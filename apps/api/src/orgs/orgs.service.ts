import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { newToken, slugify } from "../common/crypto";
import { assignableRoles } from "../common/permissions";
import { paginate } from "../common/validation";
import { CommunicationsService } from "../communications/communications.service";
import { config } from "../config";
import { MembershipStatus, Role, StageKind } from "../generated/prisma/enums";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { createDefaultStages, SYSTEM_STAGE_KINDS } from "./defaults";

export interface OrgProfileInput {
  name?: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  website?: string | null;
  industry?: string | null;
  companySize?: string | null;
  country?: string | null;
  timezone?: string;
  defaultCurrency?: string;
  blindModeDefault?: boolean;
  /** Whether /careers/<slug> is served publicly. */
  careersEnabled?: boolean;
  careersIntro?: string | null;
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly mail: MailService,
    private readonly comms: CommunicationsService,
  ) {}

  // ── Organization ──

  get(ctx: RequestContext) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  }

  async update(ctx: RequestContext, input: OrgProfileInput) {
    const org = await this.prisma.organization.update({ where: { id: ctx.orgId }, data: input });
    await this.log(ctx, "org.updated", "organization", org.id, { fields: Object.keys(input) });
    return org;
  }

  async create(ctx: RequestContext, name: string) {
    let slug = slugify(name);
    if (await this.prisma.organization.findUnique({ where: { slug } })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const org = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name, slug } });
      await tx.membership.create({ data: { userId: ctx.userId, organizationId: org.id, role: "OWNER" } });
      await createDefaultStages(tx, org.id);
      await this.comms.ensureDefaults(org.id, tx);
      return org;
    });
    await this.activity.log({ orgId: org.id, actorId: ctx.userId, action: "org.created", entityType: "organization", entityId: org.id });
    return org;
  }

  // ── Members ──

  async members(ctx: RequestContext) {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: ctx.orgId },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((m) => ({ ...m.user, role: m.role, status: m.status, joinedAt: m.createdAt }));
  }

  async updateMember(ctx: RequestContext, userId: string, input: { role?: Role; status?: MembershipStatus }) {
    const target = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: ctx.orgId } },
    });
    if (!target) throw new NotFoundException("Member not found");
    if (userId === ctx.userId) throw new BadRequestException("You cannot change your own role or status");
    if (target.role === "OWNER" && ctx.role !== "OWNER") throw new ForbiddenException("Only owners can modify owners");
    if (input.role && !assignableRoles(ctx.role).includes(input.role)) {
      throw new ForbiddenException(`You cannot assign the ${input.role} role`);
    }
    if (target.role === "OWNER" && ((input.role && input.role !== "OWNER") || input.status === "SUSPENDED")) {
      await this.assertAnotherOwner(ctx.orgId, userId);
    }
    const updated = await this.prisma.membership.update({ where: { id: target.id }, data: input });
    await this.log(ctx, "member.updated", "membership", userId, { from: { role: target.role, status: target.status }, to: input });
    return updated;
  }

  async removeMember(ctx: RequestContext, userId: string) {
    const target = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: ctx.orgId } },
    });
    if (!target) throw new NotFoundException("Member not found");
    if (target.role === "OWNER") {
      if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can remove owners");
      await this.assertAnotherOwner(ctx.orgId, userId);
    }
    await this.prisma.membership.delete({ where: { id: target.id } });
    await this.log(ctx, "member.removed", "membership", userId, { role: target.role });
  }

  private async assertAnotherOwner(orgId: string, excludingUserId: string) {
    const owners = await this.prisma.membership.count({
      where: { organizationId: orgId, role: "OWNER", status: "ACTIVE", userId: { not: excludingUserId } },
    });
    if (!owners) throw new BadRequestException("An organization must keep at least one active owner");
  }

  // ── Invitations ──

  invitations(ctx: RequestContext) {
    return this.prisma.invitation.findMany({
      where: { organizationId: ctx.orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async invite(ctx: RequestContext, emailRaw: string, role: Role) {
    const email = emailRaw.toLowerCase();
    if (!assignableRoles(ctx.role).includes(role)) throw new ForbiddenException(`You cannot invite a ${role}`);
    const existing = await this.prisma.membership.findFirst({
      where: { organizationId: ctx.orgId, user: { email } },
    });
    if (existing) throw new ConflictException("This person is already a member");

    // Replace any open invitation for the same address.
    await this.prisma.invitation.updateMany({
      where: { organizationId: ctx.orgId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const { token, hash } = newToken();
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: ctx.orgId,
        email,
        role,
        tokenHash: hash,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      include: { organization: true },
    });
    await this.mail.send({
      to: email,
      subject: `${ctx.name} invited you to ${invitation.organization.name} on Veyra Talent`,
      text: `You've been invited to join ${invitation.organization.name} as ${role.replace("_", " ").toLowerCase()}.\n\nAccept: ${config.webOrigin}/invite?token=${token}\n\nThis invitation expires in 7 days.`,
    });
    await this.log(ctx, "member.invited", "invitation", invitation.id, { email, role });
    return { id: invitation.id, email, role, expiresAt: invitation.expiresAt };
  }

  async revokeInvitation(ctx: RequestContext, id: string) {
    const { count } = await this.prisma.invitation.updateMany({
      where: { id, organizationId: ctx.orgId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new NotFoundException("Invitation not found");
    await this.log(ctx, "invitation.revoked", "invitation", id);
  }

  // ── Departments ──

  departments(ctx: RequestContext) {
    return this.prisma.department.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { name: "asc" },
      include: { _count: { select: { jobs: true } } },
    });
  }

  async createDepartment(ctx: RequestContext, name: string) {
    const dept = await this.prisma.department.create({ data: { organizationId: ctx.orgId, name } });
    await this.log(ctx, "department.created", "department", dept.id, { name });
    return dept;
  }

  async deleteDepartment(ctx: RequestContext, id: string) {
    const { count } = await this.prisma.department.deleteMany({ where: { id, organizationId: ctx.orgId } });
    if (!count) throw new NotFoundException("Department not found");
    await this.log(ctx, "department.deleted", "department", id);
  }

  // ── Pipeline stages ──

  stages(ctx: RequestContext) {
    return this.prisma.pipelineStage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { position: "asc" } });
  }

  async createStage(ctx: RequestContext, input: { name: string; color?: string; kind?: StageKind }) {
    const kind = input.kind ?? "CUSTOM";
    if (SYSTEM_STAGE_KINDS.includes(kind)) throw new BadRequestException(`There can only be one ${kind} stage`);
    // Insert before the terminal stages (Hired/Rejected) so they stay last.
    const stages = await this.stages(ctx);
    const firstTerminal = stages.find((s) => s.kind === "HIRED" || s.kind === "REJECTED");
    const position = firstTerminal ? firstTerminal.position : stages.length;
    const stage = await this.prisma.$transaction(async (tx) => {
      await tx.pipelineStage.updateMany({
        where: { organizationId: ctx.orgId, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
      return tx.pipelineStage.create({ data: { organizationId: ctx.orgId, name: input.name, color: input.color, kind, position } });
    });
    await this.log(ctx, "stage.created", "stage", stage.id, { name: stage.name });
    return stage;
  }

  async updateStage(ctx: RequestContext, id: string, input: { name?: string; color?: string }) {
    await this.findStage(ctx, id);
    const stage = await this.prisma.pipelineStage.update({ where: { id }, data: input });
    await this.log(ctx, "stage.updated", "stage", id, input);
    return stage;
  }

  async reorderStages(ctx: RequestContext, ids: string[]) {
    const stages = await this.stages(ctx);
    if (ids.length !== stages.length || !stages.every((s) => ids.includes(s.id))) {
      throw new BadRequestException("Provide every stage id exactly once");
    }
    const kindById = new Map(stages.map((s) => [s.id, s.kind]));
    if (kindById.get(ids[0]) !== "APPLIED") throw new BadRequestException("Applied must remain the first stage");
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.pipelineStage.update({ where: { id }, data: { position } })));
    await this.log(ctx, "stage.reordered", "stage", ctx.orgId);
    return this.stages(ctx);
  }

  async deleteStage(ctx: RequestContext, id: string) {
    const stage = await this.findStage(ctx, id);
    if (SYSTEM_STAGE_KINDS.includes(stage.kind)) throw new BadRequestException(`The ${stage.name} stage cannot be deleted`);
    const inUse = await this.prisma.application.count({ where: { stageId: id } });
    if (inUse) throw new BadRequestException(`Move the ${inUse} application(s) in this stage before deleting it`);
    await this.prisma.pipelineStage.delete({ where: { id } });
    await this.log(ctx, "stage.deleted", "stage", id, { name: stage.name });
  }

  private async findStage(ctx: RequestContext, id: string) {
    const stage = await this.prisma.pipelineStage.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!stage) throw new NotFoundException("Stage not found");
    return stage;
  }

  // ── Audit ──

  async audit(ctx: RequestContext, page: number, pageSize: number) {
    const where = { organizationId: ctx.orgId };
    const [items, total] = await Promise.all([
      this.prisma.activity.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(page, pageSize) }),
      this.prisma.activity.count({ where }),
    ]);
    const actorIds = [...new Set(items.map((i) => i.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const nameById = new Map(actors.map((a) => [a.id, a.name]));
    return { items: items.map((i) => ({ ...i, actorName: i.actorId ? nameById.get(i.actorId) ?? null : null })), total, page, pageSize };
  }

  private log(ctx: RequestContext, action: string, entityType: string, entityId: string, data?: object) {
    return this.activity.log({ orgId: ctx.orgId, actorId: ctx.userId, action, entityType, entityId, data: data as never, ip: ctx.ip });
  }
}
