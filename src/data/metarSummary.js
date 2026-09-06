// src/data/metarSummary.js
/**
 * @module metarSummary
 * @description METAR v ľudskej reči pre kartu letiska (2026-09-05, „aby
 * užívateľ hneď vedel, aké počasie tam je").
 *
 * Surový riadok `250° 12 kt · FEW035 · 21/12 · Q1016` prečíta pilot, bežný
 * človek nie. Tento modul z TÝCH ISTÝCH polí (aviationweather.gov JSON)
 * odvodí:
 *   • titulok: „Zamračené, slabý dážď · 14 °C · vietor 12 kt zo západu",
 *   • druh počasia pre monochromatický glyf (slnko, oblak, dážď, sneh, hmla,
 *     búrka) — SVG, žiadne emoji (štýl panelu),
 *   • letovú kategóriu VFR/MVFR/IFR/LIFR — server ju posiela v `fltCat`;
 *     keď chýba, počíta sa z výšky základne oblačnosti a dohľadnosti podľa
 *     štandardných prahov (FAA/NWS).
 *
 * Čistý modul: žiadny fetch, žiadny DOM, všetko cez `translate`. METAR je
 * POZOROVANIE, nie predpoveď, a býva až hodinu staré — `stale` to hovorí.
 */

/** Letové kategórie od najlepšej po najhoršiu. */
export const FLIGHT_CATEGORIES = Object.freeze(['VFR', 'MVFR', 'IFR', 'LIFR']);

/** Po tomto veku pozorovania karta varuje (METAR vychádza hodinovo). */
export const METAR_STALE_MIN = 90;

/** Druhy počasia, ktoré má glyf — poradie = priorita pri kombinácii. */
export const WEATHER_KINDS = Object.freeze([
  'thunder', 'snow', 'rain', 'drizzle', 'fog', 'mist', 'haze',
  'overcast', 'broken', 'scattered', 'few', 'clear',
]);

