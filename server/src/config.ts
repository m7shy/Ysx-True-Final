
import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  // PostgreSQL (Neon) connection strings consumed by Prisma's datasource block.
  // DATABASE_URL: pooled (PgBouncer) URL used at runtime.
  // DIRECT_URL: direct (unpooled) URL used for migrations / introspection.
  // Optional here so tests and mail-only runs don't require a database; Prisma
  // surfaces a clear error at query time if DATABASE_URL is unset.
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),

  ALLOWLIST_HOSTS: z.string()
    .default('imap.gmail.com,smtp.gmail.com,outlook.office365.com,smtp.office365.com')
    .transform((str) => new Set(str.split(',').map((s) => s.trim()).filter(Boolean))),

  // ── Auth (JWT) ──────────────────────────────────────────────────────────────
  // Signing secret for access + refresh tokens. Required in production; a fixed
  // dev fallback is used only for NODE_ENV=development|test (see auth/jwt.ts).
  JWT_SECRET: z.string().optional(),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // ── Mailbox token encryption-at-rest ────────────────────────────────────────
  // 32-byte key (hex = 64 chars, or base64) used to AES-256-GCM encrypt the
  // OAuth accessToken/refreshToken columns on Mailbox before they hit Postgres.
  // Required only when reading/writing mailbox credentials (see creds/crypto.ts).
  MAILBOX_ENCRYPTION_KEY: z.string().optional(),

  // ── Stripe billing ──────────────────────────────────────────────────────────
  // STRIPE_SECRET_KEY: API key for the Stripe SDK client.
  // STRIPE_WEBHOOK_SECRET: the `whsec_...` signing secret for the
  //   /api/billing/webhook endpoint — every event's `Stripe-Signature` header is
  //   cryptographically verified against it; unsigned payloads are rejected.
  // STRIPE_PRICE_PRO / STRIPE_PRICE_AGENCY: price IDs mapped to tenant tiers by
  //   the subscription webhooks.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_AGENCY: z.string().optional(),

  // ── OAuth connect flow (multi-account mailbox consent) ──────────────────────
  // Public base URL of THIS backend, used to build the OAuth redirect_uri
  // (`<base>/api/auth/oauth/<provider>/callback`). It must byte-for-byte match the
  // redirect URI registered in the Google/Microsoft app registration. When unset,
  // the callback URL is derived from the incoming request origin (fine for local
  // dev; set it explicitly behind a proxy / in production).
  OAUTH_REDIRECT_BASE_URL: z.string().optional(),

  // ── Campaign open/click tracking ─────────────────────────────────────────
  // Public base URL used to build tracking pixel/redirect links embedded in
  // sent emails (<base>/t/o/:token, <base>/t/c/:token) — see
  // campaigns/trackedHtml.ts. Falls back to OAUTH_REDIRECT_BASE_URL, then a
  // localhost default for dev.
  PUBLIC_BASE_URL: z.string().optional(),
  // HMAC secret for signing tracking tokens (campaigns/trackingToken.ts).
  // Falls back to JWT_SECRET so no extra config is required in most setups.
  TRACKING_SECRET: z.string().optional(),

  // ── Scraper lead-import gateway (server-to-server) ──────────────────────────
  // The headless YouTube scraper has no browser JWT session, so POST
  // /api/leads/import authenticates with a shared secret in the `X-Import-Key`
  // header (timing-safe compared against IMPORT_API_KEY) and writes every row
  // into IMPORT_TENANT_ID's leads via the same tenant-scoped Prisma client the
  // JWT routes use. Both are optional so tests / mail-only runs need neither; the
  // import route returns 503 until both are set.
  IMPORT_API_KEY: z.string().optional(),
  IMPORT_TENANT_ID: z.string().optional(),

  // ── In-app YouTube scraper ──────────────────────────────────────────────────
  // The "Scraper" view lets a logged-in user launch the Python scraper from the
  // CRM. The backend spawns `PYTHON_BIN main.py --niche <tenantId>` inside
  // SCRAPER_DIR, then imports that run's profiles/<tenant>/leads.csv into the
  // user's own tenant. The scraper is bundled in-repo at ./scraper; SCRAPER_DIR
  // points at it (../scraper for local `npm run dev`, /app/scraper in the Docker
  // image) and its Python deps must be installed (scraper/requirements.txt).
  // When unset, /api/scraper returns 503. PYTHON_BIN defaults to `python`
  // (the Docker image uses the venv at /opt/venv/bin/python).
  SCRAPER_DIR: z.string().optional(),
  PYTHON_BIN: z.string().default('python'),
  // Path to a Netscape-format cookies.txt from a logged-in Google/YouTube
  // session — yt-dlp's fix for "Sign in to confirm you're not a bot" (an
  // authenticated session beats IP reputation / browser impersonation alone).
  // Read directly by the Python scraper (main.py / transcript_extractor.py);
  // listed here only so it's discoverable alongside the other scraper config.
  // Not validated as a real config value the Node backend consumes — it's
  // forwarded to the child process purely via `env: { ...process.env }` in
  // scraper/service.ts. NEVER commit the file this points to (see .gitignore).
  // Legacy single-file cookie; auto-adopted into the rotation pool below on the
  // scraper's first run (see scraper/cookie_manager.py).
  YTDLP_COOKIES_FILE: z.string().optional(),
  // Directory (relative to SCRAPER_DIR, default "cookies") holding the pool of
  // Netscape cookie files the Python scraper rotates across. Unlike
  // YTDLP_COOKIES_FILE, this one the Node backend actively manages: the
  // /api/scraper/cookies routes list/upload/delete files here (cookieService.ts).
  // Forwarded to the child via env so Python resolves the same directory.
  YTDLP_COOKIES_DIR: z.string().default('cookies'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
  throw new Error('Invalid environment variables');
}

export const config = parsed.data;

// Fail fast in production if the JWT secret is missing: tokens are worthless
// (and insecure) without a real, stable secret.
if (config.NODE_ENV === 'production' && !config.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}
