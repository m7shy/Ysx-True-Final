// Patch Express 4 to forward rejected promises from async route handlers to
// the error-handling middleware below. Must be imported before any routes are
// defined — Express 4 otherwise silently swallows the rejection, leaving the
// client hanging and eventually triggering --unhandled-rejections=throw.
import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { config } from './config.js';
import { logger } from './logger.js';
import { toHttp } from './httpErrors.js';

import { authRouter, oauthRouter, requireAuth, requireActiveTenant } from './auth/index.js';
import { billingWebhookRouter, billingRouter } from './billing/index.js';
import mailRouter from './mail/routes.js';
import followupsRouter from './followups/routes.js';
import geminiRouter from './gemini/routes.js';
import campaignsRouter from './campaigns/routes.js';
import leadsRouter from './leads/routes.js';
import settingsRouter from './settings/routes.js';
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
import {
  unsubscribeHeaders,
  unsubscribeUrlForRecipient,
  unsubscribeUrlForAddress,
  complianceFooter,
} from './campaigns/trackedHtml.js';
import { assertSenderIdentity } from './campaigns/senderIdentity.js';
import { reportActivity } from './scheduler/pulse.js';
import { isSuppressed } from './leads/suppression.js';

import { LeadStatus, CampaignStatus, FollowupJobStatus } from '@prisma/client';
import { prisma } from './db/prisma.js';
import { startFollowupScheduler, cancelFollowup, cancelRemainingFollowupsForRecipient, cancelScheduledFollowupsForUserRecipient } from './scheduler/followupScheduler.js';
import { sendSmtpMail, parseProvider } from './mail/smtpGateway.js';
import { checkRecipientReply } from './mail/replyCheck.js';
import { startCampaignWorker } from './campaigns/worker.js';
import { isWithinSendWindow } from './campaigns/engine.js';
import { startReplyPoller } from './unibox/replyPoller.js';
import { startAutoScraperScheduler } from './scraper/autoScheduler.js';
import { runDeepChecks, startWatchdog } from './health/monitor.js';
import { configReport } from './config.js';

// How long a follow-up waits before re-checking a non-ACTIVE campaign. Long
// enough that a paused campaign is not re-claimed on every scheduler tick,
// short enough that resuming a campaign feels immediate.
const PAUSED_RECHECK_MS = 5 * 60_000;

// How long a follow-up waits before re-checking a closed send window. Shorter
// than the paused interval: a window reopens on a schedule, so this bounds how
// late into the window a deferred follow-up goes out.
const OUTSIDE_WINDOW_RECHECK_MS = 10 * 60_000;

// How long a follow-up waits after a reply check that could not complete (IMAP
// down, credentials unresolvable). Deliberately the shortest of the three: this
// is an unexpected fault rather than a scheduled state, so it should clear as
// soon as the mailbox is reachable again.
//
// ⚠️ This defer is UNBOUNDED — a permanently broken mailbox stalls the
// recipient's sequence indefinitely rather than sending. That is the intended
// meaning of failing closed (never mail someone who may have replied), but it
// does mean a silently dead mailbox quietly halts follow-ups. Visibility comes
// from the warn/error logged on every failed check and from the `mailboxes`
// check in /api/health/deep. Capping it properly needs a per-job counter that
// does not collide with the send-retry attemptCount, i.e. a schema field —
// deliberately not added here.
const REPLY_CHECK_RECHECK_MS = 3 * 60_000;

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

// Parse Cookie headers so refresh-token cookies are available on req.cookies.
// Must be mounted before any router that reads cookies.
app.use(cookieParser());

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

