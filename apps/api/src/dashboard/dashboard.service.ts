import { Injectable } from "@nestjs/common";
import { RequestContext } from "../common/context";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Headline numbers plus the recruitment funnel for the last `days` days. */
  async overview(ctx: RequestContext, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const org = { organizationId: ctx.orgId };

    const [activeJobs, draftJobs, totalCandidates, newCandidates, totalApplications, newApplications, hired, rejected, stages, byStage, pendingReview, parseStats] =
      await Promise.all([
        this.prisma.job.count({ where: { ...org, status: "PUBLISHED" } }),
        this.prisma.job.count({ where: { ...org, status: "DRAFT" } }),
        this.prisma.candidate.count({ where: { ...org, deletedAt: null } }),
        this.prisma.candidate.count({ where: { ...org, deletedAt: null, createdAt: { gte: since } } }),
        this.prisma.application.count({ where: org }),
        this.prisma.application.count({ where: { ...org, createdAt: { gte: since } } }),
        this.prisma.application.findMany({ where: { ...org, status: "HIRED", hiredAt: { gte: since } }, select: { createdAt: true, hiredAt: true } }),
        this.prisma.application.count({ where: { ...org, status: "REJECTED", rejectedAt: { gte: since } } }),
        this.prisma.pipelineStage.findMany({ where: org, orderBy: { position: "asc" } }),
        this.prisma.application.groupBy({ by: ["stageId"], where: { ...org, status: "ACTIVE" }, _count: true }),
        this.prisma.matchResult.count({ where: { ...org, reviewStatus: "PENDING" } }),
        this.prisma.resume.groupBy({ by: ["status"], where: org, _count: true }),
      ]);

    const countByStage = new Map(byStage.map((s) => [s.stageId, s._count]));
    const timeToHireDays = hired.length
      ? Math.round(hired.reduce((sum, a) => sum + (a.hiredAt!.getTime() - a.createdAt.getTime()), 0) / hired.length / 86_400_000)
      : null;

    const parsed = parseStats.find((p) => p.status === "PARSED")?._count ?? 0;
    const failed = parseStats.find((p) => p.status === "FAILED")?._count ?? 0;
    const pendingResumes = parseStats.filter((p) => p.status === "UPLOADED" || p.status === "PROCESSING").reduce((s, p) => s + p._count, 0);

    return {
      periodDays: days,
      jobs: { active: activeJobs, draft: draftJobs },
      candidates: { total: totalCandidates, new: newCandidates },
      applications: { total: totalApplications, new: newApplications, hired: hired.length, rejected },
      funnel: stages.map((s) => ({ stageId: s.id, name: s.name, kind: s.kind, color: s.color, count: countByStage.get(s.id) ?? 0 })),
      timeToHireDays,
      pendingMatchReviews: pendingReview,
      resumeProcessing: { parsed, failed, pending: pendingResumes, successRate: parsed + failed ? Math.round((parsed / (parsed + failed)) * 100) : null },
    };
  }

  /** Per-job performance: applications, shortlist/interview conversion, average match score. */
  async jobPerformance(ctx: RequestContext) {
    const jobs = await this.prisma.job.findMany({
      where: { organizationId: ctx.orgId, status: { not: "ARCHIVED" } },
      select: { id: true, title: true, status: true, openings: true, publishedAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (!jobs.length) return [];
    const jobIds = jobs.map((j) => j.id);

    const [apps, stages, scores] = await Promise.all([
      this.prisma.application.findMany({
        where: { jobId: { in: jobIds } },
        select: { jobId: true, stageId: true, status: true, createdAt: true, hiredAt: true },
      }),
      this.prisma.pipelineStage.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, kind: true, position: true } }),
      this.prisma.matchResult.groupBy({ by: ["jobId"], where: { jobId: { in: jobIds } }, _avg: { score: true }, _count: true }),
    ]);

    const stageById = new Map(stages.map((s) => [s.id, s]));
    const shortlistPos = stages.find((s) => s.kind === "SHORTLISTED")?.position ?? 2;
    const interviewPos = stages.find((s) => s.kind === "INTERVIEW")?.position ?? 4;
    const scoreByJob = new Map(scores.map((s) => [s.jobId, s]));

    return jobs.map((job) => {
      const jobApps = apps.filter((a) => a.jobId === job.id);
      const reached = (minPos: number) =>
        jobApps.filter((a) => {
          const pos = stageById.get(a.stageId)?.position ?? 0;
          return pos >= minPos || a.status === "HIRED";
        }).length;
      const hiredApps = jobApps.filter((a) => a.status === "HIRED" && a.hiredAt);
      const score = scoreByJob.get(job.id);
      return {
        ...job,
        applications: jobApps.length,
        shortlisted: reached(shortlistPos),
        interviewed: reached(interviewPos),
        hired: hiredApps.length,
        rejected: jobApps.filter((a) => a.status === "REJECTED").length,
        shortlistRate: jobApps.length ? Math.round((reached(shortlistPos) / jobApps.length) * 100) : 0,
        interviewRate: jobApps.length ? Math.round((reached(interviewPos) / jobApps.length) * 100) : 0,
        averageMatchScore: score?._avg.score != null ? Math.round(score._avg.score) : null,
        matchesRun: score?._count ?? 0,
        timeToHireDays: hiredApps.length
          ? Math.round(hiredApps.reduce((s, a) => s + (a.hiredAt!.getTime() - a.createdAt.getTime()), 0) / hiredApps.length / 86_400_000)
          : null,
      };
    });
  }

  /** AI oversight: how often humans accept, adjust or dismiss AI recommendations. */
  async aiOversight(ctx: RequestContext, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [byStatus, adjusted, usage] = await Promise.all([
      this.prisma.matchResult.groupBy({ by: ["reviewStatus"], where: { organizationId: ctx.orgId, createdAt: { gte: since } }, _count: true }),
      this.prisma.matchResult.findMany({
        where: { organizationId: ctx.orgId, reviewStatus: "ADJUSTED", createdAt: { gte: since } },
        select: { score: true, adjustedScore: true },
      }),
      this.prisma.aiUsage.groupBy({ by: ["feature"], where: { organizationId: ctx.orgId, createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true }, _count: true }),
    ]);

    const reviews = Object.fromEntries(byStatus.map((s) => [s.reviewStatus, s._count]));
    const reviewed = (reviews.ACCEPTED ?? 0) + (reviews.ADJUSTED ?? 0) + (reviews.DISMISSED ?? 0);
    const deltas = adjusted.filter((a) => a.adjustedScore != null).map((a) => a.adjustedScore! - a.score);
    return {
      periodDays: days,
      reviews,
      reviewedShare: reviewed + (reviews.PENDING ?? 0) ? Math.round((reviewed / (reviewed + (reviews.PENDING ?? 0))) * 100) : null,
      acceptanceRate: reviewed ? Math.round(((reviews.ACCEPTED ?? 0) / reviewed) * 100) : null,
      averageHumanAdjustment: deltas.length ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10 : null,
      usage: usage.map((u) => ({ feature: u.feature, calls: u._count, inputTokens: u._sum.inputTokens ?? 0, outputTokens: u._sum.outputTokens ?? 0 })),
    };
  }
}
