// src/data/aircraftSearch.js
/**
 * @module aircraftSearch
 * @description Jednotné hľadanie lietadla (2026-10-04, vlastník: „potrebujem zjednotiť vyhľadávanie,
 * aby som našiel lietadlo" — An-124 Ruslan na prílete do Bratislavy). Z jedného textu urobí dopyt:
 * typ (Ruslan / An-124 / A124), prevádzkovateľ (Antonov → ADB), registrácia (UR-82072), volací znak
 * (ADB3017) alebo ICAO hex (508035). Rovnakú logiku používa paleta v prehliadači (živé lietadlá
 * v pamäti) aj server (celosvetové hľadanie cez adsb.lol). Čisté funkcie, bez Cesia.
 *
 * Typové označenia sú ICAO Doc 8643; mená sú ľudské (aj slovenské a prezývky), aby stačilo napísať
 * „ruslan", „mrija", „herkules" alebo „globemaster".
 */

/** ICAO typ → ľudský názov + ďalšie mená, ktoré človek napíše. Výber: nákladné obry, vojenské, bežné dopravné. */
export const AIRCRAFT_TYPES = Object.freeze([
  // Antonov
  { code: 'A124', name: 'Antonov An-124 Ruslan', aliases: ['an-124', 'an124', 'ruslan', 'condor'], maker: 'antonov' },
  { code: 'A225', name: 'Antonov An-225 Mrija', aliases: ['an-225', 'an225', 'mriya', 'mrija'], maker: 'antonov' },
  { code: 'AN22', name: 'Antonov An-22 Antej', aliases: ['an-22', 'antei', 'antej'], maker: 'antonov' },
  { code: 'AN12', name: 'Antonov An-12', aliases: ['an-12'], maker: 'antonov' },
  { code: 'AN26', name: 'Antonov An-26', aliases: ['an-26'], maker: 'antonov' },
  { code: 'AN32', name: 'Antonov An-32', aliases: ['an-32'], maker: 'antonov' },
  { code: 'AN72', name: 'Antonov An-72', aliases: ['an-72'], maker: 'antonov' },
  { code: 'AN74', name: 'Antonov An-74', aliases: ['an-74'], maker: 'antonov' },
  { code: 'A148', name: 'Antonov An-148', aliases: ['an-148'], maker: 'antonov' },
  { code: 'AN2', name: 'Antonov An-2', aliases: ['an-2', 'kukuruznik'], maker: 'antonov' },
  // Iľjušin / Tupolev
  { code: 'IL76', name: 'Iľjušin Il-76', aliases: ['il-76', 'il76', 'iljusin', 'ilyushin', 'candid'], maker: 'iljusin' },
  { code: 'IL62', name: 'Iľjušin Il-62', aliases: ['il-62'], maker: 'iljusin' },
  { code: 'IL96', name: 'Iľjušin Il-96', aliases: ['il-96'], maker: 'iljusin' },
  { code: 'T204', name: 'Tupolev Tu-204', aliases: ['tu-204'], maker: 'tupolev' },
  { code: 'T154', name: 'Tupolev Tu-154', aliases: ['tu-154'], maker: 'tupolev' },
  // Vojenské nákladné a tankovacie
  { code: 'C17', name: 'Boeing C-17 Globemaster III', aliases: ['c-17', 'globemaster'], maker: 'boeing' },
  { code: 'C5M', name: 'Lockheed C-5M Super Galaxy', aliases: ['c-5', 'c5', 'galaxy', 'super galaxy'], maker: 'lockheed' },
  { code: 'C130', name: 'Lockheed C-130 Hercules', aliases: ['c-130', 'hercules', 'herkules'], maker: 'lockheed' },
  { code: 'C30J', name: 'Lockheed C-130J Super Hercules', aliases: ['c-130j', 'super hercules', 'herkules'], maker: 'lockheed' },
  { code: 'A400', name: 'Airbus A400M Atlas', aliases: ['a400m', 'a400', 'atlas'], maker: 'airbus' },
  { code: 'C27J', name: 'Alenia C-27J Spartan', aliases: ['c-27j', 'spartan'], maker: 'leonardo' },
  { code: 'C295', name: 'Airbus C295', aliases: ['c-295', 'casa'], maker: 'airbus' },
  { code: 'K35R', name: 'Boeing KC-135 Stratotanker', aliases: ['kc-135', 'stratotanker', 'tanker'], maker: 'boeing' },
  { code: 'KC2', name: 'Embraer C-390 Millennium', aliases: ['c-390', 'kc-390', 'millennium'], maker: 'embraer' },
  { code: 'A332', name: 'Airbus A330-200 (aj MRTT)', aliases: ['a330-200', 'mrtt', 'a330'], maker: 'airbus' },
  { code: 'E3TF', name: 'Boeing E-3 Sentry (AWACS)', aliases: ['e-3', 'awacs', 'sentry'], maker: 'boeing' },
  { code: 'P8', name: 'Boeing P-8 Poseidon', aliases: ['p-8', 'poseidon'], maker: 'boeing' },
  { code: 'R135', name: 'Boeing RC-135', aliases: ['rc-135', 'rivet joint'], maker: 'boeing' },
  { code: 'Q4', name: 'Northrop RQ-4 Global Hawk', aliases: ['rq-4', 'global hawk', 'dron'], maker: 'northrop' },
  // Nákladné a veľké dopravné
  { code: 'BLCF', name: 'Boeing 747 Dreamlifter', aliases: ['dreamlifter', '747lcf'], maker: 'boeing' },
  { code: 'A3ST', name: 'Airbus Beluga', aliases: ['beluga', 'a300-600st'], maker: 'airbus' },
  { code: 'A337', name: 'Airbus BelugaXL', aliases: ['belugaxl', 'beluga xl'], maker: 'airbus' },
  { code: 'B748', name: 'Boeing 747-8', aliases: ['747-8', 'jumbo'], maker: 'boeing' },
  { code: 'B744', name: 'Boeing 747-400', aliases: ['747-400', 'jumbo', '747'], maker: 'boeing' },
  { code: 'A388', name: 'Airbus A380', aliases: ['a380', 'a380-800'], maker: 'airbus' },
  { code: 'B77W', name: 'Boeing 777-300ER', aliases: ['777-300er', '777', 'triple seven'], maker: 'boeing' },
  { code: 'B77L', name: 'Boeing 777-200LR / 777F', aliases: ['777f', '777-200lr', '777'], maker: 'boeing' },
  { code: 'B789', name: 'Boeing 787-9 Dreamliner', aliases: ['787-9', '787', 'dreamliner'], maker: 'boeing' },
  { code: 'B788', name: 'Boeing 787-8 Dreamliner', aliases: ['787-8', '787', 'dreamliner'], maker: 'boeing' },
  { code: 'A359', name: 'Airbus A350-900', aliases: ['a350', 'a350-900'], maker: 'airbus' },
  { code: 'A35K', name: 'Airbus A350-1000', aliases: ['a350-1000', 'a350'], maker: 'airbus' },
  { code: 'A333', name: 'Airbus A330-300', aliases: ['a330-300', 'a330'], maker: 'airbus' },
  { code: 'A339', name: 'Airbus A330-900neo', aliases: ['a330neo', 'a330-900'], maker: 'airbus' },
  { code: 'B763', name: 'Boeing 767-300', aliases: ['767', '767-300'], maker: 'boeing' },
  { code: 'B752', name: 'Boeing 757-200', aliases: ['757', '757-200'], maker: 'boeing' },
  { code: 'A320', name: 'Airbus A320', aliases: ['a320'], maker: 'airbus' },
  { code: 'A20N', name: 'Airbus A320neo', aliases: ['a320neo'], maker: 'airbus' },
  { code: 'A321', name: 'Airbus A321', aliases: ['a321'], maker: 'airbus' },
  { code: 'A21N', name: 'Airbus A321neo', aliases: ['a321neo'], maker: 'airbus' },
  { code: 'A319', name: 'Airbus A319', aliases: ['a319'], maker: 'airbus' },
  { code: 'B738', name: 'Boeing 737-800', aliases: ['737-800', '737'], maker: 'boeing' },
  { code: 'B38M', name: 'Boeing 737 MAX 8', aliases: ['737 max', '737max', 'max 8'], maker: 'boeing' },
  { code: 'E195', name: 'Embraer E195', aliases: ['e195', 'embraer 195'], maker: 'embraer' },
  { code: 'E190', name: 'Embraer E190', aliases: ['e190', 'embraer 190'], maker: 'embraer' },
  { code: 'AT76', name: 'ATR 72-600', aliases: ['atr 72', 'atr72', 'atr'], maker: 'atr' },
  { code: 'DH8D', name: 'De Havilland Dash 8-400', aliases: ['dash 8', 'q400'], maker: 'dehavilland' },
  { code: 'CONC', name: 'Concorde', aliases: ['concorde'], maker: 'aerospatiale' },
  // Vládne a business (štátne lety)
  { code: 'GL5T', name: 'Bombardier Global 5000', aliases: ['global 5000'], maker: 'bombardier' },
  { code: 'GLEX', name: 'Bombardier Global Express', aliases: ['global express', 'global 6000'], maker: 'bombardier' },
  { code: 'F900', name: 'Dassault Falcon 900', aliases: ['falcon 900'], maker: 'dassault' },
]);

