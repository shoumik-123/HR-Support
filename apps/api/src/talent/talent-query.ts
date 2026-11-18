/**
 * Turning a recruiter's sentence into search criteria.
 *
 * "3+ years React developer in Dhaka, must know TypeScript, preferably AWS, no WordPress"
 * becomes a structured query that the scorer can apply to every candidate the same way.
 * The parse is the only part a model is ever asked to help with, and it never sees a
 * candidate - only the recruiter's own words.
 */
import { canonicalSkill, findSkills, skillPatterns } from "../resumes/skills";

export interface TalentQuery {
  requiredSkills: string[];
  preferredSkills: string[];
  /** Hard filter: a candidate who shows one of these is left out of the results entirely. */
  excludedSkills: string[];
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  locations: string[];
  /** Role phrases such as "senior frontend developer", matched against headline and job titles. */
  titles: string[];
  /** Everything else worth looking for in the resume text. */
  keywords: string[];
  education: string | null;
  tags: string[];
}

export interface ParsedQuery extends TalentQuery {
  /** Plain-language read-back, shown to the recruiter so a misreading is obvious. */
  interpretation: string;
  /** 0-1: how much of the sentence the parse actually accounted for. */
  confidence: number;
}

export const EMPTY_QUERY: TalentQuery = {
  requiredSkills: [],
  preferredSkills: [],
  excludedSkills: [],
  minExperienceYears: null,
  maxExperienceYears: null,
  locations: [],
  titles: [],
  keywords: [],
  education: null,
  tags: [],
};

/** Cities and divisions a Bangladeshi recruiter is likely to type without saying "in". */
const PLACES = [
  "dhaka", "chattogram", "chittagong", "sylhet", "khulna", "rajshahi", "barishal", "barisal",
  "rangpur", "mymensingh", "gazipur", "narayanganj", "cumilla", "comilla", "bogura", "bogra",
  "jashore", "jessore", "savar", "uttara", "gulshan", "banani", "motijheel", "dhanmondi",
  "cox's bazar", "coxs bazar", "remote", "hybrid", "onsite", "on-site",
];

const ROLE_WORDS = [
  "developer", "engineer", "designer", "manager", "analyst", "accountant", "officer", "executive",
  "intern", "lead", "architect", "scientist", "administrator", "admin", "consultant", "specialist",
  "coordinator", "assistant", "associate", "director", "head", "supervisor", "technician",
  "marketer", "writer", "editor", "recruiter", "teacher", "nurse", "doctor", "lawyer", "auditor",
  "tester", "qa", "sre", "devops", "support",
];

const SENIORITY = ["junior", "mid", "mid-level", "senior", "staff", "principal", "lead", "entry", "entry-level", "fresher", "graduate"];

const EDUCATION_TERMS: [RegExp, string][] = [
  [/\bph\.?d\b|\bdoctorate\b/i, "PhD"],
  [/\bmasters?\b|\bm\.?sc\b|\bmba\b|\bm\.?eng\b|\bpostgraduate\b/i, "Master's degree"],
  [/\bbachelors?\b|\bb\.?sc\b|\bbba\b|\bb\.?eng\b|\bb\.?tech\b|\bhonours\b|\bhonors\b|\bundergraduate\b/i, "Bachelor's degree"],
  [/\bdiploma\b|\bhsc\b|\ba[- ]level\b|\bhigher secondary\b/i, "Diploma or HSC"],
];

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "with", "without", "who", "whom", "that", "this", "those", "these",
  "for", "from", "in", "at", "on", "of", "to", "by", "as", "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "can", "could", "should", "would", "will", "shall", "may", "might", "must", "need",
  "needs", "needed", "want", "wants", "wanted", "looking", "look", "find", "show", "me", "us", "i", "we",
  "you", "someone", "anyone", "somebody", "people", "person", "candidate", "candidates", "profile",
  "profiles", "resume", "resumes", "cv", "cvs", "applicant", "applicants", "experience", "experienced",
  "year", "years", "yr", "yrs", "least", "most", "more", "than", "over", "under", "up", "about", "around",
  "good", "great", "strong", "solid", "excellent", "best", "top", "any", "all", "some", "please", "also",
  "knows", "know", "knowledge", "skill", "skills", "skilled", "work", "working", "worked", "role", "roles",
  "job", "jobs", "position", "positions", "prefer", "preferably", "preferred", "ideally", "bonus", "plus",
  "nice", "must", "not", "no", "exclude", "excluding", "except", "optional", "based", "located", "near",
  "level", "new", "old", "only", "other", "both", "very", "well", "hiring", "hire", "search", "searching",
  "degree", "degrees", "qualification", "qualifications", "background",
  // Intensifiers carry no search meaning, and left in they become terms to hunt for.
  "really", "truly", "quite", "fairly", "rather", "pretty", "highly", "super", "extremely",
  "maybe", "perhaps", "kindly", "urgent", "urgently", "asap", "somebody", "anybody",
]);

