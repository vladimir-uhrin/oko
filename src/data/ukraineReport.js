// src/data/ukraineReport.js
/**
 * @module ukraineReport
 * @description Denné operačné hlásenie Generálneho štábu ZSU (modul UKRAJINA,
 * etapa 2, 2026-09-19) — jediný OFICIÁLNY zdroj počtov stretov po smeroch,
 * ktorý je licenčne čistý: ArmyInform (agentúra Ministerstva obrany Ukrajiny)
 * ho publikuje v plnom znení pod CC BY 4.0 s povinným priamym odkazom
 * (armyinform.com.ua/terms-of-use). Tag feed
 * `https://armyinform.com.ua/tag/operatyvna-informacziya/feed/` nesie len
 * úvod; plné znenie je v článku (div.single-content). wp-json je zakázaný
 * v robots.txt, preto článok, nie REST.
 *
 * Tento modul je ČISTÝ: extrakcia odsekov z HTML, parser (celkový počet
 * stretov, čas hlásenia, údery, smery s počtom útokov), klientsky fetch.
 * Sťahovanie a cache robí `ukraineReportProxy()` vo vite.config.js.
 *
 * POCTIVOSŤ: je to JEDNOSTRANNÉ oficiálne hlásenie („oficiálne hlásenie UA");
 * počty sú tvrdenia strany konfliktu, nie nezávisle overené. Straty
 * protivníka sa zámerne NEPARSUJÚ (osoby nemodelujeme, čísla sú neoveriteľné).
 */

export const UKRAINE_REPORT_API = '/api/ukraine/report';
export const ARMYINFORM_OPS_FEED = 'https://armyinform.com.ua/tag/operatyvna-informacziya/feed/';
export const ARMYINFORM_ATTRIBUTION = 'ArmyInform (Ministry of Defence of Ukraine) · CC BY 4.0';

/** Mesiace v genitíve („19 вересня"). */
export const UK_MONTHS_GENITIVE = Object.freeze(['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']);

/** Číslovky (základné aj v páde, ako sa objavujú pri „атак/спроб/штурмових дій"). */
export const UK_NUMBER_WORDS = Object.freeze({
  один: 1, одна: 1, одну: 1, одного: 1, одне: 1, одній: 1, одним: 1,
  два: 2, дві: 2, двох: 2, три: 3, трьох: 3, чотири: 4, чотирьох: 4,
  "п'ять": 5, "п'яти": 5, шість: 6, шести: 6, сім: 7, семи: 7, вісім: 8, восьми: 8, "дев'ять": 9, "дев'яти": 9,
  десять: 10, десяти: 10, одинадцять: 11, дванадцять: 12, тринадцять: 13, чотирнадцять: 14, "п'ятнадцять": 15,
  шістнадцять: 16, сімнадцять: 17, вісімнадцять: 18, "дев'ятнадцять": 19, двадцять: 20, тридцять: 30, сорок: 40, "п'ятдесят": 50,
});
const TIMES_ADVERBS = Object.freeze({ двічі: 2, тричі: 3 });

