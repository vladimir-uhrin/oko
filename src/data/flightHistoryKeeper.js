// src/data/flightHistoryKeeper.js — nepretržitý záznam histórie letov (2026-09-30).
//
// Používateľ: „chcem čo najviac informácií ukladať a nezáleží na veľkosti. Miesta mám dosť!"
// Záznam bol dovtedy len pasívny obal nad odpoveďami /api/opensky a /api/adsblol/mil
// (vite.config.js, flightHistoryProxy): keď nikto nemal otvorenú mapu, nezapísalo sa nič
// (25. 9. celý deň prázdny, 30. 9. o 10:00 jediný fix). Strážca si v tichu pýta tie isté
// LOKÁLNE adresy sám — dopyt prejde celou cestou proxy (cache, kreditový governor, zápis),
// takže nevzniká nový zdroj ani druhá kópia logiky.
//
// Kvóta OpenSky (dokumentácia REST API, overené 2026-09-30): Standard 4 000 kreditov denne,
// celosvetový /states/all = 4 kredity → najviac ~1 000 snímkov za deň. Strážca beží, len keď
// nikto nepozerá (návštevníci si snímky ťahajú sami a zapisujú sa rovnako), a pod
// KEEPER_RESERVE_CREDITS nechá kredity živej mape návštevníkov.

import fs from 'node:fs';

/** Ako často sa strážca rozhoduje (nie ako často sťahuje). */
export const KEEPER_TICK_MS = 15_000;
/** Návštevník sa pýtal takto nedávno → jeho dopyty zapisujú, strážca čaká. */
export const KEEPER_CLIENT_IDLE_MS = 2 * 60_000;
/** Kredity OpenSky, ktoré strážca nechá návštevníkom (≈ 300 celosvetových snímkov). */
export const KEEPER_RESERVE_CREDITS = 1200;
/** Pod rezervou už len sonda: zistí obnovu kreditov a drží aspoň hrubú stopu. */
export const KEEPER_PROBE_MS = 30 * 60_000;
/** adsb.lol /v2/mil nemá kredity; jeden dopyt za minútu (proxy aj tak drží 12 s cache). */
export const KEEPER_MIL_INTERVAL_MS = 60_000;
export const KEEPER_REQUEST_TIMEOUT_MS = 60_000;
/** Najdlhší odstup pri opakovaných chybách (zdvojovanie intervalu). */
export const KEEPER_MAX_BACKOFF_MS = 30 * 60_000;
/** Hlavička vlastných dopytov strážcu (návštevník to nie je). */
export const KEEPER_HEADER = 'x-oko-history-keeper';
/** Pod týmto voľným miestom sa história nezapisuje (plný disk by zložil aj cache na D:). */
export const HISTORY_MIN_FREE_BYTES = 25 * 1024 ** 3;

/**
 * Odstup celosvetových snímkov OpenSky podľa zostatku kreditov. Pure.
 * >2400: 90 s (~160 kreditov/h), >rezerva: 120 s (~120/h), inak sonda raz za 30 min.
 * Bez známeho zostatku 90 s — prvá odpoveď ho prinesie v X-Rate-Limit-Remaining.
 * @param {number|null|undefined} remainingCredits
 */
export function keeperOpenSkyIntervalMs(remainingCredits) {
  if (remainingCredits === null || remainingCredits === undefined || !Number.isFinite(Number(remainingCredits))) return 90_000;
  const remaining = Number(remainingCredits);
  if (remaining > 2400) return 90_000;
  if (remaining > KEEPER_RESERVE_CREDITS) return 120_000;
  return KEEPER_PROBE_MS;
}

/**
 * Má strážca teraz sťahovať? Pure.
 * @returns {'poll'|'blocked'|'clients'|'wait'}
 */
export function keeperDecision({ nowMs, lastClientMs = 0, lastPollMs = 0, intervalMs, blockedUntilMs = 0 }) {
  if (nowMs < blockedUntilMs) return 'blocked';
  if (nowMs - lastClientMs < KEEPER_CLIENT_IDLE_MS) return 'clients';
  if (nowMs - lastPollMs < intervalMs) return 'wait';
  return 'poll';
}

/** Interval so zdvojovaním po chybách (1, 2, 4… ×), strop KEEPER_MAX_BACKOFF_MS. Pure. */
export function keeperBackoffMs(intervalMs, errorStreak) {
  if (!errorStreak) return intervalMs;
  return Math.max(intervalMs, Math.min(KEEPER_MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(errorStreak, 10)));
}

/**
 * Poistka voľného miesta: pýta sa disku najviac raz za `checkEveryMs`.
 * @param {{dir: string, minFreeBytes?: number, checkEveryMs?: number, statfs?: Function, now?: () => number}} options
 */
export function createDiskGuard({
  dir,
  minFreeBytes = HISTORY_MIN_FREE_BYTES,
  checkEveryMs = 60_000,
  statfs = fs.statfsSync,
  now = Date.now,
}) {
  let checkedAt = -Infinity;
  let freeBytes = null;
  let ok = true;
  function refresh() {
    const t = now();
    if (t - checkedAt < checkEveryMs) return;
    checkedAt = t;
    try {
      const st = statfs(dir);
      freeBytes = Number(st.bavail) * Number(st.bsize);
      ok = !Number.isFinite(freeBytes) || freeBytes >= minFreeBytes;
    } catch {
      // Neznámy stav disku históriu nezastaví (chyba zápisu sa aj tak zaloguje).
      freeBytes = null;
      ok = true;
    }
  }
  return {
    ok() { refresh(); return ok; },
    status() { refresh(); return { ok, freeBytes, minFreeBytes }; },
  };
}

