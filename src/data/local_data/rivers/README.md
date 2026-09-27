# Rivers — Danube centreline

`danube.json` — centreline of the Danube from OpenStreetMap relation 89652 (all member ways
tagged `waterway=river`), each way kept as its own line in the OSM drawing direction, which for
waterways is DOWNSTREAM. Simplified with Douglas–Peucker (~30 m), coordinates rounded to 5 decimals.

Built by `scripts/build-danube-centerline.mjs` (one manual Overpass query; the raw answer is cached
in `.gev-cache/rivers/`). Snapshot: 2026-09-27 (OSM base timestamp in the file).

Used only by `src/data/riverDirection.js` to point moored vessels that report no heading upstream
(river vessels moor bow into the current); the line itself is never drawn.

License: Open Database License (ODbL) 1.0 — © OpenStreetMap contributors
(https://www.openstreetmap.org/copyright). Keep the attribution when redistributing this derived
database; a modified version distributed publicly must be offered under ODbL.
