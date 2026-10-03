# Natural Earth physical regions pack

Offline named-region polygons for the voice-annotation resolver
(`src/data/naturalEarthRegions.js`) — "outline the Alps" resolves to the real
range geometry with no network dependency.

| File | Source dataset | Features |
|------|----------------|----------|
| `regions.json` | `ne_10m_geography_regions_polys` (ranges, deserts, plateaus, peninsulas, islands, …) | 1,046 named |
| `land.json` | `ne_50m_land` (outer rings, DP 0.02°, 2 dp) — map on OKO Studio images; `scripts/build-land.mjs` | 553 rings |
| `marine.json` | `ne_10m_geography_marine_polys` (seas, gulfs, straits, bays, …) | 292 named |

**Source:** Natural Earth 10m physical vectors, via the canonical
[nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector)
GitHub repo, commit `ca96624a56bd078437bca8184e78163e5039ad19` (fetched
2026-07-28T01:36:39Z — exact provenance is in each file's `meta` header).

**License:** public domain (https://www.naturalearthdata.com/about/terms-of-use/).
No attribution legally required; we credit "Made with Natural Earth" anyway.
See DATA_SOURCES.md.

**Curation** (script not committed — parameters recorded in `meta.curation`):

- Named features only; the `Dragons-be-here` joke feature ("Null Island") dropped.
- Outer rings only (holes are irrelevant at country-scale outline zoom).
- Douglas-Peucker simplification at 0.01°, coordinates rounded to 3 decimals
  (~110 m), rings stored open (no closing duplicate vertex).
- MultiPolygon crumbs under 20 km² dropped (largest part always kept);
  rings that survive with fewer than 8 distinct vertices are midpoint-densified
  (shape-identical) so every ring has ≥8 vertices.
- Zero-area sliver artifacts dropped. Two marine features are ONLY slivers in
  the source and are therefore absent: **Drake Passage** and **Luzon Strait**.
- Result: 7.3 MB source → 2.5 MB pack (budget ≤3 MB, enforced by
  `src/data/naturalEarthRegions.test.mjs`).

Duplicate names exist upstream (two "Cordillera Oriental", a sliver + real
"Canadian Shield", …); the lookup module resolves ties by largest area.

## `places.json` — populated places (2026-09-08, meteorology city labels)

Built by `scripts/build-meteo-places.mjs` from `ne_10m_populated_places_simple.geojson`
(same nvkelso/natural-earth-vector repo, `master` on 2026-09-08). Keeps places with
`pop_max ≥ 100 000` or an admin-0 capital (3 116 rows), as compact arrays
`[name, lat, lon, popThousands, scalerank, iso2, capital]` (coordinates to 3 decimals).
Used by `src/data/meteoPlaces.js` for the "city + field value" labels drawn above the
weather fields. Public domain like the rest of this folder.
