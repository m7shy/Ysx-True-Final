# Encrypt a server/.env for off-VM backup. PowerShell version - no bash needed.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts\backup-env.ps1
#
# By default it encrypts the PRODUCTION .env, not whichever checkout you happen
# to be sitting in. There are multiple YSXXS checkouts on this machine and their
# .env files are NOT the same - encrypting the working copy would back up the
# wrong secrets, and that is only discovered at restore time. Override with:
#   -EnvPath <path>
#
# Why encrypt: .env holds MAILBOX_ENCRYPTION_KEY, which is UNRECOVERABLE. Every
# mailbox OAuth token in the database is encrypted with it, so losing it means
# reconnecting every mailbox by hand. It also holds JWT_SECRET, the live
# database URL, mail passwords and the Gemini key. That is why this file must
# never go to cloud storage in plaintext - cloud copies persist after deletion.
#
# Decrypt with:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in .env.enc -out .env

param(
  [string]$EnvPath = 'C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server\.env'
)

$ErrorActionPreference = 'Stop'

# openssl ships with Git for Windows but is usually not on PATH for cmd/PowerShell.
$openssl = @(
  'C:\Program Files\Git\usr\bin\openssl.exe',
  'C:\Program Files\Git\mingw64\bin\openssl.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $openssl) {
  $cmd = Get-Command openssl -ErrorAction SilentlyContinue
  if ($cmd) { $openssl = $cmd.Source }
}
if (-not $openssl) { Write-Error 'openssl not found (expected with Git for Windows).'; exit 1 }

if (-not (Test-Path $EnvPath)) { Write-Error "No .env at $EnvPath"; exit 1 }

$outPath = "$EnvPath.enc"
$srcSize = (Get-Item $EnvPath).Length
Write-Host "Source:  $EnvPath ($srcSize bytes)"
Write-Host "Output:  $outPath"
Write-Host "openssl: $openssl"
Write-Host ''
# Prompt once here rather than letting openssl own the TTY: openssl's own
# prompt cannot be driven non-interactively, which makes the script impossible
# to test end-to-end, and it asks three separate times.
$p1 = Read-Host -Prompt 'Passphrase (input hidden)' -AsSecureString
$p2 = Read-Host -Prompt 'Confirm passphrase' -AsSecureString

function ConvertFrom-Secure([System.Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$pass = ConvertFrom-Secure $p1
if ($pass -ne (ConvertFrom-Secure $p2)) { Write-Error 'Passphrases do not match.'; exit 1 }
if ([string]::IsNullOrWhiteSpace($pass)) { Write-Error 'Empty passphrase.'; exit 1 }
if ($pass.Length -lt 12) { Write-Warning "Passphrase is only $($pass.Length) chars - this protects your entire production keyring." }

Write-Host ''
Write-Host 'Store the passphrase in a password manager. Without it this backup is unrecoverable.'
Write-Host ''

# -pass env: keeps the passphrase out of the command line, where it would be
# visible in a process listing. -pbkdf2 at a high iteration count because
# openssl's legacy key derivation is weak against offline brute force, and this
# ciphertext is going somewhere less trusted than the VM by definition.
$env:YSX_ENV_PASS = $pass
$tmp = [System.IO.Path]::GetTempFileName()
try {
  & $openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -pass env:YSX_ENV_PASS -in $EnvPath -out $outPath
  if ($LASTEXITCODE -ne 0) { Write-Error 'Encryption failed.'; exit 1 }

  # Verify the backup actually restores BEFORE trusting it. An unverified
  # backup is not a backup: a mistyped passphrase or a truncated write would
  # otherwise surface at the worst possible moment.
  & $openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:YSX_ENV_PASS -in $outPath -out $tmp
  if ($LASTEXITCODE -ne 0) { Write-Error 'Decryption failed - do NOT rely on this file.'; exit 1 }

  $a = Get-FileHash -Algorithm SHA256 $EnvPath
  $b = Get-FileHash -Algorithm SHA256 $tmp
  if ($a.Hash -eq $b.Hash) {
    Write-Host "VERIFIED: $outPath decrypts byte-for-byte back to the original."
    Write-Host "          $((Get-Item $outPath).Length) bytes encrypted, SHA256 $($a.Hash.Substring(0,16))..."
    Write-Host ''
    Write-Host 'Tell Claude it is ready and it will upload it to the private Drive folder.'
  } else {
    Write-Error 'MISMATCH - decrypted output differs from the original. Do NOT rely on this file.'
    exit 1
  }
} finally {
  Remove-Item Env:\YSX_ENV_PASS -ErrorAction SilentlyContinue
  $pass = $null
  if (Test-Path $tmp) { Remove-Item $tmp -Force }
}
