// src/data/strikeCasualties.js — obete ruských útokov zo správ (2026-10-07). Vlastník: „len Ukrajina"; denné
// video 7. 10. hovorilo o „hlásenej hrozbe", hoci útok zabil 25 ľudí (Pryluky: 20, z toho 5 detí) — video musí
// vedieť o obetiach. Zdroj: titulky správ (/api/situation-news?region=ukraine — Ukrinform, Ukrainska Pravda,
// Kyiv Independent, BBC…). Čísla počas dňa rastú (Pryluky 14 → 18 → 19 → 20), médiá sa líšia → PRAVIDLO:
// použije sa číslo, ktoré uviedli aspoň dve rôzne médiá („najmenej N" = druhé najvyššie číslo spomedzi
// najvyšších čísel jednotlivých médií). Číslo od jediného média sa nepoužije. Len útoky Ruska (nie straty
// vojakov, nie útoky Ukrajiny). Miesto = sídlo z mapy KARTA (anglické meno v titulku), inak celá Ukrajina. Pure.

const WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 });
const NUM = '(\\d{1,4}|' + Object.keys(WORDS).join('|') + ')';
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS[String(s).toLowerCase()] ?? NaN);

/** Útok Ruska (nie straty ruských vojakov, nie ukrajinský úder). */
const RUSSIAN_ATTACK = /\b(russian|russia'?s?|russians)\b[^.]{0,60}\b(attack|attacks|strike|strikes|missile|missiles|drone|drones|barrage|shelling|bomb|bombs|bombed|hit|hits|launches)\b|\b(attack|strike|missile|drone)s?\b[^.]{0,40}\bby russia/i;
const NOT_CIVIL = /\b(russian (troops|soldiers|servicemen|personnel)|occupiers? killed|ukrainian (forces|drones?) (kill|destroy|hit))/i;
/** Celoštátny súčet (bez miesta): „combined attack", „massive attack on Ukraine", „over past day". */
const NATIONAL = /\b(across ukraine|on ukraine|in ukraine|(combined|massive|large-scale)( \w+)? attacks?|overnight (attack|barrage)|past day|nationwide)\b/i;

const KILLED = [
  new RegExp(`\\bkill(?:s|ed|ing)?\\s+(?:at least\\s+|more than\\s+|over\\s+)?${NUM}\\b`, 'i'),
  new RegExp(`\\b(?:at least\\s+|more than\\s+)?${NUM}\\s+(?:people\\s+|civilians\\s+|ukrainians\\s+)?(?:were\\s+)?(?:killed|dead)\\b`, 'i'),
  new RegExp(`\\bdeath toll\\b[^0-9]{0,60}?\\b(?:rises|climbs|reaches|grows|jumps|increases)\\s+to\\s+${NUM}\\b`, 'i'),
  new RegExp(`\\bamong\\s+${NUM}\\s+(?:people\\s+)?killed\\b`, 'i'),
];
const CHILDREN = [
  new RegExp(`\\bincluding\\s+${NUM}\\s+children\\b`, 'i'),
  new RegExp(`\\b${NUM}\\s+children\\b[^.]{0,60}\\b(?:killed|among)\\b`, 'i'),
];
const INJURED = [
  new RegExp(`\\binjur(?:e|es|ed|ing)\\s+(?:at least\\s+|more than\\s+)?${NUM}\\b`, 'i'),
  new RegExp(`\\b(?:injury toll|number (?:of )?injured)\\b[^0-9]{0,60}?\\brises\\s+to\\s+${NUM}\\b`, 'i'),
  new RegExp(`\\b${NUM}\\s+(?:people\\s+)?(?:were\\s+)?(?:injured|wounded)\\b`, 'i'),
];
const firstNum = (title, patterns) => {
  for (const re of patterns) { const m = re.exec(title); if (m) { const n = toNum(m[1]); if (Number.isFinite(n)) return n; } }
  return null;
};

/** Slovenské meno sídla (exonymá), inak prepis z angličtiny. Pure. */
const EXONYMS = Object.freeze({ Kyiv: 'Kyjev', Kharkiv: 'Charkov', Lviv: 'Ľvov', Zaporizhzhia: 'Záporožie', Kherson: 'Cherson', Mykolaiv: 'Mykolajiv',
  Chernihiv: 'Černihiv', Zhytomyr: 'Žytomyr', Cherkasy: 'Čerkasy', 'Kryvyi Rih': 'Kryvyj Rih', Kropyvnytskyi: 'Kropyvnyckyj', Vinnytsia: 'Vinnica',
  Khmelnytskyi: 'Chmeľnyckyj', Lutsk: 'Luck', Uzhhorod: 'Užhorod', Chernivtsi: 'Černovice', 'Bila Tserkva': 'Biela Cerkev', Sloviansk: 'Slovjansk',
  Odesa: 'Odesa', Dnipro: 'Dnipro', Sumy: 'Sumy', Poltava: 'Poltava' });
export function placeSk(en) {
  if (EXONYMS[en]) return EXONYMS[en];
  return String(en).replace(/shch/gi, 'šč').replace(/kh/g, 'ch').replace(/Kh/g, 'Ch').replace(/zh/g, 'ž').replace(/Zh/g, 'Ž')
    .replace(/ch/g, 'č').replace(/Ch(?=[aeiouy])/g, 'Č').replace(/sh/g, 'š').replace(/Sh/g, 'Š').replace(/ts/g, 'c').replace(/Ts/g, 'C').replace(/yi\b/g, 'yj');
}

/**
 * Sídla na hľadanie v titulkoch: z bázy miest KARTA (GeoJSON s `en`, `pop`) — len mestá od `minPop`, dlhšie mená
 * skôr (Bila Tserkva pred Tserkva). Pure.
 */
export function placeIndex(features, { minPop = 15_000 } = {}) {
  const out = [];
  for (const f of features || []) {
    const p = f?.properties || {}; const c = f?.geometry?.coordinates;
    const en = p.en || (p.lang !== 'uk' ? p.name : null);
    if (!en || !Array.isArray(c) || !(Number(p.pop) >= minPop) || !/^[A-Za-z][A-Za-z' -]+$/.test(en)) continue;
    out.push({ en, lon: c[0], lat: c[1], pop: Number(p.pop) });
  }
  return out.sort((a, b) => b.en.length - a.en.length);
}

/** Jeden titulok → { place, killed, children, injured, national } alebo null. Pure. */
export function parseHeadline(title, places = []) {
  const t = String(title || '');
  if (!RUSSIAN_ATTACK.test(t) || NOT_CIVIL.test(t)) return null;
  const killed = firstNum(t, KILLED); const injured = firstNum(t, INJURED); const children = firstNum(t, CHILDREN);
  if (killed === null && injured === null) return null;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentioned = places.find((p) => new RegExp(`\\b${esc(p.en)}(?:'s)?\\b`).test(t)) || null;
  // Útok priamo na mesto („attack on Kyiv", „strike in Pryluky") patrí mestu aj pri „overnight barrage";
  // inak má celoštátny súčet prednosť pred zmienkou o meste („Russian attacks kill at least 28 … over past day,
  // rescue efforts continue in Pryluky" je súčet za Ukrajinu, nie za Pryluky).
  const targeted = mentioned && new RegExp(`\\b(attacks?|strikes?|missile|drone|shelling|hits?|bombing)\\s+(?:on|in|at)\\s+(?:the city of\\s+)?${esc(mentioned.en)}\\b`, 'i').test(t);
  if (!targeted && NATIONAL.test(t)) return { place: null, killed, children, injured, national: true };
  const place = mentioned;
  // „Kyiv Oblast" / „Kyiv region" = oblasť, nie mesto.
  const oblast = place && new RegExp(`\\b${place.en}\\s+(oblast|region)\\b`, 'i').test(t);
  return { place: oblast ? null : place, killed, children, injured, national: false };
}

/** Číslo potvrdené aspoň dvoma médiami: najvyššie číslo každého média, z nich druhé najvyššie. Pure. */
export function confirmedNumber(bySource) {
  const values = [...bySource.values()].filter(Number.isFinite).sort((a, b) => b - a);
  return values.length >= 2 ? values[1] : null;
}

/**
 * Obete ruských útokov za okno (predvolene 30 h) zo správ.
 * @param {Array<{title: string, source: string, publishedAt: number, url?: string}>} items
 * @returns {{ total: {killed, children, injured, sources}|null, places: Array<{en, sk, lat, lon, killed, children, injured, sources}> }}
 */
export function attackCasualties(items, { now = Date.now(), windowMs = 30 * 3600_000, places = [] } = {}) {
  const buckets = new Map(); // kľúč miesta → { place, killed: Map(zdroj → max), children, injured, urls }
  const bucket = (key, place) => {
    if (!buckets.has(key)) buckets.set(key, { place, killed: new Map(), children: new Map(), injured: new Map(), urls: new Map() });
    return buckets.get(key);
  };
  const keep = (map, src, n) => { if (Number.isFinite(n)) map.set(src, Math.max(map.get(src) ?? -1, n)); };
  for (const it of items || []) {
    if (!Number.isFinite(it?.publishedAt) || it.publishedAt > now + 60_000 || now - it.publishedAt > windowMs) continue;
    const h = parseHeadline(it.title, places);
    if (!h || !(h.place || h.national)) continue;
    const src = String(it.source || '').trim() || 'neznámy zdroj';
    const b = bucket(h.place ? h.place.en : '*', h.place);
    keep(b.killed, src, h.killed); keep(b.children, src, h.children); keep(b.injured, src, h.injured);
    if (it.url && !b.urls.has(src)) b.urls.set(src, it.url);
  }
  const summarize = (b) => {
    const killed = confirmedNumber(b.killed); const injured = confirmedNumber(b.injured);
    if (!(killed > 0) && !(injured > 0)) return null;
    const children = killed > 0 ? confirmedNumber(b.children) : null;
    const used = new Set([...b.killed.keys(), ...b.injured.keys()]);
    const sources = [...used].map((s) => ({ name: s, url: b.urls.get(s) || null }));
    return { killed: killed > 0 ? killed : null, children: children > 0 ? children : null, injured: injured > 0 ? injured : null, sources };
  };
  const placesOut = [];
  for (const [key, b] of buckets) {
    if (key === '*') continue;
    const s = summarize(b);
    if (s) placesOut.push({ en: b.place.en, sk: placeSk(b.place.en), lat: b.place.lat, lon: b.place.lon, ...s });
  }
  placesOut.sort((a, b) => (b.killed ?? 0) - (a.killed ?? 0) || (b.injured ?? 0) - (a.injured ?? 0));
  let total = buckets.has('*') ? summarize(buckets.get('*')) : null;
  // Celok nesmie byť menší než najväčšie miesto (správy o celku môžu byť staršie).
  const top = placesOut[0];
  if (top?.killed && (!total?.killed || total.killed < top.killed)) total = { ...(total || {}), killed: top.killed, children: total?.children ?? top.children, sources: total?.sources || top.sources };
  return { total, places: placesOut };
}
