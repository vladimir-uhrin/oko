// src/data/vesselPortIndex.js
/**
 * @module vesselPortIndex
 * @description Jeden index prístavov (World Port Index bundel) pre všetky
 * lodné vrstvy: cieľ z AIS textu aj posledný prístav z registra (2026-10-10).
 * Načíta sa lenivo pri prvej potrebe; synchrónny prístup pre karty, ktoré
 * sa prekresľujú každú sekundu (kým nie je, plavba sa len nekreslí).
 */
import { buildPortIndex } from './vesselDestination.js';

// new URL(...), nie Vite `?url` — ten pozná len Vite a Node testy by padli.
const portsUrl = new URL('./local_data/ports/ports.geojsonl', import.meta.url).href;

let index = null;
let pending = null;

/** Index alebo null, kým sa nenačítal (a spustí načítanie). */
export function cachedPortIndex() {
  if (!index) loadPortIndex();
  return index;
}

/** @returns {Promise<object|null>} */
export function loadPortIndex() {
  if (index) return Promise.resolve(index);
  if (!pending) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    pending = fetch(portsUrl)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => {
        const features = [];
        for (const line of String(text).split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { features.push(JSON.parse(trimmed)); } catch { /* poškodený riadok preskočiť */ }
        }
        index = buildPortIndex(features);
        return index;
      })
      .catch(() => { pending = null; return null; });
  }
  return pending;
}

/** Test seam: podstrč hotový index. */
export function _setPortIndexForTest(next) {
  index = next || null;
  pending = null;
}
