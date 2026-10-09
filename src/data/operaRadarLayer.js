// src/data/operaRadarLayer.js
// Zrážkový radar celej Európy — kompozit EUMETNET OPERA (2026-10-08, sekcia POČASIE). Druhá inštancia vrstvy
// radaru SHMÚ (shmuRadar.js: slučka poslednej hodiny, paleta dBZ, legenda); dáta z /api/opera/radar
// (operaRadarService.js, MeteoGate Open Radar Data, CC BY 4.0). Je to MERANIE radarov, maximum odrazivosti
// za 10 min; detail Slovenska dáva radar SHMÚ.

import { createShmuRadarLayer } from './shmuRadar.js';

export const OPERA_RADAR_LAYER_ID = 'opera-radar';
/** Snímok na mobile / slabšom zariadení: 1 h namiesto 2 h (12 × ~14 MB textúr by mobil nemusel zvládnuť). */
export const OPERA_MOBILE_FRAMES = 6;

/**
 * Koľko snímok načítať (null = všetky): úzka obrazovka (≤ 620 px) alebo prehliadač hlási ≤ 4 GB pamäte. Pure.
 * @param {{width?: number, deviceMemory?: number}} env
 */
export function operaFrameBudget({ width, deviceMemory } = {}) {
  if (Number.isFinite(width) && width <= 620) return OPERA_MOBILE_FRAMES;
  if (Number.isFinite(deviceMemory) && deviceMemory <= 4) return OPERA_MOBILE_FRAMES;
  return null;
}

export function createOperaRadarLayer(options = {}) {
  return createShmuRadarLayer({
    id: OPERA_RADAR_LAYER_ID,
    name: 'Zrážkový radar Európa (OPERA)',
    icon: '▨',
    metaUrl: '/api/opera/radar',
    sourceIdle: 'EUMETNET OPERA — MeteoGate Open Radar Data (CC BY 4.0)',
    sourceAt: (_product, iso) => `EUMETNET OPERA · ${iso.slice(11, 16)} UTC (CC BY 4.0)`,
    logTag: 'OperaRadar',
    maxFrames: () => operaFrameBudget({ width: globalThis.innerWidth, deviceMemory: globalThis.navigator?.deviceMemory }),
    ...options,
  });
}

export default createOperaRadarLayer();
