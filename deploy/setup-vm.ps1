# Run this ONCE from an elevated ("Run as Administrator") PowerShell window.
# Installs Caddy (reverse proxy + automatic HTTPS) and NSSM (Windows Service
# manager), opens firewall ports, and registers the Node app as a service.

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS'

Write-Host '== Installing Caddy + NSSM via Chocolatey ==' -ForegroundColor Cyan
choco install caddy nssm -y

Write-Host '== Windows Firewall: allow inbound 80/443 (Caddy) ==' -ForegroundColor Cyan
New-NetFirewallRule -DisplayName 'Caddy HTTP'  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Caddy HTTPS' -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -ErrorAction SilentlyContinue

Write-Host '== Registering ysx-backend as a Windows Service (NSSM) ==' -ForegroundColor Cyan
$nodeExe = (Get-Command node).Source
nssm install ysx-backend $nodeExe "dist/index.js"
nssm set ysx-backend AppDirectory "$repo\server"
nssm set ysx-backend AppEnvironmentExtra `
  "NODE_ENV=production" `
  "WEB_ORIGIN=https://ysxvisuals.online" `
  "OAUTH_REDIRECT_BASE_URL=https://ysxvisuals.online" `
  "SCRAPER_DIR=$repo\scraper" `
  "PYTHON_BIN=$repo\scraper\venv\Scripts\python.exe"
nssm set ysx-backend AppStdout "$repo\server\service.log"
nssm set ysx-backend AppStderr "$repo\server\service.err"
nssm set ysx-backend Start SERVICE_AUTO_START
nssm start ysx-backend

Write-Host '== Registering Caddy as a Windows Service ==' -ForegroundColor Cyan
$caddyExe = (Get-Command caddy).Source
nssm install caddy-proxy $caddyExe "run --config `"$repo\Caddyfile`""
nssm set caddy-proxy AppDirectory "$repo"
nssm set caddy-proxy AppStdout "$repo\caddy.log"
nssm set caddy-proxy AppStderr "$repo\caddy.err"
nssm set caddy-proxy Start SERVICE_AUTO_START
nssm start caddy-proxy

Write-Host '== Done. Check status with: nssm status ysx-backend / nssm status caddy-proxy ==' -ForegroundColor Green
Write-Host 'Also check Get-Content service.log / caddy.log for startup errors.' -ForegroundColor Green
