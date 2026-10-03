# Test fixtures

- `tomtom-flow-austin-12-935-1686.pbf` — one real TomTom traffic-flow vector
  tile (Mapbox Vector Tile protobuf, layer `"Traffic flow"`), downtown Austin
  z12 x935 y1686, captured 2026-07-16 from
  `api.tomtom.com/traffic/map/4/tile/flow/relative/12/935/1686.pbf`
  (22,980 bytes). Used ONLY by `src/data/flowTiles.test.mjs` to pin MVT
  decoding offline — it is a point-in-time congestion snapshot, not a bundled
  data layer, and is never served to the app. © TomTom.
- `shmu-zmax-20260830T181000Z.hdf` — one real SHMÚ radar composite (ODIM_H5,
  product `zmax`/DBZH, 1560×2270), captured 2026-08-30 from
  `opendata.shmu.sk/meteorology/weather/radar/composite/skcomp/zmax/20260830/T_PABV22_C_LZIB_20260830181000.hdf`
  (42,448 bytes). Used ONLY by `src/data/shmuRadar.test.mjs` to pin the HDF5
  decode + rasterization offline — a point-in-time weather snapshot, never
  served to the app. © SHMÚ, CC BY 4.0 (opendata.shmu.sk/README.txt).
- `wiki-israel-palestine-20260924.lua` — raw Lua source of the English
  Wikipedia map module `Module:Israeli-Palestinian conflict detailed map`,
  captured 2026-09-24 from
  `en.wikipedia.org/w/index.php?title=Module:Israeli-Palestinian_conflict_detailed_map&action=raw`
  (239,200 bytes; last edit in that revision 2026-09-22T18:56:08Z). Live
  reference for the full file: 1,335 occurrences of `lat =` (1,329 active
  marks + 5 Lua-commented Egyptian dots + 1 commented template line). Used
  ONLY by `src/data/wikiControl.test.mjs` to pin the parser, the verified
  icon → side legend and the co-located ring/dot merge offline — a
  point-in-time snapshot, never served to the app. © Wikipedia contributors,
  CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
- `wiki-yemen-20260924.lua` — raw Lua source of `Module:Yemeni Civil War
  detailed map`, captured 2026-09-24 from
  `en.wikipedia.org/w/index.php?title=Module:Yemeni_Civil_War_detailed_map&action=raw`
  (190,688 bytes; last edit 2026-09-23T20:36:22Z). Live reference: 1,286
  occurrences of `lat =` on 1,284 lines (two lines carry two marks), no
  commented marks. Used ONLY by `src/data/wikiControl.test.mjs` (parser,
  legend, skipped Taizz inset). © Wikipedia contributors, CC BY-SA 4.0.
- `wiki-lebanon-20260924.lua` — raw Lua source of `Module:Lebanese insurgency
  detailed map`, captured 2026-09-24 from
  `en.wikipedia.org/w/index.php?title=Module:Lebanese_insurgency_detailed_map&action=raw`
  (18,449 bytes; last edit 2026-09-21T04:15:03Z). Live reference: 95
  occurrences of `lat =` (85 active marks, 10 Lua-commented). Its
  `secondaryModules` pulls the IP module for everything south of Sidon. Used
  ONLY by `src/data/wikiControl.test.mjs` (parser, legend, comment stripping).
  © Wikipedia contributors, CC BY-SA 4.0.
- `wiki-syria-20260924-head.lua` — TRIMMED raw Lua source of `Module:Syrian
  Civil War detailed map`, captured 2026-09-24 from
  `en.wikipedia.org/w/index.php?title=Module:Syrian_Civil_War_detailed_map&action=raw`
  (full file 958,104 bytes; last edit 2026-09-11T21:11:42Z). The fixture is
  90,446 bytes: lines 1–660 of the raw file (631 `lat =` = the road overlay +
  630 marks in the module's unquoted `{lat= 34.212, long= 38.8, mark= …}`
  syntax), one added marker line `-- [OKO fixture] orezané …`, then lines
  7822–7839 (closing brace + `containerArgs` with the legend caption). Live
  reference for the FULL file: 7,752 occurrences of `lat =` (7,719 active
  marks, 33 Lua-commented). Used ONLY by `src/data/wikiControl.test.mjs`
  (unquoted syntax on a real module, legend). © Wikipedia contributors,
  CC BY-SA 4.0.
