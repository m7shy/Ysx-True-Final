// FILE: server/src/scheduler/types.ts
import type { ProviderName } from "../mail/types.js";

export type ProviderKey = ProviderName;

export type FollowupStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled";

export interface FollowupJob {
  id: string; // UUID

  // Mail send data
  provider: ProviderKey;
  to: string;
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;

  // Scheduling timestamps
  scheduledAt: string; // ISO timestamp when follow-up should be sent
  createdAt: string; // ISO timestamp when job was created
  updatedAt?: string; // ISO timestamp when job was last updated
  sentAt?: string; // ISO timestamp if sent

  // State
  status: FollowupStatus;
  lastError?: string;
  failureReason?: string;
  cancelReason?: string;

  // Campaign / CRM metadata
  campaignId?: string;
  leadId?: string;
  originalEmailId?: string;
  stepIndex?: number; // follow-up step index in campaign sequence

  // Reply gating flags
  onlyIfNoReply?: boolean; // legacy flag for reply gating
  skipIfReplied?: boolean; // skip if the recipient has replied before the scheduled send

  // For reply detection / threading
  originalMessageId?: string; // SMTP Message-ID for reply threading checks
  initialSentAt?: string; // ISO timestamp when the initial email was sent
  recipientEmail?: string; // explicit recipient address for reply detection / grouping
}

export type FollowupJobInput = Omit<
  FollowupJob,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "sentAt"
  | "status"
  | "lastError"
  | "failureReason"
  | "cancelReason"
>;
