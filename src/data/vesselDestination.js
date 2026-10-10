// src/data/vesselDestination.js
/**
 * @module vesselDestination
 * @description Cieľový prístav plavidla z AIS textu (2026-09-05, používateľ:
 * „Cieľový prístav lodí s čiarou a ETA"). Čisté funkcie; index prístavov sa
 * stavia z už bundlovaného World Port Index (`local_data/ports`).
 *
 * AIS pole `destination` je VOĽNÝ TEXT, ktorý píše posádka — a podľa toho aj
 * vyzerá. Namerané na živom feede 2026-09-05:
 *   `NLRTM`, `USPEF`            čistý UN/LOCODE
 *   `TH BKK`, `EG PSD`          LOCODE s medzerou
 *   `HAMBURG`, `HONG KONG`      názov prístavu
 *   `ECPSJ>JPYOK`, `USNOLA>USCHS`  celá plavba (posledný úsek je cieľ)
 *   `INCHEON@@@@@@@`, `US^09WQ>06NC`  výplň a šum
 *   `MIZUSHIMA JAPAN`           názov + krajina
 *   `PERAMA`, `SAR`             skratky, ktoré nepatria nikam
 * Preto: rozobrať posledný úsek, skúsiť LOCODE, potom presný názov, potom
 * názov ako prefix. Čo sa nechytí, ostáva len textom na karte — NIKDY sa
 * nehádže čiara na „najbližší podobný" prístav (pravidlo 2).
 */

/** Nad touto vzdialenosťou je zhoda podozrivá — plavidlo tam nedopláva rozumne (km). */
export const MAX_DESTINATION_DISTANCE_KM = 22_000;
/** Pod touto rýchlosťou ETA nepočítame (uzly) — loď stojí alebo manévruje. */
export const MIN_ETA_SPEED_KT = 1.0;
const KT_TO_KMH = 1.852;
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Vyčistí AIS text a vráti POSLEDNÝ úsek plavby (za `>`). Pure.
 * @param {string|null} raw
 * @returns {string} veľkými písmenami, bez výplne; '' keď nezostane nič
 */
export function normalizeDestination(raw) {
  const text = String(raw ?? '').toUpperCase();
  if (!text.trim()) return '';
  // Výplňové znaky AIS (@ je NULL v 6-bitovom kódovaní) a riadiace symboly.
  const cleaned = text.replace(/[@^_*]+/g, ' ').replace(/[^A-Z0-9 >/.,-]+/g, ' ');
  // Posledný úsek plavby: 'ECPSJ>JPYOK' → 'JPYOK'; podporuje aj '>>' a '->'.
  const legs = cleaned.split(/-?>+/).map((s) => s.trim()).filter(Boolean);
  const last = legs.length ? legs[legs.length - 1] : '';
  return last.replace(/\s{2,}/g, ' ').replace(/[\s.,-]+$/, '').trim();
}

/**
 * UN/LOCODE z textu: `NLRTM`, `TH BKK`, `NL RTM` → `NLRTM`. Pure.
 * @param {string} text už normalizovaný
 * @returns {string|null}
 */
export function parseLocode(text) {
  const s = String(text ?? '').trim();
  const compact = /^([A-Z]{2})\s?([A-Z0-9]{3})$/.exec(s);
  if (compact) return `${compact[1]}${compact[2]}`;
  return null;
}

/** Kľúč názvu: bez diakritiky, len písmená a číslice. Pure. */
export function nameKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Index prístavov pre vyhľadanie. Pure.
 * @param {Array<{id: string, geometry: {coordinates: number[]}, properties: object}>} features
 * @returns {{byLocode: Map<string, object>, byName: Map<string, object>, byNameCountry: Map<string, object>, size: number}}
 */
