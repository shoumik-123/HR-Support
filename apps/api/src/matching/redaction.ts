/**
 * Removes identity and protected-characteristic information from resume text before it is
 * used for matching. CVs in Bangladesh commonly include a "Personal Information" block
 * (father's/mother's name, date of birth, religion, marital status, nationality, NID,
 * blood group); none of it is job-related, so whole lines that carry it are dropped.
 */
// Unambiguous phrases match anywhere; everyday words (age, sex, race, height...) only as a
// "Label: value" field, so lines like "race condition" or "single-page app" survive.
const PROTECTED_LINE = new RegExp(
  [
    String.raw`\b(date of birth|d\.o\.b|birth ?date|born on|religion|religious|marital status|unmarried|spouse'?s? name|husband'?s? name|wife'?s? name|father'?s? name|mother'?s? name|nationality|national id|nid no|passport no|blood group|caste|ethnicity|disability|permanent address|present address)\b`,
    String.raw`^\W*(age|gender|sex|race|height|weight|dob|religion|marital|father|mother|spouse|photo)\s*[:\-–]`,
    "জন্ম|ধর্ম|বৈবাহিক|পিতা|মাতা|জাতীয়তা|লিঙ্গ",
  ].join("|"),
  "i",
);

export function redactResumeText(text: string, identifiers: (string | null | undefined)[]): string {
  const names = identifiers
    .filter((s): s is string => !!s && s.trim().length > 1)
    .flatMap((s) => [s, ...s.split(/\s+/).filter((part) => part.length > 2)]);
  const nameRe = names.length
    ? new RegExp(`\\b(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")
    : null;

  return text
    .split(/\r?\n/)
    .filter((line) => !PROTECTED_LINE.test(line))
    .map((line) => {
      let out = line
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
        .replace(/https?:\/\/\S+|(?:www\.)?(?:linkedin|github|facebook)\.com\/\S+/gi, "[link]")
        .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
      if (nameRe) out = out.replace(nameRe, "[candidate]");
      return out;
    })
    .join("\n");
}

/** True if a snippet still carries protected info and must not be shown as match evidence. */
export function isProtectedSnippet(snippet: string): boolean {
  return PROTECTED_LINE.test(snippet);
}
