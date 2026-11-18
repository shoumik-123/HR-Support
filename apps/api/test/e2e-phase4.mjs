// End-to-end smoke test for Phase 4 (the public careers portal) against a running API
// with seeded demo data. Run: pnpm db:seed && pnpm test:e2e:phase4
const B = "http://localhost:4000/api";
let pass = 0, fail = 0;

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function call(path, { token, org, method, body, form, expect } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers["X-Org-Id"] = org;
  if (body !== undefined && !form) headers["Content-Type"] = "application/json";
  const res = await fetch(`${B}${path}`, {
    method: method ?? (body || form ? "POST" : "GET"),
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (expect !== undefined && res.status !== expect) {
    throw new Error(`${path} expected ${expect}, got ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: json };
}

async function login(email) {
  let r;
  for (let i = 0; i < 8; i++) {
    r = await call("/auth/login", { body: { email, password: "Veyra12345" } });
    if (r.status !== 429) break;
    await new Promise((x) => setTimeout(x, 20_000));
  }
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status}`);
  const me = await call("/auth/me", { token: r.body.accessToken, expect: 200 });
  return { token: r.body.accessToken, org: me.body.organizations[0].id };
}

/** A real PDF by magic bytes; the background parse will find no text, which is its own concern. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
const EXE = Buffer.from(`MZ\x90\x00\x03\x00\x00\x00${"x".repeat(400)}`);

/** Publishing a job enforces a real advert: a long enough description and at least one required skill. */
const PUBLISHABLE_DESCRIPTION =
  "This is a fixture vacancy created by the Phase 4 end-to-end suite. It exists only so the careers portal has something to hide or show, and it is removed again when the suite finishes.";

/** Emails are unique per run so a re-run without reseeding still exercises a first-time applicant. */
const run = Date.now().toString(36);
const applicantEmail = `portal.${run}@example.com`;

function applyForm(fields, file = PDF, fileName = "resume.pdf") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  if (file) fd.append("resume", new Blob([file], { type: "application/pdf" }), fileName);
  return fd;
}

const owner = await login("owner@veyra.test");
const recruiter = await login("recruiter@veyra.test");
const O = { token: owner.token, org: owner.org };
const H = { token: recruiter.token, org: recruiter.org };

const orgRow = (await call("/org", { ...O, expect: 200 })).body;
const slug = orgRow.slug;
const P = `/public/careers/${slug}`;

// Preconditions: the portal on, and blind mode off so the suite can read back the
// contact details an applicant typed. Blind mode gets its own check further down.
await call("/org", { ...O, method: "PATCH", body: { careersEnabled: true, careersIntro: "We build software in Dhaka.", blindModeDefault: false }, expect: 200 });

console.log("\n== Public job board ==");
const board = await call(P, { expect: 200 });
check("the board opens with no token at all", board.body.items.length > 0, JSON.stringify(board.body).slice(0, 200));
check("it names the employer", board.body.organization?.name === orgRow.name);
check("it carries the intro the organization wrote", board.body.organization?.intro === "We build software in Dhaka.");
check("it offers filter values drawn from the open roles", Array.isArray(board.body.filters?.departments) && board.body.filters.departments.length > 0);

const leaked = ["hiringManagerIds", "matchingCriteria", "openings", "createdById", "status", "publicApply", "organizationId", "departmentId"];
const firstCard = board.body.items[0];
check(
  "a listing card carries no hiring data",
  leaked.every((k) => !(k in firstCard)),
  leaked.filter((k) => k in firstCard).join(", "),
);
check("a listing card carries a teaser rather than the whole description", typeof firstCard.teaser === "string" && firstCard.teaser.length <= 230);

const remote = await call(`${P}?workMode=REMOTE`, { expect: 200 });
check("filtering by work mode narrows the list", remote.body.items.every((j) => j.workMode === "REMOTE") && remote.body.items.length < board.body.items.length);

const searched = await call(`${P}?search=${encodeURIComponent(firstCard.title.split(" ")[0])}`, { expect: 200 });
check("searching by title finds the role", searched.body.items.some((j) => j.id === firstCard.id));

const nonsense = await call(`${P}?search=zzzzzznotathing`, { expect: 200 });
check("a search that matches nothing returns an empty list, not an error", nonsense.body.items.length === 0 && nonsense.body.total === 0);

const unknown = await call("/public/careers/no-such-employer");
check("an unknown slug is a 404", unknown.status === 404, `got ${unknown.status}`);

console.log("\n== What stays off the portal ==");
const draft = (await call("/jobs", { ...O, body: { title: `Portal draft ${run}`, description: "A draft that must never be public." }, expect: 201 })).body;
check("a draft job is absent from the board", !(await call(P, { expect: 200 })).body.items.some((j) => j.id === draft.id));
check("a draft job's public page is a 404", (await call(`${P}/jobs/${draft.id}`)).status === 404);

const confidential = (await call("/jobs", { ...O, body: { title: `Confidential search ${run}`, description: PUBLISHABLE_DESCRIPTION, requiredSkills: ["Node.js"], publicApply: false }, expect: 201 })).body;
await call(`/jobs/${confidential.id}/publish`, { ...O, method: "POST", expect: 200 });
const afterConfidential = await call(P, { expect: 200 });
check("a published job kept off the careers page is absent from the board", !afterConfidential.body.items.some((j) => j.id === confidential.id));
check("its public page is a 404, so the portal never confirms it exists", (await call(`${P}/jobs/${confidential.id}`)).status === 404);
check("applying to it is a 404 too", (await call(`${P}/jobs/${confidential.id}/apply`, { form: applyForm({ fullName: "Nobody", email: `x.${run}@example.com`, consent: "true" }) })).status === 404);

// Publishing refuses a past expiry, so the job is published with a live date and the
// date is then moved back — which is what happens in life when a vacancy closes.
const expired = (await call("/jobs", { ...O, body: { title: `Expired role ${run}`, description: PUBLISHABLE_DESCRIPTION, requiredSkills: ["Node.js"], expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, expect: 201 })).body;
await call(`/jobs/${expired.id}/publish`, { ...O, method: "POST", expect: 200 });
await call(`/jobs/${expired.id}`, { ...O, method: "PATCH", body: { expiresAt: new Date(Date.now() - 86_400_000).toISOString() }, expect: 200 });
check("a job past its closing date is absent from the board", !(await call(P, { expect: 200 })).body.items.some((j) => j.id === expired.id));
check("its public page is a 404", (await call(`${P}/jobs/${expired.id}`)).status === 404);

check("a job id that does not exist is a 404", (await call(`${P}/jobs/ckdoesnotexist000000000`)).status === 404);

console.log("\n== Salary visibility ==");
const paid = (await call("/jobs", { ...O, body: { title: `Open salary ${run}`, description: PUBLISHABLE_DESCRIPTION, requiredSkills: ["Node.js"], salaryMin: 90_000, salaryMax: 120_000, salaryVisible: true }, expect: 201 })).body;
await call(`/jobs/${paid.id}/publish`, { ...O, method: "POST", expect: 200 });
const paidPublic = await call(`${P}/jobs/${paid.id}`, { expect: 200 });
check("a published range is shown", paidPublic.body.job.salary?.min === 90_000 && paidPublic.body.job.salary?.max === 120_000);

await call(`/jobs/${paid.id}`, { ...O, method: "PATCH", body: { salaryVisible: false }, expect: 200 });
const hiddenPublic = await call(`${P}/jobs/${paid.id}`, { expect: 200 });
check("turning visibility off withholds the range from the public page", hiddenPublic.body.job.salary === null);

console.log("\n== The apply form ==");
const target = (await call(P, { expect: 200 })).body.items.find((j) => j.id !== paid.id) ?? firstCard;

const noResume = await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "Ayesha Siddika", email: applicantEmail, consent: "true" }, null) });
check("an application with no resume is refused", noResume.status === 400, `got ${noResume.status}`);

