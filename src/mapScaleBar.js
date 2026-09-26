// src/mapScaleBar.js
/**
 * @module mapScaleBar
 * @description Mierka v km (2026-09-24, vlastník: „snaž sa o prehľadnosť ako
 * špičkové portály" — každá dobrá mapa ju má). Ukazuje sa len v režime mapy
 * (`body.oko-map-focus` — priblížená scéna frontu/úžiny). Dĺžka sa meria na
 * elipsoide v spodnej časti záberu (tam, kde sa mapa číta), zaokrúhli na pekné
 * číslo (1, 2, 5 × 10ⁿ) do ~110 px. Poloha: vpravo od súradníc HUD-u vľavo dole
 * (nad nimi je rezerva ľavého panela), bez HUD-u nad najvyšším spodným chrómom
 * (os, dok, mobilná lišta). Prvok je v tele stránky (`position: fixed` v
 * style.css), takže ho karty udalostí berú ako prekážku.
 */
import * as Cesium from 'cesium';

export const SCALE_STEPS_KM = Object.freeze([0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]);
export const SCALE_MAX_PX = 110;
export const SCALE_UPDATE_MS = 250;

/** Najdlhší pekný krok, ktorý sa zmestí do `maxPx`; text „500 m" / „20 km". Pure. */
export function niceScale(kmPerPx, maxPx = SCALE_MAX_PX, lang = 'sk') {
  if (!(kmPerPx > 0) || !Number.isFinite(kmPerPx)) return null;
  const maxKm = kmPerPx * maxPx;
  let km = null;
  for (const s of SCALE_STEPS_KM) if (s <= maxKm) km = s;
  if (km === null) return null;
  const num = (v) => (lang === 'sk' ? String(v).replace('.', ',') : String(v));
  return { km, px: Math.max(8, Math.round(km / kmPerPx)), label: km < 1 ? `${Math.round(km * 1000)} m` : `${num(km)} km` };
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createMapScaleBar({ viewer, documentRef = null, lang = () => 'sk', now = () => Date.now() } = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument || globalThis.document;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement || !doc.body) return { update() {}, destroy() {}, getState: () => ({ shown: false }) };
  const el = doc.createElement('div');
  el.className = 'oko-scale';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  const bar = doc.createElement('span');
  bar.className = 'oko-scale-bar';
  const label = doc.createElement('span');
  label.className = 'oko-scale-label';
  el.appendChild(bar); el.appendChild(label);
  doc.body.appendChild(el);
  let last = 0; let state = { shown: false, km: null, px: 0 };
  const scratchA = new Cesium.Cartesian2(); const scratchB = new Cesium.Cartesian2();

  function hide() { if (!el.hidden) el.hidden = true; state = { shown: false, km: null, px: 0 }; }
  function place() {
    // Vedľa súradníc HUD-u vľavo dole; bez neho nad spodným chrómom (os, dok, mobilná lišta).
    const hud = doc.querySelector('#intel-hud .hud-bottom-left');
    const hr = hud && typeof hud.checkVisibility === 'function' && hud.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? hud.getBoundingClientRect() : null;
    const tl = doc.querySelector('.oko-ukr-timeline');
    const tr = tl && !tl.hidden ? tl.getBoundingClientRect() : null;
    const h = el.offsetHeight || 18;
    const vh = doc.defaultView?.innerHeight || 800;
    let left = 36; let top = vh - h - 24;
    // Rám KARTA (2026-09-26): súradnicový roh je schovaný; mierka ide do päty
    // legendy (slot .oko-karta-legend-scale) — legenda + mierka ako na tlačenej mape.
    const slot = doc.querySelector('#oko-karta-overlay.is-visible .oko-karta-legend-scale');
    const sr = slot && typeof slot.checkVisibility === 'function' && slot.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? slot.getBoundingClientRect() : null;
    if (sr && sr.height > 0) {
      left = sr.left; top = sr.top + (sr.height - h) / 2;
    } else if (hr && hr.height > 0) {
      // Vpravo od súradníc, zarovnané so spodkom — nad nimi je rezerva ľavého panela.
      left = hr.right + 14; top = hr.bottom - h - 2;
    } else {
      // Bez HUD-u (mobil, čistý pohľad): nad najvyšším spodným chrómom v páse mierky
      // (os, dok, mobilná lišta, kredity Cesium/Google — na mobile sú zdvihnuté nad dok).
      let floor = vh;
      for (const sel of ['.oko-ukr-timeline', '#command-dock', '#oko-appbar', '#cesium-credits']) {
        const n = doc.querySelector(sel);
        if (!n || n.hidden || (typeof n.checkVisibility === 'function' && !n.checkVisibility({ opacityProperty: false, visibilityProperty: true }))) continue;
        const r = n.getBoundingClientRect();
        if (!(r.height > 0) || r.left > left + 200 || r.right < left) continue;
        floor = Math.min(floor, r.top);
      }
      if (tr && tr.height > 0) left = Math.max(16, tr.left);
      top = floor - h - 8;
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }
  function update(force = false) {
    const t = now();
    if (!force && t - last < SCALE_UPDATE_MS) return;
    last = t;
    if (!doc.body.classList.contains('oko-map-focus')) { hide(); return; }
    const canvas = scene.canvas;
    const w = canvas?.clientWidth || 0; const hgt = canvas?.clientHeight || 0;
    if (!w || !hgt) { hide(); return; }
    const y = hgt * 0.7;
    scratchA.x = w / 2 - 50; scratchA.y = y; scratchB.x = w / 2 + 50; scratchB.y = y;
    let km = null;
    try {
      const a = scene.camera.pickEllipsoid(scratchA, Cesium.Ellipsoid.WGS84);
      const b = scene.camera.pickEllipsoid(scratchB, Cesium.Ellipsoid.WGS84);
      if (a && b) {
        const g = new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromCartesian(a), Cesium.Cartographic.fromCartesian(b));
        km = g.surfaceDistance / 1000;
      }
    } catch { km = null; }
    const nice = km ? niceScale(km / 100, SCALE_MAX_PX, lang()) : null;
    if (!nice) { hide(); return; }
    bar.style.width = `${nice.px}px`;
    label.textContent = nice.label;
    el.hidden = false;
    state = { shown: true, km: nice.km, px: nice.px };
    place();
  }
  const onRender = () => update(false);
  try { scene.postRender?.addEventListener?.(onRender); } catch { /* */ }
  function destroy() {
    try { scene.postRender?.removeEventListener?.(onRender); } catch { /* */ }
    try { el.remove(); } catch { /* */ }
  }
  return { update: () => update(true), destroy, getState: () => ({ ...state }), _el: el };
}
