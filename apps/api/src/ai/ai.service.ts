import { Global, Injectable, Logger, Module } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";

export class AiUnavailableError extends Error {
  constructor(message = "AI is not configured (set ANTHROPIC_API_KEY)") {
    super(message);
  }
}

/** Retryable = worth re-running the background job later. */
export class AiRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export interface StructuredRequest<T extends z.ZodType> {
  orgId: string;
  feature: string;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  schema: T;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/**
 * Single entry point for Claude calls. Every call:
 * - returns schema-validated structured output (never free text parsed by hand),
 * - opts into server-side refusal fallbacks,
 * - records token usage per organization (AI cost per candidate KPI).
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger("AI");
  private readonly client = config.anthropicApiKey
    ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 3, timeout: 5 * 60 * 1000 })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return this.client !== null;
  }

  get model(): string {
    return config.aiModel;
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<{ data: z.infer<T>; model: string }> {
    if (!this.client) throw new AiUnavailableError();

    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: config.aiModel,
        max_tokens: req.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: req.system,
        output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
        messages: [{ role: "user", content: req.content }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AiRequestError("Anthropic API key was rejected", false);
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new AiRequestError(`AI request rejected: ${err.message}`, false);
      }
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        throw new AiRequestError(`AI temporarily unavailable: ${err.message}`, true);
      }
      if (err instanceof Anthropic.APIError) {
        throw new AiRequestError(`AI error ${err.status}: ${err.message}`, true);
      }
      throw err;
    }

    await this.prisma.aiUsage
      .create({
        data: {
          organizationId: req.orgId,
          feature: req.feature,
          model: response.model,
          inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0),
          outputTokens: response.usage.output_tokens,
        },
      })
      .catch((e) => this.logger.warn(`Failed to record AI usage: ${e}`));

    if (response.stop_reason === "refusal") {
      throw new AiRequestError(`AI declined the request (${response.stop_details?.category ?? "unspecified"})`, false);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AiRequestError("AI response was truncated (max_tokens)", true);
    }
    if (response.parsed_output == null) {
      throw new AiRequestError("AI response did not match the expected schema", true);
    }
    return { data: response.parsed_output as z.infer<T>, model: response.model };
  }
}

@Global()
@Module({ providers: [AiService], exports: [AiService] })
export class AiModule {}
