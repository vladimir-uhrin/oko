/**
 * @module airportsData
 * @description Pure helpers for the bundled global airports dataset
 * (OurAirports, public domain — provenance in src/data/local_data/airports/).
 * The build script (scripts/build-airports.mjs) uses the filter + feature
 * mapper to produce the geojsonl snapshot and the details sidecar; the
 * localGeojson layer uses the card copy + importance; the airport card
 * (airportCard.js) uses the details formatters. One contract, tested once,
 * consumed three times.
 *
 * 2026-09-05 (používateľ: „nepáči sa mi ten štýl … vyžmýkať všetko čo sa dá
 * o danom letisku"): ambientná karta dostala vlajku štátu, kódy s mestom a
 * slovný typ s výškou v metroch; klik otvára bohatú kartu s frekvenciami
 * (veža, zem, prílet, ATIS…), dráhami, METAR/TAF, živou premávkou v okolí a
 * odkazmi (LiveATC, Wikipédia, web). Frekvencie a dráhy sú z OurAirports
 * `airport-frequencies.csv` / `runways.csv` (public domain), zapečené do
 * `airport-details.json` a načítané až pri prvom kliknutí na letisko.
 */
import { t } from '../i18n.js';

export const AIRPORTS_LAYER_ID = 'local-airports';
/** Sidecar s frekvenciami, dráhami a odkazmi (lenivo pri prvom výbere letiska). */
export const AIRPORT_DETAILS_FILE = 'airport-details.json';
const FT_TO_M = 0.3048;

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Bundle filter: large + medium airports always, small only with scheduled
 * service — 86k rows shrink to ~6k that matter on a globe. `closed` is
 * excluded EXPLICITLY: the live CSV uses the value "closed" (the data
 * dictionary's "closed_airport" is out of sync — guard both), and 8 closed
 * airports still carry scheduled_service=yes, so the flag alone is no guard.
 * Heliports, seaplane bases and balloonports are out of scope.
 * @param {object} row Parsed airports.csv row.
 * @returns {boolean}
 */
export function airportRowAccepted(row) {
  const type = cleanText(row?.type);
  if (!type || type === 'closed' || type === 'closed_airport') return false;
  if (type === 'large_airport' || type === 'medium_airport') return true;
  return type === 'small_airport' && cleanText(row?.scheduled_service) === 'yes';
}

/**
 * One airports.csv row → one bundled GeoJSON feature (or null when the row
 * has no usable identity/position). `ident` is the only always-present key
 * (812 filtered rows lack IATA, 667 ICAO, 201 elevation) — every other field
 * degrades to null and the UI tolerates the blanks.
 * @param {object} row Parsed airports.csv row.
 * @returns {object|null}
 */
export function airportFeatureFromRow(row) {
  const ident = cleanText(row?.ident);
  const lat = finite(row?.latitude_deg);
  const lon = finite(row?.longitude_deg);
  if (!ident || lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const elevFt = finite(row?.elevation_ft);
  return {
    id: ident,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name: cleanText(row?.name) || ident,
      // ident je jediné vždy prítomné ID (často = ICAO) — nesie sa aj vo
      // properties, lebo karta/METAR vidí len properties, nie feature.id.
      ident,
      icao: cleanText(row?.icao_code),
      iata: cleanText(row?.iata_code),
      // 'large_airport' → 'large' — the bundle spells the tier once.
      type: cleanText(row?.type)?.replace('_airport', '') ?? null,
      municipality: cleanText(row?.municipality),
      country: cleanText(row?.iso_country),
      elevFt: elevFt === null ? null : Math.round(elevFt),
      scheduled: cleanText(row?.scheduled_service) === 'yes',
    },
  };
}

/** Slovný typ letiska (i18n), '' pre neznámy. Pure. */
export function airportTierLabel(type, translate = t) {
  const tier = cleanText(type);
  if (!tier || !['large', 'medium', 'small'].includes(tier)) return '';
  return translate(`airport.tier.${tier}`);
}

/** Výška v metroch nad morom so stopami v zátvorke: `66 m (218 ft)`; '' bez výšky. Pure. */
export function formatElevation(elevFt) {
  const ft = finite(elevFt);
  if (ft === null) return '';
  return `${Math.round(ft * FT_TO_M)} m (${Math.round(ft)} ft)`;
}

/**
 * Card detail lines for an airport feature (ambient card):
 *   `LBG · LFPB · Paris`            kódy + mesto
 *   `Large airport · 66 m (218 ft)` slovný typ + výška
 * Every part is optional; empty lines are not emitted.
 * @param {object} props Bundled feature properties.
 * @param {(key: string) => string} [translate]
 * @returns {string[]}
 */
export function airportOverlayCopy(props, translate = t) {
  const details = [];
  const codesLine = [cleanText(props?.iata), cleanText(props?.icao), cleanText(props?.municipality)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' · ');
  if (codesLine) details.push(codesLine);
  const tierLine = [airportTierLabel(props?.type, translate), formatElevation(props?.elevFt)]
    .filter(Boolean).join(' · ');
  if (tierLine) details.push(tierLine);
  return details;
}

/**
 * Najkratšia identita letiska pre vzdialený stupeň popisu: IATA, inak ICAO,
 * inak ident. Pure.
 * @param {object} props
 * @returns {string}
 */
export function airportShortCode(props) {
  return cleanText(props?.iata) || cleanText(props?.icao) || cleanText(props?.ident) || '';
}

/**
 * Jednoriadkový popis pre stredný stupeň: `BTS · Bratislava`. Keď chýba kód
 * alebo mesto, ostane to, čo je; úplne bez oboch nastúpi názov. Pure.
 * @param {object} props
 * @returns {string}
 */
export function airportCompactLabel(props) {
  const line = [airportShortCode(props), cleanText(props?.municipality)].filter(Boolean).join(' · ');
  return line || cleanText(props?.name) || '';
}

/** ISO2 štátu pre vlajku karty (malé písmená), null bez štátu. Pure. */
export function airportTitleFlag(props) {
  const code = cleanText(props?.country)?.toLowerCase();
  return code && /^[a-z]{2}$/.test(code) ? code : null;
}

/**
 * Label-cohort importance: hubs first. Feeds the shared local-layer label
 * priority so a zoomed-out view names Bratislava and Vienna, not airstrips.
 * @param {object} props Bundled feature properties.
 * @returns {number}
 */
export function airportImportance(props) {
  const type = cleanText(props?.type);
  if (type === 'large') return 300;
  if (type === 'medium') return 150;
  if (type === 'small') return 60;
  return 0;
}

// ── Details sidecar (frequencies, runways, links) ──────────────────────────

/** Poradie skupín frekvencií na karte — čo pilot ladí ako prvé. */
export const FREQUENCY_GROUP_ORDER = Object.freeze([
  'ATIS', 'TWR', 'GND', 'DEL', 'CLD', 'APP', 'DEP', 'A/D', 'AFIS', 'CTAF', 'UNIC', 'MF', 'ATF', 'APRON', 'RMP', 'FSS', 'RDO', 'INFO',
]);
/** Najviac riadkov frekvencií na karte; zvyšok ako „+N". */
export const FREQUENCY_ROWS_MAX = 12;

/**
 * Sidecar záznam jedného letiska z troch OurAirports tabuliek. Pure.
 * @param {object} airportRow airports.csv riadok
 * @param {object[]} frequencyRows airport-frequencies.csv riadky tohto letiska
 * @param {object[]} runwayRows runways.csv riadky tohto letiska
 * @returns {{region: string|null, web: string|null, wiki: string|null, gps: string|null, local: string|null, freq: Array<[string,string,number]>, rwy: Array<[string,string,number|null,number|null,string|null,number,number,number|null,number|null]>}}
 */
export function airportDetailsFromRows(airportRow, frequencyRows = [], runwayRows = []) {
  const freq = frequencyRows
    .map((r) => [cleanText(r?.type) || 'MISC', cleanText(r?.description) || '', finite(r?.frequency_mhz)])
    .filter((f) => f[2] !== null && f[2] > 0)
    .sort((a, b) => frequencyGroupRank(a[0]) - frequencyGroupRank(b[0]) || a[2] - b[2]);
  const rwy = runwayRows
    .map((r) => [
      cleanText(r?.le_ident) || '', cleanText(r?.he_ident) || '',
      finite(r?.length_ft), finite(r?.width_ft), cleanText(r?.surface),
      Number(r?.lighted) === 1 ? 1 : 0, Number(r?.closed) === 1 ? 1 : 0,
      // Pravé hlavičky oboch koncov (2026-09-05) — karta z nich a z vetra
      // v METAR odhaduje aktívnu dráhu (runwayWind.js). Časť koncov ich
      // v CSV nemá; vtedy sa odvodia z označenia (04 → 040°).
      finite(r?.le_heading_degT), finite(r?.he_heading_degT),
    ])
    .filter((r) => (r[0] || r[1]) && r[6] === 0)
    .sort((a, b) => (b[2] || 0) - (a[2] || 0));
  const web = cleanText(airportRow?.home_link);
  const wiki = cleanText(airportRow?.wikipedia_link);
  return {
    region: cleanText(airportRow?.iso_region),
    web: web && /^https?:\/\//i.test(web) ? web : null,
    wiki: wiki && /^https?:\/\//i.test(wiki) ? wiki : null,
    gps: cleanText(airportRow?.gps_code),
    local: cleanText(airportRow?.local_code),
    freq,
    rwy,
  };
}

function frequencyGroupRank(type) {
  const i = FREQUENCY_GROUP_ORDER.indexOf(String(type || '').toUpperCase());
  return i < 0 ? FREQUENCY_GROUP_ORDER.length : i;
}

/** MHz na tri desatinné (118.1 → `118.100`), '' pre nečíslo. Pure. */
export function formatFrequencyMhz(mhz) {
  const n = finite(mhz);
  return n === null ? '' : n.toFixed(3);
}

/**
 * Riadky frekvencií pre kartu: zoradené podľa skupín, orezané na
 * FREQUENCY_ROWS_MAX s „+N" zvyškom. Pure.
 * @param {Array<[string,string,number]>} freq zo sidecaru
 * @returns {{rows: Array<{type: string, description: string, mhz: string}>, more: number}}
 */
export function frequencyRows(freq, max = FREQUENCY_ROWS_MAX) {
  const list = Array.isArray(freq) ? freq : [];
  const rows = list.slice(0, max).map(([type, description, mhz]) => ({
    type: String(type || '').toUpperCase(),
    description: String(description || ''),
    mhz: formatFrequencyMhz(mhz),
  }));
  return { rows, more: Math.max(0, list.length - rows.length) };
}

/** Povrch dráhy zo skratky OurAirports → i18n kľúč; '' pre neznámy. Pure. */
export function runwaySurfaceKey(surface) {
  const code = String(surface || '').trim().toUpperCase();
  if (!code) return '';
  if (/^(ASP|ASPH|ASF|ASPHALT|BIT|BITUMEN|MAC|TAR)/.test(code)) return 'airport.surface.asphalt';
  if (/^(CON|CONC|PEM|CEM|CONCRETE)/.test(code)) return 'airport.surface.concrete';
  if (/^(GRS|GRASS|TURF|SOD|GRE(?!V)|GREEN)/.test(code)) return 'airport.surface.grass';
  if (/^(GRV|GRVL|GRAVEL|GRE$)/.test(code)) return 'airport.surface.gravel';
  if (/^(DIRT|EARTH|SAND|CLAY|SOIL|UNPAVED|LATERITE|COR|CORAL)/.test(code)) return 'airport.surface.unpaved';
  if (/^(WATER|WAT)/.test(code)) return 'airport.surface.water';
  if (/^(ICE|SNOW)/.test(code)) return 'airport.surface.ice';
  return '';
}

/**
 * Jedna dráha ako text: `07/25 · 3 000 × 45 m · asfalt · osvetlená`. Pure.
 * @param {[string,string,number|null,number|null,string|null,number,number]} rwy zo sidecaru
 * @param {(key: string) => string} [translate]
 */
export function runwayLabel(rwy, translate = t) {
  if (!Array.isArray(rwy)) return '';
  const [le, he, lengthFt, widthFt, surface, lighted] = rwy;
  const ident = [le, he].filter(Boolean).join('/');
  const len = finite(lengthFt), wid = finite(widthFt);
  const size = len !== null
    ? `${thousands(Math.round(len * FT_TO_M))}${wid !== null ? ` × ${Math.round(wid * FT_TO_M)}` : ''} m`
    : '';
  const surfaceKey = runwaySurfaceKey(surface);
  return [ident, size, surfaceKey ? translate(surfaceKey) : '', lighted ? translate('airport.runway.lighted') : '']
    .filter(Boolean).join(' · ');
}

function thousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Odkaz na stránku letiska na LiveATC (LEN odkaz — ich podmienky zakazujú
 * použitie streamov tretími stranami, takže OKO zvuk nevkladá). Pure.
 * @param {string|null} icao
 * @returns {string|null}
 */
export function liveAtcUrl(icao) {
  const code = cleanText(icao)?.toUpperCase();
  return code && /^[A-Z0-9]{4}$/.test(code) ? `https://www.liveatc.net/search/?icao=${code}` : null;
}
