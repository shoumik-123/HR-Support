import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeQuery, EMPTY_QUERY, isEmptyQuery, normaliseQuery, parseQuery, type TalentQuery } from "../src/talent/talent-query";
import { aggregateSearch, hasExcludedSkill, scoreSubject, SEARCH_WEIGHTS, type SearchSubject } from "../src/talent/talent-scoring";

function query(overrides: Partial<TalentQuery> = {}): TalentQuery {
  return { ...EMPTY_QUERY, ...overrides };
}

function subject(overrides: Partial<SearchSubject> = {}): SearchSubject {
  return {
    id: "cksub0000000000000000001",
    fullName: "Nusrat Jahan",
    headline: "Senior Frontend Developer",
    summary: "Builds web applications for fintech products.",
    location: "Dhaka, Bangladesh",
    skills: ["React", "TypeScript", "Node.js"],
    tags: ["referral"],
    totalExperienceYears: 5,
    resumeText: [
      "Senior Frontend Developer at Veyra",
      "Built dashboards in React and TypeScript",
      "Worked on payment reconciliation for a fintech client",
      "BSc in Computer Science, BUET",
    ].join("\n"),
    jobTitles: ["Senior Frontend Developer", "Frontend Developer"],
    educationText: "BSc Computer Science BUET",
    parseConfidence: 0.9,
    updatedAt: new Date("2026-11-18T12:00:00.000Z"),
    ...overrides,
  };
}

describe("talent search — reading a recruiter's sentence", () => {
  it("reads skills, experience, role and location out of one phrase", () => {
    const q = parseQuery("3+ years React developer in Dhaka");
    assert.ok(q.requiredSkills.includes("React"), "React is a requirement");
    assert.equal(q.minExperienceYears, 3);
    assert.equal(q.maxExperienceYears, null);
    assert.deepEqual(q.locations, ["Dhaka"]);
    assert.ok(q.titles.some((t) => t.endsWith("developer")), `expected a developer title, got ${JSON.stringify(q.titles)}`);
  });

  it("separates what is required from what is merely preferred", () => {
    const q = parseQuery("must know TypeScript, preferably AWS");
    assert.ok(q.requiredSkills.includes("TypeScript"));
    assert.ok(q.preferredSkills.includes("AWS"), `AWS should be a bonus, got ${JSON.stringify(q)}`);
    assert.ok(!q.requiredSkills.includes("AWS"));
  });

  it("treats a ruled-out skill as an exclusion, not a requirement", () => {
    const q = parseQuery("PHP developer, no WordPress");
    assert.ok(q.requiredSkills.includes("PHP"));
    assert.ok(q.excludedSkills.includes("WordPress"));
    assert.ok(!q.requiredSkills.includes("WordPress"));
  });

  it("reads a range as a range, not as a floor", () => {
    const q = parseQuery("Python engineer with 3-5 years of experience");
    assert.equal(q.minExperienceYears, 3);
    assert.equal(q.maxExperienceYears, 5);
  });

  it("reads a ceiling on its own", () => {
    const q = parseQuery("junior designer, up to 2 years experience");
    assert.equal(q.maxExperienceYears, 2);
    assert.equal(q.minExperienceYears, null);
  });

  it("puts a swapped range the right way round", () => {
    const q = parseQuery("engineer with 8 to 4 years");
    assert.equal(q.minExperienceYears, 4);
    assert.equal(q.maxExperienceYears, 8);
  });

  it("reads Bengali numerals and the Bengali word for years", () => {
    const q = parseQuery("৫ বছরের Java developer");
    assert.equal(q.minExperienceYears, 5);
    assert.ok(q.requiredSkills.includes("Java"));
  });

  it("picks up an education requirement", () => {
    const q = parseQuery("accountant with a bachelors degree");
    assert.equal(q.education, "Bachelor's degree");
  });

  it("reads tags written as #tag or tag:value", () => {
    const q = parseQuery("React developer #referral tag:diversity");
    assert.deepEqual(q.tags.sort(), ["diversity", "referral"]);
  });

  it("keeps words it cannot place as keywords instead of dropping them", () => {
    const q = parseQuery("engineer with fintech and telecom billing background");
    assert.ok(q.keywords.includes("fintech"), `expected fintech among ${JSON.stringify(q.keywords)}`);
    assert.ok(q.keywords.includes("telecom"));
  });

  it("drops filler words rather than searching for them", () => {
    for (const phrase of ["looking for a good candidate who has strong skills", "looking for a really good candidate", "need somebody quite senior urgently"]) {
      const q = parseQuery(phrase);
      assert.deepEqual(q.keywords, [], phrase);
      assert.ok(isEmptyQuery(q), `nothing searchable was named in: ${phrase}`);
    }
  });

  it("says plainly that an empty search lists the whole pool", () => {
    const q = parseQuery("   ");
    assert.ok(isEmptyQuery(q));
    assert.match(q.interpretation, /whole talent pool/i);
  });

  it("reads the parse back in a sentence a recruiter can check", () => {
    const text = describeQuery(query({ requiredSkills: ["React"], minExperienceYears: 3, locations: ["Dhaka"] }));
    assert.match(text, /React/);
    assert.match(text, /3\+ years/);
    assert.match(text, /Dhaka/);
  });

  it("is honest about how much of the sentence it understood", () => {
    const clear = parseQuery("React TypeScript developer in Dhaka with 4 years");
    const vague = parseQuery("someone really promising for the growth team");
    assert.ok(clear.confidence > vague.confidence, `${clear.confidence} should beat ${vague.confidence}`);
  });
});

