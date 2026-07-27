-- Compliance groundwork: per-tenant sender identity + a suppression list that
-- outlives the Lead rows it protects.
--
-- Sender identity (User.businessName / businessAddress / senderProvenance):
-- CAN-SPAM §7704(a)(5) requires a valid physical postal address in every
-- commercial message. No campaign email this system has ever sent contained
-- one. These are per-TENANT columns, not app config, because a second agency
-- sending through this system must send its own address, never the operator's.
-- All three are nullable: existing rows are untouched, and the send path
-- (assertSenderIdentity) is what refuses to dispatch until they are filled in.
--
-- Suppression: Lead.status = DNC lives on a row that can be deleted, so
-- deleting a lead has always taken its opt-out with it — re-import the same
-- list and someone who unsubscribed gets mailed again. This table records the
-- opt-out separately, keyed on sha256(lower(trim(email))) so that an erasure
-- request can delete every trace of the person and STILL leave a working
-- suppression key behind. Unique per (userId, emailHash): one agency's opt-out
-- is not another agency's.
--
-- Additive only: three nullable columns and one new table. No existing row is
-- read, rewritten or constrained by this migration, so it cannot fail on
-- current data and needs no backfill.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "businessAddress" TEXT,
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "senderProvenance" TEXT;

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suppression_userId_idx" ON "Suppression"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_userId_emailHash_key" ON "Suppression"("userId", "emailHash");

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
