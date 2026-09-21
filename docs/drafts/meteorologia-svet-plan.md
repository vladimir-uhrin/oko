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

## Stav 2026-09-08 neskoro večer — fáza „polia" hotová

Tlak MSL s izobarami (marching squares, meteoIsolines.js, každé 4 hPa, 1013 zvýraznená), zrážky (mm/h,
priehľadné bez javu), oblačnosť (%), nárazy vetra; čipy v riadku vrstvy. Ďalej: radar (RainViewer po ToS),
GIBS geostacionárne snímky, meteogram po kliknutí, izočiary s popiskami, ECMWF/ICON.

## 2026-09-08 noc — tri techniky Windy

Popisky miest s hodnotou nad polom (Natural Earth, vlastná LabelCollection — CARTO dlaždice majú bez kľúča vodoznak),
interpolácia v čase (mix dvoch rezov v materiáli aj v časticiach, plynulé prehrávanie 2,4 s/krok), vek častíc (pevná fáza).
Útlm poľa pod 20 km výšky kamery (pod drapériou bola biela obrazovka).

## 2026-09-17 — fáza 1 (stabilizácia): vyťažená rasterizácia, offline bake, horizont +72 h

Po revízii plánu: rasterizácia z closure proxy → `src/data/meteoRasterize.js` (čistá, 6 testov);
nový `scripts/meteo-bake.mjs` (+ `meteo-bake.ps1`, `install-meteo-bake-task.ps1` — úloha
`OKO meteo bake`, 4×/deň ~45 min po behoch 00/06/12/18 UTC, sériovo s 1,5 s pauzami)
pečie 6 polí × 25 krokov do tej istej cache schémy ako proxy (`meta.baked = true`),
takže proxy je čítač cache + dopĺňač. Horizont 48 → 72 h (`METEO_HORIZON_HOURS`, testy).
Katalóg proxy hlási `baked`/`bakedTotal` a `stale` podľa veku najnovšieho behu v cache;
`normalizeCatalog` ich nesie. THREDDS zostáva komunitný server (terms 404 od 8. 9.) —
bake drží šetrné tempo; presun na NOAA NODD S3 GRIB2 ostáva pre fázu ECMWF/ICON.
Overené: bake upekol reálny rez (beh 16.9. 18Z), katalóg naživo 25 krokov, meteo 37/37.

**Otvorené (odložené 17. 9.):** meteo podklad Stadia funguje len na localhoste (keyless režim
viazaný na Origin); cez tunel `oko.uhrin.digital` vracia 401 → glóbus ostáva modrý bez podkladu.
Riešenie: bezplatný Stadia účet + doménová autorizácia `oko.uhrin.digital` (NIE api_key do URL).
Na rozhodnutie používateľa — meteo sa zatiaľ pozerá cez `http://localhost:4173/`.

## 2026-09-20 — prebratie a zosúladenie (Claude)

Používateľ: „meteo musíš dorobiť ty… musíš to prebrať a zosúladiť."

**Čo bolo rozbité.** Po „Windy pass 1" (konzistentný: rampa `#155e86`, tmavý podklad,
sýte prúdnice, 49 152 častíc, horizont +72 h, pečený katalóg — testy aj kód sedeli)
sa začal **„Windy pass 2"**, ktorý sa **zmenil len v kóde, nie v testoch**:
pole vetra dostalo zeleno-fialovú paletu **bez alfy** pri `alpha: 0,92`, podklad sa
prepol na svetlý a prúdnice na takmer biele. Výsledok overený v prehliadači:
**celá planéta jednoliato neónovo zelená**, bez pobreží a popisov — teda presne to,
čo Windy nerobí. Navyše 2 červené testy a hlavička `windParticles.js` popisovala
hodnoty, ktoré v kóde už neboli.

**Ako je to vyriešené.** Zámer pass 2 („farebná VÝPLŇ, nie len čiary") je zachovaný,
ale spravený tak, aby mapa ostala čitateľná — **alfu nesie RAMPA**, nie konštanta,
rovnakým mechanizmom, aký už používajú zrážky a oblačnosť
(`rampRgbaTable` berie `[hodnota, hex, alfa]`, shader robí `material.alpha = c.a * alpha`):

- rampa vetra späť do identity OKO (modrá → azúrová `--accent` → jantárová → biela)
  a s alfou 0,18 v pokoji → 1,0 pri búrke; `alpha` poľa 0,92 → 0,82,
- prúdnice späť na sýtu rampu (`mix(…, 0.05)`, alfa `0,35 + 0,65 × rýchlosť`),
- podklad späť `stadia-dark` (prepína sa len z `photoreal`, inak rešpektuje voľbu
  používateľa), stmavenie zdieľaného `stadia-dark` (0,28/0,7) vrátené na 0,45/0,85,
- komentáre zosúladené s kódom.

**Ponechané z pass 1 (dobrá práca, nesahané):** `meteoRasterize.js` + testy,
`scripts/meteo-bake.mjs` / `.ps1` / úloha Plánovača, horizont +72 h,
`baked`/`bakedTotal` v katalógu, 49 152 častíc, `WIND_SCREEN_SCALE 0,75`, fade 0,965.

**Stav:** celá suite **3704/3704 zelená** (predtým 2 červené). Overené naživo:
pole má štruktúru (azúrové prúdy, jantárové tryskové prúdenie), podklad je cez
pokojné oblasti vidieť. Cache 203 MB, katalóg 25 krokov, beh 20. 9. 12Z.

**Stále otvorené:** Stadia cez tunel `oko.uhrin.digital` vracia 401 (keyless režim je
viazaný na Origin) → na doméne ostáva glóbus bez podkladu; treba bezplatný Stadia účet
s doménovou autorizáciou. Ďalej fázy 2+: radar (RainViewer po ToS), GIBS geostacionárne,
meteogram po kliknutí, ECMWF/ICON.

### 2026-09-20 — podklad na doméne vyriešený bez účtu

Overené `curl`-om: tá istá Stadia dlaždica vráti **200** s Origin `http://localhost:4173`
a **401** s Origin `https://oko.uhrin.digital` — bezkľúčový režim Stadia obsluhuje len
lokálny vývoj. Meteo preto na doméne ostávalo bez podkladu.

Riešenie **nezávisí od účtu**: `basemapForHost()` (čistá, testovaná) vyberie podklad podľa
hostiteľa — localhost → `stadia-dark`, čokoľvek iné → **bezkľúčové `gibs-blue-marble`**
(NASA, ten istý podklad, s akým prototyp začínal). Neznámy hostiteľ (Node, testy) →
primárny, aby sa správanie nemenilo.

Ak si používateľ založí bezplatný Stadia účet a autorizuje doménu, stačí ju pridať do
`STADIA_KEYLESS_HOSTS` — Stadia autorizuje **Origin**, nie `api_key` v URL, takže žiadny
kľúč do prehliadača ani do proxy nejde.
