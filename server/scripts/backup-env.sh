#!/usr/bin/env bash
# Encrypt server/.env for off-VM backup.
#
# .env holds MAILBOX_ENCRYPTION_KEY, which is UNRECOVERABLE if lost: without it
# every stored mailbox OAuth token is undecryptable and every mailbox has to be
# reconnected by hand. It also holds JWT_SECRET, the database URL with live
# credentials, three mail passwords and the Gemini key.
#
# That is exactly why this file must never be uploaded to cloud storage in
# plaintext. One account compromise, one mis-shared folder or one bad OAuth
# grant would hand over the entire production keyring, and cloud copies persist
# after deletion. The ciphertext is safe to store anywhere; the passphrase is
# not, and must live only in a password manager.
#
# Usage, from server/ in Git Bash:
#   bash scripts/backup-env.sh
#
# Produces .env.enc next to .env. Decrypt with:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in .env.enc -out .env
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env in $(pwd)" >&2; exit 1; }

OUT=".env.enc"

# -pbkdf2 with a high iteration count: the default (MD5-based EVP_BytesToKey)
# is weak against offline brute force, and this ciphertext is going somewhere
# less trusted than the VM by definition.
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -in .env -out "$OUT"

# Prove it round-trips BEFORE trusting it as a backup. An unverified backup is
# not a backup — a wrong passphrase or a truncated write is only discovered at
# restore time, which is the worst possible moment.
echo
echo "Verifying the backup decrypts back to the original (re-enter the same passphrase):"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$OUT" -out "$TMP"

if cmp -s .env "$TMP"; then
  echo "VERIFIED: $OUT decrypts byte-for-byte back to .env ($(wc -c < "$OUT") bytes encrypted)"
  echo
  echo "Store the passphrase in a password manager. Without it this file is unrecoverable,"
  echo "and so is every mailbox token in the database."
else
  echo "MISMATCH — decrypted output differs from .env. Do NOT rely on this file." >&2
  exit 1
fi