const noConsent = await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "Ayesha Siddika", email: applicantEmail, consent: "false" }) });
check("an application without consent is refused", noConsent.status === 400, `got ${noConsent.status}`);

const badEmail = await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "Ayesha Siddika", email: "not-an-email", consent: "true" }) });
check("an invalid email is reported as a field issue", badEmail.status === 400 && badEmail.body.issues?.some((i) => i.path === "email"), JSON.stringify(badEmail.body).slice(0, 160));

const shortName = await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "A", email: applicantEmail, consent: "true" }) });
check("a one-letter name is reported as a field issue", shortName.status === 400 && shortName.body.issues?.some((i) => i.path === "fullName"));

const badUrl = await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "Ayesha Siddika", email: applicantEmail, consent: "true", linkedinUrl: "linkedin" }) });
check("a link that is not a full address is reported as a field issue", badUrl.status === 400 && badUrl.body.issues?.some((i) => i.path === "linkedinUrl"));

const disguised = await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "Ayesha Siddika", email: applicantEmail, consent: "true" }, EXE, "resume.pdf") });
check("an executable renamed as a PDF is refused", disguised.status === 400 && /Unsupported file type/i.test(disguised.body.message ?? ""), JSON.stringify(disguised.body).slice(0, 160));

const coverLetter = "I have shipped payment systems for five years and would like to do it with your team.";
const applied = await call(`${P}/jobs/${target.id}/apply`, {
  form: applyForm({
    fullName: "Ayesha Siddika",
    email: applicantEmail,
    phone: `+88017${run.slice(-8).padStart(8, "0")}`,
    location: "Dhaka, Bangladesh",
    headline: "Backend Engineer at Acme",
    linkedinUrl: "https://linkedin.com/in/ayesha-example",
    coverLetter,
    consent: "true",
  }),
});
check("a complete application is accepted", applied.status === 201, `got ${applied.status}: ${JSON.stringify(applied.body).slice(0, 200)}`);
check("the candidate is given a reference", /^VT-[0-9A-Z]{8}$/.test(applied.body.reference ?? ""), applied.body.reference);
check("the receipt names the role and the employer", applied.body.jobTitle === target.title && applied.body.organizationName === orgRow.name);
check("a first-time applicant is not marked as re-applying", applied.body.isReapplication === false);

