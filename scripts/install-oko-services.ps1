# OKO - Windows services instead of logon tasks (2026-09-29).
# User: "potrebujem aj dobre nastavit samotny server na PC aby sa spustal s windowsami a nepadal".
#
# Before: three Task Scheduler tasks started only at user logon (OKO dev server, OKO public static,
# OKO Cloudflare Tunnel); the static server and the tunnel had visible console windows, and closing
# them took okolive.sk down (2026-09-29, LastTaskResult 0xC000013A). After: three services managed
# by NSSM - the same tool this machine already uses for d4y, saveotter, nginx and the other tunnels:
#   oko-dev     node scripts/oko-dev-supervisor.mjs -> Vite on localhost:4173 (/api + /s); a crash
#               or a hung server (no answer for 5 minutes) is restarted, see the supervisor header
#   oko-static  node scripts/oko-static-server.mjs on 127.0.0.1:4174 (dist/, the public build)
#   oko-tunnel  cloudflared tunnel --config ~/.cloudflared/config-oko.yml run oko
# All three start with Windows (no logon needed), have no window to close, are restarted 5 s after
# any exit, log to .gev-cache/logs/svc-<name>.log (rotated at 10 MB) and run at Normal priority
# (Below Normal starved the dev server on 2026-09-14). They run as LocalSystem like the other NSSM
# services here. The old tasks are only disabled; -Uninstall removes the services and turns the
# tasks back on. The user who runs this gets start/stop rights on the three services, so
# scripts/oko-publish.ps1 can restart them from a normal (non-elevated) PowerShell.
#
# Run once from an elevated PowerShell (Run as administrator):
#   powershell -ExecutionPolicy Bypass -File scripts\install-oko-services.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-oko-services.ps1 -Uninstall
param(
  [switch]$Uninstall,
  [string]$Nssm = '',
  [string]$Node = 'C:\Program Files\nodejs\node.exe',
  [string]$Cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe',
  [string]$TunnelConfig = (Join-Path $env:USERPROFILE '.cloudflared\config-oko.yml'),
  [string]$TunnelName = 'oko',
  [int]$DevPort = 4173,
  [int]$StaticPort = 4174,
  [string[]]$Redirects = @('www.okolive.sk=https://okolive.sk'),
  [string]$PublicUrl = 'https://okolive.sk'
)
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from an elevated PowerShell (Run as administrator).' }

$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo '.gev-cache\logs'
$services = @('oko-dev', 'oko-static', 'oko-tunnel')
$tasks = @('OKO dev server', 'OKO public static', 'OKO Cloudflare Tunnel')
# NSSM gets the arguments as one string; paths without spaces need no quoting (PowerShell 5.1 mangles
# embedded quotes when calling native programs).
if ($repo -match ' ' -or $TunnelConfig -match ' ') { throw "paths with spaces are not supported here: $repo / $TunnelConfig" }
$Redirects = @($Redirects | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($r in $Redirects) { if ($r -notmatch '^[a-z0-9.-]+=https://[a-z0-9.-]+$') { throw "bad redirect (host=https://origin): $r" } }

# nssm.exe: a stable copy next to the repository (C:\AI\OKO\bin), so the services do not depend on
# another project's folder.
$stableNssm = Join-Path (Split-Path -Parent $repo) 'bin\nssm.exe'
if (-not $Nssm) {
  if (Test-Path -LiteralPath $stableNssm) { $Nssm = $stableNssm }
  else {
    $found = @('C:\AI\Video downloader\project-root\nssm.exe', (Get-Command nssm -ErrorAction SilentlyContinue).Source) |
      Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $found) { throw 'nssm.exe not found; pass -Nssm <path to nssm.exe>' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stableNssm) | Out-Null
    Copy-Item -LiteralPath $found -Destination $stableNssm
    $Nssm = $stableNssm
  }
}

function Invoke-Nssm([string[]]$NssmArgs) {
  # PowerShell 5.1 with ErrorActionPreference Stop turns any stderr line of a native program into a
  # terminating error; judge nssm by its exit code instead.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $Nssm @NssmArgs 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "nssm $($NssmArgs -join ' ') failed: $(($out | Out-String) -replace "`0", '')" }
}

