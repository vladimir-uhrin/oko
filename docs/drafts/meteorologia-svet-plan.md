# Meteorológia pre celý svet v štýle Windy — PLÁN (2026-09-08, nič nie je implementované)

Používateľ: „chcel by som spraviť sekciu meteorológia nie len Slovensko aj SHMÚ ale celý svet
na štýl WINDY.com. Navrhni plán len." Windy = animované častice vetra, farebné polia (teplota,
zrážky, tlak, oblačnosť, vlny), radar + satelit, časová os s predpoveďou, prepínač modelov
(ECMWF / GFS / ICON), teploty pri mestách, klik → meteogram.

## Čo už OKO má (staviame na tom, nie vedľa toho)

- SHMÚ zrážkový radar (drape, CC BY 4.0), METAR/TAF cache (`airportWeather.js`), Open-Meteo bod
  pre kokpit (CC BY 4.0, už v DATA_SOURCES), NASA GIBS: 5 dátových prekryvov (SST, zrážky IMERG,
  sneh, aerosól, ľad) + podklady, `imageryOrder` roly a `activeMapStack`.
- Továreň drapov `densityDrape.js` (plochá textúrovaná primitíva, alpha × kontrast × zoom fade,
  bez Phongu) — presne to, čo treba pre farebné polia.
- Overlay host (`worldOverlay*`), kreslič grafov (`flightHistoryChart.js`), `ReplayClock`
  (rýchlosti, rAF) — základ pre popisky teplôt pri mestách, meteogram a časovú os.
- Vzor proxy s cache + budget governorom (TomTom, adsbdb, airframes), disk cache `.gev-cache/`.

## Dáta — kandidáti (licencia = stav poznania; PRED zapojením overiť doslovne, checklist `new-data-layer`)

| Vrstva (Windy) | Zdroj | Formát / prístup | Licencia (overiť) | Poznámka |
|---|---|---|---|---|
| Vietor, teplota, tlak, zrážky, oblačnosť, nárazy, sneh, CAPE, výškové hladiny | **NOAA GFS 0,25°** cez NOMADS **OpenDAP/GrADS-DDS** (`nomads.ncep.noaa.gov/dods/gfs_0p25_1hr`) | binárny XDR výrez (`.dods`) alebo ASCII na premennú/čas/oblasť — dekódovanie v Node bez GRIB knižnice | NOAA = verejná doména (US gov); NOMADS má pravidlá rozumného použitia a limity dopytov — overiť | 4 behy/deň, +384 h; **hlavný model fázy 1** |
| to isté, presnejšie | **ECMWF Open Data** 0,25° IFS (ecmwf.int / zrkadlá AWS, Azure) | len GRIB2 | CC BY 4.0 (overiť aktuálne podmienky) | fáza 2 — vyžaduje GRIB2 dekodér (sidecar `wgrib2`/ecCodes) |
| to isté, Európa jemne | **DWD ICON / ICON-EU** open data | GRIB2 | CC BY 4.0 | fáza 2, s ECMWF |
| Radar (svet) | **RainViewer API** (kompozit radarov + IR satelit, minulosť 2 h + nowcast) | dlaždice PNG cez ich API | free tier s atribúciou, komerčné nie — overiť ToS | Windy „Radar"; **SHMÚ ostáva ako presnejšia SK vrstva navrch** |
| Satelit | **NASA GIBS** geostacionárne (GOES, Himawari, Meteosat GeoColor/IR, 10 min) — už máme GIBS klienta | WMTS | NASA open | rozšírenie katalógu, nie nový klient |
| Vlny, perióda, smer | **NOAA WaveWatch III** (`gfswave`) cez NOMADS DDS | ako GFS | verejná doména | pre lodnú vrstvu |
| Bodová predpoveď, meteogram | **Open-Meteo** (už zapojené) | JSON | CC BY 4.0, nekomerčne zdarma, ~10 k dopytov/deň | klik na mapu, mestá mimo mriežky |
| Blesky | Blitzortung | len pre členov siete | — | **mimo**, kým nie sme feeder |
| Kvalita ovzdušia | Copernicus CAMS | registrácia + kľúč, GRIB/NetCDF | CC BY-like (overiť) | fáza 3 |
| SK model | SHMÚ ALADIN | zatiaľ nevieme, či je v open data | — | preveriť cez `sk-data-source` |

Zámerne NIE: Windy API (platené, licenčne pre vlastný web), scraping windy.com, meteoblue bez licencie.

## Architektúra

```
NOMADS/ECMWF ──► scripts/meteo-bake (Node, cron po behu modelu)
                  │  stiahne výrezy premenných × krokov, uloží Float16/PNG „slice" + sidecar JSON
                  ▼
      .gev-cache/meteo/<model>/<run>/<var>/<step>.png (+ meta)   ~200–400 kB/slice
                  │
  vite.config.js meteoProxy(): /api/meteo/catalog | /api/meteo/slice | /api/meteo/point
                  │  (cache-control podľa behu, budget governor na upstream, nič v prehliadači bez proxy)
                  ▼
  klient src/data/meteo*.js
   ├─ meteoField.js     — načíta slice ako textúru, farebná rampa v shaderi, drape cez densityDrape továreň
   ├─ windParticles.js  — CPU častice (5–10 k) na celoobrazovkovom <canvas>, UV z textúry vetra,
   │                       projekcia cez SceneTransforms, okluzia za glóbusom, stopa s fade (Windy štýl)
   ├─ meteoIsolines.js  — izobary/izotermy: marching squares zo slice (worker), polylines
   ├─ meteoTimeline.js  — spodná časová os (dni × hodiny, play, rýchlosť), vlastný „meteo čas",
   │                       predbežné načítanie susedných krokov, interpolácia medzi krokmi
   ├─ meteoCityLabels.js— teplota/vietor pri mestách VZORKOVANÍM z mriežky (0 dopytov navyše)
   ├─ meteoPoint.js     — klik → karta s meteogramom (Open-Meteo hodinovo 7 dní, graf z flightHistoryChart)
   └─ panel „Meteorológia" (nová skupina v paneli vrstiev): model, vrstva, hladina, legenda, čas
```

