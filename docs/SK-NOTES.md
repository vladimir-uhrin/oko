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

### AIS na Dunaji

Netestované — vyžaduje `AISSTREAM_API_KEY` (bezplatná registrácia na
aisstream.io), ktorý podľa bootstrapu odkladáme. HUD ukazuje `AIS: --`.
Úloha: po registrácii kľúča overiť terestriálne pokrytie úseku BA–Komárno.

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
- Implementácia: `shmuRadarProxy` vo vite.config.js (dekód jsfive → prevzorkovanie
  Mercator→lineárna šírka → dBZ paleta → PNG; disk cache, serve-stale s flagom),
  vrstva `src/data/shmuRadar.js` — obdĺžniková entita vo 4 km (viditeľná aj na
  photoreal stacku, kde je glóbus skrytý), stav staleness v paneli. Testy:
  `src/data/shmuRadar.test.mjs` + fixture.

**Hydrológia (Dunaj/Váh) — zatiaľ NIE.** V opendata strome nie je; operatívne
vodné stavy sú len na portáli shmu.sk (HTML) a v Modrej platforme
(mpl.his.shmu.sk). Modrá platforma preverená 2026-08-30: prihlásenie cez
Keycloak, sekcia „Dátové služby" je **v príprave**, žiadna deklarovaná
otvorená licencia (len „za podmienok stanovených príslušnými právnymi
predpismi") → neimplementovať. Sledovať spustenie „Dátových služieb";
alternatívne vyžiadať podmienky od SHMÚ priamo.

### Fáza 1b — DMR 5.0 terrain (úloha, zatiaľ nerealizované)

Oficiálny Cesium terrain (quantized-mesh) pre DMR 5.0 neexistuje — GKÚ poskytuje
len WMS vizualizáciu terénu a download GeoTIFFov (LOT-y, CC BY 4.0 podľa
registra otvorených dát; presné znenie preveriť pri realizácii). Plán:
stiahnuť DMR 5.0 pre Žitný ostrov, zbuildovať quantized-mesh
(cesium-terrain-builder) a servovať lokálne/z vlastného hostingu ako terrain
provider pre keyless stacky. ZBGIS 3D klient má interný terrain endpoint, ale
je nedokumentovaný — nepoužívať.

### Prevádzkové poznámky

- Optional endpointy bez kľúčov: `/api/google/nearby-places` → 403 (kľúč nemá
  Places API — zámer), `/api/openai/hud-summary` → 503 (bez OpenAI kľúča).
  Appka beží normálne.
- Jeden headless beh cez 6 lokalít spotrebuje ~1–2 root requesty (jedna
  session, jeden tileset) — kvóta 500/deň je pohodlná.