const finite = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Dohľadnosť v míľach. aviationweather.gov posiela číslo alebo reťazec
 * („10+", „1/2", „6+"). Pure.
 * @param {object} report
 * @returns {number|null}
 */
export function visibilitySm(report) {
  const raw = report?.visib;
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim().replace(/\+$/, '');
  if (/^\d+\/\d+$/.test(s)) {
    const [a, b] = s.split('/').map(Number);
    return b ? a / b : null;
  }
  return finite(s);
}

/**
 * Základňa oblačnosti (ft AGL) — najnižšia vrstva BKN/OVC/VV. Pure.
 * FEW a SCT strop netvoria; to je definícia „ceiling", nie výber.
 * @param {object} report
 * @returns {number|null}
 */
export function ceilingFt(report) {
  const layers = Array.isArray(report?.clouds) ? report.clouds : [];
  let lowest = null;
  for (const layer of layers) {
    const cover = String(layer?.cover ?? '').toUpperCase();
    if (cover !== 'BKN' && cover !== 'OVC' && cover !== 'OVX' && cover !== 'VV') continue;
    const base = finite(layer?.base);
    if (base === null) continue;
    if (lowest === null || base < lowest) lowest = base;
  }
  return lowest;
}

/**
 * Letová kategória. `fltCat` zo servera má prednosť; bez neho štandardné
 * prahy: LIFR strop < 500 ft alebo dohľadnosť < 1 SM, IFR < 1 000 ft / < 3 SM,
 * MVFR ≤ 3 000 ft / ≤ 5 SM, inak VFR. Bez oboch údajov null. Pure.
 * @param {object} report
 * @returns {'VFR'|'MVFR'|'IFR'|'LIFR'|null}
 */
export function flightCategory(report) {
  const given = String(report?.fltCat ?? '').trim().toUpperCase();
  if (FLIGHT_CATEGORIES.includes(given)) return given;
  const ceil = ceilingFt(report);
  const vis = visibilitySm(report);
  if (ceil === null && vis === null) return null;
  const c = ceil === null ? Number.POSITIVE_INFINITY : ceil;
  const v = vis === null ? Number.POSITIVE_INFINITY : vis;
  if (c < 500 || v < 1) return 'LIFR';
  if (c < 1000 || v < 3) return 'IFR';
  if (c <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

/**
 * Prevládajúca oblačnosť zo správy (najhustejšia vrstva). Pure.
 * @param {object} report
 * @returns {'overcast'|'broken'|'scattered'|'few'|'clear'|null}
 */
export function cloudKind(report) {
  const layers = Array.isArray(report?.clouds) ? report.clouds : [];
  const rank = { OVC: 4, OVX: 4, VV: 4, BKN: 3, SCT: 2, FEW: 1, CLR: 0, SKC: 0, NSC: 0, NCD: 0, CAVOK: 0 };
  let best = null;
  for (const layer of layers) {
    const cover = String(layer?.cover ?? '').toUpperCase();
    if (!(cover in rank)) continue;
    if (best === null || rank[cover] > rank[best]) best = cover;
  }
  // aviationweather.gov posiela pri CAVOK/CLR PRÁZDNE `clouds` a oblohu nesie
  // samostatné pole `cover` (overené naživo na LZIB 2026-09-05: clouds [],
  // cover "CAVOK"). Bez tohto fallbacku by jasné počasie nemalo ani slovo.
  if (best === null) {
    const top = String(report?.cover ?? '').toUpperCase();
    if (top in rank) best = top;
  }
  if (best === null) return null;
  // Index = rank: 0 jasno (CLR/SKC/NSC/CAVOK), 1 FEW, 2 SCT, 3 BKN, 4 OVC/VV.
  return ['clear', 'few', 'scattered', 'broken', 'overcast'][rank[best]];
}

/**
 * Jav z `wxString` (napr. „-RA BR", „TSRA", „FZFG"). Pure.
 * @param {object} report
 * @returns {{kind: string|null, intensity: 'light'|'heavy'|null, freezing: boolean}}
 */
export function presentWeather(report) {
  const wx = String(report?.wxString ?? '').toUpperCase();
  if (!wx.trim()) return { kind: null, intensity: null, freezing: false };
  const freezing = /FZ/.test(wx);
  const intensity = /(^|\s)\+/.test(wx) ? 'heavy' : (/(^|\s)-/.test(wx) ? 'light' : null);
  let kind = null;
  if (/TS/.test(wx)) kind = 'thunder';
  else if (/SN|SG|PL|GS|GR|IC/.test(wx)) kind = 'snow';
  else if (/RA|SH|UP/.test(wx)) kind = 'rain';
  else if (/DZ/.test(wx)) kind = 'drizzle';
  else if (/FG/.test(wx)) kind = 'fog';
  else if (/BR/.test(wx)) kind = 'mist';
  else if (/HZ|FU|DU|SA|VA|SS|DS|PO/.test(wx)) kind = 'haze';
  return { kind, intensity, freezing };
}

/**
 * Druh počasia pre glyf: jav má prednosť pred oblačnosťou. Pure.
 * @param {object} report
 * @returns {string|null}
 */
export function weatherKind(report) {
  const { kind } = presentWeather(report);
  if (kind) return kind;
  return cloudKind(report);
}

/** Smer vetra ako jeden z ôsmich sektorov (kľúč i18n `wx.dir-*`). Pure. */
export function windSectorKey(dirDeg) {
  const d = finite(dirDeg);
  if (d === null) return null;
  const keys = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  return `wx.dir-${keys[Math.round((((d % 360) + 360) % 360) / 45) % 8]}`;
}

/**
 * Titulok v ľudskej reči. Pure.
 * @param {object} report
 * @param {(key: string, vars?: object) => string} translate
 * @returns {string}
 */
export function metarHeadline(report, translate) {
  if (!report || typeof report !== 'object') return '';
  const parts = [];
  const cloud = cloudKind(report);
  const wx = presentWeather(report);
  const sky = cloud ? translate(`wx.${cloud}`) : '';
  if (wx.kind) {
    let phen = translate(`wx.${wx.kind}`);
    if (wx.intensity && (wx.kind === 'rain' || wx.kind === 'snow' || wx.kind === 'drizzle')) {
      phen = translate(`wx.${wx.intensity}`, { what: phen });
    }
    if (wx.freezing) phen = translate('wx.freezing', { what: phen });
    // „Zamračené, slabý dážď" — obloha prvá, jav za čiarkou; hmla/opar stoja samy.
    const skyFirst = sky && !['fog', 'mist', 'haze'].includes(wx.kind);
    parts.push(skyFirst ? `${sky}, ${phen.toLocaleLowerCase()}` : phen);
  } else if (sky) {
    parts.push(sky);
  }
  const temp = finite(report.temp);
  if (temp !== null) parts.push(`${Math.round(temp)} °C`);
  const speed = finite(report.wspd);
  if (speed !== null) {
    const gust = finite(report.wgst);
    let wind;
    if (speed === 0) wind = translate('wx.wind-calm');
    else {
      const dirKey = windSectorKey(report.wdir);
      wind = dirKey
        ? translate('wx.wind-from', { kt: Math.round(speed), dir: translate(dirKey) })
        : translate('wx.wind-variable', { kt: Math.round(speed) });
    }
    if (gust !== null && gust > speed) wind += translate('wx.gust', { kt: Math.round(gust) });
    parts.push(wind);
  }
  return parts.join(' · ');
}

const GLYPH_PATHS = Object.freeze({
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  few: '<circle cx="9" cy="9" r="3.2"/><path d="M9 3v1.8M3 9h1.8M4.8 4.8l1.3 1.3M13.2 4.8l-1.3 1.3"/><path d="M10 19h8.5a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-1A3.5 3.5 0 0 0 10 19z"/>',
  scattered: '<circle cx="8.5" cy="8.5" r="3"/><path d="M8.5 3v1.6M3 8.5h1.6M4.6 4.6l1.1 1.1"/><path d="M9.5 19h9a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-1A3.5 3.5 0 0 0 9.5 19z"/>',
  broken: '<path d="M7 18h11a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.2A4.1 4.1 0 0 0 7 18z"/>',
  overcast: '<path d="M7 18h11a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.2A4.1 4.1 0 0 0 7 18z"/><path d="M5 21h13"/>',
  rain: '<path d="M7 15h11a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.2A4.1 4.1 0 0 0 7 15z"/><path d="M9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5"/>',
  drizzle: '<path d="M7 15h11a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.2A4.1 4.1 0 0 0 7 15z"/><path d="M9 18v.01M13 18v.01M17 18v.01M11 20.5v.01M15 20.5v.01"/>',
  snow: '<path d="M7 14h11a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.2A4.1 4.1 0 0 0 7 14z"/><path d="M9 18l1.5-1.5M9 16.5L10.5 18M13 20l1.5-1.5M13 18.5L14.5 20M17 18l1.5-1.5M17 16.5L18.5 18"/>',
  thunder: '<path d="M7 14h11a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.2A4.1 4.1 0 0 0 7 14z"/><path d="M13 14l-2.5 4h3L11 22"/>',
  fog: '<path d="M4 9h16M4 13h16M6 17h12M8 21h8"/>',
  mist: '<path d="M4 10h16M6 14h12M8 18h8"/>',
  haze: '<path d="M4 10h16M4 14h16M4 18h16" stroke-dasharray="3 2"/>',
});

/**
 * Monochromatický glyf počasia ako SVG (24×24, ťah vo farbe). Pure.
 * @param {string|null} kind
 * @param {string} [color]
 * @returns {string}
 */
export function weatherGlyphSvg(kind, color = '#e8eaed') {
  const body = GLYPH_PATHS[kind] || GLYPH_PATHS.broken;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Glyf ako data URI pre `<img src>`. Pure. */
export function weatherGlyphDataUri(kind, color) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(weatherGlyphSvg(kind, color))}`;
}

/**
 * Zhrnutie pre kartu. Pure.
 * @param {object|null} report
 * @param {number} nowMs
 * @param {(key: string, vars?: object) => string} translate
 * @returns {?{kind: string|null, category: string|null, headline: string, glyph: string, ageMin: number|null, stale: boolean}}
 */
export function metarSummary(report, nowMs, translate) {
  if (!report || typeof report !== 'object') return null;
  const headline = metarHeadline(report, translate);
  const category = flightCategory(report);
  if (!headline && !category) return null;
  const kind = weatherKind(report);
  const obs = finite(report.obsTime);
  const ageMin = obs === null || obs <= 0 ? null : Math.max(0, Math.round((nowMs - obs * 1000) / 60_000));
  return {
    kind,
    category,
    headline,
    glyph: weatherGlyphDataUri(kind),
    ageMin,
    stale: ageMin !== null && ageMin > METAR_STALE_MIN,
  };
}
