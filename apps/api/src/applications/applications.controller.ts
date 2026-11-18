import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, ZodPipe } from "../common/validation";
import { ApplicationStatus, CandidateSource } from "../generated/prisma/enums";
import { ApplicationsService } from "./applications.service";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);

const BoardSchema = z.object({
  jobId: z.string().min(1),
  perStage: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(120).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
});
const ListSchema = zPagination.extend({
  jobId: z.string().optional(),
  stageId: z.string().optional(),
  candidateId: z.string().optional(),
  status: zEnum(ApplicationStatus).optional(),
});
const CreateSchema = z.object({ jobId: z.string().min(1), candidateId: z.string().min(1), source: zEnum(CandidateSource).optional() });
const MoveSchema = z.object({ stageId: z.string().min(1) });
const RejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const BulkSchema = z.object({
  applicationIds: z.array(z.string()).min(1).max(200),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("move"), stageId: z.string().min(1) }),
    z.object({ type: z.literal("reject"), reason: z.string().trim().min(3).max(500) }),
  ]),
});

@Controller("applications")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get("board")
  @RequirePermission(Permission.CandidateView)
  board(@Ctx() ctx: RequestContext, @Query(new ZodPipe(BoardSchema)) q: z.infer<typeof BoardSchema>) {
    return this.applications.board(ctx, q);
  }

  @Get()
  @RequirePermission(Permission.CandidateView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.applications.list(ctx, q);
  }

  @Post()
  @RequirePermission(Permission.CandidateManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>) {
    return this.applications.create(ctx, body.jobId, body.candidateId, body.source);
  }

  @Post("bulk")
  @HttpCode(200)
  @RequirePermission(Permission.PipelineMove)
  bulk(@Ctx() ctx: RequestContext, @Body(new ZodPipe(BulkSchema)) body: z.infer<typeof BulkSchema>) {
    return this.applications.bulk(ctx, body.applicationIds, body.action);
  }

  @Get(":id")
  @RequirePermission(Permission.CandidateView)
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.applications.get(ctx, id);
  }

  @Post(":id/move")
  @HttpCode(200)
  @RequirePermission(Permission.PipelineMove)
  move(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(MoveSchema)) body: z.infer<typeof MoveSchema>) {
    return this.applications.move(ctx, id, body.stageId);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermission(Permission.PipelineReject)
  reject(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(RejectSchema)) body: z.infer<typeof RejectSchema>) {
    return this.applications.reject(ctx, id, body.reason);
  }
}
