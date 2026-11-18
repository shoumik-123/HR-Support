import { Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../common/context";
import { CommunicationsService } from "../communications/communications.service";
import { WhatsAppService } from "./whatsapp.service";

/** The slice of Meta's webhook payload this platform acts on. */
interface StatusPayload {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[];
      };
    }[];
  }[];
}

const KNOWN = new Set(["sent", "delivered", "read", "failed"]);

/**
 * Delivery receipts from WhatsApp.
 *
 * This is the one route in the platform a stranger can POST to that writes to tenant data,
 * so it is narrow by construction: the body must carry Meta's signature over the exact bytes
 * received, nothing is read from it but a provider message id and a status, and that id must
 * already belong to a message this platform sent. A receipt for an unknown id is accepted and
 * ignored — answering 200 to anything well-formed is what stops the provider retrying for
 * hours, and telling a caller which ids exist would be an oracle.
 *
 * It needs a public URL to be of any use, so it does nothing on a laptop. Without
 * WHATSAPP_APP_SECRET set, every call is refused rather than trusted.
 */
@Controller("public/whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger("WhatsAppWebhook");

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly comms: CommunicationsService,
  ) {}

  /** Meta's one-time subscription handshake: echo the challenge if the token matches. */
  @Public()
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    if (!this.whatsapp.verifySubscription(mode, token)) throw new ForbiddenException("Verification failed");
    return challenge;
  }

  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async receive(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!this.whatsapp.verifyWebhookSignature(raw, req.header("x-hub-signature-256"))) {
      throw new ForbiddenException("Invalid signature");
    }

    const body = req.body as StatusPayload;
    const statuses = (body.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.statuses ?? []);

    let applied = 0;
    for (const status of statuses.slice(0, 200)) {
      if (!status.id || !status.status || !KNOWN.has(status.status)) continue;
      const error = status.errors?.map((e) => e.message ?? e.title).filter(Boolean).join("; ");
      const result = await this.comms
        .applyDeliveryReceipt(status.id, status.status as "sent" | "delivered" | "read" | "failed", error || undefined)
        .catch((err) => {
          this.logger.warn(`Could not apply a delivery receipt: ${err instanceof Error ? err.message : err}`);
          return { matched: false };
        });
      if (result.matched) applied++;
    }

    // Deliberately no detail: a receipt for a message we never sent looks the same as one
    // for a message we did.
    return { received: statuses.length, applied };
  }
}
