// src/quakeDeepLink.js
/**
 * Hlboký odkaz na zemetrasenie (2026-11-06): /?quake=<USGS:… | EMSC:…> z push upozornenia
 * (src/data/quakeAlert.js). Zapne vrstvu Zemetrasenia, počká, kým katalóg dorazí, vyberie otras
 * (karta, ShakeMap, sekvencia) a priblíži kameru nad ohnisko. Vzor: /?ship=<MMSI> v main.js.
 */

const ID_RE = /^(USGS|EMSC):[A-Za-z0-9_.-]{2,40}$/;

/** ID otrasu z query reťazca, alebo null. Pure. */
export function parseQuakeLink(search) {
  try {
    const id = new URLSearchParams(search || '').get('quake');
    return id && ID_RE.test(id) ? id : null;
  } catch { return null; }
}

/**
 * @param {object} o
 * @param {string} o.id
 * @param {{setEnabled: Function}} o.dataManager
 * @param {{selectById: Function, getSelectedInfo: Function}} o.layer
 * @param {(info: {lat: number, lon: number}) => void} o.flyTo
 * @param {(ms: number) => Promise<void>} [o.wait]
 * @param {number} [o.attempts] pokusy o výber (katalóg sa načítava niekoľko sekúnd)
 * @returns {Promise<boolean>} podaril sa výber?
 */
export async function openQuakeLink({ id, dataManager, layer, flyTo, wait = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 20 }) {
  if (!id) return false;
  try { await dataManager.setEnabled('earthquakes', true, { origin: 'link' }); } catch { return false; }
  for (let i = 0; i < attempts; i++) {
    if (layer.selectById?.(id)) {
      const info = layer.getSelectedInfo?.();
      if (info && Number.isFinite(info.lat) && Number.isFinite(info.lon)) { try { flyTo(info); } catch { /* kamera je voliteľná */ } }
      return true;
    }
    await wait(1500);
  }
  return false;
}
