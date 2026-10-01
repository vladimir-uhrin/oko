# OKO - Windows service oko-api: the public API from committed code (2026-10-01).
# Owner: "zacni zo vsetkym" to the proposal to separate the public API from the dev server.
#
#   oko-api  node <Base>\current\scripts\oko-dev-supervisor.mjs --port 4175 with OKO_ROLE=api: Vite from an
#            immutable release (scripts/oko-api-release.ps1) without file watching, HMR and dependency
#            pre-bundling - the ONE process with the flight history recorder, keeper, events, accounts and
#            the OpenSky credit governor; restarted on crash or hang like oko-dev.
#   oko-dev  gets OKO_API_UPSTREAM=http://localhost:4175: local UI development only, /api and /s are proxied
#            (scripts/lib/serverRole.mjs) - two recorders would write into one database and double the
#            OpenSky credits.
# Order (never two recorders at once): stop oko-dev -> start oko-api and wait for /api -> start oko-dev in
# proxy mode. The public tunnel keeps pointing to oko-dev meanwhile (dev proxies to oko-api); afterwards
#   powershell -ExecutionPolicy Bypass -File scripts\oko-publish.ps1 -SkipBuild
# points /api and /s straight to oko-api (oko-publish reads the port of the installed service).
# Rollback: -Uninstall (oko-dev runs everything again), then the same oko-publish call.
#
# Run from an elevated PowerShell after the first release:
#   powershell -ExecutionPolicy Bypass -File scripts\oko-api-release.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-oko-api-service.ps1
param(
  [switch]$Uninstall,
  [string]$Nssm = '',
  [string]$Node = 'C:\AI\OKO\bin\node-v24\node.exe',
  [int]$ApiPort = 4175,
  [int]$DevPort = 4173,
  [string]$Base = '',
  [int]$WaitSeconds = 180
)
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from an elevated PowerShell (Run as administrator).' }
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Base) { $Base = Join-Path (Split-Path -Parent $repo) 'oko-api' }
$current = Join-Path $Base 'current'
$logDir = Join-Path $repo '.gev-cache\logs'
if (-not $Nssm) { $Nssm = Join-Path (Split-Path -Parent $repo) 'bin\nssm.exe' }
if (-not (Test-Path -LiteralPath $Nssm)) { throw "nssm.exe not found: $Nssm" }
if (-not (Get-Service -Name 'oko-dev' -ErrorAction SilentlyContinue)) { throw 'service oko-dev missing (scripts\install-oko-services.ps1 first)' }

