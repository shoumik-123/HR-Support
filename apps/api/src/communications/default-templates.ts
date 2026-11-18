import { TemplateKey } from "../generated/prisma/enums";

/**
 * Seed templates for a new organization. Wording is deliberately plain and respectful;
 * recruiters are expected to edit them. Rejection and selection templates exist but their
 * automations stay off until a human turns them on.
 */
export interface DefaultTemplate {
  key: TemplateKey;
  name: string;
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "APPLICATION_RECEIVED",
    name: "Application received",
    subject: "We received your application for {{job.title}}",
    body: `Dear {{candidate.firstName}},

Thank you for applying for the {{job.title}} role at {{organization.name}}. We have received your application and our team will review it.

If your experience matches what we are looking for, we will be in touch about next steps. Either way, we will let you know the outcome.

Best regards,
{{organization.name}} Recruitment Team`,
  },
  {
    key: "SHORTLISTED",
    name: "Shortlisted for next steps",
    subject: "Your application for {{job.title}} - next steps",
    body: `Dear {{candidate.firstName}},

Good news: after reviewing your application for {{job.title}}, we would like to take it further.

Someone from our team will contact you shortly to arrange the next step. If you have questions in the meantime, reply to this email.

Best regards,
{{sender.name}}
{{organization.name}}`,
  },
  {
    key: "INTERVIEW_INVITATION",
    name: "Interview invitation",
    subject: "Interview invitation: {{job.title}} at {{organization.name}}",
    body: `Dear {{candidate.firstName}},

We would like to invite you to a {{interview.kind}} interview for the {{job.title}} role.

When: {{interview.datetime}}
Duration: {{interview.duration}} minutes
Format: {{interview.mode}}
Where: {{interview.location}}
You will be meeting: {{interview.interviewers}}

A calendar invitation is attached. Please confirm that this time works for you, and tell us as soon as you can if you need a different slot.

Best regards,
{{sender.name}}
{{organization.name}}`,
  },
  {
    key: "INTERVIEW_REMINDER",
    name: "Interview reminder",
    subject: "Reminder: your interview for {{job.title}}",
    body: `Dear {{candidate.firstName}},

This is a reminder of your upcoming interview for the {{job.title}} role.

When: {{interview.datetime}}
Format: {{interview.mode}}
Where: {{interview.location}}

If anything has changed and you can no longer attend, please let us know.

Best regards,
{{organization.name}} Recruitment Team`,
  },
  {
    key: "INTERVIEW_RESCHEDULED",
    name: "Interview rescheduled",
    subject: "Your interview for {{job.title}} has been rescheduled",
    body: `Dear {{candidate.firstName}},

Your interview for the {{job.title}} role has been moved to a new time.

New time: {{interview.datetime}}
Format: {{interview.mode}}
Where: {{interview.location}}

Our apologies for the change. An updated calendar invitation is attached.

Best regards,
{{sender.name}}
{{organization.name}}`,
  },
  {
    key: "INTERVIEW_CANCELLED",
    name: "Interview cancelled",
    subject: "Your interview for {{job.title}} has been cancelled",
    body: `Dear {{candidate.firstName}},

We are writing to let you know that your interview for the {{job.title}} role, scheduled for {{interview.datetime}}, has been cancelled.

We will contact you about next steps.

Best regards,
{{sender.name}}
{{organization.name}}`,
  },
  {
    key: "ASSESSMENT_INVITATION",
    name: "Assessment invitation",
    subject: "Assessment for your {{job.title}} application",
    body: `Dear {{candidate.firstName}},

As the next step in your application for {{job.title}}, we would like you to complete a short assessment.

We will send the assessment details separately.

Best regards,
{{sender.name}}
{{organization.name}}`,
  },
  {
    key: "SELECTED",
    name: "Selected for the role",
    subject: "Good news about your {{job.title}} application",
    body: `Dear {{candidate.firstName}},

We are delighted to tell you that we would like to offer you the {{job.title}} role at {{organization.name}}.

We will follow up shortly with the formal offer and the details.

Congratulations, and welcome.

Best regards,
{{sender.name}}
{{organization.name}}`,
  },
  {
    key: "REJECTED",
    name: "Application not progressing",
    subject: "Your application for {{job.title}}",
    body: `Dear {{candidate.firstName}},

Thank you for the time you put into applying for the {{job.title}} role at {{organization.name}}, and for the chance to consider your experience.

After careful review we have decided not to take your application further on this occasion. This was a considered decision made by our hiring team.

We would be glad to hear from you about future openings that match your experience.

We wish you well with your search.

Best regards,
{{organization.name}} Recruitment Team`,
  },
  {
    key: "OFFER",
    name: "Offer details",
    subject: "Your offer from {{organization.name}}",
    body: `Dear {{candidate.firstName}},

Please find the details of our offer for the {{job.title}} role attached.

Let us know if you have any questions.

Best regards,
{{sender.name}}
{{organization.name}}`,
  },
];
