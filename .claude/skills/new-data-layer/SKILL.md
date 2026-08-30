---
name: new-data-layer
description: Pridanie novej živej alebo statickej dátovej vrstvy do glóbusu (src/data/). Použi vždy, keď mám pridať nový zdroj — kamery, hydrológiu, radar, infraštruktúru — alebo keď upravujem existujúcu vrstvu tak, že mení zdroj dát.
---

# Pridanie dátovej vrstvy

## Najprv čítaj, potom píš

Nikdy nezačínaj písaním nového modulu. Poradie:

1. `docs/CURRENT-STATE.md` — autoritatívna referencia runtime.
2. Dva existujúce moduly v `src/data/` — jeden živý (napr. flights, vessels)
   a jeden statický/bundlovaný. Živé a statické vrstvy majú iný tvar.
3. Miesto, kde sa vrstvy registrujú v `src/main.js`.
4. Ako sa vrstva zobrazuje v paneli v `src/ui.js`.

Tvar modulu si odvoď z toho, čo v repe naozaj je. Nevymýšľaj API, ktoré tam
nevidíš, a nepredpokladaj názvy funkcií z iných Cesium projektov.

## Kontrolný zoznam pred implementáciou

Odpovedz na tieto otázky **v odpovedi mne**, nie v kóde, a počkaj na potvrdenie:

- Aký je presný endpoint a formát odpovede? Ukáž mi jednu reálnu vzorku
  (curl, orezanú na rozumnú dĺžku).
- Aká je frekvencia aktualizácie zdroja? Ako často má klient pollovať?
- Potrebuje kľúč? Ak áno → server-side proxy, nie fetch z prehliadača.
- Aké sú podmienky použitia? Odkaz na ToS. Ak nie sú deklarované otvorené dáta,
  zastav sa a povedz mi to.
- Koľko objektov to je? Nad ~5000 entít potrebuje vrstva clustering alebo
  viewport-bounded dotazovanie, inak zabije framerate.
- Sú to živé dáta, alebo modelované/odhadnuté? Toto určuje, ako sa vrstva označí.

## Implementácia

- Jeden modul = jedna vrstva. Nepridávaj vrstvu do existujúceho modulu.
- Drž sa lifecycle vzoru, ktorý vidíš v susedných moduloch: enable, disable,
  update, cleanup. Nezabudni na cleanup — Cesium entity si treba upratať.
- Každá vrstva vystavuje svoj zdroj a freshness stav do UI. Projekt zásadne
  odlišuje živé, oneskorené, čiastočné, simulované a nedostupné dáta. Ak je
  vrstva odhad, musí to byť v UI vidieť — toto nie je voliteľné.
- Výška entít ide cez rovnaký vertikálny datum ako zvyšok projektu, inak ti
  objekty budú lietať nad terénom alebo sa doň zaboria.
- Ikony s orientáciou (čokoľvek, čo sa hýbe a má kurz) používajú
  `iconOrientation.js`. Nerob si vlastnú rotáciu.

## Sieť a rozpočet

- Zdroj s kľúčom alebo kvótou → proxy s cache, timeoutom, stropom veľkosti
  odpovede a per-IP rate limitom. Vzor nájdeš pri existujúcich platených feedoch.
- Cache na disk, ak sa dáta menia pomaly.
- Nikdy neposielaj secret do klienta.

## Dokončenie

- Unit testy podľa `TESTING.md`. Nová vrstva bez testov sa nemerguje.
- Zápis do `DATA_SOURCES.md`: zdroj, licencia, podmienky, frekvencia.
- Ak je vrstva SK-špecifická, poznámka do `docs/SK-NOTES.md`.
- Spusť celú test suite pred commitom.
- Commit do tematickej vetvy, nie do `main` — kvôli rebase na upstream.
