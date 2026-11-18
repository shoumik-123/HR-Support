// End-to-end smoke test for Phase 3 (assessments + offers + onboarding) against a
// running API with seeded demo data. Run: pnpm db:seed && pnpm test:e2e:phase3
const B = "http://localhost:4000/api";
let pass = 0, fail = 0;

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function call(path, { token, org, method, body, expect } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers["X-Org-Id"] = org;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${B}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  return { token: r.body.accessToken, org: me.body.organizations[0].id, userId: me.body.id, name: me.body.name };
}

/** Pulls the token out of an invite link. */
const tokenOf = (link) => link.split("/").pop();

const owner = await login("owner@veyra.test");
const hr = await login("hr@veyra.test");
const recruiter = await login("recruiter@veyra.test");
const manager = await login("manager@veyra.test");
const viewer = await login("viewer@veyra.test");

const H = { token: recruiter.token, org: recruiter.org };
const HR = { token: hr.token, org: hr.org };
const MGR = { token: manager.token, org: manager.org };
const V = { token: viewer.token, org: viewer.org };

const jobs = await call("/jobs", { ...H, expect: 200 });
const job = jobs.body.items.find((j) => j.title.includes("Senior"));
const apps = await call(`/applications?jobId=${job.id}&status=ACTIVE&pageSize=10`, { ...H, expect: 200 });
if (apps.body.items.length < 2) throw new Error(`need 2 active applications, found ${apps.body.items.length}; run pnpm db:seed`);
const application = apps.body.items[0];
const secondApp = apps.body.items[1];

