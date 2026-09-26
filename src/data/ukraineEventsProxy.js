// src/data/ukraineEventsProxy.js
/**
 * @module ukraineEventsProxy
 * @description Vite plugin modulu UKRAJINA (etapa 3a, 2026-09-19): archivár na
 * pozadí + `/api/ukraine/events`. Beží LEN v Node (vite.config.js ho importuje
 * ako earthquakeFeedProxy), nikdy v prehliadači.
 *
 * Archivár (kým dev server beží — úloha Plánovača ho drží stále, pozri
 * scripts/oko-server.ps1) ukladá po dňoch na disk (.gev-cache/ukraine/events/,
 * junction na D:), aby časová os vedela ísť späť:
 *  - správy: každých 15 min z vlastnej proxy `/api/situation-news?region=ukraine`
 *    (tá má cache 15 min, takže upstream sa nevolá navyše) + dohľadanie náhľadu
 *    cez `/api/link-image` (len položky bez `noImage`, najviac 25 na tik);
 *  - médiá: každých 15 min YouTube feedy, Telegram náhľady, ArmyInform videá;
 *  - hlásenie GŠ: každú hodinu z `/api/ukraine/report` (cache 30 min);
 *  - GeoConfirmed: každých 6 h rolujúce okno 90 dní po 30-dňových kusoch
 *    (staršie dni sú konečné, nesťahujú sa znova);
 *  - VIINA: aktuálny rok raz za 24 h, minulé roky raz za 30 d, jeden rok na tik.
 * Vypnutie: `UKRAINE_ARCHIVE=off`. Klient dostáva surové položky a skladá ich
 * čistým modelom (ukraineEvents.js), proxy nič neinterpretuje.
 *
 * `/api/ukraine/events?from&to` (≤ 31 dní): udalosti + správy + médiá +
 * hlásenia + pokrytie; `/api/ukraine/events/summary?from&to` (≤ 1 900 dní):
 * počty po dňoch pre prehľad osi; `/api/ukraine/events/directions?from&to`
 * (≤ 92 dní): odseky smerov z hlásení GŠ pre kartu smeru;
 * `/api/ukraine/events/status`: stav archivára.
 */
import zlib from 'node:zlib';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  GEOCONFIRMED_ROLLING_DAYS, VIINA_FIRST_YEAR, archiveDayItems, archiveReport, collectMedia, controlDays, controlFor, controlSnapshot, dayKey, dayList, dayShift,
  deepstateDays, deepstateFor, deepstateSnapshot, directionsPayload, eventsPayload, firesRefresh, geoconfirmedRefresh, isDay, summaryPayload, viinaStatus, viinaYear,
} from '../../scripts/lib/ukraineArchive.mjs';
import { DEEPSTATE_MIRROR_NOTE, DEEPSTATE_MIRRORS, MIRROR_FIRST_DAY, createDeepStateMirror, dateKeyProblem, deepstateMirrorLicense, getFormattedDateKey } from './deepstateMirror.js';
import { deepstateMirrorAttribution, deepstateSnapshotFromMirror } from './ukraineDeepState.js';
import { DEEPSTATE_FULL_MIRROR_LICENSE, DEEPSTATE_FULL_MIRROR_NOTE, deepstateSnapshotFromFullMirror } from './deepstateFullMirror.js';
/** Súbor celej mapy starší než toľko dní od požadovaného dňa → radšej cyterat (mirror mohol zastať). */
export const FULL_MIRROR_MAX_AGE_DAYS = 7;

export const EVENTS_MAX_DAYS = 31;
export const SUMMARY_MAX_DAYS = 1900;
/** Karta smeru ťahá 30 dní; strop drží odpoveď malú (len odseky smerov). */
export const DIRECTIONS_MAX_DAYS = 92;
const MIN = 60_000;
const TICK_MS = { news: 15 * MIN, media: 15 * MIN, report: 60 * MIN, geoconfirmed: 6 * 60 * MIN, viina: 6 * 60 * MIN, control: 6 * 60 * MIN, fires: 6 * 60 * MIN, deepstate: 60 * MIN };
const FIRST_DELAY_MS = { news: 20_000, media: 45_000, report: 70_000, geoconfirmed: 100_000, viina: 130_000, control: 160_000, fires: 200_000, deepstate: 90_000 };
const UNFURL_PER_TICK = 25;

function simpleLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now); hits.set(key, recent);
    if (hits.size > 500) hits.delete(hits.keys().next().value);
    return true;
  };
}
// Kľúč limitera: CF-Connecting-IP (nastavuje Cloudflare), inak socket. PRVÁ
// hodnota X-Forwarded-For patrí klientovi — Cloudflare skutočnú IP pripája za ňu,
// takže striedaním prvej hodnoty sa dal limit obísť (kontrola 24. 9. 2026).
const clientKey = (req) => {
  const cf = req.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return String(req.socket?.remoteAddress || 'anon');
};

/**
 * @param {{root?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, now?: () => number, setTimer?: Function, clearTimer?: Function, log?: Function}} [opts]
 * @returns {import('vite').Plugin & {_tick: (name: string) => Promise<void>, _state: object}}
 */
/**
 * Smie táto požiadavka dostať DeepState? Rozhoduje HOSTITEĽ z hlavičky, nie IP:
 * cez Cloudflare Tunnel prichádza aj verejná návšteva z loopbacku, takže adresa
 * nerozlíši nič. Rovnaký vzor ako `basemapForHost()` pri Stadii.
 *
 * Kým súhlas DeepState nie je (žiadosť odoslaná 19. 9. 2026), licencia §2
 * zakazuje „distribution, publication, proxying" — lokálne prezeranie je vlastné
 * hobby použitie, verejná doména už je publikovanie. `UKRAINE_DEEPSTATE=consent`
 * to otvorí, keď súhlas príde; `=off` vypne aj lokálne. Chýbajúca hlavička =
 * radšej nie. Týka sa NÁŠHO archívu z API DeepState; verejná doména od 24. 9.
 * 2026 dostáva namiesto neho snímku z mirroru cyterat (rozhodnutie vlastníka —
 * mirrory používame; `UKRAINE_DEEPSTATE_MIRROR=off` vráti 451). Od 24. 9. 2026
 * („len mirrory") trasa archív bez súhlasu nečíta ani na localhoste — pravidlo
 * hostiteľa ostáva pre prípad, že by súhlas prišiel len pre domáce použitie. Pure.
 * @param {unknown} host hlavička Host (môže niesť port)
 * @param {{consent?: boolean}} [o]
 * @returns {boolean}
 */
export function deepstateAllowedForHost(host, { consent = false } = {}) {
  if (consent) return true;
  const raw = String(host ?? '').trim().toLowerCase();
  // IPv6 v hlavičke Host býva v zátvorkách (`[::1]:4173`). Holé `::1` je samé
  // samý dvojbodkový — orezanie „:port" by z neho spravilo `:`, preto sa port
  // odstrihne len vtedy, keď je dvojbodka v adrese jediná.
  const bracketed = /^\[([^\]]+)\]/.exec(raw);
  const name = bracketed ? bracketed[1] : (raw.split(':').length === 2 ? raw.split(':')[0] : raw);
  if (!name) return false;
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name.endsWith('.localhost');
}

