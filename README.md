# YSX Flow

An intelligent email follow-up assistant.

## IMAP/SMTP Quickstart

The backend gateway (`server/`) provides a secure interface for IMAP and SMTP operations, allowing the frontend to list sent emails and send new ones using server-side credentials.

### 1. Server Configuration

Navigate to the server directory and set up your environment variables:

```bash
cd server
cp .env.example .env
```

Edit `.env` to include your provider credentials. **Do not commit this file.**

```env
# Server Config
PORT=3001
WEB_ORIGIN=http://localhost:5173
ALLOWLIST_HOSTS=imap.gmail.com,smtp.gmail.com,imap.zoho.com,smtp.zoho.com

# Credentials (choose your provider)
GMAIL_USER=your_email@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

ZOHO_USER=your_email@zoho.com
ZOHO_APP_PASSWORD=xxxxxxxx
```

### 2. Running the Server

Install dependencies and start the backend:

```bash
cd server
npm install
npm start
# Or for development with watch mode:
npm run dev
```

### 3. Verification (Smoke Test)

Use the provided script to verify connectivity and API health:

```bash
# Make executable (once)
chmod +x server/scripts/smoke.sh

# Run
./server/scripts/smoke.sh
```

### Provider Notes

*   **Gmail**:
    *   You must enable **2-Step Verification**.
    *   Generate an **App Password** (Manage Google Account > Security > 2-Step Verification > App passwords). Use this instead of your login password.
*   **Zoho Mail**:
    *   If Multi-Factor Authentication (MFA) is enabled, you must generate an **App Password**.
*   **Sent Items**:
    *   Providers like Gmail and Zoho automatically save emails sent via SMTP to your "Sent" folder.
    *   This gateway does **not** manually append sent messages to IMAP to avoid duplicates.
