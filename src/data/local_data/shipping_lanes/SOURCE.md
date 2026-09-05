# Global Shipping Lanes Dataset

## Provenance
- **Source:** [Global Shipping Lanes / Routes GIS Dataset](https://github.com/newzealandpaul/Shipping-Lanes) — GitHub `main` branch (v1.4), file `data/Shipping_Lanes_v1.geojson`. Author: Paul Benden (University of Canterbury).
- **Citation:** Benden, P. (2022). *Global Shipping Lanes* [Data set]. Zenodo. https://doi.org/10.5281/zenodo.6361763
- **Origin:** Georeferenced from the CIA's "Map of The World's Oceans" (October 2012 — US Government work, public domain) with subsequent maritime route corrections by the author.

## License — CC BY 4.0 (NOT public domain)
- The repository's `LICENSE` file is **Creative Commons Attribution 4.0 International (CC BY 4.0)**, published under the custom title *"Excluding Statista"* — a standard CC BY 4.0 grant for everyone except Statista. <https://creativecommons.org/licenses/by/4.0/>
- ⚠️ Only the underlying CIA base map is public domain. The **derivative dataset** (georeferencing + route corrections) is the author's work and is licensed CC BY 4.0. An earlier version of this file wrongly recorded it as "U.S. Government work — Public Domain / CC0"; corrected 2026-09-05 after reading the LICENSE file directly.
- ⚠️ **Licence discrepancy to be aware of:** the Zenodo deposit of the *older* v1.3.1 (the DOI above) is listed as **CC BY-NC 4.0** (NonCommercial). This snapshot is built from GitHub `main`, whose LICENSE is plain CC BY 4.0. **Do not rebuild from the Zenodo zip** without re-verifying the licence — `scripts/build-shipping-lanes.mjs` deliberately fetches the GitHub file.

## Obligations (CC BY 4.0)
Attribute the creator, link the licence, and indicate that the material was modified. Carried by:
- the in-app credit (`src/data/dataCredits.js` → "Data attribution" lightbox), and
- the project-wide register `DATA_SOURCES.md`.

## Build
- **Build date:** 2026-09-04 (licence verified 2026-09-05)
- **Transform (= the "modification"):** `scripts/build-shipping-lanes.mjs` converts MultiLineStrings to individual LineString records in `.geojsonl`, rounding coordinates to 5 decimal places.

## Content
- **Total lines:** 239
- **Major routes:** 52
- **Secondary (Middle) routes:** 123
- **Minor routes:** 64
- **Total points:** 28766
- **File size:** ~626 KB
