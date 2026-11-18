-- DropForeignKey
ALTER TABLE "AssessmentAnswer" DROP CONSTRAINT "AssessmentAnswer_questionId_fkey";

-- AlterTable
ALTER TABLE "AssessmentAnswer" ALTER COLUMN "questionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AssessmentAnswer" ADD CONSTRAINT "AssessmentAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
