// src/data/vesselCardDetails.js
/**
 * @module vesselCardDetails
 * @description Riadky karty lode, ktoré pribudli 2026-10-10 (vlastník poslal
 * kartu cudzieho prehliadača lodí: „máme toto?" → „áno doplň aj fotky"):
 * kurz a smer prídy zvlášť, rýchlosť otáčania, IMO, trieda AIS, rozmery
 * a ponor, miestny čas lode a údaje z registra (podrobný typ, rok stavby,
 * GT, DWT). Čisté funkcie bez Cesia — zdieľa ich karta po kliknutí aj
 * kartička pod kurzorom.
 */
import { AIS_ROT_FAST_DEG_PER_MIN } from './aisIngest.js';
import { greatCircleKm, matchDestinationPort, matchPortByNameCountry, voyageProgress } from './vesselDestination.js';
import { resolveFlagIso2 } from './countryFlags.js';

const identity = (key) => key;

function valid(deg, max) {
  return Number.isFinite(deg) && deg >= 0 && deg < max ? Math.round(deg) % 360 : null;
}

/** Desatinné číslo s čiarkou v slovenčine. Pure. */
function decimal(value, digits, lang) {
  const text = Number(value).toFixed(digits);
  return lang === 'sk' ? text.replace('.', ',') : text;
}

