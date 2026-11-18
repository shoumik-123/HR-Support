import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zId, zPagination, ZodPipe, zStringList } from "../common/validation";
import { TalentService } from "./talent.service";

const zYears = z.number().min(0).max(60).nullable().optional();

/** Criteria a recruiter corrected by hand, or a saved search being replayed. */
const CriteriaSchema = z.object({
  requiredSkills: zStringList(15).optional(),
  preferredSkills: zStringList(15).optional(),
  excludedSkills: zStringList(10).optional(),
  minExperienceYears: zYears,
  maxExperienceYears: zYears,
  locations: zStringList(6).optional(),
  titles: zStringList(4).optional(),
  keywords: zStringList(10).optional(),
  education: z.string().trim().max(80).nullable().optional(),
  tags: zStringList(10).optional(),
});

const SearchSchema = zPagination.extend({
  phrase: z.string().trim().max(500).default(""),
  /** When present the phrase is not re-read: these criteria are searched as given. */
  criteria: CriteriaSchema.optional(),
});

const SaveSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phrase: z.string().trim().max(500),
  criteria: CriteriaSchema,
});

const RunSavedSchema = zPagination;

/**
 * Talent-pool search: one sentence in, a ranked shortlist out, with the reason for every
 * position. Reading the sentence may use a model; the ranking never does.
 */
@Controller("talent")
export class TalentController {
  constructor(private readonly talent: TalentService) {}

  @Post("search")
  @HttpCode(200)
  @RequirePermission(Permission.CandidateView)
  // Each search reads up to a few hundred resumes, and the AI path costs tokens, so it is
  // limited per member - generously enough that refining a search never hits the wall.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SearchSchema)) body: z.infer<typeof SearchSchema>) {
    return this.talent.search(ctx, {
      phrase: body.phrase,
      page: body.page,
      pageSize: body.pageSize,
      criteria: body.criteria ? { ...body.criteria } as never : undefined,
    });
  }

  @Get("searches")
  @RequirePermission(Permission.CandidateView)
  listSaved(@Ctx() ctx: RequestContext) {
    return this.talent.listSaved(ctx);
  }

  @Post("searches")
  @HttpCode(200)
  @RequirePermission(Permission.CandidateView)
  save(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SaveSchema)) body: z.infer<typeof SaveSchema>) {
    return this.talent.save(ctx, { name: body.name, phrase: body.phrase, criteria: body.criteria as never });
  }

  @Post("searches/:id/run")
  @HttpCode(200)
  @RequirePermission(Permission.CandidateView)
  runSaved(@Ctx() ctx: RequestContext, @Param("id", new ZodPipe(zId)) id: string, @Body(new ZodPipe(RunSavedSchema)) body: z.infer<typeof RunSavedSchema>) {
    return this.talent.runSaved(ctx, id, body.page, body.pageSize);
  }

  @Delete("searches/:id")
  @RequirePermission(Permission.CandidateView)
  deleteSaved(@Ctx() ctx: RequestContext, @Param("id", new ZodPipe(zId)) id: string) {
    return this.talent.deleteSaved(ctx, id);
  }
}
