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
 * @returns {{byLocode: Map<string, object>, byName: Map<string, object>, size: number}}
 */
export function buildPortIndex(features) {
  const byLocode = new Map();
  const byName = new Map();
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
  }
  return { byLocode, byName, size: byLocode.size + byName.size };
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
  // `MIZUSHIMA JAPAN` → prístav `MIZUSHIMA`: skús postupne kratšie prefixy,
  // ale nikdy nie kratšie ako 4 znaky (inak by `SAR` chytilo hocičo).
  const words = key.split(' ');
  for (let take = words.length - 1; take >= 1; take -= 1) {
    const candidate = words.slice(0, take).join(' ');
    if (candidate.length < 4) break;
    const port = index.byName.get(candidate);
    if (port) return { port, matchedBy: 'prefix', text };
  }
  return null;
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
