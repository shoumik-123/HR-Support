export type Role = "OWNER" | "ADMIN" | "HR_MANAGER" | "RECRUITER" | "HIRING_MANAGER" | "INTERVIEWER" | "EVALUATOR" | "VIEWER";
export type JobStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
export type StageKind = "APPLIED" | "SCREENING" | "SHORTLISTED" | "ASSESSMENT" | "INTERVIEW" | "FINAL_REVIEW" | "OFFER" | "HIRED" | "REJECTED" | "CUSTOM";
export type ReviewStatus = "PENDING" | "ACCEPTED" | "ADJUSTED" | "DISMISSED";
export type AnalysisMethod = "AI" | "HEURISTIC";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string | null;
  role: Role;
  permissions: string[];
}

export interface Me {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  organizations: OrgSummary[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string | null;
  website: string | null;
  industry: string | null;
  companySize: string | null;
  country: string | null;
  timezone: string;
  defaultCurrency: string;
  blindModeDefault: boolean;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "SUSPENDED";
  joinedAt: string;
  lastLoginAt: string | null;
}

export interface Department {
  id: string;
  name: string;
  _count?: { jobs: number };
}

export interface Stage {
  id: string;
  name: string;
  kind: StageKind;
  position: number;
  color: string | null;
}

export interface MatchingCriteria {
  skills: number;
  experience: number;
  education: number;
  projects: number;
  certifications: number;
}

export interface Job {
  id: string;
  title: string;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  description: string;
  responsibilities: string | null;
  location: string | null;
  workMode: "ONSITE" | "REMOTE" | "HYBRID";
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP" | "TEMPORARY";
  status: JobStatus;
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  educationRequirement: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryVisible: boolean;
  openings: number;
  matchingCriteria: MatchingCriteria | null;
  hiringManagerIds: string[];
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  applicationCount?: number;
  activeApplicationCount?: number;
  stageCounts?: Record<string, number>;
}

export interface CandidateSummary {
  id: string;
  fullName: string;
  email: string | null;
  phone?: string | null;
  location?: string | null;
  headline: string | null;
  totalExperienceYears: number | null;
  skills: string[];
  tags?: string[];
  source?: string;
  consentStatus?: "UNKNOWN" | "GRANTED" | "WITHDRAWN";
  createdAt?: string;
  masked: boolean;
  _count?: { applications: number; resumes: number };
}

export interface CriterionResult {
  criterion: keyof MatchingCriteria;
  score: number | null;
  weight: number;
  rationale: string;
  evidence: string[];
}

export interface MatchResult {
  id: string;
  score: number;
  adjustedScore: number | null;
  effectiveScore?: number | null;
  confidence: number;
  method: AnalysisMethod;
  model: string | null;
  promptVersion: string;
  reviewStatus: ReviewStatus;
  reviewNote?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  gaps: string[];
  summary: string;
  breakdown: CriterionResult[];
  createdAt: string;
}

export interface ApplicationCard {
  id: string;
  stageId: string;
  status: "ACTIVE" | "REJECTED" | "HIRED" | "WITHDRAWN";
  stageEnteredAt: string;
  createdAt: string;
  isReapplication: boolean;
  source: string;
  candidate: CandidateSummary;
  match: Partial<MatchResult> | null;
  effectiveScore: number | null;
  job?: { id: string; title: string };
  stage?: Stage;
}

export interface Board {
  job: { id: string; title: string; status: JobStatus };
  blindMode: boolean;
  stages: (Stage & { total: number; applications: ApplicationCard[] })[];
}

export interface ParsedEvidenceItem {
  evidence: string;
  confidence: number;
}

export interface ParsedResume {
  resumeLanguage: string;
  contact: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
    portfolioUrl: string | null;
  };
  headline: string | null;
  summary: string | null;
  totalExperienceYears: number | null;
  skills: (ParsedEvidenceItem & { name: string; category: string | null })[];
  experience: (ParsedEvidenceItem & { title: string; company: string | null; startDate: string | null; endDate: string | null; isCurrent: boolean; description: string | null })[];
  education: (ParsedEvidenceItem & { degree: string | null; field: string | null; institution: string | null; endYear: string | null; grade: string | null })[];
  certifications: (ParsedEvidenceItem & { name: string; issuer: string | null; year: string | null })[];
  projects: (ParsedEvidenceItem & { name: string; description: string | null; technologies: string[]; url: string | null })[];
  languages: { name: string; proficiency: string | null }[];
  missingFields: string[];
  overallConfidence: number;
}

