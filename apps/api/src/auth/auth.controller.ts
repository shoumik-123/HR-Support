import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import { Ctx, Public, RequestContext, UserOnly } from "../common/context";
import { ZodPipe } from "../common/validation";
import { config } from "../config";
import { AuthService, ClientInfo, IssuedSession } from "./auth.service";

const REFRESH_COOKIE = "veyra_rt";

const zPassword = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Password must contain letters and numbers");
const zEmail = z.string().trim().toLowerCase().email().max(254);

const RegisterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: zEmail,
  password: zPassword,
  organizationName: z.string().trim().min(2).max(120),
});
const LoginSchema = z.object({ email: zEmail, password: z.string().min(1).max(128) });
const TokenSchema = z.object({ token: z.string().min(10).max(200) });
const ResetSchema = z.object({ token: z.string().min(10).max(200), password: zPassword });
const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: zPassword });
const AcceptInviteSchema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(1).max(128),
});

function clientInfo(req: Request): ClientInfo {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

function setRefreshCookie(res: Response, session: IssuedSession) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/auth",
    expires: session.refreshExpiresAt,
  });
}

@Controller("auth")
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  async register(@Body(new ZodPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.register(body, clientInfo(req));
    setRefreshCookie(res, session);
    return { accessToken: session.accessToken };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(body.email, body.password, clientInfo(req));
    setRefreshCookie(res, session);
    return { accessToken: session.accessToken };
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const session = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientInfo(req));
      setRefreshCookie(res, session);
      return { accessToken: session.accessToken };
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
      throw err;
    }
  }

  @UserOnly()
  @Post("logout")
  @HttpCode(204)
  async logout(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx.sessionId);
    res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
  }

  @UserOnly()
  @Get("me")
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx.userId);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(204)
  async verifyEmail(@Body(new ZodPipe(TokenSchema)) body: z.infer<typeof TokenSchema>) {
    await this.auth.verifyEmail(body.token);
  }

  @UserOnly()
  @Post("resend-verification")
  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@Ctx() ctx: RequestContext) {
    await this.auth.sendVerification(ctx.userId, ctx.email);
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body(new ZodPipe(z.object({ email: zEmail }))) body: { email: string }) {
    await this.auth.forgotPassword(body.email);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(204)
  async resetPassword(@Body(new ZodPipe(ResetSchema)) body: z.infer<typeof ResetSchema>) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @UserOnly()
  @Post("change-password")
  @HttpCode(204)
  async changePassword(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ChangePasswordSchema)) body: z.infer<typeof ChangePasswordSchema>) {
    await this.auth.changePassword(ctx.userId, body.currentPassword, body.newPassword, ctx.sessionId);
  }

  @UserOnly()
  @Get("sessions")
  sessions(@Ctx() ctx: RequestContext) {
    return this.auth.listSessions(ctx.userId, ctx.sessionId);
  }

  @UserOnly()
  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeSession(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.auth.revokeSession(ctx.userId, id);
  }

  @Public()
  @Get("invitations/:token")
  describeInvitation(@Param("token") token: string) {
    return this.auth.describeInvitation(token);
  }

  @Public()
  @Post("invitations/accept")
  async acceptInvitation(@Body(new ZodPipe(AcceptInviteSchema)) body: z.infer<typeof AcceptInviteSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { session, organizationId } = await this.auth.acceptInvitation(body, clientInfo(req));
    setRefreshCookie(res, session);
    return { accessToken: session.accessToken, organizationId };
  }
}
