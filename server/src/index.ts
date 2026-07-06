import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { logger } from './logger.js';

import { authRouter, oauthRouter, requireAuth } from './auth/index.js';
import mailRouter from './mail/routes.js';
import followupsRouter from './followups/routes.js';
import geminiRouter from './gemini/routes.js';
import campaignsRouter from './campaigns/routes.js';
import leadsRouter from './leads/routes.js';
import uniboxRouter from './unibox/routes.js';

import { startFollowupScheduler, cancelFollowup, cancelRemainingFollowupsForRecipient } from './scheduler/followupScheduler.js';
import { sendSmtpMail, parseProvider } from './mail/smtpGateway.js';
import { hasRecipientReplied } from './mail/replyCheck.js';
import { startCampaignWorker } from './campaigns/worker.js';
import { startReplyPoller } from './unibox/replyPoller.js';

export const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.tailwindcss.com',
          'https://aistudiocdn.com',
          'https://esm.sh',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'https://esm.sh', 'https://aistudiocdn.com'],
        upgradeInsecureRequests: null,
      },
    },
  })
);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// OAuth connect/callback flow (multi-account mailbox consent). Mounted before
// the auth router so its paths take precedence. The /start leg is gated by
// requireAuth inside the router; the /callback leg is a provider browser redirect
// with no Authorization header and is instead protected by the signed `state`.
app.use('/api/auth/oauth', oauthRouter);

// Public auth endpoints (signup / login / refresh).
app.use('/api/auth', authRouter);

// Tenant-scoped routers: every request must carry a valid access token, and
// each handler resolves credentials/data from the DB using req.auth.userId.
app.use('/api/mail', requireAuth, mailRouter);
app.use('/api/followups', requireAuth, followupsRouter);
app.use('/api/gemini', requireAuth, geminiRouter);
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/leads', requireAuth, leadsRouter);
app.use('/api/unibox', requireAuth, uniboxRouter);

// ---- Static Files (Frontend) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, '../../dist');

app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// ---- Followup scheduler boot wiring ----
async function sendFollowupJob(job: any) {
  const provider = parseProvider(job.provider ?? job.mailProvider ?? 'gmail');
  const userId = String(job.userId ?? '');

  if (!userId) {
    logger.error({ id: job.id }, 'Follow-up job is missing userId; cannot resolve mailbox credentials');
    return;
  }

  // Reply gating + cancellation of remaining followups
  if (job.skipIfReplied) {
    const recipientRaw = String(job.recipientEmail ?? job.to ?? '').trim();
    const initialSentAt = String(job.initialSentAt ?? '');
    const originalMessageId = job.originalMessageId ? String(job.originalMessageId) : undefined;

    if (recipientRaw && initialSentAt) {
      const replied = await hasRecipientReplied({
        userId,
        provider,
        recipientEmail: recipientRaw,
        initialSentAt,
        originalMessageId,
      });

      if (replied) {
        const campaignId = job.campaignId ? String(job.campaignId) : undefined;
        const normalizedRecipient = recipientRaw.toLowerCase();

        if (campaignId && normalizedRecipient) {
          try {
            await cancelFollowup(String(job.id), 'replied');
            await cancelRemainingFollowupsForRecipient(
              campaignId,
              normalizedRecipient,
              'replied',
              String(job.id),
            );
          } catch (err) {
            logger.error(
              { err, campaignId, recipientEmail: normalizedRecipient, id: job.id },
              'Failed to cancel remaining followups after reply detection',
            );
          }
        }

        logger.info(
          { campaignId, recipientEmail: recipientRaw, id: job.id },
          'Skipping followup send because recipient replied',
        );
        return;
      }
    }
  }

  // Send followup
  const to = String(job.to ?? job.recipientEmail ?? '');
  const subject = String(job.subject ?? '');
  const text = job.body ? String(job.body) : job.text ? String(job.text) : undefined;
  const html = job.html ? String(job.html) : undefined;

  // Threading: if we have original message id, set as reply headers
  const originalMessageId = job.originalMessageId ? String(job.originalMessageId) : undefined;

  const messageId = await sendSmtpMail(userId, provider, {
    to,
    subject,
    text,
    html,
    // If frontend includes "from", smtpGateway treats it as replyTo only.
    replyTo: job.replyTo ? String(job.replyTo) : job.from ? String(job.from) : undefined,
    inReplyTo: originalMessageId,
    references: originalMessageId,
    attachments: job.attachments,
  });

  logger.info({ messageId, id: job.id }, 'Followup sent');
}

const tickMs = Number(process.env.FOLLOWUP_TICK_MS ?? 10000);

// Avoid TS error if scheduler typing currently only accepts 1 argument.
// If the scheduler ignores options, this is harmless; if it supports options, it will use tickMs.
(startFollowupScheduler as any)(sendFollowupJob, { tickMs });

// ---- Phase 4: campaign dispatch worker + Unibox reply poller ----
// Both require the database; skip them when no DATABASE_URL is configured
// (mail-only runs and the vitest suite import this module without a DB).
if (config.DATABASE_URL && config.NODE_ENV !== 'test') {
  startCampaignWorker({ tickMs: Number(process.env.CAMPAIGN_TICK_MS ?? 60_000) });
  startReplyPoller({ pollMs: Number(process.env.UNIBOX_POLL_MS ?? 300_000) });
}

const port = Number((config as any).PORT ?? process.env.PORT ?? 3001);

function isMainModule(): boolean {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  app.listen(port, () => {
    logger.info({ port, tickMs }, 'Server listening');
  });
}
