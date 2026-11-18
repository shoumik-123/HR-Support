import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { can, Permission } from "../common/permissions";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { CandidateSource, ConsentStatus } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { canonicalSkill } from "../resumes/skills";
import { StorageService } from "../storage/storage.service";
import { shouldMask, view } from "./candidate-view";

export interface CandidateListQuery {
  page: number;
  pageSize: number;
  search?: string;
  skills?: string[];
  tags?: string[];
  minExperience?: number;
  maxExperience?: number;
  source?: CandidateSource;
  notInJobId?: string;
}

export interface CandidateInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  headline?: string | null;
  summary?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  totalExperienceYears?: number | null;
  skills?: string[];
  tags?: string[];
  source?: CandidateSource;
  consentStatus?: ConsentStatus;
}

const LIST_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  location: true,
  headline: true,
  totalExperienceYears: true,
  skills: true,
  tags: true,
  source: true,
  consentStatus: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { applications: true, resumes: true } },
} satisfies Prisma.CandidateSelect;

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly storage: StorageService,
  ) {}

  async orgBlind(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { blindModeDefault: true } });
    return org.blindModeDefault;
  }

  async list(ctx: RequestContext, q: CandidateListQuery) {
    const mask = shouldMask(ctx, await this.orgBlind(ctx.orgId));
    const and: Prisma.CandidateWhereInput[] = [{ organizationId: ctx.orgId, deletedAt: null }];
    if (q.search) {
      const term = q.search.trim();
      and.push({
        OR: [
          // Identity search is disabled in blind mode so names can't be probed.
          ...(mask ? [] : [{ fullName: { contains: term, mode: "insensitive" as const } }, { email: { contains: term, mode: "insensitive" as const } }]),
          { headline: { contains: term, mode: "insensitive" } },
          { summary: { contains: term, mode: "insensitive" } },
          { skills: { has: canonicalSkill(term) } },
          { tags: { has: term } },
        ],
      });
    }
    if (q.skills?.length) and.push({ skills: { hasEvery: q.skills.map(canonicalSkill) } });
    if (q.tags?.length) and.push({ tags: { hasEvery: q.tags } });
    if (q.minExperience != null) and.push({ totalExperienceYears: { gte: q.minExperience } });
    if (q.maxExperience != null) and.push({ totalExperienceYears: { lte: q.maxExperience } });
    if (q.source) and.push({ source: q.source });
    if (q.notInJobId) and.push({ applications: { none: { jobId: q.notInJobId } } });

    const where: Prisma.CandidateWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      this.prisma.candidate.findMany({ where, select: LIST_SELECT, orderBy: { createdAt: "desc" }, ...paginate(q.page, q.pageSize) }),
      this.prisma.candidate.count({ where }),
    ]);
    return { items: items.map((c) => view(c, mask)), total, page: q.page, pageSize: q.pageSize };
  }

  async get(ctx: RequestContext, id: string, reveal: boolean) {
    const orgBlind = await this.orgBlind(ctx.orgId);
    if (reveal && !can(ctx.role, Permission.CandidateContactView)) throw new ForbiddenException("You cannot view candidate identity");
    const mask = shouldMask(ctx, orgBlind, reveal);

    const candidate = await this.prisma.candidate.findFirst({
      where: { id, organizationId: ctx.orgId, deletedAt: null },
      include: {
        resumes: {
          orderBy: { version: "desc" },
          select: {
            id: true, fileName: true, mimeType: true, sizeBytes: true, version: true, status: true, parseMethod: true,
            model: true, promptVersion: true, overallConfidence: true, error: true, createdAt: true, processedAt: true,
          },
        },
        applications: {
          orderBy: { createdAt: "desc" },
          include: {
            job: { select: { id: true, title: true, status: true } },
            stage: { select: { id: true, name: true, kind: true, color: true } },
            matches: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });
    if (!candidate) throw new NotFoundException("Candidate not found");

    if (reveal && orgBlind) {
      await this.activity.log({ orgId: ctx.orgId, actorId: ctx.userId, action: "candidate.identity_revealed", entityType: "candidate", entityId: id, candidateId: id, ip: ctx.ip });
    }

    const [notes, timeline] = await Promise.all([this.notes(ctx, id), this.timeline(ctx, id)]);
    return { ...view(candidate, mask), blindMode: orgBlind, notes, timeline };
  }

  async create(ctx: RequestContext, input: CandidateInput & { fullName: string }) {
    const candidate = await this.prisma.candidate.create({
      data: {
        ...input,
        skills: input.skills?.map(canonicalSkill) ?? [],
        organizationId: ctx.orgId,
        createdById: ctx.userId,
        source: input.source ?? "OTHER",
        consentUpdatedAt: input.consentStatus ? new Date() : undefined,
      },
    });
    await this.log(ctx, "candidate.created", candidate.id, { source: candidate.source });
    return candidate;
  }

  async update(ctx: RequestContext, id: string, input: CandidateInput) {
    const existing = await this.find(ctx, id);
    const candidate = await this.prisma.candidate.update({
      where: { id },
      data: {
        ...input,
        ...(input.skills ? { skills: [...new Set(input.skills.map(canonicalSkill))] } : {}),
        ...(input.consentStatus && input.consentStatus !== existing.consentStatus ? { consentUpdatedAt: new Date() } : {}),
      },
    });
    await this.log(ctx, input.consentStatus && input.consentStatus !== existing.consentStatus ? "candidate.consent_changed" : "candidate.updated", id, {
      fields: Object.keys(input),
      ...(input.consentStatus ? { consent: input.consentStatus } : {}),
    });
    return candidate;
  }

  /** Permanent deletion (right to erasure): removes profile, applications, matches and files. */
  async remove(ctx: RequestContext, id: string) {
    await this.find(ctx, id);
    const resumes = await this.prisma.resume.findMany({ where: { candidateId: id }, select: { id: true, storageKey: true } });
    await this.prisma.$transaction([
      this.prisma.resume.deleteMany({ where: { candidateId: id } }),
      this.prisma.candidate.delete({ where: { id } }),
    ]);
    await Promise.all(resumes.map((r) => this.storage.remove(r.storageKey)));
    // Logged without personal data.
    await this.log(ctx, "candidate.deleted", id, { resumesDeleted: resumes.length });
  }

  /** Data export (data portability). Includes everything stored about the candidate. */
  async export(ctx: RequestContext, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: {
        resumes: { select: { fileName: true, version: true, createdAt: true, parsed: true, parseMethod: true, model: true } },
        applications: { include: { job: { select: { title: true } }, stage: { select: { name: true } }, matches: true } },
        notes: true,
      },
    });
    if (!candidate) throw new NotFoundException("Candidate not found");
    await this.log(ctx, "candidate.exported", id);
    return { exportedAt: new Date().toISOString(), candidate };
  }

  async notes(ctx: RequestContext, candidateId: string) {
    const notes = await this.prisma.note.findMany({
      where: { organizationId: ctx.orgId, candidateId },
      orderBy: { createdAt: "desc" },
    });
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(notes.map((n) => n.authorId))] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(authors.map((a) => [a.id, a.name]));
    return notes.map((n) => ({ ...n, authorName: nameById.get(n.authorId) ?? "Former member" }));
  }

  async addNote(ctx: RequestContext, candidateId: string, body: string, applicationId?: string) {
    await this.find(ctx, candidateId);
    if (applicationId) {
      const app = await this.prisma.application.findFirst({ where: { id: applicationId, candidateId, organizationId: ctx.orgId } });
      if (!app) throw new NotFoundException("Application not found");
    }
    const note = await this.prisma.note.create({
      data: { organizationId: ctx.orgId, candidateId, applicationId, authorId: ctx.userId, body },
    });
    await this.log(ctx, "note.added", candidateId, { noteId: note.id });
    return { ...note, authorName: ctx.name };
  }

  async deleteNote(ctx: RequestContext, candidateId: string, noteId: string) {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, candidateId, organizationId: ctx.orgId } });
    if (!note) throw new NotFoundException("Note not found");
    if (note.authorId !== ctx.userId && !can(ctx.role, Permission.CandidateDelete)) {
      throw new ForbiddenException("You can only delete your own notes");
    }
    await this.prisma.note.delete({ where: { id: noteId } });
    await this.log(ctx, "note.deleted", candidateId, { noteId });
  }

  async timeline(ctx: RequestContext, candidateId: string) {
    const items = await this.prisma.activity.findMany({
      where: { organizationId: ctx.orgId, candidateId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.actorId).filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(actors.map((a) => [a.id, a.name]));
    return items.map((i) => ({ ...i, actorName: i.actorId ? nameById.get(i.actorId) ?? "Former member" : "System" }));
  }

  async allTags(ctx: RequestContext) {
    const rows = await this.prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT unnest(tags) AS tag, count(*) AS count FROM "Candidate"
      WHERE "organizationId" = ${ctx.orgId} AND "deletedAt" IS NULL
      GROUP BY tag ORDER BY count DESC LIMIT 200`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  async find(ctx: RequestContext, id: string) {
    const c = await this.prisma.candidate.findFirst({ where: { id, organizationId: ctx.orgId, deletedAt: null } });
    if (!c) throw new NotFoundException("Candidate not found");
    return c;
  }

  private log(ctx: RequestContext, action: string, candidateId: string, data?: object) {
    return this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action, entityType: "candidate", entityId: candidateId, candidateId, data: data as never, ip: ctx.ip,
    });
  }
}
