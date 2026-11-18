-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommunicationStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "CommunicationStatus" ADD VALUE 'READ';

-- AlterTable
ALTER TABLE "Communication" ADD COLUMN     "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "toPhone" TEXT,
ADD COLUMN     "whatsappTemplateId" TEXT,
ALTER COLUMN "toEmail" DROP NOT NULL;

-- AlterTable
ALTER TABLE "EmailAutomation" ADD COLUMN     "whatsappTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappNumber" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" "TemplateKey" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "providerTemplateName" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_organizationId_key_idx" ON "WhatsAppTemplate"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Communication_providerMessageId_idx" ON "Communication"("providerMessageId");

-- AddForeignKey
ALTER TABLE "EmailAutomation" ADD CONSTRAINT "EmailAutomation_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
