# Zadanie: AISHub ako druhý zdroj lodí (oneskorený) — Cesta A (2026-09-15)

Nadväzuje na `docs/research/ais-free-coverage-2026-09-15.md` (merania + citácie).
Stav: **návrh zadania, nič nie je implementované.** Cesta B (vlastný prijímač → AISHub)
je samostatné rozhodnutie používateľa, toto zadanie na nej nezávisí.

## Cieľ

Doplniť celosvetové pokrytie lodí tam, kde dnes `ais-live` (aisstream.io, terestriálna sieť)
nevidí nič — Hormuz, Singapur, Mexický záliv, Južná Amerika, India. Zdroj: **agregát AISHub
cez aiscast** (`https://ais.openwaters.io/v1/vessels?bbox=`), ktorý je bez tokenu, bez účtu a
s atribúciou pri každej lodi.

Merané 2026-09-15 (aiscast `/v1/stats`): AISHub **48 926 plavidiel / 24 h, 24 885 výhradných**,
oneskorenie p50 59 s; aisstream súčasne 24 024 plavidiel, z toho výhradných len **242**.

## Vzor, ktorý už v projekte existuje (nerobiť novú architektúru)

`src/data/gfwPresence.js` (2026-09-12) — oneskorený satelitný AIS, ktorý je vedľa živých lodí
a **zdieľa s nimi trup aj farbu** (`shipIconDataUrl` v `aisLiveVessels.js`, komentár
„sprav ako ostatné lode"). AISHub je presne ten istý prípad: druhá, oneskorená trieda lodí,
nie nová vrstva s vlastným glyfom.

## Rozsah práce

1. **Proxy** (`vite.config.js`), nová trieda vedľa `gfwPresenceProxy`:
   - `GET /api/aiscast/vessels?bbox=west,south,east,north`
   - validácia bboxu existujúcim parserom; **odmietnuť plochu > ~90 štvorcových stupňov**
     s jasnou správou (anonymný strop aiscastu je 100 sq°, overené: `400 bbox not allowed for this key`).
   - disk/memory cache 60 s na bbox, in-flight dedupe, per-client rate limit, rešpektovať
     ich 120 req/min na adresu, honest `User-Agent`, žiadny token (žiadny secret v klientovi).
   - zdroj nepotrebuje kľúč — do `.env` nič nepribudne.
2. **Klient**: `src/data/aishubVessels.js` (+ `.test.mjs`):
   - dotaz na viditeľný výrez pri `camera.moveEnd` (debounce), len keď je výrez ≤ strop;
     pri malom zoome (celý glóbus) sa **neťahá nič** — žiadne predstieranie pokrytia.
   - riadky nesú `source: 'AISHub'`, `observedAt`, oneskorenie; **deduplikácia podľa MMSI**:
     živý záznam z aisstream vyhráva, AISHub riadok sa zahodí (ale `source` badge ostáva pravdivý).
   - karta a rail: rovnaké plumbiny ako `gfwPresence`; v karte a v rail riadku musí byť
     **„AISHub · oneskorené ~1–6 min"**, nikdy nie LIVE.
3. **Licencie a atribúcia** (povinné, pravidlo projektu):
   - `attribution` vracia aiscast na úrovni kolekcie, napr.
     `"aishub": "Open Waters AIS (https://openwaters.io/ais/). AISHub (https://www.aishub.net)"`
     → zobraziť v source line a pridať `DATA_CREDITS` entry (vzor `austin-cctv`).
   - riadok do `DATA_SOURCES.md`: AISHub členstvo („All contributors are allowed to use the
     aggregated data for free", aishub.net/join-us, citovať doslovne) + aiscast ako re-server
     (`docs/policy.md`: „AISHub confirmed in writing on 2026-08-22 that commercial use and
     redistribution are fine") + poznámka, že OKO je nekomerčné a pred verejným nasadením
     treba písomné potvrdenie (`hello@openwaters.io`).
4. **Testy** (pravidlo: nový zdroj = nové testy): normalizácia riadkov, dedupe proti živému
   záznamu, odmietnutie veľkého bboxu, honest label (nikdy „LIVE" pre AISHub riadok),
   a tripwire, že bez `?bbox=` sa endpoint nevolá.

## Akceptácia

- Hormuz a Singapur ukazujú lode tam, kde dnes nie sú žiadne; Európa sa nemení.
- Živá vrstva `ais-live` nemá regresiu (rovnaký zdroj, rovnaké správanie, rovnaké oneskorenie).
- AISHub riadok je v UI vždy označený ako oneskorený a s atribúciou.
- `npm test` zelené (baseline ~3 254).

## Čo nerobiť

- Nepresúvať živý stream na aiscast: celosvetový odber má až feeder tier (potrebuje vlastný
  prijímač, Cesta B) — bez hardware by to znamenalo cap 400 sq° na pripojenie.
- Neoznačovať AISHub riadky ako LIVE a nemiešať ich do počtu „live plavidiel".
- Nepoužiť marinesia.com ani scraping komerčných máp.
- Neposielať dáta z aiscast do AISHub (jeho ToS zakazuje feedovať dáta z verejných zdrojov).
