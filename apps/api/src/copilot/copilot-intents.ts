/**
 * What the copilot can be asked, and how a question is matched to one of those things.
 *
 * The copilot is not a free-form agent over the database. It answers a fixed list of
 * questions, each backed by one deterministic query whose numbers the API computes. A model
 * may help pick the question and phrase the reply; it never invents a figure, and a question
 * that fits nothing on this list is answered honestly with the list.
 */
import { Permission } from "../common/permissions";

export const INTENTS = [
  "top_candidates",
  "pipeline_health",
  "stuck_applications",
  "time_to_hire",
  "interview_load",
  "offer_status",
  "assessment_status",
  "job_funnel",
  "find_candidates",
  "capabilities",
] as const;

export type Intent = (typeof INTENTS)[number];

export interface IntentSpec {
  intent: Intent;
  /** What a recruiter would say they are asking for. */
  summary: string;
  /** Everyone who may see the answer must hold this. */
  permission: Permission;
  /** Words that point at this question, strongest first. */
  cues: string[][];
  followUps: string[];
}

export const INTENT_SPECS: Record<Intent, IntentSpec> = {
  top_candidates: {
    intent: "top_candidates",
    summary: "The strongest matches for a job, with their scores and stages",
    permission: Permission.CandidateView,
    cues: [
      ["best", "top", "strongest", "shortlist", "highest scoring", "who should i look at", "most suitable"],
      ["candidate", "candidates", "applicant", "applicants", "match", "matches"],
    ],
    followUps: ["Where is this pipeline stuck?", "How does this job's funnel look?"],
  },
  pipeline_health: {
    intent: "pipeline_health",
    summary: "How many candidates sit in each stage, and which stage is holding things up",
    permission: Permission.JobView,
    cues: [
      ["pipeline", "stage", "stages", "board", "bottleneck", "holding", "backlog", "where are we"],
      [],
    ],
    followUps: ["Who has been waiting longest?", "What is our time to hire?"],
  },
  stuck_applications: {
    intent: "stuck_applications",
    summary: "Candidates who have waited too long in one stage",
    permission: Permission.CandidateView,
    cues: [
      ["stuck", "waiting", "waited", "stale", "idle", "no movement", "longest", "forgotten", "sitting"],
      [],
    ],
    followUps: ["How does the pipeline look overall?", "Who owes interview feedback?"],
  },
  time_to_hire: {
    intent: "time_to_hire",
    summary: "How long hiring takes, and how many were hired or rejected",
    permission: Permission.AnalyticsView,
    cues: [
      ["time to hire", "how long", "speed", "duration", "days to hire", "hiring time", "how many hired", "hires", "hire", "hired"],
      [],
    ],
    followUps: ["Where is the pipeline stuck?", "How does each job's funnel compare?"],
  },
  interview_load: {
    intent: "interview_load",
    summary: "Interviews coming up, and feedback that has not been given",
    permission: Permission.InterviewView,
    cues: [
      ["interview", "interviews", "scorecard", "feedback", "panel", "scheduled", "this week", "calendar"],
      [],
    ],
    followUps: ["Which offers are waiting on approval?", "Where is the pipeline stuck?"],
  },
  offer_status: {
    intent: "offer_status",
    summary: "Offers by status, and which approvals are outstanding",
    permission: Permission.OfferView,
    cues: [
      ["offer", "offers", "offer letter", "approval", "approvals", "accepted", "declined", "salary offered"],
      [],
    ],
    followUps: ["What is our time to hire?", "Who is in the final stages?"],
  },
  assessment_status: {
    intent: "assessment_status",
    summary: "Assessments sent, sat, and waiting to be marked",
    permission: Permission.AssessmentView,
    cues: [
      ["assessment", "assessments", "test", "tests", "exam", "marking", "marked", "paper", "papers"],
      [],
    ],
    followUps: ["Who owes interview feedback?", "Where is the pipeline stuck?"],
  },
  job_funnel: {
    intent: "job_funnel",
    summary: "One job from applications through interviews and offers to hires",
    permission: Permission.AnalyticsView,
    cues: [
      ["funnel", "conversion", "how is the job", "how is this role", "performance", "progress on", "how many applied"],
      [],
    ],
    followUps: ["Who are the strongest matches for this job?", "Where is this pipeline stuck?"],
  },
  find_candidates: {
    intent: "find_candidates",
    summary: "People in the talent pool who fit a description",
    permission: Permission.CandidateView,
    cues: [
      ["find", "search", "anyone with", "do we have", "somebody who", "someone with", "look for", "is there anyone"],
      [],
    ],
    followUps: ["Add the best of them to a job?", "Who are the strongest matches for our open role?"],
  },
  capabilities: {
    intent: "capabilities",
    summary: "What the copilot can answer",
    permission: Permission.JobView,
    cues: [["what can you do", "help", "how do you work", "what do you know"], []],
    followUps: ["Where is the pipeline stuck?", "What is our time to hire?"],
  },
};

/** Phrases that mean the asker wants a judgement the copilot must not make. */
const DECISION_CUES = [
  "should i hire",
  "should we hire",
  "should i reject",
  "should we reject",
  "who should i reject",
  "is he good enough",
  "is she good enough",
  "pick one",
  "choose for me",
  "decide for me",
  "auto reject",
  "automatically reject",
];

export function asksForADecision(question: string): boolean {
  const q = question.toLowerCase();
  return DECISION_CUES.some((cue) => q.includes(cue));
}

export interface RoutedQuestion {
  intent: Intent;
  /** 0-1: how clearly the question pointed at this intent. */
  confidence: number;
  /** A job the question named, as typed; resolved against real jobs later. */
  jobHint: string | null;
  /** A period in days, when the question gave one. */
  days: number | null;
  /** For find_candidates: the description to search the pool with. */
  searchPhrase: string | null;
}

