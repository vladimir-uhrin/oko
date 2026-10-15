// src/contextLossRecovery.js — obnova po strate grafického kontextu WebGL (2026-10-15).
//
// Vlastník: „na mobiloch sa mi niekedy nevykreslia google dlaždice". Mobilný prehliadač pri nedostatku
// grafickej pamäte zahodí kontext WebGL (udalosť `webglcontextlost`). Cesium kontext obnoviť nevie —
// glóbus ostane prázdny až do obnovenia stránky. Pohľad (kamera, vrstvy, sledovaný objekt) je v adrese,
// takže obnovenie stránky vráti návštevníka tam, kde bol: najviac AUTO_RELOAD_MAX× za AUTO_RELOAD_WINDOW_MS
// sama, potom už len hláška s tlačidlom (žiadna slučka obnovovania na zariadení, ktoré to nezvláda).

export const AUTO_RELOAD_MAX = 2;
export const AUTO_RELOAD_WINDOW_MS = 10 * 60_000;
export const AUTO_RELOAD_DELAY_MS = 1200;
export const CONTEXT_LOSS_STORAGE_KEY = 'oko.contextLost';

/** Smie sa stránka obnoviť sama? (pure) — počet strát v okne pred touto. */
export function shouldAutoReload(timestamps, nowMs, { max = AUTO_RELOAD_MAX, windowMs = AUTO_RELOAD_WINDOW_MS } = {}) {
  const recent = (Array.isArray(timestamps) ? timestamps : []).filter((t) => Number.isFinite(t) && nowMs - t < windowMs);
  return recent.length < max;
}

function readTimes(storage) {
  try {
    const raw = JSON.parse(storage?.getItem?.(CONTEXT_LOSS_STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(Number.isFinite) : [];
  } catch { return []; }
}

/**
 * @param {HTMLCanvasElement} canvas plátno Cesia
 * @param {object} [o]
 * @param {Storage|null} [o.storage] sessionStorage (počítadlo strát v tejto karte)
 * @param {() => void} [o.reload]
 * @param {(text: string, { action?: () => void, actionLabel?: string }) => void} [o.notify]
 * @param {(key: string) => string} [o.translate]
 * @param {() => number} [o.now]
 * @param {(fn: Function, ms: number) => unknown} [o.setTimeoutImpl]
 */
export function installContextLossRecovery(canvas, {
  storage = null,
  reload = () => globalThis.location?.reload?.(),
  notify = () => {},
  translate = (key) => key,
  now = () => Date.now(),
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  if (!canvas?.addEventListener) return { destroy() {} };
  const onLost = (event) => {
    event?.preventDefault?.();
    const t = now();
    const times = readTimes(storage);
    if (shouldAutoReload(times, t)) {
      try { storage?.setItem?.(CONTEXT_LOSS_STORAGE_KEY, JSON.stringify([...times.filter((x) => t - x < AUTO_RELOAD_WINDOW_MS), t])); } catch { /* bez úložiska jedna obnova */ }
      notify(translate('context.lost-reloading'), {});
      setTimeoutImpl(() => reload(), AUTO_RELOAD_DELAY_MS);
    } else {
      notify(translate('context.lost-manual'), { action: () => reload(), actionLabel: translate('context.reload') });
    }
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  return { destroy() { canvas.removeEventListener('webglcontextlost', onLost, false); } };
}

/** Jednoduchá hláška cez celú šírku (styleManager v tej chvíli ešte nemusí existovať). */
export function showContextLossNotice(doc, text, { action = null, actionLabel = '' } = {}) {
  if (!doc?.body) return;
  let box = doc.getElementById('oko-context-lost');
  if (!box) {
    box = doc.createElement('div');
    box.id = 'oko-context-lost';
    box.setAttribute('role', 'alert');
    doc.body.appendChild(box);
  }
  box.textContent = text;
  if (typeof action === 'function' && actionLabel) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = actionLabel;
    btn.addEventListener('click', action);
    box.appendChild(btn);
  }
}
