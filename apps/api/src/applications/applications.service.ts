import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { shouldMask, view } from "../candidates/candidate-view";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { ApplicationStatus, CandidateSource } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";

export interface BoardQuery {
  jobId: string;
  perStage: number;
  search?: string;
  minScore?: number;
}

const CARD_SELECT = {
  id: true,
  stageId: true,
  status: true,
  stageEnteredAt: true,
  createdAt: true,
  isReapplication: true,
  source: true,
  candidate: { select: { id: true, fullName: true, email: true, headline: true, totalExperienceYears: true, skills: true, tags: true } },
  matches: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, score: true, adjustedScore: true, confidence: true, reviewStatus: true, method: true, missingSkills: true },
  },
} satisfies Prisma.ApplicationSelect;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** Kanban board: stages with their applications, capped per stage. */
  async board(ctx: RequestContext, q: BoardQuery) {
    const job = await this.prisma.job.findFirst({ where: { id: q.jobId, organizationId: ctx.orgId } });
    if (!job) throw new NotFoundException("Job not found");
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));

    const stages = await this.prisma.pipelineStage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { position: "asc" } });
    const where: Prisma.ApplicationWhereInput = {
      jobId: q.jobId,
      organizationId: ctx.orgId,
      ...(q.search && !mask
        ? { candidate: { OR: [{ fullName: { contains: q.search, mode: "insensitive" } }, { skills: { has: q.search } }] } }
        : q.search
          ? { candidate: { skills: { has: q.search } } }
          : {}),
    };

    const [applications, counts] = await Promise.all([
      this.prisma.application.findMany({ where, select: CARD_SELECT, orderBy: { stageEnteredAt: "desc" } }),
      this.prisma.application.groupBy({ by: ["stageId"], where, _count: true }),
    ]);
    const countByStage = new Map(counts.map((c) => [c.stageId, c._count]));

    const cards = applications
      .map((a) => {
        const match = a.matches[0];
        const effectiveScore = match ? match.adjustedScore ?? match.score : null;
        return { ...a, candidate: view(a.candidate, mask), match: match ?? null, effectiveScore, matches: undefined };
      })
      .filter((a) => (q.minScore == null ? true : (a.effectiveScore ?? -1) >= q.minScore));

    return {
      job: { id: job.id, title: job.title, status: job.status },
      blindMode: mask,
      stages: stages.map((stage) => ({
        ...stage,
        total: countByStage.get(stage.id) ?? 0,
        applications: cards
          .filter((c) => c.stageId === stage.id)
          .sort((a, b) => (b.effectiveScore ?? -1) - (a.effectiveScore ?? -1))
          .slice(0, q.perStage),
      })),
    };
  }

  async list(ctx: RequestContext, q: { page: number; pageSize: number; jobId?: string; stageId?: string; status?: ApplicationStatus; candidateId?: string }) {
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));
    const where: Prisma.ApplicationWhereInput = {
      organizationId: ctx.orgId,
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.candidateId ? { candidateId: q.candidateId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        select: { ...CARD_SELECT, job: { select: { id: true, title: true } }, stage: { select: { id: true, name: true, color: true } } },
        orderBy: { createdAt: "desc" },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.application.count({ where }),
    ]);
    return {
      items: items.map((a) => ({ ...a, candidate: view(a.candidate, mask), match: a.matches[0] ?? null, matches: undefined })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Add an existing candidate to a job (talent pool rediscovery). */
  async create(ctx: RequestContext, jobId: string, candidateId: string, source: CandidateSource = "OTHER") {
    const [job, candidate] = await Promise.all([
      this.prisma.job.findFirst({ where: { id: jobId, organizationId: ctx.orgId } }),
      this.prisma.candidate.findFirst({ where: { id: candidateId, organizationId: ctx.orgId, deletedAt: null } }),
    ]);
    if (!job) throw new NotFoundException("Job not found");
    if (!candidate) throw new NotFoundException("Candidate not found");
    if (job.status === "ARCHIVED") throw new BadRequestException("This job is archived");

    const existing = await this.prisma.application.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
    if (existing) throw new BadRequestException("This candidate is already on this job");

    const applied = await this.prisma.pipelineStage.findFirstOrThrow({ where: { organizationId: ctx.orgId, kind: "APPLIED" } });
    const priorApplications = await this.prisma.application.count({ where: { organizationId: ctx.orgId, candidateId } });
    const application = await this.prisma.application.create({
      data: { organizationId: ctx.orgId, jobId, candidateId, stageId: applied.id, source, isReapplication: priorApplications > 0 },
    });
    await this.log(ctx, "application.created", application, { via: "manual" });
    return application;
  }

  async move(ctx: RequestContext, applicationId: string, stageId: string) {
    const app = await this.find(ctx, applicationId);
    const stage = await this.prisma.pipelineStage.findFirst({ where: { id: stageId, organizationId: ctx.orgId } });
    if (!stage) throw new NotFoundException("Stage not found");
    if (app.stageId === stageId) return app;
    if (stage.kind === "REJECTED") throw new BadRequestException("Use the reject action so a reason is recorded");

    const previous = await this.prisma.pipelineStage.findUnique({ where: { id: app.stageId }, select: { name: true } });
    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        stageId,
        stageEnteredAt: new Date(),
        status: stage.kind === "HIRED" ? "HIRED" : "ACTIVE",
        hiredAt: stage.kind === "HIRED" ? new Date() : null,
        ...(app.status === "REJECTED" ? { rejectionReason: null, rejectedAt: null } : {}),
      },
    });
    await this.log(ctx, "application.stage_changed", updated, { from: previous?.name, to: stage.name });
    return updated;
  }

  async reject(ctx: RequestContext, applicationId: string, reason: string) {
    const app = await this.find(ctx, applicationId);
    const rejected = await this.prisma.pipelineStage.findFirstOrThrow({ where: { organizationId: ctx.orgId, kind: "REJECTED" } });
    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: { stageId: rejected.id, status: "REJECTED", rejectionReason: reason, rejectedAt: new Date(), stageEnteredAt: new Date() },
    });
    // Rejection is always an explicit human decision; AI never performs it.
    await this.log(ctx, "application.rejected", updated, { reason, fromStageId: app.stageId, decidedBy: ctx.name });
    return updated;
  }

  async bulk(ctx: RequestContext, applicationIds: string[], action: { type: "move"; stageId: string } | { type: "reject"; reason: string }) {
    const apps = await this.prisma.application.findMany({
      where: { id: { in: applicationIds }, organizationId: ctx.orgId },
      select: { id: true },
    });
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const { id } of apps) {
      try {
        if (action.type === "move") await this.move(ctx, id, action.stageId);
        else await this.reject(ctx, id, action.reason);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : "Failed" });
      }
    }
    return { processed: results.filter((r) => r.ok).length, results };
  }

  async get(ctx: RequestContext, id: string) {
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));
    const app = await this.prisma.application.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: {
        job: true,
        stage: true,
        candidate: { include: { resumes: { orderBy: { version: "desc" }, select: { id: true, fileName: true, version: true, status: true, overallConfidence: true } } } },
        matches: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!app) throw new NotFoundException("Application not found");
    return { ...app, candidate: view(app.candidate, mask), blindMode: mask };
  }

  private async find(ctx: RequestContext, id: string) {
    const app = await this.prisma.application.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!app) throw new NotFoundException("Application not found");
    return app;
  }

  private async blindMode(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { blindModeDefault: true } });
    return org.blindModeDefault;
  }

  private log(ctx: RequestContext, action: string, app: { id: string; candidateId: string; jobId: string }, data?: object) {
    return this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action, entityType: "application", entityId: app.id,
      candidateId: app.candidateId, jobId: app.jobId, applicationId: app.id, data: data as never, ip: ctx.ip,
    });
  }
}
