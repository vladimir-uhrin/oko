// src/data/mideastIncidents.js
/**
 * @module mideastIncidents
 * @description OVERENÉ UDALOSTI modulu BLÍZKY VÝCHOD (etapa 4, 2026-11-05; plán
 * docs/drafts/blizky-vychod-plan.md kap. 4 a 6): údery, zásahy a poškodenia z GeoConfirmed
 * (geolokované proti fotke či videu) a z UCDP Candidate Events (druhý zdroj, mesačné súbory).
 *
 * Zdroje (bez kľúča):
 *  - GeoConfirmed `https://geoconfirmed.org/api/Map/export/<Iran|israel|Yemen|Syria>/csv?start&end`
 *    — CSV oddelené `;`, s BOM, stĺpce Date;Name;Faction;Origin;Latitude;Longitude;PlusCode;
 *    Description;Source;Geolocation;Equipment;EquipmentItems;Units;OrbatUnits;Id. Riadky bez
 *    dátumu sú statické značky (základne, zariadenia) — zahadzujú sa. Mapa `israel` pokrýva aj
 *    Gazu, Západný breh a Libanon.
 *  - UCDP Candidate Events `https://ucdp.uu.se/downloads/candidateged/GEDEvent_v<RR>_0_<M>.csv`
 *    (CC BY 4.0) — mesačný súbor celého sveta, CSV s čiarkou a s viacriadkovými poliami
 *    v úvodzovkách; berú sa len krajiny regiónu, presný deň a poloha najviac na úrovni okresu.
 *
 * ETICKÝ FILTER (záväzný, plán kap. 4 bod 2 a 4): preč riadky s neprázdnym `Units`, riadky,
 * ktoré ukazujú polohu, presun, outpost, kontrolný bod či rozmiestnenie jednotiek a techniky,
 * riadky, ktorých súradnice sú poloha autora záberu („point of view", „seen from"), zatknutia,
 * únosy a riadky, ktorých cieľom sú osoby (bojovník, veliteľ, novinár…), a všetko, čo nie je
 * úder, zásah ani poškodenie (protesty, pohreby, výcvik, zhromaždenia). Vety o obetiach
 * a osobách sa z popisu vystrihnú. `OrbatUnits` smie dať len AKTÉRA (napr. „Israeli Air
 * Force"), nikdy polohu jednotky. Odkazy na zdroje z blocklistu sankcií EÚ sa zahodia.
 * Vojenské základne nie sú vrstva — len miesto udalosti (riadok bez úderu či poškodenia
 * neprejde bránou „kinetická udalosť").
 *
 * Modul je čistý (bez DOM, bez Cesia, bez Node API); zdieľa ho archív servera aj klient.
 */
import { isSanctionedMediaUrl } from './sanctionedMedia.js';

export const MIDEAST_INCIDENTS_API = '/api/mideast/events/incidents';
/** Začiatok archívu: 28. 2. 2026 (vojna s Iránom; plán kap. 6, rovnako ako kontrola sídiel). */
export const MIDEAST_INCIDENTS_FIRST_DAY = '2026-02-28';
/** Rolujúce okno obnovy GeoConfirmed po prvom naplnení (geolokácie sa dopĺňajú spätne). */
export const MIDEAST_INCIDENTS_ROLLING_DAYS = 30;
/** Najviac dní na jeden dopyt trasy `/incidents` (klient si dlhšie obdobie berie po kusoch). */
export const MIDEAST_INCIDENTS_MAX_DAYS = 31;
/** Najviac dní pre `/incidents/summary` (celý archív od 28. 2. s rezervou). */
export const MIDEAST_INCIDENTS_SUMMARY_MAX_DAYS = 400;
/** Dedup GeoConfirmed × UCDP: ten istý deň a najviac toľko km. */
export const MIDEAST_DEDUP_KM = 2;

export const GEOCONFIRMED_EXPORT_BASE = 'https://geoconfirmed.org/api/Map/export';
export const GEOCONFIRMED_SITE = 'https://geoconfirmed.org';
export const GEOCONFIRMED_LICENSE = 'GeoConfirmed — verejný export, nekomerčné použitie s atribúciou';
export const GEOCONFIRMED_MIDEAST_ATTRIBUTION = 'GeoConfirmed (geoconfirmed.org) · OSINT, geolokované proti záberom';
/**
 * Konflikty GeoConfirmed: `api` = názov v URL exportu (veľkosť písmen ako na webe), `slug` =
 * adresár archívu a cesta mapy, `minDay` = najstarší deň, ktorý sa berie (Sýria má záznamy od
 * 2013 — do archívu ide len súčasná fáza).
 */
export const GEOCONFIRMED_CONFLICTS = Object.freeze([
  Object.freeze({ api: 'Iran', slug: 'iran', minDay: MIDEAST_INCIDENTS_FIRST_DAY }),
  Object.freeze({ api: 'israel', slug: 'israel', minDay: MIDEAST_INCIDENTS_FIRST_DAY }),
  Object.freeze({ api: 'Yemen', slug: 'yemen', minDay: MIDEAST_INCIDENTS_FIRST_DAY }),
  Object.freeze({ api: 'Syria', slug: 'syria', minDay: '2026-01-01' }),
]);
export const GEOCONFIRMED_SLUGS = Object.freeze(GEOCONFIRMED_CONFLICTS.map((c) => c.slug));
export const geoconfirmedConflict = (slug) => GEOCONFIRMED_CONFLICTS.find((c) => c.slug === slug) || null;
/** URL exportu konfliktu pre okno dní (vrátane). Pure. */
export const geoconfirmedExportUrl = (slug, from, to) => `${GEOCONFIRMED_EXPORT_BASE}/${geoconfirmedConflict(slug)?.api || slug}/csv?start=${from}&end=${to}`;
/** Verejná mapa konfliktu (odkaz v karte). Pure. */
export const geoconfirmedMapUrl = (slug) => `${GEOCONFIRMED_SITE}/map/${slug}`;

