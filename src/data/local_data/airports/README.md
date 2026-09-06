# Airports — globálny snapshot letísk

Bundlovaná bodová vrstva letísk pre glóbus (letecký balík 2 OKO).

- **Zdroj:** OurAirports — `airports.csv` z kanonického repa
  <https://davidmegginson.github.io/ourairports-data/airports.csv>
  (repo `davidmegginson/ourairports-data`), stiahnuté 2026-09-02.
- **Licencia:** public domain. Stránka ourairports.com/data/ deklaruje:
  „All data is released to the Public Domain, and comes with no guarantee
  of accuracy or fitness for use." Repo nesie formálnu **Unlicense**.
  Atribúcia sa nevyžaduje („We'd love you to give us credit … but you're
  not required to.") — kredit v Data attribution je zdvorilostný.
- **Filter (build-airports.mjs + airportsData.js):** `large_airport` +
  `medium_airport` vždy, `small_airport` len so `scheduled_service=yes`;
  `closed` explicitne vylúčené (8 zatvorených letísk má scheduled=yes!).
  Heliporty, vodné a balónové základne mimo záberu.
- **Obsah:** 6 146 letísk (1 173 large, 4 108 medium, 865 small),
  ~1,6 MB geojsonl. Polia: name, icao, iata, type, municipality, country,
  elevFt, scheduled — `id` = OurAirports `ident` (jediné vždy prítomné;
  812 riadkov bez IATA, 667 bez ICAO, 201 bez výšky → nully).
- **Obnova:** `node scripts/build-airports.mjs` (manuálny krok, nikdy CI;
  dataset sa generuje denne, ale letiská pribúdajú v horizonte mesiacov).
- **Presnosť:** dobrovoľnícky udržiavané dáta s výslovným disclaimerom —
  nie na navigáciu; pár súradníc/výšok môže byť mimo.

## Sidecar `airport-details.json` (2026-09-05)

- **Zdroj:** tie isté OurAirports dáta — `airport-frequencies.csv` (typ,
  popis, MHz), `runways.csv` (označenie, dĺžka/šírka ft, povrch, osvetlenie,
  zatvorená) a z `airports.csv` navyše `iso_region`, `gps_code`,
  `local_code`, `home_link`, `wikipedia_link`. Public domain (Unlicense).
- **Filter:** len letiská z bundlu; zatvorené dráhy a frekvencie bez čísla
  vypadnú; frekvencie zoradené ATIS → TWR → GND → DEL → APP → DEP …;
  dráhy od najdlhšej. Odkazy len `http(s)`.
- **Použitie:** karta letiska po kliknutí (`src/data/airportCard.js`),
  načítanie až pri prvom výbere. Ambientná vrstva sidecar nečíta.
- **Poctivosť:** dobrovoľnícke dáta, nie na navigáciu — frekvencie sú
  referenčné. Živý zvuk LiveATC sa NEvkladá (ich podmienky), karta má len odkaz.
- **Obnova:** `node scripts/build-airports.mjs` (obe výstupy naraz).

## Vlastný stream (`atc-streams.local.json`, git-ignorovaný)

Rádiová sekcia je iba zvuková. Kamerové prenosy Praha a LAX boli na pokyn
používateľa odložené pre samostatnú funkciu; zdroje sú zachované v DATA_SOURCES.md.
Vstavaný katalóg v `src/data/airportBroadcasts.js` je zatiaľ prázdny.
Automatické spustenie so zvukom závisí od prehliadača; dostupné sú natívne
ovládacie prvky. Výber iného letiska alebo zatvorenie karty zastaví prehrávanie.

Karta letiska vie prehrať zvukový stream, ktorý si doplníš sám — kľúč je
ICAO, hodnota `{ "url": "https://…", "label": "…" }` (vzor v
`atc-streams.example.json`). Platí pre zdroje, ktoré máš právo prehrávať
(vlastný prijímač cez Icecast, letisko s otvoreným streamom). **LiveATC
streamy sem nepatria** — ich podmienky použitie tretími stranami zakazujú;
karta na LiveATC iba odkazuje.
