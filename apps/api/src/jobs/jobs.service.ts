import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { AiService } from "../ai/ai.service";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { EmploymentType, JobStatus, WorkMode } from "../generated/prisma/enums";
import { MatchingCriteria } from "../matching/criteria";
import { PrismaService } from "../prisma/prisma.service";

export interface JobInput {
  title: string;
  departmentId?: string | null;
  description: string;
  responsibilities?: string | null;
  location?: string | null;
  workMode?: WorkMode;
  employmentType?: EmploymentType;
  requiredSkills?: string[];
  preferredSkills?: string[];
  minExperienceYears?: number | null;
  maxExperienceYears?: number | null;
  educationRequirement?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  salaryVisible?: boolean;
  openings?: number;
  matchingCriteria?: MatchingCriteria;
  hiringManagerIds?: string[];
  expiresAt?: Date | null;
}

export interface JobListQuery {
  page: number;
  pageSize: number;
  status?: JobStatus;
  departmentId?: string;
  search?: string;
}

const JD_PROMPT_VERSION = "jd-v1";

const GeneratedJobSchema = z.object({
  description: z.string().describe("2-4 paragraph role overview, markdown allowed"),
  responsibilities: z.string().describe("Bulleted markdown list of key responsibilities"),
  requiredSkills: z.array(z.string()).describe("Concrete must-have skills, 4-10 items"),
  preferredSkills: z.array(z.string()).describe("Nice-to-have skills, 0-8 items"),
  educationRequirement: z.string().describe("Education requirement, or empty string if not essential"),
});

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Jobs");
  private expiryTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly ai: AiService,
  ) {}

  onModuleInit() {
    const sweep = () => this.closeExpired().catch((e) => this.logger.warn(`Expiry sweep failed: ${e}`));
    sweep();
    this.expiryTimer = setInterval(sweep, 15 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  async list(ctx: RequestContext, q: JobListQuery) {
    const where: Prisma.JobWhereInput = {
      organizationId: ctx.orgId,
      ...(q.status ? { status: q.status } : { status: { not: "ARCHIVED" } }),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.search ? { title: { contains: q.search, mode: "insensitive" } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          department: { select: { id: true, name: true } },
          _count: { select: { applications: true } },
        },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.job.count({ where }),
    ]);
    const activeCounts = await this.prisma.application.groupBy({
      by: ["jobId"],
      where: { jobId: { in: items.map((j) => j.id) }, status: "ACTIVE" },
      _count: true,
    });
    const activeById = new Map(activeCounts.map((c) => [c.jobId, c._count]));
    return {
      items: items.map(({ _count, ...job }) => ({
        ...job,
        applicationCount: _count.applications,
        activeApplicationCount: activeById.get(job.id) ?? 0,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(ctx: RequestContext, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: { department: { select: { id: true, name: true } } },
    });
    if (!job) throw new NotFoundException("Job not found");
    const byStage = await this.prisma.application.groupBy({
      by: ["stageId"],
      where: { jobId: id },
      _count: true,
    });
    return { ...job, stageCounts: Object.fromEntries(byStage.map((s) => [s.stageId, s._count])) };
  }

  async create(ctx: RequestContext, input: JobInput) {
    await this.validateRefs(ctx, input);
    const job = await this.prisma.job.create({
      data: {
        ...this.toData(input),
        title: input.title,
        description: input.description,
        organizationId: ctx.orgId,
        createdById: ctx.userId,
      },
    });
    await this.log(ctx, "job.created", job.id, { title: job.title });
    return job;
  }

  async update(ctx: RequestContext, id: string, input: Partial<JobInput>) {
    const existing = await this.find(ctx, id);
    await this.validateRefs(ctx, input);
    const merged = {
      min: input.minExperienceYears !== undefined ? input.minExperienceYears : existing.minExperienceYears,
      max: input.maxExperienceYears !== undefined ? input.maxExperienceYears : existing.maxExperienceYears,
      smin: input.salaryMin !== undefined ? input.salaryMin : existing.salaryMin,
      smax: input.salaryMax !== undefined ? input.salaryMax : existing.salaryMax,
    };
    if (merged.min != null && merged.max != null && merged.min > merged.max) throw new BadRequestException("Minimum experience exceeds maximum");
    if (merged.smin != null && merged.smax != null && merged.smin > merged.smax) throw new BadRequestException("Minimum salary exceeds maximum");

    const job = await this.prisma.job.update({ where: { id }, data: { ...this.toData(input), title: input.title, description: input.description } });
    await this.log(ctx, "job.updated", id, { fields: Object.keys(input) });
    return job;
  }

  async setStatus(ctx: RequestContext, id: string, status: JobStatus) {
    const job = await this.find(ctx, id);
    if (status === "PUBLISHED") {
      const problems: string[] = [];
      if (job.description.trim().length < 50) problems.push("description must be at least 50 characters");
      if (!job.requiredSkills.length) problems.push("add at least one required skill");
      if (job.expiresAt && job.expiresAt < new Date()) problems.push("expiry date is in the past");
      if (problems.length) throw new BadRequestException(`Cannot publish: ${problems.join("; ")}`);
    }
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        status,
        ...(status === "PUBLISHED" ? { publishedAt: job.publishedAt ?? new Date(), closedAt: null } : {}),
        ...(status === "CLOSED" ? { closedAt: new Date() } : {}),
      },
    });
    await this.log(ctx, `job.${status.toLowerCase()}`, id, { from: job.status });
    return updated;
  }

  async remove(ctx: RequestContext, id: string) {
    await this.find(ctx, id);
    const apps = await this.prisma.application.count({ where: { jobId: id } });
    if (apps) {
      // Keep recruitment history; archive instead of deleting.
      await this.prisma.job.update({ where: { id }, data: { status: "ARCHIVED" } });
      await this.log(ctx, "job.archived", id);
      return { archived: true };
    }
    await this.prisma.job.delete({ where: { id } });
    await this.log(ctx, "job.deleted", id);
    return { deleted: true };
  }

  async duplicate(ctx: RequestContext, id: string) {
    const src = await this.find(ctx, id);
    const { id: _id, createdAt, updatedAt, publishedAt, closedAt, status, createdById, matchingCriteria, ...rest } = src;
    const job = await this.prisma.job.create({
      data: {
        ...rest,
        matchingCriteria: matchingCriteria ?? undefined,
        title: `${src.title} (copy)`,
        status: "DRAFT",
        createdById: ctx.userId,
      },
    });
    await this.log(ctx, "job.created", job.id, { title: job.title, duplicatedFrom: id });
    return job;
  }

  /** AI job description assistant. Output is a draft for a human to edit, never auto-published. */
  async generateDescription(
    ctx: RequestContext,
    input: { title: string; seniority?: string; skills?: string[]; context?: string; department?: string; location?: string },
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const brief = [
      `Job title: ${input.title}`,
      input.seniority && `Seniority: ${input.seniority}`,
      input.department && `Department: ${input.department}`,
      input.location && `Location: ${input.location}`,
      input.skills?.length && `Skills the hiring team mentioned: ${input.skills.join(", ")}`,
      `Company: ${org.name}${org.industry ? ` (${org.industry})` : ""}`,
      input.context && `Additional context from the recruiter:\n${input.context}`,
    ]
      .filter(Boolean)
      .join("\n");

    const { data, model } = await this.ai.structured({
      orgId: ctx.orgId,
      feature: "job_description",
      effort: "low",
      maxTokens: 8000,
      schema: GeneratedJobSchema,
      system:
        "You write clear, inclusive job descriptions for recruiters. Use plain language, avoid gendered or exclusionary wording, " +
        "do not mention age, gender, religion, marital status, nationality or other personal characteristics, and only list " +
        "requirements that are genuinely job-related. Do not invent salary figures or benefits that were not provided.",
      content: brief,
    });
    await this.activity.log({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: "ai.job_description_generated",
      entityType: "job",
      entityId: "draft",
      data: { title: input.title, model, promptVersion: JD_PROMPT_VERSION },
    });
    return { ...data, model, promptVersion: JD_PROMPT_VERSION };
  }

  async closeExpired() {
    const { count } = await this.prisma.job.updateMany({
      where: { status: "PUBLISHED", expiresAt: { lt: new Date() } },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    if (count) this.logger.log(`Closed ${count} expired job(s)`);
  }

  async find(ctx: RequestContext, id: string) {
    const job = await this.prisma.job.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!job) throw new NotFoundException("Job not found");
    return job;
  }

  private async validateRefs(ctx: RequestContext, input: Partial<JobInput>) {
    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: input.departmentId, organizationId: ctx.orgId } });
      if (!dept) throw new BadRequestException("Unknown department");
    }
    if (input.hiringManagerIds?.length) {
      const members = await this.prisma.membership.count({
        where: { organizationId: ctx.orgId, userId: { in: input.hiringManagerIds }, status: "ACTIVE" },
      });
      if (members !== input.hiringManagerIds.length) throw new BadRequestException("Hiring managers must be active members");
    }
  }

  private toData(input: Partial<JobInput>) {
    const { title: _t, description: _d, matchingCriteria, ...rest } = input;
    return { ...rest, ...(matchingCriteria ? { matchingCriteria } : {}) };
  }

  private log(ctx: RequestContext, action: string, jobId: string, data?: object) {
    return this.activity.log({ orgId: ctx.orgId, actorId: ctx.userId, action, entityType: "job", entityId: jobId, jobId, data: data as never, ip: ctx.ip });
  }
}
