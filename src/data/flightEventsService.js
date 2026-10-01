// src/data/flightEventsService.js — Udalosti, etapa 1 (2026-09-30, vlastník: „automatizované aj
// s overením z nezávislého zdroja… tak by sme odstránili šum", „potrebujem len overené, nie fake!").
//
// Každú minútu si z archívu letov vezme nové spúšťače (núdzový kód 7500/7600/7700, strmhlavé
// klesanie — flightHistoryStore.triggersSince). Kandidáta (jedno lietadlo) spracuje 3 min po prvom
// spúšťači a znova 30 min po poslednom: stopa z archívu OKO (LEN body zo siete OpenSky — body, ktoré
// archív prevzal z adsb.lol, by adsb.lol overovala sama sebou) + stopa toho istého lietadla z druhej,
// nezávislej siete adsb.lol (živá stopa dňa alebo denný archív) → overenie (eventVerify.js) a časová
// os (eventTimeline.js). Výsledok sa uloží ako JSON vedľa databázy — aj vyvrátený šum (aby bolo
// vidno, čo filter zahodil). Etapa 1 je súkromná: API odpovedá len priamo z tohto počítača.
// Etapa 2 (správy): pri udalostiach dopravných letov sa každých 30 min (do 48 h) hľadajú správy
// v GDELT (eventNews.js) — overené, keď píšu aspoň 2 dôveryhodné médiá zo zoznamu vlastníka.
// Udalosť je na zverejnenie (`publishable`) až keď sú overené DÁTA (dve siete) AJ SPRÁVY.
// Etapa 2b (zverejnenie): vlastník si na tomto počítači pozrie obrázok a text príspevku a klikne
// „Zverejniť" — vznikne trvalý odkaz /s/<id> s obrázkom (Open Graph pre FB) a verejný pohľad
// /api/events/public/<id> (panel v OKO). Nič sa nezverejní samo a nič sa neposiela na FB.

import fs from 'node:fs';
import path from 'node:path';
import { globeHistoryUrl, liveTraceUrl, shiftDay, traceToFlight, utcDay } from './adsblolTrace.js';
import { EMERGENCY_CODES, normalizeTrack } from './flightAnomalies.js';
import { fixFromCompact } from './flightHistory.js';
import { verifyEvent } from './eventVerify.js';
import { buildEventTimeline, describeMoment } from './eventTimeline.js';
import { NEWS_WINDOW_AFTER_S, NEWS_WINDOW_BEFORE_S, flightIdentity, newsQuery, newsUrl, newsVerdict, parseTrustedList } from './eventNews.js';
import { simplifyTrack } from './eventCard.js';
import { eventHeadline, eventShareHash, eventShareMeta, facebookShareUrl, isPublishable, postText, publicEventView } from './eventPost.js';
import { parseGdeltArticles } from './situationNews.js';
import { STATE_BACKFILL_BLOCK_PAUSE_MS, STATE_BACKFILL_UA, fetchTraceFromUrl, latestCompleteDay } from './stateAircraftBackfill.js';
import { validateSharePayload } from '../shareStore.js';

/** Správy sa hľadajú každých 30 min, kým ich nepotvrdia 2 dôveryhodné médiá (najdlhšie 48 h). */
export const NEWS_RECHECK_MS = 30 * 60_000;
/** GDELT dovolí jeden dopyt za 5 s (zdieľaný s modulom Blízky východ) — my najviac jeden za 10 s. */
export const NEWS_GAP_MS = 10_000;
/** Po 429 alebo výpadku GDELT pauza. */
export const NEWS_PAUSE_MS = 10 * 60_000;
/** Najviac toľko overení správ za jeden tik. */
export const NEWS_PER_TICK = 3;

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
/**
 * Denný archív adsb.lol môže vyjsť neskôr než 2 h po polnoci (dovtedy 404): preverenie sa zopakuje
 * o 30 min, najviac 24× (12 h) — potom lietadlo v archíve naozaj nie je a udalosť ostane neoverená.
 */
