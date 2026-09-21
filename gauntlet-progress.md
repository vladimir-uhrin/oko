# Meteo gauntlet — plán a denník

Cieľ: meteo vrstva OKO na úrovni **Windy (windy.com)**. Zadanie a pravidlá určil
používateľ; tento súbor je plán (Fáza 0) a potom denník každého kola.

## Stav Fázy 0

| Krok | Stav |
|---|---|
| 1. Latka = Windy | ✔ neposúvam ju |
| 2. Rozklad na kusy | ✔ nižšie |
| 3. Spôsob overenia na kus | ✔ nižšie |
| 4. Harness | ČIASTOČNE — `check-lazy.js` + `capture-fixture.js` hotové; `check-data.js`, `shot.js`, `perf.js`, `snapshot-meteo.js` čakajú na fixtures |
| 5. Dôkaz determinizmu | ČAKÁ na harness |
| 6. Plán + commit | ✔ tento súbor |

## BLOKÉRY (nezakrývam ich, nepokračujem cez ne)

1. **`refs/windy/` neexistuje.** Bez referenčných captures sa nedá spraviť Fáza 2 —
   nie je proti čomu súdiť. Windy nescrapujem (zakázané zadaním).
2. **`fixtures/` a `fixtures/checkpoints.json` neexistujú.** Bez nich nejde
   `check-data.js`, `?fixture=` ani zmrazenie dát pre determinizmus.
3. Zadanie vyžaduje, aby referencie boli zachytené **v tom istom okamihu** ako
   fixture. Fixture preto nesmiem vyrobiť dopredu — musí vzniknúť v tej istej
   minúte ako snímky Windy. Riešenie: `scripts/capture-fixture.js` spustí
   používateľ tesne pred/po fotení Windy.

### Otvorené rozhodnutia používateľa

- **2D vs glóbus pri súdení.** Windy je 2D Mercator, OKO 3D glóbus. Slepé A/B by
  porovnávalo projekcie, nie počasie. OKO má režim PLÁTNO (2D Mercator) —
  navrhujem v ňom súdiť statické kusy pri zhodnom bboxe.
- **Zdroj dát.** Obmedzenie žiada zhodu s Open-Meteo `icon_d2` (±0,5 °C). Vrstva
  dnes pečie **GFS 0,25° z THREDDS** — iný model, do tolerancie sa netrafí.
  Buď vrstvu prepneme na `icon_d2`, alebo checkpointy platia len pre meteogram.
- **Doména `icon_d2`** (zmerané z GRIB hlavičky DWD): lon −3,94…20,34°,
  lat 43,18…58,08°. Bratislava vnútri, **Košice (21,26° E) MIMO** — checkpointy
  musia ležať v doméne.

## Kusy a spôsob overenia

Poradie je záväzné: statické najprv, animácia posledná.

| # | Kus | Overenie | Referencia |
|---|---|---|---|
| 1 | Teplotné pole | JUDGED (PNG) + MEASURABLE (hodnoty) | C1, C2, C3, C4, C5 |
| 2 | Zrážky / radar | JUDGED + MEASURABLE | C1, C4 |
| 3 | Oblačnosť | JUDGED | C1 |
| 4 | Tlak + izobary | JUDGED + MEASURABLE | C1, C4 |
| 5 | Legenda a jednotky | JUDGED | v PNG vyššie |
| 6 | Výber vrstiev | JUDGED | C1 (otvorené menu) |
| 7 | Hodnoty pri sídlach | JUDGED + MEASURABLE | C2, C3 |
| 8 | Časová os + prehrávanie | JUDGED (5 s video) | C1 |
| 9 | Meteogram po kliknutí | JUDGED + MEASURABLE | C3 |
| 10 | **Vietor — častice** | JUDGED (5 s video) | C1, C3 — **posledné** |

### Čisto merateľné (nikdy nesúdi model to, čo vie zmerať kód)

| ID | Kontrola | Skript |
|---|---|---|
| M1 | Hodnoty = Open-Meteo `icon_d2` (±0,5 °C, ±1 m/s, ±15°) | `check-data.js` |
| M2 | ≥ 30 FPS s časticami, mobil + 4× CPU throttling | `perf.js` |
| M3 | Lazy-load: bez weather kódu a `/api/meteo/*`, kým sa vrstva neotvorí | `check-lazy.js` |
| M4 | `?fixture=<meno>` funguje offline aj naživo | `snapshot-meteo.js` |
| M5 | Determinizmus: každý skript 2× = zhodný výstup | všetky |

**Poznámka k M3:** OKO je SPA (jediný `index.html`), takže „news pages" = aplikácia
načítaná na správy/situácie. Merateľné ako: žiadna sieťová požiadavka na weather
modul ani `/api/meteo/*`, kým sa vrstva neotvorí; po otvorení musia prísť — inak
by test prešiel aj pre vrstvu, ktorá je len rozbitá.

## Kamery (5, vrátane mobilu)

| ID | Stred | Rozsah | Viewport |
|---|---|---|---|
| C1 EURÓPA | 50,0 °N 15,0 °E | ~35–60 °N, 0–30 °E | 1600×1000 |
| C2 SLOVENSKO | 48,4 °N 18,5 °E | ~300 km | 1600×1000 |
| C3 DETAIL | 48,15 °N 17,11 °E | ~40 km | 1600×1000 |
| C4 ALPY | 47,5 °N 13,0 °E | ~300 km | 1600×1000 |
| C5 MOBIL | ako C3 | ~40 km | 390×844 |

Pri každom zábere sa mrazí: hodiny, kamera, dáta (fixture) a semienko častíc.

## Namerané v Fáze 0

**M3 lazy-load — FAIL (potvrdené, nie odhadnuté).** `node scripts/check-lazy.js`:
pred otvorením vrstvy sa načíta **6 weather modulov** —
`meteoField.js`, `meteoIsolines.js`, `meteoLayer.js`, `meteoPlaces.js`,
`meteoTimeline.js`, `windParticles.js`. Príčina: `src/main.js:12` je statický
import. Fáza B testu potvrdila, že po otvorení dáta prídu
(`/api/meteo/catalog`, `/api/meteo/slice?var=wind`), takže test neprejde ani
pre vrstvu, ktorá je len rozbitá. Oprava patrí do Fázy 1.

**Determinizmus `check-lazy.js` — OK.** Dva behy, zhodné MD5
(`6a8e6e3ac21ef2403f674d2fc508e9dd`).

**Open-Meteo `icon_d2` overené naživo:** jednotky °C / m/s / ° / mm / % / hPa,
`wind_speed_unit=ms` je nutné vynútiť (inak vracia km/h a tolerancia ±1 m/s
by sa merala na nesprávnej veličine).

## Denník kôl

| Dátum | Kus | Kolo | Verdikt | Najväčšia medzera | Zmena |
|---|---|---|---|---|---|
| 2026-09-21 | — | Fáza 0 | plán zapísaný | refs + fixtures chýbajú | rozklad, kamery, M1–M5 |
| 2026-09-21 | M3 | meranie | **FAIL** | 6 weather modulov pred otvorením | `check-lazy.js` napísaný, determinizmus OK |
