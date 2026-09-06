# Volcano sidecar — OpenStreetMap

`osm-volcanoes.json` is a snapshot of every named `natural=volcano` node in
OpenStreetMap (Overpass API), built by `scripts/build-volcanoes.mjs`. Fields:
name (English when tagged, local name kept), position, elevation, `volcano:type`,
`volcano:status`, Wikipedia article, short description.

- **License:** ODbL 1.0 — "© OpenStreetMap contributors". Attribution + share-alike on the data.
- **Use:** joined at runtime to NASA EONET volcanic events by proximity and name
  (`src/data/volcanoInfo.js`) to give the volcano card elevation, type, status and
  a Wikipedia photo (free licences only, via `airportPhoto.js`).
- **Why not Smithsonian GVP:** its catalogue is richer, but the Smithsonian Terms of
  Use allow personal, educational and other non-commercial use only (checked
  2026-09-05). EONET keeps linking to the GVP profile; we do not bundle GVP data.
- Coverage is what mappers tagged: elevation on ~74 %, type on ~32 %, Wikipedia on ~22 %.
