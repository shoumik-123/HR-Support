import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { AssessmentKind, AssessmentQuestionType, QuestionDifficulty } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { isAutoMarked } from "./scoring";

export interface QuestionInput {
  text: string;
  type: AssessmentQuestionType;
  kind?: AssessmentKind;
  difficulty?: QuestionDifficulty;
  options?: string[];
  correctAnswers?: string[];
  tolerance?: number | null;
  points?: number;
  explanation?: string | null;
  skills?: string[];
  jobId?: string | null;
  approved?: boolean;
}

@Injectable()
export class AssessmentBankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  // ── Question bank ──

  async list(ctx: RequestContext, q: { page: number; pageSize: number; kind?: AssessmentKind; type?: AssessmentQuestionType; difficulty?: QuestionDifficulty; jobId?: string; search?: string; approvedOnly?: boolean }) {
    const where: Prisma.AssessmentQuestionWhereInput = {
      organizationId: ctx.orgId,
      archivedAt: null,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.jobId ? { OR: [{ jobId: q.jobId }, { jobId: null }] } : {}),
      ...(q.approvedOnly ? { approved: true } : {}),
      ...(q.search ? { text: { contains: q.search, mode: "insensitive" } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.assessmentQuestion.findMany({
        where,
        orderBy: [{ approved: "desc" }, { createdAt: "desc" }],
        include: { job: { select: { id: true, title: true } }, _count: { select: { items: true } } },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.assessmentQuestion.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** Validates a question's shape: a markable question needs an unambiguous answer key. */
  private validate(input: QuestionInput) {
    const type = input.type;
    const options = input.options ?? [];
    const correct = input.correctAnswers ?? [];

    if (type === "MCQ_SINGLE" || type === "MCQ_MULTI") {
      if (options.length < 2) throw new BadRequestException("A multiple-choice question needs at least two options");
      if (options.length > 10) throw new BadRequestException("Ten options is the maximum");
      if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
        throw new BadRequestException("Options must be distinct");
      }
      if (!correct.length) throw new BadRequestException("Mark which option or options are correct");
      const indexes = correct.map((c) => Number(c));
      if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) {
        throw new BadRequestException("The answer key must refer to the options listed");
      }
      if (type === "MCQ_SINGLE" && correct.length !== 1) {
        throw new BadRequestException("A single-choice question must have exactly one correct option");
      }
      if (type === "MCQ_MULTI" && correct.length === options.length) {
        throw new BadRequestException("If every option is correct the question tests nothing");
      }
    }

    if (type === "NUMERIC") {
      if (correct.length !== 1 || !Number.isFinite(Number(correct[0]))) {
        throw new BadRequestException("Give the expected number as the answer");
      }
      if (input.tolerance != null && input.tolerance < 0) throw new BadRequestException("Tolerance cannot be negative");
    }

    if (!isAutoMarked(type) && correct.length) {
      throw new BadRequestException("Written answers are marked by a person, so they take no answer key");
    }
    if ((input.points ?? 1) < 1) throw new BadRequestException("A question must be worth at least one point");
  }

  async create(ctx: RequestContext, input: QuestionInput) {
    this.validate(input);
    if (input.jobId) await this.assertJob(ctx.orgId, input.jobId);
    const question = await this.prisma.assessmentQuestion.create({
      data: {
        organizationId: ctx.orgId,
        text: input.text.trim(),
        type: input.type,
        kind: input.kind ?? "TECHNICAL",
        difficulty: input.difficulty ?? "MEDIUM",
        options: input.options ?? [],
        correctAnswers: input.correctAnswers ?? [],
        tolerance: input.tolerance ?? null,
        points: input.points ?? 1,
        explanation: input.explanation ?? null,
        skills: input.skills ?? [],
        jobId: input.jobId ?? null,
        approved: input.approved ?? true,
        createdById: ctx.userId,
      },
    });
    await this.log(ctx, "assessment_question.created", question.id, { type: question.type });
    return question;
  }

  async update(ctx: RequestContext, id: string, input: Partial<QuestionInput>) {
    const existing = await this.find(ctx, id);
    const merged: QuestionInput = {
      text: input.text ?? existing.text,
      type: input.type ?? existing.type,
      options: input.options ?? existing.options,
      correctAnswers: input.correctAnswers ?? existing.correctAnswers,
      tolerance: input.tolerance !== undefined ? input.tolerance : existing.tolerance,
      points: input.points ?? existing.points,
    };
    this.validate(merged);
    if (input.jobId) await this.assertJob(ctx.orgId, input.jobId);

    // Papers already sent keep their snapshot, so editing the bank is safe.
    const updated = await this.prisma.assessmentQuestion.update({
      where: { id },
      data: { ...input, text: input.text?.trim() },
    });
    await this.log(ctx, "assessment_question.updated", id, { fields: Object.keys(input) });
    return updated;
  }

  async archive(ctx: RequestContext, id: string) {
    await this.find(ctx, id);
    await this.prisma.assessmentQuestion.update({ where: { id }, data: { archivedAt: new Date(), approved: false } });
    await this.log(ctx, "assessment_question.archived", id);
  }

  // ── Templates ──

  async templates(ctx: RequestContext, jobId?: string) {
    return this.prisma.assessmentTemplate.findMany({
      where: { organizationId: ctx.orgId, ...(jobId ? { OR: [{ jobId }, { jobId: null }] } : {}) },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: {
        job: { select: { id: true, title: true } },
        items: { orderBy: { position: "asc" }, include: { question: { select: { id: true, text: true, type: true, points: true } } } },
      },
    });
  }

  async createTemplate(
    ctx: RequestContext,
    input: { name: string; description?: string; kind: AssessmentKind; jobId?: string | null; durationMinutes: number; passingPercent: number; questionIds: string[]; shuffleQuestions?: boolean; showResultToCandidate?: boolean },
  ) {
    if (!input.questionIds.length) throw new BadRequestException("Add at least one question to the paper");
    if (input.passingPercent < 0 || input.passingPercent > 100) throw new BadRequestException("The pass mark must be between 0 and 100");
    if (input.jobId) await this.assertJob(ctx.orgId, input.jobId);

    const questions = await this.prisma.assessmentQuestion.findMany({
      where: { id: { in: input.questionIds }, organizationId: ctx.orgId, archivedAt: null },
    });
    if (questions.length !== new Set(input.questionIds).size) throw new BadRequestException("One or more questions no longer exist");

    const template = await this.prisma.assessmentTemplate.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name.trim(),
        description: input.description ?? null,
        kind: input.kind,
        jobId: input.jobId ?? null,
        durationMinutes: input.durationMinutes,
        passingPercent: input.passingPercent,
        shuffleQuestions: input.shuffleQuestions ?? true,
        showResultToCandidate: input.showResultToCandidate ?? false,
        createdById: ctx.userId,
        items: { create: input.questionIds.map((questionId, position) => ({ questionId, position })) },
      },
      include: { items: true },
    });
    await this.log(ctx, "assessment_template.created", template.id, { name: template.name, questions: input.questionIds.length });
    return template;
  }

  async updateTemplate(
    ctx: RequestContext,
    id: string,
    input: { name?: string; description?: string | null; durationMinutes?: number; passingPercent?: number; questionIds?: string[]; shuffleQuestions?: boolean; showResultToCandidate?: boolean },
  ) {
    const existing = await this.prisma.assessmentTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!existing) throw new NotFoundException("Template not found");
    if (input.passingPercent != null && (input.passingPercent < 0 || input.passingPercent > 100)) {
      throw new BadRequestException("The pass mark must be between 0 and 100");
    }

    if (input.questionIds) {
      if (!input.questionIds.length) throw new BadRequestException("A paper needs at least one question");
      const questions = await this.prisma.assessmentQuestion.findMany({
        where: { id: { in: input.questionIds }, organizationId: ctx.orgId, archivedAt: null },
      });
      if (questions.length !== new Set(input.questionIds).size) throw new BadRequestException("One or more questions no longer exist");
    }

    const { questionIds, ...rest } = input;
    await this.prisma.$transaction(async (tx) => {
      await tx.assessmentTemplate.update({ where: { id }, data: { ...rest, isDefault: false } });
      if (questionIds) {
        await tx.assessmentItem.deleteMany({ where: { templateId: id } });
        await tx.assessmentItem.createMany({ data: questionIds.map((questionId, position) => ({ templateId: id, questionId, position })) });
      }
    });
    await this.log(ctx, "assessment_template.updated", id, { fields: Object.keys(input) });
    return this.prisma.assessmentTemplate.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  }

  async deleteTemplate(ctx: RequestContext, id: string) {
    const existing = await this.prisma.assessmentTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!existing) throw new NotFoundException("Template not found");
    const inUse = await this.prisma.assessment.count({ where: { templateId: id, status: { in: ["INVITED", "IN_PROGRESS"] } } });
    if (inUse) throw new BadRequestException("Assessments using this paper are still open; cancel them first");
    await this.prisma.assessmentTemplate.delete({ where: { id } });
    await this.log(ctx, "assessment_template.deleted", id, { name: existing.name });
  }

  private async assertJob(orgId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, organizationId: orgId } });
    if (!job) throw new BadRequestException("Unknown job");
  }

  private async find(ctx: RequestContext, id: string) {
    const q = await this.prisma.assessmentQuestion.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!q) throw new NotFoundException("Question not found");
    return q;
  }

  private log(ctx: RequestContext, action: string, entityId: string, data?: object) {
    return this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action, entityType: "assessmentQuestion", entityId, data: data as never, ip: ctx.ip,
    });
  }
}
