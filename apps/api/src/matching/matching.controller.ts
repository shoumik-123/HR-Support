import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, ZodPipe } from "../common/validation";
import { MatchingService } from "./matching.service";

const RunSchema = z.object({ applicationIds: z.array(z.string()).min(1).max(500) });
const RunJobSchema = z.object({ rerunAll: z.boolean().default(false) });
const ReviewSchema = z
  .object({
    status: z.enum(["ACCEPTED", "ADJUSTED", "DISMISSED"]),
    adjustedScore: z.number().int().min(0).max(100).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.status !== "ADJUSTED" || v.adjustedScore != null, { message: "adjustedScore is required when adjusting" });
const RankingSchema = zPagination.extend({
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  stageId: z.string().optional(),
});
const CompareSchema = z.object({ applicationIds: z.array(z.string()).min(2).max(5) });

@Controller()
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Post("matches/run")
  @HttpCode(200)
  @RequirePermission(Permission.MatchRun)
  run(@Ctx() ctx: RequestContext, @Body(new ZodPipe(RunSchema)) body: z.infer<typeof RunSchema>) {
    return this.matching.queueMatches(ctx, body.applicationIds);
  }

  @Post("jobs/:jobId/matches/run")
  @HttpCode(200)
  @RequirePermission(Permission.MatchRun)
  runForJob(@Ctx() ctx: RequestContext, @Param("jobId") jobId: string, @Body(new ZodPipe(RunJobSchema)) body: z.infer<typeof RunJobSchema>) {
    return this.matching.queueForJob(ctx, jobId, body.rerunAll);
  }

  @Get("jobs/:jobId/ranking")
  @RequirePermission(Permission.CandidateView)
  ranking(@Ctx() ctx: RequestContext, @Param("jobId") jobId: string, @Query(new ZodPipe(RankingSchema)) q: z.infer<typeof RankingSchema>) {
    return this.matching.ranking(ctx, jobId, q);
  }

  @Post("jobs/:jobId/compare")
  @HttpCode(200)
  @RequirePermission(Permission.CandidateView)
  compare(@Ctx() ctx: RequestContext, @Param("jobId") jobId: string, @Body(new ZodPipe(CompareSchema)) body: z.infer<typeof CompareSchema>) {
    return this.matching.compare(ctx, jobId, body.applicationIds);
  }

  @Get("applications/:id/matches")
  @RequirePermission(Permission.CandidateView)
  history(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.matching.history(ctx, id);
  }

  @Post("matches/:id/review")
  @HttpCode(200)
  @RequirePermission(Permission.MatchReview)
  review(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(ReviewSchema)) body: z.infer<typeof ReviewSchema>) {
    return this.matching.review(ctx, id, body);
  }
}
