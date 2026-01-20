Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# =========================
# DAGGER FULL MAIL TEST (PS7)
# - Compile
# - Start server
# - Test /sent for microsoft + gmail (never 500)
# - Send initial + follow-up emails from both providers
# - Confirm messages appear in /sent
# - Attempt reply-check (auto-discover) after you reply manually
# =========================

$RepoRoot = "F:\Junk\checkpoint2\YSXX"
$BaseUrl  = "http://localhost:3001"
$ToEmail  = "sofffa.309.youssef@gmail.com"

Set-Location $RepoRoot

function Fail([string]$msg) { throw $msg }

function Assert-Exists([string]$path, [string]$msg) {
  if (-not (Test-Path $path)) { Fail $msg }
}

function Run-Exe([string]$File, [string[]]$ArgumentList, [string]$FailMsg) {
  & $File @ArgumentList
  if ($LASTEXITCODE -ne 0) { Fail "$FailMsg (exit=$LASTEXITCODE)" }
}

function Parse-CurlResponse([string]$raw) {
  $lines = $raw -split "`r?`n"
  $statusLine = ($lines | Where-Object { $_ -match '^HTTP/\d\.\d\s+\d+' } | Select-Object -First 1)
  if (-not $statusLine) { $statusLine = "NO_STATUS_LINE" }

  $idx = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -eq "") { $idx = $i; break }
  }

  $body = ""
  if ($idx -ge 0 -and ($idx + 1) -lt $lines.Count) {
    $body = ($lines[($idx+1)..($lines.Count-1)] -join "`n").Trim()
  }

  $statusCode = $null
  $m = [regex]::Match($statusLine, 'HTTP/\d\.\d\s+(\d+)')
  if ($m.Success) { $statusCode = [int]$m.Groups[1].Value }

  $code = $null
  $message = $null
  $json = $null
  try {
    if ($body.StartsWith("{") -or $body.StartsWith("[")) {
      $json = $body | ConvertFrom-Json
      if ($null -ne $json.code) { $code = [string]$json.code }
      if ($null -ne $json.message) { $message = [string]$json.message }
    }
  } catch { }

  [pscustomobject]@{
    StatusLine = $statusLine.Trim()
    StatusCode = $statusCode
    Body       = $body
    Json       = $json
    Code       = $code
    Message    = $message
  }
}

function Curl-Call([string]$url, [string]$method = "GET", [string]$jsonBody = $null) {
  if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Fail "curl.exe not found in PATH" }

  if ($method -eq "GET") {
    $raw = & curl.exe -sS -i $url
    return (Parse-CurlResponse $raw)
  }

  $tmp = Join-Path $env:TEMP ("dagger_payload_" + [Guid]::NewGuid().ToString("N") + ".json")
  if ($null -ne $jsonBody) {
    Set-Content -Path $tmp -Value $jsonBody -Encoding UTF8
  } else {
    Set-Content -Path $tmp -Value "{}" -Encoding UTF8
  }

  try {
    $raw = & curl.exe -sS -i -X $method $url -H "Content-Type: application/json" --data-binary "@$tmp"
    return (Parse-CurlResponse $raw)
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue | Out-Null
  }
}

function Assert-RepoLayout {
  Assert-Exists ".\server" "Missing .\server. Repo root wrong? Current: $PWD"
  Assert-Exists ".\server\src" "Missing .\server\src"
  Assert-Exists ".\server\package.json" "Missing .\server\package.json"
  Assert-Exists ".\server\.env" "Missing .\server\.env"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "node not found in PATH" }
  if (-not (Get-Command cmd.exe -ErrorAction SilentlyContinue)) { Fail "cmd.exe not found" }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail "npm.cmd not found in PATH" }
}

function Compile-ServerTs {
  Write-Host "==> COMPILING: server TypeScript (npm.cmd to avoid policy prompts)"
  Run-Exe "cmd.exe" @("/c", 'cd server && npm.cmd run build') "TypeScript build failed"
  Write-Host "    OK: TypeScript compile"
}

