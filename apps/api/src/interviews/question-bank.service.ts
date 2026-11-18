import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AiRequestError, AiService } from "../ai/ai.service";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { InterviewKind, QuestionCategory, QuestionDifficulty } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { generateQuestions, heuristicQuestions, QUESTION_PROMPT_VERSION } from "./question-generator";
import { criteriaForKind, ScorecardCriteriaSchema, ScorecardCriterion } from "./scorecard-criteria";

export interface QuestionInput {
  text: string;
  category: QuestionCategory;
  difficulty?: QuestionDifficulty;
  skills?: string[];
  guidance?: string | null;
  rationale?: string | null;
  jobId?: string | null;
  approved?: boolean;
}

@Injectable()
export class QuestionBankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly activity: ActivityService,
  ) {}

  // ── Question bank ──

  async list(ctx: RequestContext, q: { page: number; pageSize: number; category?: QuestionCategory; difficulty?: QuestionDifficulty; jobId?: string; search?: string; approvedOnly?: boolean }) {
    const where: Prisma.InterviewQuestionWhereInput = {
      organizationId: ctx.orgId,
      archivedAt: null,
      ...(q.category ? { category: q.category } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.jobId ? { OR: [{ jobId: q.jobId }, { jobId: null }] } : {}),
      ...(q.approvedOnly ? { approved: true } : {}),
      ...(q.search ? { text: { contains: q.search, mode: "insensitive" } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.interviewQuestion.findMany({
        where,
        orderBy: [{ approved: "desc" }, { createdAt: "desc" }],
        include: { job: { select: { id: true, title: true } }, _count: { select: { usages: true } } },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.interviewQuestion.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async create(ctx: RequestContext, input: QuestionInput) {
    if (input.jobId) await this.assertJob(ctx.orgId, input.jobId);
    const question = await this.prisma.interviewQuestion.create({
      data: {
        organizationId: ctx.orgId,
        text: input.text.trim(),
        category: input.category,
        difficulty: input.difficulty ?? "MEDIUM",
        skills: input.skills ?? [],
        guidance: input.guidance ?? null,
        rationale: input.rationale ?? null,
        jobId: input.jobId ?? null,
        // Written by a person, so it is usable straight away.
        approved: input.approved ?? true,
        source: "HEURISTIC",
        createdById: ctx.userId,
      },
    });
    await this.log(ctx, "question.created", question.id, { category: question.category });
    return question;
  }

  async update(ctx: RequestContext, id: string, input: Partial<QuestionInput>) {
    await this.find(ctx, id);
    if (input.jobId) await this.assertJob(ctx.orgId, input.jobId);
    const updated = await this.prisma.interviewQuestion.update({
      where: { id },
      data: { ...input, text: input.text?.trim() },
    });
    await this.log(ctx, "question.updated", id, { fields: Object.keys(input) });
    return updated;
  }

  async archive(ctx: RequestContext, id: string) {
    await this.find(ctx, id);
    // Archived rather than deleted: past interviews reference it.
    await this.prisma.interviewQuestion.update({ where: { id }, data: { archivedAt: new Date(), approved: false } });
    await this.log(ctx, "question.archived", id);
  }

  /**
   * Generates questions for a job and saves them to the bank as unapproved drafts.
   * A human approves them before they can be used in a template.
   */
  async generateForJob(ctx: RequestContext, input: { jobId: string; kind: InterviewKind; count?: number; difficulty?: QuestionDifficulty | "MIXED"; categories?: QuestionCategory[] }) {
    const job = await this.prisma.job.findFirst({ where: { id: input.jobId, organizationId: ctx.orgId } });
    if (!job) throw new NotFoundException("Job not found");
    const count = Math.min(Math.max(input.count ?? 8, 1), 20);

    const generateInput = {
      orgId: ctx.orgId,
      kind: input.kind,
      count,
      difficulty: input.difficulty,
      categories: input.categories,
      job: {
        title: job.title,
        description: job.description,
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
        minExperienceYears: job.minExperienceYears,
        educationRequirement: job.educationRequirement,
      },
    };

    let questions;
    let method: "AI" | "HEURISTIC" = "HEURISTIC";
    let model: string | null = null;
    if (this.ai.enabled) {
      try {
        const result = await generateQuestions(this.ai, generateInput);
        questions = result.questions;
        model = result.model;
        method = "AI";
      } catch (err) {
        if (err instanceof AiRequestError && !err.retryable) throw new BadRequestException(err.message);
        questions = heuristicQuestions(generateInput);
      }
    } else {
      questions = heuristicQuestions(generateInput);
    }

    const created = await this.prisma.$transaction(
      questions.map((q) =>
        this.prisma.interviewQuestion.create({
          data: {
            organizationId: ctx.orgId,
            text: q.text,
            category: q.category,
            difficulty: q.difficulty,
            skills: q.skills,
            guidance: q.guidance,
            rationale: q.rationale,
            jobId: job.id,
            source: method,
            model,
            promptVersion: QUESTION_PROMPT_VERSION,
            approved: false, // drafts: a recruiter reviews before use
            createdById: ctx.userId,
          },
        }),
      ),
    );

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "ai.questions_generated", entityType: "job", entityId: job.id, jobId: job.id,
      data: { count: created.length, method, model, promptVersion: QUESTION_PROMPT_VERSION, kind: input.kind }, ip: ctx.ip,
    });
    return { questions: created, method, model, promptVersion: QUESTION_PROMPT_VERSION };
  }

  async approve(ctx: RequestContext, ids: string[], approved: boolean) {
    const { count } = await this.prisma.interviewQuestion.updateMany({
      where: { id: { in: ids }, organizationId: ctx.orgId, archivedAt: null },
      data: { approved },
    });
    await this.log(ctx, approved ? "question.approved" : "question.unapproved", ids[0] ?? "", { count });
    return { updated: count };
  }

  // ── Interview templates ──

  async templates(ctx: RequestContext, jobId?: string) {
    return this.prisma.interviewTemplate.findMany({
      where: { organizationId: ctx.orgId, ...(jobId ? { OR: [{ jobId }, { jobId: null }] } : {}) },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: { job: { select: { id: true, title: true } } },
    });
  }

  async createTemplate(
    ctx: RequestContext,
    input: { name: string; description?: string; jobId?: string | null; kind: InterviewKind; durationMinutes: number; criteria?: ScorecardCriterion[]; questionIds?: string[] },
  ) {
    if (input.jobId) await this.assertJob(ctx.orgId, input.jobId);
    const criteria = input.criteria ?? criteriaForKind(input.kind);
    const parsed = ScorecardCriteriaSchema.safeParse(criteria);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid scorecard criteria");

    const questionIds = await this.validateQuestionIds(ctx.orgId, input.questionIds ?? []);
    const template = await this.prisma.interviewTemplate.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name.trim(),
        description: input.description ?? null,
        jobId: input.jobId ?? null,
        kind: input.kind,
        durationMinutes: input.durationMinutes,
        criteria: parsed.data as unknown as Prisma.InputJsonValue,
        questionIds,
        createdById: ctx.userId,
      },
    });
    await this.log(ctx, "interview_template.created", template.id, { name: template.name });
    return template;
  }

  async updateTemplate(
    ctx: RequestContext,
    id: string,
    input: { name?: string; description?: string | null; kind?: InterviewKind; durationMinutes?: number; criteria?: ScorecardCriterion[]; questionIds?: string[] },
  ) {
    const existing = await this.prisma.interviewTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!existing) throw new NotFoundException("Template not found");

    let criteria: Prisma.InputJsonValue | undefined;
    if (input.criteria) {
      const parsed = ScorecardCriteriaSchema.safeParse(input.criteria);
      if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid scorecard criteria");
      criteria = parsed.data as unknown as Prisma.InputJsonValue;
    }
    const questionIds = input.questionIds ? await this.validateQuestionIds(ctx.orgId, input.questionIds) : undefined;

    const updated = await this.prisma.interviewTemplate.update({
      where: { id },
      data: { ...input, criteria, questionIds, isDefault: false },
    });
    // Interviews already scheduled keep their snapshotted criteria.
    await this.log(ctx, "interview_template.updated", id, { fields: Object.keys(input) });
    return updated;
  }

  async deleteTemplate(ctx: RequestContext, id: string) {
    const existing = await this.prisma.interviewTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!existing) throw new NotFoundException("Template not found");
    await this.prisma.interviewTemplate.delete({ where: { id } });
    await this.log(ctx, "interview_template.deleted", id, { name: existing.name });
  }

  private async validateQuestionIds(orgId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const found = await this.prisma.interviewQuestion.findMany({
      where: { id: { in: ids }, organizationId: orgId, archivedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(ids).size) throw new BadRequestException("One or more questions no longer exist");
    return ids;
  }

  private async assertJob(orgId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, organizationId: orgId } });
    if (!job) throw new BadRequestException("Unknown job");
  }

  private async find(ctx: RequestContext, id: string) {
    const q = await this.prisma.interviewQuestion.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!q) throw new NotFoundException("Question not found");
    return q;
  }

  private log(ctx: RequestContext, action: string, entityId: string, data?: object) {
    return this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action, entityType: "interviewQuestion", entityId, data: data as never, ip: ctx.ip,
    });
  }
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async get(ctx: RequestContext, userId?: string) {
    const target = userId ?? ctx.userId;
    const [slots, org] = await Promise.all([
      this.prisma.interviewerAvailability.findMany({
        where: { organizationId: ctx.orgId, userId: target },
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } }),
    ]);
    return { userId: target, timezone: org.timezone, slots };
  }

  /** Replaces a person's weekly hours. Only they, or an admin, may change them. */
  async set(ctx: RequestContext, userId: string, slots: { weekday: number; startMinute: number; endMinute: number }[]) {
    for (const s of slots) {
      if (s.weekday < 0 || s.weekday > 6) throw new BadRequestException("Weekday must be between 0 (Sunday) and 6 (Saturday)");
      if (s.endMinute <= s.startMinute) throw new BadRequestException("Each window must end after it starts");
      if (s.startMinute < 0 || s.endMinute > 24 * 60) throw new BadRequestException("Windows must fall inside a single day");
    }
    // Reject overlapping windows on the same day so free-slot search stays unambiguous.
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].weekday === slots[j].weekday && slots[i].startMinute < slots[j].endMinute && slots[j].startMinute < slots[i].endMinute) {
          throw new BadRequestException("Availability windows on the same day must not overlap");
        }
      }
    }
    const member = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: ctx.orgId } } });
    if (!member) throw new BadRequestException("That person is not a member of this organization");

    await this.prisma.$transaction([
      this.prisma.interviewerAvailability.deleteMany({ where: { organizationId: ctx.orgId, userId } }),
      this.prisma.interviewerAvailability.createMany({
        data: slots.map((s) => ({ organizationId: ctx.orgId, userId, ...s })),
      }),
    ]);
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "availability.updated", entityType: "availability", entityId: userId,
      data: { windows: slots.length }, ip: ctx.ip,
    });
    return this.get(ctx, userId);
  }

  /** Who can be put on a panel, and whether they have declared any hours. */
  async interviewers(ctx: RequestContext) {
    const members = await this.prisma.membership.findMany({
      where: { organizationId: ctx.orgId, status: "ACTIVE" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    const availability = await this.prisma.interviewerAvailability.groupBy({
      by: ["userId"],
      where: { organizationId: ctx.orgId },
      _count: true,
    });
    const hoursByUser = new Map(availability.map((a) => [a.userId, a._count]));
    return members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      availabilityWindows: hoursByUser.get(m.user.id) ?? 0,
    }));
  }
}
