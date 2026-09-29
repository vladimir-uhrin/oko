# Geoid EGM96, mriežka 30' (výška geoidu nad elipsoidom WGS84)

## Pôvod
- **Model:** EGM96 (Earth Gravitational Model 1996), NGA/NASA — mriežka výšok geoidu `WW15MGH` s krokom 15'. Práca vlády USA, **verejná doména**.
- **Odkiaľ:** npm balík [`egm96-universal`](https://github.com/nicolas-van/egm96-universal) 1.1.1 (**MIT**), ktorý mriežku 15' (721 × 1 440 bodov, int16 v cm) nesie v sebe a číta bilineárne. Balík ostáva v `node_modules` pre generátor a test presnosti; do prehliadača ide len tento súbor.

## Úprava (scripts/build-geoid-grid.mjs, 2026-09-29)
- Každý druhý uzol → **30'** (361 × 720 bodov, od 90° S po 90° J, od 0° V na východ), hodnoty cez verejné API `meanSeaLevel` v uzloch.
- Decimetre (int16), v riadku rozdiely od suseda, nízke a vysoké bajty v dvoch blokoch, base64 v JS module `egm96-30min.js` (generovaný — neupravovať ručne; test `src/data/geoid.test.mjs` overuje, že sedí s generátorom).
- Čítanie v `src/data/geoid.js`: bikubicky (Catmull-Rom), riadky orezané na póloch, dĺžka dookola. 0,12 µs na volanie.

## Presnosť voči pôvodnej 15' mriežke (bilineárne)
| oblasť | RMS | p99 | max |
|---|---|---|---|
| svet | 5,9 cm | 22 cm | 1,01 m |
| Európa (34–72° S, 25° Z – 45° V) | 5,8 cm | 21 cm | 0,58 m |

Pod presnosťou výšok, ktoré geoid opravuje (barometrická výška po 25 ft, hladina mora ± príliv a vietor).

## Veľkosť
- Predtým (balík egm96-universal ako lenivý chunk): 2,77 MB, cez Cloudflare 1,85 MB gzip / 1,49 MB brotli.
- Teraz: 693 KB, **194 KB gzip**.