// Deep health for humans + external uptime monitors (UptimeRobot etc.):
// DB round-trip, worker tick freshness, mailbox health, disk, alerting.
// 503 only on critical (DB down) so uptime monitors page on real outages.
//
// NOT public: the payload maps the deployment (worker liveness, mailbox
// counts, free disk, whether alerting is even configured) and previously
// echoed raw Prisma errors carrying the database host. Authenticated by a
// shared HEALTH_TOKEN when one is configured — so an external monitor can
// poll it — and otherwise by a normal admin session. Never anonymous.
const healthTokenGuard: express.RequestHandler = (req, res, next) => {
  const expected = config.HEALTH_TOKEN;

  if (expected) {
    // Header is preferred; the query fallback exists because some uptime
    // monitors cannot send custom headers. Query strings land in access logs,
    // so treat a token used that way as lower-trust and rotate it if leaked.
    const supplied = req.get('x-health-token') ?? (typeof req.query.token === 'string' ? req.query.token : '');
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      next();
      return;
    }
  }

  // Either no token is configured, or this caller did not present a valid one.
  // Fall back to a normal admin session rather than rejecting outright: the
  // previous version returned early when HEALTH_TOKEN was set, so configuring a
  // token for the uptime monitor silently locked admins out of their own
  // diagnostics in the UI. A monitor and a human should both be able to read
  // this. Still never anonymous — requireAuth is the floor in both paths.
  return requireAuth(req, res, next);
};

app.get('/api/health/deep', healthTokenGuard, async (_req, res) => {
  const health = await runDeepChecks();
  res.status(health.status === 'critical' ? 503 : 200).json(health);
});

// OAuth connect/callback flow (multi-account mailbox consent). Mounted before
// the auth router so its paths take precedence. The /start leg is gated by
// requireAuth inside the router; the /callback leg is a provider browser redirect
// with no Authorization header and is instead protected by the signed `state`.
// NOT wrapped in requireActiveTenant, deliberately: both legs of this flow are
// GETs, and requireActiveTenant lets safe methods through by design — mounting
// it here would look like a gate while enforcing nothing. Connecting a mailbox
// IS a mutation despite the verb, so the billing/status check lives inside the
// /start handler instead (see assertActiveTenant in oauthRoutes.ts).
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
// /refresh mints access tokens from a bearer refresh token, so it deserves its
// own budget rather than only the global 120/min. Looser than login: a normal
// client refreshes on boot and every ~15 min, and several tabs refresh
// independently, so this must not throttle real use. skipSuccessfulRequests
// means only rejected attempts count — brute force is bounded, legitimate
// clients are unaffected however often they refresh.
app.use(
  '/api/auth/refresh',
  rateLimit({
    windowMs: 15 * 60_000,
    max: 30,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'RATE_LIMITED', message: 'Too many attempts — try again in a few minutes' },
  }),
);

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

// Dedicated limiter for the magic-link endpoint.
//
// Why a second limiter and not the one above?
// portalAuthLimiter.skipSuccessfulRequests=true is correct for login/refresh
// (only failed guesses should count against the budget), but the magic-link
// handler ALWAYS returns 200 regardless of whether the email exists — so
// every request looks "successful" and skipSuccessfulRequests means the
// budget is never decremented. An unauthenticated attacker can therefore
// spam this route at the global 120/min rate, burning the tenant's paid
// email quota and eventually exhausting it so CRM campaign sends fail.
//
// This limiter keys on IP + normalized email together so rotating either
// alone is not sufficient to escape the window.  3 per 15 min gives a
// genuine user two retries before the window resets while making bulk
// abuse uneconomical.
const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 3,
  // Do NOT set skipSuccessfulRequests — every response is 200 by design.
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown').toLowerCase();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${ip}:${email}`;
  },
  message: { code: 'RATE_LIMITED', message: 'Too many sign-in link requests — try again in 15 minutes' },
});
app.post('/api/portal/auth/magic-link', magicLinkLimiter);
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
// Someone is actually using the app: keep the pollers at full cadence rather
// than making a live user wait up to an idle interval for their campaign to
// move. Health probes are excluded deliberately — an uptime monitor hitting
// /api/health every minute would otherwise pin the pollers permanently awake
// and defeat the whole mechanism.
app.use('/api', (req, _res, next) => {
  if (!req.path.startsWith('/health')) reportActivity();
  next();
});

app.use('/api/analytics', requireAuth, requireActiveTenant, analyticsRouter);
app.use('/api/settings', requireAuth, requireActiveTenant, settingsRouter);

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
const portalDistPath = path.join(__dirname, '../../dist-portal');

