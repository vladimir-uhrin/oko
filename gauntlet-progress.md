# Meteo gauntlet — UZAVRETÉ 2026-09-21

> **Tento smer sa neuzavrel dokončením, ale rozhodnutím.** Používateľ:
> „nechaj to tak, pôjdeme vlastnou cestou." Windy prestáva byť latkou;
> meteo v OKU sa ďalej vyvíja po svojom. Nič z nižšie uvedeného nie je
> rozpracovaná úloha — je to záznam, čo sa stihlo a čo sa pritom zistilo.

## Čo z toho ostáva v hre (s Windy nesúvisí)

- `src/data/meteoLazy.js` + `meteoLazy.test.mjs` — meteo sa načíta až pri
  otvorení vrstvy. Hodnota je samostatná: rýchlejší štart pre každého, kto
  meteo nezapne. **Ostáva.**
- `scripts/check-lazy.js` — regresná stráž presne k tomu. **Ostáva.**

## Čo sa stalo mŕtvym

- `fixtures/` a `scripts/capture-fixture.js` — dávali zmysel len pre slepé
  A/B proti Windy a pre checkpointy `icon_eu`, ktoré sa nesledujú.
- Kusy 1–10 a kamery C1–C5 nižšie: neodpracované, neplánujú sa.

## Trvalý nález, ktorý prežije tento smer

Doména **`icon_d2` nie je obdĺžnik svojej mriežky.** Natívna doména je
rotovaná a rohy sú maskované (v GRIB-e bitmapa: platných 754 862 z 906 390
bodov). Zmerané dopytmi na Open-Meteo:

```
OK    Bratislava · Trnava · Nitra · Trenčín · Viedeň · Brno · Praha
      Mníchov · Záhreb · Graz
MIMO  Žilina · Banská Bystrica · Košice · Budapešť
```

`icon_d2` teda pokrýva len **západné Slovensko** a Ukrajinu vôbec.
`icon_eu` (0,0625°, ~7 km) siaha po 62,5° E — overené, že dáta má aj Košice,
Užhorod, Ľvov, Kyjev a Charkov. Pre akékoľvek budúce meteo nad Ukrajinou je
to rozdiel medzi „ide to" a „nejde to".

---

# Pôvodný plán (archív)

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

## Pokrytie icon_d2 — NAMERANÉ, nie odhadnuté (2026-09-21)

Obdĺžnik mriežky z GRIB Section 3 (−3,94…20,34° E) **NIE JE** test pokrytia:
natívna doména je rotovaná a rohy sú maskované (v GRIB-e bitmapa, platných len
754 862 z 906 390 bodov). Overené dopytmi na Open-Meteo:

```
OK    Bratislava · Trnava · Nitra · Trenčín · Viedeň · Brno · Praha
      Mníchov · Záhreb · Graz
MIMO  Žilina · Banská Bystrica · Košice · Budapešť
      → {"reason":"No data is available for this location"}
```

**icon_d2 teda pokrýva len západné Slovensko** — východná hrana reže SR okolo
18,1–18,7° E. To je zásadné pre zadanie: ak má vrstva sedieť s icon_d2, pre
väčšinu SR a pre CELÚ Ukrajinu (hlavné zameranie OKA) model dáta nemá.
Na zváženie: `icon_eu` (7 km) siaha po 62,5° E a Ukrajinu pokrýva celú.

## Fixture zachytený

`fixtures/checkpoints.json` — 6 bodov (všetky overené, že dáta majú),
`fixtures/2026-09-21-base/` — 6 rezov, `driftHours: 0` voči okamihu zachytenia.

**POZOR:** snímky z Windy pre tento okamih NEEXISTUJÚ — fixture vznikol na
pokyn používateľa, aby sa odblokovala Fáza 1. Pre Fázu 2 treba
`capture-fixture.js` spustiť ZNOVA v tej istej minúte ako fotenie Windy.

### Dve chyby v mojom skripte, ktoré som našiel a opravil

