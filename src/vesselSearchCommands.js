// src/vesselSearchCommands.js
/**
 * @module vesselSearchCommands
 * @description Lode v jednotnom hľadaní (2026-10-11, bod 3 zo zoznamu vylepšení:
 * „hľadanie lode podľa mena, IMO alebo MMSI aj mimo mapy"). Dva zdroje do palety:
 *  • lode v pamäti prehliadača (živé AIS) — okamžite pri písaní,
 *  • lode kdekoľvek zo servera (/api/vessel-info/search) — o chvíľu.
 * Klik: loď, ktorú pozná niektorá lodná vrstva, sa vyberie (karta + kamera). Inak
 * kamera preletí na jej poslednú polohu z registra s dočasnou značkou a časom.
 */

const SHIP_GROUP = 'vessels';
const SHIP_WORLD_GROUP = 'vessels-world';

/** Má zmysel pýtať sa servera? Meno (≥ 3 písmená) alebo MMSI/IMO (7–9 číslic). Pure. */
export function looksLikeVesselQuery(query) {
  const q = String(query ?? '').trim();
  if (/^\d{7,9}$/.test(q)) return true;
  return q.replace(/[^A-Za-zÀ-ž]/g, '').length >= 3;
}

/** „10. 10. 02:57 UTC". Pure. */
function whenUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/**
 * @param {object} o
 * @param {object} o.live vrstva živých lodí (searchVessels, selectByMmsi)
 * @param {object} [o.delayed] vrstvy so selectContact (AISHub, GFW)
 * @param {object} [o.dataManager]
 * @param {object} [o.viewer]
 * @param {object} [o.Cesium]
 * @param {Function} [o.translate]
 * @param {(text: string) => void} [o.notify]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(ship: object) => void} [o.onRemoteShip] loď bez vrstvy (odhad polohy ju nakreslí)
 */
export function createVesselSearchCommands({ live, delayed = [], dataManager = null, viewer = null, Cesium = null,
  translate = (k) => k, notify = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis), onRemoteShip = null,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let marker = null;
  let markerTimer = null;

  function clearMarker() {
    clearTimer(markerTimer);
    if (marker && viewer?.entities) { try { viewer.entities.remove(marker); } catch { /* */ } }
    marker = null;
  }

  function selectKnown(mmsi) {
    try { if (live?.selectByMmsi?.(mmsi)) return true; } catch { /* */ }
    for (const layer of delayed) {
      try { if (layer?.selectContact?.(mmsi)) return true; } catch { /* */ }
    }
    return false;
  }

  /** Loď len z registra: let kamery a značka s časom poslednej polohy. */
  function showRemote(ship) {
    clearMarker();
    const p = ship?.position;
    const name = ship?.name || ship?.mmsi || '';
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      notify(translate('cmd.vessel.no-position', { name }));
      return;
    }
    if (typeof onRemoteShip === 'function') {
      try { onRemoteShip(ship); } catch { /* */ }
    } else if (viewer && Cesium) {
      try {
        marker = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
          point: { pixelSize: 11, color: Cesium.Color.fromCssColorString('#5fd0e6'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: { text: `${name}\n${whenUtc(p.t)}`, font: '12px "JetBrains Mono", monospace', fillColor: Cesium.Color.WHITE,
            showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#050a10cc'), pixelOffset: new Cesium.Cartesian2(0, -28),
            disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      } catch { marker = null; }
      markerTimer = setTimer(() => clearMarker(), 180_000);
    }
    try { viewer?.camera?.flyTo?.({ destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 400_000), duration: 2.5 }); } catch { /* */ }
    notify(translate('cmd.vessel.flying', { name, when: whenUtc(p.t) }));
  }

  async function runRemote(hit) {
    let ship = null;
    try {
      const res = await fetchImpl(`/api/vessel-info/ship?shipId=${encodeURIComponent(hit.shipId)}`);
      ship = res?.ok ? await res.json() : null;
    } catch { ship = null; }
    if (!ship) { notify(translate('cmd.vessel.failed')); return; }
    if (ship.mmsi && selectKnown(ship.mmsi)) return;
    showRemote({ ...ship, name: ship.name || hit.name });
  }

  /** Lode v pamäti — synchrónne pri každom písmene. */
  function queryCommands(query) {
    let hits = [];
    try { hits = live?.searchVessels?.(query, { limit: 8 }) || []; } catch { hits = []; }
    return hits.map((h) => ({
      id: `vessel:${h.mmsi}`,
      label: h.name || `MMSI ${h.mmsi}`,
      hint: `MMSI ${h.mmsi}`,
      group: SHIP_GROUP,
      keywords: [],
      run: () => { if (dataManager && !dataManager.isEnabled?.('ais-live-vessels')) dataManager.setEnabled?.('ais-live-vessels', true, { origin: 'user' }); live?.selectByMmsi?.(h.mmsi); },
    }));
  }

  /** Lode kdekoľvek zo servera. */
  async function asyncResults(query) {
    if (!looksLikeVesselQuery(query) || typeof fetchImpl !== 'function') return [];
    const res = await fetchImpl(`/api/vessel-info/search?q=${encodeURIComponent(String(query).trim())}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const body = await res.json();
    return (body.results || []).slice(0, 8).map((hit) => ({
      id: `vessel-world:${hit.shipId}`,
      label: hit.name,
      hint: [hit.typeText, hit.flagIso2 ? hit.flagIso2.toUpperCase() : ''].filter(Boolean).join(' · '),
      group: SHIP_WORLD_GROUP,
      keywords: [],
      run: () => { void runRemote(hit); },
    }));
  }

  return { queryCommands, asyncResults, clearMarker, _runRemoteForTest: runRemote };
}
