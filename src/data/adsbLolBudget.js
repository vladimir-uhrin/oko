// src/data/adsbLolBudget.js — denný rozpočet pre api.adsb.lol (2026-10-23, vlastník: „oprav všetko").
//
// PREČO: adsb.lol vracia v hlavičkách `x-ratelimit-limit: 500, 4;w=1, 60;w=60, 500;w=86400` — 4 za sekundu,
// 60 za minútu a **500 za deň na jednu IP**. OKO z tej istej IP volá adsb.lol zo štyroch miest (vojenské lety,
// hľadanie lietadla, štátne lietadlá, regionálna záloha OpenSky) a pred touto opravou minulo denný strop
// každé ráno; proxy potom vracalo prázdne 429 do polnoci UTC (audit prvej návštevy 2026-10-23).
//
// AKO: jeden spoločný rozpočet v procese servera. Každá odpoveď adsb.lol sem nahlási stav a hlavičky; po 429
// alebo pri zostatku 0 sa drží pauza do resetu dňa. Druhy dopytov majú prednosť: hľadanie lietadla smie
// míňať až do nuly, štátne lietadlá si nechávajú malú rezervu, hromadné dopyty (záloha vojenských letov,
// regionálna záloha OpenSky) prestanú pri väčšej rezerve — a každý druh má najmenší odstup, aby sa deň
// neminul do obeda. Čistý modul: čas, register aj hlavičky sú vstupy (testy). Jediná inštancia procesu cez
// globalThis (config Vite aj služby ju zdieľajú) ako upstreamStatus.js.
import { upstream as upstreamRegistry } from './upstreamStatus.js';

/** Denný strop adsb.lol na IP (z hlavičky `500;w=86400`). */
export const ADSBLOL_DAILY_LIMIT = 500;
/** Pauza po 429 bez čitateľnej hlavičky resetu: minúta, pri opakovaní zdvojená až po strop hodiny. */
export const ADSBLOL_BLIND_PAUSE_MS = 60_000;
export const ADSBLOL_FALLBACK_PAUSE_MS = 60 * 60_000;
/** Hlavička resetu kratšia než toto patrí sekundovému/minútovému oknu, nie dňu. */
export const ADSBLOL_DAY_WINDOW_MIN_S = 120;
/**
 * Prednosť druhov: koľko zostatku si druh musí nechať ostatným (0 = smie minúť všetko) a najmenší odstup
 * medzi dvoma dopytmi toho istého druhu (štátne lietadlá = ich 60 s cache; rezerva 30 ich zastaví skôr, než
 * vyjedia hľadanie). Hľadanie má vlastnú frontu (1,1 s), odstup tu netreba.
 */
export const ADSBLOL_KINDS = Object.freeze({
  search: Object.freeze({ reserve: 0, minGapMs: 0 }),
  // Typ a registrácia na karte lietadla (adsbLolTypeFallback.js) — vlastná fronta 1,1 s, len malá rezerva.
  type: Object.freeze({ reserve: 10, minGapMs: 0 }),
  state: Object.freeze({ reserve: 30, minGapMs: 60_000 }),
  regional: Object.freeze({ reserve: 60, minGapMs: 30_000 }),
  mil: Object.freeze({ reserve: 60, minGapMs: 300_000 }),
  // Záloha zberača rušenia GPS (mideastArchive.mjs gpsCollect) — hlavný zdroj je adsb.fi; 6 kruhov naraz, preto bez
  // odstupu, ale s najväčšou rezervou (2026-10-30: zber bol 576 dopytov denne, sám nad denným stropom).
  gps: Object.freeze({ reserve: 100, minGapMs: 0 }),
});

const DAY_MS = 86_400_000;

/** Čítanie hlavičky z Headers aj z obyčajného objektu (pure). */
function headerOf(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : null;
}

/**
 * Hlavičky limitu adsb.lol (envoy, návrh IETF RateLimit) → čísla (pure).
 * `x-ratelimit-remaining`/`x-ratelimit-reset` patria oknu, ktoré je najbližšie k vyčerpaniu — denné okno
 * spoznáme podľa resetu dlhšieho než ADSBLOL_DAY_WINDOW_MIN_S.
 * @param {Headers|object|null} headers
 * @param {number} nowMs
 * @returns {{ remaining: number|null, resetS: number|null, resetAtMs: number|null, dayWindow: boolean, dailyLimit: number|null }}
 */
export function parseAdsbLolRateLimit(headers, nowMs = Date.now()) {
  const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  const remainingHeader = headerOf(headers, 'x-ratelimit-remaining');
  const resetHeader = headerOf(headers, 'x-ratelimit-reset');
  const remainingRaw = present(remainingHeader) ? Number(remainingHeader) : Number.NaN;
  const resetRaw = present(resetHeader) ? Number(resetHeader) : Number.NaN;
  const limitRaw = String(headerOf(headers, 'x-ratelimit-limit') ?? '');
  const remaining = Number.isFinite(remainingRaw) && remainingRaw >= 0 ? Math.floor(remainingRaw) : null;
  const resetS = Number.isFinite(resetRaw) && resetRaw >= 0 ? Math.ceil(resetRaw) : null;
  const dayMatch = limitRaw.match(/(\d+);w=86400/);
  const dailyLimit = dayMatch ? Number(dayMatch[1]) : null;
  return {
    remaining,
    resetS,
    resetAtMs: resetS === null ? null : nowMs + resetS * 1000,
    dayWindow: resetS !== null && resetS > ADSBLOL_DAY_WINDOW_MIN_S,
    dailyLimit,
  };
}

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {{ record: Function }} [options.registry] spoločný register zdrojov (admin)
 * @param {object} [options.kinds] prednosti druhov (testy)
 */
