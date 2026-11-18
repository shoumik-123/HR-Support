import { z } from "zod";

/** Per-job weights for candidate matching. Weights are percentages and must sum to 100. */
export const MatchingCriteriaSchema = z
  .object({
    skills: z.number().int().min(0).max(100),
    experience: z.number().int().min(0).max(100),
    education: z.number().int().min(0).max(100),
    projects: z.number().int().min(0).max(100),
    certifications: z.number().int().min(0).max(100),
  })
  .refine((c) => c.skills + c.experience + c.education + c.projects + c.certifications === 100, {
    message: "Matching weights must add up to 100",
  });

export type MatchingCriteria = z.infer<typeof MatchingCriteriaSchema>;
export type Criterion = keyof MatchingCriteria;

export const DEFAULT_CRITERIA: MatchingCriteria = {
  skills: 45,
  experience: 25,
  education: 10,
  projects: 10,
  certifications: 10,
};

export function criteriaFor(stored: unknown): MatchingCriteria {
  const parsed = MatchingCriteriaSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_CRITERIA;
}
