import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { z } from "zod";
import { Public } from "../common/context";
import { zPagination, ZodPipe } from "../common/validation";
import { config } from "../config";
import { EmploymentType, WorkMode } from "../generated/prisma/enums";
import { CareersService } from "./careers.service";

const zEnum = <T extends string>(o: Record<string, T>) => z.enum(Object.values(o) as [T, ...T[]]);

const ListSchema = zPagination.extend({
  search: z.string().trim().max(100).optional(),
  department: z.string().trim().max(120).optional(),
  location: z.string().trim().max(160).optional(),
  workMode: zEnum(WorkMode).optional(),
  employmentType: zEnum(EmploymentType).optional(),
});

/**
 * A URL the candidate types in is optional, but if it is there it must be a real
 * http(s) address — a bare word would otherwise be stored and later rendered as a link.
 */
const zPublicUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^https?:\/\/\S+\.\S+/.test(v), { message: "Enter a full address starting with http:// or https://" })
  .optional();

/**
 * Multipart form fields arrive as strings, so booleans and blanks are coerced here
 * rather than in the service.
 */
const zOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined)
    .optional();

const ApplySchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  phone: zOptionalText(40),
  location: zOptionalText(160),
  headline: zOptionalText(160),
  linkedinUrl: zPublicUrl,
  portfolioUrl: zPublicUrl,
  coverLetter: zOptionalText(5000),
  consent: z
    .union([z.boolean(), z.enum(["true", "false", "on", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "on" || v === "1"),
});

/**
 * The public careers portal: a job board and an apply form, with no account and no
 * sign-in. Reads are throttled generously because browsing is cheap; applying is
 * throttled hard and additionally capped per email address inside the service, since
 * behind the web app's proxy every visitor shares one source address.
 */
@Controller("public/careers")
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PublicCareersController {
  constructor(private readonly careers: CareersService) {}

  @Public()
  @Get(":slug")
  board(@Param("slug") slug: string, @Query(new ZodPipe(ListSchema)) q: z.infer<typeof ListSchema>) {
    return this.careers.board(slug, q);
  }

  @Public()
  @Get(":slug/jobs/:jobId")
  job(@Param("slug") slug: string, @Param("jobId") jobId: string) {
    return this.careers.job(slug, jobId);
  }

  @Public()
  @Post(":slug/jobs/:jobId/apply")
  // Deliberately loose. Anonymous traffic is counted per source address, and behind an
  // office NAT or a university that is everyone at once, so a tight limit here would
  // lock out real applicants without stopping a determined flood. The guards that do
  // the precise work are the per-email cap and the unique (job, candidate) constraint
  // in CareersService; this one only blunts a naive script.
  @Throttle({ default: { limit: 60, ttl: 10 * 60_000 } })
  @UseInterceptors(FileInterceptor("resume", { limits: { fileSize: config.maxUploadBytes, files: 1 } }))
  apply(
    @Param("slug") slug: string,
    @Param("jobId") jobId: string,
    @UploadedFile() resume: Express.Multer.File | undefined,
    @Body() raw: unknown,
    @Req() req: Request,
  ) {
    const parsed = ApplySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const file = resume ? { originalname: resume.originalname, buffer: resume.buffer } : undefined;
    return this.careers.apply(slug, jobId, parsed.data, file, req.ip);
  }
}
