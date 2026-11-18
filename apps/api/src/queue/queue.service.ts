import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { hostname } from "node:os";
import { config } from "../config";
import { BackgroundJob, Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type JobHandler = (payload: any, job: BackgroundJob) => Promise<void>;

/**
 * Durable background work queue on Postgres (SELECT ... FOR UPDATE SKIP LOCKED).
 * - At-least-once delivery with exponential backoff retries.
 * - Idempotency keys de-duplicate enqueues; handlers must also be idempotent.
 * - Jobs whose worker died are reclaimed after LOCK_TIMEOUT.
 * Run more API instances (or RUN_WORKER=true worker-only instances) to scale out.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Queue");
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId = `${hostname()}:${process.pid}`;
  private readonly concurrency = 3;
  private readonly lockTimeoutMs = 10 * 60 * 1000;
  private running = false;
  private active = 0;
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(
    type: string,
    payload: Prisma.InputJsonValue,
    opts: { orgId?: string; idempotencyKey?: string; maxAttempts?: number; tx?: Prisma.TransactionClient } = {},
  ): Promise<void> {
    const db = opts.tx ?? this.prisma;
    const data = {
      type,
      payload,
      organizationId: opts.orgId,
      idempotencyKey: opts.idempotencyKey,
      maxAttempts: opts.maxAttempts ?? 3,
    };
    if (opts.idempotencyKey) {
      await db.backgroundJob.upsert({ where: { idempotencyKey: opts.idempotencyKey }, create: data, update: {} });
    } else {
      await db.backgroundJob.create({ data });
    }
    this.kick();
  }

  onApplicationBootstrap() {
    if (!config.runWorker) return;
    this.running = true;
    this.timer = setInterval(() => this.kick(), 2000);
    this.logger.log(`Worker ${this.workerId} started (concurrency ${this.concurrency})`);
  }

  async onApplicationShutdown() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  /** Fill free worker slots. Safe to call often. */
  private kick() {
    if (!this.running) return;
    while (this.active < this.concurrency) {
      this.active++;
      void this.slot();
    }
  }

  /** One worker slot: keeps taking jobs until the queue is empty, then frees itself. */
  private async slot() {
    try {
      while (this.running && (await this.runOne())) {
        // keep draining
      }
    } catch (err) {
      this.logger.error(`Worker loop error: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.active--;
    }
  }

  private async claim(): Promise<BackgroundJob | null> {
    const staleBefore = new Date(Date.now() - this.lockTimeoutMs);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "BackgroundJob" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${this.workerId},
             attempts = attempts + 1
      WHERE id = (
        SELECT id FROM "BackgroundJob"
        WHERE (status = 'PENDING' AND "runAt" <= now())
           OR (status = 'RUNNING' AND "lockedAt" < ${staleBefore})
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id`;
    if (!rows.length) return null;
    return this.prisma.backgroundJob.findUnique({ where: { id: rows[0].id } });
  }

  private async runOne(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;

    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
      await handler(job.payload, job);
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, lastError: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentJobError || job.attempts >= job.maxAttempts;
      const backoffMs = Math.min(5 * 60_000, 2 ** job.attempts * 5000);
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: permanent ? "FAILED" : "PENDING",
          lastError: message.slice(0, 2000),
          lockedAt: null,
          runAt: new Date(Date.now() + backoffMs),
        },
      });
      this.logger.warn(`Job ${job.type}#${job.id} attempt ${job.attempts} failed${permanent ? " permanently" : ""}: ${message}`);
      if (permanent) {
        const onFail = this.handlers.get(`${job.type}:failed`);
        await onFail?.(job.payload, job).catch(() => undefined);
      }
    }
    return true;
  }
}

/** Throw from a handler to fail without retrying (bad input, unsupported file, etc.). */
export class PermanentJobError extends Error {}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
