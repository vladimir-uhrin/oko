# scripts/install-meteo-bake-task.ps1 — zaregistruje pečenie meteo rezov
# (scripts/meteo-bake.ps1) ako úlohu Plánovača pre TOHTO používateľa:
# 4× denne po behoch GFS (00/06/12/18 UTC), s oneskorením ~45 min na dokončenie
# modelu, beží skryto, bez admin práv (úloha pod prihláseným používateľom).
#
#   Inštalácia:   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-meteo-bake-task.ps1
#   Odinštalácia: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-meteo-bake-task.ps1 -Uninstall
#   Stav:         Get-ScheduledTask -TaskName 'OKO meteo bake'

param([switch]$Uninstall)

$taskName = 'OKO meteo bake'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'scripts\meteo-bake.ps1'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "úloha '$taskName' odstránená (ak existovala)"
  exit 0
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
  -WorkingDirectory $root

# GFS beží o 00/06/12/18 UTC; výstup býva na THREDDS po ~45 min. Lokálny čas
# (letný UTC+2) = 02:45, 08:45, 14:45, 20:45.
$trigger1 = New-ScheduledTaskTrigger -Daily -At '02:45'
$trigger2 = New-ScheduledTaskTrigger -Daily -At '08:45'
$trigger3 = New-ScheduledTaskTrigger -Daily -At '14:45'
$trigger4 = New-ScheduledTaskTrigger -Daily -At '20:45'
# -Priority 4 = Normal (rovnako ako dev server; BelowNormal sa vyhladovalo).
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew -StartWhenAvailable -Priority 4

Register-ScheduledTask -TaskName $taskName -Action $action `
  -Trigger @($trigger1, $trigger2, $trigger3, $trigger4) -Settings $settings `
  -Description 'OKO: pečenie GFS meteo rezov do .gev-cache (scripts/meteo-bake.mjs)' | Out-Null
Write-Host "úloha '$taskName' nainštalovaná: denne 02:45/08:45/14:45/20:45 (lokálny čas), ~45 min po behoch GFS"
Write-Host "manuálny test: Start-ScheduledTask -TaskName '$taskName'"
