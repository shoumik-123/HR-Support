import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, ZodPipe } from "../common/validation";
import { AutomationTrigger, CommunicationStatus, TemplateKey } from "../generated/prisma/enums";
import { CommunicationsService } from "./communications.service";
import { TEMPLATE_VARIABLES } from "./template-render";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);

const CreateTemplateSchema = z.object({
  key: zEnum(TemplateKey),
  name: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(10).max(20_000),
});

const UpdateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  subject: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(10).max(20_000).optional(),
  enabled: z.boolean().optional(),
});

const AutomationSchema = z.object({
  trigger: zEnum(AutomationTrigger),
  stageId: z.string().nullable().optional(),
  templateId: z.string().min(1),
  enabled: z.boolean(),
  offsetHours: z.number().int().min(1).max(336).optional(),
});

const SendSchema = z
  .object({
    applicationId: z.string().min(1),
    templateId: z.string().optional(),
    subject: z.string().trim().min(2).max(200).optional(),
    body: z.string().trim().min(5).max(20_000).optional(),
  })
  .refine((v) => v.templateId || (v.subject && v.body), { message: "Choose a template, or write a subject and message" });

const BulkSendSchema = z
  .object({
    applicationIds: z.array(z.string()).min(1).max(200),
    templateId: z.string().optional(),
    subject: z.string().trim().min(2).max(200).optional(),
    body: z.string().trim().min(5).max(20_000).optional(),
  })
  .refine((v) => v.templateId || (v.subject && v.body), { message: "Choose a template, or write a subject and message" });

const HistorySchema = zPagination.extend({
  candidateId: z.string().optional(),
  applicationId: z.string().optional(),
  status: zEnum(CommunicationStatus).optional(),
});

@Controller("communications")
export class CommunicationsController {
  constructor(private readonly comms: CommunicationsService) {}

  @Get("variables")
  @RequirePermission(Permission.EmailSend)
  variables() {
    return Object.entries(TEMPLATE_VARIABLES).map(([name, description]) => ({ name, description }));
  }

  @Get("templates")
  @RequirePermission(Permission.EmailSend)
  templates(@Ctx() ctx: RequestContext) {
    return this.comms.templates(ctx);
  }

  @Post("templates")
  @RequirePermission(Permission.EmailTemplateManage)
  createTemplate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreateTemplateSchema)) body: z.infer<typeof CreateTemplateSchema>) {
    return this.comms.createTemplate(ctx, body);
  }

  @Patch("templates/:id")
  @RequirePermission(Permission.EmailTemplateManage)
  updateTemplate(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(UpdateTemplateSchema)) body: z.infer<typeof UpdateTemplateSchema>) {
    return this.comms.updateTemplate(ctx, id, body);
  }

  @Delete("templates/:id")
  @HttpCode(204)
  @RequirePermission(Permission.EmailTemplateManage)
  deleteTemplate(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.comms.deleteTemplate(ctx, id);
  }

  @Get("templates/:id/preview")
  @RequirePermission(Permission.EmailSend)
  preview(@Ctx() ctx: RequestContext, @Param("id") id: string, @Query("applicationId") applicationId?: string) {
    return this.comms.preview(ctx, id, applicationId);
  }

  @Get("automations")
  @RequirePermission(Permission.EmailSend)
  automations(@Ctx() ctx: RequestContext) {
    return this.comms.automations(ctx);
  }

  @Put("automations")
  @RequirePermission(Permission.AutomationManage)
  upsertAutomation(@Ctx() ctx: RequestContext, @Body(new ZodPipe(AutomationSchema)) body: z.infer<typeof AutomationSchema>) {
    return this.comms.upsertAutomation(ctx, body);
  }

  @Post("send")
  @HttpCode(200)
  @RequirePermission(Permission.EmailSend)
  send(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SendSchema)) body: z.infer<typeof SendSchema>) {
    return this.comms.sendToApplication(ctx, body);
  }

  @Post("send-bulk")
  @HttpCode(200)
  @RequirePermission(Permission.EmailSend)
  sendBulk(@Ctx() ctx: RequestContext, @Body(new ZodPipe(BulkSendSchema)) body: z.infer<typeof BulkSendSchema>) {
    return this.comms.sendBulk(ctx, body);
  }

  @Get()
  @RequirePermission(Permission.EmailSend)
  history(@Ctx() ctx: RequestContext, @Query(new ZodPipe(HistorySchema)) q: z.infer<typeof HistorySchema>) {
    return this.comms.history(ctx, q);
  }

  @Get("stats")
  @RequirePermission(Permission.AnalyticsView)
  stats(@Ctx() ctx: RequestContext, @Query(new ZodPipe(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }))) q: { days: number }) {
    return this.comms.stats(ctx, q.days);
  }

  @Post(":id/retry")
  @HttpCode(200)
  @RequirePermission(Permission.EmailSend)
  retry(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.comms.retry(ctx, id);
  }
}
