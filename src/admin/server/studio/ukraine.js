// OKO Štúdio — Ukrajina (2026-10-04, vlastník: „Ukrajina" + „mám tam aj feedy z YT, telegram a iné … aj to by
// som chcel naviac spracovať, by to bolo aktuálne"). Päť šablón z dát, ktoré OKO už zbiera (0 €):
//
//   ua-report     denné hlásenie Generálneho štábu ZSU: strety, smery, údery, porovnanie s 7-dňovým priemerom,
//   ua-front      zmena frontu za deň z dvoch denných snímok mapy frontu (ten istý výpočet ako vrstva a video),
//   ua-air        veľký vzdušný útok: hrozba hlásená Vzdušnými silami ZSU pre veľa oblastí naraz,
//   ua-media      fotky a videá oficiálnych kanálov UA (GŠ, MO, DSNS; licencia doložená len pri MO a ArmyInform),
//   ua-week       Týždeň na fronte ako karusel obrázkov (bez Chromu, popri videu).
//
// Redakčné pravidlá vlastníka (docs/CURRENT-STATE.md, Týždeň na fronte): kritický voči agresorovi („ruský
// agresor", „ruské útoky"), počty stretov vždy „podľa ukrajinského generálneho štábu" a „údaje jednej strany",
// poskytovateľ mapy frontu sa nemenuje (zdroj = mapa frontu okolive.sk), vždy odkaz na mapu frontu, priamy
// odkaz na ArmyInform; prechod okupované → sivá zóna nie je ukrajinský zisk. Bez obetí v záberoch a bez
// ľudí ako cieľa (pravidlo 6) — preto ua-media nikdy nejde von automaticky, len po schválení človekom.
//
// YouTube videá sa NEpreberajú: podmienky YouTube nedovoľujú video stiahnuť a nahrať inde (OKO ich len
// vkladá prehrávačom). Preposlané príspevky Telegramu (brigády) parser vynecháva už pri zbere.

import path from 'node:path';
import { classifyUkText, locateUkText, mediaToAlert, ukCasualties, UK_OBLAST_HINTS } from '../../../data/ukraineMedia.js';
import { UKRAINE_GAZETTEER } from '../../../data/ukraineIncidents.js';
import { changeBreakdown, polyIndex } from '../../../data/frontWeek.js';
import { occupiedChangeRaster, shiftDay } from '../../../data/ukraineContactLine.js';
import { isPartialReport } from '../../../data/ukraineDirectionTrend.js';
import { CHANGE_MIN_KM2, DIRECTION_SK, MAP_SOURCE, rangeLabel } from '../../../data/frontWeekNarration.js';
import { insetOccupiedRings } from '../../../data/frontWeekHud.js';
import { FRONT_SCENES, frontSceneByGsDirection } from '../../../ukraineFrontScenes.js';
import { date, plural, when } from './templates.js';

const DAY_MS = 86_400_000;
export const utcDay = at => new Date(at).toISOString().slice(0, 10);
const fmt = n => Math.round(n).toLocaleString('sk-SK').replace(/ /g, ' ');
const km2 = n => `${n < 10 ? String(Math.round(n * 10) / 10).replace('.', ',') : fmt(n)} km²`;
const cap = s => s.replace(/^./, c => c.toUpperCase());

/** Mapa frontu na portáli (vlastník: „vždy mi daj odkaz na mapu frontu"). */
export const FRONT_URL = 'https://okolive.sk/?front=front';
// Výrezy pre kartu: projekcia karty je ekvirektangulárna bez korekcie cos(šírky), preto rozpätie dĺžky
// = 1,71 (pomer mapy 960×560) × rozpätie šírky / cos 48° — inak by bola krajina roztiahnutá.
/** Celá Ukrajina (hlásenie GŠ, vzdušný útok). */
export const UA_VIEW = Object.freeze({ west: 20, east: 42.5, south: 44, north: 52.8 });
/** Front na východe a juhu (zmena územia). */
export const FRONT_VIEW = Object.freeze({ west: 27.2, east: 42, south: 44.9, north: 50.7 });
export const TAGS = ['#Ukrajina', '#vojna', '#OKO'];
const RU_COLOR = '#ff5a3c';
const UA_COLOR = '#ffd23c';

function footer({ source, at, now, tags = TAGS }) {
  return [`📡 Zdroj: ${source} · stav k ${when(at ?? now, now).replace(/^dnes o /, '')}`,
    `🗺️ Mapa frontu deň po dni: ${FRONT_URL}`, '', tags.join(' ')].join('\n');
}

const sceneById = id => FRONT_SCENES.find(scene => scene.id === id) || null;
const dirName = id => DIRECTION_SK[id]?.name || null;