if ($Uninstall) {
  foreach ($name in $services) {
    if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
      Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
      Invoke-Nssm @('remove', $name, 'confirm')
      Write-Host "removed service $name"
    }
  }
  foreach ($task in $tasks) {
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
      Enable-ScheduledTask -TaskName $task | Out-Null
      Start-ScheduledTask -TaskName $task
      Write-Host "task back on: $task"
    }
  }
  return
}

$devSupervisor = Join-Path $repo 'scripts\oko-dev-supervisor.mjs'
$staticServer = Join-Path $repo 'scripts\oko-static-server.mjs'
foreach ($p in @($Node, $Cloudflared, $TunnelConfig, $devSupervisor, $staticServer, (Join-Path $repo 'node_modules\vite\bin\vite.js'), (Join-Path $repo 'dist\index.html'))) {
  if (-not (Test-Path -LiteralPath $p)) { throw "missing: $p" }
}
# Services run outside this user's session: a per-user path, or one redirected into an app container
# (the Claude app's MSIX redirects AppData), does not exist for them (2026-09-21, 0x80070002).
foreach ($p in @($Node, $Cloudflared)) {
  if ($p -match '\\AppData\\') { throw "per-user path is not safe for a service: $p" }
  if ((Get-Item -LiteralPath $p -Force).Target) { throw "redirected path (link): $p" }
}
# The services must run a Node that satisfies package.json engines (>=24.14 <25 or 26.x). On this
# machine the system Node was 22.15 and the dev server ran on it unnoticed (2026-09-30); a copy of
# Node 24 outside AppData lives in C:\AI\OKO\bin\node-v24\node.exe - pass it with -Node.
$nodeVersion = [version]((& $Node --version).Trim().TrimStart('v'))
$nodeOk = ($nodeVersion.Major -eq 24 -and $nodeVersion -ge [version]'24.14.0') -or ($nodeVersion.Major -eq 26)
if (-not $nodeOk) { throw "Node $nodeVersion at $Node does not satisfy package.json engines (>=24.14 <25 or 26.x); pass -Node C:\AI\OKO\bin\node-v24\node.exe" }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 1. The logon tasks go quiet (disabled, not deleted - rollback is -Uninstall).
foreach ($task in $tasks) {
  if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $task | Out-Null
    Write-Host "task disabled: $task"
  }
}

# 2. Leftovers of the tasks: stopping a task does not end the processes it started (Vite survived
# Stop-ScheduledTask on 2026-09-13/14). Only processes that are clearly ours are ended.
function Stop-OkoPortOwner([int]$Port, [string]$Pattern) {
  foreach ($conn in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.CommandLine -match $Pattern) {
      Write-Host "ending leftover pid $($proc.ProcessId) on port $Port"
      & taskkill.exe /PID $proc.ProcessId /T /F | Out-Null
    } else {
      throw "port $Port is used by another program (pid $($proc.ProcessId)): $($proc.CommandLine)"
    }
  }
}
Start-Sleep -Seconds 2
Stop-OkoPortOwner -Port $DevPort -Pattern 'vite'
Stop-OkoPortOwner -Port $StaticPort -Pattern 'oko-static-server'
foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue)) {
  if ($proc.CommandLine -match 'config-oko\.yml') {
    Write-Host "ending leftover tunnel pid $($proc.ProcessId)"
    & taskkill.exe /PID $proc.ProcessId /T /F | Out-Null
  }
}

# 3. Services.
function Grant-OkoServiceControl([string]$Name) {
  # Start, stop, query and read rights for the user who installs (scripts/oko-publish.ps1 restarts
  # the static server and the tunnel from a normal PowerShell).
  $sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  $sddl = ((& sc.exe sdshow $Name) -join '').Trim()
  if ($sddl -match [regex]::Escape(";;;$sid)")) { return }
  $ace = "(A;;CCLCSWRPWPLORC;;;$sid)"
  $at = $sddl.IndexOf('S:')
  $new = if ($at -ge 0) { $sddl.Substring(0, $at) + $ace + $sddl.Substring($at) } else { $sddl + $ace }
  & sc.exe sdset $Name $new | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "sc sdset $Name failed" }
}