const BENGALI_DIGITS: Record<string, string> = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };

/** Bengali numerals and the word for "years" are normalised so "৩ বছর" reads as "3 years". */
function normalise(text: string): string {
  return text
    .replace(/[০-৯]/g, (d) => BENGALI_DIGITS[d] ?? d)
    .replace(/বছরের|বছর/g, " years ")
    .replace(/\s+/g, " ")
    .trim();
}

const clampYears = (n: number) => Math.max(0, Math.min(60, n));

/** Pulls experience bounds out and returns the sentence with those phrases removed. */
function takeExperience(text: string): { min: number | null; max: number | null; rest: string } {
  let min: number | null = null;
  let max: number | null = null;
  let rest = text;

  const eat = (re: RegExp, use: (m: RegExpMatchArray) => void) => {
    const m = rest.match(re);
    if (!m) return;
    use(m);
    rest = rest.replace(m[0], " ");
  };

  // Ranges first: "3-5 years" must not be read as a 3-year minimum.
  eat(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:\+\s*)?years?/i, (m) => {
    min = clampYears(Number(m[1]));
    max = clampYears(Number(m[2]));
  });
  eat(/(?:at least|minimum(?: of)?|min\.?|more than|over|above)\s*(\d+(?:\.\d+)?)\s*years?/i, (m) => (min ??= clampYears(Number(m[1]))));
  eat(/(\d+(?:\.\d+)?)\s*(?:\+|plus)\s*years?/i, (m) => (min ??= clampYears(Number(m[1]))));
  eat(/(?:up to|under|less than|below|at most|maximum(?: of)?|max\.?)\s*(\d+(?:\.\d+)?)\s*years?/i, (m) => (max ??= clampYears(Number(m[1]))));
  // A bare "3 years" is read as a floor, not an exact figure: a recruiter asking for three
  // years will take four, and the score - not a filter - handles someone with two and a half.
  eat(/(\d+(?:\.\d+)?)\s*years?/i, (m) => (min ??= clampYears(Number(m[1]))));

  if (min != null && max != null && min > max) [min, max] = [max, min];
  return { min, max, rest };
}

type Modality = "required" | "preferred" | "excluded";

const PREFERRED_RE = /\b(prefer|preferably|preferred|ideally|nice to have|bonus|optional|optionally|a plus|advantage)\b/i;
const EXCLUDED_RE = /\b(not|no|without|exclude|excluding|except|avoid)\b|ছাড়া/i;

function modalityOf(clause: string): Modality {
  if (EXCLUDED_RE.test(clause)) return "excluded";
  if (PREFERRED_RE.test(clause)) return "preferred";
  return "required";
}

/**
 * Splits on punctuation and the connectives that usually separate requirements. A full stop
 * only separates when a space follows it, or "Node.js" and "Next.js" would be torn in half -
 * and the "js" left behind would be read as a requirement for JavaScript.
 */
