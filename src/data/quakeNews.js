// Následky zemetrasenia zo správ (2026-10-10, automatika videa o zemetrasení): titulky článkov GDELT DOC
// z dôveryhodných médií (local_data/events/trusted-news.json). Číslo obetí alebo zranených platí, len keď ho
// uvedú aspoň dve rôzne médiá (z najvyšších čísel každého média druhé najvyššie, ako pri ruských útokoch);
// „zatiaľ nikto nezahynul" len keď to napíšu aspoň dve médiá a žiadne číslo obetí nie je potvrdené. Pure.
import { trustedDomainOf } from './eventNews.js';
import { spokenNumber } from './eventSpeech.js';

export const QUAKE_NEWS_MIN_SOURCES = 2;
const NBSP = ' ';
const num = (s) => Number(String(s).replace(/[,.\s]/g, ''));
const KILLED = [
  /\b(?:kill(?:s|ed|ing)?|leaves?|left)\s+(?:at\s+least\s+|more\s+than\s+|over\s+)?(\d[\d,]*)\s+(?:people\s+)?(?:dead)?/i,
  /\b(\d[\d,]*)\s+(?:people\s+|persons\s+)?(?:dead|killed|deaths|die|died)\b/i,
  /\bdeath\s+toll\s+(?:rises|climbs|jumps|reaches|hits)?\s*(?:to\s+)?(\d[\d,]*)/i,
  /\b(\d[\d,]*)\s+(?:muertos|fallecidos|víctimas\s+mortales)\b/i,
];
const INJURED = [
  /\b(\d[\d,]*)\s+(?:people\s+)?(?:injured|hurt|wounded)\b/i,
  /\binjur(?:es|ing|ed)\s+(?:at\s+least\s+|more\s+than\s+)?(\d[\d,]*)/i,
  /\b(\d[\d,]*)\s+heridos\b/i,
];
const NO_DEATHS = /\bno\s+(?:deaths|fatalities|immediate\s+reports?\s+of\s+(?:deaths|casualties)|reports?\s+of\s+(?:deaths|casualties)|one\s+(?:was\s+)?killed|casualties)\b|\bsin\s+(?:víctimas|muertos|fallecidos)\b/i;
const QUAKE_WORD = /earthquake|quake|tremor|sismo|terremoto|temblor/i;

const firstNum = (title, res) => { for (const re of res) { const m = re.exec(title); if (m) { const n = num(m[1]); if (Number.isFinite(n) && n < 1_000_000) return n; } } return null; };
/** Číslo potvrdené aspoň dvoma médiami: najvyššie číslo každého média, z nich druhé najvyššie. Pure. */
export function confirmedByTwo(byDomain) {
  const v = [...byDomain.values()].filter(Number.isFinite).sort((a, b) => b - a);
  return v.length >= QUAKE_NEWS_MIN_SOURCES ? v[1] : null;
}

/** Dopyt GDELT: zemetrasenie a krajina (anglický názov z miesta USGS). Pure. */
export function quakeNewsQuery(countryEn) {
  return `(earthquake OR quake OR sismo OR terremoto) "${String(countryEn).replace(/"/g, '')}"`;
}

/**
 * Titulky → overené následky. `articles`: [{ title, url, domain, seendate }]. Pure.
 * @returns {{killed, injured, noDeaths, sources: Array<{name, url}>}|null}
 */
export function quakeNewsFacts(articles, trusted, { afterMs = -Infinity } = {}) {
  const killed = new Map(); const injured = new Map(); const none = new Map(); const urls = new Map();
  for (const a of articles || []) {
    const title = String(a?.title || '');
    if (!QUAKE_WORD.test(title)) continue;
    const t = Date.parse(String(a.seendate || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    if (Number.isFinite(t) && t < afterMs) continue;
    const domain = trustedDomainOf(a.domain || (() => { try { return new URL(a.url).hostname; } catch { return ''; } })(), trusted);
    if (!domain) continue;
    const k = firstNum(title, KILLED); const i = firstNum(title, INJURED);
    if (k !== null) killed.set(domain, Math.max(killed.get(domain) ?? -1, k));
    if (i !== null) injured.set(domain, Math.max(injured.get(domain) ?? -1, i));
    if (NO_DEATHS.test(title)) none.set(domain, true);
    if ((k !== null || i !== null || NO_DEATHS.test(title)) && !urls.has(domain)) urls.set(domain, a.url);
  }
  const k = confirmedByTwo(killed); const i = confirmedByTwo(injured);
  const noDeaths = !(k > 0) && none.size >= QUAKE_NEWS_MIN_SOURCES;
  if (!(k > 0) && !(i > 0) && !noDeaths) return null;
  const used = new Set([...(k > 0 ? killed.keys() : []), ...(i > 0 ? injured.keys() : []), ...(noDeaths ? none.keys() : [])]);
  return { killed: k > 0 ? k : null, injured: i > 0 ? i : null, noDeaths, sources: [...used].slice(0, 4).map((d) => ({ name: d, url: urls.get(d) || null })) };
}

const words = { 2: 'dvaja', 3: 'traja', 4: 'štyria' };
function died(n, spoken) {
  if (n === 1) return spoken ? 'zahynul najmenej jeden človek' : 'zahynul najmenej 1 človek';
  if (n >= 2 && n <= 4) return `zahynuli najmenej ${spoken ? words[n] : n} ľudia`;
  return `zahynulo najmenej ${spoken ? spokenNumber(n) : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)} ľudí`;
}
/** „Zranených je najmenej 27." — jedna forma pre každé číslo. Pure. */
function hurtSentence(n, spoken) {
  return `Zranených je najmenej ${spoken ? spokenNumber(n) : String(n).replace(/B(?=(d{3})+(?!d))/g, NBSP)}.`;
}

/** Overené následky → veta a záber pre quakeScenario (facts). Pure. */
export function quakeFactsLine(f) {
  if (!f) return null;
  const text = (sp) => {
    const first = f.killed ? `Podľa médií ${died(f.killed, sp)}.` : f.noDeaths ? 'Podľa médií zatiaľ nikto nezahynul.' : '';
    return [first, f.injured ? hurtSentence(f.injured, sp) : ''].filter(Boolean).join(' ').replace(/^Zranených/, 'Podľa médií zranených');
  };
  const title = f.killed ? `${f.killed} ${f.killed === 1 ? 'MŔTVY' : f.killed <= 4 ? 'MŔTVI' : 'MŔTVYCH'}` : f.noDeaths ? 'BEZ OBETÍ' : 'ZRANENÍ';
  const rows = [f.injured && (f.killed || f.noDeaths) ? `najmenej ${f.injured} zranených` : null, 'čísla od dvoch médií · môžu sa meniť'].filter(Boolean);
  return { spoken: text(true), caption: text(false), title, rows, sources: f.sources };
}
