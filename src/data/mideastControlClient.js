// src/data/mideastControlClient.js
/**
 * @module mideastControlClient
 * @description Klient snímok KONTROLY SÍDIEL modulu BLÍZKY VÝCHOD (etapa 2, 2026-09-26;
 * plán docs/drafts/blizky-vychod-plan.md kap. 5–6): `GET /api/mideast/events/control
 * ?module=<id>&at=YYYY-MM-DD` (src/data/mideastEventsProxy.js) a malý sklad s TTL 15 min
 * podľa dvojice modul + deň — zrkadlo `fetchUkraineControl` a `store.control()`
 * z ukraineEventsClient.js, len s modulom navyše (štyri moduly Wikipédie, každý vlastný archív).
 *
 * Chyby idú ako `Error` s `status` (404 = `no_control_snapshot`: pre deň ešte nie je snímka —
 * panel to hlási ako „zatiaľ nie je snímka", nie ako poruchu; 200 bez poľa `points` =
 * `bad_control_payload`: HTML z presmerovaného /api alebo prázdne telo nie je prázdna snímka).
 * Bez DOM a Cesia.
 */
import { dayKey } from './ukraineEvents.js';

/** Montáž proxy (rovnaká konštanta ako `MIDEAST_EVENTS_MOUNT` v mideastEventsProxy.js — ten beží len v Node). */
export const MIDEAST_EVENTS_API = '/api/mideast/events';
export const MIDEAST_CONTROL_TTL_MS = 15 * 60_000;

/**
 * Snímka kontroly modulu platná pre deň (posledná ≤ deň) z proxy.
 * @param {string} moduleId 'israel-palestine' | 'yemen' | 'syria' | 'lebanon'
 * @param {string} day YYYY-MM-DD
 * @param {{fetcher?: Function, base?: string}} [o]
 * @returns {Promise<object>} `{ day, module, revisionAt, revisions, count, summary, points, license, attribution, requestedAt, snapshots, first, last }`
 */
export async function fetchMideastControl(moduleId, day, { fetcher = (...a) => fetch(...a), base = MIDEAST_EVENTS_API } = {}) {
  const response = await fetcher(`${base}/control?module=${encodeURIComponent(moduleId)}&at=${encodeURIComponent(day)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    err.body = json;
    throw err;
  }
  // 200 bez snímky (nečitateľné telo, null, objekt bez `points`) — vrstva by inak dostala
  // setSnapshot(null) bez chyby a legenda by navždy hlásila „načítava sa".
  if (!json || !Array.isArray(json.points)) {
    const err = new Error('bad_control_payload');
    err.status = response.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Sklad snímok: kľúč `${modul}:${deň}`, TTL 15 min; snímka platná pre viac dní sa uloží aj
 * pod vlastným dňom (`payload.day`), súbežné dopyty na ten istý kľúč zdieľajú jeden sľub,
 * zlyhanie sa necachuje (ďalší pokus ide na server — 404 dnes môže byť 200 o hodinu).
 * @param {{fetchControl?: typeof fetchMideastControl, now?: () => number, ttlMs?: number, max?: number}} [o]
 */
export function createMideastControlStore({ fetchControl = fetchMideastControl, now = Date.now, ttlMs = MIDEAST_CONTROL_TTL_MS, max = 32 } = {}) {
  const cache = new Map(); // `${module}:${day}` -> { at, payload, promise }
  const evict = () => { while (cache.size > max) cache.delete(cache.keys().next().value); };

  /**
   * @param {string} moduleId
   * @param {string|number} dayOrMs YYYY-MM-DD alebo epocha ms
   */
  function control(moduleId, dayOrMs) {
    const day = typeof dayOrMs === 'string' ? dayOrMs : dayKey(dayOrMs);
    const key = `${moduleId}:${day}`;
    const hit = cache.get(key);
    if (hit?.payload && now() - hit.at < ttlMs) return Promise.resolve(hit.payload);
    if (hit?.promise) return hit.promise;
    const promise = Promise.resolve(fetchControl(moduleId, day))
      .then((payload) => {
        const at = now();
        cache.set(key, { at, payload });
        if (payload?.day && payload.day !== day) cache.set(`${moduleId}:${payload.day}`, { at, payload });
        evict();
        return payload;
      })
      .catch((error) => { cache.delete(key); throw error; });
    cache.set(key, { ...(hit || {}), promise });
    return promise;
  }

  /** Zahodí snímky modulu (bez argumentu všetky) — po zmene dňa alebo pri ručnom obnovení. */
  function clear(moduleId = null) {
    if (moduleId === null) { cache.clear(); return; }
    for (const key of [...cache.keys()]) if (key.startsWith(`${moduleId}:`)) cache.delete(key);
  }

  return { control, clear, _cache: cache };
}
