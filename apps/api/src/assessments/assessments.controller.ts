import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { Ctx, Public, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, zStringList, ZodPipe } from "../common/validation";
import { AssessmentKind, AssessmentQuestionType, AssessmentStatus, QuestionDifficulty } from "../generated/prisma/enums";
import { AssessmentBankService } from "./assessment-bank.service";
import { AssessmentsService } from "./assessments.service";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);

const AssignSchema = z.object({
  applicationId: z.string().min(1),
  templateId: z.string().optional(),
  title: z.string().trim().max(160).optional(),
  kind: zEnum(AssessmentKind).optional(),
  questionIds: z.array(z.string()).max(100).optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  passingPercent: z.number().int().min(0).max(100).optional(),
  validForDays: z.number().int().min(1).max(30).optional(),
  shuffleQuestions: z.boolean().optional(),
  showResultToCandidate: z.boolean().optional(),
  notifyCandidate: z.boolean().optional(),
});

const ListSchema = zPagination.extend({
  status: zEnum(AssessmentStatus).optional(),
  jobId: z.string().optional(),
  candidateId: z.string().optional(),
  awaitingMarking: z.coerce.boolean().optional(),
});

const MarkSchema = z.object({
  marks: z
    .array(z.object({ answerId: z.string().min(1), points: z.number().int().min(0).max(1000), comment: z.string().trim().max(2000).optional() }))
    .min(1)
    .max(100),
  note: z.string().trim().max(2000).optional(),
});

const AnswersSchema = z.object({
  answers: z
    .array(z.object({ answerId: z.string().min(1), response: z.array(z.string().max(10_000)).max(50) }))
    .max(100),
});

const QuestionSchema = z.object({
  text: z.string().trim().min(5).max(4000),
  type: zEnum(AssessmentQuestionType),
  kind: zEnum(AssessmentKind).optional(),
  difficulty: zEnum(QuestionDifficulty).optional(),
  options: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  correctAnswers: z.array(z.string().trim().max(500)).max(10).optional(),
  tolerance: z.number().min(0).nullable().optional(),
  points: z.number().int().min(1).max(100).optional(),
  explanation: z.string().trim().max(2000).nullable().optional(),
  skills: zStringList(10).optional(),
  jobId: z.string().nullable().optional(),
});

const TemplateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  kind: zEnum(AssessmentKind),
  jobId: z.string().nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(45),
  passingPercent: z.number().int().min(0).max(100).default(60),
  questionIds: z.array(z.string()).min(1).max(100),
  shuffleQuestions: z.boolean().optional(),
  showResultToCandidate: z.boolean().optional(),
});

/**
 * Candidate-facing assessment endpoints. These are public by design: a candidate has no
 * account, only a single-use link. Access is gated on a hashed token, throttled, and
 * returns nothing but the candidate's own paper — never the answer key.
 */
@Controller("public/assessment")
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicAssessmentController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Public()
  @Get(":token")
  open(@Param("token") token: string) {
    return this.assessments.openForCandidate(token);
  }

  @Public()
  @Post(":token/start")
  @HttpCode(200)
  start(@Param("token") token: string) {
    return this.assessments.startForCandidate(token);
  }

  @Public()
  @Put(":token/answers")
  save(@Param("token") token: string, @Body(new ZodPipe(AnswersSchema)) body: z.infer<typeof AnswersSchema>) {
    return this.assessments.saveAnswers(token, body.answers);
  }

  @Public()
  @Post(":token/submit")
  @HttpCode(200)
  submit(@Param("token") token: string, @Body(new ZodPipe(AnswersSchema.partial())) body: z.infer<typeof AnswersSchema>) {
    return this.assessments.submitForCandidate(token, body.answers);
  }
}

