# Historical air-traffic density (adsb.lol, one day)

## Provenance
- **Source:** [adsb.lol globe_history_2026](https://github.com/adsblol/globe_history_2026), GitHub release `v2026.09.04-planes-readsb-prod-0` — the network's daily `/var/globe_history` dump (readsb). Day: **2026-09-04**. The archive's own `README.txt` is kept here as `README-adsblol.txt`.
- **What a value is:** the **number of 10-second ADS-B position samples** inside a 0.25° cell for every aircraft adsb.lol heard that day (readsb `heatmap/` slices, 48 × 30 min). **Historical, one day, not live.** Coverage follows the feeder network: strong over Europe, North America and East Asia, weak over oceans and Africa — the picture is honest about flights *and* receivers.
- **License:** **ODbL 1.0 + CC0 1.0** (dual, as published in the repository and shipped inside the archive: `LICENSE-ODbL.txt`, `LICENSE-cc0.txt`, copied here). Attribution: "adsb.lol feeders".

## Ocean bridging (interpolation — the part that is NOT observed)
- Terrestrial ADS-B has no mid-ocean receivers. Every airframe that left coverage and re-appeared **≥ 500 km** away at an implied speed of **500–1050 km/h** (one continuous flight, not a landing and a later departure) with both ends **≥ 10000 ft** is followed across the hole along the **great circle** between its last and first heard position, sampled every 10 s like the observed data.
- **19,169 gaps bridged**, 13,781,668 synthetic samples = **19.5 %** of all samples; 2,793,288 cells hold *only* interpolated samples (vs 1,494,053 with observations). Longest bridged gap 12,601 km. Rejected long gaps: {"notime":0,"slow":3198,"fast":409,"low":1234}.
- **Caveat:** real ocean tracks (North Atlantic organised tracks, Pacific PACOTS, weather routing) deviate from the great circle by up to a few hundred km — the corridors are real flights of that day, their exact path over water is modelled. The panel row says so.

## Build (= the modification)
- **Built:** 2026-09-07 by `scripts/build-air-density.mjs`.
- Input: 48 gzip slices (≈910 MB), 67,268,223 records → 56,765,358 positions from 80,761 airframes; skipped 8640 separators, 10,485,585 info entries, 8640 placeholders, 0 out-of-range.
- Record format: 16 B `int32 hex, int32 lat, int32 lon, int16 alt, int16 gs`, degrees × 1e6. Info entries are `lat >= 2^30` on the SIGNED value — the naive bit-30 mask also matches negative latitudes and erased the southern hemisphere on the first attempt.
- Transform: positions **counted** into a 0.05° grid (7200×3600), then **log-normalised between a floor and a ceiling**: floor = 60th percentile of non-zero cells (5 samples → transparent background), ceiling = 99.5th (306; raw max 146,781, clamped so hubs cannot dim the routes). Painted as RGBA, amber ramp, alpha = intensity^1.4.

## Content
- **Grid:** 7200 × 3600 cells of 0.05°
- **Non-zero cells:** 4,287,341
- **Total samples:** 70,547,026 (observed 56,765,358 + bridged 13,781,668)
- **File size:** ~2562 KB (PNG)
