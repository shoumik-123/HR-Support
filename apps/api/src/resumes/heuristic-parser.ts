import { ParsedResume } from "./parsed-resume";
import { findSkills } from "./skills";

/**
 * Deterministic resume parser used when AI is unavailable (or as a cross-check).
 * Extracts contact details, skills and an experience estimate with evidence lines.
 * Confidence values are deliberately conservative.
 */
export function heuristicParse(text: string): ParsedResume {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = findPhone(text);
  const linkedinUrl = matchUrl(text, /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s,;)]+/i);
  const githubUrl = matchUrl(text, /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s,;)]+/i);
  const portfolioUrl =
    text
      .match(/https?:\/\/[^\s,;)]+/gi)
      ?.find((u) => !/linkedin\.com|github\.com|mailto:/i.test(u)) ?? null;
  const fullName = guessName(lines, email);

  const skills = findSkills(text).map((s) => ({ name: s.name, category: null, evidence: s.evidence, confidence: 0.6 }));
  const { years, evidence: expEvidence } = estimateExperience(text);
  const education = findEducation(lines);
  const languages = findLanguages(text);
  const resumeLanguage = /[ঀ-৿]/.test(text) && (text.match(/[ঀ-৿]/g)?.length ?? 0) > text.length * 0.3 ? "Bengali" : "English";

  const missingFields: string[] = [];
  if (!fullName) missingFields.push("full name");
  if (!email) missingFields.push("email");
  if (!phone) missingFields.push("phone");
  if (!skills.length) missingFields.push("skills");
  if (years == null) missingFields.push("employment dates");
  if (!education.length) missingFields.push("education");

  return {
    resumeLanguage,
    contact: { fullName, email, phone, location: null, linkedinUrl, githubUrl, portfolioUrl },
    headline: null,
    summary: null,
    totalExperienceYears: years,
    skills,
    experience: expEvidence.length
      ? [
          {
            title: "Employment history (not itemised by heuristic parser)",
            company: null,
            startDate: null,
            endDate: null,
            isCurrent: false,
            description: null,
            evidence: expEvidence.slice(0, 5).join(" | "),
            confidence: 0.3,
          },
        ]
      : [],
    education,
    certifications: [],
    projects: [],
    languages,
    missingFields,
    overallConfidence: Math.min(0.6, 0.15 + (email ? 0.1 : 0) + (phone ? 0.1 : 0) + (skills.length ? 0.15 : 0) + (years != null ? 0.1 : 0)),
  };
}

function matchUrl(text: string, re: RegExp): string | null {
  const m = text.match(re)?.[0];
  if (!m) return null;
  return m.startsWith("http") ? m : `https://${m}`;
}

export function findPhone(text: string): string | null {
  // Bangladesh mobile numbers first (+880 1XXXXXXXXX / 01XXXXXXXXX), then generic international.
  const bd = text.match(/(?:\+?880[\s-]?)?0?1[3-9]\d{2}[\s-]?\d{3}[\s-]?\d{3}/);
  if (bd) return bd[0].trim();
  const intl = text.match(/\+?\d[\d\s().-]{8,16}\d/);
  if (intl && intl[0].replace(/\D/g, "").length >= 9) return intl[0].trim();
  return null;
}

/** Digits-only phone key for duplicate detection; strips country code 880/leading 0. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880")) digits = digits.slice(3);
  digits = digits.replace(/^0+/, "");
  return digits.length >= 8 ? digits : null;
}

const HEADING = /^(curriculum vitae|resume|résumé|cv|profile|summary|objective|contact|personal|career)/i;

function guessName(lines: string[], email: string | null): string | null {
  for (const line of lines.slice(0, 8)) {
    if (HEADING.test(line) || /@|\d{3}|http/i.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 5 && words.every((w) => /^[\p{Lu}][\p{L}.'-]*$/u.test(w) || /^[\p{Lu}.'-]+$/u.test(w))) {
      return words.map((w) => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");
    }
  }
  if (email) {
    const local = email.split("@")[0].replace(/\d+/g, "");
    const parts = local.split(/[._-]/).filter((p) => p.length > 1);
    if (parts.length >= 2) return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (name: string) => Math.max(0, MONTHS.indexOf(name.toLowerCase().slice(0, 3)));

/**
 * Sum non-overlapping employment date ranges like "Jan 2019 - Present" or "2017 – 2020".
 * Education ranges are excluded when the line looks academic.
 */
