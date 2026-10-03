/**
 * @file Request-origin and spend guards for the Vite dev-server proxies.
 *
 * OKO is published through cloudflared → the dev server on localhost:4173
 * (scripts/oko-publish.ps1), so EVERY request — local or from the internet —
 * arrives on a loopback socket. The socket address alone therefore tells us
 * neither who the visitor is (all of them would share one rate-limit bucket)
 * nor whether the request is genuinely local (loopback-only features would be
 * open to the world). This module answers both questions the same way the
 * account backend does (src/auth/server/http.js `context()`):
 *
 *   - client IP: `CF-Connecting-IP`, honoured ONLY when
 *     AUTH_TRUST_CLOUDFLARE_PROXY=true AND the socket is loopback (i.e. the
 *     header can only have come from the local cloudflared), else the socket.
 *   - genuine local: loopback socket AND no Cloudflare header
 *     (`CF-Connecting-IP` / `CF-Ray`). Cloudflare's edge always sets both, a
 *     tunnel visitor cannot strip them, so their presence means "internet".
 *     This holds regardless of the trust flag — failing closed.
 *
 * It also holds the persistent daily budget counter used for the OpenAI cost
 * endpoints (same shape as the TomTom/GFW governors: `{date, count}` keyed by
 * UTC day in a JSON file under .gev-cache/).
 *
 * Node-only (node:net, node:fs) and Cesium-free, so node:test covers it.
 *
 * @module serverGuards
 */
import { isIP } from 'node:net';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

/** Loopback test for a socket address (IPv4 127/8, ::1, IPv4-mapped). */
export function isLoopbackAddress(address) {
  const a = String(address || '').trim().toLowerCase();
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.') || a.startsWith('::ffff:127.');
}

function header(req, name) {
  const value = req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/** True when the request came through Cloudflare (carries CF-Connecting-IP or CF-Ray). */
export function isTunnelRequest(req) {
  return Boolean(header(req, 'cf-connecting-ip') || header(req, 'cf-ray'));
}

/**
 * True only for a request from this machine that did NOT come through the
 * tunnel — the gate for loopback-only features (ACARS, the Realtime debug log).
 */
export function isGenuineLocalRequest(req) {
  return isLoopbackAddress(req?.socket?.remoteAddress) && !isTunnelRequest(req);
}

/** Whether CF-Connecting-IP may be trusted (same switch as the account backend). */
export function trustCloudflareProxy(env = process.env) {
  return env.AUTH_TRUST_CLOUDFLARE_PROXY === 'true';
}

/**
 * Client IP for per-visitor rate limiting. X-Forwarded-For is never trusted
 * (client-controlled). CF-Connecting-IP is used only with the trust switch on,
 * from a loopback socket, and when it parses as an IP.
 *
 * @param {import('http').IncomingMessage} req
 * @param {{trustCloudflare?: boolean}} [options]
 * @returns {string}
 */
export function resolveClientIp(req, { trustCloudflare = trustCloudflareProxy() } = {}) {
  const socketIp = String(req?.socket?.remoteAddress || 'local');
  if (!trustCloudflare || !isLoopbackAddress(socketIp)) return socketIp;
  const cf = String(header(req, 'cf-connecting-ip') || '').trim();
  return isIP(cf) ? cf : socketIp;
}

/** Positive integer from an env value, else the fallback. */
export function positiveIntEnv(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** UTC day key `YYYY-MM-DD`. */
export function utcDayKey(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Persistent daily budget counter (one JSON file, reset on UTC day change).
 * `tryConsume()` reserves one unit and reports whether it fit under the cap;
 * over the cap nothing is counted, so a rejected request never spends.
 *
 * @param {{filePath:string, limit:()=>number, now?:()=>number, label?:string}} options
 */
export function createDailyBudget({ filePath, limit, now = Date.now, label = 'budget' }) {
  /** @type {{date:string, count:number}|null} */
  let state = null;
  /** @type {Promise<void>|null} */
  let loading = null;

  function load() {
    if (!loading) {
      loading = fsp.readFile(filePath, 'utf8').then((raw) => {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.date === 'string' && Number.isFinite(parsed.count) && parsed.count >= 0) {
          state = { date: parsed.date, count: Math.floor(parsed.count) };
        }
      }).catch(() => { /* no file yet / unreadable → start at zero */ });
    }
    return loading;
  }

  function current() {
    const today = utcDayKey(now());
    if (!state || state.date !== today) state = { date: today, count: 0 };
    return state;
  }

  /** Writes are chained so two bursts never interleave on the same file. */
  let writing = Promise.resolve();
  function persist() {
    writing = writing.then(async () => {
      try {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, JSON.stringify(state), 'utf8');
      } catch (err) {
        console.warn(`[${label}] budget write failed:`, err?.message || err);
      }
    });
    return writing;
  }

  return {
    /** @returns {Promise<{ok:boolean, count:number, limit:number, date:string}>} */
    async tryConsume() {
      await load();
      const b = current();
      const cap = limit();
      if (b.count >= cap) return { ok: false, count: b.count, limit: cap, date: b.date };
      b.count += 1;
      void persist();
      return { ok: true, count: b.count, limit: cap, date: b.date };
    },
    /** Resolves once every pending write has landed (tests, shutdown). */
    flush() { return writing; },
    /** @returns {Promise<{count:number, limit:number, date:string}>} */
    async snapshot() {
      await load();
      const b = current();
      return { count: b.count, limit: limit(), date: b.date };
    },
  };
}

/**
 * Whether appending `addBytes` to a file currently `currentBytes` long would
 * push it past `capBytes` (the Realtime debug-log disk cap).
 */
export function exceedsFileCap(currentBytes, addBytes, capBytes) {
  return (Math.max(0, Number(currentBytes) || 0) + Math.max(0, Number(addBytes) || 0)) > capBytes;
}
