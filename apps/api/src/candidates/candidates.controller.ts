import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { zPagination, zStringList, ZodPipe } from "../common/validation";
import { CandidateSource, ConsentStatus } from "../generated/prisma/enums";
import { CandidatesService } from "./candidates.service";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);
const zUrl = z.string().trim().url().max(500).nullable();

const CandidateFields = {
  fullName: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().email().max(254).nullable(),
  phone: z.string().trim().max(40).nullable(),
  location: z.string().trim().max(160).nullable(),
  headline: z.string().trim().max(200).nullable(),
  summary: z.string().trim().max(4000).nullable(),
  linkedinUrl: zUrl,
  githubUrl: zUrl,
  portfolioUrl: zUrl,
  totalExperienceYears: z.number().min(0).max(60).nullable(),
  skills: zStringList(100),
  tags: zStringList(50),
  source: zEnum(CandidateSource),
  consentStatus: zEnum(ConsentStatus),
};
const CreateSchema = z.object(CandidateFields).partial().required({ fullName: true });
const UpdateSchema = z.object(CandidateFields).partial();

const csv = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string()).max(20));

const ListSchema = zPagination.extend({
  search: z.string().trim().max(120).optional(),
  skills: csv.optional(),
  tags: csv.optional(),
  minExperience: z.coerce.number().min(0).max(60).optional(),
  maxExperience: z.coerce.number().min(0).max(60).optional(),
  source: zEnum(CandidateSource).optional(),
  notInJobId: z.string().optional(),
});

const NoteSchema = z.object({ body: z.string().trim().min(1).max(5000), applicationId: z.string().optional() });

@Controller("candidates")
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get()
  @RequirePermission(Permission.CandidateView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.candidates.list(ctx, q);
  }

  @Post()
  @RequirePermission(Permission.CandidateManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>) {
    return this.candidates.create(ctx, body);
  }

  @Get("tags")
  @RequirePermission(Permission.CandidateView)
  tags(@Ctx() ctx: RequestContext) {
    return this.candidates.allTags(ctx);
  }

  @Get(":id")
  @RequirePermission(Permission.CandidateView)
  get(@Ctx() ctx: RequestContext, @Param("id") id: string, @Query("reveal") reveal?: string) {
    return this.candidates.get(ctx, id, reveal === "true");
  }

  @Patch(":id")
  @RequirePermission(Permission.CandidateManage)
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>) {
    return this.candidates.update(ctx, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission(Permission.CandidateDelete)
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.candidates.remove(ctx, id);
  }

  @Get(":id/export")
  @RequirePermission(Permission.CandidateView, Permission.CandidateContactView)
  export(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.candidates.export(ctx, id);
  }

  @Get(":id/timeline")
  @RequirePermission(Permission.CandidateView)
  timeline(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.candidates.timeline(ctx, id);
  }

  @Get(":id/notes")
  @RequirePermission(Permission.CandidateView)
  notes(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.candidates.notes(ctx, id);
  }

  @Post(":id/notes")
  @RequirePermission(Permission.NoteWrite)
  addNote(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(NoteSchema)) body: z.infer<typeof NoteSchema>) {
    return this.candidates.addNote(ctx, id, body.body, body.applicationId);
  }

  @Delete(":id/notes/:noteId")
  @HttpCode(204)
  @RequirePermission(Permission.NoteWrite)
  deleteNote(@Ctx() ctx: RequestContext, @Param("id") id: string, @Param("noteId") noteId: string) {
    return this.candidates.deleteNote(ctx, id, noteId);
  }
}