export function buildPortIndex(features) {
  const byLocode = new Map();
  const byName = new Map();
  const byNameCountry = new Map();
  /** Všetky prístavy s rovnakým názvom (Wilmington NC aj DE) — pre rozlíšenie podľa textu. */
  const byNameAll = new Map();
  for (const feature of Array.isArray(features) ? features : []) {
    const [lon, lat] = feature?.geometry?.coordinates || [];
    const props = feature?.properties || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !props.name) continue;
    const port = {
      id: String(feature.id ?? ''),
      name: String(props.name),
      locode: props.locode ? String(props.locode).toUpperCase() : null,
      country: props.country ? String(props.country) : null,
      lat,
      lon,
    };
    if (port.locode && !byLocode.has(port.locode)) byLocode.set(port.locode, port);
    const key = nameKey(port.name);
    // Prvý zápis vyhráva: bundel je zoradený tak, že väčšie prístavy sú skôr,
    // a duplicitný názov („Victoria") sa nemá prepisovať náhodným posledným.
    if (key && !byName.has(key)) byName.set(key, port);
    if (key) { const list = byNameAll.get(key); if (list) list.push(port); else byNameAll.set(key, [port]); }
    // Názov + štát (posledný prístav z registra, 2026-10-10): „St Petersburg" je aj v USA.
    const nameCountry = key && port.country ? `${key}|${countryKey(port.country)}` : '';
    if (nameCountry && !byNameCountry.has(nameCountry)) byNameCountry.set(nameCountry, port);
  }
  return { byLocode, byName, byNameCountry, byNameAll, size: byLocode.size + byName.size };
}

/** Rôzne zápisy štátu v registroch lodí → názov vo World Port Index. */
const COUNTRY_ALIASES = new Map([
  ['USA', 'UNITED STATES'], ['US', 'UNITED STATES'], ['UNITED STATES OF AMERICA', 'UNITED STATES'],
  ['UK', 'UNITED KINGDOM'], ['GREAT BRITAIN', 'UNITED KINGDOM'], ['RUSSIAN FEDERATION', 'RUSSIA'],
  ['KOREA', 'SOUTH KOREA'], ['REPUBLIC OF KOREA', 'SOUTH KOREA'], ['UAE', 'UNITED ARAB EMIRATES'],
  ['TURKIYE', 'TURKEY'], ['NETHERLANDS THE', 'NETHERLANDS'], ['THE NETHERLANDS', 'NETHERLANDS'],
]);

/** Kľúč štátu (bez diakritiky, aliasy). Pure. */
export function countryKey(country) {
  const key = nameKey(country);
  return COUNTRY_ALIASES.get(key) || key;
}

/** Varianty názvu: SAINT ↔ ST ↔ SANKT, PETERSBURG ↔ PETERBURG, bez prípony PORT. Pure. */
export function portNameVariants(name) {
  const key = nameKey(name);
  if (!key) return [];
  const out = new Set([key]);
  const swaps = [[/^SAINT /, 'ST '], [/^ST /, 'SAINT '], [/^SAINT /, 'SANKT '], [/^ST /, 'SANKT '], [/^SANKT /, 'SAINT ']];
  for (const [re, to] of swaps) if (re.test(key)) out.add(key.replace(re, to));
  for (const v of [...out]) if (/PETERSBURG/.test(v)) out.add(v.replace('PETERSBURG', 'PETERBURG'));
  for (const v of [...out]) if (/ PORT$/.test(v)) out.add(v.replace(/ PORT$/, ''));
  return [...out];
}

/**
 * Prístav podľa názvu A štátu (posledný prístav z registra). Bez štátu alebo
 * bez zhody null — nikdy nehádať prístav s rovnakým menom inde. Pure.
 * @param {string} name napr. „Saint Petersburg"
 * @param {string} country napr. „Russia"
 * @param {{byNameCountry?: Map}} index
 */
export function matchPortByNameCountry(name, country, index) {
  if (!index?.byNameCountry || !country) return null;
  const c = countryKey(country);
  for (const variant of portNameVariants(name)) {
    const port = index.byNameCountry.get(`${variant}|${c}`);
    if (port) return port;
  }
  return null;
}