1. **Obdĺžniková kontrola domény** prijala Žilinu aj Budapešť, hoci tam model
   dáta nemá. Nahradené sondou na zdroj (`probePoint`) — doménu nehádam.
2. **Výber rezu `files[0]`** bral najstarší rez v cache: fixture miešal dnešné
   checkpointy s rastrom spred 13 dní. Nahradené `nearestSlice()`; manifest
   teraz nesie `driftHours`, nech je odchýlka vidieť.

## ZMENA ZADANIA používateľom (2026-09-21): icon_d2 → icon_eu

Pôvodné obmedzenie znelo „Open-Meteo, model **icon_d2**". Po tom, čo meranie
ukázalo, že icon_d2 pokrýva len západné Slovensko a vôbec nie Ukrajinu,
používateľ na otázku odpovedal **„eu"**. Vrstva aj checkpointy teda cielia na
**`icon_eu`** (0,0625°, ~7 km, po 62,5° E).

Zaznamenané výslovne, lebo HARD RULES zakazujú meniť testy a tolerancie:
toto je **rozhodnutie zadávateľa**, nie moje zmäkčenie latky. Tolerancie
(±0,5 °C, ±1 m/s, ±15°) ostávajú nedotknuté.

Overené, že icon_eu dáta má: Bratislava, Žilina, B. Bystrica, Košice,
Užhorod, Ľvov, Kyjev, Charkov, Budapešť, Viedeň — teda všetko, čo icon_d2
nemal, vrátane celého zamerania OKA na Ukrajinu.

`fixtures/checkpoints.json` prepísaný na icon_eu: **8 bodov od 11,58° E
(Mníchov) po 30,52° E (Kyjev)**, zámerne pretínajú doménu.

## Fáza 1 — priebeh

**M3 lazy-load: FAIL → PASS.** Príčinou bolo, že `meteoLayer.js` sa
inštanciuje už pri importe (`export default createMeteoLayer()`), takže
statický import v `main.js` ťahal 6 modulov pri každom štarte.

Riešenie `src/data/meteoLazy.js`: správca číta metadáta (id/name/icon) hneď
pri registrácii, aby vrstvu vedel ukázať v zozname — tie teda zástupca nesie
sám. Skutočný modul sa dotiahne dynamickým importom až v `init()`, ktorý
správca awaituje tesne pred `enable()`. Metadáta sú zopakované zámerne
(importovať ich z `meteoLayer.js` by ten modul načítalo) a proti rozídeniu
ich stráži `meteoLazy.test.mjs`.

```
pred:  beforeOpen = 6 modulov   → FAIL
po:    beforeOpen = []          → PASS
       afterOpen  = 6 modulov + /api/meteo/catalog + /slice
```

Overené aj naživo, že vrstva po zlenivení naozaj funguje (test by prešiel aj
pre rozbitú vrstvu): pred otvorením v zozname a nenačítaná, po otvorení
načítaná, 25 krokov, bez chyby, časová os aj plátno častíc na mieste.
Determinizmus 2× zhodný. Celá suite 3710/3710.

## Denník kôl

| Dátum | Kus | Kolo | Verdikt | Najväčšia medzera | Zmena |
|---|---|---|---|---|---|
| 2026-09-21 | — | Fáza 0 | plán zapísaný | refs + fixtures chýbajú | rozklad, kamery, M1–M5 |
| 2026-09-21 | M3 | meranie | **FAIL** | 6 weather modulov pred otvorením | `check-lazy.js` napísaný, determinizmus OK |
| 2026-09-21 | fixture | zachytenie | OK | snímky Windy chýbajú | 6 bodov + 6 rezov, drift 0 h; opravené 2 chyby skriptu |
| 2026-09-21 | model | rozhodnutie | — | icon_d2 nepokrýval UA | používateľ: **icon_eu**; fixture prepísaný na 8 bodov |
| 2026-09-21 | M3 | Fáza 1 | **PASS** | — | `meteoLazy.js`: 0 requestov pred otvorením (bolo 6 modulov) |
