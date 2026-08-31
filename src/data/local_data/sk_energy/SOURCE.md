# SK energy infrastructure snapshot (sk-energy.geojsonl)

Slovakia's high-voltage transmission grid (400 kV / 220 kV `power=line` ways)
and gas transmission pipelines (`man_made=pipeline` + `substance~gas` +
`usage=transmission`), extracted from OpenStreetMap for the OKO fork's
`local-energy` layer (Fáza 4 — replaces the landlocked-dead submarine-cables
default; docs/SK-NOTES.md).

- **License:** ODbL 1.0 — © OpenStreetMap contributors
  (https://www.openstreetmap.org/copyright). Same carve-out as the other
  OSM-derived bundles (see DATA_SOURCES.md): the data keeps its own license,
  the MIT code license does not cover it.
- **Retrieved:** 2026-08-30, OSM base timestamp 2026-08-30T20:11:01Z, via the
  Overpass API (maps.mail.ru mirror; canonical endpoint was unreachable from
  the build machine that day).
- **Query bbox:** 47.70,16.80,49.65,22.60 (Slovakia + margin). Overpass
  returns full geometries of ways touching the bbox, so the build CLIPS to
  the bbox — a way that leaves and re-enters yields multiple parts
  (`osm-way-<id>.<n>`).
- **Deterministic transform:** `scripts/build-sk-energy.mjs` — bbox clip,
  Douglas–Peucker simplification at 0.0004° (~40 m), coordinates rounded to
  4 decimals, properties reduced to kind/name/operator + voltage|substance,
  features sorted by kind then OSM way id.
- **Contents:** 688 LineString features — 586 power (400/220 kV), 102 gas
  transmission — 3 928 points, ~194 kB.
- **Refresh:** manual, occasional (the grid changes on the timescale of
  years). Never wire the build script into CI — one-off fetches only,
  per Overpass usage etiquette.