const NUMBER_WORD_RE = Object.keys(UK_NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|');
/** Číslo („10 588", „2952") alebo slovná číslovka. */
const NUM_RE = `(\\d[\\d\\u00a0 ]*|${NUMBER_WORD_RE})`;

/** Typografické apostrofy → ', medzery ujednotené. */
export function normalizeUkText(value) {
  return String(value ?? '').replace(/[’ʼ`´]/g, "'").replace(/[ \s]+/g, ' ').trim();
}

/** „10 588" / „вісім" / „одну" → číslo alebo null. */
export function parseUkNumber(token) {
  const t = normalizeUkText(token).toLowerCase();
  if (!t) return null;
  if (/^\d/.test(t)) { const n = Number.parseInt(t.replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; }
  return UK_NUMBER_WORDS[t] ?? null;
}

/**
 * Lokál smeru → nominatív: „Лиманському" → „Лиманський", „Північно-Слобожанському"
 * → „Північно-Слобожанський", „Куп'янському" → „Куп'янський". Pure.
 */
export function directionNominative(locative) {
  const s = normalizeUkText(locative);
  if (/ому$/i.test(s)) return s.replace(/ому$/i, 'ий');
  if (/ім$/i.test(s)) return s.replace(/ім$/i, 'ий');
  return s;
}

/**
 * Odseky hlásenia z HTML článku ArmyInform: `<p>` od začiatku div.single-content,
 * len cyrilické odseky, koniec za odsekom o stratách alebo pri prvom odseku,
 * ktorý už nie je hlásenie (zdieľacie tlačidlá, inzeráty). Bez DOM parsera —
 * regex stačí, štruktúra je jednoduchá. Pure.
 * @param {string} html
 * @returns {string[]}
 */
export function extractReportParagraphs(html) {
  const text = String(html ?? '');
  const start = text.search(/class="[^"]*single-content[^"]*"/);
  const body = start >= 0 ? text.slice(start) : text;
  const out = [];
  for (const match of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const p = normalizeUkText(match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;|&#039;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&amp;/g, '&').replace(/&#8230;|&hellip;/g, '…')
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))));
    // Koniec hlásenia: zdieľacie tlačidlá, „čítajte tiež", inzeráty (грн) —
    // kontroluje sa PRED filtrom cyriliky, lebo tlačidlá cyriliku mať nemusia.
    if (/Gemini ChatGPT|Читайте також|(?<![а-яіїєґ])грн(?![а-яіїєґ])/i.test(p)) break;
    if (p.length < 20 || !/[а-яіїєґ]/i.test(p)) continue;
    out.push(p);
    if (/втрати російських військ/i.test(p)) break;
  }
  return out;
}

/**
 * Počet útokov v odseku smeru alebo null (neznáme). 0 = výslovne bez aktivity.
 * Vzory zo skutočných hlásení: „відбили 12 атак", „тричі атакував", „П'ять атак",
 * „здійснив вісім штурмових дій", „один раз атакували", „18 атак відбито",
 * „… на Покровському напрямку — 29.", „зупинили одну спробу", „наступальних дій
 * не проводили", „ознак … не виявлено". Pure.
 */
// POZOR: `\b` v JS regexe pozná len ASCII slová — pred cyrilikou NIKDY nesedí
// (rovnaká pasca ako `\w` pri latinizácii). Hranica slova je preto lookbehind.
const CYR_START = "(?<![А-Яа-яІіЇїЄєҐґ'])";

export function attacksInParagraph(paragraph) {
  const p = normalizeUkText(paragraph);
  let m = p.match(/напрямк(?:у|ах)\s*[—–-]\s*(\d[\d ]*)/i);
  if (m) return parseUkNumber(m[1]);
  m = p.match(new RegExp(`${CYR_START}(двічі|тричі)\\s+(?:\\S+\\s+){0,2}?атакув`, 'i'));
  if (m) return TIMES_ADVERBS[m[1].toLowerCase()];
  m = p.match(new RegExp(`${CYR_START}${NUM_RE}\\s+раз(?:и|ів)?\\s+(?:\\S+\\s+){0,2}?атакув`, 'i'));
  if (m) return parseUkNumber(m[1]);
  m = p.match(new RegExp(`${CYR_START}${NUM_RE}\\s+(?:\\S+\\s+){0,2}?(?:атак|штурмов|наступальн|спроб|бойов)`, 'i'));
  if (m) return parseUkNumber(m[1]);
  if (/не проводил|не виявлено|не здійснював|не здійснювали|не було|не зафіксовано/i.test(p)) return 0;
  return null;
}

const DIRECTION_RE = new RegExp(`${CYR_START}[Нн]а\\s+([А-ЯІЇЄҐ][А-Яа-яІіЇїЄєҐґ'-]*?)(?:ому|ім)(?:\\s+та\\s+([А-ЯІЇЄҐ][А-Яа-яІіЇїЄєҐґ'-]*?)(?:ому|ім))?\\s+напрямк(?:у|ах)`, 'g');

/**
 * Smery v odseku (nominatív), v poradí výskytu; jeden odsek môže niesť dva
 * („На Північно-Слобожанському та Курському напрямках"). Pure.
 * @returns {string[]}
 */
export function directionsInParagraph(paragraph) {
  const p = normalizeUkText(paragraph);
  const out = [];
  for (const m of p.matchAll(DIRECTION_RE)) {
    for (const loc of [m[1], m[2]]) {
      if (!loc) continue;
      const name = directionNominative(`${loc}ому`);
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * „станом на 08:00 19 вересня" → {time, day, month} alebo null. Pure.
 *
 * ArmyInform píše hodinu raz s dvojbodkou, raz s BODKOU („станом на 08.00
 * 22 вересня") — líši sa to článok od článku, nie dátum od dátumu (21. 9.
 * malo dvojbodku, 22. 9. bodku). Kým sme brali len dvojbodku, hlásenie
 * nevedelo povedať, KEDY platí: `reportedAt` aj `reportedAtText` boli null
 * a karta na doméne bola bez času. Obe formy sa normalizujú na `HH:MM`.
 */
export function reportTimestamp(text, { year = null } = {}) {
  const m = normalizeUkText(text).match(/станом на (\d{1,2})[:.](\d{2})\s+(\d{1,2})\s+([а-яії]+)/i);
  if (!m) return null;
  const month = UK_MONTHS_GENITIVE.indexOf(m[4].toLowerCase()) + 1;
  if (!month) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  // Hodina sa vždy vydá ako HH:MM, nech je v zdroji bodka alebo dvojbodka —
  // inak by sa oddeľovač zdroja presakoval do popisku karty.
  const out = { time: `${String(hh).padStart(2, '0')}:${m[2]}`, day: Number(m[3]), month };
  if (Number.isFinite(year)) {
    // Kyjev: EEST (UTC+3) v lete, EET (UTC+2) v zime — hrubo podľa mesiaca.
    const offsetH = month >= 4 && month <= 10 ? 3 : 2;
    out.iso = new Date(Date.UTC(year, month - 1, out.day, hh - offsetH, mm)).toISOString();
  }
  return out;
}

/**
 * Údery za deň z úvodného odseku: rakety, letecké údery, KAB, drony, obstrely. Pure.
 */
export function strikesInText(text) {
  const p = normalizeUkText(text);
  const num = (re) => { const m = p.match(re); return m ? parseUkNumber(m[1]) : null; };
  return {
    missileStrikes: num(new RegExp(`${NUM_RE}\\s+ракетн(?:ого|их|ий)\\s+(?:та|удар)`, 'i')),
    airStrikes: num(new RegExp(`${NUM_RE}\\s+авіаційн(?:их|ий)\\s+удар`, 'i')),
    guidedBombs: num(new RegExp(`${NUM_RE}\\s+керован(?:их|у|і)\\s+авіабомб`, 'i')),
    kamikazeDrones: num(new RegExp(`${NUM_RE}\\s+дрон(?:ів|и)-камікадзе`, 'i')),
    shellings: num(new RegExp(`${NUM_RE}\\s+обстріл`, 'i')),
  };
}

/**
 * Celé hlásenie z odsekov. Odsek so súhrnom („… 213 бойових зіткнень") dáva
 * celkový počet a nie je smerom; ostatné odseky so smerom dávajú
 * {gs, attacks, text}; dva smery v jednom odseku zdieľajú počet aj text.
 * @param {string[]} paragraphs
 * @param {{publishedAt?: string|number|null, url?: string, title?: string}} [meta]
 */
export function parseGeneralStaffReport(paragraphs, meta = {}) {
  const list = (Array.isArray(paragraphs) ? paragraphs : []).map(normalizeUkText).filter(Boolean);
  const all = list.join('\n');
  const totalMatch = all.match(/(\d[\d ]*)\s+бойов(?:их|і)\s+зіткнен/i);
  const total = totalMatch ? parseUkNumber(totalMatch[1]) : null;
  const publishedMs = meta.publishedAt ? new Date(meta.publishedAt).getTime() : NaN;
  const year = Number.isFinite(publishedMs) ? new Date(publishedMs).getUTCFullYear() : null;
  const stamp = reportTimestamp(all, { year });
  const directions = [];
  const seen = new Set();
  for (const p of list) {
    if (/\d[\d ]*\s+бойов(?:их|і)\s+зіткнен/i.test(p)) continue; // súhrn, nie smer
    const names = directionsInParagraph(p);
    if (!names.length) continue;
    const attacks = attacksInParagraph(p);
    for (const gs of names) {
      if (seen.has(gs)) continue;
      seen.add(gs);
      directions.push({ gs, attacks, text: p, shared: names.length > 1 });
    }
  }
  return {
    ok: directions.length > 0 || total !== null,
    total,
    reportedAt: stamp?.iso ?? null,
    reportedAtText: stamp ? `${stamp.time} ${stamp.day}.${stamp.month}.` : null,
    strikes: strikesInText(list.slice(0, 4).join(' ')),
    directions,
    directionsWithActivity: directions.filter((d) => Number(d.attacks) > 0).length,
    publishedAt: Number.isFinite(publishedMs) ? publishedMs : null,
    url: meta.url || null,
    title: meta.title || null,
    source: ARMYINFORM_ATTRIBUTION,
    official: 'ua',
  };
}

/**
 * Hlásenie rozložené na presety smerov (scény): jeden preset môže zbierať dva
 * GŠ smery (Sumy = Severoslobožanský + Kurský). Zdieľaný odsek („na X та Y
 * напрямках …") sa ráta raz; null (počet neuvedený) sa nesčíta, ale preset
 * ho nesie ako `unknown`. Pure.
 * @param {{directions?: Array<{gs:string, attacks:number|null, text:string, shared?:boolean}>}|null} report
 * @param {(gs: string) => ({id: string}|null)} sceneFor napr. frontSceneByGsDirection
 * @returns {Map<string, {sceneId: string, attacks: number|null, gs: string[], texts: string[], unknown: boolean}>}
 */
export function reportByScene(report, sceneFor) {
  const out = new Map();
  for (const d of report?.directions || []) {
    const scene = typeof sceneFor === 'function' ? sceneFor(d.gs) : null;
    if (!scene?.id) continue;
    let entry = out.get(scene.id);
    if (!entry) { entry = { sceneId: scene.id, attacks: null, gs: [], texts: [], unknown: false }; out.set(scene.id, entry); }
    entry.gs.push(d.gs);
    const text = normalizeUkText(d.text);
    const duplicateText = entry.texts.includes(text);
    if (!duplicateText && text) entry.texts.push(text);
    if (d.attacks === null || d.attacks === undefined) { entry.unknown = true; continue; }
    if (duplicateText) continue; // ten istý odsek pre dva smery = jeden počet
    entry.attacks = (entry.attacks ?? 0) + Number(d.attacks);
  }
  return out;
}

/**
 * Klient: hlásenie z proxy. Chyba proxy = výnimka so statusom.
 * @param {{fetcher?: typeof fetch, base?: string}} [o]
 */
export async function fetchUkraineReport({ fetcher = (...a) => fetch(...a), base = UKRAINE_REPORT_API } = {}) {
  const response = await fetcher(base, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return json;
}
