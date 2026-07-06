import bcrypt from 'bcryptjs';

// bcrypt work factor. 12 is a sane production default (~250ms/hash on modern
// hardware) — high enough to slow brute force, low enough to keep login snappy.
const SALT_ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  // bcrypt.compare is constant-time and tolerates malformed hashes (returns false).
  return bcrypt.compare(plaintext, hash);
}
