# Ports — globálny snapshot prístavov (World Port Index)

Bundlovaná bodová vrstva námorných prístavov — statický náprotivok živej
AIS vrstvy (trasa lode niekam vedie a glóbus to miesto pozná).

- **Zdroj:** World Port Index (Pub 150), US National Geospatial-Intelligence
  Agency — `UpdatedPub150.csv` z msi.nga.mil, stiahnuté 2026-09-02.
- **Licencia:** dielo vlády USA, **public domain** (NGA na Commercial Use
  Warning stránke výslovne neuplatňuje copyright na svoje publikácie).
  Kredit v Data attribution je zdvorilostný.
- **Obsah:** 3 807 prístavov (174 Large, 376 Medium, 1 021 Small,
  2 109 Very Small, 127 bez veľkosti), ~950 KB geojsonl. Polia: name,
  locode (normalizovaný bez medzery), country, size, harborType,
  chanDepthM, maxDraftM; `id` = `wpi-<číslo>`.
- **Pasca dát:** WPI kóduje „neuvedené" v hĺbkových/rozmerových stĺpcoch
  ako 0.0 — `portsData.js` číta <= 0 ako null, inak by prístavy hlásili
  nulový ponor.
- **Pokrytie:** oceánsky register — **Dunaj (Bratislava/Komárno) v ňom
  NIE JE** (overené pri prieskume aj v bundli). Riečne prístavy sú
  samostatná téma (EuRIS/RIS — čaká na licenčné rozhodnutie).
- **Obnova:** `node scripts/build-ports.mjs` (manuálny krok, nikdy CI);
  `WPI_CSV=path` použije lokálny súbor.
- **Presnosť:** navigačné publikačné dáta s vlastnými chybami — nie na
  navigáciu.