// Client portal SPA — must be mounted BEFORE the CRM static/catch-all so
// /portal/* never falls through to the CRM's index.html.
app.use('/portal', express.static(portalDistPath));
app.get('/portal/*', (_req, res) => {
  res.sendFile(path.join(portalDistPath, 'index.html'));
});

app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// ---- Terminal error-handling middleware ----
// Express 4 requires exactly four arguments to recognise this as an error
// handler. express-async-errors (imported at the top) ensures rejected async
// route promises land here instead of crashing the process.
// Uses toHttp from httpErrors.ts to derive a client-safe status/payload for
// known error types; unknown errors get a generic 500 with no leaked details.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  // If headers are already flushed there is nothing useful we can do — hand
  // off to Express's built-in finaliser so it can tear down the socket.
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, 'Unhandled error in request pipeline');
  const http = toHttp(err);
  res.status(http.status).json({ code: http.code, message: http.message });
});

// ---- Process-level backstops ----
// Prevent Node's default --unhandled-rejections=throw from silently killing
// the API, campaign worker, follow-up scheduler and reply poller together.
// We log with full detail so the root cause is diagnosable from the logs.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection (process backstop)');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception (process backstop)');
});

// ---- Followup scheduler boot wiring ----
/**
 * Dispatch one follow-up job. Exported for tests: the reply gate below decides
 * whether a scheduled email goes out, gets deferred, or cancels a whole
 * sequence, and that decision is worth testing through the real function rather
 * than through a re-implementation of its rules.
 */
