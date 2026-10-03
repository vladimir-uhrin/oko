// src/data/eventVideoScript.js — scenár videa od vlastníka (2026-10-03): to jediné, kde treba úsudok, vyplní
// vlastník vo formulári udalosti — háčik na začiatok (PRAVIDLO: prvé 3–4 sekundy musia diváka chytiť),
// doplnky zo správ (pripnuté k momentu — pád, ticho, kód, obrat, koniec údajov, pristátie — alebo na
// koniec; vlastník 10-03: „viac informácií") a prípadné náhrady vygenerovaných viet. Každý výrok zo správ nesie zdroje:
// odkazy na články dôveryhodných médií s presným citátom (kód overí, že citát je v článku doslova —
// pipeline) a koho výrok to je („izraelský premiér"). Bez zdroja sa scenár neprijme. Pure.

import { trustedDomainOf } from './eventNews.js';
import { outletName } from './eventPost.js';
import { normalizeVideoHook } from './eventVideoHud.js';
import { HIDDEN_VIA } from './eventReported.js';
import { spokenDigits } from './eventSpeech.js';

export const SCRIPT_LIMITS = Object.freeze({ spokenMax: 220, captionMax: 160, hookSpoken: 3, extras: 8, sources: 3, quoteMin: 10, quoteMax: 600, attributedMax: 60, lineOverrides: 20 });

/** Kam sa doplnok zaradí (`extras[].after`): za vety daného momentu; `end` (predvolené) = na záver. */
export const EXTRA_AFTER = Object.freeze(['intro', 'dive', 'gap', 'squawk', 'uturn', 'last-contact', 'landing', 'end']);

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max + 1) : '');
const bad = (why, index = null) => Object.assign(new Error(`scenár: ${why}`), { code: 'BAD_SCRIPT', why, index });

/** Jeden zdroj: https odkaz na dôveryhodné médium + presný citát. Pure. */
export function normalizeSource(input, trusted) {
  if (!input || typeof input !== 'object') throw bad('chýba zdroj (odkaz na článok a citát)');
  let host;
  try {
    const u = new URL(String(input.url || ''));
    if (u.protocol !== 'https:') throw new Error();
    host = u.hostname;
  } catch { throw bad('odkaz na článok musí byť https adresa'); }
  const domain = trustedDomainOf(host, trusted || []);
  if (!domain) throw bad(`médium ${host} nie je v zozname dôveryhodných`);
  const quote = str(input.quote, SCRIPT_LIMITS.quoteMax);
  if (quote.length < SCRIPT_LIMITS.quoteMin || quote.length > SCRIPT_LIMITS.quoteMax) throw bad('citát 10–600 znakov, doslova z článku');
  return { url: String(input.url), domain, quote };
}

/** Zdroje výroku (1–3, každé médium raz) + koho výrok. Pure. */
function normalizeSources(input, trusted, index) {
  const list = Array.isArray(input?.sources) ? input.sources : (input?.source ? [input.source] : []);
  if (!list.length || list.length > SCRIPT_LIMITS.sources) throw bad('výrok potrebuje 1–3 zdroje (odkaz + citát)', index);
  const sources = list.map((s) => normalizeSource(s, trusted));
  if (new Set(sources.map((s) => s.domain)).size !== sources.length) throw bad('každé médium raz', index);
  const attributed = str(input.attributed, SCRIPT_LIMITS.attributedMax) || null;
  return { sources, attributed };
}

/** Riadok zdroja na kartu/titulky: „podľa izraelského premiéra · Al Jazeera, Arab News". Pure. */
export function sourceLine({ attributed, sources }) {
  const names = [...new Set((sources || []).map((s) => outletName(s.domain)))].join(', ');
  return `${attributed ? `podľa ${attributed}` : 'podľa správ'} · ${names}`;
}

/**
 * Veta hlasu a titulok: bez konkurenčnej služby (eventReported.HIDDEN_VIA), v medziach dĺžky. Číslice vo vete
 * hlasu sa prepíšu na slová (eventSpeech.spokenDigits — hlas číslice číta zle), titulok ostáva tak, ako ho
 * vlastník napísal (s číslicami); číslo s neistým tvarom sa vráti vlastníkovi s radou. Pure.
 */
function normalizeLine(input, index) {
  const written = str(input?.spoken, SCRIPT_LIMITS.spokenMax);
  if (!written || written.length > SCRIPT_LIMITS.spokenMax) throw bad('veta hlasu 1–220 znakov', index);
  const digits = spokenDigits(written);
  if (digits.problem) throw bad(`${digits.problem} — hlas číslice číta zle, titulok ich mať môže`, index);
  const spoken = digits.text;
  if (spoken.length > SCRIPT_LIMITS.spokenMax + 120) throw bad('veta hlasu je po prepise čísel na slová pridlhá', index);
  const caption = str(input?.caption, SCRIPT_LIMITS.captionMax) || written;
  if (caption.length > SCRIPT_LIMITS.captionMax) throw bad('titulok najviac 160 znakov', index);
  if (HIDDEN_VIA.test(spoken) || HIDDEN_VIA.test(caption)) throw bad('konkurenčná služba sledovania letov sa nemenuje — napíš „podľa správ"', index);
  return { spoken, caption };
}