// ── 1. Denné hlásenie Generálneho štábu ───────────────────────────────────
// Tvary pre zoznam za dvojbodkou („Ruské údery podľa hlásenia: 120 riadených leteckých bômb, …").
const STRIKES = [
  ['guidedBombs', 'riadená letecká bomba', 'riadené letecké bomby', 'riadených leteckých bômb'],
  ['kamikazeDrones', 'dron-kamikadze', 'drony-kamikadze', 'dronov-kamikadze'],
  ['shellings', 'ostreľovanie', 'ostreľovania', 'ostreľovaní'],
  ['airStrikes', 'letecký úder', 'letecké údery', 'leteckých úderov'],
  ['missileStrikes', 'raketový úder', 'raketové údery', 'raketových úderov'],
];
/** Údery ako položky { n, label } (číslo a slovo zvlášť — číslo má medzeru tisícok, „5 600"). */
export function strikeItems(strikes = {}) {
  return STRIKES.filter(([k]) => Number.isFinite(strikes?.[k]) && strikes[k] > 0)
    .map(([k, one, few, many]) => ({ key: k, n: strikes[k], label: plural(strikes[k], one, few, many) }));
}
export const strikesSk = (strikes = {}) => strikeItems(strikes).map(item => `${fmt(item.n)} ${item.label}`);

/** Útoky hlásenia po smeroch OKO (jeden smer môže zbierať dva smery GŠ); smery mimo OKO sa vynechajú. */
export function reportDirections(report) {
  const by = new Map();
  for (const d of report?.directions || []) {
    const scene = frontSceneByGsDirection(d.gs);
    if (!scene || scene.overview || !Number.isFinite(d.attacks)) continue;
    by.set(scene.id, (by.get(scene.id) || 0) + d.attacks);
  }
  return [...by.entries()].map(([id, attacks]) => ({ id, name: dirName(id), attacks, center: sceneById(id)?.center }))
    .filter(d => d.name).sort((a, b) => b.attacks - a.attacks || a.id.localeCompare(b.id));
}

export async function loadReport({ get, now }) {
  const report = await get('/api/ukraine/report');
  if (report.status === 503 && report.body?.error === 'disabled_by_admin') return { reason: 'feed_disabled' };
  if (report.status !== 200 || !report.body?.ok) return { reason: 'source_unavailable' };
  const history = await get(`/api/ukraine/events/directions?from=${utcDay(now - 8 * DAY_MS)}&to=${utcDay(now - DAY_MS)}`);
  return { data: { report: report.body, days: history.status === 200 ? history.body?.days || {} : {} } };
}

export function uaReport({ report, days = {} }, { now }) {
  const published = Number.isFinite(report?.publishedAt) ? report.publishedAt : Date.parse(report?.reportedAt || '');
  // Len ranné súhrnné hlásenie za celý deň: čerstvé (do 30 h) a so súčtom stretov.
  if (!Number.isFinite(report?.total) || !Number.isFinite(published) || now - published > 30 * 3600_000 || isPartialReport(report)) return null;
  const day = utcDay(published);
  const past = Object.entries(days).filter(([d, r]) => d !== day && r && Number.isFinite(r.total) && !isPartialReport(r)).map(([, r]) => r.total);
  const avg = past.length >= 4 ? past.reduce((a, b) => a + b, 0) / past.length : null;
  const dirs = reportDirections(report);
  const top = dirs.filter(d => d.attacks > 0).slice(0, 3);
  const strikes = strikesSk(report.strikes);
  const total = report.total;
  const cmp = avg === null ? '' : Math.abs(total - avg) < Math.max(5, avg * 0.1)
    ? ` To je približne 7-dňový priemer (${fmt(avg)}).`
    : ` To je ${total > avg ? 'viac' : 'menej'} ako 7-dňový priemer (${fmt(avg)}).`;
  const title = `Front za deň: ${fmt(total)} ${plural(total, 'bojový stret', 'bojové strety', 'bojových stretov')}`;
  const text = [`⚔️ ${title}`, '',
    `Ukrajinský generálny štáb hlási za uplynulý deň ${fmt(total)} ${plural(total, 'bojový stret', 'bojové strety', 'bojových stretov')} s ruskými jednotkami.${cmp}`,
    ...(top.length ? ['', 'Najviac ruských útokov:', ...top.map(d => `• ${d.name} – ${d.attacks}`)] : []),
    ...(strikes.length ? ['', `Ruské údery podľa hlásenia: ${strikes.join(', ')}.`] : []),
    '', 'Údaje jednej strany (oficiálne hlásenie Generálneho štábu Ukrajiny), nezávisle neoverené.',
    ...(report.url ? [`Hlásenie: ${report.url}`] : []),
    '', footer({ source: 'Generálny štáb Ukrajiny cez ArmyInform (CC BY 4.0)', at: published, now, tags: ['#Ukrajina', '#front', '#vojna', '#OKO'] })].join('\n');
  const maxAttacks = Math.max(1, ...top.map(d => d.attacks));
  return {
    key: `ua-report:${day}`,
    title,
    text,
    card: { kind: 'ua-report', kicker: 'FRONT · DENNÉ HLÁSENIE', big: fmt(total), headline: 'bojových stretov za deň',
      lines: [top[0] ? `najviac útokov: ${top[0].name} (${top[0].attacks})` : 'podľa Generálneho štábu Ukrajiny',
        ...(avg !== null ? [`7-dňový priemer: ${fmt(avg)}`] : []), 'údaje jednej strany'],
      view: FRONT_VIEW, points: top.filter(d => d.center).map(d => ({ lat: d.center.lat, lon: d.center.lon, r: 10 + 26 * d.attacks / maxAttacks, label: String(d.attacks) })),
      source: 'Generálny štáb Ukrajiny · ArmyInform', at: published },
  };
}

