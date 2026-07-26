# Set PORTAL_SMTP_PASS in server/.env without the secret ever appearing on
# screen, in shell history, or in a chat transcript.
#
# Provider-agnostic: PORTAL_SMTP_* is a plain host/port/user/pass transport, so
# it works with Outlook/M365, Gmail, SendPulse or any other SMTP server. Only
# the password is set here; set HOST/PORT/USER/FROM in .env directly.
#
# CURRENT SETUP (2026-07-26): pointed at Outlook -
#   smtp.office365.com:587 as YoussefAhmed@outreach.ysxvisuals.com,
#   reusing MICROSOFT_APP_PASSWORD, which was verified to authenticate.
# Gmail was the earlier choice and its app password is REVOKED
# (534-5.7.9 WebLoginRequired), so do not reach for Gmail by default.
#
# This script therefore exists for ROTATION - when the Outlook app password is
# changed, or when moving the fallback to a different provider.
#
# Usage, from server\:
#   powershell -ExecutionPolicy Bypass -File scripts\set-smtp-pass.ps1
#
# App passwords are typically 16 characters and are often displayed in groups
# of four; the display spaces are stripped automatically.
#
# Afterwards, restart the service and confirm alerting flipped to ok:
#   Restart-Service -Name ysx-backend -Force        (elevated)
#   curl -H "X-Health-Token: <token>" https://crm.ysxvisuals.com/api/health/deep

$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '..\.env' | Resolve-Path
Write-Host "Target: $envPath"

$secure = Read-Host -Prompt 'SMTP app password for PORTAL_SMTP_USER (input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# Google displays app passwords in four groups of four; the spaces are display
# only and must not be sent to the SMTP server.
$plain = $plain -replace '\s', ''

if ([string]::IsNullOrWhiteSpace($plain)) { Write-Error 'Empty input - nothing written.'; exit 1 }
if ($plain.Length -ne 16) {
  Write-Warning "Expected 16 characters, got $($plain.Length). Continuing anyway, but double-check it."
}

# Back up before editing - .env is the single most load-bearing file on this VM.
$backup = "$envPath.bak-smtp-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $envPath $backup
Write-Host "Backup written: $backup"

$lines = Get-Content $envPath
$found = $false
$out = foreach ($line in $lines) {
  if ($line -match '^PORTAL_SMTP_PASS=') { $found = $true; "PORTAL_SMTP_PASS=$plain" } else { $line }
}
if (-not $found) { $out += "PORTAL_SMTP_PASS=$plain" }

Set-Content -Path $envPath -Value $out -Encoding UTF8
$plain = $null

# Report length only - never the value.
$written = (Get-Content $envPath | Where-Object { $_ -match '^PORTAL_SMTP_PASS=' }) -replace '^PORTAL_SMTP_PASS=', ''
Write-Host "PORTAL_SMTP_PASS written ($($written.Length) chars). Value not displayed."
Write-Host ''
Write-Host 'Next:  Restart-Service -Name ysx-backend -Force   (elevated)'
Write-Host 'Then re-run the deep health check - alerting should read ok, not degraded.'
