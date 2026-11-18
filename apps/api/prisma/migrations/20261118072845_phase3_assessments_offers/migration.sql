-- CreateEnum
CREATE TYPE "AssessmentQuestionType" AS ENUM ('MCQ_SINGLE', 'MCQ_MULTI', 'SHORT_ANSWER', 'LONG_ANSWER', 'NUMERIC');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('TECHNICAL', 'APTITUDE', 'LOGICAL', 'DOMAIN', 'LANGUAGE', 'MIXED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('INVITED', 'IN_PROGRESS', 'SUBMITTED', 'EVALUATED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OnboardingCategory" AS ENUM ('DOCUMENT', 'IT_SETUP', 'HR_ADMIN', 'TRAINING', 'INTRODUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED');

-- AlterTable
ALTER TABLE "Communication" ADD COLUMN     "assessmentId" TEXT,
ADD COLUMN     "offerId" TEXT;

-- CreateTable
CREATE TABLE "AssessmentQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "AssessmentQuestionType" NOT NULL,
    "kind" "AssessmentKind" NOT NULL DEFAULT 'TECHNICAL',
    "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "options" TEXT[],
    "correctAnswers" TEXT[],
    "tolerance" DOUBLE PRECISION,
    "points" INTEGER NOT NULL DEFAULT 1,
    "explanation" TEXT,
    "skills" TEXT[],
    "jobId" TEXT,
    "source" "AnalysisMethod" NOT NULL DEFAULT 'HEURISTIC',
    "model" TEXT,
    "promptVersion" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "AssessmentKind" NOT NULL DEFAULT 'TECHNICAL',
    "jobId" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 45,
    "passingPercent" INTEGER NOT NULL DEFAULT 60,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "showResultToCandidate" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "points" INTEGER,

    CONSTRAINT "AssessmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "passingPercent" INTEGER NOT NULL,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "showResultToCandidate" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'INVITED',
    "accessTokenHash" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "autoScore" INTEGER,
    "manualScore" INTEGER,
    "totalPoints" INTEGER NOT NULL,
    "finalScore" INTEGER,
    "percent" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "evaluatedById" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "evaluatorNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAnswer" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" "AssessmentQuestionType" NOT NULL,
    "options" TEXT[],
    "position" INTEGER NOT NULL,
    "maxPoints" INTEGER NOT NULL,
    "response" TEXT[],
    "autoCorrect" BOOLEAN,
    "pointsAwarded" INTEGER,
    "evaluatorComment" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "AssessmentAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "templateId" TEXT,
    "jobTitle" TEXT NOT NULL,
    "salaryAmount" INTEGER NOT NULL,
    "salaryCurrency" TEXT NOT NULL,
    "salaryPeriod" TEXT NOT NULL DEFAULT 'MONTHLY',
    "benefits" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "respondBy" TIMESTAMP(3) NOT NULL,
    "probationMonths" INTEGER,
    "noticePeriodDays" INTEGER,
    "reportingTo" TEXT,
    "workLocation" TEXT,
    "letterBody" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "accessTokenHash" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "withdrawReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferApproval" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "OnboardingCategory" NOT NULL DEFAULT 'OTHER',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "position" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentQuestion_organizationId_kind_idx" ON "AssessmentQuestion"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "AssessmentQuestion_organizationId_jobId_idx" ON "AssessmentQuestion"("organizationId", "jobId");

-- CreateIndex
CREATE INDEX "AssessmentTemplate_organizationId_jobId_idx" ON "AssessmentTemplate"("organizationId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTemplate_organizationId_name_key" ON "AssessmentTemplate"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AssessmentItem_templateId_position_idx" ON "AssessmentItem"("templateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentItem_templateId_questionId_key" ON "AssessmentItem"("templateId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_accessTokenHash_key" ON "Assessment"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Assessment_organizationId_status_idx" ON "Assessment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Assessment_applicationId_idx" ON "Assessment"("applicationId");

-- CreateIndex
CREATE INDEX "Assessment_candidateId_idx" ON "Assessment"("candidateId");

-- CreateIndex
CREATE INDEX "AssessmentAnswer_assessmentId_position_idx" ON "AssessmentAnswer"("assessmentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAnswer_assessmentId_questionId_key" ON "AssessmentAnswer"("assessmentId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferTemplate_organizationId_name_key" ON "OfferTemplate"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_accessTokenHash_key" ON "Offer"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Offer_organizationId_status_idx" ON "Offer"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Offer_applicationId_idx" ON "Offer"("applicationId");

-- CreateIndex
CREATE INDEX "OfferApproval_approverId_decision_idx" ON "OfferApproval"("approverId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "OfferApproval_offerId_approverId_key" ON "OfferApproval"("offerId", "approverId");

-- CreateIndex
CREATE INDEX "OnboardingTask_organizationId_status_idx" ON "OnboardingTask"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OnboardingTask_offerId_position_idx" ON "OnboardingTask"("offerId", "position");

-- CreateIndex
CREATE INDEX "OnboardingTask_assigneeId_status_idx" ON "OnboardingTask"("assigneeId", "status");

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentItem" ADD CONSTRAINT "AssessmentItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentItem" ADD CONSTRAINT "AssessmentItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferTemplate" ADD CONSTRAINT "OfferTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OfferTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApproval" ADD CONSTRAINT "OfferApproval_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApproval" ADD CONSTRAINT "OfferApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