export function createAdsbLolBudget({ now = Date.now, registry = upstreamRegistry, kinds = ADSBLOL_KINDS } = {}) {
  /** Posledný známy zostatok DENNÉHO okna (null = nevieme, prvá odpoveď ho prinesie). */
  let remaining = null;
  let remainingAtMs = 0;
  /** Reset denného okna (ms), ak ho poznáme. */
  let resetAtMs = null;
  let pausedUntilMs = 0;
  /** Po sebe idúce 429 bez hlavičky resetu (pauza sa zdvojuje). */
  let blindStreak = 0;
  let lastStatus = null;
  let lastAtMs = 0;
  const lastSpentMs = new Map();
  let spentDay = -1;
  const spent = new Map();

  const dayOf = (t) => Math.floor(t / DAY_MS);
  const rollDay = (t) => {
    const d = dayOf(t);
    if (d !== spentDay) { spentDay = d; spent.clear(); }
  };
  const knownRemaining = (t) => {
    // Po resete denného okna je starý zostatok neplatný — nový povie prvá odpoveď.
    if (remaining !== null && resetAtMs !== null && t >= resetAtMs) { remaining = null; resetAtMs = null; }
    return remaining;
  };

  return {
    /**
     * Smie druh `kind` teraz zavolať adsb.lol? (pure voči sieti; nič nemíňa)
     * @param {'search'|'state'|'regional'|'mil'} kind
     */
    allow(kind) {
      const rule = kinds[kind] || kinds.mil;
      const t = now();
      if (t < pausedUntilMs) return false;
      const gap = t - (lastSpentMs.get(kind) ?? -Infinity);
      if (gap < rule.minGapMs) return false;
      const left = knownRemaining(t);
      if (left !== null && left <= rule.reserve) return false;
      return true;
    },

    /** Pred odoslaním dopytu — odstup druhu a odhad zostatku (odpoveď ho upresní). */
    spend(kind) {
      const t = now();
      rollDay(t);
      lastSpentMs.set(kind, t);
      spent.set(kind, (spent.get(kind) || 0) + 1);
      if (remaining !== null && remaining > 0) remaining -= 1;
    },

    /**
     * Výsledok dopytu: hlavičky limitu, 429 → pauza do resetu dňa (bez hlavičky 60 min), chyba siete.
     * @param {'search'|'state'|'regional'|'mil'} kind
     * @param {{ status?: number, headers?: Headers|object|null, error?: boolean }} result
     */
    record(kind, { status = 0, headers = null, error = false } = {}) {
      const t = now();
      lastAtMs = t;
      lastStatus = error ? 0 : status;
      if (!error && status !== 429) blindStreak = 0;
      const limit = parseAdsbLolRateLimit(headers, t);
      if (limit.dayWindow && limit.remaining !== null) {
        remaining = limit.remaining;
        remainingAtMs = t;
        resetAtMs = limit.resetAtMs;
      }
      let pauseMs = 0;
      if (status === 429) {
        // 429 v sekundovom/minútovom okne = krátka pauza; denné okno = do resetu; bez hlavičiek (neznáme) minúta,
        // pri opakovaní zdvojená až po hodinu — zostatok dňa sa naslepo nenuluje.
        let until;
        if (limit.resetAtMs !== null) { until = limit.resetAtMs; blindStreak = 0; }
        else { until = t + Math.min(ADSBLOL_FALLBACK_PAUSE_MS, ADSBLOL_BLIND_PAUSE_MS * 2 ** blindStreak); blindStreak = Math.min(blindStreak + 1, 10); }
        pausedUntilMs = Math.max(pausedUntilMs, until);
        pauseMs = Math.max(0, pausedUntilMs - t);
        if (limit.dayWindow) { remaining = 0; remainingAtMs = t; resetAtMs = limit.resetAtMs; }
      } else if (remaining === 0 && resetAtMs !== null && t < resetAtMs) {
        pausedUntilMs = Math.max(pausedUntilMs, resetAtMs);
      }
      try { registry?.record?.('adsb.lol', { status: error ? 0 : status, error, pauseMs }); } catch { /* register nesmie zhodiť dopyt */ }
      void kind;
    },

    /** Je adsb.lol v pauze (429 alebo deň minutý)? */
    paused() { return now() < pausedUntilMs; },
    pausedUntil() { return pausedUntilMs; },

    /** Stav pre /api/history/status a admin. */
    status() {
      const t = now();
      rollDay(t);
      return {
        remaining: knownRemaining(t),
        remainingAt: remainingAtMs || null,
        resetAt: resetAtMs,
        paused: t < pausedUntilMs,
        pausedUntil: t < pausedUntilMs ? pausedUntilMs : null,
        lastStatus,
        lastAt: lastAtMs || null,
        dailyLimit: ADSBLOL_DAILY_LIMIT,
        spentToday: Object.fromEntries(spent),
        kinds,
      };
    },
  };
}

const KEY = Symbol.for('oko.adsbLolBudget');
/** Spoločná inštancia procesu (server). */
export const adsbLolBudget = globalThis[KEY] || (globalThis[KEY] = createAdsbLolBudget());
