import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { CommunicationsService } from "../communications/communications.service";
import { RequestContext } from "../common/context";
import { sha256 } from "../common/crypto";
import { config } from "../config";
import { AiRequestError, AiUnavailableError } from "../ai/ai.service";
import { Prisma } from "../generated/prisma/client";
import { CandidateSource } from "../generated/prisma/enums";
import { PermanentJobError, QueueService } from "../queue/queue.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { detectResumeKind, expandZip, isZip, MIME_BY_KIND, ResumeKind } from "./file-types";
import { normalizePhone } from "./heuristic-parser";
import { MalwareScanner } from "./malware-scanner";
import { ParsedResume } from "./parsed-resume";
import { ResumeParserService } from "./resume-parser.service";
import { canonicalSkill } from "./skills";
import { extractText } from "./text-extraction";

export const PARSE_RESUME_JOB = "resume.parse";

export interface UploadFile {
  originalname: string;
  buffer: Buffer;
}

export interface UploadOptions {
  jobId?: string;
  source?: CandidateSource;
}

const ZIP_LIMITS = { maxEntries: 500, maxEntryBytes: 15 * 1024 * 1024, maxTotalBytes: 500 * 1024 * 1024 };

@Injectable()
export class ResumesService implements OnModuleInit {
  private readonly logger = new Logger("Resumes");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly parser: ResumeParserService,
    private readonly scanner: MalwareScanner,
    private readonly activity: ActivityService,
    private readonly comms: CommunicationsService,
  ) {}

  onModuleInit() {
    this.queue.register(PARSE_RESUME_JOB, async (payload: { resumeId: string }) => {
      await this.processResume(payload.resumeId);
    });
    this.queue.register(`${PARSE_RESUME_JOB}:failed`, async (payload: { resumeId: string }, job) => {
      await this.prisma.resume.update({
        where: { id: payload.resumeId },
        data: { status: "FAILED", error: job.lastError?.slice(0, 1000) ?? "Processing failed" },
      });
    });
  }

  /**
   * Accepts resumes and ZIP archives. Files are type-checked by magic bytes, virus-scanned,
   * stored, then parsed in the background so large batches never block the request.
   */
  async upload(ctx: RequestContext, files: UploadFile[], opts: UploadOptions) {
    if (!files.length) throw new BadRequestException("No files were uploaded");
    if (opts.jobId) {
      const job = await this.prisma.job.findFirst({ where: { id: opts.jobId, organizationId: ctx.orgId } });
      if (!job) throw new BadRequestException("Unknown job");
    }

    const expanded: UploadFile[] = [];
    const rejected: { fileName: string; reason: string }[] = [];
    for (const file of files) {
      if (isZip(file.buffer) && !detectResumeKind(file.buffer)) {
        try {
          expanded.push(...expandZip(file.buffer, ZIP_LIMITS).map((e) => ({ originalname: e.name, buffer: e.data })));
        } catch (err) {
          rejected.push({ fileName: file.originalname, reason: err instanceof Error ? err.message : "Could not read archive" });
        }
      } else {
        expanded.push(file);
      }
    }
    if (!expanded.length && rejected.length) throw new BadRequestException(rejected[0].reason);

    const batch = await this.prisma.uploadBatch.create({
      data: { organizationId: ctx.orgId, jobId: opts.jobId, total: expanded.length, createdById: ctx.userId },
    });

    const accepted: { id: string; fileName: string; duplicateOf?: string }[] = [];
    for (const file of expanded) {
      try {
        accepted.push(await this.acceptOne(ctx, file, batch.id, opts));
      } catch (err) {
        rejected.push({ fileName: file.originalname, reason: err instanceof Error ? err.message : "Upload failed" });
      }
    }

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "resume.uploaded", entityType: "uploadBatch", entityId: batch.id,
      jobId: opts.jobId, data: { accepted: accepted.length, rejected: rejected.length }, ip: ctx.ip,
    });
    return { batchId: batch.id, accepted, rejected };
  }

  private async acceptOne(ctx: RequestContext, file: UploadFile, batchId: string, opts: UploadOptions) {
    if (file.buffer.length > config.maxUploadBytes) {
      throw new Error(`File exceeds the ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB limit`);
    }
    const kind = detectResumeKind(file.buffer);
    if (!kind) throw new Error("Unsupported file type - upload a PDF, DOC or DOCX resume");

    const scan = await this.scanner.scan(file.buffer);
    if (!scan.clean) throw new Error(scan.reason);

    const hash = sha256(file.buffer);
    const existing = await this.prisma.resume.findFirst({
      where: { organizationId: ctx.orgId, sha256: hash },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      // Identical file already on record: don't store or re-parse it.
      if (existing.candidateId && opts.jobId) await this.linkToJob(ctx, existing.candidateId, opts.jobId, opts.source);
      return { id: existing.id, fileName: file.originalname, duplicateOf: existing.candidateId ?? existing.id };
    }

    const storageKey = await this.storage.put(ctx.orgId, file.originalname, file.buffer);
    const resume = await this.prisma.resume.create({
      data: {
        organizationId: ctx.orgId,
        batchId,
        fileName: file.originalname.slice(0, 255),
        mimeType: MIME_BY_KIND[kind],
        sizeBytes: file.buffer.length,
        storageKey,
        sha256: hash,
        uploadedById: ctx.userId,
      },
    });
    await this.queue.enqueue(
      PARSE_RESUME_JOB,
      { resumeId: resume.id, jobId: opts.jobId ?? null, source: opts.source ?? "UPLOAD", actorId: ctx.userId },
      { orgId: ctx.orgId, idempotencyKey: `parse:${resume.id}` },
    );
    return { id: resume.id, fileName: resume.fileName };
  }

  /** Background: extract text, parse, create/merge the candidate, optionally add to a job. */
  async processResume(resumeId: string) {
    const resume = await this.prisma.resume.findUnique({ where: { id: resumeId }, include: { batch: true } });
    if (!resume) throw new PermanentJobError(`Resume ${resumeId} no longer exists`);
    if (resume.status === "PARSED") return;

    await this.prisma.resume.update({ where: { id: resumeId }, data: { status: "PROCESSING", error: null } });

    const file = await this.storage.get(resume.storageKey);
    const kind = detectResumeKind(file);
    if (!kind) throw new PermanentJobError("Stored file is not a supported resume type");

    const extracted = await extractText(kind, file);
    if (!extracted.text.trim() && !(extracted.needsOcr && kind === "pdf")) {
      throw new PermanentJobError("No readable text could be extracted from this document");
    }

    let outcome;
    if (this.parser.aiEnabled) {
      try {
        outcome = await this.parser.parseWithAi(resume.organizationId, kind, file, extracted);
      } catch (err) {
        if (err instanceof AiRequestError && err.retryable) throw err; // queue retries with backoff
        this.logger.warn(`AI parse unavailable for ${resumeId}, falling back to heuristics: ${err instanceof Error ? err.message : err}`);
        outcome = this.parser.parseHeuristic(extracted);
      }
    } else {
      if (extracted.needsOcr) throw new PermanentJobError("This document appears to be scanned; OCR requires AI to be configured");
      outcome = this.parser.parseHeuristic(extracted);
    }

    // A resume that already names its owner keeps it: the careers portal creates the
    // candidate from what the applicant typed, which outranks whatever the parse
    // reads off the document.
    const candidateId = await this.upsertCandidate(resume.organizationId, outcome.parsed, resume.uploadedById, resume.candidateId);
    const priorVersions = await this.prisma.resume.count({ where: { candidateId, id: { not: resumeId } } });

    await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        candidateId,
        status: "PARSED",
        version: priorVersions + 1,
        rawText: extracted.text.slice(0, 500_000),
        parsed: outcome.parsed as unknown as Prisma.InputJsonValue,
        parseMethod: outcome.method,
        model: outcome.model,
        promptVersion: outcome.promptVersion,
        overallConfidence: outcome.parsed.overallConfidence,
        processedAt: new Date(),
      },
    });

    await this.activity.log({
      orgId: resume.organizationId,
      actorId: resume.uploadedById,
      action: "resume.parsed",
      entityType: "resume",
      entityId: resumeId,
      candidateId,
      data: { method: outcome.method, model: outcome.model, promptVersion: outcome.promptVersion, confidence: outcome.parsed.overallConfidence },
    });

    if (resume.batch?.jobId) {
      await this.linkToJobInternal(resume.organizationId, candidateId, resume.batch.jobId, "UPLOAD", resume.uploadedById);
    }
  }

  /**
   * Create the candidate, or merge into an existing one matched by email or phone.
   * Merging keeps the richer value for each field rather than overwriting blindly.
   */
  private async upsertCandidate(orgId: string, parsed: ParsedResume, actorId: string | null, pinnedCandidateId?: string | null): Promise<string> {
    const email = parsed.contact.email?.toLowerCase().trim() || null;
    const phoneKey = normalizePhone(parsed.contact.phone);

    const existing = pinnedCandidateId
      ? await this.prisma.candidate.findFirst({ where: { id: pinnedCandidateId, organizationId: orgId, deletedAt: null } })
      : await this.prisma.candidate.findFirst({
          where: {
            organizationId: orgId,
            deletedAt: null,
            OR: [...(email ? [{ email }] : []), ...(phoneKey ? [{ phone: { contains: phoneKey } }] : [])],
          },
          orderBy: { createdAt: "asc" },
        });

    const skills = [...new Set(parsed.skills.map((s) => canonicalSkill(s.name)))];
    const profile = {
      experience: parsed.experience,
      education: parsed.education,
      certifications: parsed.certifications,
      projects: parsed.projects,
      skillDetails: parsed.skills,
      resumeLanguage: parsed.resumeLanguage,
    } as unknown as Prisma.InputJsonValue;

    if (existing) {
      const keepLonger = (a: string | null, b: string | null | undefined) => (b && b.length > (a?.length ?? 0) ? b : a);
      await this.prisma.candidate.update({
        where: { id: existing.id },
        data: {
          // A pinned candidate typed their own name on the apply form, so the parse
          // never overrules it; otherwise the fuller of the two names wins.
          fullName:
            !pinnedCandidateId && parsed.contact.fullName && parsed.contact.fullName.length > existing.fullName.length
              ? parsed.contact.fullName
              : existing.fullName,
          email: existing.email ?? email,
          phone: existing.phone ?? parsed.contact.phone,
          location: existing.location ?? parsed.contact.location,
          headline: keepLonger(existing.headline, parsed.headline),
          summary: keepLonger(existing.summary, parsed.summary),
          linkedinUrl: existing.linkedinUrl ?? parsed.contact.linkedinUrl,
          githubUrl: existing.githubUrl ?? parsed.contact.githubUrl,
          portfolioUrl: existing.portfolioUrl ?? parsed.contact.portfolioUrl,
          totalExperienceYears: Math.max(existing.totalExperienceYears ?? 0, parsed.totalExperienceYears ?? 0) || null,
          skills: [...new Set([...existing.skills, ...skills])],
          languages: [...new Set([...existing.languages, ...parsed.languages.map((l) => l.name)])],
          profile,
          missingFields: parsed.missingFields,
        },
      });
      await this.activity.log({
        orgId, actorId, action: "candidate.resume_added", entityType: "candidate", entityId: existing.id, candidateId: existing.id,
      });
      return existing.id;
    }

    const candidate = await this.prisma.candidate.create({
      data: {
        organizationId: orgId,
        fullName: parsed.contact.fullName?.trim() || "Unnamed candidate",
        email,
        phone: parsed.contact.phone,
        location: parsed.contact.location,
        headline: parsed.headline,
        summary: parsed.summary,
        linkedinUrl: parsed.contact.linkedinUrl,
        githubUrl: parsed.contact.githubUrl,
        portfolioUrl: parsed.contact.portfolioUrl,
        totalExperienceYears: parsed.totalExperienceYears,
        skills,
        languages: parsed.languages.map((l) => l.name),
        profile,
        missingFields: parsed.missingFields,
        source: "UPLOAD",
        createdById: actorId,
      },
    });
    await this.activity.log({
      orgId, actorId, action: "candidate.created", entityType: "candidate", entityId: candidate.id, candidateId: candidate.id, data: { via: "resume" },
    });
    return candidate.id;
  }

  private linkToJob(ctx: RequestContext, candidateId: string, jobId: string, source?: CandidateSource) {
    return this.linkToJobInternal(ctx.orgId, candidateId, jobId, source ?? "UPLOAD", ctx.userId);
  }

  private async linkToJobInternal(orgId: string, candidateId: string, jobId: string, source: CandidateSource, actorId: string | null) {
    const existing = await this.prisma.application.findUnique({ where: { jobId_candidateId: { jobId, candidateId } } });
    if (existing) return existing.id;

    const applied = await this.prisma.pipelineStage.findFirst({ where: { organizationId: orgId, kind: "APPLIED" }, orderBy: { position: "asc" } });
    if (!applied) throw new Error("Organization has no Applied stage configured");
    const priorApplications = await this.prisma.application.count({ where: { organizationId: orgId, candidateId } });

    const application = await this.prisma.application.create({
      data: { organizationId: orgId, jobId, candidateId, stageId: applied.id, source, isReapplication: priorApplications > 0 },
    });
    await this.activity.log({
      orgId, actorId, action: "application.created", entityType: "application", entityId: application.id,
      candidateId, jobId, applicationId: application.id, data: { isReapplication: application.isReapplication },
    });
    return application.id;
  }

  // ── Queries ──

  async batchStatus(ctx: RequestContext, batchId: string) {
    const batch = await this.prisma.uploadBatch.findFirst({ where: { id: batchId, organizationId: ctx.orgId } });
    if (!batch) throw new NotFoundException("Upload batch not found");
    const resumes = await this.prisma.resume.findMany({
      where: { batchId },
      select: { id: true, fileName: true, status: true, error: true, candidateId: true, overallConfidence: true, parseMethod: true },
    });
    const counts = resumes.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    return {
      batchId,
      total: batch.total,
      jobId: batch.jobId,
      counts,
      done: resumes.every((r) => r.status === "PARSED" || r.status === "FAILED"),
      resumes,
    };
  }

  async download(ctx: RequestContext, resumeId: string) {
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, organizationId: ctx.orgId } });
    if (!resume) throw new NotFoundException("Resume not found");
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "resume.downloaded", entityType: "resume", entityId: resumeId,
      candidateId: resume.candidateId, ip: ctx.ip,
    });
    return { resume, data: await this.storage.get(resume.storageKey) };
  }

  async getParsed(ctx: RequestContext, resumeId: string) {
    const resume = await this.prisma.resume.findFirst({
      where: { id: resumeId, organizationId: ctx.orgId },
      select: {
        id: true, fileName: true, status: true, parsed: true, parseMethod: true, model: true, promptVersion: true,
        overallConfidence: true, error: true, rawText: true, candidateId: true, createdAt: true, processedAt: true,
      },
    });
    if (!resume) throw new NotFoundException("Resume not found");
    return resume;
  }

  async retry(ctx: RequestContext, resumeId: string) {
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, organizationId: ctx.orgId } });
    if (!resume) throw new NotFoundException("Resume not found");
    if (resume.status === "PROCESSING") throw new BadRequestException("This resume is already being processed");
    await this.prisma.resume.update({ where: { id: resumeId }, data: { status: "UPLOADED", error: null } });
    await this.queue.enqueue(PARSE_RESUME_JOB, { resumeId }, { orgId: ctx.orgId, idempotencyKey: `parse:${resumeId}:retry:${Date.now()}` });
    return { queued: true };
  }

  aiAvailable(): boolean {
    return this.parser.aiEnabled;
  }
}

export { AiUnavailableError };