// Clear anything left behind by a previous run, so the "already in progress" guards
// below test this run's state rather than the last one's.
for (const o of (await call("/offers?pageSize=100", { ...H, expect: 200 })).body.items) {
  if (["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(o.status)) {
    await call(`/offers/${o.id}/withdraw`, { ...H, body: { reason: "Test cleanup" } });
  }
}
for (const a of (await call("/assessments?pageSize=100", { ...H, expect: 200 })).body.items) {
  if (["INVITED", "IN_PROGRESS"].includes(a.status)) {
    await call(`/assessments/${a.id}/cancel`, { ...H, body: { reason: "Test cleanup" } });
  }
}

console.log("\n== Assessment question bank ==");
const mkQuestion = (over = {}) => ({
  text: "Which of these is a property of a relational database index?",
  type: "MCQ_SINGLE",
  kind: "TECHNICAL",
  options: ["It speeds up reads at some write cost", "It always reduces storage", "It removes the need for a WHERE clause", "It encrypts the column"],
  correctAnswers: ["0"],
  points: 5,
  ...over,
});

const q1 = await call("/assessment-questions", { ...H, body: mkQuestion() });
check("a single-choice question can be added", q1.status === 201, `got ${q1.status}: ${JSON.stringify(q1.body).slice(0, 150)}`);

const q2 = await call("/assessment-questions", {
  ...H,
  body: mkQuestion({ text: "Select every statement that is true of HTTP caching.", type: "MCQ_MULTI", correctAnswers: ["0", "2"], points: 4 }),
});
check("a multi-choice question can be added", q2.status === 201, `got ${q2.status}`);

const q3 = await call("/assessment-questions", {
  ...H,
  body: { text: "A query returns 1,200 rows in 300 ms. How many rows per second is that, to the nearest whole number?", type: "NUMERIC", correctAnswers: ["4000"], tolerance: 50, points: 3, options: [] },
});
check("a numeric question can be added with a tolerance", q3.status === 201, `got ${q3.status}`);

const q4 = await call("/assessment-questions", {
  ...H,
  body: { text: "Describe how you would investigate a sudden rise in API error rates. Walk through your first three steps.", type: "LONG_ANSWER", points: 10, options: [] },
});
check("a written question can be added", q4.status === 201, `got ${q4.status}`);

const badSingle = await call("/assessment-questions", { ...H, body: mkQuestion({ correctAnswers: ["0", "1"] }) });
check("a single-choice question with two right answers is rejected", badSingle.status === 400, `got ${badSingle.status}`);

const badIndex = await call("/assessment-questions", { ...H, body: mkQuestion({ correctAnswers: ["9"] }) });
check("an answer key pointing outside the options is rejected", badIndex.status === 400, `got ${badIndex.status}`);

const tooFewOptions = await call("/assessment-questions", { ...H, body: mkQuestion({ options: ["Only one"] }) });
check("a multiple-choice question needs at least two options", tooFewOptions.status === 400, `got ${tooFewOptions.status}`);

const dupOptions = await call("/assessment-questions", { ...H, body: mkQuestion({ options: ["Same", "same", "Other"] }) });
check("duplicate options are rejected", dupOptions.status === 400, `got ${dupOptions.status}`);

const allCorrect = await call("/assessment-questions", {
  ...H, body: mkQuestion({ type: "MCQ_MULTI", options: ["A", "B"], correctAnswers: ["0", "1"] }),
});
check("a multi-choice question where every option is correct is rejected", allCorrect.status === 400, `got ${allCorrect.status}`);

const writtenWithKey = await call("/assessment-questions", {
  ...H, body: { text: "Explain indexing.", type: "LONG_ANSWER", correctAnswers: ["an answer"], options: [], points: 5 },
});
check("a written question cannot carry an answer key", writtenWithKey.status === 400, `got ${writtenWithKey.status}`);

const badNumeric = await call("/assessment-questions", {
  ...H, body: { text: "How many?", type: "NUMERIC", correctAnswers: ["not a number"], options: [], points: 1 },
});
check("a numeric question needs a numeric answer", badNumeric.status === 400, `got ${badNumeric.status}`);

const viewerQuestion = await call("/assessment-questions", { ...V, body: mkQuestion() });
check("a viewer cannot add assessment questions (403)", viewerQuestion.status === 403, `got ${viewerQuestion.status}`);

console.log("\n== Assessment template ==");
const questionIds = [q1.body.id, q2.body.id, q3.body.id, q4.body.id];
const template = await call("/assessment-templates", {
  ...H,
  body: { name: `Engineering screen ${Date.now()}`, kind: "TECHNICAL", durationMinutes: 30, passingPercent: 60, questionIds, showResultToCandidate: true },
});
check("a paper can be assembled from the bank", template.status === 201 && template.body.items.length === 4, `got ${template.status}`);

const emptyTemplate = await call("/assessment-templates", {
  ...H, body: { name: "Empty", kind: "TECHNICAL", durationMinutes: 30, passingPercent: 60, questionIds: [] },
});
check("a paper with no questions is rejected", emptyTemplate.status === 400, `got ${emptyTemplate.status}`);

const badPass = await call("/assessment-templates", {
  ...H, body: { name: "Bad pass", kind: "TECHNICAL", durationMinutes: 30, passingPercent: 140, questionIds },
});
check("a pass mark above 100 is rejected", badPass.status === 400, `got ${badPass.status}`);

console.log("\n== Assigning and taking an assessment ==");
const assigned = await call("/assessments", {
  ...H, body: { applicationId: application.id, templateId: template.body.id, validForDays: 7, notifyCandidate: true },
});
check("an assessment can be assigned to a candidate", assigned.status === 201, `got ${assigned.status}: ${JSON.stringify(assigned.body).slice(0, 200)}`);
check("the recruiter gets a shareable link", typeof assigned.body.inviteLink === "string" && assigned.body.inviteLink.includes("/assessment/"));
check("total marks are computed from the paper", assigned.body.totalPoints === 22, `got ${assigned.body.totalPoints}`);
const token = tokenOf(assigned.body.inviteLink);

const duplicate = await call("/assessments", { ...H, body: { applicationId: application.id, templateId: template.body.id } });
check("a second open assessment for the same candidate is refused", duplicate.status === 400, `got ${duplicate.status}`);

const viewerAssign = await call("/assessments", { ...V, body: { applicationId: secondApp.id, templateId: template.body.id } });
check("a viewer cannot assign assessments (403)", viewerAssign.status === 403, `got ${viewerAssign.status}`);

// ── Candidate side: no account, just the link ──
const badToken = await call("/public/assessment/not-a-real-token");
check("an invalid assessment link is rejected", badToken.status === 404, `got ${badToken.status}`);

const landing = await call(`/public/assessment/${token}`, { expect: 200 });
check("the candidate sees the paper's details before starting", landing.body.state === "not_started" && landing.body.questionCount === 4, JSON.stringify(landing.body).slice(0, 150));
check("the landing page names the organization and role", !!landing.body.organizationName && !!landing.body.jobTitle);
check("no questions are exposed before the candidate starts", !("questions" in landing.body));

const started = await call(`/public/assessment/${token}/start`, { method: "POST", expect: 200 });
check("the candidate can start the assessment", started.body.state === "in_progress" && started.body.questions.length === 4);
check("the clock starts and time remaining is reported", started.body.remainingSeconds > 0 && started.body.remainingSeconds <= 30 * 60);
check("the answer key is never sent to the candidate", !JSON.stringify(started.body).includes("correctAnswers"));
check("per-question marks are not revealed as answers", started.body.questions.every((q) => !("correct" in q) && !("pointsAwarded" in q)));

const restart = await call(`/public/assessment/${token}/start`, { method: "POST", expect: 200 });
check("reloading does not restart the timer", restart.body.remainingSeconds <= started.body.remainingSeconds);

const byText = new Map(started.body.questions.map((q) => [q.text.slice(0, 30), q]));
const single = [...byText.values()].find((q) => q.type === "MCQ_SINGLE");
const multi = [...byText.values()].find((q) => q.type === "MCQ_MULTI");
const numeric = [...byText.values()].find((q) => q.type === "NUMERIC");
const written = [...byText.values()].find((q) => q.type === "LONG_ANSWER");

const saved = await call(`/public/assessment/${token}/answers`, {
  method: "PUT",
  body: { answers: [{ answerId: single.answerId, response: ["0"] }] },
  expect: 200,
});
check("answers can be saved part-way through", saved.body.saved === 1);

const submitted = await call(`/public/assessment/${token}/submit`, {
  method: "POST",
  body: {
    answers: [
      { answerId: single.answerId, response: ["0"] },       // correct, 5 points
      { answerId: multi.answerId, response: ["0", "2"] },   // correct, 4 points
      { answerId: numeric.answerId, response: ["4010"] },   // within tolerance, 3 points
      { answerId: written.answerId, response: ["I would check error dashboards, then recent deploys, then database latency."] },
    ],
  },
  expect: 200,
});
check("the candidate can submit", submitted.body.state === "submitted");
check("the candidate is told a human still has to mark the written answer", submitted.body.awaitingManualMarking === true);
check("no result is shown while marking is incomplete", submitted.body.result === null);

const resubmit = await call(`/public/assessment/${token}/submit`, { method: "POST", body: {} });
check("a second submission is refused", resubmit.status === 400, `got ${resubmit.status}`);

const afterSubmit = await call(`/public/assessment/${token}`, { expect: 200 });
check("the link now shows a submitted state", afterSubmit.body.state === "submitted");

console.log("\n== Marking ==");
const paper = await call(`/assessments/${assigned.body.id}`, { ...H, expect: 200 });
check("closed questions were marked automatically", paper.body.autoScore === 12, `autoScore ${paper.body.autoScore}`);
check("the written answer is left unmarked", paper.body.score.awaitingManual === 1);
check("no percentage is published while marking is incomplete", paper.body.percent === null);
check("the evaluator can see the answer key", paper.body.answers.some((a) => Array.isArray(a.question?.correctAnswers)));

const writtenAnswer = paper.body.answers.find((a) => a.questionType === "LONG_ANSWER");
const overMax = await call(`/assessments/${assigned.body.id}/mark`, {
  ...H, body: { marks: [{ answerId: writtenAnswer.id, points: 99 }] },
});
check("marks above the question's maximum are rejected", overMax.status === 400, `got ${overMax.status}`);

const markClosed = await call(`/assessments/${assigned.body.id}/mark`, {
  ...H, body: { marks: [{ answerId: paper.body.answers.find((a) => a.questionType === "MCQ_SINGLE").id, points: 0 }] },
});
check("a closed question cannot be re-marked by hand", markClosed.status === 400, `got ${markClosed.status}`);

const marked = await call(`/assessments/${assigned.body.id}/mark`, {
  ...H,
  body: { marks: [{ answerId: writtenAnswer.id, points: 7, comment: "Sensible order of checks; did not mention rollback." }], note: "Solid overall." },
  expect: 200,
});
check("a human can mark the written answer", marked.body.manualScore === 7, `got ${marked.body.manualScore}`);
check("the paper becomes evaluated once nothing is outstanding", marked.body.status === "EVALUATED");
check("the final score adds the automatic and manual marks", marked.body.finalScore === 19, `got ${marked.body.finalScore}`);
check("the percentage is computed against the whole paper", marked.body.percent === 86.4, `got ${marked.body.percent}`);
check("the pass flag reflects the organization's bar", marked.body.passed === true);

const candidateResult = await call(`/public/assessment/${token}`, { expect: 200 });
check("the candidate sees their result when the organization allows it", candidateResult.body.result?.percent === 86.4, JSON.stringify(candidateResult.body.result));

const auditAssessment = await call("/org/audit?pageSize=40", { ...HR, expect: 200 });
check("assigning, submitting and marking are all audited", ["assessment.assigned", "assessment.submitted", "assessment.marked"].every((a) => auditAssessment.body.items.some((i) => i.action === a)));

console.log("\n== Offers ==");
const offerTemplates = await call("/offers/templates", { ...H, expect: 200 });
check("a default offer letter is provided", offerTemplates.body.length >= 1 && offerTemplates.body[0].body.includes("{{offer.jobTitle}}"));

const startDate = new Date(Date.now() + 30 * 86_400_000);
const respondBy = new Date(Date.now() + 10 * 86_400_000);

const draft = await call("/offers", {
  ...H,
  body: {
    applicationId: application.id,
    salaryAmount: 180000,
    salaryCurrency: "BDT",
    salaryPeriod: "MONTHLY",
    benefits: [{ label: "Festival bonus", value: "2 per year" }, { label: "Health insurance", value: "Self and family" }],
    startDate: startDate.toISOString(),
    respondBy: respondBy.toISOString(),
    probationMonths: 6,
    noticePeriodDays: 60,
    reportingTo: "Engineering Manager",
  },
});
check("an offer can be drafted", draft.status === 201, `got ${draft.status}: ${JSON.stringify(draft.body).slice(0, 200)}`);
check("the letter is rendered with the real terms", draft.body.letterBody.includes("180,000") && !draft.body.letterBody.includes("{{"), draft.body.letterBody?.slice(0, 120));
check("the benefits appear in the letter", draft.body.letterBody.includes("Festival bonus"));
check("a fresh draft has no approvals and no token", draft.body.approvals.length === 0 && !draft.body.accessTokenHash);

const badDates = await call("/offers", {
  ...H, body: { applicationId: secondApp.id, salaryAmount: 100000, startDate: respondBy.toISOString(), respondBy: startDate.toISOString() },
});
check("a response deadline after the joining date is rejected", badDates.status === 400, `got ${badDates.status}`);

const pastStart = await call("/offers", {
  ...H, body: { applicationId: secondApp.id, salaryAmount: 100000, startDate: new Date(Date.now() - 10 * 86_400_000).toISOString(), respondBy: respondBy.toISOString() },
});
check("a joining date in the past is rejected", pastStart.status === 400, `got ${pastStart.status}`);

const secondOffer = await call("/offers", { ...H, body: { applicationId: application.id, salaryAmount: 120000, startDate: startDate.toISOString(), respondBy: respondBy.toISOString() } });
check("a second open offer for the same candidate is refused", secondOffer.status === 400, `got ${secondOffer.status}`);

const viewerOffer = await call("/offers", { ...V, body: { applicationId: secondApp.id, salaryAmount: 100000, startDate: startDate.toISOString(), respondBy: respondBy.toISOString() } });
check("a viewer cannot draft offers (403)", viewerOffer.status === 403, `got ${viewerOffer.status}`);

console.log("\n== Offer approval ==");
const recruiterSend = await call(`/offers/${draft.body.id}/send`, { ...H, method: "POST" });
check("a recruiter cannot send an offer (403)", recruiterSend.status === 403, `got ${recruiterSend.status}`);

const requested = await call(`/offers/${draft.body.id}/request-approval`, {
  ...H, body: { approverIds: [hr.userId, manager.userId] }, expect: 200,
});
check("approval can be requested from several people", requested.body.status === "PENDING_APPROVAL" && requested.body.approvals.length === 2);

const sendBeforeApproval = await call(`/offers/${draft.body.id}/send`, { ...HR, method: "POST" });
check("an offer awaiting approval cannot be sent", sendBeforeApproval.status === 400 && /awaiting approval/i.test(sendBeforeApproval.body.message), JSON.stringify(sendBeforeApproval.body).slice(0, 120));

const notApprover = await call(`/offers/${draft.body.id}/decide`, { ...V, body: { decision: "APPROVED" } });
check("someone who is not an approver cannot decide (403)", notApprover.status === 403, `got ${notApprover.status}`);

const firstApproval = await call(`/offers/${draft.body.id}/decide`, { ...HR, body: { decision: "APPROVED", comment: "Within band." }, expect: 200 });
check("the first approver can approve", firstApproval.body.status === "PENDING_APPROVAL", "still pending until everyone approves");

const twice = await call(`/offers/${draft.body.id}/decide`, { ...HR, body: { decision: "APPROVED" } });
check("an approver cannot decide twice", twice.status === 400, `got ${twice.status}`);

const sendPartlyApproved = await call(`/offers/${draft.body.id}/send`, { ...HR, method: "POST" });
check("an offer with one approval outstanding still cannot be sent", sendPartlyApproved.status === 400, `got ${sendPartlyApproved.status}`);

const secondApproval = await call(`/offers/${draft.body.id}/decide`, { ...MGR, body: { decision: "APPROVED" }, expect: 200 });
check("the offer is approved once everyone has signed off", secondApproval.body.status === "APPROVED");

console.log("\n== Editing resets approvals ==");
const edited = await call(`/offers/${draft.body.id}`, { ...H, method: "PATCH", body: { salaryAmount: 190000 } });
check("an approved offer can still be corrected before sending", edited.status === 200, `got ${edited.status}`);

const reApprove = await call(`/offers/${draft.body.id}/request-approval`, { ...H, body: { approverIds: [hr.userId] }, expect: 200 });
check("re-requesting approval returns the offer to pending", reApprove.body.status === "PENDING_APPROVAL");
await call(`/offers/${draft.body.id}/decide`, { ...HR, body: { decision: "APPROVED" }, expect: 200 });

console.log("\n== Sending and the candidate's response ==");
const sent = await call(`/offers/${draft.body.id}/send`, { ...HR, method: "POST", expect: 200 });
check("HR can send an approved offer", sent.body.status === "SENT" && !!sent.body.offerLink, JSON.stringify(sent.body).slice(0, 150));
const offerToken = tokenOf(sent.body.offerLink);

const sendTwice = await call(`/offers/${draft.body.id}/send`, { ...HR, method: "POST" });
check("an offer cannot be sent twice", sendTwice.status === 400, `got ${sendTwice.status}`);

const badOfferToken = await call("/public/offer/nope");
check("an invalid offer link is rejected", badOfferToken.status === 404, `got ${badOfferToken.status}`);

const offerView = await call(`/public/offer/${offerToken}`, { expect: 200 });
check("the candidate can read their offer", offerView.body.state === "open" && offerView.body.jobTitle === job.title);
check("the offer shows the salary, start date and deadline", !!offerView.body.salary && !!offerView.body.startDate && !!offerView.body.respondBy);
check("the offer shows the benefits", Array.isArray(offerView.body.benefits) && offerView.body.benefits.length === 2);
check("internal fields are not exposed to the candidate", !("createdById" in offerView.body) && !("accessTokenHash" in offerView.body));

const accepted = await call(`/public/offer/${offerToken}/respond`, { method: "POST", body: { accept: true }, expect: 200 });
check("the candidate can accept", accepted.body.status === "ACCEPTED");

const respondTwice = await call(`/public/offer/${offerToken}/respond`, { method: "POST", body: { accept: false } });
check("the candidate cannot respond twice", respondTwice.status === 400 || respondTwice.status === 404, `got ${respondTwice.status}`);

const hiredApp = await call(`/applications/${application.id}`, { ...H, expect: 200 });
check("accepting moves the application to hired", hiredApp.body.status === "HIRED", `got ${hiredApp.body.status}`);
check("the hire date is recorded", !!hiredApp.body.hiredAt);

console.log("\n== Onboarding ==");
const afterAccept = await call(`/offers/${draft.body.id}`, { ...HR, expect: 200 });
check("accepting seeds an onboarding checklist", afterAccept.body.onboardingTasks.length >= 10, `got ${afterAccept.body.onboardingTasks.length}`);
check("checklist tasks are grouped by category", new Set(afterAccept.body.onboardingTasks.map((t) => t.category)).size >= 4);
check("tasks due before the start date have a due date", afterAccept.body.onboardingTasks.some((t) => !!t.dueDate));

const board = await call("/offers/onboarding", { ...HR, expect: 200 });
check("the onboarding board lists the new joiner", board.body.length >= 1 && board.body[0].progress.total >= 10);
check("the board counts days until the start date", typeof board.body[0].daysUntilStart === "number");

const task = afterAccept.body.onboardingTasks[0];
const doneTask = await call(`/onboarding-tasks/${task.id}/status`, { ...HR, body: { status: "DONE" }, expect: 200 });
check("a task can be marked done", doneTask.body.status === "DONE" && !!doneTask.body.completedAt);

const extraTask = await call(`/offers/${draft.body.id}/tasks`, {
  ...HR, body: { title: "Order company SIM card", category: "IT_SETUP", assigneeId: recruiter.userId },
});
check("a custom task can be added", extraTask.status === 201, `got ${extraTask.status}`);

const badAssignee = await call(`/offers/${draft.body.id}/tasks`, { ...HR, body: { title: "Nope", assigneeId: "not-a-member" } });
check("a task cannot be assigned to a non-member", badAssignee.status === 400, `got ${badAssignee.status}`);

const recruiterTask = await call(`/onboarding-tasks/${task.id}/status`, { ...H, body: { status: "TODO" } });
check("a recruiter cannot change onboarding tasks (403)", recruiterTask.status === 403, `got ${recruiterTask.status}`);

const progress = await call("/offers/onboarding", { ...HR, expect: 200 });
check("the board reflects completed work", progress.body[0].progress.done >= 1);

console.log("\n== Declining an offer ==");
const declineDraft = await call("/offers", {
  ...H,
  body: { applicationId: secondApp.id, salaryAmount: 95000, startDate: startDate.toISOString(), respondBy: respondBy.toISOString() },
  expect: 201,
});
const declineSent = await call(`/offers/${declineDraft.body.id}/send`, { ...HR, method: "POST", expect: 200 });
const declined = await call(`/public/offer/${tokenOf(declineSent.body.offerLink)}/respond`, {
  method: "POST", body: { accept: false, reason: "Accepted another role closer to home." }, expect: 200,
});
check("the candidate can decline with a reason", declined.body.status === "DECLINED");
const declinedOffer = await call(`/offers/${declineDraft.body.id}`, { ...HR, expect: 200 });
check("the decline reason is kept", declinedOffer.body.declineReason?.includes("closer to home"));
check("declining does not mark the candidate hired", declinedOffer.body.status === "DECLINED");
const secondAppAfter = await call(`/applications/${secondApp.id}`, { ...H, expect: 200 });
check("a declined offer leaves the application active", secondAppAfter.body.status === "ACTIVE", `got ${secondAppAfter.body.status}`);

console.log("\n== Tenant isolation (Phase 3) ==");
const stamp = Date.now();
const rival = await call("/auth/register", {
  body: { name: "Rival", email: `rival3-${stamp}@test.test`, password: "Rival123456", organizationName: `Rival3 ${stamp}` }, expect: 201,
});
const rivalMe = await call("/auth/me", { token: rival.body.accessToken, expect: 200 });
const R = { token: rival.body.accessToken, org: rivalMe.body.organizations[0].id };
check("another tenant sees no assessments", (await call("/assessments", { ...R, expect: 200 })).body.total === 0);
check("another tenant sees no offers", (await call("/offers", { ...R, expect: 200 })).body.total === 0);
check("another tenant's assessment is not readable", (await call(`/assessments/${assigned.body.id}`, R)).status === 404);
check("another tenant's offer is not readable", (await call(`/offers/${draft.body.id}`, R)).status === 404);
check("another tenant's question bank is empty", (await call("/assessment-questions", { ...R, expect: 200 })).body.total === 0);
check("another tenant has an empty onboarding board", (await call("/offers/onboarding", { ...R, expect: 200 })).body.length === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
