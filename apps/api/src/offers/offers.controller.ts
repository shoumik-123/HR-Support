import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { Ctx, Public, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, ZodPipe } from "../common/validation";
import { OfferStatus, OnboardingCategory, TaskStatus } from "../generated/prisma/enums";
import { OffersService } from "./offers.service";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);

const BenefitSchema = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(200) });

const CreateOfferSchema = z.object({
  applicationId: z.string().min(1),
  templateId: z.string().optional(),
  jobTitle: z.string().trim().min(2).max(160).optional(),
  salaryAmount: z.number().int().min(1).max(1_000_000_000),
  salaryCurrency: z.string().trim().length(3).toUpperCase().optional(),
  salaryPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
  benefits: z.array(BenefitSchema).max(20).optional(),
  startDate: z.coerce.date(),
  respondBy: z.coerce.date(),
  probationMonths: z.number().int().min(0).max(24).nullable().optional(),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  reportingTo: z.string().trim().max(160).nullable().optional(),
  workLocation: z.string().trim().max(200).nullable().optional(),
  approverIds: z.array(z.string()).max(10).optional(),
});

const UpdateOfferSchema = CreateOfferSchema.partial().omit({ applicationId: true }).extend({
  letterBody: z.string().trim().min(50).max(50_000).optional(),
});

const ListSchema = zPagination.extend({
  status: zEnum(OfferStatus).optional(),
  jobId: z.string().optional(),
  mineToApprove: z.coerce.boolean().optional(),
});

const TaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  category: zEnum(OnboardingCategory).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
});

const UpdateTaskSchema = TaskSchema.partial().extend({
  assigneeId: z.string().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

/**
 * Candidate-facing offer endpoints: no account, a single-use hashed token, throttled.
 * Accepting or declining is the candidate's own decision and is recorded as such.
 */
@Controller("public/offer")
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class PublicOfferController {
  constructor(private readonly offers: OffersService) {}

  @Public()
  @Get(":token")
  open(@Param("token") token: string) {
    return this.offers.openForCandidate(token);
  }

  @Public()
  @Post(":token/respond")
  @HttpCode(200)
  respond(
    @Param("token") token: string,
    @Body(new ZodPipe(z.object({ accept: z.boolean(), reason: z.string().trim().max(500).optional() })))
    body: { accept: boolean; reason?: string },
  ) {
    return this.offers.respondAsCandidate(token, body.accept, body.reason);
  }
}

@Controller("offers")
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @RequirePermission(Permission.OfferView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.offers.list(ctx, q);
  }

  @Post()
  @RequirePermission(Permission.OfferManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreateOfferSchema)) body: z.infer<typeof CreateOfferSchema>) {
    return this.offers.create(ctx, body);
  }

  @Get("templates")
  @RequirePermission(Permission.OfferView)
  templates(@Ctx() ctx: RequestContext) {
    return this.offers.templates(ctx);
  }

  @Put("templates")
  @RequirePermission(Permission.OfferManage)
  saveTemplate(
    @Ctx() ctx: RequestContext,
    @Body(new ZodPipe(z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(80), body: z.string().trim().min(50).max(50_000) })))
    body: { id?: string; name: string; body: string },
  ) {
    return this.offers.saveTemplate(ctx, body);
  }

  @Get("onboarding")
  @RequirePermission(Permission.OfferView)
  onboarding(@Ctx() ctx: RequestContext) {
    return this.offers.onboardingBoard(ctx);
  }

  @Get(":id")
  @RequirePermission(Permission.OfferView)
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.offers.get(ctx, id);
  }

  @Patch(":id")
  @RequirePermission(Permission.OfferManage)
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(UpdateOfferSchema)) body: z.infer<typeof UpdateOfferSchema>) {
    return this.offers.update(ctx, id, body);
  }

  @Post(":id/request-approval")
  @HttpCode(200)
  @RequirePermission(Permission.OfferManage)
  requestApproval(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(z.object({ approverIds: z.array(z.string()).min(1).max(10) }))) body: { approverIds: string[] },
  ) {
    return this.offers.requestApproval(ctx, id, body.approverIds);
  }

  @Post(":id/decide")
  @HttpCode(200)
  @RequirePermission(Permission.OfferApprove)
  decide(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().trim().max(2000).optional() })))
    body: { decision: "APPROVED" | "REJECTED"; comment?: string },
  ) {
    return this.offers.decide(ctx, id, body.decision, body.comment);
  }

  @Post(":id/send")
  @HttpCode(200)
  @RequirePermission(Permission.OfferSend)
  send(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.offers.send(ctx, id);
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  @RequirePermission(Permission.OfferManage)
  withdraw(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(500) }))) body: { reason: string },
  ) {
    return this.offers.withdraw(ctx, id, body.reason);
  }

  @Post(":id/tasks")
  @RequirePermission(Permission.OnboardingManage)
  addTask(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(TaskSchema)) body: z.infer<typeof TaskSchema>) {
    return this.offers.addTask(ctx, id, body);
  }
}

@Controller("onboarding-tasks")
export class OnboardingController {
  constructor(private readonly offers: OffersService) {}

  @Post(":id/status")
  @HttpCode(200)
  @RequirePermission(Permission.OnboardingManage)
  setStatus(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(z.object({ status: zEnum(TaskStatus) }))) body: { status: TaskStatus },
  ) {
    return this.offers.setTaskStatus(ctx, id, body.status);
  }

  @Patch(":id")
  @RequirePermission(Permission.OnboardingManage)
  update(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body(new ZodPipe(UpdateTaskSchema)) body: z.infer<typeof UpdateTaskSchema>,
  ) {
    return this.offers.updateTask(ctx, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission(Permission.OnboardingManage)
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.offers.deleteTask(ctx, id);
  }
}
