/**
 * Ranking for talent-pool search.
 *
 * A model may help read the recruiter's sentence, but nothing here is a model's opinion:
 * every candidate is scored by the same arithmetic, against the same criteria, with the
 * resume line that justifies each point attached as evidence. Two searches with the same
 * criteria always produce the same order.
 */
import { canonicalSkill, skillPatterns } from "../resumes/skills";
import { isProtectedSnippet } from "../matching/redaction";
import { TalentQuery } from "./talent-query";

export type SearchCriterion = "skills" | "experience" | "role" | "keywords" | "location" | "education";

/** Weights are percentages; a criterion the query says nothing about is dropped and the rest share its weight. */
export const SEARCH_WEIGHTS: Record<SearchCriterion, number> = {
  skills: 40,
  experience: 20,
  role: 15,
  keywords: 10,
  location: 10,
  education: 5,
};

export interface SearchCriterionResult {
  criterion: SearchCriterion;
  /** 0-100, or null when the query sets no requirement for this criterion. */
  score: number | null;
  weight: number;
  rationale: string;
  evidence: string[];
}

export interface SearchSubject {
  id: string;
  fullName: string;
  headline: string | null;
  summary: string | null;
  location: string | null;
  skills: string[];
  tags: string[];
  totalExperienceYears: number | null;
  /** Latest resume text, already redacted when the viewer must not see identity. */
  resumeText: string;
  /** Job titles from the parsed resume, used for role relevance. */
  jobTitles: string[];
  educationText: string;
  parseConfidence: number;
  updatedAt: Date;
}

export interface SearchHit {
  score: number;
  breakdown: SearchCriterionResult[];
  matchedSkills: string[];
  missingSkills: string[];
  /** Why this candidate is in the list, in the recruiter's own terms. */
  reasons: string[];
  gaps: string[];
  confidence: number;
}

const EDU_LEVELS: [RegExp, number, string][] = [
  [/ph\.?d|doctor/i, 4, "doctorate"],
  [/master|m\.?sc|mba|m\.?eng|postgraduate/i, 3, "master's"],
  [/bachelor|b\.?sc|bba|b\.?eng|b\.?tech|honours|honors|undergraduate|graduate/i, 2, "bachelor's"],
  [/diploma|hsc|a[- ]level|higher secondary/i, 1, "diploma/HSC"],
];

function eduLevel(text: string): number | null {
  for (const [re, level] of EDU_LEVELS) if (re.test(text)) return level;
  return null;
}

const levelName = (l: number) => EDU_LEVELS.find(([, n]) => n === l)?.[2] ?? "unspecified";

/** Weighted mean over the criteria the query actually asked about. */
export function aggregateSearch(breakdown: { score: number | null; weight: number }[]): number {
  const applicable = breakdown.filter((b) => b.score != null && b.weight > 0);
  const total = applicable.reduce((s, b) => s + b.weight, 0);
  if (!total) return 0;
  return Math.round(applicable.reduce((s, b) => s + (b.score as number) * b.weight, 0) / total);
}

