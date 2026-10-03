// src/data/frontWeekNarration.js — komentár a háčik videa „Týždeň na fronte" (2026-10-03). Z modelu týždňa
// (frontWeek.js) vety v dvoch podobách — `spoken` pre hlas (čísla slovami, cudzie názvy foneticky) a `caption`
// pre titulok (číslice) — každá priradená záberu (`shot`): háčik na úvodnej karte, prehľad frontu, smery,
// záver. Pravidlá vlastníka: prvé sekundy musia chytiť (najsilnejšie číslo týždňa hneď), text dramatický
// a s číslami; kritický voči agresorovi (ruský agresor „obsadil", „ruská okupácia", útoky sú „ruské",
// Ukrajina „oslobodila") — fakty a čísla ostávajú presné a so zdrojom: strety „ukrajinský generálny štáb
// hlási" (údaje jednej strany), zmena územia „z porovnania dvoch snímok mapy frontu okolive.sk".
// Zdroj mapy sa vo výstupoch volá okolive.sk (vlastník 2026-10-03: „používaj zdroje okolive.sk, nie
// DeepState") — pôvod dát vrstvy uvádza appka pri vrstve a DATA_SOURCES.md, výstupy ho nemenujú. Pure.

import { spokenNumber } from './eventSpeech.js';

const NBSP = ' ';
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Zdroj mapy vo výstupoch (karta, titulky, hlas, text príspevku): mapa frontu portálu, nie poskytovateľ dát. */
export const MAP_SOURCE = Object.freeze({ site: 'okolive.sk', spokenSite: 'okolajv bodka es ká', brand: 'OKO' });

/** Smery po slovensky: meno, titulok záberu (verzálky) a „kde" v 6. páde pre vetu („pri Pokrovsku"). */
const dir = (name, at) => Object.freeze({ name, title: name.toUpperCase(), at });
export const DIRECTION_SK = Object.freeze({
  sumy: dir('Sumský smer', 'na Sumskom smere'),
  vovchansk: dir('Vovčansk', 'pri Vovčansku'),
  kupiansk: dir('Kupianský smer', 'pri Kupiansku'),
  lyman: dir('Lymanský smer', 'pri Lymane'),
  'sloviansk-kramatorsk': dir('Sloviansk – Kramatorsk', 'pri Sloviansku a Kramatorsku'),
  kostiantynivka: dir('Kosťantynivský smer', 'pri Kosťantynivke'),
  pokrovsk: dir('Pokrovský smer', 'pri Pokrovsku'),
  oleksandrivka: dir('Oleksandrivský smer', 'na Oleksandrivskom smere'),
  huliaipole: dir('Huliajpiľský smer', 'pri Huliajpoli'),
  orikhiv: dir('Orichivský smer', 'pri Orichive'),
  kherson: dir('Chersonský smer', 'pri Chersone'),
});
export const directionSk = (id) => DIRECTION_SK[id] || dir(String(id || ''), 'na tomto smere');

/** „43 kilometrov štvorcových" / „43 km²"; 1 → „kilometer štvorcový", 2–4 → „kilometre štvorcové". Pure. */
export function km2Phrase(km2) {
  const v = Math.max(0, Math.round(Number(km2) || 0));
  const unit = v === 1 ? 'kilometer štvorcový' : (v >= 2 && v <= 4 ? 'kilometre štvorcové' : 'kilometrov štvorcových');
  return { value: v, spoken: `${spokenNumber(v)} ${unit}`, caption: `${group(v)}${NBSP}km²` };
}

/** „169 útokov" (1 útok, 2–4 útoky); `russian`: „169 ruských útokov" (1 ruský útok, 2–4 ruské útoky). Pure. */
export function attacksPhrase(n, { russian = false } = {}) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  const unit = v === 1 ? 'útok' : (v >= 2 && v <= 4 ? 'útoky' : 'útokov');
  const adj = !russian ? '' : (v === 1 ? 'ruský ' : (v >= 2 && v <= 4 ? 'ruské ' : 'ruských '));
  return { value: v, spoken: `${spokenNumber(v)} ${adj}${unit}`, caption: `${group(v)} ${adj}${unit}` };
}