const BENGALI_DIGITS: Record<string, string> = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };

/** "last 30 days", "this week", "past quarter" - a window, in days. */
export function readPeriod(question: string): number | null {
  const q = question.replace(/[০-৯]/g, (d) => BENGALI_DIGITS[d] ?? d).toLowerCase();
  const explicit = q.match(/(?:last|past|previous|in the|গত)\s+(\d{1,3})\s*(day|days|week|weeks|month|months)/);
  if (explicit) {
    const n = Number(explicit[1]);
    const unit = explicit[2].startsWith("week") ? 7 : explicit[2].startsWith("month") ? 30 : 1;
    return Math.min(730, Math.max(1, n * unit));
  }
  if (/\b(this|last|past)\s+week\b/.test(q)) return 7;
  if (/\b(this|last|past)\s+month\b/.test(q)) return 30;
  if (/\b(this|last|past)\s+quarter\b/.test(q)) return 90;
  if (/\b(this|last|past)\s+year\b/.test(q)) return 365;
  if (/\btoday\b/.test(q)) return 1;
  // A bare "7 days", as in "stuck for more than 14 days", is still a period — and that is
  // the most natural way to ask the one question that needs one.
  const bare = q.match(/(\d{1,3})\s*(day|days|week|weeks|month|months)/);
  if (bare) {
    const unit = bare[2].startsWith("week") ? 7 : bare[2].startsWith("month") ? 30 : 1;
    return Math.min(730, Math.max(1, Number(bare[1]) * unit));
  }
  return null;
}

/** A job named in quotes, or after "for"/"on" - the service checks it against real jobs. */
export function readJobHint(question: string): string | null {
  const quoted = question.match(/["“']([^"”']{2,80})["”']/);
  if (quoted) return quoted[1].trim();
  const after = question.match(/\b(?:for|on|in|of)\s+(?:the\s+)?([A-Za-z][\w/&().+-]*(?:\s+[A-Za-z][\w/&().+-]*){0,4})\s*(?:role|job|position|vacancy|pipeline|opening)?\s*[?.]?$/);
  if (after) {
    const hint = after[1].trim();
    if (hint.split(/\s+/).length <= 5 && !/^(the|us|me|now|today|this|that)$/i.test(hint)) return hint;
  }
  return null;
}

/**
 * Rule-based routing. Always available, and the fallback whenever the model is not
 * configured or declines. Scores each intent by how many of its cue groups the question
 * hits; a question that hits nothing is routed to `capabilities` rather than guessed at.
 */
export function routeQuestion(question: string): RoutedQuestion {
  const q = question.toLowerCase().trim();
  const days = readPeriod(question);
  const jobHint = readJobHint(question);

  if (!q) return { intent: "capabilities", confidence: 1, jobHint: null, days: null, searchPhrase: null };

  // Scored by how many of an intent's cue groups the question hits, not how many words it
  // matches. "best" + "candidates" hits both of top_candidates' groups and wins outright,
  // while a question that only says "candidates" hits half of it and loses to an intent
  // whose single group it hits squarely. Counting words instead let one plural
  // ("candidates" containing "candidate") outscore the intent actually being asked about.
  let best: { intent: Intent; score: number } = { intent: "capabilities", score: 0 };
  for (const spec of Object.values(INTENT_SPECS)) {
    if (spec.intent === "capabilities") continue;
    const groups = spec.cues.filter((g) => g.length);
    if (!groups.length) continue;
    let hitGroups = 0;
    let hits = 0;
    for (const group of groups) {
      const matched = group.filter((cue) => q.includes(cue)).length;
      if (matched) hitGroups++;
      hits += matched;
    }
    if (!hitGroups) continue;
    const score = hitGroups / groups.length + hits * 0.01;
    if (score > best.score) best = { intent: spec.intent, score };
  }

  if (INTENT_SPECS.capabilities.cues[0].some((cue) => q.includes(cue))) {
    return { intent: "capabilities", confidence: 0.9, jobHint: null, days: null, searchPhrase: null };
  }
  if (!best.score) return { intent: "capabilities", confidence: 0.3, jobHint, days, searchPhrase: null };

  // "Do we have anyone with Kubernetes?" is a pool search, and the whole question is the phrase.
  const searchPhrase = best.intent === "find_candidates" ? stripSearchPreamble(question) : null;
  const confidence = Math.round(Math.min(0.85, 0.4 + best.score * 0.4) * 100) / 100;
  return { intent: best.intent, confidence, jobHint, days, searchPhrase };
}

/** Turns "do we have anyone with 3 years of React?" into "3 years of React". */
export function stripSearchPreamble(question: string): string {
  return question
    .replace(/^\s*(?:do we have|have we got|is there|are there|can you find|find me|find|search for|search|look for|show me|who are)\s+/i, "")
    .replace(/^\s*(?:any\s+)?(?:one|body|anyone|anybody|someone|somebody|candidates?|people|profiles?)\s*(?:who\s+)?(?:has|have|knows?|with|that)?\s*/i, "")
    .replace(/\s*[?.!]+\s*$/, "")
    .trim();
}

export function capabilitiesAnswer(allowed: IntentSpec[]): string {
  const lines = allowed.filter((s) => s.intent !== "capabilities").map((s) => `• ${s.summary}`);
  return [
    "I answer questions about your own hiring data, and every number I give is computed here and shown beside the answer, so you can check it.",
    "",
    ...lines,
    "",
    "I do not decide anything: I will not tell you who to hire, reject or advance. Ask me what the data says and the judgement stays yours.",
  ].join("\n");
}
