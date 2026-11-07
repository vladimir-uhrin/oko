// src/auth/server/quakeWatch.js
/**
 * Strážca otrasov citeľných na Slovensku + Web Push (2026-11-06, vlastník: „sprav"). Raz za 2 min
 * prečíta 24-hodinové katalógy USGS a EMSC z vlastných endpointov (cache /api/earthquakes, žiadne
 * ďalšie dopyty von), spojí riešenia, vyberie otrasy podľa src/data/quakeAlert.js a pošle push
 * každému zariadeniu účtov, ktoré majú sledovanie `quake:sk` (rovnaký zoznam ako lety a lode).
 *
 * Odoslané ID riešení drží v JSON súbore, aby reštart služby nič neposlal znova. Prvý prechod bez
 * uloženého stavu je len základ: súčasné otrasy označí ako známe a nič nepošle.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { mergeEarthquakeCatalogs } from '../../data/earthquakeCatalog.js';
import { LOOPBACK_HOST } from '../../admin/server/loopback.js';
import { quakeAlertCandidates, quakePushPayload, slovakiaPointsFromObce, solutionIds } from '../../data/quakeAlert.js';

export const QUAKE_WATCH_INTERVAL_MS = 2 * 60_000;
export const QUAKE_WATCH_FIRST_MS = 60_000;
/** Ako dlho si pamätať odoslané riešenie (katalóg má aj tak len 24 h). */
export const QUAKE_WATCH_MEMORY_MS = 3 * 86_400_000;

/**
 * @param {object} o
 * @param {object} o.store openAuthStore (quakeFollowers)
 * @param {(userId: number, payload: object) => Promise<number>} o.send odoslanie (pushWatch.send)
 * @param {() => boolean} [o.enabled] sú VAPID kľúče?
 * @param {() => number|null} [o.port]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {string|null} [o.stateFile]
 * @param {string|null} [o.obceFile] local_data/volby/obce-geo.json
 * @param {Array|null} [o.points] body SR (test: podvrh namiesto súboru)
 */
export function createQuakeWatch({ store, send, enabled = () => true, port = () => null, fetchImpl = globalThis.fetch,
  now = Date.now, log = () => {}, stateFile = null, obceFile = null, points = null } = {}) {
  let timer = null; let first = null; let running = false; let memoryState = null; let skPoints = points; let noData = false;
  const stats = { lastTickAt: null, events: 0, alerts: 0, sent: 0 };

  async function loadPoints() {
    if (skPoints) return skPoints;
    if (!obceFile) return [];
    try { skPoints = slovakiaPointsFromObce(JSON.parse(await fsp.readFile(obceFile, 'utf8'))); }
    catch (error) { log(`[quake-watch] obce: ${error?.message || error}`); skPoints = []; }
    return skPoints;
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
    } catch (error) { log(`[quake-watch] zápis stavu zlyhal: ${error?.message || error}`); }
  }

  async function catalog(base, source) {
    try {
      const res = await fetchImpl(`${base}/api/earthquakes/${source}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      const json = res?.ok ? await res.json() : null;
      return Array.isArray(json?.records) ? json.records : [];
    } catch { return []; }
  }

  /** Jeden prechod: katalógy, výber otrasov, upozornenia. */
  async function tick() {
    if (running || !enabled()) return { skipped: true };
    const p = port();
    if (!p) return { skipped: true, reason: 'no_port' };
    running = true;
    try {
      // `localhost`, nie 127.0.0.1: služba oko-api počúva na Windows len na IPv6 [::1] (admin/server/loopback.js;
      // 2026-11-07 prvé vydanie strážcu dostalo s 127.0.0.1 prázdne katalógy a ticho nič nerobilo).
      const base = `http://${LOOPBACK_HOST}:${p}`;
      const [usgs, emsc] = await Promise.all([catalog(base, 'usgs'), catalog(base, 'emsc')]);
      if (!usgs.length && !emsc.length) {
        // Jeden riadok pri prechode na „bez dát" — tichý výpadok (napr. zlá spätná adresa) sa inak nedá odhaliť.
        if (!noData) log(`[quake-watch] katalógy USGS ani EMSC na ${base} nič nevrátili — upozornenia stoja`);
        noData = true;
        return { skipped: true, reason: 'no_data' };
      }
      if (noData) log('[quake-watch] katalógy sú späť');
      noData = false;
      const events = mergeEarthquakeCatalogs([...usgs, ...emsc]);
      const t = now();
      const prev = await readState();
      const notified = new Map(Object.entries(prev?.notified || {}));
      if (!prev) {
        // Základ: všetko, čo už v katalógu je, sa považuje za známe.
        for (const event of events) for (const id of solutionIds(event)) notified.set(id, t);
        await writeState({ notified: Object.fromEntries(notified), baselineAt: t });
        Object.assign(stats, { lastTickAt: t, events: events.length, alerts: 0 });
        return { baseline: true, events: events.length };
      }
      const candidates = quakeAlertCandidates(events, { points: await loadPoints(), now: t, notified: new Set(notified.keys()) });
      const followers = candidates.length ? store.quakeFollowers() : [];
      let sent = 0;
      for (const { event, reach } of candidates) {
        const payload = quakePushPayload(event, reach, t);
        for (const userId of followers) sent += await send(userId, payload);
        for (const id of solutionIds(event)) notified.set(id, t);
        log(`[quake-watch] ${payload.title} · ${Math.round(reach.distanceKm)} km od obce SR · dosah ~${Math.round(reach.feltKm)} km · ${followers.length} odberateľov`);
      }
      // Ďalšie riešenia už nahláseného otrasu (napr. USGS po EMSC) sa označia tiež.
      for (const event of events) {
        const ids = solutionIds(event);
        if (ids.some(id => notified.has(id))) for (const id of ids) if (!notified.has(id)) notified.set(id, t);
      }
      for (const [id, at] of notified) if (t - at > QUAKE_WATCH_MEMORY_MS) notified.delete(id);
      await writeState({ notified: Object.fromEntries(notified), baselineAt: prev.baselineAt ?? t });
      Object.assign(stats, { lastTickAt: t, events: events.length, alerts: stats.alerts + candidates.length, sent: stats.sent + sent });
      return { events: events.length, alerts: candidates.length, sent };
    } finally { running = false; }
  }

  return {
    tick,
    stats: () => ({ ...stats }),
    start() {
      if (timer || !enabled()) return;
      first = setTimeout(() => { void tick().catch((e) => log(`[quake-watch] ${e?.message || e}`)); }, QUAKE_WATCH_FIRST_MS);
      first.unref?.();
      timer = setInterval(() => { void tick().catch((e) => log(`[quake-watch] ${e?.message || e}`)); }, QUAKE_WATCH_INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
      first = null; timer = null;
    },
  };
}