/** Celé číslo s medzerou ako oddeľovačom tisícov (29 442). Pure. */
export function groupThousands(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Rýchlosť otáčania: „0°/min", „4,5°/min vpravo", „> 10°/min vľavo". Null
 * = AIS ju nehlási (trieda B, nedostupná). Pure.
 * @param {number|null} rot °/min (+ vpravo, − vľavo)
 * @param {(key: string, vars?: object) => string} [t]
 * @param {string} [lang]
 */
export function formatRateOfTurn(rot, t = identity, lang = 'sk') {
  if (!Number.isFinite(rot)) return null;
  if (Math.abs(rot) < 0.05) return '0°/min';
  const side = rot > 0 ? t('vessel.rot-right') : t('vessel.rot-left');
  const value = Math.abs(rot) >= AIS_ROT_FAST_DEG_PER_MIN ? '> 10' : decimal(Math.abs(rot), Math.abs(rot) < 10 ? 1 : 0, lang);
  return `${value}°/min ${side}`;
}

/**
 * Časové pásmo lode na mori: námorné pásmo z dĺžky (každých 15°, ±12 h) —
 * presne tak ho lode na otvorenom mori aj vedú. Pure.
 * @param {number} lon
 * @returns {number|null}
 */
export function nauticalZoneOffsetH(lon) {
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return Math.max(-12, Math.min(12, Math.round(lon / 15)));
}

/** „UTC", „UTC+2", „UTC−5", „UTC+5:30" z posunu v minútach. Pure. */
function zoneLabel(offsetMin) {
  if (!offsetMin) return 'UTC';
  const sign = offsetMin > 0 ? '+' : '−';
  const abs = Math.abs(offsetMin);
  const minutes = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

/**
 * Posun časového pásma IANA v minútach v danom okamihu (letný čas
 * zahrnutý), alebo null pre neznáme pásmo. Pure (Intl).
 * @param {string} timeZone napr. „Europe/Amsterdam"
 * @param {number} nowMs
 */
export function timeZoneOffsetMin(timeZone, nowMs) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(nowMs));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return Math.round((asUtc - Math.floor(nowMs / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

/**
 * Miestny čas lode „21:57 (UTC−5)". So zadaným pásmom IANA (z polohy,
 * vesselTimeZone.js) platí aj v prístave vrátane letného času; bez neho
 * námorné pásmo z dĺžky, ako ho vedú lode na otvorenom mori. Pure.
 * @param {number} lon
 * @param {number} [nowMs]
 * @param {string|null} [timeZone]
 * @returns {string|null}
 */
export function vesselLocalTimeLabel(lon, nowMs = Date.now(), timeZone = null) {
  if (timeZone && Number.isFinite(nowMs)) {
    const offsetMin = timeZoneOffsetMin(timeZone, nowMs);
    if (offsetMin !== null) {
      const d = new Date(nowMs + offsetMin * 60000);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} (${zoneLabel(offsetMin)})`;
    }
  }
  const offset = nauticalZoneOffsetH(lon);
  if (offset === null || !Number.isFinite(nowMs)) return null;
  const d = new Date(nowMs + offset * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const zone = offset === 0 ? 'UTC' : `UTC${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
  return `${hh}:${mm} (${zone})`;
}

/**
 * Riadok pohybu: kurz nad dnom, smer prídy, otáčanie — každá časť len keď je
 * známa (sentinely 360/511 sú už preč, ale tu sa overujú znova). Pure.
 * @param {{course?:number|null, heading?:number|null, rateOfTurn?:number|null}} record
 */
export function vesselMotionParts(record, t = identity, lang = 'sk') {
  const course = valid(record?.course, 360);
  const heading = valid(record?.heading, 360);
  const rot = formatRateOfTurn(record?.rateOfTurn, t, lang);
  return [
    course !== null ? t('vessel.course', { deg: course }) : null,
    heading !== null ? t('vessel.heading', { deg: heading }) : null,
    rot ? t('vessel.turn', { rot }) : null,
  ].filter(Boolean);
}

/**
 * Riadok trupu: IMO · trieda AIS · rozmery · ponor. IMO a rozmery dopĺňa
 * register, keď ich AIS ešte nedoniesol (statická správa chodí raz za 6 min).
 * @param {object} record AIS záznam
 * @param {object|null} info výstup /api/vessel-info
 */
export function vesselHullParts(record, info, t = identity, lang = 'sk') {
  const imo = String(record?.imo || '').trim().replace(/^0+$/, '') || info?.imo || '';
  const length = Number.isFinite(record?.lengthM) && record.lengthM > 0 ? record.lengthM : info?.lengthM;
  const beam = Number.isFinite(record?.beamM) && record.beamM > 0 ? record.beamM : info?.beamM;
  const aisClass = String(record?.aisClass || '').trim().toUpperCase();
  const draught = Number.isFinite(record?.draughtM) && record.draughtM > 0 ? record.draughtM : null;
  return [
    imo ? `IMO ${imo}` : null,
    aisClass === 'A' || aisClass === 'B' ? t('vessel.ais-class', { cls: aisClass }) : null,
    Number.isFinite(length) && length > 0
      ? (Number.isFinite(beam) && beam > 0 ? `${Math.round(length)} × ${Math.round(beam)} m` : `${Math.round(length)} m`)
      : null,
    draught ? t('vessel.draught', { m: decimal(draught, 1, lang) }) : null,
  ].filter(Boolean);
}

/** Bežné typy z registra po slovensky; neznámy ostáva v originále. */
const TYPE_SK = new Map([
  ['chemical/oil products tanker', 'tanker na chemikálie a ropné produkty'],
  ['oil products tanker', 'tanker na ropné produkty'],
  ['crude oil tanker', 'tanker na surovú ropu'],
  ['chemical tanker', 'chemický tanker'],
  ['lng tanker', 'tanker LNG'],
  ['lpg tanker', 'tanker LPG'],
  ['container ship', 'kontajnerová loď'],
  ['bulk carrier', 'loď na sypký náklad'],
  ['general cargo ship', 'loď na kusový náklad'],
  ['vehicles carrier', 'loď na prepravu áut'],
  ['ro-ro cargo ship', 'ro-ro nákladná loď'],
  ['passenger ship', 'osobná loď'],
  ['passenger (cruise) ship', 'výletná loď'],
  ['passenger/ro-ro cargo ship', 'trajekt'],
  ['tug', 'remorkér'],
  ['pusher tug', 'tlačný remorkér'],
  ['fishing vessel', 'rybárska loď'],
  ['pleasure craft', 'rekreačné plavidlo'],
  ['sailing vessel', 'plachetnica'],
  ['inland, motor freighter', 'riečna motorová nákladná loď'],
  ['inland, motor tanker', 'riečny motorový tanker'],
  ['inland, passenger ship', 'riečna osobná loď'],
  ['offshore supply ship', 'zásobovacia loď offshore'],
  ['research/survey vessel', 'výskumná loď'],
  ['dredger', 'bagrovacia loď'],
  ['cargo ship', 'nákladná loď'],
  ['cargo', 'nákladná loď'],
  ['tanker', 'tanker'],
  ['passenger', 'osobná loď'],
  ['high speed craft', 'rýchla loď'],
  ['pilot vessel', 'pilotná loď'],
  ['search & rescue vessel', 'záchranná loď'],
  ['law enforcement', 'plavidlo polície'],
  ['military ops', 'vojenské plavidlo'],
  ['towing vessel', 'vlečný remorkér'],
  ['port tender', 'prístavný čln'],
  ['yacht', 'jachta'],
  ['hopper dredger', 'násypková bagrovacia loď'],
  ['ro-ro/passenger ship', 'trajekt'],
  ['reefer', 'chladiarenská loď'],
  ['refrigerated cargo ship', 'chladiarenská loď'],
  ['cement carrier', 'loď na cement'],
  ['heavy load carrier', 'loď na ťažké náklady'],
  ['asphalt/bitumen tanker', 'tanker na asfalt'],
  ['bunkering tanker', 'bunkrovací tanker'],
  ['crew boat', 'loď pre posádky'],
  ['anchor handling vessel', 'loď na manipuláciu s kotvami'],
]);

/** Podrobný typ z registra v jazyku rozhrania. Pure. */
export function localizedTypeDetail(typeDetail, lang = 'sk') {
  const text = String(typeDetail || '').trim();
  if (!text) return null;
  if (lang !== 'sk') return text;
  return TYPE_SK.get(text.toLowerCase()) || text;
}

/**
 * Riadok registra: podrobný typ · rok stavby · GT · DWT. Pure.
 * @param {object|null} info výstup /api/vessel-info
 */
export function vesselRegistryParts(info, t = identity, lang = 'sk') {
  if (!info) return [];
  const type = localizedTypeDetail(info.typeDetail, lang);
  return [
    type ? type.charAt(0).toUpperCase() + type.slice(1) : null,
    Number.isFinite(info.yearBuilt) ? t('vessel.built', { year: info.yearBuilt }) : null,
    Number.isFinite(info.grossTonnage) ? `GT ${groupThousands(info.grossTonnage)}` : null,
    Number.isFinite(info.deadweight) ? `DWT ${groupThousands(info.deadweight)} t` : null,
  ].filter(Boolean);
}

/**
 * Súčasná plavba (2026-10-10, predloha z prehliadača lodí: „Polazak iz Sankt
 * Peterburga · RU LED · skutočný čas odchodu" + čiara priebehu): posledný
 * prístav a odchod z registra, cieľ z AIS textu (alebo z registra), priebeh
 * po veľkokružnici. Bez posledného prístavu null. Pure.
 * @param {{lat?: number, lon?: number, destination?: string}} vessel
 * @param {object|null} info výstup /api/vessel-info (info.voyage, info.destination)
 * @param {object|null} index index prístavov (vesselPortIndex) — bez neho bez priebehu
 */
export function vesselVoyageModel(vessel, info, index) {
  // Register (stránka lode) je čerstvejší; GFW návštevy prístavov sú záloha
  // pre lode, ktoré register nepozná (oneskorenie ~3 dni).
  const voyage = info?.voyage?.lastPort ? info.voyage : voyageFromPortCalls(portCallsLabelled(info, index));
  if (!voyage?.lastPort) return null;
  const originPort = index ? matchPortByNameCountry(voyage.lastPort, voyage.lastPortCountry, index) : null;
  const destinationText = String(vessel?.destination || info?.destination || '').trim();
  const destinationMatch = index && destinationText ? matchDestinationPort(destinationText, index) : null;
  const destinationPort = destinationMatch?.port || null;
  const progress = originPort && destinationPort ? voyageProgress(originPort, vessel, destinationPort) : null;
  return {
    arrivedAt: Number.isFinite(voyage.arrivedAt) ? voyage.arrivedAt : null,
    origin: {
      name: voyage.lastPort,
      locode: voyage.locode || originPort?.locode || null,
      iso2: resolveFlagIso2(null, null, voyage.lastPortCountry) || null,
      country: voyage.lastPortCountry || null,
    },
    destination: destinationPort
      ? { name: destinationPort.name, locode: destinationPort.locode, iso2: resolveFlagIso2(null, null, destinationPort.country) || null, country: destinationPort.country, lat: destinationPort.lat, lon: destinationPort.lon }
      : (destinationText ? { name: destinationText, locode: null, iso2: null, country: null } : null),
    progress,
    departedAt: Number.isFinite(voyage.departedAt) ? voyage.departedAt : null,
  };
}

function sideLabel(side) {
  if (!side?.name) return '?';
  return side.locode ? `${side.name} (${side.locode})` : side.name;
}

/** „Saint Petersburg (RULED) → Wilmington (USILG) · 92 %". Pure. */
export function voyageRouteLine(model) {
  if (!model) return '';
  const parts = [`${sideLabel(model.origin)} → ${model.destination ? sideLabel(model.destination) : '?'}`];
  if (model.progress) parts.push(`${Math.round(model.progress.fractionDone * 100)} %`);
  return parts.join(' · ');
}

/** „vyplávala 22. 9. 20:32 UTC · pred 18 d". Pure. */
/** „22. 9. 20:32 UTC" / „Sep 22 20:32 UTC" a vek „18 d" / „5 h". Pure. */
function whenAndAgo(ms, lang, nowMs) {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const when = lang === 'sk'
    ? `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${hh}:${mm} UTC`
    : `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()} ${hh}:${mm} UTC`;
  const hours = (nowMs - ms) / 3_600_000;
  const ago = hours < 0 ? '' : hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`;
  return { when, ago };
}

/**
 * Novšia poloha z registra, keď je naša stará alebo žiadna (MINERVA mimo
 * dosahu AIS: „Novšia poloha 10. 10. 02:57 UTC · pred 18 h · 34,13° S 68,88° Z
 * · 13,1 kn · prijímač na inej lodi"). Pure.
 * @param {object|null} info výstup /api/vessel-info (lastPosition)
 * @param {number|null} ownFixMs čas našej polohy (ms) alebo null
 */
export function newerPositionLine(info, ownFixMs, t = identity, lang = 'sk', nowMs = Date.now()) {
  const p = info?.lastPosition;
  if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return '';
  if (Number.isFinite(ownFixMs) && p.t <= ownFixMs + 10 * 60_000) return '';
  const { when, ago } = whenAndAgo(p.t, lang, nowMs);
  const fmt = (v, pos, neg) => `${decimal(Math.abs(v), 2, lang)}° ${v >= 0 ? pos : neg}`;
  const coords = lang === 'sk' ? `${fmt(p.lat, 'S', 'J')} ${fmt(p.lon, 'V', 'Z')}` : `${fmt(p.lat, 'N', 'S')} ${fmt(p.lon, 'E', 'W')}`;
  const station = p.station === 'Roaming' ? t('vessel.station-roaming') : p.station === 'Satellite' ? t('vessel.station-satellite') : p.station === 'Terrestrial' ? t('vessel.station-terrestrial') : '';
  return [
    t('vessel.newer-position', { when, ago }),
    coords,
    Number.isFinite(p.speedKn) ? `${decimal(p.speedKn, 1, lang)} kn` : '',
    station,
  ].filter(Boolean).join(' · ');
}

export function voyageDepartureLine(model, t = identity, lang = 'sk', nowMs = Date.now(), { withOrigin = false } = {}) {
  // Loď v prístave (príchod bez novšieho odchodu): „v prístave Bratislava od 4. 7. · pred 98 d".
  if (!Number.isFinite(model?.departedAt) && Number.isFinite(model?.arrivedAt) && model?.origin?.name) {
    const { when, ago } = whenAndAgo(model.arrivedAt, lang, nowMs);
    return t('vessel.in-port', { port: sideLabel(model.origin), when, ago });
  }
  if (!Number.isFinite(model?.departedAt)) return withOrigin && model?.origin?.name ? sideLabel(model.origin) : '';
  const prefix = withOrigin && model?.origin?.name ? `${sideLabel(model.origin)} · ` : '';
  const d = new Date(model.departedAt);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const when = lang === 'sk'
    ? `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${hh}:${mm} UTC`
    : `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()} ${hh}:${mm} UTC`;
  const hours = (nowMs - model.departedAt) / 3_600_000;
  const ago = hours < 0 ? '' : hours < 48 ? `${Math.max(1, Math.round(hours))} h` : `${Math.round(hours / 24)} d`;
  return prefix + (ago ? t('vessel.departed-ago', { when, ago }) : t('vessel.departed', { when }));
}

/**
 * Trasa pre kartičku pod kurzorom (riadok s vlajkami). Len keď je známy aj
 * cieľ — inak by ostala prázdna šípka „→"; odkiaľ potom nesie riadok odchodu
 * (voyageDepartureLine s withOrigin). Pure.
 */
export function voyageRouteInfo(model) {
  if (!model?.origin?.name || !model.destination?.name) return null;
  const side = (s) => ({ code: s.locode, name: s.name, country: s.iso2 || s.country });
  return { origin: side(model.origin), destination: side(model.destination) };
}

/**
 * Cieľ a ETA: AIS má prednosť (posádka ho práve zadala), register je záloha —
 * AIS statika chodí raz za ~6 min a AISHub cieľ neposiela vôbec. Pure.
 * @returns {{destination: string, eta: string, fromRegistry: boolean}}
 */
export function vesselDestinationWithFallback(record, info) {
  const aisDest = String(record?.destination || '').trim();
  if (aisDest) return { destination: aisDest, eta: String(record?.eta || '').trim(), fromRegistry: false };
  const regDest = String(info?.destination || '').trim();
  if (!regDest) return { destination: '', eta: '', fromRegistry: false };
  let eta = '';
  if (Number.isFinite(info?.etaMs)) {
    const d = new Date(info.etaMs);
    eta = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  return { destination: regDest, eta, fromRegistry: true };
}

/** ISO3 vlajky kotviska GFW → ISO2 (námorné štáty; ostatné bez vlajky). */
const ISO3_TO_ISO2 = Object.freeze({
  RUS: 'ru', USA: 'us', GBR: 'gb', NLD: 'nl', DEU: 'de', BEL: 'be', FRA: 'fr', ESP: 'es', ITA: 'it', GRC: 'gr', TUR: 'tr',
  CHN: 'cn', JPN: 'jp', KOR: 'kr', SGP: 'sg', NOR: 'no', DNK: 'dk', SWE: 'se', FIN: 'fi', EST: 'ee', LVA: 'lv', LTU: 'lt',
  POL: 'pl', PRT: 'pt', IRL: 'ie', EGY: 'eg', ARE: 'ae', SAU: 'sa', IND: 'in', BRA: 'br', MEX: 'mx', CAN: 'ca', AUS: 'au',
  ROU: 'ro', BGR: 'bg', UKR: 'ua', HRV: 'hr', MLT: 'mt', CYP: 'cy', MAR: 'ma', ISR: 'il', IRN: 'ir', IRQ: 'iq', KWT: 'kw',
  QAT: 'qa', OMN: 'om', PAK: 'pk', MYS: 'my', IDN: 'id', THA: 'th', VNM: 'vn', PHL: 'ph', TWN: 'tw', HKG: 'hk', ZAF: 'za',
  NGA: 'ng', ARG: 'ar', CHL: 'cl', PER: 'pe', COL: 'co', PAN: 'pa', VEN: 've', GEO: 'ge', SVN: 'si', MNE: 'me', ALB: 'al', ISL: 'is',
});

/** Najbližší prístav World Port Index do `maxKm` (pre návštevy GFW bez mena). Pure. */
export function nearestPort(index, lat, lon, maxKm = 60) {
  if (!index?.byLocode || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  let bestKm = maxKm;
  const seen = new Set();
  for (const map of [index.byLocode, index.byName]) {
    for (const port of map?.values?.() || []) {
      if (seen.has(port)) continue;
      seen.add(port);
      if (Math.abs(port.lat - lat) > 1 || Math.abs(port.lon - lon) > 1.5) continue;
      const km = greatCircleKm(lat, lon, port.lat, port.lon);
      if (km !== null && km <= bestKm) { best = port; bestKm = km; }
    }
  }
  return best;
}

/**
 * Návštevy prístavov z GFW (info.portCalls) s menom a štátom: meno z GFW,
 * inak najbližší prístav WPI; štát z WPI. Pure.
 */
export function portCallsLabelled(info, index) {
  const calls = Array.isArray(info?.portCalls) ? info.portCalls : [];
  return calls.map((c) => {
    const port = index ? nearestPort(index, c.lat, c.lon) : null;
    const name = c.name || port?.name || null;
    const iso2 = ISO3_TO_ISO2[String(c.flag || '').toUpperCase()] || (port?.country ? resolveFlagIso2(null, null, port.country) : null) || null;
    return { ...c, name, locode: port?.locode || null, country: port?.country || null, iso2 };
  });
}

/** Posledná návšteva prístavu ako „posledný prístav + odchod" (tvar info.voyage). Pure. */
export function voyageFromPortCalls(calls) {
  const last = Array.isArray(calls) ? [...calls].reverse().find((c) => c?.name) : null;
  if (!last) return null;
  return { lastPort: last.name, lastPortCountry: last.country || null, departedAt: Number.isFinite(last.departure) ? last.departure : null, fromPortCalls: true };
}

/** „Predtým: Liverpool · Amsterdam · IJmuiden · Tallinn" — posledné prístavy z GFW. Pure. */
export function portHistoryLine(info, index, t = identity, max = 5) {
  const names = [];
  for (const c of portCallsLabelled(info, index)) {
    if (!c.name || names[names.length - 1] === c.name) continue;
    names.push(c.name);
  }
  if (names.length < 2) return '';
  return t('vessel.port-history', { ports: names.slice(-max).join(' · ') });
}
