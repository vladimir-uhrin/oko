// src/data/shipServer/index.js
/**
 * @module shipServer
 * @description Lodná časť servera na jednom mieste (2026-10-11, bod 8 „údržba": vite.config.js
 * mal vyše 12 000 riadkov a všetky lodné zdroje, strážcu aj históriu sme pridávali doň). Skladá:
 *  - históriu lodí a DMA (history.js),
 *  - zdroje navyše OpenSeaFeed / Open Waters / oceán (supplements.js),
 *  - zdravie zdrojov pre admin (/api/ais-live/health → 503 = stíchlo),
 *  - trasy /contact, /health, /history pod /api/ais-live.
 * Úložisko živých lodí (AISStream) ostáva vo vite.config.js; sem prichádza injekciou.
 */
import { SHIP_HISTORY_MAX_DAYS, thinShipSamples } from '../shipHistoryStore.js';
import { createShipHistoryService } from './history.js';
import { createAisSupplements } from './supplements.js';
import { inboundToPort } from './portInbound.js';

/** Hranice ticha zdrojov (ms): keď od posledných dát uplynie viac, zdroj je „stale". */
export const AIS_HEALTH_LIMITS = Object.freeze({ aisstream: 10 * 60_000, openseafeed: 15 * 60_000, aiscast: 5 * 60_000, ocean: 15 * 60_000, dma: 5 * 86_400_000 });
/** Po štarte služby dostanú zdroje navyše čas na prvé dáta. */
export const AIS_HEALTH_GRACE_MS = 10 * 60_000;

/**
 * Zdravie zdrojov lodí. Pure.
 * @param {object} o
 * @param {{lastMessageAt?: number|null, status?: string, error?: string|null}} o.feed AISStream
 * @param {object|null} o.supplements štatistiky zdrojov navyše (null = nebežia)
 * @param {boolean} o.oceanActive
 * @param {{active: boolean, lastDoneAt: number|null}} o.dma
 * @param {object|null} o.history štatistika histórie
 * @param {number} o.retained
 * @param {number} o.nowMs
 * @param {number} o.uptimeMs
 */
export function aisLiveHealth({ feed, supplements, oceanActive, dma, history, retained, nowMs, uptimeMs }) {
  const checks = {};
  const check = (id, at, limit, extra = {}) => {
    const age = Number.isFinite(at) && at > 0 ? nowMs - at : null;
    const grace = age === null && uptimeMs < AIS_HEALTH_GRACE_MS;
    checks[id] = { ok: grace || (age !== null && age <= limit), ageMinutes: age === null ? null : Math.round(age / 60_000), limitMinutes: Math.round(limit / 60_000), ...extra };
  };
  check('aisstream', feed?.lastMessageAt, AIS_HEALTH_LIMITS.aisstream, { status: feed?.status || null, error: feed?.error || null });
  if (supplements) {
    for (const id of ['openseafeed', 'aiscast', 'ocean']) {
      if (id === 'ocean' && !oceanActive) continue;
      const st = supplements[id];
      check(id, st.at, AIS_HEALTH_LIMITS[id], { rows: st.rows, merged: st.merged, error: st.error || null, ...(id === 'ocean' ? { unresolved: st.unresolved } : {}) });
    }
  }
  if (dma?.active) check('dma', dma.lastDoneAt, AIS_HEALTH_LIMITS.dma);
  if (history) checks.shipHistory = { ok: true, ...history };
  const ok = Object.values(checks).every((c) => c.ok !== false);
  return { ok, status: ok ? 'live' : 'stale', checks, retained, checkedAt: nowMs };
}

/** Riadok úložiska → kontakt pre strážcu sledovaných lodí; starý = null. Pure. */
export function contactFromRow(row, nowMs, staleMs) {
  const fresh = row && Number.isFinite(row.last_position_epoch) && nowMs - row.last_position_epoch * 1000 < staleMs;
  if (!fresh) return null;
  return { lat: row.lat, lon: row.lon, sog: row.speed ?? null, navStatus: row.nav_status ?? null, lastPositionEpoch: row.last_position_epoch, feed: row.feed || 'aisstream', name: row.name || null };
}

