// src/data/powerFlows.js
/**
 * @module powerFlows
 * @description Cezhraničné fyzické toky elektriny (ELEKTRINA, 2026-11-06)
 * pre hover kartu vedení: čistý katalóg krajín Energy-Charts, URL dopytu,
 * zostavenie odpovede proxy `/api/power/flows` a riadky karty. Modul je
 * čistý (bez Cesia, DOM aj i18n) — importuje ho aj vite.config.js.
 *
 * Zdroj: Energy-Charts (Fraunhofer ISE), API bez kľúča, dáta ENTSO-E
 * Transparency; licencia v každej odpovedi: „CC BY 4.0, attribution:
 * energy-charts.info". Odpoveď `/v2/cbpf` nesie pre jednu krajinu rad
 * 15-minútových hodnôt v GW ku každému susedovi; znamienko: kladné = dovoz do
 * krajiny, záporné = vývoz. Toky sú za HRANICU (dvojicu štátov), nie za
 * vedenie — preto karta hovorí „tok cez hranicu", nikdy „tok týmto vedením".
 * Limit API: pri ~10 rýchlych dopytoch vracia 429, preto proxy sťahuje krajiny
 * s rozostupom a raz za hodinu.
 */
import { formatDateLabel } from './gasPrices.js';

export const POWER_FLOWS_API = '/api/power/flows';
export const ENERGY_CHARTS_CBPF_URL = 'https://api.energy-charts.info/v2/cbpf';
export const ENERGY_CHARTS_URL = 'https://www.energy-charts.info/';
export const POWER_FLOWS_LICENSE = 'CC BY 4.0';
/** Okno dopytu (36 h späť), aby po polnoci nebol rad prázdny. */
export const POWER_FLOW_WINDOW_MS = 36 * 60 * 60_000;
/** Koľko 15-min intervalov ide do odpovede proxy na dvojicu (24 h). */
export const POWER_FLOW_SERIES_LEN = 96;
/**
 * Rozostup dopytov Energy-Charts v proxy. 2026-11-06 naostro: pri 4 s dostalo
 * 22 z 37 krajín 429; API posiela `Retry-After` (1–30 s), takže proxy po 429
 * počká podľa neho (strop 60 s) a skúsi znova, najviac POWER_FLOW_MAX_ATTEMPTS×.
 */
export const POWER_FLOW_REQUEST_GAP_MS = 6_000;
export const POWER_FLOW_MAX_ATTEMPTS = 4;

/** `Retry-After` (sekundy alebo dátum HTTP) → ms, 1–60 s; bez hlavičky 20 s. */
export function retryAfterMs(header, now = Date.now()) {
  const raw = String(header ?? '').trim();
  let ms = 20_000;
  if (/^\d+(\.\d+)?$/.test(raw)) ms = Number(raw) * 1000;
  else if (raw && Number.isFinite(Date.parse(raw))) ms = Date.parse(raw) - now;
  return Math.min(60_000, Math.max(1_000, Math.round(ms) + 500));
}

/**
 * Neúplný posledný interval: Energy-Charts pri najnovšom 15-min intervale
 * vracia za suseda, ktorý ešte nehlásil, presnú nulu (2026-11-06: CZ 1,759 →
 * 0, UA −0,444 → 0). Presná nula na KONCI radu po nenulovom toku (≥ 50 MW)
 * sa preto berie ako chýbajúca; hranica, ktorá je naozaj zavretá, má nuly
 * po celom rade a ostane nulou.
 * @param {Array<{t: number, gw: number|null}>} points
 */
export function dropTrailingPlaceholderZeros(points) {
  const out = points.map((p) => ({ ...p }));
  let i = out.length - 1;
  while (i > 0 && out[i].gw === 0) i -= 1;
  if (i < out.length - 1 && Number.isFinite(out[i]?.gw) && Math.abs(out[i].gw) >= 0.05) {
    for (let k = i + 1; k < out.length; k++) out[k].gw = null;
  }
  return out;
}

/**
 * Krajiny, pre ktoré Energy-Charts publikuje `cbpf` (enum CountryV2 bez
 * agregátov eu/all), ako ISO2 → kód API. Cyprus (cy) je v enume, ale `cbpf` preň vracia
 * 404 (overené 2026-11-06) — ostrov nemá cezhraničné vedenia. Spojené kráľovstvo = `uk` v API,
 * `GB` v Natural Earth (krajiny úsekov v snímku).
 */
export const POWER_FLOW_COUNTRIES = Object.freeze({
  AT: 'at', BA: 'ba', BE: 'be', BG: 'bg', CH: 'ch', CZ: 'cz', DE: 'de', DK: 'dk', EE: 'ee', ES: 'es', FI: 'fi', FR: 'fr', GE: 'ge', GR: 'gr',
  HR: 'hr', HU: 'hu', IE: 'ie', IT: 'it', LT: 'lt', LU: 'lu', LV: 'lv', MD: 'md', ME: 'me', MK: 'mk', NL: 'nl', NO: 'no', PL: 'pl', PT: 'pt', RO: 'ro',
  RS: 'rs', SE: 'se', SI: 'si', SK: 'sk', UA: 'ua', GB: 'uk', XK: 'xk',
});

