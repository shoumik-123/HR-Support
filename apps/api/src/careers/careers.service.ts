import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { sha256 } from "../common/crypto";
import { CommunicationsService } from "../communications/communications.service";
import { config } from "../config";
import { Prisma } from "../generated/prisma/client";
import type { EmploymentType, WorkMode } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { normalizePhone } from "../resumes/heuristic-parser";
import { detectResumeKind, MIME_BY_KIND } from "../resumes/file-types";
import { MalwareScanner } from "../resumes/malware-scanner";
import { PARSE_RESUME_JOB } from "../resumes/resumes.service";
import { StorageService } from "../storage/storage.service";
import { applicationReference, isListable, jobCard, jobDetail, type PortalJobSource } from "./public-view";

/**
 * Public careers portal.
 *
 * This is the one place in the API where the tenant is resolved from the request
 * rather than from a membership: an unauthenticated visitor identifies the employer
 * by the organization's public slug. That is only safe because every read here is
 * filtered to published, public-apply jobs and shaped by `public-view.ts`, and the
 * only write is an application the visitor is making about themselves. No endpoint
 * in this module accepts an organization id, a candidate id, or a pipeline stage.
 */

export interface PortalListQuery {
  page: number;
  pageSize: number;
  search?: string;
  department?: string;
  location?: string;
  workMode?: WorkMode;
  employmentType?: EmploymentType;
}

export interface ApplyInput {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  headline?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  coverLetter?: string;
  consent: boolean;
}

/** The apply form after normalization: email lowercased, phone resolved to a value or null. */
type ApplicantDetails = Omit<ApplyInput, "email" | "phone"> & { email: string; phone: string | null };

export interface ApplyFile {
  originalname: string;
  buffer: Buffer;
}

