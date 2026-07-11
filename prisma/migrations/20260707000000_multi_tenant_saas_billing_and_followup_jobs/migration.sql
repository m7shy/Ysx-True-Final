-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'UNPAID', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FollowupJobStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE';

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

-- CreateIndex
CREATE INDEX "FollowupJob_status_scheduledAt_idx" ON "FollowupJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "FollowupJob_userId_status_idx" ON "FollowupJob"("userId", "status");

-- CreateIndex
CREATE INDEX "FollowupJob_campaignId_recipientEmail_status_idx" ON "FollowupJob"("campaignId", "recipientEmail", "status");

-- CreateIndex
CREATE INDEX "FollowupJob_userId_recipientEmail_status_idx" ON "FollowupJob"("userId", "recipientEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "FollowupJob" ADD CONSTRAINT "FollowupJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