/**
 * Strážca: periodicky sa pýta lokálneho servera na zdroje histórie, keď to
 * nerobí nikto iný.
 * @param {object} options
 * @param {Array<{id: string, path: string, intervalMs: () => number, blockedUntilMs?: () => number}>} options.streams
 * @param {() => number|null} [options.openSkyCredits] zostatok kreditov (na zápis obnovy do stavu)
 * @param {() => boolean} [options.canRecord] napr. poistka disku
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {number} [options.tickMs]
 * @param {(msg: string) => void} [options.log]
 */
export function createHistoryKeeper({
  streams,
  openSkyCredits = () => null,
  canRecord = () => true,
  fetchImpl = fetch,
  now = Date.now,
  tickMs = KEEPER_TICK_MS,
  log = (msg) => console.log(msg),
}) {
  const state = new Map(streams.map((s) => [s.id, {
    lastClientMs: 0, lastPollMs: 0, inFlight: false, polls: 0, errors: 0, errorStreak: 0,
    lastStatus: null, lastCache: null, lastDecision: null, lastErrorLogMs: -Infinity,
  }]));
  let baseUrl = null;
  let timer = null;
  let lastCredits = null;
  let lastRefillAt = null;
  let diskPausedLogged = false;

  async function poll(stream, st) {
    st.inFlight = true;
    st.lastPollMs = now();
    try {
      const res = await fetchImpl(`${baseUrl}${stream.path}`, {
        headers: { [KEEPER_HEADER]: '1' },
        signal: AbortSignal.timeout(KEEPER_REQUEST_TIMEOUT_MS),
      });
      await res.arrayBuffer(); // dočítať — zápis robí obal odpovede na strane servera
      st.lastStatus = res.status;
      st.lastCache = res.headers.get('x-opensky-cache') || res.headers.get('x-ads-b-cache') || null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (st.polls === 0) log(`[history-keeper] ${stream.id}: záznam beží aj bez návštevníkov`);
      st.polls += 1;
      st.errorStreak = 0;
    } catch (error) {
      st.errors += 1;
      st.errorStreak += 1;
      const t = now();
      if (t - st.lastErrorLogMs > 10 * 60_000) {
        st.lastErrorLogMs = t;
        log(`[history-keeper] ${stream.id}: ${error?.message || error} (pokus ${st.errorStreak}, ďalší o ${Math.round(keeperBackoffMs(stream.intervalMs(), st.errorStreak) / 1000)} s)`);
      }
    } finally {
      st.inFlight = false;
    }
  }

  function tick() {
    if (!baseUrl) return [];
    const credits = openSkyCredits();
    if (Number.isFinite(credits)) {
      // Skok nahor = denná obnova kreditov (čas obnovy dokumentácia neuvádza — zapíše sa sem).
      if (Number.isFinite(lastCredits) && credits - lastCredits > 1000) {
        lastRefillAt = now();
        log(`[history-keeper] kredity OpenSky obnovené: ${lastCredits} → ${credits} (${new Date(lastRefillAt).toISOString()})`);
      }
      lastCredits = credits;
    }
    if (!canRecord()) {
      if (!diskPausedLogged) log('[history-keeper] pauza: málo voľného miesta pre históriu letov');
      diskPausedLogged = true;
      return [];
    }
    diskPausedLogged = false;
    const started = [];
    const t = now();
    for (const stream of streams) {
      const st = state.get(stream.id);
      if (st.inFlight) continue;
      const decision = keeperDecision({
        nowMs: t,
        lastClientMs: st.lastClientMs,
        lastPollMs: st.lastPollMs,
        intervalMs: keeperBackoffMs(stream.intervalMs(), st.errorStreak),
        blockedUntilMs: stream.blockedUntilMs?.() ?? 0,
      });
      st.lastDecision = decision;
      if (decision === 'poll') started.push(poll(stream, st));
    }
    return started;
  }

  /** Spusti proti základnej adrese servera (napr. http://127.0.0.1:4173). */
  function start(url) {
    baseUrl = String(url).replace(/\/+$/, '');
    if (timer) return;
    timer = setInterval(() => { tick(); }, tickMs);
    timer.unref?.();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    baseUrl = null;
  }

  return {
    start,
    stop,
    /** Návštevník sa práve pýtal na zdroj `id` — jeho dopyty zapisujú, strážca počká. */
    noteClient(id) {
      const st = state.get(id);
      if (st) st.lastClientMs = now();
    },
    /** Jeden rozhodovací krok (testy); vráti Promise spustených dopytov. */
    tick,
    /**
     * Pripoj k http serveru: štart po 'listening' na jeho skutočnej adrese,
     * stop pri 'close' (reštart Vite vytvorí nový plugin aj strážcu).
     */
    attach(httpServer) {
      if (!httpServer) return;
      const onListening = () => {
        const addr = httpServer.address();
        if (!addr || typeof addr !== 'object') return;
        const host = addr.address === '::' || addr.address === '0.0.0.0'
          ? '127.0.0.1'
          : (addr.address.includes(':') ? `[${addr.address}]` : addr.address);
        start(`http://${host}:${addr.port}`);
      };
      if (httpServer.listening) onListening(); else httpServer.once('listening', onListening);
      httpServer.once('close', stop);
    },
    status() {
      const out = { running: Boolean(timer && baseUrl), openSkyCredits: lastCredits, lastRefillAt, streams: {} };
      for (const stream of streams) {
        const st = state.get(stream.id);
        out.streams[stream.id] = {
          polls: st.polls,
          errors: st.errors,
          lastPollAt: st.lastPollMs || null,
          lastStatus: st.lastStatus,
          lastCache: st.lastCache,
          decision: st.lastDecision,
          intervalMs: keeperBackoffMs(stream.intervalMs(), st.errorStreak),
          lastClientAt: st.lastClientMs || null,
        };
      }
      return out;
    },
  };
}
