// src/data/countryFlags.js
/**
 * @module countryFlags
 * @description Vlajky štátov pre karty kontaktov (sledovaný let, karta lode,
 * kartička pod kurzorom). Požiadavka 2026-09-05: „daj tam aj zástavy/vlajky".
 *
 * Prečo SVG a nie emoji: Windows nemá emoji glyfy vlajok (Segoe UI Emoji ich
 * kreslí ako dvojicu písmen) a projektové pravidlo drží ikony mimo emoji.
 * Zdroj je MIT sada flag-icons zapečená skriptom `scripts/fetch-flags.mjs`
 * do `local_data/flags/4x3/{iso2}.svg` — každá vlajka sa načíta až keď ju
 * prvá karta potrebuje a ostáva v pamäti (≈ 250 malých obrázkov max).
 *
 * Dva čisté helpery držia mapovanie: `normalizeIso2` (adsbdb, MID tabuľka,
 * BarentsWatch… posielajú ISO2 v rôznych veľkostiach písmen) a
 * `countryIso2FromName` — OpenSky nesie len anglické MENO štátu z alokácie
 * ICAO adries („Russian Federation", „Republic of Korea"), preto je tu
 * tabuľka aliasov nad menami zo sady.
 */
import { COUNTRIES, FLAG_ICONS_VERSION } from './local_data/flags/countries.js';

export { FLAG_ICONS_VERSION };

/** Pomer strán vlajok v sade (4:3). */
export const FLAG_ASPECT = 4 / 3;
/** Rádius orezania rohov pri kreslení do canvasu (px). */
export const FLAG_CORNER_RADIUS_PX = 1.5;

// Reťazcovo, nie `new URL('./…/', import.meta.url)`: Vite ten tvar prepíše na
// asset URL a pri adresári zahodí koncovú lomku (naživo 2026-09-05:
// `…/4x3gb.svg` → SPA fallback text/html → „vlajka zlyhala").
const FLAG_DIR = `${import.meta.url.replace(/[^/]*$/, '')}local_data/flags/4x3/`;
const KNOWN = new Set(COUNTRIES.map((c) => c.code));

/** Kľúč pre porovnanie mien: bez diakritiky, malé písmená, jedna medzera. */
function nameKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_TO_ISO = new Map(COUNTRIES.map((c) => [nameKey(c.name), c.code]));

/**
 * Aliasy mien, ktoré sada nepozná doslovne: mená z alokácie ICAO/OpenSky
 * („Russian Federation"), ISO dlhé tvary („Iran, Islamic Republic of") a bežné
 * krátke tvary. Kľúče už prešli `nameKey`.
 */
