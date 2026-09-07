# airframes.io — štúdia zdroja (2026-09-07, nezapojené)

Otázka používateľa: „dá sa získať komunikácia lietadla s riadiacou vežou?" → hlas veže
z dátových sietí nedostaneme, ale **ACARS/VDL2/HFDL/SATCOM textové správy** áno. Airframes.io
je komunitný agregátor týchto správ (obdoba ADS-B Exchange pre ACARS).

## Čo to je

- Komunitná sieť prijímačov (SDR) a agregátor správ **ACARS** cez VHF (acarsdec), **VDL Mode 2**
  (dumpvdl2), **HFDL** (dumphfdl), **SATCOM Inmarsat** (JAERO) a **Iridium** (iridium-toolkit).
- Obsah správ (podľa docs/intro): OOOI hlásenia (out/off/on/in), polohové správy, METAR/TAF/
  NOTAM/PIREP na vyžiadanie, **pre-departure clearance (PDC)**, letové plány, **oceanic
  clearance**, ATIS, brány, palivo, údržba, zdravie motorov, **ADS-C / CPDLC**.
  → Toto je najbližšie k „komunikácii s vežou": CPDLC a PDC sú textové povolenia od riadenia.
- Web: app.airframes.io (živé a historické správy, lety, stanice), komunita Discord/fórum.

Zdroje: https://docs.airframes.io/docs/intro/ , https://docs.airframes.io/api/ ,
https://docs.airframes.io/api/authentication/ , https://docs.airframes.io/api/pricing/ ,
https://docs.airframes.io/api/licensing/ , https://docs.airframes.io/api/realtime/ ,
https://docs.airframes.io/docs/feeding/how/ , https://github.com/airframesio/data
(airframes.io/ a airframes.io/about vracajú z nášho prostredia HTTP 403 — čítané cez docs a GitHub).

## API (REST v1, `https://api.airframes.io/v1`)

- Auth: `Authorization: Bearer <API key>` (alebo `X-API-KEY`). Časť koncových bodov je
  verejná bez kľúča (`/v1/messages`, `/v1/flights`, `/v1/flights/{id}/messages|positions|events`),
  s kľúčom vyšší limit; `/v1/flights/active`, `/v1/flights/live`, `/v1/flights/bbox/…` a všetky
  `/v1/airframes/…` **vyžadujú kľúč**.
- Správy: `GET /v1/messages?icao=<hex>&since=&until=&labels=&text=&station_ids=&timeframe=last-hour…`
  (aj `flight_id`, `airframe_ids`, keyset `before_id`). Schéma správy: `id, text, label, createdAt,
  station, airframe (tail/icao), flight, decodedPayload, poloha (ak je)`.
- Lety: `/v1/flights/{id}` s `include=positions`, `/v1/flights/{id}/positions?hours=`.
- Limit: default **60 req/min na IP**, hlavičky `X-RateLimit-*`, 429 + `Retry-After`.
- OpenAPI: `docs.airframes.io/assets/files/openapi-….yaml` (stiahnuté 2026-09-07, 162 kB).
- Realtime: Socket.IO **len WebSocket** na `wss://ws.airframes.io`; s API kľúčom nevzorkovaný feed
  **z vlastných staníc** (`feed:message`), pre celú sieť len vzorkovaný „firehose"
  (`messages:sniff`); „10 subscribe-type events / minute".

## Kľúč a podmienky (doslovne)

- Kľúč zadarmo len pre feederov: *„Users who run a receiver that contributes data in real-time
  to Airframes with a measure of validated data will receive a minimal, yet useful, free API
  account"*; postup: stanica viditeľná na app.airframes.io/stations, **≥ 7 dní kŕmenia**, potom
  mail na api@airframes.io so station ID. Tier Feeder: **60 req/min**, koncové body messages,
  flights, aircraft, stations, použitie *„Personal and non-commercial use"*.
- Platené tiery: *„Paid tiers for commercial users, researchers, and organizations with
  higher-volume needs are in development."*
- Atribúcia (predpísaná): **„Data provided by Airframes.io and its community of feeders."**
  + odkaz na https://airframes.io.