export interface ResumeSummary {
  id: string;
  fileName: string;
  version: number;
  status: "UPLOADED" | "PROCESSING" | "PARSED" | "FAILED";
  parseMethod: AnalysisMethod | null;
  model: string | null;
  promptVersion: string | null;
  overallConfidence: number | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface Candidate360 extends CandidateSummary {
  summary: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  languages: string[];
  missingFields: string[];
  profile: {
    experience?: ParsedResume["experience"];
    education?: ParsedResume["education"];
    certifications?: ParsedResume["certifications"];
    projects?: ParsedResume["projects"];
    skillDetails?: ParsedResume["skills"];
    resumeLanguage?: string;
  } | null;
  blindMode: boolean;
  resumes: ResumeSummary[];
  applications: (ApplicationCard & { job: { id: string; title: string; status: JobStatus }; stage: Stage; matches: MatchResult[] })[];
  notes: { id: string; body: string; authorName: string; createdAt: string; authorId: string }[];
  timeline: { id: string; action: string; actorName: string; createdAt: string; data: unknown }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Overview {
  periodDays: number;
  jobs: { active: number; draft: number };
  candidates: { total: number; new: number };
  applications: { total: number; new: number; hired: number; rejected: number };
  funnel: { stageId: string; name: string; kind: StageKind; color: string | null; count: number }[];
  timeToHireDays: number | null;
  pendingMatchReviews: number;
  resumeProcessing: { parsed: number; failed: number; pending: number; successRate: number | null };
}

export interface AiOversight {
  periodDays: number;
  reviews: Partial<Record<ReviewStatus, number>>;
  reviewedShare: number | null;
  acceptanceRate: number | null;
  averageHumanAdjustment: number | null;
  usage: { feature: string; calls: number; inputTokens: number; outputTokens: number }[];
}

export interface JobPerformance {
  id: string;
  title: string;
  status: JobStatus;
  openings: number;
  applications: number;
  shortlisted: number;
  interviewed: number;
  hired: number;
  rejected: number;
  shortlistRate: number;
  interviewRate: number;
  averageMatchScore: number | null;
  matchesRun: number;
  timeToHireDays: number | null;
}

// ───────────────────────── Phase 2: Interviews ─────────────────────────

export type QuestionCategory = "TECHNICAL" | "BEHAVIORAL" | "SITUATIONAL" | "HR" | "ROLE_SPECIFIC";
export type QuestionDifficulty = "EASY" | "MEDIUM" | "HARD";
export type InterviewKind = "SCREENING" | "TECHNICAL" | "BEHAVIORAL" | "PANEL" | "HR" | "FINAL";
export type InterviewMode = "VIDEO" | "PHONE" | "ONSITE";
export type InterviewStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type ParticipantRole = "LEAD" | "PANEL" | "OBSERVER";
export type ParticipantResponse = "PENDING" | "ACCEPTED" | "DECLINED";
export type RecommendationValue = "STRONG_YES" | "YES" | "LEAN_YES" | "LEAN_NO" | "NO" | "STRONG_NO";

export interface ScorecardCriterion {
  id: string;
  label: string;
  description?: string;
  weight: number;
}

export interface Rating {
  rating: number;
  comment?: string;
}

export interface Scorecard {
  id: string;
  interviewerId: string;
  interviewer?: { id: string; name: string };
  ratings: Record<string, Rating>;
  overallRating: number | null;
  recommendation: RecommendationValue | null;
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
  aiSummary: string | null;
  aiModel: string | null;
  submittedAt: string | null;
}

export interface PanelSummary {
  submitted: number;
  pending: number;
  averageRating: number | null;
  perCriterion: { id: string; label: string; average: number | null; ratings: number[] }[];
  recommendations: Partial<Record<RecommendationValue, number>>;
  split: boolean;
  consensus: "positive" | "negative" | "mixed" | "insufficient";
}

export interface InterviewQuestionItem {
  id: string;
  questionId: string | null;
  text: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  guidance: string | null;
  rationale: string | null;
  position: number;
}

export interface GeneratedQuestion {
  text: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  skills: string[];
  guidance: string;
  rationale: string;
}

export interface BankQuestion {
  id: string;
  text: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  skills: string[];
  guidance: string | null;
  rationale: string | null;
  jobId: string | null;
  job?: { id: string; title: string } | null;
  source: AnalysisMethod;
  model: string | null;
  promptVersion: string | null;
  approved: boolean;
  createdAt: string;
  _count?: { usages: number };
}

export interface InterviewTemplate {
  id: string;
  name: string;
  description: string | null;
  jobId: string | null;
  job?: { id: string; title: string } | null;
  kind: InterviewKind;
  durationMinutes: number;
  criteria: ScorecardCriterion[];
  questionIds: string[];
  isDefault: boolean;
}

export interface InterviewParticipantView {
  id: string;
  userId: string;
  role: ParticipantRole;
  response: ParticipantResponse;
  user: { id: string; name: string; email?: string };
}

export interface InterviewListItem {
  id: string;
  title: string;
  kind: InterviewKind;
  mode: InterviewMode;
  status: InterviewStatus;
  round: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  candidate: CandidateSummary;
  job: { id: string; title: string };
  participants: InterviewParticipantView[];
  feedbackSubmitted: number;
  feedbackPending: number;
}

export interface InterviewDetail extends Omit<InterviewListItem, "feedbackSubmitted" | "feedbackPending"> {
  location: string | null;
  meetingLink: string | null;
  agenda: string | null;
  cancelReason: string | null;
  criteria: ScorecardCriterion[];
  questions: InterviewQuestionItem[];
  scorecards: Scorecard[];
  panel: PanelSummary;
  myScorecardId: string | null;
  canSeePanelFeedback: boolean;
  isParticipant: boolean;
  application: { id: string; stageId: string; status: string };
  template?: { id: string; name: string } | null;
}

export interface CalendarResponse {
  timezone: string;
  interviews: {
    id: string;
    title: string;
    kind: InterviewKind;
    mode: InterviewMode;
    status: InterviewStatus;
    startsAt: string;
    endsAt: string;
    timezone: string;
    localLabel: string;
    candidate: CandidateSummary;
    job: { id: string; title: string };
    interviewers: { id: string; name: string; role: ParticipantRole; response: ParticipantResponse }[];
  }[];
}

export interface InterviewerOption {
  id: string;
  name: string;
  email: string;
  role: Role;
  availabilityWindows: number;
}

export interface SlotSuggestion {
  timezone: string;
  withoutDeclaredHours: string[];
  slots: { start: string; end: string; label: string }[];
}

export interface SlotConflict {
  userId: string;
  interviewId: string;
  interviewerName?: string;
  start: string;
  end: string;
}

export interface AvailabilityResponse {
  userId: string;
  timezone: string;
  slots: { id: string; weekday: number; startMinute: number; endMinute: number }[];
}

export interface ApplicationFeedback {
  id: string;
  title: string;
  kind: InterviewKind;
  round: number;
  status: InterviewStatus;
  startsAt: string;
  timezone: string;
  criteria: ScorecardCriterion[];
  panel: PanelSummary;
  scorecards: Scorecard[];
}

// ───────────────────────── Phase 2: Communications ─────────────────────────

export type TemplateKey =
  | "APPLICATION_RECEIVED" | "SHORTLISTED" | "INTERVIEW_INVITATION" | "INTERVIEW_REMINDER"
  | "INTERVIEW_RESCHEDULED" | "INTERVIEW_CANCELLED" | "ASSESSMENT_INVITATION" | "SELECTED"
  | "REJECTED" | "OFFER" | "CUSTOM";

export type AutomationTrigger =
  | "APPLICATION_CREATED" | "STAGE_CHANGED" | "INTERVIEW_SCHEDULED" | "INTERVIEW_RESCHEDULED"
  | "INTERVIEW_CANCELLED" | "INTERVIEW_REMINDER" | "APPLICATION_REJECTED" | "CANDIDATE_HIRED";

export type CommunicationStatus = "QUEUED" | "SENT" | "FAILED" | "SKIPPED";

export interface EmailTemplate {
  id: string;
  key: TemplateKey;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  isDefault: boolean;
  variables: { known: string[]; unknown: string[] };
}

export interface AutomationRule {
  id: string;
  trigger: AutomationTrigger;
  stageId: string | null;
  templateId: string;
  enabled: boolean;
  offsetHours: number;
  template: { id: string; name: string; key: TemplateKey };
  stage: { id: string; name: string } | null;
}

export interface AutomationsResponse {
  rules: AutomationRule[];
  templates: { id: string; name: string; key: TemplateKey }[];
  stages: { id: string; name: string; kind: StageKind }[];
}

export interface Communication {
  id: string;
  candidateId: string | null;
  applicationId: string | null;
  interviewId: string | null;
  templateKey: TemplateKey | null;
  trigger: AutomationTrigger | null;
  toEmail: string;
  subject: string;
  body: string;
  status: CommunicationStatus;
  error: string | null;
  skipReason: string | null;
  sentAt: string | null;
  automated: boolean;
  createdAt: string;
  candidate?: { id: string; fullName: string } | null;
  template?: { name: string } | null;
  sentByName: string | null;
}

export interface CommunicationStats {
  periodDays: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
  automated: number;
  deliveryRate: number | null;
}
