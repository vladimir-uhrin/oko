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
 * Zapíš počítadlo a over, že sa dá prečítať späť (2026-10-15). Bez úložiska (zakázané údaje stránok,
 * rámček s nepriehľadným pôvodom → main.js podá null) alebo pri zahodenom zápise by obnovenie stránky
 * počítadlo stratilo, každé načítanie by videlo prázdny zoznam a na telefóne, ktorý kontext stráca
 * stále, by sa stránka obnovovala dookola. Samostatne sa teda obnovuje len vtedy, keď počet prežije.
 * @returns {boolean} zápis prežije obnovenie stránky
 */
function persistTimes(storage, times) {
  try {
    storage?.setItem?.(CONTEXT_LOSS_STORAGE_KEY, JSON.stringify(times));
  } catch { return false; }
  const back = readTimes(storage);
  return back.length === times.length && back[back.length - 1] === times[times.length - 1];
}

/**
 * @param {HTMLCanvasElement} canvas plátno Cesia
 * @param {object} [o]
 * @param {Storage|null} [o.storage] sessionStorage (počítadlo strát v tejto karte); bez neho sa stránka sama neobnovuje
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
  /** Straty v tomto načítaní stránky — bez úložiska jediný údaj o predošlej strate. */
  let lostHere = 0;
  const onLost = (event) => {
    event?.preventDefault?.();
    const t = now();
    const recent = readTimes(storage).filter((x) => t - x < AUTO_RELOAD_WINDOW_MS);
    // Bez trvalého počítadla len hláška s tlačidlom — strop AUTO_RELOAD_MAX by inak neplatil.
    if (shouldAutoReload(recent, t) && persistTimes(storage, [...recent, t])) {
      notify(translate('context.lost-reloading'), {});
      setTimeoutImpl(() => reload(), AUTO_RELOAD_DELAY_MS);
    } else {
      // „Opäť" len pri známej predošlej strate (2026-10-16): bez úložiska je aj prvá strata stránky
      // vetvou s tlačidlom a text „opäť resetoval" by klamal.
      const again = recent.length > 0 || lostHere > 0;
      notify(translate(again ? 'context.lost-manual' : 'context.lost-manual-first'), { action: () => reload(), actionLabel: translate('context.reload') });
    }
    lostHere += 1;
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