/**
 * @param {object} o
 * @param {string} o.rootDir
 * @param {object} [o.env]
 * @param {Map<string, object>} o.vessels
 * @param {Map<string, object>} o.tracks
 * @param {Function} o.appendTrack
 * @param {number} o.cacheMax
 * @param {number} o.staleMs
 * @param {() => object} o.feedStatus snímka stavu AISStream
 * @param {() => boolean} o.persistEnabled AIS_STATE_PERSIST ≠ off (služba)
 * @param {Function} o.createDiskGuard
 */
export function createShipServer({ rootDir, env = process.env, vessels, tracks, appendTrack, cacheMax, staleMs, feedStatus, persistEnabled, createDiskGuard, log = console, now = Date.now }) {
  const history = createShipHistoryService({ rootDir, env, createDiskGuard, log });
  const supplements = createAisSupplements({ rootDir, env, vessels, tracks, appendTrack, record: (...a) => history.record(...a), cacheMax, now });
  const recording = () => persistEnabled() && String(env.SHIP_HISTORY || '').toLowerCase() !== 'off';

  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  function health(nowMs = now()) {
    return aisLiveHealth({
      feed: feedStatus(),
      supplements: supplements.stats(),
      oceanActive: supplements.oceanActive(),
      dma: { active: history.dmaActive(), lastDoneAt: history.dmaActive() ? history.dmaLastDoneAt() : null },
      history: history.statsOrNull(),
      retained: vessels.size,
      nowMs,
      uptimeMs: process.uptime() * 1000,
    });
  }

  /**
   * Trasy pod /api/ais-live: /contact, /health, /history. Vráti true, keď požiadavku vybavil.
   * Návštevníka (nie loopback, nie /health) si zapamätá pre takt zdrojov navyše.
   */
  async function handleRoute(req, res, incoming) {
    const p = incoming.pathname;
    if (p !== '/health') supplements.markVisitor(req);
    if (p === '/contact') {
      const mmsi = String(incoming.searchParams.get('mmsi') || '').trim();
      if (!/^\d{9}$/.test(mmsi)) { json(res, 400, { error: 'bad_mmsi' }); return true; }
      json(res, 200, { mmsi, contact: contactFromRow(vessels.get(mmsi), now(), staleMs) });
      return true;
    }
    if (p === '/health') {
      const h = health();
      json(res, h.ok ? 200 : 503, h);
      return true;
    }
    // Lode na ceste do prístavu (2026-10-11): /inbound?locode=&name=&lat=&lon= — cieľ z AIS vs. prístav.
    if (p === '/inbound') {
      const lat = Number(incoming.searchParams.get('lat'));
      const lon = Number(incoming.searchParams.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { json(res, 400, { error: 'bad_port' }); return true; }
      const port = { lat, lon, locode: String(incoming.searchParams.get('locode') || '').slice(0, 8), name: String(incoming.searchParams.get('name') || '').slice(0, 80) };
      const out = inboundToPort(vessels.values(), port, { nowMs: now(), staleMs });
      res.setHeader('Cache-Control', 'public, max-age=60');
      json(res, 200, { port: { locode: port.locode || null, name: port.name || null }, ...out, source: 'AIS destination text (crew-entered) · ETA from current speed (estimate)' });
      return true;
    }
    if (p === '/history') {
      const mmsi = String(incoming.searchParams.get('mmsi') || '').trim();
      if (!/^\d{9}$/.test(mmsi)) { json(res, 400, { error: 'bad_mmsi', samples: [] }); return true; }
      const days = Math.max(1, Math.min(SHIP_HISTORY_MAX_DAYS, Math.floor(Number(incoming.searchParams.get('days'))) || 7));
      const to = Math.floor(now() / 1000);
      const from = to - days * 86400;
      const all = await history.history().read(mmsi, from, to);
      json(res, 200, { mmsi, days, from, to, total: all.length, first: all[0]?.t ?? null, samples: thinShipSamples(all, 3000), source: 'OKO ship history (AISStream, stored on disk)' });
      return true;
    }
    return false;
  }

  return {
    history,
    supplements,
    recording,
    /** Spustí zápis histórie, DMA a zdroje navyše — len v službe. */
    start() {
      if (!recording()) return false;
      history.startFlush();
      history.startDma();
      supplements.start();
      return true;
    },
    /** Poloha z AISStream do histórie (len keď zápis beží). */
    recordPosition: (...a) => history.record(...a),
    wantResolve: (id) => supplements.wantResolve(id),
    supplementStats: () => supplements.stats(),
    health,
    handleRoute,
    stop() { history.stop(); supplements.stop(); },
  };
}
