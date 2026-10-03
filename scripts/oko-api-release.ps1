# OKO - release of the public API (service oko-api) from committed code (2026-10-01).
# Owner: "zacni zo vsetkym" to the proposal to separate the public API from the dev server.
#
# Before: okolive.sk/api and /s were answered by the dev server straight from the WORKING TREE - every saved
# server file restarted the public API and half-finished code went live. Now the public API runs from an
# immutable copy of a commit:
#   1. git worktree of HEAD (or -Commit) -> copied to <Base>\releases\<hash>-<time> without .git
#   2. links to the shared runtime data of the main checkout (not in git): node_modules, .gev-cache (history
#      caches, share store, logs), .auth-data (accounts), .gev-logs; .env is copied (a change of .env needs a
#      new release, like a service restart before)
#   3. RELEASE file with the commit (header X-Oko-Release on every API answer)
#   4. <Base>\current -> the new release; the service oko-api is restarted (if installed) and must answer
#      /api/history/status within -WaitSeconds; older releases beyond -Keep are removed
# Rollback: run it again with -Commit <older hash>.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\oko-api-release.ps1 [-Commit HEAD] [-Base C:\AI\OKO\oko-api]
#        [-ApiPort 4175] [-Keep 3] [-WaitSeconds 180] [-NoRestart]
param(
  [string]$Commit = 'HEAD',
  [string]$Base = '',
  [int]$ApiPort = 4175,
  [int]$Keep = 3,
  [int]$WaitSeconds = 180,
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Base) { $Base = Join-Path (Split-Path -Parent $repo) 'oko-api' }
if ($Base -match ' ' -or $repo -match ' ') { throw "paths with spaces are not supported: $Base / $repo" }

# PowerShell 5.1 with ErrorActionPreference Stop turns any stderr line of a native program (git prints
# "Preparing worktree" there) into a terminating error; judge git by its exit code instead.
function Invoke-Git([string[]]$GitArgs) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & git -C $repo @GitArgs 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "git $($GitArgs -join ' ') failed: $(($out | Out-String).Trim())" }
  return (($out | Where-Object { $_ -is [string] }) -join "`n").Trim()
}
$hash = Invoke-Git @('rev-parse', '--short', $Commit)
if ($hash -notmatch '^[0-9a-f]{7,40}$') { throw "unknown commit: $Commit" }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$releases = Join-Path $Base 'releases'
$target = Join-Path $releases "$hash-$stamp"
$current = Join-Path $Base 'current'
New-Item -ItemType Directory -Force -Path $releases | Out-Null

# 1. Clean copy of the commit (a worktree, then a copy without .git - the worktree is removed again).
$tmp = Join-Path $env:TEMP "oko-api-$hash-$stamp"
Invoke-Git @('worktree', 'add', '--detach', $tmp, $hash) | Out-Null
if (-not (Test-Path (Join-Path $tmp 'vite.config.js'))) { throw "worktree not created: $tmp" }
try {
  & robocopy $tmp $target /E /XD .git /XF .git /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
} finally {
  try { Invoke-Git @('worktree', 'remove', '--force', $tmp) | Out-Null } catch { Write-Host "warning: $($_.Exception.Message)" }
  try { Invoke-Git @('worktree', 'prune') | Out-Null } catch { }
}

# 2. Shared runtime data of the main checkout (links, never copies - one history, one account store).
function Resolve-LinkTarget([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Target) { return [string]($item.Target | Select-Object -First 1) }
  return $item.FullName
}
foreach ($name in @('node_modules', '.gev-cache', '.auth-data', '.gev-logs')) {
  $source = Join-Path $repo $name
  if (-not (Test-Path -LiteralPath $source)) {
    if ($name -in @('node_modules', '.gev-cache')) { throw "missing in the main checkout: $source" }
    continue
  }
  $link = Join-Path $target $name
  # Never a recursive delete here: through a link it would empty the shared target (history, accounts).
  if (Test-Path -LiteralPath $link) { throw "unexpected $name in the release copy: $link" }
  New-Item -ItemType Junction -Path $link -Target (Resolve-LinkTarget $source) | Out-Null
}
$envFile = Join-Path $repo '.env'
if (Test-Path -LiteralPath $envFile) { Copy-Item -LiteralPath $envFile -Destination (Join-Path $target '.env') -Force }
Set-Content -LiteralPath (Join-Path $target 'RELEASE') -Value $hash -Encoding ascii -NoNewline

# 3. Switch current -> new release.
if (Test-Path -LiteralPath $current) {
  $item = Get-Item -LiteralPath $current -Force
  if (-not $item.Target) { throw "$current exists and is not a link" }
  $item.Delete()
}
New-Item -ItemType Junction -Path $current -Target $target | Out-Null
Write-Host "release: $hash -> $current"

# 4. Restart the service and wait for the API.
$service = Get-Service -Name 'oko-api' -ErrorAction SilentlyContinue
if ($service -and -not $NoRestart) {
  Restart-Service -Name 'oko-api'
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $ok = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -Uri "http://localhost:$ApiPort/api/history/status" -UseBasicParsing -TimeoutSec 10
      $release = ($res.Headers.GetEnumerator() | Where-Object { $_.Key -ieq 'X-Oko-Release' } | Select-Object -First 1).Value
      if ($res.StatusCode -eq 200 -and [string]$release -eq $hash) { $ok = $true; break }
    } catch { }
    Start-Sleep -Seconds 3
  }
  if (-not $ok) { throw "oko-api did not answer as release $hash within $WaitSeconds s (see .gev-cache\logs\svc-oko-api.log)" }
  Write-Host "oko-api: release $hash answers on localhost:$ApiPort"
} elseif (-not $service) {
  Write-Host 'oko-api service not installed yet (scripts\install-oko-api-service.ps1)'
}

# 5. Keep the newest releases (the running one is always kept).
$running = (Resolve-LinkTarget $current)
Get-ChildItem -LiteralPath $releases -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep |
  Where-Object { $_.FullName -ne $running } | ForEach-Object {
    foreach ($name in @('node_modules', '.gev-cache', '.auth-data', '.gev-logs')) {
      $link = Join-Path $_.FullName $name
      if (Test-Path -LiteralPath $link) { (Get-Item -LiteralPath $link -Force).Delete() }
    }
    # Any other link left at the top level -> keep the folder (a recursive delete could follow it).
    $links = @(Get-ChildItem -LiteralPath $_.FullName -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($links.Count) { Write-Host "kept old release $($_.Name): unexpected links $($links.Name -join ', ')"; return }
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
    Write-Host "removed old release: $($_.Name)"
  }