export function ukraineEventsProxy({ root = process.cwd(), env = process.env, fetchImpl = (...a) => fetch(...a), now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = (m) => console.log(m), deepstateMirror = null, deepstateFullMirror = null } = {}) {
  const enabled = env.UKRAINE_ARCHIVE !== 'off';
  const viinaCache = new Map();
  const payloadCache = new Map(); // key -> { at, json }
  const limiter = simpleLimiter({ windowMs: MIN, max: 40 });
  const timers = new Map();
  const state = { enabled, base: null, running: {}, last: {}, errors: [] };
  const note = (name, error) => { const msg = `${name}: ${error?.message || error}`; state.errors = [{ at: now(), msg }, ...state.errors].slice(0, 20); log(`[ukraine-events] ${msg}`); };

  async function selfJson(pathname) {
    if (!state.base) throw new Error('server address unknown');
    const res = await fetchImpl(state.base + pathname, { signal: AbortSignal.timeout(90_000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`self ${pathname} HTTP ${res.status}`);
    return res.json();
  }
  const today = () => dayKey(now());

  const jobs = {
    async news() {
      const payload = await selfJson('/api/situation-news?region=ukraine');
      const items = Array.isArray(payload?.items) ? payload.items.filter((it) => it?.url && Number.isFinite(it.publishedAt)) : [];
      let unfurled = 0;
      for (const it of items) {
        if (it.image || it.noImage || unfurled >= UNFURL_PER_TICK) continue;
        try {
          const j = await selfJson(`/api/link-image?url=${encodeURIComponent(it.url)}`);
          unfurled += 1;
          if (typeof j?.image === 'string' && /^https?:\/\//.test(j.image)) it.image = j.image;
        } catch { /* náhľad je bonus */ }
      }
      const r = await archiveDayItems(root, 'news', items, { timeKey: 'publishedAt', key: (it) => it.url, now: now() });
      return { items: items.length, unfurled, ...r };
    },
    async media() {
      const { items, failures } = await collectMedia({ fetchImpl, log });
      const r = await archiveDayItems(root, 'media', items, { timeKey: 'publishedAt', key: (it) => it.id, now: now() });
      return { items: items.length, failures: failures.length, ...r };
    },
    async report() {
      const report = await selfJson('/api/ukraine/report');
      return archiveReport(root, report, { now: now() });
    },
    async geoconfirmed() {
      const end = today();
      const out = [];
      for (let back = 0; back < GEOCONFIRMED_ROLLING_DAYS; back += 30) {
        const to = dayShift(end, -back);
        const from = dayShift(end, -Math.min(back + 29, GEOCONFIRMED_ROLLING_DAYS - 1));
        out.push(await geoconfirmedRefresh(root, from, to, { fetchImpl, now: now(), log }));
      }
      return out;
    },
    async viina() {
      const year = new Date(now()).getUTCFullYear();
      const current = await viinaYear(root, year, { fetchImpl, now: now(), log });
      if (current.status === 'updated' || current.status === 'not-modified') viinaCache.delete(year);
      // jeden minulý rok na tik (najstarší chýbajúci/zastaraný), aby sa štart nezahltil
      const status = await viinaStatus(root, { now: now() });
      for (let y = VIINA_FIRST_YEAR; y < year; y += 1) {
        const s = status[y];
        if (s && now() - (s.fetchedAt || 0) < 30 * 86_400_000) continue;
        const r = await viinaYear(root, y, { fetchImpl, now: now(), log });
        if (r.status === 'updated' || r.status === 'not-modified') viinaCache.delete(y);
        break;
      }
      return current;
    },
    // Územná kontrola (Wikipedia, CC BY-SA): najnovšia snímka raz za 6 h; história
    // po týždňoch ide cez CLI (scripts/build-ukraine-events.mjs --control-history).
    async control() {
      const r = await controlSnapshot(root, { fetchImpl, now: now(), log });
      if (r.status === 'updated') controlCache.clear();
      return r;
    },
    // Vojnové požiare (Economist): 70 MB CSV, ETag → 304 keď sa nič nezmenilo.
    async fires() { return firesRefresh(root, { fetchImpl, now: now(), log }); },
    // DeepStateMap.live API: LEN so súhlasom (`UKRAINE_DEEPSTATE=consent`). Na žiadosť
    // z 19. 9. 2026 do termínu neprišla odpoveď = zamietnuté (pravidlo plánu);
    // vlastník 24. 9. 2026: „len mirrory" — bez súhlasu sa z API nesťahuje nič.
    async deepstate() {
      if (!deepstateConsent) return { status: 'disabled', reason: 'mirror-only' };
      const r = await deepstateSnapshot(root, { fetchImpl, now: now(), log });
      if (r.status === 'updated') deepstateCache.clear();
      return r;
    },
  };
  const deepstateMode = String(env.UKRAINE_DEEPSTATE || '').toLowerCase();
  const deepstateOff = deepstateMode === 'off';
  const deepstateConsent = deepstateMode === 'consent';
  // Mirror cyterat (vlastník 24. 9. 2026): verejná doména + dni, ktoré náš
  // archív nemá (beží od 19. 9. 2026; mirror má súbory od 8. 7. 2024).
  const mirrorOn = !deepstateOff && String(env.UKRAINE_DEEPSTATE_MIRROR || '').toLowerCase() !== 'off';
  // Celá mapa so sivou zónou (SmartFinn/wararchive-website, 2026-09-26) — len keď ju vite.config.js odovzdá.
  const fullMirrorOn = mirrorOn && Boolean(deepstateFullMirror) && String(env.UKRAINE_DEEPSTATE_FULL_MIRROR || '').toLowerCase() !== 'off';
  let mirror = deepstateMirror;
  const getMirror = () => { if (!mirror) mirror = createDeepStateMirror({ root, fetchImpl, now, log, mirrors: DEEPSTATE_MIRRORS }); return mirror; };
  const controlCache = new Map(); // deň -> { at, json }
  const deepstateCache = new Map();
  const damageCache = new Map(); // adm3 | unosat -> { at, json }

  async function tick(name) {
    if (state.running[name]) return;
    state.running[name] = true;
    const started = now();
    try {
      const result = await jobs[name]();
      state.last[name] = { at: now(), ms: now() - started, result };
      if (name === 'news' || name === 'media') payloadCache.clear();
    } catch (error) { state.last[name] = { at: now(), ms: now() - started, error: String(error?.message || error) }; note(name, error); }
    finally { state.running[name] = false; }
  }
  function schedule(name, delay) {
    clearTimer(timers.get(name));
    timers.set(name, setTimer(async () => { await tick(name); schedule(name, TICK_MS[name]); }, delay));
  }
  function start(base) {
    state.base = base;
    if (!enabled) { log('[ukraine-events] archiver disabled (UKRAINE_ARCHIVE=off)'); return; }
    for (const name of Object.keys(jobs)) schedule(name, FIRST_DELAY_MS[name]);
    log(`[ukraine-events] archiver started (base ${base}; news/media 15 min, report 60 min, GeoConfirmed/VIINA 6 h)`);
  }
  function stop() { for (const t of timers.values()) clearTimer(t); timers.clear(); }

  function send(res, status, json, req) {
    const body = Buffer.from(JSON.stringify(json));
    const gzip = status === 200 && body.length > 1024 && /\bgzip\b/i.test(String(req?.headers?.['accept-encoding'] || ''));
    const out = gzip ? zlib.gzipSync(body, { level: 6 }) : body;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'Content-Length': String(out.length) };
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    res.end(out);
  }
  function parseRange(url, maxDays) {
    const from = url.searchParams.get('from') || ''; const to = url.searchParams.get('to') || from;
    if (!isDay(from) || !isDay(to)) return { error: 'bad_day' };
    const days = dayList(from, to);
    if (!days.length) return { error: 'bad_range' };
    if (days.length > maxDays) return { error: 'range_too_long', maxDays };
    return { from, to, days: days.length };
  }
  async function handler(req, res) {
    if (req.method !== 'GET') { send(res, 405, { error: 'Method Not Allowed' }, req); return; }
    let url; try { url = new URL(req.url || '/', 'http://localhost'); } catch { send(res, 400, { error: 'bad_url' }, req); return; }
    const sub = url.pathname.replace(/\/+$/, '');
    if (sub === '/status') {
      send(res, 200, { ...state, viina: await viinaStatus(root, { now: now() }), now: now() }, req);
      return;
    }
    if (!limiter(clientKey(req))) { send(res, 429, { error: 'rate_limited' }, req); return; }
    if (sub === '/damage/adm3' || sub === '/damage/unosat') {
      // Statické škody (ETH Zürich / UNOSAT, do 02/2024) — súbor zo stavby
      // scripts/build-ukraine-damage.mjs; bez súboru 404 no_damage_snapshot.
      const name = sub.endsWith('adm3') ? 'adm3' : 'unosat';
      const hit = damageCache.get(name);
      if (hit && now() - hit.at < 60 * MIN) { send(res, 200, hit.json, req); return; }
      try {
        const text = await fsp.readFile(path.join(root, '.gev-cache', 'ukraine', 'damage', `${name}.json`), 'utf8');
        const json = JSON.parse(text);
        damageCache.set(name, { at: now(), json });
        send(res, 200, json, req);
      } catch (error) {
        if (error?.code === 'ENOENT') send(res, 404, { error: 'no_damage_snapshot', name }, req);
        else send(res, 500, { error: 'archive_read_failed', detail: String(error?.message || error) }, req);
      }
      return;
    }
    if (sub === '/deepstate') {
      // Len mirrory (vlastník 24. 9. 2026, „len mirrory"): náš archív z API
      // DeepState sa číta len so súhlasom (`UKRAINE_DEEPSTATE=consent`), inak má
      // KAŽDÝ hostiteľ vrátane localhostu snímku z GitHub mirroru; mirror vypnutý = 451.
      const archiveAllowed = deepstateConsent;
      if (!archiveAllowed && !mirrorOn) {
        send(res, 451, { error: 'deepstate_consent_pending' }, req);
        return;
      }
      const at = url.searchParams.get('at') || dayKey(now());
      if (!isDay(at)) { send(res, 400, { error: 'bad_day' }, req); return; }
      const cacheKey = (archiveAllowed ? 'A:' : 'M:') + at;
      const hit = deepstateCache.get(cacheKey);
      if (hit && now() - hit.at < 10 * MIN) { send(res, 200, hit.json, req); return; }
      const remember = (json) => {
        deepstateCache.set(cacheKey, { at: now(), json });
        if (deepstateCache.size > 64) deepstateCache.delete(deepstateCache.keys().next().value);
      };
      let days = [];
      if (archiveAllowed) {
        try {
          days = await deepstateDays(root);
          const snapshot = await deepstateFor(root, at, { days });
          if (snapshot) {
            const json = { ...snapshot, source: 'archive', requestedAt: at, snapshots: days.length, first: days[0] || null, last: days.at(-1) || null };
            remember(json);
            send(res, 200, json, req);
            return;
          }
        } catch (error) { send(res, 500, { error: 'archive_read_failed', detail: String(error?.message || error) }, req); return; }
        if (!mirrorOn) { send(res, 404, { error: 'no_deepstate_snapshot', at, days: days.length, disabled: deepstateOff }, req); return; }
      }
      // Mirror: deň kurzora (LIVE = dnes, súbor vzniká ~03:00 UTC), inak až 7 starších.
      const todayKey = getFormattedDateKey(0, new Date(now()));
      let key = at.replace(/-/g, '');
      const problem = dateKeyProblem(key, todayKey);
      if (problem === 'future') key = todayKey;
      if (problem === 'before_mirror') {
        const firstDay = MIRROR_FIRST_DAY.slice(0, 4) + '-' + MIRROR_FIRST_DAY.slice(4, 6) + '-' + MIRROR_FIRST_DAY.slice(6);
        send(res, 404, { error: 'no_deepstate_snapshot', source: 'mirror', at, firstDay }, req);
        return;
      }
      // Najprv celá mapa so sivou zónou; ak ju nemá alebo je jej súbor priveľmi starý, cyterat.
      if (fullMirrorOn) {
        const dayReq = key.slice(0, 4) + '-' + key.slice(4, 6) + '-' + key.slice(6);
        try {
          const f = await deepstateFullMirror.lookup(dayReq);
          if (f.found) {
            const snapshot = deepstateSnapshotFromFullMirror(f.found.geojson, { commitAt: f.found.at, sha: f.found.sha, requestedDay: dayReq });
            if (snapshot.features.length && snapshot.fallbackDays <= FULL_MIRROR_MAX_AGE_DAYS) {
              const json = {
                ...snapshot, requestedAt: at,
                attribution: deepstateMirrorAttribution(snapshot.mirror), license: DEEPSTATE_FULL_MIRROR_LICENSE, note: DEEPSTATE_FULL_MIRROR_NOTE,
                ...(archiveAllowed ? { archiveDays: days.length, archiveFirst: days[0] || null } : {}),
              };
              remember(json);
              send(res, 200, json, req);
              return;
            }
          }
        } catch (error) { log(`[ukraine-events] deepstate full mirror: ${error?.message || error}`); }
      }
      try {
        const r = await getMirror().lookup({ requestedDate: key, maxFallback: 7 });
        if (!r.found) {
          if (r.upstreamProblem) send(res, 502, { error: 'deepstate_mirror_unavailable', source: 'mirror', at, upstreamStatus: r.upstreamStatus }, req);
          else if (r.budgetExhausted) send(res, 503, { error: 'deepstate_mirror_slow', source: 'mirror', at }, req);
          else send(res, 404, { error: 'no_deepstate_snapshot', source: 'mirror', at, checkedDays: r.checkedDays }, req);
          return;
        }
        const snapshot = deepstateSnapshotFromMirror(r.found.data, { dateKey: r.found.key, fallbackDays: r.fallbackDays, upstreamUnavailable: r.upstreamUnavailable, mirror: r.found.mirror });
        const json = {
          ...snapshot, requestedAt: at,
          attribution: deepstateMirrorAttribution(snapshot.mirror), license: deepstateMirrorLicense(snapshot.mirror), note: DEEPSTATE_MIRROR_NOTE,
          ...(archiveAllowed ? { archiveDays: days.length, archiveFirst: days[0] || null } : {}),
        };
        // Starší súbor kvôli výpadku mirroru sa necachuje — o 10 min môže byť správny.
        if (!r.upstreamUnavailable) remember(json);
        send(res, 200, json, req);
      } catch (error) { send(res, 500, { error: 'deepstate_mirror_failed', detail: String(error?.message || error) }, req); }
      return;
    }
    if (sub === '/control') {
      // Snímka kontroly platná pre deň `at` (posledná so dňom ≤ at); bez `at` = dnes.
      const at = url.searchParams.get('at') || dayKey(now());
      if (!isDay(at)) { send(res, 400, { error: 'bad_day' }, req); return; }
      const hit = controlCache.get(at);
      if (hit && now() - hit.at < 10 * MIN) { send(res, 200, hit.json, req); return; }
      try {
        const days = await controlDays(root);
        const snapshot = await controlFor(root, at, { days });
        if (!snapshot) { send(res, 404, { error: 'no_control_snapshot', at, days: days.length }, req); return; }
        const json = { ...snapshot, requestedAt: at, snapshots: days.length, first: days[0] || null, last: days.at(-1) || null };
        controlCache.set(at, { at: now(), json });
        if (controlCache.size > 64) controlCache.delete(controlCache.keys().next().value);
        send(res, 200, json, req);
      } catch (error) { send(res, 500, { error: 'archive_read_failed', detail: String(error?.message || error) }, req); }
      return;
    }
    if (sub === '/directions') {
      // Karta smeru (B5): odseky smerov z archívu hlásení GŠ po dňoch.
      const range = parseRange(url, DIRECTIONS_MAX_DAYS);
      if (range.error) { send(res, 400, range, req); return; }
      const key = `D:${range.from}:${range.to}`;
      const hit = payloadCache.get(key);
      if (hit && now() - hit.at < 10 * MIN) { send(res, 200, hit.json, req); return; }
      try {
        const json = await directionsPayload(root, range.from, range.to, { now: now() });
        payloadCache.set(key, { at: now(), json });
        if (payloadCache.size > 64) payloadCache.delete(payloadCache.keys().next().value);
        send(res, 200, json, req);
      } catch (error) { send(res, 500, { error: 'archive_read_failed', detail: String(error?.message || error) }, req); }
      return;
    }
    const isSummary = sub === '/summary';
    const range = parseRange(url, isSummary ? SUMMARY_MAX_DAYS : EVENTS_MAX_DAYS);
    if (range.error) { send(res, 400, range, req); return; }
    const key = `${isSummary ? 'S' : 'E'}:${range.from}:${range.to}`;
    const hit = payloadCache.get(key);
    const ttl = isSummary ? 10 * MIN : MIN;
    if (hit && now() - hit.at < ttl) { send(res, 200, hit.json, req); return; }
    try {
      const json = isSummary ? await summaryPayload(root, range.from, range.to, { now: now(), viinaCache }) : await eventsPayload(root, range.from, range.to, { now: now(), viinaCache });
      json.archiver = { enabled, last: Object.fromEntries(Object.entries(state.last).map(([k, v]) => [k, v.at])) };
      payloadCache.set(key, { at: now(), json });
      if (payloadCache.size > 64) payloadCache.delete(payloadCache.keys().next().value);
      send(res, 200, json, req);
    } catch (error) { send(res, 500, { error: 'archive_read_failed', detail: String(error?.message || error) }, req); }
  }
  function install(server) {
    server.middlewares.use('/api/ukraine/events', handler);
    const http = server.httpServer;
    if (!http) return;
    const onListening = () => {
      const addr = http.address();
      if (!addr || typeof addr !== 'object') return;
      const host = addr.address.includes(':') ? `[${addr.address}]` : addr.address;
      start(`http://${host}:${addr.port}`);
    };
    if (http.listening) onListening(); else http.once('listening', onListening);
    http.once('close', stop);
  }
  return {
    name: 'ukraine-events-proxy',
    configureServer(server) { install(server); },
    configurePreviewServer(server) { install(server); },
    _tick: tick,
    _state: state,
    _start: start,
    _stop: stop,
  };
}
