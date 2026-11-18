import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { AutomationTrigger, TemplateKey } from "../generated/prisma/enums";
import { MailAttachment, MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { DEFAULT_TEMPLATES } from "./default-templates";
import { firstName, render, RenderContext, usedVariables } from "./template-render";

export const SEND_EMAIL_JOB = "email.send";

export interface SendRequest {
  orgId: string;
  templateId?: string;
  templateKey?: TemplateKey;
  trigger?: AutomationTrigger;
  candidateId?: string;
  applicationId?: string;
  interviewId?: string;
  /** Overrides the template; used for one-off emails written in the UI. */
  subject?: string;
  body?: string;
  /** Extra context values, e.g. interview details the caller already has. */
  extraContext?: RenderContext;
  attachments?: MailAttachment[];
  sentById?: string | null;
  automated?: boolean;
}

@Injectable()
export class CommunicationsService implements OnModuleInit {
  private readonly logger = new Logger("Communications");

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly queue: QueueService,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    this.queue.register(SEND_EMAIL_JOB, async (payload: { communicationId: string; attachments?: MailAttachment[] }) => {
      await this.deliver(payload.communicationId, payload.attachments);
    });
    this.queue.register(`${SEND_EMAIL_JOB}:failed`, async (payload: { communicationId: string }, job) => {
      await this.prisma.communication.update({
        where: { id: payload.communicationId },
        data: { status: "FAILED", error: job.lastError?.slice(0, 1000) ?? "Delivery failed" },
      });
    });
  }

  // ── Templates ──

  async ensureDefaults(orgId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const existing = await tx.emailTemplate.count({ where: { organizationId: orgId } });
    if (existing) return;
    await tx.emailTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ ...t, organizationId: orgId, isDefault: true })),
    });
  }

  async templates(ctx: RequestContext) {
    await this.ensureDefaults(ctx.orgId);
    const templates = await this.prisma.emailTemplate.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: [{ key: "asc" }, { name: "asc" }],
    });
    return templates.map((t) => ({ ...t, variables: usedVariables(`${t.subject}\n${t.body}`) }));
  }

  async updateTemplate(ctx: RequestContext, id: string, input: { name?: string; subject?: string; body?: string; enabled?: boolean }) {
    const template = await this.prisma.emailTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!template) throw new NotFoundException("Template not found");

    const merged = `${input.subject ?? template.subject}\n${input.body ?? template.body}`;
    const { unknown } = usedVariables(merged);
    if (unknown.length) throw new BadRequestException(`Unknown placeholders: ${unknown.map((u) => `{{${u}}}`).join(", ")}`);

    const updated = await this.prisma.emailTemplate.update({ where: { id }, data: { ...input, isDefault: false } });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "email_template.updated", entityType: "emailTemplate", entityId: id,
      data: { key: template.key, fields: Object.keys(input) }, ip: ctx.ip,
    });
    return updated;
  }

  async createTemplate(ctx: RequestContext, input: { key: TemplateKey; name: string; subject: string; body: string }) {
    const { unknown } = usedVariables(`${input.subject}\n${input.body}`);
    if (unknown.length) throw new BadRequestException(`Unknown placeholders: ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
    const created = await this.prisma.emailTemplate.create({
      data: { ...input, organizationId: ctx.orgId, createdById: ctx.userId },
    });
    await this.activity.log({ orgId: ctx.orgId, actorId: ctx.userId, action: "email_template.created", entityType: "emailTemplate", entityId: created.id, ip: ctx.ip });
    return created;
  }

  async deleteTemplate(ctx: RequestContext, id: string) {
    const template = await this.prisma.emailTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!template) throw new NotFoundException("Template not found");
    const inUse = await this.prisma.emailAutomation.count({ where: { templateId: id, enabled: true } });
    if (inUse) throw new BadRequestException("This template is used by an active automation; turn that off first");
    await this.prisma.emailTemplate.delete({ where: { id } });
    await this.activity.log({ orgId: ctx.orgId, actorId: ctx.userId, action: "email_template.deleted", entityType: "emailTemplate", entityId: id, ip: ctx.ip });
  }

  /** Renders a template against a real application so recruiters see the actual wording. */
  async preview(ctx: RequestContext, templateId: string, applicationId?: string) {
    const template = await this.prisma.emailTemplate.findFirst({ where: { id: templateId, organizationId: ctx.orgId } });
    if (!template) throw new NotFoundException("Template not found");
    const context = applicationId
      ? await this.buildContext({ orgId: ctx.orgId, applicationId, sentById: ctx.userId })
      : { ...(await this.orgContext(ctx.orgId)), "candidate.name": "Example Candidate", "candidate.firstName": "Example", "job.title": "Example Role" };

    const subject = render(template.subject, context);
    const body = render(template.body, context);
    return {
      subject: subject.text,
      body: body.text,
      missing: [...new Set([...subject.missing, ...body.missing])],
      unknown: [...new Set([...subject.unknown, ...body.unknown])],
    };
  }

  // ── Automations ──

  async automations(ctx: RequestContext) {
    await this.ensureDefaults(ctx.orgId);
    const [rules, templates, stages] = await Promise.all([
      this.prisma.emailAutomation.findMany({ where: { organizationId: ctx.orgId }, include: { template: { select: { id: true, name: true, key: true } }, stage: { select: { id: true, name: true } } } }),
      this.prisma.emailTemplate.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true, key: true } }),
      this.prisma.pipelineStage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } }),
    ]);
    return { rules, templates, stages };
  }

  async upsertAutomation(
    ctx: RequestContext,
    input: { trigger: AutomationTrigger; stageId?: string | null; templateId: string; enabled: boolean; offsetHours?: number },
  ) {
    const template = await this.prisma.emailTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.orgId } });
    if (!template) throw new BadRequestException("Unknown template");
    if (input.trigger === "STAGE_CHANGED" && !input.stageId) throw new BadRequestException("Choose which stage fires this automation");
    if (input.trigger !== "STAGE_CHANGED" && input.stageId) throw new BadRequestException("A stage can only be set for the stage-changed trigger");
    if (input.stageId) {
      const stage = await this.prisma.pipelineStage.findFirst({ where: { id: input.stageId, organizationId: ctx.orgId } });
      if (!stage) throw new BadRequestException("Unknown stage");
    }

    // Not an upsert: the unique constraint covers a nullable stageId, and Postgres treats
    // NULLs as distinct, so a plain upsert could create duplicate non-stage rules. The
    // migration adds NULLS NOT DISTINCT; this keeps the application correct regardless.
    const data = {
      templateId: input.templateId,
      enabled: input.enabled,
      offsetHours: input.offsetHours ?? 24,
      updatedById: ctx.userId,
    };
    const existing = await this.prisma.emailAutomation.findFirst({
      where: { organizationId: ctx.orgId, trigger: input.trigger, stageId: input.stageId ?? null },
    });
    const rule = existing
      ? await this.prisma.emailAutomation.update({ where: { id: existing.id }, data })
      : await this.prisma.emailAutomation.create({
          data: { ...data, organizationId: ctx.orgId, trigger: input.trigger, stageId: input.stageId ?? null },
        });
    // Turning candidate-facing automation on or off is a policy change worth auditing.
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: input.enabled ? "automation.enabled" : "automation.disabled",
      entityType: "emailAutomation", entityId: rule.id,
      data: { trigger: input.trigger, stageId: input.stageId ?? null, template: template.name }, ip: ctx.ip,
    });
    return rule;
  }

  // ── Sending ──

  /**
   * Queues one email. Always writes a Communication row first, so an attempt is on
   * record even if delivery later fails, and nothing is sent without a trace.
   */
  async queueSend(req: SendRequest): Promise<{ communicationId: string; status: "QUEUED" | "SKIPPED"; reason?: string }> {
    const context = await this.buildContext(req);
    const to = context["candidate.email"];

    let subject = req.subject;
    let body = req.body;
    if (!subject || !body) {
      const template = req.templateId
        ? await this.prisma.emailTemplate.findFirst({ where: { id: req.templateId, organizationId: req.orgId } })
        : req.templateKey
          ? await this.prisma.emailTemplate.findFirst({ where: { organizationId: req.orgId, key: req.templateKey }, orderBy: { isDefault: "asc" } })
          : null;
      if (!template) throw new BadRequestException("No template available for this message");
      if (!template.enabled) {
        return this.recordSkip(req, to, template.id, template.key, "Template is disabled");
      }
      subject = render(template.subject, context).text;
      body = render(template.body, context).text;
      req = { ...req, templateId: template.id, templateKey: template.key };
    } else {
      subject = render(subject, context).text;
      body = render(body, context).text;
    }

    if (!to) return this.recordSkip(req, to, req.templateId, req.templateKey, "No email address on file for this candidate");

    const consent = context["__consent"] as string | undefined;
    if (consent === "WITHDRAWN") {
      return this.recordSkip(req, to, req.templateId, req.templateKey, "Candidate has withdrawn consent to be contacted");
    }

    const communication = await this.prisma.communication.create({
      data: {
        organizationId: req.orgId,
        candidateId: req.candidateId,
        applicationId: req.applicationId,
        interviewId: req.interviewId,
        templateId: req.templateId,
        templateKey: req.templateKey,
        trigger: req.trigger,
        toEmail: to,
        subject,
        body,
        status: "QUEUED",
        sentById: req.sentById ?? null,
        automated: req.automated ?? false,
      },
    });
    // Attachments travel in the job payload as plain JSON so a retry after a restart
    // still carries the calendar invite.
    await this.queue.enqueue(
      SEND_EMAIL_JOB,
      { communicationId: communication.id, attachments: (req.attachments ?? []) as unknown as Prisma.InputJsonValue },
      { orgId: req.orgId, idempotencyKey: `email:${communication.id}` },
    );
    return { communicationId: communication.id, status: "QUEUED" };
  }

  private async recordSkip(req: SendRequest, to: string | null | undefined, templateId: string | null | undefined, templateKey: TemplateKey | null | undefined, reason: string) {
    const row = await this.prisma.communication.create({
      data: {
        organizationId: req.orgId, candidateId: req.candidateId, applicationId: req.applicationId, interviewId: req.interviewId,
        templateId: templateId ?? undefined, templateKey: templateKey ?? undefined, trigger: req.trigger, toEmail: to ?? "(unknown)", subject: "(not sent)", body: "",
        status: "SKIPPED", skipReason: reason, sentById: req.sentById ?? null, automated: req.automated ?? false,
      },
    });
    this.logger.log(`Email skipped (${reason}) for candidate ${req.candidateId ?? "?"}`);
    return { communicationId: row.id, status: "SKIPPED" as const, reason };
  }

  private async deliver(communicationId: string, attachments?: MailAttachment[]) {
    const row = await this.prisma.communication.findUnique({ where: { id: communicationId } });
    if (!row || row.status === "SENT") return;
    await this.mail.send({ to: row.toEmail, subject: row.subject, text: row.body, attachments });
    await this.prisma.communication.update({ where: { id: communicationId }, data: { status: "SENT", sentAt: new Date(), error: null } });
  }

  /** Fires any enabled automation for a trigger. Never throws into the caller's flow. */
  async fire(trigger: AutomationTrigger, input: { orgId: string; applicationId?: string; candidateId?: string; interviewId?: string; stageId?: string; extraContext?: RenderContext; attachments?: MailAttachment[] }) {
    try {
      const rule = await this.prisma.emailAutomation.findFirst({
        where: { organizationId: input.orgId, trigger, enabled: true, ...(trigger === "STAGE_CHANGED" ? { stageId: input.stageId } : {}) },
        include: { template: true },
      });
      if (!rule) return null;
      return await this.queueSend({
        orgId: input.orgId,
        templateId: rule.templateId,
        trigger,
        candidateId: input.candidateId,
        applicationId: input.applicationId,
        interviewId: input.interviewId,
        extraContext: input.extraContext,
        attachments: input.attachments,
        automated: true,
        sentById: null,
      });
    } catch (err) {
      // A failed notification must never roll back the recruitment action that caused it.
      this.logger.error(`Automation ${trigger} failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ── Manual and bulk sending ──

  async sendToApplication(ctx: RequestContext, input: { applicationId: string; templateId?: string; subject?: string; body?: string }) {
    const app = await this.prisma.application.findFirst({ where: { id: input.applicationId, organizationId: ctx.orgId } });
    if (!app) throw new NotFoundException("Application not found");
    const result = await this.queueSend({
      orgId: ctx.orgId, applicationId: app.id, candidateId: app.candidateId,
      templateId: input.templateId, subject: input.subject, body: input.body, sentById: ctx.userId, automated: false,
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "email.sent", entityType: "communication", entityId: result.communicationId,
      candidateId: app.candidateId, applicationId: app.id, jobId: app.jobId, data: { status: result.status, reason: result.reason }, ip: ctx.ip,
    });
    return result;
  }

  /** Bulk send to selected applications. Each recipient gets its own logged attempt. */
  async sendBulk(ctx: RequestContext, input: { applicationIds: string[]; templateId?: string; subject?: string; body?: string }) {
    const apps = await this.prisma.application.findMany({
      where: { id: { in: input.applicationIds }, organizationId: ctx.orgId },
      select: { id: true, candidateId: true, jobId: true },
    });
    if (!apps.length) throw new NotFoundException("No matching applications");

    const results: { applicationId: string; status: string; reason?: string }[] = [];
    for (const app of apps) {
      try {
        const r = await this.queueSend({
          orgId: ctx.orgId, applicationId: app.id, candidateId: app.candidateId,
          templateId: input.templateId, subject: input.subject, body: input.body, sentById: ctx.userId, automated: false,
        });
        results.push({ applicationId: app.id, status: r.status, reason: r.reason });
      } catch (err) {
        results.push({ applicationId: app.id, status: "FAILED", reason: err instanceof Error ? err.message : "Failed" });
      }
    }
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "email.bulk_sent", entityType: "communication", entityId: apps[0].id,
      data: { requested: input.applicationIds.length, queued: results.filter((r) => r.status === "QUEUED").length }, ip: ctx.ip,
    });
    return { queued: results.filter((r) => r.status === "QUEUED").length, results };
  }

  // ── History ──

  async history(ctx: RequestContext, q: { page: number; pageSize: number; candidateId?: string; applicationId?: string; status?: string }) {
    const where: Prisma.CommunicationWhereInput = {
      organizationId: ctx.orgId,
      ...(q.candidateId ? { candidateId: q.candidateId } : {}),
      ...(q.applicationId ? { applicationId: q.applicationId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.communication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { candidate: { select: { id: true, fullName: true } }, template: { select: { name: true } } },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.communication.count({ where }),
    ]);
    const senderIds = [...new Set(items.map((i) => i.sentById).filter((x): x is string => !!x))];
    const senders = await this.prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true } });
    const nameById = new Map(senders.map((s) => [s.id, s.name]));
    return {
      items: items.map((i) => ({ ...i, sentByName: i.sentById ? nameById.get(i.sentById) ?? "Former member" : i.automated ? "Automation" : null })),
      total, page: q.page, pageSize: q.pageSize,
    };
  }

  async stats(ctx: RequestContext, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [byStatus, automatedCount] = await Promise.all([
      this.prisma.communication.groupBy({ by: ["status"], where: { organizationId: ctx.orgId, createdAt: { gte: since } }, _count: true }),
      this.prisma.communication.count({ where: { organizationId: ctx.orgId, createdAt: { gte: since }, automated: true } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    const attempted = (counts.SENT ?? 0) + (counts.FAILED ?? 0);
    return {
      periodDays: days,
      sent: counts.SENT ?? 0,
      queued: counts.QUEUED ?? 0,
      failed: counts.FAILED ?? 0,
      skipped: counts.SKIPPED ?? 0,
      automated: automatedCount,
      deliveryRate: attempted ? Math.round(((counts.SENT ?? 0) / attempted) * 100) : null,
    };
  }

  async retry(ctx: RequestContext, id: string) {
    const row = await this.prisma.communication.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!row) throw new NotFoundException("Message not found");
    if (row.status === "SENT") throw new BadRequestException("This message was already delivered");
    if (row.status === "SKIPPED") throw new BadRequestException("This message was skipped and has no content to resend");
    await this.prisma.communication.update({ where: { id }, data: { status: "QUEUED", error: null } });
    await this.queue.enqueue(SEND_EMAIL_JOB, { communicationId: id }, { orgId: ctx.orgId, idempotencyKey: `email:${id}:retry:${Date.now()}` });
    return { queued: true };
  }

  // ── Context ──

  private async orgContext(orgId: string): Promise<RenderContext> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { name: true, website: true },
    });
    return {
      "organization.name": org.name,
      "organization.website": org.website ?? undefined,
      today: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    };
  }

  /** Assembles every template variable available for this message. */
  private async buildContext(req: SendRequest): Promise<RenderContext & { __consent?: string }> {
    const context: RenderContext & { __consent?: string } = { ...(await this.orgContext(req.orgId)) };

    if (req.sentById) {
      const sender = await this.prisma.user.findUnique({ where: { id: req.sentById }, select: { name: true } });
      context["sender.name"] = sender?.name;
    }
    context["sender.name"] ??= context["organization.name"];

    const application = req.applicationId
      ? await this.prisma.application.findFirst({
          where: { id: req.applicationId, organizationId: req.orgId },
          include: {
            candidate: { select: { id: true, fullName: true, email: true, consentStatus: true } },
            job: { select: { title: true, location: true, department: { select: { name: true } } } },
            stage: { select: { name: true } },
          },
        })
      : null;

    const candidate = application?.candidate
      ?? (req.candidateId
        ? await this.prisma.candidate.findFirst({ where: { id: req.candidateId, organizationId: req.orgId }, select: { id: true, fullName: true, email: true, consentStatus: true } })
        : null);

    if (candidate) {
      context["candidate.name"] = candidate.fullName;
      context["candidate.firstName"] = firstName(candidate.fullName);
      context["candidate.email"] = candidate.email ?? undefined;
      context.__consent = candidate.consentStatus;
    }
    if (application) {
      context["job.title"] = application.job.title;
      context["job.location"] = application.job.location ?? undefined;
      context["job.department"] = application.job.department?.name;
      context["stage.name"] = application.stage.name;
    }

    if (req.interviewId) {
      const interview = await this.prisma.interview.findFirst({
        where: { id: req.interviewId, organizationId: req.orgId },
        include: { participants: { include: { user: { select: { name: true } } } }, job: { select: { title: true, location: true } } },
      });
      if (interview) {
        const { formatInZone } = await import("../interviews/scheduling");
        context["interview.title"] = interview.title;
        context["interview.kind"] = interview.kind.replace(/_/g, " ").toLowerCase();
        context["interview.datetime"] = formatInZone(interview.startsAt, interview.timezone);
        context["interview.duration"] = String(Math.round((interview.endsAt.getTime() - interview.startsAt.getTime()) / 60000));
        context["interview.mode"] = interview.mode === "ONSITE" ? "on-site" : interview.mode.toLowerCase();
        context["interview.location"] = interview.meetingLink ?? interview.location ?? undefined;
        context["interview.round"] = String(interview.round);
        context["interview.interviewers"] = interview.participants.filter((p) => p.role !== "OBSERVER").map((p) => p.user.name).join(", ") || undefined;
        context["job.title"] ??= interview.job.title;
      }
    }

    return { ...context, ...req.extraContext };
  }
}
