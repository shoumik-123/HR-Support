import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { can, Permission } from "../common/permissions";
import { zPagination, zStringList, ZodPipe } from "../common/validation";
import { InterviewKind, QuestionCategory, QuestionDifficulty } from "../generated/prisma/enums";
import { InterviewsService } from "./interviews.service";
import { AvailabilityService, QuestionBankService } from "./question-bank.service";
import { ScorecardCriterionSchema } from "./scorecard-criteria";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);
const zDifficultyOrMixed = z.union([zEnum(QuestionDifficulty), z.literal("MIXED")]);

const ListQuestionsSchema = zPagination.extend({
  category: zEnum(QuestionCategory).optional(),
  difficulty: zEnum(QuestionDifficulty).optional(),
  jobId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  approvedOnly: z.coerce.boolean().optional(),
});

const CreateQuestionSchema = z.object({
  text: z.string().trim().min(5).max(2000),
  category: zEnum(QuestionCategory),
  difficulty: zEnum(QuestionDifficulty).optional(),
  skills: zStringList(10).optional(),
  guidance: z.string().trim().max(2000).nullable().optional(),
  rationale: z.string().trim().max(1000).nullable().optional(),
  jobId: z.string().nullable().optional(),
});

const UpdateQuestionSchema = CreateQuestionSchema.partial().extend({ approved: z.boolean().optional() });

const GenerateQuestionsSchema = z.object({
  jobId: z.string().min(1),
  kind: zEnum(InterviewKind),
  count: z.number().int().min(1).max(20).optional(),
  difficulty: zDifficultyOrMixed.optional(),
  categories: z.array(zEnum(QuestionCategory)).max(5).optional(),
});

const ApproveSchema = z.object({ ids: z.array(z.string()).min(1).max(100), approved: z.boolean() });

const CreateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  jobId: z.string().nullable().optional(),
  kind: zEnum(InterviewKind),
  durationMinutes: z.number().int().min(10).max(480).default(60),
  criteria: z.array(ScorecardCriterionSchema).min(1).max(12).optional(),
  questionIds: z.array(z.string()).max(40).optional(),
});

const UpdateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  kind: zEnum(InterviewKind).optional(),
  durationMinutes: z.number().int().min(10).max(480).optional(),
  criteria: z.array(ScorecardCriterionSchema).min(1).max(12).optional(),
  questionIds: z.array(z.string()).max(40).optional(),
});

const AvailabilitySchema = z.object({
  userId: z.string().optional(),
  slots: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
      }),
    )
    .max(30),
});

@Controller()
export class InterviewSetupController {
  constructor(
    private readonly bank: QuestionBankService,
    private readonly availability: AvailabilityService,
    private readonly interviews: InterviewsService,
  ) {}

  // ── Question bank ──

  @Get("questions")
  @RequirePermission(Permission.InterviewView)
  listQuestions(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListQuestionsSchema)) q: z.infer<typeof ListQuestionsSchema>) {
    return this.bank.list(ctx, q);
  }

  @Post("questions")
  @RequirePermission(Permission.QuestionManage)
  createQuestion(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreateQuestionSchema)) body: z.infer<typeof CreateQuestionSchema>) {
    return this.bank.create(ctx, body);
  }

  @Post("questions/generate")
  @HttpCode(200)
  @RequirePermission(Permission.QuestionManage, Permission.AiUse)
  generateQuestions(@Ctx() ctx: RequestContext, @Body(new ZodPipe(GenerateQuestionsSchema)) body: z.infer<typeof GenerateQuestionsSchema>) {
    return this.bank.generateForJob(ctx, body);
  }

  @Post("questions/approve")
  @HttpCode(200)
  @RequirePermission(Permission.QuestionManage)
  approveQuestions(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ApproveSchema)) body: z.infer<typeof ApproveSchema>) {
    return this.bank.approve(ctx, body.ids, body.approved);
  }

  @Patch("questions/:id")
  @RequirePermission(Permission.QuestionManage)
  updateQuestion(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(UpdateQuestionSchema)) body: z.infer<typeof UpdateQuestionSchema>) {
    return this.bank.update(ctx, id, body);
  }

  @Delete("questions/:id")
  @HttpCode(204)
  @RequirePermission(Permission.QuestionManage)
  archiveQuestion(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.bank.archive(ctx, id);
  }

  // ── Interview templates ──

  @Get("interview-templates")
  @RequirePermission(Permission.InterviewView)
  templates(@Ctx() ctx: RequestContext, @Query("jobId") jobId?: string) {
    return this.bank.templates(ctx, jobId);
  }

  @Post("interview-templates")
  @RequirePermission(Permission.QuestionManage)
  createTemplate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreateTemplateSchema)) body: z.infer<typeof CreateTemplateSchema>) {
    return this.bank.createTemplate(ctx, body);
  }

  @Patch("interview-templates/:id")
  @RequirePermission(Permission.QuestionManage)
  updateTemplate(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(UpdateTemplateSchema)) body: z.infer<typeof UpdateTemplateSchema>) {
    return this.bank.updateTemplate(ctx, id, body);
  }

  @Delete("interview-templates/:id")
  @HttpCode(204)
  @RequirePermission(Permission.QuestionManage)
  deleteTemplate(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.bank.deleteTemplate(ctx, id);
  }

  // ── Interviewers and availability ──

  @Get("interviewers")
  @RequirePermission(Permission.InterviewView)
  interviewers(@Ctx() ctx: RequestContext) {
    return this.availability.interviewers(ctx);
  }

  @Get("availability")
  @RequirePermission(Permission.InterviewView)
  getAvailability(@Ctx() ctx: RequestContext, @Query("userId") userId?: string) {
    return this.availability.get(ctx, userId);
  }

  @Put("availability")
  @RequirePermission(Permission.InterviewConduct)
  setAvailability(@Ctx() ctx: RequestContext, @Body(new ZodPipe(AvailabilitySchema)) body: z.infer<typeof AvailabilitySchema>) {
    const target = body.userId ?? ctx.userId;
    // Your own hours are yours to set; changing someone else's needs team management rights.
    if (target !== ctx.userId && !can(ctx.role, Permission.TeamManage)) {
      throw new ForbiddenException("You can only change your own availability");
    }
    return this.availability.set(ctx, target, body.slots);
  }

  // ── Feedback for one application ──

  @Get("applications/:id/interviews")
  @RequirePermission(Permission.InterviewView)
  applicationFeedback(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.interviews.applicationFeedback(ctx, id);
  }
}
