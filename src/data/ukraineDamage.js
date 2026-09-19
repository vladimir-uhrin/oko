// src/data/ukraineDamage.js
/**
 * @module ukraineDamage
 * @description Škody na budovách modulu UKRAJINA (etapa 5, 2026-09-19; plán
 * docs/drafts/ukrajina-plan.md kap. 2.4 a 5.5 — časť bez súhlasov). Dva statické
 * zdroje zo Zenodo záznamu ETH Zürich (Dietrich et al. 2025, CC BY 4.0):
 *  - `n_buildings_damaged_adm3_t0_655.geojson`: 1 769 hromád (ADM3) s počtom
 *    pravdepodobne poškodených budov zo Sentinel-1 (Random Forest, recall 85 %,
 *    precision 67 %) za február 2022 – február 2024 → kruhy v ťažisku hromady;
 *  - `unosat_labels.geojson`: 18 686 budov hodnotených UNOSAT/UNITAR z VHR snímok
 *    (Mariupol, Rubižne, Sjeverodoneck, Lysyčansk, Irpiň, Černihiv, Volnovacha…,
 *    marec 2022 – 2023) s triedou poškodenia a dátumom hodnotenia → body, ktoré
 *    časová os odkrýva podľa dátumu (UNOSAT licencia CC BY-SA).
 * Pravdepodobnostné a statické — v UI vždy „do 02/2024", „model", „odhad".
 * Budovy, nie osoby. Čistý modul (build skript aj klient).
 */

/** Triedy UNOSAT (Main Damage Site Class): 1 zničená, 2 ťažko, 3 stredne, 4 možno; 6 bez viditeľných škôd; 7 neurčené. */
export const UNOSAT_CLASS = Object.freeze({ 1: 'destroyed', 2: 'severe', 3: 'moderate', 4: 'possible' });
export const UNOSAT_COLORS = Object.freeze({ destroyed: '#f87171', severe: '#ff8a3d', moderate: '#ffb547', possible: '#ffe08a' });
export const DAMAGE_PERIOD = Object.freeze({ from: '2022-02-24', to: '2024-02-29' });

/** Ťažisko kruhu polygónu [lon,lat] (planárny vzorec; pri degenerovanom kruhu priemer). Pure. */
export function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]; const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    a += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}
/** Ťažisko prvku: Polygon = vonkajší kruh, MultiPolygon = najväčšia časť (podľa |plochy|). Pure. */
export function featureCentroid(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') return ringCentroid(geometry.coordinates?.[0]);
  if (geometry.type === 'MultiPolygon') {
    let best = null; let bestArea = -1;
    for (const poly of geometry.coordinates || []) {
      const ring = poly?.[0];
      if (!ring) continue;
      let a = 0;
      for (let i = 0; i < ring.length - 1; i += 1) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = ring; }
    }
    return best ? ringCentroid(best) : null;
  }
  if (geometry.type === 'Point') return geometry.coordinates?.slice(0, 2) || null;
  return null;
}
const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** Prvok ADM3 → `{id, name, lat, lon, damaged, buildings, pct}` alebo null (bez škôd = null). Pure. */
export function adm3Item(feature) {
  const p = feature?.properties || {};
  const damaged = Number(p.n_buildings_damaged) || 0;
  if (damaged <= 0) return null;
  const c = featureCentroid(feature.geometry);
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { id: String(p.adm3_id ?? ''), name: String(p.ADM3_EN || '').trim() || null, lat: round4(c[1]), lon: round4(c[0]), damaged, buildings: Number(p.n_buildings) || null, pct: Number.isFinite(Number(p.perc_destroyed)) ? Math.round(Number(p.perc_destroyed) * 10) / 10 : null };
}
/** Prvok UNOSAT → `{lat, lon, t, cls, city}` alebo null (bez triedy 1–4 alebo bez dátumu). Pure. */
export function unosatItem(feature) {
  const p = feature?.properties || {};
  const cls = UNOSAT_CLASS[Number(p.damage)];
  if (!cls) return null;
  const t = Date.parse(p.date || '');
  if (!Number.isFinite(t)) return null;
  const c = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { lat: round4(c[1]), lon: round4(c[0]), t, cls, city: p.city ? String(p.city) : null };
}
/** Súhrn pre panel a legendu. Pure. */
export function damageSummary(adm3, unosat) {
  const out = { hromady: adm3.length, damaged: 0, unosat: unosat.length, byClass: {}, cities: {} };
  for (const a of adm3) out.damaged += a.damaged;
  for (const u of unosat) { out.byClass[u.cls] = (out.byClass[u.cls] || 0) + 1; if (u.city) out.cities[u.city] = (out.cities[u.city] || 0) + 1; }
  return out;
}

/** Polomer kruhu hromady v px z počtu poškodených budov (odmocnina, 4–22 px). Pure. */
export function damageRadiusPx(damaged) {
  if (!Number.isFinite(damaged) || damaged <= 0) return 0;
  return Math.max(4, Math.min(22, 2.2 * Math.sqrt(damaged / 25)));
}
/** Farba hromady podľa podielu poškodených budov (%): < 2 žltá, < 10 oranžová, inak červená. Pure. */
export function damageColor(pct) {
  if (!Number.isFinite(pct)) return '#ffb547';
  if (pct < 2) return '#ffe08a';
  if (pct < 10) return '#ff8a3d';
  return '#f87171';
}
/** UNOSAT body platné k času kurzora (dátum hodnotenia ≤ kurzor); bez kurzora všetky. Pure. */
export function unosatVisibleAt(items, cursorMs) {
  if (!Number.isFinite(cursorMs)) return items || [];
  return (items || []).filter((u) => u.t <= cursorMs);
}