console.log("\n== What the recruiter sees ==");
const pipeline = await call(`/applications?jobId=${target.id}&pageSize=100`, { ...H, expect: 200 });
const mine = pipeline.body.items.find((a) => a.candidate.email === applicantEmail);
check("the application is in the recruiter's pipeline", !!mine, `looked for ${applicantEmail}`);
check("it is recorded as coming from the careers portal", mine?.source === "CAREER_PORTAL", mine?.source);
// The list endpoint returns a stage name, not its kind, so the Applied stage is
// resolved from the organization's own pipeline rather than matched by name.
const appliedStage = (await call("/org/stages", { ...H, expect: 200 })).body.find((st) => st.kind === "APPLIED");
check("it starts in the Applied stage", mine?.stageId === appliedStage?.id, `${mine?.stage?.name} vs ${appliedStage?.name}`);

const candidateId = mine.candidate.id;
const candidate = (await call(`/candidates/${candidateId}?reveal=true`, { ...H, expect: 200 })).body;
check("the candidate's own typed name is what was stored", candidate.fullName === "Ayesha Siddika", candidate.fullName);
check("the candidate's source is the careers portal", candidate.source === "CAREER_PORTAL", candidate.source);
check("ticking the consent box is recorded as a granted consent", candidate.consentStatus === "GRANTED" && !!candidate.consentUpdatedAt);
check("the resume they attached is on file", (candidate.resumes ?? []).length >= 1);
const storedApp = candidate.applications.find((a) => a.job.id === target.id);
check("what the candidate wrote is kept with the application", storedApp?.coverLetter === coverLetter, String(storedApp?.coverLetter).slice(0, 60));

