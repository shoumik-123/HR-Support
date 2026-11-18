import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AuthedRequest, IS_PUBLIC, NO_ORG, PERMISSIONS } from "./context";
import { can, Permission } from "./permissions";

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

/**
 * Global guard: verifies the access token, checks the session is live, resolves the
 * active organization from the X-Org-Id header (falling back to the user's first
 * membership) and enforces @RequirePermission. Tenant isolation starts here: services
 * receive orgId only from this context, never from request bodies.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Missing access token");

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException("Session is no longer valid");
    }

    const base = {
      userId: session.userId,
      sessionId: session.id,
      email: session.user.email,
      name: session.user.name,
      ip: req.ip,
    };

    if (this.reflector.getAllAndOverride<boolean>(NO_ORG, targets)) {
      req.ctx = { ...base, orgId: "", role: "VIEWER" };
      return true;
    }

    const requestedOrg = req.headers["x-org-id"];
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: session.userId,
        status: "ACTIVE",
        ...(typeof requestedOrg === "string" && requestedOrg ? { organizationId: requestedOrg } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) throw new ForbiddenException("You are not a member of this organization");

    req.ctx = { ...base, orgId: membership.organizationId, role: membership.role };

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !can(membership.role, p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(", ")}`);
    return true;
  }
}
