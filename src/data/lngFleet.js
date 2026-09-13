// src/data/lngFleet.js
/**
 * @module lngFleet
 * @description LNG tankery v dosahu AIS (modul PLYN, etapa 8, 2026-09-13;
 * používateľ: „LNG flotila cez AIS", „pokračuj"). Zo živých kontaktov AIS
 * (úložisko AISStream na serveri, pozemné prijímače = len pobrežia a prístavy)
 * vyberie LNG tankery: **potvrdené** = IMO alebo MMSI v zozname Wikidata
 * (CC0, `local_data/lng_fleet/lng-carriers.json`, ~tretina svetovej flotily),
 * **pravdepodobné** = tanker podľa AIS typu + silné meno (LNG, GasLog, Maran
 * Gas, Methane, Golar, FSRU…) alebo dĺžka ≥ 250 m so slabším menom či cieľom
 * na LNG termináli. Nič iné sa LNG nenazve. Modul je čistý (bez i18n a DOM),
 * importuje ho aj server (klasifikácia beží v proxy nad úložiskom).
 */
export const GAS_LNG_FLEET_API = '/api/gas/lng-fleet';
/** Lode sa hýbu: karta sa obnovuje častejšie než ceny (10 min), ale len z úložiska servera. */
export const LNG_FLEET_REFRESH_MS = 10 * 60 * 1000;
export const LNG_FLEET_MIN_LENGTH_M = 250;
export const LNG_FLEET_FRESH_MS = 10 * 60_000;
export const LNG_FLEET_MAX_ROWS = 60;

/** Silné mená: flotily, ktoré vozia len LNG (GasLog, Maran Gas, Golar, Dynagas „Clean …", Yamal Arc7, FSRU/Energos). */
export const LNG_NAME_STRONG_RE = /\bLNG\b|\bLNGC\b|GASLOG|MARAN GAS|\bMETHANE\b|\bGOLAR\b|\bFSRU\b|\bENERGOS\b|DIAMOND GAS|LNGSHIPS|GDF SUEZ|\bYAMAL\b|\bCLEAN (?:ENERGY|OCEAN|PLANET|HORIZON|VISION|SEA|FORCE|POWER|GALAXY)\b|\b(?:CADIZ|BILBAO|SEVILLA|VALENCIA|IBERICA|BARCELONA|LA MANCHA|RIOJA|RIBERA DEL DUERO|TRABZON|ADRIANO) KNUTSEN\b|CHRISTOPHE DE MARGERIE|BORIS VILKITSKY|FEDOR LITKE|EDUARD TOLL|RUDOLF SAMOYLOVICH|NIKOLAY YEVGENOV|VLADIMIR RUSANOV|VLADIMIR VIZE|GEORGIY BRUSILOV|YAKOV GAKKEL|NIKOLAY ZUBOV|VLADIMIR VORONIN|NIKOLAY URVANTSEV/;
/**
 * Slabé mená: prefixy flotíl, ktoré vozia LNG, ale nie výlučne — platia len
 * s AIS typom tanker a dĺžkou ≥ 250 m. Zámerne BEZ prefixov, ktoré majú aj
 * veľké ropné tankery (Minerva, Energy, Pacific, SK, Stena, Sonangol,
 * Knutsen shuttle) — prvý živý beh chytil MINERVA PELAGIA (ropný, 250 m).
 */
