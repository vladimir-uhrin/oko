// src/auth/server/pushWatch.js
/**
 * Strážca sledovaných lodí na serveri + Web Push (2026-10-11, vlastník: „upozornenia na
 * sledované lode aj so zatvorenou stránkou"). Raz za 5 min prejde všetky lode, ktoré niekto
 * sleduje (tabuľka followed_flights, kľúče `mmsi:`), zistí stav zo živého AIS a plavby z registra
 * (cez vlastné endpointy na loopbacku) a pri prechode v prístave → na ceste / na ceste → v prístave
 * pošle push každému zariadeniu sledovateľa (web-push, VAPID z .env). Stav lodí drží v JSON
 * súbore, aby reštart služby neposielal upozornenia znova. Prvé vyhodnotenie bez uloženého stavu
 * je len základ.
 *
 * Push sa posiela vždy; service worker (public/sw-push.js) ho nezobrazí, keď je OKO otvorené
 * a viditeľné — vtedy toast robí stránka sama (followedVessels.js).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { vesselFollowStatus, vesselFollowTransitions } from '../../data/vesselFollowStatus.js';
import { vesselPushPayload } from '../push.js';

export const FOLLOW_WATCH_INTERVAL_MS = 5 * 60_000;
export const FOLLOW_WATCH_FIRST_MS = 90_000;
/** Najviac lodí na jeden prechod (ochrana registra: 600 dopytov/h). */
export const FOLLOW_WATCH_MAX_VESSELS = 400;
const PUSH_TTL_S = 6 * 3600;

/** VAPID kľúče z prostredia; bez nich je push vypnutý (UI to vie z /api/account/push). Pure. */
export function vapidFromEnv(env = process.env) {
  const publicKey = String(env.PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.PUSH_VAPID_SUBJECT || 'mailto:info@okolive.sk').trim();
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

/**
 * @param {object} o
 * @param {object} o.store openAuthStore (followedVessels, pushSubscriptions, removePush)
 * @param {object} [o.env]
 * @param {() => number|null} [o.port] port tohto servera (loopback dopyty)
 * @param {typeof fetch} [o.fetchImpl]
 * @param {object|null} [o.webpush] knižnica web-push (lenivo, test: podvrh)
 * @param {string|null} [o.stateFile] JSON so stavom lodí; null = len v pamäti
 */
export function createFollowWatch({ store, env = process.env, port = () => null, fetchImpl = globalThis.fetch, webpush = null, now = Date.now, log = () => {}, stateFile = null } = {}) {
  const vapid = vapidFromEnv(env);
  let lib = webpush;
  let configured = false;
  let timer = null;
  let first = null;
  let running = false;
  let memoryState = null; // mmsi → {status, port, to}
  const stats = { lastTickAt: null, checked: 0, events: 0, sent: 0, failed: 0 };

  async function library() {
    if (!lib) lib = (await import('web-push')).default;
    if (!configured) { lib.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey); configured = true; }
    return lib;
  }

  async function readState() {
    if (memoryState) return memoryState;
    if (!stateFile) return null;
    try { memoryState = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { memoryState = null; }
    return memoryState;
  }

  async function writeState(state) {
    memoryState = state;
    if (!stateFile) return;
    try {
      await fsp.mkdir(path.dirname(stateFile), { recursive: true });
      await fsp.writeFile(stateFile, JSON.stringify(state));
    } catch (error) { log(`[follow-watch] zápis stavu zlyhal: ${error?.message || error}`); }
  }

  async function getJson(url) {
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
      return res?.ok ? await res.json() : null;
    } catch { return null; }
  }

  /** Pošle upozornenie všetkým zariadeniam používateľa; mŕtve predplatné (404/410) zmaže. */
  async function send(userId, payload) {
    if (!vapid) return 0;
    const subs = store.pushSubscriptions(userId);
    if (!subs.length) return 0;
    const wp = await library();
    let sent = 0;
    for (const sub of subs) {
      try {
        await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: PUSH_TTL_S });
        sent += 1;
      } catch (error) {
        const code = Number(error?.statusCode);
        if (code === 404 || code === 410) store.removePush(userId, sub.endpoint);
        else { stats.failed += 1; log(`[follow-watch] push zlyhal (${code || error?.message || error})`); }
      }
    }
    stats.sent += sent;
    return sent;
  }

  /** Jeden prechod: stav každej sledovanej lode, prechody, upozornenia. */
  async function tick() {
    if (running || !vapid) return { skipped: true };
    const p = port();
    if (!p) return { skipped: true, reason: 'no_port' };
    running = true;
    try {
      const rows = store.followedVessels();
      const byMmsi = new Map();
      for (const r of rows) {
        const mmsi = String(r.key || '').slice(5);
        if (!/^\d{9}$/.test(mmsi)) continue;
        if (!byMmsi.has(mmsi)) byMmsi.set(mmsi, []);
        byMmsi.get(mmsi).push({ userId: r.userId, label: r.label || mmsi, mmsi });
      }
      const prevRaw = await readState();
      const prev = prevRaw ? new Map(Object.entries(prevRaw)) : null;
      const next = new Map();
      let checked = 0;
      for (const [mmsi] of byMmsi) {
        if (checked >= FOLLOW_WATCH_MAX_VESSELS) break;
        const base = `http://127.0.0.1:${p}`;
        const [live, info] = await Promise.all([getJson(`${base}/api/ais-live/contact?mmsi=${mmsi}`), getJson(`${base}/api/vessel-info?mmsi=${mmsi}`)]);
        const s = vesselFollowStatus(live?.contact || null, info);
        next.set(mmsi, { status: s.status, port: s.port, to: s.to });
        checked += 1;
      }
      // Lode, ktoré už nikto nesleduje, zo stavu vypadnú; nové dostanú stav bez hlásenia.
      const events = vesselFollowTransitions(prev, next);
      let sent = 0;
      for (const ev of events) {
        const s = next.get(ev.key);
        for (const follower of byMmsi.get(ev.key) || []) {
          sent += await send(follower.userId, vesselPushPayload(ev, follower, s, prev?.get(ev.key) || null));
        }
      }
      await writeState(Object.fromEntries(next));
      Object.assign(stats, { lastTickAt: now(), checked, events: events.length });
      return { checked, events: events.length, sent };
    } finally { running = false; }
  }

  return {
    enabled: () => Boolean(vapid),
    publicKey: () => vapid?.publicKey || null,
    send,
    tick,
    stats: () => ({ ...stats, enabled: Boolean(vapid) }),
    start() {
      if (timer || !vapid) return;
      first = setTimeout(() => { void tick().catch((e) => log(`[follow-watch] ${e?.message || e}`)); }, FOLLOW_WATCH_FIRST_MS);
      first.unref?.();
      timer = setInterval(() => { void tick().catch((e) => log(`[follow-watch] ${e?.message || e}`)); }, FOLLOW_WATCH_INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
      first = null;
      timer = null;
    },
  };
}
