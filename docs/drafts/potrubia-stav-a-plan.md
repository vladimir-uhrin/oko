# Potrubia (plynovody + ropovody) — stav, ako sa k tomu vrátiť, čo ostalo

Stav k **2026-09-19 večer**. Všetkých šesť etáp plánu z 2026-09-18 je hotových
(+ etapa 3b, hover lokálnych značiek, plot rúr vypnutý). Vetva
`codex/blender-tanker-trial`, commity `b923bc9 … 03b049e` (aktuálny koniec reťaze:
`git log`), **nič nepushnuté**. Publikované na oko.uhrin.digital z čistého exportu
HEAD `03b049e` (build `index-CuDo8FZ_.js`).
Autoritatívne detaily po etapách: `docs/CURRENT-STATE.md` (bullety „Pipelines
stage …"), licencie: `DATA_SOURCES.md` (riadky OSM gas / OSM oil / Natural
Earth). Otvorené body: sekcia 8 nižšie.

## 1. Čo sa dá na mape robiť

- Vrstva **`gas-pipelines`** (token `0`) kreslí **plyn aj ropu**; čipy PLYN / ROPA
  v riadku vrstvy (voľby `gas`/`oil`, odkaz `lo=0.o.0` = len plyn), legenda
  s počtami (PLYN 18.7K · ROPA 2.6K).
- **Hover** nad rúrou: karta v štýle OKO — látka, meno v latinke (+ originál
  v cyrilike), prevádzkovateľ, krajiny úseku s vlajkami, DN · úsek · trasa
  from→to · kapacita · tlak · uloženie · stav, **živý tok ENTSOG** (D−1, GWh/d,
  ≈ mil. m³/d, Ø 7 dní, sparkline 14 dní, citácia) pri plynovodoch naviazaných
  na bod ENTSOG, pri rope poctivé „živé toky nie sú verejné", päta s OSM way,
  ODbL a dátumom snímku, „celá trasa: N úsekov · X km".
- **Klik**: zvýrazní CELÚ trasu (relácia / meno+prevádzkovateľ), karta v overlay
  s tými istými údajmi.
- **Hranice štátov** sa kreslia, kým je vrstva zapnutá (držiteľ `gas-pipelines`),
  scéna úžiny je druhý držiteľ.
- **Viditeľnosť**: šírky 6/5/4/3 px podľa DN s tmavým obrysom, pahýle miznú
  z diaľky, **duch** (čiarkovaná čiara cez terén) do 250 km. **Plot (stena 7 km)
  na rúrach je VYPNUTÝ** (`PIPELINE_FENCE.enabled = false`) — používateľ: „potrubia
  majú ploty", steny s obrysom na 3 561 krátkych úsekoch vyzerali ako reťaz
  škatuliek; plot HRANÍC ostáva.
- **Lokálne značky** (prístavy, letiská, dátové centrá, priehrady) majú tiež
  hover kartu; prístavy vlajku.

## 2. Kde čo je

