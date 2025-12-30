// FILE: server/src/followups/routes.ts

import express from "express";
import { z } from "zod";
import {
  scheduleFollowup,
  getScheduledFollowups,
  cancelFollowup,
} from "../scheduler/followupScheduler.js";
import { parseProvider } from "../mail/smtpGateway.js";
import type { FollowupJobInput } from "../scheduler/types.js";

const router = express.Router();

/**
 * Validation schema for scheduling a follow-up email.
 *
 * Required:
 *  - campaignId
 *  - recipientEmail
 *  - originalMessageId
 *  - initialSentAt
 *  - scheduledAt
 *  - to, subject, body (what we need to actually send the email)
 */
const scheduleSchema = z.object({
  provider: z.string().optional(), // default handled by parseProvider
  to: z.string().min(1, "to is required"),
  subject: z.string().min(1, "subject is required"),
  body: z.string().min(1, "body is required"),
  replyTo: z.string().trim().optional(),

  scheduledAt: z.string().min(1, "scheduledAt is required"),

  // Required metadata for reply-gating / grouping
  campaignId: z.string().min(1, "campaignId is required"),
  recipientEmail: z.string().min(1, "recipientEmail is required"),
  originalMessageId: z.string().min(1, "originalMessageId is required"),
  initialSentAt: z.string().min(1, "initialSentAt is required"),

  // Optional metadata used by UI / analytics
  leadId: z.string().optional(),
  originalEmailId: z.string().optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  onlyIfNoReply: z.boolean().optional(),
  skipIfReplied: z.boolean().optional(),
});

function toErrorPayload(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof z.ZodError) {
    return {
      status: 400,
      code: "INVALID_INPUT",
      message: err.issues.map((i) => i.message).join("; "),
    };
  }

  if (err && typeof err === "object") {
    const e = err as any;
    if (
      typeof e.status === "number" &&
      typeof e.code === "string" &&
      typeof e.message === "string"
    ) {
      return { status: e.status, code: e.code, message: e.message };
    }
  }

  const message = err instanceof Error ? err.message : "Internal Server Error";
  return { status: 500, code: "UNKNOWN", message };
}

router.get("/", async (_req, res) => {
  const jobs = await getScheduledFollowups();
  res.json({ jobs });
});

router.post("/schedule", async (req, res) => {
  try {
    const parsed = scheduleSchema.parse(req.body);

    const provider = parseProvider(parsed.provider, "zoho");
    const replyGate = parsed.skipIfReplied ?? parsed.onlyIfNoReply ?? false;

    const input: FollowupJobInput = {
      provider,
      to: parsed.to,
      subject: parsed.subject,
      body: parsed.body,
      replyTo: parsed.replyTo,
      scheduledAt: parsed.scheduledAt,

      campaignId: parsed.campaignId,
      leadId: parsed.leadId,
      originalEmailId: parsed.originalEmailId,
      stepIndex: parsed.stepIndex,

      onlyIfNoReply: replyGate,
      skipIfReplied: replyGate,

      originalMessageId: parsed.originalMessageId,
      initialSentAt: parsed.initialSentAt,
      recipientEmail: parsed.recipientEmail,
    };

    const job = await scheduleFollowup(input);
    res.json({ job });
  } catch (err) {
    const out = toErrorPayload(err);
    res.status(out.status).json({ code: out.code, message: out.message });
  }
});

router.post("/:id/cancel", async (req, res) => {
  const ok = await cancelFollowup(req.params.id);
  res.json({ ok });
});

export default router;