const NAME_ALIASES = Object.freeze({
  'united states': 'us', 'usa': 'us', 'united states of america': 'us',
  'united kingdom': 'gb', 'great britain': 'gb', 'uk': 'gb',
  'russian federation': 'ru', 'russia': 'ru',
  'republic of korea': 'kr', 'korea, republic of': 'kr', 'south korea': 'kr', 'korea': 'kr',
  "democratic people's republic of korea": 'kp', "korea, democratic people's republic of": 'kp', 'north korea': 'kp',
  'czech republic': 'cz', 'czechia': 'cz',
  'slovakia': 'sk', 'slovak republic': 'sk',
  'turkiye': 'tr', 'turkey': 'tr',
  'iran, islamic republic of': 'ir', 'iran (islamic republic of)': 'ir', 'islamic republic of iran': 'ir', 'iran': 'ir',
  'viet nam': 'vn', 'vietnam': 'vn',
  'taiwan': 'tw', 'taiwan, province of china': 'tw',
  'china': 'cn', "people's republic of china": 'cn',
  'hong kong': 'hk', 'macao': 'mo', 'macau': 'mo',
  'bolivia (plurinational state of)': 'bo', 'bolivia': 'bo',
  'venezuela (bolivarian republic of)': 've', 'venezuela': 've',
  'moldova, republic of': 'md', 'republic of moldova': 'md', 'moldova': 'md',
  'tanzania, united republic of': 'tz', 'united republic of tanzania': 'tz', 'tanzania': 'tz',
  'syrian arab republic': 'sy', 'syria': 'sy',
  "lao people's democratic republic": 'la', 'laos': 'la',
  'brunei': 'bn', 'brunei darussalam': 'bn',
  'congo': 'cg', 'republic of the congo': 'cg', 'congo (brazzaville)': 'cg',
  'congo, the democratic republic of the': 'cd', 'democratic republic of the congo': 'cd', 'congo (kinshasa)': 'cd',
  "cote d'ivoire": 'ci', 'ivory coast': 'ci',
  'cabo verde': 'cv', 'cape verde': 'cv',
  'micronesia, federated states of': 'fm', 'federated states of micronesia': 'fm', 'micronesia': 'fm',
  'palestine': 'ps', 'state of palestine': 'ps', 'palestinian territory': 'ps', 'palestine, state of': 'ps',
  'holy see': 'va', 'vatican': 'va', 'vatican city': 'va', 'holy see (vatican city state)': 'va',
  'netherlands': 'nl', 'kingdom of the netherlands': 'nl', 'the netherlands': 'nl',
  'eswatini': 'sz', 'swaziland': 'sz',
  'myanmar': 'mm', 'burma': 'mm',
  'north macedonia': 'mk', 'macedonia': 'mk', 'the former yugoslav republic of macedonia': 'mk',
  'united arab emirates': 'ae', 'uae': 'ae',
  'bosnia and herzegovina': 'ba',
  'libya': 'ly', 'libyan arab jamahiriya': 'ly',
  'timor-leste': 'tl', 'east timor': 'tl',
  'bahamas': 'bs', 'the bahamas': 'bs',
  'gambia': 'gm', 'the gambia': 'gm',
  'philippines': 'ph', 'the philippines': 'ph',
  'falkland islands (malvinas)': 'fk',
  'saint kitts and nevis': 'kn', 'st. kitts and nevis': 'kn',
  'saint vincent and the grenadines': 'vc', 'st. vincent and the grenadines': 'vc',
  'saint lucia': 'lc', 'st. lucia': 'lc',
  'trinidad and tobago': 'tt',
  'papua new guinea': 'pg',
  'sao tome and principe': 'st',
  'kyrgyzstan': 'kg', 'kyrgyz republic': 'kg',
  'antigua and barbuda': 'ag',
  'cayman islands': 'ky', 'bermuda': 'bm', 'isle of man': 'im', 'guernsey': 'gg', 'jersey': 'je',
  'aruba': 'aw', 'curacao': 'cw', 'sint maarten (dutch part)': 'sx',
  'reunion': 're', 'new caledonia': 'nc', 'french polynesia': 'pf',
  'saudi arabia': 'sa', 'kingdom of saudi arabia': 'sa',
  'republic of ireland': 'ie', 'ireland': 'ie',
  'republic of cyprus': 'cy', 'cyprus': 'cy',
  'georgia': 'ge', 'armenia': 'am', 'azerbaijan': 'az',
  'kazakhstan': 'kz', 'uzbekistan': 'uz', 'tajikistan': 'tj', 'turkmenistan': 'tm',
  'serbia': 'rs', 'republic of serbia': 'rs', 'montenegro': 'me', 'kosovo': 'xk',
  'ukraine': 'ua', 'belarus': 'by',
});

/**
 * Normalizuje ISO 3166-1 alpha-2 kód na malé písmená; neznámy alebo prázdny
 * vstup vracia null (karta potom vlajku jednoducho nekreslí). Pure.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function normalizeIso2(value) {
  const code = String(value ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) && KNOWN.has(code) ? code : null;
}

/**
 * Anglické meno štátu (OpenSky `origin_country`, adsbdb `country_name`) → ISO2.
 * Pure; null pre neznáme meno.
 * @param {string|null|undefined} name
 * @returns {string|null}
 */
export function countryIso2FromName(name) {
  const key = nameKey(name);
  if (!key) return null;
  return NAME_ALIASES[key] || NAME_TO_ISO.get(key) || null;
}

