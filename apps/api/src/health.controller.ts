import { Controller, Get } from "@nestjs/common";
import { AiService } from "./ai/ai.service";
import { Public } from "./common/context";
import { PrismaService } from "./prisma/prisma.service";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  @Public()
  @Get("health")
  async health() {
    const started = Date.now();
    let database = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "unavailable";
    }
    const [pending, failed] = await Promise.all([
      this.prisma.backgroundJob.count({ where: { status: "PENDING" } }).catch(() => -1),
      this.prisma.backgroundJob.count({ where: { status: "FAILED" } }).catch(() => -1),
    ]);
    return {
      status: database === "ok" ? "ok" : "degraded",
      database,
      ai: this.ai.enabled ? "configured" : "disabled",
      queue: { pending, failed },
      latencyMs: Date.now() - started,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