// ── 2. Zmena frontu za deň ────────────────────────────────────────────────
/** Snímka „spred dňa" smie byť o toľko staršia (zrkadlo zapisuje len pri zmene mapy) — ako v Týždni na fronte. */
export const FRONT_FALLBACK_DAYS = 2;
/** Mapa frontu staršia než toľko dní = zastaraná (ukraineFreshness DEEPSTATE_STALE_DAYS). */
export const FRONT_STALE_DAYS = 4;

export async function loadFront({ get, now }) {
  const snapNow = await get(`/api/ukraine/events/deepstate?at=${utcDay(now)}`);
  if (snapNow.status === 503 && snapNow.body?.error === 'disabled_by_admin') return { reason: 'feed_disabled' };
  if (snapNow.status !== 200 || !snapNow.body?.day || !snapNow.body.features?.length) return { reason: 'source_unavailable' };
  const dayNow = snapNow.body.day;
  if (Date.parse(`${utcDay(now)}T00:00:00Z`) - Date.parse(`${dayNow}T00:00:00Z`) > FRONT_STALE_DAYS * DAY_MS) return { reason: 'stale' };
  const before = await get(`/api/ukraine/events/deepstate?at=${shiftDay(dayNow, -1)}`);
  if (before.status !== 200 || !before.body?.day || !before.body.features?.length) return { reason: 'source_unavailable' };
  if (before.body.day < shiftDay(dayNow, -1 - FRONT_FALLBACK_DAYS)) return { reason: 'stale' };
  return { data: { now: snapNow.body, before: before.body } };
}

/** Zmena okupovaného územia medzi dvoma snímkami po smeroch (ten istý výpočet ako vrstva a Týždeň na fronte). */
export function frontChange(snapNow, snapBefore) {
  const idxNow = polyIndex(snapNow.features); const idxBefore = polyIndex(snapBefore.features);
  const raster = occupiedChangeRaster(idxNow, idxBefore);
  if (!raster) return null;
  const parts = changeBreakdown(raster, idxNow, idxBefore, FRONT_SCENES);
  const directions = Object.entries(parts.byScene).map(([id, v]) => ({ id, name: dirName(id), ...v }))
    .filter(d => d.name && (d.ruKm2 >= 0.1 || d.uaKm2 >= 0.1)).sort((a, b) => (b.ruKm2 + b.uaKm2) - (a.ruKm2 + a.uaKm2));
  return { ruKm2: parts.ruKm2, uaKm2: parts.uaKm2, toGreyKm2: parts.toGreyKm2, directions };
}

