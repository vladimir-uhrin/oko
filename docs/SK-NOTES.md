# SK-NOTES

Zistenia o slovenských podmienkach a dátových zdrojoch.
Zapisuje sa sem výsledok Fázy 0 a každého prevereného zdroja.

---

## Fáza 0 — pokrytie Google Photorealistic 3D Tiles nad SK (2026-08-30)

**Setup:** GCP projekt `oko-dev-507115` (vytvorený 2026-08-30, billing účet so SK
adresou), Map Tiles API, kľúč obmedzený na `http://localhost:4173/*` + Map Tiles
API. Denné kvóty: 3D root 500, 2D 10 000, Street View 1 000. Budget 10 €/mes.

**Metodika:** headless Chromium (SwiftShader) proti dev serveru, kamera
`setView` ~800–900 m nad miestom, pitch ≈ −31°, čakanie na
`googleTileset.tilesLoaded`, screenshot. Skript: `scripts/qa-sk-coverage.mjs`
(výstup do `qa-shots/sk-coverage/`, gitignorované). Viedeň slúži ako kontrola
so známym plným 3D pokrytím.

### Výsledky

| Lokalita | Výsledok |
|---|---|
| Viedeň (kontrola) | ✅ plný fotogrametrický 3D mesh |
| Bratislava — hrad/centrum | ✅ plný 3D mesh (budovy, kopce, vily); pri zemi miestami hrubší LOD než Viedeň |
| Bratislava — Petržalka/most SNP | ✅ 3D mesh cez rieku; brehy v popredí hrubšie |
| Šamorín | ❌ len terén + ortofoto (žiadna extrúzia budov v šikmom pohľade) |
| Dunajská Streda | ❌ len terén + ortofoto (štadión aj bytovky ploché) |
| Topoľníky | ❌ len terén + ortofoto |

**Záver:** mesh je mestský — Bratislava áno, Žitný ostrov nie. Fáza 1 (ÚGKK
ortofotomozaika + LiDAR DMR 5.0 ako terrain provider) má pre projekt zmysel
presne tam, kde bude OKO najviac používané (DS, Šamorín, Topoľníky).

### EHP podmienky — dôležitá kaveát

