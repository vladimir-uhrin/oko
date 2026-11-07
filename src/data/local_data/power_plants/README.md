# Power plants ≥ 100 MW

Source: WRI Global Power Plant Database v1.3.0 (World Resources Institute, June 2021),
https://datasets.wri.org/dataset/globalpowerplantdatabase — **CC BY 4.0**.

Built by `node scripts/build-power-plants.mjs` (downloads the official ZIP into
`.gev-cache/power-plants/` or takes a local CSV/ZIP path).

Transform: plants with capacity ≥ 100 MW; name without the appended country;
ISO2 country code; fuel grouped like the energy panel mix (nuclear, hydro, coal,
gas, oil, wind, solar, bio, other; original fuel kept in `fuel_raw` when grouped);
commissioning year; owner; last *reported* annual generation (2013–2019, values
under 1 % capacity factor dropped as reporting errors). Coordinates rounded to 1e-5°.

Verified corrections after 2021 (`PLANT_OVERRIDES` in `scripts/lib/powerPlantsBuild.mjs`,
each with a source URL): Nováky ENO closed 2023-12, Vojany EVO closed 2024-03,
Mochovce 1 411 MW (unit 3). Everything else is the 2021 state and is labelled so.

Runtime output: `power-plants.geojsonl` (one GeoJSON Feature per line).
