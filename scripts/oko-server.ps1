# scripts/oko-server.ps1 — strážca dev servera OKO (2026-09-08).
#
# Prečo: dev server spúšťaný z Claude aplikácie (Browser pane) žije len počas
# relácie agenta — po jej skončení ho aplikácia zastaví, takže „keď prídem domov,
# server je padnutý". Tento skript beží MIMO Claude: spustí `vite` na
# localhost:4173 a keď proces skončí (pád, zatvorené okno, reštart .env),
# po 5 s ho spustí znova. Log: .gev-cache/logs/oko-server.log.
#
# Spustenie ručne:   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\oko-server.ps1
# Pri prihlásení:    scripts\install-oko-server-task.ps1 (Plánovač úloh, len pre tohto používateľa)
#
# Server sa viaže LEN na localhost (CLAUDE.md: nikdy 0.0.0.0). Kľúče ostávajú v .env.

param(
  [int]$Port = 4173,
  [string]$HostName = 'localhost',
  [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root '.gev-cache\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'oko-server.log'

function Write-Log([string]$message) {
  $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $message
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Host $line
}

function Test-PortListening([int]$p) {
  $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -ne $conn
}

# Node: uprednostni fnm (Node 24 podľa package.json engines), inak node z PATH.
$fnm = Get-Command fnm -ErrorAction SilentlyContinue
if ($fnm) {
  try { fnm env --use-on-cd --shell power-shell | Out-String | Invoke-Expression; fnm use 24 2>$null | Out-Null } catch { }
}
$nodeVersion = (& node -v) 2>$null
Write-Log "štart strážcu; node $nodeVersion; koreň $root; $HostName`:$Port"

# Druhá inštancia by sa bila o port — ak už niečo počúva, len to ohlás a skonči.
if (Test-PortListening $Port) {
  Write-Log "port $Port už počúva (iná inštancia alebo Claude preview) — strážca končí"
  exit 0
}

# Rotácia logu nad 5 MB.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) {
  Move-Item -Force $log ($log + '.1')
}

while ($true) {
  Write-Log "spúšťam vite --host $HostName --port $Port --strictPort"
  $started = Get-Date
  $proc = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', $HostName, '--port', "$Port", '--strictPort') `
    -WorkingDirectory $root -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $logDir 'vite.out.log') -RedirectStandardError (Join-Path $logDir 'vite.err.log')
  $proc.WaitForExit()
  $uptime = [int]((Get-Date) - $started).TotalSeconds
  Write-Log "vite skončil (exit $($proc.ExitCode)) po $uptime s — reštart o $RestartDelaySeconds s"
  # Ak padá hneď po štarte (napr. zlý .env), nepretáčaj CPU: po 3 rýchlych pádoch čakaj minútu.
  if ($uptime -lt 15) { $script:fastFails = [int]$script:fastFails + 1 } else { $script:fastFails = 0 }
  if ($script:fastFails -ge 3) { Write-Log "3 rýchle pády za sebou — čakám 60 s"; Start-Sleep -Seconds 60; $script:fastFails = 0 }
  else { Start-Sleep -Seconds $RestartDelaySeconds }
}