/** Prevádzkovatelia: ICAO kód (prvé 3 znaky volacieho znaku) + mená. Výber podľa toho, čo OKO ukazuje najčastejšie. */
export const OPERATORS = Object.freeze([
  { icao: 'ADB', name: 'Antonov Airlines', aliases: ['antonov airlines', 'antonov'] },
  { icao: 'VDA', name: 'Volga-Dnepr', aliases: ['volga-dnepr', 'volga dnepr'] },
  { icao: 'MXU', name: 'Maximus Air', aliases: ['maximus'] },
  { icao: 'CLX', name: 'Cargolux', aliases: ['cargolux'] },
  { icao: 'GTI', name: 'Atlas Air', aliases: ['atlas air'] },
  { icao: 'BOX', name: 'AeroLogic', aliases: ['aerologic'] },
  { icao: 'DHK', name: 'DHL Air', aliases: ['dhl'] },
  { icao: 'FDX', name: 'FedEx', aliases: ['fedex'] },
  { icao: 'UPS', name: 'UPS Airlines', aliases: ['ups'] },
  { icao: 'RCH', name: 'US Air Force — Reach (AMC)', aliases: ['reach', 'usaf'] },
  { icao: 'NATO', name: 'NATO', aliases: ['nato'] },
  { icao: 'RYR', name: 'Ryanair', aliases: ['ryanair'] },
  { icao: 'WZZ', name: 'Wizz Air', aliases: ['wizz', 'wizzair'] },
  { icao: 'TVS', name: 'Smartwings', aliases: ['smartwings'] },
  { icao: 'LOT', name: 'LOT Polish Airlines', aliases: ['lot'] },
  { icao: 'AUA', name: 'Austrian Airlines', aliases: ['austrian'] },
  { icao: 'DLH', name: 'Lufthansa', aliases: ['lufthansa'] },
  { icao: 'THY', name: 'Turkish Airlines', aliases: ['turkish'] },
  { icao: 'UAE', name: 'Emirates', aliases: ['emirates'] },
  { icao: 'QTR', name: 'Qatar Airways', aliases: ['qatar'] },
  { icao: 'ELY', name: 'El Al', aliases: ['el al', 'elal'] },
  { icao: 'AHY', name: 'Azerbaijan Airlines', aliases: ['azal', 'azerbaijan'] },
  { icao: 'BAW', name: 'British Airways', aliases: ['british airways', 'speedbird'] },
  { icao: 'AFR', name: 'Air France', aliases: ['air france'] },
  { icao: 'KLM', name: 'KLM', aliases: ['klm'] },
]);

