// src/data/flightEventsService.js — Udalosti, etapa 1 (2026-09-30, vlastník: „automatizované aj
// s overením z nezávislého zdroja… tak by sme odstránili šum", „potrebujem len overené, nie fake!").
//
// Každú minútu si z archívu letov vezme nové spúšťače (núdzový kód 7500/7600/7700, strmhlavé
// klesanie — flightHistoryStore.triggersSince). Kandidáta (jedno lietadlo) spracuje 3 min po prvom
// spúšťači a znova 30 min po poslednom: stopa z archívu OKO (LEN body zo siete OpenSky — body, ktoré
// archív prevzal z adsb.lol, by adsb.lol overovala sama sebou) + stopa toho istého lietadla z druhej,
// nezávislej siete adsb.lol (živá stopa dňa alebo denný archív) → overenie (eventVerify.js) a časová
// os (eventTimeline.js). Výsledok sa uloží ako JSON vedľa databázy — aj vyvrátený šum (aby bolo
// vidno, čo filter zahodil). Etapa 1 je súkromná: API odpovedá len priamo z tohto počítača;
// verejne nič (zverejnenie až po overení správami v etape 2).

import fs from 'node:fs';
import path from 'node:path';
import { globeHistoryUrl, liveTraceUrl, shiftDay, utcDay } from './adsblolTrace.js';
import { EMERGENCY_CODES, normalizeTrack } from './flightAnomalies.js';
import { fixFromCompact } from './flightHistory.js';
import { verifyEvent } from './eventVerify.js';
import { buildEventTimeline, describeMoment } from './eventTimeline.js';
import { STATE_BACKFILL_BLOCK_PAUSE_MS, fetchTraceFromUrl, latestCompleteDay } from './stateAircraftBackfill.js';

export const EVENTS_TICK_MS = 60_000;
/** Kandidát sa spracuje 3 min po prvom spúšťači (epizóda sa rozvinie, druhá sieť ju má). */
export const EVENT_SETTLE_MS = 3 * 60_000;
/** Konečné spracovanie 30 min po poslednom spúšťači (pristátie alebo koniec údajov). */
export const EVENT_FINAL_MS = 30 * 60_000;
/** Spúšťače jedného lietadla ďalej od seba než 2 h = dva kandidáti. */
export const EVENT_SPLIT_S = 2 * 3600;
/** Okno stopy: 2 h pred prvým spúšťačom, 1 h po poslednom. */
export const EVENT_WINDOW_BEFORE_S = 2 * 3600;
export const EVENT_WINDOW_AFTER_S = 3600;
/** Po štarte servera sa dohľadajú spúšťače posledných 3 h. */
export const EVENT_LOOKBACK_S = 3 * 3600;
/** Spúšťače prichádzajú so zdržaním (čas polohy je starší než snímok) — skenovanie sa prekrýva. */
export const EVENT_SCAN_OVERLAP_S = 15 * 60;
/** adsb.lol: najviac jeden dopyt za 10 s (spolu so spätným importom štátnych lietadiel ~1 / 3 s). */
export const EVENT_FETCH_GAP_MS = 10_000;
/** Prvá sieť = len fixy z OpenSky (nie náhrada ani vojenské z adsb.lol). */
export const PRIMARY_SRC = 'opensky';
/**
 * Verzia pravidiel analýzy. Udalosť analyzovaná staršou verziou nie je „uzavretá" — spúšťače
 * v okne spätného dohľadania (3 h) sa po zmene pravidiel spracujú nanovo.
 */
export const ANALYSIS_VERSION = 3;
/** Volací znak letu leteckej spoločnosti: 3 písmená označenia ICAO + číslo (FDB1073, AUA66D). */
export const AIRLINE_CALLSIGN = /^[A-Z]{3}\d/;
/**
 * Kategórie (číslovanie OpenSky), pri ktorých je strmhlavé klesanie bežné: 2 ľahké (A1 — výsadok
 * parašutistov, akrobacia), 7 vysokovýkonné (A6), 8 vrtuľník (A7), 9 vetroň, 10 balón, 11 parašutista,
 * 12 ultraľahké, 14 bezpilotné. Klesanie dopravného lietadla (A2–A5) alebo neznámej kategórie ostáva.
 */
