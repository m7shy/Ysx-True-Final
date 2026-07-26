# Set PORTAL_SMTP_PASS in server/.env without the secret ever appearing on
# screen, in shell history, or in a chat transcript.
#
# Why this exists: PORTAL_SMTP_PASS being empty is the reason there is no
# alerting on anything. The watchdog has been detecting real failures and
# writing them to a logfile nobody reads (see HANDOFF 2026-07-25). Everything
# else for alerting is already configured — HOST, PORT, USER, FROM and
# ALERT_EMAIL are all set.
#
# Usage, from server\:
#   powershell -ExecutionPolicy Bypass -File scripts\set-smtp-pass.ps1
#
# Get the value first: https://myaccount.google.com/apppasswords
# (requires 2-Step Verification on that Google account). It is 16 characters,
# usually shown in four groups of four — spaces are stripped automatically.
#
# Afterwards, restart the service and confirm alerting flipped to ok:
#   Restart-Service -Name ysx-backend -Force        (elevated)
#   curl -H "X-Health-Token: <token>" https://crm.ysxvisuals.com/api/health/deep

$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '..\.env' | Resolve-Path
Write-Host "Target: $envPath"

$secure = Read-Host -Prompt 'Gmail app password (input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# Google displays app passwords in four groups of four; the spaces are display
# only and must not be sent to the SMTP server.
$plain = $plain -replace '\s', ''

if ([string]::IsNullOrWhiteSpace($plain)) { Write-Error 'Empty input — nothing written.'; exit 1 }
if ($plain.Length -ne 16) {
  Write-Warning "Expected 16 characters, got $($plain.Length). Continuing anyway, but double-check it."
}

# Back up before editing — .env is the single most load-bearing file on this VM.
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

# Report length only — never the value.
$written = (Get-Content $envPath | Where-Object { $_ -match '^PORTAL_SMTP_PASS=' }) -replace '^PORTAL_SMTP_PASS=', ''
Write-Host "PORTAL_SMTP_PASS written ($($written.Length) chars). Value not displayed."
Write-Host ''
Write-Host 'Next:  Restart-Service -Name ysx-backend -Force   (elevated)'
Write-Host 'Then re-run the deep health check — alerting should read ok, not degraded.'