/** Id radov susedov v odpovedi (`series[].id`) → ISO2. Neznámy sused sa zapíše do `unknownSeries`. */
export const POWER_FLOW_SERIES_ISO = Object.freeze({
  albania: 'AL', armenia: 'AM', austria: 'AT', azerbaijan: 'AZ', belarus: 'BY', belgium: 'BE', bosnia_and_herzegovina: 'BA', bosnia_herzegovina: 'BA', bulgaria: 'BG',
  croatia: 'HR', cyprus: 'CY', czech_republic: 'CZ', denmark: 'DK', estonia: 'EE', finland: 'FI', france: 'FR', georgia: 'GE', germany: 'DE',
  greece: 'GR', hungary: 'HU', ireland: 'IE', italy: 'IT', kosovo: 'XK', latvia: 'LV', lithuania: 'LT', luxembourg: 'LU', malta: 'MT',
  moldova: 'MD', montenegro: 'ME', morocco: 'MA', netherlands: 'NL', north_macedonia: 'MK', northern_ireland: 'GB', norway: 'NO', poland: 'PL',
  portugal: 'PT', romania: 'RO', russia: 'RU', serbia: 'RS', slovakia: 'SK', slovenia: 'SI', spain: 'ES', sweden: 'SE', switzerland: 'CH',
  turkey: 'TR', ukraine: 'UA', united_kingdom: 'GB', great_britain: 'GB',
});

/**
 * URL dopytu pre jednu krajinu: 36 h späť po teraz v unixových sekundách
 * (API berie `start`/`end` aj ako unix), aby po polnoci nebol rad prázdny.
 * @param {string} code kód API (`sk`)
 * @param {number} [now]
 */
export function energyChartsCbpfUrl(code, now = Date.now()) {
  const end = Math.floor(now / 1000);
  const start = Math.floor((now - POWER_FLOW_WINDOW_MS) / 1000);
  return `${ENERGY_CHARTS_CBPF_URL}?country=${encodeURIComponent(code)}&start=${start}&end=${end}`;
}

/** Kľúč dvojice: ISO2 abecedne, `AT-SK`; tok v odpovedi je vždy od prvej k druhej. */
export function powerFlowPairId(a, b) {
  const x = String(a || '').toUpperCase();
  const y = String(b || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(x) || !/^[A-Z]{2}$/.test(y) || x === y) return null;
  return x < y ? `${x}-${y}` : `${y}-${x}`;
}

/**
 * Zostav odpoveď proxy z odpovedí Energy-Charts za krajiny. Každá dvojica
 * hraníc sa môže objaviť z oboch strán — vyhrá rad s novšou poslednou
 * známou hodnotou (pri rovnosti prvý). Hodnota dvojice `A-B` je tok A → B
 * v GW (kladné A → B, záporné B → A).
 * @param {Array<{iso: string, json: object|null, error?: string|null}>} results
 * @param {{fetchedAt?: number, seriesLen?: number}} [o]
 */
export function buildPowerFlowsPayload(results, { fetchedAt = Date.now(), seriesLen = POWER_FLOW_SERIES_LEN } = {}) {
  const pairs = {};
  const unknownSeries = new Set();
  const errors = {};
  const countries = [];
  let intervalMinutes = null;
  let license = null;
  for (const result of results || []) {
    const iso = String(result?.iso || '').toUpperCase();
    if (!iso) continue;
    if (result.error || !result.json) { errors[iso] = String(result.error || 'empty'); continue; }
    const json = result.json;
    countries.push(iso);
    if (Number.isFinite(json.interval_minutes)) intervalMinutes = json.interval_minutes;
    if (typeof json.license === 'string') license = json.license;
    const series = Array.isArray(json.series) ? json.series : [];
    const data = Array.isArray(json.data) ? json.data : [];
    for (const s of series) {
      const id = String(s?.id || '');
      if (!id || id === 'sum') continue;
      const other = POWER_FLOW_SERIES_ISO[id] || null;
      if (!other) { unknownSeries.add(id); continue; }
      const pairId = powerFlowPairId(iso, other);
      if (!pairId) continue;
      const [a] = pairId.split('-');
      // kladné = dovoz do `iso` od `other`; tok A → B: keď A = iso, otočiť znamienko.
      const sign = a === iso ? -1 : 1;
      const points = [];
      for (const row of data) {
        const raw = row?.values?.[id];
        const t = Date.parse(row?.timestamp || '');
        if (!Number.isFinite(t)) continue;
        points.push({ t, gw: Number.isFinite(raw) ? Math.round(sign * raw * 1000) / 1000 : null });
      }
      const trimmed = dropTrailingPlaceholderZeros(points).slice(-seriesLen);
      const lastKnown = [...trimmed].reverse().find((p) => Number.isFinite(p.gw)) || null;
      const candidate = { id: pairId, a, b: pairId.slice(3), via: iso, latestGw: lastKnown ? lastKnown.gw : null, latestAt: lastKnown ? new Date(lastKnown.t).toISOString() : null, series: trimmed };
      const existing = pairs[pairId];
      if (!existing || (candidate.latestAt && (!existing.latestAt || candidate.latestAt > existing.latestAt))) pairs[pairId] = candidate;
    }
  }
  return {
    fetchedAt,
    unit: 'GW',
    intervalMinutes,
    countries: countries.sort(),
    pairs,
    errors,
    unknownSeries: [...unknownSeries].sort(),
    license: license || `${POWER_FLOWS_LICENSE}, attribution: energy-charts.info`,
    source: 'Energy-Charts (Fraunhofer ISE) · ENTSO-E Transparency',
    citation: `Energy-Charts.info (Fraunhofer ISE), ENTSO-E · ${POWER_FLOWS_LICENSE} · ${ENERGY_CHARTS_URL}`,
  };
}

