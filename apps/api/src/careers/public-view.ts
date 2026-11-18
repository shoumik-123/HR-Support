import type { EmploymentType, JobStatus, WorkMode } from "../generated/prisma/enums";

/**
 * What the public careers portal is allowed to see.
 *
 * Everything the portal returns passes through this file, so the rule is one place
 * rather than spread across query selects: a visitor gets the advert, never the
 * hiring data. `hiringManagerIds`, `matchingCriteria`, `openings`, `createdById`
 * and the application pipeline are deliberately absent from these shapes.
 */

export interface PortalJobSource {
  id: string;
  title: string;
  description: string;
  responsibilities: string | null;
  location: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  status: JobStatus;
  publicApply: boolean;
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  educationRequirement: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryVisible: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  department: { id: string; name: string } | null;
}

export interface SalaryRange {
  min: number | null;
  max: number | null;
  currency: string;
}

/**
 * A job appears on the portal only while it is published, flagged for public apply
 * and not past its closing date. Everything else — drafts, closed, archived,
 * internal-only — is a 404 to the public, not a 403: the portal does not confirm
 * that a hidden job exists.
 */
export function isListable(job: Pick<PortalJobSource, "status" | "publicApply" | "expiresAt">, now: Date = new Date()): boolean {
  if (job.status !== "PUBLISHED") return false;
  if (!job.publicApply) return false;
  return job.expiresAt === null || job.expiresAt.getTime() > now.getTime();
}

/** Salary is shown only when the job says so; an unset range stays hidden either way. */
export function salaryRange(job: Pick<PortalJobSource, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryVisible">): SalaryRange | null {
  if (!job.salaryVisible) return null;
  if (job.salaryMin === null && job.salaryMax === null) return null;
  return { min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency };
}

/** Experience line for the listing, e.g. "3-5 years" or "5+ years". */
export function experienceLabel(job: Pick<PortalJobSource, "minExperienceYears" | "maxExperienceYears">): string | null {
  const { minExperienceYears: min, maxExperienceYears: max } = job;
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return min === max ? `${min} years` : `${min}-${max} years`;
  if (min !== null) return `${min}+ years`;
  return `Up to ${max} years`;
}

/**
 * First readable sentences of a description, with markdown punctuation removed, for
 * the listing card. Truncation lands on a word boundary so the text never breaks
 * mid-word.
 */
export function teaser(description: string, maxChars = 220): string {
  const flat = description
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Listing card: enough to decide whether to open the job, nothing more. */
export function jobCard(job: PortalJobSource) {
  return {
    id: job.id,
    title: job.title,
    department: job.department?.name ?? null,
    location: job.location,
    workMode: job.workMode,
    employmentType: job.employmentType,
    experience: experienceLabel(job),
    salary: salaryRange(job),
    requiredSkills: job.requiredSkills.slice(0, 8),
    teaser: teaser(job.description),
    postedAt: job.publishedAt ?? job.createdAt,
    closesAt: job.expiresAt,
  };
}

/** Full advert for the job page. */
export function jobDetail(job: PortalJobSource) {
  return {
    id: job.id,
    title: job.title,
    department: job.department?.name ?? null,
    location: job.location,
    workMode: job.workMode,
    employmentType: job.employmentType,
    experience: experienceLabel(job),
    salary: salaryRange(job),
    description: job.description,
    responsibilities: job.responsibilities,
    educationRequirement: job.educationRequirement,
    requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills,
    postedAt: job.publishedAt ?? job.createdAt,
    closesAt: job.expiresAt,
  };
}

/**
 * The code the candidate is shown after applying. It is derived from the application
 * id rather than stored, and is not a credential: quoting it proves nothing and it
 * opens nothing. Staff can find the application from it because the suffix is unique
 * within a job.
 */
export function applicationReference(applicationId: string): string {
  return `VT-${applicationId.slice(-8).toUpperCase()}`;
}
