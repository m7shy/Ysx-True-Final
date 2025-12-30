#!/usr/bin/env bash
# Smoke test for IMAP/SMTP gateway
# - Requires the server running (PORT or BASE_URL)
# - Requires env: ALLOWLIST_HOSTS, GMAIL_USER, GMAIL_APP_PASSWORD (and optionally Zoho)
# - Fails fast with meaningful exit codes

set -Eeuo pipefail
command -v bash >/dev/null || { echo "bash not found" >&2; exit 2; }

BASE_URL="${BASE_URL:-http://localhost:${PORT:-3001}}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

need() { local v="$1"; [ -n "${!v:-}" ] || fail "$v is not set"; }

# --- Required envs ---
need ALLOWLIST_HOSTS
need GMAIL_USER
need GMAIL_APP_PASSWORD

# --- Sanity: allowlist must include required hosts ---
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

log "Health check..."
curl_json GET "/api/mail/health" >/dev/null || fail "health failed"

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
