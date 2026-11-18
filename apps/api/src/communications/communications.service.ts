import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { paginate } from "../common/validation";
import { Prisma } from "../generated/prisma/client";
import { AutomationTrigger, TemplateKey } from "../generated/prisma/enums";
import { MailAttachment, MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { DEFAULT_WHATSAPP_TEMPLATES } from "../whatsapp/default-whatsapp-templates";
import { normalisePhone } from "../whatsapp/phone";
import { WhatsAppSendError, WhatsAppService } from "../whatsapp/whatsapp.service";
import { DEFAULT_TEMPLATES } from "./default-templates";
import { firstName, render, RenderContext, usedVariables } from "./template-render";

export const SEND_EMAIL_JOB = "email.send";
export const SEND_WHATSAPP_JOB = "whatsapp.send";

export interface SendRequest {
  orgId: string;
  templateId?: string;
  templateKey?: TemplateKey;
  trigger?: AutomationTrigger;
  candidateId?: string;
  applicationId?: string;
  interviewId?: string;
  assessmentId?: string;
  offerId?: string;
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
    private readonly whatsapp: WhatsAppService,
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
    this.queue.register(SEND_WHATSAPP_JOB, async (payload: { communicationId: string }) => {
      await this.deliverWhatsApp(payload.communicationId);
    });
    this.queue.register(`${SEND_WHATSAPP_JOB}:failed`, async (payload: { communicationId: string }, job) => {
      await this.prisma.communication.update({
        where: { id: payload.communicationId },
        data: { status: "FAILED", error: job.lastError?.slice(0, 1000) ?? "WhatsApp delivery failed" },
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
    await this.ensureWhatsAppDefaults(ctx.orgId);
    const [rules, templates, stages] = await Promise.all([
      this.prisma.emailAutomation.findMany({
        where: { organizationId: ctx.orgId },
        include: {
          template: { select: { id: true, name: true, key: true } },
          whatsappTemplate: { select: { id: true, name: true, key: true } },
          stage: { select: { id: true, name: true } },
        },
      }),
      this.prisma.emailTemplate.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true, key: true } }),
      this.prisma.pipelineStage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } }),
    ]);
    const whatsappTemplates = await this.prisma.whatsAppTemplate.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true, key: true, enabled: true } });
    return { rules, templates, stages, whatsappTemplates };
  }

  async upsertAutomation(
    ctx: RequestContext,
    input: { trigger: AutomationTrigger; stageId?: string | null; templateId: string; whatsappTemplateId?: string | null; enabled: boolean; offsetHours?: number },
  ) {
    const template = await this.prisma.emailTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.orgId } });
    if (!template) throw new BadRequestException("Unknown template");
    if (input.whatsappTemplateId) {
      const wa = await this.prisma.whatsAppTemplate.findFirst({ where: { id: input.whatsappTemplateId, organizationId: ctx.orgId } });
      if (!wa) throw new BadRequestException("Unknown WhatsApp template");
    }
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
      whatsappTemplateId: input.whatsappTemplateId ?? null,
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
        assessmentId: req.assessmentId,
        offerId: req.offerId,
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
        assessmentId: req.assessmentId, offerId: req.offerId,
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
    // An email row without an address cannot be delivered and must not be retried forever;
    // queueSend records a skip instead, so reaching here means the row was tampered with.
    if (!row.toEmail) {
      await this.prisma.communication.update({ where: { id: communicationId }, data: { status: "SKIPPED", skipReason: "No email address on the message" } });
      return;
    }
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
      const email = await this.queueSend({
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
      // One rule, two channels. A WhatsApp template attached to the rule means the same
      // event also reaches the candidate's phone; a failure on either side is recorded on
      // its own row and neither can stop the other.
      if (rule.whatsappTemplateId) {
        await this.queueWhatsApp({
          orgId: input.orgId,
          whatsappTemplateId: rule.whatsappTemplateId,
          trigger,
          candidateId: input.candidateId,
          applicationId: input.applicationId,
          interviewId: input.interviewId,
          extraContext: input.extraContext,
          automated: true,
          sentById: null,
        }).catch((err) => this.logger.error(`WhatsApp automation ${trigger} failed: ${err instanceof Error ? err.message : err}`));
      }
      return email;
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

  async history(ctx: RequestContext, q: { page: number; pageSize: number; candidateId?: string; applicationId?: string; status?: string; channel?: string }) {
    const where: Prisma.CommunicationWhereInput = {
      organizationId: ctx.orgId,
      ...(q.candidateId ? { candidateId: q.candidateId } : {}),
      ...(q.applicationId ? { applicationId: q.applicationId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.channel ? { channel: q.channel as never } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.communication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
        candidate: { select: { id: true, fullName: true } },
        template: { select: { name: true } },
        whatsappTemplate: { select: { name: true } },
      },
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
    if (row.status === "SENT" || row.status === "DELIVERED" || row.status === "READ") throw new BadRequestException("This message was already delivered");
    // A WhatsApp message recorded while no provider was connected keeps its text, so once
    // WhatsApp is set up it can be sent as written rather than retyped.
    if (row.status === "SKIPPED" && !row.body) throw new BadRequestException("This message was skipped and has no content to resend");
    if (row.channel === "WHATSAPP") {
      if (!row.toPhone) throw new BadRequestException("This message has no phone number to send to");
      if (!this.whatsapp.configured) throw new BadRequestException("WhatsApp is not connected on this server, so there is nothing to retry yet");
      await this.prisma.communication.update({ where: { id }, data: { status: "QUEUED", error: null, skipReason: null } });
      await this.queue.enqueue(SEND_WHATSAPP_JOB, { communicationId: id }, { orgId: ctx.orgId, idempotencyKey: `whatsapp:${id}:retry:${Date.now()}` });
      return { queued: true };
    }
    await this.prisma.communication.update({ where: { id }, data: { status: "QUEUED", error: null } });
    await this.queue.enqueue(SEND_EMAIL_JOB, { communicationId: id }, { orgId: ctx.orgId, idempotencyKey: `email:${id}:retry:${Date.now()}` });
    return { queued: true };
  }

  // ── WhatsApp ──

  /** Seeds a new organization's WhatsApp templates the first time they are asked for. */
  async ensureWhatsAppDefaults(orgId: string) {
    const existing = await this.prisma.whatsAppTemplate.count({ where: { organizationId: orgId } });
    if (existing) return;
    await this.prisma.whatsAppTemplate.createMany({
      data: DEFAULT_WHATSAPP_TEMPLATES.map((t) => ({ ...t, organizationId: orgId, isDefault: true })),
    });
  }

  /** Templates, plus whether this server can actually deliver one. */
  async whatsappTemplates(ctx: RequestContext) {
    await this.ensureWhatsAppDefaults(ctx.orgId);
    const [templates, org] = await Promise.all([
      this.prisma.whatsAppTemplate.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ key: "asc" }, { name: "asc" }] }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { whatsappEnabled: true, whatsappNumber: true } }),
    ]);
    return {
      templates: templates.map((t) => ({ ...t, variables: usedVariables(t.body), length: t.body.length })),
      enabledForOrganization: org.whatsappEnabled,
      /** False when no provider credentials are set: messages are recorded, not delivered. */
      providerConnected: this.whatsapp.configured,
      businessNumber: org.whatsappNumber ?? this.whatsapp.businessNumber,
    };
  }

  async createWhatsAppTemplate(ctx: RequestContext, input: { key: TemplateKey; name: string; body: string; providerTemplateName?: string | null; locale?: string }) {
    const { unknown } = usedVariables(input.body);
    if (unknown.length) throw new BadRequestException(`Unknown placeholders: ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
    const created = await this.prisma.whatsAppTemplate.create({ data: { ...input, organizationId: ctx.orgId, createdById: ctx.userId } });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "whatsapp_template.created", entityType: "whatsAppTemplate", entityId: created.id,
      data: { key: created.key }, ip: ctx.ip,
    });
    return created;
  }

  async updateWhatsAppTemplate(
    ctx: RequestContext,
    id: string,
    input: { name?: string; body?: string; enabled?: boolean; providerTemplateName?: string | null; locale?: string },
  ) {
    const template = await this.prisma.whatsAppTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!template) throw new NotFoundException("Template not found");
    if (input.body) {
      const { unknown } = usedVariables(input.body);
      if (unknown.length) throw new BadRequestException(`Unknown placeholders: ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
    }
    const updated = await this.prisma.whatsAppTemplate.update({ where: { id }, data: { ...input, isDefault: false } });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "whatsapp_template.updated", entityType: "whatsAppTemplate", entityId: id,
      data: { key: template.key, fields: Object.keys(input) }, ip: ctx.ip,
    });
    return updated;
  }

  async deleteWhatsAppTemplate(ctx: RequestContext, id: string) {
    const template = await this.prisma.whatsAppTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!template) throw new NotFoundException("Template not found");
    const inUse = await this.prisma.emailAutomation.count({ where: { whatsappTemplateId: id, enabled: true } });
    if (inUse) throw new BadRequestException("This template is used by an active automation; turn that off first");
    await this.prisma.whatsAppTemplate.delete({ where: { id } });
    await this.activity.log({ orgId: ctx.orgId, actorId: ctx.userId, action: "whatsapp_template.deleted", entityType: "whatsAppTemplate", entityId: id, ip: ctx.ip });
  }

  /** The message as the candidate would read it, and the number it would go to. */
  async previewWhatsApp(ctx: RequestContext, templateId: string, applicationId?: string) {
    const template = await this.prisma.whatsAppTemplate.findFirst({ where: { id: templateId, organizationId: ctx.orgId } });
    if (!template) throw new NotFoundException("Template not found");
    const context = applicationId
      ? await this.buildContext({ orgId: ctx.orgId, applicationId, sentById: ctx.userId })
      : { ...(await this.orgContext(ctx.orgId)), "candidate.name": "Example Candidate", "candidate.firstName": "Example", "job.title": "Example Role" };
    const body = render(template.body, context);
    const phone = normalisePhone((context as { __phone?: string }).__phone);
    return {
      body: body.text,
      length: body.text.length,
      missing: body.missing,
      unknown: body.unknown,
      to: phone.e164,
      toReason: phone.reason,
      providerTemplateName: template.providerTemplateName,
      providerConnected: this.whatsapp.configured,
    };
  }

  /**
   * Queues one WhatsApp message, writing the Communication row first so the attempt is on
   * record either way. Everything that would stop a send - the feature being off, no usable
   * number, withdrawn consent, a disabled template - is recorded as a skip with its reason,
   * never as a silent nothing.
   */
  async queueWhatsApp(req: SendRequest & { whatsappTemplateId?: string; whatsappTemplateKey?: TemplateKey }): Promise<{
    communicationId: string;
    status: "QUEUED" | "SKIPPED";
    reason?: string;
  }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: req.orgId }, select: { whatsappEnabled: true } });
    const context = await this.buildContext(req);

    const template = req.whatsappTemplateId
      ? await this.prisma.whatsAppTemplate.findFirst({ where: { id: req.whatsappTemplateId, organizationId: req.orgId } })
      : req.whatsappTemplateKey
        ? await this.prisma.whatsAppTemplate.findFirst({ where: { organizationId: req.orgId, key: req.whatsappTemplateKey }, orderBy: { isDefault: "asc" } })
        : null;
    if (!template && !req.body) throw new BadRequestException("No WhatsApp template available for this message");

    const label = template?.name ?? "WhatsApp message";
    const rendered = render(template?.body ?? req.body ?? "", context);
    const body = rendered.text;
    const skip = (reason: string, to: string | null, text = "") => this.recordWhatsAppSkip(req, template?.id ?? null, template?.key ?? null, label, to, text, reason);

    const phone = normalisePhone(context.__phone);

    if (!org.whatsappEnabled) return skip("WhatsApp messaging is switched off for this organization", phone.e164, body);
    if (template && !template.enabled) return skip("This WhatsApp template is switched off", phone.e164, body);
    if (!phone.e164) return skip(phone.reason ?? "No usable phone number", null, body);
    if (context.__consent === "WITHDRAWN") return skip("Candidate has withdrawn consent to be contacted", phone.e164, body);
    // A placeholder with nothing to put in it leaves a hole mid-sentence. In an email that
    // is untidy; on someone's phone, from an employer, it reads as careless - and the thing
    // that is missing is usually the very detail the message exists to convey. So a message
    // with gaps is recorded, named, and not sent: an interview invitation needs to be sent
    // from the interview, where the time and the link exist.
    if (rendered.missing.length) {
      return skip(`The message still had gaps (${rendered.missing.map((m) => `{{${m}}}`).join(", ")}), so it was not sent`, phone.e164, body);
    }

    const communication = await this.prisma.communication.create({
      data: {
        organizationId: req.orgId,
        candidateId: req.candidateId,
        applicationId: req.applicationId,
        interviewId: req.interviewId,
        assessmentId: req.assessmentId,
        offerId: req.offerId,
        whatsappTemplateId: template?.id,
        templateKey: template?.key,
        trigger: req.trigger,
        channel: "WHATSAPP",
        toEmail: null,
        toPhone: phone.e164,
        subject: label,
        body,
        status: "QUEUED",
        sentById: req.sentById ?? null,
        automated: req.automated ?? false,
      },
    });
    await this.queue.enqueue(SEND_WHATSAPP_JOB, { communicationId: communication.id }, { orgId: req.orgId, idempotencyKey: `whatsapp:${communication.id}` });
    return { communicationId: communication.id, status: "QUEUED" };
  }

  private async recordWhatsAppSkip(
    req: SendRequest,
    templateId: string | null,
    templateKey: TemplateKey | null,
    label: string,
    to: string | null,
    body: string,
    reason: string,
  ) {
    const row = await this.prisma.communication.create({
      data: {
        organizationId: req.orgId, candidateId: req.candidateId, applicationId: req.applicationId, interviewId: req.interviewId,
        assessmentId: req.assessmentId, offerId: req.offerId,
        whatsappTemplateId: templateId ?? undefined, templateKey: templateKey ?? undefined, trigger: req.trigger,
        channel: "WHATSAPP", toEmail: null, toPhone: to, subject: label, body,
        status: "SKIPPED", skipReason: reason, sentById: req.sentById ?? null, automated: req.automated ?? false,
      },
    });
    this.logger.log(`WhatsApp skipped (${reason}) for candidate ${req.candidateId ?? "?"}`);
    return { communicationId: row.id, status: "SKIPPED" as const, reason };
  }

  private async deliverWhatsApp(communicationId: string) {
    const row = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      include: { whatsappTemplate: { select: { providerTemplateName: true, locale: true } } },
    });
    if (!row || !row.toPhone || row.status === "SENT" || row.status === "DELIVERED" || row.status === "READ") return;

    try {
      const result = await this.whatsapp.send({
        to: row.toPhone,
        text: row.body,
        providerTemplateName: row.whatsappTemplate?.providerTemplateName ?? null,
        locale: row.whatsappTemplate?.locale ?? "en",
      });
      await this.prisma.communication.update({
        where: { id: communicationId },
        data: result.delivered
          ? { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId, error: null, skipReason: null }
          : // Nothing left the machine, so claiming it was sent would be a lie in the one
            // place a recruiter goes to check whether a candidate was told.
            { status: "SKIPPED", skipReason: "WhatsApp is not connected on this server, so this message was recorded but not delivered" },
      });
    } catch (err) {
      if (err instanceof WhatsAppSendError && !err.retryable) {
        await this.prisma.communication.update({
          where: { id: communicationId },
          data: { status: "FAILED", error: `${err.message}`.slice(0, 1000) },
        });
        return;
      }
      throw err;
    }
  }

  /**
   * A delivery receipt from the provider. Statuses only ever move forward, so a receipt that
   * arrives out of order cannot turn a read message back into a sent one.
   */
  async applyDeliveryReceipt(providerMessageId: string, status: "sent" | "delivered" | "read" | "failed", error?: string) {
    const row = await this.prisma.communication.findFirst({ where: { providerMessageId }, select: { id: true, status: true } });
    if (!row) return { matched: false };

    const rank: Record<string, number> = { QUEUED: 0, SKIPPED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
    const next = status === "failed" ? "FAILED" : status === "read" ? "READ" : status === "delivered" ? "DELIVERED" : "SENT";
    if (rank[next] <= rank[row.status] && next !== "FAILED") return { matched: true, changed: false };

    await this.prisma.communication.update({
      where: { id: row.id },
      data: { status: next as never, ...(status === "failed" && error ? { error: error.slice(0, 1000) } : {}), ...(next === "SENT" ? { sentAt: new Date() } : {}) },
    });
    return { matched: true, changed: true, status: next };
  }

  /** A recruiter sending one WhatsApp message to one candidate, by hand. */
  async sendWhatsAppToApplication(ctx: RequestContext, input: { applicationId: string; templateId?: string; body?: string }) {
    const app = await this.prisma.application.findFirst({ where: { id: input.applicationId, organizationId: ctx.orgId } });
    if (!app) throw new NotFoundException("Application not found");
    const result = await this.queueWhatsApp({
      orgId: ctx.orgId, applicationId: app.id, candidateId: app.candidateId,
      whatsappTemplateId: input.templateId, body: input.body, sentById: ctx.userId, automated: false,
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "whatsapp.sent", entityType: "communication", entityId: result.communicationId,
      candidateId: app.candidateId, applicationId: app.id, jobId: app.jobId, data: { status: result.status, reason: result.reason }, ip: ctx.ip,
    });
    return result;
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
  private async buildContext(req: SendRequest): Promise<RenderContext & { __consent?: string; __phone?: string }> {
    const context: RenderContext & { __consent?: string; __phone?: string } = { ...(await this.orgContext(req.orgId)) };

    if (req.sentById) {
      const sender = await this.prisma.user.findUnique({ where: { id: req.sentById }, select: { name: true } });
      context["sender.name"] = sender?.name;
    }
    context["sender.name"] ??= context["organization.name"];

    const application = req.applicationId
      ? await this.prisma.application.findFirst({
          where: { id: req.applicationId, organizationId: req.orgId },
          include: {
            candidate: { select: { id: true, fullName: true, email: true, phone: true, consentStatus: true } },
            job: { select: { title: true, location: true, department: { select: { name: true } } } },
            stage: { select: { name: true } },
          },
        })
      : null;

    const candidate = application?.candidate
      ?? (req.candidateId
        ? await this.prisma.candidate.findFirst({ where: { id: req.candidateId, organizationId: req.orgId }, select: { id: true, fullName: true, email: true, phone: true, consentStatus: true } })
        : null);

    if (candidate) {
      context["candidate.name"] = candidate.fullName;
      context["candidate.firstName"] = firstName(candidate.fullName);
      context["candidate.email"] = candidate.email ?? undefined;
      context.__consent = candidate.consentStatus;
      context.__phone = candidate.phone ?? undefined;
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
