/**
 * Demo data for local development: one organization, team members across roles,
 * three jobs and a set of candidates with resumes already in the pipeline.
 * Run with: pnpm db:seed
 */
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Role } from "../src/generated/prisma/enums";
import { DEFAULT_STAGES } from "../src/orgs/defaults";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const storageDir = path.resolve(process.env.STORAGE_DIR ?? "./storage");
const PASSWORD = "Veyra12345";

const TEAM: { name: string; email: string; role: Role }[] = [
  { name: "Nusrat Jahan", email: "owner@veyra.test", role: "OWNER" },
  { name: "Tanvir Ahmed", email: "hr@veyra.test", role: "HR_MANAGER" },
  { name: "Sadia Rahman", email: "recruiter@veyra.test", role: "RECRUITER" },
  { name: "Imran Hossain", email: "manager@veyra.test", role: "HIRING_MANAGER" },
  { name: "Farhana Akter", email: "viewer@veyra.test", role: "VIEWER" },
];

interface CandidateSeed {
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  years: number;
  skills: string[];
  education: { degree: string; field: string; institution: string; endYear: string };
  experience: { title: string; company: string; startDate: string; endDate: string | null; description: string }[];
  projects?: { name: string; description: string; technologies: string[] }[];
  certifications?: { name: string; issuer: string; year: string }[];
}

const CANDIDATES: CandidateSeed[] = [
  {
    name: "Arif Chowdhury", email: "arif.chowdhury@example.com", phone: "+8801712345601", location: "Dhaka, Bangladesh",
    headline: "Senior Full Stack Engineer", years: 7,
    skills: ["JavaScript", "TypeScript", "React", "Node.js", "PostgreSQL", "AWS", "Docker", "REST APIs"],
    education: { degree: "BSc", field: "Computer Science and Engineering", institution: "BUET", endYear: "2017" },
    experience: [
      { title: "Senior Software Engineer", company: "Brain Station 23", startDate: "2021-03", endDate: null, description: "Led a team of five on a multi-tenant SaaS platform using React, Node.js and PostgreSQL on AWS." },
      { title: "Software Engineer", company: "Therap BD", startDate: "2017-08", endDate: "2021-02", description: "Built REST APIs and React dashboards for healthcare case management." },
    ],
    projects: [{ name: "Inventory sync service", description: "Event-driven stock synchronisation across warehouses", technologies: ["Node.js", "PostgreSQL", "Docker"] }],
    certifications: [{ name: "AWS Certified Solutions Architect - Associate", issuer: "Amazon Web Services", year: "2022" }],
  },
  {
    name: "Mehjabin Karim", email: "mehjabin.karim@example.com", phone: "+8801712345602", location: "Dhaka, Bangladesh",
    headline: "Frontend Engineer", years: 4,
    skills: ["JavaScript", "TypeScript", "React", "Next.js", "Tailwind CSS", "Jest"],
    education: { degree: "BSc", field: "Computer Science", institution: "North South University", endYear: "2020" },
    experience: [
      { title: "Frontend Engineer", company: "Shikho", startDate: "2021-01", endDate: null, description: "Owned the learner web app in Next.js; improved Core Web Vitals and accessibility." },
      { title: "Junior Developer", company: "Kaz Software", startDate: "2020-06", endDate: "2020-12", description: "Maintained React components and wrote unit tests with Jest." },
    ],
    projects: [{ name: "Design system", description: "Shared component library used across three products", technologies: ["React", "TypeScript", "Tailwind CSS"] }],
  },
  {
    name: "Rafiul Islam", email: "rafiul.islam@example.com", phone: "+8801712345603", location: "Chattogram, Bangladesh",
    headline: "Backend Engineer", years: 6,
    skills: ["Python", "Django", "PostgreSQL", "Redis", "Docker", "Kubernetes", "AWS", "Microservices"],
    education: { degree: "MSc", field: "Computer Science", institution: "University of Dhaka", endYear: "2019" },
    experience: [
      { title: "Backend Engineer", company: "Pathao", startDate: "2019-09", endDate: null, description: "Built and scaled ride-matching services in Python with Redis and PostgreSQL; moved deployments to Kubernetes." },
    ],
    certifications: [{ name: "Certified Kubernetes Application Developer", issuer: "CNCF", year: "2023" }],
  },
  {
    name: "Sumaiya Hoque", email: "sumaiya.hoque@example.com", phone: "+8801712345604", location: "Dhaka, Bangladesh",
    headline: "HR Executive", years: 3,
    skills: ["Recruitment", "HR Management", "Payroll", "Labour Law", "Excel", "Communication"],
    education: { degree: "MBA", field: "Human Resource Management", institution: "Institute of Business Administration, DU", endYear: "2021" },
    experience: [
      { title: "HR Executive", company: "Square Group", startDate: "2021-07", endDate: null, description: "Handled end-to-end recruitment for 40+ roles a year and monthly payroll for 300 staff." },
    ],
  },
  {
    name: "Nayeem Hasan", email: "nayeem.hasan@example.com", phone: "+8801712345605", location: "Dhaka, Bangladesh",
    headline: "Junior Web Developer", years: 1,
    skills: ["JavaScript", "React", "HTML", "CSS", "Git"],
    education: { degree: "BSc", field: "Software Engineering", institution: "Daffodil International University", endYear: "2024" },
    experience: [{ title: "Intern Developer", company: "Cefalo", startDate: "2024-02", endDate: "2025-01", description: "Built internal tools in React under senior supervision." }],
  },
  {
    name: "Tasnim Ferdous", email: "tasnim.ferdous@example.com", phone: "+8801712345606", location: "Sylhet, Bangladesh",
    headline: "Senior Talent Acquisition Specialist", years: 8,
    skills: ["Recruitment", "HR Management", "Leadership", "Communication", "Jira", "Labour Law"],
    education: { degree: "MBA", field: "Management", institution: "Shahjalal University of Science and Technology", endYear: "2016" },
    experience: [
      { title: "Senior Talent Acquisition Specialist", company: "Grameenphone", startDate: "2019-04", endDate: null, description: "Owned technical hiring for engineering; reduced time to hire from 52 to 31 days." },
      { title: "Recruitment Officer", company: "Robi Axiata", startDate: "2017-01", endDate: "2019-03", description: "Campus hiring and assessment centre coordination." },
    ],
  },
];

