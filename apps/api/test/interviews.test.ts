import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  criteriaForKind,
  parseCriteria,
  ScorecardCriteriaSchema,
  summarisePanel,
  weightedRating,
} from "../src/interviews/scorecard-criteria";
import { firstName, render, usedVariables } from "../src/communications/template-render";
import { DEFAULT_TEMPLATES } from "../src/communications/default-templates";
import { heuristicQuestions } from "../src/interviews/question-generator";

const criteria = [
  { id: "depth", label: "Technical depth", weight: 50 },
  { id: "problem", label: "Problem solving", weight: 30 },
  { id: "comms", label: "Communication", weight: 20 },
];

describe("scorecard criteria", () => {
  it("accepts criteria whose weights total 100", () => {
    assert.equal(ScorecardCriteriaSchema.safeParse(criteria).success, true);
  });

  it("rejects weights that do not total 100", () => {
    const bad = ScorecardCriteriaSchema.safeParse([{ id: "a", label: "A", weight: 40 }, { id: "b", label: "B", weight: 40 }]);
    assert.equal(bad.success, false);
    assert.match(bad.error!.issues[0].message, /add up to 100/);
  });

  it("rejects duplicate criterion ids", () => {
    const dup = ScorecardCriteriaSchema.safeParse([{ id: "a", label: "A", weight: 50 }, { id: "a", label: "B", weight: 50 }]);
    assert.equal(dup.success, false);
    assert.match(dup.error!.issues[0].message, /unique/);
  });

  it("falls back to sensible defaults for stored rubbish", () => {
    assert.ok(parseCriteria("not criteria").length > 0);
    assert.ok(parseCriteria(null).length > 0);
  });

  it("provides defaults per interview kind that all validate", () => {
    for (const kind of ["TECHNICAL", "BEHAVIORAL", "SCREENING", "HR", "PANEL", "FINAL"]) {
      const set = criteriaForKind(kind);
      assert.equal(ScorecardCriteriaSchema.safeParse(set).success, true, `${kind} defaults are invalid`);
    }
  });
});

describe("weightedRating", () => {
  it("computes a weighted mean on the 1-5 scale", () => {
    const rating = weightedRating(criteria, { depth: { rating: 4 }, problem: { rating: 3 }, comms: { rating: 5 } });
    // 4*50 + 3*30 + 5*20 = 390 / 100 = 3.9
    assert.equal(rating, 3.9);
  });

  it("redistributes weight when a criterion is unrated, rather than scoring it zero", () => {
    const partial = weightedRating(criteria, { depth: { rating: 4 }, problem: { rating: 4 } });
    assert.equal(partial, 4, "an unrated criterion must not drag the average down");
  });

  it("returns null when nothing is rated", () => {
    assert.equal(weightedRating(criteria, {}), null);
  });

  it("ignores criteria with zero weight", () => {
    const withZero = [...criteria, { id: "extra", label: "Extra", weight: 0 }];
    assert.equal(weightedRating(withZero, { depth: { rating: 4 }, problem: { rating: 3 }, comms: { rating: 5 }, extra: { rating: 1 } }), 3.9);
  });
});

describe("summarisePanel", () => {
  const card = (rating: number, rec: string, submitted = true) => ({
    ratings: { depth: { rating }, problem: { rating }, comms: { rating } },
    overallRating: rating,
    recommendation: rec,
    submittedAt: submitted ? new Date() : null,
  });

  it("counts submitted and pending feedback separately", () => {
    const panel = summarisePanel(criteria, [card(4, "YES"), card(3, "LEAN_YES", false)]);
    assert.equal(panel.submitted, 1);
    assert.equal(panel.pending, 1);
  });

  it("averages only submitted scorecards", () => {
    const panel = summarisePanel(criteria, [card(4, "YES"), card(2, "NO", false)]);
    assert.equal(panel.averageRating, 4);
  });

  it("reports a positive consensus when everyone leans yes", () => {
    const panel = summarisePanel(criteria, [card(4, "YES"), card(5, "STRONG_YES")]);
    assert.equal(panel.consensus, "positive");
    assert.equal(panel.split, false);
  });

  it("flags a split panel rather than picking a side", () => {
    const panel = summarisePanel(criteria, [card(5, "STRONG_YES"), card(2, "NO")]);
    assert.equal(panel.split, true);
    assert.equal(panel.consensus, "mixed");
  });

  it("says insufficient when nobody has reported", () => {
    const panel = summarisePanel(criteria, [card(4, "YES", false)]);
    assert.equal(panel.consensus, "insufficient");
    assert.equal(panel.averageRating, null);
  });

  it("gives a per-criterion average across the panel", () => {
    const panel = summarisePanel(criteria, [card(4, "YES"), card(2, "LEAN_NO")]);
    const depth = panel.perCriterion.find((c) => c.id === "depth")!;
    assert.equal(depth.average, 3);
    assert.deepEqual(depth.ratings, [4, 2]);
  });

  it("never returns a hiring decision, only what the panel said", () => {
    const panel = summarisePanel(criteria, [card(5, "STRONG_YES"), card(5, "STRONG_YES")]);
    assert.ok(!("decision" in panel), "panel summary must not contain a decision");
    assert.ok(!("hire" in panel));
    assert.equal(panel.consensus, "positive");
  });
});

