import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { AiRequestError, AiService } from "../ai/ai.service";
import { shouldMask, view } from "../candidates/candidate-view";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { can, Permission } from "../common/permissions";
import { paginate } from "../common/validation";
import { CommunicationsService } from "../communications/communications.service";
import { Prisma } from "../generated/prisma/client";
import {
  InterviewKind,
  InterviewMode,
  InterviewStatus,
  ParticipantRole,
  QuestionCategory,
  QuestionDifficulty,
  Recommendation,
  TemplateKey,
} from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { ParsedResume } from "../resumes/parsed-resume";
import { generateQuestions, heuristicQuestions, QUESTION_PROMPT_VERSION } from "./question-generator";
import {
  availabilityGaps,
  BusyBlock,
  buildIcs,
  findConflicts,
  findFreeSlots,
  formatInZone,
  WeeklySlot,
} from "./scheduling";
import { criteriaForKind, parseCriteria, Ratings, RatingsSchema, summarisePanel, weightedRating } from "./scorecard-criteria";

export const INTERVIEW_REMINDER_JOB = "interview.reminder";

export interface ScheduleInput {
  applicationId: string;
  templateId?: string;
  title?: string;
  kind?: InterviewKind;
  mode?: InterviewMode;
  startsAt: Date;
  durationMinutes?: number;
  timezone?: string;
  location?: string | null;
  meetingLink?: string | null;
  agenda?: string | null;
  interviewers: { userId: string; role?: ParticipantRole }[];
  questionIds?: string[];
  /** Skip the conflict guard after the organizer has seen and accepted the clash. */
  allowConflicts?: boolean;
  notifyCandidate?: boolean;
}

