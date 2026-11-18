/**
 * Assessment marking. Pure functions so every edge case is cheap to test.
 *
 * Only closed questions (MCQ, numeric) are marked automatically. Written answers are
 * left for a human, and an assessment is not "evaluated" until those are marked — so a
 * candidate is never scored as zero on a question nobody has read.
 */
import { AssessmentQuestionType } from "../generated/prisma/enums";

export const AUTO_MARKED: AssessmentQuestionType[] = ["MCQ_SINGLE", "MCQ_MULTI", "NUMERIC"];

export function isAutoMarked(type: AssessmentQuestionType): boolean {
  return AUTO_MARKED.includes(type);
}

export interface MarkableQuestion {
  type: AssessmentQuestionType;
  /** Option indexes (as strings) for MCQ; accepted values for NUMERIC. */
  correctAnswers: string[];
  tolerance?: number | null;
  maxPoints: number;
}

export interface MarkResult {
  /** Null when a human must mark it. */
  correct: boolean | null;
  points: number | null;
}

/**
 * Marks one answer.
 *
 * MCQ_SINGLE: exactly one choice, and it must be the right one.
 * MCQ_MULTI: all-or-nothing — every correct option and no incorrect one. Partial
 *   credit is deliberately not given, because a half-right multi-select tells you
 *   very little and recruiters read partial marks as competence.
 * NUMERIC: parsed as a number and compared within `tolerance` (default exact).
 */
export function markAnswer(question: MarkableQuestion, response: string[]): MarkResult {
  if (!isAutoMarked(question.type)) return { correct: null, points: null };

  const given = response.map((r) => r.trim()).filter((r) => r !== "");
  if (!given.length) return { correct: false, points: 0 };

  if (question.type === "NUMERIC") {
    const expected = Number(question.correctAnswers[0]);
    const actual = Number(given[0]);
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) return { correct: false, points: 0 };
    const tolerance = question.tolerance ?? 0;
    const correct = Math.abs(actual - expected) <= tolerance;
    return { correct, points: correct ? question.maxPoints : 0 };
  }

  const expected = new Set(question.correctAnswers.map((a) => a.trim()));
  const chosen = new Set(given);

  if (question.type === "MCQ_SINGLE") {
    const correct = chosen.size === 1 && expected.has([...chosen][0]);
    return { correct, points: correct ? question.maxPoints : 0 };
  }

  // MCQ_MULTI
  const correct = chosen.size === expected.size && [...chosen].every((c) => expected.has(c));
  return { correct, points: correct ? question.maxPoints : 0 };
}

export interface ScoredAnswer {
  type: AssessmentQuestionType;
  maxPoints: number;
  pointsAwarded: number | null;
}

export interface AssessmentScore {
  autoScore: number;
  manualScore: number;
  /** Points available across every question. */
  totalPoints: number;
  /** Points from questions that have actually been marked. */
  markedPoints: number;
  finalScore: number;
  /** Percentage of the whole paper. Null while written answers are unmarked. */
  percent: number | null;
  passed: boolean | null;
  /** Written questions still waiting for a human. */
  awaitingManual: number;
  complete: boolean;
}

/**
 * Totals a paper. `percent` and `passed` stay null until every written answer has
 * been marked, so a partially marked paper is never presented as a final result.
 */
export function scoreAssessment(answers: ScoredAnswer[], passingPercent: number): AssessmentScore {
  let autoScore = 0;
  let manualScore = 0;
  let totalPoints = 0;
  let markedPoints = 0;
  let awaitingManual = 0;

  for (const a of answers) {
    totalPoints += a.maxPoints;
    if (a.pointsAwarded == null) {
      // Anything still unmarked needs a human, whatever its type. A closed question is
      // normally marked the moment it is submitted, so one left null means it could not
      // be marked automatically (its answer key was removed) - counting it as awaiting
      // keeps it out of the published percentage instead of quietly scoring it zero.
      awaitingManual++;
      continue;
    }
    markedPoints += a.maxPoints;
    if (isAutoMarked(a.type)) autoScore += a.pointsAwarded;
    else manualScore += a.pointsAwarded;
  }

  const finalScore = autoScore + manualScore;
  const complete = awaitingManual === 0;
  const percent = complete && totalPoints > 0 ? Math.round((finalScore / totalPoints) * 1000) / 10 : null;

  return {
    autoScore,
    manualScore,
    totalPoints,
    markedPoints,
    finalScore,
    percent,
    passed: percent == null ? null : percent >= passingPercent,
    awaitingManual,
    complete,
  };
}

/**
 * Deterministic per-candidate shuffle. Seeded by the assessment id so a candidate who
 * reloads mid-test sees the same order, while two candidates get different orders.
 */
export function shuffleFor<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const next = () => {
    // xorshift32 on the seeded state
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return Math.abs(h) / 2 ** 31;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Remaining seconds before the sitting's hard deadline, floored at zero. */
export function remainingSeconds(dueAt: Date | null, now = new Date()): number {
  if (!dueAt) return 0;
  return Math.max(0, Math.floor((dueAt.getTime() - now.getTime()) / 1000));
}

export function isExpired(assessment: { expiresAt: Date; dueAt: Date | null; status: string }, now = new Date()): boolean {
  if (assessment.status === "SUBMITTED" || assessment.status === "EVALUATED") return false;
  if (assessment.dueAt) return assessment.dueAt < now;
  return assessment.expiresAt < now;
}
