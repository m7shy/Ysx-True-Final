import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { logger } from './logger.js';

import { authRouter, oauthRouter, requireAuth, requireActiveTenant } from './auth/index.js';
import { billingWebhookRouter, billingRouter } from './billing/index.js';
import mailRouter from './mail/routes.js';
import followupsRouter from './followups/routes.js';
import geminiRouter from './gemini/routes.js';
import campaignsRouter from './campaigns/routes.js';
import leadsRouter from './leads/routes.js';
import leadsImportRouter from './leads/importRoutes.js';
import uniboxRouter from './unibox/routes.js';
import scraperRouter from './scraper/routes.js';
import analyticsRouter from './analytics/routes.js';
import trackingRouter from './campaigns/trackingRoutes.js';
import portalAuthRouter from './portal/auth.js';
import portalRouter from './portal/routes.js';
import { requireClientAuth } from './auth/clientMiddleware.js';
import clientsRouter from './clients/routes.js';
import projectsRouter from './projects/routes.js';
import invoicesRouter from './invoices/routes.js';
import { unsubscribeHeaders, unsubscribeUrlForRecipient } from './campaigns/trackedHtml.js';

import { LeadStatus } from '@prisma/client';
import { prisma } from './db/prisma.js';
import { startFollowupScheduler, cancelFollowup, cancelRemainingFollowupsForRecipient, cancelScheduledFollowupsForUserRecipient } from './scheduler/followupScheduler.js';
import { sendSmtpMail, parseProvider } from './mail/smtpGateway.js';
import { hasRecipientReplied } from './mail/replyCheck.js';
import { startCampaignWorker } from './campaigns/worker.js';
import { startReplyPoller } from './unibox/replyPoller.js';
import { startAutoScraperScheduler } from './scraper/autoScheduler.js';

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
    origin: config.WEB_ORIGIN,
    credentials: true,
  })
);

// Campaign open/click tracking pixel + click redirect + one-click unsubscribe —
// deliberately unauthenticated (the recipient's mail client has no session);
// HMAC-signed tokens (campaigns/trackingToken.ts) stand in for auth. Mounted
// BEFORE the global rate limiter: a burst of legitimate opens (e.g. a mail
// provider prefetching pixels for a whole send batch from one egress IP) must
// never be throttled, and RFC 8058 unsubscribe POSTs must always succeed.
app.use('/t', trackingRouter);

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Stripe webhook — MUST be mounted before express.json(): signature
// verification hashes the raw request bytes, so this router uses its own
// express.raw() parser. Authenticated exclusively by the Stripe-Signature
// HMAC against STRIPE_WEBHOOK_SECRET (see src/billing/webhook.ts).
app.use('/api/billing/webhook', billingWebhookRouter);

app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// OAuth connect/callback flow (multi-account mailbox consent). Mounted before
// the auth router so its paths take precedence. The /start leg is gated by
// requireAuth inside the router; the /callback leg is a provider browser redirect
// with no Authorization header and is instead protected by the signed `state`.
app.use('/api/auth/oauth', oauthRouter);

// Credential-stuffing guard: login/signup get a much tighter budget than the
// global 120/min limiter. Failed attempts only — successful logins don't
// consume the budget, so a legitimate user can't lock themselves out.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many attempts — try again in a few minutes' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

// Public auth endpoints (signup / login / refresh).
app.use('/api/auth', authRouter);

// Client-portal auth (login / magic link / invite set-password / refresh).
// Same tight failed-attempt budget as the CRM's, but a separate limiter
// instance so client brute-force attempts can't exhaust the admin's budget.
const portalAuthLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many attempts — try again in a few minutes' },
});
app.use('/api/portal/auth', portalAuthLimiter, portalAuthRouter);

// Client-facing portal API — gated by requireClientAuth (aud:'client' tokens
// only; CRM tokens are rejected). Every handler additionally filters by the
// token's clientId, so a crafted :id can only 404.
app.use('/api/portal', requireClientAuth, portalRouter);

