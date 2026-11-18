import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asksForADecision,
  capabilitiesAnswer,
  INTENT_SPECS,
  readJobHint,
  readPeriod,
  routeQuestion,
  stripSearchPreamble,
} from "../src/copilot/copilot-intents";
import { emptyFindings, factsBlock, heuristicAnswer, plural } from "../src/copilot/copilot-findings";

describe("copilot — matching a question to something it can answer", () => {
  const cases: [string, string][] = [
    ["Who are the best candidates for the Backend Engineer role?", "top_candidates"],
    ["Show me the strongest applicants", "top_candidates"],
    ["Where is the pipeline stuck?", "pipeline_health"],
    ["Which stage is the bottleneck?", "pipeline_health"],
    ["Who has been waiting the longest?", "stuck_applications"],
    ["Any candidates sitting idle?", "stuck_applications"],
    ["What is our time to hire?", "time_to_hire"],
    ["How many did we hire last quarter?", "time_to_hire"],
    ["What interviews are scheduled this week?", "interview_load"],
    ["Who still owes interview feedback?", "interview_load"],
    ["Which offers are waiting on approval?", "offer_status"],
    ["How many assessments need marking?", "assessment_status"],
    ["How does the funnel look for Senior Full Stack Engineer?", "job_funnel"],
    ["Do we have anyone with Kubernetes experience?", "find_candidates"],
    ["What can you do?", "capabilities"],
  ];

  for (const [question, intent] of cases) {
    it(`routes "${question}" to ${intent}`, () => {
      assert.equal(routeQuestion(question).intent, intent);
    });
  }

  it("says it does not know rather than guessing", () => {
    const routed = routeQuestion("what is the weather in Sylhet tomorrow");
    assert.equal(routed.intent, "capabilities");
    assert.ok(routed.confidence <= 0.4, `a guess should not look confident: ${routed.confidence}`);
  });

  it("is more confident about a clear question than a vague one", () => {
    const clear = routeQuestion("which offers are waiting on approval?");
    const vague = routeQuestion("anything about offers");
    assert.ok(clear.confidence >= vague.confidence);
  });

  it("treats an empty question as a request for help", () => {
    assert.equal(routeQuestion("   ").intent, "capabilities");
  });
});

describe("copilot — reading the details out of a question", () => {
  it("reads a period in days, weeks, months or quarters", () => {
    assert.equal(readPeriod("how many hires in the last 30 days?"), 30);
    assert.equal(readPeriod("hires in the past 2 weeks"), 14);
    assert.equal(readPeriod("hires in the last 3 months"), 90);
    assert.equal(readPeriod("how did we do this quarter"), 90);
    assert.equal(readPeriod("interviews today"), 1);
    assert.equal(readPeriod("what is our time to hire"), null);
  });

  it("reads Bengali numerals in a period", () => {
    assert.equal(readPeriod("গত ৭ days"), 7);
  });

  it("bounds an absurd period instead of trusting it", () => {
    assert.equal(readPeriod("hires in the last 999 months"), 730);
  });

  it("takes a quoted job title verbatim", () => {
    assert.equal(readJobHint('who are the best candidates for "Senior Backend Engineer"?'), "Senior Backend Engineer");
  });

  it("takes a job title that follows for or on", () => {
    assert.equal(readJobHint("how is the funnel for Backend Engineer?"), "Backend Engineer");
  });

  it("does not mistake a pronoun for a job title", () => {
    assert.equal(readJobHint("what can you do for me?"), null);
    assert.equal(readJobHint("where is the pipeline stuck?"), null);
  });

  it("strips the preamble off a search so the phrase is searchable", () => {
    assert.equal(stripSearchPreamble("Do we have anyone with 3 years of React?"), "3 years of React");
    assert.equal(stripSearchPreamble("find me a Python engineer in Dhaka"), "a Python engineer in Dhaka");
    assert.equal(stripSearchPreamble("is there anybody who knows Kubernetes"), "Kubernetes");
  });
});

describe("copilot — what it refuses to do", () => {
  it("recognises a question that asks it to decide about a person", () => {
    assert.ok(asksForADecision("should we hire Rafiul?"));
    assert.ok(asksForADecision("who should I reject first"));
    assert.ok(asksForADecision("just decide for me"));
  });

  it("does not mistake an ordinary question for a request to decide", () => {
    assert.ok(!asksForADecision("who are the strongest matches for this job?"));
    assert.ok(!asksForADecision("how many did we hire last month?"));
  });

  it("says in its own description that it decides nothing", () => {
    const text = capabilitiesAnswer(Object.values(INTENT_SPECS));
    assert.match(text, /do not decide/i);
    assert.match(text, /hire, reject or advance/i);
  });

  it("lists only the questions the member may ask", () => {
    const text = capabilitiesAnswer([INTENT_SPECS.pipeline_health]);
    assert.match(text, /each stage/i);
    assert.ok(!/offer/i.test(text), "an offer question must not be advertised to someone who cannot ask it");
  });
});

describe("copilot — an answer with no model involved", () => {
  it("says what the figures say, and nothing more", () => {
    const f = emptyFindings("pipeline_health");
    f.highlights.push("12 candidates are active across all jobs.", "Screening holds the most, with 7.");
    const answer = heuristicAnswer(f);
    assert.match(answer, /12 candidates are active/);
    assert.match(answer, /Screening holds the most/);
  });

  it("keeps every caveat in the answer", () => {
    const f = emptyFindings("top_candidates");
    f.highlights.push("3 candidates are active on Backend Engineer.");
    f.notes.push("Candidates without a score are missing from this ranking.");
    assert.match(heuristicAnswer(f), /missing from this ranking/);
  });

  it("admits when there is nothing to report", () => {
    assert.match(heuristicAnswer(emptyFindings("offer_status")), /found nothing/i);
  });

  it("hands the model figures, rows and caveats — and no other data", () => {
    const f = emptyFindings("top_candidates");
    f.subject = "Backend Engineer";
    f.facts.push({ label: "Active candidates", value: 3 }, { label: "Average match score", value: null });
    f.references.push({ type: "candidate", id: "ck1", label: "Candidate 4F2A9C", score: 82, detail: "Screening" });
    f.notes.push("Blind mode is on.");
    const block = factsBlock(f);
    assert.match(block, /Subject: Backend Engineer/);
    assert.match(block, /Active candidates: 3/);
    assert.match(block, /Average match score: not known/);
    assert.match(block, /Candidate 4F2A9C — score 82/);
    assert.match(block, /must appear in your answer/);
    assert.ok(!block.includes("ck1"), "an internal id is not something the model needs");
  });

  it("counts in words a person would use", () => {
    assert.equal(plural(1, "candidate"), "1 candidate");
    assert.equal(plural(2, "candidate"), "2 candidates");
    assert.equal(plural(1, "person", "people"), "1 person");
    assert.equal(plural(4, "person", "people"), "4 people");
  });
});
