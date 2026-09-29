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
# 2026-09-28 (user bought okolive.sk): several public hostnames. -Hostnames get /api + /s -> dev server and the
# rest -> build; -Redirects ('host=https://origin') are routed whole to the static server, which answers 301
# (scripts/oko-static-server.mjs --redirect). DNS for another Cloudflare zone is a manual CNAME to the tunnel
# (see scripts/oko-tunnel-setup.ps1: cert.pem is bound to one zone).
#
# 2026-09-29 (user: "chcel by som dnes premigrovat na druhu domenu", then "nic nebolo zdielane ani publikovane ani
# indexovane"): okolive.sk is the only address. The old oko.uhrin.digital is not published at all (the tunnel's
# catch-all answers 404); only www.okolive.sk answers 301 to the apex. A redirect is only published once its target
# already serves this build through the tunnel (/robots.txt from our static server); until then the source host
# keeps serving the app, so DNS and publishing can happen in any order.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/oko-publish.ps1 [-SkipBuild] [-DevPort 4173] [-StaticPort 4174]
#        [-Hostnames okolive.sk] [-Redirects www.okolive.sk=https://okolive.sk]
param(
  [switch]$SkipBuild,
  [int]$DevPort = 4173,
  [int]$StaticPort = 4174,
  [string[]]$Hostnames = @('okolive.sk'),
  [string[]]$Redirects = @('www.okolive.sk=https://okolive.sk'),
  [string]$TunnelName = 'oko',
  [string]$TunnelTaskName = 'OKO Cloudflare Tunnel',
  [string]$StaticTaskName = 'OKO public static'
)
$ErrorActionPreference = 'Continue'
# -File passes "a,b" as ONE string; split it here so both call styles work.
$Hostnames = @($Hostnames | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Redirects = @($Redirects | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($h in $Hostnames) { if ($h -notmatch '^[a-z0-9.-]+$') { throw "bad hostname: $h" } }
foreach ($r in $Redirects) { if ($r -notmatch '^[a-z0-9.-]+=https://[a-z0-9.-]+$') { throw "bad redirect (host=https://origin): $r" } }
if ($Hostnames.Count -eq 0) { throw 'no hostname to publish' }
# A redirect to an origin that does not serve OKO yet would take the source host down (new domain before its DNS
# or certificate is live). Probe the target through the currently running tunnel: our static server answers
# /robots.txt with the noindex header and its own body. Not live -> keep serving the source host normally.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$liveRedirects = @()
foreach ($r in $Redirects) {
  $redirectHost, $target = $r -split '=', 2
  $live = $false
  try {
    $probe = Invoke-WebRequest -Uri "$target/robots.txt" -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0 -ErrorAction Stop
    $robotsTag = ($probe.Headers.GetEnumerator() | Where-Object { $_.Key -ieq 'X-Robots-Tag' } | Select-Object -First 1).Value
    $live = ($probe.StatusCode -eq 200) -and ([string]$robotsTag -match 'noindex') -and ([string]$probe.Content -match 'Disallow: /api/')
  } catch { $live = $false }
  if ($live) { $liveRedirects += $r }
  else {
    Write-Host "redirect $redirectHost -> $target postponed: $target does not serve OKO yet, $redirectHost keeps serving the app"
    if ($Hostnames -notcontains $redirectHost) { $Hostnames += $redirectHost }
  }
}
$Redirects = $liveRedirects
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
$redirectArgs = ($Redirects | ForEach-Object { " --redirect $_" }) -join ''
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$serverScript`" --port $StaticPort --dir dist$redirectArgs" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# -Priority 4 = Normal. Task Scheduler defaults to 7 (BelowNormal): with the machine busy (Docker, browser,
# Defender) the origin got almost no CPU and /api answered in 80-100 s -> 502 through the tunnel (2026-09-14).
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -Priority 4
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
$rules = @()
foreach ($h in $Hostnames) {
  $rules += @"
  - hostname: $h
    path: ^/(api|s)(/.*)?$
    service: http://localhost:$DevPort
    originRequest:
      connectTimeout: 30s
  - hostname: $h
    service: http://localhost:$StaticPort
    originRequest:
      connectTimeout: 30s
"@
}
foreach ($r in $Redirects) {
  $redirectHost = ($r -split '=')[0]
  $rules += @"
  - hostname: $redirectHost
    service: http://localhost:$StaticPort
    originRequest:
      connectTimeout: 30s
"@
}
$ingress = "`ningress:`n" + ($rules -join "`n") + "`n  - service: http_status:404`n"
[System.IO.File]::WriteAllText($config, (($head -join "`n") + "`n" + $ingress + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "config rewritten: $config"
Stop-ScheduledTask -TaskName $TunnelTaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $TunnelTaskName
Start-Sleep -Seconds 6
Write-Host "tunnel task: " (Get-ScheduledTask -TaskName $TunnelTaskName).State
Write-Host ("published: " + (($Hostnames | ForEach-Object { "https://$_/" }) -join ', ') + " (build) + /api -> localhost:$DevPort")
if ($Redirects.Count) { Write-Host ("301: " + ($Redirects -join ', ')) }
