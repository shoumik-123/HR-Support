import { Criterion, MatchingCriteria } from "./criteria";

export interface CriterionResult {
  criterion: Criterion;
  /** 0-100, or null when the job sets no requirement for this criterion. */
  score: number | null;
  weight: number;
  rationale: string;
  evidence: string[];
}

export interface MatchAnalysis {
  score: number;
  breakdown: CriterionResult[];
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  gaps: string[];
  summary: string;
  confidence: number;
}

export interface MatchJob {
  title: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  educationRequirement: string | null;
}

export interface MatchCandidateProfile {
  skills: string[];
  totalExperienceYears: number | null;
  headline: string | null;
  education: { degree: string | null; field: string | null; institution: string | null; evidence: string }[];
  certifications: { name: string; issuer: string | null; evidence: string }[];
  projects: { name: string; description: string | null; technologies: string[]; evidence: string }[];
  experience: { title: string; company: string | null; startDate: string | null; endDate: string | null; description: string | null; evidence: string }[];
  parseConfidence: number;
}

/** Weighted mean over applicable criteria; weights of non-applicable criteria are redistributed. */
export function aggregate(breakdown: { score: number | null; weight: number }[]): number {
  const applicable = breakdown.filter((b) => b.score != null && b.weight > 0);
  const totalWeight = applicable.reduce((s, b) => s + b.weight, 0);
  if (!totalWeight) return 0;
  return Math.round(applicable.reduce((s, b) => s + (b.score as number) * b.weight, 0) / totalWeight);
}

export function weightFor(criteria: MatchingCriteria, c: Criterion) {
  return criteria[c];
}