/**
 * Priebeh plavby z posledného prístavu cez polohu lode do cieľa (po
 * veľkokružnici — nie plavebná trasa, preto len orientačne). Pure.
 * @returns {?{fractionDone: number, sailedKm: number, remainingKm: number}}
 */
export function voyageProgress(origin, vessel, destination) {
  const sailedKm = greatCircleKm(origin?.lat, origin?.lon, vessel?.lat, vessel?.lon);
  const remainingKm = greatCircleKm(vessel?.lat, vessel?.lon, destination?.lat, destination?.lon);
  if (sailedKm === null || remainingKm === null) return null;
  const total = sailedKm + remainingKm;
  if (total < 1 || total > MAX_DESTINATION_DISTANCE_KM * 1.5) return null;
  return { fractionDone: sailedKm / total, sailedKm, remainingKm };
}

/**
 * Nájde prístav pre AIS cieľ. Pure.
 * @param {string|null} destination surový AIS text
 * @param {{byLocode: Map, byName: Map}} index
 * @returns {?{port: object, matchedBy: 'locode'|'name'|'prefix', text: string}}
 */
export function matchDestinationPort(destination, index) {
  const text = normalizeDestination(destination);
  if (!text || !index?.byLocode || !index?.byName) return null;
  const locode = parseLocode(text);
  if (locode) {
    const port = index.byLocode.get(locode);
    if (port) return { port, matchedBy: 'locode', text };
  }
  const key = nameKey(text);
  if (!key) return null;
  const exact = index.byName.get(key);
  if (exact) return { port: exact, matchedBy: 'name', text };
  // Prefix s dovetkom: „WILMINGTON NC USA" — dovetok (štát, americký štát) rozlíši
  // rovnomenné prístavy; bez rozlíšenia ostáva prvý (väčší) ako doteraz.
  const pick = (candidate, rest) => disambiguatePort(index.byNameAll?.get(candidate), rest) || index.byName.get(candidate);
  // `MIZUSHIMA JAPAN` → prístav `MIZUSHIMA`: skús postupne kratšie prefixy,
  // ale nikdy nie kratšie ako 4 znaky (inak by `SAR` chytilo hocičo).
  const words = key.split(' ');
  for (let take = words.length - 1; take >= 1; take -= 1) {
    const candidate = words.slice(0, take).join(' ');
    if (candidate.length < 4) break;
    const port = index.byName.get(candidate) ? pick(candidate, words.slice(take)) : null;
    if (port) return { port, matchedBy: 'prefix', text };
  }
  return null;
}

/**
 * Pobrežné štáty USA (skratka z AIS cieľa) → obdĺžnik [juh, západ, sever, východ].
 * „WILMINGTON.NC.USA" je Severná Karolína, nie Delaware.
 */
const US_STATE_BOXES = {
  AL: [30, -88.6, 35, -84.9], AK: [51, -180, 72, -129], CA: [32.4, -124.6, 42.1, -114], CT: [40.9, -73.8, 42.1, -71.7],
  DE: [38.4, -75.9, 39.9, -75], FL: [24.4, -87.7, 31.1, -79.9], GA: [30.3, -85.7, 35.1, -80.7], HI: [18.8, -160.5, 22.4, -154.7],
  IL: [36.9, -91.6, 42.6, -87.4], IN: [37.7, -88.2, 41.8, -84.7], LA: [28.8, -94.1, 33.1, -88.8], ME: [43, -71.2, 47.5, -66.9],
  MD: [37.9, -79.5, 39.8, -75], MA: [41.2, -73.6, 42.9, -69.9], MI: [41.6, -90.5, 48.4, -82.1], MN: [43.4, -97.3, 49.4, -89.4],
  MS: [30.1, -91.7, 35, -88.1], NH: [42.6, -72.6, 45.4, -70.6], NJ: [38.9, -75.6, 41.4, -73.8], NY: [40.4, -79.8, 45.1, -71.8],
  NC: [33.8, -84.4, 36.6, -75.4], OH: [38.4, -84.9, 42, -80.5], OR: [41.9, -124.7, 46.3, -116.4], PA: [39.7, -80.6, 42.3, -74.6],
  RI: [41.1, -71.9, 42.1, -71.1], SC: [32, -83.4, 35.3, -78.5], TX: [25.8, -106.7, 36.6, -93.5], VA: [36.5, -83.7, 39.5, -75.2],
  WA: [45.5, -124.9, 49.1, -116.9], WI: [42.4, -92.9, 47.1, -86.2],
};