- Obmedzenia: *„Bulk redistribution, resale, or commercial use beyond your access tier requires
  prior arrangement."*, *„Don't attempt to re-identify or de-anonymize individuals from station
  or message data"*, *„The Airframes API and its licensing terms are still being finalized."*,
  *„Keep your API key private."*, *„All API requests must be made over HTTPS."*
- Referenčné dáta (repo airframesio/data — letecké spoločnosti, draky, ACARS labely, frekvencie,
  VDL pozemné stanice; CSV/JSON): *„Use of the data here for your non-commercial projects is
  allowed & encouraged. There is no cost to you."*, atribúcia vyžiadaná, *„Use of the data here
  for your commercial projects is not allowed without financial compensation."*, zákaz
  republikovať ako vlastné; komerčná licencia cez licensing@airframes.io.

## Ako by to sedelo do OKO

**A. Konzument API (bez vlastného prijímača)** — verejné `/v1/messages?icao=<hex>` pre sledovaný
stroj: karta letu / kokpit by ukázal posledné ACARS správy (OOOI, PDC, CPDLC povolenia,
polohové správy). Bez kľúča 60 req/min na IP → proxy s cache (1 dopyt na sledovaný stroj za
~60 s, nič pri nezmenenom sledovaní), TTL 60 s, budget governor ako pri adsbdb. Kľúč pre vyššie
limity a `/v1/flights/live` dostaneme len ako feeder (B). Podmienky sú „still being finalized"
→ pred zapojením ešte raz prečítať licensing a napísať na api@airframes.io, že OKO je
nekomerčný projekt a čo zobrazuje.

**B. Vlastný prijímač (SDR) + kŕmenie airframes.io + lokálny odber** — RTL-SDR (VHF ACARS na
131,525/131,725/131,850 MHz v Európe, VDL2 136,975 MHz), dekodéry acarsdec/dumpvdl2, výstup
súčasne na `feed.airframes.io` (UDP 5550 acarsdec, UDP 5552 / TCP 5553 dumpvdl2, UDP 5556
dumphfdl) **aj lokálne** (dumpvdl2 vie ZMQ/UDP/TCP JSON; ACARS Hub + acars_router ZMQ PUB).
OKO proxy by odoberala lokálny JSON prúd — nulová závislosť na cudzej licencii pre vlastné
správy, po 7 dňoch kŕmenia príde aj API kľúč (A s vyšším limitom, realtime feed vlastných staníc).
Dosah VHF ACARS ~200–300 km od Bratislavy = celá SK, časť AT/HU/CZ. ACARS Hub je Docker na Linuxe
(na Windowse cez Docker Desktop s USB passthrough — nepohodlné); acarsdec/dumpvdl2 sa dajú
zostaviť aj natívne, alebo beží prijímač na Raspberry Pi.

**Právne (SK):** príjem leteckého pásma pre vlastnú potrebu je dovolený; **verejné šírenie
obsahu komunikácie riadenia letovej prevádzky nie** — ACARS správy sú dátové správy dopravcov,
airframes.io ich zobrazuje verejne celosvetovo, ale pri vlastnom prijímači šírme len to, čo ide
do airframes.io, a v OKO zobrazujeme lokálne. Pred verejným nasadením overiť so ZÚ/ÚREKPS.

## Odporúčanie

1. Najprv A v „len na čítanie" podobe pre sledovaný stroj (karta/kokpit: posledné ACARS správy
   s labelom a časom, atribúcia doslovne), cache 60 s, vypínateľné. Vyžaduje: mail na
   api@airframes.io, checklist `new-data-layer`, zápis do DATA_SOURCES.md.
2. Potom B: RTL-SDR + acarsdec/dumpvdl2 na Raspberry Pi alebo Linux VM, kŕmiť airframes.io,
   lokálny JSON do OKO proxy; po 7 dňoch požiadať o kľúč.
3. Hlas veže ostáva mimo: LiveATC (súhlas, SK nepokryté) alebo lokálny SDR len pre seba.
