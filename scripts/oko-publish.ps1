# OKO - publish the production build to the public tunnel (2026-09-14).
# User: "velmi pomaly to nacita" - the dev server pushed hundreds of unbundled modules through the tunnel.
#
# What it does (idempotent, no secrets):
#   1. npm run build  -> dist/ (minified, hashed assets; Cloudflare caches them at the edge)
#   2. registers/refreshes a Scheduled Task "OKO public static" running scripts/oko-static-server.mjs
#      (127.0.0.1:4174, serves dist/, noindex) and (re)starts it so the new build is live
#   3. rewrites ~/.cloudflared/config-oko.yml: /api/* -> dev server (localhost:4173, the ONE process that
#      owns the live feeds), everything else -> the static build (localhost:4174); restarts the tunnel task
# Re-run after every change you want on the public address. Dev on localhost:4173 is untouched.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/oko-publish.ps1 [-SkipBuild] [-DevPort 4173] [-StaticPort 4174]
param(
  [switch]$SkipBuild,
  [int]$DevPort = 4173,
  [int]$StaticPort = 4174,
  [string]$Hostname = 'oko.uhrin.digital',
  [string]$TunnelName = 'oko',
  [string]$TunnelTaskName = 'OKO Cloudflare Tunnel',
  [string]$StaticTaskName = 'OKO public static'
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node not found in PATH' }
$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
$config = Join-Path $cfDir "config-$TunnelName.yml"
if (-not (Test-Path $config)) { throw "tunnel config missing: $config (run scripts/oko-tunnel-setup.ps1 first)" }

if (-not $SkipBuild) {
  Write-Host 'building dist/ ...'
  Push-Location $repo
  $buildOut = cmd /c "npm run build 2>&1"
  $buildCode = $LASTEXITCODE
  Pop-Location
  $buildOut | Select-Object -Last 8 | ForEach-Object { Write-Host "  $_" }
  if ($buildCode -ne 0) { throw "vite build failed (exit $buildCode)" }
}
if (-not (Test-Path (Join-Path $repo 'dist\index.html'))) { throw 'dist/index.html missing' }

# Static server task (at logon, current user, auto-restart); a restart picks up the fresh dist/.
$serverScript = Join-Path $repo 'scripts\oko-static-server.mjs'
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$serverScript`" --port $StaticPort --dir dist" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
if (Get-ScheduledTask -TaskName $StaticTaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $StaticTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $StaticTaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $StaticTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "OKO production build (dist/) on 127.0.0.1:$StaticPort for the public tunnel; /api goes to the dev server." | Out-Null
Start-ScheduledTask -TaskName $StaticTaskName
Start-Sleep -Seconds 3
Write-Host "static task: " (Get-ScheduledTask -TaskName $StaticTaskName).State

# Tunnel ingress: API to the dev server, the rest to the build. Keep tunnel id + credentials lines as they are.
$lines = Get-Content $config
$head = $lines | Where-Object { $_ -match '^(tunnel|credentials-file|logfile|loglevel):' }
$ingress = @"

ingress:
  - hostname: $Hostname
    path: ^/api(/.*)?$
    service: http://localhost:$DevPort
    originRequest:
      connectTimeout: 30s
  - hostname: $Hostname
    service: http://localhost:$StaticPort
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
"@
[System.IO.File]::WriteAllText($config, (($head -join "`n") + "`n" + $ingress + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "config rewritten: $config"
Stop-ScheduledTask -TaskName $TunnelTaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $TunnelTaskName
Start-Sleep -Seconds 6
Write-Host "tunnel task: " (Get-ScheduledTask -TaskName $TunnelTaskName).State
Write-Host "published: https://$Hostname/ (build) + /api -> localhost:$DevPort"
