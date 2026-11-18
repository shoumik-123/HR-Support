import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAutoMarked, isExpired, markAnswer, remainingSeconds, scoreAssessment, shuffleFor } from "../src/assessments/scoring";

describe("markAnswer — single choice", () => {
  const q = { type: "MCQ_SINGLE" as const, correctAnswers: ["2"], maxPoints: 5 };

  it("awards full marks for the right option", () => {
    assert.deepEqual(markAnswer(q, ["2"]), { correct: true, points: 5 });
  });

  it("awards nothing for the wrong option", () => {
    assert.deepEqual(markAnswer(q, ["1"]), { correct: false, points: 0 });
  });

  it("awards nothing when the candidate picks several on a single-choice question", () => {
    assert.deepEqual(markAnswer(q, ["2", "3"]), { correct: false, points: 0 });
  });

  it("treats no answer as wrong, not as unmarked", () => {
    assert.deepEqual(markAnswer(q, []), { correct: false, points: 0 });
    assert.deepEqual(markAnswer(q, ["  "]), { correct: false, points: 0 });
  });
});

describe("markAnswer — multiple choice", () => {
  const q = { type: "MCQ_MULTI" as const, correctAnswers: ["0", "2"], maxPoints: 4 };

  it("awards full marks only when every correct option is chosen", () => {
    assert.deepEqual(markAnswer(q, ["0", "2"]), { correct: true, points: 4 });
    assert.deepEqual(markAnswer(q, ["2", "0"]), { correct: true, points: 4 }, "order must not matter");
  });

  it("gives no partial credit for a subset", () => {
    assert.deepEqual(markAnswer(q, ["0"]), { correct: false, points: 0 });
  });

  it("gives no credit when a wrong option is included as well", () => {
    assert.deepEqual(markAnswer(q, ["0", "1", "2"]), { correct: false, points: 0 });
  });

  it("ignores duplicate selections of the same option", () => {
    assert.deepEqual(markAnswer(q, ["0", "0", "2"]), { correct: true, points: 4 });
  });
});

describe("markAnswer — numeric", () => {
  it("accepts an exact match when no tolerance is set", () => {
    const q = { type: "NUMERIC" as const, correctAnswers: ["42"], maxPoints: 2 };
    assert.deepEqual(markAnswer(q, ["42"]), { correct: true, points: 2 });
    assert.deepEqual(markAnswer(q, ["42.1"]), { correct: false, points: 0 });
  });

  it("accepts an answer inside the tolerance", () => {
    const q = { type: "NUMERIC" as const, correctAnswers: ["100"], tolerance: 5, maxPoints: 3 };
    assert.deepEqual(markAnswer(q, ["96"]), { correct: true, points: 3 });
    assert.deepEqual(markAnswer(q, ["105"]), { correct: true, points: 3 });
    assert.deepEqual(markAnswer(q, ["106"]), { correct: false, points: 0 });
  });

  it("marks text in a numeric field as wrong rather than crashing", () => {
    const q = { type: "NUMERIC" as const, correctAnswers: ["10"], maxPoints: 1 };
    assert.deepEqual(markAnswer(q, ["ten"]), { correct: false, points: 0 });
  });

  it("handles negative and decimal answers", () => {
    const q = { type: "NUMERIC" as const, correctAnswers: ["-2.5"], maxPoints: 1 };
    assert.deepEqual(markAnswer(q, ["-2.5"]), { correct: true, points: 1 });
  });
});

describe("markAnswer — written answers", () => {
  it("leaves short answers for a human", () => {
    assert.deepEqual(markAnswer({ type: "SHORT_ANSWER", correctAnswers: [], maxPoints: 5 }, ["my answer"]), { correct: null, points: null });
  });

  it("leaves long answers for a human", () => {
    assert.deepEqual(markAnswer({ type: "LONG_ANSWER", correctAnswers: [], maxPoints: 10 }, ["an essay"]), { correct: null, points: null });
  });

  it("knows which types mark themselves", () => {
    assert.equal(isAutoMarked("MCQ_SINGLE"), true);
    assert.equal(isAutoMarked("MCQ_MULTI"), true);
    assert.equal(isAutoMarked("NUMERIC"), true);
    assert.equal(isAutoMarked("SHORT_ANSWER"), false);
    assert.equal(isAutoMarked("LONG_ANSWER"), false);
  });
});

