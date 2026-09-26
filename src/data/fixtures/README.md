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