| Vrstva | Súbor | Poznámka |
|---|---|---|
| build plyn | `scripts/build-gas-pipelines.mjs` | 12 dlaždíc 0–75° s. š. × −12…180° v. d., `QUERY_VERSION v2` |
| build ropa | `scripts/build-oil-pipelines.mjs` | tie isté dlaždice, `v1`, `substance oil\|crude_oil\|petroleum`, vlastný súbor (ODbL Collective DB) |
| engine | `scripts/lib/pipelineSnapshot.mjs` | Overpass s cache, clip, Douglas–Peucker, relácie (id + tagy), krajiny, meta |
| tagy | `scripts/lib/pipelineTags.mjs` | `diameterMm` (palce!), `makeClassifier({substanceRe})` |
| krajiny | `scripts/lib/pipelineCountries.mjs` | Natural Earth 1:50m admin-0 bodom v polygóne; auto-download do `.gev-cache/natural-earth/` |
| snímky | `.gev-cache/gas/pipelines.geojsonl` (10,0 MB), `.gev-cache/oil/…` (1,5 MB) + `pipelines.meta.json` | `.gev-cache` je junction na `D:\OKO\gev-cache` |
| proxy | `vite.config.js` → `gasProxy()` | `/api/gas/pipelines` + `/meta`, `/api/oil/pipelines` + `/meta` (**/meta pred súborom!**), ETag, gzip, 404 `no_snapshot` |
| čisté funkcie | `src/data/gasPipelines.js` | štýl, šírky, DDC, plot, duch-kohorta, mená (latinka), skupiny, karty, fetch |
| vrstva | `src/data/gasPipelinesLayer.js` | 4 zdroje (gas, oil, selected, ghost), čipy, hover, duch, plot, výber trasy |
| toky | `src/data/pipelineFlowLinks.js` | ručná tabuľka meno → bod ENTSOG (len body z `GAS_FLOW_POINTS`) |
| hover karta | `src/data/pipelineHoverCard.js`, `src/data/localHoverCard.js` | DOM bez innerHTML, CSS `.pipeline-hover-card` |
| prepis | `src/data/latinize.js` | cyrilika → latinka (RU/UK/BE/KK/BG/SR), `lang` nápoveda zo snímku |
| hranice | `src/data/countryBoundaries.js` + `src/main.js` | `retain/release` držitelia |
| voľby | `src/data/layerState.js` | `OPTION_GROUPS['gas-pipelines']` = `gas` (g), `oil` (o), default = absent = zapnuté |
| i18n | `src/i18nStrings.js` | kľúče `gas.pipeline-*`, `local.hover-hint` (SK + EN) |
| kredity | `src/data/dataCredits.js` | `gas-pipelines`, `oil-pipelines` |
| hlas | `src/voice/gevActions.js` | „ropovody / oil pipelines" → `gas-pipelines` (schéma nástrojov je pinovaná na bajt — nový enum netreba) |
| testy | `src/data/gasPipelines*.test.mjs`, `pipelineFlowLinks.test.mjs`, `pipelineHoverCard.test.mjs`, `latinize.test.mjs`, `localHoverCard.test.mjs`, `localGeojsonHover.test.mjs`, `portTitleFlag.test.mjs`, `countryBoundaries.test.mjs`, `layerState.test.mjs`, `scripts/lib/pipelineTags.test.mjs` | runner skenuje aj `scripts/lib/` |

## 3. Ako prestavať snímky

```bash
node scripts/build-gas-pipelines.mjs
node scripts/build-oil-pipelines.mjs
```

- Bez `--refresh` sa použijú surové dlaždice z `.gev-cache/*/osm-pipelines/`
  (prestavba trvá sekundy, žiadna sieť). **`--refresh` nikdy nespúšťať
  bezmyšlienkovite**: 12 dopytov Overpass s 20 s rozostupmi (a pauza sa
  preskakuje, keď je ďalšia dlaždica v cache).
- Natural Earth (3 MB) sa pri chýbajúcom súbore stiahne raz do
  `.gev-cache/natural-earth/` (public domain).
- Zmena dopytu = zdvihnúť `QUERY_VERSION`, inak sa vezmú staré dlaždice.
- Po prestavbe skontrolovať meta (`features`, `lengthKm`, `countries.featuresWithCountry`)
  a čísla v `DATA_SOURCES.md` (plynový aj ropný riadok).

## 4. Ako publikovať čisto

Pracovný strom zdieľajú ďalší agenti (meteo: `meteoField`, `windParticles`,
`vite.config.js`, `DATA_SOURCES.md`, `docs/CURRENT-STATE.md`). Publikuje sa
preto z **commitnutého HEAD**, nie zo stromu:

```bash
OUT=/d/OKO/publish-build; rm -rf "$OUT"; mkdir -p "$OUT"
git archive --format=tar HEAD | tar -x -C "$OUT"; cp .env "$OUT/.env"
```
```powershell
New-Item -ItemType Junction -Path 'D:\OKO\publish-build\node_modules' -Target 'C:\AI\OKO\oko\node_modules'
```
```bash
cd /d/OKO/publish-build && npm run build
```
```powershell
robocopy 'D:\OKO\publish-build\dist' 'C:\AI\OKO\oko\dist' /MIR
powershell -ExecutionPolicy Bypass -File scripts\oko-publish.ps1 -SkipBuild
```
Overenie: `curl -s https://oko.uhrin.digital/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'`
musí ukázať hash z `dist/index.html`; `/api/gas/pipelines/meta` 200.
Zdieľané súbory sa do commitu stagujú cez **HEAD-copy** (index blob z
`git show :súbor` + moje hunky → `git hash-object -w` → `git update-index
--cacheinfo`), aby commit niesol len moje riadky.

