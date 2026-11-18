import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectResumeKind, expandZip } from "../src/resumes/file-types";
import { estimateExperience, findPhone, heuristicParse, normalizePhone } from "../src/resumes/heuristic-parser";
import { canonicalSkill, findSkills } from "../src/resumes/skills";
import { normalizeParsed, ParsedResumeSchema } from "../src/resumes/parsed-resume";
import AdmZip from "adm-zip";

const RESUME = `Arif Chowdhury
Senior Full Stack Engineer | Dhaka, Bangladesh
Email: arif.chowdhury@example.com | Phone: +8801712345601
linkedin.com/in/arifchowdhury | github.com/arifc

TECHNICAL SKILLS
JavaScript, TypeScript, React, Node.js, PostgreSQL, AWS, Docker

WORK EXPERIENCE
Senior Software Engineer, Brain Station 23 (Mar 2021 - Present)
Software Engineer, Therap BD (Aug 2017 - Feb 2021)

EDUCATION
BSc in Computer Science and Engineering, BUET, 2017, CGPA 3.75

LANGUAGES
Bengali (native), English (fluent)`;

describe("heuristicParse", () => {
  const parsed = heuristicParse(RESUME);

  it("produces output valid against the shared schema", () => {
    assert.equal(ParsedResumeSchema.safeParse(parsed).success, true);
  });

  it("extracts contact details", () => {
    assert.equal(parsed.contact.email, "arif.chowdhury@example.com");
    assert.equal(parsed.contact.fullName, "Arif Chowdhury");
    assert.ok(parsed.contact.phone?.includes("1712345601"));
    assert.ok(parsed.contact.linkedinUrl?.startsWith("https://"));
    assert.ok(parsed.contact.githubUrl?.includes("github.com"));
  });

  it("extracts skills with evidence from the resume", () => {
    const names = parsed.skills.map((s) => s.name);
    for (const skill of ["JavaScript", "TypeScript", "React", "Node.js", "PostgreSQL", "Docker"]) {
      assert.ok(names.includes(skill), `missing ${skill}`);
    }
    assert.ok(parsed.skills.every((s) => s.evidence.length > 0), "every skill needs evidence");
  });

  it("estimates experience from employment dates only", () => {
    assert.ok(parsed.totalExperienceYears != null && parsed.totalExperienceYears > 7, `got ${parsed.totalExperienceYears}`);
  });

  it("extracts education and languages", () => {
    assert.ok(parsed.education.length >= 1);
    assert.ok(parsed.education[0].institution?.includes("BUET"));
    assert.deepEqual(parsed.languages.map((l) => l.name).sort(), ["Bengali", "English"]);
  });

  it("reports missing fields for a sparse resume", () => {
    const sparse = heuristicParse("Rafiul Islam\nLooking for opportunities.");
    assert.ok(sparse.missingFields.includes("email"));
    assert.ok(sparse.missingFields.includes("phone"));
    assert.ok(sparse.overallConfidence < 0.5);
  });

  it("keeps confidences within 0..1", () => {
    const bad = normalizeParsed({ ...parsed, overallConfidence: 5, skills: parsed.skills.map((s) => ({ ...s, confidence: -2 })) });
    assert.equal(bad.overallConfidence, 1);
    assert.ok(bad.skills.every((s) => s.confidence === 0));
  });
});

describe("experience estimation", () => {
  it("merges overlapping ranges instead of double counting", () => {
    const { years } = estimateExperience("Engineer A 2015 - 2020\nConsultant B 2018 - 2020", new Date("2026-01-01"));
    assert.equal(years, 5);
  });

  it("ignores education date ranges", () => {
    const { years } = estimateExperience("BSc, BUET 2013 - 2017\nEngineer 2020 - 2022", new Date("2026-01-01"));
    assert.equal(years, 2);
  });

  it("treats 'Present' as today", () => {
    const { years } = estimateExperience("Engineer Jan 2020 - Present", new Date("2026-01-01"));
    assert.ok(years != null && Math.abs(years - 6) < 0.2, `got ${years}`);
  });

  it("returns null when no dates are present", () => {
    assert.equal(estimateExperience("Experienced engineer").years, null);
  });
});

describe("phone handling", () => {
  it("finds Bangladeshi numbers in common formats", () => {
    assert.ok(findPhone("Cell: 01712-345601")?.includes("01712"));
    assert.ok(findPhone("Mobile +880 1712 345601")?.includes("1712"));
  });

  it("normalises numbers to the same key for duplicate detection", () => {
    assert.equal(normalizePhone("+8801712345601"), normalizePhone("01712-345601"));
    assert.equal(normalizePhone("123"), null);
  });
});

describe("skills taxonomy", () => {
  it("canonicalises aliases", () => {
    assert.equal(canonicalSkill("nodejs"), "Node.js");
    assert.equal(canonicalSkill("postgres"), "PostgreSQL");
    assert.equal(canonicalSkill("k8s"), "Kubernetes");
  });

  it("keeps unknown skills as written", () => {
    assert.equal(canonicalSkill("Bangla typing"), "Bangla typing");
  });

  it("does not match ambiguous words used in plain prose", () => {
    const found = findSkills("I express my interest in this spring season role. Excellent at lean processes.").map((s) => s.name);
    assert.ok(!found.includes("Express.js"), `false positive: ${found.join(", ")}`);
    assert.ok(!found.includes("Spring"), `false positive: ${found.join(", ")}`);
  });

  it("matches tokens with punctuation", () => {
    const found = findSkills("Proficient in C++, C#, .NET and Node.js").map((s) => s.name);
    for (const s of ["C++", "C#", ".NET", "Node.js"]) assert.ok(found.includes(s), `missed ${s} in ${found.join(", ")}`);
  });
});

describe("file type detection", () => {
  it("accepts a PDF by magic bytes", () => {
    assert.equal(detectResumeKind(Buffer.from("%PDF-1.4\nrest of file")), "pdf");
  });

  it("rejects an executable renamed as a resume", () => {
    assert.equal(detectResumeKind(Buffer.from("MZ\x90\x00\x03\x00\x00\x00")), null);
  });

  it("rejects a ZIP that is not a DOCX", () => {
    const zip = new AdmZip();
    zip.addFile("notes.txt", Buffer.from("hello"));
    assert.equal(detectResumeKind(zip.toBuffer()), null);
  });

  it("rejects a macro-enabled Word document", () => {
    const zip = new AdmZip();
    zip.addFile("word/document.xml", Buffer.from("<w:document/>"));
    zip.addFile("word/vbaProject.bin", Buffer.from("macro"));
    assert.equal(detectResumeKind(zip.toBuffer()), null);
  });

  it("expands a ZIP of resumes and skips junk entries", () => {
    const zip = new AdmZip();
    zip.addFile("a.pdf", Buffer.from("%PDF-1.4 a"));
    zip.addFile("sub/b.docx", Buffer.from("PK stub"));
    zip.addFile("__MACOSX/._a.pdf", Buffer.from("junk"));
    zip.addFile("readme.txt", Buffer.from("junk"));
    const files = expandZip(zip.toBuffer(), { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 4096 });
    assert.deepEqual(files.map((f) => f.name).sort(), ["a.pdf", "b.docx"]);
  });

  it("refuses an archive with too many entries", () => {
    const zip = new AdmZip();
    for (let i = 0; i < 5; i++) zip.addFile(`cv${i}.pdf`, Buffer.from("%PDF-1.4"));
    assert.throws(() => expandZip(zip.toBuffer(), { maxEntries: 2, maxEntryBytes: 1024, maxTotalBytes: 4096 }), /more than 2 files/);
  });
});
