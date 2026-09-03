/**
 * @module airportWeather
 * @description METAR pre zvolené letisko — klientská cache + čisté
 * formátovanie riadkov karty. Dáta tečú cez server proxy `/api/metar`
 * (aviationweather.gov, US gov public domain, bez kľúča); fetch sa spúšťa
 * VÝHRADNE pri výbere letiska, nikdy pre ambient kohortu — 100 req/min je
 * spoločný limit celej služby a kohorta máva stovky kariet.
 *
 * Texty sú zámerne letecká angličtina (VFR/QNH/METAR), rovnako ako karta
 * letu — sú to medzinárodné termíny, nie UI chrome na lokalizáciu.
 */

/** Klientské TTL jednej stanice; METAR sa obnovuje ~hodinovo, 5 min stačí. */
export const METAR_CACHE_TTL_MS = 5 * 60_000;
/** Neúspechy sa nedržia dlho — ďalší klik skúsi znova skôr. */
export const METAR_FAILURE_TTL_MS = 60_000;

/** @type {Map<string, {lines:string[], at:number, ttl:number, pending:boolean}>} */
const _cache = new Map();

/** Test seam: čistý štart cache medzi testami. */
export function _resetMetarCacheForTest() {
  _cache.clear();
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * METAR stanica z properties letiska: ICAO kód, inak ident (často = ICAO).
 * OurAirports identy tvaru 'US-0571' nie sú stanice — prísny 4-znakový
 * formát ich odfiltruje a klik na také letisko METAR jednoducho nemá.
 * @param {object|null} props Bundled properties letiska.
 * @returns {string|null}
 */
export function metarStationId(props) {
  for (const candidate of [props?.icao, props?.ident]) {
    const text = String(candidate ?? '').trim();
    if (/^[A-Z0-9]{4}$/.test(text)) return text;
  }
  return null;
}

function windPart(report) {
  const speed = finite(report?.wspd);
  if (speed === null) return null;
  if (speed === 0) return 'CALM';
  const gust = finite(report?.wgst);
  const gustPart = gust === null ? '' : ` G${Math.round(gust)}`;
  const dirRaw = report?.wdir;
  const dir = finite(dirRaw);
  const dirPart = dir === null ? String(dirRaw ?? 'VRB').toUpperCase() : `${Math.round(dir)}°`;
  return `${dirPart}/${Math.round(speed)}KT${gustPart}`;
}

function ageLabel(obsEpochSec, nowMs) {
  const obs = finite(obsEpochSec);
  if (obs === null || obs <= 0) return null;
  const date = new Date(obs * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const hhmm = date.toISOString().slice(11, 16);
  const ageMin = Math.max(0, Math.round((nowMs - obs * 1000) / 60_000));
  const age = ageMin >= 120 ? `${Math.round(ageMin / 60)} h` : `${ageMin} min`;
  return `METAR ${hhmm}Z (${age})`;
}

/**
 * Dekódovaný report → riadky karty. Každá časť je voliteľná; nič sa
 * nefalšuje — bez času nie je vek, bez kategórie vedie riadok 'METAR'.
 * @param {object|null} report Jeden report z aviationweather.gov JSON.
 * @param {number} nowMs Epoch ms teraz.
 * @returns {string[]}
 */
export function metarCardLines(report, nowMs) {
  if (!report || typeof report !== 'object') return [];
  const lines = [];

  const visib = report?.visib === null || report?.visib === undefined || report?.visib === ''
    ? null
    : `VIS ${String(report.visib).toUpperCase()}SM`;
  const head = [
    String(report?.fltCat ?? '').trim() || 'METAR',
    windPart(report),
    visib,
  ].filter(Boolean).join(' · ');
  if (head) lines.push(head);

  const temp = finite(report?.temp);
  const dewp = finite(report?.dewp);
  const altim = finite(report?.altim);
  const tempsLine = [
    temp === null ? null : `T${Math.round(temp)}°${dewp === null ? '' : ` DP${Math.round(dewp)}°`}`,
    altim === null ? null : `QNH ${Math.round(altim)}`,
  ].filter(Boolean).join(' · ');
  if (tempsLine) lines.push(tempsLine);

  const age = ageLabel(report?.obsTime, nowMs);
  if (age) lines.push(age);
  return lines;
}

/** Strop riadkov, ktoré smie pridať TAF. Karta letiska má 2 riadky vlastného
 *  popisu + max 3 METAR; `drawCardText` vo world overlay nemá žiadny vlastný
 *  strop a každý riadok je +15 px výšky. Sedem riadkov je ešte karta, deväť
 *  už stena. */
export const TAF_MAX_CARD_LINES = 2;

/**
 * Absolútny čas z TAF dvojice deň/hodina.
 *
 * TAF nenesie mesiac ani rok — kotví sa na „teraz". Prelom mesiaca je
 * klasická pasca: predpoveď vydaná 31. na 1. by bez korekcie skočila o mesiac
 * dozadu. Preto sa výsledok posúva o mesiac tým smerom, ktorý ho vráti do
 * okolia kotvy.
 * @param {number} day Deň v mesiaci z TAF.
 * @param {number} hour Hodina UTC (24 = polnoc nasledujúceho dňa).
 * @param {number} minute Minúta.
 * @param {number} anchorMs Epoch ms, okolo ktorého sa kotví.
 * @returns {number|null} Epoch ms, alebo null pri nezmyselnom vstupe.
 */
export function tafEpochMs(day, hour, minute, anchorMs) {
  if (![day, hour, minute, anchorMs].every(Number.isFinite)) return null;
  if (day < 1 || day > 31 || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  const anchor = new Date(anchorMs);
  if (Number.isNaN(anchor.getTime())) return null;
  let ms = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), day, hour, minute);
  const FIFTEEN_DAYS = 15 * 24 * 3600_000;
  if (ms - anchorMs > FIFTEEN_DAYS) {
    ms = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, day, hour, minute);
  } else if (anchorMs - ms > FIFTEEN_DAYS) {
    ms = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, day, hour, minute);
  }
  return ms;
}

