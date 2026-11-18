import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { Ctx, RequestContext, RequirePermission } from "../common/context";
import { Permission } from "../common/permissions";
import { ZodPipe } from "../common/validation";
import { config } from "../config";
import { CandidateSource } from "../generated/prisma/enums";
import { ResumesService, UploadFile } from "./resumes.service";

const UploadSchema = z.object({
  jobId: z.string().optional(),
  source: z.enum(Object.values(CandidateSource) as [CandidateSource, ...CandidateSource[]]).optional(),
});

const MAX_FILES = 100;

@Controller("resumes")
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  @Post("upload")
  @RequirePermission(Permission.ResumeUpload)
  @UseInterceptors(
    FilesInterceptor("files", MAX_FILES, {
      // ZIP archives may hold many resumes, so the request limit is higher than per-file.
      limits: { fileSize: Math.max(config.maxUploadBytes, 200 * 1024 * 1024), files: MAX_FILES },
    }),
  )
  upload(
    @Ctx() ctx: RequestContext,
    @UploadedFiles() files: Express.Multer.File[] = [],
    @Body(new ZodPipe(UploadSchema)) body: z.infer<typeof UploadSchema>,
  ) {
    const uploads: UploadFile[] = files.map((f) => ({ originalname: f.originalname, buffer: f.buffer }));
    return this.resumes.upload(ctx, uploads, body);
  }

  @Get("batches/:id")
  @RequirePermission(Permission.ResumeUpload)
  batch(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.resumes.batchStatus(ctx, id);
  }

  @Get("capabilities")
  capabilities() {
    return { aiEnabled: this.resumes.aiAvailable(), maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024), maxFilesPerRequest: MAX_FILES };
  }

  @Get(":id")
  @RequirePermission(Permission.CandidateView)
  parsed(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.resumes.getParsed(ctx, id);
  }

  @Post(":id/retry")
  @HttpCode(200)
  @RequirePermission(Permission.ResumeUpload)
  retry(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.resumes.retry(ctx, id);
  }

  @Get(":id/file")
  @RequirePermission(Permission.CandidateView)
  async download(@Ctx() ctx: RequestContext, @Param("id") id: string, @Query("disposition") disposition: string | undefined, @Res() res: Response) {
    const { resume, data } = await this.resumes.download(ctx, id);
    const mode = disposition === "inline" ? "inline" : "attachment";
    res.setHeader("Content-Type", resume.mimeType);
    res.setHeader("Content-Security-Policy", "default-src 'none'; object-src 'none'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${mode}; filename*=UTF-8''${encodeURIComponent(resume.fileName)}`);
    res.send(data);
  }
}