function Set-OkoService([string]$Name, [string]$Display, [string]$Description, [string]$App, [string]$AppArgs, [string]$Start) {
  if (Get-Service -Name $Name -ErrorAction SilentlyContinue) {
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    Invoke-Nssm @('set', $Name, 'Application', $App)
  } else {
    Invoke-Nssm @('install', $Name, $App)
  }
  $log = Join-Path $logDir "svc-$Name.log"
  Invoke-Nssm @('set', $Name, 'AppParameters', $AppArgs)
  Invoke-Nssm @('set', $Name, 'AppDirectory', $repo)
  Invoke-Nssm @('set', $Name, 'DisplayName', $Display)
  Invoke-Nssm @('set', $Name, 'Description', $Description)
  Invoke-Nssm @('set', $Name, 'Start', $Start)
  Invoke-Nssm @('set', $Name, 'ObjectName', 'LocalSystem')
  Invoke-Nssm @('set', $Name, 'AppPriority', 'NORMAL_PRIORITY_CLASS')
  Invoke-Nssm @('set', $Name, 'AppExit', 'Default', 'Restart')
  Invoke-Nssm @('set', $Name, 'AppRestartDelay', '5000')
  Invoke-Nssm @('set', $Name, 'AppThrottle', '30000')
  Invoke-Nssm @('set', $Name, 'AppStopMethodConsole', '10000')
  # NSSM 2.24 (the build on this machine) ends the whole process tree on stop by itself; the
  # AppKillProcessTree switch exists only in later pre-releases and 2.24 rejects it.
  Invoke-Nssm @('set', $Name, 'AppStdout', $log)
  Invoke-Nssm @('set', $Name, 'AppStderr', $log)
  Invoke-Nssm @('set', $Name, 'AppStdoutCreationDisposition', '4')
  Invoke-Nssm @('set', $Name, 'AppStderrCreationDisposition', '4')
  Invoke-Nssm @('set', $Name, 'AppRotateFiles', '1')
  Invoke-Nssm @('set', $Name, 'AppRotateOnline', '1')
  Invoke-Nssm @('set', $Name, 'AppRotateBytes', '10485760')
  # If nssm.exe itself ever dies, the service manager restarts it.
  & sc.exe failure $Name reset= 86400 actions= restart/10000/restart/10000/restart/60000 | Out-Null
  Grant-OkoServiceControl $Name
  Write-Host "service ready: $Name ($Display)"
}

$redirectArgs = ($Redirects | ForEach-Object { " --redirect $_" }) -join ''
Set-OkoService -Name 'oko-static' -Display 'OKO public static' -Start 'SERVICE_AUTO_START' -App $Node `
  -AppArgs "$staticServer --port $StaticPort --dir dist$redirectArgs" `
  -Description "OKO production build (dist/) on 127.0.0.1:$StaticPort for the public tunnel; /api goes to oko-dev."
Set-OkoService -Name 'oko-tunnel' -Display 'OKO Cloudflare Tunnel' -Start 'SERVICE_AUTO_START' -App $Cloudflared `
  -AppArgs "tunnel --config $TunnelConfig run $TunnelName" `
  -Description 'Cloudflare Tunnel oko: okolive.sk -> localhost (static build + /api).'
Set-OkoService -Name 'oko-dev' -Display 'OKO dev server' -Start 'SERVICE_DELAYED_AUTO_START' -App $Node `
  -AppArgs "$devSupervisor --port $DevPort" `
  -Description "OKO dev server (Vite on localhost:$DevPort, live feeds and /api) under a supervisor that restarts it when it crashes or hangs."

# 4. Start and check.
foreach ($name in @('oko-static', 'oko-tunnel', 'oko-dev')) { Start-Service -Name $name }
function Wait-Http([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { return $true } } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}
$staticOk = Wait-Http "http://127.0.0.1:$StaticPort/robots.txt" 30
$devOk = Wait-Http "http://localhost:$DevPort/robots.txt" 180
$publicOk = Wait-Http "$PublicUrl/robots.txt" 60
foreach ($name in $services) { Write-Host ("{0,-11} {1}" -f $name, (Get-Service -Name $name).Status) }
Write-Host "static 127.0.0.1:$StaticPort -> $(if ($staticOk) { 'OK' } else { 'NO ANSWER (see .gev-cache\logs\svc-oko-static.log)' })"
Write-Host "dev    localhost:$DevPort -> $(if ($devOk) { 'OK' } else { 'NO ANSWER (see .gev-cache\logs\svc-oko-dev.log)' })"
Write-Host "public $PublicUrl -> $(if ($publicOk) { 'OK' } else { 'NO ANSWER (see .gev-cache\logs\svc-oko-tunnel.log)' })"