export function uaFront({ now: snapNow, before }, { now }) {
  const change = frontChange(snapNow, before);
  if (!change || change.ruKm2 + change.uaKm2 < CHANGE_MIN_KM2) return null;
  const day = snapNow.day;
  const lines = change.directions.slice(0, 4).map(d => `• ${d.name}: ${[d.ruKm2 >= 0.1 ? `ruský agresor obsadil ${km2(d.ruKm2)}` : null,
    d.uaKm2 >= 0.1 ? `Ukrajina oslobodila ${km2(d.uaKm2)}` : null].filter(Boolean).join(', ')}`);
  const lead = change.ruKm2 >= change.uaKm2
    ? `Ruský agresor za deň obsadil ${km2(change.ruKm2)} ukrajinského územia${change.uaKm2 >= 0.1 ? `, Ukrajina oslobodila ${km2(change.uaKm2)}` : ''}.`
    : `Ukrajina za deň oslobodila ${km2(change.uaKm2)}${change.ruKm2 >= 0.1 ? `, ruský agresor obsadil ${km2(change.ruKm2)}` : ''}.`;
  const title = change.ruKm2 >= change.uaKm2 ? `Front za deň: Rusko obsadilo ${km2(change.ruKm2)}` : `Front za deň: Ukrajina oslobodila ${km2(change.uaKm2)}`;
  const text = [`🗺️ ${title}`, '',
    `Mapa frontu k ${date(Date.parse(`${day}T12:00:00Z`))} oproti predchádzajúcemu dňu: ${lead}`,
    ...(lines.length ? ['', ...lines] : []),
    ...(change.toGreyKm2 >= 0.1 ? ['', `Ďalších ${km2(change.toGreyKm2)} prešlo z ruskej kontroly do sivej zóny (nie je to ukrajinský zisk).`] : []),
    '', `Zmena je vypočítaná z porovnania dvoch denných snímok mapy frontu na ${MAP_SOURCE.site}; mapa zachytáva stav s oneskorením 2–3 dni.`,
    '', footer({ source: `mapa frontu ${MAP_SOURCE.site}`, at: now, now, tags: ['#Ukrajina', '#front', '#vojna', '#OKO'] })].join('\n');
  const points = [];
  for (const d of change.directions.slice(0, 4)) {
    if (d.ruAt && d.ruKm2 >= 0.1) points.push({ lat: d.ruAt.lat, lon: d.ruAt.lon, r: 12, color: RU_COLOR, label: `+${km2(d.ruKm2)}` });
    if (d.uaAt && d.uaKm2 >= 0.1) points.push({ lat: d.uaAt.lat, lon: d.uaAt.lon, r: 12, color: UA_COLOR, label: `−${km2(d.uaKm2)}` });
  }
  return {
    key: `ua-front:${day}`,
    title,
    text,
    card: { kind: 'ua-front', kicker: 'FRONT · ZMENA ZA DEŇ', big: km2(change.ruKm2 >= change.uaKm2 ? change.ruKm2 : change.uaKm2),
      headline: change.ruKm2 >= change.uaKm2 ? 'obsadil ruský agresor za deň' : 'oslobodila Ukrajina za deň',
      lines: [change.directions[0] ? `najviac: ${change.directions[0].name}` : '', `mapa frontu k ${date(Date.parse(`${day}T12:00:00Z`))}`, 'oneskorenie mapy 2–3 dni'].filter(Boolean),
      view: FRONT_VIEW, polygons: [{ rings: insetOccupiedRings(snapNow, { maxPoints: 400, minSpanDeg: 0.05 }), fill: RU_COLOR, opacity: 0.28 }], points,
      mapCredit: `Mapa frontu: ${MAP_SOURCE.site} · Natural Earth`, source: `mapa frontu ${MAP_SOURCE.site}`, at: now },
  };
}

// ── 3. Veľký vzdušný útok (hlásená hrozba) ────────────────────────────────
export const OBLAST_SK = Object.freeze({
  'Vinnytsia Oblast': 'Vinnická', 'Volyn Oblast': 'Volynská', 'Zhytomyr Oblast': 'Žytomyrská', 'Zakarpattia Oblast': 'Zakarpatská',
  'Ivano-Frankivsk Oblast': 'Ivanofrankivská', 'Kyiv Oblast': 'Kyjevská', 'Kirovohrad Oblast': 'Kirovohradská', 'Luhansk Oblast': 'Luhanská',
  'Lviv Oblast': 'Ľvovská', 'Mykolaiv Oblast': 'Mykolajivská', 'Poltava Oblast': 'Poltavská', 'Rivne Oblast': 'Rivnenská',
  'Ternopil Oblast': 'Ternopiľská', 'Khmelnytskyi Oblast': 'Chmeľnycká', 'Cherkasy Oblast': 'Čerkaská', 'Chernivtsi Oblast': 'Černovická',
  'Chernihiv Oblast': 'Černihivská', 'Kharkiv Oblast': 'Charkivská', 'Sumy Oblast': 'Sumská', 'Donetsk Oblast': 'Donecká',
  'Zaporizhzhia Oblast': 'Záporožská', 'Kherson Oblast': 'Chersonská', 'Dnipropetrovsk Oblast': 'Dnipropetrovská', 'Odesa Oblast': 'Odeská',
  Kyiv: 'mesto Kyjev',
});
let oblastCentres = null;
function centres() {
  if (oblastCentres) return oblastCentres;
  oblastCentres = Object.keys(OBLAST_SK).map(name => {
    const hint = UK_OBLAST_HINTS[name]; const g = UKRAINE_GAZETTEER.find(p => p.name === name);
    const c = hint || g;
    return c ? { name, lat: c.lat, lon: c.lon } : null;
  }).filter(Boolean);
  return oblastCentres;
}
const kmApprox = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180));
/** Cieľ poplachu → oblasť Ukrajiny (sídlo k najbližšiemu ťažisku oblasti do 160 km, Kyjev ako mesto). */
export function targetOblast(target) {
  if (OBLAST_SK[target.name]) return target.name;
  // Oblasť mimo zoznamu (Belgorodská, Kurská…) nie je ukrajinská oblasť — nepriradiť ju susednej.
  if (target.kind === 'oblast') return null;
  let best = null;
  for (const c of centres()) { const km = kmApprox(target, c); if (km <= 160 && (!best || km < best.km)) best = { name: c.name, km }; }
  return best?.name || null;
}
/** Okno, v ktorom sa sčítajú ohrozené oblasti (prah). */
export const AIR_WINDOW_MS = 3 * 3600_000;
/** Pauza bez hlásení, po ktorej začína nová vlna (nočný útok trvá aj 10 h — stále jedna vlna, jeden návrh). */
export const AIR_GAP_MS = 2 * 3600_000;
export const AIR_MIN_OBLASTS_DEFAULT = 8;

