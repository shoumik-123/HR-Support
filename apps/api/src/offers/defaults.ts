import { OnboardingCategory } from "../generated/prisma/enums";

/**
 * Default offer letter. Uses the same `{{placeholders}}` as email templates, plus a few
 * offer-only ones ({{benefits}}, {{probation}}, {{notice}}, {{reportingTo}},
 * {{workLocation}}) that the offer service fills in.
 *
 * Deliberately plain. It is a starting point an organization is expected to replace with
 * wording its own legal advisers have approved — an offer letter is a contractual document.
 */
export const DEFAULT_OFFER_LETTER = `{{today}}

Dear {{candidate.name}},

OFFER OF EMPLOYMENT — {{offer.jobTitle}}

We are pleased to offer you the position of {{offer.jobTitle}} at {{organization.name}}.

TERMS

Position: {{offer.jobTitle}}
Reporting to: {{reportingTo}}
Work location: {{workLocation}}
Remuneration: {{offer.salary}}
Joining date: {{offer.startDate}}
Probation period: {{probation}}
Notice period: {{notice}}

BENEFITS

{{benefits}}

ACCEPTANCE

Please confirm your acceptance by {{offer.respondBy}}. This offer is subject to
verification of the documents and references you have provided.

We are glad you are considering joining us, and we look forward to working with you.

Yours sincerely,

{{sender.name}}
{{organization.name}}`;

export interface DefaultOnboardingTask {
  title: string;
  description?: string;
  category: OnboardingCategory;
  /** Due this many days before the joining date. Null means no due date. */
  daysBeforeStart: number | null;
}

/**
 * Seeded when a candidate accepts an offer, so HR starts from a real checklist rather
 * than a blank page. Each organization edits, removes or adds to it.
 */
export const DEFAULT_ONBOARDING_TASKS: DefaultOnboardingTask[] = [
  {
    title: "Collect signed offer letter",
    description: "Signed and dated copy on file.",
    category: "DOCUMENT",
    daysBeforeStart: 14,
  },
  {
    title: "Collect academic and experience certificates",
    description: "Degree certificates, transcripts, and release or experience letters from previous employers.",
    category: "DOCUMENT",
    daysBeforeStart: 10,
  },
  {
    title: "Collect National ID and photographs",
    description: "NID copy and passport-size photographs for the personnel file.",
    category: "DOCUMENT",
    daysBeforeStart: 10,
  },
  {
    title: "Complete reference checks",
    description: "Contact the referees provided and record the outcome.",
    category: "HR_ADMIN",
    daysBeforeStart: 7,
  },
  {
    title: "Prepare employment contract",
    description: "Draft, review and have the contract ready for signing on day one.",
    category: "HR_ADMIN",
    daysBeforeStart: 5,
  },
  {
    title: "Set up payroll and bank details",
    description: "Add to payroll, collect bank account details and tax information.",
    category: "HR_ADMIN",
    daysBeforeStart: 3,
  },
  {
    title: "Create email and system accounts",
    description: "Company email, and access to the tools the role needs.",
    category: "IT_SETUP",
    daysBeforeStart: 2,
  },
  {
    title: "Arrange equipment",
    description: "Laptop, peripherals, access card, desk.",
    category: "IT_SETUP",
    daysBeforeStart: 2,
  },
  {
    title: "Share first-week schedule",
    description: "Send the joining instructions, reporting time and first-week plan.",
    category: "INTRODUCTION",
    daysBeforeStart: 2,
  },
  {
    title: "Assign an onboarding buddy",
    description: "A colleague the new joiner can ask anything in their first weeks.",
    category: "INTRODUCTION",
    daysBeforeStart: 1,
  },
  {
    title: "Day one: team introductions and office tour",
    category: "INTRODUCTION",
    daysBeforeStart: 0,
  },
  {
    title: "Complete orientation and policy briefing",
    description: "Code of conduct, leave policy, health and safety, information security.",
    category: "TRAINING",
    daysBeforeStart: null,
  },
  {
    title: "Role-specific training plan agreed",
    description: "What the new joiner should be able to do by the end of the first month.",
    category: "TRAINING",
    daysBeforeStart: null,
  },
  {
    title: "HR handover to line manager",
    description: "Confirm the manager has everything needed to run the first 30 days.",
    category: "HR_ADMIN",
    daysBeforeStart: null,
  },
];