function Get-ListeningProcessId3001 {
  $out = & cmd.exe /c "netstat -ano | findstr :3001" 2>$null
  if (-not $out) { return $null }

  foreach ($line in ($out -split "`r?`n")) {
    $t = $line.Trim()
    if (-not $t) { continue }
    $m = [regex]::Match($t, ':\b3001\b\s+\S+\s+LISTENING\s+(\d+)\s*$')
    if ($m.Success) { return [int]$m.Groups[1].Value }
  }
  return $null
}

function Stop-ServerByProcessId([int]$ProcessId) {
  if (-not $ProcessId) { return }
  & cmd.exe /c "taskkill /F /PID $ProcessId" | Out-Null
}

function Start-ServerBackground([hashtable]$EnvOverrides) {
  $setParts = @()
  foreach ($k in $EnvOverrides.Keys) {
    $val = [string]$EnvOverrides[$k]
    $setParts += "set $k=$val"
  }
  $setPrefix = ""
  if ($setParts.Count -gt 0) { $setPrefix = ($setParts -join " && ") + " && " }

  $cmd = $setPrefix + 'cd server && start "" /b npm.cmd run dev'
  Run-Exe "cmd.exe" @("/c", $cmd) "Failed to start server"
}

function Wait-ServerReady {
  Write-Host "==> WAITING: server on $BaseUrl"
  $max = 200
  for ($i=0; $i -lt $max; $i++) {
    $listenProcessId = Get-ListeningProcessId3001
    if ($listenProcessId) {
      try {
        $resp = Curl-Call "$BaseUrl/api/mail/health"
        if ($resp.StatusCode -eq 200) {
          Write-Host "    OK: server ready (ProcessId=$listenProcessId)"
          return $listenProcessId
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail "Server did not become ready on $BaseUrl"
}

function Print-Resp([string]$label, $resp) {
  Write-Host "---- $label ----"
  Write-Host $resp.StatusLine

  if ($resp.StatusCode -eq 200) {
    Write-Host "(Body suppressed for 200 responses)"
    return
  }

  if ($resp.StatusCode -eq 401 -or $resp.StatusCode -eq 403) {
    if ($resp.Code)    { Write-Host "code: $($resp.Code)" }
    if ($resp.Message) { Write-Host "message: $($resp.Message)" }
    if (-not $resp.Code -and -not $resp.Message) {
      $p = $resp.Body
      if ($p.Length -gt 400) { $p = $p.Substring(0, 400) + "…" }
      if ($p) { Write-Host $p }
    }
    return
  }

  $preview = $resp.Body
  if ($preview.Length -gt 400) { $preview = $preview.Substring(0, 400) + "…" }
  if ($preview) { Write-Host $preview }
}

function Assert-Not500([string]$label, $resp) {
  if ($resp.StatusLine -match '\s500\b') {
    Fail "FAIL [$label]: returned 500"
  }
}

function Test-Sent([string]$provider) {
  $label = "SENT $provider"
  $resp = Curl-Call "$BaseUrl/api/mail/sent?provider=$provider&limit=5"
  Print-Resp $label $resp
  Assert-Not500 $label $resp
  return $resp
}

function Send-Mail([string]$provider, [string]$to, [string]$subject, [string]$body) {
  $payloadObj = [pscustomobject]@{
    to      = $to
    subject = $subject
    body    = $body
  }
  $jsonBody = $payloadObj | ConvertTo-Json -Depth 20

  $label = "SEND $provider"
  $resp = Curl-Call "$BaseUrl/api/mail/send?provider=$provider" "POST" $jsonBody
  Print-Resp $label $resp
  Assert-Not500 $label $resp

  if ($resp.StatusCode -ne 200) { return $null }

  # routes.ts returns { ok: true, messageId: ... }
  try {
    if ($resp.Json -and $resp.Json.messageId) { return [string]$resp.Json.messageId }
  } catch { }
  return $null
}

function Find-SentItemBySubject([string]$provider, [string]$subject) {
  $resp = Curl-Call "$BaseUrl/api/mail/sent?provider=$provider&limit=50"
  Assert-Not500 "FIND $provider" $resp
  if ($resp.StatusCode -ne 200 -or -not $resp.Json) { return $null }

  try {
    $items = $resp.Json.items
    foreach ($it in $items) {
      if ($it.subject -eq $subject) { return $it }
    }
  } catch { }
  return $null
}

function Discover-ReplyCheckPaths {
  # Try to find routes containing "reply" in server/src
  $paths = New-Object System.Collections.Generic.List[string]
  $files = Get-ChildItem -Path ".\server\src" -Recurse -File -Include *.ts,*.tsx,*.js,*.mjs -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    try {
      $matches = Select-String -Path $f.FullName -Pattern 'router\.(get|post|put|patch|delete)\(\s*["'']([^"'']*reply[^"'']*)["'']' -AllMatches -ErrorAction SilentlyContinue
      foreach ($m in $matches) {
        foreach ($mm in $m.Matches) {
          $p = $mm.Groups[2].Value
          if ($p -and -not $paths.Contains($p)) { $paths.Add($p) }
        }
      }
    } catch { }
  }

  # Common fallbacks if search finds nothing
  if ($paths.Count -eq 0) {
    @(
      "/api/mail/reply-check",
      "/api/mail/replies/check",
      "/api/mail/replyCheck",
      "/api/mail/reply_check",
      "/api/mail/check-replies"
    )
  } else {
    # Normalize to /api/mail prefix if the route is mounted under /api/mail
    $out = @()
    foreach ($p in $paths) {
      if ($p.StartsWith("/api/")) { $out += $p }
      elseif ($p.StartsWith("/")) { $out += ("/api/mail" + $p) }
      else { $out += ("/api/mail/" + $p) }
    }
    $out | Select-Object -Unique
  }
}

function Try-ReplyCheck([string]$provider, $sentItem, [string]$subject) {
  $candidates = Discover-ReplyCheckPaths
  Write-Host "==> Reply-check route candidates:"
  $candidates | ForEach-Object { Write-Host "    $_" }

  $uid = $null
  $msgId = $null
  try { if ($sentItem -and $sentItem.uid) { $uid = $sentItem.uid } } catch { }
  try { if ($sentItem -and $sentItem.id)  { $msgId = $sentItem.id } } catch { }

  foreach ($path in $candidates) {
    $urlBase = "$BaseUrl$path"

    # Attempt 1: GET with provider + uid + subject
    $q = "provider=$provider"
    if ($uid)   { $q += "&uid=$uid" }
    if ($subject) { $q += "&subject=$([uri]::EscapeDataString($subject))" }
    $resp1 = Curl-Call ($urlBase + "?" + $q)
    if ($resp1.StatusCode -ne 404) {
      Print-Resp "REPLY-CHECK GET $provider ($path)" $resp1
      Assert-Not500 "REPLY-CHECK GET $provider" $resp1
      if ($resp1.StatusCode -eq 200) { return }
    }

    # Attempt 2: POST with provider + uid + messageId + subject
    $payloadObj = [pscustomobject]@{
      provider  = $provider
      uid       = $uid
      messageId = $msgId
      subject   = $subject
      to        = $ToEmail
    }
    $jsonBody = $payloadObj | ConvertTo-Json -Depth 20
    $resp2 = Curl-Call $urlBase "POST" $jsonBody
    if ($resp2.StatusCode -ne 404) {
      Print-Resp "REPLY-CHECK POST $provider ($path)" $resp2
      Assert-Not500 "REPLY-CHECK POST $provider" $resp2
      if ($resp2.StatusCode -eq 200) { return }
    }
  }

  Write-Host "Reply-check endpoint not detected (all candidates returned 404)."
  Write-Host "If you tell me the real reply-check route path + required params, I’ll wire it into this script exactly."
}

# ----------------- MAIN -----------------
Assert-RepoLayout

Write-Host "==============================================="
Write-Host "DAGGER FULL TEST: /sent + send + followups + reply-check"
Write-Host "Repo: $RepoRoot"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "To: $ToEmail"
Write-Host "==============================================="

Compile-ServerTs

# Stop anything already listening on 3001
$existingProcessId = Get-ListeningProcessId3001
if ($existingProcessId) {
  Write-Host "==> Port 3001 LISTENING (ProcessId=$existingProcessId). Stopping it..."
  Stop-ServerByProcessId $existingProcessId
  Start-Sleep -Milliseconds 900
}

# Start server
Write-Host "==> Starting server (background)..."
Start-ServerBackground @{}
$serverProcessId = Wait-ServerReady

try {
  # Connectivity tests
  $null = Test-Sent "microsoft"
  $null = Test-Sent "gmail"

  # Send initial + follow-up from Microsoft + Gmail
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $msSubject1 = "DAGGER MS TEST $stamp"
  $msSubject2 = "Re: DAGGER MS TEST $stamp (Follow-up 1)"
  $ggSubject1 = "DAGGER GMAIL TEST $stamp"
  $ggSubject2 = "Re: DAGGER GMAIL TEST $stamp (Follow-up 1)"

  Write-Host "==> Sending Microsoft initial..."
  $msMsgId1 = Send-Mail "microsoft" $ToEmail $msSubject1 "DAGGER: Microsoft initial email. Reply to this message to test reply-check."
  Start-Sleep -Seconds 2
  Write-Host "==> Sending Microsoft follow-up..."
  $msMsgId2 = Send-Mail "microsoft" $ToEmail $msSubject2 "DAGGER: Microsoft follow-up #1. Reply to confirm follow-up handling."

  Write-Host "==> Sending Gmail initial..."
  $ggMsgId1 = Send-Mail "gmail" $ToEmail $ggSubject1 "DAGGER: Gmail initial email. Reply to this message to test reply-check."
  Start-Sleep -Seconds 2
  Write-Host "==> Sending Gmail follow-up..."
  $ggMsgId2 = Send-Mail "gmail" $ToEmail $ggSubject2 "DAGGER: Gmail follow-up #1. Reply to confirm follow-up handling."

  # Confirm they exist in /sent
  Write-Host "==> Confirming sent items exist..."
  $msItem1 = Find-SentItemBySubject "microsoft" $msSubject1
  $msItem2 = Find-SentItemBySubject "microsoft" $msSubject2
  $ggItem1 = Find-SentItemBySubject "gmail" $ggSubject1
  $ggItem2 = Find-SentItemBySubject "gmail" $ggSubject2

  Write-Host "Microsoft initial found: "  -NoNewline
  if ($msItem1) { Write-Host "YES (uid=$($msItem1.uid))" } else { Write-Host "NO" }

  Write-Host "Microsoft follow-up found:" -NoNewline
  if ($msItem2) { Write-Host "YES (uid=$($msItem2.uid))" } else { Write-Host "NO" }

  Write-Host "Gmail initial found:     "  -NoNewline
  if ($ggItem1) { Write-Host "YES (uid=$($ggItem1.uid))" } else { Write-Host "NO" }

  Write-Host "Gmail follow-up found:   " -NoNewline
  if ($ggItem2) { Write-Host "YES (uid=$($ggItem2.uid))" } else { Write-Host "NO" }

  Write-Host ""
  Write-Host "==> ACTION REQUIRED:"
  Write-Host "Reply manually (from your inbox) to these subjects:"
  Write-Host "  - $msSubject1"
  Write-Host "  - $ggSubject1"
  Write-Host ""
  Read-Host "Press ENTER after replying so the script can run reply-check"

  # Reply check attempts (auto-discover routes)
  Write-Host "==> Running reply-check (Microsoft)..."
  Try-ReplyCheck "microsoft" $msItem1 $msSubject1

  Write-Host "==> Running reply-check (Gmail)..."
  Try-ReplyCheck "gmail" $ggItem1 $ggSubject1

  Write-Host ""
  Write-Host "==============================================="
  Write-Host "DONE"
  Write-Host "==============================================="

} finally {
  if ($serverProcessId) {
    Write-Host "==> Stopping server ProcessId=$serverProcessId"
    Stop-ServerByProcessId $serverProcessId
  }
}