export function estimateExperience(text: string, now = new Date()): { years: number | null; evidence: string[] } {
  const re =
    /(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})\s*(?:-|–|—|to|until)\s*(?:(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})|(present|current|now|till date|date|ongoing))/gi;
  const ranges: [number, number][] = [];
  const evidence: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/universit|college|school|b\.?sc|m\.?sc|bachelor|master|diploma|hsc|ssc|degree|cgpa|gpa/i.test(line)) continue;
    for (const m of line.matchAll(re)) {
      const start = Number(m[2]) * 12 + (m[1] ? monthIndex(m[1]) : 0);
      // A known end month is inclusive ("Jan 2020 - Dec 2020" = 12 months); a year-only end is
      // exclusive, so "2015 - 2020" reads as 5 years rather than 5 years 11 months.
      const end = m[5] ? now.getFullYear() * 12 + now.getMonth() : Number(m[4]) * 12 + (m[3] ? monthIndex(m[3]) + 1 : 0);
      if (end > start && end - start < 50 * 12) {
        ranges.push([start, end]);
        evidence.push(line.trim().slice(0, 200));
      }
    }
  }
  if (!ranges.length) return { years: null, evidence };
  ranges.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let [curStart, curEnd] = ranges[0];
  for (const [s, e] of ranges.slice(1)) {
    if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else {
      months += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  months += curEnd - curStart;
  return { years: Math.round((months / 12) * 10) / 10, evidence };
}

const DEGREE = /\b(ph\.?d|doctorate|m\.?sc|mba|m\.?a\b|master'?s?|m\.?eng|b\.?sc|bba|b\.?a\b|bachelor'?s?|b\.?eng|b\.?tech|diploma|hsc|ssc|a[- ]levels?|o[- ]levels?)/i;

const INSTITUTION_WORD = /universit|college|institute|school|academy|polytechnic/i;

/** Institution by keyword, else the comma-separated part that is not degree, field, year or grade. */
function findInstitution(line: string): string | null {
  const parts = line.split(/[,|]/).map((p) => p.trim()).filter(Boolean);
  const byKeyword = parts.find((p) => INSTITUTION_WORD.test(p));
  if (byKeyword) return byKeyword;
  const candidate = parts.find(
    (p, i) => i > 0 && !DEGREE.test(p) && !/^\(?(19|20)\d{2}/.test(p) && !/c?gpa|grade|division|class/i.test(p) && /[A-Za-z]{2}/.test(p),
  );
  return candidate ?? null;
}

function findEducation(lines: string[]): ParsedResume["education"] {
  return lines
    .filter((l) => DEGREE.test(l))
    .slice(0, 6)
    .map((l) => ({
      degree: l.match(DEGREE)?.[0] ?? null,
      field: l.match(/\bin\s+([^,|(]{3,60})/i)?.[1]?.trim() ?? null,
      institution: findInstitution(l),
      endYear: l.match(/(?:19|20)\d{2}(?!.*(?:19|20)\d{2})/)?.[0] ?? null,
      grade: l.match(/c?gpa[:\s]*\d(?:\.\d+)?(?:\s*\/\s*\d(?:\.\d+)?)?/i)?.[0] ?? null,
      evidence: l.slice(0, 240),
      confidence: 0.4,
    }));
}

const LANGUAGES = ["English", "Bengali", "Bangla", "Hindi", "Urdu", "Arabic", "Chinese", "Mandarin", "Japanese", "Korean", "French", "German", "Spanish", "Malay"];

function findLanguages(text: string): ParsedResume["languages"] {
  const section = text.match(/languages?\s*[:\n]([\s\S]{0,300})/i)?.[1] ?? "";
  if (!section) return [];
  const seen = new Set<string>();
  return LANGUAGES.filter((l) => new RegExp(`\\b${l}\\b`, "i").test(section))
    .map((l) => (l === "Bangla" ? "Bengali" : l))
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .map((name) => ({ name, proficiency: null }));
}
