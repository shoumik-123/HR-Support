import { Injectable } from "@nestjs/common";
import { AiRequestError, AiService } from "../ai/ai.service";
import { blindLabel, shouldMask } from "../candidates/candidate-view";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { can, Permission } from "../common/permissions";
import { PrismaService } from "../prisma/prisma.service";
import { TalentService } from "../talent/talent.service";
import { aiNarrate, aiRoute, COPILOT_PROMPT_VERSION } from "./copilot-ai";
import { emptyFindings, Fact, Findings, has, heuristicAnswer, is, plural, Reference, was } from "./copilot-findings";
import {
  asksForADecision,
  capabilitiesAnswer,
  Intent,
  INTENT_SPECS,
  IntentSpec,
  routeQuestion,
  RoutedQuestion,
  stripSearchPreamble,
} from "./copilot-intents";

const HEURISTIC_VERSION = "copilot-heuristic-v1";
const DAY = 86_400_000;
const STUCK_DAYS = 14;

/** Appended to every answer. The copilot describes; people decide. */
const STANDING_NOTE = "These are figures from your own data, not a recommendation — what to do about them is your call.";

@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly activity: ActivityService,
    private readonly talent: TalentService,
  ) {}

  async ask(ctx: RequestContext, question: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { blindModeDefault: true } });
    const mask = shouldMask(ctx, org.blindModeDefault);

    // A member is only ever routed to a question they are allowed to have answered, so an
    // answer can never be the reason they learn something their role does not permit.
    const allowed = Object.values(INTENT_SPECS).filter((spec) => can(ctx.role, spec.permission));
    const route = await this.route(ctx, question, allowed);

    // A question that asks the copilot to judge a person is answered with a refusal and the
    // list of what it can do - not with whatever figures happened to sit nearest the words.
    const decision = asksForADecision(question);
    const intent = decision ? "capabilities" : route.intent;
    const findings = await this.gather(ctx, intent, route, mask, allowed);
    if (decision) {
      findings.notes.unshift("I cannot advise on who to hire, reject or advance — that decision is a person's to make, with the evidence in front of them.");
    }

    const narration = await this.narrate(ctx, question, findings);

    await this.activity.log({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      action: "copilot.asked",
      entityType: "organization",
      entityId: ctx.orgId,
      data: { question: question.slice(0, 300), intent, method: narration.method } as never,
      ip: ctx.ip,
    });

    return {
      question,
      intent,
      asked: INTENT_SPECS[intent].summary,
      subject: findings.subject,
      answer: narration.answer,
      facts: findings.facts,
      references: findings.references,
      notes: [...findings.notes, ...narration.caveats, STANDING_NOTE],
      followUps: INTENT_SPECS[intent].followUps,
      method: narration.method,
      model: narration.model ?? route.model ?? null,
      promptVersion: narration.method === "AI" || route.method === "AI" ? COPILOT_PROMPT_VERSION : HEURISTIC_VERSION,
      routing: { method: route.method, confidence: route.confidence },
      confidence: Math.min(route.confidence, narration.confidence),
      blindMode: mask,
      /** What this member is allowed to ask about, for the suggestions on screen. */
      canAsk: allowed.map((s) => ({ intent: s.intent, summary: s.summary })),
    };
  }

  /** Which of the fixed questions this is. The model helps when it can; the rules always can. */
  private async route(ctx: RequestContext, question: string, allowed: IntentSpec[]) {
    const fallback = (reason?: string) => {
      const routed = routeQuestion(question);
      const intent = allowed.some((s) => s.intent === routed.intent) ? routed.intent : "capabilities";
      return { ...routed, intent, method: "HEURISTIC" as const, model: null, fallbackReason: reason };
    };

    if (!this.ai.enabled || !can(ctx.role, Permission.AiUse)) return fallback();
    try {
      const routed = await aiRoute(this.ai, ctx.orgId, question, allowed);
      // The rules still supply a period or a job title the model left out; they cost nothing.
      const rules = routeQuestion(question);
      return {
        ...routed,
        jobHint: routed.jobHint ?? rules.jobHint,
        days: routed.days ?? rules.days,
        searchPhrase: routed.searchPhrase ?? rules.searchPhrase,
        method: "AI" as const,
        fallbackReason: undefined,
      };
    } catch (err) {
      return fallback(err instanceof AiRequestError ? err.message : "AI could not read the question");
    }
  }

  /** Turn the figures into prose. Without a model the highlights are the answer. */
  private async narrate(ctx: RequestContext, question: string, findings: Findings) {
    const base = { answer: heuristicAnswer(findings), confidence: 0.8, caveats: [] as string[], model: null as string | null };
    if (!this.ai.enabled || !can(ctx.role, Permission.AiUse)) return { ...base, method: "HEURISTIC" as const };
    try {
      const narrated = await aiNarrate(this.ai, ctx.orgId, question, findings);
      return { ...narrated, method: "AI" as const };
    } catch {
      return { ...base, method: "HEURISTIC" as const, caveats: ["Written from the figures directly, because the AI narration was unavailable."] };
    }
  }

  // ───────────────────────── Facts, one gatherer per question ─────────────────────────

  private gather(ctx: RequestContext, intent: Intent, route: RoutedQuestion, mask: boolean, allowed: IntentSpec[]): Promise<Findings> {
    switch (intent) {
      case "top_candidates":
        return this.topCandidates(ctx, route, mask);
      case "pipeline_health":
        return this.pipelineHealth(ctx, route);
      case "stuck_applications":
        return this.stuckApplications(ctx, route, mask);
      case "time_to_hire":
        return this.timeToHire(ctx, route);
      case "interview_load":
        return this.interviewLoad(ctx, route, mask);
      case "offer_status":
        return this.offerStatus(ctx, route, mask);
      case "assessment_status":
        return this.assessmentStatus(ctx, route);
      case "job_funnel":
        return this.jobFunnel(ctx, route);
      case "find_candidates":
        return this.findCandidates(ctx, route, mask);
      case "capabilities":
      default:
        return this.capabilities(allowed);
    }
  }

  private async capabilities(allowed: IntentSpec[]): Promise<Findings> {
    const f = emptyFindings("capabilities");
    f.highlights.push(capabilitiesAnswer(allowed));
    return f;
  }

  /** The job the question was about: named if possible, otherwise the newest open one, said out loud. */
  private async resolveJob(ctx: RequestContext, hint: string | null) {
    const jobs = await this.prisma.job.findMany({
      where: { organizationId: ctx.orgId, status: { not: "ARCHIVED" } },
      select: { id: true, title: true, status: true, openings: true, publishedAt: true, createdAt: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    if (!jobs.length) return { job: null, note: "There are no jobs in this organization yet." };
    if (!hint) {
      const fallbackJob = jobs.find((j) => j.status === "PUBLISHED") ?? jobs[0];
      return { job: fallbackJob, note: `No job was named, so this is about the most recent one, ${fallbackJob.title}.` };
    }
    const needle = hint.toLowerCase();
    const exact = jobs.find((j) => j.title.toLowerCase() === needle);
    if (exact) return { job: exact, note: null };
    const partial = jobs.filter((j) => j.title.toLowerCase().includes(needle) || needle.includes(j.title.toLowerCase()));
    if (partial.length === 1) return { job: partial[0], note: null };
    if (partial.length > 1) return { job: partial[0], note: `"${hint}" matches ${partial.length} jobs; this is about ${partial[0].title}.` };
    const fallbackJob = jobs.find((j) => j.status === "PUBLISHED") ?? jobs[0];
    return { job: fallbackJob, note: `No job called "${hint}" exists here, so this is about ${fallbackJob.title} instead.` };
  }

  private label(mask: boolean, candidate: { id: string; fullName: string }) {
    return mask ? blindLabel(candidate.id) : candidate.fullName;
  }

  private async topCandidates(ctx: RequestContext, route: RoutedQuestion, mask: boolean): Promise<Findings> {
    const f = emptyFindings("top_candidates");
    const { job, note } = await this.resolveJob(ctx, route.jobHint);
    if (note) f.notes.push(note);
    if (!job) return f;
    f.subject = job.title;

    const apps = await this.prisma.application.findMany({
      where: { organizationId: ctx.orgId, jobId: job.id, status: "ACTIVE" },
      select: {
        id: true,
        candidate: { select: { id: true, fullName: true, totalExperienceYears: true } },
        stage: { select: { name: true } },
        matches: { orderBy: { createdAt: "desc" }, take: 1, select: { score: true, adjustedScore: true, reviewStatus: true, method: true } },
      },
      take: 500,
    });

    const scored = apps
      .map((a) => ({ app: a, score: a.matches[0]?.adjustedScore ?? a.matches[0]?.score ?? null }))
      .sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
    const withScore = scored.filter((s) => s.score != null);
    const average = withScore.length ? Math.round(withScore.reduce((s, x) => s + (x.score as number), 0) / withScore.length) : null;

    f.facts.push(
      { label: "Active candidates on this job", value: apps.length },
      { label: "Scored by matching", value: withScore.length, detail: `${apps.length - withScore.length} not scored yet` },
      { label: "Average match score", value: average },
    );
    for (const { app, score } of scored.slice(0, 5)) {
      f.references.push({
        type: "candidate",
        id: app.candidate.id,
        label: this.label(mask, app.candidate),
        score,
        detail: `${app.stage.name}${app.matches[0]?.reviewStatus === "PENDING" ? ", match not reviewed yet" : ""}`,
      });
    }

    if (!apps.length) f.highlights.push(`Nobody is active on ${job.title} at the moment.`);
    else {
      f.highlights.push(`${plural(apps.length, "candidate")} ${is(apps.length)} active on ${job.title}, and ${withScore.length} of them ${has(withScore.length)} a match score.`);
      if (withScore.length) {
        f.highlights.push(
          `The highest scoring ${is(Math.min(withScore.length, 5))} ${f.references.filter((r) => r.score != null).map((r) => `${r.label} (${r.score})`).join(", ")}.`,
        );
        if (average != null) f.highlights.push(`The average score of those assessed is ${average}.`);
      } else {
        f.highlights.push("None of them has been scored yet, so there is no ranking to give - run screening from the job to produce one.");
      }
    }
    if (apps.length > withScore.length && withScore.length) f.notes.push("Candidates without a score are missing from this ranking, not at the bottom of it — run screening on the job to include them.");
    if (mask) f.notes.push("Blind mode is on, so candidates appear by reference rather than by name.");
    return f;
  }

  private async pipelineHealth(ctx: RequestContext, route: RoutedQuestion): Promise<Findings> {
    const f = emptyFindings("pipeline_health");
    let jobId: string | undefined;
    if (route.jobHint) {
      const { job, note } = await this.resolveJob(ctx, route.jobHint);
      if (note) f.notes.push(note);
      if (job) {
        jobId = job.id;
        f.subject = job.title;
      }
    }

    const stages = await this.prisma.pipelineStage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } });
    const apps = await this.prisma.application.findMany({
      where: { organizationId: ctx.orgId, status: "ACTIVE", ...(jobId ? { jobId } : {}) },
      select: { stageId: true, stageEnteredAt: true },
      take: 5000,
    });

    const now = Date.now();
    let busiest: { name: string; count: number } | null = null;
    let slowest: { name: string; days: number } | null = null;
    for (const stage of stages) {
      const here = apps.filter((a) => a.stageId === stage.id);
      const oldest = here.reduce<number | null>((max, a) => Math.max(max ?? 0, Math.floor((now - a.stageEnteredAt.getTime()) / DAY)), null);
      f.facts.push({ label: `In ${stage.name}`, value: here.length, detail: oldest != null ? `longest wait ${plural(oldest, "day")}` : undefined });
      if (here.length && (!busiest || here.length > busiest.count)) busiest = { name: stage.name, count: here.length };
      if (oldest != null && stage.kind !== "HIRED" && stage.kind !== "REJECTED" && (!slowest || oldest > slowest.days)) slowest = { name: stage.name, days: oldest };
    }

    f.facts.unshift({ label: "Active candidates in total", value: apps.length });
    if (!apps.length) f.highlights.push(`There are no active candidates${f.subject ? ` on ${f.subject}` : ""} right now.`);
    else {
      f.highlights.push(`${plural(apps.length, "candidate")} ${is(apps.length)} active${f.subject ? ` on ${f.subject}` : " across all jobs"}.`);
      if (busiest) f.highlights.push(`${busiest.name} holds the most, with ${busiest.count}.`);
      if (slowest && slowest.days >= 1) f.highlights.push(`The longest anyone has waited in one stage is ${plural(slowest.days, "day")}, in ${slowest.name}.`);
      else f.highlights.push("Nobody has been sitting in a stage for a full day yet.");
    }
    return f;
  }

  private async stuckApplications(ctx: RequestContext, route: RoutedQuestion, mask: boolean): Promise<Findings> {
    const f = emptyFindings("stuck_applications");
    const threshold = route.days ?? STUCK_DAYS;
    const cutoff = new Date(Date.now() - threshold * DAY);
    let jobId: string | undefined;
    if (route.jobHint) {
      const { job, note } = await this.resolveJob(ctx, route.jobHint);
      if (note) f.notes.push(note);
      if (job) {
        jobId = job.id;
        f.subject = job.title;
      }
    }

    const where = { organizationId: ctx.orgId, status: "ACTIVE" as const, stageEnteredAt: { lt: cutoff }, ...(jobId ? { jobId } : {}) };
    const [count, worst] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({
        where,
        orderBy: { stageEnteredAt: "asc" },
        take: 5,
        select: { id: true, stageEnteredAt: true, candidate: { select: { id: true, fullName: true } }, stage: { select: { name: true } }, job: { select: { title: true } } },
      }),
    ]);

    f.facts.push({ label: `Waiting longer than ${plural(threshold, "day")}`, value: count });
    for (const a of worst) {
      const waited = Math.floor((Date.now() - a.stageEnteredAt.getTime()) / DAY);
      f.references.push({
        type: "application",
        id: a.id,
        label: this.label(mask, a.candidate),
        detail: `${plural(waited, "day")} in ${a.stage.name} — ${a.job.title}`,
      });
    }

    if (!count) f.highlights.push(`Nobody has been waiting more than ${plural(threshold, "day")} in a stage${f.subject ? ` on ${f.subject}` : ""}.`);
    else {
      f.highlights.push(`${plural(count, "candidate")} ${has(count)} been in the same stage for more than ${plural(threshold, "day")}${f.subject ? ` on ${f.subject}` : ""}.`);
      f.highlights.push(`The longest waits are ${f.references.map((r) => `${r.label} (${r.detail})`).join("; ")}.`);
    }
    return f;
  }

  private async timeToHire(ctx: RequestContext, route: RoutedQuestion): Promise<Findings> {
    const f = emptyFindings("time_to_hire");
    const window = route.days ?? 90;
    const since = new Date(Date.now() - window * DAY);
    const org = { organizationId: ctx.orgId };

    const [hired, rejected, active] = await Promise.all([
      this.prisma.application.findMany({ where: { ...org, status: "HIRED", hiredAt: { gte: since } }, select: { createdAt: true, hiredAt: true, job: { select: { title: true } } } }),
      this.prisma.application.count({ where: { ...org, status: "REJECTED", rejectedAt: { gte: since } } }),
      this.prisma.application.count({ where: { ...org, status: "ACTIVE" } }),
    ]);

    const spans = hired.map((a) => Math.round((a.hiredAt!.getTime() - a.createdAt.getTime()) / DAY)).sort((a, b) => a - b);
    const average = spans.length ? Math.round(spans.reduce((s, d) => s + d, 0) / spans.length) : null;
    const median = spans.length ? spans[Math.floor(spans.length / 2)] : null;

    f.facts.push(
      { label: "Period", value: `last ${plural(window, "day")}` },
      { label: "Hired", value: hired.length },
      { label: "Rejected", value: rejected },
      { label: "Still active", value: active },
      { label: "Average days from application to hire", value: average },
      { label: "Median days from application to hire", value: median },
      { label: "Fastest hire, in days", value: spans[0] ?? null },
      { label: "Slowest hire, in days", value: spans.at(-1) ?? null },
    );

    if (!hired.length) f.highlights.push(`Nobody was hired in the last ${plural(window, "day")}, so there is no time-to-hire figure for that period.`);
    else {
      f.highlights.push(`${plural(hired.length, "person", "people")} ${was(hired.length)} hired in the last ${plural(window, "day")}, taking ${plural(average ?? 0, "day")} on average and ${plural(median ?? 0, "day")} for the middle case.`);
      if (spans.length > 2) f.highlights.push(`The range was ${spans[0]} to ${spans.at(-1)} days.`);
      f.highlights.push(`${plural(rejected, "application")} ${was(rejected)} rejected in the same period, and ${active} ${is(active)} still active.`);
    }
    if (hired.length === 1) f.notes.push("One hire is not a trend — treat the average as a single data point.");
    return f;
  }

  private async interviewLoad(ctx: RequestContext, route: RoutedQuestion, mask: boolean): Promise<Findings> {
    const f = emptyFindings("interview_load");
    const window = route.days ?? 7;
    const now = new Date();
    const until = new Date(now.getTime() + window * DAY);

    const [upcoming, next, overdueFeedback, myOverdue] = await Promise.all([
      this.prisma.interview.count({ where: { organizationId: ctx.orgId, status: "SCHEDULED", startsAt: { gte: now, lte: until } } }),
      this.prisma.interview.findMany({
        where: { organizationId: ctx.orgId, status: "SCHEDULED", startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        take: 5,
        select: { id: true, title: true, startsAt: true, candidate: { select: { id: true, fullName: true } }, job: { select: { title: true } } },
      }),
      this.prisma.scorecard.count({ where: { organizationId: ctx.orgId, submittedAt: null, interview: { endsAt: { lt: now }, status: { in: ["SCHEDULED", "COMPLETED"] } } } }),
      this.prisma.scorecard.count({ where: { organizationId: ctx.orgId, interviewerId: ctx.userId, submittedAt: null, interview: { endsAt: { lt: now }, status: { in: ["SCHEDULED", "COMPLETED"] } } } }),
    ]);

    f.facts.push(
      { label: `Interviews scheduled in the next ${plural(window, "day")}`, value: upcoming },
      { label: "Scorecards still owed after an interview has ended", value: overdueFeedback },
      { label: "Of those, owed by you", value: myOverdue },
    );
    for (const i of next) {
      f.references.push({
        type: "interview",
        id: i.id,
        label: `${i.title} — ${this.label(mask, i.candidate)}`,
        detail: `${i.job.title}, ${i.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
      });
    }

    f.highlights.push(
      upcoming
        ? `${plural(upcoming, "interview")} ${is(upcoming)} scheduled in the next ${plural(window, "day")}.`
        : `No interviews are scheduled in the next ${plural(window, "day")}.`,
    );
    if (next.length) f.highlights.push(`Next up: ${f.references.map((r) => `${r.label} (${r.detail})`).join("; ")}.`);
    if (overdueFeedback) {
      f.highlights.push(`${plural(overdueFeedback, "scorecard")} ${is(overdueFeedback)} still owed for interviews that have already finished${myOverdue ? `, ${myOverdue} of them yours` : ""}.`);
    }
    if (myOverdue) f.notes.push("While you owe feedback you will only see your own scorecard on those interviews, so your rating is not swayed by anyone else's.");
    return f;
  }

  private async offerStatus(ctx: RequestContext, route: RoutedQuestion, mask: boolean): Promise<Findings> {
    const f = emptyFindings("offer_status");
    const window = route.days ?? 90;
    const since = new Date(Date.now() - window * DAY);

    const [byStatus, waiting, recent] = await Promise.all([
      this.prisma.offer.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: true }),
      this.prisma.offer.findMany({
        where: { organizationId: ctx.orgId, status: "PENDING_APPROVAL" },
        orderBy: { updatedAt: "asc" },
        take: 5,
        select: {
          id: true,
          updatedAt: true,
          candidate: { select: { id: true, fullName: true } },
          job: { select: { title: true } },
          approvals: { where: { decision: "PENDING" }, select: { approver: { select: { name: true } } } },
        },
      }),
      this.prisma.offer.count({ where: { organizationId: ctx.orgId, status: { in: ["ACCEPTED", "DECLINED"] }, updatedAt: { gte: since } } }),
    ]);

    const count = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;
    for (const row of byStatus) f.facts.push({ label: `Offers ${row.status.toLowerCase().replace("_", " ")}`, value: row._count });
    f.facts.push({ label: `Accepted or declined in the last ${plural(window, "day")}`, value: recent });

    for (const o of waiting) {
      const days = Math.floor((Date.now() - o.updatedAt.getTime()) / DAY);
      f.references.push({
        type: "offer",
        id: o.id,
        label: `${this.label(mask, o.candidate)} — ${o.job.title}`,
        detail: `waiting ${plural(days, "day")} on ${o.approvals.map((a) => a.approver.name).join(", ") || "approval"}`,
      });
    }

    const total = byStatus.reduce((s, r) => s + r._count, 0);
    if (!total) f.highlights.push("No offers have been created yet.");
    else {
      f.highlights.push(`There ${is(total)} ${plural(total, "offer")} in all: ${count("PENDING_APPROVAL")} awaiting approval, ${count("SENT")} sent, ${count("ACCEPTED")} accepted and ${count("DECLINED")} declined.`);
      if (waiting.length) f.highlights.push(`Waiting on approval: ${f.references.map((r) => `${r.label} (${r.detail})`).join("; ")}.`);
    }
    if (count("PENDING_APPROVAL")) f.notes.push("Editing an offer resets its approvals, so an offer that has been revised starts its approval round again.");
    return f;
  }

  private async assessmentStatus(ctx: RequestContext, route: RoutedQuestion): Promise<Findings> {
    const f = emptyFindings("assessment_status");
    const [byStatus, awaitingMarking] = await Promise.all([
      this.prisma.assessment.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: true }),
      this.prisma.assessment.count({ where: { organizationId: ctx.orgId, status: "SUBMITTED" } }),
    ]);

    for (const row of byStatus) f.facts.push({ label: `Assessments ${row.status.toLowerCase().replace("_", " ")}`, value: row._count });
    f.facts.push({ label: "Submitted and waiting to be marked", value: awaitingMarking });

    const total = byStatus.reduce((s, r) => s + r._count, 0);
    const count = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;
    if (!total) f.highlights.push("No assessments have been sent yet.");
    else {
      f.highlights.push(`${plural(total, "assessment")} ${has(total)} been sent: ${count("INVITED")} not started, ${count("IN_PROGRESS")} under way, ${awaitingMarking} waiting to be marked and ${count("EVALUATED")} finished.`);
      if (count("EXPIRED")) f.highlights.push(`${plural(count("EXPIRED"), "assessment")} expired before being sat.`);
    }
    if (awaitingMarking) f.notes.push("A paper with written answers has no percentage until every one of them is marked — an unmarked answer is never counted as zero.");
    return f;
  }

  private async jobFunnel(ctx: RequestContext, route: RoutedQuestion): Promise<Findings> {
    const f = emptyFindings("job_funnel");
    const { job, note } = await this.resolveJob(ctx, route.jobHint);
    if (note) f.notes.push(note);
    if (!job) return f;
    f.subject = job.title;

    const [applications, hired, rejected, interviewed, offers, matches] = await Promise.all([
      this.prisma.application.count({ where: { organizationId: ctx.orgId, jobId: job.id } }),
      this.prisma.application.count({ where: { organizationId: ctx.orgId, jobId: job.id, status: "HIRED" } }),
      this.prisma.application.count({ where: { organizationId: ctx.orgId, jobId: job.id, status: "REJECTED" } }),
      this.prisma.interview.findMany({ where: { organizationId: ctx.orgId, jobId: job.id }, select: { candidateId: true } }),
      this.prisma.offer.count({ where: { organizationId: ctx.orgId, jobId: job.id } }),
      this.prisma.matchResult.aggregate({ where: { organizationId: ctx.orgId, jobId: job.id }, _avg: { score: true }, _count: true }),
    ]);

    const interviewedPeople = new Set(interviewed.map((i) => i.candidateId)).size;
    const pct = (n: number) => (applications ? Math.round((n / applications) * 100) : null);
    const average = matches._avg?.score != null ? Math.round(matches._avg.score) : null;

    f.facts.push(
      { label: "Applications", value: applications },
      { label: "Interviewed", value: interviewedPeople, detail: pct(interviewedPeople) != null ? `${pct(interviewedPeople)}% of applicants` : undefined },
      { label: "Offers made", value: offers },
      { label: "Hired", value: hired, detail: `${job.openings} opening${job.openings === 1 ? "" : "s"}` },
      { label: "Rejected", value: rejected },
      { label: "Average match score", value: average, detail: `${matches._count} scored` },
    );
    f.references.push({ type: "job", id: job.id, label: job.title, detail: job.status.toLowerCase() });

    if (!applications) f.highlights.push(`${job.title} has had no applications yet.`);
    else {
      f.highlights.push(`${job.title} has ${plural(applications, "application")}: ${interviewedPeople} interviewed, ${offers} offered and ${hired} hired, with ${rejected} rejected.`);
      if (average != null) f.highlights.push(`The average match score across ${matches._count} assessments is ${average}.`);
      if (hired >= job.openings && job.openings > 0) f.highlights.push(`All ${plural(job.openings, "opening")} are filled.`);
    }
    return f;
  }

  private async findCandidates(ctx: RequestContext, route: RoutedQuestion, mask: boolean): Promise<Findings> {
    const f = emptyFindings("find_candidates");
    const phrase = route.searchPhrase ?? stripSearchPreamble(route.jobHint ?? "");
    if (!phrase.trim()) {
      f.highlights.push("Tell me what to look for — a skill, a role, a location, years of experience — and I will search the pool.");
      return f;
    }

    // The same search the Smart search page runs, so the copilot cannot rank people by some
    // other arithmetic than the one the recruiter can inspect.
    const results = await this.talent.search(ctx, { phrase, page: 1, pageSize: 5 });
    f.subject = phrase;
    f.facts.push(
      { label: "Search read as", value: results.query.interpretation },
      { label: "Candidates matching", value: results.total, detail: `${results.poolSearched} read` },
      { label: "Left out by exclusions", value: results.excludedCount },
    );
    for (const hit of results.items) {
      f.references.push({
        type: "candidate",
        id: hit.candidate.id,
        label: hit.candidate.fullName,
        score: hit.score,
        detail: hit.reasons.join("; ") || hit.gaps.join("; "),
      });
    }

    if (!results.total) f.highlights.push(`Nobody in the pool matches "${phrase}".`);
    else {
      f.highlights.push(`${plural(results.total, "candidate")} in the pool match "${phrase}", read as: ${results.query.interpretation}`);
      f.highlights.push(`The closest ${is(f.references.length)} ${f.references.map((r) => `${r.label}${r.score != null ? ` (${r.score})` : ""}`).join(", ")}.`);
    }
    f.notes.push("Open Smart search to see the full list, the evidence behind each score, and to correct how the search was read.");
    if (mask) f.notes.push("Blind mode is on, so candidates appear by reference rather than by name.");
    return f;
  }
}

export type { Fact, Reference };