/** „Ruských útokov tu bolo 56." (1: „Ruský útok tu bol jeden.", 2–4: „Ruské útoky tu boli tri.") — počty GŠ sú útoky nepriateľa. Pure. */
export function attacksHereSentence(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  const [lead, verb] = v === 1 ? ['Ruský útok', 'tu bol'] : (v >= 2 && v <= 4 ? ['Ruské útoky', 'tu boli'] : ['Ruských útokov', 'tu bolo']);
  return { spoken: `${lead} ${verb} ${spokenNumber(v)}.`, caption: `${lead} ${verb} ${group(v)}.` };
}

/** Zmena oproti minulému týždňu slovom: „o desatinu menej", „približne rovnako"; null bez porovnania. Pure. */
export function changePhrase(pct) {
  if (!Number.isFinite(pct)) return null;
  const a = Math.abs(pct);
  if (a < 5) return 'približne rovnako ako týždeň predtým';
  const how = a < 15 ? 'o desatinu' : a < 25 ? 'o pätinu' : a < 40 ? 'o tretinu' : a < 60 ? 'takmer o polovicu' : 'výrazne';
  return `${how} ${pct < 0 ? 'menej' : 'viac'} než týždeň predtým`;
}

const dayMonth = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[3])}.${NBSP}${Number(m[2])}.` : ''; };
/** „27. 9. – 3. 10. 2026". Pure. */
export function rangeLabel(from, to) {
  const y = /^(\d{4})/.exec(String(to || ''))?.[1] || '';
  return `${dayMonth(from)} – ${dayMonth(to)}${y ? ` ${y}` : ''}`;
}

/** Od akej zmeny (km²) sa o území hovorí — menšie rozdiely sú šum digitalizácie mapy. */
export const CHANGE_MIN_KM2 = 3;
export const HOOK_MIN_KM2 = 10;

/**
 * Druh príbehu týždňa: 'ua' (Ukrajina oslobodila aspoň toľko, čo Rusko obsadilo), 'ru' (Rusko postúpilo),
 * 'clashes' (mapa sa takmer nepohla alebo nie je — háčik je počet stretov). Pure.
 */
export function weekStory(model) {
  // Zmena územia „za týždeň" len z dvoch snímok s odstupom presne 7 dní — inak sa o území nehovorí.
  if (!model?.change?.weekly) return 'clashes';
  const g = model.change.ruKm2 ?? 0;
  const l = model.change.uaKm2 ?? 0;
  if (l >= HOOK_MIN_KM2 && l >= g) return 'ua';
  if (g >= HOOK_MIN_KM2) return 'ru';
  return 'clashes';
}

/**
 * Háčik úvodnej karty: `{tag, lines[1–3], sub, source}` (tvar eventVideoHud.normalizeVideoHook). Pure.
 */
export function frontWeekHook(model) {
  const story = weekStory(model);
  const g = km2Phrase(model?.change?.ruKm2 ?? 0);
  const l = km2Phrase(model?.change?.uaKm2 ?? 0);
  const mapSource = `z porovnania dvoch snímok mapy frontu ${MAP_SOURCE.site} · ${rangeLabel(model?.change?.fromDay, model?.change?.toDay)}`;
  if (story === 'ua') return { tag: 'TÝŽDEŇ NA FRONTE', lines: ['Ukrajina oslobodila', l.caption], sub: g.value >= 1 ? `Ruský agresor obsadil ${g.caption}` : null, source: mapSource };
  if (story === 'ru') return { tag: 'TÝŽDEŇ NA FRONTE', lines: ['Ruský agresor obsadil', `ďalších ${g.caption}`], sub: l.value >= 1 ? `Ukrajina oslobodila ${l.caption}` : null, source: mapSource };
  return { tag: 'TÝŽDEŇ NA FRONTE', lines: [`${group(model?.total?.week ?? 0)} bojových stretov`, 'za sedem dní'], sub: null, source: `podľa hlásení ukrajinského generálneho štábu · ${rangeLabel(model?.week?.from, model?.week?.to)}` };
}

/**
 * Smery, ktoré dostanú vlastný záber: dva s najviac útokmi a smer s najväčšou zmenou územia v prospech
 * strany, o ktorej je príbeh týždňa (ak medzi nimi ešte nie je). Najviac `max`. Pure.
 * @returns {Array<{id: string, role: 'top'|'second'|'story'|'counter'}>}
 */
export function directionShots(model, { max = 3 } = {}) {
  const dirs = (model?.directions || []).filter((d) => d.weekDays >= 4);
  const byAttacks = dirs.filter((d) => d.week > 0).slice(0, 2).map((d, i) => ({ id: d.id, role: i === 0 ? 'top' : 'second' }));
  const story = weekStory(model);
  const out = [...byAttacks];
  if (story !== 'clashes') {
    const top = (key, min) => [...(model?.directions || [])].filter((d) => (d[key] ?? 0) >= min).sort((a, b) => b[key] - a[key])[0] || null;
    // Kde sa front pohol najviac v prospech strany príbehu, a kde výrazne opačne (protipohyb od 10 km²).
    const best = top(story === 'ua' ? 'uaKm2' : 'ruKm2', CHANGE_MIN_KM2);
    const counter = top(story === 'ua' ? 'ruKm2' : 'uaKm2', HOOK_MIN_KM2);
    if (best && !out.some((s) => s.id === best.id)) out.push({ id: best.id, role: 'story' });
    if (counter && !out.some((s) => s.id === counter.id)) out.push({ id: counter.id, role: 'counter' });
  }
  return out.slice(0, max);
}

/**
 * Veta o zmene územia v smere (alebo null pod prahom či bez týždenného porovnania): kto sa pohol a o koľko.
 * Zdroj zmeny zaznie v prehľade (veta `src`); v týždni bez nej (`named`) ho nesie veta sama. Pure.
 */
function directionChangeSentence(d, model, named) {
  if (!model?.change?.weekly) return null;
  const g = d.ruKm2 ?? 0;
  const l = d.uaKm2 ?? 0;
  if (g >= CHANGE_MIN_KM2 && g >= l) {
    const p = km2Phrase(g);
    return named
      ? { spoken: `Podľa mapy frontu ${MAP_SOURCE.brand} sa tu ruská okupácia za týždeň rozšírila o ${p.spoken}.`, caption: `Podľa mapy frontu ${MAP_SOURCE.brand} sa tu ruská okupácia za týždeň rozšírila o ${p.caption}.`, names: true }
      : { spoken: `Ruská okupácia sa tu rozšírila o ${p.spoken}.`, caption: `Ruská okupácia sa tu rozšírila o ${p.caption}.` };
  }
  if (l >= CHANGE_MIN_KM2) {
    const p = km2Phrase(l);
    return named
      ? { spoken: `Podľa mapy frontu ${MAP_SOURCE.brand} tu Ukrajina za týždeň oslobodila ${p.spoken}.`, caption: `Podľa mapy frontu ${MAP_SOURCE.brand} tu Ukrajina za týždeň oslobodila ${p.caption}.`, names: true }
      : { spoken: `Ukrajina tu oslobodila ${p.spoken}.`, caption: `Ukrajina tu oslobodila ${p.caption}.` };
  }
  return null;
}

/**
 * Vety komentára v poradí záberov. `shot`: 'opening' (háčik na karte), 'overview', `dir:<id>`, 'closing'.
 * @returns {Array<{id: string, shot: string, spoken: string, caption: string, approved?: boolean}>}
 */
export function frontWeekLines(model) {
  const out = [];
  const story = weekStory(model);
  const g = km2Phrase(model?.change?.ruKm2 ?? 0);
  const l = km2Phrase(model?.change?.uaKm2 ?? 0);
  const total = model?.total || { week: 0 };
  const clashes = { spoken: `${spokenNumber(total.week)} bojových stretov`, caption: `${group(total.week)} bojových stretov` };

  // ── háčik: najsilnejšie číslo týždňa hneď v prvej vete (na úvodnej karte); druhé číslo už nad mapou
  //    frontu — karta nestojí dlhšie než jednu vetu a popisy na mape ukážu, kde sa to stalo ──
  if (story === 'ua') {
    out.push({ id: 'hook1', shot: 'opening', spoken: `Ukrajina za týždeň oslobodila ${l.spoken}.`, caption: `Ukrajina za týždeň oslobodila ${l.caption}.` });
    if (g.value >= 1) out.push({ id: 'hook2', shot: 'overview', spoken: `Ruský agresor za ten istý čas obsadil ${g.spoken}.`, caption: `Ruský agresor za ten istý čas obsadil ${g.caption}.` });
  } else if (story === 'ru') {
    out.push({ id: 'hook1', shot: 'opening', spoken: `Ruský agresor za týždeň obsadil ďalších ${g.spoken} Ukrajiny.`, caption: `Ruský agresor za týždeň obsadil ďalších ${g.caption} Ukrajiny.` });
    if (l.value >= 1) out.push({ id: 'hook2', shot: 'overview', spoken: `Ukrajina oslobodila ${l.spoken}.`, caption: `Ukrajina oslobodila ${l.caption}.` });
  } else {
    out.push({ id: 'hook1', shot: 'opening', spoken: `${cap(clashes.spoken)} za sedem dní.`, caption: `${cap(clashes.caption)} za sedem dní.` });
  }

  // ── prehľad frontu: odkiaľ čísla sú ──
  if (story !== 'clashes') {
    // Pevná veta (doména foneticky, bez čísel) — ako veta portálu sa nahrá raz a prepisom sa nekontroluje.
    out.push({ id: 'src', shot: 'overview', spoken: `Ukazuje to mapa frontu na ${MAP_SOURCE.spokenSite}: porovnanie dvoch snímok s odstupom siedmich dní.`, caption: `Ukazuje to mapa frontu na ${MAP_SOURCE.site}: porovnanie dvoch snímok s odstupom siedmich dní.`, approved: true });
    const cmp = changePhrase(total.changePct);
    out.push({
      id: 'total', shot: 'overview',
      spoken: `Ukrajinský generálny štáb hlási za týždeň ${clashes.spoken}${cmp ? ` — ${cmp}` : ''}.`,
      caption: `Ukrajinský generálny štáb hlási za týždeň ${clashes.caption}${cmp ? ` — ${cmp}` : ''}.`,
    });
  } else {
    const cmp = changePhrase(total.changePct);
    out.push({ id: 'total', shot: 'overview', spoken: `Hlási ich ukrajinský generálny štáb${cmp ? ` — ${cmp}` : ''}.`, caption: `Hlási ich ukrajinský generálny štáb${cmp ? ` — ${cmp}` : ''}.` });
  }

  // ── smery ──
  const byId = Object.fromEntries((model?.directions || []).map((d) => [d.id, d]));
  let topWeek = 0;
  for (const s of directionShots(model)) {
    const d = byId[s.id];
    if (!d) continue;
    const sk = directionSk(d.id);
    const a = attacksPhrase(d.week);
    const shot = `dir:${d.id}`;
    if (s.role === 'top') {
      topWeek = d.week;
      out.push({ id: `${d.id}-a`, shot, spoken: `Najviac ruských útokov je ${sk.at}: ${spokenNumber(d.week)} za týždeň.`, caption: `Najviac ruských útokov je ${sk.at}: ${group(d.week)} za týždeň.`, names: true });
    } else if (s.role === 'second') {
      // Druhý smer tesne za prvým (od 85 %) = „takmer rovnako útočí agresor", inak len počet.
      const close = topWeek > 0 && d.week >= topWeek * 0.85;
      const ra = attacksPhrase(d.week, { russian: true });
      out.push(close
        ? { id: `${d.id}-a`, shot, spoken: `Takmer rovnako útočí agresor ${sk.at}: ${a.spoken}.`, caption: `Takmer rovnako útočí agresor ${sk.at}: ${a.caption}.`, names: true }
        : { id: `${d.id}-a`, shot, spoken: `${cap(sk.at)} ${ra.spoken}.`, caption: `${cap(sk.at)} ${ra.caption}.`, names: true });
    }
    else {
      // Smer príbehu týždňa (alebo protipohybu): zmena územia je hlavná veta, útoky dopĺňajú.
      const uaSide = (s.role === 'story') === (story === 'ua');
      const p = uaSide ? km2Phrase(d.uaKm2) : km2Phrase(d.ruKm2);
      const what = uaSide ? 'Ukrajina tu oslobodila' : 'ruská okupácia sa tu rozšírila o';
      const lead = s.role === 'counter' ? 'sa front pohol opačným smerom' : 'sa front pohol najviac';
      out.push({ id: `${d.id}-a`, shot, spoken: `${cap(sk.at)} ${lead}: ${what} ${p.spoken}.`, caption: `${cap(sk.at)} ${lead}: ${what} ${p.caption}.`, names: true });
      if (d.week > 0) out.push({ id: `${d.id}-b`, shot, ...attacksHereSentence(d.week) });
      continue;
    }
    const ch = directionChangeSentence(d, model, story === 'clashes');
    if (ch) out.push({ id: `${d.id}-b`, shot, ...ch });
  }

  // ── záver: portál (pevná veta — doména foneticky, bez kontroly výslovnosti) ──
  out.push({ id: 'portal', shot: 'closing', spoken: 'Mapu frontu deň po dni nájdete na okolajv bodka es ká.', caption: 'Mapu frontu deň po dni nájdete na okolive.sk.', approved: true });
  return out;
}
