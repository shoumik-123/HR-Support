import { canonicalSkill, skillPatterns } from "../resumes/skills";
import { MatchingCriteria } from "./criteria";
import { aggregate, CriterionResult, MatchAnalysis, MatchCandidateProfile, MatchJob } from "./match-types";

const EDU_LEVELS: [RegExp, number, string][] = [
  [/ph\.?d|doctor/i, 4, "doctorate"],
  [/master|m\.?sc|mba|m\.?eng|m\.?a\b|postgraduate/i, 3, "master's"],
  [/bachelor|b\.?sc|bba|b\.?eng|b\.?tech|b\.?a\b|undergraduate|graduate|honours|honors/i, 2, "bachelor's"],
  [/diploma|hsc|a[- ]level|higher secondary/i, 1, "diploma/HSC"],
];

function eduLevel(text: string | null | undefined): number | null {
  if (!text) return null;
  for (const [re, level] of EDU_LEVELS) if (re.test(text)) return level;
  return null;
}

const levelName = (l: number) => EDU_LEVELS.find(([, n]) => n === l)?.[2] ?? "unspecified";

/** Find where the candidate shows a skill: their skill list first, then the resume text. */
function locateSkill(skill: string, profile: MatchCandidateProfile, lines: string[]): string | null {
  const canon = canonicalSkill(skill).toLowerCase();
  if (profile.skills.some((s) => canonicalSkill(s).toLowerCase() === canon)) {
    const patterns = skillPatterns(skill);
    return lines.find((l) => patterns.some((p) => p.test(l)))?.slice(0, 200) ?? `Listed skill: ${skill}`;
  }
  const patterns = skillPatterns(skill);
  return lines.find((l) => patterns.some((p) => p.test(l)))?.slice(0, 200) ?? null;
}

/**
 * Transparent rule-based matching. Only job-related qualifications are used:
 * skills, experience duration, education level, projects and certifications.
 */