export const RECHECK_RETRY_MS = 30 * 60_000;
export const RECHECK_MAX_TRIES = 24;
/**
 * Stopa druhej siete sa pri overení uloží k udalosti (2026-10-01): adsb.lol živú stopu po hodinách
 * zmaže a do denného archívu nemusí lietadlo dať vôbec (naživo FZ1073 / A6-FKF: archív 30. 9. vyšiel,
 * lietadlo v ňom chýba) — neskoršie preverenie by inak potvrdenú udalosť zhodilo na „neoverenú".
 */
export const STORED_TRACE_MAX_POINTS = 20_000;
/** Ručne dodaná stopa (readsb JSON z adsb.lol) najviac 16 MB. */
export const TRACE_IMPORT_MAX_BYTES = 16 * 1024 * 1024;

const roundTo = (v, k) => (Number.isFinite(v) ? Math.round(v * k) / k : null);
/** Body druhej siete na uloženie k udalosti — kompaktné riadky. Pure. */
export function packTracePoints(points) {
  return (points || []).slice(0, STORED_TRACE_MAX_POINTS).map((p) => [
    p.t, roundTo(p.lat, 1e5), roundTo(p.lon, 1e5), roundTo(p.alt, 10), roundTo(p.gs, 10), roundTo(p.trk, 10),
    roundTo(p.vr, 100), p.squawk ?? null, p.gnd ? 1 : 0, Number.isFinite(p.cat) ? p.cat : null, p.callsign || null,
  ]);
}
/** Uložené riadky späť na body stopy. Pure. */
export function unpackTracePoints(rows) {
  return (Array.isArray(rows) ? rows : []).filter(Array.isArray).map((a) => ({
    t: a[0], lat: a[1], lon: a[2], alt: a[3], gs: a[4], trk: a[5], vr: a[6], squawk: a[7], gnd: a[8] === 1, cat: a[9], callsign: a[10],
  }));
}
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
/** Verejná adresa OKO pre odkazy v príspevkoch (nie adresa požiadavky — vlastník klikne na localhoste). */
export const EVENTS_PUBLIC_ORIGIN = 'https://okolive.sk';
const EVENT_ID = /^[0-9a-f]{6}-\d{8}T\d{4}$/;
const EVENT_ID_PART = '[0-9a-f]{6}-\\d{8}T\\d{4}';
const PUBLIC_ROUTE = new RegExp(`^/public/(${EVENT_ID_PART})$`);
const EVENT_ROUTE = new RegExp(`^/(${EVENT_ID_PART})(?:/(card\\.jpg|post|publish|unpublish|second-network))?$`);
/** Stopa na obrázok: body sietí, ktoré sú v atribúcii (OpenSky + adsb.lol), aj z druhej siete. */
const DRAWN_SRC = (src) => src === PRIMARY_SRC || String(src || '').startsWith('adsb.lol');

/** Telo POST ako JSON so stropom veľkosti (BODY_TOO_LARGE nad strop). */
async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' });
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Zapisovacie akcie (zverejniť / stiahnuť) len z vlastnej stránky OKO na localhoste: cudzia stránka
 * otvorená v prehliadači vlastníka by inak vedela poslať POST na localhost (CSRF). Vyžaduje JSON
 * telo (cudzí pôvod tak musí prejsť predletom CORS, ktorý tu neprejde). Pure.
 */
export function isOwnLocalPost(req) {
  const h = req?.headers || {};
  const site = String(h['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = String(h.origin || '');
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return false;
  return String(h['content-type'] || '').toLowerCase().startsWith('application/json');
}

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
    news: e.news?.status ?? null,
    newsType: e.news?.type ?? null,
    newsFinal: Boolean(e.news?.final),
    // Na zverejnenie až keď sú overené dáta (dve siete) AJ správy (dve dôveryhodné médiá).
    publishable: isPublishable(e),
    published: e.published?.url ?? null,
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
 * Zoznam dôveryhodných médií z JSON súboru; zmena súboru platí bez reštartu (mtime).
 * @returns {() => string[]}
 */
export function trustedNewsLoader(file) {
  let mtime = -1;
  let list = [];
  return () => {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m !== mtime) {
        list = parseTrustedList(JSON.parse(fs.readFileSync(file, 'utf8')));
        mtime = m;
      }
    } catch { /* bez súboru nič nie je dôveryhodné */ }
    return list;
  };
}