/** Médiá archívu za včera a dnes (UTC) — pre poplachy aj fotky/videá. */
export async function loadMedia({ get, now }) {
  const res = await get(`/api/ukraine/events?from=${utcDay(now - DAY_MS)}&to=${utcDay(now)}`);
  if (res.status === 503 && res.body?.error === 'disabled_by_admin') return { reason: 'feed_disabled' };
  if (res.status !== 200 || !Array.isArray(res.body?.media)) return { reason: 'source_unavailable' };
  return { data: { media: res.body.media } };
}

export function airWave(media, now) {
  const all = media.map(item => mediaToAlert(item)).filter(a => a && a.t <= now + 60_000).sort((a, b) => a.t - b.t);
  const alerts = all.filter(a => now - a.t <= AIR_WINDOW_MS);
  // Začiatok vlny: od posledného hlásenia späť, kým medzi hláseniami nie je pauza ≥ AIR_GAP_MS.
  let start = alerts[0]?.t ?? null;
  for (let i = all.length - 1; i > 0 && alerts.length; i--) {
    if (all[i].t - all[i - 1].t >= AIR_GAP_MS) { start = all[i].t; break; }
    start = all[i - 1].t;
  }
  const oblasts = new Map();
  const kinds = new Set();
  for (const a of alerts) {
    for (const target of a.targets) {
      const name = targetOblast(target);
      if (name && !oblasts.has(name)) oblasts.set(name, centres().find(c => c.name === name) || target);
    }
    if (/Бр?пЛА|безпілотн|шахед|ударн[а-яіїєґ]* дрон/iu.test(a.text)) kinds.add('drones');
    if (/ракет|балісти|крилат|швидкісн/iu.test(a.text)) kinds.add('missiles');
    if (/КАБ|авіаційн[а-яіїєґ]* бомб|авіабомб/iu.test(a.text)) kinds.add('bombs');
  }
  return { alerts, oblasts, kinds, start, first: alerts[0]?.t ?? null, last: alerts.at(-1)?.t ?? null };
}

