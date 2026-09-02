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
