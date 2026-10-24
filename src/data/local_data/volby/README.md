# Polohy obcí pre sekciu VOĽBY 2026

`obce-geo.json` — kód obce ŠÚ SR → zemepisná šírka a dĺžka (4 desatinné miesta) a presnosť.
Číta ho len server (`src/data/volbyService.js`); do prehliadača idú polohy po jednej obci
v odpovediach `/api/volby/obce` a `/api/volby/obec/<kód>`.

Postavené skriptom `scripts/build-volby-obce-geo.mjs` (2026-10-24):

- **GeoNames** `SK.txt` (https://download.geonames.org/export/dump/SK.zip), licencia
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — sídla triedy P; spojenie podľa
  kódu okresu (GeoNames `admin2` = kód okresu ŠÚ SR, napr. 201 Dunajská Streda) a mena bez
  diakritiky; mestské časti Bratislavy a Košíc bez prefixu mesta; pri viacerých zhodách vyhrá
  sídlo s vyšším kódom (PPLC, PPLA…) a väčším počtom obyvateľov.
- **ŠÚ SR** — Územné členenie OSO 2026 (`OSO2026_SK_tab0dd.xlsx`, `OSO2026_SK_tab0dx.xlsx`,
  https://volbysr.sk/oso/sk/uzemne_clenenie.html) — zoznam 2 924 obcí a mestských častí
  s kódmi plus mestá Bratislava (582000) a Košice (599981).

Presnosť v stĺpci 4: `obec` = sídlo v tom istom okrese (2 782 + 2 mestá), `name` = jednoznačné
meno v celej SR (13), `okres` = stred nájdených obcí okresu (131; panel to označí ako
približnú polohu). Atribúcia GeoNames je v riadku zdroja panela.

Obnova: `node scripts/build-volby-obce-geo.mjs` (stiahne vstupy do `.gev-cache/volby-build/`).