describe("email template rendering", () => {
  it("substitutes known variables", () => {
    const out = render("Dear {{candidate.firstName}}, about {{job.title}}.", { "candidate.firstName": "Arif", "job.title": "Engineer" });
    assert.equal(out.text, "Dear Arif, about Engineer.");
    assert.deepEqual(out.unknown, []);
    assert.deepEqual(out.missing, []);
  });

  it("reports unknown placeholders and leaves them visible", () => {
    const out = render("Hello {{candidate.salary}}", {});
    assert.deepEqual(out.unknown, ["candidate.salary"]);
    assert.match(out.text, /\{\{candidate\.salary\}\}/);
  });

  it("reports known-but-missing values and renders nothing for them", () => {
    const out = render("Link: {{interview.location}}|", { "candidate.name": "A" });
    assert.deepEqual(out.missing, ["interview.location"]);
    assert.equal(out.text, "Link: |");
  });

  it("does not execute anything inside a placeholder", () => {
    const out = render("{{candidate.name}}", { "candidate.name": "{{job.title}}" });
    // A value that looks like a placeholder is inserted literally, not re-expanded.
    assert.equal(out.text, "{{job.title}}");
  });

  it("tolerates whitespace inside the braces", () => {
    assert.equal(render("Hi {{ candidate.firstName }}", { "candidate.firstName": "Sadia" }).text, "Hi Sadia");
  });

  it("lists which variables a template uses", () => {
    const { known, unknown } = usedVariables("{{candidate.name}} {{job.title}} {{made.up}}");
    assert.deepEqual(known.sort(), ["candidate.name", "job.title"]);
    assert.deepEqual(unknown, ["made.up"]);
  });

  it("every shipped default template uses only known variables", () => {
    for (const t of DEFAULT_TEMPLATES) {
      const { unknown } = usedVariables(`${t.subject}\n${t.body}`);
      assert.deepEqual(unknown, [], `${t.key} uses unknown placeholders: ${unknown.join(", ")}`);
    }
  });

  it("ships a template for every candidate-facing moment", () => {
    const keys = DEFAULT_TEMPLATES.map((t) => t.key);
    for (const required of ["APPLICATION_RECEIVED", "INTERVIEW_INVITATION", "INTERVIEW_REMINDER", "INTERVIEW_CANCELLED", "REJECTED", "SELECTED"]) {
      assert.ok(keys.includes(required as never), `missing default template: ${required}`);
    }
  });
});

describe("firstName", () => {
  it("takes the first word", () => {
    assert.equal(firstName("Arif Chowdhury"), "Arif");
  });

  it("skips an honorific so the greeting is not 'Dear Md'", () => {
    assert.equal(firstName("Md. Arif Chowdhury"), "Arif");
    assert.equal(firstName("Mr Rafiul Islam"), "Rafiul");
  });

  it("falls back to the whole name when there is only one word", () => {
    assert.equal(firstName("Nusrat"), "Nusrat");
  });
});

describe("heuristicQuestions", () => {
  const input = {
    orgId: "o1",
    kind: "TECHNICAL",
    count: 8,
    job: {
      title: "Senior Full Stack Engineer",
      description: "Build SaaS products.",
      requiredSkills: ["React", "Node.js", "PostgreSQL"],
      preferredSkills: ["AWS"],
      minExperienceYears: 5,
      educationRequirement: null,
    },
  };

  it("produces job-related questions without AI", () => {
    const questions = heuristicQuestions(input);
    assert.ok(questions.length >= 5);
    assert.ok(questions.some((q) => q.text.includes("React")));
    assert.ok(questions.every((q) => q.guidance.length > 20), "every question needs interviewer guidance");
    assert.ok(questions.every((q) => q.rationale.length > 0), "every question needs a rationale");
  });

  it("asks about a missing skill rather than assuming the candidate lacks it", () => {
    const questions = heuristicQuestions({ ...input, focusSkills: ["Kubernetes"] });
    const probe = questions.find((q) => q.text.includes("Kubernetes"));
    assert.ok(probe, "no question generated for the focus skill");
    assert.match(probe!.text, /Have you worked with it or anything similar/);
    assert.match(probe!.guidance, /find out, not to confirm/);
  });

  it("never asks about protected characteristics", () => {
    const questions = heuristicQuestions({ ...input, focusSkills: ["Docker"] });
    const banned = /\b(age|married|marital|religion|gender|nationality|children|pregnan|disab|caste|ethnic)\b/i;
    for (const q of questions) {
      assert.ok(!banned.test(q.text), `question touches a protected characteristic: ${q.text}`);
      assert.ok(!banned.test(q.guidance), `guidance touches a protected characteristic: ${q.guidance}`);
    }
  });

  it("raises difficulty for senior roles", () => {
    const junior = heuristicQuestions({ ...input, job: { ...input.job, minExperienceYears: 1 } });
    const senior = heuristicQuestions(input);
    assert.ok(senior.some((q) => q.difficulty === "HARD"));
    assert.ok(!junior.some((q) => q.difficulty === "HARD"));
  });
});
