import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { ActivityService } from "../common/activity.service";
import { newToken, sha256, slugify } from "../common/crypto";
import { CommunicationsService } from "../communications/communications.service";
import { permissionsFor } from "../common/permissions";
import { config } from "../config";
import { MailService } from "../mail/mail.service";
import { createDefaultStages } from "../orgs/defaults";
import { PrismaService } from "../prisma/prisma.service";

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const BCRYPT_ROUNDS = 12;
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly activity: ActivityService,
    private readonly comms: CommunicationsService,
  ) {}

  async register(input: { name: string; email: string; password: string; organizationName: string }, client: ClientInfo) {
    const email = input.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException("An account with this email already exists");
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const slug = await this.uniqueSlug(input.organizationName);

    const { user, org } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, name: input.name, passwordHash } });
      const org = await tx.organization.create({ data: { name: input.organizationName, slug } });
      await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
      await createDefaultStages(tx, org.id);
      await this.comms.ensureDefaults(org.id, tx);
      return { user, org };
    });

    await this.activity.log({
      orgId: org.id,
      actorId: user.id,
      action: "org.created",
      entityType: "organization",
      entityId: org.id,
      ip: client.ip,
    });
    await this.sendVerification(user.id, user.email);
    return this.issueSession(user.id, client);
  }

  async login(emailRaw: string, password: string, client: ClientInfo) {
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
    // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    if (!user || !ok) throw new UnauthorizedException("Invalid email or password");
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueSession(user.id, client);
  }

  /** Rotates the refresh token. Reuse of a rotated token revokes all the user's sessions. */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedException("Missing refresh token");
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!session) throw new UnauthorizedException("Invalid refresh token");
    if (session.revokedAt) {
      // Two tabs refreshing at the same moment is benign; only older reuse is treated as theft.
      if (Date.now() - session.revokedAt.getTime() < 30_000) throw new UnauthorizedException("Refresh token already rotated");
      await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Refresh token reuse detected; all sessions revoked");
    }
    if (session.expiresAt < new Date()) throw new UnauthorizedException("Session expired");

    const { token, hash } = newToken();
    const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * DAY);
    // Rotation keeps the session id; the old hash is moved aside so reuse is detectable.
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: session.id },
        data: { refreshTokenHash: hash, expiresAt, lastUsedAt: new Date(), ipAddress: client.ip, userAgent: client.userAgent },
      }),
      this.prisma.session.create({
        data: {
          userId: session.userId,
          refreshTokenHash: sha256(refreshToken),
          expiresAt: session.expiresAt,
          revokedAt: new Date(),
        },
      }),
    ]);
    return {
      accessToken: await this.signAccess(session.userId, session.id),
      refreshToken: token,
      refreshExpiresAt: expiresAt,
    };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          include: { organization: { select: { id: true, name: true, slug: true, logoUrl: true, brandColor: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: !!user.emailVerifiedAt,
      organizations: user.memberships.map((m) => ({
        ...m.organization,
        role: m.role,
        permissions: permissionsFor(m.role),
      })),
    };
  }

  async sendVerification(userId: string, email: string) {
    const { token, hash } = newToken();
    await this.prisma.userToken.create({
      data: { userId, type: "EMAIL_VERIFICATION", tokenHash: hash, expiresAt: new Date(Date.now() + 2 * DAY) },
    });
    await this.mail.send({
      to: email,
      subject: "Verify your Veyra Talent email",
      text: `Confirm your email address:\n\n${config.webOrigin}/verify-email?token=${token}\n\nThis link expires in 48 hours.`,
    });
  }

  async verifyEmail(token: string) {
    const record = await this.consumeToken(token, "EMAIL_VERIFICATION");
    await this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  }

  async forgotPassword(emailRaw: string) {
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
    if (!user) return; // Don't reveal whether the account exists.
    const { token, hash } = newToken();
    await this.prisma.userToken.create({
      data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: hash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await this.mail.send({
      to: user.email,
      subject: "Reset your Veyra Talent password",
      text: `Reset your password:\n\n${config.webOrigin}/reset-password?token=${token}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
    });
  }

  async resetPassword(token: string, password: string) {
    const record = await this.consumeToken(token, "PASSWORD_RESET");
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async changePassword(userId: string, current: string, next: string, keepSessionId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new BadRequestException("Current password is incorrect");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, BCRYPT_ROUNDS) } }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, id: { not: keepSessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new NotFoundException("Session not found");
  }

  // ── Invitations ──

  async describeInvitation(token: string) {
    const invite = await this.findOpenInvitation(token);
    const existing = await this.prisma.user.findUnique({ where: { email: invite.email } });
    return {
      organizationName: invite.organization.name,
      email: invite.email,
      role: invite.role,
      accountExists: !!existing,
    };
  }

  async acceptInvitation(input: { token: string; name?: string; password: string }, client: ClientInfo) {
    const invite = await this.findOpenInvitation(input.token);
    let user = await this.prisma.user.findUnique({ where: { email: invite.email } });

    if (user) {
      if (!(await bcrypt.compare(input.password, user.passwordHash))) {
        throw new UnauthorizedException("Incorrect password for the existing account");
      }
    } else {
      if (!input.name) throw new BadRequestException("Name is required to create your account");
      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          name: input.name,
          passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
          // Receiving the invitation link proves control of the address.
          emailVerifiedAt: new Date(),
        },
      });
    }

    const userId = user.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { userId_organizationId: { userId, organizationId: invite.organizationId } },
        create: { userId, organizationId: invite.organizationId, role: invite.role },
        update: { role: invite.role, status: "ACTIVE" },
      });
      await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      await this.activity.log(
        {
          orgId: invite.organizationId,
          actorId: userId,
          action: "member.joined",
          entityType: "membership",
          entityId: userId,
          data: { role: invite.role },
          ip: client.ip,
        },
        tx,
      );
    });
    return { session: await this.issueSession(userId, client), organizationId: invite.organizationId };
  }

  // ── internals ──

  private async issueSession(userId: string, client: ClientInfo): Promise<IssuedSession> {
    const { token, hash } = newToken();
    const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * DAY);
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hash,
        expiresAt,
        ipAddress: client.ip,
        userAgent: client.userAgent?.slice(0, 500),
      },
    });
    return { accessToken: await this.signAccess(userId, session.id), refreshToken: token, refreshExpiresAt: expiresAt };
  }

  private signAccess(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId });
  }

  private async consumeToken(token: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET") {
    const record = await this.prisma.userToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException("This link is invalid or has expired");
    }
    await this.prisma.userToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return record;
  }

  private async findOpenInvitation(token: string) {
    const invite = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: true },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) {
      throw new ForbiddenException("This invitation is invalid or has expired");
    }
    return invite;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const taken = await this.prisma.organization.findUnique({ where: { slug } });
      if (!taken) return slug;
    }
    throw new ConflictException("Could not allocate an organization URL; try a different name");
  }
}
