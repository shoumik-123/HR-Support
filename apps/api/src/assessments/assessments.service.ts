import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ActivityService } from "../common/activity.service";
import { RequestContext } from "../common/context";
import { newToken, sha256 } from "../common/crypto";
import { config } from "../config";
import { paginate } from "../common/validation";
import { CommunicationsService } from "../communications/communications.service";
import { Prisma } from "../generated/prisma/client";
import { AssessmentKind, AssessmentQuestionType, AssessmentStatus, QuestionDifficulty } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { isAutoMarked, isExpired, markAnswer, remainingSeconds, scoreAssessment, shuffleFor } from "./scoring";

/** The fields of a bank question that assigning a paper needs. */
interface BankQuestion {
  id: string;
  text: string;
  type: AssessmentQuestionType;
  options: string[];
  points: number;
}

export const EXPIRE_ASSESSMENTS_JOB = "assessment.expire";

export interface AssignInput {
  applicationId: string;
  templateId?: string;
  title?: string;
  kind?: AssessmentKind;
  questionIds?: string[];
  durationMinutes?: number;
  passingPercent?: number;
  /** Days the invitation link stays usable. */
  validForDays?: number;
  shuffleQuestions?: boolean;
  showResultToCandidate?: boolean;
  notifyCandidate?: boolean;
}