## 5. Čo je namerané (nie odhadnuté)

- Etapa 0 (GTX 1080 Ti, produkčný build): sieť 18 378 entít = 4 draw commandy,
  **+1,0 ms/snímok** zo 600 km, +307 MB haldy, stavba 748 ms; vypnutie vrstvy
  neuvoľní nič. Etapa 5: celá vrstva s plotmi **+1,5 ms** zo 700 km (8,3 vs 6,8 ms).
- Sharpen (predvolený štýl): 1,4–3 px čiara sa oreže na bielu 255,190,255;
  od **4 px** prežije 2 px jadro (212,164,228). Obrys na pozemnej čiare KRESLÍ,
  DDC na inštanciu funguje, dash + tmavá gapColor funguje.
- Snímky: plyn 18 740 úsekov / 8 602 pomenovaných / 247 534 km (2 243 v 112
  reláciách, 18 498 s krajinou), ropa 2 599 / 1 665 / 77 962 km (1 001 v 50
  reláciách, 2 563 s krajinou). Scény: Hormuz 24 úsekov, Malacca 10, Suez /
  Báb al-Mandab / Panama 0 (poctivé diery).
- Duch: kohorta 60 úsekov / 462 vrcholov → výšky za 260 ms cez `/api/terrain/heights`.
- Farby: ropa `#eab2ff` je 48,9 dE2000 od plynu `#ffb14d`, 36,2 od plotu hraníc
  `#f0574d`, 41,9 od koridorov; pod deuteranopiou 53,4 / 50,6.

## 6. Rozhodnutia a prečo

- **Ropa = vlastný súbor a trasa**, nikdy nezlúčiť s plynom: ODbL §4.5(a)
  Collective Database vs Derivative Database.
- **Farba nie je jediný kanál**: látka je v karte slovom pri OBOCH látkach.
- Voľby `gas`/`oil`: absent = zapnuté, aby `v=2&l=0` znamenalo to, čo vrstva kreslí.
- `classificationType` **BOTH** zámerne: prepnutie podľa podkladu prestaví
  21 000 entít (~750 ms) za < 1 ms/snímok.
- Výber = **jedna entita vo vlastnom zdroji** (klik už neprestavuje dávku).
- Duch berie výšky z **`terrainHeights.js` resolvera** (Re:Earth). Nie
  `scene.sampleHeightMostDetailed` (núti načítať najdetailnejšie 3D dlaždice
  v okruhu 250 km — kvóta, v pane sa nedokončilo), nie
  `Cesium.sampleTerrain(viewer.terrainProvider)` (na fotoreáli je provider
  plochý EllipsoidTerrainProvider → výšky 0).