function lines(subject: SearchSubject): string[] {
  return [subject.headline, subject.summary, subject.resumeText]
    .filter((s): s is string => !!s)
    .flatMap((s) => s.split(/\r?\n/))
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Where the candidate shows a skill: their own skill list first, then the resume text. */
function locate(skill: string, subject: SearchSubject, textLines: string[]): string | null {
  const canon = canonicalSkill(skill).toLowerCase();
  const patterns = skillPatterns(skill);
  const listed = subject.skills.some((s) => canonicalSkill(s).toLowerCase() === canon);
  const line = textLines.find((l) => patterns.some((p) => p.test(l)) && !isProtectedSnippet(l));
  if (line) return line.slice(0, 200);
  return listed ? `Listed skill: ${canonicalSkill(skill)}` : null;
}

/** True when the candidate shows an excluded skill, which takes them out of the results. */
export function hasExcludedSkill(query: TalentQuery, subject: SearchSubject): string | null {
  const textLines = lines(subject);
  for (const skill of query.excludedSkills) {
    if (locate(skill, subject, textLines)) return canonicalSkill(skill);
  }
  return null;
}

export function scoreSubject(query: TalentQuery, subject: SearchSubject): SearchHit {
  const textLines = lines(subject);
  const haystack = [subject.headline ?? "", subject.summary ?? "", subject.skills.join(" "), subject.jobTitles.join(" "), subject.resumeText]
    .join("\n")
    .toLowerCase();
  const reasons: string[] = [];
  const gaps: string[] = [];

  // ── Skills: a required skill counts double, exactly as job matching weights it.
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  const skillEvidence: string[] = [];
  let requiredHits = 0;
  let preferredHits = 0;
  for (const skill of query.requiredSkills) {
    const ev = locate(skill, subject, textLines);
    if (ev) {
      requiredHits++;
      matchedSkills.push(canonicalSkill(skill));
      skillEvidence.push(ev);
    } else missingSkills.push(canonicalSkill(skill));
  }
  for (const skill of query.preferredSkills) {
    const ev = locate(skill, subject, textLines);
    if (ev) {
      preferredHits++;
      matchedSkills.push(canonicalSkill(skill));
      skillEvidence.push(ev);
    }
  }
  const skillDenom = query.requiredSkills.length * 2 + query.preferredSkills.length;
  const skills: SearchCriterionResult = {
    criterion: "skills",
    weight: SEARCH_WEIGHTS.skills,
    score: skillDenom ? Math.round(((requiredHits * 2 + preferredHits) / skillDenom) * 100) : null,
    rationale: skillDenom
      ? `${requiredHits}/${query.requiredSkills.length} required and ${preferredHits}/${query.preferredSkills.length} preferred skills found.`
      : "The search named no skills.",
    evidence: [...new Set(skillEvidence)].slice(0, 6),
  };
  if (query.requiredSkills.length && requiredHits === query.requiredSkills.length) reasons.push(`Shows every skill you asked for: ${query.requiredSkills.join(", ")}`);
  else if (requiredHits) reasons.push(`Shows ${matchedSkills.slice(0, 4).join(", ")}`);
  if (missingSkills.length) gaps.push(`No evidence of ${missingSkills.join(", ")}`);

  // ── Experience: never zero for a missing figure, because a resume the parser could not
  //    date is a gap in our data, not a gap in the candidate.
  let experience: SearchCriterionResult;
  const years = subject.totalExperienceYears;
  if (query.minExperienceYears == null && query.maxExperienceYears == null) {
    experience = { criterion: "experience", weight: SEARCH_WEIGHTS.experience, score: null, rationale: "The search set no experience range.", evidence: [] };
  } else if (years == null) {
    experience = {
      criterion: "experience",
      weight: SEARCH_WEIGHTS.experience,
      score: 40,
      rationale: "Years of experience could not be read from the resume; check it before ruling them out.",
      evidence: [],
    };
    gaps.push("Experience duration unclear");
  } else {
    const min = query.minExperienceYears;
    const max = query.maxExperienceYears;
    let score: number;
    let rationale: string;
    if (min != null && years < min) {
      // Close is still interesting: 2.5 years against a 3-year ask scores 83, not 0.
      score = Math.max(10, Math.round((years / Math.max(min, 0.5)) * 100));
      rationale = `About ${years} years against the ${min} years you asked for.`;
      gaps.push(`${years} ${years === 1 ? "year" : "years"}, under the ${min} you asked for`);
    } else if (max != null && years > max) {
      // Over the top of the range is not a fault; it is simply further from the ask.
      score = Math.max(60, 100 - Math.round((years - max) * 8));
      rationale = `About ${years} years, above the ${max}-year top of your range (not penalised heavily).`;
    } else {
      score = 100;
      rationale = `About ${years} years of experience, inside your range.`;
      reasons.push(`${years} years of experience`);
    }
    experience = { criterion: "experience", weight: SEARCH_WEIGHTS.experience, score, rationale, evidence: [] };
  }

  // ── Role relevance: the words of the title, found in a headline or a past job title.
  let role: SearchCriterionResult;
  if (!query.titles.length) {
    role = { criterion: "role", weight: SEARCH_WEIGHTS.role, score: null, rationale: "The search named no role.", evidence: [] };
  } else {
    const roleEvidence: string[] = [];
    let best = 0;
    for (const title of query.titles) {
      const words = title.split(/\s+/).filter((w) => w.length > 2);
      const hits = words.filter((w) => haystack.includes(w.toLowerCase()));
      const ratio = words.length ? hits.length / words.length : 0;
      if (ratio > best) best = ratio;
      const line = textLines.find((l) => hits.some((w) => l.toLowerCase().includes(w.toLowerCase())) && !isProtectedSnippet(l));
      if (line) roleEvidence.push(line.slice(0, 200));
    }
    role = {
      criterion: "role",
      weight: SEARCH_WEIGHTS.role,
      score: Math.round(best * 100),
      rationale: best === 1 ? `Their history matches "${query.titles[0]}".` : best > 0 ? `Partly matches "${query.titles[0]}".` : `Nothing in their history mentions "${query.titles[0]}".`,
      evidence: [...new Set(roleEvidence)].slice(0, 3),
    };
    if (best === 1) reasons.push(`Has worked as ${query.titles[0]}`);
  }

  // ── Free keywords.
  let keywords: SearchCriterionResult;
  if (!query.keywords.length) {
    keywords = { criterion: "keywords", weight: SEARCH_WEIGHTS.keywords, score: null, rationale: "No extra terms to look for.", evidence: [] };
  } else {
    const found = query.keywords.filter((k) => haystack.includes(k.toLowerCase()));
    const kwEvidence = found
      .map((k) => textLines.find((l) => l.toLowerCase().includes(k.toLowerCase()) && !isProtectedSnippet(l)))
      .filter((l): l is string => !!l)
      .map((l) => l.slice(0, 200));
    keywords = {
      criterion: "keywords",
      weight: SEARCH_WEIGHTS.keywords,
      score: Math.round((found.length / query.keywords.length) * 100),
      rationale: `${found.length} of ${query.keywords.length} search terms appear in their material${found.length ? `: ${found.join(", ")}` : ""}.`,
      evidence: [...new Set(kwEvidence)].slice(0, 4),
    };
  }

  // ── Location. "Remote" is treated as a term to find, not a place to be.
  let location: SearchCriterionResult;
  if (!query.locations.length) {
    location = { criterion: "location", weight: SEARCH_WEIGHTS.location, score: null, rationale: "The search named no location.", evidence: [] };
  } else if (!subject.location) {
    location = {
      criterion: "location",
      weight: SEARCH_WEIGHTS.location,
      score: 40,
      rationale: "No location on their profile; it may still be a fit.",
      evidence: [],
    };
    gaps.push("Location unknown");
  } else {
    const here = subject.location.toLowerCase();
    const hit = query.locations.find((l) => here.includes(l.toLowerCase()) || haystack.includes(l.toLowerCase()));
    location = {
      criterion: "location",
      weight: SEARCH_WEIGHTS.location,
      score: hit ? 100 : 20,
      rationale: hit ? `Based in ${subject.location}.` : `Based in ${subject.location}, not ${query.locations.join(" or ")}.`,
      evidence: [],
    };
    if (hit) reasons.push(`In ${subject.location}`);
    else gaps.push(`Based in ${subject.location}`);
  }

  // ── Education level.
  let education: SearchCriterionResult;
  if (!query.education) {
    education = { criterion: "education", weight: SEARCH_WEIGHTS.education, score: null, rationale: "The search set no education requirement.", evidence: [] };
  } else {
    const asked = eduLevel(query.education);
    const held = eduLevel(`${subject.educationText}\n${subject.resumeText.slice(0, 4000)}`);
    let score: number;
    let rationale: string;
    if (held == null) {
      score = 40;
      rationale = "Education level could not be read from the resume.";
      gaps.push("Education not confirmed");
    } else if (asked == null || held >= asked) {
      score = 100;
      rationale = `Highest education: ${levelName(held)}.`;
    } else {
      score = held === asked - 1 ? 55 : 25;
      rationale = `Highest education: ${levelName(held)}; you asked for ${levelName(asked)}.`;
      gaps.push(`Education below ${levelName(asked)}`);
    }
    education = { criterion: "education", weight: SEARCH_WEIGHTS.education, score, rationale, evidence: [] };
  }

  const breakdown = [skills, experience, role, keywords, location, education];
  if (query.tags.length) {
    const matchedTags = query.tags.filter((t) => subject.tags.some((s) => s.toLowerCase() === t.toLowerCase()));
    if (matchedTags.length) reasons.push(`Tagged ${matchedTags.join(", ")}`);
  }

  return {
    score: aggregateSearch(breakdown),
    breakdown,
    matchedSkills: [...new Set(matchedSkills)],
    missingSkills,
    reasons: reasons.slice(0, 4),
    gaps: gaps.slice(0, 4),
    // Confidence is about the material, not the person: a thin resume means a shaky reading.
    confidence:
      Math.round(
        Math.min(0.9, 0.3 + 0.3 * subject.parseConfidence + (subject.resumeText.length > 400 ? 0.2 : 0) + (subject.skills.length ? 0.1 : 0)) * 100,
      ) / 100,
  };
}
