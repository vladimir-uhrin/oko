// src/data/frontDayNarration.js — komentár a text príspevku denného videa „Deň na fronte" (2026-10-05).
// Vlastník: „denné akčné spravodajstvo z UA … systém, nie ty", „v štýle OKO a text kvalitnejší", „riaď sa FB".
// Štýl spravodajskej agentúry: najsilnejší overený fakt dňa prvý (háčik), potom každá veta nová informácia
// (strety a porovnanie s týždňom, kde sa bojuje najviac, zmena mapy, nočná hrozba z neba, údery, zábery),
// bez emoji, bez vyzývania na reakcie (FB ho trestá). Kritický voči agresorovi („ruský agresor obsadil",
// „ruská okupácia", „ruské útoky", „okupačné jednotky") — a presný: počty GŠ = údaje jednej strany, hlásená
// hrozba ≠ potvrdený útok, zmena územia „za deň" len pri dennom odstupe snímok mapy, zdroj mapy okolive.sk.
// Každá veta: `spoken` (čísla slovami, doména foneticky) a `caption` (číslice) + záber (`shot`) pre plán videa. Pure.

import { spokenNumber } from './eventSpeech.js';
import { MAP_SOURCE, directionSk } from './frontWeekNarration.js';

const NBSP = ' ';
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Od akej zmeny (km²) sa o území hovorí — menšie rozdiely sú šum digitalizácie mapy. */
export const DAY_CHANGE_MIN_KM2 = 3;
/** Od akej zmeny je mapa háčikom aj vtedy, keď bola v noci veľká hrozba z neba (menšia zmena ustúpi). */
export const DAY_HOOK_KM2 = 10;
/** Od koľkých oblastí je nočná hrozba z neba háčikom dňa / vetou. */
export const AIR_HOOK_OBLASTS = 10;
export const AIR_LINE_OBLASTS = 5;
export const FRONT_URL = 'https://okolive.sk/?front=front';

