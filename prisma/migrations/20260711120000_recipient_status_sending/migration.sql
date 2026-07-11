-- Add SENDING as a claim state on CampaignRecipient.status, mirroring
-- FollowupJobStatus.SENDING. The worker now atomically claims a recipient
-- (PENDING -> SENDING compare-and-set) before sending, so a crash mid-send
-- or a second worker instance can never double-send the same recipient.
ALTER TYPE "RecipientStatus" ADD VALUE 'SENDING';