export const LNG_NAME_WEAK_RE = /^(?:FLEX|BW|SERI|GRACE|ARCTIC|PUTERI|CESI|HL|ASIA|CORAL|TAITAR|HYUNDAI|AL|HOEGH|CELSIUS|CASTILLO DE|EXCEL|EXEM|EXPE|EXPL|EXQU|MARVEL|LIJMILIYA|MOZAH|ZARGA|MEKAINES|AAMIRA|RASHEEDA|SHAGRA|ONAIZA|BU SAMRA|UMM |DUHAIL|TEMBEK|GALEA|GALLINA|GEMMATA|MAGDALA|ISH|TANGGUH|WOODSIDE|NORTHWEST|GRAND|OB RIVER|AMUR RIVER|NEVA RIVER|KOOL|PROVALYS|GASELYS)\b/;
/** Ciele LNG terminálov (názvy aj LOCODE); EÚ podmnožina rozhoduje o „smeruje do EÚ". */
export const LNG_EU_TERMINAL_RE = /SWINOUJSCIE|PLSWI|KLAIPEDA|LTKLJ|\bGATE\b|MAASVLAKTE|EEMSHAVEN|NLEEM|WILHELMSHAVEN|DEWVN|BRUNSBUTTEL|BRUNSB|DEBRB|\bSTADE\b|DESTA|MUKRAN|LUBMIN|SASSNITZ|ZEEBRUGGE|BEZEE|DUNKERQUE|DUNKIRK|FRDKK|MONTOIR|FRMTX|\bFOS\b|FRFOS|BARCELONA|ESBCN|SAGUNTO|ESSAG|HUELVA|ESHUV|CARTAGENA|ESCAR|BILBAO|ESBIO|MUGARDOS|FERROL|ESFRO|\bSINES\b|PTSIE|PANIGAGLIA|LA SPEZIA|ITSPE|PORTO LEVANTE|ROVIGO|ADRIATIC LNG|LIVORNO|ITLIV|\bOLT\b|PIOMBINO|ITPIO|RAVENNA|ITRAN|REVITHOUSSA|REVYTHOUSSA|REVITHOUSA|ALEXANDROUPOLI|GRAXD|\bKRK\b|OMISALJ|HROMI|\bINKOO\b|FIINK|HAMINA|FIHMN|ROTTERDAM|NLRTM|ANTWERP|BEANR|GDANSK|PLGDN|SWINO/;
export const LNG_TERMINAL_RE = new RegExp(`${LNG_EU_TERMINAL_RE.source}|SABINE|CAMERON|CORPUS CHRISTI|FREEPORT|COVE POINT|CALCASIEU|PLAQUEMINES|ELBA|RAS LAFFAN|QARAS|BONNY|SKIKDA|ARZEW|BETHIOUA|SNOHVIT|MELKOYA|HAMMERFEST|SABETTA|PORTOVAYA|VYSOTSK|MURMANSK|ISLE OF GRAIN|GBGRA|SOUTH HOOK|MILFORD HAVEN|GBMLF|DRAGON LNG|ALIAGA|MARMARA EREGLISI|BILBAO|LNG`, 'i');
/**
 * Prísne ciele pre KLASIFIKÁCIU (tanker ≥ 250 m + tento cieľ = pravdepodobne
 * LNG): len miesta, kde je LNG terminál tým hlavným, čo tam veľký tanker
 * hľadá. Všeobecné prístavy (Rotterdam, Antverpy, Barcelona, Zeebrugge, Fos,
 * Gdańsk…) tu zámerne nie sú — prvý živý beh označil ropný tanker do
 * Rotterdamu; tie ostávajú len v LNG_EU_TERMINAL_RE pre „smeruje do EÚ".
 */
export const LNG_TERMINAL_STRICT_RE = /SWINOUJSCIE|PLSWI|SWINO|KLAIPEDA|LTKLJ|\bGATE\b|MAASVLAKTE|EEMSHAVEN|NLEEM|WILHELMSHAVEN|DEWVN|BRUNSBUTTEL|BRUNSB|DEBRB|\bSTADE\b|DESTA|MUKRAN|LUBMIN|SASSNITZ|MONTOIR|FRMTX|FOS CAVAOU|FOS TONKIN|SAGUNTO|ESSAG|MUGARDOS|FERROL|ESFRO|PANIGAGLIA|ITSPE|PORTO LEVANTE|ROVIGO|ADRIATIC LNG|\bOLT\b|PIOMBINO|ITPIO|REVITHOUSSA|REVYTHOUSSA|REVITHOUSA|ALEXANDROUPOLI|GRAXD|\bKRK\b|OMISALJ|HROMI|\bINKOO\b|FIINK|ISLE OF GRAIN|GBGRA|SOUTH HOOK|MILFORD HAVEN|GBMLF|DRAGON LNG|SABINE|CAMERON LNG|COVE POINT|CALCASIEU|PLAQUEMINES|ELBA ISLAND|RAS LAFFAN|QARAS|BONNY|SKIKDA|ARZEW|BETHIOUA|SNOHVIT|MELKOYA|HAMMERFEST|SABETTA|PORTOVAYA|MARMARA EREGLISI|\bLNG\b/;

const digits = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Index zoznamu Wikidata podľa IMO a MMSI.
 * @param {{rows?: Array<{imo: string, mmsi?: string[], name?: string|null, lengthM?: number|null, built?: string|null, operator?: string|null}>, ships?: number, withMmsi?: number, snapshot?: string, license?: string}|null} fleet
 */
export function buildLngFleetIndex(fleet) {
  const byImo = new Map();
  const byMmsi = new Map();
  for (const ship of Array.isArray(fleet?.rows) ? fleet.rows : []) {
    const imo = digits(ship?.imo);
    if (imo) byImo.set(imo, ship);
    for (const m of Array.isArray(ship?.mmsi) ? ship.mmsi : []) { const mm = digits(m); if (mm) byMmsi.set(mm, ship); }
  }
  return { byImo, byMmsi, ships: byImo.size, withMmsi: fleet?.withMmsi ?? null, snapshot: fleet?.snapshot ?? null, license: fleet?.license ?? null };
}

/**
 * AIS typ: 80–89 = tanker (true); známy iný typ (false); neznámy (null).
 * @param {string|number|null|undefined} type
 */
