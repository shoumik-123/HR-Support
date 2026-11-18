import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, ZodPipe } from "../common/validation";
import {
  InterviewKind,
  InterviewMode,
  InterviewStatus,
  ParticipantRole,
  QuestionCategory,
  QuestionDifficulty,
  Recommendation,
} from "../generated/prisma/enums";
import { InterviewsService } from "./interviews.service";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);
const zDifficultyOrMixed = z.union([zEnum(QuestionDifficulty), z.literal("MIXED")]);

const InterviewerSchema = z.object({ userId: z.string().min(1), role: zEnum(ParticipantRole).optional() });

const ScheduleSchema = z.object({
  applicationId: z.string().min(1),
  templateId: z.string().optional(),
  title: z.string().trim().max(160).optional(),
  kind: zEnum(InterviewKind).optional(),
  mode: zEnum(InterviewMode).optional(),
  startsAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(480).optional(),
  timezone: z.string().trim().max(60).optional(),
  location: z.string().trim().max(300).nullable().optional(),
  meetingLink: z.string().trim().url().max(500).nullable().optional(),
  agenda: z.string().trim().max(4000).nullable().optional(),
  interviewers: z.array(InterviewerSchema).min(1).max(10),
  questionIds: z.array(z.string()).max(40).optional(),
  allowConflicts: z.boolean().optional(),
  notifyCandidate: z.boolean().optional(),
});

const RescheduleSchema = z.object({
  startsAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(480).optional(),
  reason: z.string().trim().max(500).optional(),
  allowConflicts: z.boolean().optional(),
  notifyCandidate: z.boolean().optional(),
});

const ListSchema = zPagination.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  jobId: z.string().optional(),
  candidateId: z.string().optional(),
  status: zEnum(InterviewStatus).optional(),
  mine: z.coerce.boolean().optional(),
});

const CalendarSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  mine: z.coerce.boolean().default(false),
});

const SuggestSlotsSchema = z.object({
  userIds: z.array(z.string()).min(1).max(10),
  durationMinutes: z.number().int().min(10).max(480).default(60),
  fromDate: z.coerce.date().optional(),
  days: z.number().int().min(1).max(60).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const CheckSlotSchema = z.object({
  startsAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(480),
  userIds: z.array(z.string()).min(1).max(10),
  ignoreInterviewId: z.string().optional(),
});

const SuggestQuestionsSchema = z.object({
  count: z.number().int().min(1).max(20).optional(),
  difficulty: zDifficultyOrMixed.optional(),
  categories: z.array(zEnum(QuestionCategory)).max(5).optional(),
  useCandidate: z.boolean().optional(),
});

const SetQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        questionId: z.string().optional(),
        text: z.string().trim().min(5).max(2000).optional(),
        category: zEnum(QuestionCategory).optional(),
        difficulty: zEnum(QuestionDifficulty).optional(),
        guidance: z.string().trim().max(2000).optional(),
        rationale: z.string().trim().max(1000).optional(),
      }),
    )
    .max(40),
});

const ScorecardSchema = z.object({
  ratings: z.record(z.string(), z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() })).optional(),
  recommendation: zEnum(Recommendation).optional(),
  strengths: z.string().trim().max(4000).optional(),
  concerns: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(8000).optional(),
  submit: z.boolean().optional(),
});

const CancelSchema = z.object({ reason: z.string().trim().min(3).max(500), notifyCandidate: z.boolean().optional() });
const ParticipantsSchema = z.object({ interviewers: z.array(InterviewerSchema).min(1).max(10) });
const RespondSchema = z.object({ response: z.enum(["ACCEPTED", "DECLINED"]) });
const StatusSchema = z.object({ status: z.enum(["COMPLETED", "NO_SHOW"]) });

@Controller("interviews")
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Get()
  @RequirePermission(Permission.InterviewView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.interviews.list(ctx, q);
  }

  @Post()
  @RequirePermission(Permission.InterviewSchedule)
  schedule(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ScheduleSchema)) body: z.infer<typeof ScheduleSchema>) {
    return this.interviews.schedule(ctx, body);
  }

  @Get("calendar")
  @RequirePermission(Permission.InterviewView)
  calendar(@Ctx() ctx: RequestContext, @Query(new ZodPipe(CalendarSchema)) q: z.infer<typeof CalendarSchema>) {
    return this.interviews.calendar(ctx, q.from, q.to, q.mine);
  }

  @Get("mine")
  @RequirePermission(Permission.InterviewView)
  mine(@Ctx() ctx: RequestContext) {
    return this.interviews.myInterviews(ctx);
  }

  @Post("slots/suggest")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewSchedule)
  suggestSlots(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SuggestSlotsSchema)) body: z.infer<typeof SuggestSlotsSchema>) {
    return this.interviews.suggestSlots(ctx, body);
  }

  @Post("slots/check")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewSchedule)
  async checkSlot(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CheckSlotSchema)) body: z.infer<typeof CheckSlotSchema>) {
    const end = new Date(body.startsAt.getTime() + body.durationMinutes * 60_000);
    const { conflicts, gaps } = await this.interviews.checkSlot(ctx.orgId, { start: body.startsAt, end }, body.userIds, body.ignoreInterviewId);
    return { available: conflicts.length === 0, conflicts, availabilityGaps: gaps };
  }

  @Get(":id")
  @RequirePermission(Permission.InterviewView)
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.interviews.get(ctx, id);
  }

  @Post(":id/reschedule")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewSchedule)
  reschedule(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(RescheduleSchema)) body: z.infer<typeof RescheduleSchema>) {
    return this.interviews.reschedule(ctx, id, body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewSchedule)
  cancel(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(CancelSchema)) body: z.infer<typeof CancelSchema>) {
    return this.interviews.cancel(ctx, id, body.reason, body.notifyCandidate !== false);
  }

  @Post(":id/status")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewConduct)
  setStatus(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(StatusSchema)) body: z.infer<typeof StatusSchema>) {
    return this.interviews.setStatus(ctx, id, body.status);
  }

  @Put(":id/participants")
  @RequirePermission(Permission.InterviewSchedule)
  setParticipants(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(ParticipantsSchema)) body: z.infer<typeof ParticipantsSchema>) {
    return this.interviews.setParticipants(ctx, id, body.interviewers);
  }

  @Post(":id/respond")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewConduct)
  respond(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(RespondSchema)) body: z.infer<typeof RespondSchema>) {
    return this.interviews.respond(ctx, id, body.response);
  }

  @Post(":id/questions/suggest")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewConduct, Permission.AiUse)
  suggestQuestions(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(SuggestQuestionsSchema)) body: z.infer<typeof SuggestQuestionsSchema>) {
    return this.interviews.suggestQuestions(ctx, id, body);
  }

  @Put(":id/questions")
  @RequirePermission(Permission.InterviewConduct)
  setQuestions(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(SetQuestionsSchema)) body: z.infer<typeof SetQuestionsSchema>) {
    return this.interviews.setQuestions(ctx, id, body.questions);
  }

  @Put(":id/scorecard")
  @RequirePermission(Permission.InterviewConduct)
  saveScorecard(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(ScorecardSchema)) body: z.infer<typeof ScorecardSchema>) {
    return this.interviews.saveScorecard(ctx, id, body);
  }

  @Post(":id/scorecard/summarise")
  @HttpCode(200)
  @RequirePermission(Permission.InterviewConduct, Permission.AiUse)
  summarise(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.interviews.summariseScorecard(ctx, id);
  }
}
