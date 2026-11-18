import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission, UserOnly } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, ZodPipe } from "../common/validation";
import { MembershipStatus, Role, StageKind } from "../generated/prisma/enums";
import { OrgsService } from "./orgs.service";

const zUrl = z.string().trim().url().max(500);
const zColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #4f46e5");

const UpdateOrgSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: zUrl.nullable().optional(),
  brandColor: zColor.nullable().optional(),
  website: zUrl.nullable().optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  companySize: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  timezone: z.string().trim().max(60).optional(),
  defaultCurrency: z.string().trim().length(3).toUpperCase().optional(),
  blindModeDefault: z.boolean().optional(),
  careersEnabled: z.boolean().optional(),
  careersIntro: z.string().trim().max(2000).nullable().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappNumber: z.string().trim().max(32).nullable().optional(),
});
const zRole = z.enum(Object.values(Role) as [Role, ...Role[]]);
const UpdateMemberSchema = z.object({
  role: zRole.optional(),
  status: z.enum(Object.values(MembershipStatus) as [MembershipStatus, ...MembershipStatus[]]).optional(),
});
const InviteSchema = z.object({ email: z.string().trim().email().max(254), role: zRole });
const NameSchema = z.object({ name: z.string().trim().min(1).max(120) });
const StageSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: zColor.optional(),
  kind: z.enum(Object.values(StageKind) as [StageKind, ...StageKind[]]).optional(),
});
const UpdateStageSchema = z.object({ name: z.string().trim().min(1).max(60).optional(), color: zColor.optional() });
const ReorderSchema = z.object({ ids: z.array(z.string()).min(1).max(50) });

@Controller()
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @UserOnly()
  @Post("orgs")
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(NameSchema)) body: { name: string }) {
    return this.orgs.create(ctx, body.name);
  }

  @Get("org")
  get(@Ctx() ctx: RequestContext) {
    return this.orgs.get(ctx);
  }

  @Patch("org")
  @RequirePermission(Permission.OrgManage)
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(UpdateOrgSchema)) body: z.infer<typeof UpdateOrgSchema>) {
    return this.orgs.update(ctx, body);
  }

  @Get("org/members")
  @RequirePermission(Permission.TeamView)
  members(@Ctx() ctx: RequestContext) {
    return this.orgs.members(ctx);
  }

  @Patch("org/members/:userId")
  @RequirePermission(Permission.TeamManage)
  updateMember(@Ctx() ctx: RequestContext, @Param("userId") userId: string, @Body(new ZodPipe(UpdateMemberSchema)) body: z.infer<typeof UpdateMemberSchema>) {
    return this.orgs.updateMember(ctx, userId, body);
  }

  @Delete("org/members/:userId")
  @HttpCode(204)
  @RequirePermission(Permission.TeamManage)
  removeMember(@Ctx() ctx: RequestContext, @Param("userId") userId: string) {
    return this.orgs.removeMember(ctx, userId);
  }

  @Get("org/invitations")
  @RequirePermission(Permission.TeamManage)
  invitations(@Ctx() ctx: RequestContext) {
    return this.orgs.invitations(ctx);
  }

  @Post("org/invitations")
  @RequirePermission(Permission.TeamManage)
  invite(@Ctx() ctx: RequestContext, @Body(new ZodPipe(InviteSchema)) body: z.infer<typeof InviteSchema>) {
    return this.orgs.invite(ctx, body.email, body.role);
  }

  @Delete("org/invitations/:id")
  @HttpCode(204)
  @RequirePermission(Permission.TeamManage)
  revokeInvitation(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.orgs.revokeInvitation(ctx, id);
  }

  @Get("org/departments")
  departments(@Ctx() ctx: RequestContext) {
    return this.orgs.departments(ctx);
  }

  @Post("org/departments")
  @RequirePermission(Permission.OrgManage)
  createDepartment(@Ctx() ctx: RequestContext, @Body(new ZodPipe(NameSchema)) body: { name: string }) {
    return this.orgs.createDepartment(ctx, body.name);
  }

  @Delete("org/departments/:id")
  @HttpCode(204)
  @RequirePermission(Permission.OrgManage)
  deleteDepartment(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.orgs.deleteDepartment(ctx, id);
  }

  @Get("org/stages")
  stages(@Ctx() ctx: RequestContext) {
    return this.orgs.stages(ctx);
  }

  @Post("org/stages")
  @RequirePermission(Permission.PipelineConfigure)
  createStage(@Ctx() ctx: RequestContext, @Body(new ZodPipe(StageSchema)) body: z.infer<typeof StageSchema>) {
    return this.orgs.createStage(ctx, body);
  }

  @Put("org/stages/order")
  @RequirePermission(Permission.PipelineConfigure)
  reorderStages(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ReorderSchema)) body: { ids: string[] }) {
    return this.orgs.reorderStages(ctx, body.ids);
  }

  @Patch("org/stages/:id")
  @RequirePermission(Permission.PipelineConfigure)
  updateStage(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(UpdateStageSchema)) body: z.infer<typeof UpdateStageSchema>) {
    return this.orgs.updateStage(ctx, id, body);
  }

  @Delete("org/stages/:id")
  @HttpCode(204)
  @RequirePermission(Permission.PipelineConfigure)
  deleteStage(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.orgs.deleteStage(ctx, id);
  }

  @Get("org/audit")
  @RequirePermission(Permission.AuditView)
  audit(@Ctx() ctx: RequestContext, @Query(new ZodPipe(zPagination)) q: z.infer<typeof zPagination>) {
    return this.orgs.audit(ctx, q.page, q.pageSize);
  }
}