/**
 * Dvojice hraníc, ktorých sa úsek dotýka: krajiny úseku (ISO2 v poradí pozdĺž
 * úseku, dopočítané v builde) → susedné dvojice. Úsek v jednej krajine nemá
 * žiadnu — karta povie „bez cezhraničného toku", nie číslo z inej hranice.
 * @param {object} properties
 * @returns {string[]}
 */
export function powerFlowPairIds(properties = {}) {
  const countries = Array.isArray(properties?.countries) ? properties.countries.filter((c) => /^[A-Z]{2}$/.test(String(c || ''))) : [];
  const ids = [];
  for (let i = 1; i < countries.length; i++) {
    const id = powerFlowPairId(countries[i - 1], countries[i]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/** `1,53 GW` / `830 MW` podľa veľkosti; 0 = `0 MW`. */
export function formatGw(gw, lang = 'sk') {
  if (gw === null || gw === undefined || gw === '') return '';
  const v = Number(gw);
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  if (abs >= 1) return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(abs)} GW`;
  return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(abs * 1000)} MW`;
}

/**
 * Riadky pre hover kartu (ten istý tvar ako riadky ENTSOG, aby ich kreslila
 * tá istá karta): smer podľa znamienka, hodnota, čas intervalu, sparkline
 * posledných 24 h (tok A → B so znamienkom).
 * @param {object|null} payload odpoveď proxy
 * @param {string[]} ids dvojice
 * @param {{lang?: string, translate?: (k: string, v?: object) => string}} [o]
 */
export function powerFlowRows(payload, ids, { lang = 'sk', translate = (k) => k } = {}) {
  const rows = [];
  for (const id of ids) {
    const p = payload?.pairs?.[id];
    if (!p) continue;
    const gw = Number.isFinite(p.latestGw) ? p.latestGw : null;
    const level = gw === null ? 'nodata' : (Math.abs(gw) >= 0.005 ? 'flow' : 'zero');
    const from = gw !== null && gw < 0 ? p.b : p.a;
    const to = from === p.a ? p.b : p.a;
    const at = p.latestAt ? new Date(p.latestAt) : null;
    const time = at && !Number.isNaN(at.getTime()) ? new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(at) : '';
    rows.push({
      id,
      name: translate('power.flow-border'),
      route: `${from} → ${to}`,
      dir: from === p.a ? 'ab' : 'ba',
      level,
      gw,
      text: level === 'nodata' ? translate('gas.flow-nodata') : formatGw(gw, lang),
      mcmText: '',
      dateText: at ? `${formatDateLabel(p.latestAt.slice(0, 10), lang, { year: false })} ${time}` : '',
      statusText: translate('power.flow-interval'),
      avg7Text: '',
      // Sparkline kreslí od nuly nahor — veľkosť toku bez znamienka; smer hovorí riadok.
      spark: (p.series || []).slice(-POWER_FLOW_SERIES_LEN).map((r) => (Number.isFinite(r?.gw) ? Math.abs(r.gw) : null)),
      fromIso: from,
      toIso: to,
      note: '',
    });
  }
  return { rows, citation: payload?.citation ? String(payload.citation) : '' };
}

/**
 * Stiahni odpoveď proxy (cache proxy 1 h). Chyba → výnimka; vrstva ju zaloguje
 * a karta povie „nedostupné".
 * @param {{fetcher?: typeof fetch, url?: string}} [o]
 */
export async function fetchPowerFlows({ fetcher = (...a) => fetch(...a), url = POWER_FLOWS_API } = {}) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