/**
 * @param {{getStore:() => any, eventsDir:string, isLocal:(req:any) => boolean, fetchImpl?:typeof fetch,
 *   now?:() => number, sleep?:(ms:number) => Promise<void>, log?:(msg:string) => void, tickMs?:number,
 *   trustedFile?:string, renderCard?:((event:object, format?:string) => Promise<{jpeg:Buffer, width:number, height:number}>)|null,
 *   shareStore?:{save:Function, read:Function, remove:Function}|null, publicOrigin?:string}} opts
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
  trustedFile = null,
  renderCard = null,
  shareStore = null,
  publicOrigin = EVENTS_PUBLIC_ORIGIN,
} = {}) {
  const store = fileEventStore(eventsDir);
  store.load();
  const trustedNews = trustedFile ? trustedNewsLoader(trustedFile) : () => [];
  let lastNewsMs = 0;
  let newsBlockedUntil = 0;
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
  async function analyze(icao24, fromS, toS, { final = false, idT = null, id = null, secondOverride = null } = {}) {
    const hex = String(icao24 || '').trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex) || !(toS > fromS)) return { error: 'bad_request' };
    const s = getStore();
    // Bez archívu OKO (prvá sieť) nie je čo overovať — radšej nič než udalosť bez prvej siete.
    if (!s) return { error: 'no_store' };
    const rows = await s.track(hex, { fromS, toS, limit: 20_000, withSrc: true });
    const ours = normalizeTrack(rows.filter((r) => r[12] === PRIMARY_SRC).map(fixFromCompact).filter(Boolean));
    let second = secondOverride || await secondNetwork(hex, fromS, toS);
    if (second.blocked) return { blocked: true };
    // Druhá sieť stopu už nemá (živá zmizla, denný archív bez lietadla) → stopa uložená pri overení.
    const prior = storedTraceEvent(hex, fromS, toS, id);
    let storedUsed = null;
    if (!secondOverride && !second.points.length && prior?.secondNetworkTrace?.points?.length) {
      storedUsed = prior.secondNetworkTrace;
      second = {
        ...second,
        points: unpackTracePoints(storedUsed.points),
        meta: second.meta || storedUsed.meta || null,
        statuses: [...second.statuses, { url: storedUsed.url || 'stored', status: 'stored' }],
        pendingDay: null,
      };
    }
    const windowPoints = second.points.filter((p) => p.t >= fromS && p.t <= toS);
    const theirs = normalizeTrack(windowPoints);
    // Stopa na obrázok a do verejného pohľadu: spojené body oboch sietí (overuje sa len z `ours`).
    const drawn = normalizeTrack([...rows.filter((r) => DRAWN_SRC(r[12])).map(fixFromCompact).filter(Boolean), ...theirs]);
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
      track: simplifyTrack(drawn),
      secondNetwork: second.statuses,
      // Uložená stopa: použitá záloha / ručne dodaná / čerstvo stiahnutá (úplnejšia než pri prvom
      // spracovaní) — len pri udalostiach (nie šum ani výcvik); inak tá, ktorá už bola uložená.
      secondNetworkTrace: storedUsed || secondOverride?.record
        || (theirs.length && ['confirmed', 'unverified'].includes(verification.status) && !routineReason
          ? {
            source: 'adsb.lol',
            origin: 'fetch',
            url: second.statuses.find((x) => x.status === 200)?.url ?? null,
            fetchedT: Math.floor(now() / 1000),
            meta: second.meta ? { reg: second.meta.reg ?? null, acType: second.meta.acType ?? null, acDesc: second.meta.acDesc ?? null, military: Boolean(second.meta.military) } : null,
            points: packTracePoints(windowPoints),
          }
          : null)
        || prior?.secondNetworkTrace || null,
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
      if (full.recheckNotBefore && now() < full.recheckNotBefore) continue;
      done += 1;
      const result = await analyze(full.icao24, full.window.fromT, full.window.toT, { final: true, id: full.id });
      if (result.blocked) {
        blockedUntil = now() + STATE_BACKFILL_BLOCK_PAUSE_MS;
        break;
      }
      if (stopped) break;
      if (!result.event) continue;
      const tries = (full.recheckTries || 0) + 1;
      // Denný archív ešte nevyšiel (404) a druhá sieť nemá nič → nový pokus o 30 min, nie „navždy neoverené".
      const archiveMissing = result.event.status === 'unverified'
        && (result.event.secondNetwork || []).some((s) => s.status === 404 && s.url.includes('/globe_history/'));
      if (archiveMissing && tries < RECHECK_MAX_TRIES) {
        saveMerged({ ...result.event, recheckDay: full.recheckDay, recheckTries: tries, recheckNotBefore: now() + RECHECK_RETRY_MS });
        log(`[events] ${full.id} ${full.callsign || ''} denný archív adsb.lol ešte nie je (404) — znova o ${RECHECK_RETRY_MS / 60_000} min (${tries}/${RECHECK_MAX_TRIES})`);
        continue;
      }
      saveMerged({ ...result.event, recheckDay: null, recheckTries: tries, recheckNotBefore: null });
      log(`[events] ${full.id} ${full.callsign || ''} preverené z denného archívu → ${result.event.status}`);
    }
  }

  /** Uloženie po analýze: overenie správami, trasa, zverejnenie a uložená stopa druhej siete sa nestratia. */
  function saveMerged(event) {
    const prev = store.get(event.id);
    store.save({
      ...event,
      route: event.route ?? prev?.route ?? null,
      news: event.news ?? prev?.news ?? null,
      published: event.published ?? prev?.published ?? null,
      secondNetworkTrace: event.secondNetworkTrace ?? prev?.secondNetworkTrace ?? null,
    });
  }

  /** Predošlá udalosť toho istého lietadla v okne (podľa id, inak prekryvom okna) — kvôli uloženej stope. */
  function storedTraceEvent(hex, fromS, toS, id) {
    if (id) return store.get(id);
    const hit = store.summaries().find((e) => e.icao24 === hex && e.firstT >= fromS && e.firstT <= toS);
    return hit ? store.get(hit.id) : null;
  }

  /**
   * Stopa druhej siete dodaná ručne (readsb JSON z adsb.lol, napr. živá stopa uložená skôr, než ju
   * adsb.lol zmazal): udalosť sa overí znova s ňou a pôvod sa zapíše (odkiaľ a kedy bola stopa uložená).
   */
  async function importSecondNetwork(event, body) {
    const flight = traceToFlight(body?.trace);
    if (!flight) return { status: 400, body: { error: 'bad_trace' } };
    if (flight.icao24 !== event.icao24) return { status: 400, body: { error: 'other_aircraft' } };
    const capturedMs = Date.parse(String(body?.capturedAt || ''));
    if (!Number.isFinite(capturedMs)) return { status: 400, body: { error: 'bad_captured_at' } };
    const { fromT, toT } = event.window || {};
    const inWindow = flight.points.filter((p) => p.t >= fromT && p.t <= toT);
    if (!inWindow.length) return { status: 400, body: { error: 'no_points_in_window' } };
    const record = {
      source: 'adsb.lol',
      origin: String(body.origin || 'import').slice(0, 200),
      note: String(body.note || '').slice(0, 500),
      capturedAt: new Date(capturedMs).toISOString(),
      importedT: Math.floor(now() / 1000),
      url: 'import',
      meta: { reg: flight.reg ?? null, acType: flight.acType ?? null, acDesc: flight.acDesc ?? null, military: Boolean(flight.military) },
      points: packTracePoints(inWindow),
    };
    const result = await analyze(event.icao24, fromT, toT, {
      final: true,
      id: event.id,
      secondOverride: { blocked: false, points: flight.points, meta: flight, statuses: [{ url: 'import', status: 'stored' }], pendingDay: null, record },
    });
    if (!result.event) return { status: 400, body: { error: result.error || 'analysis_failed' } };
    if (stopped) return { status: 503, body: { error: 'restarting' } };
    saveMerged({ ...result.event, recheckDay: null, recheckNotBefore: null });
    log(`[events] ${event.id} ${event.callsign || ''} druhá sieť z uloženej stopy (${record.origin}, ${record.capturedAt}) → ${result.event.status}`);
    return { status: 200, body: eventSummary(store.get(event.id)) };
  }

  /**
   * Udalosť so stopou na obrázok. Staršie záznamy (pred etapou 2b) stopu nemajú — doplní sa z archívu
   * OKO (body OpenSky a adsb.lol v okne udalosti) bez nového overovania a uloží sa.
   */
  async function withTrack(event) {
    if (Array.isArray(event.track) && event.track.length) return event;
    const s = getStore();
    if (!s || !event.window) return event;
    const rows = await s.track(event.icao24, { fromS: event.window.fromT, toS: event.window.toT, limit: 20_000, withSrc: true });
    const track = simplifyTrack(normalizeTrack(rows.filter((r) => DRAWN_SRC(r[12])).map(fixFromCompact).filter(Boolean)));
    if (!track.length || stopped) return event;
    const next = { ...(store.get(event.id) || event), track };
    store.save(next);
    return next;
  }

  /** Text príspevku a stav zverejnenia pre kontrolu vlastníkom. */
  function postPayload(event) {
    const url = event.published?.url || null;
    return {
      id: event.id,
      publishable: isPublishable(event),
      headline: eventHeadline(event),
      text: postText(event, { url }),
      published: event.published || null,
      facebook: url ? facebookShareUrl(url) : null,
    };
  }

  /**
   * Zverejnenie (klik vlastníka): len udalosť overená DÁTAMI aj SPRÁVAMI. Obrázok og → trvalý odkaz
   * /s/<id> (retencia ho nemaže) s adresou verejného OKO; opakované zverejnenie vráti ten istý odkaz.
   */
  async function publish(event) {
    if (!isPublishable(event)) return { status: 409, body: { error: 'not_publishable' } };
    if (event.published?.shareId && shareStore?.read(event.published.shareId)) return { status: 200, body: postPayload(event) };
    if (!renderCard || !shareStore) return { status: 503, body: { error: 'publish_unavailable' } };
    const full = await withTrack(event);
    const hash = eventShareHash(full);
    if (!hash) return { status: 409, body: { error: 'no_track' } };
    const card = await renderCard(full, 'og');
    const meta = eventShareMeta(full);
    const checked = validateSharePayload({
      hash,
      title: meta.title,
      description: meta.description,
      image: `data:image/jpeg;base64,${card.jpeg.toString('base64')}`,
      width: card.width,
      height: card.height,
    });
    if (!checked.ok) return { status: 500, body: { error: `share_${checked.error}` } };
    if (stopped) return { status: 503, body: { error: 'restarting' } };
    const record = shareStore.save({ ...checked.value, keep: true });
    const origin = String(publicOrigin || EVENTS_PUBLIC_ORIGIN).replace(/\/+$/, '');
    const published = { t: Math.floor(now() / 1000), shareId: record.id, url: `${origin}/s/${record.id}`, image: `${origin}/s/${record.id}.jpg` };
    const latest = store.get(event.id) || full;
    const next = { ...latest, track: latest.track?.length ? latest.track : full.track, published };
    store.save(next);
    log(`[events] ${event.id} ${event.callsign || ''} zverejnené → ${published.url}`);
    return { status: 200, body: postPayload(next) };
  }

  /** Stiahnutie zverejnenia (vlastník): odkaz /s/<id> aj verejný pohľad potom vrátia 404. */
  function unpublish(event) {
    if (!event.published) return { status: 200, body: postPayload(event) };
    if (event.published.shareId) shareStore?.remove?.(event.published.shareId);
    const next = { ...(store.get(event.id) || event), published: null, unpublishedT: Math.floor(now() / 1000) };
    store.save(next);
    log(`[events] ${event.id} ${event.callsign || ''} zverejnenie stiahnuté`);
    return { status: 200, body: postPayload(next) };
  }

  /** Trasa letu z adsbdb (aerolinka, číslo letu, mestá) — null = neznáma, 'retry' = skúsiť neskôr. */
  async function lookupRoute(callsign) {
    try {
      const res = await fetchImpl(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
        headers: { 'User-Agent': STATE_BACKFILL_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) return 'retry';
      const json = JSON.parse(await res.text());
      return json?.response?.flightroute && typeof json.response.flightroute === 'object' ? json.response.flightroute : null;
    } catch {
      return 'retry';
    }
  }

  /** Správy k jednej udalosti: { route, news } alebo { blocked } (GDELT/adsbdb neodpovedá — neskôr). */
  async function newsFor(event) {
    const nowMs = now();
    const checkedT = Math.floor(nowMs / 1000);
    let identity = event.route || null;
    if (!identity) {
      const fr = await lookupRoute(event.callsign);
      if (fr === 'retry') return { blocked: true };
      identity = fr ? flightIdentity(event.callsign, fr) : null;
      if (!identity) {
        return { route: null, news: { status: 'none', reason: 'no-route', trusted: [], otherCount: 0, type: null, typeDomains: [], checkedT, final: true } };
      }
    }
    const fromMs = (event.firstT - NEWS_WINDOW_BEFORE_S) * 1000;
    const endMs = (event.firstT + NEWS_WINDOW_AFTER_S) * 1000;
    const toMs = Math.min(nowMs, endMs);
    const query = newsQuery(identity);
    let json = null;
    // GDELT pri obmedzení (jeden dopyt za 5 s z tej istej adresy — pýta sa aj modul Blízky východ)
    // vracia 429 alebo text namiesto JSON: jeden nový pokus po 15 s, potom pauza.
    for (let attempt = 0; attempt < 2 && !json && !stopped; attempt += 1) {
      const wait = lastNewsMs + (attempt ? 15_000 : NEWS_GAP_MS) - now();
      if (wait > 0) await sleep(wait);
      lastNewsMs = now();
      try {
        const res = await fetchImpl(newsUrl(query, { fromMs, toMs }), {
          headers: { 'User-Agent': STATE_BACKFILL_UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
        const text = await res.text();
        if (res.ok && text.trim().startsWith('{')) json = JSON.parse(text);
      } catch { /* sieť — ďalší pokus alebo pauza */ }
    }
    if (!json) return { blocked: true };
    const verdict = newsVerdict(parseGdeltArticles(json), identity, trustedNews(), { fromMs, toMs });
    return { route: identity, news: { ...verdict, query, checkedT, final: verdict.status === 'verified' || nowMs >= endMs } };
  }

  /** Overenie správami pri udalostiach dopravných letov (každých 30 min do overenia, najdlhšie 48 h). */
  async function checkNews() {
    // Bez zoznamu dôveryhodných médií nemá čo overiť — správy sa ani nehľadajú.
    if (!trustedFile) return;
    let done = 0;
    for (const e of store.summaries()) {
      if (stopped || done >= NEWS_PER_TICK || now() < newsBlockedUntil) break;
      if (!['confirmed', 'unverified'].includes(e.status) || e.newsFinal) continue;
      if (!e.callsign || !AIRLINE_CALLSIGN.test(e.callsign)) continue;
      const full = store.get(e.id);
      if (!full || now() - (full.news?.checkedT ?? 0) * 1000 < NEWS_RECHECK_MS) continue;
      done += 1;
      const result = await newsFor(full);
      if (result.blocked) {
        newsBlockedUntil = now() + NEWS_PAUSE_MS;
        if (!stopped) log(`[events] ${e.id} správy: GDELT alebo adsbdb teraz neodpovedá — znova o ${NEWS_PAUSE_MS / 60_000} min`);
        break;
      }
      if (stopped) break;
      const latest = store.get(e.id) || full; // medzičasom mohlo prebehnúť nové spracovanie údajov
      store.save({ ...latest, route: result.route ?? latest.route ?? null, news: result.news });
      log(`[events] ${e.id} ${e.callsign} správy → ${result.news.status}${result.news.type ? ` (${result.news.type})` : ''}: ${result.news.trusted.map((t) => t.domain).join(', ') || '—'}`);
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
      saveMerged(result.event);
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
      await checkNews();
      stats.lastError = null;
    } catch (error) {
      stats.lastError = error?.message || String(error);
      // Zastavená inštancia (reštart Vite) dostane chybu zatvoreného archívu — to nie je chyba služby.
      if (!stopped) log(`[events] chyba: ${stats.lastError}`);
    } finally {
      busy = false;
    }
  }

  const json = (res, status, payload, cache = 'no-store') => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache });
    res.end(JSON.stringify(payload));
  };

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const local = Boolean(isLocal?.(req));
    const method = String(req.method || 'GET').toUpperCase();
    try {
      // Verejný pohľad: len udalosť, ktorú vlastník zverejnil (po dvoch overeniach). Na tomto počítači
      // aj náhľad udalosti pred zverejnením (vlastník vidí presne to, čo uvidí verejnosť).
      const pub = PUBLIC_ROUTE.exec(route);
      if (pub) {
        if (method !== 'GET' && method !== 'HEAD') { json(res, 405, { error: 'method_not_allowed' }); return; }
        let event = store.get(pub[1]);
        const preview = local && event && !event.published?.url && ['confirmed', 'unverified'].includes(event.status);
        if (!event || (!event.published?.url && !preview)) { json(res, 404, { error: 'not_found' }); return; }
        if (preview) event = await withTrack(event);
        json(res, 200, { ...publicEventView(event), preview: Boolean(preview) }, preview ? 'no-store' : 'public, max-age=60');
        return;
      }
      // Všetko ostatné je súkromné: odpovedá len priamo z tohto počítača.
      if (!local) { json(res, 404, { error: 'not_found' }); return; }
      if (method === 'POST' && !isOwnLocalPost(req)) { json(res, 403, { error: 'forbidden' }); return; }
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
        if (url.searchParams.get('save') === '1' && result.event.triggers.length) saveMerged(result.event);
        json(res, 200, result.event);
        return;
      }
      const match = EVENT_ROUTE.exec(route);
      const event = match ? store.get(match[1]) : null;
      if (!event) { json(res, 404, { error: 'not_found' }); return; }
      const action = match[2] || null;
      if (!action) { json(res, 200, event); return; }
      if (action === 'card.jpg' || action === 'post') {
        if (method !== 'GET' && method !== 'HEAD') { json(res, 405, { error: 'method_not_allowed' }); return; }
        if (action === 'post') { json(res, 200, postPayload(event)); return; }
        if (!renderCard) { json(res, 503, { error: 'card_unavailable' }); return; }
        const card = await renderCard(await withTrack(event), url.searchParams.get('format') === 'feed' ? 'feed' : 'og');
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': String(card.jpeg.length) });
        res.end(card.jpeg);
        return;
      }
      // Zverejniť / stiahnuť / dodať stopu druhej siete: len POST z vlastnej stránky (overené vyššie).
      if (method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return; }
      if (action === 'second-network') {
        let body;
        try {
          body = await readJsonBody(req, TRACE_IMPORT_MAX_BYTES);
        } catch (error) {
          json(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: error?.code === 'BODY_TOO_LARGE' ? 'too_large' : 'bad_json' });
          return;
        }
        const imported = await importSecondNetwork(event, body);
        json(res, imported.status, imported.body);
        return;
      }
      const result = action === 'publish' ? await publish(event) : unpublish(event);
      json(res, result.status, result.body);
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
      publishing: Boolean(renderCard && shareStore),
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
