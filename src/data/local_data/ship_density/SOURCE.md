# Global Shipping Traffic Density (historical snapshot)

## Provenance
- **Source:** [World Bank Data Catalog 0037580 — Global Shipping Traffic Density](https://datacatalog.worldbank.org/search/dataset/0037580/Global-Shipping-Traffic-Density), obtained via the World Bank's partnership with the IMF (World Seaborne Trade Monitoring System). Stable archive used for the build: Zenodo record 16894236 (`shipdensity_global.zip`, 534.9 MB, MD5 `e8f98c56fa1306225b81558c0a23da21`).
- **Citation:** Cerdeiro, Komaromi, Liu, Saeed (2020), *World Seaborne Trade in Real Time: A Proof of Concept for Building AIS-based Nowcasts from Scratch*, IMF WP/20/57.
- **What a value is:** the **number of AIS positions** reported by ships inside a 0.005° cell between **Jan 2015 and Feb 2021** — moving and stationary ships alike, so it reads as *intensity of shipping activity*. **Historical, not live.** Terrestrial + satellite AIS as collected by the IMF pipeline; it is not a measure of our live feed's coverage.
- **License:** **CC BY 4.0** (stated on both the World Bank catalog entry and the Zenodo record). Attribution required; modifications must be indicated — see below.

## Build (= the modification)
- **Built:** 2026-09-05 by `scripts/build-ship-density.mjs`.
- Source raster: 72006×33998 px int32 BigTIFF (uncompressed, 128×128 tiles, nodata 2147483647), 9.8 GB. Not bundled.
- Transform: 50×50 px blocks are **summed** into a 0.25° grid (1440×680) — true block totals, so a 1-px open-ocean lane survives — then **log-normalised between a floor and a ceiling**: the floor is the 60th percentile of non-zero cells (126,365,688 positions — ordinary background sea, rendered fully transparent so the basemap shows through), the ceiling the 99.5th percentile (39,242,280,290 positions; raw max 98,712,509,773, clamped so ports cannot dim the lanes). Painted as an RGBA PNG whose alpha is intensity^1.4 (mid-range stays faint haze, ports hot). Zero cells and everything at or below the floor are fully transparent.
- Raster extent: lon -180.0153 → 179.9847, lat 85.0026 → -84.9974 (the source stops at ±85°).

## Known artefacts (in the SOURCE data — not build bugs)
- **Zero block over the central Sahara / N. Africa** (~lon 10–40, lat 15–35): the IMF raster holds exact zeros there instead of the usual land noise. Land is transparent in the drape anyway, so it is invisible in-app; noted so nobody hunts for a tiling bug.
- **Speckle over land**: sparse non-zero cells inland are real river/lake traffic (Rhine, Danube, Mississippi, Yangtze, Great Lakes…) plus AIS position noise/spoofing. Kept as data; below the normalisation floor they are transparent.
- **Coverage ends at ±85°**: the source raster does not reach the poles (see extent above).

## Content
- **Grid:** 1440 × 680 cells of 0.25°
- **Non-zero cells:** 595,623
- **Total positions:** 656,031,894,272,591
- **File size:** ~455 KB (PNG)
