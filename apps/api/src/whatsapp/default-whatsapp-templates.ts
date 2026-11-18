import { TemplateKey } from "../generated/prisma/enums";

/**
 * Seed WhatsApp templates for a new organization.
 *
 * These are not the email templates with the signature removed. WhatsApp arrives on a
 * personal phone, usually within seconds, and is read on a small screen: so each one is
 * short, says who is writing in the first line, and asks for nothing the candidate cannot
 * answer from their phone. Recruiters are expected to edit them.
 *
 * There is deliberately no rejection template. A rejection that lands on someone's personal
 * phone between other messages from their family is a worse way to hear it than an email
 * they open when they are ready, and an automated one is worse still. Anyone who disagrees
 * can write one under the CUSTOM key; nothing here prevents it, and nothing here encourages it.
 */
export interface DefaultWhatsAppTemplate {
  key: TemplateKey;
  name: string;
  body: string;
}

export const DEFAULT_WHATSAPP_TEMPLATES: DefaultWhatsAppTemplate[] = [
  {
    key: "APPLICATION_RECEIVED",
    name: "Application received",
    body: `{{organization.name}} here — thank you for applying for {{job.title}}, {{candidate.firstName}}. Your application has reached our team and we will review it. We will let you know either way.`,
  },
  {
    key: "SHORTLISTED",
    name: "Shortlisted for next steps",
    body: `Hello {{candidate.firstName}}, this is {{organization.name}}. Good news: your application for {{job.title}} is going forward. Someone from our team will contact you about the next step.`,
  },
  {
    key: "INTERVIEW_INVITATION",
    name: "Interview invitation",
    body: `Hello {{candidate.firstName}}, this is {{organization.name}} about the {{job.title}} role. Your {{interview.kind}} interview is set for {{interview.datetime}} ({{interview.duration}} minutes, {{interview.mode}}). Details: {{interview.location}}. Reply here if that time does not work.`,
  },
  {
    key: "INTERVIEW_REMINDER",
    name: "Interview reminder",
    body: `Reminder from {{organization.name}}: your {{interview.kind}} interview for {{job.title}} is at {{interview.datetime}}. {{interview.location}}. See you then, {{candidate.firstName}}.`,
  },
  {
    key: "INTERVIEW_RESCHEDULED",
    name: "Interview moved",
    body: `Hello {{candidate.firstName}}, {{organization.name}} here. Your interview for {{job.title}} has moved to {{interview.datetime}}. {{interview.location}}. Sorry for the change.`,
  },
  {
    key: "INTERVIEW_CANCELLED",
    name: "Interview cancelled",
    body: `Hello {{candidate.firstName}}, {{organization.name}} here. Your interview for {{job.title}} on {{interview.datetime}} has been cancelled. We will be in touch about what happens next.`,
  },
  {
    key: "ASSESSMENT_INVITATION",
    name: "Assessment invitation",
    body: `Hello {{candidate.firstName}}, {{organization.name}} here about {{job.title}}. The next step is a short assessment ({{assessment.duration}} minutes), to be completed by {{assessment.deadline}}: {{assessment.link}}`,
  },
  {
    key: "SELECTED",
    name: "Selected",
    body: `Congratulations {{candidate.firstName}} — {{organization.name}} would like to offer you the {{job.title}} role. The full details are in your email; reply here if you have not received it.`,
  },
  {
    key: "OFFER",
    name: "Offer sent",
    body: `Hello {{candidate.firstName}}, {{organization.name}} here. Your offer for {{job.title}} is ready and waiting for your answer by {{offer.respondBy}}: {{offer.link}}`,
  },
];