const KIND_SK = { drones: 'útočných dronov', missiles: 'rakiet', bombs: 'riadených leteckých bômb' };
const KIND_NOM = { drones: 'drony', missiles: 'rakety', bombs: 'riadené bomby' };
export function listSk(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} a ${items.at(-1)}`;
}

export function uaAir({ media }, { now, settings = {} }) {
  const min = Number.isInteger(settings.airMinOblasts) && settings.airMinOblasts > 0 ? settings.airMinOblasts : AIR_MIN_OBLASTS_DEFAULT;
  const wave = airWave(media, now);
  if (wave.oblasts.size < min) return null;
  const names = [...wave.oblasts.keys()].map(n => OBLAST_SK[n]).sort((a, b) => a.localeCompare(b, 'sk'));
  const regions = names.filter(n => !n.startsWith('mesto'));
  const city = names.includes('mesto Kyjev');
  const kinds = [...wave.kinds].map(k => KIND_SK[k]);
  const n = wave.oblasts.size;
  const title = `Rozsiahly vzdušný útok: hrozba pre ${n} ${plural(n, 'oblasť', 'oblasti', 'oblastí')} Ukrajiny`;
  const text = [`🚨 ${title}`, '',
    `Vzdušné sily Ukrajiny od ${when(wave.first, now).replace(/^dnes o /, '')} hlásia hrozbu ${kinds.length ? listSk(kinds) : 'ruských vzdušných útokov'} pre ${regions.length ? `${listSk(regions.map(r => r.replace(/á$/, 'ú')))} oblasť` : ''}${city ? `${regions.length ? ' a ' : ''}hlavné mesto Kyjev` : ''}.`,
    '', 'Ide o hrozbu hlásenú oficiálnym kanálom Vzdušných síl, nie o oficiálnu mapu protileteckých sirén. Zásahy a škody zatiaľ nie sú potvrdené.',
    '', footer({ source: 'Vzdušné sily Ozbrojených síl Ukrajiny (Telegram, CC BY 4.0)', at: wave.last, now, tags: ['#Ukrajina', '#útok', '#vojna', '#OKO'] })].join('\n');
  return {
    // Jedna vlna = jeden návrh: kľúč = začiatok vlny (minúta), stály počas celého útoku.
    key: `ua-air:${Math.floor(wave.start / 60_000)}`,
    title,
    text,
    card: { kind: 'ua-air', kicker: 'VZDUŠNÁ HROZBA', big: String(n), headline: `${plural(n, 'oblasť', 'oblasti', 'oblastí')} Ukrajiny v ohrození`,
      lines: [wave.kinds.size ? `hrozba: ${listSk([...wave.kinds].map(k => KIND_NOM[k]))}` : 'hrozba z neba', 'hlásená hrozba, nie mapa sirén'],
      view: UA_VIEW, points: [...wave.oblasts.values()].map(c => ({ lat: c.lat, lon: c.lon, r: 16 })),
      source: 'Vzdušné sily ZSU', at: wave.last },
  };
}

// ── 4. Fotky a videá oficiálnych kanálov ──────────────────────────────────
/**
 * Oficiálne kanály, ktorých zábery Štúdio navrhuje (kpszsu sú len texty poplachov). `license` = doložená licencia
 * (DATA_SOURCES.md: obsah MO „CC BY 4.0, ak nie je uvedené inak"; ArmyInform CC BY 4.0). Pri GŠ a DSNS licencia
 * doložená nie je — text ju netvrdí a návrh pred schválením upozorní (pravidlo 7).
 */
export const MEDIA_CHANNELS = Object.freeze({
  GeneralStaffZSU: { sk: 'Generálny štáb Ozbrojených síl Ukrajiny', verb: 'zverejnil', license: null },
  ministry_of_defense_ua: { sk: 'Ministerstvo obrany Ukrajiny', verb: 'zverejnilo', license: 'CC BY 4.0' },
  dsns_telegram: { sk: 'Štátna záchranná služba Ukrajiny', verb: 'zverejnila', license: null },
});
const ARMYINFORM = { sk: 'ArmyInform (Ministerstvo obrany Ukrajiny)', verb: 'zverejnil', license: 'CC BY 4.0' };
const REVIEW = 'Pred schválením skontroluj zábery: žiadne obete, žiadne rozpoznateľné osoby ako cieľ (pravidlo 6).';
const REVIEW_LICENSE = ' Licencia záberov tohto kanála nie je overená (DATA_SOURCES.md) — zverejni len so súhlasom vlastníka.';
export const MEDIA_MAX_AGE_MS = 12 * 3600_000;
export const MEDIA_PER_DAY_DEFAULT = 6;
/** Hostitelia, z ktorých Štúdio sťahuje médiá (CDN Telegramu, ArmyInform). */
export const MEDIA_HOSTS = [/(^|\.)telesco\.pe$/i, /(^|\.)cdn-telegram\.org$/i, /(^|\.)armyinform\.com\.ua$/i];
export function mediaHostAllowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && MEDIA_HOSTS.some(re => re.test(u.hostname)); } catch { return false; }
}
/** Ukrajinské sily zasiahli cieľ („уражено ЗРК", „знищено", operácie Middle/Deep Strike). */
const UA_ACTION_RE = /уражен|уразил|знищен|знищил|Middle Strike|Deep Strike|Сил[иа] оборони/iu;
/** Ruský útok: nepriateľ menovaný, ostreľovanie, obete alebo škody na civilných objektoch. */
const RU_ATTACK_RE = /ворог|ворож|окупант|рашист|росі[яйю]|російськ|обстріл|атакува|загинул|загибл|поранен|постраждал|пошкоджен|зруйнован|наслідк/iu;
/**
 * Čo záber ukazuje, po slovensky — so správnou stranou: úder ukrajinských síl na ruský cieľ nie je „ruský
 * útok" (2026-10-04, záber GŠ „Уражено ЗРК «Бук-М3»" dostal pôvodne nesprávny popis). Nejasná strana = null.
 */
export function mediaWhat(type, text) {
  const ua = UA_ACTION_RE.test(text); const ru = RU_ATTACK_RE.test(text);
  switch (type) {
    case 'strike': case 'infrastructure': case 'fire':
      if (ua && !ru) return 'zásah ukrajinských síl';
      if (ru && !ua) return type === 'infrastructure' ? 'ruský útok na infraštruktúru' : type === 'fire' ? 'požiar po ruskom útoku' : 'následky ruského útoku';
      return null;
    case 'naval': return ua && !ru ? 'zásah ukrajinských síl na mori' : null;
    case 'air-defence': return 'práca protivzdušnej obrany';
    case 'ground': return 'boje na fronte';
    default: return null;
  }
}

/** Zdroj média, ktorý smie ísť do príspevku, alebo null. */
export function mediaSource(item) {
  if (item?.provider === 'file' && String(item.id || '').startsWith('ai:') && mediaHostAllowed(item.videoUrl)) return { ...ARMYINFORM, video: item.videoUrl, photos: [] };
  if (item?.provider !== 'telegram') return null;
  const channel = /^tg:([\w]+)\//.exec(item.id || '')?.[1];
  const meta = MEDIA_CHANNELS[channel];
  if (!meta) return null;
  const photos = (item.photos || []).filter(mediaHostAllowed).slice(0, 4);
  // Video z Telegramu sa zo stránky náhľadu stiahnuť nedá (len embed) → príspevok s videom len s fotkami.
  if (!photos.length) return null;
  return { ...meta, video: null, photos };
}

/** „ Podľa príspevku: 2 obete, 7 zranených." — len čísla, ktoré príspevok uvádza. */
export function casualtiesSk({ killed = null, injured = null } = {}) {
  const parts = [];
  if (Number.isFinite(killed) && killed > 0) parts.push(`${killed} ${plural(killed, 'obeť', 'obete', 'obetí')}`);
  if (Number.isFinite(injured) && injured > 0) parts.push(`${injured} ${plural(injured, 'zranený', 'zranení', 'zranených')}`);
  return parts.length ? ` Podľa príspevku: ${parts.join(', ')}.` : '';
}

export function uaMedia({ media }, { now, has = () => false, settings = {}, countToday = () => 0 }) {
  if (settings.media === false) return null;
  const perDay = Number.isInteger(settings.mediaPerDay) && settings.mediaPerDay >= 0 ? settings.mediaPerDay : MEDIA_PER_DAY_DEFAULT;
  if (countToday('ua-media') >= perDay) return null;
  const candidates = media.filter(item => Number.isFinite(item?.publishedAt) && item.publishedAt <= now + 60_000 && now - item.publishedAt <= MEDIA_MAX_AGE_MS)
    .sort((a, b) => b.publishedAt - a.publishedAt);
  for (const item of candidates) {
    const src = mediaSource(item);
    if (!src) continue;
    const key = `ua-media:${item.id}`;
    if (has(key)) continue;
    const raw = `${item.title || ''}\n${item.text || item.description || ''}`;
    const type = classifyUkText(raw)?.type;
    const place = locateUkText(raw)?.name || null;
    const what = mediaWhat(type, raw);
    // Len príspevky o udalosti (útok, požiar, infraštruktúra, PVO, boje) — blahoželania a PR nie sú správy.
    if (!what) continue;
    const kind = src.video ? 'video' : src.photos.length > 1 ? 'fotografie' : 'fotografiu';
    const title = `${src.sk}: ${cap(what)}${place ? ` – ${place}` : ''}`.slice(0, 180);
    const text = [`${src.video ? '🎥' : '📸'} ${title}`, '',
      `${src.sk} ${when(item.publishedAt, now)} ${src.verb} ${kind} (${what}${place ? `, ${place}` : ''}).${casualtiesSk(ukCasualties(raw))}`,
      '', `Pôvodný príspevok (ukrajinsky): ${item.url}`,
      '', footer({ source: `${src.sk} — oficiálny kanál${src.license ? `, ${src.license}` : ''}`, at: item.publishedAt, now })].join('\n');
    return {
      key,
      title,
      text,
      card: { kind: 'ua-media', kicker: src.video ? 'UKRAJINA · VIDEO' : 'UKRAJINA · FOTO', big: '', headline: title, lines: [], source: src.sk, at: item.publishedAt },
      media: { photos: src.photos, video: src.video, source: src.sk, license: src.license, url: item.url, at: item.publishedAt,
        review: src.license ? REVIEW : REVIEW + REVIEW_LICENSE },
    };
  }
  return null;
}

// ── 5. Týždeň na fronte ako karusel ───────────────────────────────────────
export async function loadWeek({ get, now, root }) {
  const [{ loadFrontWeek }, { frontWeekPostText }] = await Promise.all([
    import('../../../../scripts/lib/frontWeekData.mjs'), import('../../../../scripts/lib/frontWeekPipeline.mjs')]);
  const fetchImpl = async url => {
    const res = await get(String(url));
    return { ok: res.status === 200, status: res.status, json: async () => res.body };
  };
  try {
    const { model, inputs } = await loadFrontWeek({ baseUrl: '', archiveDir: root ? path.join(root, '.gev-cache', 'ukraine', 'events') : null, fetchImpl, today: utcDay(now) });
    if (!model) return { reason: 'nothing_to_post' };
    return { data: { model, occupied: inputs.snapshotNow ? insetOccupiedRings(inputs.snapshotNow, { maxPoints: 400, minSpanDeg: 0.05 }) : [], text: frontWeekPostText(model) } };
  } catch (error) {
    return { reason: error?.code === 'FRONT_WEEK_NO_REPORTS' ? 'nothing_to_post' : 'source_unavailable' };
  }
}

export function uaWeek({ model, occupied = [], text }, { now }) {
  if (!model?.week?.to || !(model.total?.week > 0)) return null;
  // Týždeň končí posledným hlásením; starší než 3 dni = nie je to „tento týždeň".
  if (Date.parse(`${utcDay(now)}T00:00:00Z`) - Date.parse(`${model.week.to}T00:00:00Z`) > 3 * DAY_MS) return null;
  const range = rangeLabel(model.week.from, model.week.to);
  const top = model.directions.filter(d => d.week > 0).slice(0, 4);
  const maxWeek = Math.max(1, ...top.map(d => d.week));
  const pts = top.filter(d => d.center).map(d => ({ lat: d.center.lat, lon: d.center.lon, r: 10 + 26 * d.week / maxWeek, label: fmt(d.week) }));
  const trend = Number.isFinite(model.total.changePct) ? `${model.total.changePct > 0 ? '+' : ''}${model.total.changePct} % oproti predch. týždňu` : null;
  const source = 'Generálny štáb Ukrajiny · ArmyInform';
  const slides = [];
  if (top.length) {
    slides.push({ kind: 'ua-week', kicker: 'NAJVIAC RUSKÝCH ÚTOKOV', big: fmt(top[0].week), headline: dirName(top[0].id) || 'smer',
      lines: top.slice(1).map(d => `${dirName(d.id)}: ${fmt(d.week)}`), view: FRONT_VIEW, points: pts, source, at: now });
  }
  const change = model.change;
  if (change?.weekly) {
    const marks = [];
    for (const d of model.directions) {
      if (d.ruAt && d.ruKm2 >= 0.1) marks.push({ lat: d.ruAt.lat, lon: d.ruAt.lon, r: 12, color: RU_COLOR, label: `+${km2(d.ruKm2)}` });
      if (d.uaAt && d.uaKm2 >= 0.1) marks.push({ lat: d.uaAt.lat, lon: d.uaAt.lon, r: 12, color: UA_COLOR, label: `−${km2(d.uaKm2)}` });
    }
    slides.push({ kind: 'ua-week', kicker: 'ZMENA ÚZEMIA ZA TÝŽDEŇ', big: km2(change.ruKm2), headline: 'obsadil ruský agresor',
      lines: [`Ukrajina oslobodila ${km2(change.uaKm2)}`, ...(change.toGreyKm2 >= 0.1 ? [`do sivej zóny ${km2(change.toGreyKm2)}`] : []), rangeLabel(change.fromDay, change.toDay)],
      view: FRONT_VIEW, polygons: occupied.length ? [{ rings: occupied, fill: RU_COLOR, opacity: 0.28 }] : [], points: marks.slice(0, 8),
      mapCredit: `Mapa frontu: ${MAP_SOURCE.site} · Natural Earth`, source: `mapa frontu ${MAP_SOURCE.site}`, at: now });
  }
  const strikes = strikeItems(Object.fromEntries(Object.entries(model.strikes || {}).map(([k, v]) => [k, v.sum])));
  if (strikes.length) {
    slides.push({ kind: 'ua-week', kicker: 'RUSKÉ ÚDERY ZA TÝŽDEŇ', big: fmt(strikes[0].n), headline: strikes[0].label,
      lines: [...strikes.slice(1, 4).map(item => `${fmt(item.n)} ${item.label}`), 'podľa Generálneho štábu Ukrajiny'], view: UA_VIEW, source, at: now });
  }
  const title = `Týždeň na fronte (${range}): ${fmt(model.total.week)} bojových stretov`;
  return {
    key: `ua-week:${model.week.to}`,
    title,
    text: `🗓️ ${text}\n\n${TAGS.join(' ')}`,
    card: { kind: 'ua-week', kicker: 'TÝŽDEŇ NA FRONTE', big: fmt(model.total.week), headline: 'bojových stretov za týždeň',
      lines: [range, ...(trend ? [trend] : []), 'údaje jednej strany'], view: FRONT_VIEW, points: pts, source, at: now },
    slides,
  };
}

export const UA_TEMPLATES = Object.freeze([
  { id: 'ua-report', label: 'Ukrajina: denné hlásenie GŠ', load: loadReport, build: uaReport, auto: 'daily' },
  { id: 'ua-front', label: 'Ukrajina: zmena frontu za deň', load: loadFront, build: uaFront, auto: true },
  { id: 'ua-air', label: 'Ukrajina: veľký vzdušný útok', load: loadMedia, build: uaAir, auto: true },
  // Zábery z vojny: vždy len návrh, schvaľuje človek (obete, osoby) — auto-zverejnenie sa nedá zapnúť.
  { id: 'ua-media', label: 'Ukrajina: fotky a videá oficiálnych kanálov', load: loadMedia, build: uaMedia, auto: true, autoPublish: false },
  { id: 'ua-week', label: 'Ukrajina: Týždeň na fronte (karusel)', load: loadWeek, build: uaWeek, auto: 'weekly' },
]);
