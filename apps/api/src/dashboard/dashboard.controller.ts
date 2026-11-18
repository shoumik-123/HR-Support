import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { ZodPipe } from "../common/validation";
import { DashboardService } from "./dashboard.service";

const PeriodSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

@Controller("analytics")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("overview")
  @RequirePermission(Permission.AnalyticsView)
  overview(@Ctx() ctx: RequestContext, @Query(new ZodPipe(PeriodSchema)) q: { days: number }) {
    return this.dashboard.overview(ctx, q.days);
  }

  @Get("jobs")
  @RequirePermission(Permission.AnalyticsView)
  jobs(@Ctx() ctx: RequestContext) {
    return this.dashboard.jobPerformance(ctx);
  }

  @Get("ai-oversight")
  @RequirePermission(Permission.AnalyticsView)
  aiOversight(@Ctx() ctx: RequestContext, @Query(new ZodPipe(PeriodSchema)) q: { days: number }) {
    return this.dashboard.aiOversight(ctx, q.days);
  }
}
