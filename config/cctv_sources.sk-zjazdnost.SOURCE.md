# SK CCTV katalóg — zjazdnost.sk (SSC) · Fáza 2 (OKO)

Katalóg pre kamery meteostaníc Slovenskej správy ciest publikované na
www.zjazdnost.sk. Aktivuje sa cez:

```
CCTV_SOURCES_FILE=config/cctv_sources.sk-zjazdnost.json
```

## Stav: SEZÓNNY ZDROJ — katalóg je zámerne prázdny

Portál (overené 2026-08-30): „Údaje o aktuálnom počasí nie sú momentálne
k dispozícii. Tieto dáta sa zbierajú iba počas výkonu zimnej údržby ciest."
Mimo zimnej sezóny (~november–marec) nie sú dostupné stanice, snímky ani
ich URL vzor — katalóg preto NEobsahuje vymyslené endpointy. Napĺňa sa až
zo živej zimnej vzorky (postup nižšie). Prázdny katalóg = CCTV vrstva beží
bez SK kamier; nič nefailuje.

## Podmienky použitia (preverené, docs/SK-NOTES.md Fáza 2)

Copyright stránka www.zjazdnost.sk/share/copyright.html k produktu „Údaje
o počasí a zjazdnosti ciest" (držitelia práv: SSC, NDS, Granvia, krajské
správy ciest, Magistrát hl. m. SR Bratislavy):

> „Údaje, publikované na týchto stránkach sú verejné a môžu byť ďalej šírené
> a distribuované, za predpokladu uvedenia informácie, že zdrojom týchto
> údajov je stránka www.zjazdnost.sk, prevádzkovaná Slovenskou správou ciest."

Povinná atribúcia (dávaj do `license` každého záznamu a je aj v
DATA_SOURCES.md): **„Zdroj: www.zjazdnost.sk — Slovenská správa ciest"**.

## Šablóna záznamu (schéma = normalizeSourceItem vo vite.config.js)

```json
{
  "id": "sk-ssc-<guid alebo slug stanice>",
  "name": "<názov stanovišťa, napr. I/63 Rovinka>",
  "city": "Bratislava",
  "cityId": "sk-ba-ds",
  "provider": "Slovenská správa ciest — zjazdnost.sk",
  "license": "Zdroj: www.zjazdnost.sk — Slovenská správa ciest",
  "lat": 0.0,
  "lon": 0.0,
  "feedType": "jpg",
  "snapshotUrl": "<URL snímky — doplniť zo zimnej vzorky>",
  "poseSource": "curated",
  "headingDeg": null,
  "pitchDeg": null,
  "fovDeg": null,
  "mountHeightM": null
}
```

Pózy (`headingDeg`/`pitchDeg`/`fovDeg`) sa kalibrujú ručne gizmom v scéne
(CLAUDE.md Fáza 2) — začať malým setom v okolí Bratislavy a Dunajskej Stredy
(I/63, I/61).

## Zimný checklist (pred naplnením katalógu)

1. Over, že www.zjazdnost.sk/map/ má naplnené `meteo.*` domény v
   `mapObjectsIcons` (mimo sezóny sú `[]`). Súradnice objektov sú v UTM
   (pravdepodobne EPSG:32633/34 — over podľa rozsahu) → prepočítať na WGS84.
2. Odober vzorku snímky jednej kamery: HTTP status, hlavičky (cache-control,
   rate limit), rozlíšenie, veľkosť. Dva requesty s odstupom → reálna kadencia
   obnovy. Zapíš do docs/SK-NOTES.md.
3. Podľa kadencie nastav klientsky refresh (nie častejšie než obnova zdroja;
   verejná infraštruktúra — cachuj agresívne).
4. Skontroluj, či snímky nevyžadujú referer/cookie — ak áno, idú cez existujúci
   CCTV frame proxy (robí to už pre Austin/Caltrans/TfL), nie priamo z klienta.
5. Doplň záznamy sem, aktualizuj DATA_SOURCES.md (status zo „seasonal —
   awaiting winter sample" na aktívny) a pridaj kredit do
   src/data/dataCredits.js (vzor: austin-cctv).
