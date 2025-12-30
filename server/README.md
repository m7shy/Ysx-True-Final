
# Secure Mail Gateway

A secure Node.js + TypeScript backend to act as a gateway for IMAP/SMTP operations.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Environment:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. Run Development:
   ```bash
   npm run dev
   ```

## Docker

Build the image:
```bash
docker build -t mail-gateway .
```

Run the container:
```bash
docker run --env-file .env -p 3001:3001 mail-gateway
```

## Architecture

- **Express**: Web server framework.
- **Helmet**: Sets secure HTTP headers.
- **Zod**: Validates environment variables at startup.
- **Pino**: Structured logging with sensitive data redaction.
- **TypeScript**: Strict type checking with ESM modules.

## API

- `GET /api/health`: Health check.
- `GET /api/mail/sent`: Fetch sent emails via IMAP.
- `GET /api/mail/sent/:uid`: Fetch a specific email body by UID.
- `POST /api/mail/send`: Send an email via SMTP.
- `GET /metrics`: Prometheus metrics.

## Runbook

### Credential Rotation
1. **App Passwords**:
   - Generate a new App Password in the provider's security portal (Google/Zoho).
   - Update `GMAIL_APP_PASSWORD` or `ZOHO_APP_PASSWORD` in the `.env` file or environment variables.
   - Restart the service: `docker restart mail-gateway` or `npm start`.
2. **OAuth2**:
   - If using OAuth, update `*_REFRESH_TOKEN` variables. The service automatically handles access token generation.

### Diagnosis Guide
| Status Code | Meaning | Action |
|-------------|---------|--------|
| **401** | Authentication Failed | Check `API_KEY` or provider credentials in `.env`. Verify App Password hasn't been revoked. |
| **429** | Rate Limit Exceeded | The upstream provider (Gmail/Zoho) is throttling requests. The service implements exponential backoff, but reduce traffic if persistent. |
| **500** | Internal Error | Check logs for stack traces. Likely a configuration issue or unhandled parsing error. |
| **503** | Upstream Unavailable | Transient network issue with Gmail/Zoho. Retry the request. |
| **504** | Gateway Timeout | The IMAP/SMTP operation took longer than 15s. Check network latency or attachment size. |

### IMAP Folder Fallback
The service attempts to find the "Sent" folder in this order:
1. IMAP `SPECIAL-USE` flag (`\Sent`).
2. Common names: "Sent", "Sent Mail", "Sent Items", "Enviados", "[Gmail]/Sent Mail".
3. **Action**: If emails aren't syncing, check the provider's web interface to ensure the Sent folder is exposed to IMAP.

### Provider Hostnames
| Provider | IMAP Host | Port | SMTP Host | Port |
|----------|-----------|------|-----------|------|
| **Gmail** | `imap.gmail.com` | 993 (SSL) | `smtp.gmail.com` | 465 (SSL) |
| **Zoho** | `imap.zoho.com` | 993 (SSL) | `smtp.zoho.com` | 465 (SSL) |

### Logging & Security
- **Library**: Pino is used for structured JSON logging.
- **Redaction**: Authorization headers, passwords, and tokens are redacted automatically.
- **Policy**: Never log message bodies or attachment content in production.

### Metrics & Monitoring
Metrics are exposed at `GET /metrics` (Prometheus format).

**Key Metrics**:
- `send_total`: Counter of sent emails.
- `fetch_total`: Counter of IMAP fetch operations.
- `errors_total`: Counter of errors labeled by code (AUTH, TIMEOUT, etc).
- `send_duration_ms`: Histogram of SMTP latency.

**Sample PromQL**:
- **Error Rate**: `rate(errors_total[5m])`
- **95th Percentile Latency**: `histogram_quantile(0.95, rate(send_duration_ms_bucket[5m]))`