// Tenant-scoped routers: every request must carry a valid access token, and
// each handler resolves credentials/data from the DB using req.auth.userId.
// requireActiveTenant additionally blocks all mutations (POST/PUT/PATCH/DELETE)
// from tenants whose account status is UNPAID or INACTIVE.
app.use('/api/mail', requireAuth, requireActiveTenant, mailRouter);
app.use('/api/followups', requireAuth, requireActiveTenant, followupsRouter);
app.use('/api/gemini', requireAuth, requireActiveTenant, geminiRouter);
app.use('/api/campaigns', requireAuth, requireActiveTenant, campaignsRouter);
// Server-to-server scraper feed. Mounted BEFORE the JWT /api/leads router so
// this more-specific path matches first: it authenticates with the X-Import-Key
// shared secret (see leads/importRoutes.ts) instead of a Bearer token.
app.use('/api/leads/import', leadsImportRouter);
app.use('/api/leads', requireAuth, requireActiveTenant, leadsRouter);
app.use('/api/unibox', requireAuth, requireActiveTenant, uniboxRouter);
// In-app YouTube scraper: a logged-in user launches the Python scraper and its
// leads land in their own tenant (see scraper/service.ts).
app.use('/api/scraper', requireAuth, requireActiveTenant, scraperRouter);
app.use('/api/analytics', requireAuth, requireActiveTenant, analyticsRouter);

// Client-portal admin management (clients / projects / invoices) — CRM-side,
// tenant-scoped like every other router above.
app.use('/api/clients', requireAuth, requireActiveTenant, clientsRouter);
app.use('/api/projects', requireAuth, requireActiveTenant, projectsRouter);
app.use('/api/invoices', requireAuth, requireActiveTenant, invoicesRouter);

// Billing reads (tier / status / metered usage). Auth-gated but deliberately
// NOT behind requireActiveTenant: a lapsed tenant must still see its usage
// and why mutations are blocked.
app.use('/api/billing', requireAuth, billingRouter);

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

  // DNC hard block: a lead marked do-not-contact is never emailed again,
  // even if this job was queued before the status change (enforceDnc cancels
  // scheduled jobs, but this guard also covers jobs claimed mid-transition).
  const dncRecipient = String(job.to ?? job.recipientEmail ?? '').trim();
  if (dncRecipient) {
    const lead = await prisma.lead.findFirst({
      where: { userId, email: { equals: dncRecipient, mode: 'insensitive' } },
      select: { status: true },
    });
    if (lead?.status === LeadStatus.DNC) {
      await cancelFollowup(String(job.id), 'dnc');
      await cancelScheduledFollowupsForUserRecipient(userId, dncRecipient, 'dnc');
      logger.info({ id: job.id }, 'Skipping follow-up send: lead is marked DNC');
      return;
    }
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

  // Campaign follow-ups carry the one-click unsubscribe headers, same as the
  // initial send. The job stores campaignId/leadId, not the recipient row, so
  // rebuild the URL from the (campaignId, leadId)-unique recipient.
  let headers: Record<string, string> | undefined;
  if (job.campaignId && job.leadId) {
    try {
      const recipient = await prisma.campaignRecipient.findUnique({
        where: { campaignId_leadId: { campaignId: String(job.campaignId), leadId: String(job.leadId) } },
        select: { id: true },
      });
      if (recipient) headers = unsubscribeHeaders(unsubscribeUrlForRecipient(recipient.id));
    } catch (err) {
      logger.error({ err, id: job.id }, 'Failed to resolve unsubscribe headers for follow-up');
    }
  }

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
    headers,
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

// Auto-scraper: 3-5x/day per tenant, staggered across 24h (see autoScheduler.ts).
// Separately gated on SCRAPER_DIR inside startAutoScraperScheduler itself.
startAutoScraperScheduler({ tickMs: Number(process.env.SCRAPER_AUTO_TICK_MS ?? 300_000) });

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
