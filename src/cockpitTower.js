// src/cockpitTower.js
// Veža cieľového letiska v kokpite — LEN ONLINE STREAMY (2026-09-08, používateľ:
// „B nie" = žiadny vlastný prijímač, „len online streami").
//
// Čo je legálne (overené, DATA_SOURCES.md):
//   - LiveATC: „Audio streams may not be used in any third-party products." → NIE.
//   - Broadcastify/RadioReference §8: len „private, personal, non-commercial
//     viewing purposes", inak licencia → NIE.
//   - Radio Browser: žiadne ATC streamy (tag „atc" = mexické rádiá Grupo ACIR).
//   - YouTube live (kamera letiska + ATC zvuk) cez OFICIÁLNY embed → ÁNO
//     (airportCameras.js: kurátorovaný katalóg + vyhľadanie s YOUTUBE_API_KEY).
//   - Vlastný stream používateľa z local_data/airports/atc-streams.local.json
//     (git-ignorované; čo si tam dá, je jeho zodpovednosť) → ÁNO.
// Karta letiska to už vie; kokpit tie isté dva zdroje ukáže pre CIEĽ letu.
// Tento modul je čistý (žiadne DOM) — DOM je v ui.js.

import { airportCameraFor, cameraSearchQuery, pickLiveCamera, youtubeEmbedUrl, youtubeWatchUrl } from './data/airportCameras.js';
import { ownStreamFor } from './data/airportCard.js';

export { youtubeEmbedUrl, youtubeWatchUrl };

/**
 * Zdroje veže pre letisko. Pure.
 * @param {object} input
 * @param {string|null} input.icao ICAO cieľa
 * @param {object|null} [input.streams] obsah atc-streams.local.json (null = ešte nenačítané / bez súboru)
 * @param {?{camera: object|null, at: number}} [input.lookup] výsledok vyhľadania na YouTube z cache (undefined = nehľadané)
 * @param {boolean} [input.searching] vyhľadanie práve beží
 * @returns {{icao: string|null, own: ?{url: string, label: string}, camera: object|null, searching: boolean}}
 */
export function towerSources({ icao, streams = null, lookup, searching = false } = {}) {
  const code = String(icao || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return { icao: null, own: null, camera: null, searching: false };
  const own = ownStreamFor(streams, code);
  const camera = airportCameraFor(code) || lookup?.camera || null;
  return { icao: code, own, camera, searching: !camera && searching };
}

/**
 * Stavový riadok hlavičky. Pure.
 * @param {ReturnType<typeof towerSources>} sources
 * @param {(key: string, vars?: object) => string} t
 */
export function towerStatusLine(sources, t) {
  if (!sources?.icao) return '';
  const parts = [];
  if (sources.own) parts.push(sources.own.label || t('cockpit.tower-own'));
  if (sources.camera) parts.push(t('cockpit.tower-youtube', { provider: sources.camera.provider || 'YouTube' }));
  if (parts.length) return `${sources.icao} · ${parts.join(' + ')}`;
  if (sources.searching) return `${sources.icao} · ${t('cockpit.tower-searching')}`;
  return t('cockpit.tower-none', { icao: sources.icao });
}

/** Podpis pre „DOM len pri zmene". Pure. */
export function towerSignature(sources) {
  if (!sources?.icao) return '';
  return [sources.icao, sources.own?.url || '', sources.camera?.videoId || '', sources.searching ? 's' : ''].join('|');
}

/** Dopyt pre vyhľadanie na YouTube zo záznamu letiska (airportLookup.js). Pure. */
export function towerSearchQuery(airport) {
  return cameraSearchQuery({
    name: airport?.name, municipality: airport?.municipality, iata: airport?.iata, icao: airport?.icao,
  });
}

/** Výber živého výsledku — rovnaké pravidlá ako karta letiska. Pure. */
export function towerPickCamera(payload, airport) {
  return pickLiveCamera(payload, { icao: airport?.icao, iata: airport?.iata, municipality: airport?.municipality, name: airport?.name });
}
