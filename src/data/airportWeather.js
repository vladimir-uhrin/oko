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
    const lines = metarCardLines(report, nowMs);
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
