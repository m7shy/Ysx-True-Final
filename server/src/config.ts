
import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  ALLOWLIST_HOSTS: z.string()
    .default('imap.gmail.com,smtp.gmail.com,imap.zoho.com,smtp.zoho.com')
    .transform((str) => new Set(str.split(',').map((s) => s.trim()).filter(Boolean))),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),
  ZOHO_USER: z.string().optional(),
  ZOHO_APP_PASSWORD: z.string().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
  throw new Error('Invalid environment variables');
}

export const config = parsed.data;