export function isTankerType(type) {
  if (type === null || type === undefined || type === '') return null;
  const n = Number(type);
  if (Number.isFinite(n)) return n === 0 ? null : (n >= 80 && n <= 89);
  return /tanker/i.test(String(type)) ? true : false;
}

/**
 * Prečo je kontakt LNG tanker — alebo null.
 * @param {object} row riadok úložiska AIS ({ mmsi, imo, name, type, destination, length_m | lengthM })
 * @param {ReturnType<typeof buildLngFleetIndex>} index
 * @returns {{confidence: 'confirmed'|'likely', reason: string, ship: object|null}|null}
 */
export function classifyLngContact(row, index) {
  const imo = digits(row?.imo);
  const mmsi = digits(row?.mmsi);
  if (imo && index?.byImo?.has(imo)) return { confidence: 'confirmed', reason: 'wikidata-imo', ship: index.byImo.get(imo) };
  if (mmsi && index?.byMmsi?.has(mmsi)) return { confidence: 'confirmed', reason: 'wikidata-mmsi', ship: index.byMmsi.get(mmsi) };
  const tanker = isTankerType(row?.type);
  if (tanker === false) return null;
  const name = String(row?.name || '').toUpperCase().trim();
  if (name && LNG_NAME_STRONG_RE.test(name)) return { confidence: 'likely', reason: 'name', ship: null };
  const len = Number(row?.length_m ?? row?.lengthM);
  if (tanker === true && Number.isFinite(len) && len >= LNG_FLEET_MIN_LENGTH_M) {
    if (LNG_NAME_WEAK_RE.test(name)) return { confidence: 'likely', reason: 'name-size', ship: null };
    if (LNG_TERMINAL_STRICT_RE.test(String(row?.destination || '').toUpperCase())) return { confidence: 'likely', reason: 'terminal-size', ship: null };
  }
  return null;
}

const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Serverová zostava: prefiltrované riadky (len LNG) + stav feedu + údaje o zozname.
 * @param {Iterable<object>} rows riadky úložiska AISStream
 * @param {ReturnType<typeof buildLngFleetIndex>} index
 * @param {{now?: number, feed?: object}} [o]
 */
