import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { AiRequestError, AiService } from "../ai/ai.service";
import { shouldMask, view } from "../candidates/candidate-view";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ParsedResume } from "../resumes/parsed-resume";
import { aiMatch, MATCH_PROMPT_VERSION } from "./ai-matcher";
import { criteriaFor } from "./criteria";
import { heuristicMatch } from "./heuristic-matcher";
import { MatchAnalysis, MatchCandidateProfile, MatchJob } from "./match-types";
import { QueueService } from "../queue/queue.service";
import { redactResumeText } from "./redaction";

export const MATCH_JOB = "match.run";
const HEURISTIC_MATCH_VERSION = "match-heuristic-v1";

@Injectable()
export class MatchingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly queue: QueueService,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    this.queue.register(MATCH_JOB, async (payload: { applicationId: string; actorId: string | null }) => {
      await this.runForApplication(payload.applicationId, payload.actorId);
    });
  }

  /** Queue matching for one or more applications. Returns immediately. */
  async queueMatches(ctx: RequestContext, applicationIds: string[]) {
    const apps = await this.prisma.application.findMany({
      where: { id: { in: applicationIds }, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (!apps.length) throw new NotFoundException("No matching applications found");
    for (const app of apps) {
      await this.queue.enqueue(MATCH_JOB, { applicationId: app.id, actorId: ctx.userId }, { orgId: ctx.orgId });
    }
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "match.queued", entityType: "application", entityId: apps[0].id,
      data: { count: apps.length }, ip: ctx.ip,
    });
    return { queued: apps.length };
  }

  /** Queue matching for every active application on a job that has no current match. */
  async queueForJob(ctx: RequestContext, jobId: string, rerunAll: boolean) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, organizationId: ctx.orgId } });
    if (!job) throw new NotFoundException("Job not found");
    const apps = await this.prisma.application.findMany({
      where: { jobId, organizationId: ctx.orgId, status: "ACTIVE", ...(rerunAll ? {} : { matches: { none: {} } }) },
      select: { id: true },
    });
    for (const app of apps) {
      await this.queue.enqueue(MATCH_JOB, { applicationId: app.id, actorId: ctx.userId }, { orgId: ctx.orgId });
    }
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "match.queued", entityType: "job", entityId: jobId, jobId,
      data: { count: apps.length, rerunAll }, ip: ctx.ip,
    });
    return { queued: apps.length };
  }

  /** Background worker body: analyse one application and store a new MatchResult. */
  async runForApplication(applicationId: string, actorId: string | null) {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        candidate: { include: { resumes: { where: { status: "PARSED" }, orderBy: { version: "desc" }, take: 1 } } },
        organization: { select: { blindModeDefault: true } },
      },
    });
    if (!app) return;

    const resume = app.candidate.resumes[0];
    const parsed = (resume?.parsed ?? null) as ParsedResume | null;
    const profile = toMatchProfile(app.candidate.skills, app.candidate.totalExperienceYears, app.candidate.headline, parsed, resume?.overallConfidence ?? 0.3);
    const criteria = criteriaFor(app.job.matchingCriteria);
    const matchJob: MatchJob = {
      title: app.job.title,
      description: app.job.description.slice(0, 8000),
      requiredSkills: app.job.requiredSkills,
      preferredSkills: app.job.preferredSkills,
      minExperienceYears: app.job.minExperienceYears,
      maxExperienceYears: app.job.maxExperienceYears,
      educationRequirement: app.job.educationRequirement,
    };

    const rawText = resume?.rawText ?? "";
    // Identity is always stripped before matching, whether or not blind mode is on for viewing.
    const redacted = redactResumeText(rawText, [app.candidate.fullName, app.candidate.email, app.candidate.phone]).slice(0, 40_000);

    let analysis: MatchAnalysis;
    let method: "AI" | "HEURISTIC";
    let model: string | null = null;
    let promptVersion: string;

    if (this.ai.enabled) {
      try {
        const result = await aiMatch(this.ai, app.organizationId, matchJob, profile, redacted, criteria);
        analysis = result.analysis;
        model = result.model;
        method = "AI";
        promptVersion = MATCH_PROMPT_VERSION;
      } catch (err) {
        if (err instanceof AiRequestError && err.retryable) throw err;
        analysis = heuristicMatch(matchJob, profile, redacted, criteria);
        method = "HEURISTIC";
        promptVersion = HEURISTIC_MATCH_VERSION;
      }
    } else {
      analysis = heuristicMatch(matchJob, profile, redacted, criteria);
      method = "HEURISTIC";
      promptVersion = HEURISTIC_MATCH_VERSION;
    }

    const result = await this.prisma.matchResult.create({
      data: {
        organizationId: app.organizationId,
        applicationId: app.id,
        jobId: app.jobId,
        candidateId: app.candidateId,
        score: analysis.score,
        breakdown: analysis.breakdown as unknown as Prisma.InputJsonValue,
        matchedSkills: analysis.matchedSkills,
        missingSkills: analysis.missingSkills,
        strengths: analysis.strengths as unknown as Prisma.InputJsonValue,
        gaps: analysis.gaps as unknown as Prisma.InputJsonValue,
        summary: analysis.summary,
        confidence: analysis.confidence,
        method,
        model,
        promptVersion,
        criteriaSnapshot: criteria as unknown as Prisma.InputJsonValue,
        blindMode: true,
      },
    });

    await this.activity.log({
      orgId: app.organizationId, actorId, action: "match.completed", entityType: "match", entityId: result.id,
      candidateId: app.candidateId, jobId: app.jobId, applicationId: app.id,
      data: { score: analysis.score, method, model, promptVersion, confidence: analysis.confidence },
    });
    return result;
  }

  async history(ctx: RequestContext, applicationId: string) {
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, organizationId: ctx.orgId } });
    if (!app) throw new NotFoundException("Application not found");
    const matches = await this.prisma.matchResult.findMany({ where: { applicationId }, orderBy: { createdAt: "desc" } });
    const reviewerIds = [...new Set(matches.map((m) => m.reviewedById).filter((x): x is string => !!x))];
    const reviewers = await this.prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } });
    const nameById = new Map(reviewers.map((r) => [r.id, r.name]));
    return matches.map((m) => ({ ...m, reviewedByName: m.reviewedById ? nameById.get(m.reviewedById) ?? null : null }));
  }

  /**
   * Human review of an AI recommendation. Recruiters accept, adjust the score, or dismiss it.
   * Nothing about the candidate's pipeline stage changes here - that stays a separate human action.
   */
  async review(ctx: RequestContext, matchId: string, input: { status: "ACCEPTED" | "ADJUSTED" | "DISMISSED"; adjustedScore?: number; note?: string }) {
    const match = await this.prisma.matchResult.findFirst({ where: { id: matchId, organizationId: ctx.orgId } });
    if (!match) throw new NotFoundException("Match result not found");
    if (input.status === "ADJUSTED" && input.adjustedScore == null) {
      throw new BadRequestException("Provide the adjusted score");
    }
    const updated = await this.prisma.matchResult.update({
      where: { id: matchId },
      data: {
        reviewStatus: input.status,
        adjustedScore: input.status === "ADJUSTED" ? input.adjustedScore : null,
        reviewNote: input.note,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "match.reviewed", entityType: "match", entityId: matchId,
      candidateId: match.candidateId, jobId: match.jobId, applicationId: match.applicationId,
      data: { status: input.status, aiScore: match.score, adjustedScore: input.adjustedScore ?? null }, ip: ctx.ip,
    });
    return updated;
  }

  /** Ranked shortlist for a job: latest match per application, reviewer adjustments applied. */
  async ranking(ctx: RequestContext, jobId: string, q: { page: number; pageSize: number; minScore?: number; stageId?: string }) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, organizationId: ctx.orgId } });
    if (!job) throw new NotFoundException("Job not found");
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));

    const applications = await this.prisma.application.findMany({
      where: { jobId, organizationId: ctx.orgId, status: "ACTIVE", ...(q.stageId ? { stageId: q.stageId } : {}) },
      include: {
        candidate: { select: { id: true, fullName: true, headline: true, totalExperienceYears: true, skills: true, email: true, phone: true } },
        stage: { select: { id: true, name: true, color: true } },
        matches: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const rows = applications
      .map((app) => {
        const match = app.matches[0];
        const effectiveScore = match ? match.adjustedScore ?? match.score : null;
        return {
          applicationId: app.id,
          stage: app.stage,
          candidate: view(app.candidate, mask),
          match: match
            ? {
                id: match.id, score: match.score, adjustedScore: match.adjustedScore, effectiveScore, confidence: match.confidence,
                method: match.method, model: match.model, promptVersion: match.promptVersion, reviewStatus: match.reviewStatus,
                matchedSkills: match.matchedSkills, missingSkills: match.missingSkills, summary: match.summary,
                breakdown: match.breakdown, strengths: match.strengths, gaps: match.gaps, createdAt: match.createdAt,
              }
            : null,
          effectiveScore,
        };
      })
      .filter((r) => (q.minScore == null ? true : (r.effectiveScore ?? -1) >= q.minScore))
      // Unmatched applications sort last rather than appearing as zero-score candidates.
      .sort((a, b) => (b.effectiveScore ?? -1) - (a.effectiveScore ?? -1));

    const { skip, take } = paginate(q.page, q.pageSize);
    return { items: rows.slice(skip, skip + take), total: rows.length, page: q.page, pageSize: q.pageSize, unmatched: rows.filter((r) => !r.match).length };
  }

  /** Side-by-side comparison of up to 5 candidates on one job. */
  async compare(ctx: RequestContext, jobId: string, applicationIds: string[]) {
    const apps = await this.prisma.application.findMany({
      where: { id: { in: applicationIds }, jobId, organizationId: ctx.orgId },
      include: {
        candidate: { select: { id: true, fullName: true, headline: true, totalExperienceYears: true, skills: true, email: true } },
        matches: { orderBy: { createdAt: "desc" }, take: 1 },
        stage: { select: { name: true } },
      },
    });
    if (apps.length < 2) throw new BadRequestException("Select at least two candidates to compare");
    const job = await this.prisma.job.findFirstOrThrow({ where: { id: jobId, organizationId: ctx.orgId } });
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));
    return {
      job: { id: job.id, title: job.title, requiredSkills: job.requiredSkills, preferredSkills: job.preferredSkills },
      blindMode: mask,
      candidates: apps.map((a) => ({
        applicationId: a.id,
        stage: a.stage.name,
        candidate: view(a.candidate, mask),
        match: a.matches[0] ?? null,
      })),
    };
  }

  private async blindMode(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { blindModeDefault: true } });
    return org.blindModeDefault;
  }
}

export function toMatchProfile(
  skills: string[],
  totalExperienceYears: number | null,
  headline: string | null,
  parsed: ParsedResume | null,
  parseConfidence: number,
): MatchCandidateProfile {
  return {
    skills,
    totalExperienceYears,
    headline,
    parseConfidence,
    education: parsed?.education.map((e) => ({ degree: e.degree, field: e.field, institution: e.institution, evidence: e.evidence })) ?? [],
    certifications: parsed?.certifications.map((c) => ({ name: c.name, issuer: c.issuer, evidence: c.evidence })) ?? [],
    projects: parsed?.projects.map((p) => ({ name: p.name, description: p.description, technologies: p.technologies, evidence: p.evidence })) ?? [],
    experience:
      parsed?.experience.map((e) => ({
        title: e.title, company: e.company, startDate: e.startDate, endDate: e.endDate, description: e.description, evidence: e.evidence,
      })) ?? [],
  };
}
