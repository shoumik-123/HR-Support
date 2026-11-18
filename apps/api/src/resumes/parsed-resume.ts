import { z } from "zod";

/**
 * Canonical structured resume. Produced by both the AI parser and the heuristic parser.
 * Every list item carries `evidence` (a verbatim snippet from the resume) and `confidence`
 * (0-1) so reviewers can verify each extracted claim against the source.
 */
const evidence = z.string().describe("Verbatim snippet copied from the resume that supports this item");
const confidence = z.number().describe("0.0-1.0 confidence that this item was extracted correctly");

export const ParsedResumeSchema = z.object({
  resumeLanguage: z.string().describe("Primary language the resume is written in, e.g. English, Bengali"),
  contact: z.object({
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    linkedinUrl: z.string().nullable(),
    githubUrl: z.string().nullable(),
    portfolioUrl: z.string().nullable(),
  }),
  headline: z.string().nullable().describe("Current or most recent professional title"),
  summary: z.string().nullable().describe("2-3 sentence neutral summary of qualifications, in English"),
  totalExperienceYears: z.number().nullable().describe("Total professional experience in years, computed from employment dates"),
  skills: z.array(z.object({ name: z.string(), category: z.string().nullable(), evidence, confidence })),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string().nullable(),
      startDate: z.string().nullable().describe("YYYY-MM or YYYY"),
      endDate: z.string().nullable().describe("YYYY-MM, YYYY, or null when current"),
      isCurrent: z.boolean(),
      description: z.string().nullable(),
      evidence,
      confidence,
    }),
  ),
  education: z.array(
    z.object({
      degree: z.string().nullable(),
      field: z.string().nullable(),
      institution: z.string().nullable(),
      endYear: z.string().nullable(),
      grade: z.string().nullable(),
      evidence,
      confidence,
    }),
  ),
  certifications: z.array(z.object({ name: z.string(), issuer: z.string().nullable(), year: z.string().nullable(), evidence, confidence })),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      technologies: z.array(z.string()),
      url: z.string().nullable(),
      evidence,
      confidence,
    }),
  ),
  languages: z.array(z.object({ name: z.string(), proficiency: z.string().nullable() })),
  missingFields: z.array(z.string()).describe("Important information absent from the resume, e.g. email, phone, dates of employment"),
  overallConfidence: z.number().describe("0.0-1.0 overall extraction confidence"),
});

export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

export function clamp01(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Normalise model output: clamp confidences and drop empty items. */
export function normalizeParsed(p: ParsedResume): ParsedResume {
  const fix = <T extends { confidence: number }>(items: T[]) => items.map((i) => ({ ...i, confidence: clamp01(i.confidence) }));
  return {
    ...p,
    skills: fix(p.skills.filter((s) => s.name.trim())),
    experience: fix(p.experience),
    education: fix(p.education),
    certifications: fix(p.certifications.filter((c) => c.name.trim())),
    projects: fix(p.projects.filter((x) => x.name.trim())),
    totalExperienceYears:
      p.totalExperienceYears == null ? null : Math.max(0, Math.min(60, Math.round(p.totalExperienceYears * 10) / 10)),
    overallConfidence: clamp01(p.overallConfidence),
  };
}