export function buildLngFleetPayload(rows, index, { now = Date.now(), feed = null } = {}) {
  const out = [];
  let scanned = 0;
  for (const row of rows || []) {
    scanned += 1;
    const cls = classifyLngContact(row, index);
    if (!cls) continue;
    const epoch = finite(row.last_position_epoch ?? row.lastPositionEpoch);
    out.push({
      mmsi: String(row.mmsi ?? ''),
      name: String(row.name || '').trim() || null,
      imo: digits(row.imo) || null,
      confidence: cls.confidence,
      reason: cls.reason,
      ship: cls.ship ? { name: cls.ship.name ?? null, built: cls.ship.built ?? null, operator: cls.ship.operator ?? null, lengthM: cls.ship.lengthM ?? null } : null,
      type: row.type ?? null,
      lengthM: finite(row.length_m ?? row.lengthM),
      draughtM: finite(row.draught_m ?? row.draughtM),
      speedKts: finite(row.speed ?? row.speed_kn ?? row.sog),
      course: finite(row.course ?? row.cog),
      navStatus: row.nav_status ?? row.navStatus ?? null,
      destination: row.destination ? String(row.destination).trim() : null,
      eta: row.eta ? String(row.eta) : null,
      lat: finite(row.lat),
      lon: finite(row.lon),
      lastPositionEpoch: epoch,
      positionState: epoch && now - epoch * 1000 < LNG_FLEET_FRESH_MS ? 'fresh' : 'last-known',
    });
  }
  out.sort((a, b) => (a.confidence === b.confidence ? String(a.name).localeCompare(String(b.name)) : (a.confidence === 'confirmed' ? -1 : 1)));
  return {
    rows: out.slice(0, LNG_FLEET_MAX_ROWS),
    counts: { scanned, lng: out.length, confirmed: out.filter((r) => r.confidence === 'confirmed').length, likely: out.filter((r) => r.confidence === 'likely').length },
    feed: feed || null,
    fleet: { ships: index?.ships ?? 0, withMmsi: index?.withMmsi ?? null, snapshot: index?.snapshot ?? null, license: index?.license ?? null },
    fetchedAt: now,
    source: 'AISStream (terrestrial AIS, this session) · Wikidata LNG carrier list (CC0)',
  };
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');
const fmt = (v, lang, digits = 0) => new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

/** Vek poslednej polohy v minútach/hodinách pre laika. */
export function formatAge(epochSec, nowMs, translate = (k) => k) {
  if (!Number.isFinite(epochSec)) return '';
  const min = Math.max(0, Math.round((nowMs - epochSec * 1000) / 60_000));
  return min < 60 ? translate('gas.fleet-age-min', { n: min }) : translate('gas.fleet-age-h', { n: Math.round(min / 60) });
}

/** Stav feedu AIS pre kartu: off (feed nebeží, zapína ho vrstva lodí), missing-key, live, connecting, error. */
export function fleetFeedState(feed) {
  if (!feed) return 'off';
  if (feed.status === 'missing-key') return 'missing-key';
  if (!feed.active) return 'off';
  if (feed.status === 'live') return 'live';
  // Stavy strážcu AISStream (aisWatchdog.js): auth-failed / down / unsupported sú chyby, connecting / reconnecting čakanie.
  if (feed.error || ['auth-failed', 'down', 'unsupported'].includes(feed.status)) return 'error';
  return feed.status === 'idle' ? 'off' : 'connecting';
}

/**
 * Model karty LNG TANKERY.
 * @param {ReturnType<typeof buildLngFleetPayload>|null} payload
 * @param {{lang?: string, translate?: Function, nowMs?: number, flagOf?: (mmsi: string) => string|null}} [o]
 */
export function buildLngFleetModel(payload, { lang = 'sk', translate = (key) => key, nowMs = Date.now(), flagOf = () => null } = {}) {
  const t = translate;
  const state = fleetFeedState(payload?.feed);
  const rows = (Array.isArray(payload?.rows) ? payload.rows : []).map((r) => {
    const euBound = LNG_EU_TERMINAL_RE.test(String(r.destination || '').toUpperCase());
    const moving = Number.isFinite(r.speedKts) && r.speedKts >= 1;
    const dest = r.destination ? `${r.destination}${r.eta ? ` · ETA ${r.eta}` : ''}` : t('gas.fleet-no-destination');
    const size = [Number.isFinite(r.lengthM) ? `${fmt(r.lengthM, lang)} m` : null, r.ship?.built ? t('gas.fleet-built', { y: r.ship.built }) : null].filter(Boolean).join(' · ');
    return {
      mmsi: r.mmsi,
      name: r.name || (r.ship?.name ?? `MMSI ${r.mmsi}`),
      flag: flagOf(r.mmsi) || null,
      confidence: r.confidence,
      confidenceText: t(r.confidence === 'confirmed' ? 'gas.fleet-confirmed' : 'gas.fleet-likely'),
      reasonText: t(`gas.fleet-reason-${r.reason}`),
      euBound,
      moving,
      speedText: Number.isFinite(r.speedKts) ? t('gas.fleet-speed', { v: fmt(r.speedKts, lang, 1) }) : '',
      destinationText: dest,
      sizeText: size,
      operator: r.ship?.operator || null,
      ageText: formatAge(r.lastPositionEpoch, nowMs, t),
      positionState: r.positionState,
      lat: r.lat,
      lon: r.lon,
      level: r.positionState === 'fresh' ? 'ok' : 'stale',
    };
  }).sort((a, b) => (b.euBound - a.euBound) || (a.confidence === b.confidence ? 0 : (a.confidence === 'confirmed' ? -1 : 1)) || (a.positionState === b.positionState ? 0 : (a.positionState === 'fresh' ? -1 : 1)) || a.name.localeCompare(b.name));
  const counts = payload?.counts || { scanned: 0, lng: 0, confirmed: 0, likely: 0 };
  const euBound = rows.filter((r) => r.euBound).length;
  const moving = rows.filter((r) => r.moving).length;
  const fresh = rows.filter((r) => r.positionState === 'fresh').length;
  return {
    ok: state === 'live' || (state === 'connecting' && rows.length > 0) || (state === 'error' && rows.length > 0),
    state,
    headline: {
      countText: String(counts.lng),
      label: t('gas.fleet-label', { scanned: fmt(counts.scanned, lang) }),
      sub: [t('gas.fleet-confirmed-n', { n: counts.confirmed }), t('gas.fleet-likely-n', { n: counts.likely }), t('gas.fleet-eu-bound', { n: euBound }), t('gas.fleet-moving', { n: moving, fresh })].join(' · '),
    },
    rows,
    note: t('gas.fleet-note', { ships: fmt(payload?.fleet?.ships ?? 0, lang) }),
    sourceLine: t('gas.fleet-source', { date: payload?.fleet?.snapshot ? String(payload.fleet.snapshot).slice(0, 10) : '—' }),
    freshness: { fetchedAt: payload?.fetchedAt ?? null, feedLastMessageAt: payload?.feed?.lastMessageAt ?? null, retained: payload?.feed?.retained ?? null },
  };
}

export async function fetchLngFleet({ fetcher = (...a) => fetch(...a), url = GAS_LNG_FLEET_API } = {}) {
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    err.code = json?.error ?? null;
    throw err;
  }
  return response.json();
}
