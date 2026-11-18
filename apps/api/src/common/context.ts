import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { Role } from "../generated/prisma/enums";
import type { Permission } from "./permissions";

/** Authenticated request context, attached by AuthGuard. */
export interface RequestContext {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  /** Present on org-scoped routes. */
  orgId: string;
  role: Role;
  ip?: string;
}

export interface AuthedRequest extends Request {
  ctx?: RequestContext;
}

export const IS_PUBLIC = "isPublic";
/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const NO_ORG = "noOrg";
/** Route needs a logged-in user but no organization (e.g. creating or listing orgs). */
export const UserOnly = () => SetMetadata(NO_ORG, true);

export const PERMISSIONS = "permissions";
/** Route requires every listed permission in the active organization. */
export const RequirePermission = (...perms: Permission[]) => SetMetadata(PERMISSIONS, perms);

export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const req = host.switchToHttp().getRequest<AuthedRequest>();
  if (!req.ctx) throw new Error("Ctx used on a route without AuthGuard context");
  return req.ctx;
});