/**
 * Z viacerých rovnomenných prístavov vyber ten, na ktorý ukazuje dovetok cieľa
 * (štát „USA", „JAPAN" alebo skratka amerického štátu „NC"). Len jednoznačná
 * zhoda, inak null. Pure.
 * @param {object[]|undefined} candidates
 * @param {string[]} restWords slová za názvom
 */
export function disambiguatePort(candidates, restWords) {
  if (!Array.isArray(candidates) || candidates.length < 2 || !restWords?.length) return null;
  let pool = candidates;
  const countries = new Set(restWords.map((w) => countryKey(w)));
  const byCountry = pool.filter((p) => p.country && countries.has(countryKey(p.country)));
  if (byCountry.length) pool = byCountry;
  for (const word of restWords) {
    const box = US_STATE_BOXES[word];
    if (!box) continue;
    const inState = pool.filter((p) => p.lat >= box[0] && p.lat <= box[2] && p.lon >= box[1] && p.lon <= box[3]);
    if (inState.length) pool = inState;
  }
  return pool.length === 1 ? pool[0] : null;
}

/** Veľkokružnicová vzdialenosť v km. Pure. */
export function greatCircleKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Plavba k cieľu: vzdialenosť po veľkokružnici a ETA z rýchlosti nad zemou.
 * Vracia null, keď zhoda vyzerá nezmyselne ďaleko. Pure.
 * @param {{lat: number, lon: number, speedKt?: number|null}} vessel
 * @param {{lat: number, lon: number}} port
 * @returns {?{distanceKm: number, etaHours: number|null, etaMs: number|null}}
 */
export function voyageToPort(vessel, port, nowMs = Date.now()) {
  const distanceKm = greatCircleKm(vessel?.lat, vessel?.lon, port?.lat, port?.lon);
  if (distanceKm === null || distanceKm > MAX_DESTINATION_DISTANCE_KM) return null;
  const speedKt = Number(vessel?.speedKt);
  const moving = Number.isFinite(speedKt) && speedKt >= MIN_ETA_SPEED_KT;
  const etaHours = moving ? distanceKm / (speedKt * KT_TO_KMH) : null;
  return {
    distanceKm,
    etaHours,
    etaMs: etaHours === null ? null : nowMs + etaHours * 3_600_000,
  };
}

/**
 * Riadok karty: `→ ROTTERDAM (NLRTM) · 412 km · ETA 21 h`. Pure.
 * @param {?{port: object, matchedBy: string}} match
 * @param {?{distanceKm: number, etaHours: number|null}} voyage
 * @param {(key: string, vars?: object) => string} translate
 * @returns {string}
 */
export function destinationCardLine(match, voyage, translate) {
  if (!match?.port) return '';
  const t = typeof translate === 'function' ? translate : (k) => k;
  const label = match.port.locode ? `${match.port.name} (${match.port.locode})` : match.port.name;
  const parts = [`→ ${label}`];
  if (voyage) {
    parts.push(t('vessel.km-to-go', { km: Math.round(voyage.distanceKm).toLocaleString('sk-SK').replace(/ /g, ' ') }));
    if (voyage.etaHours !== null) {
      parts.push(voyage.etaHours >= 24
        ? t('vessel.eta-days', { days: Math.round(voyage.etaHours / 24) })
        : t('vessel.eta-hours', { hours: Math.max(1, Math.round(voyage.etaHours)) }));
    }
  }
  return parts.join(' · ');
}
