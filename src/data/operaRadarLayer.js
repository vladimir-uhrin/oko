// src/data/operaRadarLayer.js
// Zrážkový radar celej Európy — kompozit EUMETNET OPERA (2026-10-08, sekcia POČASIE). Druhá inštancia vrstvy
// radaru SHMÚ (shmuRadar.js: slučka poslednej hodiny, paleta dBZ, legenda); dáta z /api/opera/radar
// (operaRadarService.js, MeteoGate Open Radar Data, CC BY 4.0). Je to MERANIE radarov, maximum odrazivosti
// za 10 min; detail Slovenska dáva radar SHMÚ.

import { createShmuRadarLayer } from './shmuRadar.js';

export const OPERA_RADAR_LAYER_ID = 'opera-radar';

export function createOperaRadarLayer(options = {}) {
  return createShmuRadarLayer({
    id: OPERA_RADAR_LAYER_ID,
    name: 'Zrážkový radar Európa (OPERA)',
    icon: '▨',
    metaUrl: '/api/opera/radar',
    sourceIdle: 'EUMETNET OPERA — MeteoGate Open Radar Data (CC BY 4.0)',
    sourceAt: (_product, iso) => `EUMETNET OPERA · ${iso.slice(11, 16)} UTC (CC BY 4.0)`,
    logTag: 'OperaRadar',
    ...options,
  });
}

export default createOperaRadarLayer();
