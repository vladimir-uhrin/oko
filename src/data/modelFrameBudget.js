// src/data/modelFrameBudget.js
// Automatický rozpočet 3D modelov lietadiel podľa času snímku (2026-09-09,
// používateľ: „nestačí to, sprav aby to bolo automaticky"): každý stroj na
// obrazovke má dostať model, ale každý model je vlastný draw call + update
// (~0,2 ms/snímok v paneli; 143 modelov = +30 ms). Rozpočet preto rastie,
// kým je snímok rýchly, a sťahuje sa, keď je pomalý — nikdy pod základný
// strop režimu, nikdy nad tvrdý strop. Čisté počty + malý merač snímku.

/** Predvolené ladenie regulátora. */
export const MODEL_BUDGET_DEFAULTS = Object.freeze({
  /** Nad týmto časom (ms CPU render) sa rozpočet sťahuje (~45 fps). */
  slowMs: 22,
  /** Pod týmto časom sa rozpočet rozširuje. */
  fastMs: 14,
  /** Násobok pri sťahovaní. */
  shrink: 0.8,
  /** Prírastok modelov pri rozširovaní. */
  grow: 40,
  /** Interval regulácie (ms) — modely sa načítavajú asynchrónne, cena sa ustáli až po chvíli. */
  intervalMs: 1000,
  /** Váha nového merania v kĺzavom priemere času snímku. */
  emaAlpha: 0.15,
});

/**
 * Ďalší rozpočet z aktuálneho času snímku. Pure.
 * @param {number} budget aktuálny rozpočet
 * @param {number} renderMs kĺzavý čas renderu (ms); NaN = bez merania → nemení
 * @param {{baseCap:number, maxCap:number, slowMs?:number, fastMs?:number, shrink?:number, grow?:number}} opts
 * @returns {number}
 */
export function nextModelBudget(budget, renderMs, opts) {
  const o = { ...MODEL_BUDGET_DEFAULTS, ...opts };
  const base = Math.max(0, Number(o.baseCap) || 0);
  const max = Math.max(base, Number(o.maxCap) || base);
  const clamp = (v) => Math.min(max, Math.max(base, Math.round(v)));
  const current = clamp(Number.isFinite(budget) ? budget : base);
  if (!Number.isFinite(renderMs)) return current;
  if (renderMs > o.slowMs) return clamp(current * o.shrink);
  if (renderMs < o.fastMs) return clamp(current + o.grow);
  return current;
}

/**
 * Merač CPU času snímku: preRender → postRender scény, kĺzavý priemer.
 * Injektovateľné `now` a scéna s addEventListener na oboch udalostiach.
 * @param {{preRender:{addEventListener:Function}, postRender:{addEventListener:Function}}|null} scene
 * @returns {{renderMs:() => number, destroy:() => void}}
 */
export function createFrameCostMeter(scene, { now = () => performance.now(), emaAlpha = MODEL_BUDGET_DEFAULTS.emaAlpha } = {}) {
  let t0 = NaN;
  let ema = NaN;
  const onPre = () => { t0 = now(); };
  const onPost = () => {
    if (!Number.isFinite(t0)) return;
    const dt = now() - t0;
    t0 = NaN;
    if (!Number.isFinite(dt) || dt < 0) return;
    ema = Number.isFinite(ema) ? ema + (dt - ema) * emaAlpha : dt;
  };
  const removePre = scene?.preRender?.addEventListener?.(onPre) || null;
  const removePost = scene?.postRender?.addEventListener?.(onPost) || null;
  return {
    renderMs: () => ema,
    destroy() { removePre?.(); removePost?.(); t0 = NaN; ema = NaN; },
  };
}
