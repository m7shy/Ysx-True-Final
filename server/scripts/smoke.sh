#!/usr/bin/env bash
# Smoke test for IMAP/SMTP gateway
# - Requires the server running (PORT or BASE_URL)
# - MANDATORY: server health endpoint must respond 200
# - OPTIONAL: live Gmail/Zoho provider smoke, only when creds are configured
# - Fails fast with meaningful exit codes
#
# Mandatory vs optional:
#   * Server boot + /api/mail/health  -> ALWAYS run, must pass.
#   * Live provider smoke (Gmail/Zoho) -> runs only when the required creds
#     exist. If creds are present and the provider smoke fails, this script
#     fails (exit 1). Missing creds skips ONLY the provider section (exit 0).

set -Eeuo pipefail
command -v bash >/dev/null || { echo "bash not found" >&2; exit 2; }

BASE_URL="${BASE_URL:-http://localhost:${PORT:-3001}}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

need() { local v="$1"; [ -n "${!v:-}" ] || fail "$v is not set"; }

# Curl helper: return non-zero on HTTP error
curl_json() {
  local method="${1:-GET}" path="$2" data="${3:-}"
  local tmp="$(mktemp)"
  local code
  if [ -n "$data" ]; then
    code=$(curl -sS -o "$tmp" -w "%{http_code}" \
      -X "$method" -H 'Content-Type: application/json' \
      --data "$data" "$BASE_URL$path") || true
  else
    code=$(curl -sS -o "$tmp" -w "%{http_code}" \
      -X "$method" "$BASE_URL$path") || true
  fi
  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    cat "$tmp"; rm -f "$tmp"; return 0
  fi
  echo "HTTP $code: $(cat "$tmp")" >&2
  rm -f "$tmp"; return 1
}

# --- MANDATORY: server health (no credentials required) ---
log "Health check (mandatory)..."
curl_json GET "/api/mail/health" >/dev/null || fail "health failed"
log "Health smoke OK"

# --- OPTIONAL: live provider smoke (only when Gmail creds are configured) ---
if [ -z "${GMAIL_USER:-}" ] || [ -z "${GMAIL_APP_PASSWORD:-}" ]; then
  log "Skipping live provider smoke: GMAIL_USER/GMAIL_APP_PASSWORD are not configured. Server health smoke already passed."
  exit 0
fi

# Creds are present: from here on, any failure is a real failure.
need ALLOWLIST_HOSTS

# --- Sanity: allowlist must include required Gmail hosts ---
case ",$ALLOWLIST_HOSTS," in
  *",imap.gmail.com,"*) : ;;
  *) fail "imap.gmail.com missing from ALLOWLIST_HOSTS";;
esac
case ",$ALLOWLIST_HOSTS," in
  *",smtp.gmail.com,"*) : ;;
  *) fail "smtp.gmail.com missing from ALLOWLIST_HOSTS";;
esac

# Optional Zoho check
HAS_ZOHO=0
if [ -n "${ZOHO_USER:-}" ] && [ -n "${ZOHO_APP_PASSWORD:-}" ]; then
  case ",$ALLOWLIST_HOSTS," in
    *",imap.zoho.com,"*|*",imap.zoho.eu,"*|*",imap.zoho.in,"*) : ;;
    *) log "WARN: Zoho creds set but zoho imap host not allowlisted";;
  esac
  case ",$ALLOWLIST_HOSTS," in
    *",smtp.zoho.com,"*|*",smtp.zoho.eu,"*|*",smtp.zoho.in,"*) : ;;
    *) log "WARN: Zoho creds set but zoho smtp host not allowlisted";;
  esac
  HAS_ZOHO=1
fi

log "Fetch last 3 from Gmail Sent..."
resp=$(curl_json GET "/api/mail/sent?provider=gmail&limit=3") || fail "fetch gmail sent failed"
echo "$resp" | grep -q '"items"' || fail "response missing items"

SUBJECT="SMOKE $(date -u +%FT%TZ)"
payload=$(printf '{"provider":"gmail","from":"%s","to":"%s","subject":"%s","text":"hello from smoke"}' \
  "$GMAIL_USER" "$GMAIL_USER" "$SUBJECT")

log "Send Gmail test message to self..."
send=$(curl_json POST "/api/mail/send" "$payload") || fail "gmail send failed"
echo "$send" | grep -q '"messageId"' || fail "no messageId in send response"

if [ "$HAS_ZOHO" -eq 1 ]; then
  log "Fetch last 2 from Zoho Sent..."
  respz=$(curl_json GET "/api/mail/sent?provider=zoho&limit=2") || fail "fetch zoho sent failed"
  echo "$respz" | grep -q '"items"' || fail "zoho response missing items"
fi

log "SMOKE OK"
