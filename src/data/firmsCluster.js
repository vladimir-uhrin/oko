// src/data/firmsCluster.js — zhluky ohnísk a tvar plameňa (2026-10-07), čisté funkcie.
//
// Vlastník: „vyzerá to ako hviezdna obloha“ (juh Ukrajiny z 700 km: stovky žltých svietiacich bodov
// na tmavej mape). Dve zmeny: (1) z diaľky jedna značka na zhluk ohnísk s počtom — „27“ — namiesto
// stoviek bodov; zblízka sa zhluk rozpadne na jednotlivé ohniská; (2) značka má tvar plameňa
// (nie rozmazaný kruh), farba podľa sily požiaru, sýtosť podľa veku.

/**
 * Ohniská → zhluky na mriežke `gridDeg`. Vstup zoradený podľa FRP zostupne (prvé ohnisko bunky =
 * najsilnejšie = poloha a klik zhluku). Výstup v poradí najsilnejšieho ohniska. Pure.
 * @param {Array<{lat:number, lon:number, frp:number, acqMs?:number, geoSeenMs?:number, night?:boolean}>} firesByFrp
 * @param {number} gridDeg
 * @param {number} [maxClusters]
 * @returns {Array<{lat:number, lon:number, count:number, maxFrp:number, sumFrp:number, newestMs:number, night:number, strongest:object}>}
 */
export function clusterFires(firesByFrp, gridDeg, maxClusters = Infinity) {
  const cells = new Map();
  const out = [];
  for (const f of Array.isArray(firesByFrp) ? firesByFrp : []) {
    if (!Number.isFinite(f?.lat) || !Number.isFinite(f?.lon)) continue;
    const key = `${Math.floor(f.lat / gridDeg)}:${Math.floor(f.lon / gridDeg)}`;
    let c = cells.get(key);
    const seen = Math.max(f.acqMs || 0, f.geoSeenMs || 0);
    if (!c) {
      if (out.length >= maxClusters) continue;
      c = { lat: f.lat, lon: f.lon, count: 0, maxFrp: f.frp || 0, sumFrp: 0, newestMs: 0, night: 0, strongest: f };
      cells.set(key, c);
      out.push(c);
    }
    c.count += 1;
    c.sumFrp += f.frp || 0;
    if (seen > c.newestMs) c.newestMs = seen;
    if (f.night) c.night += 1;
  }
  return out;
}

/** Počet do odznaku: 1–99 presne, potom „99+“. Pure. */
export function clusterBadge(count) {
  if (!(count > 1)) return '';
  return count > 99 ? '99+' : String(count);
}

/**
 * Obrys plameňa v štvorci `size` (body pre quadraticCurveTo): špička hore, oblé dno, mierne
 * prehnutý jazyk. Vracia príkazy pre canvas — samotné kreslenie robí firmsHeatmap (DOM). Pure.
 * @param {number} size
 * @returns {Array<[string, ...number[]]>}
 */
export function flamePath(size) {
  const s = size;
  return [
    ['M', s * 0.5, s * 0.04],
    ['Q', s * 0.62, s * 0.3, s * 0.8, s * 0.48],
    ['Q', s * 0.94, s * 0.66, s * 0.84, s * 0.82],
    ['Q', s * 0.72, s * 0.98, s * 0.5, s * 0.98],
    ['Q', s * 0.28, s * 0.98, s * 0.16, s * 0.82],
    ['Q', s * 0.06, s * 0.66, s * 0.22, s * 0.46],
    ['Q', s * 0.3, s * 0.56, s * 0.36, s * 0.5],
    ['Q', s * 0.34, s * 0.26, s * 0.5, s * 0.04],
  ];
}
