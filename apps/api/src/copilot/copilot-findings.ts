/**
 * What an answer is made of, and how it reads when no model is involved.
 *
 * `Findings` is the whole truth of an answer: figures the API computed, the rows they came
 * from, and one-line highlights written by code. The narrator - model or template - may only
 * rearrange these words. It is given no other data, so it has nothing else to say.
 */
import { Intent, INTENT_SPECS } from "./copilot-intents";

export interface Fact {
  label: string;
  value: string | number | null;
  detail?: string;
}

export interface Reference {
  type: "job" | "candidate" | "application" | "interview" | "offer" | "assessment" | "stage";
  id: string;
  label: string;
  detail?: string;
  score?: number | null;
}

export interface Findings {
  intent: Intent;
  /** The job or person the question was about, once resolved against real data. */
  subject: string | null;
  facts: Fact[];
  references: Reference[];
  /** Plain sentences built from the figures; the narrator may reuse them verbatim. */
  highlights: string[];
  /** Caveats that must survive into the answer - missing data, permissions, truncation. */
  notes: string[];
}

export const emptyFindings = (intent: Intent): Findings => ({ intent, subject: null, facts: [], references: [], highlights: [], notes: [] });

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const days = (n: number) => plural(n, "day");

/** Verb agreement, so a count of one does not read as "1 candidate are active". */
export const is = (n: number) => (n === 1 ? "is" : "are");
export const has = (n: number) => (n === 1 ? "has" : "have");
export const was = (n: number) => (n === 1 ? "was" : "were");

/**
 * The answer when no model is available. Deliberately plain: it is the highlights joined up,
 * so the rule-based copilot says exactly what the numbers say and nothing more.
 */
export function heuristicAnswer(findings: Findings): string {
  const parts: string[] = [];
  if (findings.highlights.length) parts.push(findings.highlights.join(" "));
  else parts.push(`I found nothing to report for ${INTENT_SPECS[findings.intent].summary.toLowerCase()}.`);
  if (findings.notes.length) parts.push(findings.notes.join(" "));
  return parts.join("\n\n");
}

/** One line per figure, for the model to narrate and for the screen to show beside the answer. */
export function factsBlock(findings: Findings): string {
  const lines = findings.facts.map((f) => `- ${f.label}: ${f.value ?? "not known"}${f.detail ? ` (${f.detail})` : ""}`);
  const rows = findings.references.map((r) => `- ${r.type}: ${r.label}${r.score != null ? ` — score ${r.score}` : ""}${r.detail ? ` — ${r.detail}` : ""}`);
  return [
    findings.subject ? `Subject: ${findings.subject}` : null,
    lines.length ? `Figures:\n${lines.join("\n")}` : "Figures: none",
    rows.length ? `Rows:\n${rows.join("\n")}` : null,
    findings.highlights.length ? `Plain-language highlights:\n${findings.highlights.map((h) => `- ${h}`).join("\n")}` : null,
    findings.notes.length ? `Caveats that must appear in your answer:\n${findings.notes.map((n) => `- ${n}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
