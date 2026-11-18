import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiMatch } from "../src/matching/ai-matcher";
import { DEFAULT_CRITERIA, MatchingCriteriaSchema } from "../src/matching/criteria";
import type { MatchCandidateProfile, MatchJob } from "../src/matching/match-types";
import type { AiService, StructuredRequest } from "../src/ai/ai.service";

const job: MatchJob = {
  title: "Senior Full Stack Engineer",
  description: "Build SaaS products.",
  requiredSkills: ["React", "Node.js"],
  preferredSkills: ["AWS"],
  minExperienceYears: 5,
  maxExperienceYears: null,
  educationRequirement: null,
};

const profile: MatchCandidateProfile = {
  skills: ["React", "Node.js"],
  totalExperienceYears: 6,
  headline: "Engineer",
  education: [],
  certifications: [],
  projects: [],
  experience: [],
  parseConfidence: 0.9,
};

/** Stub AiService that returns a canned model response and captures the request. */
function stubAi(criteria: { criterion: string; applicable: boolean; score: number; evidence?: string[] }[]) {
  const captured: { system?: string; content?: unknown; feature?: string } = {};
  const ai = {
    enabled: true,
    model: "stub-model",
    async structured(req: StructuredRequest<never>) {
      captured.system = req.system;
      captured.content = req.content;
      captured.feature = req.feature;
      return {
        model: "stub-model",
        data: {
          criteria: criteria.map((c) => ({
            criterion: c.criterion,
            applicable: c.applicable,
            score: c.score,
            rationale: `${c.criterion} rationale`,
            evidence: c.evidence ?? [`evidence for ${c.criterion}`],
          })),
          matchedSkills: ["React", "Node.js"],
          missingSkills: [],
          strengths: ["Strong React background"],
          gaps: [],
          summary: "Solid fit.",
          confidence: 0.82,
        } as never,
      };
    },
  } as unknown as AiService;
  return { ai, captured };
}

const ALL = ["skills", "experience", "education", "projects", "certifications"];

describe("aiMatch", () => {
  it("computes the overall score from the organisation's weights, not the model", async () => {
    // Model gives skills 100 and everything else 0; with a skills-only weighting the total must be 100.
    const { ai } = stubAi(ALL.map((c) => ({ criterion: c, applicable: true, score: c === "skills" ? 100 : 0 })));
    const skillsOnly = MatchingCriteriaSchema.parse({ skills: 100, experience: 0, education: 0, projects: 0, certifications: 0 });
    const { analysis } = await aiMatch(ai, "org1", job, profile, "redacted resume", skillsOnly);
    assert.equal(analysis.score, 100);

    const { ai: ai2 } = stubAi(ALL.map((c) => ({ criterion: c, applicable: true, score: c === "skills" ? 100 : 0 })));
    const balanced = await aiMatch(ai2, "org1", job, profile, "redacted resume", DEFAULT_CRITERIA);
    assert.equal(balanced.analysis.score, DEFAULT_CRITERIA.skills); // 45% weight, others score 0
  });

  it("skips criteria the model marks not applicable and redistributes their weight", async () => {
    const { ai } = stubAi([
      { criterion: "skills", applicable: true, score: 80 },
      { criterion: "experience", applicable: true, score: 80 },
      { criterion: "education", applicable: false, score: 0 },
      { criterion: "projects", applicable: false, score: 0 },
      { criterion: "certifications", applicable: false, score: 0 },
    ]);
    const { analysis } = await aiMatch(ai, "org1", job, profile, "resume", DEFAULT_CRITERIA);
    assert.equal(analysis.score, 80, "non-applicable criteria must not drag the score down");
    assert.equal(analysis.breakdown.find((b) => b.criterion === "education")!.score, null);
  });

  it("always returns all five criteria, even if the model omits one", async () => {
    const { ai } = stubAi([{ criterion: "skills", applicable: true, score: 90 }]);
    const { analysis } = await aiMatch(ai, "org1", job, profile, "resume", DEFAULT_CRITERIA);
    assert.deepEqual(analysis.breakdown.map((b) => b.criterion), ALL);
    assert.equal(analysis.breakdown.find((b) => b.criterion === "projects")!.rationale, "Not assessed.");
  });

  it("clamps model scores into 0-100", async () => {
    const { ai } = stubAi(ALL.map((c) => ({ criterion: c, applicable: true, score: c === "skills" ? 180 : -40 })));
    const { analysis } = await aiMatch(ai, "org1", job, profile, "resume", DEFAULT_CRITERIA);
    assert.equal(analysis.breakdown.find((b) => b.criterion === "skills")!.score, 100);
    assert.equal(analysis.breakdown.find((b) => b.criterion === "experience")!.score, 0);
    assert.ok(analysis.score >= 0 && analysis.score <= 100);
  });

  it("drops evidence quoting protected characteristics", async () => {
    const { ai } = stubAi([
      { criterion: "skills", applicable: true, score: 70, evidence: ["Built React dashboards", "Religion: Islam", "Date of Birth: 1992"] },
      ...ALL.slice(1).map((c) => ({ criterion: c, applicable: true, score: 50 })),
    ]);
    const { analysis } = await aiMatch(ai, "org1", job, profile, "resume", DEFAULT_CRITERIA);
    const evidence = analysis.breakdown.find((b) => b.criterion === "skills")!.evidence;
    assert.deepEqual(evidence, ["Built React dashboards"]);
  });

  it("sends only the redacted resume and instructs the model to ignore embedded instructions", async () => {
    const { ai, captured } = stubAi(ALL.map((c) => ({ criterion: c, applicable: true, score: 60 })));
    await aiMatch(ai, "org1", job, profile, "[candidate] worked at Brain Station 23", DEFAULT_CRITERIA);
    const content = String(captured.content);
    assert.ok(content.includes("[candidate]"), "redacted text should be what is sent");
    assert.ok(/untrusted/i.test(captured.system ?? ""), "system prompt must mark candidate material untrusted");
    assert.ok(/never infer age, gender, race/i.test(captured.system ?? ""), "system prompt must forbid protected characteristics");
    assert.ok(/decision support only/i.test(captured.system ?? ""), "system prompt must state it is advisory");
    assert.equal(captured.feature, "candidate_match");
  });

  it("keeps the model's confidence within 0-1", async () => {
    const { ai } = stubAi(ALL.map((c) => ({ criterion: c, applicable: true, score: 50 })));
    const { analysis } = await aiMatch(ai, "org1", job, profile, "resume", DEFAULT_CRITERIA);
    assert.ok(analysis.confidence > 0 && analysis.confidence <= 1);
  });
});
