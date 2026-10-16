# Country boundaries

`boundaries.geojsonl` — international land borders as one `LineString` Feature per
line (MultiLineStrings split into their parts; coordinates rounded to 4 decimals).
Built by `scripts/build-boundaries.mjs` (2026-10-16; pure helpers in `scripts/lib/boundaries.mjs`).

- **Source:** Natural Earth — `ne_50m_admin_0_boundary_lines_land` (1:50m) and, for the
  country codes, `ne_50m_admin_0_countries`, via <https://github.com/nvkelso/natural-earth-vector>
  (`geojson/`, commit `ca96624a56bd078437bca8184e78163e5039ad19`).
- **Licence:** Public domain. Natural Earth is released with no restrictions:
  <https://www.naturalearthdata.com/about/terms-of-use/> ("may be used, copied
  … in any manner, including commercially"). Attribution appreciated, not required.
- **What it is:** political land borders only (no coastlines, no mid-water maritime
  boundaries — the base map already delineates land/water). 392 line features.
- **Properties (per line):**
  - `l`, `r` — ISO 3166-1 alpha-2 of the country to the left / right of the line (in line
    direction), computed by point-in-polygon of points offset 0.03° from the segment midpoints
    at 1/4, 1/2 and 3/4 of the line (majority vote). `null` where the samples fall into water
    (6 lines: Juan de Fuca, Río de la Plata, Kerch, Monaco, Kuril, Boundary Bay). Used to
    emphasise the visitor's home country (`countryBoundaries.highlight`).
  - `cls` — `international` (solid) or `disputed` (dashed, as on UN maps): Natural Earth
    `FEATURECLA` other than "International boundary" (disputed, line of control, indefinite,
    indeterminant) or `FCLASS_ISO = Unrecognized` (e.g. Kosovo–Serbia).
- **Internationally recognised borders (UN position) for Ukraine:** Natural Earth draws Crimea
  de facto under Russia. The line Ukraine classifies as internal (`FCLASS_UA = Admin-1`, the
  Perekop isthmus) is DROPPED; the line it classifies as international (Kerch) is international.
  Hence 392 lines from 393 source parts.
- **Regenerate:** `node scripts/build-boundaries.mjs` (downloads both source files from the
  pinned commit) — also writes `natural_earth/country-labels.json`.