Podľa [oficiálnych EEA úprav Map Tiles API](https://developers.google.com/maps/comms/eea/map-tiles)
majú projekty vytvorené po 8. 7. 2025 s EHP fakturačnou adresou dostávať na
fotorealistické 3D tiles (aj 2D satelit) **HTTP 403**. Empiricky 2026-08-30:
`root.json` aj obsah **tečú bez 403** (overené z originu `localhost:4173`).
Buď sa politika/vymáhanie medzičasom zmenili, alebo je enforcement per-účet.
**Považovať za krehké** — pred väčšou prácou nad 3D vrstvou vždy pretestovať
(`scripts/qa-sk-coverage.mjs`), fallback podklady z Fázy 1 ostávajú strategické.

### AIS na Dunaji — ✅ POKRYTÉ (doplnené 2026-08-30 ~22:40)

Po registrácii `AISSTREAM_API_KEY` (bezplatný, aisstream.io, server-side):
websocket nabehol na prvý pokus a už po ~2 minútach akumulácie bolo
v úseku Bratislava–Komárno (bbox 47.72–48.17 N, 16.95–18.25 E) **5 plavidiel
s pozíciami čerstvými na sekundy**: TURIEC, PREŠOV, MUFLON8 (MMSI prefix 267
= SK) a ARIANA (BG) v bratislavskom prístave, **BD TEKOV pri Hrušovskej
zdrži** — terestriálne pokrytie teda siaha aj pod Bratislavu smerom na
Gabčíkovo. Nedeľná noc, všetko na kotve (spd 0) — očakávané; cez deň bude
tranzit bohatší. Globálny feed v tom čase ~4 800–9 000 lodí. Vizuálne overené
v appke (chevrony + label MUFLON8 v prístave). Fáza 0 je týmto kompletná.

## Fáza 1 — ÚGKK ortofotomozaika ako mapový stack (2026-08-30)

**Preverenie (skill `sk-data-source`):**
- Oficiálna služba: WMS `https://zbgisws.skgeodesy.sk/zbgis_ortofoto_wms/service.svc/get`
  (GKÚ Bratislava). WMTS existuje len v S-JTSK — pre Cesium je WMS jednoduchší.
- Licencia — citácia priamo zo služby (`GetCapabilities` → `AccessConstraints`):
  **„CC BY Creative Commons Attribution („uvedenie autora") 4.0"**. Stránka WMS
  služieb GKÚ uvádza atribúciu „GKÚ Bratislava". Atribúcia v appke:
  „Ortofotomozaika SR © GKÚ Bratislava, NLC (CC BY 4.0)" — na credit line pri
  aktívnom stacku + v Data attribution popoveri.
- Vzorka: `GetCapabilities` 200 (bez rate-limit/cache hlavičiek, F5 LB cookies);
  CRS zahŕňa EPSG:3857 aj 4326; vrstvy: `1` = Ortofoto (čistá mozaika),
  `2` = Footprint, `3` = Boundary (zelený klad — nepoužívať). `GetMap` 512×512
  JPEG nad Dunajskou Stredou: 200, ~82–116 kB, plné rozlíšenie.
- Obsah sa mení v 2–3-ročných cykloch (3. cyklus: východ SR 2025) → žiadny
  polling, dlaždice sa v session cachujú v Cesiu.

**Implementácia:** stack `ugkk-ortofoto` („SK Orto") v `src/mapStackController.js`
— opt-in, 512 px dlaždice, `maximumLevel` 19, rectangle orezaný na SR (mimo
pokrytia sa negeneruje žiadny request; zvyšok glóbusu je pri tomto stacku
zámerne prázdny). Unit testy: `src/mapStackController.test.mjs`.
**QA/screenshot slučky nad týmto stackom nepúšťať** — je to verejne financovaná
infraštruktúra; na QA používať OSM.

**Chip v UI doplnený až 2026-09-01** — `mapStackChips.js` má EXPLICITNÝ
allowlist `PRESENTED_MAP_STACK_IDS` (upstream ho zaviedol, aby sa interný
stack nedostal do lišty omylom) a pri Fáze 1 sa naň zabudlo: podklad fungoval
(WMS 200), ale používateľ sa k nemu nevedel preklikať — dostupný bol len cez
API/voice/share link. Nový tripwire test páruje `MAP_STACKS` s allowlistom,
takže ďalší podklad už takto nezmizne.

## Fáza 2 — SK kamery (2026-08-30, preverenie + scaffold)

**zjazdnost.sk (SSC)** — jediný životaschopný zdroj, a je **sezónny**:
- Podmienky (citácia z /share/copyright.html, produkt „Údaje o počasí
  a zjazdnosti ciest"; držitelia práv: SSC, NDS, Granvia, krajské správy,
  Magistrát BA): *„Údaje, publikované na týchto stránkach sú verejné a môžu
  byť ďalej šírené a distribuované, za predpokladu uvedenia informácie, že
  zdrojom týchto údajov je stránka www.zjazdnost.sk, prevádzkovaná Slovenskou
  správou ciest."* `robots.txt` neexistuje.
- Portál dnes hlási: *„Údaje o aktuálnom počasí nie sú momentálne k dispozícii.
  Tieto dáta sa zbierajú iba počas výkonu zimnej údržby ciest."* Aj `meteo.*`
  domény v mapových objektoch (`/map/view.html` → `mapObjectsIcons`) sú mimo
  sezóny prázdne → stanice, snímky aj URL vzor sú do zimy nezistiteľné.
- **Scaffold hotový bez vymýšľania API:** upstream CCTV vrstva je katalógová
  (`CCTV_SOURCES_FILE` → JSON pole, schéma `normalizeSourceItem` vo
  vite.config.js) — SK kamery vojdú ako dáta, nie kód. Pripravené:
  `config/cctv_sources.sk-zjazdnost.json` (prázdny) +
  `config/cctv_sources.sk-zjazdnost.SOURCE.md` (šablóna záznamu, povinná
  atribúcia, zimný checklist: vzorka snímky, kadencia, UTM→WGS84, gizmo pózy).

**NDS** — verejný kamerový feed neexistuje (dopravná mapa portálu nemá
v bundli jedinú zmienku o kamerách); mýtne/známkové kamery (čítanie EČV) sú
mimo etickej čiary projektu. Nepoužiteľné.

**Mestské kamery Bratislavy** — `kamery.bratislava.sk` je mŕtve (404),
livestreamy z 2020 boli dočasné, mestský kamerový systém je policajný
(uzavretý). Momentálne žiadny verejný zdroj.

**data.slovensko.sk** — žiadny kamerový dataset v registri.

## Fáza 3 — SHMÚ (2026-08-30, radar hotový)

**Zrážkový radar — implementované.** Zdroj `opendata.shmu.sk`:
- Licencia — citácia z [README.txt](https://opendata.shmu.sk/README.txt):
  *„Prístup je udelený bez registrácie. Platia nasledujúce podmienky
  používania: https://creativecommons.org/licenses/by/4.0/deed.sk"* (server si
  30 dní drží IP adresy kvôli prevádzke). **CC BY 4.0, bez kľúča.**
- Produkt: kompozit `zmax` (max. odrazivosť v stĺpci, DBZH) z 5 rádiolokátorov
  (CZSKA/JAV/KOJ/KUB/LAZ), ODIM_H5, **každých 5 min**, ~40 kB, publikácia
  ~1 min po termíne. Mriežka 1560×2270, Mercator (+lon_0=18.7, lat_ts=48.43),
  rohy LL(46.047, 13.6)–UR(50.7, 23.804) — pokrýva SK aj široké okolie.
  K dispozícii aj `cappi2km`, `etop`, `pac01` (1h úhrn) — do budúcna.
- Vzorka: 200 OK, `application/x-hdf`, ETag + Last-Modified, žiadne rate-limit
  hlavičky. Proxy robí ≤12 fetchov/h (TTL = kadencia produktu).
- Implementácia: `shmuRadarProxy` vo vite.config.js (dekód jsfive → despeckle →
  prevzorkovanie Mercator→lineárna šírka → dBZ paleta → soften → PNG; disk
  cache, serve-stale s flagom), vrstva `src/data/shmuRadar.js` — obdĺžniková
  entita vo 4 km (viditeľná aj na photoreal stacku, kde je glóbus skrytý),
  stav staleness v paneli. Testy: `src/data/shmuRadar.test.mjs` + fixture.
- **Grafika (lekcia z 2026-08-30, ~21:30):** surový `zmax` je v lete v noci
  nepoužiteľný — kompozit maxíma stĺpca zosilňuje **nočnú migráciu
  vtákov/hmyzu** (súvislé koherentné polia, filter susedov ich nezoberie)
  a **clutter tatranského hrebeňa**. Meranie na rovnakom slote:
  zmax 6 966 despecklovaných echo px vs. **cappi2km 1 769** → default
  je `cappi2km` (odrazivosť v 2 km), prah 8 dBZ, despeckle 5×5 (≥6 susedov,
  prežije ≥3×3 zhluk ≈ 1 km jadro prehánky) + premultiplied dilate/blur do
  mäkkých blobov. Daňou je plytké mrholenie pod 2 km; `SHMU_RADAR_PRODUCT=zmax`
  prepne späť na maximum stĺpca.

**Hydrológia (Dunaj/Váh) — zatiaľ NIE.** V opendata strome nie je; operatívne
vodné stavy sú len na portáli shmu.sk (HTML) a v Modrej platforme
(mpl.his.shmu.sk). Modrá platforma preverená 2026-08-30: prihlásenie cez
Keycloak, sekcia „Dátové služby" je **v príprave**, žiadna deklarovaná
otvorená licencia (len „za podmienok stanovených príslušnými právnymi
predpismi") → neimplementovať. Sledovať spustenie „Dátových služieb";
alternatívne vyžiadať podmienky od SHMÚ priamo.

## Fáza 4 — kozmetika (2026-08-30)

**4a — Energetika SR namiesto podmorských káblov.** Nová bundlovaná vrstva
`local-energy` („Energetika SR", ⚡): 400/220 kV prenosová sústava (584 línií)
+ tranzitné plynovody (102 línií) z OSM — ODbL, snapshot 2026-08-30,
provenance a deterministický transform v
`src/data/local_data/sk_energy/SOURCE.md` + `scripts/build-sk-energy.mjs`
(build je manuálny, nikdy nie CI — Overpass etiketa; kanonický endpoint bol
v deň buildu nedostupný, použitý mirror maps.mail.ru). Clampované ground
polylines (400 kV hrubšie, 220 kV tenšie, plyn jantárový) — funguje na
photoreal aj glóbusových stackoch. Káblová vrstva ostáva v kóde (rebase),
len už nie je jediná „infra" voľba.

**4b — SK first-run.** Prvý let už nejde do Austinu: `flyToBratislava`
(kamera JZ od centra, pohľad cez Dunaj na Staré mesto — plný 3D mesh podľa
Fázy 0). Mission karta má novú prvú dlaždicu **SLOVENSKÝ PREHĽAD** —
zámerne úplne keyless (SHMÚ radar CC BY + bundlovaná energetika ODbL),
takže prvý klik nového návštevníka vždy doručí. Hlasové aliasy: „radar",
„precipitation" → shmu-radar; „energy", „energetika", „power grid",
„pipelines" → local-energy.

## Polish blok (2026-08-30 večer)

- **SK Orto má OSM podklad** (`underlayStackId` v mapStackController) a WMS
  beží na transparentnom PNG — mozaika kopíruje hranice SR nad čitateľným
  svetom namiesto čiernej gule s bielou svätožiarou.
- **Radar poctivo hlási čas**: freshness vrstvy = čas platnosti produktu
  (nie čas fetchu), `stale` je prvotriedny feed-stav (STALE chip cez
  layerFeedState) a source label žije: „SHMÚ cappi2km · HH:MM UTC".
- **dBZ legenda v UI** (2026-08-31): `#radar-legend` chip vľavo dole —
  farebný pás priamo z `ZMAX_DBZ_PALETTE` (`radarLegendStops()`, jeden zdroj
  pravdy pre render aj legendu), ticky 8–60 dBZ, titulok s časom platnosti
  produktu + `data-stale`. Zobrazí sa len so zapnutou vrstvou; skrytá
  v clean-view/recording/cockpit/scene režimoch.
- **Radarová animácia** (2026-08-31): proxy drží ring posledných 7 snímok
  (~30 min) ako nemenné `/frame/<iso>.png` (immutable cache) a vrstva ich
  prehráva — jeden skrytý Primitive na snímku, slučka len prepína `show`
  (textúry ostávajú rezidentné). Ring je súvislé okno: frames staršie než
  7×5 min od najnovšej sa zahadzujú (aj pri obnove z disk cache), inak by
  po nočnej pauze slučka skákala o hodiny. LEKCIA: výmena materiálu na
  entite reuploaduje 3,5-Mpx textúru pri každom kroku a materiál medzitým
  renderuje bielu; a Material, ktorému dáš URL, si PNG fetchne sám ešte raz —
  transientný fail (504) znamená textúru 0×0, „Expected width > 0"
  a **navždy zastavený render**. Preto sa snímka preload+decode-ne
  a do Materialu ide hotový HTMLImageElement, nie URL.
- **Energetika je klikateľná**: 688 línií registrovaných v context store,
  label karty = legenda („Vedenie 400 kV" / „Vedenie 220 kV" /
  „Plynovod (tranzit)", meno V-čka keď existuje).
- **Branding OKO**: titulok, HUD hlavička aj loading screen („OKO — ŽIVÝ
  POHĽAD NA SLOVENSKO"), podľa pravidla z CLAUDE.md.
- **SK misia rámuje Slovensko** (`cameraRectangleDegrees`), nie celý glóbus.

### Fáza 1b — SK terén (2026-08-31, HOTOVÉ — DMR 3.5 celoštátne)

Oficiálny Cesium terrain (quantized-mesh) od GKÚ neexistuje, preto self-host:

- **Zdroj: DMR 3.5, 10 m, celá SR** — `opendata.skgeodesy.sk/static/DMR3_5/dmr3_5-10.zip`
  (~2,3 GB; stránka GKÚ tvrdí 12 MB, neveriť). CC BY 4.0, autor ÚGKK SR
  (deklarované na GKÚ „Na stiahnutie"; DATA_SOURCES.md). DMR 5.0/6.0 v 1 m sú
  na neskoršie lokálne upgrady: 5.0 je JEDEN 190 GB deflatovaný TIFF (server
  podporuje Range, ale deflate nemá random access — nepoužiteľné po častiach),
  6.0 je po LOT-och 8,7–14,8 GB — použiteľný per-región vstup do tej istej
  pipeline. MAPKA export (výrezy do 400 km²) vyžaduje e-mail + súhlas per
  žiadosť — nie je to programová cesta.
- **Pipeline: `scripts/build-sk-terrain.mjs`** (Docker: osgeo/gdal +
  tumgis/ctb-quantized-mesh): download → warp `EPSG:5514+8357 → EPSG:4979`
  s `PROJ_NETWORK=ON` (Bpv→ELIPSOIDNÉ výšky; overené: Tatry +42,9 m
  undulácia, PROJ si stiahol transformačné gridy, presnosť ~1 m) → relabel
  4326 → maska platnosti → `ctb-tile -f Mesh -C -N` z14→z0 → **prune na
  vnútro dátového footprintu** (maskCoversTile s eróziou okraja).
- **Merge, nie náhrada** (OKO nie je SK-only): Cesium má jeden
  terrainProvider a keyless stacky už majú celosvetový Re:Earth (elipsoidný).
  `/api/sk-terrain` (vite proxy) servíruje Re:Earth layer.json (plná
  availability do z14), lokálnu DMR dlaždicu keď existuje, inak passthrough
  s write-through cache. Prune garantuje, že hraničné dlaždice ostávajú
  Re:Earth — nodata útes na 0 m nemôže vzniknúť. Klient
  (`_getKeylessTerrainProvider`) si merge endpoint vyberá probe-om;
  produkčný build bez middleware padá na priamy Re:Earth. Ion „world"
  režim (Cesium World Terrain) sa nemení.
- **Výškový kontrakt §1a platí**: mergované dlaždice sú elipsoidné ako
  Re:Earth, `groundPriorM`/geoid logika sa nemení.
- LEKCIA: vite watcher sledoval `.gev-cache/` — download so zamknutým súborom
  (EBUSY z chokidar) ZABIL dev server. `server.watch.ignored` teraz kryje
  `.gev-cache/**` aj `qa-shots/**` (pin v skTerrain.test.mjs).
- ZBGIS 3D klient má interný terrain endpoint, ale je nedokumentovaný —
  nepoužívať.

### Prevádzkové poznámky

- **Kvóta Google root requestov sa dá minúť testovaním** (2026-09-01: 429 na
  `root.json` po dni s desiatkami headless bootov — appka korektne padla na
  OSM; reset kvóty je o polnoci PT = 09:00 SELČ). Odvtedy: KAŽDÝ headless/QA
  boot appky, ktorý nepotrebuje photoreal, ide na `?qaBasemap=osm` — Google
  tileset sa vôbec nevytvorí a kvótu šetríme reálnym pozeraniam. Výnimka:
  `qa-sk-coverage.mjs` (jeho účel JE Google mesh; 1× týždenne cez watchdog).

- Optional endpointy bez kľúčov: `/api/google/nearby-places` → 403 (kľúč nemá
  Places API — zámer), `/api/openai/hud-summary` → 503 (bez OpenAI kľúča).
  Appka beží normálne.
- Jeden headless beh cez 6 lokalít spotrebuje ~1–2 root requesty (jedna
  session, jeden tileset) — kvóta 500/deň je pohodlná.
