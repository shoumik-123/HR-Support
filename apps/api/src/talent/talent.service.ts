import { Injectable, NotFoundException } from "@nestjs/common";
import { AiRequestError, AiService } from "../ai/ai.service";
import { shouldMask, view } from "../candidates/candidate-view";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { can, Permission } from "../common/permissions";
import { Prisma } from "../generated/prisma/client";
import { redactResumeText } from "../matching/redaction";
import { PrismaService } from "../prisma/prisma.service";
import { ParsedResume } from "../resumes/parsed-resume";
import { canonicalSkill } from "../resumes/skills";
import { aiParseQuery, TALENT_QUERY_PROMPT_VERSION } from "./talent-ai";
import { describeQuery, isEmptyQuery, normaliseQuery, parseQuery, TalentQuery } from "./talent-query";
import { hasExcludedSkill, SearchSubject, scoreSubject } from "./talent-scoring";

const HEURISTIC_QUERY_VERSION = "talent-query-heuristic-v1";

/**
 * How many candidates one search reads in full. A search that would exceed it says so
 * rather than quietly ranking a slice of the pool and calling it the best match.
 */
const POOL_CAP = 400;

/** Terms worth pushing down into SQL. More than this and the prefilter costs more than it saves. */
const PREFILTER_TERMS = 8;

export interface SearchInput {
  phrase: string;
  page: number;
  pageSize: number;
  /** Criteria the recruiter corrected by hand, or a saved search's stored criteria. */
  criteria?: TalentQuery;
  savedSearchId?: string;
}

