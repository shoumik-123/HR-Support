import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, zStringList, ZodPipe } from "../common/validation";
import { EmploymentType, JobStatus, WorkMode } from "../generated/prisma/enums";
import { MatchingCriteriaSchema } from "../matching/criteria";
import { JobsService } from "./jobs.service";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);
const zYears = z.number().int().min(0).max(60).nullable();
const zMoney = z.number().int().min(0).max(1_000_000_000).nullable();

const JobFields = {
  title: z.string().trim().min(2).max(160),
  departmentId: z.string().nullable(),
  description: z.string().trim().min(1).max(20_000),
  responsibilities: z.string().trim().max(10_000).nullable(),
  location: z.string().trim().max(160).nullable(),
  workMode: zEnum(WorkMode),
  employmentType: zEnum(EmploymentType),
  requiredSkills: zStringList(50),
  preferredSkills: zStringList(50),
  minExperienceYears: zYears,
  maxExperienceYears: zYears,
  educationRequirement: z.string().trim().max(500).nullable(),
  salaryMin: zMoney,
  salaryMax: zMoney,
  salaryCurrency: z.string().trim().length(3).toUpperCase(),
  salaryVisible: z.boolean(),
  openings: z.number().int().min(1).max(10_000),
  publicApply: z.boolean(),
  matchingCriteria: MatchingCriteriaSchema,
  hiringManagerIds: z.array(z.string()).max(20),
  expiresAt: z.coerce.date().nullable(),
};

const CreateJobSchema = z
  .object(JobFields)
  .partial()
  .required({ title: true, description: true })
  .refine((j) => j.minExperienceYears == null || j.maxExperienceYears == null || j.minExperienceYears <= j.maxExperienceYears, {
    message: "Minimum experience exceeds maximum",
  })
  .refine((j) => j.salaryMin == null || j.salaryMax == null || j.salaryMin <= j.salaryMax, {
    message: "Minimum salary exceeds maximum",
  });
const UpdateJobSchema = z.object(JobFields).partial();

const ListSchema = zPagination.extend({
  status: zEnum(JobStatus).optional(),
  departmentId: z.string().optional(),
  search: z.string().trim().max(100).optional(),
});

const GenerateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  seniority: z.string().trim().max(60).optional(),
  department: z.string().trim().max(120).optional(),
  location: z.string().trim().max(160).optional(),
  skills: zStringList(30).optional(),
  context: z.string().trim().max(4000).optional(),
});

@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequirePermission(Permission.JobView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.jobs.list(ctx, q);
  }

  @Post()
  @RequirePermission(Permission.JobManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreateJobSchema)) body: z.infer<typeof CreateJobSchema>) {
    return this.jobs.create(ctx, body);
  }

  @Post("ai/generate-description")
  @HttpCode(200)
  @RequirePermission(Permission.JobManage, Permission.AiUse)
  generate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(GenerateSchema)) body: z.infer<typeof GenerateSchema>) {
    return this.jobs.generateDescription(ctx, body);
  }

  @Get(":id")
  @RequirePermission(Permission.JobView)
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.jobs.get(ctx, id);
  }

  @Patch(":id")
  @RequirePermission(Permission.JobManage)
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(UpdateJobSchema)) body: z.infer<typeof UpdateJobSchema>) {
    return this.jobs.update(ctx, id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission(Permission.JobPublish)
  publish(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.jobs.setStatus(ctx, id, "PUBLISHED");
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermission(Permission.JobPublish)
  close(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.jobs.setStatus(ctx, id, "CLOSED");
  }

  @Post(":id/unpublish")
  @HttpCode(200)
  @RequirePermission(Permission.JobPublish)
  unpublish(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.jobs.setStatus(ctx, id, "DRAFT");
  }

  @Post(":id/duplicate")
  @RequirePermission(Permission.JobManage)
  duplicate(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.jobs.duplicate(ctx, id);
  }

  @Delete(":id")
  @RequirePermission(Permission.JobManage)
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.jobs.remove(ctx, id);
  }
}