- `adsblol-trace-8965d1-20260930.json`, `adsblol-trace-a670b4-20260929.json`,
  `adsblol-trace-a46cc1-20260928.json`, `adsblol-trace-a681e5-20260929.json`,
  `adsblol-trace-300a95-20260930.json` — real readsb traces from adsb.lol
  (`adsb.lol/data/traces/<xx>/trace_full_<hex>.json` for 2026-09-30,
  `adsb.lol/globe_history/RRRR/MM/DD/traces/<xx>/trace_full_<hex>.json` for
  earlier days), captured 2026-09-30 and trimmed to the windows the tests need
  (the last row carrying a squawk before each window is kept so the carried
  code parses the same as the full file — checked when trimming; `ownOp` and
  `year` removed). 8965d1 = flydubai FZ1073 (A6-FKF), Dubai → Tel Aviv,
  02:50–03:12 and 05:10–05:54 UTC: steep descent 05:22, squawk 7700 05:31:30
  and 7500 05:36:18, U-turn ~05:42, data ends 05:53 (reported diverted to
  Tabuk). The other four are aircraft for which the OKO archive (OpenSky)
  logged squawk 7500 while adsb.lol saw a normal code at the same time
  (5323, 3244, 1200, 7224) — noise the verification must reject. Used ONLY by
  the Udalosti tests (`flightAnomalies`, `eventVerify`, `eventTimeline`,
  `flightEventsService`) via `flightEventFixtures.mjs`, never served to the
  app. The OpenSky side is not stored (redistributing OpenSky data in the
  repository was not checked against their terms); tests derive it from the
  same trace the way the archive recorded it. © adsb.lol contributors, ODbL 1.0
  (https://opendatacommons.org/licenses/odbl/1-0/).
- `easa-czib-export-20261003.json`, `easa-czib-feed-20261003.xml` — the EASA
  Conflict Zone Information Bulletins list export
  (`easa.europa.eu/en/domains/air-operations/czibs/export-json?page&_format=json`,
  34 bulletins, 16 active) and RSS feed (`…/czibs/feed.xml`), captured
  2026-10-03. `easa-czib-{iraq,gulf,ukraine,libya,syria}-20261003.html` — the
  `<main>` element only of five bulletin pages (CZIB-2026-05-R2, CZIB-2026-07R3,
  CZIB-2022-01R14, CZIB-2017-02R20, CZIB-2017-03R20; the site menus and the
  e-mail sign-up form removed, ~15–19 kB each instead of ~285 kB). Used ONLY by
  `src/data/czib.test.mjs`, `scripts/lib/mideastAirspace.test.mjs` and
  `src/data/mideastEventsProxy.test.mjs`, never served to the app. © European
  Union Aviation Safety Agency — „Reproduction is authorised, provided the
  source is acknowledged" (easa.europa.eu/copyright-disclaimer).
- `vatspy-boundaries-sample-20261003.geojson` — 11 real features of the VATSpy
  `Boundaries.geojson` (ORBB with its sector ORBB-N, OBBB, OKAC, OTDF, OMAE,
  OOMM, UKBV, UKLV, HLLL, OSTT), captured 2026-10-03 from
  `raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson`,
  plus 120 synthetic 1° squares (ids `Z??Q`) so the „at least 100 FIRs" guard
  can be tested with a small file. Used by the same tests. VATSpy Data Project
  (VATSIM), CC BY-SA 4.0 — approximate, not official boundaries.
- `airspace-payload-20261003.json` — the body of `/api/mideast/events/airspace`
  produced by `scripts/lib/mideastArchive.mjs` from the two fixtures above
  (5 bulletins, 10 FIR polygons, 4 missing FIR codes). Used by
  `src/airspaceAdvisoryLayer.test.mjs` and `src/mideastPanel.test.mjs`.
  Same licences (EASA with acknowledgement; FIR polygons CC BY-SA 4.0).
