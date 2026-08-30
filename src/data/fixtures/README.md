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
