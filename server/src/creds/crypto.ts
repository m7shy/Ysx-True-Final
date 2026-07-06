import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Symmetric encryption for the OAuth token columns on `Mailbox`.
 *
 * The Prisma schema documents accessToken/refreshToken as ciphertext: secrets
 * are encrypted before they are written and decrypted on read, so Postgres only
 * ever stores ciphertext. We use AES-256-GCM (authenticated encryption) with a
 * per-value random IV. The key comes from MAILBOX_ENCRYPTION_KEY (32 bytes,
 * supplied as 64 hex chars or base64).
 *
 * Wire format (single string stored in the DB column):
 *   v1:<iv base64>:<authTag base64>:<ciphertext base64>
 */

const VERSION = 'v1';

function loadKey(): Buffer {
  const raw = config.MAILBOX_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'MAILBOX_ENCRYPTION_KEY is not set — cannot encrypt/decrypt mailbox tokens. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }

  // Accept hex (64 chars) or base64.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== 32) {
    throw new Error(
      `MAILBOX_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
        'Use 64 hex chars or a 32-byte base64 value.',
    );
  }
  return key;
}

/** Encrypt a plaintext secret. Returns the versioned wire string. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12); // 96-bit nonce recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Decrypt a wire string produced by encryptSecret(). Throws on tampering. */
export function decryptSecret(payload: string): string {
  const key = loadKey();
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted secret (expected v1:iv:tag:ciphertext).');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** True when a mailbox-encryption key is configured (used to gate features). */
export function hasEncryptionKey(): boolean {
  return Boolean(config.MAILBOX_ENCRYPTION_KEY);
}