function resumeText(c: CandidateSeed): string {
  return [
    c.name,
    `${c.headline} | ${c.location}`,
    `Email: ${c.email} | Phone: ${c.phone}`,
    "",
    "PROFESSIONAL SUMMARY",
    `${c.headline} with around ${c.years} years of experience.`,
    "",
    "TECHNICAL SKILLS",
    c.skills.join(", "),
    "",
    "WORK EXPERIENCE",
    ...c.experience.flatMap((e) => [`${e.title}, ${e.company} (${e.startDate} - ${e.endDate ?? "Present"})`, `  ${e.description}`]),
    "",
    "EDUCATION",
    `${c.education.degree} in ${c.education.field}, ${c.education.institution}, ${c.education.endYear}`,
    "",
    ...(c.projects?.length ? ["PROJECTS", ...c.projects.map((p) => `${p.name}: ${p.description} (${p.technologies.join(", ")})`), ""] : []),
    ...(c.certifications?.length ? ["CERTIFICATIONS", ...c.certifications.map((x) => `${x.name} - ${x.issuer}, ${x.year}`), ""] : []),
    "LANGUAGES",
    "Bengali (native), English (fluent)",
  ].join("\n");
}

/** Minimal single-page PDF so the demo resumes are real, downloadable files. */
function makePdf(text: string): Buffer {
  const lines = text.split("\n").slice(0, 48).map((l) => l.slice(0, 95));
  const content =
    "BT /F1 9 Tf 40 780 Td 11 TL\n" +
    lines.map((l) => `(${l.replace(/[\\()]/g, (m) => "\\" + m).replace(/[^\x20-\x7e]/g, "")}) Tj T*`).join("\n") +
    "\nET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function main() {
  console.log("Seeding Veyra Talent demo data...");
  const existing = await prisma.organization.findUnique({ where: { slug: "veyra-demo" } });
  if (existing) {
    console.log("Removing previous demo organization...");
    await prisma.organization.delete({ where: { id: existing.id } });
    await prisma.user.deleteMany({ where: { email: { in: TEAM.map((t) => t.email) } } });
  }

  const org = await prisma.organization.create({
    data: {
      name: "Veyra Demo Industries",
      slug: "veyra-demo",
      industry: "Information Technology",
      companySize: "51-200",
      country: "Bangladesh",
      brandColor: "#4f46e5",
      blindModeDefault: false,
    },
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const users = await Promise.all(
    TEAM.map((t) =>
      prisma.user.create({
        data: { email: t.email, name: t.name, passwordHash, emailVerifiedAt: new Date(), memberships: { create: { organizationId: org.id, role: t.role } } },
      }),
    ),
  );
  const owner = users[0];
  const recruiter = users[2];

  await prisma.pipelineStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ ...s, organizationId: org.id, position: i })) });
  const stages = await prisma.pipelineStage.findMany({ where: { organizationId: org.id }, orderBy: { position: "asc" } });
  const stageByKind = Object.fromEntries(stages.map((s) => [s.kind, s]));

  const engineering = await prisma.department.create({ data: { organizationId: org.id, name: "Engineering" } });
  const people = await prisma.department.create({ data: { organizationId: org.id, name: "People & Culture" } });

  const seniorEngineer = await prisma.job.create({
    data: {
      organizationId: org.id, createdById: owner.id, departmentId: engineering.id,
      title: "Senior Full Stack Engineer",
      description:
        "We are looking for a senior full stack engineer to help build and scale our multi-tenant SaaS products. " +
        "You will design APIs, build React interfaces, and work closely with product and design. You will also mentor " +
        "mid-level engineers and take part in architecture decisions.",
      responsibilities: "- Design and build features end to end\n- Review code and mentor engineers\n- Improve reliability and performance",
      location: "Dhaka, Bangladesh", workMode: "HYBRID", employmentType: "FULL_TIME", status: "PUBLISHED", publishedAt: new Date(),
      requiredSkills: ["JavaScript", "TypeScript", "React", "Node.js", "PostgreSQL"],
      preferredSkills: ["AWS", "Docker", "Next.js"],
      minExperienceYears: 5, educationRequirement: "Bachelor's degree in Computer Science or equivalent experience",
      salaryMin: 150000, salaryMax: 250000, salaryCurrency: "BDT", openings: 2, hiringManagerIds: [users[3].id],
    },
  });

  const backendEngineer = await prisma.job.create({
    data: {
      organizationId: org.id, createdById: owner.id, departmentId: engineering.id,
      title: "Backend Engineer (Python)",
      description:
        "Join our platform team to build reliable backend services in Python. You will work on APIs, data pipelines " +
        "and the infrastructure that supports them, with a focus on correctness and observability.",
      location: "Remote (Bangladesh)", workMode: "REMOTE", employmentType: "FULL_TIME", status: "PUBLISHED", publishedAt: new Date(),
      requiredSkills: ["Python", "PostgreSQL", "REST APIs"],
      preferredSkills: ["Django", "Kubernetes", "Redis", "AWS"],
      minExperienceYears: 3, educationRequirement: "Bachelor's degree",
      salaryMin: 120000, salaryMax: 200000, salaryCurrency: "BDT", openings: 1,
    },
  });

  await prisma.job.create({
    data: {
      organizationId: org.id, createdById: owner.id, departmentId: people.id,
      title: "Talent Acquisition Specialist",
      description:
        "Own technical and non-technical hiring end to end: sourcing, screening, interview coordination and offers. " +
        "You will partner with hiring managers and improve our hiring process with data.",
      location: "Dhaka, Bangladesh", workMode: "ONSITE", employmentType: "FULL_TIME", status: "DRAFT",
      requiredSkills: ["Recruitment", "HR Management", "Communication"],
      preferredSkills: ["Labour Law", "Excel"],
      minExperienceYears: 2, salaryMin: 60000, salaryMax: 100000, salaryCurrency: "BDT", openings: 1,
    },
  });

  await mkdir(storageDir, { recursive: true });
  const pipelinePlan = ["SCREENING", "SHORTLISTED", "INTERVIEW", "APPLIED", "APPLIED", "SHORTLISTED"] as const;

  for (const [i, c] of CANDIDATES.entries()) {
    const text = resumeText(c);
    const pdf = makePdf(text);
    const key = `${org.id}/seed/${randomUUID()}.pdf`;
    const full = path.join(storageDir, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, pdf);

    const parsed = {
      resumeLanguage: "English",
      contact: { fullName: c.name, email: c.email, phone: c.phone, location: c.location, linkedinUrl: null, githubUrl: null, portfolioUrl: null },
      headline: c.headline,
      summary: `${c.headline} with around ${c.years} years of experience in ${c.skills.slice(0, 3).join(", ")}.`,
      totalExperienceYears: c.years,
      skills: c.skills.map((s) => ({ name: s, category: null, evidence: `TECHNICAL SKILLS: ${c.skills.join(", ")}`, confidence: 0.92 })),
      experience: c.experience.map((e) => ({
        title: e.title, company: e.company, startDate: e.startDate, endDate: e.endDate, isCurrent: e.endDate === null,
        description: e.description, evidence: `${e.title}, ${e.company} (${e.startDate} - ${e.endDate ?? "Present"})`, confidence: 0.9,
      })),
      education: [{ degree: c.education.degree, field: c.education.field, institution: c.education.institution, endYear: c.education.endYear, grade: null, evidence: `${c.education.degree} in ${c.education.field}, ${c.education.institution}, ${c.education.endYear}`, confidence: 0.9 }],
      certifications: (c.certifications ?? []).map((x) => ({ name: x.name, issuer: x.issuer, year: x.year, evidence: `${x.name} - ${x.issuer}, ${x.year}`, confidence: 0.88 })),
      projects: (c.projects ?? []).map((p) => ({ name: p.name, description: p.description, technologies: p.technologies, url: null, evidence: `${p.name}: ${p.description}`, confidence: 0.85 })),
      languages: [{ name: "Bengali", proficiency: "Native" }, { name: "English", proficiency: "Fluent" }],
      missingFields: [],
      overallConfidence: 0.9,
    };

    const candidate = await prisma.candidate.create({
      data: {
        organizationId: org.id, fullName: c.name, email: c.email, phone: c.phone, location: c.location, headline: c.headline,
        summary: parsed.summary, totalExperienceYears: c.years, skills: c.skills, languages: ["Bengali", "English"],
        profile: { experience: parsed.experience, education: parsed.education, certifications: parsed.certifications, projects: parsed.projects, skillDetails: parsed.skills, resumeLanguage: "English" },
        missingFields: [], source: "UPLOAD", consentStatus: "GRANTED", consentUpdatedAt: new Date(), createdById: recruiter.id,
        resumes: {
          create: {
            organizationId: org.id, fileName: `${c.name.replace(/\s+/g, "_")}_CV.pdf`, mimeType: "application/pdf",
            sizeBytes: pdf.length, storageKey: key, sha256: randomUUID().replace(/-/g, ""), status: "PARSED",
            rawText: text, parsed, parseMethod: "AI", model: "seed-data", promptVersion: "resume-parse-v1",
            overallConfidence: 0.9, uploadedById: recruiter.id, processedAt: new Date(),
          },
        },
      },
    });

    const isHr = c.skills.includes("Recruitment");
    const job = isHr ? null : i === 2 ? backendEngineer : seniorEngineer;
    if (job) {
      const stage = stageByKind[pipelinePlan[i]] ?? stageByKind.APPLIED;
      await prisma.application.create({
        data: {
          organizationId: org.id, jobId: job.id, candidateId: candidate.id, stageId: stage.id, source: "UPLOAD",
          createdAt: new Date(Date.now() - (6 - i) * 86_400_000),
        },
      });
    }
  }

  console.log(`\nDemo organization: ${org.name}`);
  console.log("Sign in with any of these (password: " + PASSWORD + "):");
  for (const t of TEAM) console.log(`  ${t.role.padEnd(14)} ${t.email}`);
  console.log(`\n${CANDIDATES.length} candidates, 3 jobs. Run matching from a job to generate AI scores.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
