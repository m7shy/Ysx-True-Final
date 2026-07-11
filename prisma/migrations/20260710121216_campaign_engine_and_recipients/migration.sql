-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'IN_SEQUENCE', 'COMPLETED', 'REPLIED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "counterDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dailyLimit" INTEGER,
ADD COLUMN     "linkTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sendDays" INTEGER,
ADD COLUMN     "sendWindowEnd" INTEGER,
ADD COLUMN     "sendWindowStart" INTEGER,
ADD COLUMN     "sentToday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "CookieFile" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "FollowupJob" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ScraperSchedule" ADD COLUMN     "runStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_nextSendAt_idx" ON "CampaignRecipient"("campaignId", "status", "nextSendAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_userId_leadId_idx" ON "CampaignRecipient"("userId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_leadId_key" ON "CampaignRecipient"("campaignId", "leadId");

-- CreateIndex
CREATE INDEX "CookieFile_userId_idx" ON "CookieFile"("userId");

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
