# Country boundaries

`boundaries.geojsonl` — international land borders as one `LineString` Feature per
line (MultiLineStrings split into their parts; coordinates rounded to 4 decimals).

- **Source:** Natural Earth — `ne_50m_admin_0_boundary_lines_land` (1:50m), via
  <https://github.com/nvkelso/natural-earth-vector> (`geojson/`).
- **Licence:** Public domain. Natural Earth is released with no restrictions:
  <https://www.naturalearthdata.com/about/terms-of-use/> ("may be used, copied
  … in any manner, including commercially"). Attribution appreciated, not required.
- **What it is:** political land borders only (no coastlines, no mid-water maritime
  boundaries — the base map already delineates land/water). ~393 line features.
- **Regenerate:** download the source GeoJSON above and split each Feature's
  geometry into LineStrings, rounding coordinates to 4 decimals.
