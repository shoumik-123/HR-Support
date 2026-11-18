import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { heuristicMatch } from "../src/matching/heuristic-matcher";
import { DEFAULT_CRITERIA, MatchingCriteriaSchema } from "../src/matching/criteria";
import { aggregate } from "../src/matching/match-types";
import { isProtectedSnippet, redactResumeText } from "../src/matching/redaction";
import type { MatchCandidateProfile, MatchJob } from "../src/matching/match-types";

const job: MatchJob = {
  title: "Senior Full Stack Engineer",
  description: "Build SaaS products.",
  requiredSkills: ["JavaScript", "React", "Node.js", "PostgreSQL"],
  preferredSkills: ["AWS", "Docker"],
  minExperienceYears: 5,
  maxExperienceYears: 10,
  educationRequirement: "Bachelor's degree in Computer Science",
};

function profile(over: Partial<MatchCandidateProfile> = {}): MatchCandidateProfile {
  return {
    skills: ["JavaScript", "React", "Node.js", "PostgreSQL", "AWS"],
    totalExperienceYears: 7,
    headline: "Senior Engineer",
    education: [{ degree: "BSc", field: "CSE", institution: "BUET", evidence: "BSc in CSE, BUET, 2017" }],
    certifications: [],
    projects: [],
    experience: [{ title: "Senior Engineer", company: "X", startDate: "2019-01", endDate: null, description: "React and Node.js", evidence: "Senior Engineer at X" }],
    parseConfidence: 0.9,
    ...over,
  };
}

const RESUME = `Arif Chowdhury
Senior Full Stack Engineer
TECHNICAL SKILLS
JavaScript, TypeScript, React, Node.js, PostgreSQL, AWS, Docker
WORK EXPERIENCE
Senior Software Engineer, Brain Station 23 (2019-01 - Present)
EDUCATION
BSc in Computer Science and Engineering, BUET, 2017`;

describe("heuristicMatch", () => {
  it("scores a strong candidate highly and finds no missing required skills", () => {
    const r = heuristicMatch(job, profile(), RESUME, DEFAULT_CRITERIA);
    assert.equal(r.missingSkills.length, 0);
    assert.ok(r.score >= 80, `expected >= 80, got ${r.score}`);
    assert.ok(r.confidence <= 0.7, "heuristic confidence stays capped");
  });

  it("reports missing required skills and scores lower", () => {
    const weak = profile({ skills: ["JavaScript", "React"], totalExperienceYears: 1 });
    const r = heuristicMatch(job, weak, "JavaScript, React\nJunior Developer 2024-2025", DEFAULT_CRITERIA);
    assert.deepEqual(r.missingSkills.sort(), ["Node.js", "PostgreSQL"]);
    assert.ok(r.score < 50, `expected < 50, got ${r.score}`);
    assert.ok(r.gaps.some((g) => /below the 5-year minimum/.test(g)));
  });

  it("never exceeds 100 or drops below 0", () => {
    const r = heuristicMatch(job, profile({ totalExperienceYears: 40 }), RESUME, DEFAULT_CRITERIA);
    assert.ok(r.score >= 0 && r.score <= 100);
  });

  it("does not penalise experience above the stated maximum", () => {
    const within = heuristicMatch(job, profile({ totalExperienceYears: 8 }), RESUME, DEFAULT_CRITERIA);
    const over = heuristicMatch(job, profile({ totalExperienceYears: 15 }), RESUME, DEFAULT_CRITERIA);
    assert.ok(over.score >= within.score, "over-qualified candidates must not score lower");
  });

  it("credits a skill written as an alias in the resume", () => {
    const p = profile({ skills: ["JavaScript", "React", "Node.js", "Postgres"] });
    const resume = "Skills: javascript, reactjs, nodejs, postgres";
    const r = heuristicMatch(job, p, resume, DEFAULT_CRITERIA);
    assert.ok(r.matchedSkills.includes("PostgreSQL"), `alias not credited: ${JSON.stringify(r.matchedSkills)}`);
  });

  it("marks a criterion not applicable when the job sets no requirement", () => {
    const noEdu = { ...job, educationRequirement: null, minExperienceYears: null };
    const r = heuristicMatch(noEdu, profile(), RESUME, DEFAULT_CRITERIA);
    const education = r.breakdown.find((b) => b.criterion === "education")!;
    assert.equal(education.score, null);
    assert.equal(r.breakdown.find((b) => b.criterion === "experience")!.score, null);
  });

  it("respects organisation weights: weighting skills alone changes the total", () => {
    const skillsOnly = MatchingCriteriaSchema.parse({ skills: 100, experience: 0, education: 0, projects: 0, certifications: 0 });
    const weak = profile({ skills: ["JavaScript"], totalExperienceYears: 20 });
    const resume = "Skills: javascript\nEngineer 2005 - Present";
    const balanced = heuristicMatch(job, weak, resume, DEFAULT_CRITERIA);
    const skillWeighted = heuristicMatch(job, weak, resume, skillsOnly);
    assert.ok(skillWeighted.score < balanced.score, "skill-only weighting should punish a one-skill candidate");
  });
});

describe("criteria", () => {
  it("rejects weights that do not sum to 100", () => {
    assert.equal(MatchingCriteriaSchema.safeParse({ skills: 50, experience: 20, education: 10, projects: 10, certifications: 5 }).success, false);
  });

  it("aggregate redistributes weight across applicable criteria only", () => {
    assert.equal(aggregate([{ score: 80, weight: 50 }, { score: null, weight: 50 }]), 80);
    assert.equal(aggregate([{ score: 100, weight: 75 }, { score: 0, weight: 25 }]), 75);
    assert.equal(aggregate([{ score: null, weight: 100 }]), 0);
  });
});

describe("redaction", () => {
  const resume = `Md. Arif Chowdhury
Email: arif@example.com | Phone: +8801712345601
Father's Name: Abdul Chowdhury
Date of Birth: 12 March 1992
Religion: Islam
Marital Status: Married
Nationality: Bangladeshi
EXPERIENCE
Senior Engineer at Brain Station 23 - built React dashboards
Fixed a race condition in the payment service
Shipped a single-page application for merchants`;

  const redacted = redactResumeText(resume, ["Md. Arif Chowdhury", "arif@example.com", "+8801712345601"]);

  it("removes protected characteristics", () => {
    for (const term of ["Islam", "Married", "Bangladeshi", "1992", "Abdul"]) {
      assert.ok(!redacted.includes(term), `"${term}" survived redaction:\n${redacted}`);
    }
  });

  it("removes identity and contact details", () => {
    assert.ok(!redacted.includes("Arif"), "candidate name survived redaction");
    assert.ok(!redacted.includes("arif@example.com"));
    assert.ok(!redacted.includes("8801712345601"));
  });

  it("keeps job-related content, including lines with ambiguous words", () => {
    assert.ok(redacted.includes("Brain Station 23"));
    assert.ok(redacted.includes("React dashboards"));
    assert.ok(redacted.includes("race condition"), "a technical line was wrongly dropped");
    assert.ok(redacted.includes("single-page application"), "a technical line was wrongly dropped");
  });

  it("flags protected snippets so they cannot be shown as evidence", () => {
    assert.equal(isProtectedSnippet("Religion: Islam"), true);
    assert.equal(isProtectedSnippet("Built a React dashboard"), false);
  });
});