@Controller("assessments")
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get()
  @RequirePermission(Permission.AssessmentView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.assessments.list(ctx, q);
  }

  @Post()
  @RequirePermission(Permission.AssessmentAssign)
  assign(@Ctx() ctx: RequestContext, @Body(new ZodPipe(AssignSchema)) body: z.infer<typeof AssignSchema>) {
    return this.assessments.assign(ctx, body);
  }

  @Get(":id")
  @RequirePermission(Permission.AssessmentView)
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.assessments.get(ctx, id);
  }

  @Post(":id/mark")
  @HttpCode(200)
  @RequirePermission(Permission.AssessmentEvaluate)
  mark(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(MarkSchema)) body: z.infer<typeof MarkSchema>) {
    return this.assessments.mark(ctx, id, body.marks, body.note);
  }

  @Post(":id/resend")
  @HttpCode(200)
  @RequirePermission(Permission.AssessmentAssign)
  resend(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(z.object({ validForDays: z.number().int().min(1).max(30).optional() }))) body: { validForDays?: number },
  ) {
    return this.assessments.resend(ctx, id, body.validForDays ?? 7);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission(Permission.AssessmentAssign)
  cancel(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(z.object({ reason: z.string().trim().max(500).optional() }))) body: { reason?: string },
  ) {
    return this.assessments.cancel(ctx, id, body.reason);
  }
}

@Controller()
export class AssessmentBankController {
  constructor(private readonly bank: AssessmentBankService) {}

  @Get("assessment-questions")
  @RequirePermission(Permission.AssessmentView)
  listQuestions(
    @Ctx() ctx: RequestContext,
    @Query(new ZodPipe(zPagination.extend({
      kind: zEnum(AssessmentKind).optional(),
      type: zEnum(AssessmentQuestionType).optional(),
      difficulty: zEnum(QuestionDifficulty).optional(),
      jobId: z.string().optional(),
      search: z.string().trim().max(120).optional(),
      approvedOnly: z.coerce.boolean().optional(),
    })))
    q: { page: number; pageSize: number; kind?: AssessmentKind; type?: AssessmentQuestionType; difficulty?: QuestionDifficulty; jobId?: string; search?: string; approvedOnly?: boolean },
  ) {
    return this.bank.list(ctx, q);
  }

  @Post("assessment-questions")
  @RequirePermission(Permission.AssessmentManage)
  createQuestion(@Ctx() ctx: RequestContext, @Body(new ZodPipe(QuestionSchema)) body: z.infer<typeof QuestionSchema>) {
    return this.bank.create(ctx, body);
  }

  @Patch("assessment-questions/:id")
  @RequirePermission(Permission.AssessmentManage)
  updateQuestion(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(QuestionSchema.partial())) body: Partial<z.infer<typeof QuestionSchema>>) {
    return this.bank.update(ctx, id, body);
  }

  @Delete("assessment-questions/:id")
  @HttpCode(204)
  @RequirePermission(Permission.AssessmentManage)
  archiveQuestion(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.bank.archive(ctx, id);
  }

  @Get("assessment-templates")
  @RequirePermission(Permission.AssessmentView)
  templates(@Ctx() ctx: RequestContext, @Query("jobId") jobId?: string) {
    return this.bank.templates(ctx, jobId);
  }

  @Post("assessment-templates")
  @RequirePermission(Permission.AssessmentManage)
  createTemplate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(TemplateSchema)) body: z.infer<typeof TemplateSchema>) {
    return this.bank.createTemplate(ctx, body);
  }

  @Patch("assessment-templates/:id")
  @RequirePermission(Permission.AssessmentManage)
  updateTemplate(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(TemplateSchema.partial().omit({ kind: true, jobId: true }))) body: Partial<z.infer<typeof TemplateSchema>>,
  ) {
    return this.bank.updateTemplate(ctx, id, body);
  }

  @Delete("assessment-templates/:id")
  @HttpCode(204)
  @RequirePermission(Permission.AssessmentManage)
  deleteTemplate(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.bank.deleteTemplate(ctx, id);
  }
}
