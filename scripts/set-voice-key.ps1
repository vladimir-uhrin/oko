# scripts/set-voice-key.ps1 - vlozi kluc hlasovej sluzby ai-translators do .env (2026-10-03).
# Kluc pise vlastnik sam do maskovanej vyzvy v paneli Terminal - neprechadza cez agenta, nevypise sa,
# nezostane v historii prikazov. Existujuce riadky AI_TRANSLATORS_* sa nahradia, ostatne .env ostava
# bajt po bajte (BOM aj konce riadkov). Potom: Restart-Service oko-dev (a po vydani aj oko-api).
#
#   .\scripts\set-voice-key.ps1 [-Url http://192.168.2.43:9140/mcp]
param([string]$Url = 'http://192.168.2.43:9140/mcp')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'

$secure = Read-Host -AsSecureString 'AI_TRANSLATORS_MCP_KEY (vloz kluc, nezobrazi sa)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$key = $key.Trim()
if (-not $key) { Write-Host 'Prazdny kluc - nic sa nezapisalo.'; exit 2 }
if ($key -match '\s') { Write-Host 'Kluc obsahuje medzeru alebo novy riadok - nic sa nezapisalo.'; exit 2 }

$bytes = @()
if (Test-Path $envPath) { $bytes = [IO.File]::ReadAllBytes($envPath) }
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
$text = [Text.Encoding]::UTF8.GetString($bytes)
if ($hasBom) { $text = $text.Substring(1) }
$nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }
$kept = @($text -split "`r?`n" | Where-Object { $_ -notmatch '^\s*AI_TRANSLATORS_(MCP_KEY|MCP_URL|TOKEN)\s*=' })
$replaced = (($text -split "`r?`n") | Where-Object { $_ -match '^\s*AI_TRANSLATORS_(MCP_KEY|MCP_URL|TOKEN)\s*=' }).Count
while ($kept.Count -gt 0 -and $kept[-1] -eq '') { $kept = $kept[0..($kept.Count - 2)] }
$kept += "AI_TRANSLATORS_MCP_URL=$Url"
$kept += "AI_TRANSLATORS_MCP_KEY=$key"
$out = ($kept -join $nl) + $nl
$enc = New-Object Text.UTF8Encoding($hasBom)
[IO.File]::WriteAllText($envPath, $out, $enc)
Write-Host ("Zapisane do .env: adresa {0}, kluc {1} znakov (nahradene riadky: {2}). Teraz: Restart-Service oko-dev" -f $Url, $key.Length, $replaced)