export const UCDP_CANDIDATE_BASE = 'https://ucdp.uu.se/downloads/candidateged';
export const UCDP_PAGE = 'https://ucdp.uu.se/downloads/index.html#candidate';
export const UCDP_LICENSE = 'CC BY 4.0';
export const UCDP_ATTRIBUTION = 'UCDP Candidate Events Dataset (Uppsala Conflict Data Program) · CC BY 4.0';
/** Mesačný súbor UCDP Candidate: rok 2026, mesiac 9 → GEDEvent_v26_0_9.csv. Pure. */
export const ucdpCandidateUrl = (year, month) => `${UCDP_CANDIDATE_BASE}/GEDEvent_v${String(year).slice(-2)}_0_${Number(month)}.csv`;
/** Krajiny regiónu v UCDP (stĺpec `country`). */
export const UCDP_COUNTRIES = Object.freeze([
  'Israel', 'Iran', 'Iraq', 'Lebanon', 'Syria', 'Yemen (North Yemen)', 'Saudi Arabia', 'Jordan',
  'Kuwait', 'Bahrain', 'Qatar', 'United Arab Emirates', 'Oman', 'Egypt',
]);
/** Najhoršia presnosť polohy UCDP, ktorá sa ešte kreslí (1 presne, 2 do 25 km, 3 okres). */
export const UCDP_MAX_WHERE_PREC = 3;

/**
 * Druhy udalostí (poradie v legende = `rank` zostupne). Farby monochromatickej mapy OKO
 * v duchu UKMTO: teplé = údery, studené = more a protivzdušná obrana.
 */
export const MIDEAST_INCIDENT_TYPES = Object.freeze([
  Object.freeze({ id: 'missile', css: '#ff5a5f', rank: 7 }),
  Object.freeze({ id: 'air', css: '#ff8a3d', rank: 6 }),
  Object.freeze({ id: 'drone', css: '#ffb547', rank: 5 }),
  Object.freeze({ id: 'artillery', css: '#e8d44d', rank: 4 }),
  Object.freeze({ id: 'naval', css: '#39d0ff', rank: 3 }),
  Object.freeze({ id: 'air-defence', css: '#b07cff', rank: 2 }),
  Object.freeze({ id: 'damage', css: '#c9a27e', rank: 1 }),
  Object.freeze({ id: 'other', css: '#8aa0b6', rank: 0 }),
]);
export const MIDEAST_INCIDENT_TYPE_OTHER = MIDEAST_INCIDENT_TYPES.at(-1);
export const mideastIncidentTypeOf = (id) => MIDEAST_INCIDENT_TYPES.find((x) => x.id === id) || MIDEAST_INCIDENT_TYPE_OTHER;

/** Aktéri (kľúč i18n `mideast.inc.actor.<id>`). */
export const MIDEAST_ACTORS = Object.freeze(['il', 'ir', 'us', 'hezbollah', 'houthi', 'hamas', 'sa', 'ye-gov', 'sy', 'iq-militia', 'is', 'uk', 'fr', 'jo']);

const DAY_MS = 86_400_000;

