# Štátne lietadlá (state-aircraft)

`sk.json` — ručne overený zoznam štátnych lietadiel Slovenskej republiky, ktoré OKO
sleduje dlhodobo a spätne (vlastník 2026-09-30: „lietadlá špeciálne slovenskej vlády,
aby sa ich aj spätne dalo trackovať"; najprv vládna/VIP preprava, neskôr aj Vzdušné
sily, polícia a záchranári).

- **Obsah záznamu:** ICAO 24-bit adresa (hex), registrácia, typ (ICAO kód a názov),
  prevádzkovateľ (inštitúcia), úloha (`government` / `military` / `police` /
  `rescue`), obdobie služby štátu (`since`/`until`, ak je známe), zdroje (URL) a dátum
  overenia. Záznam bez zdroja alebo bez platného hexu sa nenačíta
  (`parseStateAircraftList` v `src/data/stateAircraft.js`).
- **Etapa 1 (2026-09-30): vládna/VIP preprava — Letecký útvar MV SR** (prevádzkuje
  vládnu letku celé obdobie 2023–2026; návrh MO SR z 3/2023 presunúť ju pod rezort
  obrany sa nerealizoval — teraz.sk, tnlive.sk). OM-BYA (A319CJ, 505C06, od 14. 6.
  2016), OM-BYK (A319CJ, 505C09, od 2. 9. 2017), OM-BYB (Fokker 100, 505C07, od
  29. 1. 2017), OM-BYC (Fokker 100, 505C08, 26. 9. 2016 – vyradený 11. 2. 2025).
  **Hex kódy nie sú v úradnom registri** (register Dopravného úradu k 16. 6. 2026
  neobsahuje OM-BY* — štátne lietadlá v policajných službách): každý potvrdzujú štyri
  nezávislé verejné databázy (Flightradar24, tar1090-db, hexdb.io,
  live-mobile-mode-s.eu) a archív OKO — v septembri 2026 lietali 505C06, 505C09 a
  505C07 pod volacími znakmi SSG001/SSG004/SSG04A/SSG04B/SSG006 (SSG = SLOVAK
  GOVERNMENT); 505C08 od začiatku archívu (8. 9. 2026) nelietal, čo sedí s vyradením.
  Blok ICAO adries SR: 505C00–505FFF (ICAO Annex 10, zv. III, tab. 9-1).
- **Ďalšie etapy (overené, zatiaľ mimo zoznamu):** vrtuľníky LÚ MV SR OM-BYW (AW189,
  505C17) a OM-BYD (Bell 429, 505C04) — hlavne polícia, hasenie a záchrana, preprava
  ústavných činiteľov len ako vedľajšia úloha; Vzdušné sily OS SR Bombardier Global
  5000 9513 (505FA0) a 9633 (505FA1) — doprava a medevac, jeden raz aj s premiérom
  (MO SR: „výcvik"), hex len z dvoch neúradných zdrojov.
- **Pravidlo:** len overené fakty. Každé pole má zdroj; čo sa nedalo potvrdiť, v
  zozname nie je. Nič sa nedopĺňa odhadom ani z pamäti.
- **Etická čiara:** zoznam opisuje štátne STROJE (majetok štátu) a ich lety z verejného
  vysielania ADS-B. Neobsahuje a neukladá, kto je na palube, ani majiteľov súkromných
  lietadiel.
- **Použitie:** `src/data/stateAircraftService.js` (API `/api/state-aircraft`, živé
  polohy z adsb.lol `/v2/hex/…`, lety s odvodenými letiskami), spätný import stôp
  `src/data/stateAircraftBackfill.js` (adsb.lol `globe_history`, ODbL 1.0), pás nad
  kartou `src/stateFlightsStrip.js` a rad v paneli História letov.
- **Úprava:** zmena súboru sa na serveri prejaví bez reštartu (sleduje sa čas zmeny);
  nový stroj sa spätne doimportuje sám.
