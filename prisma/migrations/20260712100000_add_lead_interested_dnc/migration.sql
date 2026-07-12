-- Additive enum values only: INTERESTED (positive reply disposition) and
-- DNC (do-not-contact — hard-blocked from all automated sends).
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'INTERESTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'DNC';
