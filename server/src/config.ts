
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

  // ── OAuth connect flow (multi-account mailbox consent) ──────────────────────
  // Public base URL of THIS backend, used to build the OAuth redirect_uri
  // (`<base>/api/auth/oauth/<provider>/callback`). It must byte-for-byte match the
  // redirect URI registered in the Google/Microsoft app registration. When unset,
  // the callback URL is derived from the incoming request origin (fine for local
  // dev; set it explicitly behind a proxy / in production).
  OAUTH_REDIRECT_BASE_URL: z.string().optional(),
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