@Injectable()
export class TalentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly activity: ActivityService,
  ) {}

  async search(ctx: RequestContext, input: SearchInput) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.orgId },
      select: { blindModeDefault: true },
    });
    const mask = shouldMask(ctx, org.blindModeDefault);

    const read = await this.readPhrase(ctx, input);
    const query = read.query;

    const { subjects, poolTotal } = await this.pool(ctx.orgId, query, mask);

    let excludedCount = 0;
    const scored = [];
    for (const subject of subjects) {
      if (query.excludedSkills.length && hasExcludedSkill(query, subject)) {
        excludedCount++;
        continue;
      }
      scored.push({ subject, hit: scoreSubject(query, subject) });
    }

    // An empty query cannot rank anything, so the pool is simply listed newest first.
    const empty = isEmptyQuery(query);
    scored.sort((a, b) =>
      empty
        ? b.subject.updatedAt.getTime() - a.subject.updatedAt.getTime()
        : b.hit.score - a.hit.score || b.subject.updatedAt.getTime() - a.subject.updatedAt.getTime(),
    );

    const start = (input.page - 1) * input.pageSize;
    const pageItems = scored.slice(start, start + input.pageSize);
    const pipelines = await this.pipelinesFor(ctx.orgId, pageItems.map((s) => s.subject.id));

    await this.activity.log({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: "talent.searched",
      entityType: "organization",
      entityId: ctx.orgId,
      // The phrase is the recruiter's own wording, and keeping it makes a sourcing decision
      // auditable later; no candidate data goes into the log.
      data: { phrase: input.phrase.slice(0, 300), method: read.method, results: scored.length, pool: poolTotal } as never,
      ip: ctx.ip,
    });

    return {
      query: { ...query, interpretation: read.interpretation, confidence: read.confidence },
      method: read.method,
      model: read.model,
      promptVersion: read.promptVersion,
      fallbackReason: read.fallbackReason,
      unclear: read.unclear,
      blindMode: mask,
      poolSearched: subjects.length,
      poolTotal,
      poolTruncated: poolTotal > subjects.length,
      excludedCount,
      total: scored.length,
      page: input.page,
      pageSize: input.pageSize,
      /** False when the search named nothing to rank by, so the list carries no scores. */
      ranked: !empty,
      items: pageItems.map(({ subject, hit }) => ({
        candidate: view(
          {
            id: subject.id,
            fullName: subject.fullName,
            headline: subject.headline,
            location: subject.location,
            skills: subject.skills,
            tags: subject.tags,
            totalExperienceYears: subject.totalExperienceYears,
            updatedAt: subject.updatedAt,
          },
          mask,
        ),
        ...hit,
        score: empty ? null : hit.score,
        pipelines: pipelines.get(subject.id) ?? [],
      })),
    };
  }

  /**
   * Decide what the search is looking for. Hand-corrected criteria win; otherwise the model
   * reads the phrase when it is available and the member may use AI, and the rule-based
   * parser stands in whenever it is not.
   */
  private async readPhrase(ctx: RequestContext, input: SearchInput) {
    const base = {
      model: null as string | null,
      unclear: [] as string[],
      fallbackReason: undefined as string | undefined,
    };

    if (input.criteria) {
      const query = normaliseQuery(input.criteria);
      return {
        ...base,
        query,
        method: "MANUAL" as const,
        promptVersion: HEURISTIC_QUERY_VERSION,
        interpretation: describeQuery(query),
        confidence: 1,
      };
    }

    // A member without permission to use AI still gets the full search; it is read by rules.
    if (this.ai.enabled && can(ctx.role, Permission.AiUse)) {
      try {
        const parsed = await aiParseQuery(this.ai, ctx.orgId, input.phrase);
        return {
          query: normaliseQuery(parsed),
          method: "AI" as const,
          model: parsed.model,
          promptVersion: TALENT_QUERY_PROMPT_VERSION,
          interpretation: parsed.interpretation,
          confidence: parsed.confidence,
          unclear: parsed.unclear,
          fallbackReason: undefined,
        };
      } catch (err) {
        // A search must never fail because the model did; the rules take over and say so.
        base.fallbackReason = err instanceof AiRequestError ? err.message : "AI could not read the search phrase";
      }
    }

    const parsed = parseQuery(input.phrase);
    return {
      ...base,
      query: normaliseQuery(parsed),
      method: "HEURISTIC" as const,
      promptVersion: HEURISTIC_QUERY_VERSION,
      interpretation: parsed.interpretation,
      confidence: parsed.confidence,
    };
  }

  /** Load the candidates worth scoring, with the material each score must cite. */
  private async pool(orgId: string, query: TalentQuery, mask: boolean) {
    const where: Prisma.CandidateWhereInput = { organizationId: orgId, deletedAt: null };
    if (query.tags.length) where.tags = { hasSome: query.tags };

    const terms = [...new Set([...(query.requiredSkills.length ? query.requiredSkills : query.preferredSkills), ...query.titles])].slice(0, PREFILTER_TERMS);
    if (terms.length) {
      // Narrow in SQL where it is cheap, but keep anyone whose resume text mentions a term
      // without it reaching their skill list - that is exactly who a keyword filter loses.
      where.OR = [
        { skills: { hasSome: terms.map(canonicalSkill) } },
        ...terms.flatMap((t) => [
          { headline: { contains: t, mode: "insensitive" as const } },
          { summary: { contains: t, mode: "insensitive" as const } },
          { resumes: { some: { rawText: { contains: t, mode: "insensitive" as const } } } },
        ]),
      ];
    }

    const [poolTotal, rows] = await Promise.all([
      this.prisma.candidate.count({ where }),
      this.prisma.candidate.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: POOL_CAP,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          headline: true,
          summary: true,
          location: true,
          skills: true,
          tags: true,
          totalExperienceYears: true,
          updatedAt: true,
          resumes: {
            orderBy: { version: "desc" },
            take: 1,
            select: { rawText: true, parsed: true, overallConfidence: true },
          },
        },
      }),
    ]);

    const subjects: SearchSubject[] = rows.map((c) => {
      const resume = c.resumes[0];
      const parsed = (resume?.parsed ?? null) as ParsedResume | null;
      const rawText = (resume?.rawText ?? "").slice(0, 20_000);
      return {
        id: c.id,
        fullName: c.fullName,
        headline: c.headline,
        summary: c.summary,
        location: c.location,
        skills: c.skills,
        tags: c.tags,
        totalExperienceYears: c.totalExperienceYears,
        // In blind mode the resume is redacted before it is searched at all, so a name
        // cannot be probed by typing it and seeing which masked card comes back.
        resumeText: mask ? redactResumeText(rawText, [c.fullName, c.email, c.phone]) : rawText,
        jobTitles: (parsed?.experience ?? []).map((e) => e.title).filter((t): t is string => !!t),
        educationText: (parsed?.education ?? []).map((e) => [e.degree, e.field, e.institution].filter(Boolean).join(" ")).join("\n"),
        parseConfidence: resume?.overallConfidence ?? 0.3,
        updatedAt: c.updatedAt,
      };
    });

    return { subjects, poolTotal };
  }

  /** Which jobs each candidate is already in, so nobody is sourced into a pipeline twice. */
  private async pipelinesFor(orgId: string, candidateIds: string[]) {
    if (!candidateIds.length) return new Map<string, { jobId: string; jobTitle: string; stageName: string; status: string }[]>();
    const apps = await this.prisma.application.findMany({
      where: { organizationId: orgId, candidateId: { in: candidateIds } },
      select: { candidateId: true, jobId: true, status: true, job: { select: { title: true } }, stage: { select: { name: true } } },
    });
    const byCandidate = new Map<string, { jobId: string; jobTitle: string; stageName: string; status: string }[]>();
    for (const a of apps) {
      const list = byCandidate.get(a.candidateId) ?? [];
      list.push({ jobId: a.jobId, jobTitle: a.job.title, stageName: a.stage.name, status: a.status });
      byCandidate.set(a.candidateId, list);
    }
    return byCandidate;
  }

  // ───────────────────────── Saved searches ─────────────────────────

  /** Saved searches are per member: a recruiter sees their own, and only their own. */
  async listSaved(ctx: RequestContext) {
    return this.prisma.savedSearch.findMany({
      where: { organizationId: ctx.orgId, createdById: ctx.userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }

  async save(ctx: RequestContext, input: { name: string; phrase: string; criteria: TalentQuery }) {
    const criteria = normaliseQuery(input.criteria) as unknown as Prisma.InputJsonValue;
    const saved = await this.prisma.savedSearch.upsert({
      where: { organizationId_createdById_name: { organizationId: ctx.orgId, createdById: ctx.userId, name: input.name } },
      create: { organizationId: ctx.orgId, createdById: ctx.userId, name: input.name, phrase: input.phrase, criteria },
      update: { phrase: input.phrase, criteria },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "talent.search_saved", entityType: "savedSearch", entityId: saved.id,
      data: { name: saved.name } as never, ip: ctx.ip,
    });
    return saved;
  }

  async runSaved(ctx: RequestContext, id: string, page: number, pageSize: number) {
    const saved = await this.prisma.savedSearch.findFirst({ where: { id, organizationId: ctx.orgId, createdById: ctx.userId } });
    if (!saved) throw new NotFoundException("Saved search not found");
    await this.prisma.savedSearch.update({ where: { id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
    const results = await this.search(ctx, {
      phrase: saved.phrase,
      page,
      pageSize,
      criteria: normaliseQuery(saved.criteria as unknown as Partial<TalentQuery>),
    });
    return { ...results, savedSearch: { id: saved.id, name: saved.name, phrase: saved.phrase } };
  }

  async deleteSaved(ctx: RequestContext, id: string) {
    const saved = await this.prisma.savedSearch.findFirst({ where: { id, organizationId: ctx.orgId, createdById: ctx.userId } });
    if (!saved) throw new NotFoundException("Saved search not found");
    await this.prisma.savedSearch.delete({ where: { id } });
    return { deleted: true };
  }
}