describe("talent search — criteria that arrive from outside", () => {
  it("canonicalises skill aliases so the same search is the same search", () => {
    const q = normaliseQuery({ requiredSkills: ["reactjs", "nodejs"] });
    assert.deepEqual(q.requiredSkills, ["React", "Node.js"]);
  });

  it("lets an exclusion win over a requirement for the same skill", () => {
    const q = normaliseQuery({ requiredSkills: ["WordPress"], excludedSkills: ["wordpress"] });
    assert.deepEqual(q.requiredSkills, []);
    // The exclusion keeps the spelling it arrived with; only the comparison ignores case.
    assert.deepEqual(q.excludedSkills, ["wordpress"]);
  });

  it("bounds years of experience to something a career can hold", () => {
    const q = normaliseQuery({ minExperienceYears: -4, maxExperienceYears: 900 });
    assert.equal(q.minExperienceYears, 0);
    assert.equal(q.maxExperienceYears, 60);
  });

  it("ignores anything that is not a list of strings", () => {
    const q = normaliseQuery({ requiredSkills: "React" as never, tags: [{ evil: true }] as never });
    assert.deepEqual(q.requiredSkills, []);
    assert.deepEqual(q.tags, []);
  });
});

describe("talent search — ranking is arithmetic, not opinion", () => {
  it("scores a candidate who shows every required skill above one who shows none", () => {
    const q = query({ requiredSkills: ["React", "TypeScript"] });
    const strong = scoreSubject(q, subject());
    const weak = scoreSubject(q, subject({ skills: ["Excel"], resumeText: "Data entry operator", jobTitles: [] }));
    assert.ok(strong.score > weak.score);
    assert.deepEqual(strong.missingSkills, []);
    assert.deepEqual(weak.missingSkills, ["React", "TypeScript"]);
  });

  it("weighs a required skill above a preferred one", () => {
    const required = scoreSubject(query({ requiredSkills: ["React"], preferredSkills: ["Docker"] }), subject());
    const preferred = scoreSubject(query({ requiredSkills: ["Docker"], preferredSkills: ["React"] }), subject());
    assert.ok(required.score > preferred.score, `${required.score} should beat ${preferred.score}`);
  });

  it("gives the same candidate the same score every time", () => {
    const q = query({ requiredSkills: ["React"], minExperienceYears: 3, locations: ["Dhaka"] });
    assert.equal(scoreSubject(q, subject()).score, scoreSubject(q, subject()).score);
  });

  it("quotes the resume line that justifies a skill", () => {
    const hit = scoreSubject(query({ requiredSkills: ["React"] }), subject());
    const skills = hit.breakdown.find((b) => b.criterion === "skills");
    assert.ok(skills?.evidence.some((e) => /React/.test(e)), `expected evidence, got ${JSON.stringify(skills?.evidence)}`);
  });

  it("finds a skill in the resume text even when it is missing from the skill list", () => {
    const hit = scoreSubject(query({ requiredSkills: ["PostgreSQL"] }), subject({ skills: [], resumeText: "Tuned postgres queries for a reporting service" }));
    assert.deepEqual(hit.missingSkills, []);
  });

  it("drops a criterion the search said nothing about instead of scoring it zero", () => {
    const hit = scoreSubject(query({ requiredSkills: ["React"] }), subject());
    const location = hit.breakdown.find((b) => b.criterion === "location");
    assert.equal(location?.score, null);
    assert.equal(hit.score, hit.breakdown.find((b) => b.criterion === "skills")?.score);
  });

  it("never scores a missing figure as a zero", () => {
    const hit = scoreSubject(query({ minExperienceYears: 5 }), subject({ totalExperienceYears: null }));
    const experience = hit.breakdown.find((b) => b.criterion === "experience");
    assert.equal(experience?.score, 40);
    assert.ok(hit.gaps.some((g) => /unclear/i.test(g)));
  });

  it("keeps someone just short of the asked experience in the running", () => {
    const hit = scoreSubject(query({ minExperienceYears: 3 }), subject({ totalExperienceYears: 2.5 }));
    const experience = hit.breakdown.find((b) => b.criterion === "experience");
    assert.ok((experience?.score ?? 0) > 70, `2.5 against 3 years should stay strong, got ${experience?.score}`);
  });

  it("does not punish someone for having more experience than asked", () => {
    const under = scoreSubject(query({ maxExperienceYears: 5 }), subject({ totalExperienceYears: 4 }));
    const over = scoreSubject(query({ maxExperienceYears: 5 }), subject({ totalExperienceYears: 9 }));
    assert.equal(under.score, 100);
    assert.ok(over.score >= 60, `being over the range should stay respectable, got ${over.score}`);
  });

  it("explains a location mismatch rather than hiding it", () => {
    const hit = scoreSubject(query({ locations: ["Sylhet"] }), subject());
    const location = hit.breakdown.find((b) => b.criterion === "location");
    assert.match(location?.rationale ?? "", /Dhaka.*not Sylhet/);
    assert.ok(hit.gaps.some((g) => /Dhaka/.test(g)));
  });

  it("treats an unknown location as unknown, not as a mismatch", () => {
    const hit = scoreSubject(query({ locations: ["Dhaka"] }), subject({ location: null }));
    assert.equal(hit.breakdown.find((b) => b.criterion === "location")?.score, 40);
  });

  it("takes a ruled-out skill as a reason to leave someone out", () => {
    assert.equal(hasExcludedSkill(query({ excludedSkills: ["React"] }), subject()), "React");
    assert.equal(hasExcludedSkill(query({ excludedSkills: ["COBOL"] }), subject()), null);
  });

  it("gives a reason for every candidate it returns", () => {
    const hit = scoreSubject(query({ requiredSkills: ["React", "TypeScript"], minExperienceYears: 3, locations: ["Dhaka"] }), subject());
    assert.ok(hit.reasons.length >= 2, `expected reasons, got ${JSON.stringify(hit.reasons)}`);
    assert.ok(hit.reasons.some((r) => /Dhaka/.test(r)));
  });

  it("is less confident about a thin profile than a full one", () => {
    const full = scoreSubject(query({ requiredSkills: ["React"] }), subject());
    const thin = scoreSubject(query({ requiredSkills: ["React"] }), subject({ resumeText: "React", skills: [], parseConfidence: 0.2 }));
    assert.ok(full.confidence > thin.confidence);
  });

  it("never lets a protected-information line become evidence", () => {
    const hit = scoreSubject(
      query({ requiredSkills: ["React"] }),
      subject({ skills: [], resumeText: "Religion: Islam, React developer\nBuilt a React dashboard for a bank" }),
    );
    const skills = hit.breakdown.find((b) => b.criterion === "skills");
    assert.ok(!skills?.evidence.some((e) => /Religion/i.test(e)), `protected line leaked: ${JSON.stringify(skills?.evidence)}`);
    assert.ok(skills?.evidence.some((e) => /dashboard/.test(e)));
  });

  it("weighs criteria by the published weights, redistributing the rest", () => {
    assert.equal(aggregateSearch([{ score: 100, weight: SEARCH_WEIGHTS.skills }, { score: 0, weight: SEARCH_WEIGHTS.experience }]), 67);
    assert.equal(aggregateSearch([{ score: 80, weight: SEARCH_WEIGHTS.skills }, { score: null, weight: SEARCH_WEIGHTS.location }]), 80);
    assert.equal(aggregateSearch([{ score: null, weight: 10 }]), 0);
  });
});
