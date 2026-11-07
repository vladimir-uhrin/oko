// src/plantSearchCommands.js
/**
 * @module plantSearchCommands
 * @description Elektrárne v jednotnom hľadaní (2026-11-07, ELEKTRINA 5. kolo):
 * „Mochovce", „Temelín", „Three Gorges" v palete nájde elektráreň zo snímku
 * WRI (vrstva local-power-plants), klik zapne vrstvu a kamera preletí nad ňu —
 * zblízka je karta s palivom, výkonom a výrobou na mape sama (localLabelLod).
 *
 * Snímok (≈ 2 MB) sa stiahne až pri prvom dopyte s ≥ 3 písmenami, nie pri štarte;
 * je to ten istý súbor ako vo vrstve, takže druhé stiahnutie vybaví cache prehliadača.
 */
import { foldText } from './commandPalette.js';
import { formatPlantMw } from './data/powerPlants.js';

export const PLANT_GROUP = 'plants';
const LAYER_ID = 'local-power-plants';

/** Má zmysel hľadať? Aspoň 3 písmená (číslo ani kód nie je meno elektrárne). Pure. */
export function looksLikePlantQuery(query) {
  return String(query ?? '').replace(/[^A-Za-zÀ-ž]/g, '').length >= 3;
}

/** GeoJSONL → kompaktný index { name, fold, lon, lat, mw, fuel, cc, status }. Pure. */
export function buildPlantIndex(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let f;
    try { f = JSON.parse(line); } catch { continue; }
    const p = f?.properties || {};
    const [lon, lat] = f?.geometry?.coordinates || [];
    if (!p.name || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({ id: String(f.id ?? p.id ?? p.name), name: p.name, fold: foldText(p.name), lon, lat,
      mw: Number(p.mw) || 0, fuel: p.fuel || 'other', cc: p.cc || null, status: p.status || null });
  }
  return out;
}

/**
 * Zhoda podľa mena: od začiatku > začiatok slova > kdekoľvek; pri rovnosti väčšia
 * elektráreň skôr („Gabčíkovo" pred malou vodnou s rovnakým slovom). Pure.
 */
export function matchPlants(index, query, { limit = 6 } = {}) {
  const q = foldText(query);
  if (q.length < 3) return [];
  const hits = [];
  for (const p of index || []) {
    let s = 0;
    if (p.fold.startsWith(q)) s = 3;
    else if (p.fold.includes(` ${q}`) || p.fold.includes(`-${q}`)) s = 2;
    else if (p.fold.includes(q)) s = 1;
    if (s) hits.push({ p, s });
  }
  hits.sort((a, b) => (b.s - a.s) || (b.p.mw - a.p.mw));
  return hits.slice(0, limit).map((h) => h.p);
}

/** „jadrová · 1 411 MW · SK" (zatvorená: „… · ZATVORENÁ"). Pure. */
export function plantHint(p, translate = (k) => k, lang = 'sk') {
  const parts = [translate(`plant.fuel-${p.fuel}`), formatPlantMw(p.mw, lang)];
  if (p.cc) parts.push(p.cc);
  if (p.status === 'closed') parts.push(translate('cmd.plant.closed'));
  return parts.filter(Boolean).join(' · ');
}

/**
 * @param {object} o
 * @param {string} o.url adresa snímku (tá istá ako vo vrstve)
 * @param {object} [o.dataManager]
 * @param {object} [o.viewer]
 * @param {object} [o.Cesium]
 * @param {Function} [o.translate]
 * @param {() => string} [o.lang]
 * @param {(text: string) => void} [o.notify]
 * @param {typeof fetch} [o.fetchImpl]
 */
export function createPlantSearchCommands({ url, dataManager = null, viewer = null, Cesium = null,
  translate = (k) => k, lang = () => 'sk', notify = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  let indexPromise = null;

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = Promise.resolve()
        .then(() => fetchImpl(url))
        .then((res) => (res?.ok ? res.text() : Promise.reject(new Error(`HTTP ${res?.status}`))))
        .then(buildPlantIndex)
        .catch((error) => { indexPromise = null; throw error; }); // ďalší dopyt skúsi znova
    }
    return indexPromise;
  }

  async function flyTo(p) {
    try {
      if (dataManager && !dataManager.isEnabled?.(LAYER_ID)) await dataManager.setEnabled?.(LAYER_ID, true, { origin: 'user' });
    } catch { /* let kamery aj bez vrstvy */ }
    // 25 km: v dosahu plného popisu (localLabelLod 90 km), elektráreň aj okolie v zábere.
    try { viewer?.camera?.flyTo?.({ destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 25_000), duration: 2.5 }); } catch { /* */ }
    notify(`${p.name} · ${plantHint(p, translate, lang())}`);
  }

  return {
    async asyncResults(query) {
      if (!looksLikePlantQuery(query)) return [];
      const index = await loadIndex();
      return matchPlants(index, query).map((p) => ({
        id: `plant:${p.id}`,
        group: PLANT_GROUP,
        label: p.name,
        hint: plantHint(p, translate, lang()),
        run: () => { void flyTo(p); },
      }));
    },
    _loadIndexForTest: loadIndex,
  };
}