export function heuristicMatch(job: MatchJob, profile: MatchCandidateProfile, resumeText: string, criteria: MatchingCriteria): MatchAnalysis {
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const strengths: string[] = [];
  const gaps: string[] = [];

  // Skills
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  const skillEvidence: string[] = [];
  let reqHit = 0;
  let prefHit = 0;
  for (const skill of job.requiredSkills) {
    const ev = locateSkill(skill, profile, lines);
    if (ev) {
      reqHit++;
      matchedSkills.push(skill);
      skillEvidence.push(ev);
    } else missingSkills.push(skill);
  }
  for (const skill of job.preferredSkills) {
    const ev = locateSkill(skill, profile, lines);
    if (ev) {
      prefHit++;
      matchedSkills.push(skill);
      skillEvidence.push(ev);
    }
  }
  const skillDenom = job.requiredSkills.length * 2 + job.preferredSkills.length;
  const skills: CriterionResult = {
    criterion: "skills",
    weight: criteria.skills,
    score: skillDenom ? Math.round(((reqHit * 2 + prefHit) / skillDenom) * 100) : null,
    rationale: skillDenom
      ? `${reqHit}/${job.requiredSkills.length} required and ${prefHit}/${job.preferredSkills.length} preferred skills found in the resume.`
      : "The job lists no skills to match.",
    evidence: [...new Set(skillEvidence)].slice(0, 8),
  };
  if (job.requiredSkills.length && reqHit === job.requiredSkills.length) strengths.push("Has every required skill");
  if (missingSkills.length) gaps.push(`Missing required skills: ${missingSkills.join(", ")}`);

  // Experience
  const years = profile.totalExperienceYears;
  let experience: CriterionResult;
  if (job.minExperienceYears == null) {
    experience = { criterion: "experience", weight: criteria.experience, score: null, rationale: "No minimum experience set for this job.", evidence: [] };
  } else if (years == null) {
    experience = {
      criterion: "experience",
      weight: criteria.experience,
      score: 40,
      rationale: "Employment dates could not be determined from the resume; verify manually.",
      evidence: [],
    };
    gaps.push("Experience duration unclear");
  } else {
    const min = job.minExperienceYears;
    const score = min === 0 ? 100 : Math.min(100, Math.round((years / min) * 100));
    const over = job.maxExperienceYears != null && years > job.maxExperienceYears;
    experience = {
      criterion: "experience",
      weight: criteria.experience,
      score,
      rationale:
        `About ${years} years of experience against a minimum of ${min}.` +
        (over ? ` Exceeds the stated maximum of ${job.maxExperienceYears} years (not penalised).` : ""),
      evidence: profile.experience.map((e) => e.evidence).filter(Boolean).slice(0, 4),
    };
    if (years >= min) strengths.push(`${years} years of experience (minimum ${min})`);
    else gaps.push(`${years} years of experience, below the ${min}-year minimum`);
  }

  // Education
  let education: CriterionResult;
  const required = eduLevel(job.educationRequirement);
  if (!job.educationRequirement) {
    education = { criterion: "education", weight: criteria.education, score: null, rationale: "No education requirement set.", evidence: [] };
  } else {
    const levels = profile.education.map((e) => eduLevel(`${e.degree ?? ""} ${e.evidence}`)).filter((l): l is number => l != null);
    const best = levels.length ? Math.max(...levels) : null;
    let score: number;
    let rationale: string;
    if (best == null) {
      score = profile.education.length ? 50 : 30;
      rationale = profile.education.length ? "Education listed but the level is unclear." : "No education details found in the resume.";
      gaps.push("Education level not confirmed");
    } else if (required == null || best >= required) {
      score = 100;
      rationale = `Highest education: ${levelName(best)}${required ? `, meets the ${levelName(required)} requirement` : ""}.`;
    } else {
      score = best === required - 1 ? 50 : 20;
      rationale = `Highest education: ${levelName(best)}; the job asks for ${levelName(required)}.`;
      gaps.push(`Education below stated requirement (${levelName(required)})`);
    }
    education = { criterion: "education", weight: criteria.education, score, rationale, evidence: profile.education.map((e) => e.evidence).slice(0, 3) };
  }

  // Projects and certifications: relevance to the job's skills and title
  const jobTerms = [...job.requiredSkills, ...job.preferredSkills];
  const mentionsJobSkill = (text: string) => jobTerms.some((s) => skillPatterns(s).some((p) => p.test(text)));

  const relevantProjects = profile.projects.filter((p) => mentionsJobSkill(`${p.name} ${p.description ?? ""} ${p.technologies.join(" ")}`));
  const projects: CriterionResult = {
    criterion: "projects",
    weight: criteria.projects,
    score: jobTerms.length ? Math.min(100, relevantProjects.length * 50) : null,
    rationale: profile.projects.length
      ? `${relevantProjects.length} of ${profile.projects.length} listed projects use the job's skills.`
      : "No projects listed in the resume.",
    evidence: relevantProjects.map((p) => p.evidence).slice(0, 4),
  };
  if (relevantProjects.length >= 2) strengths.push(`${relevantProjects.length} relevant projects`);

  const titleWords = job.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const relevantCerts = profile.certifications.filter((c) => mentionsJobSkill(c.name) || titleWords.some((w) => c.name.toLowerCase().includes(w)));
  const certifications: CriterionResult = {
    criterion: "certifications",
    weight: criteria.certifications,
    score: relevantCerts.length ? Math.min(100, 60 + relevantCerts.length * 20) : profile.certifications.length ? 20 : 0,
    rationale: profile.certifications.length
      ? `${relevantCerts.length} of ${profile.certifications.length} certifications relate to this role.`
      : "No certifications listed.",
    evidence: relevantCerts.map((c) => c.evidence).slice(0, 4),
  };
  if (relevantCerts.length) strengths.push(`Relevant certification: ${relevantCerts[0].name}`);

  const breakdown = [skills, experience, education, projects, certifications];
  const score = aggregate(breakdown);
  return {
    score,
    breakdown,
    matchedSkills,
    missingSkills,
    strengths,
    gaps,
    summary:
      `Rule-based match: ${score}/100. ` +
      (job.requiredSkills.length ? `${reqHit} of ${job.requiredSkills.length} required skills found. ` : "") +
      (years != null ? `About ${years} years of experience. ` : "Experience duration unclear. ") +
      "Keyword matching can miss synonyms and context; review the resume before deciding.",
    confidence: Math.round(Math.min(0.7, 0.35 + 0.35 * profile.parseConfidence) * 100) / 100,
  };
}