/**
 * Prvý použiteľný ISO2 zo zoznamu kandidátov (kód alebo meno). Pure.
 * @param {...(string|null|undefined)} candidates
 * @returns {string|null}
 */
export function resolveFlagIso2(...candidates) {
  for (const candidate of candidates) {
    const iso = normalizeIso2(candidate) || countryIso2FromName(candidate);
    if (iso) return iso;
  }
  return null;
}

/**
 * URL bundlovanej SVG vlajky; null pre neznámy kód. Pure nad kódom.
 * @param {string|null|undefined} iso2
 * @returns {string|null}
 */
export function flagUrl(iso2) {
  const code = normalizeIso2(iso2);
  return code ? `${FLAG_DIR}${code}.svg` : null;
}

/** Šírka vlajky pre danú výšku (px). */
export function flagWidth(heightPx) {
  return Math.round(heightPx * FLAG_ASPECT);
}

/** @type {Map<string, {image: any, ready: boolean, failed: boolean}>} */
const _images = new Map();
/** @type {(() => void)|null} Zavolá sa, keď sa vlajka dotiahne — hostiteľ si vyžiada prekreslenie. */
let _onFlagReady = null;

/**
 * Registruje callback pre dotiahnutie vlajky (typicky requestRender scény),
 * aby karta prekreslila vlajku aj bez pohybu kamery.
 * @param {(() => void)|null} listener
 */
export function setFlagReadyListener(listener) {
  _onFlagReady = typeof listener === 'function' ? listener : null;
}

/**
 * Obrázok vlajky z cache (načíta pri prvom dopyte). Vracia null bez DOM
 * (testy, server) alebo pre neznámy kód.
 * @param {string|null|undefined} iso2
 * @param {{ imageFactory?: () => any }} [options] test seam
 * @returns {{image: any, ready: boolean, failed: boolean}|null}
 */
export function getFlagImage(iso2, options = {}) {
  const code = normalizeIso2(iso2);
  if (!code) return null;
  let entry = _images.get(code);
  if (entry) return entry;
  const factory = options.imageFactory
    || (typeof Image !== 'undefined' ? () => new Image() : null);
  if (!factory) return null;
  const image = factory();
  entry = { image, ready: false, failed: false };
  _images.set(code, entry);
  // SVG bez width/height atribútov potrebuje intrinsic rozmer, inak drawImage
  // v niektorých prehliadačoch nakreslí nič — 4:3 zodpovedá sade.
  try { image.width = 64; image.height = 48; } catch { /* test double */ }
  image.onload = () => { entry.ready = true; _onFlagReady?.(); };
  image.onerror = () => { entry.failed = true; };
  image.decoding = 'async';
  image.src = flagUrl(code);
  return entry;
}

/**
 * Nakreslí vlajku do canvasu (orezané rohy + jemný obrys), alebo — kým sa
 * obrázok ťahá — len tichý obdĺžnik rovnakej veľkosti, nech sa rozloženie
 * karty nehýbe. Vracia šírku, ktorú vlajka zaberá (0 pre neznámy kód).
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|null|undefined} iso2
 * @param {number} x ľavý okraj
 * @param {number} y horný okraj
 * @param {number} heightPx výška vlajky
 * @returns {number} zabraná šírka v px
 */
export function paintFlag(ctx, iso2, x, y, heightPx) {
  const code = normalizeIso2(iso2);
  if (!code || !ctx) return 0;
  const w = flagWidth(heightPx);
  const h = heightPx;
  const entry = getFlagImage(code);
  ctx.save();
  if (typeof ctx.beginPath === 'function' && typeof ctx.clip === 'function' && typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, FLAG_CORNER_RADIUS_PX);
    ctx.clip();
  }
  if (entry?.ready && typeof ctx.drawImage === 'function') {
    try { ctx.drawImage(entry.image, x, y, w, h); } catch { /* obrázok medzi snímkami zmizol */ }
  } else if (typeof ctx.fillRect === 'function') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  if (typeof ctx.strokeRect === 'function') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }
  return w;
}

/** Test seam: vyprázdni cache obrázkov. */
export function _resetFlagCacheForTest() {
  _images.clear();
  _onFlagReady = null;
}