const JOB_SELECT = {
  id: true,
  title: true,
  description: true,
  responsibilities: true,
  location: true,
  workMode: true,
  employmentType: true,
  status: true,
  publicApply: true,
  requiredSkills: true,
  preferredSkills: true,
  minExperienceYears: true,
  maxExperienceYears: true,
  educationRequirement: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryVisible: true,
  publishedAt: true,
  expiresAt: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.JobSelect;

/**
 * How many applications one email address may submit to one employer per hour.
 *
 * Address-based throttling is weak here on purpose: the web app proxies every call,
 * so all portal visitors share one source address, and the same is true behind any
 * load balancer. The guards that actually hold are this per-email cap and the unique
 * (job, candidate) constraint, neither of which depends on the network path.
 */
const APPLY_PER_EMAIL_PER_HOUR = 5;

@Injectable()
export class CareersService {
  private readonly logger = new Logger("Careers");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly scanner: MalwareScanner,
    private readonly activity: ActivityService,
    private readonly comms: CommunicationsService,
  ) {}

  /** Employer header plus the filtered, paginated job list. */
  async board(slug: string, q: PortalListQuery) {
    const org = await this.org(slug);
    const now = new Date();
    const openJobs: Prisma.JobWhereInput = {
      organizationId: org.id,
      status: "PUBLISHED",
      publicApply: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };

    const where: Prisma.JobWhereInput = {
      ...openJobs,
      ...(q.department ? { department: { name: q.department } } : {}),
      ...(q.location ? { location: { contains: q.location, mode: "insensitive" } } : {}),
      ...(q.workMode ? { workMode: q.workMode } : {}),
      ...(q.employmentType ? { employmentType: q.employmentType } : {}),
      ...(q.search
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: q.search, mode: "insensitive" } },
                  { description: { contains: q.search, mode: "insensitive" } },
                  { requiredSkills: { has: q.search } },
                ],
              },
            ],
          }
        : {}),
    };

    const [rows, total, open] = await Promise.all([
      this.prisma.job.findMany({
        where,
        select: JOB_SELECT,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where: openJobs,
        select: { location: true, workMode: true, employmentType: true, department: { select: { name: true } } },
      }),
    ]);

    const unique = <T>(values: (T | null | undefined)[]) => [...new Set(values.filter((v): v is T => v != null))].sort();
    return {
      organization: this.header(org),
      filters: {
        departments: unique(open.map((j) => j.department?.name)),
        locations: unique(open.map((j) => j.location)),
        workModes: unique(open.map((j) => j.workMode)),
        employmentTypes: unique(open.map((j) => j.employmentType)),
      },
      items: rows.map((j) => jobCard(j as PortalJobSource)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** One advert. A job that is not open to the public is a 404, not a 403. */
  async job(slug: string, jobId: string) {
    const org = await this.org(slug);
    const job = await this.prisma.job.findFirst({ where: { id: jobId, organizationId: org.id }, select: JOB_SELECT });
    if (!job || !isListable(job)) throw new NotFoundException("This vacancy is no longer open");
    return { organization: this.header(org), job: jobDetail(job as PortalJobSource) };
  }

  /**
   * A candidate applying to a job themselves. The resume is stored and queued for
   * parsing exactly like a recruiter upload, but the identity fields come from the
   * form rather than from the model, because the person filling it in is the
   * authority on their own name and contact details.
   */
  async apply(slug: string, jobId: string, input: ApplyInput, file: ApplyFile | undefined, ip?: string) {
    const org = await this.org(slug);
    const job = await this.prisma.job.findFirst({ where: { id: jobId, organizationId: org.id }, select: JOB_SELECT });
    if (!job || !isListable(job)) throw new NotFoundException("This vacancy is no longer open");
    if (!input.consent) throw new BadRequestException("Please confirm you agree to your details being stored");
    if (!file) throw new BadRequestException("Attach your resume as a PDF, DOC or DOCX file");

    const email = input.email.toLowerCase().trim();
    await this.assertUnderEmailCap(org.id, email);

    const kind = detectResumeKind(file.buffer);
    if (!kind) throw new BadRequestException("Unsupported file type - upload a PDF, DOC or DOCX resume");
    if (file.buffer.length > config.maxUploadBytes) {
      throw new BadRequestException(`Your file exceeds the ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB limit`);
    }
    const scan = await this.scanner.scan(file.buffer);
    if (!scan.clean) throw new BadRequestException(scan.reason);

    const phone = input.phone?.trim() || null;
    const phoneKey = normalizePhone(phone);
    const existing = await this.prisma.candidate.findFirst({
      where: {
        organizationId: org.id,
        deletedAt: null,
        OR: [{ email }, ...(phoneKey ? [{ phone: { contains: phoneKey } }] : [])],
      },
      orderBy: { createdAt: "asc" },
    });

    if (existing) {
      const already = await this.prisma.application.findUnique({ where: { jobId_candidateId: { jobId, candidateId: existing.id } } });
      if (already) {
        throw new BadRequestException("You have already applied for this role. The team will be in touch about that application.");
      }
    }

    const candidateId = existing
      ? await this.mergeCandidate(existing, { ...input, email, phone })
      : await this.createCandidate(org.id, { ...input, email, phone });

    const applied = await this.prisma.pipelineStage.findFirst({ where: { organizationId: org.id, kind: "APPLIED" }, orderBy: { position: "asc" } });
    if (!applied) throw new BadRequestException("This employer is not accepting applications right now");

    const storageKey = await this.storage.put(org.id, file.originalname, file.buffer);
    const resume = await this.prisma.resume.create({
      data: {
        organizationId: org.id,
        candidateId,
        fileName: file.originalname.slice(0, 255),
        mimeType: MIME_BY_KIND[kind],
        sizeBytes: file.buffer.length,
        storageKey,
        sha256: sha256(file.buffer),
        uploadedById: null,
      },
    });

    const priorApplications = await this.prisma.application.count({ where: { organizationId: org.id, candidateId } });
    const application = await this.prisma.application.create({
      data: {
        organizationId: org.id,
        jobId,
        candidateId,
        stageId: applied.id,
        source: "CAREER_PORTAL",
        isReapplication: priorApplications > 0,
        coverLetter: input.coverLetter?.trim() || null,
      },
    });

    // The resume is parsed in the background. Because the Resume row already carries a
    // candidateId, the parse enriches that candidate instead of matching afresh.
    await this.queue.enqueue(PARSE_RESUME_JOB, { resumeId: resume.id }, { orgId: org.id, idempotencyKey: `parse:${resume.id}` });

    await this.activity.log({
      orgId: org.id,
      actorId: null,
      action: "application.created",
      entityType: "application",
      entityId: application.id,
      candidateId,
      jobId,
      applicationId: application.id,
      data: { via: "careers_portal", isReapplication: application.isReapplication, reference: applicationReference(application.id) },
      ip,
    });

    await this.acknowledge(org.id, application.id, candidateId);

    return {
      reference: applicationReference(application.id),
      jobTitle: job.title,
      organizationName: org.name,
      candidateName: input.fullName.trim(),
      email,
      isReapplication: application.isReapplication,
      submittedAt: application.createdAt,
    };
  }

  // ── Internals ──

  /** Resolves the public slug. A portal that is switched off does not exist publicly. */
  private async org(slug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        brandColor: true,
        website: true,
        industry: true,
        country: true,
        careersEnabled: true,
        careersIntro: true,
      },
    });
    if (!org || !org.careersEnabled) throw new NotFoundException("No careers page is published at this address");
    return org;
  }

  /** Employer fields a visitor may see. Everything else about the org stays private. */
  private header(org: Awaited<ReturnType<CareersService["org"]>>) {
    return {
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      brandColor: org.brandColor,
      website: org.website,
      industry: org.industry,
      country: org.country,
      intro: org.careersIntro,
    };
  }

  private async assertUnderEmailCap(orgId: string, email: string) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.application.count({
      where: { organizationId: orgId, source: "CAREER_PORTAL", createdAt: { gte: since }, candidate: { email } },
    });
    if (recent >= APPLY_PER_EMAIL_PER_HOUR) {
      throw new HttpException("You have sent several applications in the last hour. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async createCandidate(orgId: string, input: ApplicantDetails) {
    const candidate = await this.prisma.candidate.create({
      data: {
        organizationId: orgId,
        fullName: input.fullName.trim(),
        email: input.email,
        phone: input.phone,
        location: input.location?.trim() || null,
        headline: input.headline?.trim() || null,
        linkedinUrl: input.linkedinUrl?.trim() || null,
        portfolioUrl: input.portfolioUrl?.trim() || null,
        source: "CAREER_PORTAL",
        // The applicant ticked the consent box on the form; that is a deliberate grant,
        // not an assumption, so it is recorded with its timestamp.
        consentStatus: "GRANTED",
        consentUpdatedAt: new Date(),
        createdById: null,
      },
    });
    await this.activity.log({
      orgId,
      actorId: null,
      action: "candidate.created",
      entityType: "candidate",
      entityId: candidate.id,
      candidateId: candidate.id,
      data: { via: "careers_portal" },
    });
    return candidate.id;
  }

  /**
   * A returning applicant. The form fills gaps and refreshes contact details, but it
   * never deletes what the organization already holds, and it never touches the parsed
   * resume profile — the background parse owns that.
   */
  private async mergeCandidate(
    existing: {
      id: string;
      organizationId: string;
      fullName: string;
      email: string | null;
      phone: string | null;
      location: string | null;
      headline: string | null;
      linkedinUrl: string | null;
      portfolioUrl: string | null;
    },
    input: ApplicantDetails,
  ) {
    await this.prisma.candidate.update({
      where: { id: existing.id },
      data: {
        fullName: input.fullName.trim() || existing.fullName,
        email: existing.email ?? input.email,
        phone: input.phone ?? existing.phone,
        location: input.location?.trim() || existing.location,
        headline: input.headline?.trim() || existing.headline,
        linkedinUrl: input.linkedinUrl?.trim() || existing.linkedinUrl,
        portfolioUrl: input.portfolioUrl?.trim() || existing.portfolioUrl,
        consentStatus: "GRANTED",
        consentUpdatedAt: new Date(),
      },
    });
    await this.activity.log({
      orgId: existing.organizationId,
      actorId: null,
      action: "candidate.reapplied",
      entityType: "candidate",
      entityId: existing.id,
      candidateId: existing.id,
      data: { via: "careers_portal" },
    });
    return existing.id;
  }

  /**
   * Someone who applies through a public form has no other confirmation that it
   * arrived, so the acknowledgement is not optional here. If the organization has
   * turned the APPLICATION_CREATED automation on, that is what goes out; otherwise the
   * stock "application received" template is sent once. Either way, failing to email
   * never undoes the application.
   */
  private async acknowledge(orgId: string, applicationId: string, candidateId: string) {
    try {
      const automated = await this.comms.fire("APPLICATION_CREATED", { orgId, applicationId, candidateId });
      if (automated) return;
      await this.comms.queueSend({
        orgId,
        templateKey: "APPLICATION_RECEIVED",
        trigger: "APPLICATION_CREATED",
        applicationId,
        candidateId,
        automated: true,
        sentById: null,
      });
    } catch (err) {
      this.logger.error(`Could not acknowledge application ${applicationId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
