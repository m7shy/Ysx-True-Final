$ErrorActionPreference = "Stop"

$BASE    = "http://127.0.0.1:3001"
$ENVFILE = "F:\Junk\checkpoint2\YSX\server\.env"
$TO      = "sofffa.309.youssef@gmail.com"

function Read-EnvFile($path){
  $m=@{}
  Get-Content $path | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
      $k=$matches[1].Trim()
      $v=$matches[2].Trim().Trim('"')
      $m[$k]=$v
    }
  }
  return $m
}

function Mask-Secrets($json){
  # mask appPassword fields for printing
  return ($json -replace '("appPassword"\s*:\s*")[^"]*(")', '$1***$2')
}

function PostJson($url, $obj){
  $json = ($obj | ConvertTo-Json -Depth 30 -Compress)
  Write-Host "`nPOST $url"
  Write-Host (Mask-Secrets $json)
  $resp = curl.exe -s -H "Content-Type: application/json" -X POST $url -d $json
  Write-Host "RESPONSE: $resp"
  return $resp
}

function GetUrl($url){
  Write-Host "`nGET $url"
  $resp = curl.exe -s $url
  Write-Host "RESPONSE: $resp"
  return $resp
}

# --- 0) Health ---
$h = GetUrl "$BASE/api/health" | ConvertFrom-Json
if (-not $h.ok) { throw "Health failed: $($h | ConvertTo-Json -Compress)" }

# --- Load env ---
$envMap = Read-EnvFile $ENVFILE
$GMAIL_USER = $envMap["GMAIL_USER"]
$GMAIL_PASS = ($envMap["GMAIL_APP_PASSWORD"] -replace '\s','')
$MS_USER    = $envMap["MICROSOFT_USER"]
$MS_PASS    = ($envMap["MICROSOFT_APP_PASSWORD"] -replace '\s','')

if (-not $GMAIL_USER -or -not $GMAIL_PASS) { throw "Missing Gmail creds in .env (GMAIL_USER / GMAIL_APP_PASSWORD)" }
if (-not $MS_USER -or -not $MS_PASS)       { throw "Missing Microsoft creds in .env (MICROSOFT_USER / MICROSOFT_APP_PASSWORD)" }

Write-Host "`nLoaded env OK."
Write-Host "GMAIL_USER=$GMAIL_USER | PASS_LEN=$($GMAIL_PASS.Length)"
Write-Host "MS_USER=$MS_USER | PASS_LEN=$($MS_PASS.Length)"

# --- 1) SMTP verify ---
$svG = PostJson "$BASE/api/mail/smtp/verify" @{ provider="gmail"; user=$GMAIL_USER; appPassword=$GMAIL_PASS } | ConvertFrom-Json
if (-not $svG.ok) { throw "Gmail SMTP verify failed: $($svG | ConvertTo-Json -Compress)" }

$svM = PostJson "$BASE/api/mail/smtp/verify" @{ provider="microsoft"; user=$MS_USER; appPassword=$MS_PASS } | ConvertFrom-Json
if (-not $svM.ok) { throw "Microsoft SMTP verify failed: $($svM | ConvertTo-Json -Compress)" }

# --- 2) Send initial (capture messageId) ---
$msSend = PostJson "$BASE/api/mail/send" @{
  provider="microsoft"; user=$MS_USER; appPassword=$MS_PASS;
  to=$TO; subject="YSX MS INITIAL"; text="Initial test (Microsoft)."
} | ConvertFrom-Json
if (-not $msSend.ok) { throw "Microsoft send failed: $($msSend | ConvertTo-Json -Compress)" }
$msMsgIdRaw   = [string]$msSend.messageId
$msMsgIdClean = ($msMsgIdRaw -replace '[<>]','')
Write-Host "`nMS messageId(raw)=$msMsgIdRaw"
Write-Host "MS messageId(clean)=$msMsgIdClean"

$gmSend = PostJson "$BASE/api/mail/send" @{
  provider="gmail"; user=$GMAIL_USER; appPassword=$GMAIL_PASS;
  to=$TO; subject="YSX GMAIL INITIAL"; text="Initial test (Gmail)."
} | ConvertFrom-Json
if (-not $gmSend.ok) { throw "Gmail send failed: $($gmSend | ConvertTo-Json -Compress)" }
$gmMsgIdRaw   = [string]$gmSend.messageId
$gmMsgIdClean = ($gmMsgIdRaw -replace '[<>]','')
Write-Host "`nGmail messageId(raw)=$gmMsgIdRaw"
Write-Host "Gmail messageId(clean)=$gmMsgIdClean"