/** Deň YYYY-MM-DD z ms UTC. Pure. */
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
/** YYYY-MM-DD (aj s časom za ním) → ms UTC o polnoci, inak null. Pure. */
export function dayToMs(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(ms) && dayKey(ms) === `${m[1]}-${m[2]}-${m[3]}` ? ms : null;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
/**
 * CSV (RFC 4180) → riadky ako objekty podľa hlavičky. Na rozdiel od `parseCsv` v ukraineEvents.js
 * zvláda nové riadky VNÚTRI úvodzoviek (UCDP má viacriadkové výňatky článkov; GeoConfirmed
 * zatiaľ nie, ale popis ich mať smie). BOM preč, CRLF aj LF, prázdne riadky sa vynechajú. Pure.
 * @param {string} text
 * @param {string} [sep]
 * @returns {Array<Record<string, string>>}
 */
export function parseCsvRecords(text, sep = ',') {
  const s = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') records.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0] !== '') records.push(row); }
  if (!records.length) return [];
  const header = records[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < records.length; r += 1) {
    const cells = records[r];
    const obj = {};
    for (let k = 0; k < header.length; k += 1) obj[header[k]] = cells[k] ?? '';
    out.push(obj);
  }
  return out;
}

// ── klasifikácia ────────────────────────────────────────────────────────────
// Poradie testov je zámerné: zásah PVO pred dronom („air defenses intercept a drone"), loď pred
// raketou („missile hit a tanker" je námorná udalosť), raketa pred letectvom. „Missile base",
// „missile city" či „launch site" nie sú druh úderu, len miesto — negatívny výhľad.
const RE_AIR_DEFENCE = /\b(intercept(?:s|ed|ion|ions|or|ors|ing)?|shot down|shoots? down|shooting down|air[- ]defen[cs]es? (?:fire|activ\w*|engag\w*|respond\w*)|anti-aircraft fire)\b/i;
const RE_NAVAL = /\b(warships?|frigates?|corvettes?|destroyer (?:ship|vessel)|vessels?|tankers?|cargo ships?|merchant ships?|ships?|boats?|sea drones?|unmanned surface|usv|naval drones?)\b/i;
const RE_MISSILE = /\b(ballistic|cruise missiles?|hypersonic|missiles?(?!\s+(?:bases?|city|cities|sites?|facilit\w*|production|factor\w*|depots?|storage|launchers? sites?|programs?))|rockets?(?!\s+(?:bases?|sites?|factor\w*|production))|katyusha|grad rockets?|fateh|kheibar|emad|ghadr|sejjil|burkan|zulfiqar)\b/i;
/** Protitankové riadené strely patria k pozemnej palbe, nie k raketovým úderom. */
const RE_ATGM = /\b(atgms?|anti-tank(?: guided)?(?: missiles?)?|kornet|tow missiles?)\b/i;
const RE_DRONE = /\b(drones?|uavs?|uas|fpv|kamikaze|loitering|shahed|geran|samad|qasef|one-way attack|quadcopter|drone-dropped|drone dropped)\b/i;
const RE_AIR = /\b(air ?strikes?|air raids?|warplanes?|fighter jets?|jets?|bombers?|bomb(?:s|ed|ing|ings)?|iaf|air force|b-2|f-35|f-15|f-16|precision strikes?|aerial (?:strikes?|bombardment))\b/i;
const RE_ARTILLERY = /\b(artillery|shell(?:s|ed|ing)|mortars?|howitzers?|mlrs|tank (?:fire|shell\w*)|atgms?|anti-tank)\b/i;
const RE_DAMAGE = /\b(destroy\w*|damag\w*|struck|strikes?|hit|hits|explosions?|exploded|blasts?|impacts?|fires?|burn\w*|smoke|plumes?|debris|rubble|aftermath|demoli\w*|blown up|blowing up|blew up|craters?|collapsed?|vbied|ied|car bomb)\b/i;

/**
 * Druh udalosti z popisu (EN kľúčové slová; `extra` = Equipment/EquipmentItems GeoConfirmed
 * alebo titulok UCDP — len na triedenie, nikdy sa neukladá). Pure.
 * @returns {string} id z MIDEAST_INCIDENT_TYPES
 */
export function mideastIncidentType(description, extra = '') {
  const s = `${description || ''} ${extra || ''}`;
  if (RE_AIR_DEFENCE.test(s)) return 'air-defence';
  if (RE_NAVAL.test(s) && RE_DAMAGE.test(s) || /\b(sea drones?|unmanned surface|usv|naval drones?)\b/i.test(s)) return 'naval';
  if (RE_ATGM.test(s)) return 'artillery';
  if (RE_MISSILE.test(s)) return 'missile';
  if (RE_DRONE.test(s)) return 'drone';
  if (/\b(car bombs?|vbieds?|ieds?)\b/i.test(s)) return 'damage';
  if (RE_AIR.test(s)) return 'air';
  if (RE_ARTILLERY.test(s)) return 'artillery';
  if (RE_DAMAGE.test(s)) return 'damage';
  return 'other';
}

// Aktéri: mená strán (s veľkým začiatočným písmenom, bez príznaku i — „us" je zámeno, „US" štát).
const ACTOR_NAMES = Object.freeze([
  ['iq-militia', "Iranian-backed militias?|Iran-backed militias?|Iraqi militias?|PMF|Popular Mobilization Forces|Kata'?ib Hezbollah|Islamic Resistance in Iraq"],
  ['il', "Israeli Air Force|Israeli Navy|Israeli forces|Israeli army|Israeli military|Israel Defense Forces|Israeli|Israel|IDF|IAF"],
  ['ir', 'Islamic Revolutionary Guard Corps|IRGC|Iranian forces|Iranian|Iran'],
  ['us', 'United States Air Force|United States Navy|U\\.S\\. forces|US forces|United States|U\\.S\\.|USAF|CENTCOM|American|US'],
  ['hezbollah', 'Hezbollah|Hizbollah|Hizballah'],
  ['houthi', 'Houthis?|Ansar ?Allah|Ansarallah'],
  ['hamas', "Hamas|Al-Qassam|Qassam Brigades|Izz al-Din al-Qassam"],
  ['sa', 'Royal Saudi Air Force|Saudi-led coalition|Saudi-led|Saudi'],
  ['ye-gov', 'Yemeni government forces|Yemeni Government forces|Yemeni [Gg]overnment|Yemeni [Aa]rmy|Yemeni [Aa]rmed [Ff]orces|Yemeni forces|National Resistance Forces?|Giants Brigades?|Homeland Shield Forces|PLC forces'],
  ['sy', 'Syrian [Aa]rmy|Syrian [Aa]ir [Dd]efen[cs]es?|Syrian [Ii]nternal [Ss]ecurity(?: forces)?|Syrian [Gg]overnment(?: forces)?|Syrian forces'],
  ['is', 'Islamic State|ISIS|ISIL'],
  ['uk', 'Royal Air Force|British forces|British|RAF'],
  ['fr', 'French [Aa]ir [Ff]orce|French forces|French'],
  ['jo', 'Jordanian forces|Jordanian [Aa]ir [Ff]orce|Jordanian'],
]);
// Medzi menom a zbraňou smú byť najviac tri prívlastky alebo názov v úvodzovkách
// („Hezbollah 'Ababil' drone", „Hezbollah Fiber-Optic FPV Kamikaze Drone").
// Prívlastok = slovo s veľkým písmenom, názov v úvodzovkách alebo známe prídavné meno — nikdy
// „hit", „by" či iné sloveso („Houthi forces hit by drone" je Húsíom cieľ, nie aktér).
const ACTOR_FILLER = "(?:['‘\"][^'’\"]{1,24}['’\"]|[A-Z][\\w-]*|kamikaze|fiber-optic|one-way|attack|loitering|suicide|reported|claimed|military|army|forces?|navy|naval|air|armed|long-range|precision|explosive|surveillance|ballistic)";
const ACTOR_WEAPON = "(?:'s)?\\s+(?:" + ACTOR_FILLER + "\\s+){0,3}?(?:drones?|UAVs?|FPV|fpv|missiles?|rockets?|ballistic|cruise|air ?strikes?|strikes?|attacks?|artillery|shelling|mortars?|ATGMs?|warplanes?|jets?|bombs?|bombing|interceptors?|air defen[cs]es?|raids?|fire)\\b(?!\\s+by\\b)";
const ACTOR_VERB = '\\s+(?:forces\\s+|military\\s+|army\\s+|reportedly\\s+|allegedly\\s+)?(?:strikes?|struck|hits?|attack(?:s|ed|ing)?|bomb(?:s|ed|ing)?|target(?:s|ed|ing)?|shell(?:s|ed|ing)?|fire[sd]?|launch(?:es|ed)?|intercept(?:s|ed)?|destroy(?:s|ed)?|shot down|shoots? down|blew up|blowing up|demolish(?:es|ed)?|carr(?:y|ies|ied) out|conduct(?:s|ed))\\b(?!\\s+by\\b)';
// „by X" a „launched/fired from X"; holé „of"/„from" nie — „headquarters of the IRGC" je cieľ.
const ACTOR_BY = '\\b(?:by|launched from|fired from)\\s+(?:the\\s+|an?\\s+)?(?:reported\\s+|claimed\\s+|alleged\\s+|suspected\\s+|presumed\\s+)?';
/** Dvojica strán („US/Israeli strikes", „Israeli and US strikes") — aktér je prvá z nich. */
const ACTOR_PAIR = '(?:\\s*(?:/|and|&)\\s*[A-Z][\\w.-]*)?';
const ACTOR_PATTERNS = ACTOR_NAMES.map(([id, names]) => ({
  id,
  res: [
    new RegExp(`${ACTOR_BY}(?:${names})\\b`, 'g'),
    new RegExp(`\\b(?:${names})${ACTOR_PAIR}${ACTOR_WEAPON}`, 'g'),
    new RegExp(`\\b(?:${names})${ACTOR_PAIR}${ACTOR_VERB}`, 'g'),
  ],
}));
// `OrbatUnits` → aktér len pre letectvá útočiacich strán (útočiaca zložka, nie poloha jednotky).
// Velenia a útvary Iránu či námorníctva tam bývajú ako CIEĽ („headquarters of the IRGC Aerospace
// Force", „US 5th Fleet") — preto nie.
const ORBAT_ACTORS = Object.freeze([
  ['il', /Israeli Air Force/],
  ['us', /United States Air Force|US Air Force/],
  ['sa', /Royal Saudi Air Force|Saudi Air Force/],
  ['uk', /Royal Air Force/],
  ['fr', /French Air (?:and Space )?Force/],
  ['jo', /Royal Jordanian Air Force/],
]);

/**
 * Aktér (kto úder vykonal) z popisu: najskoršia zmienka v tvare „by X", „X drone/missile/strike…"
 * alebo „X strikes/hit/targeted…"; inak útočiaca zložka z `OrbatUnits` (letectvo, námorníctvo);
 * inak null. Frakcia záznamu GeoConfirmed (`Faction`) NIE JE aktér — pri satelitných záberoch
 * poškodenia ňou zdroj označuje stranu cieľa. Pure.
 * @returns {string|null} id z MIDEAST_ACTORS
 */
export function mideastIncidentActor(description, orbatUnits = '') {
  const s = String(description || '');
  let best = null;
  for (const { id, res } of ACTOR_PATTERNS) {
    for (const re of res) {
      re.lastIndex = 0;
      const m = re.exec(s);
      if (m && (!best || m.index < best.index || (m.index === best.index && m[0].length > best.len))) best = { id, index: m.index, len: m[0].length };
    }
  }
  if (best) return best.id;
  const orbat = String(orbatUnits || '');
  for (const [id, re] of ORBAT_ACTORS) if (re.test(orbat)) return id;
  return null;
}

// ── etický filter ───────────────────────────────────────────────────────────
/** Poloha autora záberu — súradnice by ukázali, kde stál človek s kamerou. */
const RE_POV = /\b(point\s*(?:of|fo|f)\s*view|pov|seen from|filmed from|view from the|recorded from)\b/i;
/**
 * Polohy, presuny a rozmiestnenie jednotiek či techniky (ktorejkoľvek strany). „Base" samo nie
 * je v zozname: riadok o základni bez úderu či poškodenia neprejde bránou kinetickej udalosti,
 * úder NA základňu (známe pevné miesto) je udalosť.
 */
const RE_POSITION = /\b(positions?|outposts?|checkpoints?|road ?blocks?|heading\b|establish(?:es|ed|ing)? (?:a |new )?(?:positions?|presence|control)|deploy(?:s|ed|ing|ment|ments)?|redeploy\w*|stationed|staging|convoys?|columns? of|seen (?:in|at|near|on|moving|driving|entering|patrolling|operating)|spotted|moving (?:towards?|through|along|in|into)|driving|entering|patrol(?:s|ling)?|gather(?:ed|ing)|military camp|army camp|base camp|encampment|bivouac|trench(?:es)?|dugouts?|fortif\w*|firing points?|parked|presence|advance[sd]?|advancing|withdr[ae]w\w*|captur\w*|seiz\w*|took control|taken over|control of|sharing a view|share a view|elements of|border posts?|military posts?|army posts?|command posts?|newly established|brigades?|battalions?|regiments?|companies of)\b/i;
/** Zatknutia, únosy, popravy a osoby ako cieľ či predmet riadku. */
const RE_PERSON = /\b(arrest\w*|detain\w*|detention|abduct\w*|kidnap\w*|hostages?|prisoners?|execut(?:ed|ion|ions)|hanged|assassinat\w*|operatives?|fighters?|soldiers?|troops|militants?|gunmen|commanders?|leaders?|officials?|officers?|journalists?|reporters?|correspondents?|paramedics?|child(?:ren)?|individuals?|persons?|people|civilians?|man|men|woman|women|bod(?:y|ies)|corpses?|killed|killing|injured|wounded|casualt\w*|dead|deaths?|mourners?|funerals?|family|families|members?|crowd|eulogi\w*|named|identified as|colonel|captain|lieutenant|sergeant|brigadier)\b/i;
/** Nekinetické udalosti, ktoré do vrstvy úderov nepatria. */
const RE_NON_KINETIC = /\b(protest\w*|rall(?:y|ies)|mourn\w*|parades?|training|exercises?|drills?|ceremon\w*|celebrat\w*|speech|volunteers?|evacuat\w*|construction|rehabilitat\w*|smuggl\w*)\b/i;
/** Brána: riadok musí opisovať úder, zásah alebo poškodenie. */
const RE_KINETIC = /\b(strikes?|struck|air ?strikes?|hit|hits|attack\w*|bomb\w*|shell(?:s|ed|ing)|explo(?:sion|sions|ded|des|sive)|blasts?|impacts?|intercept\w*|shot down|destroy\w*|damag\w*|burn(?:ing|ed|t)|fires?\b|blaze|smoke|plumes?|debris|demoli\w*|blown up|blowing up|blew up|launch(?:es|ed)\b|targeted|targets?\b|craters?|rubble|aftermath|wreck\w*|sunk|sank|vbied|ied|car bomb)\b/i;
/** Časová značka videa na začiatku popisu („0:06-0:12 - ", „(1:28-1:38)", „Vid1 0:14-0:27/Vid2 1:08-1:42 - "). */
const RE_TIMECODE = /^\s*(?:(?:vid(?:eo)?\s*\d*\s*)?\(?\d{1,2}:\d{2,3}(?:\s*[-/:]\s*(?:\d{1,2}:\d{2,3}|end))*\)?\s*[,/]?\s*)+(?:[-–:]\s*)?/i;
/** Úvodná značka popisu, ktorá do karty nepatrí („Top building -", „Picture 2,3 -", „Area grid -"). */
const RE_LABEL = /^\s*(?:(?:top|bottom|left|right|middle|upper|lower|cent(?:er|re)|first|second|third)\s+(?:building|structure|hangar|impact|image|picture)|pictures?\s*[\d,\s&and]*|images?\s*[\d,\s&and]*|area grid|building at\s*[\d:]+|location of the [\w\s]{1,30}?|(?:rough(?:ly)? location|r+o+ugh location|approximate (?:location|position)|approximately located|approx\.?)(?: of [^-–:]{1,40}?)?)\s*[-–:]\s*/i;
const RE_APPROX = /^\s*(?:rough(?:ly)? location|r+o+ugh location|approximate (?:location|position)|approximately located|approx\.?|area grid)\b/i;

/** Popis bez úvodných časových značiek a značiek typu „Top building -" (aj striedavo). Pure. */
function stripLead(description) {
  let s = String(description || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(RE_TIMECODE, '').replace(RE_LABEL, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Vety popisu GeoConfirmed: oddeľovače „., " a „ , , ". Pure. */
export function descriptionSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/\.\s*,\s*|\s,\s*,\s*|(?<=\.)\s+(?=[A-Z0-9"'(“])/)
    .map((s) => s.replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '').trim())
    .filter(Boolean);
}

/**
 * Text karty: bez časovej značky videa, bez úvodného „Rough location -", bez viet o osobách
 * a obetiach, najviac `max` znakov (na hranici slova). Null, keď nič neostane. Pure.
 */
export function incidentStatusText(description, { max = 280 } = {}) {
  let s = stripLead(description);
  const kept = descriptionSentences(s).filter((x, i) => i === 0 || !RE_PERSON.test(x));
  s = kept.join('. ').replace(/\s+([,.])/g, '$1').replace(/\.{2,}/g, '.').trim();
  if (!s) return null;
  if (!/[.!?…]$/.test(s)) s += '.';
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:-]+$/, '')}…`;
}

/**
 * Etický filter + prah relevancie pre riadok GeoConfirmed. Vracia dôvod zahodenia alebo null
 * (riadok smie ísť ďalej). Poradie = poradie v štatistike archívu. Pure.
 * @returns {null|'units'|'pov'|'position'|'person'|'non-kinetic'}
 */
export function geoconfirmedDropReason(row) {
  if (String(row?.Units || '').trim()) return 'units';
  const raw = String(row?.Description || '').replace(/\s+/g, ' ').trim();
  const text = raw.replace(RE_TIMECODE, '');
  if (RE_POV.test(text)) return 'pov';
  if (RE_POSITION.test(text)) return 'position';
  const first = descriptionSentences(stripLead(text))[0] || '';
  if (RE_PERSON.test(first)) return 'person';
  if (RE_NON_KINETIC.test(text)) return 'non-kinetic';
  if (!RE_KINETIC.test(text)) return 'non-kinetic';
  return null;
}

/** „GH4P+X43 Enerhodar, Zaporizhia Oblast, Ukraine" → „Enerhodar, Zaporizhia Oblast". Pure. */
export function placeFromPlusCode(plusCode) {
  const s = String(plusCode || '').trim();
  const rest = s.replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\s*/i, '');
  const parts = rest.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts.slice(0, 2).join(', ');
}
/** Krajina z PlusCode (posledná časť adresy), inak null. Pure. */
export function countryFromPlusCode(plusCode) {
  const parts = String(plusCode || '').split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts.at(-1) : null;
}

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const sourceLinks = (value) => String(value || '').split(/[,\s]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u) && !isSanctionedMediaUrl(u));

/**
 * Riadok GeoConfirmed → `{ incident }` alebo `{ drop: dôvod }` (štatistika archívu). Dôvody:
 * 'no-date' (statická značka), 'before' (pred `minDay`), 'coords', potom etický filter. Pure.
 * @param {Record<string, string>} row
 * @param {{conflict: string, minDay?: string}} o
 */
export function geoconfirmedRowToIncident(row, { conflict, minDay = MIDEAST_INCIDENTS_FIRST_DAY } = {}) {
  const t = dayToMs(String(row?.Date || '').slice(0, 10));
  if (t === null) return { drop: 'no-date' };
  if (minDay && dayKey(t) < minDay) return { drop: 'before' };
  const lat = Number(String(row.Latitude ?? '').replace(',', '.'));
  const lon = Number(String(row.Longitude ?? '').replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return { drop: 'coords' };
  const reason = geoconfirmedDropReason(row);
  if (reason) return { drop: reason };
  const description = String(row.Description || '').replace(/\s+/g, ' ').trim();
  const approx = RE_APPROX.test(description.replace(RE_TIMECODE, ''));
  const links = sourceLinks(row.Source);
  return {
    incident: {
      id: `gc:${String(row.Id || '').trim() || `${conflict}:${dayKey(t)}:${round5(lat)}:${round5(lon)}`}`,
      src: 'geoconfirmed',
      conflict,
      t,
      day: dayKey(t),
      lat: round5(lat),
      lon: round5(lon),
      precision: approx ? 'approx' : 'geolocated',
      place: placeFromPlusCode(row.PlusCode),
      country: countryFromPlusCode(row.PlusCode),
      type: mideastIncidentType(description, `${row.Equipment || ''} ${row.EquipmentItems || ''}`),
      actor: mideastIncidentActor(description, row.OrbatUnits),
      text: incidentStatusText(description),
      origin: ['SAT', 'VID', 'PIC', 'UAV'].includes(String(row.Origin || '').trim()) ? String(row.Origin).trim() : null,
      url: geoconfirmedMapUrl(conflict),
      sources: links.slice(0, 2),
    },
  };
}

/**
 * Celý export konfliktu → udalosti + počty zahodených podľa dôvodu. Rovnaké Id dvakrát (export
 * ho občas zopakuje) = jedna udalosť. Pure.
 * @returns {{incidents: object[], dropped: Record<string, number>, rows: number}}
 */
export function parseGeoconfirmedIncidents(text, { conflict, minDay } = {}) {
  const rows = parseCsvRecords(text, ';');
  const dropped = {};
  const seen = new Set();
  const incidents = [];
  for (const row of rows) {
    const r = geoconfirmedRowToIncident(row, { conflict, minDay: minDay ?? geoconfirmedConflict(conflict)?.minDay ?? MIDEAST_INCIDENTS_FIRST_DAY });
    if (r.drop) { dropped[r.drop] = (dropped[r.drop] || 0) + 1; continue; }
    if (seen.has(r.incident.id)) { dropped.duplicate = (dropped.duplicate || 0) + 1; continue; }
    seen.add(r.incident.id);
    incidents.push(r.incident);
  }
  return { incidents, dropped, rows: rows.length };
}

// ── UCDP Candidate ─────────────────────────────────────────────────────────
// Strany UCDP → aktér (pri jednostrannom násilí je strana A páchateľ).
const UCDP_SIDE_ACTORS = Object.freeze([
  ['il', /^Government of Israel$/], ['ir', /^Government of Iran$/], ['us', /^Government of United States of America$/],
  ['hezbollah', /^Hezbollah$/], ['houthi', /^Ansarallah$/], ['hamas', /^Hamas$/], ['sa', /^Government of Saudi Arabia$/],
  ['ye-gov', /^Government of Yemen \(North Yemen\)$/], ['sy', /^Government of Syria$/], ['is', /^IS$/],
  ['uk', /^Government of United Kingdom$/], ['jo', /^Government of Jordan$/],
]);
const ucdpActor = (side) => { const s = String(side || '').trim(); for (const [id, re] of UCDP_SIDE_ACTORS) if (re.test(s)) return id; return null; };
/** Strana UCDP vhodná do karty: organizácia, nie neidentifikovaný kód „XXX630". Pure. */
const ucdpParty = (side) => { const s = String(side || '').trim(); return s && !/^XXX\d*/.test(s) ? s : null; };

/**
 * Riadok UCDP Candidate → `{ incident }` alebo `{ drop }`. Len krajiny regiónu, presný deň
 * (`date_prec` 1, začiatok = koniec), poloha najviac na úrovni okresu (`where_prec` ≤ 3).
 * Titulok a výňatok článku slúžia LEN na triedenie druhu — neukladajú sa (sú v nich mená).
 * Počet obetí je odhad UCDP (`best`), nie zoznam. Pure.
 */
export function ucdpRowToIncident(row, { minDay = MIDEAST_INCIDENTS_FIRST_DAY } = {}) {
  if (!UCDP_COUNTRIES.includes(String(row?.country || '').trim())) return { drop: 'country' };
  const start = String(row.date_start || '').slice(0, 10);
  const end = String(row.date_end || '').slice(0, 10);
  const t = dayToMs(start);
  if (t === null) return { drop: 'no-date' };
  if (Number(row.date_prec) !== 1 || (end && end !== start)) return { drop: 'date-precision' };
  if (minDay && start < minDay) return { drop: 'before' };
  const prec = Number(row.where_prec);
  if (!Number.isFinite(prec) || prec > UCDP_MAX_WHERE_PREC) return { drop: 'place-precision' };
  const lat = Number(row.latitude); const lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return { drop: 'coords' };
  const violence = Number(row.type_of_violence);
  const sideA = ucdpParty(row.side_a); const sideB = ucdpParty(row.side_b);
  const deaths = Number(row.best);
  const place = String(row.where_coordinates || '').replace(/\s+(town|village|city|county|district|governorate|province)$/i, '').trim() || null;
  return {
    incident: {
      id: `ucdp:${String(row.id || '').trim() || `${start}:${round5(lat)}:${round5(lon)}`}`,
      src: 'ucdp',
      conflict: null,
      t,
      day: start,
      lat: round5(lat),
      lon: round5(lon),
      precision: prec === 1 ? 'exact' : (prec === 2 ? 'near' : 'district'),
      place,
      country: String(row.country || '').replace(/\s*\(North Yemen\)$/, '').trim() || null,
      type: mideastIncidentType(`${row.source_headline || ''} ${row.source_article || ''}`),
      actor: violence === 3 ? ucdpActor(row.side_a) : null,
      parties: [sideA, sideB].filter(Boolean),
      violence: [1, 2, 3].includes(violence) ? violence : null,
      deaths: Number.isFinite(deaths) && deaths >= 0 ? Math.round(deaths) : null,
      text: null,
      origin: null,
      url: UCDP_PAGE,
      sources: [],
    },
  };
}

/** Celý mesačný súbor UCDP → udalosti regiónu + počty zahodených. Pure. */
export function parseUcdpIncidents(text, { minDay = MIDEAST_INCIDENTS_FIRST_DAY } = {}) {
  const rows = parseCsvRecords(text, ',');
  const dropped = {};
  const incidents = [];
  const seen = new Set();
  for (const row of rows) {
    const r = ucdpRowToIncident(row, { minDay });
    if (r.drop) { dropped[r.drop] = (dropped[r.drop] || 0) + 1; continue; }
    if (seen.has(r.incident.id)) continue;
    seen.add(r.incident.id);
    incidents.push(r.incident);
  }
  return { incidents, dropped, rows: rows.length };
}

// ── spájanie, dejiská, súhrn ────────────────────────────────────────────────
/** Vzdialenosť po veľkej kružnici v km. Pure. */
export function distanceKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Dedup GeoConfirmed × UCDP: udalosť UCDP v ten istý deň do `maxKm` od udalosti GeoConfirmed
 * vypadne (GeoConfirmed je geolokovaný proti záberu, UCDP býva na úrovni sídla); GeoConfirmed
 * dostane príznak `ucdp: true`. Rovnaké id dvakrát (prekryv konfliktov) = jedna udalosť. Pure.
 * @returns {{incidents: object[], duplicates: number}}
 */
export function dedupIncidents(incidents, { maxKm = MIDEAST_DEDUP_KM } = {}) {
  const byId = new Map();
  for (const it of Array.isArray(incidents) ? incidents : []) if (it?.id && !byId.has(it.id)) byId.set(it.id, it);
  const list = [...byId.values()];
  const gcByDay = new Map();
  for (const it of list) {
    if (it.src !== 'geoconfirmed') continue;
    if (!gcByDay.has(it.day)) gcByDay.set(it.day, []);
    gcByDay.get(it.day).push(it);
  }
  const out = [];
  let duplicates = 0;
  const flagged = new Set();
  for (const it of list) {
    if (it.src === 'ucdp') {
      const twin = (gcByDay.get(it.day) || []).find((g) => distanceKm(g, it) <= maxKm);
      if (twin) { duplicates += 1; flagged.add(twin.id); continue; }
    }
    out.push(it);
  }
  return { incidents: out.map((it) => (flagged.has(it.id) ? { ...it, ucdp: true } : it)), duplicates };
}

/** Leží udalosť v obdĺžniku [W, S, E, N] rozšírenom o `marginDeg`? Pure. */
export function inRect(it, rect, marginDeg = 0.5) {
  if (!Array.isArray(rect) || rect.length !== 4) return true;
  const [w, s, e, n] = rect;
  return it.lat >= s - marginDeg && it.lat <= n + marginDeg && it.lon >= w - marginDeg && it.lon <= e + marginDeg;
}

/** Vek pre kreslenie: 'fresh' ≤ 7 dní, 'recent' ≤ 30 dní, inak 'old'. Pure. */
export function incidentAge(tMs, nowMs = Date.now()) {
  const days = (nowMs - tMs) / DAY_MS;
  return days <= 7 ? 'fresh' : (days <= 30 ? 'recent' : 'old');
}

/**
 * Súhrn pre legendu: počty podľa druhu (zoradené podľa `rank`), podľa zdroja a najnovšie
 * udalosti. Pure.
 */
export function incidentSummary(incidents, { latest = 5 } = {}) {
  const list = Array.isArray(incidents) ? incidents : [];
  const counts = new Map();
  const bySrc = { geoconfirmed: 0, ucdp: 0 };
  for (const it of list) {
    counts.set(it.type, (counts.get(it.type) || 0) + 1);
    if (it.src in bySrc) bySrc[it.src] += 1;
  }
  return {
    total: list.length,
    bySrc,
    byType: [...counts].map(([type, count]) => ({ type, count, css: mideastIncidentTypeOf(type).css, rank: mideastIncidentTypeOf(type).rank })).sort((a, b) => b.rank - a.rank),
    latest: [...list].sort((a, b) => b.t - a.t).slice(0, Math.max(0, latest)),
  };
}

/** Obdobia jednoduchej osi (výber v paneli). */
export const MIDEAST_INCIDENT_PERIODS = Object.freeze(['7d', '30d', 'all']);
/**
 * Okno obdobia: '7d' / '30d' = posledných 7 / 30 dní vrátane dneška (UTC), 'all' = od 28. 2.
 * Pure.
 * @returns {{from: string, to: string, days: number}}
 */
export function incidentPeriodRange(period, nowMs = Date.now()) {
  const to = dayKey(nowMs);
  const span = period === '7d' ? 7 : (period === '30d' ? 30 : null);
  const fromMs = span ? Math.max(dayToMs(to) - (span - 1) * DAY_MS, dayToMs(MIDEAST_INCIDENTS_FIRST_DAY)) : dayToMs(MIDEAST_INCIDENTS_FIRST_DAY);
  const from = dayKey(fromMs);
  return { from, to, days: Math.round((dayToMs(to) - fromMs) / DAY_MS) + 1 };
}
/** Okno rozsekané na kusy po `MIDEAST_INCIDENTS_MAX_DAYS` dní (od najnovšieho). Pure. */
export function incidentChunks(from, to, maxDays = MIDEAST_INCIDENTS_MAX_DAYS) {
  const a = dayToMs(from); const b = dayToMs(to);
  if (a === null || b === null || b < a) return [];
  const out = [];
  for (let end = b; end >= a; end -= maxDays * DAY_MS) {
    const start = Math.max(a, end - (maxDays - 1) * DAY_MS);
    out.push({ from: dayKey(start), to: dayKey(end) });
  }
  return out;
}

/**
 * Počty obdobia zo súhrnu po dňoch (`/incidents/summary`): súčet dní v okne. Pure.
 * @param {Record<string, {total: number}>} days
 */
export function countInRange(days, from, to) {
  let n = 0;
  for (const [day, v] of Object.entries(days || {})) if (day >= from && day <= to) n += Number(v?.total) || 0;
  return n;
}

// ── klient ──────────────────────────────────────────────────────────────────
async function getJson(fetcher, url, bad) {
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json) throw new Error(bad);
  return json;
}
/**
 * Klient: udalosti okna (≤ 31 dní) z archívu servera; voliteľne len dejisko. Chyba = výnimka
 * so `status`.
 */
export async function fetchMideastIncidents({ from, to, theatre = null, fetcher = (...a) => fetch(...a), base = MIDEAST_INCIDENTS_API } = {}) {
  const q = new URLSearchParams({ from, to });
  if (theatre) q.set('theatre', theatre);
  const json = await getJson(fetcher, `${base}?${q}`, 'bad_incidents_payload');
  if (!Array.isArray(json.incidents)) throw new Error('bad_incidents_payload');
  return json;
}
/** Klient: počty po dňoch pre os (celé obdobie od 28. 2. jedným dopytom). */
export async function fetchMideastIncidentSummary({ from, to, theatre = null, fetcher = (...a) => fetch(...a), base = MIDEAST_INCIDENTS_API } = {}) {
  const q = new URLSearchParams({ from, to });
  if (theatre) q.set('theatre', theatre);
  const json = await getJson(fetcher, `${base}/summary?${q}`, 'bad_summary_payload');
  if (!json.days || typeof json.days !== 'object') throw new Error('bad_summary_payload');
  return json;
}
