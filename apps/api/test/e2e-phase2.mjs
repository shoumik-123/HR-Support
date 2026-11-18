// End-to-end smoke test for Phase 2 (interviews + communications) against a running API
// with seeded demo data. Run: pnpm test:e2e:phase2
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
    // The login rate limit is a deliberate security control and counts blocked attempts
    // too, so wait out a full window rather than retrying tightly.
    await new Promise((x) => setTimeout(x, 20_000));
  }
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status}`);
  const me = await call("/auth/me", { token: r.body.accessToken, expect: 200 });
  return { token: r.body.accessToken, org: me.body.organizations[0].id, userId: me.body.id, name: me.body.name };
}

/** Next Wednesday at 10:00 UTC, comfortably in the future. */
function nextWednesday(hourUtc = 10) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7 || 7));
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

const owner = await login("owner@veyra.test");
const hr = await login("hr@veyra.test");
const recruiter = await login("recruiter@veyra.test");
const manager = await login("manager@veyra.test");
const viewer = await login("viewer@veyra.test");

const H = { token: recruiter.token, org: recruiter.org };
const HR = { token: hr.token, org: hr.org };

const jobs = await call("/jobs", { ...H, expect: 200 });
const job = jobs.body.items.find((j) => j.title.includes("Senior"));
const apps = await call(`/applications?jobId=${job.id}&status=ACTIVE&pageSize=10`, { ...H, expect: 200 });
if (apps.body.items.length < 3) throw new Error(`need 3 active applications on "${job.title}", found ${apps.body.items.length}; re-run pnpm db:seed`);
const application = apps.body.items[0];

// Leave no interviews behind from a previous run, so the slot-conflict checks below
// test this run's bookings rather than the last run's.
const existing = await call("/interviews?status=SCHEDULED&pageSize=100", { ...H, expect: 200 });
for (const i of existing.body.items) {
  await call(`/interviews/${i.id}/cancel`, { ...H, body: { reason: "Test cleanup", notifyCandidate: false } });
}
if (existing.body.items.length) console.log(`(cleared ${existing.body.items.length} interview(s) from a previous run)`);

console.log("\n== Email templates ==");
const templates = await call("/communications/templates", { ...H, expect: 200 });
check("default templates are seeded for the organization", templates.body.length >= 8, `got ${templates.body.length}`);
check("every seeded template declares only known variables", templates.body.every((t) => t.variables.unknown.length === 0));
const inviteTemplate = templates.body.find((t) => t.key === "INTERVIEW_INVITATION");
check("an interview invitation template exists", !!inviteTemplate);

const preview = await call(`/communications/templates/${inviteTemplate.id}/preview?applicationId=${application.id}`, { ...H, expect: 200 });
check("preview substitutes the real candidate and job", preview.body.body.includes(job.title) && !preview.body.body.includes("{{"), preview.body.body.slice(0, 120));
check("preview reports which variables have no value yet", Array.isArray(preview.body.missing));

const badTemplate = await call(`/communications/templates/${inviteTemplate.id}`, { ...HR, method: "PATCH", body: { body: "Hello {{candidate.salary}}" } });
check("a template with an unknown placeholder is rejected", badTemplate.status === 400 && /Unknown placeholders/.test(badTemplate.body.message), JSON.stringify(badTemplate.body).slice(0, 120));

const recruiterEdit = await call(`/communications/templates/${inviteTemplate.id}`, { ...H, method: "PATCH", body: { subject: "x" } });
check("a recruiter cannot edit templates (403)", recruiterEdit.status === 403, `got ${recruiterEdit.status}`);

console.log("\n== Automations ==");
const automations = await call("/communications/automations", { ...H, expect: 200 });
check("automation rules list the triggers and stages they can use", automations.body.templates.length >= 8 && automations.body.stages.length >= 5);

const receivedTemplate = templates.body.find((t) => t.key === "APPLICATION_RECEIVED");
const enableAuto = await call("/communications/automations", {
  ...HR, method: "PUT", body: { trigger: "APPLICATION_CREATED", templateId: receivedTemplate.id, enabled: true },
});
check("HR can enable an automation", enableAuto.status === 200 && enableAuto.body.enabled === true, `got ${enableAuto.status}`);

const twice = await call("/communications/automations", {
  ...HR, method: "PUT", body: { trigger: "APPLICATION_CREATED", templateId: receivedTemplate.id, enabled: true },
});
check("enabling the same trigger twice updates rather than duplicates", twice.status === 200 && twice.body.id === enableAuto.body.id);

const stageAutoNoStage = await call("/communications/automations", {
  ...HR, method: "PUT", body: { trigger: "STAGE_CHANGED", templateId: receivedTemplate.id, enabled: true },
});
check("a stage trigger without a stage is rejected", stageAutoNoStage.status === 400, `got ${stageAutoNoStage.status}`);

const recruiterAuto = await call("/communications/automations", {
  ...H, method: "PUT", body: { trigger: "APPLICATION_CREATED", templateId: receivedTemplate.id, enabled: false },
});
check("a recruiter cannot change automations (403)", recruiterAuto.status === 403, `got ${recruiterAuto.status}`);

const auditAfterAutomation = await call("/org/audit?pageSize=20", { ...HR, expect: 200 });
check("enabling an automation is audited", auditAfterAutomation.body.items.some((a) => a.action === "automation.enabled"));

console.log("\n== Availability & slot search ==");
const interviewers = await call("/interviewers", { ...H, expect: 200 });
check("interviewers are listed with their availability count", interviewers.body.length >= 5 && "availabilityWindows" in interviewers.body[0]);

// Manager and recruiter both declare Wednesday hours (Dhaka time, org default).
for (const who of [manager, recruiter]) {
  const r = await call("/availability", {
    token: who.token, org: who.org, method: "PUT",
    body: { slots: [{ weekday: 3, startMinute: 10 * 60, endMinute: 18 * 60 }] },
  });
  check(`${who.name} can set their own weekly hours`, r.status === 200 && r.body.slots.length === 1, `got ${r.status}`);
}

const overlapping = await call("/availability", {
  token: manager.token, org: manager.org, method: "PUT",
  body: { slots: [{ weekday: 3, startMinute: 600, endMinute: 720 }, { weekday: 3, startMinute: 660, endMinute: 780 }] },
});
check("overlapping availability windows are rejected", overlapping.status === 400, `got ${overlapping.status}`);
const backwards = await call("/availability", {
  token: manager.token, org: manager.org, method: "PUT", body: { slots: [{ weekday: 3, startMinute: 800, endMinute: 700 }] },
});
check("a window that ends before it starts is rejected", backwards.status === 400, `got ${backwards.status}`);
// restore
await call("/availability", { token: manager.token, org: manager.org, method: "PUT", body: { slots: [{ weekday: 3, startMinute: 600, endMinute: 1080 }] } });

const othersHours = await call("/availability", {
  ...H, method: "PUT", body: { userId: manager.userId, slots: [{ weekday: 1, startMinute: 600, endMinute: 660 }] },
});
check("a recruiter cannot edit someone else's hours (403)", othersHours.status === 403, `got ${othersHours.status}`);

const suggest = await call("/interviews/slots/suggest", {
  ...H, body: { userIds: [manager.userId, recruiter.userId], durationMinutes: 60, days: 21, limit: 5 },
});
check("free slots are suggested for the panel", suggest.status === 200 && suggest.body.slots.length > 0, JSON.stringify(suggest.body).slice(0, 200));
check("suggested slots are in the future", suggest.body.slots.every((s) => new Date(s.start) > new Date()));
check("suggested slots carry a readable local label", /\(/.test(suggest.body.slots[0]?.label ?? ""));

console.log("\n== Scheduling ==");
const startsAt = nextWednesday(10);
const scheduled = await call("/interviews", {
  ...H,
  body: {
    applicationId: application.id,
    kind: "TECHNICAL",
    mode: "VIDEO",
    startsAt: startsAt.toISOString(),
    durationMinutes: 60,
    meetingLink: "https://meet.example.com/veyra-test",
    interviewers: [{ userId: manager.userId, role: "LEAD" }, { userId: recruiter.userId, role: "PANEL" }],
  },
});
check("an interview can be scheduled", scheduled.status === 201 || scheduled.status === 200, `got ${scheduled.status}: ${JSON.stringify(scheduled.body).slice(0, 200)}`);
const interview = scheduled.body;
check("round number starts at 1", interview.round === 1);
// The organizer is on this panel too, so they see only their own scorecard until they
// submit; the panel counts stay visible so they know how much feedback is outstanding.
check("a scorecard is created for each non-observer interviewer", interview.panel.submitted + interview.panel.pending === 2, `got ${interview.panel?.pending}`);
check("the organizer on the panel sees only their own scorecard before submitting", interview.scorecards.length === 1 && interview.canSeePanelFeedback === false, `got ${interview.scorecards?.length}`);
check("default criteria are snapshotted onto the interview", interview.criteria.length >= 3 && interview.criteria.reduce((s, c) => s + c.weight, 0) === 100);

const clash = await call("/interviews", {
  ...H,
  body: {
    applicationId: apps.body.items[1].id,
    startsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
    durationMinutes: 60,
    interviewers: [{ userId: manager.userId }],
  },
});
check("a double-booking is refused with the clash described", clash.status === 400 && Array.isArray(clash.body.conflicts) && clash.body.conflicts.length > 0, JSON.stringify(clash.body).slice(0, 200));
check("the clash names the interviewer", clash.body.conflicts?.[0]?.interviewerName?.length > 0);

const forced = await call("/interviews", {
  ...H,
  body: {
    applicationId: apps.body.items[1].id,
    startsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
    durationMinutes: 60,
    interviewers: [{ userId: manager.userId }],
    allowConflicts: true,
  },
});
check("an organizer can override a clash deliberately", forced.status === 201 || forced.status === 200, `got ${forced.status}`);
const forcedId = forced.body.id;

const backToBack = await call("/interviews", {
  ...H,
  body: {
    applicationId: apps.body.items[2].id,
    startsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
    durationMinutes: 60,
    interviewers: [{ userId: recruiter.userId }],
  },
});
check("a back-to-back slot is not treated as a clash", backToBack.status === 201 || backToBack.status === 200, `got ${backToBack.status}: ${JSON.stringify(backToBack.body).slice(0,150)}`);

const past = await call("/interviews", {
  ...H, body: { applicationId: application.id, startsAt: new Date(Date.now() - 86_400_000).toISOString(), interviewers: [{ userId: manager.userId }] },
});
check("scheduling in the past is refused", past.status === 400, `got ${past.status}`);

const outsiderPanel = await call("/interviews", {
  ...H, body: { applicationId: application.id, startsAt: nextWednesday(16).toISOString(), interviewers: [{ userId: "not-a-member" }] },
});
check("a non-member cannot be put on a panel", outsiderPanel.status === 400, `got ${outsiderPanel.status}`);

const viewerSchedule = await call("/interviews", {
  token: viewer.token, org: viewer.org,
  body: { applicationId: application.id, startsAt: nextWednesday(14).toISOString(), interviewers: [{ userId: manager.userId }] },
});
check("a viewer cannot schedule interviews (403)", viewerSchedule.status === 403, `got ${viewerSchedule.status}`);

const checkSlot = await call("/interviews/slots/check", {
  ...H, body: { startsAt: startsAt.toISOString(), durationMinutes: 60, userIds: [manager.userId] },
});
check("slot check reports the existing booking", checkSlot.status === 200 && checkSlot.body.available === false);

console.log("\n== Questions ==");
const generated = await call(`/interviews/${interview.id}/questions/suggest`, { ...H, body: { count: 6 } });
check("interview questions are suggested", generated.status === 200 && generated.body.questions.length > 0, `got ${generated.status}`);
check("suggestions say whether AI or rules produced them", ["AI", "HEURISTIC"].includes(generated.body.method));
check("every suggested question carries interviewer guidance", generated.body.questions.every((q) => q.guidance?.length > 10));
check("every suggested question carries a rationale", generated.body.questions.every((q) => q.rationale?.length > 0));
const banned = /\b(your age|how old|married|marital status|religion|which religion|your gender|nationality|children|pregnan|disabilit|caste)\b/i;
check("no suggested question touches a protected characteristic", generated.body.questions.every((q) => !banned.test(q.text)), generated.body.questions.map((q) => q.text).join(" | ").slice(0, 200));

const saveQuestions = await call(`/interviews/${interview.id}/questions`, {
  ...H, method: "PUT",
  body: { questions: generated.body.questions.slice(0, 4).map((q) => ({ text: q.text, category: q.category, difficulty: q.difficulty, guidance: q.guidance, rationale: q.rationale })) },
});
check("selected questions are attached to the interview", saveQuestions.status === 200 && saveQuestions.body.length === 4, `got ${saveQuestions.status}`);

const genForJob = await call("/questions/generate", { ...H, body: { jobId: job.id, kind: "TECHNICAL", count: 5 } });
check("questions can be generated into the bank for a job", genForJob.status === 200 && genForJob.body.questions.length > 0, `got ${genForJob.status}`);
check("generated bank questions start unapproved for human review", genForJob.body.questions.every((q) => q.approved === false));

const bank = await call("/questions?pageSize=50", { ...H, expect: 200 });
check("the bank lists the generated questions", bank.body.total >= 5);
const approved = await call("/questions/approve", { ...H, body: { ids: genForJob.body.questions.slice(0, 2).map((q) => q.id), approved: true } });
check("questions can be approved for use", approved.status === 200 && approved.body.updated === 2);

const viewerQuestion = await call("/questions", { token: viewer.token, org: viewer.org, body: { text: "Should not be allowed to write this", category: "TECHNICAL" } });
check("a viewer cannot add questions to the bank (403)", viewerQuestion.status === 403, `got ${viewerQuestion.status}`);

console.log("\n== Scorecards ==");
const mgr = { token: manager.token, org: manager.org };
const detail = await call(`/interviews/${interview.id}`, { ...mgr, expect: 200 });
check("an interviewer on the panel can open the interview", detail.body.isParticipant === true);
check("the interviewer sees their own scorecard", !!detail.body.myScorecardId);
check("panel feedback is hidden until the interviewer submits their own", detail.body.canSeePanelFeedback === false);

const criteriaIds = detail.body.criteria.map((c) => c.id);
const partial = await call(`/interviews/${interview.id}/scorecard`, {
  ...mgr, method: "PUT", body: { ratings: { [criteriaIds[0]]: { rating: 4, comment: "Strong on the fundamentals" } } },
});
check("a scorecard can be saved as a draft", partial.status === 200 && partial.body.submittedAt === null, `got ${partial.status}`);
check("partial ratings produce a weighted score without zeroing the rest", partial.body.overallRating === 4, `got ${partial.body.overallRating}`);

const earlySubmit = await call(`/interviews/${interview.id}/scorecard`, { ...mgr, method: "PUT", body: { submit: true } });
check("submitting with criteria unrated is refused and says which", earlySubmit.status === 400 && /Rate every criterion/.test(earlySubmit.body.message), JSON.stringify(earlySubmit.body).slice(0, 150));

const badRating = await call(`/interviews/${interview.id}/scorecard`, { ...mgr, method: "PUT", body: { ratings: { [criteriaIds[0]]: { rating: 9 } } } });
check("a rating outside 1-5 is rejected", badRating.status === 400, `got ${badRating.status}`);

const unknownCriterion = await call(`/interviews/${interview.id}/scorecard`, { ...mgr, method: "PUT", body: { ratings: { made_up: { rating: 3 } } } });
check("an unknown criterion is rejected", unknownCriterion.status === 400, `got ${unknownCriterion.status}`);

const fullRatings = Object.fromEntries(criteriaIds.map((id, i) => [id, { rating: (i % 2 ? 4 : 5), comment: "Evidence from the interview" }]));
const submitted = await call(`/interviews/${interview.id}/scorecard`, {
  ...mgr, method: "PUT", body: { ratings: fullRatings, recommendation: "YES", strengths: "Clear reasoning, solid React depth", concerns: "Limited exposure to PostgreSQL tuning", submit: true },
});
check("a complete scorecard can be submitted", submitted.status === 200 && !!submitted.body.submittedAt, `got ${submitted.status}: ${JSON.stringify(submitted.body).slice(0,150)}`);

const editAfterSubmit = await call(`/interviews/${interview.id}/scorecard`, { ...mgr, method: "PUT", body: { recommendation: "NO" } });
check("a submitted scorecard cannot be edited", editAfterSubmit.status === 400, `got ${editAfterSubmit.status}`);

const afterSubmit = await call(`/interviews/${interview.id}`, { ...mgr, expect: 200 });
check("the panel's feedback becomes visible once the interviewer has submitted", afterSubmit.body.canSeePanelFeedback === true);
check("the panel summary counts submitted and pending feedback", afterSubmit.body.panel.submitted === 1 && afterSubmit.body.panel.pending === 1);
check("the panel summary reports no decision, only consensus", !("decision" in afterSubmit.body.panel) && typeof afterSubmit.body.panel.consensus === "string");

const otherCard = await call(`/interviews/${interview.id}/scorecard`, {
  ...H, method: "PUT", body: { ratings: Object.fromEntries(criteriaIds.map((id) => [id, { rating: 2 }])), recommendation: "NO", submit: true },
});
check("a second interviewer can submit independently", otherCard.status === 200, `got ${otherCard.status}`);
const split = await call(`/interviews/${interview.id}`, { ...mgr, expect: 200 });
check("a disagreeing panel is flagged as split, not resolved automatically", split.body.panel.split === true && split.body.panel.consensus === "mixed");

const nonPanel = await call(`/interviews/${interview.id}/scorecard`, {
  token: viewer.token, org: viewer.org, method: "PUT", body: { ratings: {} },
});
check("someone not on the panel cannot leave feedback", nonPanel.status === 403, `got ${nonPanel.status}`);

console.log("\n== Reschedule, cancel, history ==");
const newTime = nextWednesday(13);
const rescheduled = await call(`/interviews/${forcedId}/reschedule`, { ...H, body: { startsAt: newTime.toISOString(), reason: "Candidate asked for a later slot" } });
check("an interview can be rescheduled", rescheduled.status === 200, `got ${rescheduled.status}: ${JSON.stringify(rescheduled.body).slice(0,150)}`);
check("the new time is stored", new Date(rescheduled.body.startsAt).getTime() === newTime.getTime());

const cancelled = await call(`/interviews/${forcedId}/cancel`, { ...H, body: { reason: "Role put on hold" } });
check("an interview can be cancelled with a reason", cancelled.status === 200 && cancelled.body.status === "CANCELLED" && !!cancelled.body.cancelReason);

const calendar = await call(`/interviews/calendar?from=${new Date().toISOString()}&to=${new Date(Date.now() + 30 * 86400000).toISOString()}`, { ...H, expect: 200 });
check("the calendar returns scheduled interviews", calendar.body.interviews.length > 0);
check("cancelled interviews are left off the calendar", !calendar.body.interviews.some((i) => i.id === forcedId));
check("calendar entries carry a local time label", calendar.body.interviews.every((i) => typeof i.localLabel === "string" && i.localLabel.length > 0));

const mine = await call("/interviews/mine", { ...mgr, expect: 200 });
check("an interviewer sees their own assignments", Array.isArray(mine.body.upcoming) && Array.isArray(mine.body.pendingFeedback));

const feedback = await call(`/applications/${application.id}/interviews`, { ...H, expect: 200 });
check("all feedback for an application is retrievable", feedback.body.length >= 1 && feedback.body[0].scorecards.length === 2);
check("each round reports its own panel summary", typeof feedback.body[0].panel.consensus === "string");

console.log("\n== Communication log ==");
const history = await call("/communications?pageSize=50", { ...H, expect: 200 });
check("sent and skipped messages are logged", history.body.total > 0, `got ${history.body.total}`);
check("each logged message records its outcome", history.body.items.every((c) => ["QUEUED", "SENT", "FAILED", "SKIPPED"].includes(c.status)));
check("automated messages are distinguishable from human ones", history.body.items.some((c) => c.automated === true));
const invitation = history.body.items.find((c) => c.templateKey === "INTERVIEW_INVITATION");
check("the interview invitation was generated from its template", !!invitation, history.body.items.map((i) => i.templateKey).join(","));
check("the invitation contains the real interview time, not a placeholder", invitation ? !invitation.body.includes("{{") : false);

const manualSend = await call("/communications/send", {
  ...H, body: { applicationId: application.id, subject: "A quick question about your application", body: "Hello {{candidate.firstName}}, could you confirm your notice period?" },
});
check("a one-off email can be sent to a candidate", manualSend.status === 200 && manualSend.body.status === "QUEUED", JSON.stringify(manualSend.body).slice(0, 150));

const bulk = await call("/communications/send-bulk", {
  ...H, body: { applicationIds: apps.body.items.slice(0, 2).map((a) => a.id), templateId: templates.body.find((t) => t.key === "SHORTLISTED").id },
});
check("bulk email reports per-recipient outcomes", bulk.status === 200 && bulk.body.results.length === 2, `got ${bulk.status}`);

const viewerSend = await call("/communications/send", { token: viewer.token, org: viewer.org, body: { applicationId: application.id, subject: "Hi", body: "Hello there" } });
check("a viewer cannot email candidates (403)", viewerSend.status === 403, `got ${viewerSend.status}`);

const stats = await call("/communications/stats?days=30", { ...H, expect: 200 });
check("delivery statistics are reported", typeof stats.body.sent === "number" && "deliveryRate" in stats.body);

console.log("\n== Tenant isolation (Phase 2) ==");
const stamp = Date.now();
const rival = await call("/auth/register", {
  body: { name: "Rival", email: `rival${stamp}@test.test`, password: "Rival123456", organizationName: `Rival ${stamp}` }, expect: 201,
});
const rivalMe = await call("/auth/me", { token: rival.body.accessToken, expect: 200 });
const R = { token: rival.body.accessToken, org: rivalMe.body.organizations[0].id };
check("a new organization gets its own email templates", (await call("/communications/templates", { ...R, expect: 200 })).body.length >= 8);
const freshAutomations = await call("/communications/automations", { ...R, expect: 200 });
check("a new organization has no candidate-facing automation switched on", freshAutomations.body.rules.every((r) => !r.enabled), JSON.stringify(freshAutomations.body.rules).slice(0, 120));
check("another tenant's interview is not readable", (await call(`/interviews/${interview.id}`, R)).status === 404);
check("another tenant sees no interviews", (await call("/interviews", { ...R, expect: 200 })).body.total === 0);
check("another tenant sees no communications", (await call("/communications", { ...R, expect: 200 })).body.total === 0);
check("another tenant's question bank is empty", (await call("/questions", { ...R, expect: 200 })).body.total === 0);

// Leave the demo org as it was.
await call("/communications/automations", { ...HR, method: "PUT", body: { trigger: "APPLICATION_CREATED", templateId: receivedTemplate.id, enabled: false } });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