/** Tokeny, ktoré do karty nepatria: teplotné extrémy predpovede (LOWW ich má). */
const TAF_NOISE = /^T[XN]M?\d{1,2}\/\d{4}Z$/;

/**
 * Rozloží surový TAF na platnosť a zmenové skupiny.
 *
 * Gramatika overená na reálnych vzorkách (LZIB, LZKZ, LKPR, EDDM, LOWW,
 * EGLL, KJFK). `PROB30 TEMPO` sa MUSÍ brať ako jeden token — inak sa
 * predpovede s pravdepodobnostnými skupinami rozsypú na polovicu.
 * @param {string|null} raw Pole `rawTaf` z aviationweather.gov.
 * @returns {{fromDay:number, fromHour:number, toDay:number, toHour:number,
 *   base:string[], groups:Array<object>}|null}
 */
export function parseRawTaf(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const head = /^TAF(?:\s+(?:AMD|COR))?\s+([A-Z0-9]{4})\s+(\d{2})(\d{2})(\d{2})Z\s+(\d{2})(\d{2})\/(\d{2})(\d{2})\s*/.exec(text);
  if (!head) return null;
  const body = text.slice(head[0].length);

  // Rozdeľ pred každým prepínačom skupiny; `PROB\d{2}` a nasledujúce `TEMPO`
  // sa vzápätí zlepia späť do jedného.
  const chunks = body.split(/(?=\bFM\d{6}\b|\bBECMG\b|\bPROB\d{2}\b|\bTEMPO\b)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const merged = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && /^PROB\d{2}$/.test(previous) && /^TEMPO\b/.test(chunk)) {
      merged[merged.length - 1] = `${previous} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }

  const clean = (tokens) => tokens.filter((token) => token && !TAF_NOISE.test(token));
  const groups = [];
  let base = [];
  for (const chunk of merged) {
    const tokens = chunk.split(' ');
    const fm = /^FM(\d{2})(\d{2})(\d{2})$/.exec(tokens[0]);
    if (fm) {
      groups.push({
        kind: 'FM',
        day: Number(fm[1]),
        hour: Number(fm[2]),
        minute: Number(fm[3]),
        toDay: null,
        toHour: null,
        body: clean(tokens.slice(1)),
      });
      continue;
    }
    const window = /^((?:PROB\d{2} )?(?:TEMPO|BECMG))\s+(\d{2})(\d{2})\/(\d{2})(\d{2})$/
      .exec(tokens.slice(0, chunk.startsWith('PROB') ? 3 : 2).join(' '));
    if (window) {
      const consumed = window[1].split(' ').length + 1;
      groups.push({
        kind: window[1],
        day: Number(window[2]),
        hour: Number(window[3]),
        minute: 0,
        toDay: Number(window[4]),
        toHour: Number(window[5]),
        body: clean(tokens.slice(consumed)),
      });
      continue;
    }
    base = base.concat(clean(tokens));
  }

  return {
    fromDay: Number(head[5]),
    fromHour: Number(head[6]),
    toDay: Number(head[7]),
    toHour: Number(head[8]),
    base,
    groups,
  };
}

/**
 * Riadky TAF pre kartu letiska (najviac `TAF_MAX_CARD_LINES`).
 *
 * Prvý riadok je platnosť + základné podmienky, druhý najbližšia zmena,
 * ktorá ešte neskončila. Zvyšné skupiny sa nevypisujú — len sa spočítajú
 * ako `+N`, aby bolo vidieť, že predpoveď pokračuje.
 * @param {object|null} report Report s poľom `rawTaf`.
 * @param {number} nowMs Epoch ms teraz.
 * @returns {string[]}
 */
export function tafCardLines(report, nowMs) {
  const taf = parseRawTaf(report?.rawTaf);
  if (!taf) return [];
  const lines = [];
  const validTo = tafEpochMs(taf.toDay, taf.toHour, 0, nowMs);
  // Vypršaná predpoveď je horšia než žiadna — mlčí sa.
  if (validTo !== null && validTo <= nowMs) return [];

  const hh = (h) => `${String(h).padStart(2, '0')}Z`;
  const headParts = [`TAF ${hh(taf.fromHour)}/${hh(taf.toHour)}`, ...taf.base.slice(0, 3)];
  lines.push(headParts.join(' · '));

  const upcoming = taf.groups.filter((group) => {
    const end = group.toDay === null
      ? tafEpochMs(group.day, group.hour, group.minute, nowMs)
      : tafEpochMs(group.toDay, group.toHour, 0, nowMs);
    return end === null || end > nowMs;
  });
  if (upcoming.length && lines.length < TAF_MAX_CARD_LINES) {
    const next = upcoming[0];
    const when = next.toDay === null
      ? `${hh(next.hour)}→`
      : `${hh(next.hour)}-${hh(next.toHour)}`;
    const rest = upcoming.length - 1;
    const parts = [`${next.kind} ${when}`, ...next.body.slice(0, 3)];
    if (rest > 0) parts.push(`+${rest}`);
    lines.push(parts.join(' · '));
  }
  return lines.slice(0, TAF_MAX_CARD_LINES);
}

/**
 * Riadky METAR sekcie karty zo synchrónnej cache ('' kým nič nevieme).
 * Overlay copy letísk ich číta pri prebuild-e entry po výbere.
 * @param {string|null} station 4-znakový kód stanice.
 * @param {number} [nowMs] Epoch ms teraz.
 * @returns {string[]}
 */
export function cachedMetarCardLines(station, nowMs = Date.now()) {
  const entry = station ? _cache.get(station) : null;
  if (!entry) return [];
  if (entry.pending) return ['METAR…'];
  return entry.lines;
}

/**
 * Vyžiada METAR pre stanicu (deduplikované, TTL cache). `onDone` sa volá po
 * KAŽDOM dokončení (aj neúspešnom) — typicky prebuduje overlay entry karty.
 * @param {string|null} station 4-znakový kód stanice.
 * @param {object} [options]
 * @param {function} [options.fetcher] Test seam (default globálny fetch).
 * @param {function} [options.onDone] Callback po dokončení.
 * @param {number} [options.nowMs] Epoch ms teraz (test seam).
 * @returns {Promise<void>}
 */
export async function requestAirportMetar(station, {
  fetcher = globalThis.fetch,
  onDone = () => {},
  nowMs = Date.now(),
} = {}) {
  if (!station) return;
  const existing = _cache.get(station);
  if (existing && (existing.pending || nowMs - existing.at < existing.ttl)) {
    if (!existing.pending) onDone();
    return;
  }
  _cache.set(station, { lines: ['METAR…'], at: nowMs, ttl: METAR_FAILURE_TTL_MS, pending: true });
  try {
    const response = await fetcher(`/api/metar?ids=${encodeURIComponent(station)}`);
    if (!response?.ok) throw new Error(`metar HTTP ${response?.status}`);
    const payload = await response.json();
    const report = Array.isArray(payload)
      ? payload.find((row) => String(row?.icaoId ?? '').trim() === station) ?? payload[0]
      : null;
    // TAF prišiel v TOM ISTOM zázname (`taf=true` v proxy), takže sa len
    // pripojí — žiadne druhé čakanie, žiadny druhý stav cache.
    const lines = metarCardLines(report, nowMs).concat(tafCardLines(report, nowMs));
    _cache.set(station, {
      // Prázdna odpoveď je poctivý stav: stanica nehlási — nie chyba.
      lines: lines.length ? lines : ['NO METAR'],
      at: nowMs,
      ttl: METAR_CACHE_TTL_MS,
      pending: false,
    });
  } catch {
    _cache.set(station, {
      lines: ['METAR UNAVAILABLE'],
      at: nowMs,
      ttl: METAR_FAILURE_TTL_MS,
      pending: false,
    });
  }
  onDone();
}
