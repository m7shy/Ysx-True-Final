import express, { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';

const router = express.Router();

// ---- Zod schema for the campaign payload ----

const LeadSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  company: z.string().optional(),
  website: z.string().optional(),
  linkedin: z.string().optional(),
  location: z.string().optional(),
  custom: z.record(z.string(), z.string()).default({}),
});

const SequenceVariantSchema = z.object({
  id: z.string().min(1),
  subject: z.string(),
  body: z.string().min(1),
});

const SequenceStageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  waitDays: z.number().int().min(0),
  isThreadReply: z.boolean(),
  variants: z.array(SequenceVariantSchema).min(1),
});

const ScheduleSchema = z.object({
  timezone: z.string().min(1),
  sendDays: z.object({
    mon: z.boolean(),
    tue: z.boolean(),
    wed: z.boolean(),
    thu: z.boolean(),
    fri: z.boolean(),
    sat: z.boolean(),
    sun: z.boolean(),
  }),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  intervalMinutes: z.number().int().min(1),
  maxNewLeadsPerDay: z.number().int().min(1),
});

const SettingsSchema = z.object({
  followUpPercent: z.number().min(0).max(100),
});

export const CampaignPayloadSchema = z.object({
  name: z.string().min(1),
  leads: z.array(LeadSchema).min(1),
  sequence: z.array(SequenceStageSchema).min(1),
  senderAccountIds: z.array(z.string().min(1)).min(1),
  schedule: ScheduleSchema,
  settings: SettingsSchema,
});

export type CampaignPayload = z.infer<typeof CampaignPayloadSchema>;

// ---- Sender account stubs ----
// Derived from any mail credentials configured on the server. Warmup reputation
// and daily limit are reasonable defaults used until a real reputation system
// is wired up.

interface SenderAccount {
  id: string;
  email: string;
  provider: 'gmail' | 'zoho' | 'microsoft' | 'other';
  warmupReputation: number;
  dailyLimit: number;
  campaignsUsed: number;
  connected: boolean;
}

function collectSenderAccounts(): SenderAccount[] {
  const accounts: SenderAccount[] = [];
  const gmail = process.env.GMAIL_USER;
  const zoho = process.env.ZOHO_USER;
  const ms = process.env.MICROSOFT_USER;

  if (gmail) {
    accounts.push({
      id: `gmail:${gmail}`,
      email: gmail,
      provider: 'gmail',
      warmupReputation: 95,
      dailyLimit: 500,
      campaignsUsed: 0,
      connected: true,
    });
  }
  if (zoho) {
    accounts.push({
      id: `zoho:${zoho}`,
      email: zoho,
      provider: 'zoho',
      warmupReputation: 92,
      dailyLimit: 250,
      campaignsUsed: 0,
      connected: true,
    });
  }
  if (ms) {
    accounts.push({
      id: `microsoft:${ms}`,
      email: ms,
      provider: 'microsoft',
      warmupReputation: 90,
      dailyLimit: 300,
      campaignsUsed: 0,
      connected: true,
    });
  }

  // Provide at least one demo mailbox when nothing is configured so the UI
  // can be explored without credentials.
  if (accounts.length === 0) {
    accounts.push({
      id: 'demo:sender@example.com',
      email: 'sender@example.com',
      provider: 'other',
      warmupReputation: 88,
      dailyLimit: 100,
      campaignsUsed: 0,
      connected: false,
    });
  }
  return accounts;
}

// ---- Routes ----

router.get('/sender-accounts', (_req: Request, res: Response) => {
  res.json({ accounts: collectSenderAccounts() });
});

router.post('/', (req: Request, res: Response) => {
  const parsed = CampaignPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid campaign payload',
      issues: parsed.error.issues,
    });
  }
  const campaign = parsed.data;
  const id = `camp_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  logger.info(
    {
      campaignId: id,
      name: campaign.name,
      leads: campaign.leads.length,
      stages: campaign.sequence.length,
      senders: campaign.senderAccountIds.length,
    },
    'Campaign received'
  );
  return res.status(201).json({
    id,
    status: 'queued',
    name: campaign.name,
    leadsCount: campaign.leads.length,
    stages: campaign.sequence.length,
  });
});

export default router;