const audit = (await call("/org/audit?pageSize=50", { ...O, expect: 200 })).body;
check(
  "the application is in the audit log as coming from the portal",
  audit.items.some((a) => a.action === "application.created" && a.data?.via === "careers_portal"),
);

const comms = (await call(`/communications?candidateId=${candidateId}&pageSize=20`, { ...H, expect: 200 })).body;
check(
  "an acknowledgement was sent even though no automation is switched on",
  comms.items.some((c) => c.templateKey === "APPLICATION_RECEIVED" && c.status !== "FAILED"),
  JSON.stringify(comms.items.map((c) => [c.templateKey, c.status])).slice(0, 200),
);

console.log("\n== Applying twice ==");
const again = await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "Ayesha Siddika", email: applicantEmail, consent: "true" }) });
check("applying to the same role twice is refused", again.status === 400 && /already applied/i.test(again.body.message ?? ""), JSON.stringify(again.body).slice(0, 160));

const otherJob = (await call(P, { expect: 200 })).body.items.find((j) => j.id !== target.id && j.id !== paid.id);
if (otherJob) {
  const second = await call(`${P}/jobs/${otherJob.id}/apply`, { form: applyForm({ fullName: "Ayesha Siddika", email: applicantEmail, consent: "true" }) });
  check("the same person may apply to a different role", second.status === 201, `got ${second.status}`);
  check("the second application is marked as a re-application", second.body.isReapplication === true);
  const list = (await call(`/candidates?search=${encodeURIComponent(applicantEmail)}&pageSize=10`, { ...H, expect: 200 })).body;
  check("a returning applicant is merged rather than duplicated", list.items.filter((c) => c.email === applicantEmail).length === 1, JSON.stringify(list.items.map((c) => c.id)));
} else {
  check("the same person may apply to a different role", false, "no second published job on the board");
}

console.log("\n== Switching the portal off ==");
await call("/org", { ...O, method: "PATCH", body: { careersEnabled: false }, expect: 200 });
check("the board stops resolving", (await call(P)).status === 404);
check("an individual advert stops resolving", (await call(`${P}/jobs/${target.id}`)).status === 404);
check("applying stops too", (await call(`${P}/jobs/${target.id}/apply`, { form: applyForm({ fullName: "Too Late", email: `late.${run}@example.com`, consent: "true" }) })).status === 404);
await call("/org", { ...O, method: "PATCH", body: { careersEnabled: true }, expect: 200 });
check("turning it back on restores the board", (await call(P)).status === 200);

console.log("\n== Blind mode covers portal applicants too ==");
await call("/org", { ...O, method: "PATCH", body: { blindModeDefault: true }, expect: 200 });
const maskedCard = (await call(`/applications?jobId=${target.id}&pageSize=100`, { ...H, expect: 200 })).body.items.find((a) => a.id === mine.id);
check(
  "a portal applicant is masked like every other candidate",
  maskedCard?.candidate?.email == null && maskedCard?.candidate?.fullName !== "Ayesha Siddika",
  JSON.stringify(maskedCard?.candidate).slice(0, 140),
);
await call("/org", { ...O, method: "PATCH", body: { blindModeDefault: false }, expect: 200 });

console.log("\n== Tenant isolation on a public route ==");
const spoofed = await call(P, { org: "some-other-organization-id" });
check("an X-Org-Id header on a public route changes nothing", spoofed.status === 200 && spoofed.body.organization.slug === slug);
check("the portal exposes no endpoint that takes an organization id", (await call("/public/careers")).status === 404);

console.log("\n== Cleanup ==");
for (const id of [draft.id, confidential.id, expired.id, paid.id]) {
  await call(`/jobs/${id}`, { ...O, method: "DELETE" });
}
console.log("  (test jobs removed)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
