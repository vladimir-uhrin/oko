# SK-NOTES

Zistenia o slovenských podmienkach a dátových zdrojoch.
Zapisuje sa sem výsledok Fázy 0 a každého prevereného zdroja.

---

## Fáza 0 — pokrytie Google Photorealistic 3D Tiles nad SK (2026-08-30)

**Setup:** GCP projekt `oko-dev-507115` (vytvorený 2026-08-30, billing účet so SK
adresou), Map Tiles API, kľúč obmedzený na `http://localhost:4173/*` + Map Tiles
API. Denné kvóty: 3D root 500, 2D 10 000, Street View 1 000. Budget 10 €/mes.

**Metodika:** headless Chromium (SwiftShader) proti dev serveru, kamera
`setView` ~800–900 m nad miestom, pitch ≈ −31°, čakanie na
`googleTileset.tilesLoaded`, screenshot. Skript: `scripts/qa-sk-coverage.mjs`
(výstup do `qa-shots/sk-coverage/`, gitignorované). Viedeň slúži ako kontrola
so známym plným 3D pokrytím.

### Výsledky

| Lokalita | Výsledok |
|---|---|
| Viedeň (kontrola) | ✅ plný fotogrametrický 3D mesh |
| Bratislava — hrad/centrum | ✅ plný 3D mesh (budovy, kopce, vily); pri zemi miestami hrubší LOD než Viedeň |
| Bratislava — Petržalka/most SNP | ✅ 3D mesh cez rieku; brehy v popredí hrubšie |
| Šamorín | ❌ len terén + ortofoto (žiadna extrúzia budov v šikmom pohľade) |
| Dunajská Streda | ❌ len terén + ortofoto (štadión aj bytovky ploché) |
| Topoľníky | ❌ len terén + ortofoto |

**Záver:** mesh je mestský — Bratislava áno, Žitný ostrov nie. Fáza 1 (ÚGKK
ortofotomozaika + LiDAR DMR 5.0 ako terrain provider) má pre projekt zmysel
presne tam, kde bude OKO najviac používané (DS, Šamorín, Topoľníky).

### EHP podmienky — dôležitá kaveát

Podľa [oficiálnych EEA úprav Map Tiles API](https://developers.google.com/maps/comms/eea/map-tiles)
majú projekty vytvorené po 8. 7. 2025 s EHP fakturačnou adresou dostávať na
fotorealistické 3D tiles (aj 2D satelit) **HTTP 403**. Empiricky 2026-08-30:
`root.json` aj obsah **tečú bez 403** (overené z originu `localhost:4173`).
Buď sa politika/vymáhanie medzičasom zmenili, alebo je enforcement per-účet.
**Považovať za krehké** — pred väčšou prácou nad 3D vrstvou vždy pretestovať
(`scripts/qa-sk-coverage.mjs`), fallback podklady z Fázy 1 ostávajú strategické.

### AIS na Dunaji

Netestované — vyžaduje `AISSTREAM_API_KEY` (bezplatná registrácia na
aisstream.io), ktorý podľa bootstrapu odkladáme. HUD ukazuje `AIS: --`.
Úloha: po registrácii kľúča overiť terestriálne pokrytie úseku BA–Komárno.

### Prevádzkové poznámky

- Optional endpointy bez kľúčov: `/api/google/nearby-places` → 403 (kľúč nemá
  Places API — zámer), `/api/openai/hud-summary` → 503 (bez OpenAI kľúča).
  Appka beží normálne.
- Jeden headless beh cez 6 lokalít spotrebuje ~1–2 root requesty (jedna
  session, jeden tileset) — kvóta 500/deň je pohodlná.
