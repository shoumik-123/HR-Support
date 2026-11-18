import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { newToken, sha256 } from "../common/crypto";
import { can, Permission } from "../common/permissions";
import { config } from "../config";
import { paginate } from "../common/validation";
import { CommunicationsService } from "../communications/communications.service";
import { render } from "../communications/template-render";
import { Prisma } from "../generated/prisma/client";
import { OfferStatus, OnboardingCategory, TaskStatus } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { DEFAULT_OFFER_LETTER, DEFAULT_ONBOARDING_TASKS } from "./defaults";

export const EXPIRE_OFFERS_JOB = "offer.expire";

export interface Benefit {
  label: string;
  value: string;
}

export interface CreateOfferInput {
  applicationId: string;
  templateId?: string;
  jobTitle?: string;
  salaryAmount: number;
  salaryCurrency?: string;
  salaryPeriod?: "MONTHLY" | "YEARLY";
  benefits?: Benefit[];
  startDate: Date;
  respondBy: Date;
  probationMonths?: number | null;
  noticePeriodDays?: number | null;
  reportingTo?: string | null;
  workLocation?: string | null;
  /** Approvers who must all sign off before the offer can be sent. */
  approverIds?: string[];
}

@Injectable()
export class OffersService implements OnModuleInit {
  private readonly logger = new Logger("Offers");

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly activity: ActivityService,
    private readonly comms: CommunicationsService,
  ) {}

  onModuleInit() {
    this.queue.register(EXPIRE_OFFERS_JOB, async () => {
      await this.expireOverdue();
    });
    const sweep = () => this.expireOverdue().catch((e) => this.logger.warn(`Offer expiry sweep failed: ${e}`));
    sweep();
    setInterval(sweep, 60 * 60 * 1000).unref();
  }

  // ── Templates ──

  async ensureDefaultTemplate(orgId: string) {
    const existing = await this.prisma.offerTemplate.count({ where: { organizationId: orgId } });
    if (existing) return;
    await this.prisma.offerTemplate.create({
      data: { organizationId: orgId, name: "Standard offer letter", body: DEFAULT_OFFER_LETTER, isDefault: true },
    });
  }

  async templates(ctx: RequestContext) {
    await this.ensureDefaultTemplate(ctx.orgId);
    return this.prisma.offerTemplate.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  }

  async saveTemplate(ctx: RequestContext, input: { id?: string; name: string; body: string }) {
    if (input.id) {
      const existing = await this.prisma.offerTemplate.findFirst({ where: { id: input.id, organizationId: ctx.orgId } });
      if (!existing) throw new NotFoundException("Template not found");
      return this.prisma.offerTemplate.update({ where: { id: input.id }, data: { name: input.name, body: input.body, isDefault: false } });
    }
    return this.prisma.offerTemplate.create({
      data: { organizationId: ctx.orgId, name: input.name, body: input.body, createdById: ctx.userId },
    });
  }

  // ── Creating and approving ──

  async create(ctx: RequestContext, input: CreateOfferInput) {
    const app = await this.prisma.application.findFirst({
      where: { id: input.applicationId, organizationId: ctx.orgId },
      include: { job: true, candidate: { select: { id: true, fullName: true, email: true } } },
    });
    if (!app) throw new NotFoundException("Application not found");
    if (app.status === "REJECTED") throw new BadRequestException("This application has been rejected");

    const open = await this.prisma.offer.findFirst({
      where: { applicationId: app.id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"] } },
    });
    if (open) throw new BadRequestException("An offer is already in progress for this candidate; withdraw it first");

    if (input.startDate < new Date(Date.now() - 86_400_000)) throw new BadRequestException("The joining date cannot be in the past");
    if (input.respondBy <= new Date()) throw new BadRequestException("The response deadline must be in the future");
    if (input.respondBy > input.startDate) throw new BadRequestException("The candidate must respond before the joining date");
    if (input.salaryAmount <= 0) throw new BadRequestException("Enter the offered salary");

    await this.ensureDefaultTemplate(ctx.orgId);
    const template = input.templateId
      ? await this.prisma.offerTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.orgId } })
      : await this.prisma.offerTemplate.findFirst({ where: { organizationId: ctx.orgId }, orderBy: { isDefault: "desc" } });
    if (!template) throw new BadRequestException("No offer template available");

    if (input.approverIds?.length) {
      const members = await this.prisma.membership.count({
        where: { organizationId: ctx.orgId, userId: { in: input.approverIds }, status: "ACTIVE" },
      });
      if (members !== new Set(input.approverIds).size) throw new BadRequestException("Approvers must be active members of this organization");
    }

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, defaultCurrency: true } });
    const currency = input.salaryCurrency ?? app.job.salaryCurrency ?? org.defaultCurrency;
    const benefits = input.benefits ?? [];

    const letterBody = this.renderLetter(template.body, {
      candidateName: app.candidate.fullName,
      organizationName: org.name,
      jobTitle: input.jobTitle ?? app.job.title,
      salary: formatMoney(input.salaryAmount, currency, input.salaryPeriod ?? "MONTHLY"),
      startDate: input.startDate,
      respondBy: input.respondBy,
      benefits,
      probationMonths: input.probationMonths ?? null,
      noticePeriodDays: input.noticePeriodDays ?? null,
      reportingTo: input.reportingTo ?? null,
      workLocation: input.workLocation ?? app.job.location ?? null,
      senderName: ctx.name,
    });

    const offer = await this.prisma.offer.create({
      data: {
        organizationId: ctx.orgId,
        applicationId: app.id,
        candidateId: app.candidateId,
        jobId: app.jobId,
        templateId: template.id,
        jobTitle: input.jobTitle ?? app.job.title,
        salaryAmount: input.salaryAmount,
        salaryCurrency: currency,
        salaryPeriod: input.salaryPeriod ?? "MONTHLY",
        benefits: benefits as unknown as Prisma.InputJsonValue,
        startDate: input.startDate,
        respondBy: input.respondBy,
        probationMonths: input.probationMonths ?? null,
        noticePeriodDays: input.noticePeriodDays ?? null,
        reportingTo: input.reportingTo ?? null,
        workLocation: input.workLocation ?? app.job.location ?? null,
        letterBody,
        status: input.approverIds?.length ? "PENDING_APPROVAL" : "DRAFT",
        createdById: ctx.userId,
        approvals: input.approverIds?.length
          ? { create: input.approverIds.map((approverId, position) => ({ approverId, position })) }
          : undefined,
      },
    });

    await this.log(ctx, "offer.created", offer, {
      salaryAmount: input.salaryAmount, currency, approvers: input.approverIds?.length ?? 0,
    });
    return this.get(ctx, offer.id);
  }

  async update(ctx: RequestContext, id: string, input: Partial<CreateOfferInput> & { letterBody?: string }) {
    const offer = await this.find(ctx, id);
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(offer.status)) {
      throw new BadRequestException(
        offer.status === "SENT"
          ? "This offer has been sent; withdraw it before changing the terms"
          : "An offer that has been responded to cannot be edited",
      );
    }
    const updated = await this.prisma.offer.update({
      where: { id },
      data: {
        jobTitle: input.jobTitle,
        salaryAmount: input.salaryAmount,
        salaryCurrency: input.salaryCurrency,
        salaryPeriod: input.salaryPeriod,
        benefits: input.benefits ? (input.benefits as unknown as Prisma.InputJsonValue) : undefined,
        startDate: input.startDate,
        respondBy: input.respondBy,
        probationMonths: input.probationMonths,
        noticePeriodDays: input.noticePeriodDays,
        reportingTo: input.reportingTo,
        workLocation: input.workLocation,
        letterBody: input.letterBody,
      },
    });
    // Any change invalidates approvals already given: approvers signed off on the old
    // terms, so an approved offer goes back for approval rather than being sendable with
    // terms nobody agreed to.
    const approvals = await this.prisma.offerApproval.count({ where: { offerId: id } });
    if (approvals) {
      await this.prisma.$transaction([
        this.prisma.offerApproval.updateMany({
          where: { offerId: id },
          data: { decision: "PENDING", decidedAt: null, comment: null },
        }),
        this.prisma.offer.update({ where: { id }, data: { status: "PENDING_APPROVAL" } }),
      ]);
    }
    await this.log(ctx, "offer.updated", offer, {
      fields: Object.keys(input),
      approvalsReset: approvals,
      previousStatus: offer.status,
    });
    return this.get(ctx, updated.id);
  }

  async requestApproval(ctx: RequestContext, id: string, approverIds: string[]) {
    const offer = await this.find(ctx, id);
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(offer.status)) {
      throw new BadRequestException("This offer is past the approval stage");
    }
    if (!approverIds.length) throw new BadRequestException("Choose at least one approver");
    const members = await this.prisma.membership.count({
      where: { organizationId: ctx.orgId, userId: { in: approverIds }, status: "ACTIVE" },
    });
    if (members !== new Set(approverIds).size) throw new BadRequestException("Approvers must be active members of this organization");

    await this.prisma.$transaction([
      this.prisma.offerApproval.deleteMany({ where: { offerId: id, approverId: { notIn: approverIds } } }),
      ...approverIds.map((approverId, position) =>
        this.prisma.offerApproval.upsert({
          where: { offerId_approverId: { offerId: id, approverId } },
          create: { offerId: id, approverId, position },
          update: { position },
        }),
      ),
      this.prisma.offer.update({ where: { id }, data: { status: "PENDING_APPROVAL" } }),
    ]);

    await this.notifyApprovers(ctx, id);
    await this.log(ctx, "offer.approval_requested", offer, { approvers: approverIds.length });
    return this.get(ctx, id);
  }

  /** One approver records their decision. All must approve before the offer can be sent. */
  async decide(ctx: RequestContext, id: string, decision: "APPROVED" | "REJECTED", comment?: string) {
    const offer = await this.find(ctx, id);
    if (offer.status !== "PENDING_APPROVAL") throw new BadRequestException("This offer is not awaiting approval");

    const approval = await this.prisma.offerApproval.findUnique({
      where: { offerId_approverId: { offerId: id, approverId: ctx.userId } },
    });
    if (!approval) throw new ForbiddenException("You are not an approver on this offer");
    if (approval.decision !== "PENDING") throw new BadRequestException("You have already recorded your decision");

    await this.prisma.offerApproval.update({
      where: { id: approval.id },
      data: { decision, comment, decidedAt: new Date() },
    });

    if (decision === "REJECTED") {
      // One rejection sends it back to draft; the recruiter revises and asks again.
      await this.prisma.offer.update({ where: { id }, data: { status: "DRAFT" } });
      await this.log(ctx, "offer.approval_rejected", offer, { comment: comment ?? null });
      return this.get(ctx, id);
    }

    const outstanding = await this.prisma.offerApproval.count({ where: { offerId: id, decision: { not: "APPROVED" } } });
    if (!outstanding) {
      await this.prisma.offer.update({ where: { id }, data: { status: "APPROVED" } });
      await this.log(ctx, "offer.approved", offer, {});
    } else {
      await this.log(ctx, "offer.approval_given", offer, { outstanding });
    }
    return this.get(ctx, id);
  }

  /** Sends the offer to the candidate. Requires approval when approvers were named. */
  async send(ctx: RequestContext, id: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: { approvals: true, candidate: { select: { email: true } } },
    });
    if (!offer) throw new NotFoundException("Offer not found");
    if (offer.status === "SENT") throw new BadRequestException("This offer has already been sent");
    if (offer.status !== "DRAFT" && offer.status !== "APPROVED") {
      throw new BadRequestException(offer.status === "PENDING_APPROVAL" ? "This offer is still awaiting approval" : "This offer cannot be sent");
    }
    if (offer.approvals.length && offer.approvals.some((a) => a.decision !== "APPROVED")) {
      throw new BadRequestException("Every approver must approve before the offer is sent");
    }
    if (offer.respondBy <= new Date()) throw new BadRequestException("The response deadline has passed; update it before sending");
    if (!offer.candidate.email) throw new BadRequestException("This candidate has no email address on file");

    const { token, hash } = newToken();
    await this.prisma.offer.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), accessTokenHash: hash },
    });

    const link = `${config.webOrigin}/offer/${token}`;
    await this.comms.queueSend({
      orgId: ctx.orgId,
      templateKey: "OFFER",
      applicationId: offer.applicationId,
      candidateId: offer.candidateId,
      offerId: offer.id,
      extraContext: {
        "offer.jobTitle": offer.jobTitle,
        "offer.salary": formatMoney(offer.salaryAmount, offer.salaryCurrency, offer.salaryPeriod),
        "offer.startDate": offer.startDate.toDateString(),
        "offer.respondBy": offer.respondBy.toDateString(),
        "offer.link": link,
      },
      sentById: ctx.userId,
    });

    await this.log(ctx, "offer.sent", offer, { respondBy: offer.respondBy.toISOString() });
    return { ...(await this.get(ctx, id)), offerLink: link };
  }

  async withdraw(ctx: RequestContext, id: string, reason: string) {
    const offer = await this.find(ctx, id);
    if (offer.status === "ACCEPTED") throw new BadRequestException("An accepted offer cannot be withdrawn here; speak to the candidate first");
    await this.prisma.offer.update({
      where: { id },
      // Clearing the token stops the candidate's link working.
      data: { status: "WITHDRAWN", withdrawReason: reason, accessTokenHash: null },
    });
    await this.log(ctx, "offer.withdrawn", offer, { reason });
    return this.get(ctx, id);
  }

  // ── Candidate-facing (token, no account) ──

  async openForCandidate(token: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { accessTokenHash: sha256(token) },
      include: {
        organization: { select: { name: true } },
        candidate: { select: { fullName: true } },
        job: { select: { title: true } },
      },
    });
    if (!offer) throw new NotFoundException("This offer link is not valid");
    if (offer.status === "WITHDRAWN") throw new ForbiddenException("This offer has been withdrawn");

    const expired = offer.status === "SENT" && offer.respondBy < new Date();
    if (expired && offer.status === "SENT") {
      await this.prisma.offer.update({ where: { id: offer.id }, data: { status: "EXPIRED" } });
    }

    return {
      state: expired ? ("expired" as const) : offer.status === "SENT" ? ("open" as const) : ("responded" as const),
      organizationName: offer.organization.name,
      candidateName: offer.candidate.fullName,
      jobTitle: offer.jobTitle,
      salary: formatMoney(offer.salaryAmount, offer.salaryCurrency, offer.salaryPeriod),
      benefits: offer.benefits as unknown as Benefit[],
      startDate: offer.startDate,
      respondBy: offer.respondBy,
      probationMonths: offer.probationMonths,
      noticePeriodDays: offer.noticePeriodDays,
      reportingTo: offer.reportingTo,
      workLocation: offer.workLocation,
      letterBody: offer.letterBody,
      status: offer.status,
      respondedAt: offer.respondedAt,
    };
  }

  /**
   * The candidate accepts or declines. Accepting moves the application to Hired and
   * seeds the onboarding checklist; it does not silently alter anything else.
   */
  async respondAsCandidate(token: string, accept: boolean, reason?: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { accessTokenHash: sha256(token) },
      include: { application: { select: { id: true, organizationId: true } } },
    });
    if (!offer) throw new NotFoundException("This offer link is not valid");
    if (offer.status !== "SENT") {
      throw new BadRequestException(
        offer.status === "ACCEPTED" || offer.status === "DECLINED" ? "You have already responded to this offer" : "This offer is no longer open",
      );
    }
    if (offer.respondBy < new Date()) {
      await this.prisma.offer.update({ where: { id: offer.id }, data: { status: "EXPIRED" } });
      throw new ForbiddenException("The deadline for responding to this offer has passed");
    }

    if (!accept) {
      await this.prisma.offer.update({
        where: { id: offer.id },
        data: { status: "DECLINED", respondedAt: new Date(), declineReason: reason?.slice(0, 500), accessTokenHash: null },
      });
      await this.activity.log({
        orgId: offer.organizationId, actorId: null, action: "offer.declined", entityType: "offer", entityId: offer.id,
        candidateId: offer.candidateId, jobId: offer.jobId, applicationId: offer.applicationId, data: { reason: reason ?? null },
      });
      return { status: "DECLINED" as const };
    }

    const hiredStage = await this.prisma.pipelineStage.findFirst({
      where: { organizationId: offer.organizationId, kind: "HIRED" },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.offer.update({
        where: { id: offer.id },
        data: { status: "ACCEPTED", respondedAt: new Date(), accessTokenHash: null },
      });
      if (hiredStage) {
        await tx.application.update({
          where: { id: offer.applicationId },
          data: { stageId: hiredStage.id, status: "HIRED", hiredAt: new Date(), stageEnteredAt: new Date() },
        });
      }
      // Seed the onboarding checklist so HR has something concrete to work from.
      await tx.onboardingTask.createMany({
        data: DEFAULT_ONBOARDING_TASKS.map((t, position) => ({
          organizationId: offer.organizationId,
          offerId: offer.id,
          candidateId: offer.candidateId,
          title: t.title,
          description: t.description,
          category: t.category,
          position,
          dueDate: t.daysBeforeStart != null ? new Date(offer.startDate.getTime() - t.daysBeforeStart * 86_400_000) : null,
        })),
      });
    });

    await this.activity.log({
      orgId: offer.organizationId, actorId: null, action: "offer.accepted", entityType: "offer", entityId: offer.id,
      candidateId: offer.candidateId, jobId: offer.jobId, applicationId: offer.applicationId,
      data: { startDate: offer.startDate.toISOString(), onboardingTasks: DEFAULT_ONBOARDING_TASKS.length },
    });
    return { status: "ACCEPTED" as const, startDate: offer.startDate };
  }

  // ── Reading ──

  async list(ctx: RequestContext, q: { page: number; pageSize: number; status?: OfferStatus; jobId?: string; mineToApprove?: boolean }) {
    const where: Prisma.OfferWhereInput = {
      organizationId: ctx.orgId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.mineToApprove ? { status: "PENDING_APPROVAL", approvals: { some: { approverId: ctx.userId, decision: "PENDING" } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          candidate: { select: { id: true, fullName: true, email: true } },
          job: { select: { id: true, title: true } },
          approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: { position: "asc" } },
          _count: { select: { onboardingTasks: true } },
        },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.offer.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(ctx: RequestContext, id: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: {
        candidate: { select: { id: true, fullName: true, email: true } },
        job: { select: { id: true, title: true } },
        template: { select: { id: true, name: true } },
        approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: { position: "asc" } },
        onboardingTasks: { include: { assignee: { select: { id: true, name: true } } }, orderBy: { position: "asc" } },
      },
    });
    if (!offer) throw new NotFoundException("Offer not found");
    const myApproval = offer.approvals.find((a) => a.approverId === ctx.userId);
    return {
      ...offer,
      benefits: offer.benefits as unknown as Benefit[],
      canSend:
        (offer.status === "DRAFT" && offer.approvals.length === 0) ||
        (offer.status === "APPROVED" && can(ctx.role, Permission.OfferSend)),
      myApprovalPending: myApproval?.decision === "PENDING",
    };
  }

  // ── Onboarding ──

  async setTaskStatus(ctx: RequestContext, taskId: string, status: TaskStatus) {
    const task = await this.prisma.onboardingTask.findFirst({ where: { id: taskId, organizationId: ctx.orgId } });
    if (!task) throw new NotFoundException("Task not found");
    const updated = await this.prisma.onboardingTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === "DONE" ? new Date() : null,
        completedById: status === "DONE" ? ctx.userId : null,
      },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "onboarding.task_updated", entityType: "onboardingTask", entityId: taskId,
      candidateId: task.candidateId, data: { title: task.title, status }, ip: ctx.ip,
    });
    return updated;
  }

  async addTask(ctx: RequestContext, offerId: string, input: { title: string; description?: string; category?: OnboardingCategory; assigneeId?: string; dueDate?: Date }) {
    const offer = await this.find(ctx, offerId);
    if (input.assigneeId) {
      const member = await this.prisma.membership.findUnique({
        where: { userId_organizationId: { userId: input.assigneeId, organizationId: ctx.orgId } },
      });
      if (!member) throw new BadRequestException("The assignee must be a member of this organization");
    }
    const last = await this.prisma.onboardingTask.findFirst({ where: { offerId }, orderBy: { position: "desc" } });
    const task = await this.prisma.onboardingTask.create({
      data: {
        organizationId: ctx.orgId,
        offerId,
        candidateId: offer.candidateId,
        title: input.title,
        description: input.description,
        category: input.category ?? "OTHER",
        assigneeId: input.assigneeId,
        dueDate: input.dueDate,
        position: (last?.position ?? -1) + 1,
      },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "onboarding.task_added", entityType: "onboardingTask", entityId: task.id,
      candidateId: offer.candidateId, data: { title: task.title }, ip: ctx.ip,
    });
    return task;
  }

  async updateTask(ctx: RequestContext, taskId: string, input: { title?: string; description?: string | null; assigneeId?: string | null; dueDate?: Date | null; category?: OnboardingCategory }) {
    const task = await this.prisma.onboardingTask.findFirst({ where: { id: taskId, organizationId: ctx.orgId } });
    if (!task) throw new NotFoundException("Task not found");
    if (input.assigneeId) {
      const member = await this.prisma.membership.findUnique({
        where: { userId_organizationId: { userId: input.assigneeId, organizationId: ctx.orgId } },
      });
      if (!member) throw new BadRequestException("The assignee must be a member of this organization");
    }
    return this.prisma.onboardingTask.update({ where: { id: taskId }, data: input });
  }

  async deleteTask(ctx: RequestContext, taskId: string) {
    const { count } = await this.prisma.onboardingTask.deleteMany({ where: { id: taskId, organizationId: ctx.orgId } });
    if (!count) throw new NotFoundException("Task not found");
  }

  /** Everything HR needs for people who have accepted and not yet started. */
  async onboardingBoard(ctx: RequestContext) {
    const offers = await this.prisma.offer.findMany({
      where: { organizationId: ctx.orgId, status: "ACCEPTED" },
      orderBy: { startDate: "asc" },
      include: {
        candidate: { select: { id: true, fullName: true, email: true } },
        job: { select: { id: true, title: true } },
        onboardingTasks: { include: { assignee: { select: { id: true, name: true } } }, orderBy: { position: "asc" } },
      },
    });
    return offers.map((o) => {
      const done = o.onboardingTasks.filter((t) => t.status === "DONE").length;
      const overdue = o.onboardingTasks.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate < new Date()).length;
      return {
        offerId: o.id,
        candidate: o.candidate,
        job: o.job,
        jobTitle: o.jobTitle,
        startDate: o.startDate,
        daysUntilStart: Math.ceil((o.startDate.getTime() - Date.now()) / 86_400_000),
        tasks: o.onboardingTasks,
        progress: { done, total: o.onboardingTasks.length, overdue },
      };
    });
  }

  async expireOverdue() {
    const { count } = await this.prisma.offer.updateMany({
      where: { status: "SENT", respondBy: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
    if (count) this.logger.log(`Expired ${count} offer(s) with no response`);
    return count;
  }

  // ── internals ──

  private renderLetter(
    template: string,
    data: {
      candidateName: string; organizationName: string; jobTitle: string; salary: string;
      startDate: Date; respondBy: Date; benefits: Benefit[];
      probationMonths: number | null; noticePeriodDays: number | null;
      reportingTo: string | null; workLocation: string | null; senderName: string;
    },
  ): string {
    const benefitLines = data.benefits.length
      ? data.benefits.map((b) => `- ${b.label}: ${b.value}`).join("\n")
      : "- As per company policy";

    const rendered = render(template, {
      "candidate.name": data.candidateName,
      "candidate.firstName": data.candidateName.split(/\s+/)[0],
      "organization.name": data.organizationName,
      "offer.jobTitle": data.jobTitle,
      "offer.salary": data.salary,
      "offer.startDate": data.startDate.toDateString(),
      "offer.respondBy": data.respondBy.toDateString(),
      "sender.name": data.senderName,
      today: new Date().toDateString(),
    });

    // Fields with no template variable of their own are appended as a terms block.
    return rendered.text
      .replace("{{benefits}}", benefitLines)
      .replace("{{probation}}", data.probationMonths != null ? `${data.probationMonths} months` : "Not applicable")
      .replace("{{notice}}", data.noticePeriodDays != null ? `${data.noticePeriodDays} days` : "As per company policy")
      .replace("{{reportingTo}}", data.reportingTo ?? "To be confirmed")
      .replace("{{workLocation}}", data.workLocation ?? "To be confirmed");
  }

  private async notifyApprovers(ctx: RequestContext, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        approvals: { where: { decision: "PENDING" }, include: { approver: { select: { email: true, name: true } } } },
        candidate: { select: { fullName: true } },
      },
    });
    if (!offer) return;
    for (const a of offer.approvals) {
      await this.comms
        .queueSend({
          orgId: ctx.orgId,
          offerId,
          subject: `Offer approval needed: ${offer.jobTitle}`,
          body:
            `${a.approver.name},\n\n${ctx.name} has asked you to approve an offer.\n\n` +
            `Role: ${offer.jobTitle}\nCandidate: ${offer.candidate.fullName}\n` +
            `Salary: ${formatMoney(offer.salaryAmount, offer.salaryCurrency, offer.salaryPeriod)}\n` +
            `Joining date: ${offer.startDate.toDateString()}\n\nOpen Veyra Talent to approve or reject it.`,
          extraContext: { "candidate.email": a.approver.email },
          automated: true,
          sentById: null,
        })
        .catch((e) => this.logger.warn(`Approver notification failed: ${e instanceof Error ? e.message : e}`));
    }
  }

  private async find(ctx: RequestContext, id: string) {
    const offer = await this.prisma.offer.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!offer) throw new NotFoundException("Offer not found");
    return offer;
  }

  private log(ctx: RequestContext, action: string, offer: { id: string; candidateId: string; jobId: string; applicationId: string }, data: object) {
    return this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action, entityType: "offer", entityId: offer.id,
      candidateId: offer.candidateId, jobId: offer.jobId, applicationId: offer.applicationId, data: data as never, ip: ctx.ip,
    });
  }
}

export function formatMoney(amount: number, currency: string, period: string): string {
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    formatted = `${currency} ${amount.toLocaleString()}`;
  }
  return `${formatted} per ${period === "YEARLY" ? "year" : "month"}`;
}
