import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export interface WhatsAppMessage {
  /** E.164, with the plus. */
  to: string;
  /** The text a candidate will read. Already rendered; placeholders are resolved upstream. */
  text: string;
  /**
   * The provider-approved template to send it as. Without one, a message only reaches a
   * candidate who wrote to the business within the last 24 hours, so the service says so
   * rather than letting the provider reject it silently.
   */
  providerTemplateName?: string | null;
  locale?: string;
}

export class WhatsAppSendError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly providerCode?: string) {
    super(message);
  }
}

export interface WhatsAppResult {
  /** The provider's id for the message, so a delivery receipt can be matched to it. */
  providerMessageId: string | null;
  /** False when nothing left this machine because no provider is configured. */
  delivered: boolean;
}

/**
 * Sends WhatsApp messages through Meta's Cloud API when it is configured, and otherwise
 * records exactly what would have been sent.
 *
 * Credentials are platform-wide environment variables, not per-organization settings: a
 * WhatsApp token is a bearer credential and nothing here encrypts data at rest yet, so a
 * token per tenant would be a secret sitting in a database in plain text. The consequence
 * is that every organization on one deployment sends from the same business number, which
 * is right for a single-company deployment and has to change before this is sold as SaaS.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger("WhatsApp");

  get configured(): boolean {
    return !!(config.whatsappToken && config.whatsappPhoneNumberId);
  }

  /** The number candidates will see, when the platform knows it. */
  get businessNumber(): string | null {
    return config.whatsappBusinessNumber ?? null;
  }

  async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
    if (!this.configured) {
      // Not an error: the whole feature has to work on a laptop with no Meta account, the
      // same way email falls back to the log. The Communication row records the attempt.
      this.logger.log(
        `\n--- WhatsApp (no provider configured) ---\nTo: ${message.to}\nTemplate: ${message.providerTemplateName ?? "(free text, 24-hour window only)"}\n\n${message.text}\n---`,
      );
      return { providerMessageId: null, delivered: false };
    }

    const url = `https://graph.facebook.com/${config.whatsappApiVersion}/${config.whatsappPhoneNumberId}/messages`;
    const body = message.providerTemplateName
      ? {
          messaging_product: "whatsapp",
          to: message.to,
          type: "template",
          template: {
            name: message.providerTemplateName,
            language: { code: message.locale ?? "en" },
            // One body parameter carrying the whole rendered text. Meta requires the
            // registered template to be a single {{1}} body for this to line up, which is
            // what the setup notes in the README ask for.
            components: [{ type: "body", parameters: [{ type: "text", text: message.text.slice(0, 1024) }] }],
          },
        }
      : { messaging_product: "whatsapp", to: message.to, type: "text", text: { preview_url: false, body: message.text.slice(0, 4096) } };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.whatsappToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new WhatsAppSendError(`Could not reach WhatsApp: ${err instanceof Error ? err.message : err}`, true);
    }

    const payload = (await response.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_subcode?: number; type?: string };
    };

    if (!response.ok) {
      const detail = payload.error?.message ?? `HTTP ${response.status}`;
      // 4xx other than 429 means the request itself is wrong - retrying sends it again and
      // gets the same answer, so the row is failed with the provider's reason kept.
      const retryable = response.status === 429 || response.status >= 500;
      throw new WhatsAppSendError(`WhatsApp refused the message: ${detail}`, retryable, String(payload.error?.code ?? response.status));
    }

    return { providerMessageId: payload.messages?.[0]?.id ?? null, delivered: true };
  }

  /**
   * Meta signs every webhook with the app secret. An unsigned or wrongly signed callback is
   * someone else writing to our delivery history, so it is rejected before it is parsed.
   */
  verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
    if (!config.whatsappAppSecret) return false;
    if (!header?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", config.whatsappAppSecret).update(rawBody).digest();
    const given = Buffer.from(header.slice(7), "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** The handshake Meta performs once when the webhook URL is first registered. */
  verifySubscription(mode: string | undefined, token: string | undefined): boolean {
    return mode === "subscribe" && !!config.whatsappVerifyToken && token === config.whatsappVerifyToken;
  }
}

@Global()
@Module({ providers: [WhatsAppService], exports: [WhatsAppService] })
export class WhatsAppModule {}
