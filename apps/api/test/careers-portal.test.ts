import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicationReference,
  experienceLabel,
  isListable,
  jobCard,
  jobDetail,
  salaryRange,
  teaser,
  type PortalJobSource,
} from "../src/careers/public-view";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-18T12:00:00.000Z");

function job(overrides: Partial<PortalJobSource> = {}): PortalJobSource {
  return {
    id: "ckjob0000000000000000001",
    title: "Senior Backend Engineer",
    description: "## About the role\n\nYou will build **payment** services with [our team](https://example.com).",
    responsibilities: "- Design APIs\n- Mentor engineers",
    location: "Dhaka, Bangladesh",
    workMode: "HYBRID",
    employmentType: "FULL_TIME",
    status: "PUBLISHED",
    publicApply: true,
    requiredSkills: ["Node.js", "PostgreSQL", "TypeScript", "Docker", "AWS", "Redis", "Kafka", "GraphQL", "Terraform"],
    preferredSkills: ["Kubernetes"],
    minExperienceYears: 5,
    maxExperienceYears: 8,
    educationRequirement: "BSc in Computer Science or equivalent experience",
    salaryMin: 150_000,
    salaryMax: 220_000,
    salaryCurrency: "BDT",
    salaryVisible: true,
    publishedAt: new Date("2026-11-10T09:00:00.000Z"),
    expiresAt: null,
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    department: { id: "ckdep001", name: "Engineering" },
    ...overrides,
  };
}

describe("careers portal — which jobs the public may see", () => {
  it("lists a published job that is flagged for public apply", () => {
    assert.equal(isListable(job(), now), true);
  });

  for (const status of ["DRAFT", "CLOSED", "ARCHIVED"] as const) {
    it(`hides a ${status} job`, () => {
      assert.equal(isListable(job({ status }), now), false);
    });
  }

  it("hides a published job the organization kept off the portal", () => {
    // Confidential or internal-only searches stay published for staff but unlisted.
    assert.equal(isListable(job({ publicApply: false }), now), false);
  });

  it("hides a job whose closing date has passed", () => {
    assert.equal(isListable(job({ expiresAt: new Date(now.getTime() - HOUR) }), now), false);
  });

  it("still lists a job that closes later today", () => {
    assert.equal(isListable(job({ expiresAt: new Date(now.getTime() + HOUR) }), now), true);
  });

  it("treats no closing date as open", () => {
    assert.equal(isListable(job({ expiresAt: null }), now), true);
  });
});

describe("careers portal — salary visibility", () => {
  it("shows the range when the job publishes it", () => {
    assert.deepEqual(salaryRange(job()), { min: 150_000, max: 220_000, currency: "BDT" });
  });

  it("withholds the range when the job does not publish it", () => {
    assert.equal(salaryRange(job({ salaryVisible: false })), null);
  });

  it("withholds an empty range even when publishing is on", () => {
    assert.equal(salaryRange(job({ salaryMin: null, salaryMax: null })), null);
  });

  it("publishes an open-ended minimum", () => {
    assert.deepEqual(salaryRange(job({ salaryMax: null })), { min: 150_000, max: null, currency: "BDT" });
  });
});

describe("careers portal — experience label", () => {
  it("reads as a range", () => {
    assert.equal(experienceLabel(job()), "5-8 years");
  });

  it("collapses an equal range", () => {
    assert.equal(experienceLabel(job({ minExperienceYears: 3, maxExperienceYears: 3 })), "3 years");
  });

  it("reads as a floor when there is no ceiling", () => {
    assert.equal(experienceLabel(job({ maxExperienceYears: null })), "5+ years");
  });

  it("reads as a ceiling when there is no floor", () => {
    assert.equal(experienceLabel(job({ minExperienceYears: null })), "Up to 8 years");
  });

  it("is absent when the job says nothing about experience", () => {
    assert.equal(experienceLabel(job({ minExperienceYears: null, maxExperienceYears: null })), null);
  });
});

describe("careers portal — listing teaser", () => {
  it("strips markdown punctuation and link targets", () => {
    const text = teaser(job().description);
    assert.equal(text.includes("#"), false);
    assert.equal(text.includes("*"), false);
    assert.equal(text.includes("https://example.com"), false);
    assert.equal(text.includes("our team"), true);
    assert.equal(text.startsWith("About the role"), true);
  });

  it("leaves a short description untouched", () => {
    assert.equal(teaser("We are hiring a cook."), "We are hiring a cook.");
  });

  it("truncates on a word boundary, never mid-word", () => {
    const text = teaser(`${"alpha bravo ".repeat(40)}charlie`, 40);
    assert.equal(text.endsWith("…"), true);
    assert.ok(text.length <= 41, `too long: ${text.length}`);
    assert.equal(/alph…$|brav…$/.test(text), false);
  });

  it("drops fenced code blocks rather than printing them", () => {
    assert.equal(teaser("Join us.\n\n```\nsecret()\n```"), "Join us.");
  });
});

describe("careers portal — what the card and the advert expose", () => {
  const forbidden = ["hiringManagerIds", "matchingCriteria", "openings", "createdById", "status", "publicApply", "organizationId"];

  it("keeps hiring data out of the listing card", () => {
    const card = jobCard(job());
    for (const key of forbidden) assert.equal(key in card, false, `card leaked ${key}`);
  });

  it("keeps hiring data out of the advert", () => {
    const detail = jobDetail(job());
    for (const key of forbidden) assert.equal(key in detail, false, `advert leaked ${key}`);
  });

  it("caps the skills shown on a card but shows all of them on the advert", () => {
    assert.equal(jobCard(job()).requiredSkills.length, 8);
    assert.equal(jobDetail(job()).requiredSkills.length, 9);
  });

  it("falls back to the creation date when a job has no publish date", () => {
    const card = jobCard(job({ publishedAt: null }));
    assert.equal(card.postedAt.toISOString(), "2026-11-01T09:00:00.000Z");
  });

  it("names the department rather than exposing its id", () => {
    assert.equal(jobCard(job()).department, "Engineering");
    assert.equal(jobCard(job({ department: null })).department, null);
  });

  it("withholds the salary on the advert too when the job does not publish it", () => {
    assert.equal(jobDetail(job({ salaryVisible: false })).salary, null);
  });
});

describe("careers portal — application reference", () => {
  it("is derived from the application id, so it is stable", () => {
    assert.equal(applicationReference("ckapp0000000000000abcdef"), "VT-00ABCDEF");
    assert.equal(applicationReference("ckapp0000000000000abcdef"), applicationReference("ckapp0000000000000abcdef"));
  });

  it("does not reveal the whole id, so it cannot be used as a lookup key by itself", () => {
    const id = "ckapp0000000000000abcdef";
    assert.equal(applicationReference(id).includes(id), false);
  });
});
