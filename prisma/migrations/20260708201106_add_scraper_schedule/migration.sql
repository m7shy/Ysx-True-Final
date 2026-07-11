-- CreateEnum
CREATE TYPE "ScraperScheduleStatus" AS ENUM ('IDLE', 'RUNNING');

-- CreateTable
CREATE TABLE "ScraperSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "runsPerDay" INTEGER NOT NULL DEFAULT 3,
    "status" "ScraperScheduleStatus" NOT NULL DEFAULT 'IDLE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScraperSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScraperSchedule_userId_key" ON "ScraperSchedule"("userId");

-- CreateIndex
CREATE INDEX "ScraperSchedule_enabled_status_nextRunAt_idx" ON "ScraperSchedule"("enabled", "status", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ScraperSchedule" ADD CONSTRAINT "ScraperSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
