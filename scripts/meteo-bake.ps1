# scripts/meteo-bake.ps1 — obal offline pečenia meteo rezov pre Plánovač úloh
# (2026-09-17, fáza 1 krok 2). Spúšťa `node scripts/meteo-bake.mjs` z koreňa
# repozitára a loguje do .gev-cache/logs/meteo-bake.log (rotácia nad 5 MB).
#
#   Ručne:     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\meteo-bake.ps1
#   Plánovač:  scripts\install-meteo-bake-task.ps1
param(
  [string[]]$BakeArgs = @()
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root '.gev-cache\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'meteo-bake.log'

function Write-Log([string]$message) {
  $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $message
  Add-Content -Path $log -Value $line -Encoding utf8
}

# Rotácia logu nad 5 MB.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) {
  Move-Item -Force $log ($log + '.1')
}

# Node: uprednostni fnm (Node 24 podľa package.json engines), inak node z PATH.
$fnm = Get-Command fnm -ErrorAction SilentlyContinue
if ($fnm) {
  try { fnm env --use-on-cd --shell power-shell | Out-String | Invoke-Expression; fnm use 24 2>$null | Out-Null } catch { }
}
$nodeVersion = (& node -v) 2>$null
Write-Log "štart bake; node $nodeVersion; args: $($BakeArgs -join ' ')"

$out = & node scripts\meteo-bake.mjs @BakeArgs 2>&1
$code = $LASTEXITCODE
foreach ($line in $out) { Write-Log $line }
Write-Log "koniec bake, exit $code"
exit $code
