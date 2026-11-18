// End-to-end smoke test against a running API (pnpm dev) with seeded demo data.
// Run: pnpm test:e2e
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
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${B}${path}`, {
    method: method ?? (body || form ? "POST" : "GET"),
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (expect !== undefined && res.status !== expect) {
    throw new Error(`${path} expected ${expect}, got ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body: json, cookies: res.headers.getSetCookie?.() ?? [] };
}

async function login(email) {
  let r;
  for (let i = 0; i < 8; i++) {
    r = await call("/auth/login", { body: { email, password: "Veyra12345" } });
    if (r.status !== 429) break;
    // The login rate limit is a deliberate security control and counts blocked attempts
    // too, so wait out a full window rather than retrying tightly.
    await new Promise((x) => setTimeout(x, 20_000));
  }
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status}`);
  const me = await call("/auth/me", { token: r.body.accessToken, expect: 200 });
  return { token: r.body.accessToken, org: me.body.organizations[0].id, me: me.body, cookies: r.cookies };
}

console.log("\n== Authentication ==");
const recruiter = await login("recruiter@veyra.test");
check("recruiter can sign in", !!recruiter.token);
check("session returns organization + permissions", recruiter.me.organizations[0].permissions.length > 5);
check("refresh token is HttpOnly", recruiter.cookies.some((c) => /veyra_rt=/.test(c) && /HttpOnly/i.test(c)));

const bad = await call("/auth/login", { body: { email: "recruiter@veyra.test", password: "wrong-password" } });
check("wrong password is rejected", bad.status === 401);
const unknown = await call("/auth/login", { body: { email: "nobody@veyra.test", password: "Veyra12345" } });
check("unknown user gives the same error as a wrong password", unknown.status === 401 && unknown.body.message === bad.body.message);
const weak = await call("/auth/register", { body: { name: "X", email: `x${Date.now()}@t.test`, password: "short", organizationName: "T" } });
check("weak password is rejected", weak.status === 400);

console.log("\n== Authorization ==");
const noAuth = await call("/jobs");
check("unauthenticated request is rejected", noAuth.status === 401);
const badToken = await call("/jobs", { token: "not.a.real.token" });
check("forged token is rejected", badToken.status === 401);

const viewer = await login("viewer@veyra.test");
const viewerJobs = await call("/jobs", { token: viewer.token, org: viewer.org });
check("viewer can read jobs", viewerJobs.status === 200);
const viewerCreate = await call("/jobs", { token: viewer.token, org: viewer.org, body: { title: "Nope", description: "x".repeat(60) } });
check("viewer cannot create a job (403)", viewerCreate.status === 403, `got ${viewerCreate.status}`);
const viewerTeam = await call("/org/invitations", { token: viewer.token, org: viewer.org, body: { email: "a@b.test", role: "ADMIN" } });
check("viewer cannot invite members (403)", viewerTeam.status === 403, `got ${viewerTeam.status}`);
const recruiterAudit = await call("/org/audit", { token: recruiter.token, org: recruiter.org });
check("recruiter cannot read the audit log (403)", recruiterAudit.status === 403, `got ${recruiterAudit.status}`);
const hr = await login("hr@veyra.test");
const owner = await login("owner@veyra.test");
check("recruiter cannot change organization settings (403)", (await call("/org", { token: recruiter.token, org: recruiter.org, method: "PATCH", body: { blindModeDefault: true } })).status === 403);
check("HR manager cannot change organization-wide settings (403)", (await call("/org", { token: hr.token, org: hr.org, method: "PATCH", body: { blindModeDefault: true } })).status === 403);
check("owner can change organization settings", (await call("/org", { token: owner.token, org: owner.org, method: "PATCH", body: { industry: "Information Technology" } })).status === 200);
const hrAudit = await call("/org/audit", { token: hr.token, org: hr.org });
check("HR manager can read the audit log", hrAudit.status === 200);

console.log("\n== Tenant isolation ==");
const stamp = Date.now();
const outsider = await call("/auth/register", {
  body: { name: "Outsider", email: `outsider${stamp}@test.test`, password: "Outsider12345", organizationName: `Rival ${stamp}` },
  expect: 201,
});
const outsiderToken = outsider.body.accessToken;
const outsiderMe = await call("/auth/me", { token: outsiderToken, expect: 200 });
const outsiderOrg = outsiderMe.body.organizations[0].id;
check("new organization starts with its own pipeline", (await call("/org/stages", { token: outsiderToken, org: outsiderOrg })).body.length === 9);
check("new organization sees no other tenant's candidates", (await call("/candidates", { token: outsiderToken, org: outsiderOrg })).body.total === 0);

const demoJobs = await call("/jobs", { token: recruiter.token, org: recruiter.org, expect: 200 });
const seniorJob = demoJobs.body.items.find((j) => j.title.includes("Senior"));
const crossRead = await call(`/jobs/${seniorJob.id}`, { token: outsiderToken, org: outsiderOrg });
check("another tenant's job is not readable (404)", crossRead.status === 404, `got ${crossRead.status}`);
const spoof = await call("/jobs", { token: outsiderToken, org: recruiter.org });
check("passing another org's id in the header is refused (403)", spoof.status === 403, `got ${spoof.status}`);

const demoCands = await call("/candidates", { token: recruiter.token, org: recruiter.org, expect: 200 });
const someone = demoCands.body.items[0];
const crossCand = await call(`/candidates/${someone.id}`, { token: outsiderToken, org: outsiderOrg });
check("another tenant's candidate is not readable (404)", crossCand.status === 404, `got ${crossCand.status}`);

console.log("\n== Matching & review ==");
const queued = await call(`/jobs/${seniorJob.id}/matches/run`, { token: recruiter.token, org: recruiter.org, body: { rerunAll: true }, expect: 200 });
check("screening a job queues its active applications", queued.body.queued > 0, JSON.stringify(queued.body));

// Matching runs on a background worker; wait until every application is scored.
let ranking;
for (let i = 0; i < 30; i++) {
  ranking = await call(`/jobs/${seniorJob.id}/ranking`, { token: recruiter.token, org: recruiter.org, expect: 200 });
  if (ranking.body.unmatched === 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
check("background worker scored every candidate", ranking.body.unmatched === 0, `${ranking.body.unmatched} unscored`);
check("ranking is ordered by score, high to low", ranking.body.items.every((r, i, a) => i === 0 || (a[i - 1].effectiveScore ?? -1) >= (r.effectiveScore ?? -1)));
const top = ranking.body.items[0];
check("every match carries evidence and a prompt version", !!top.match.breakdown?.length && !!top.match.promptVersion);
check("match criteria breakdown covers all five criteria", top.match.breakdown.length === 5);
check("score is within 0-100", top.match.score >= 0 && top.match.score <= 100);

const review = await call(`/matches/${top.match.id}/review`, {
  token: recruiter.token, org: recruiter.org, body: { status: "ADJUSTED", adjustedScore: 71, note: "Verified Node.js depth in interview" },
});
check("recruiter can adjust an AI score", review.status === 200 && review.body.adjustedScore === 71, `got ${review.status}`);
const afterReview = await call(`/jobs/${seniorJob.id}/ranking`, { token: recruiter.token, org: recruiter.org });
const reviewed = afterReview.body.items.find((r) => r.match?.id === top.match.id);
check("the human score overrides the AI score in the ranking", reviewed.effectiveScore === 71, `got ${reviewed.effectiveScore}`);
const badReview = await call(`/matches/${top.match.id}/review`, { token: recruiter.token, org: recruiter.org, body: { status: "ADJUSTED" } });
check("adjusting without a score is rejected", badReview.status === 400);
const viewerReview = await call(`/matches/${top.match.id}/review`, { token: viewer.token, org: viewer.org, body: { status: "ACCEPTED" } });
check("viewer cannot review AI recommendations", viewerReview.status === 403, `got ${viewerReview.status}`);

console.log("\n== Pipeline ==");
const stages = (await call("/org/stages", { token: recruiter.token, org: recruiter.org })).body;
const interview = stages.find((s) => s.kind === "INTERVIEW");
const rejectedStage = stages.find((s) => s.kind === "REJECTED");
const appId = ranking.body.items[1].applicationId;
const moved = await call(`/applications/${appId}/move`, { token: recruiter.token, org: recruiter.org, body: { stageId: interview.id } });
check("recruiter can move a candidate to Interview", moved.status === 200 && moved.body.stageId === interview.id);
const sneakyReject = await call(`/applications/${appId}/move`, { token: recruiter.token, org: recruiter.org, body: { stageId: rejectedStage.id } });
check("moving to Rejected without a reason is refused", sneakyReject.status === 400, `got ${sneakyReject.status}`);
const rejected = await call(`/applications/${appId}/reject`, { token: recruiter.token, org: recruiter.org, body: { reason: "Not enough backend depth for this role" } });
check("rejection with a reason succeeds", rejected.status === 201 || rejected.status === 200);
check("rejection records the reason and timestamp", !!rejected.body.rejectionReason && !!rejected.body.rejectedAt);
const viewerMove = await call(`/applications/${appId}/move`, { token: viewer.token, org: viewer.org, body: { stageId: interview.id } });
check("viewer cannot move candidates", viewerMove.status === 403, `got ${viewerMove.status}`);

const audit = (await call("/org/audit?pageSize=100", { token: hr.token, org: hr.org })).body;
check("rejection is written to the audit log with an actor", audit.items.some((a) => a.action === "application.rejected" && a.actorName));
check("AI review is written to the audit log", audit.items.some((a) => a.action === "match.reviewed"));

console.log("\n== Blind recruitment mode ==");
await call("/org", { token: owner.token, org: owner.org, method: "PATCH", body: { blindModeDefault: true }, expect: 200 });
const blindList = await call("/candidates", { token: recruiter.token, org: recruiter.org, expect: 200 });
const blindOne = blindList.body.items[0];
check("names are masked in blind mode", blindOne.masked === true && /^Candidate [A-Z0-9]{6}$/.test(blindOne.fullName), blindOne.fullName);
check("email is hidden in blind mode", blindOne.email === null);
const blindBoard = await call(`/applications/board?jobId=${seniorJob.id}`, { token: recruiter.token, org: recruiter.org });
const boardNames = blindBoard.body.stages.flatMap((s) => s.applications.map((a) => a.candidate.fullName));
check("board hides names in blind mode", boardNames.every((n) => n.startsWith("Candidate ")), boardNames.join(","));
const blindRanking = await call(`/jobs/${seniorJob.id}/ranking`, { token: recruiter.token, org: recruiter.org });
check("ranking hides names in blind mode", blindRanking.body.items.every((r) => r.candidate.masked === true));
const nameSearch = await call(`/candidates?search=${encodeURIComponent("Arif")}`, { token: recruiter.token, org: recruiter.org });
check("searching by name is disabled in blind mode", nameSearch.body.total === 0, `found ${nameSearch.body.total}`);
const revealed = await call(`/candidates/${someone.id}?reveal=true`, { token: recruiter.token, org: recruiter.org });
check("authorised reviewer can reveal a candidate", revealed.body.masked === false && revealed.body.fullName !== blindOne.fullName);
const audit2 = (await call("/org/audit?pageSize=20", { token: hr.token, org: hr.org })).body;
check("revealing identity is audited", audit2.items.some((a) => a.action === "candidate.identity_revealed"));
await call("/org", { token: owner.token, org: owner.org, method: "PATCH", body: { blindModeDefault: false } });

console.log("\n== Uploads ==");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
const exe = Buffer.from("MZ\x90\x00\x03\x00\x00\x00" + "x".repeat(400));

const fd1 = new FormData();
fd1.append("files", new Blob([exe], { type: "application/pdf" }), "malware.pdf");
const badUpload = await call("/resumes/upload", { token: recruiter.token, org: recruiter.org, form: fd1 });
check(
  "executable disguised as a PDF is rejected",
  badUpload.body.accepted?.length === 0 && /Unsupported file type/i.test(badUpload.body.rejected?.[0]?.reason ?? ""),
  JSON.stringify(badUpload.body).slice(0, 160),
);

const fd2 = new FormData();
fd2.append("files", new Blob([pdf], { type: "application/pdf" }), "tiny.pdf");
const okUpload = await call("/resumes/upload", { token: recruiter.token, org: recruiter.org, form: fd2 });
check("valid PDF is accepted for processing", okUpload.status === 201 && okUpload.body.accepted.length === 1, `got ${okUpload.status}`);

const fd3 = new FormData();
fd3.append("files", new Blob([pdf], { type: "application/pdf" }), "tiny-copy.pdf");
const dupUpload = await call("/resumes/upload", { token: recruiter.token, org: recruiter.org, form: fd3 });
check("identical file is detected as a duplicate", dupUpload.body.accepted[0]?.duplicateOf !== undefined);

const viewerUpload = new FormData();
viewerUpload.append("files", new Blob([pdf], { type: "application/pdf" }), "x.pdf");
const viewerUp = await call("/resumes/upload", { token: viewer.token, org: viewer.org, form: viewerUpload });
check("viewer cannot upload resumes", viewerUp.status === 403, `got ${viewerUp.status}`);

console.log("\n== Validation ==");
const badWeights = await call("/jobs", {
  token: recruiter.token, org: recruiter.org,
  body: { title: "Weights", description: "x".repeat(60), matchingCriteria: { skills: 50, experience: 50, education: 50, projects: 0, certifications: 0 } },
});
check("matching weights must sum to 100", badWeights.status === 400);
const badRange = await call("/jobs", {
  token: recruiter.token, org: recruiter.org,
  body: { title: "Range", description: "x".repeat(60), minExperienceYears: 10, maxExperienceYears: 2 },
});
check("min experience above max is rejected", badRange.status === 400);
const draft = await call("/jobs", { token: recruiter.token, org: recruiter.org, body: { title: "Unpublishable", description: "too short" }, expect: 201 });
const publishBad = await call(`/jobs/${draft.body.id}/publish`, { token: hr.token, org: hr.org, method: "POST" });
check("publishing an incomplete job is refused with a reason", publishBad.status === 400 && /description|skill/i.test(publishBad.body.message), JSON.stringify(publishBad.body));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