- **Farebné polia** = `densityDrape` + shader rampa (teplota −40…+45 °C Windy-like, zrážky, tlak,
  oblačnosť %, vlny m). Jedna textúra 1440×720 (0,25°) ≈ 4 MB RGBA na GPU; pri 6 vrstvách × 2 krokoch
  v pamäti ≈ 50 MB — v poriadku (GTX 1080 Ti).
- **Častice**: 2D canvas nad scénou (ako Windy/nullschool, ktoré sú 2D) — v 3D projektujeme
  lon/lat → okno každý snímok; v 2D „PLÁTNO" režime priamo. Kokpit ich vypne (šum).
- **Čas**: meteo čas nezávislý od hodín Cesia (Slnko/terminátor ostáva reálny), ale tlačidlo
  „zosynchronizovať" posunie aj scénu (deň/noc + predpoveď = pekný efekt).
- **Poctivosť**: každá vrstva nesie model, beh (UTC), krok, vek behu; „PREDPOVEĎ" vs „ANALÝZA"
  vs „RADAR (pozorované)". Staré behy sa označia.

## Fázy (odhad práce v dňoch; každá končí testami, DATA_SOURCES riadkom a CURRENT-STATE zápisom)

1. **Základ + vietor + teplota (GFS)** — 4–5 d: bake skript (GFS 0,25° cez DDS, 10 m vietor,
   2 m teplota, tlak MSL, zrážky/h, oblačnosť; kroky 3 h do +72 h, 6 h do +240 h), meteoProxy,
   drape teploty s legendou, častice vetra, časová os, panel. Overiť NOMADS podmienky/limity.
2. **Radar + satelit** — 2–3 d: RainViewer (po overení ToS) ako svetový radar pod SHMÚ,
   GIBS geostacionárne snímky do existujúceho katalógu, časová os aj do minulosti (2 h).
3. **Mestá, klik, izobary** — 3 d: teploty pri mestách zo slice, meteogram karta (Open-Meteo),
   izobary/izotermy, vietor v hladinách (850/700/500/250 hPa → kokpit „vietor v FL", lode → vlny).
4. **Modely ECMWF / ICON** — 3–4 d: GRIB2 cesta (sidecar `wgrib2` binárka alebo ecCodes WASM
   — rozhodnúť po teste), prepínač modelu v paneli, porovnanie modelov v meteograme.
5. **Vlny, SK detail, CAMS** — podľa chuti: WaveWatch III, SHMÚ ALADIN (ak je open data), kvalita ovzdušia.

## Rozpočet a limity

- Sťahovanie: GFS 0,25° jeden krok jednej premennej v DDS binárne ≈ 4 MB; 6 premenných × ~50 krokov
  ≈ 1,2 GB na beh (4 behy/deň ≈ 5 GB/deň) → fáza 1 podvzorkuje na 0,5° (÷4) alebo berie
  2 behy/deň; GRIB2 vo fáze 4 to zníži ~10×. Disk: `D:\oko-meteo\` ako pri histórii letov.
- Všetko zdarma; žiadny kľúč do prehliadača; proxy s budget governorom (max dopytov na upstream/h).

## Otvorené rozhodnutia (pred fázou 1)

1. Podvzorkovať na 0,5° pre svet a 0,25° len pre Európu? (Windy má 0,25° ECMWF globálne, GFS 0,25°.)
2. Častice CPU canvas (jednoduché, ~10 k) vs GPU (ping-pong textúry, 100 k+, náročnejšie na údržbu).
3. Kde bake beží: úloha Plánovača ako strážca servera (`scripts/meteo-bake.ps1`) vs v proxy lenivo.
4. Farebné rampy: vlastné (OKO azúrová/jantárová identita) alebo Windy-like (používateľ ich pozná).

## Stav 2026-09-08 večer — prototyp fázy 1 zapojený

Používateľ: „GPU, štýl OKO ale grafické znázornenie ako windy… Najprv sprav prototyp. Použi dobrú a najvhodnejšiu mapu."
→ vrstva `meteo-gfs` (meteoLayer.js, windParticles.js, meteoTimeline.js, meteoField.js, netcdf3.js, meteoProxy).
**Zmena zdroja oproti plánu:** NOMADS OpenDAP je zrušený (SCN 25-81) → GFS ide z NSF Unidata THREDDS NCSS ako NetCDF-3.
Podklad: GIBS Blue Marble (automaticky pri zapnutí). Ďalšie polia, radar, izobary, meteogram, ECMWF/ICON = ďalšie fázy.
