# LNG carrier allowlist (Wikidata)

`lng-carriers.json` — every Wikidata item that is an instance of (a subclass
of) **LNG carrier** ([Q15247](https://www.wikidata.org/wiki/Q15247)) and carries
an **IMO number** (P458), with MMSI (P587), overall length (P2043), inception
year (P571), operator (P137) and flag (P8047) when present. Built by
`scripts/build-lng-fleet.mjs` (SPARQL, one query, manual and occasional —
the fleet changes on the timescale of months); the snapshot timestamp,
counts and the exact query are inside the file.

- **Licence:** Wikidata data is released under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — no
  attribution required; OKO still names Wikidata as the source on the card.
- **Use in OKO:** `src/data/lngFleet.js` treats an AIS contact whose IMO (or
  MMSI) is in this list as a **confirmed** LNG carrier. Contacts outside the
  list can only be **likely** (name, destination and size heuristics) and
  are labelled so — Wikidata covers roughly a third of the world fleet
  (~300 of ~750 ships), so absence from the list proves nothing.
- **Rebuild:** `node scripts/build-lng-fleet.mjs` (needs network; writes
  this folder's JSON only).