export async function sendFollowupJob(job: any) {
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
    // Checked independently of the Lead row above, and by address rather than
    // by id: the suppression list is the record that survives the lead being
    // deleted, so a queued follow-up for an address that opted out must die
    // here even when there is no longer a Lead to read a status from.
    if (await isSuppressed(userId, dncRecipient)) {
      await cancelFollowup(String(job.id), 'suppressed');
      await cancelScheduledFollowupsForUserRecipient(userId, dncRecipient, 'suppressed');
      logger.info({ id: job.id }, 'Skipping follow-up send: address is on the suppression list');
      return;
    }
  }

  // Campaign paused → SUSPEND this job, do not send and do not cancel.
  //
  // Pausing used to call cancelScheduledFollowupsForCampaign(), which is
  // irreversible: resuming could not bring the sequence back, so a user who
  // paused a campaign for an hour silently lost every queued follow-up. That
  // was an unintended consequence of correctly plugging the "follow-ups keep
  // sending for days after a pause" leak.
  //
  // Deferring here fixes both: nothing sends while paused (the leak stays
  // closed, and this is the ONLY follow-up send path), and resuming needs no
  // restore bookkeeping because the jobs were never destroyed. Pushing
  // scheduledAt forward stops the scheduler re-claiming this row every tick;
  // returning it to SCHEDULED means the tick's "finalize as SENT" updateMany
  // no longer matches it (it only touches rows still in SENDING).
  if (job.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: String(job.campaignId) },
      select: {
        status: true,
        sendWindowStart: true,
        sendWindowEnd: true,
        sendDays: true,
        timezone: true,
      },
    });
    if (!campaign) {
      // Campaign deleted out from under a claimed job — nothing to send to.
      await cancelFollowup(String(job.id), 'campaign_deleted');
      return;
    }
    if (campaign.status !== CampaignStatus.ACTIVE) {
      await prisma.followupJob.updateMany({
        where: { id: String(job.id), status: FollowupJobStatus.SENDING },
        data: {
          status: FollowupJobStatus.SCHEDULED,
          scheduledAt: new Date(Date.now() + PAUSED_RECHECK_MS),
        },
      });
      logger.info({ id: job.id, campaignId: job.campaignId, status: campaign.status }, 'Follow-up deferred: campaign is not active');
      return;
    }

    // Outside the campaign's send window → defer, do not send.
    //
    // Follow-ups previously ignored the send window entirely, so a campaign
    // configured to mail 09:00-17:00 sent its first touch inside the window and
    // then delivered the rest of the sequence at 03:00. The window exists to
    // control when a RECIPIENT is contacted, and the majority of a sequence's
    // messages are follow-ups, so exempting them defeated the setting.
    //
    // Deferred rather than dropped, on the same mechanism as the paused case.
    // Re-checked on an interval instead of computing the next opening: the
    // window arithmetic already lives in engine.ts and is timezone/overnight
    // aware, so asking "is it open now?" periodically is simpler and cannot
    // disagree with the sender's own check.
    if (!isWithinSendWindow(campaign)) {
      await prisma.followupJob.updateMany({
        where: { id: String(job.id), status: FollowupJobStatus.SENDING },
        data: {
          status: FollowupJobStatus.SCHEDULED,
          scheduledAt: new Date(Date.now() + OUTSIDE_WINDOW_RECHECK_MS),
        },
      });
      logger.info({ id: job.id, campaignId: job.campaignId }, 'Follow-up deferred: outside the campaign send window');
      return;
    }
  }

  // Reply gating + cancellation of remaining followups
  if (job.skipIfReplied) {
    const recipientRaw = String(job.recipientEmail ?? job.to ?? '').trim();
    const initialSentAt = String(job.initialSentAt ?? '');
    const originalMessageId = job.originalMessageId ? String(job.originalMessageId) : undefined;

    if (recipientRaw && initialSentAt) {
      const replyState = await checkRecipientReply({
        userId,
        provider,
        recipientEmail: recipientRaw,
        initialSentAt,
        originalMessageId,
        // The follow-up subject is "Re: <original>", and normalizeSubject
        // strips that back to the thread's base subject — so this scopes the
        // last-resort subject fallback to this conversation.
        threadSubject: job.subject ? String(job.subject) : undefined,
      });

      // Could not determine whether they replied. Defer — never send, never
      // cancel.
      //
      // Sending would be the old behaviour: every error path returned "has not
      // replied", so an IMAP outage mailed the whole sequence to everyone,
      // including people who had already answered. Cancelling would be worse
      // still, since the reply branch below tears down the recipient's entire
      // remaining sequence and an outage would do that to every recipient at
      // once. Waiting is the only action that is wrong in neither direction.
      if (replyState === 'unknown') {
        await prisma.followupJob.updateMany({
          where: { id: String(job.id), status: FollowupJobStatus.SENDING },
          data: {
            status: FollowupJobStatus.SCHEDULED,
            scheduledAt: new Date(Date.now() + REPLY_CHECK_RECHECK_MS),
          },
        });
        logger.warn(
          { id: job.id, campaignId: job.campaignId },
          'Follow-up deferred: could not determine whether the recipient replied',
        );
        return;
      }

      if (replyState === 'replied') {
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

  // Campaign follow-ups carry the one-click unsubscribe headers AND the same
  // legal footer as the initial send. The job stores campaignId/leadId, not the
  // recipient row, so rebuild the URL from the (campaignId, leadId)-unique
  // recipient.
  //
  // Follow-ups used to send `job.body` verbatim: they had the RFC 8058 header
  // and nothing a human could see — no visible unsubscribe link, no postal
  // address. Most of a sequence is follow-ups, so exempting them exempted most
  // of the mail. They now go through the same complianceFooter() the initial
  // send uses, which is the point of that function existing.
  //
  // Fail-closed: if this is a campaign follow-up and the footer cannot be
  // built, the message is NOT sent. The old code logged and sent anyway, which
  // is the worse half of both options — the recipient gets a commercial email
  // with no way out, and nothing surfaces that it happened.
  let headers: Record<string, string> | undefined;
  let bodyText = text;
  let bodyHtml = html;

  if (job.campaignId && job.leadId) {
    const recipient = await prisma.campaignRecipient.findUnique({
      where: { campaignId_leadId: { campaignId: String(job.campaignId), leadId: String(job.leadId) } },
      select: { id: true },
    });
    if (!recipient) {
      await cancelFollowup(String(job.id), 'recipient_missing');
      logger.warn({ id: job.id, campaignId: job.campaignId }, 'Follow-up cancelled: no recipient row to build a compliant footer from');
      return;
    }

    // Throws MissingSenderIdentityError; caught by the scheduler's per-job
    // handler and retried, so the sequence resumes once an address is saved.
    const identity = await assertSenderIdentity(userId);
    const unsubscribeUrl = unsubscribeUrlForRecipient(recipient.id);
    const footer = complianceFooter(identity, unsubscribeUrl);

    headers = unsubscribeHeaders(unsubscribeUrl);
    bodyText = `${bodyText ?? ''}${footer.text}`;
    // Only append the HTML footer to an HTML part that actually exists —
    // synthesising one would turn a deliberately plain-text follow-up into a
    // multipart message and change how it lands.
    if (bodyHtml) bodyHtml = `${bodyHtml}${footer.html}`;
  } else {
    // One-off follow-up: scheduled from the Dashboard composer, so there is no
    // campaign and no CampaignRecipient row to derive an opt-out link from.
    //
    // It gets the SAME footer and headers regardless — a scheduled follow-up to
    // a cold prospect is the same commercial message whether or not a campaign
    // queued it, and the whole point of routing every send through one builder
    // is that the two cannot drift apart. The opt-out URL is signed over
    // (tenant, address) instead of a row id.
    //
    // Fails closed identically: assertSenderIdentity throws and the scheduler's
    // per-job handler retries, so the follow-up sends itself once an address is
    // configured rather than being lost.
    const recipientForFooter = String(job.recipientEmail ?? job.to ?? '').trim();
    if (!recipientForFooter) {
      await cancelFollowup(String(job.id), 'no_recipient');
      logger.warn({ id: job.id }, 'Follow-up cancelled: no recipient address to build a compliant footer from');
      return;
    }

    const identity = await assertSenderIdentity(userId);
    const unsubscribeUrl = unsubscribeUrlForAddress(userId, recipientForFooter);
    const footer = complianceFooter(identity, unsubscribeUrl);

    headers = unsubscribeHeaders(unsubscribeUrl);
    bodyText = `${bodyText ?? ''}${footer.text}`;
    if (bodyHtml) bodyHtml = `${bodyHtml}${footer.html}`;
  }

  const messageId = await sendSmtpMail(userId, provider, {
    to,
    subject,
    text: bodyText,
    html: bodyHtml,
    // If frontend includes "from", smtpGateway treats it as replyTo only.
    replyTo: job.replyTo ? String(job.replyTo) : job.from ? String(job.from) : undefined,
    inReplyTo: originalMessageId,
    references: originalMessageId,
    attachments: job.attachments,
    headers,
  });

  // Count follow-ups against the campaign's daily volume.
  //
  // Deliberately COUNTED but not BLOCKED. The cap exists to bound a campaign's
  // daily volume for sender reputation, and follow-ups were invisible to it, so
  // the real number sent could exceed the configured limit without ever showing
  // it. Counting them makes the figure honest and makes new first-touch sends
  // yield to in-flight sequences, since the worker's remaining budget shrinks.
  //
  // Blocking them was the other option and is worse: a sequence stranded
  // mid-way because the day's budget went to new prospects reads as being
  // ghosted, and the messages still eventually go out — just later and in a
  // worse order. Time-gate follow-ups, volume-gate new outreach.
  if (job.campaignId) {
    try {
      await prisma.campaign.update({
        where: { id: String(job.campaignId) },
        data: { sentToday: { increment: 1 } },
      });
    } catch (err) {
      // Never fail a delivered send on a counter write.
      logger.error({ err, id: job.id }, 'Failed to count follow-up against the campaign daily total');
    }
  }

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

// Self-alerting watchdog: re-runs the deep health checks every 15 min and
// emails ALERT_EMAIL via the PORTAL_SMTP_* fallback on new failures/recoveries.
startWatchdog();

// Redacted config fingerprint report — makes NSSM-env-vs-.env drift visible in
// the log on every boot (two prior outages came from exactly that drift).
logger.info({ config: configReport() }, 'Effective config (redacted fingerprints)');

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
