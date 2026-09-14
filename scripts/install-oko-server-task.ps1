# scripts/install-oko-server-task.ps1 — zaregistruje strážcu dev servera
# (scripts/oko-server.ps1) ako úlohu Plánovača pre TOHTO používateľa: spustí sa
# pri prihlásení, beží skryto, po páde ju plánovač do minúty reštartuje.
#
#   Inštalácia:   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-oko-server-task.ps1
#   Odinštalácia: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-oko-server-task.ps1 -Uninstall
#   Stav:         Get-ScheduledTask -TaskName 'OKO dev server'
#
# Nepotrebuje admin práva (úloha pod prihláseným používateľom, bez zvýšenia).

param([switch]$Uninstall)

$taskName = 'OKO dev server'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'scripts\oko-server.ps1'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "úloha '$taskName' odstránená (ak existovala)"
  exit 0
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# -Priority 4 = Normal. Plánovač dáva úlohám predvolene prioritu 7 (BelowNormal): pri vyťaženom stroji
# (Docker, prehliadač, Defender) dev server nedostával CPU a /api odpovedalo 80-100 s -> 502 cez tunel (2026-09-14).
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 4
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8
$listening = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listening) { Write-Host "úloha '$taskName' zaregistrovaná a beží: http://localhost:4173" }
else { Write-Host "úloha '$taskName' zaregistrovaná; server ešte nepočúva — pozri .gev-cache\logs\oko-server.log" }