@Injectable()
export class AssessmentsService implements OnModuleInit {
  private readonly logger = new Logger("Assessments");

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly activity: ActivityService,
    private readonly comms: CommunicationsService,
  ) {}

  onModuleInit() {
    this.queue.register(EXPIRE_ASSESSMENTS_JOB, async () => {
      await this.expireOverdue();
    });
    // Sweep for sittings whose time is up, so a abandoned test doesn't sit open forever.
    const sweep = () => this.expireOverdue().catch((e) => this.logger.warn(`Expiry sweep failed: ${e}`));
    sweep();
    setInterval(sweep, 5 * 60 * 1000).unref();
  }

  // ── Assigning ──

  /**
   * Creates one sitting for one candidate. The paper's questions are copied onto the
   * sitting, so later edits to the bank or the template never change a test already set.
   */
  async assign(ctx: RequestContext, input: AssignInput) {
    const app = await this.prisma.application.findFirst({
      where: { id: input.applicationId, organizationId: ctx.orgId },
      include: { job: { select: { id: true, title: true } }, candidate: { select: { id: true, fullName: true, email: true } } },
    });
    if (!app) throw new NotFoundException("Application not found");
    if (app.status === "REJECTED") throw new BadRequestException("This application has been rejected");

    const template = input.templateId
      ? await this.prisma.assessmentTemplate.findFirst({
          where: { id: input.templateId, organizationId: ctx.orgId },
          include: { items: { orderBy: { position: "asc" }, include: { question: true } } },
        })
      : null;
    if (input.templateId && !template) throw new BadRequestException("Unknown assessment template");

    // Questions come from the template, or from an explicit list.
    let questions: { question: BankQuestion; points: number }[];
    if (template) {
      questions = template.items.map((i) => ({ question: i.question, points: i.points ?? i.question.points }));
    } else {
      const ids = input.questionIds ?? [];
      if (!ids.length) throw new BadRequestException("Choose a template, or pick the questions for this assessment");
      const found = await this.prisma.assessmentQuestion.findMany({
        where: { id: { in: ids }, organizationId: ctx.orgId, archivedAt: null },
      });
      if (found.length !== new Set(ids).size) throw new BadRequestException("One or more questions no longer exist");
      const byId = new Map(found.map((q) => [q.id, q]));
      questions = ids.map((id) => ({ question: byId.get(id)!, points: byId.get(id)!.points }));
    }
    if (!questions.length) throw new BadRequestException("An assessment needs at least one question");

    const existing = await this.prisma.assessment.findFirst({
      where: { applicationId: app.id, status: { in: ["INVITED", "IN_PROGRESS"] } },
    });
    if (existing) throw new BadRequestException("This candidate already has an assessment open; cancel it before sending another");

    const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
    const { token, hash } = newToken();
    const validForDays = Math.min(Math.max(input.validForDays ?? 7, 1), 30);

    const assessment = await this.prisma.assessment.create({
      data: {
        organizationId: ctx.orgId,
        applicationId: app.id,
        candidateId: app.candidateId,
        jobId: app.jobId,
        templateId: template?.id,
        title: input.title?.trim() || template?.name || `${app.job.title} assessment`,
        kind: input.kind ?? template?.kind ?? "TECHNICAL",
        durationMinutes: input.durationMinutes ?? template?.durationMinutes ?? 45,
        passingPercent: input.passingPercent ?? template?.passingPercent ?? 60,
        shuffleQuestions: input.shuffleQuestions ?? template?.shuffleQuestions ?? true,
        showResultToCandidate: input.showResultToCandidate ?? template?.showResultToCandidate ?? false,
        accessTokenHash: hash,
        expiresAt: new Date(Date.now() + validForDays * 86_400_000),
        totalPoints,
        createdById: ctx.userId,
        answers: {
          create: questions.map((q, position) => ({
            questionId: q.question.id,
            questionText: q.question.text,
            questionType: q.question.type,
            options: q.question.options,
            position,
            maxPoints: q.points,
            response: [],
          })),
        },
      },
    });

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "assessment.assigned", entityType: "assessment", entityId: assessment.id,
      candidateId: app.candidateId, jobId: app.jobId, applicationId: app.id,
      data: { title: assessment.title, questions: questions.length, totalPoints, validForDays }, ip: ctx.ip,
    });

    const link = `${config.webOrigin}/assessment/${token}`;
    if (input.notifyCandidate !== false) {
      await this.comms
        .queueSend({
          orgId: ctx.orgId,
          templateKey: "ASSESSMENT_INVITATION",
          applicationId: app.id,
          candidateId: app.candidateId,
          assessmentId: assessment.id,
          extraContext: {
            "assessment.title": assessment.title,
            "assessment.duration": String(assessment.durationMinutes),
            "assessment.link": link,
            "assessment.deadline": assessment.expiresAt.toDateString(),
          },
          sentById: ctx.userId,
        })
        .catch((e) => this.logger.warn(`Assessment invitation failed: ${e instanceof Error ? e.message : e}`));
    }

    // The plain token is returned once so the recruiter can share the link manually
    // if email is not configured. It is never stored or shown again.
    return { ...(await this.get(ctx, assessment.id)), inviteLink: link };
  }

  async cancel(ctx: RequestContext, id: string, reason?: string) {
    const assessment = await this.find(ctx, id);
    if (assessment.status === "SUBMITTED" || assessment.status === "EVALUATED") {
      throw new BadRequestException("This assessment has already been submitted");
    }
    const updated = await this.prisma.assessment.update({
      where: { id },
      // Clearing the hash makes the candidate's link stop working immediately.
      data: { status: "CANCELLED", accessTokenHash: `cancelled:${id}` },
    });
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "assessment.cancelled", entityType: "assessment", entityId: id,
      candidateId: assessment.candidateId, applicationId: assessment.applicationId, data: { reason: reason ?? null }, ip: ctx.ip,
    });
    return updated;
  }

  /** Issues a fresh link, e.g. when the candidate says the old one expired. */
  async resend(ctx: RequestContext, id: string, validForDays = 7) {
    const assessment = await this.find(ctx, id);
    if (assessment.status === "SUBMITTED" || assessment.status === "EVALUATED") {
      throw new BadRequestException("This assessment has already been submitted");
    }
    const { token, hash } = newToken();
    await this.prisma.assessment.update({
      where: { id },
      data: {
        accessTokenHash: hash,
        expiresAt: new Date(Date.now() + Math.min(Math.max(validForDays, 1), 30) * 86_400_000),
        status: assessment.startedAt ? assessment.status : "INVITED",
      },
    });
    const link = `${config.webOrigin}/assessment/${token}`;
    await this.comms
      .queueSend({
        orgId: ctx.orgId, templateKey: "ASSESSMENT_INVITATION", applicationId: assessment.applicationId,
        candidateId: assessment.candidateId, assessmentId: id,
        extraContext: { "assessment.title": assessment.title, "assessment.duration": String(assessment.durationMinutes), "assessment.link": link },
        sentById: ctx.userId,
      })
      .catch(() => undefined);
    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "assessment.resent", entityType: "assessment", entityId: id,
      candidateId: assessment.candidateId, ip: ctx.ip,
    });
    return { inviteLink: link };
  }

  // ── Candidate-facing (token, no account) ──

  /**
   * Resolves a candidate's link. Returns only what the candidate needs: never the
   * correct answers, never other candidates' data, never internal scoring.
   */
  async openForCandidate(token: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { accessTokenHash: sha256(token) },
      include: {
        answers: { orderBy: { position: "asc" } },
        organization: { select: { name: true } },
        job: { select: { title: true } },
        candidate: { select: { fullName: true } },
      },
    });
    if (!assessment) throw new NotFoundException("This assessment link is not valid");
    if (assessment.status === "CANCELLED") throw new ForbiddenException("This assessment has been withdrawn");

    if (assessment.status === "SUBMITTED" || assessment.status === "EVALUATED") {
      return {
        state: "submitted" as const,
        title: assessment.title,
        organizationName: assessment.organization.name,
        jobTitle: assessment.job.title,
        candidateName: assessment.candidate.fullName,
        submittedAt: assessment.submittedAt,
        // Only shown when the organization chose to, and only once marking is complete.
        result:
          assessment.showResultToCandidate && assessment.percent != null
            ? { percent: assessment.percent, passed: assessment.passed }
            : null,
      };
    }

    if (isExpired(assessment)) {
      if (assessment.status !== "EXPIRED") {
        await this.prisma.assessment.update({ where: { id: assessment.id }, data: { status: "EXPIRED" } });
      }
      return { state: "expired" as const, title: assessment.title, organizationName: assessment.organization.name, jobTitle: assessment.job.title };
    }

    if (assessment.status === "INVITED") {
      return {
        state: "not_started" as const,
        title: assessment.title,
        organizationName: assessment.organization.name,
        jobTitle: assessment.job.title,
        candidateName: assessment.candidate.fullName,
        durationMinutes: assessment.durationMinutes,
        questionCount: assessment.answers.length,
        totalPoints: assessment.totalPoints,
        expiresAt: assessment.expiresAt,
      };
    }

    return this.candidateView(assessment);
  }

  /** Starts the clock. Idempotent: reloading does not restart the timer. */
  async startForCandidate(token: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { accessTokenHash: sha256(token) },
      include: { answers: { orderBy: { position: "asc" } }, organization: { select: { name: true } }, job: { select: { title: true } }, candidate: { select: { fullName: true } } },
    });
    if (!assessment) throw new NotFoundException("This assessment link is not valid");
    if (assessment.status === "SUBMITTED" || assessment.status === "EVALUATED") throw new BadRequestException("You have already submitted this assessment");
    if (assessment.status === "CANCELLED") throw new ForbiddenException("This assessment has been withdrawn");
    if (isExpired(assessment)) throw new ForbiddenException("This assessment has expired");

    if (assessment.status === "IN_PROGRESS") return this.candidateView(assessment);

    const startedAt = new Date();
    const dueAt = new Date(startedAt.getTime() + assessment.durationMinutes * 60_000);
    const started = await this.prisma.assessment.update({
      where: { id: assessment.id },
      data: { status: "IN_PROGRESS", startedAt, dueAt },
      include: { answers: { orderBy: { position: "asc" } }, organization: { select: { name: true } }, job: { select: { title: true } }, candidate: { select: { fullName: true } } },
    });
    await this.activity.log({
      orgId: assessment.organizationId, actorId: null, action: "assessment.started", entityType: "assessment", entityId: assessment.id,
      candidateId: assessment.candidateId, applicationId: assessment.applicationId,
    });
    return this.candidateView(started);
  }

  /** Saves answers as the candidate works, so a lost connection does not lose the paper. */
  async saveAnswers(token: string, answers: { answerId: string; response: string[] }[]) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { accessTokenHash: sha256(token) },
      include: { answers: true },
    });
    if (!assessment) throw new NotFoundException("This assessment link is not valid");
    if (assessment.status !== "IN_PROGRESS") throw new BadRequestException("This assessment is not open for answers");
    if (isExpired(assessment)) throw new ForbiddenException("Your time for this assessment is up");

    // Keyed by the candidate's own answer rows, so an id from another paper is ignored.
    const mine = new Set(assessment.answers.map((a) => a.id));
    const updates = answers
      .filter((a) => mine.has(a.answerId))
      .map((a) =>
        this.prisma.assessmentAnswer.update({
          where: { id: a.answerId },
          // Trimmed and capped: a written answer is not a place to post a megabyte.
          data: { response: a.response.map((r) => r.slice(0, 10_000)).slice(0, 50), answeredAt: new Date() },
        }),
      );
    if (updates.length) await this.prisma.$transaction(updates);
    return { saved: updates.length, remainingSeconds: remainingSeconds(assessment.dueAt) };
  }

  /**
   * Final submission. Closed questions are marked immediately; written answers wait
   * for a human, and the sitting is only EVALUATED once those are done.
   */
  async submitForCandidate(token: string, answers?: { answerId: string; response: string[] }[]) {
    if (answers?.length) await this.saveAnswers(token, answers).catch(() => undefined);

    const assessment = await this.prisma.assessment.findUnique({
      where: { accessTokenHash: sha256(token) },
      include: { answers: { include: { question: true } } },
    });
    if (!assessment) throw new NotFoundException("This assessment link is not valid");
    if (assessment.status === "SUBMITTED" || assessment.status === "EVALUATED") throw new BadRequestException("You have already submitted this assessment");
    if (assessment.status !== "IN_PROGRESS") throw new BadRequestException("This assessment has not been started");

    const marked = await this.markAndStore(assessment.id, assessment.answers, assessment.passingPercent, "SUBMITTED");
    await this.activity.log({
      orgId: assessment.organizationId, actorId: null, action: "assessment.submitted", entityType: "assessment", entityId: assessment.id,
      candidateId: assessment.candidateId, applicationId: assessment.applicationId,
      data: { autoScore: marked.autoScore, totalPoints: marked.totalPoints, awaitingManual: marked.awaitingManual },
    });
    return {
      state: "submitted" as const,
      submittedAt: new Date(),
      awaitingManualMarking: marked.awaitingManual > 0,
      result: assessment.showResultToCandidate && marked.percent != null ? { percent: marked.percent, passed: marked.passed } : null,
    };
  }

  /** Marks the closed questions, totals the paper and stores the outcome. */
  private async markAndStore(
    assessmentId: string,
    answers: { id: string; questionType: AssessmentQuestionType; maxPoints: number; response: string[]; pointsAwarded: number | null; question: { correctAnswers: string[]; tolerance: number | null } | null }[],
    passingPercent: number,
    status: AssessmentStatus,
  ) {
    const results = answers.map((a) => {
      // Written questions, and any whose bank entry has since been deleted (so the answer
      // key is gone), are left for a person rather than marked on a guess.
      if (!isAutoMarked(a.questionType) || !a.question) {
        return { id: a.id, type: a.questionType, maxPoints: a.maxPoints, pointsAwarded: a.pointsAwarded, correct: null, markable: false };
      }
      const mark = markAnswer(
        { type: a.questionType, correctAnswers: a.question.correctAnswers, tolerance: a.question.tolerance, maxPoints: a.maxPoints },
        a.response,
      );
      return { id: a.id, type: a.questionType, maxPoints: a.maxPoints, pointsAwarded: mark.points, correct: mark.correct, markable: true };
    });

    const score = scoreAssessment(results.map((r) => ({ type: r.type, maxPoints: r.maxPoints, pointsAwarded: r.pointsAwarded })), passingPercent);

    await this.prisma.$transaction([
      ...results
        .filter((r) => r.markable)
        .map((r) => this.prisma.assessmentAnswer.update({ where: { id: r.id }, data: { autoCorrect: r.correct, pointsAwarded: r.pointsAwarded } })),
      this.prisma.assessment.update({
        where: { id: assessmentId },
        data: {
          status: score.complete ? "EVALUATED" : status,
          submittedAt: status === "SUBMITTED" ? new Date() : undefined,
          autoScore: score.autoScore,
          manualScore: score.manualScore,
          finalScore: score.complete ? score.finalScore : null,
          percent: score.percent,
          passed: score.passed,
          evaluatedAt: score.complete ? new Date() : null,
        },
      }),
    ]);
    return score;
  }

  private candidateView(assessment: {
    id: string;
    title: string;
    durationMinutes: number;
    dueAt: Date | null;
    shuffleQuestions: boolean;
    totalPoints: number;
    answers: { id: string; questionText: string; questionType: AssessmentQuestionType; options: string[]; position: number; maxPoints: number; response: string[] }[];
    organization: { name: string };
    job: { title: string };
    candidate: { fullName: string };
  }) {
    const ordered = assessment.shuffleQuestions ? shuffleFor(assessment.answers, assessment.id) : [...assessment.answers].sort((a, b) => a.position - b.position);
    return {
      state: "in_progress" as const,
      title: assessment.title,
      organizationName: assessment.organization.name,
      jobTitle: assessment.job.title,
      candidateName: assessment.candidate.fullName,
      durationMinutes: assessment.durationMinutes,
      totalPoints: assessment.totalPoints,
      remainingSeconds: remainingSeconds(assessment.dueAt),
      // Note what is absent: correctAnswers, points awarded, explanations.
      questions: ordered.map((a) => ({
        answerId: a.id,
        text: a.questionText,
        type: a.questionType,
        options: a.options,
        maxPoints: a.maxPoints,
        response: a.response,
      })),
    };
  }

  // ── Recruiter-facing ──

  async list(ctx: RequestContext, q: { page: number; pageSize: number; status?: AssessmentStatus; jobId?: string; candidateId?: string; awaitingMarking?: boolean }) {
    const where: Prisma.AssessmentWhereInput = {
      organizationId: ctx.orgId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.jobId ? { jobId: q.jobId } : {}),
      ...(q.candidateId ? { candidateId: q.candidateId } : {}),
      ...(q.awaitingMarking ? { status: "SUBMITTED" } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.assessment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          candidate: { select: { id: true, fullName: true, email: true } },
          job: { select: { id: true, title: true } },
          _count: { select: { answers: true } },
        },
        ...paginate(q.page, q.pageSize),
      }),
      this.prisma.assessment.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(ctx: RequestContext, id: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: {
        candidate: { select: { id: true, fullName: true, email: true } },
        job: { select: { id: true, title: true } },
        template: { select: { id: true, name: true } },
        answers: {
          orderBy: { position: "asc" },
          include: { question: { select: { correctAnswers: true, explanation: true, tolerance: true, skills: true } } },
        },
      },
    });
    if (!assessment) throw new NotFoundException("Assessment not found");

    const score = scoreAssessment(
      assessment.answers.map((a) => ({ type: a.questionType, maxPoints: a.maxPoints, pointsAwarded: a.pointsAwarded })),
      assessment.passingPercent,
    );
    return { ...assessment, score, remainingSeconds: remainingSeconds(assessment.dueAt) };
  }

  /** A human marks the written answers. */
  async mark(ctx: RequestContext, id: string, marks: { answerId: string; points: number; comment?: string }[], note?: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, organizationId: ctx.orgId },
      include: { answers: { include: { question: { select: { correctAnswers: true, tolerance: true } } } } },
    });
    if (!assessment) throw new NotFoundException("Assessment not found");
    if (assessment.status === "INVITED" || assessment.status === "IN_PROGRESS") {
      throw new BadRequestException("This assessment has not been submitted yet");
    }

    const byId = new Map(assessment.answers.map((a) => [a.id, a]));
    for (const m of marks) {
      const answer = byId.get(m.answerId);
      if (!answer) throw new BadRequestException("Unknown answer");
      // Closed questions mark themselves, so a human cannot override them - unless the
      // bank question is gone and nothing could mark it.
      if (isAutoMarked(answer.questionType) && answer.question) {
        throw new BadRequestException("Closed questions are marked automatically and cannot be overridden");
      }
      if (m.points < 0 || m.points > answer.maxPoints) {
        throw new BadRequestException(`Marks for this question must be between 0 and ${answer.maxPoints}`);
      }
    }

    await this.prisma.$transaction(
      marks.map((m) =>
        this.prisma.assessmentAnswer.update({
          where: { id: m.answerId },
          data: { pointsAwarded: m.points, evaluatorComment: m.comment },
        }),
      ),
    );

    const fresh = await this.prisma.assessmentAnswer.findMany({
      where: { assessmentId: id },
      include: { question: { select: { correctAnswers: true, tolerance: true } } },
    });
    const score = scoreAssessment(fresh.map((a) => ({ type: a.questionType, maxPoints: a.maxPoints, pointsAwarded: a.pointsAwarded })), assessment.passingPercent);

    const updated = await this.prisma.assessment.update({
      where: { id },
      data: {
        manualScore: score.manualScore,
        autoScore: score.autoScore,
        finalScore: score.complete ? score.finalScore : null,
        percent: score.percent,
        passed: score.passed,
        status: score.complete ? "EVALUATED" : "SUBMITTED",
        evaluatedById: ctx.userId,
        evaluatedAt: score.complete ? new Date() : null,
        evaluatorNote: note ?? assessment.evaluatorNote,
      },
    });

    await this.activity.log({
      orgId: ctx.orgId, actorId: ctx.userId, action: "assessment.marked", entityType: "assessment", entityId: id,
      candidateId: assessment.candidateId, applicationId: assessment.applicationId,
      data: { marked: marks.length, percent: score.percent, passed: score.passed, complete: score.complete }, ip: ctx.ip,
    });
    return { ...updated, score };
  }

  async expireOverdue() {
    const now = new Date();
    const [invited, started] = await Promise.all([
      this.prisma.assessment.updateMany({ where: { status: "INVITED", expiresAt: { lt: now } }, data: { status: "EXPIRED" } }),
      this.prisma.assessment.updateMany({ where: { status: "IN_PROGRESS", dueAt: { lt: now } }, data: { status: "EXPIRED" } }),
    ]);
    const count = invited.count + started.count;
    if (count) this.logger.log(`Expired ${count} assessment(s)`);
    return count;
  }

  private async find(ctx: RequestContext, id: string) {
    const a = await this.prisma.assessment.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!a) throw new NotFoundException("Assessment not found");
    return a;
  }
}

export type { AssessmentKind, AssessmentQuestionType, QuestionDifficulty };
