-- CreateEnum
CREATE TYPE "TrackingEventType" AS ENUM ('SENT', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "bounceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isBounced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastBounceAt" TIMESTAMP(3);

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

-- CreateIndex
CREATE INDEX "TrackingEvent_campaignId_type_idx" ON "TrackingEvent"("campaignId", "type");

-- CreateIndex
CREATE INDEX "TrackingEvent_leadId_type_idx" ON "TrackingEvent"("leadId", "type");

-- CreateIndex
CREATE INDEX "TrackingEvent_userId_createdAt_idx" ON "TrackingEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_userId_isBounced_idx" ON "Lead"("userId", "isBounced");

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
