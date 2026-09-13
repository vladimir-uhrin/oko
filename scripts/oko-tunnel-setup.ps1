# OKO - Cloudflare Tunnel for the local dev server (2026-09-13).
# User: "daj mi to zatial pod domenu uhrin.digital cez CF tunel, ale SEO noindex".
#
# What it does (idempotent, no secrets in this file):
#   1. creates the named tunnel "oko" if missing (credentials JSON lands in ~/.cloudflared, never read here)
#   2. writes ~/.cloudflared/config-oko.yml: oko.uhrin.digital -> http://localhost:4173 (Vite dev server, bind stays localhost)
#   3. routes DNS: CNAME oko.uhrin.digital -> <tunnel>.cfargotunnel.com (skips if it already exists)
#   4. registers a Scheduled Task "OKO Cloudflare Tunnel" (at logon, current user, auto-restart) and starts it
#   5. prints tunnel info
# Same pattern as the other tunnels on this machine (config-*.yml + service/task); noindex lives in the app
# (index.html meta robots, X-Robots-Tag + robots.txt in vite.config.js). Cloudflare Access (login) is set in the
# Zero Trust dashboard, not here.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/oko-tunnel-setup.ps1 [-Hostname oko.uhrin.digital] [-Port 4173]
param(
  [string]$TunnelName = 'oko',
  [string]$Hostname = 'oko.uhrin.digital',
  [int]$Port = 4173,
  [string]$TaskName = 'OKO Cloudflare Tunnel',
  [switch]$RouteDns,
  [string]$OriginCert = ''
)
# PowerShell 5.1 turns native stderr (cloudflared's "version outdated" warning) into a terminating error
# under ErrorActionPreference=Stop, so native calls go through cmd.exe with stderr merged/discarded.
$ErrorActionPreference = 'Continue'
$cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cf)) { throw "cloudflared not found at $cf (winget install Cloudflare.cloudflared)" }
$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
$config = Join-Path $cfDir "config-$TunnelName.yml"
$log = Join-Path $cfDir "$TunnelName.log"

function Invoke-Cf([string]$CfArgs, [switch]$KeepStderr) {
  $redirect = if ($KeepStderr) { '2>&1' } else { '2>nul' }
  $out = cmd /c "`"$cf`" $CfArgs $redirect" | Out-String
  return $out
}

function Get-TunnelId {
  $json = Invoke-Cf 'tunnel list -o json'
  if (-not $json.Trim()) { return $null }
  $rows = $json | ConvertFrom-Json
  $row = $rows | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
  if ($row) { return $row.id } else { return $null }
}

$id = Get-TunnelId
if (-not $id) {
  Write-Host "creating tunnel $TunnelName ..."
  Write-Host (Invoke-Cf "tunnel create $TunnelName" -KeepStderr).Trim()
  $id = Get-TunnelId
  if (-not $id) { throw "tunnel $TunnelName was not created" }
} else {
  Write-Host "tunnel $TunnelName exists: $id"
}

$credentials = Join-Path $cfDir "$id.json"
if (-not (Test-Path $credentials)) { throw "credentials file missing: $credentials (create the tunnel on this machine)" }

$yaml = @"
tunnel: $id
credentials-file: $credentials
logfile: $log
loglevel: info

ingress:
  - hostname: $Hostname
    service: http://localhost:$Port
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
"@
[System.IO.File]::WriteAllText($config, $yaml, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "config written: $config"

# DNS: the origin certificate (~/.cloudflared/cert.pem) is bound to ONE zone chosen at `cloudflared tunnel login`
# (on this machine: palmshub.net). `tunnel route dns` with that cert appends the cert's zone to the hostname
# (it created oko.uhrin.digital.palmshub.net on 2026-09-13), so for another zone create the CNAME in the
# Cloudflare dashboard (DNS > uhrin.digital > CNAME oko -> <tunnel-id>.cfargotunnel.com, proxied), or pass
# -RouteDns together with -OriginCert pointing at a cert logged in for that zone.
Write-Host "DNS record needed (proxied): CNAME $Hostname -> $id.cfargotunnel.com"
if ($RouteDns) {
  if ($OriginCert) { $env:TUNNEL_ORIGIN_CERT = $OriginCert }
  Write-Host "routing DNS $Hostname -> tunnel via cloudflared ..."
  $route = Invoke-Cf "tunnel route dns $TunnelName $Hostname" -KeepStderr
  if ($route -match 'already exists|already configured|already has') { Write-Host "DNS route already present" } else { Write-Host $route.Trim() }
}

$action = New-ScheduledTaskAction -Execute $cf -Argument "tunnel --config `"$config`" run $TunnelName" -WorkingDirectory $cfDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "cloudflared tunnel $TunnelName -> $Hostname -> localhost:$Port (OKO dev server). Config: $config" | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8
Write-Host "task state: " (Get-ScheduledTask -TaskName $TaskName).State
Write-Host (Invoke-Cf "tunnel info $TunnelName" -KeepStderr).Trim()
Write-Host "done: https://$Hostname/ (noindex; protect it with Cloudflare Access in Zero Trust > Access > Applications)"