- Skupiny (celá trasa): relácia, inak meno+prevádzkovateľ; všeobecné mená
  („лупинг", „Нефтепровод", „gas pipeline"…), mená < 4 znaky, skupiny > 120
  úsekov a samotári skupinu netvoria. **Tiling pre culling zámerne nie** —
  čas snímku nie je prekážka, zlúčenie geometrií by rozbilo atribúty na úsek.
- Plot rúr (7 km / 200–1 100 km, iná výška aj odtieň než plot hraníc 18 667 m /
  300–1 300 km) bol postavený a **vypnutý na žiadosť používateľa** — z ~400 km
  vyzeral ako reťaz škatuliek. Ak sa má vrátiť, najprv bez `outline` (zvislé
  hrany na koncoch úsekov robia „stĺpiky") a možno len pre relácie ako celok.
- GEM tracker ZAMIETNUTÝ (formulár s osobnými údajmi) — Záliv je bez mien rúr.

## 7. Pasce (naučené za deň)

- `String.replace(a, "…$`…")`: `` $` `` a `$'` v REŤAZCOVEJ náhrade rozvinú
  časť súboru — vždy funkcia `() => b`. Poškodilo to `docs/CURRENT-STATE.md`.
- `\w` v JS regexe bez `u` nechytí cyriliku → `[а-яё]`.
- Medzery v `formatGwhDay` / `pipelineSourceLabel` sú U+202F / U+00A0 — v testoch `\s`.
- Heredoc v bashi mení `\b` na backspace 0x08 (prejde `node --check`).
- Pane: v skrytom pane nebeží rAF (dlaždice poháňať `scene.render()`),
  `camera.flyTo` pri 403 dlaždiciach zamrzne → `setView`, JS call má strop 45 s.
- Cesium: `depthFailMaterial` sa pri CallbackProperty ticho zahodí (statické
  entity); `distanceDisplayCondition` na ground polyline funguje na inštanciu;
  ground polyline sa 3×3 pickom netrafí → `scene.pick(pos, 7, 7)`.
- `GeoJsonDataSource` s Point v Node potrebuje `document` (pin cez canvas) —
  testy lokálnych vrstiev používajú Polygon.
- Tripwire `contextMenu.test.mjs`: žiadny holý `cursor: pointer` v CSS —
  `var(--cursor-pointer)`.
- Schéma hlasových nástrojov vo `vite.config.js` je pinovaná na bajt
  (`firstRunExperience.test.mjs`) — nové aliasy len v `gevActions.js`.
- Pri Overpass relácii má členská cesta VLASTNÚ `substance` — kontrolovať prvú.

## 8. Otvorené body (na neskôr)

1. Viac bodov ENTSOG pre hover: Yamal–Európa → Mallnow / Kondratki, TAG →
   Arnoldstein, Transitgas → Wallbach / Passo Gries, MEGAL, WAG — každý overiť
   proti ENTSOG TP `operatorpointdirections`, nikdy hádať.
2. Plynový `EXCLUDED_USAGE` nemá `flowline|flare_header|collection` (ropa má).
3. Duch vs. hrubý mesh: pri nízkom LOD fotoreálu mesh sedí nad DEM → duch
   čiarkuje aj viditeľné úseky; overiť na obrazovke používateľa, prípadne
   `PIPELINE_GHOST.liftM` alebo skryť pri hrubom tilesete.
4. Šírky 6/5/4/3 px a plot 7 km sú merané v pane — overiť u používateľa.
5. Dotyk: hover karta nemá dotykový ekvivalent (ťuknutie = klik-karta áno).
6. Hlas neovláda čipy PLYN/ROPA (schéma nástrojov pinovaná).
7. `pressure` bez jednotky dostáva „bar" (OSM wiki) — predpoklad.
8. Ukrajinčina bez ukrajinských písmen a bez `name:uk` padá na ruský prepis.
9. Suez / Báb al-Mandab / Panama bez rúr — poctivé diery (Panama navždy mimo okna).
10. z-index tokeny sa líšia na troch miestach — zjednotiť po meteo agentovi.
11. Republikovať, keď meteo agent commitne (dnes išiel build bez jeho zmien).
12. Snímky OSM starnú — občasná prestavba s `--refresh` (ručne, s rozvahou).
13. Plot rúr, ak sa má vrátiť: bez obrysov, jedna stena na trasu (reláciu), nie na
    úsek; dnes vypnutý (`PIPELINE_FENCE.enabled`).

## 9. Commity (2026-09-19)

`b923bc9` etapa 0 merania · `db15424` etapa 1 južné dlaždice · `2d61e7c` palce
· `cc4e0fa` ropný snímok · `6731fbd` ropa na mape · `58c5778` kredit/hlas/docs
· `8a1d434` člen relácie s inou látkou · `7d58994` audit etapy 2 · `b2be65f`
etapa 3 čipy + hover · `0ef6130` 3b hranice/latinka/vlajky · `cc83a0d` etapa 4
· `0412cc5` etapa 5 · `d098f6b` etapa 6 · `f284579` hover lokálnych značiek.