/**
 * Scenár: `{hook: {tag, lines, sub, source, spoken[], captions[], attributed, sources[]}, extras:
 * [{spoken, caption, attributed, sources[], after}], lines: {id: {spoken, caption} | {skip: true}}}`. Prázdny vstup = null. Pure.
 * @param {unknown} input
 * @param {{trusted: string[]}} ctx dôveryhodné médiá (trusted-news.json)
 */
export function normalizeVideoScript(input, { trusted = [] } = {}) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw bad('scenár musí byť objekt');
  const out = { hook: null, extras: [], lines: {} };
  if (input.hook) {
    const { sources, attributed } = normalizeSources(input.hook, trusted, 'hook');
    const card = normalizeVideoHook({ tag: input.hook.tag, lines: input.hook.lines, sub: input.hook.sub, source: sourceLine({ attributed, sources }) });
    const spokenIn = Array.isArray(input.hook.spoken) ? input.hook.spoken : [input.hook.spoken];
    if (!spokenIn.length || spokenIn.length > SCRIPT_LIMITS.hookSpoken) throw bad('háčik má 1–3 vety hlasu', 'hook');
    const captionsIn = Array.isArray(input.hook.captions) ? input.hook.captions : [];
    const spoken = [];
    const captions = [];
    spokenIn.forEach((s, i) => { const l = normalizeLine({ spoken: s, caption: captionsIn[i] }, 'hook'); spoken.push(l.spoken); captions.push(l.caption); });
    out.hook = { ...card, spoken, captions, attributed, sources };
  }
  const extras = Array.isArray(input.extras) ? input.extras : [];
  if (extras.length > SCRIPT_LIMITS.extras) throw bad(`najviac ${SCRIPT_LIMITS.extras} doplnkov zo správ`);
  out.extras = extras.map((x, i) => {
    const after = x?.after === undefined || x.after === null || x.after === '' ? 'end' : String(x.after);
    if (!EXTRA_AFTER.includes(after)) throw bad(`doplnok: neznáme miesto „${after.slice(0, 20)}" (${EXTRA_AFTER.join(', ')})`, `extra${i + 1}`);
    return { ...normalizeLine(x, `extra${i + 1}`), ...normalizeSources(x, trusted, `extra${i + 1}`), after };
  });
  const lines = input.lines && typeof input.lines === 'object' ? input.lines : {};
  const ids = Object.keys(lines);
  if (ids.length > SCRIPT_LIMITS.lineOverrides) throw bad('priveľa náhrad viet');
  for (const id of ids) {
    if (!/^[a-z0-9]{1,12}$/.test(id)) throw bad(`neplatné id vety ${id}`);
    // `{skip: true}` vygenerovanú vetu vynechá (napr. pokles zo správ, keď to isté hovorí veta z dát).
    out.lines[id] = lines[id]?.skip === true ? { skip: true } : normalizeLine(lines[id], id);
  }
  return out;
}

/** Je citát doslova v texte stránky? (úvodzovky, pomlčky a medzery zjednotené; bez HTML značiek). Pure. */
export function quoteFoundIn(pageText, quote) {
  const norm = (s) => String(s || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;|&#39;|&#039;|&rsquo;|&lsquo;|&ldquo;|&rdquo;|&#8216;|&#8217;|&#8220;|&#8221;/g, "'").replace(/&amp;/g, '&')
    .replace(/[‘’‚‛′"“”„‟″„“”]/g, "'").replace(/[–—−]/g, '-').replace(/\s+/g, ' ').toLowerCase().trim();
  const q = norm(quote);
  return q.length >= SCRIPT_LIMITS.quoteMin && norm(pageText).includes(q);
}

/** Všetky zdroje scenára (háčik aj doplnky) na overenie citátov v článkoch. Pure. */
export function scriptSources(script) {
  const out = [];
  (script?.hook?.sources || []).forEach((s) => out.push({ where: 'hook', ...s }));
  (script?.extras || []).forEach((x, i) => (x.sources || []).forEach((s) => out.push({ where: `extra${i + 1}`, ...s })));
  return out;
}

/** Háčik pre úvodnú kartu videa (eventVideoHud.buildEventVideoHudSvg `hook`). Pure. */
export function hookCard(script) {
  const h = script?.hook;
  return h ? { tag: h.tag, lines: h.lines, sub: h.sub, source: h.source } : null;
}