describe("scoreAssessment", () => {
  it("totals a fully auto-marked paper", () => {
    const score = scoreAssessment(
      [
        { type: "MCQ_SINGLE", maxPoints: 5, pointsAwarded: 5 },
        { type: "MCQ_MULTI", maxPoints: 5, pointsAwarded: 0 },
        { type: "NUMERIC", maxPoints: 10, pointsAwarded: 10 },
      ],
      60,
    );
    assert.equal(score.autoScore, 15);
    assert.equal(score.manualScore, 0);
    assert.equal(score.totalPoints, 20);
    assert.equal(score.finalScore, 15);
    assert.equal(score.percent, 75);
    assert.equal(score.passed, true);
    assert.equal(score.complete, true);
  });

  it("withholds a percentage while written answers are unmarked", () => {
    const score = scoreAssessment(
      [
        { type: "MCQ_SINGLE", maxPoints: 10, pointsAwarded: 10 },
        { type: "LONG_ANSWER", maxPoints: 10, pointsAwarded: null },
      ],
      50,
    );
    assert.equal(score.autoScore, 10);
    assert.equal(score.awaitingManual, 1);
    assert.equal(score.complete, false);
    assert.equal(score.percent, null, "a half-marked paper must not show a final percentage");
    assert.equal(score.passed, null);
  });

  it("completes once a human marks the written answers", () => {
    const score = scoreAssessment(
      [
        { type: "MCQ_SINGLE", maxPoints: 10, pointsAwarded: 10 },
        { type: "LONG_ANSWER", maxPoints: 10, pointsAwarded: 6 },
      ],
      50,
    );
    assert.equal(score.manualScore, 6);
    assert.equal(score.finalScore, 16);
    assert.equal(score.percent, 80);
    assert.equal(score.passed, true);
    assert.equal(score.complete, true);
  });

  it("marks a paper below the bar as not passed", () => {
    const score = scoreAssessment([{ type: "MCQ_SINGLE", maxPoints: 10, pointsAwarded: 4 }], 60);
    assert.equal(score.percent, 40);
    assert.equal(score.passed, false);
  });

  it("treats the passing mark as inclusive", () => {
    const score = scoreAssessment([{ type: "MCQ_SINGLE", maxPoints: 10, pointsAwarded: 6 }], 60);
    assert.equal(score.percent, 60);
    assert.equal(score.passed, true);
  });

  it("does not divide by zero on an empty paper", () => {
    const score = scoreAssessment([], 60);
    assert.equal(score.totalPoints, 0);
    assert.equal(score.percent, null);
    assert.equal(score.passed, null);
  });

  it("reports one decimal place rather than a long float", () => {
    const score = scoreAssessment([{ type: "MCQ_SINGLE", maxPoints: 3, pointsAwarded: 1 }], 50);
    assert.equal(score.percent, 33.3);
  });

  it("counts an unanswered auto-marked question as zero, not as unmarked", () => {
    const score = scoreAssessment(
      [
        { type: "MCQ_SINGLE", maxPoints: 5, pointsAwarded: 0 },
        { type: "MCQ_SINGLE", maxPoints: 5, pointsAwarded: 5 },
      ],
      60,
    );
    assert.equal(score.awaitingManual, 0);
    assert.equal(score.complete, true);
    assert.equal(score.percent, 50);
  });

  it("treats an unmarked closed question as needing attention rather than scoring it zero", () => {
    // Happens only if the question's answer key was removed after the paper was sent.
    const score = scoreAssessment(
      [
        { type: "MCQ_SINGLE", maxPoints: 5, pointsAwarded: 5 },
        { type: "MCQ_SINGLE", maxPoints: 5, pointsAwarded: null },
      ],
      60,
    );
    assert.equal(score.awaitingManual, 1);
    assert.equal(score.complete, false);
    assert.equal(score.percent, null, "an unmarkable question must not be silently scored zero");
  });
});

describe("shuffleFor", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];

  it("keeps every item exactly once", () => {
    assert.deepEqual([...shuffleFor(items, "abc")].sort((a, b) => a - b), items);
  });

  it("gives the same order for the same candidate on reload", () => {
    assert.deepEqual(shuffleFor(items, "assessment-1"), shuffleFor(items, "assessment-1"));
  });

  it("gives different orders to different candidates", () => {
    const a = shuffleFor(items, "assessment-1");
    const b = shuffleFor(items, "assessment-2");
    assert.notDeepEqual(a, b);
  });

  it("does not mutate the input", () => {
    const original = [...items];
    shuffleFor(items, "x");
    assert.deepEqual(items, original);
  });

  it("handles an empty or single-item list", () => {
    assert.deepEqual(shuffleFor([], "x"), []);
    assert.deepEqual(shuffleFor([9], "x"), [9]);
  });
});

describe("timing", () => {
  const now = new Date("2026-11-20T10:00:00Z");

  it("reports the seconds left before the deadline", () => {
    assert.equal(remainingSeconds(new Date("2026-11-20T10:30:00Z"), now), 1800);
  });

  it("never reports negative time", () => {
    assert.equal(remainingSeconds(new Date("2026-11-20T09:00:00Z"), now), 0);
  });

  it("reports zero when no deadline is set", () => {
    assert.equal(remainingSeconds(null, now), 0);
  });

  it("expires an invitation past its expiry", () => {
    assert.equal(isExpired({ expiresAt: new Date("2026-11-19T10:00:00Z"), dueAt: null, status: "INVITED" }, now), true);
    assert.equal(isExpired({ expiresAt: new Date("2026-11-21T10:00:00Z"), dueAt: null, status: "INVITED" }, now), false);
  });

  it("uses the sitting deadline once the test has started", () => {
    // Invitation is still valid, but the candidate's own time is up.
    assert.equal(isExpired({ expiresAt: new Date("2026-11-25T10:00:00Z"), dueAt: new Date("2026-11-20T09:45:00Z"), status: "IN_PROGRESS" }, now), true);
  });

  it("never expires a paper that has been submitted", () => {
    assert.equal(isExpired({ expiresAt: new Date("2026-11-01T10:00:00Z"), dueAt: new Date("2026-11-01T11:00:00Z"), status: "SUBMITTED" }, now), false);
    assert.equal(isExpired({ expiresAt: new Date("2026-11-01T10:00:00Z"), dueAt: null, status: "EVALUATED" }, now), false);
  });
});
