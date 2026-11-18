-- CreateEnum
CREATE TYPE "QuestionCategory" AS ENUM ('TECHNICAL', 'BEHAVIORAL', 'SITUATIONAL', 'HR', 'ROLE_SPECIFIC');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "InterviewKind" AS ENUM ('SCREENING', 'TECHNICAL', 'BEHAVIORAL', 'PANEL', 'HR', 'FINAL');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('VIDEO', 'PHONE', 'ONSITE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('LEAD', 'PANEL', 'OBSERVER');

-- CreateEnum
CREATE TYPE "ParticipantResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('STRONG_YES', 'YES', 'LEAN_YES', 'LEAN_NO', 'NO', 'STRONG_NO');

-- CreateEnum
CREATE TYPE "TemplateKey" AS ENUM ('APPLICATION_RECEIVED', 'SHORTLISTED', 'INTERVIEW_INVITATION', 'INTERVIEW_REMINDER', 'INTERVIEW_RESCHEDULED', 'INTERVIEW_CANCELLED', 'ASSESSMENT_INVITATION', 'SELECTED', 'REJECTED', 'OFFER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('APPLICATION_CREATED', 'STAGE_CHANGED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_RESCHEDULED', 'INTERVIEW_CANCELLED', 'INTERVIEW_REMINDER', 'APPLICATION_REJECTED', 'CANDIDATE_HIRED');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "skills" TEXT[],
    "guidance" TEXT,
    "rationale" TEXT,
    "jobId" TEXT,
    "source" "AnalysisMethod" NOT NULL DEFAULT 'HEURISTIC',
    "model" TEXT,
    "promptVersion" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "jobId" TEXT,
    "kind" "InterviewKind" NOT NULL DEFAULT 'TECHNICAL',
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "criteria" JSONB NOT NULL,
    "questionIds" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "kind" "InterviewKind" NOT NULL DEFAULT 'TECHNICAL',
    "round" INTEGER NOT NULL DEFAULT 1,
    "mode" "InterviewMode" NOT NULL DEFAULT 'VIDEO',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "location" TEXT,
    "meetingLink" TEXT,
    "agenda" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "rescheduledFromId" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "criteria" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewParticipant" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'PANEL',
    "response" "ParticipantResponse" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestionItem" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "questionId" TEXT,
    "text" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "guidance" TEXT,
    "rationale" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "InterviewQuestionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "ratings" JSONB NOT NULL,
    "overallRating" DOUBLE PRECISION,
    "recommendation" "Recommendation",
    "strengths" TEXT,
    "concerns" TEXT,
    "notes" TEXT,
    "aiSummary" TEXT,
    "aiModel" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewerAvailability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" "TemplateKey" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAutomation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" "AutomationTrigger" NOT NULL,
    "stageId" TEXT,
    "templateId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "offsetHours" INTEGER NOT NULL DEFAULT 24,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT,
    "applicationId" TEXT,
    "interviewId" TEXT,
    "templateId" TEXT,
    "templateKey" "TemplateKey",
    "trigger" "AutomationTrigger",
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "skipReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewQuestion_organizationId_category_idx" ON "InterviewQuestion"("organizationId", "category");

-- CreateIndex
CREATE INDEX "InterviewQuestion_organizationId_jobId_idx" ON "InterviewQuestion"("organizationId", "jobId");

-- CreateIndex
CREATE INDEX "InterviewTemplate_organizationId_jobId_idx" ON "InterviewTemplate"("organizationId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewTemplate_organizationId_name_key" ON "InterviewTemplate"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_rescheduledFromId_key" ON "Interview"("rescheduledFromId");

-- CreateIndex
CREATE INDEX "Interview_organizationId_startsAt_idx" ON "Interview"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "Interview_applicationId_round_idx" ON "Interview"("applicationId", "round");

-- CreateIndex
CREATE INDEX "Interview_candidateId_idx" ON "Interview"("candidateId");

-- CreateIndex
CREATE INDEX "InterviewParticipant_userId_idx" ON "InterviewParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewParticipant_interviewId_userId_key" ON "InterviewParticipant"("interviewId", "userId");

-- CreateIndex
CREATE INDEX "InterviewQuestionItem_interviewId_position_idx" ON "InterviewQuestionItem"("interviewId", "position");

-- CreateIndex
CREATE INDEX "Scorecard_organizationId_submittedAt_idx" ON "Scorecard"("organizationId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_interviewId_interviewerId_key" ON "Scorecard"("interviewId", "interviewerId");

-- CreateIndex
CREATE INDEX "InterviewerAvailability_organizationId_userId_idx" ON "InterviewerAvailability"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "EmailTemplate_organizationId_key_idx" ON "EmailTemplate"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAutomation_organizationId_trigger_stageId_key" ON "EmailAutomation"("organizationId", "trigger", "stageId");

-- CreateIndex
CREATE INDEX "Communication_organizationId_createdAt_idx" ON "Communication"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Communication_candidateId_createdAt_idx" ON "Communication"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "Communication_applicationId_idx" ON "Communication"("applicationId");

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewTemplate" ADD CONSTRAINT "InterviewTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewTemplate" ADD CONSTRAINT "InterviewTemplate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InterviewTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestionItem" ADD CONSTRAINT "InterviewQuestionItem_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestionItem" ADD CONSTRAINT "InterviewQuestionItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "InterviewQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewerAvailability" ADD CONSTRAINT "InterviewerAvailability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewerAvailability" ADD CONSTRAINT "InterviewerAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomation" ADD CONSTRAINT "EmailAutomation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomation" ADD CONSTRAINT "EmailAutomation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomation" ADD CONSTRAINT "EmailAutomation_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
