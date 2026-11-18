/**
 * Email template rendering.
 *
 * Templates use `{{group.field}}` placeholders. Rendering is deliberately not a general
 * expression language: only the variables listed below resolve, anything else is reported
 * as unknown so a recruiter sees the mistake in the editor instead of a candidate receiving
 * a half-filled email.
 */

export const TEMPLATE_VARIABLES = {
  "candidate.name": "The candidate's full name",
  "candidate.firstName": "The candidate's first name",
  "candidate.email": "The candidate's email address",
  "job.title": "Job title applied for",
  "job.location": "Job location",
  "job.department": "Department name",
  "organization.name": "Your organization's name",
  "organization.website": "Your organization's website",
  "stage.name": "Current recruitment stage",
  "interview.title": "Interview title",
  "interview.kind": "Interview type, e.g. technical",
  "interview.datetime": "Interview date and time in the candidate's stated timezone",
  "interview.duration": "Interview length in minutes",
  "interview.mode": "Video, phone or on-site",
  "interview.location": "Address or meeting link",
  "interview.interviewers": "Names of the interviewers",
  "interview.round": "Interview round number",
  "assessment.title": "Assessment name",
  "assessment.duration": "Assessment time limit in minutes",
  "assessment.link": "The candidate's private link to take the assessment",
  "assessment.deadline": "Date by which the assessment must be completed",
  "offer.jobTitle": "Job title on the offer",
  "offer.salary": "Offered salary, formatted",
  "offer.startDate": "Proposed joining date",
  "offer.respondBy": "Date by which the candidate must respond",
  "offer.link": "The candidate's private link to accept or decline the offer",
  "sender.name": "Name of the person sending, or your organization for automated email",
  "today": "Today's date",
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;

export type RenderContext = Partial<Record<TemplateVariable, string | null | undefined>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

export interface RenderResult {
  text: string;
  /** Placeholders the template used that this platform does not provide. */
  unknown: string[];
  /** Known placeholders with no value for this particular candidate or interview. */
  missing: string[];
}

export function render(template: string, context: RenderContext): RenderResult {
  const unknown = new Set<string>();
  const missing = new Set<string>();

  const text = template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!(name in TEMPLATE_VARIABLES)) {
      unknown.add(name);
      return `{{${name}}}`;
    }
    const value = context[name as TemplateVariable];
    if (value === undefined || value === null || value === "") {
      missing.add(name);
      return "";
    }
    return value;
  });

  return { text: tidy(text), unknown: [...unknown], missing: [...missing] };
}

/** Collapse the blank space left behind by an empty placeholder. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** Placeholders a template references, for the editor's preview and validation. */
export function usedVariables(template: string): { known: TemplateVariable[]; unknown: string[] } {
  const known = new Set<TemplateVariable>();
  const unknown = new Set<string>();
  for (const [, name] of template.matchAll(PLACEHOLDER)) {
    if (name in TEMPLATE_VARIABLES) known.add(name as TemplateVariable);
    else unknown.add(name);
  }
  return { known: [...known], unknown: [...unknown] };
}

export function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  // Honorifics common on CVs in this market would make a poor greeting on their own.
  if (/^(mr|mrs|ms|md|mohammad|muhammad|dr|prof)\.?$/i.test(first)) {
    const second = fullName.trim().split(/\s+/)[1];
    if (second) return second;
  }
  return first || fullName;
}
