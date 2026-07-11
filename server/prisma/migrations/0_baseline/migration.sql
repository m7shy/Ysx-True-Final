-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('GMAIL', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'REPLIED', 'CALL_BOOKED', 'TRIAL', 'CLIENT_CLOSED', 'LOST');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TrackingEventType" AS ENUM ('SENT', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'UNPAID', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FollowupJobStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENDING', 'IN_SEQUENCE', 'COMPLETED', 'REPLIED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ScraperScheduleStatus" AS ENUM ('IDLE', 'RUNNING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "signatures" JSONB,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "type" "TrackingEventType" NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" "MailboxProvider" NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "scope" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "tenant" TEXT,
    "obtainedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "dailyLimit" INTEGER NOT NULL DEFAULT 0,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "counterDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT,
    "notes" TEXT,
    "score" INTEGER,
    "lastContacted" TIMESTAMP(3),
    "intelligence" JSONB,
    "customFields" JSONB,
    "isBounced" BOOLEAN NOT NULL DEFAULT false,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "lastBounceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "clickedCount" INTEGER NOT NULL DEFAULT 0,
    "repliedCount" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesCount" INTEGER NOT NULL DEFAULT 0,
    "distributionMethod" TEXT,
    "sequence" JSONB,
    "autoFollowUps" JSONB,
    "sendWindowStart" INTEGER,
    "sendWindowEnd" INTEGER,
    "sendDays" INTEGER,
    "timezone" TEXT,
    "dailyLimit" INTEGER,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "counterDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "openTracking" BOOLEAN NOT NULL DEFAULT false,
    "linkTracking" BOOLEAN NOT NULL DEFAULT false,
    "sendIntervalMinutes" INTEGER,
    "nextSendAt" TIMESTAMP(3),
    "stopOnClick" BOOLEAN NOT NULL DEFAULT false,
    "stopOnOpen" BOOLEAN NOT NULL DEFAULT false,
    "plainTextMode" BOOLEAN NOT NULL DEFAULT false,
    "followUpPercent" INTEGER NOT NULL DEFAULT 50,
    "bouncedCount" INTEGER NOT NULL DEFAULT 0,
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "html" TEXT,
    "replyTo" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" "FollowupJobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "lastError" TEXT,
    "failureReason" TEXT,
    "cancelReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "campaignId" TEXT,
    "leadId" TEXT,
    "originalEmailId" TEXT,
    "stepIndex" INTEGER,
    "onlyIfNoReply" BOOLEAN NOT NULL DEFAULT false,
    "skipIfReplied" BOOLEAN NOT NULL DEFAULT false,
    "originalMessageId" TEXT,
    "initialSentAt" TIMESTAMP(3),
    "recipientEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowupJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "runsPerDay" INTEGER NOT NULL DEFAULT 3,
    "status" "ScraperScheduleStatus" NOT NULL DEFAULT 'IDLE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "runStartedAt" TIMESTAMP(3),
    "lastRunSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScraperSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CookieFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "content" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CookieFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "TrackingEvent_campaignId_type_idx" ON "TrackingEvent"("campaignId", "type");

-- CreateIndex
CREATE INDEX "TrackingEvent_leadId_type_idx" ON "TrackingEvent"("leadId", "type");

-- CreateIndex
CREATE INDEX "TrackingEvent_userId_createdAt_idx" ON "TrackingEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Mailbox_userId_isActive_idx" ON "Mailbox"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Mailbox_userId_expiresAt_idx" ON "Mailbox"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_userId_email_key" ON "Mailbox"("userId", "email");

-- CreateIndex
CREATE INDEX "Lead_userId_status_idx" ON "Lead"("userId", "status");

-- CreateIndex
CREATE INDEX "Lead_userId_score_idx" ON "Lead"("userId", "score");

-- CreateIndex
CREATE INDEX "Lead_userId_isBounced_idx" ON "Lead"("userId", "isBounced");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_userId_email_key" ON "Lead"("userId", "email");

-- CreateIndex
CREATE INDEX "Campaign_userId_status_idx" ON "Campaign"("userId", "status");

-- CreateIndex
CREATE INDEX "Campaign_userId_scheduledAt_idx" ON "Campaign"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_nextSendAt_idx" ON "CampaignRecipient"("campaignId", "status", "nextSendAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_userId_leadId_idx" ON "CampaignRecipient"("userId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_leadId_key" ON "CampaignRecipient"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_userId_periodStart_key" ON "UsageRecord"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "FollowupJob_status_scheduledAt_idx" ON "FollowupJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "FollowupJob_userId_status_idx" ON "FollowupJob"("userId", "status");

-- CreateIndex
CREATE INDEX "FollowupJob_campaignId_recipientEmail_status_idx" ON "FollowupJob"("campaignId", "recipientEmail", "status");

-- CreateIndex
CREATE INDEX "FollowupJob_userId_recipientEmail_status_idx" ON "FollowupJob"("userId", "recipientEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScraperSchedule_userId_key" ON "ScraperSchedule"("userId");

-- CreateIndex
CREATE INDEX "ScraperSchedule_enabled_status_nextRunAt_idx" ON "ScraperSchedule"("enabled", "status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "CookieFile_name_key" ON "CookieFile"("name");

-- CreateIndex
CREATE INDEX "CookieFile_userId_idx" ON "CookieFile"("userId");

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupJob" ADD CONSTRAINT "FollowupJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScraperSchedule" ADD CONSTRAINT "ScraperSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

