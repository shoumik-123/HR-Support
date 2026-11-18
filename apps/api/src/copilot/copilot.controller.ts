import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { can, Permission } from "../common/permissions";
import { ZodPipe } from "../common/validation";
import { INTENT_SPECS } from "./copilot-intents";
import { CopilotService } from "./copilot.service";

const AskSchema = z.object({ question: z.string().trim().min(2, "Ask a question").max(500) });

/**
 * The recruitment copilot: questions about your own hiring data, answered from figures the
 * API computes. Every answer names the question it understood, shows those figures beside
 * the prose, and says whether a model was involved.
 */
@Controller("copilot")
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post("ask")
  @HttpCode(200)
  // JobView is the floor for asking anything; each question is then gated on its own
  // permission inside the service, so an answer can never outrun the asker's role.
  @RequirePermission(Permission.JobView)
  // Two model calls and several aggregate queries per question, so a person gets a steady
  // conversation rather than a script getting a free analytics API.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  ask(@Ctx() ctx: RequestContext, @Body(new ZodPipe(AskSchema)) body: z.infer<typeof AskSchema>) {
    return this.copilot.ask(ctx, body.question);
  }

  /** What this member may ask, for the suggestions on screen. */
  @Get("questions")
  @RequirePermission(Permission.JobView)
  questions(@Ctx() ctx: RequestContext) {
    return Object.values(INTENT_SPECS)
      .filter((spec) => spec.intent !== "capabilities" && can(ctx.role, spec.permission))
      .map((spec) => ({ intent: spec.intent, summary: spec.summary, examples: spec.followUps }));
  }
}
