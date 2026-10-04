// src/aircraftSearchCommands.js
/**
 * @module aircraftSearchCommands
 * @description Lietadlá v jednotnom hľadaní (2026-10-04). Dva zdroje do palety:
 *  • živé lietadlá v pamäti prehliadača (vrstvy Lietadlá a Vojenské) — okamžite pri písaní,
 *  • celý svet zo servera (/api/aircraft-search → adsb.lol) — o chvíľu, keď dopyt vyzerá
 *    ako typ / registrácia / volací znak / hex.
 * Klik: lietadlo, ktoré vrstva pozná, sa rovno sleduje (karta + kamera). Lietadlo len zo servera
 * (OpenSky ho nevidí) dostane dočasnú značku s pôvodom „adsb.lol" a kamera k nemu doletí; keď ho
 * vrstva medzitým načíta, prepne sa na bežné sledovanie.
 */
import { aircraftTypeName, parseAircraftQuery } from './data/aircraftSearch.js';
import { upstreamPaths } from './data/aircraftSearchService.js';

const FT_PER_M = 3.28084;

/** Riadok palety pre jedno lietadlo. Pure (okrem `run`). */
export function aircraftCommandLabel(ac, translate = (k) => k) {
  const ident = ac.callsign || ac.registration || String(ac.hex || '').toUpperCase();
  const type = aircraftTypeName(ac.typeCode) || ac.typeName || ac.typeCode || '';
  const label = type ? `${ident} · ${type}` : ident;
  const parts = [];
  if (ac.registration && ac.registration !== ident) parts.push(ac.registration);
  if (ac.operator) parts.push(ac.operator);
  if (ac.onGround) parts.push(translate('cmd.aircraft.ground'));
  else if (Number.isFinite(ac.altitudeFt)) parts.push(`FL${String(Math.round(ac.altitudeFt / 100)).padStart(3, '0')}`);
  return { label, hint: parts.join(' · ') };
}

/**
 * @param {object} o
 * @param {object} o.flights vrstva lietadiel (searchContacts, trackById, hasContact)
 * @param {object} [o.military] vrstva vojenských lietadiel
 * @param {object} [o.dataManager] zapne vrstvu, ak je vypnutá
 * @param {object} [o.viewer] Cesium viewer (let kamery, dočasná značka)
 * @param {object} [o.Cesium]
 * @param {Function} [o.translate]
 * @param {(text: string) => void} [o.notify]
 * @param {typeof fetch} [o.fetchImpl]
 */
export function createAircraftSearchCommands({ flights, military = null, dataManager = null, viewer = null, Cesium = null,
  translate = (k) => k, notify = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let marker = null;
  let markerTimer = null;
  let pollTimer = null;

  const layers = () => [flights, military].filter(Boolean);
  function ensureEnabled(layer) {
    const id = layer?.id;
    if (!id || !dataManager) return;
    try { if (!dataManager.isEnabled(id)) dataManager.setEnabled(id, true, { origin: 'user' }); } catch { /* */ }
  }
  function tryTrack(hex) {
    for (const layer of layers()) {
      try { if (layer.trackById?.(hex, { origin: 'user' }) === true) { clearMarker(); return true; } } catch { /* */ }
    }
    return false;
  }
  function clearMarker() {
    clearTimer(markerTimer); clearTimer(pollTimer);
    if (marker && viewer?.entities) { try { viewer.entities.remove(marker); } catch { /* */ } }
    marker = null;
  }
  /** Lietadlo len zo servera: značka + let kamery; kým ho vrstva nenačíta, skúša prepnúť na sledovanie. */
  function showRemote(ac) {
    clearMarker();
    ensureEnabled(ac.military ? military : flights);
    if (tryTrack(ac.hex)) return;
    const { label } = aircraftCommandLabel(ac, translate);
    if (viewer && Cesium && Number.isFinite(ac.lat) && Number.isFinite(ac.lon)) {
      const heightM = Number.isFinite(ac.altitudeFt) ? ac.altitudeFt / FT_PER_M : 0;
      try {
        marker = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, heightM),
          point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#00d4ff'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: { text: `${label}\n${translate('cmd.aircraft.remote')}`, font: '12px "JetBrains Mono", monospace', fillColor: Cesium.Color.WHITE,
            showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#050a10cc'), pixelOffset: new Cesium.Cartesian2(0, -28),
            disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      } catch { marker = null; }
      try { viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, Math.max(60_000, heightM + 50_000)), duration: 2.5 }); } catch { /* */ }
    }
    notify(translate('cmd.aircraft.flying', { name: label }));
    // Vrstva sa po prelete nahrá okolo kamery — kým lietadlo príde, skúšame (30 s), potom ostane len značka (2 min).
    let tries = 0;
    const poll = () => {
      if (tryTrack(ac.hex)) return;
      if (++tries < 20) pollTimer = setTimer(poll, 1500);
    };
    pollTimer = setTimer(poll, 3000);
    markerTimer = setTimer(() => clearMarker(), 120_000);
  }
  function run(ac) {
    if (ac.local) {
      ensureEnabled(ac.layer);
      if (tryTrack(ac.hex)) return;
    }
    showRemote(ac);
  }
  function toCommand(ac, group) {
    const { label, hint } = aircraftCommandLabel(ac, translate);
    return { id: `ac:${ac.hex}`, label, hint, group, keywords: [], run: () => run(ac) };
  }

  /** Živé lietadlá v pamäti — synchrónne pri každom písmene. */
  function queryCommands(query) {
    const byHex = new Map();
    for (const layer of layers()) {
      let hits = [];
      try { hits = layer.searchContacts?.(query, { limit: 12 }) || []; } catch { hits = []; }
      for (const hit of hits) {
        if (byHex.has(hit.hex) && byHex.get(hit.hex).score >= hit.score) continue;
        byHex.set(hit.hex, { ...hit, local: true, layer, military: layer === military });
      }
    }
    return [...byHex.values()].sort((a, b) => b.score - a.score).slice(0, 12).map((ac) => toCommand(ac, 'aircraft'));
  }

  /** Celý svet zo servera — len keď dopyt vyzerá ako lietadlo (inak sa adsb.lol nezaťažuje). */
  async function asyncResults(query) {
    const parsed = parseAircraftQuery(query);
    if (!upstreamPaths(parsed).length || typeof fetchImpl !== 'function') return [];
    const res = await fetchImpl(`/api/aircraft-search?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
    if (res.status === 429) return [{ id: 'ac-note', kind: 'note', group: 'aircraft-world', label: translate('cmd.aircraft.limited') }];
    if (!res.ok) return [{ id: 'ac-note', kind: 'note', group: 'aircraft-world', label: translate('cmd.aircraft.failed') }];
    const body = await res.json();
    const out = (body.aircraft || []).slice(0, 25).map((ac) => toCommand(ac, 'aircraft-world'));
    const anyFound = out.length > 0;
    const what = (body.meaning || []).slice(0, 2).join(', ');
    if (body.limited) out.push({ id: 'ac-note', kind: 'note', group: 'aircraft-world', label: translate('cmd.aircraft.limited') });
    else if (!out.length && what) out.push({ id: 'ac-note', kind: 'note', group: 'aircraft-world', label: translate('cmd.aircraft.none', { what }) });
    if (anyFound && !body.limited) out.push({ id: 'ac-source', kind: 'note', group: 'aircraft-world', label: translate('cmd.aircraft.source') });
    return out;
  }

  return { queryCommands, asyncResults, clearMarker, _runForTest: run };
}