# --- 3) Fetch sent + confirm the messageIds show up ---
$sM = GetUrl "$BASE/api/mail/sent?provider=microsoft&limit=10" | ConvertFrom-Json
if (-not $sM.ok) { throw "Microsoft sent fetch failed: $($sM | ConvertTo-Json -Compress)" }
$foundM = $sM.items | Where-Object { $_.messageId -eq $msMsgIdRaw } | Select-Object -First 1
if (-not $foundM) { Write-Host "WARN: MS messageId not found in sent list yet (may be IMAP delay)." }

$sG = GetUrl "$BASE/api/mail/sent?provider=gmail&limit=10" | ConvertFrom-Json
if (-not $sG.ok) { throw "Gmail sent fetch failed: $($sG | ConvertTo-Json -Compress)" }
$foundG = $sG.items | Where-Object { $_.messageId -eq $gmMsgIdRaw } | Select-Object -First 1
if (-not $foundG) { Write-Host "WARN: Gmail messageId not found in sent list yet (may be IMAP delay)." }

# --- 4) Threaded follow-up (manual) ---
# NOTE: use RAW (<...>) for inReplyTo/references so headers are correct.
$msFU = PostJson "$BASE/api/mail/send" @{
  provider="microsoft"; user=$MS_USER; appPassword=$MS_PASS;
  to=$TO; subject="Re: YSX MS INITIAL"; text="Threaded follow-up (Microsoft).";
  inReplyTo=$msMsgIdRaw; references=@($msMsgIdRaw)
} | ConvertFrom-Json
if (-not $msFU.ok) { throw "Microsoft threaded follow-up failed: $($msFU | ConvertTo-Json -Compress)" }

$gmFU = PostJson "$BASE/api/mail/send" @{
  provider="gmail"; user=$GMAIL_USER; appPassword=$GMAIL_PASS;
  to=$TO; subject="Re: YSX GMAIL INITIAL"; text="Threaded follow-up (Gmail).";
  inReplyTo=$gmMsgIdRaw; references=@($gmMsgIdRaw)
} | ConvertFrom-Json
if (-not $gmFU.ok) { throw "Gmail threaded follow-up failed: $($gmFU | ConvertTo-Json -Compress)" }

# --- 5) Scheduled follow-up test ---
$nowIso       = (Get-Date).ToUniversalTime().ToString("o")
$scheduledIso = (Get-Date).ToUniversalTime().AddSeconds(20).ToString("o")

$jobM = PostJson "$BASE/api/followups/schedule" @{
  provider="microsoft"
  campaignId="ps-ms-1"
  recipientEmail=$TO
  senderEmail=$MS_USER
  scheduledAt=$scheduledIso
  initialSentAt=$nowIso
  originalMessageId=$msMsgIdClean
  to=$TO
  subject="Re: YSX MS INITIAL"
  body="Scheduled follow-up (Microsoft)."
} | ConvertFrom-Json
if (-not $jobM.ok) { throw "Microsoft schedule failed: $($jobM | ConvertTo-Json -Compress)" }

$jobG = PostJson "$BASE/api/followups/schedule" @{
  provider="gmail"
  campaignId="ps-gm-1"
  recipientEmail=$TO
  senderEmail=$GMAIL_USER
  scheduledAt=$scheduledIso
  initialSentAt=$nowIso
  originalMessageId=$gmMsgIdClean
  to=$TO
  subject="Re: YSX GMAIL INITIAL"
  body="Scheduled follow-up (Gmail)."
} | ConvertFrom-Json
if (-not $jobG.ok) { throw "Gmail schedule failed: $($jobG | ConvertTo-Json -Compress)" }

Write-Host "`nPolling followups for up to 60 seconds..."
for ($i=0; $i -lt 12; $i++){
  Start-Sleep -Seconds 5
  $f = GetUrl "$BASE/api/followups?limit=50" | ConvertFrom-Json
  if (-not $f.ok) { throw "Followups list failed: $($f | ConvertTo-Json -Compress)" }

  $mItem = $f.items | Where-Object { $_.id -eq $jobM.job.id } | Select-Object -First 1
  $gItem = $f.items | Where-Object { $_.id -eq $jobG.job.id } | Select-Object -First 1

  Write-Host ("Tick {0}: MS={1} | GM={2}" -f ($i+1), $mItem.status, $gItem.status)

  if ($mItem.status -eq "sent" -and $gItem.status -eq "sent") { break }
}

Write-Host "`nDONE. Check the recipient inbox to confirm threading/conversation grouping."
