import { z } from "zod";

/**
 * Scorecard criteria are defined per interview template and snapshotted onto each
 * interview, so editing a template never rewrites feedback already given.
 * Ratings are a 1-5 scale with a written anchor, which keeps interviewers calibrated.
 */
export const ScorecardCriterionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  weight: z.number().int().min(0).max(100),
});
export type ScorecardCriterion = z.infer<typeof ScorecardCriterionSchema>;

export const ScorecardCriteriaSchema = z
  .array(ScorecardCriterionSchema)
  .min(1, "Add at least one criterion")
  .max(12, "Twelve criteria is the practical maximum for one interview")
  .refine((list) => new Set(list.map((c) => c.id)).size === list.length, "Criterion ids must be unique")
  .refine((list) => list.reduce((sum, c) => sum + c.weight, 0) === 100, "Criterion weights must add up to 100");

export const RATING_ANCHORS: Record<number, string> = {
  1: "Well below the bar",
  2: "Below the bar",
  3: "Meets the bar",
  4: "Above the bar",
  5: "Well above the bar",
};

export const RatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});
export const RatingsSchema = z.record(z.string(), RatingSchema);
export type Ratings = z.infer<typeof RatingsSchema>;

export const DEFAULT_CRITERIA: Record<string, ScorecardCriterion[]> = {
  TECHNICAL: [
    { id: "technical_depth", label: "Technical depth", description: "Command of the technologies the role needs", weight: 35 },
    { id: "problem_solving", label: "Problem solving", description: "Breaks problems down, reasons about trade-offs", weight: 30 },
    { id: "code_quality", label: "Code and design quality", description: "Readable, tested, maintainable work", weight: 20 },
    { id: "communication", label: "Communication", description: "Explains thinking clearly", weight: 15 },
  ],
  BEHAVIORAL: [
    { id: "collaboration", label: "Collaboration", description: "Works well with others, handles disagreement", weight: 30 },
    { id: "ownership", label: "Ownership", description: "Takes responsibility and follows through", weight: 30 },
    { id: "adaptability", label: "Adaptability", description: "Handles change and ambiguity", weight: 20 },
    { id: "communication", label: "Communication", description: "Clear, direct, listens well", weight: 20 },
  ],
  SCREENING: [
    { id: "role_fit", label: "Role fit", description: "Experience lines up with the role's requirements", weight: 40 },
    { id: "motivation", label: "Motivation", description: "Clear reasons for wanting this role", weight: 30 },
    { id: "communication", label: "Communication", description: "Clear and professional", weight: 30 },
  ],
  HR: [
    { id: "role_understanding", label: "Understanding of the role", weight: 30 },
    { id: "expectations", label: "Expectations alignment", description: "Compensation, notice period, location", weight: 40 },
    { id: "communication", label: "Communication", weight: 30 },
  ],
  PANEL: [
    { id: "role_fit", label: "Role fit", weight: 30 },
    { id: "technical_depth", label: "Technical depth", weight: 30 },
    { id: "collaboration", label: "Collaboration", weight: 20 },
    { id: "communication", label: "Communication", weight: 20 },
  ],
  FINAL: [
    { id: "overall_fit", label: "Overall fit for the role", weight: 50 },
    { id: "growth", label: "Growth potential", weight: 25 },
    { id: "risks", label: "Risks and gaps", description: "What would need support after joining", weight: 25 },
  ],
};

export function criteriaForKind(kind: string): ScorecardCriterion[] {
  return DEFAULT_CRITERIA[kind] ?? DEFAULT_CRITERIA.TECHNICAL;
}

export function parseCriteria(stored: unknown): ScorecardCriterion[] {
  const parsed = ScorecardCriteriaSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_CRITERIA.TECHNICAL;
}

/**
 * Weighted mean of one interviewer's ratings, on the same 1-5 scale.
 * Criteria left unrated are excluded and their weight is shared across the rest,
 * so a partially filled scorecard is not silently scored as zeros.
 */
export function weightedRating(criteria: ScorecardCriterion[], ratings: Ratings): number | null {
  const rated = criteria.filter((c) => ratings[c.id]?.rating != null && c.weight > 0);
  const totalWeight = rated.reduce((s, c) => s + c.weight, 0);
  if (!totalWeight) return null;
  const sum = rated.reduce((s, c) => s + ratings[c.id].rating * c.weight, 0);
  return Math.round((sum / totalWeight) * 100) / 100;
}

const RECOMMENDATION_SCORE: Record<string, number> = {
  STRONG_YES: 2,
  YES: 1.5,
  LEAN_YES: 0.5,
  LEAN_NO: -0.5,
  NO: -1.5,
  STRONG_NO: -2,
};

export interface PanelSummary {
  submitted: number;
  pending: number;
  averageRating: number | null;
  /** Per-criterion average across submitted scorecards. */
  perCriterion: { id: string; label: string; average: number | null; ratings: number[] }[];
  recommendations: Record<string, number>;
  /** True when interviewers disagree sharply - a prompt to discuss, never an automatic outcome. */
  split: boolean;
  consensus: "positive" | "negative" | "mixed" | "insufficient";
}

/**
 * Aggregates a panel's scorecards for display. This is decision support: it reports what
 * the interviewers said and whether they disagree. It never produces a hire decision.
 */
export function summarisePanel(
  criteria: ScorecardCriterion[],
  scorecards: { ratings: unknown; overallRating: number | null; recommendation: string | null; submittedAt: Date | null }[],
): PanelSummary {
  const submitted = scorecards.filter((s) => s.submittedAt);
  const perCriterion = criteria.map((c) => {
    const values = submitted
      .map((s) => (RatingsSchema.safeParse(s.ratings).success ? (s.ratings as Ratings)[c.id]?.rating : undefined))
      .filter((v): v is number => typeof v === "number");
    return {
      id: c.id,
      label: c.label,
      ratings: values,
      average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null,
    };
  });

  const overalls = submitted.map((s) => s.overallRating).filter((v): v is number => v != null);
  const averageRating = overalls.length ? Math.round((overalls.reduce((a, b) => a + b, 0) / overalls.length) * 100) / 100 : null;

  const recommendations: Record<string, number> = {};
  for (const s of submitted) if (s.recommendation) recommendations[s.recommendation] = (recommendations[s.recommendation] ?? 0) + 1;

  const scores = submitted.map((s) => (s.recommendation ? RECOMMENDATION_SCORE[s.recommendation] ?? 0 : 0));
  const positives = scores.filter((v) => v > 0).length;
  const negatives = scores.filter((v) => v < 0).length;
  const split = positives > 0 && negatives > 0;

  let consensus: PanelSummary["consensus"] = "insufficient";
  if (submitted.length) {
    if (split) consensus = "mixed";
    else if (positives > 0) consensus = "positive";
    else if (negatives > 0) consensus = "negative";
    else consensus = "mixed";
  }

  return {
    submitted: submitted.length,
    pending: scorecards.length - submitted.length,
    averageRating,
    perCriterion,
    recommendations,
    split,
    consensus,
  };
}