/** Číslo + tvar podstatného mena v hlase aj titulku: { spoken: 'tridsaťjeden ruských útokov', caption: '31 ruských útokov' }. */
function counted(n, forms) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  const unit = plural(v, ...forms);
  return { value: v, spoken: `${spokenNumber(v)} ${unit}`, caption: `${group(v)}${NBSP}${unit}` };
}
const KM2 = ['kilometer štvorcový', 'kilometre štvorcové', 'kilometrov štvorcových'];
function km2(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return { value: v, spoken: `${spokenNumber(v)} ${plural(v, ...KM2)}`, caption: `${group(v)}${NBSP}km²` };
}
const CLASHES = ['bojový stret', 'bojové strety', 'bojových stretov'];
const ATTACKS = ['ruský útok', 'ruské útoky', 'ruských útokov'];
const OBLASTS = ['oblasť', 'oblasti', 'oblastí'];
/** Údery z hlásenia GŠ v akuzatíve po „použil". */
const STRIKES = Object.freeze({
  guidedBombs: ['riadenú leteckú bombu', 'riadené letecké bomby', 'riadených leteckých bômb'],
  kamikazeDrones: ['dron-kamikadze', 'drony-kamikadze', 'dronov-kamikadze'],
  airStrikes: ['letecký úder', 'letecké údery', 'leteckých úderov'],
  missileStrikes: ['raketový úder', 'raketové údery', 'raketových úderov'],
});
const KIND_GEN = { drones: 'dronov', missiles: 'rakiet', bombs: 'riadených bômb' };
const listSk = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} a ${items.at(-1)}`);
const dayMonth = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[3])}.${NBSP}${Number(m[2])}.` : ''; };
const dayMonthYear = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[3])}.${NBSP}${Number(m[2])}.${NBSP}${m[1]}` : ''; };

/** „za uplynulý deň" / „za posledné dva dni" — odstup snímok mapy povie pravdu, nie predpoklad. */
function spanPhrase(spanDays) {
  if (!Number.isFinite(spanDays) || spanDays <= 1) return { spoken: 'za uplynulý deň', caption: 'za uplynulý deň' };
  const words = { 2: 'dva', 3: 'tri', 4: 'štyri' };
  return { spoken: `za posledné ${words[spanDays] || spokenNumber(spanDays)} dni`, caption: `za posledné ${spanDays} dni` };
}

/**
 * Príbeh dňa (háčik): 'ru' (ruský agresor obsadil ≥ 3 km² a viac než Ukrajina oslobodila), 'ua' (naopak),
 * 'air' (nočná hrozba z neba pre ≥ 10 oblastí), inak 'clashes' (počet stretov). Pure.
 */
export function dayStory(model) {
  const c = model?.change;
  const bigAir = model?.air?.count >= AIR_HOOK_OBLASTS;
  // Malá zmena mapy (3–10 km²) ustúpi veľkej nočnej hrozbe z neba — háčik má byť najsilnejší fakt dňa.
  const enough = (km2) => km2 >= DAY_HOOK_KM2 || (km2 >= DAY_CHANGE_MIN_KM2 && !bigAir);
  if (c && enough(c.ruKm2) && c.ruKm2 >= c.uaKm2) return 'ru';
  if (c && enough(c.uaKm2) && c.uaKm2 > c.ruKm2) return 'ua';
  if (bigAir) return 'air';
  return 'clashes';
}

/** „ďalší 1 km²" / „ďalšie 3 km²" / „ďalších 8 km²". */
const further = (n) => (n === 1 ? 'ďalší' : n >= 2 && n <= 4 ? 'ďalšie' : 'ďalších');

/** Porovnanie stretov so 7-dňovým priemerom ako samostatná veta; null bez histórie. */
function averageWord(total, avg) {
  if (!Number.isFinite(avg) || !Number.isFinite(total)) return null;
  if (Math.abs(total - avg) < Math.max(5, avg * 0.07)) return 'približne toľko ako v priemere za posledný týždeň';
  const strong = Math.abs(total - avg) >= avg * 0.3;
  return `${strong ? 'výrazne ' : ''}${total > avg ? 'viac' : 'menej'} ako v priemere za posledný týždeň`;
}

function airSentence(air) {
  const n = counted(air.count, OBLASTS);
  const kinds = (air.kinds || []).map(k => KIND_GEN[k]).filter(Boolean);
  const what = kinds.length ? `ruských ${listSk(kinds)}` : 'ruského vzdušného útoku';
  const text = (num) => `V noci Vzdušné sily Ukrajiny hlásili hrozbu ${what} pre ${num} Ukrajiny.`;
  return { spoken: text(n.spoken), caption: text(n.caption) };
}

/** Háčik pre úvodnú kartu videa a rám reelu: { tag, lines[], accent, sub }. Pure. */
export function frontDayHook(model) {
  const story = dayStory(model);
  const tag = `DEŇ NA FRONTE · ${dayMonth(model.day)}`;
  if (story === 'ru' || story === 'ua') {
    const k = km2(story === 'ru' ? model.change.ruKm2 : model.change.uaKm2);
    const top = model.change.directions?.find(d => (story === 'ru' ? d.ruKm2 : d.uaKm2) >= 1);
    return { tag, lines: story === 'ru' ? ['RUSKÝ AGRESOR OBSADIL', `${further(k.value).toUpperCase()} ${k.caption}`] : ['UKRAJINA OSLOBODILA', k.caption], accent: k.caption,
      sub: top ? `najviac ${directionSk(top.id).at}` : null };
  }
  if (story === 'air') {
    const n = model.air.count;
    return { tag, lines: [`${n} ${plural(n, ...OBLASTS).toUpperCase()}`, 'POD HROZBOU RUSKÉHO ÚTOKU'], accent: String(n), sub: 'v noci podľa Vzdušných síl Ukrajiny' };
  }
  const t = model.report.total;
  return { tag, lines: [`${group(t)} BOJOVÝCH STRETOV`, 'ZA JEDINÝ DEŇ'], accent: group(t), sub: 'podľa Generálneho štábu Ukrajiny' };
}

/**
 * Vety komentára: [{id, shot, spoken, caption, names?, approved?}]. Záber: 'opening' (karta s háčikom),
 * 'overview' (celý front), 'dir:<smer>' (prelet nad smer), 'clip:<i>' (akčný záber), 'air' (celá Ukrajina),
 * 'closing'. Najviac ~8 viet → 30–40 s. Pure.
 */
export function frontDayLines(model) {
  const story = dayStory(model);
  const lines = [];
  const span = spanPhrase(model.change?.spanDays);
  const total = counted(model.report.total, CLASHES);
  const avg = averageWord(model.report.total, model.avg7);
  const top = (model.directions || []).find(d => d.attacks > 0) || null;
  const changeDir = model.change?.directions?.find(d => (story === 'ua' ? d.uaKm2 : d.ruKm2) >= 1) || null;

  // 1. Háčik — najsilnejší fakt dňa.
  if (story === 'ru' || story === 'ua') {
    const k = km2(story === 'ru' ? model.change.ruKm2 : model.change.uaKm2);
    const s = story === 'ru'
      ? (num, sp) => `Ruský agresor ${sp} obsadil ${further(k.value)} ${num} Ukrajiny.`
      : (num, sp) => `Ukrajina ${sp} oslobodila ${num} svojho územia.`;
    lines.push({ id: 'hook', shot: 'opening', spoken: s(k.spoken, span.spoken), caption: s(k.caption, span.caption) });
  } else if (story === 'air') {
    lines.push({ id: 'hook', shot: 'opening', ...airSentence(model.air) });
  } else {
    const s = (num) => `Generálny štáb Ukrajiny hlási za uplynulý deň ${num} s ruskými okupačnými jednotkami.`;
    lines.push({ id: 'hook', shot: 'opening', spoken: s(total.spoken), caption: s(total.caption) });
  }

  // 2. Strety (alebo pri háčiku o stretoch ich porovnanie).
  if (story !== 'clashes') {
    const s = (num) => `Generálny štáb Ukrajiny hlási za uplynulý deň ${num} s ruskými okupačnými jednotkami.${avg ? ` To je ${avg}.` : ''}`;
    lines.push({ id: 'clashes', shot: 'overview', spoken: s(total.spoken), caption: s(total.caption) });
  } else if (avg) {
    lines.push({ id: 'clashes', shot: 'overview', spoken: `To je ${avg}.`, caption: `To je ${avg}.` });
  }

  // 3. Kde sa bojuje najviac.
  if (top) {
    const a = counted(top.attacks, ATTACKS);
    const s = (num) => `Najťažšie boje sú ${directionSk(top.id).at}, kde generálny štáb hlási ${num}.`;
    lines.push({ id: 'top', shot: `dir:${top.id}`, spoken: s(a.spoken), caption: s(a.caption), names: true });
  }

  // 4. Prvý akčný záber.
  const clip = (i) => {
    const c = model.clips?.[i];
    if (!c) return;
    const where = c.direction ? ` ${directionSk(c.direction).at}` : '';
    const text = `Na záberoch ministerstva obrany ${c.captionSk.replace(/^Ukrajinské sily /, 'ukrajinské sily ')}${where}.`;
    lines.push({ id: `clip${i}`, shot: `clip:${i}`, spoken: text, caption: text, names: Boolean(where) });
  };
  clip(0);

  // 5. Zmena mapy pri smere (háčik povedal koľko, tu kde; alebo zmena, ktorá nebola háčikom).
  if (changeDir && (story === 'ru' || story === 'ua')) {
    const text = story === 'ru' ? `Ruská okupácia sa rozšírila najmä ${directionSk(changeDir.id).at}.` : `Najviac územia sa vrátilo ${directionSk(changeDir.id).at}.`;
    lines.push({ id: 'change', shot: `dir:${changeDir.id}`, spoken: text, caption: text, names: true });
  } else if (model.change && model.change.ruKm2 >= DAY_CHANGE_MIN_KM2) {
    const k = km2(model.change.ruKm2);
    const d = model.change.directions?.find(x => x.ruKm2 >= 1);
    const s = (num, sp) => `Ruský agresor ${sp} obsadil ${num}${d ? `, najviac ${directionSk(d.id).at}` : ''}.`;
    lines.push({ id: 'change', shot: d ? `dir:${d.id}` : 'overview', spoken: s(k.spoken, span.spoken), caption: s(k.caption, span.caption), names: Boolean(d) });
  }

  // 6. Nočná hrozba z neba (ak nebola háčikom).
  if (story !== 'air' && model.air?.count >= AIR_LINE_OBLASTS) lines.push({ id: 'air', shot: 'air', ...airSentence(model.air) });

  // 7. Údery z hlásenia (dva najväčšie).
  const strikes = Object.entries(STRIKES).map(([key, forms]) => ({ key, forms, n: model.strikes?.[key] })).filter(s => Number.isFinite(s.n) && s.n > 0)
    .sort((a, b) => b.n - a.n).slice(0, 2);
  if (strikes.length) {
    const parts = strikes.map(s => counted(s.n, s.forms));
    const s = (key) => `Ruský agresor podľa hlásenia použil ${listSk(parts.map(p => p[key]))}.`;
    lines.push({ id: 'strikes', shot: 'air', spoken: s('spoken'), caption: s('caption') });
  }

  // 8. Druhý akčný záber.
  clip(1);

  // 9. Záver: zdroj a portál (pevná, schválená veta).
  lines.push({ id: 'portal', shot: 'closing', approved: true,
    spoken: `Počty stretov sú údaje jednej strany. Denný prehľad frontu na ${MAP_SOURCE.spokenSite}.`,
    caption: `Počty stretov sú údaje jednej strany. Denný prehľad frontu na ${MAP_SOURCE.site}.` });
  return lines;
}

/**
 * Text príspevku na Facebook: háčik v prvom riadku (do ~125 znakov, viac FB pred „viac" neukáže), vecné odseky,
 * zdroje a odkazy (ArmyInform žiada priamy odkaz), mapa frontu, 3–4 hashtagy, bez emoji a bez vyzývania. Pure.
 */
export function frontDayPostText(model) {
  const story = dayStory(model);
  const hook = frontDayLines(model)[0].caption;
  // Háčik o hrozbe z neba hneď spresní, že nejde o potvrdené zásahy (a odsek o noci sa už neopakuje).
  const out = [story === 'air' ? `${hook} Ide o hlásenú hrozbu, nie o potvrdené zásahy.` : hook, ''];
  const avg = Number.isFinite(model.avg7) ? ` (7-dňový priemer: ${group(model.avg7)})` : '';
  const top = (model.directions || []).filter(d => d.attacks > 0).slice(0, 3);
  // Ranné hlásenie GŠ pokrýva uplynulých 24 hodín — nie kalendárny deň hlásenia.
  out.push(`Ukrajinský generálny štáb v rannom hlásení ${dayMonthYear(model.day)} uvádza za uplynulých 24 hodín ${group(model.report.total)} bojových stretov s ruskými okupačnými jednotkami${avg}.`
    + (top.length ? ` Najviac ruských útokov: ${top.map(d => `${directionSk(d.id).name} ${d.attacks}`).join(', ')}.` : ''));
  const c = model.change;
  if (c && (c.ruKm2 >= DAY_CHANGE_MIN_KM2 || c.uaKm2 >= DAY_CHANGE_MIN_KM2)) {
    const parts = [];
    if (c.ruKm2 >= 1) parts.push(`ruský agresor obsadil ${group(c.ruKm2)} km²`);
    if (c.uaKm2 >= 1) parts.push(`Ukrajina oslobodila ${group(c.uaKm2)} km²`);
    const span = spanPhrase(c.spanDays).caption;
    out.push('', `Mapa frontu ${MAP_SOURCE.site} ${span}: ${parts.join(', ')}.`
      + (c.toGreyKm2 >= 1 ? ` Ďalších ${group(c.toGreyKm2)} km² prešlo z ruskej kontroly do sivej zóny (nie je to ukrajinský zisk).` : '')
      + ' Zmena je vypočítaná z porovnania dvoch denných snímok mapy frontu; mapa zachytáva stav s oneskorením 2–3 dni.');
  }
  if (story !== 'air' && model.air?.count >= AIR_LINE_OBLASTS) out.push('', `${airSentence(model.air).caption} Ide o hlásenú hrozbu, nie o potvrdené zásahy.`);
  const used = (model.clips || []).filter(Boolean);
  if (used.length) out.push('', ...used.map(clip => `Záber: ${clip.captionSk}${clip.direction ? ` ${directionSk(clip.direction).at}` : ''} — ArmyInform, Ministerstvo obrany Ukrajiny (CC BY 4.0): ${clip.url}`));
  out.push('', 'Počty stretov a úderov sú údaje jednej strany (Generálny štáb Ukrajiny), nezávisle neoverené.'
    + (model.report.url ? ` Hlásenie: ${model.report.url}` : ''));
  out.push('', `Denný prehľad frontu každé ráno. Mapa frontu deň po dni: ${FRONT_URL}`, '', '#Ukrajina #vojna #front #OKO');
  return out.join('\n');
}
