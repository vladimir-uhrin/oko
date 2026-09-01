@echo off
REM OKO — terenne buildy mimo Claude procesu (Planovac uloh Windows).
REM Dovod: CTB krok trva hodiny a kazdy restart Claude procesu zabil
REM shellovu ulohu na pozadi. Skripty su resumovatelne, takze opakovane
REM spustenie preskoci hotove kroky.
REM
REM PORADIE JE ZAVAZNE: celostatny z15 zaklad MUSI dobehnut pred hi-res
REM merge krokom. Hires kopiruje jemnejsie z15+ dlazdice do hlavneho
REM tilesetu a prepocitava sk-availability.json — keby zaklad dobehol az
REM po nom, jeho CTB by hires z15 dlazdice prepisal hrubsimi a jeho
REM availability by o urovniach z16-18 nevedelo.

setlocal
set "PATH=%APPDATA%\fnm\node-versions\v24.20.0\installation;%PATH%"
cd /d "%~dp0.."

set "LOG=.gev-cache\terrain-build.log"
echo. >> "%LOG%"
echo ==== %DATE% %TIME% — start >> "%LOG%"

echo ---- zaklad z15 (DMR 3.5, celostatny) >> "%LOG%"
set SK_TERRAIN_MAX_ZOOM=15
node scripts\build-sk-terrain.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ---- ZAKLAD ZLYHAL ^(exit %errorlevel%^) — hires sa NESPUSTA >> "%LOG%"
  exit /b 1
)
echo ---- zaklad hotovy >> "%LOG%"

echo ---- hi-res vlozky ^(DMR 6.0, LOT08+LOT10^) >> "%LOG%"
node scripts\build-sk-terrain-hires.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ---- HIRES ZLYHAL ^(exit %errorlevel%^) >> "%LOG%"
  exit /b 1
)
echo ==== %DATE% %TIME% — vsetko hotove >> "%LOG%"
endlocal
