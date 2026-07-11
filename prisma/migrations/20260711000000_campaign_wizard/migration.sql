-- Campaign wizard: pacing, stop-on-event, follow-up priority, plain-text
-- mode, bounce auto-pause (Campaign), and per-lead CSV custom fields (Lead).
-- All columns are nullable or have defaults -- purely additive, no backfill.

ALTER TABLE "Campaign"
  ADD COLUMN "sendIntervalMinutes" INTEGER,
  ADD COLUMN "nextSendAt" TIMESTAMP(3),
  ADD COLUMN "stopOnClick" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stopOnOpen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "plainTextMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "followUpPercent" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "bouncedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pausedReason" TEXT;

ALTER TABLE "Lead"
  ADD COLUMN "customFields" JSONB;
