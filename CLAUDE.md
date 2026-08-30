# CLAUDE.md — OKO

**OKO** (pracovný názov) je fork projektu [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
(MIT) — živá priestorová inteligencia na fotorealistickom 3D glóbuse, s dôrazom
na stredoeurópske dátové zdroje.

V commitoch, docs a UI používaj názov **OKO**. Pôvodný projekt označuj ako
"upstream" alebo jeho pôvodným menom — nie ako "the project".

Názov je pracovný. Nezaťahuj ho do slugov balíčkov, názvov modulov ani do
konfigurácie hlbšie, než je nutné — môže sa zmeniť.

## Čo to je

Fotorealistický 3D glóbus so živými dátovými vrstvami (lietadlá, lode, satelity,
zemetrasenia, kamery, doprava) a hlasovým ovládaním cez OpenAI Realtime API.

**Cieľ forku:** doplnenie SK/CE dátových zdrojov a riešenie obmedzení
Google 3D Tiles v EHP.

Upstream ostáva ako remote `upstream`. Zmeny držíme v tematických vetvách, aby sa
dal rebase na upstream bez konfliktného pekla.

## Stack a spustenie

- Vanilla JavaScript, CesiumJS, Vite. **Žiadny framework** — nepridávaj React/Vue.
- Node.js 24.14.x alebo 26.x (vynútené cez `package.json`).

```bash
npm install
npm run dev -- --host localhost --port 4173
```

Dev server sa viaže na localhost. Nikdy ho neprepínaj na `0.0.0.0` bez toho, aby si
sa ma spýtal — LAN-viditeľný server sprístupní moje API kľúče komukoľvek v sieti.

## Štruktúra

```
src/
├── main.js                 # bootstrap: Google 3D tiles, registrácia vrstiev
├── ui.js                   # panely, HUD, štýly, control facade
├── hud.js                  # intelligence HUD + AI súhrn scény
├── mapStackController.js   # prepínanie Google 3D / Bing / OSM
├── iconOrientation.js      # world-space headingy premietnuté do screen-space
├── voice/                  # OpenAI Realtime session + voice tools
├── data/                   # jeden modul na vrstvu + management + context store
│   └── local_data/         # bundlované datasety (provenance per priečinok)
└── scenes/                 # cinematic scene director
```

`docs/CURRENT-STATE.md` je autoritatívna referencia runtime. Prečítaj si ju predtým,
než sa pustíš do zmien v `src/`.

## Pravidlá práce

1. **Existujúci layer modul je šablóna.** Keď pridávaš novú vrstvu, najprv si prečítaj
   dva-tri existujúce moduly v `src/data/` a drž sa ich tvaru — registrácia, freshness
   stav, zdroj, cleanup.
2. **Zdroj a stav dát musia byť viditeľné.** Projekt zásadne odlišuje živé dáta od
   modelovaných. Ak je vrstva simulovaná, odhadnutá alebo zastaraná, musí to byť
   označené v UI. Toto neobchádzaj.
3. **Kľúče nikdy do prehliadača.** Všetko, čo nesie secret (OpenAI, AISStream, TomTom,
   FIRMS, prípadne nové SK zdroje s tokenom), ide cez server-side proxy s cache
   a rate limitom. Do klienta smú len Google Maps a Cesium ion kľúč — a tie sa
   reštrikujú u providera.
4. **Rozpočet.** Platené feedy bežia za cachovanými proxy s budget governorom.
   Keď pridávaš zdroj s kvótou, pridaj aj cache a strop. Pred akýmkoľvek krokom,
   ktorý môže stáť peniaze, sa ma opýtaj.
5. **Testy.** Pozri `TESTING.md`. Nová vrstva = nové unit testy. Pred commitom
   spusť celú suite.
6. **Etická čiara upstreamu platí aj tu.** Projekt modeluje objekty, infraštruktúru
   a systémy — nie ľudí. Žiadne vyhľadávanie osôb, rozpoznávanie tvárí ani sledovanie
   jednotlivcov. Ak ťa niečo tlačí týmto smerom, zastav sa a povedz mi to.
7. **Licencie dát.** Každý nový zdroj zapíš do `DATA_SOURCES.md` aj s podmienkami
   použitia. Slovenské kamerové zdroje väčšinou **nie sú** deklarované otvorené dáta —
   pred integráciou overíme ToS. Pozri skill `sk-data-source`.

## SK roadmapa

Poradie je zámerné — začíname tým, čo overí, či má zmysel pokračovať.

### Fáza 0 — čo vlastne dostanem
- Rozbehať upstream ako je, s mojím Google kľúčom a slovenskou fakturačnou adresou.
- Overiť reálne pokrytie Google Photorealistic 3D Tiles nad SK: Bratislava,
  Dunajská Streda, Šamorín, Topoľníky. Od 8. 7. 2025 platia pre EHP osobitné
  podmienky Maps Platform a časť obsahu sa nevracia — potrebujem vedieť, čo z toho
  je 3D mesh a čo len terén s ortofotom.
- Overiť, či cez AISStream vidno plavidlá na Dunaji (terestriálne AIS pokrytie závisí
  od prijímačov v okolí).
- Výstup: krátky zápis do `docs/SK-NOTES.md`.

### Fáza 1 — mapový podklad
Ak je 3D pokrytie slabé, doplniť do `mapStackController.js` slovenské podklady:
- ÚGKK ortofotomozaika SR (WMS/WMTS)
- LiDAR DMR 5.0 ako terrain provider

Cesium vie konzumovať oboje. Cieľ: použiteľný podklad aj tam, kde Google nemá mesh.

### Fáza 2 — SK CCTV vrstva
Nový modul podľa vzoru existujúcej CCTV vrstvy. Kandidátske zdroje:
zjazdnost.sk (SSC), NDS, regionálne portály, mestské kamery Bratislavy.

Sú to periodicky obnovované JPEG snímky, nie streamy, a nemajú dokumentované
verejné API. **Pred implementáciou preveríme podmienky použitia** — skill
`sk-data-source`. Pózy kamier sa kalibrujú ručne cez gizmo v scéne — začneme
s malým setom v okolí Bratislavy a Dunajskej Stredy.

### Fáza 3 — SHMÚ
Zrážkový radar ako imagery vrstva, hydrologické stavy Dunaja a Váhu ako bodová vrstva.

### Fáza 4 — kozmetika
- Podmorské káble sú pre vnútrozemský štát mŕtva vrstva — nahradiť plynovodmi
  a elektrickým vedením z OSM.
- SK preset pre first-run mission card.

## Čo nerobiť

- Nekomitovať `.env` ani žiadny kľúč. Skontroluj `.gitignore` pred prvým pushom.
- Neprepisovať upstream súbory tam, kde stačí nový modul — uľahčuje to rebase.
- Nepridávať build step ani framework.
- Nespúšťať nič, čo generuje Google root tile requesty v slučke. Mám nastavenú
  dennú kvótu na Map Tiles API a billing alert; drž sa pod nimi.