export const ROUTINE_DIVE_CATEGORIES = new Set([2, 7, 8, 9, 10, 11, 12, 14]);
export const NETWORK_LABELS = Object.freeze({ opensky: 'OpenSky', adsblol: 'adsb.lol' });
const EVENT_ID = /^[0-9a-f]{6}-\d{8}T\d{4}$/;

const pad = (v) => String(v).padStart(2, '0');
/** Id udalosti: `<hex>-RRRRMMDDTHHMM` (čas prvého spúšťača, UTC). Pure. */
export function eventId(icao24, tS) {
  const d = new Date(tS * 1000);
  return `${icao24}-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** Čas z dopytu: epoch s alebo ISO. Pure. */
export function parseTimeParam(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{9,11}$/.test(s)) return Number(s);
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Skrátený záznam pre zoznam. Pure. */
export function eventSummary(e) {
  return {
    id: e.id,
    icao24: e.icao24,
    callsign: e.callsign ?? null,
    reg: e.reg ?? null,
    typeCode: e.typeCode ?? null,
    status: e.status,
    firstT: e.firstT,
    lastT: e.lastT,
    kinds: [...new Set((e.triggers || []).filter((t) => t.status !== 'contradicted').map((t) => (t.kind === 'squawk' ? t.code : t.kind)))],
    analyzedT: e.analyzedT,
    final: Boolean(e.final),
    military: Boolean(e.military),
    recheckDay: e.recheckDay ?? null,
    version: e.version ?? 1,
  };
}

/** Udalosti ako JSON súbory `<dir>/RRRR-MM/<id>.json` (zápis cez dočasný súbor). */
export function fileEventStore(dir) {
  const index = new Map();
  const month = (id) => `${id.slice(7, 11)}-${id.slice(11, 13)}`;
  const fileOf = (id) => path.join(dir, month(id), `${id}.json`);
  return {
    load() {
      index.clear();
      let months = [];
      try { months = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return 0; }
      for (const m of months) {
        for (const name of fs.readdirSync(path.join(dir, m))) {
          if (!name.endsWith('.json')) continue;
          try {
            const e = JSON.parse(fs.readFileSync(path.join(dir, m, name), 'utf8'));
            if (e && EVENT_ID.test(e.id)) index.set(e.id, eventSummary(e));
          } catch { /* poškodený súbor preskoč */ }
        }
      }
      return index.size;
    },
    save(event) {
      const file = fileOf(event.id);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(event, null, 1));
      fs.renameSync(tmp, file);
      index.set(event.id, eventSummary(event));
    },
    get(id) {
      if (!EVENT_ID.test(String(id)) || !index.has(id)) return null;
      try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; }
    },
    list({ statuses = null, limit = 100 } = {}) {
      return [...index.values()]
        .filter((e) => !statuses || statuses.includes(e.status))
        .sort((a, b) => b.firstT - a.firstT)
        .slice(0, Math.max(1, Math.min(1000, limit)));
    },
    summaries: () => [...index.values()],
  };
}

/**
 * @param {{getStore:() => any, eventsDir:string, isLocal:(req:any) => boolean, fetchImpl?:typeof fetch,
 *   now?:() => number, sleep?:(ms:number) => Promise<void>, log?:(msg:string) => void, tickMs?:number}} opts
 */
export function createFlightEventsService({
  getStore,
  eventsDir,
  isLocal,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (msg) => console.log(msg),
  tickMs = EVENTS_TICK_MS,
} = {}) {
  const store = fileEventStore(eventsDir);
  store.load();
  /** @type {Map<string, {icao24:string, firstT:number, lastT:number, count:number, processedAt:number|null, finalAt:number|null}>} */
  const candidates = new Map();
  let scannedUntilS = null;
  let timer = null;
  let busy = false;
  // Zastavená služba (reštart Vite = nová inštancia) nesmie dokončiť rozbehnutý tik: stará inštancia
  // už nemá archív (getStore → null) a ukladala by udalosti bez prvej siete (naživo 30. 9. večer).
  let stopped = false;
  let lastFetchMs = 0;
  let blockedUntil = 0;
  const stats = { ticks: 0, triggers: 0, analyzed: 0, fetches: 0, lastTickAt: null, lastError: null };

  /** Kandidát lietadla, do ktorého spúšťač patrí (bližšie než 2 h), alebo nový. */
  function upsert(row) {
    // Klesanie vojenského lietadla zo zoznamu vojenských (adsb.lol/mil) = výcvik; núdzový kód nie.
    if (row.src === 'adsb.lol/mil' && !EMERGENCY_CODES[row.squawk]) return;
    let key = null;
    for (const [k, c] of candidates) {
      if (c.icao24 === row.icao24 && row.t >= c.firstT - EVENT_SPLIT_S && row.t <= c.lastT + EVENT_SPLIT_S) { key = k; break; }
    }
    if (key === null) {
      // Už spracované a uzavreté udalosti sa nevracajú (reštart servera a prekryv skenovania).
      const covered = store.summaries().some((e) => e.icao24 === row.icao24 && e.final && e.version === ANALYSIS_VERSION
        && row.t >= e.firstT - 60 && row.t <= e.lastT + EVENT_SPLIT_S);
      if (covered) return;
      key = `${row.icao24}:${row.t}`;
      candidates.set(key, { icao24: row.icao24, firstT: row.t, lastT: row.t, count: 0, processedAt: null, finalAt: null });
    }
    const c = candidates.get(key);
    c.firstT = Math.min(c.firstT, row.t);
    c.lastT = Math.max(c.lastT, row.t);
    c.count += 1;
  }

  async function paced(url) {
    const wait = lastFetchMs + EVENT_FETCH_GAP_MS - now();
    if (wait > 0) await sleep(wait);
    lastFetchMs = now();
    stats.fetches += 1;
    try {
      return await fetchTraceFromUrl(url, { fetchImpl });
    } catch (error) {
      return { status: 0, error: error?.message || String(error) };
    }
  }

  /** Stopa lietadla z adsb.lol v okne: denné archívy (zverejnené dni) + živá stopa (ostatné). */
  async function secondNetwork(icao24, fromS, toS) {
    const latest = latestCompleteDay(now());
    const days = [];
    for (let d = utcDay(fromS * 1000); d <= utcDay(toS * 1000) && days.length < 4; d = shiftDay(d, 1)) days.push(d);
    const urls = [...days.filter((d) => d <= latest).map((d) => globeHistoryUrl(icao24, d))];
    if (days.some((d) => d > latest)) urls.push(liveTraceUrl(icao24));
    const points = [];
    let meta = null;
    const statuses = [];
    for (const url of urls) {
      const r = await paced(url);
      statuses.push({ url, status: r.status });
      if (r.status === 403 || r.status === 429) return { blocked: true, statuses };
      if (r.status === 200 && r.flight) {
        points.push(...r.flight.points);
        meta = meta || r.flight;
      }
    }
    // Deň, ktorý ešte nie je v dennom archíve: živá stopa po čase zmizne (FZ1073 o 20:20 UTC už 404),
    // denný archív vyjde až po polnoci — neoverenú udalosť treba vtedy preveriť znova.
    const pendingDay = days.filter((d) => d > latest).pop() || null;
    return { blocked: false, points, meta, statuses, pendingDay };
  }

  /**
   * Analýza lietadla v okne (automaticky aj ručne z API). Vracia { event } alebo { blocked }.
   * `idT` = čas, z ktorého je id udalosti (kandidát: prvý spúšťač v archíve).
   * @param {string} icao24
   * @param {number} fromS
   * @param {number} toS
   */
  async function analyze(icao24, fromS, toS, { final = false, idT = null, id = null } = {}) {
    const hex = String(icao24 || '').trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex) || !(toS > fromS)) return { error: 'bad_request' };
    const s = getStore();
    // Bez archívu OKO (prvá sieť) nie je čo overovať — radšej nič než udalosť bez prvej siete.
    if (!s) return { error: 'no_store' };
    const rows = await s.track(hex, { fromS, toS, limit: 20_000, withSrc: true });
    const ours = normalizeTrack(rows.filter((r) => r[12] === PRIMARY_SRC).map(fixFromCompact).filter(Boolean));
    const second = await secondNetwork(hex, fromS, toS);
    if (second.blocked) return { blocked: true };
    const theirs = normalizeTrack(second.points.filter((p) => p.t >= fromS && p.t <= toS));
    const primary = { id: 'opensky', label: NETWORK_LABELS.opensky, points: ours };
    const secondary = { id: 'adsblol', label: NETWORK_LABELS.adsblol, points: theirs };
    const verification = verifyEvent(primary, secondary);
    // Vojenské lietadlo (adsb.lol dbFlags alebo archív ho má zo zoznamu vojenských) so strmhlavým
    // klesaním a bez núdzového kódu = výcvik (naživo 30. 9. večer: 31 zo 40 automaticky spracovaných
    // kandidátov za 3 h — T-38, C-130 a iné), nie udalosť.
    const military = Boolean(second.meta?.military) || rows.some((r) => r[12] === 'adsb.lol/mil');
    const trigTimes = verification.triggers.map((t) => t.startT ?? t.t);
    const firstT = trigTimes.length ? Math.min(...trigTimes) : fromS;
    let callsign = null;
    let leg = null;
    try {
      const legs = s?.flightsOf ? await s.flightsOf(hex, { beforeS: toS + 1, limit: 10 }) : [];
      leg = legs.find((l) => l.firstT <= firstT + 60 && l.lastT >= firstT - 60) || null;
      callsign = leg?.callsign || null;
    } catch { /* bez volacieho znaku */ }
    if (!callsign) {
      const counts = {};
      for (const p of second.points) if (p.callsign && p.t >= fromS && p.t <= toS) counts[p.callsign] = (counts[p.callsign] || 0) + 1;
      callsign = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
    // Kategória lietadla (číslovanie OpenSky): najčastejšia v stope druhej siete, inak z úseku archívu.
    const catCounts = {};
    for (const p of theirs.length ? second.points : []) if (Number.isFinite(p.cat) && p.cat > 1) catCounts[p.cat] = (catCounts[p.cat] || 0) + 1;
    const category = Number(Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0]) || (leg?.category > 1 ? leg.category : null);
    // Samotné strmhlavé klesanie bez núdzového kódu je udalosť len pri dopravnom lete: nie vojenské
    // lietadlo (výcvik), nie kategória, pri ktorej je bežné (ľahké — výsadok parašutistov, vysokovýkonné,
    // vrtuľník, …), a volací znak letu leteckej spoločnosti (3 písmená ICAO + číslo, FDB1073). Naživo
    // 30. 9.: Mirage F1 (ATAC3) a T-45 (N503XX) súkromných firiem pre armádny výcvik vysielajú
    // kategóriu 3 ako biznis jety — odlíši ich až volací znak. Núdzový kód platí pre každé lietadlo.
    const live = verification.triggers.filter((t) => t.status !== 'contradicted');
    const diveOnly = live.length > 0 && live.every((t) => t.kind === 'dive');
    // Neznámy volací znak nedovoľuje tvrdiť „nie dopravný let" — udalosť ostáva.
    const airline = callsign ? AIRLINE_CALLSIGN.test(callsign) : true;
    const routineReason = !diveOnly ? null
      : (military ? 'military' : (ROUTINE_DIVE_CATEGORIES.has(category) ? 'category' : (airline ? null : 'not-airline')));
    const timeline = buildEventTimeline([primary, secondary], verification.triggers);
    // Id z prvého spúšťača v archíve OKO (rovnaké s údajmi druhej siete aj bez nich), inak prvý vôbec.
    const primaryTimes = verification.triggers.filter((t) => t.seenBy.includes('opensky')).map((t) => t.startT ?? t.t);
    const lastT = verification.triggers.length ? Math.max(...verification.triggers.map((t) => t.endT ?? t.t)) : toS;
    const labels = NETWORK_LABELS;
    const event = {
      // Automaticky: id z času prvého spúšťača v archíve (stabilné pri opakovanom spracovaní).
      id: id || eventId(hex, idT ?? (primaryTimes.length ? Math.min(...primaryTimes) : firstT)),
      icao24: hex,
      callsign,
      reg: second.meta?.reg ?? null,
      typeCode: second.meta?.acType ?? null,
      typeName: second.meta?.acDesc ?? null,
      // confirmed | unverified | rejected (šum) | routine (výcvik) — posledné dve nie sú udalosti.
      status: routineReason && verification.status !== 'rejected' ? 'routine' : verification.status,
      routineReason,
      military,
      category,
      version: ANALYSIS_VERSION,
      firstT,
      lastT,
      window: { fromT: fromS, toT: toS },
      triggers: verification.triggers,
      timeline: timeline.moments,
      timelineText: {
        sk: timeline.moments.map((m) => describeMoment(m, { lang: 'sk', labels })),
        en: timeline.moments.map((m) => describeMoment(m, { lang: 'en', labels })),
      },
      coverage: timeline.coverage,
      secondNetwork: second.statuses,
      attribution: ['OpenSky Network', 'adsb.lol (ODbL 1.0)'],
      analyzedT: Math.floor(now() / 1000),
      final,
      // Neoverené pre chýbajúcu druhú sieť v dni mimo denného archívu → preveriť, keď archív vyjde.
      recheckDay: verification.status === 'unverified' ? second.pendingDay : null,
    };
    stats.analyzed += 1;
    return { event };
  }

  /** Neoverené udalosti, ktorých deň už vyšiel v dennom archíve adsb.lol, sa preveria znova (najviac 5 za tik). */
  async function recheckUnverified() {
    const latest = latestCompleteDay(now());
    let done = 0;
    for (const e of store.summaries()) {
      if (stopped || done >= 5 || now() < blockedUntil) break;
      if (e.status !== 'unverified' || !e.recheckDay || e.recheckDay > latest) continue;
      const full = store.get(e.id);
      if (!full?.window) continue;
      done += 1;
      const result = await analyze(full.icao24, full.window.fromT, full.window.toT, { final: true, id: full.id });
      if (result.blocked) {
        blockedUntil = now() + STATE_BACKFILL_BLOCK_PAUSE_MS;
        break;
      }
      if (stopped) break;
      if (!result.event) continue;
      store.save({ ...result.event, recheckDay: null });
      log(`[events] ${full.id} ${full.callsign || ''} preverené z denného archívu → ${result.event.status}`);
    }
  }

  async function processCandidate(key, c) {
    const nowMs = now();
    const final = nowMs - c.lastT * 1000 >= EVENT_FINAL_MS;
    const toS = Math.min(Math.floor(nowMs / 1000), c.lastT + EVENT_WINDOW_AFTER_S);
    const result = await analyze(c.icao24, c.firstT - EVENT_WINDOW_BEFORE_S, toS, { final, idT: c.firstT });
    if (result.blocked) {
      blockedUntil = now() + STATE_BACKFILL_BLOCK_PAUSE_MS;
      log(`[events] adsb.lol blokuje dopyty — pauza ${STATE_BACKFILL_BLOCK_PAUSE_MS / 60_000} min`);
      return false;
    }
    if (stopped) return false;
    if (!result.event) return true;
    c.processedAt = nowMs;
    if (final) {
      c.finalAt = nowMs;
      candidates.delete(key);
    }
    if (result.event.triggers.length) {
      store.save(result.event);
      log(`[events] ${result.event.id} ${result.event.callsign || ''} → ${result.event.status}${final ? ' (konečné)' : ''}`);
    }
    return true;
  }

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    stats.ticks += 1;
    stats.lastTickAt = now();
    try {
      const s = getStore();
      if (!s?.triggersSince) return;
      const nowS = Math.floor(now() / 1000);
      const fromS = scannedUntilS === null ? nowS - EVENT_LOOKBACK_S : scannedUntilS - EVENT_SCAN_OVERLAP_S;
      const rows = await s.triggersSince(fromS, nowS + 1, { limit: 5000 });
      scannedUntilS = nowS;
      stats.triggers += rows.length;
      for (const row of rows) upsert(row);
      for (const [key, c] of [...candidates]) {
        if (stopped || now() < blockedUntil) break;
        const nowMs = now();
        const due = c.processedAt === null
          ? nowMs - c.firstT * 1000 >= EVENT_SETTLE_MS
          : c.finalAt === null && nowMs - c.lastT * 1000 >= EVENT_FINAL_MS;
        if (!due) continue;
        const ok = await processCandidate(key, c);
        if (!ok) break;
      }
      await recheckUnverified();
      stats.lastError = null;
    } catch (error) {
      stats.lastError = error?.message || String(error);
      log(`[events] chyba: ${stats.lastError}`);
    } finally {
      busy = false;
    }
  }

  const json = (res, status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  };

  async function handle(req, res) {
    // Etapa 1 je súkromná: bez dvoch overení (dáta + správy) nič von.
    if (!isLocal?.(req)) { json(res, 404, { error: 'not_found' }); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (route === '/') {
        // Predvolene len udalosti (overené a neoverené); `status=all` aj šum a vojenský výcvik.
        const param = url.searchParams.get('status');
        const statuses = param === 'all' ? null : (param ? param.split(',') : ['confirmed', 'unverified']);
        json(res, 200, { events: store.list({ statuses, limit: Number(url.searchParams.get('limit')) || 100 }), service: status() });
        return;
      }
      if (route === '/analyze') {
        const fromS = parseTimeParam(url.searchParams.get('from'));
        const toS = parseTimeParam(url.searchParams.get('to'));
        if (fromS === null || toS === null || toS - fromS > 48 * 3600) { json(res, 400, { error: 'bad_window' }); return; }
        const result = await analyze(url.searchParams.get('hex'), fromS, toS, { final: toS * 1000 <= now() - EVENT_FINAL_MS });
        if (result.blocked) { json(res, 503, { error: 'adsblol_blocked' }); return; }
        if (!result.event) { json(res, 400, { error: result.error || 'bad_request' }); return; }
        if (url.searchParams.get('save') === '1' && result.event.triggers.length) store.save(result.event);
        json(res, 200, result.event);
        return;
      }
      const event = store.get(route.slice(1));
      if (!event) { json(res, 404, { error: 'not_found' }); return; }
      json(res, 200, event);
    } catch (error) {
      log(`[events] API: ${error?.message || error}`);
      json(res, 500, { error: 'events_error' });
    }
  }

  function status() {
    const counts = {};
    for (const e of store.summaries()) counts[e.status] = (counts[e.status] || 0) + 1;
    return {
      running: Boolean(timer),
      candidates: candidates.size,
      scannedUntilS,
      blockedUntil: blockedUntil > now() ? blockedUntil : null,
      events: counts,
      ...stats,
    };
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => { void tick(); }, tickMs);
      timer.unref?.();
      void tick();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    analyze,
    handle,
    status,
    store,
  };
}
