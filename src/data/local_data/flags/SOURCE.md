# Country flags (flag-icons)

## Provenance
- **Source:** [flag-icons](https://github.com/lipis/flag-icons) by Panayiotis Lipiridis and contributors, npm package `flag-icons@7.5.0` (integrity via the npm registry tarball).
- **License:** **MIT** (`LICENSE` copied here). Attribution is not required by MIT but is given in the Data attribution popover.
- **What is kept:** the 249 ISO 3166-1 flags in 4:3 (`flags/4x3/*.svg`) and the code→name table from `country.json` (as `countries.js`). Sub-national and organisation flags are not bundled — cards flag STATES only.

## Build
- **Built:** 2026-09-05 by `scripts/fetch-flags.mjs`; 1599 KB of SVG, lazy-loaded one file at a time by `src/data/countryFlags.js`.

## Use in OKO
- Aircraft: registration country (adsbdb `registered_owner_country_iso_name`, fallback OpenSky `origin_country` name → ISO2), route airports (adsbdb `country_iso_name`).
- Ships: flag state from the MMSI MID prefix (`local_data/mids`).
