-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "publicApply" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "careersEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "careersIntro" TEXT;