/** Zloží diakritiku, malé písmená, len písmená/číslice/medzera — „Iľjušin" ~ „iljusin", „An-124" ~ „an 124". */
export function foldAircraftText(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const compact = value => foldAircraftText(value).replace(/ /g, '');

const HEX_RE = /^[0-9a-f]{6}$/i;
/** Registrácia: prefix krajiny + pomlčka (UR-82072, OM-BYW, D-ABYA) alebo US N-číslo. */
const REG_RE = /^(?:[A-Z0-9]{1,2}-[A-Z0-9]{2,5}|N[0-9]{1,5}[A-Z]{0,2})$/i;
/** Volací znak: 3 písmená ICAO + 1–4 znaky (ADB3017, RYR12AB) alebo 4–8 alfanum. so znakom číslice. */
const CALLSIGN_RE = /^[A-Z]{3}[0-9][0-9A-Z]{0,4}$/i;
const TYPE_CODE_RE = /^[A-Z][A-Z0-9]{1,3}$/i;

/**
 * Rozloží dopyt na to, čo môže znamenať. Viac výkladov naraz je v poriadku (A124 je typ aj hex-like nie).
 * @param {string} query
 * @returns {{q: string, types: {code: string, name: string}[], operators: {icao: string, name: string}[],
 *   hex: string|null, registration: string|null, callsign: string|null, text: string}}
 */
export function parseAircraftQuery(query) {
  const raw = String(query ?? '').trim();
  const text = foldAircraftText(raw);
  const flat = compact(raw);
  const out = { q: raw, types: [], operators: [], hex: null, registration: null, callsign: null, text, flat: flat.toUpperCase() };
  if (text.length < 2) return out;
  const seen = new Set();
  const addType = entry => { if (!seen.has(entry.code)) { seen.add(entry.code); out.types.push({ code: entry.code, name: entry.name }); } };
  for (const entry of AIRCRAFT_TYPES) {
    const names = [entry.name, ...entry.aliases];
    // Presná zhoda kódu, mena alebo aliasu; alias aj ako začiatok („ruslan" → An-124 Ruslan).
    if (flat === entry.code.toLowerCase() || names.some(name => compact(name) === flat)) addType(entry);
  }
  if (!out.types.length && text.length >= 3) {
    for (const entry of AIRCRAFT_TYPES) {
      const names = [entry.name, ...entry.aliases].map(foldAircraftText);
      if (out.types.length >= 6) break;
      if (names.some(name => name.startsWith(text) || name.split(' ').some(word => word.length >= 3 && word === text))) addType(entry);
    }
  }
  // Výrobca („antonov", „boeing") dá jeho typy — najprv tie z aliasov vyššie, max 6.
  if (text.length >= 4) {
    for (const entry of AIRCRAFT_TYPES) if (entry.maker === flat && out.types.length < 6) addType(entry);
  }
  for (const op of OPERATORS) {
    if (op.icao.toLowerCase() === flat || [op.name, ...op.aliases].some(name => compact(name) === flat || (text.length >= 4 && foldAircraftText(name).startsWith(text)))) {
      out.operators.push({ icao: op.icao, name: op.name });
    }
  }
  const upper = raw.replace(/\s+/g, '').toUpperCase();
  if (HEX_RE.test(upper) && /[0-9]/.test(upper)) out.hex = upper.toLowerCase();
  if (REG_RE.test(upper)) out.registration = upper;
  if (CALLSIGN_RE.test(upper)) out.callsign = upper;
  // Neznámy krátky kód typu (napr. „B39M") — skúsi sa ako typ, ak to nie je nič iné.
  if (!out.types.length && !out.hex && !out.registration && !out.callsign && TYPE_CODE_RE.test(upper) && /[0-9]/.test(upper)) {
    out.types.push({ code: upper, name: upper });
  }
  return out;
}

/** Prezývky, ktoré nie sú zároveň bežným miestom (na rozdiel od „Atlas", „Spartan", „Qatar"). */
const AIRCRAFT_NICKNAMES = new Set(['ruslan', 'mrija', 'mriya', 'antej', 'antei', 'globemaster', 'dreamlifter', 'beluga', 'belugaxl',
  'dreamliner', 'poseidon', 'awacs', 'stratotanker', 'hercules', 'herkules', 'concorde', 'iljusin', 'ilyushin']);

/**
 * Dopyt z poľa „miesto", ktorý jednoznačne mieri na lietadlo — registrácia, volací znak, hex, typ s číslom
 * (An-124, A380) alebo prezývka (Ruslan). Slová, ktoré môžu byť aj miesto („Atlas", „Qatar"), ostávajú geokóderu.
 */
export function looksLikeAircraftQuery(query) {
  const parsed = parseAircraftQuery(query);
  if (parsed.hex || parsed.registration || parsed.callsign) return true;
  if (!parsed.types.length) return false;
  return /[0-9]/.test(parsed.q) || AIRCRAFT_NICKNAMES.has(compact(parsed.q));
}

/** Ľudský názov typu z ICAO kódu (null, ak ho slovník nepozná). */
export function aircraftTypeName(code) {
  const upper = String(code ?? '').toUpperCase();
  return AIRCRAFT_TYPES.find(entry => entry.code === upper)?.name ?? null;
}
/** Prevádzkovateľ z volacieho znaku (prvé 3 písmená). */
export function operatorFromCallsign(callsign) {
  const prefix = String(callsign ?? '').trim().slice(0, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(prefix) ? OPERATORS.find(op => op.icao === prefix) ?? null : null;
}

/**
 * Skóre zhody jedného lietadla s rozloženým dopytom (0 = nič). Vyššie = lepšie.
 * @param {{hex: string, callsign?: string, registration?: string, typeCode?: string, typeName?: string, operator?: string, airline?: string}} ac
 * @param {ReturnType<typeof parseAircraftQuery>} parsed
 */
export function scoreAircraft(ac, parsed) {
  if (!parsed?.text || parsed.text.length < 2) return 0;
  const hex = String(ac.hex ?? '').toLowerCase();
  const callsign = String(ac.callsign ?? '').trim().toUpperCase();
  const reg = String(ac.registration ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const type = String(ac.typeCode ?? '').toUpperCase();
  const qFlat = parsed.flat ?? compact(parsed.q).toUpperCase();
  if (parsed.hex && hex === parsed.hex) return 100;
  if (callsign && callsign === qFlat) return 95;
  if (reg && reg === qFlat) return 95;
  if (type && parsed.types.some(t => t.code === type)) return 80;
  if (callsign && parsed.operators.some(op => callsign.startsWith(op.icao))) return 70;
  if (qFlat.length >= 3 && callsign.startsWith(qFlat)) return 60;
  if (qFlat.length >= 3 && reg.startsWith(qFlat)) return 60;
  // Úprava diakritiky je drahá (11 000 lietadiel pri každom písmene) — len keď je čo porovnať.
  if (parsed.text.length >= 4 && (ac.operator || ac.airline) && foldAircraftText(`${ac.operator ?? ''} ${ac.airline ?? ''}`).includes(parsed.text)) return 50;
  if (parsed.text.length >= 3 && ac.typeName && foldAircraftText(ac.typeName).includes(parsed.text)) return 45;
  return 0;
}

/**
 * Prehľadá zoznam lietadiel (živé v pamäti prehliadača), najlepšie prvé.
 * @param {Iterable<object>} aircraft záznamy pre scoreAircraft
 * @param {string} query
 * @returns {object[]} záznamy s `score`
 */
export function searchAircraft(aircraft, query, { limit = 20 } = {}) {
  const parsed = parseAircraftQuery(query);
  if (parsed.text.length < 2) return [];
  const hits = [];
  for (const ac of aircraft) {
    const score = scoreAircraft(ac, parsed);
    if (score > 0) hits.push({ ...ac, score });
  }
  hits.sort((a, b) => b.score - a.score || String(a.callsign || '').localeCompare(String(b.callsign || '')));
  return hits.slice(0, limit);
}
