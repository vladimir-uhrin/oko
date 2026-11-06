# Hranice litosférických platní (PB2002)

## Pôvod
- **Dataset:** Peter Bird (2003), *An updated digital model of plate boundaries*, Geochemistry Geophysics Geosystems 4(3), 1027, [doi:10.1029/2001GC000252](https://doi.org/10.1029/2001GC000252).
- **Konverzia do GeoJSON:** [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates) (Hugo Ahlenius, Nordpil), súbor `GeoJSON/PB2002_boundaries.json`, stiahnuté 2026-11-06.
- **Licencia:** [Open Data Commons Attribution License (ODC-By) 1.0](https://opendatacommons.org/licenses/by/1-0/). Uvedenie zdroja: Peter Bird, Hugo Ahlenius, Nordpil — v kredite vrstvy aj v okne „Zdroje dát".

## Čo je uložené
- `pb2002Boundaries.js` — 241 čiar (6 292 bodov), súradnice zaokrúhlené na 0,001°, pri každej čiare meno hranice (`n`, napr. `AF-AN`) a príznak subdukčnej zóny (`s = 1`, v datasete `Type = subduction`). Ostatné atribúty (pôvodný zdroj úseku) sa nepoužívajú.

## Obnova
```bash
curl -L -o PB2002_boundaries.json https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json
node scripts/build-plate-boundaries.mjs PB2002_boundaries.json
```

## Použitie v OKO
- Čip **Platne** vo vrstve Zemetrasenia (`src/data/earthquakePlates.js`): tenké čiary na teréne aj na 3D mape, subdukčné zóny výraznejšie. Dáta sa načítajú až po zapnutí čipu.