function clauses(text: string): string[] {
  return text
    .split(/[,;()\n]|\.(?=\s|$)|\bbut\b|\balso\b|\bwith\b|\band\b/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

function takeTitles(text: string): { titles: string[]; rest: string } {
  const titles: string[] = [];
  let rest = text;
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase().replace(/[^a-z-]/g, "");
    if (!ROLE_WORDS.includes(word)) continue;
    // Take the qualifiers that sit in front of the role word ("senior frontend developer").
    const parts: string[] = [];
    for (let j = Math.max(0, i - 2); j < i; j++) {
      const prev = words[j].toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
      if (!prev || STOPWORDS.has(prev)) continue;
      parts.push(prev);
    }
    const phrase = [...parts, word].join(" ");
    titles.push(phrase);
    rest = rest.replace(new RegExp(parts.concat(word).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i"), " ");
  }
  return { titles: [...new Set(titles)], rest };
}

function takeLocations(text: string): { locations: string[]; rest: string } {
  const locations: string[] = [];
  let rest = text;

  for (const place of PLACES) {
    const re = new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(rest)) {
      locations.push(place === "coxs bazar" ? "Cox's Bazar" : place);
      rest = rest.replace(re, " ");
    }
  }
  // "in Narsingdi" - a place the list does not know, but the preposition gives it away.
  const m = rest.match(/\b(?:in|at|from|based in|located in|near)\s+([a-z][a-z'\- ]{2,30}?)(?=\s*(?:[,;.]|$|\bwho\b|\bwith\b|\band\b|\bwho\b))/i);
  if (m && !STOPWORDS.has(m[1].trim().toLowerCase())) {
    locations.push(m[1].trim());
    rest = rest.replace(m[0], " ");
  }
  return { locations: [...new Set(locations.map((l) => l.replace(/\b\w/g, (c) => c.toUpperCase())))], rest };
}

/** First spelling wins, so the recruiter sees the word back as they typed it. */
function dedupe(words: string[]): string[] {
  const seen = new Set<string>();
  return words.filter((w) => {
    const key = w.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Removes every spelling of a skill - canonical and alias - so it cannot also become a keyword. */
function stripSkill(text: string, skill: string): string {
  let out = text;
  // skillPatterns covers the canonical spelling and every alias, which is exactly the set
  // of words that already counted as this skill.
  for (const pattern of skillPatterns(skill)) out = out.replace(new RegExp(pattern.source, "gi"), " ");
  return out;
}

/**
 * Rule-based query parsing. Always available, and the fallback whenever the model is not
 * configured or declines. Deliberately conservative: a word it cannot place becomes a
 * keyword rather than being silently dropped.
 */
export function parseQuery(raw: string): ParsedQuery {
  const text = normalise(raw);
  if (!text) return { ...EMPTY_QUERY, interpretation: "An empty search returns the whole talent pool, newest first.", confidence: 1 };

  const tags = [...text.matchAll(/(?:^|\s)(?:#|tag:)([a-z0-9][\w-]{0,40})/gi)].map((m) => m[1]);
  let working = text.replace(/(?:^|\s)(?:#|tag:)[a-z0-9][\w-]{0,40}/gi, " ");

  const experience = takeExperience(working);
  working = experience.rest;

  const education = EDUCATION_TERMS.find(([re]) => re.test(working));
  if (education) working = working.replace(education[0], " ");

  const location = takeLocations(working);
  working = location.rest;

  // Skills are read per clause so "must know TypeScript, preferably AWS, no WordPress" splits
  // three ways. A clause's modality applies to every skill named inside it.
  // Each clause is read on its own terms, because modality is local: in "must know
  // TypeScript, preferably AWS, no WordPress" the three clauses mean three different things.
  // Words a clause leaves over follow its modality too - "no WordPress" must rule WordPress
  // out, not quietly turn it into something to search for.
  const buckets: Record<Modality, string[]> = { required: [], preferred: [], excluded: [] };
  const titles: string[] = [];
  const positive: string[] = [];
  const negative: string[] = [];
  const seniority = SENIORITY.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(text));

  for (const clause of clauses(working)) {
    const modality = modalityOf(clause);
    let rest = clause;
    for (const { name } of findSkills(clause)) {
      if (!buckets[modality].includes(name)) buckets[modality].push(name);
      rest = stripSkill(rest, name);
    }
    const titlePass = takeTitles(rest);
    rest = titlePass.rest;
    if (modality === "excluded") negative.push(...titlePass.titles);
    else titles.push(...titlePass.titles);

    const words = rest
      .split(/[^A-Za-z0-9+#.]+/)
      .map((w) => w.replace(/^[.#]+|[.#]+$/g, ""))
      .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()) && !/^\d+$/.test(w) && !seniority.includes(w.toLowerCase()));
    (modality === "excluded" ? negative : positive).push(...words);
  }

  // A skill the taxonomy recognises in the sentence but that no clause claimed - a one-word
  // query, say - is still a requirement.
  for (const { name } of findSkills(working)) {
    if (!buckets.required.includes(name) && !buckets.preferred.includes(name) && !buckets.excluded.includes(name)) {
      buckets.required.push(name);
    }
  }

  const excluded = dedupe([...buckets.excluded, ...negative]);
  const keywords = dedupe(positive).filter((k) => !excluded.some((e) => e.toLowerCase() === k.toLowerCase())).slice(0, 8);

  const query: TalentQuery = {
    requiredSkills: buckets.required.filter((s) => !excluded.some((e) => e.toLowerCase() === s.toLowerCase())),
    preferredSkills: buckets.preferred.filter((s) => !excluded.some((e) => e.toLowerCase() === s.toLowerCase())),
    excludedSkills: excluded,
    minExperienceYears: experience.min,
    maxExperienceYears: experience.max,
    locations: location.locations,
    titles: dedupe(titles).slice(0, 4),
    keywords,
    education: education?.[1] ?? null,
    tags,
  };

  return { ...query, interpretation: describeQuery(query), confidence: parseConfidence(query, keywords.length) };
}

/** How much of the sentence turned into something searchable. */
function parseConfidence(q: TalentQuery, leftovers: number): number {
  const placed =
    q.requiredSkills.length + q.preferredSkills.length + q.excludedSkills.length + q.locations.length + q.titles.length + q.tags.length +
    (q.minExperienceYears != null ? 1 : 0) + (q.maxExperienceYears != null ? 1 : 0) + (q.education ? 1 : 0);
  if (!placed && !leftovers) return 0.3;
  const ratio = placed / (placed + leftovers);
  return Math.round(Math.max(0.3, Math.min(0.9, 0.4 + ratio * 0.5)) * 100) / 100;
}

/** One sentence the recruiter can check the parse against. */
export function describeQuery(q: TalentQuery): string {
  const parts: string[] = [];
  if (q.titles.length) parts.push(`role like ${q.titles.join(" or ")}`);
  if (q.requiredSkills.length) parts.push(`must show ${q.requiredSkills.join(", ")}`);
  if (q.preferredSkills.length) parts.push(`${q.preferredSkills.join(", ")} as a bonus`);
  if (q.excludedSkills.length) parts.push(`leaving out anyone with ${q.excludedSkills.join(", ")}`);
  if (q.minExperienceYears != null && q.maxExperienceYears != null) parts.push(`${q.minExperienceYears}-${q.maxExperienceYears} years of experience`);
  else if (q.minExperienceYears != null) parts.push(`around ${q.minExperienceYears}+ years of experience`);
  else if (q.maxExperienceYears != null) parts.push(`up to ${q.maxExperienceYears} years of experience`);
  if (q.education) parts.push(`${q.education} or above`);
  if (q.locations.length) parts.push(`in ${q.locations.join(" or ")}`);
  if (q.tags.length) parts.push(`tagged ${q.tags.join(", ")}`);
  if (q.keywords.length) parts.push(`mentioning ${q.keywords.join(", ")}`);
  if (!parts.length) return "Nothing specific was recognised, so the whole talent pool is ranked by how recently it was updated.";
  return `Looking for candidates ${parts.join("; ")}.`;
}

/** True when there is nothing to rank by, so the result is just the pool. */
export function isEmptyQuery(q: TalentQuery): boolean {
  return (
    !q.requiredSkills.length && !q.preferredSkills.length && !q.titles.length && !q.keywords.length &&
    !q.locations.length && !q.tags.length && q.minExperienceYears == null && q.maxExperienceYears == null && !q.education
  );
}

/** Trim, canonicalise and bound whatever came in, wherever it came from. */
export function normaliseQuery(input: Partial<TalentQuery>): TalentQuery {
  const list = (v: unknown, limit: number, canonical = false) =>
    Array.isArray(v)
      ? [...new Set(v.filter((s): s is string => typeof s === "string").map((s) => (canonical ? canonicalSkill(s.trim()) : s.trim())).filter((s) => s && s.length <= 80))].slice(0, limit)
      : [];
  const years = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(60, Math.round(v * 10) / 10)) : null);

  // Case-insensitively, because a skill the taxonomy does not know keeps whatever case it
  // was typed in: "WordPress" and "wordpress" are the same exclusion.
  const excludedSkills = list(input.excludedSkills, 10, true);
  const notExcluded = (s: string) => !excludedSkills.some((e) => e.toLowerCase() === s.toLowerCase());
  const requiredSkills = list(input.requiredSkills, 15, true).filter(notExcluded);
  const preferredSkills = list(input.preferredSkills, 15, true).filter((s) => notExcluded(s) && !requiredSkills.some((r) => r.toLowerCase() === s.toLowerCase()));
  let min = years(input.minExperienceYears);
  let max = years(input.maxExperienceYears);
  if (min != null && max != null && min > max) [min, max] = [max, min];

  return {
    ...EMPTY_QUERY,
    requiredSkills,
    preferredSkills,
    excludedSkills,
    minExperienceYears: min,
    maxExperienceYears: max,
    locations: list(input.locations, 6),
    titles: list(input.titles, 4),
    keywords: list(input.keywords, 10),
    education: typeof input.education === "string" && input.education.trim() ? input.education.trim().slice(0, 80) : null,
    tags: list(input.tags, 10),
  };
}