@Injectable()
export class InterviewsService implements OnModuleInit {
  private readonly logger = new Logger("Interviews");

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly queue: QueueService,
    private readonly activity: ActivityService,
    private readonly comms: CommunicationsService,
  ) {}

  onModuleInit() {
    this.queue.register(INTERVIEW_REMINDER_JOB, async (payload: { interviewId: string }) => {
      await this.sendReminder(payload.interviewId);
    });
    // Sweep for interviews whose reminder is due; the queue handles the sending.
    const sweep = () => this.scheduleDueReminders().catch((e) => this.logger.warn(`Reminder sweep failed: ${e}`));
    sweep();
    setInterval(sweep, 10 * 60 * 1000).unref();
  }

  // ── Scheduling ──

  async schedule(ctx: RequestContext, input: ScheduleInput) {
    const app = await this.prisma.application.findFirst({
      where: { id: input.applicationId, organizationId: ctx.orgId },
      include: { job: true, candidate: { select: { id: true, fullName: true } } },
    });
    if (!app) throw new NotFoundException("Application not found");
    if (app.status === "REJECTED") throw new BadRequestException("This application has been rejected; reopen it before scheduling");

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } });
    const timezone = input.timezone ?? org.timezone;

    const template = input.templateId
      ? await this.prisma.interviewTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.orgId } })
      : null;
    if (input.templateId && !template) throw new BadRequestException("Unknown interview template");

    const kind = input.kind ?? template?.kind ?? "TECHNICAL";
    const duration = input.durationMinutes ?? template?.durationMinutes ?? 60;
    if (duration < 10 || duration > 480) throw new BadRequestException("Interview length must be between 10 and 480 minutes");

    const startsAt = input.startsAt;
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (startsAt.getTime() < Date.now() - 60_000) throw new BadRequestException("Interviews cannot be scheduled in the past");

    const interviewerIds = [...new Set(input.interviewers.map((i) => i.userId))];
    if (!interviewerIds.length) throw new BadRequestException("Assign at least one interviewer");
    await this.assertMembers(ctx.orgId, interviewerIds);

    const { conflicts, gaps } = await this.checkSlot(ctx.orgId, { start: startsAt, end: endsAt }, interviewerIds);
    if (conflicts.length && !input.allowConflicts) {
      throw new BadRequestException({
        message: "One or more interviewers are already booked at this time",
        conflicts: await this.describeConflicts(conflicts),
        availabilityGaps: gaps,
      });
    }

    const criteria = template ? parseCriteria(template.criteria) : criteriaForKind(kind);
    // Cancelled interviews do not consume a round: a candidate whose first slot fell
    // through is still on round 1.
    const round = (await this.prisma.interview.count({ where: { applicationId: app.id, status: { not: "CANCELLED" } } })) + 1;

    const interview = await this.prisma.$transaction(async (tx) => {
      const created = await tx.interview.create({
        data: {
          organizationId: ctx.orgId,
          applicationId: app.id,
          jobId: app.jobId,
          candidateId: app.candidateId,
          templateId: template?.id,
          title: input.title?.trim() || `${kindLabel(kind)} interview: ${app.job.title}`,
          kind,
          round,
          mode: input.mode ?? "VIDEO",
          startsAt,
          endsAt,
          timezone,
          location: input.location ?? null,
          meetingLink: input.meetingLink ?? null,
          agenda: input.agenda ?? null,
          criteria: criteria as unknown as Prisma.InputJsonValue,
          createdById: ctx.userId,
          participants: {
            create: input.interviewers.map((i, index) => ({
              userId: i.userId,
              role: i.role ?? (index === 0 ? "LEAD" : "PANEL"),
            })),
          },
        },
        include: { participants: true },
      });

      const questionIds = input.questionIds ?? template?.questionIds ?? [];
      if (questionIds.length) {
        const bank = await tx.interviewQuestion.findMany({ where: { id: { in: questionIds }, organizationId: ctx.orgId } });
        const byId = new Map(bank.map((q) => [q.id, q]));
        await tx.interviewQuestionItem.createMany({
          data: questionIds
            .map((id, position) => {
              const q = byId.get(id);
              return q
                ? { interviewId: created.id, questionId: q.id, text: q.text, category: q.category, difficulty: q.difficulty, guidance: q.guidance, rationale: q.rationale, position }
                : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
        });
      }

      // A pending scorecard per interviewer, so the panel's workload is visible from the start.
      await tx.scorecard.createMany({
        data: created.participants
          .filter((p) => p.role !== "OBSERVER")
          .map((p) => ({ organizationId: ctx.orgId, interviewId: created.id, interviewerId: p.userId, ratings: {} })),
      });

      return created;
    });

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "interview.scheduled", entityType: "interview", entityId: interview.id,
      candidateId: app.candidateId, jobId: app.jobId, applicationId: app.id,
      data: { kind, round, startsAt: startsAt.toISOString(), timezone, interviewers: interviewerIds.length, conflictsOverridden: conflicts.length > 0 },
      ip: ctx.ip,
    });

    await this.notifyInterviewers(interview.id, "scheduled", ctx.userId);
    if (input.notifyCandidate !== false) {
      await this.notifyCandidate(ctx.orgId, interview.id, "INTERVIEW_SCHEDULED", true);
    }
    await this.queueReminder(interview.id);

    return this.get(ctx, interview.id);
  }

  async reschedule(ctx: RequestContext, id: string, input: { startsAt: Date; durationMinutes?: number; reason?: string; allowConflicts?: boolean; notifyCandidate?: boolean }) {
    const existing = await this.find(ctx, id);
    if (existing.status !== "SCHEDULED") throw new BadRequestException("Only a scheduled interview can be rescheduled");

    const duration = input.durationMinutes ?? Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000);
    const startsAt = input.startsAt;
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (startsAt.getTime() < Date.now() - 60_000) throw new BadRequestException("Interviews cannot be scheduled in the past");

    const participants = await this.prisma.interviewParticipant.findMany({ where: { interviewId: id }, select: { userId: true } });
    const userIds = participants.map((p) => p.userId);
    const { conflicts, gaps } = await this.checkSlot(ctx.orgId, { start: startsAt, end: endsAt }, userIds, id);
    if (conflicts.length && !input.allowConflicts) {
      throw new BadRequestException({ message: "One or more interviewers are already booked at this time", conflicts: await this.describeConflicts(conflicts), availabilityGaps: gaps });
    }

    const updated = await this.prisma.interview.update({
      where: { id },
      data: { startsAt, endsAt, agenda: existing.agenda, participants: { updateMany: { where: { interviewId: id }, data: { response: "PENDING", respondedAt: null } } } },
    });

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "interview.rescheduled", entityType: "interview", entityId: id,
      candidateId: existing.candidateId, jobId: existing.jobId, applicationId: existing.applicationId,
      data: { from: existing.startsAt.toISOString(), to: startsAt.toISOString(), reason: input.reason ?? null }, ip: ctx.ip,
    });

    await this.notifyInterviewers(id, "rescheduled", ctx.userId);
    if (input.notifyCandidate !== false) await this.notifyCandidate(ctx.orgId, id, "INTERVIEW_RESCHEDULED", true);
    await this.queueReminder(id);
    return updated;
  }

  async cancel(ctx: RequestContext, id: string, reason: string, notifyCandidate = true) {
    const existing = await this.find(ctx, id);
    if (existing.status === "CANCELLED") return existing;
    const updated = await this.prisma.interview.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: reason, cancelledAt: new Date() },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "interview.cancelled", entityType: "interview", entityId: id,
      candidateId: existing.candidateId, jobId: existing.jobId, applicationId: existing.applicationId, data: { reason }, ip: ctx.ip,
    });
    await this.notifyInterviewers(id, "cancelled", ctx.userId);
    if (notifyCandidate) await this.notifyCandidate(ctx.orgId, id, "INTERVIEW_CANCELLED", true);
    return updated;
  }

  async setStatus(ctx: RequestContext, id: string, status: Extract<InterviewStatus, "COMPLETED" | "NO_SHOW">) {
    const existing = await this.find(ctx, id);
    const updated = await this.prisma.interview.update({
      where: { id },
      data: { status, completedAt: status === "COMPLETED" ? new Date() : null },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: `interview.${status.toLowerCase()}`, entityType: "interview", entityId: id,
      candidateId: existing.candidateId, jobId: existing.jobId, applicationId: existing.applicationId, ip: ctx.ip,
    });
    return updated;
  }

  /** Conflicts and declared-availability gaps for a proposed slot. */
  async checkSlot(orgId: string, range: { start: Date; end: Date }, userIds: string[], ignoreInterviewId?: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
    const [busy, weekly] = await Promise.all([this.busyBlocks(orgId, range, userIds), this.weeklySlots(orgId, userIds)]);
    return {
      conflicts: findConflicts({ range, userIds, busy, ignoreInterviewId }),
      gaps: availabilityGaps(range, userIds, weekly, org.timezone),
    };
  }

  async suggestSlots(ctx: RequestContext, input: { userIds: string[]; durationMinutes: number; fromDate?: Date; days?: number; limit?: number }) {
    await this.assertMembers(ctx.orgId, input.userIds);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } });
    const fromDate = input.fromDate ?? new Date();
    const days = Math.min(input.days ?? 14, 60);
    const toDate = new Date(fromDate.getTime() + days * 86_400_000);

    const [busy, weekly] = await Promise.all([
      this.busyBlocks(ctx.orgId, { start: fromDate, end: new Date(toDate.getTime() + 86_400_000) }, input.userIds),
      this.weeklySlots(ctx.orgId, input.userIds),
    ]);
    const slots = findFreeSlots({
      fromDate, toDate, durationMinutes: input.durationMinutes, userIds: input.userIds,
      weekly, busy, timeZone: org.timezone, limit: input.limit ?? 12, notBefore: new Date(Date.now() + 60 * 60 * 1000),
    });
    return {
      timezone: org.timezone,
      withoutDeclaredHours: input.userIds.filter((id) => !weekly.some((w) => w.userId === id)),
      slots: slots.map((s) => ({ start: s.start, end: s.end, label: formatInZone(s.start, org.timezone) })),
    };
  }

  private async busyBlocks(orgId: string, range: { start: Date; end: Date }, userIds: string[]): Promise<BusyBlock[]> {
    const rows = await this.prisma.interview.findMany({
      where: {
        organizationId: orgId,
        status: "SCHEDULED",
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
        participants: { some: { userId: { in: userIds } } },
      },
      select: { id: true, startsAt: true, endsAt: true, participants: { select: { userId: true } } },
    });
    return rows.flatMap((r) =>
      r.participants
        .filter((p) => userIds.includes(p.userId))
        .map((p) => ({ userId: p.userId, interviewId: r.id, start: r.startsAt, end: r.endsAt })),
    );
  }

  private async weeklySlots(orgId: string, userIds: string[]): Promise<WeeklySlot[]> {
    const rows = await this.prisma.interviewerAvailability.findMany({
      where: { organizationId: orgId, userId: { in: userIds } },
      select: { userId: true, weekday: true, startMinute: true, endMinute: true },
    });
    return rows;
  }

  private async describeConflicts(conflicts: { userId: string; interviewId: string; start: Date; end: Date }[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: conflicts.map((c) => c.userId) } }, select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return conflicts.map((c) => ({ ...c, interviewerName: nameById.get(c.userId) ?? "Unknown" }));
  }

  private async assertMembers(orgId: string, userIds: string[]) {
    const count = await this.prisma.membership.count({ where: { organizationId: orgId, userId: { in: userIds }, status: "ACTIVE" } });
    if (count !== userIds.length) throw new BadRequestException("Interviewers must be active members of this organization");
  }

  // ── Reading ──

  async list(ctx: RequestContext, q: { page: number; pageSize: number; from?: Date; to?: Date; jobId?: string; candidateId?: string; status?: InterviewStatus; mine?: boolean }) {
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));
    const where: Prisma.InterviewWhereInput = {
      organizationId: ctx.orgId,
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.candidateId ? { candidateId: q.candidateId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { startsAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      ...(q.mine ? { participants: { some: { userId: ctx.userId } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.interview.findMany({
        where,
        orderBy: { startsAt: "asc" },
        include: {
          candidate: { select: { id: true, fullName: true, email: true, headline: true } },
          job: { select: { id: true, title: true } },
          participants: { include: { user: { select: { id: true, name: true } } } },
          scorecards: { select: { id: true, interviewerId: true, submittedAt: true, overallRating: true, recommendation: true } },
        },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.interview.count({ where }),
    ]);
    return {
      items: items.map((i) => ({
        ...i,
        candidate: view(i.candidate, mask),
        feedbackSubmitted: i.scorecards.filter((s) => s.submittedAt).length,
        feedbackPending: i.scorecards.filter((s) => !s.submittedAt).length,
      })),
      total, page: q.page, pageSize: q.pageSize,
    };
  }

  async get(ctx: RequestContext, id: string) {
    const interview = await this.prisma.interview.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: {
        candidate: { select: { id: true, fullName: true, email: true, phone: true, headline: true, totalExperienceYears: true, skills: true } },
        job: { select: { id: true, title: true, requiredSkills: true } },
        application: { select: { id: true, stageId: true, status: true } },
        participants: { include: { user: { select: { id: true, name: true, email: true } } } },
        questions: { orderBy: { position: "asc" } },
        scorecards: { include: { interviewer: { select: { id: true, name: true } } } },
        template: { select: { id: true, name: true } },
      },
    });
    if (!interview) throw new NotFoundException("Interview not found");

    const isParticipant = interview.participants.some((p) => p.userId === ctx.userId);
    if (!can(ctx.role, Permission.InterviewSchedule) && !isParticipant && !can(ctx.role, Permission.AnalyticsView)) {
      throw new ForbiddenException("You are not on this interview panel");
    }

    const criteria = parseCriteria(interview.criteria);
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));
    const panel = summarisePanel(criteria, interview.scorecards);

    // Anti-anchoring: anyone still owing feedback on this interview sees only their own
    // scorecard until they submit it, whatever else their role lets them do. Observers and
    // non-panel reviewers (recruiters, hiring leads) see the panel's feedback as usual.
    const mine = interview.scorecards.find((s) => s.interviewerId === ctx.userId);
    const owesFeedback = !!mine && !mine.submittedAt;
    const canSeeOthers = !owesFeedback;

    return {
      ...interview,
      candidate: view(interview.candidate, mask),
      criteria,
      panel: canSeeOthers ? panel : { ...panel, perCriterion: [], recommendations: {}, averageRating: null },
      scorecards: interview.scorecards
        .filter((s) => canSeeOthers || s.interviewerId === ctx.userId)
        .map((s) => ({ ...s, ratings: s.ratings as Ratings })),
      myScorecardId: mine?.id ?? null,
      canSeePanelFeedback: canSeeOthers,
      isParticipant,
    };
  }

  async calendar(ctx: RequestContext, from: Date, to: Date, mine: boolean) {
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));
    const interviews = await this.prisma.interview.findMany({
      where: {
        organizationId: ctx.orgId,
        startsAt: { gte: from, lte: to },
        status: { in: ["SCHEDULED", "COMPLETED", "NO_SHOW"] },
        ...(mine ? { participants: { some: { userId: ctx.userId } } } : {}),
      },
      orderBy: { startsAt: "asc" },
      include: {
        candidate: { select: { id: true, fullName: true } },
        job: { select: { id: true, title: true } },
        participants: { include: { user: { select: { id: true, name: true } } } },
      },
    });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } });
    return {
      timezone: org.timezone,
      interviews: interviews.map((i) => ({
        id: i.id, title: i.title, kind: i.kind, mode: i.mode, status: i.status,
        startsAt: i.startsAt, endsAt: i.endsAt, timezone: i.timezone,
        localLabel: formatInZone(i.startsAt, org.timezone),
        candidate: view(i.candidate, mask),
        job: i.job,
        interviewers: i.participants.map((p) => ({ id: p.user.id, name: p.user.name, role: p.role, response: p.response })),
      })),
    };
  }

  /** The signed-in interviewer's own upcoming sessions and outstanding feedback. */
  async myInterviews(ctx: RequestContext) {
    const mask = shouldMask(ctx, await this.blindMode(ctx.orgId));
    const [upcoming, pendingFeedback] = await Promise.all([
      this.prisma.interview.findMany({
        where: { organizationId: ctx.orgId, status: "SCHEDULED", endsAt: { gte: new Date() }, participants: { some: { userId: ctx.userId } } },
        orderBy: { startsAt: "asc" },
        take: 20,
        include: { candidate: { select: { id: true, fullName: true, headline: true } }, job: { select: { id: true, title: true } } },
      }),
      this.prisma.scorecard.findMany({
        where: { organizationId: ctx.orgId, interviewerId: ctx.userId, submittedAt: null, interview: { status: { in: ["COMPLETED", "SCHEDULED"] }, endsAt: { lt: new Date() } } },
        include: { interview: { include: { candidate: { select: { id: true, fullName: true } }, job: { select: { id: true, title: true } } } } },
        orderBy: { interview: { startsAt: "desc" } },
        take: 20,
      }),
    ]);
    return {
      upcoming: upcoming.map((i) => ({ ...i, candidate: view(i.candidate, mask) })),
      pendingFeedback: pendingFeedback.map((s) => ({
        scorecardId: s.id,
        interviewId: s.interviewId,
        interviewTitle: s.interview.title,
        startedAt: s.interview.startsAt,
        job: s.interview.job,
        candidate: view(s.interview.candidate, mask),
      })),
    };
  }

  // ── Participants ──

  async setParticipants(ctx: RequestContext, id: string, interviewers: { userId: string; role?: ParticipantRole }[]) {
    const interview = await this.find(ctx, id);
    const userIds = [...new Set(interviewers.map((i) => i.userId))];
    if (!userIds.length) throw new BadRequestException("Assign at least one interviewer");
    await this.assertMembers(ctx.orgId, userIds);

    const existing = await this.prisma.interviewParticipant.findMany({ where: { interviewId: id } });
    const removed = existing.filter((e) => !userIds.includes(e.userId));
    for (const r of removed) {
      const card = await this.prisma.scorecard.findUnique({ where: { interviewId_interviewerId: { interviewId: id, interviewerId: r.userId } } });
      if (card?.submittedAt) throw new BadRequestException("An interviewer who has already given feedback cannot be removed");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.interviewParticipant.deleteMany({ where: { interviewId: id, userId: { in: removed.map((r) => r.userId) } } });
      await tx.scorecard.deleteMany({ where: { interviewId: id, interviewerId: { in: removed.map((r) => r.userId) }, submittedAt: null } });
      for (const i of interviewers) {
        await tx.interviewParticipant.upsert({
          where: { interviewId_userId: { interviewId: id, userId: i.userId } },
          create: { interviewId: id, userId: i.userId, role: i.role ?? "PANEL" },
          update: { role: i.role ?? "PANEL" },
        });
        if ((i.role ?? "PANEL") !== "OBSERVER") {
          await tx.scorecard.upsert({
            where: { interviewId_interviewerId: { interviewId: id, interviewerId: i.userId } },
            create: { organizationId: ctx.orgId, interviewId: id, interviewerId: i.userId, ratings: {} },
            update: {},
          });
        }
      }
    });

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "interview.panel_changed", entityType: "interview", entityId: id,
      candidateId: interview.candidateId, applicationId: interview.applicationId, data: { interviewers: userIds.length }, ip: ctx.ip,
    });
    await this.notifyInterviewers(id, "scheduled", ctx.userId);
    return this.get(ctx, id);
  }

  async respond(ctx: RequestContext, id: string, response: "ACCEPTED" | "DECLINED") {
    const participant = await this.prisma.interviewParticipant.findUnique({
      where: { interviewId_userId: { interviewId: id, userId: ctx.userId } },
      include: { interview: { select: { organizationId: true } } },
    });
    if (!participant || participant.interview.organizationId !== ctx.orgId) throw new NotFoundException("You are not on this interview panel");
    const updated = await this.prisma.interviewParticipant.update({
      where: { id: participant.id },
      data: { response, respondedAt: new Date() },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: `interview.${response.toLowerCase()}`, entityType: "interview", entityId: id, ip: ctx.ip,
    });
    return updated;
  }

  // ── Questions on an interview ──

  async setQuestions(ctx: RequestContext, id: string, items: { questionId?: string; text?: string; category?: QuestionCategory; difficulty?: QuestionDifficulty; guidance?: string; rationale?: string }[]) {
    await this.find(ctx, id);
    const bankIds = items.map((i) => i.questionId).filter((x): x is string => !!x);
    const bank = bankIds.length
      ? await this.prisma.interviewQuestion.findMany({ where: { id: { in: bankIds }, organizationId: ctx.orgId } })
      : [];
    const byId = new Map(bank.map((q) => [q.id, q]));

    const rows = items.map((item, position) => {
      const q = item.questionId ? byId.get(item.questionId) : undefined;
      const text = (item.text ?? q?.text ?? "").trim();
      if (!text) throw new BadRequestException("Every question needs text");
      return {
        interviewId: id,
        questionId: q?.id,
        text,
        category: item.category ?? q?.category ?? ("TECHNICAL" as QuestionCategory),
        difficulty: item.difficulty ?? q?.difficulty ?? ("MEDIUM" as QuestionDifficulty),
        guidance: item.guidance ?? q?.guidance ?? null,
        rationale: item.rationale ?? q?.rationale ?? null,
        position,
      };
    });

    await this.prisma.$transaction([
      this.prisma.interviewQuestionItem.deleteMany({ where: { interviewId: id } }),
      this.prisma.interviewQuestionItem.createMany({ data: rows }),
    ]);
    return this.prisma.interviewQuestionItem.findMany({ where: { interviewId: id }, orderBy: { position: "asc" } });
  }

  /**
   * AI question suggestions for one interview, grounded in the job and - when a parsed
   * resume exists - the candidate's own documented experience, with identity stripped.
   */
  async suggestQuestions(ctx: RequestContext, id: string, input: { count?: number; difficulty?: QuestionDifficulty | "MIXED"; categories?: QuestionCategory[]; useCandidate?: boolean }) {
    const interview = await this.prisma.interview.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: {
        job: true,
        candidate: { include: { resumes: { where: { status: "PARSED" }, orderBy: { version: "desc" }, take: 1 } } },
        application: { include: { matches: { orderBy: { createdAt: "desc" }, take: 1 } } },
      },
    });
    if (!interview) throw new NotFoundException("Interview not found");

    const count = Math.min(Math.max(input.count ?? 8, 1), 20);
    const resume = interview.candidate.resumes[0];
    const useCandidate = input.useCandidate !== false && !!resume;
    const missingSkills = interview.application.matches[0]?.missingSkills ?? [];

    const generateInput = {
      orgId: ctx.orgId,
      kind: interview.kind,
      count,
      difficulty: input.difficulty,
      categories: input.categories,
      focusSkills: missingSkills.slice(0, 4),
      job: {
        title: interview.job.title,
        description: interview.job.description,
        requiredSkills: interview.job.requiredSkills,
        preferredSkills: interview.job.preferredSkills,
        minExperienceYears: interview.job.minExperienceYears,
        educationRequirement: interview.job.educationRequirement,
      },
      candidate: useCandidate
        ? {
            headline: interview.candidate.headline,
            skills: interview.candidate.skills,
            totalExperienceYears: interview.candidate.totalExperienceYears,
            parsed: (resume?.parsed ?? null) as ParsedResume | null,
            resumeText: resume?.rawText ?? "",
            identifiers: [interview.candidate.fullName, interview.candidate.email, interview.candidate.phone],
          }
        : undefined,
    };

    let questions;
    let method: "AI" | "HEURISTIC";
    let model: string | null = null;
    if (this.ai.enabled) {
      try {
        const result = await generateQuestions(this.ai, generateInput);
        questions = result.questions;
        model = result.model;
        method = "AI";
      } catch (err) {
        if (err instanceof AiRequestError && !err.retryable) this.logger.warn(`AI question generation unavailable: ${err.message}`);
        questions = heuristicQuestions(generateInput);
        method = "HEURISTIC";
      }
    } else {
      questions = heuristicQuestions(generateInput);
      method = "HEURISTIC";
    }

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "ai.interview_questions_generated", entityType: "interview", entityId: id,
      candidateId: interview.candidateId, jobId: interview.jobId,
      data: { count: questions.length, method, model, promptVersion: QUESTION_PROMPT_VERSION, candidateSpecific: useCandidate }, ip: ctx.ip,
    });

    // Suggestions are returned for review, not written to the interview automatically.
    return { questions, method, model, promptVersion: QUESTION_PROMPT_VERSION, candidateSpecific: useCandidate };
  }

  // ── Scorecards ──

  async saveScorecard(
    ctx: RequestContext,
    interviewId: string,
    input: { ratings?: Ratings; recommendation?: Recommendation; strengths?: string; concerns?: string; notes?: string; submit?: boolean },
  ) {
    const interview = await this.find(ctx, interviewId);
    const card = await this.prisma.scorecard.findUnique({
      where: { interviewId_interviewerId: { interviewId, interviewerId: ctx.userId } },
    });
    if (!card) throw new ForbiddenException("You are not an interviewer on this interview");
    if (card.submittedAt) throw new BadRequestException("Your feedback has already been submitted and cannot be edited");

    const criteria = parseCriteria(interview.criteria);
    const ratings = input.ratings ?? (card.ratings as Ratings);
    const parsed = RatingsSchema.safeParse(ratings);
    if (!parsed.success) throw new BadRequestException("Ratings must be whole numbers from 1 to 5");

    const validIds = new Set(criteria.map((c) => c.id));
    const unknown = Object.keys(parsed.data).filter((k) => !validIds.has(k));
    if (unknown.length) throw new BadRequestException(`Unknown criteria: ${unknown.join(", ")}`);

    if (input.submit) {
      const unrated = criteria.filter((c) => parsed.data[c.id]?.rating == null);
      if (unrated.length) throw new BadRequestException(`Rate every criterion before submitting: ${unrated.map((c) => c.label).join(", ")}`);
      if (!input.recommendation && !card.recommendation) throw new BadRequestException("Give your recommendation before submitting");
    }

    const overall = weightedRating(criteria, parsed.data);
    const updated = await this.prisma.scorecard.update({
      where: { id: card.id },
      data: {
        ratings: parsed.data as unknown as Prisma.InputJsonValue,
        overallRating: overall,
        recommendation: input.recommendation ?? card.recommendation,
        strengths: input.strengths ?? card.strengths,
        concerns: input.concerns ?? card.concerns,
        notes: input.notes ?? card.notes,
        submittedAt: input.submit ? new Date() : null,
      },
    });

    if (input.submit) {
      await this.activity.log({
        orgId: ctx.orgId, actorId: ctx.userId, action: "scorecard.submitted", entityType: "scorecard", entityId: card.id,
        candidateId: interview.candidateId, jobId: interview.jobId, applicationId: interview.applicationId,
        data: { interviewId, overallRating: overall, recommendation: updated.recommendation }, ip: ctx.ip,
      });
      // The interview is complete once everyone has reported.
      const outstanding = await this.prisma.scorecard.count({ where: { interviewId, submittedAt: null } });
      if (!outstanding && interview.status === "SCHEDULED" && interview.endsAt < new Date()) {
        await this.prisma.interview.update({ where: { id: interviewId }, data: { status: "COMPLETED", completedAt: new Date() } });
      }
    }
    return updated;
  }

  /** AI recap of one interviewer's own written notes. Advisory, and never a rating. */
  async summariseScorecard(ctx: RequestContext, interviewId: string) {
    const card = await this.prisma.scorecard.findUnique({
      where: { interviewId_interviewerId: { interviewId, interviewerId: ctx.userId } },
      include: { interview: { select: { organizationId: true, criteria: true, kind: true } } },
    });
    if (!card || card.interview.organizationId !== ctx.orgId) throw new NotFoundException("Scorecard not found");
    if (!this.ai.enabled) throw new BadRequestException("AI is not configured");

    const text = [card.strengths, card.concerns, card.notes].filter(Boolean).join("\n\n");
    if (text.trim().length < 40) throw new BadRequestException("Write a little more detail first, then I can tidy it into a summary");

    const criteria = parseCriteria(card.interview.criteria);
    const ratings = card.ratings as Ratings;
    const ratingLines = criteria
      .filter((c) => ratings[c.id]?.rating)
      .map((c) => `${c.label}: ${ratings[c.id].rating}/5${ratings[c.id].comment ? ` - ${ratings[c.id].comment}` : ""}`)
      .join("\n");

    const { data, model } = await this.ai.structured({
      orgId: ctx.orgId,
      feature: "interview_summary",
      effort: "low",
      maxTokens: 4000,
      schema: z.object({ summary: z.string().describe("3-5 sentence neutral summary of this interviewer's feedback") }),
      system:
        "You tidy an interviewer's own notes into a short, neutral summary for the hiring record. " +
        "Use only what the notes say: add no judgement, no hiring recommendation, and no inference about the candidate beyond the notes. " +
        "Never mention or infer age, gender, race, religion, nationality, marital status, disability or appearance. " +
        "Write in plain English, third person, about the candidate's demonstrated skills and the interviewer's observations.",
      content: `<ratings>\n${ratingLines}\n</ratings>\n\n<interviewer_notes>\n${text}\n</interviewer_notes>`,
    });

    const updated = await this.prisma.scorecard.update({
      where: { id: card.id },
      data: { aiSummary: data.summary, aiModel: model },
    });
    return { summary: updated.aiSummary, model };
  }

  /** Every interview and scorecard for one application, with the panel aggregate. */
  async applicationFeedback(ctx: RequestContext, applicationId: string) {
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, organizationId: ctx.orgId } });
    if (!app) throw new NotFoundException("Application not found");
    const interviews = await this.prisma.interview.findMany({
      where: { applicationId, organizationId: ctx.orgId },
      orderBy: { round: "asc" },
      include: {
        scorecards: { include: { interviewer: { select: { id: true, name: true } } } },
        participants: { include: { user: { select: { id: true, name: true } } } },
      },
    });
    return interviews.map((i) => {
      const criteria = parseCriteria(i.criteria);
      return {
        id: i.id, title: i.title, kind: i.kind, round: i.round, status: i.status, startsAt: i.startsAt, timezone: i.timezone,
        criteria,
        panel: summarisePanel(criteria, i.scorecards),
        scorecards: i.scorecards.map((s) => ({
          id: s.id, interviewer: s.interviewer, ratings: s.ratings as Ratings, overallRating: s.overallRating,
          recommendation: s.recommendation, strengths: s.strengths, concerns: s.concerns, notes: s.notes,
          aiSummary: s.aiSummary, submittedAt: s.submittedAt,
        })),
      };
    });
  }

  // ── Notifications ──

  /**
   * Emails the candidate about an interview.
   *
   * `explicit` means a person asked for this while scheduling, rescheduling or cancelling,
   * so the matching template is used directly. Unattended sends (the reminder sweep) go
   * through the automation rules instead, which an organization must switch on first.
   */
  private async notifyCandidate(
    orgId: string,
    interviewId: string,
    trigger: "INTERVIEW_SCHEDULED" | "INTERVIEW_RESCHEDULED" | "INTERVIEW_CANCELLED" | "INTERVIEW_REMINDER",
    explicit = false,
  ) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: { participants: { include: { user: { select: { email: true, name: true } } } }, candidate: { select: { email: true } } },
    });
    if (!interview) return;

    const attachments = interview.candidate.email
      ? [
          {
            filename: "interview.ics",
            contentType: "text/calendar; charset=utf-8; method=" + (trigger === "INTERVIEW_CANCELLED" ? "CANCEL" : "REQUEST"),
            content: buildIcs({
              uid: `veyra-interview-${interview.id}@veyra`,
              sequence: trigger === "INTERVIEW_SCHEDULED" ? 0 : 1,
              title: interview.title,
              description: interview.agenda ?? undefined,
              location: interview.meetingLink ?? interview.location ?? undefined,
              start: interview.startsAt,
              end: interview.endsAt,
              organizerEmail: interview.participants[0]?.user.email ?? "no-reply@veyra.local",
              organizerName: interview.participants[0]?.user.name,
              attendeeEmails: [interview.candidate.email],
              cancelled: trigger === "INTERVIEW_CANCELLED",
            }),
          },
        ]
      : undefined;

    const shared = {
      orgId,
      applicationId: interview.applicationId,
      candidateId: interview.candidateId,
      interviewId: interview.id,
      attachments,
    };

    if (!explicit) {
      await this.comms.fire(trigger, shared);
      return;
    }

    const templateKey = TEMPLATE_FOR_TRIGGER[trigger];
    await this.comms
      .queueSend({ ...shared, templateKey, trigger, automated: false, sentById: null })
      .catch((e) => this.logger.warn(`Candidate notification failed: ${e instanceof Error ? e.message : e}`));
  }

  /** Interviewers always hear about their own sessions; this is internal, not candidate-facing. */
  private async notifyInterviewers(interviewId: string, event: "scheduled" | "rescheduled" | "cancelled", actorId: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        participants: { include: { user: { select: { id: true, email: true, name: true } } } },
        candidate: { select: { fullName: true } },
        job: { select: { title: true } },
        organization: { select: { name: true, blindModeDefault: true } },
      },
    });
    if (!interview) return;

    const who = interview.organization.blindModeDefault ? "a candidate" : interview.candidate.fullName;
    const when = formatInZone(interview.startsAt, interview.timezone);
    const subject =
      event === "cancelled"
        ? `Cancelled: ${interview.title}`
        : event === "rescheduled"
          ? `Moved: ${interview.title} - now ${when}`
          : `You are interviewing ${who}: ${interview.title}`;
    const where = interview.meetingLink ?? interview.location ?? "(to be confirmed)";
    const body =
      event === "cancelled"
        ? `The interview for ${interview.job.title} on ${when} has been cancelled.\n\nReason: ${interview.cancelReason ?? "not given"}`
        : `Role: ${interview.job.title}\nCandidate: ${who}\nWhen: ${when}\nWhere: ${where}\n\nOpen it in Veyra Talent to see the questions and leave your feedback afterwards.`;

    for (const p of interview.participants) {
      if (p.userId === actorId) continue; // the organizer already knows
      await this.comms
        .queueSend({ orgId: interview.organizationId, interviewId, subject, body, extraContext: { "candidate.email": p.user.email }, automated: true, sentById: null })
        .catch((e) => this.logger.warn(`Interviewer notification failed: ${e}`));
    }
  }

  private async queueReminder(interviewId: string) {
    const interview = await this.prisma.interview.findUnique({ where: { id: interviewId }, select: { organizationId: true, startsAt: true } });
    if (!interview) return;
    const rule = await this.prisma.emailAutomation.findFirst({
      where: { organizationId: interview.organizationId, trigger: "INTERVIEW_REMINDER", enabled: true },
    });
    if (!rule) return;
    const runAt = new Date(interview.startsAt.getTime() - rule.offsetHours * 3_600_000);
    if (runAt.getTime() <= Date.now()) return;
    await this.prisma.backgroundJob.upsert({
      where: { idempotencyKey: `interview-reminder:${interviewId}` },
      create: { type: INTERVIEW_REMINDER_JOB, payload: { interviewId }, organizationId: interview.organizationId, idempotencyKey: `interview-reminder:${interviewId}`, runAt },
      update: { runAt, status: "PENDING", attempts: 0 },
    });
  }

  /** Catches reminders for interviews scheduled before the automation was switched on. */
  private async scheduleDueReminders() {
    const rules = await this.prisma.emailAutomation.findMany({ where: { trigger: "INTERVIEW_REMINDER", enabled: true } });
    for (const rule of rules) {
      const horizon = new Date(Date.now() + rule.offsetHours * 3_600_000);
      const due = await this.prisma.interview.findMany({
        where: { organizationId: rule.organizationId, status: "SCHEDULED", startsAt: { gt: new Date(), lte: horizon } },
        select: { id: true },
        take: 200,
      });
      for (const i of due) {
        const already = await this.prisma.communication.count({ where: { interviewId: i.id, trigger: "INTERVIEW_REMINDER" } });
        if (already) continue;
        await this.prisma.backgroundJob.upsert({
          where: { idempotencyKey: `interview-reminder:${i.id}` },
          create: { type: INTERVIEW_REMINDER_JOB, payload: { interviewId: i.id }, organizationId: rule.organizationId, idempotencyKey: `interview-reminder:${i.id}` },
          update: {},
        });
      }
    }
  }

  private async sendReminder(interviewId: string) {
    const interview = await this.prisma.interview.findUnique({ where: { id: interviewId }, select: { organizationId: true, status: true } });
    if (!interview || interview.status !== "SCHEDULED") return;
    await this.notifyCandidate(interview.organizationId, interviewId, "INTERVIEW_REMINDER");
  }

  // ── internals ──

  private async find(ctx: RequestContext, id: string) {
    const interview = await this.prisma.interview.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!interview) throw new NotFoundException("Interview not found");
    return interview;
  }

  private async blindMode(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { blindModeDefault: true } });
    return org.blindModeDefault;
  }
}

const TEMPLATE_FOR_TRIGGER = {
  INTERVIEW_SCHEDULED: "INTERVIEW_INVITATION",
  INTERVIEW_RESCHEDULED: "INTERVIEW_RESCHEDULED",
  INTERVIEW_CANCELLED: "INTERVIEW_CANCELLED",
  INTERVIEW_REMINDER: "INTERVIEW_REMINDER",
} as const satisfies Record<string, TemplateKey>;

function kindLabel(kind: InterviewKind): string {
  return kind.charAt(0) + kind.slice(1).toLowerCase().replace(/_/g, " ");
}
