// src/auth/push.js
/**
 * Web Push pre sledované lode (2026-10-11, vlastník: „upozornenia na sledované lode aj so
 * zatvorenou stránkou"). Spoločná validácia predplatného pre server (http.js) aj prehliadač
 * a text upozornenia (strážca na serveri, pushWatch.js). Bez DOM, bez siete.
 *
 * Ukladá sa len adresa push služby prehliadača a jej dva kľúče — nič o polohe používateľa.
 */

/** Najviac zariadení (predplatných) na účet. */
export const PUSH_MAX = 10;
const ENDPOINT_MAX = 2048;
const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/;

/**
 * Z PushSubscription.toJSON() spraví čistý záznam, alebo null.
 * @param {{endpoint?: unknown, keys?: {p256dh?: unknown, auth?: unknown}}} input
 * @returns {{endpoint: string, p256dh: string, auth: string}|null}
 */
export function sanitizePushSubscription(input) {
  if (!input || typeof input !== 'object') return null;
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  if (!endpoint.startsWith('https://') || endpoint.length > ENDPOINT_MAX || /\s/.test(endpoint)) return null;
  try { new URL(endpoint); } catch { return null; }
  const keys = input.keys && typeof input.keys === 'object' ? input.keys : {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
  const auth = typeof keys.auth === 'string' ? keys.auth : '';
  if (!KEY_RE.test(p256dh) || !KEY_RE.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/**
 * Text upozornenia (po slovensky — jazyk používateľa server nepozná; web je slovenský). Pure.
 * @param {{type: 'departed'|'arrived'}} ev
 * @param {{label?: string, mmsi: string}} entry
 * @param {{port?: string|null, to?: string|null}} status nový stav
 * @param {{port?: string|null}|null} prev predošlý stav (odkiaľ vyplávala)
 * @returns {{title: string, body: string, tag: string, url: string}}
 */
export function vesselPushPayload(ev, entry, status, prev = null) {
  const label = entry?.label || entry?.mmsi || '';
  const mmsi = String(entry?.mmsi || '');
  if (ev?.type === 'arrived') {
    return { title: `${label} priplávala`, body: status?.port ? `do prístavu ${status.port}` : 'do prístavu', tag: `vessel:${mmsi}`, url: `/?ship=${mmsi}` };
  }
  const from = prev?.port || status?.port || null;
  const parts = [from ? `z prístavu ${from}` : 'vyplávala', status?.to ? `na ceste do ${status.to}` : ''].filter(Boolean);
  return { title: `${label} vyplávala`, body: parts.join(' · '), tag: `vessel:${mmsi}`, url: `/?ship=${mmsi}` };
}