function Invoke-Nssm([string[]]$NssmArgs) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $Nssm @NssmArgs 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "nssm $($NssmArgs -join ' ') failed: $(($out | Out-String) -replace "`0", '')" }
}
function Wait-Api([int]$Port, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -Uri "http://localhost:$Port/api/history/status" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) { return $true } } catch { }
    Start-Sleep -Seconds 3
  }
  return $false
}

if ($Uninstall) {
  if (Get-Service -Name 'oko-api' -ErrorAction SilentlyContinue) {
    Stop-Service -Name 'oko-dev' -Force -ErrorAction SilentlyContinue
    Stop-Service -Name 'oko-api' -Force -ErrorAction SilentlyContinue
    Invoke-Nssm @('remove', 'oko-api', 'confirm')
    Write-Host 'removed service oko-api'
  }
  Invoke-Nssm @('reset', 'oko-dev', 'AppEnvironmentExtra')
  Start-Service -Name 'oko-dev'
  $ok = Wait-Api $DevPort $WaitSeconds
  Write-Host "oko-dev runs everything again: $(if ($ok) { 'OK' } else { 'NO ANSWER (see .gev-cache\logs\svc-oko-dev.log)' })"
  Write-Host 'next: powershell -ExecutionPolicy Bypass -File scripts\oko-publish.ps1 -SkipBuild  (tunnel /api back to oko-dev)'
  return
}

$supervisor = Join-Path $current 'scripts\oko-dev-supervisor.mjs'
foreach ($p in @($Node, $supervisor, (Join-Path $current 'node_modules\vite\bin\vite.js'), (Join-Path $current 'RELEASE'))) {
  if (-not (Test-Path -LiteralPath $p)) { throw "missing: $p (run scripts\oko-api-release.ps1 first)" }
}
if ($Node -match '\\AppData\\' -or (Get-Item -LiteralPath $Node -Force).Target) { throw "per-user or redirected path is not safe for a service: $Node" }
$nodeVersion = [version]((& $Node --version).Trim().TrimStart('v'))
if (-not (($nodeVersion.Major -eq 24 -and $nodeVersion -ge [version]'24.14.0') -or $nodeVersion.Major -eq 26)) { throw "Node $nodeVersion does not satisfy package.json engines" }
if (@(Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue).Count) { throw "port $ApiPort is already in use" }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Service definition (same settings as scripts/install-oko-services.ps1).
if (Get-Service -Name 'oko-api' -ErrorAction SilentlyContinue) {
  Stop-Service -Name 'oko-api' -Force -ErrorAction SilentlyContinue
  Invoke-Nssm @('set', 'oko-api', 'Application', $Node)
} else {
  Invoke-Nssm @('install', 'oko-api', $Node)
}
$log = Join-Path $logDir 'svc-oko-api.log'
$state = Join-Path $logDir 'oko-api-supervisor.json'
Invoke-Nssm @('set', 'oko-api', 'AppParameters', "$supervisor --port $ApiPort --state $state")
Invoke-Nssm @('set', 'oko-api', 'AppDirectory', $current)
Invoke-Nssm @('set', 'oko-api', 'AppEnvironmentExtra', 'OKO_ROLE=api')
Invoke-Nssm @('set', 'oko-api', 'DisplayName', 'OKO public API')
Invoke-Nssm @('set', 'oko-api', 'Description', "OKO public /api and /s on localhost:$ApiPort from an immutable release (scripts/oko-api-release.ps1); the one process with the flight history, events and accounts.")
Invoke-Nssm @('set', 'oko-api', 'Start', 'SERVICE_AUTO_START')
Invoke-Nssm @('set', 'oko-api', 'ObjectName', 'LocalSystem')
Invoke-Nssm @('set', 'oko-api', 'AppPriority', 'NORMAL_PRIORITY_CLASS')
Invoke-Nssm @('set', 'oko-api', 'AppExit', 'Default', 'Restart')
Invoke-Nssm @('set', 'oko-api', 'AppRestartDelay', '5000')
Invoke-Nssm @('set', 'oko-api', 'AppThrottle', '30000')
Invoke-Nssm @('set', 'oko-api', 'AppStopMethodConsole', '10000')
Invoke-Nssm @('set', 'oko-api', 'AppStdout', $log)
Invoke-Nssm @('set', 'oko-api', 'AppStderr', $log)
Invoke-Nssm @('set', 'oko-api', 'AppStdoutCreationDisposition', '4')
Invoke-Nssm @('set', 'oko-api', 'AppStderrCreationDisposition', '4')
Invoke-Nssm @('set', 'oko-api', 'AppRotateFiles', '1')
Invoke-Nssm @('set', 'oko-api', 'AppRotateOnline', '1')
Invoke-Nssm @('set', 'oko-api', 'AppRotateBytes', '10485760')
& sc.exe failure oko-api reset= 86400 actions= restart/10000/restart/10000/restart/60000 | Out-Null
# Start/stop rights for the installing user (scripts/oko-api-release.ps1 restarts it from a normal PowerShell).
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$sddl = ((& sc.exe sdshow oko-api) -join '').Trim()
if ($sddl -notmatch [regex]::Escape(";;;$sid)")) {
  $ace = "(A;;CCLCSWRPWPLORC;;;$sid)"
  $at = $sddl.IndexOf('S:')
  $new = if ($at -ge 0) { $sddl.Substring(0, $at) + $ace + $sddl.Substring($at) } else { $sddl + $ace }
  & sc.exe sdset oko-api $new | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'sc sdset oko-api failed' }
}
Write-Host 'service ready: oko-api'

# Switch over without two recorders: stop dev -> start api -> dev in proxy mode.
Stop-Service -Name 'oko-dev' -Force
Start-Sleep -Seconds 3
Start-Service -Name 'oko-api'
if (-not (Wait-Api $ApiPort $WaitSeconds)) {
  Stop-Service -Name 'oko-api' -Force -ErrorAction SilentlyContinue
  Start-Service -Name 'oko-dev'
  throw "oko-api did not answer within $WaitSeconds s - stopped it, oko-dev runs everything again (see $log)"
}
Write-Host "oko-api answers on localhost:$ApiPort"
Invoke-Nssm @('set', 'oko-dev', 'AppEnvironmentExtra', "OKO_API_UPSTREAM=http://localhost:$ApiPort")
Start-Service -Name 'oko-dev'
$devOk = Wait-Api $DevPort $WaitSeconds
Write-Host "oko-dev (proxy to oko-api) on localhost:$DevPort -> $(if ($devOk) { 'OK' } else { 'NO ANSWER (see .gev-cache\logs\svc-oko-dev.log)' })"
Write-Host 'next: powershell -ExecutionPolicy Bypass -File scripts\oko-publish.ps1 -SkipBuild  (tunnel /api and /s -> oko-api)'
