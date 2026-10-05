// OKO — anonymná štatistika návštev pre admin panel (2026-10-03).
//
// Posiela na /api/telemetry/hit iba: návštevu (cesta, referer, šírka okna,
// jazyk), minútový „ping" kým je karta viditeľná, ID vrstvy, ktorú človek
// zapol, a JS chyby (max. 5 za načítanie). Bez cookie, bez localStorage, bez
// polohy na glóbuse. Do Not Track / Global Privacy Control = nič sa neposiela.

const ENDPOINT = '/api/telemetry/hit';
const PING_MS = 60_000;
const MAX_ERRORS = 5;
const BOOT_GRACE_MS = 10_000;
/** Zdravie karty lietadla (2026-10-05): po 45 s sledovania dopravného lietadla — má trasu, typ, dopravcu? */
const CARD_CHECK_MS = 45_000;
const MAX_CARD_CHECKS = 20;

/**
 * Výsledok kontroly karty sledovaného lietadla, alebo null (ešte nie / netreba). Pure.
 * Len dopravné volacie znaky (LLL + číslica) vo vzduchu — iné lety trasu v adsbdb nemajú.
 * @param {object|null} info getTrackedInfo() vrstvy lietadiel
 */
export function cardHealthSample(info) {
  if (!info?.icao24 || info.onGround) return null;
  if (!/^[A-Z]{3}\d/.test(String(info.callsign || '').trim().toUpperCase())) return null;
  return {
    t: 'card',
    route: Boolean(info.route?.origin && info.route?.destination),
    type: Boolean(info.typeCode || info.typeName),
    airline: Boolean(info.airline),
  };
}

/** @returns {boolean} true, ak prehliadač žiada nesledovať. */
export function telemetryOptOut(nav = globalThis.navigator) {
  return nav?.doNotTrack === '1' || nav?.globalPrivacyControl === true || globalThis.window?.doNotTrack === '1';
}

function send(payload) {
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
  } catch { /* fallback nižšie */ }
  fetch(ENDPOINT, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' }).catch(() => {});
}

/** Spustí štatistiku na glóbuse. Bezpečné volať aj bez backendu — chyby sa ticho zahodia. */
export function initSiteTelemetry({ win = window, doc = document } = {}) {
  if (telemetryOptOut()) return { stop() {} };
  send({ t: 'view', p: win.location.pathname, r: doc.referrer || '', w: win.innerWidth, l: navigator.language || '' });

  const ping = setInterval(() => { if (doc.visibilityState === 'visible') send({ t: 'ping' }); }, PING_MS);

  let errorsSent = 0;
  const reportError = (msg, src, line, stack) => {
    if (errorsSent >= MAX_ERRORS) return;
    errorsSent++;
    send({ t: 'error', msg: String(msg || '').slice(0, 300), src: String(src || '').slice(0, 200), line: Number(line) || 0,
      stack: String(stack || '').split('\n').slice(0, 6).join('\n').slice(0, 900) });
  };
  const onError = event => reportError(event.message || event.error?.message, event.filename, event.lineno, event.error?.stack);
  const onRejection = event => {
    const reason = event.reason;
    reportError(`Unhandled rejection: ${reason?.message || reason}`, '', 0, reason?.stack);
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);

  // Vrstvy: manažér vznikne až po štarte Cesia — počkáme naň (max. 2 min).
  // Vrstvy zapnuté v prvých 10 s sú predvolené / obnovené, nie voľba človeka.
  const seen = new Set();
  let unsubscribe = null;
  const startedAt = Date.now();
  const waitForManager = setInterval(() => {
    const manager = win.__godsEyeView?.dataManager;
    if (!manager?.subscribe) {
      if (Date.now() - startedAt > 120_000) clearInterval(waitForManager);
      return;
    }
    clearInterval(waitForManager);
    const subscribedAt = Date.now();
    unsubscribe = manager.subscribe(change => {
      if (change?.type !== 'visibility-transition' || !change.enabled || change.lifecycleState !== 'enabled') return;
      if (Date.now() - subscribedAt < BOOT_GRACE_MS || seen.has(change.layerId)) return;
      seen.add(change.layerId);
      send({ t: 'layer', layer: String(change.layerId).slice(0, 48) });
    });
  }, 2000);

  // Karta lietadla: po 45 s sledovania jedného stroja jedna vzorka (áno/nie, žiadny volací znak ani poloha).
  const cardChecked = new Set();
  let tracked = { hex: null, at: 0 };
  const cardWatch = setInterval(() => {
    if (cardChecked.size >= MAX_CARD_CHECKS) return;
    let info = null;
    try { info = win.__godsEyeView?.dataManager?.layers?.get?.('flights')?.module?.getTrackedInfo?.() || null; } catch { info = null; }
    if (!info?.icao24) { tracked = { hex: null, at: 0 }; return; }
    if (tracked.hex !== info.icao24) { tracked = { hex: info.icao24, at: Date.now() }; return; }
    if (Date.now() - tracked.at < CARD_CHECK_MS || cardChecked.has(info.icao24)) return;
    const sample = cardHealthSample(info);
    if (!sample) return;
    cardChecked.add(info.icao24);
    send(sample);
  }, 5000);

  return {
    stop() {
      clearInterval(cardWatch);
      clearInterval(ping); clearInterval(waitForManager); unsubscribe?.();
      win.removeEventListener('error', onError); win.removeEventListener('unhandledrejection', onRejection);
    },
  };
}
