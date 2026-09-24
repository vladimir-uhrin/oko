// src/data/ukraineReportPlaces.js
/**
 * @module ukraineReportPlaces
 * @description Sídla z odsekov denného hlásenia Generálneho štábu ZSU → body na mape
 * (otvorená položka etapy 2, 2026-09-19). Hlásenie menuje obce v GENITÍVE za
 * spojeniami „у районі / в районах / у напрямку / в напрямках / в бік / поблизу"
 * („у районах Петропавлівки, Куп’янська-Вузлового та Новоосинового"). Modul:
 *  - vytiahne zoznamy mien (veľké začiatočné písmeno, pomlčky, apostrofy, viac slov),
 *  - z genitívu odvodí kandidátov nominatívu jednoduchými pravidlami koncoviek
 *    (-ки → -ка, -ого → -е/-ий, -ової → -ова…, -оля → -іль, výnimky ako Часів Яр),
 *  - overí ich proti indexu mien sídel z OSM snímku (podklad UKRAJINA; ODbL,
 *    geokódovanie beží v prehliadači, nič odvodené sa neukladá) a pri viacerých
 *    zhodách vyberie sídlo najbližšie k stredu smeru.
 * Poctivosť: sú to miesta, ktoré hlásenie menuje (oficiálne UA), nie polohy
 * jednotiek — čl. 114-2 TZ UA sa netýka. Čistý modul.
 */

/** Spúšťacie spojenia (za nimi zoznam mien). */
// `\b` pred azbukou v JS nikdy nesedí (pasca z etapy 2) → hranica slova lookbehindom.
// „в бік Курилівки, Новоосинового…" (2026-09-24): 70 z 574 odsekov archívu menovalo sídla len takto.
export const PLACE_TRIGGER_RE = /(?:(?<![А-Яа-яІіЇїЄєҐґ])(?:у|в)\s+(?:район[іеу]|районах|напрямку|напрямках|напрямі|бік)|(?<![А-Яа-яІіЇїЄєҐґ])поблизу|(?<![А-Яа-яІіЇїЄєҐґ])неподалік(?:\s+від)?|населен(?:их\s+пунктів|ого\s+пункту))\s+/gu;
const CYR_UP = 'А-ЯІЇЄҐ';
const CYR = "А-Яа-яІіЇїЄєҐґ'’ʼ";
const NAME_TOKEN = `[${CYR_UP}][${CYR}]*(?:-[${CYR_UP}]?[${CYR}]+)*`;
const NAME_RE = new RegExp(`^${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,2}`, 'u');
const CONNECTOR_RE = /^(?:,\s*|\s+(?:та|й|і)\s+)/u;
/** Slová, ktoré vyzerajú ako meno, ale sú vetné („Сили", „Ворог"…). */
const NOT_NAMES = new Set(['сили', 'ворог', 'противник', 'російські', 'росіяни', 'українські', 'наші']);

export const PLACE_EXCEPTIONS = Object.freeze({
  'часового яру': 'Часів Яр', 'часовому яру': 'Часів Яр', 'русиного яру': 'Русин Яр', 'києва': 'Київ', 'львова': 'Львів', 'харкова': 'Харків',
});

/** Normalizácia mena na kľúč indexu (malé písmená, jednotný apostrof, jedna medzera). Pure. */
export function placeKey(name) {
  return String(name ?? '').toLowerCase().replace(/[’ʼ`´]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Zoznamy mien za spúšťacími spojeniami v texte odseku. Pure. */
export function extractPlaceMentions(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ');
  const out = [];
  PLACE_TRIGGER_RE.lastIndex = 0;
  let m;
  while ((m = PLACE_TRIGGER_RE.exec(s))) {
    let rest = s.slice(m.index + m[0].length);
    for (let guard = 0; guard < 24; guard += 1) {
      const nm = NAME_RE.exec(rest);
      if (!nm) break;
      const raw = nm[0];
      const first = raw.split(/\s+/)[0].toLowerCase();
      if (NOT_NAMES.has(first)) break;
      out.push(raw);
      rest = rest.slice(raw.length);
      const c = CONNECTOR_RE.exec(rest);
      if (!c) break;
      rest = rest.slice(c[0].length);
    }
  }
  return out;
}

/** Kandidáti nominatívu jedného slova (vrátane identity). Pure. */
export function nominativeCandidates(word) {
  const w = String(word ?? '');
  const out = [w];
  // kmeň aspoň 2 znaky („Яру" → „Яр")
  const add = (suffix, reps) => { if (w.length >= suffix.length + 2 && w.endsWith(suffix)) for (const r of reps) out.push(w.slice(0, -suffix.length) + r); };
  add('ового', ['ове', 'овий', 'ів']);
  add('ього', ['є', 'ій']);
  if (!w.endsWith('ового') && !w.endsWith('ього')) add('ого', ['е', 'ий']);
  add('ьої', ['я']);
  if (!w.endsWith('ьої')) add('ої', ['а']);
  add('их', ['і']); add('іх', ['і']);
  add('ів', ['и']);
  add('ії', ['ія']); add('ці', ['ця']); add('ні', ['ня']); add('ки', ['ка']); add('ги', ['га']); add('хи', ['ха']);
  if (/[^кгх]и$/u.test(w)) add('и', ['а']);
  add('оля', ['іль']); add('ова', ['ів']); add('єва', ['їв']); add('ева', ['ів']);
  if (!/(?:ова|єва|ева)$/u.test(w)) add('а', ['', 'о']);
  if (!w.endsWith('оля')) add('я', ['ь', 'й', '']);
  add('у', ['', 'а']); add('ю', ['я']);
  return [...new Set(out)];
}
/** Kandidáti slova s pomlčkou: každá časť sa skloňuje („Куп’янська-Вузлового" → „Куп’янськ-Вузловий"), súčin so stropom. */
function hyphenCandidates(word, cap = 16) {
  let combos = [''];
  for (const part of word.split('-')) {
    const next = [];
    for (const prefix of combos) for (const c of nominativeCandidates(part)) { next.push(prefix ? `${prefix}-${c}` : c); if (next.length >= cap) break; }
    combos = next;
  }
  return combos;
}
/** Kandidáti celého mena (viac slov = súčin, pomlčka = súčin častí; strop 16). Pure. */
export function nameCandidates(raw) {
  const key = placeKey(raw);
  if (PLACE_EXCEPTIONS[key]) return [PLACE_EXCEPTIONS[key]];
  const words = String(raw).trim().split(/\s+/);
  let combos = [''];
  for (const word of words) {
    const cands = word.includes('-') ? hyphenCandidates(word) : nominativeCandidates(word);
    const next = [];
    for (const prefix of combos) for (const c of cands) { next.push(prefix ? `${prefix} ${c}` : c); if (next.length >= 16) break; }
    combos = next;
  }
  return [...new Set(combos)];
}

/**
 * Index mien sídel z GeoJSON prvkov podkladu (`properties.name` v ukrajinčine,
 * `lang === 'uk'` alebo azbuka). Map(kľúč → [{name, en, lat, lon, cls, pop}]). Pure.
 */
export function buildPlaceIndex(features) {
  const index = new Map();
  for (const f of features || []) {
    const p = f?.properties || f;
    const name = p?.name;
    if (!name || !/[А-Яа-яІіЇїЄєҐґ]/u.test(name)) continue;
    const c = f.geometry?.coordinates;
    const lon = Number(c?.[0] ?? p.lon); const lat = Number(c?.[1] ?? p.lat);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = placeKey(name);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ id: p.id ?? null, name, en: p.en || null, lat, lon, cls: p.cls || null, pop: Number(p.pop) || 0 });
  }
  return index;
}
const kmBetween = (a, b) => { const dy = (b.lat - a.lat) * 111.32; const dx = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180); return Math.hypot(dx, dy); };

/** Bonus triedy pri rovnakých menách: mesto vyhrá nad obcou s rovnakým menom, ak je o pár km ďalej (Добропілля: mesto 20 km vs. obec 18 km). */
export const CLASS_BONUS_KM = Object.freeze({ city: 30, town: 15 });

/**
 * Meno v genitíve → sídlo z indexu: prvý kandidát so zhodou; pri viacerých sídlach
 * najbližšie k `center` (do `maxKm`, vzdialenosť mínus bonus triedy), inak najľudnatejšie. Pure.
 */
export function resolvePlace(raw, index, { center = null, maxKm = 120 } = {}) {
  for (const cand of nameCandidates(raw)) {
    const hits = index.get(placeKey(cand));
    if (!hits?.length) continue;
    let pick = null;
    if (center) {
      let best = Infinity;
      for (const h of hits) {
        const d = kmBetween(center, h);
        if (d > maxKm) continue;
        const score = d - (CLASS_BONUS_KM[h.cls] || 0);
        if (score < best) { best = score; pick = h; }
      }
    }
    if (!pick && !center) pick = [...hits].sort((a, b) => b.pop - a.pop)[0];
    if (pick) return { ...pick, raw, nominative: cand };
  }
  return null;
}

/** Kotva pri línii: sídlo mimo dosahu vzorkovania sa ráta ako takto ďaleko (km). */
export const FRONT_FAR_KM = 48;
/** Váha vzdialenosti od ťažiska pri voľbe podľa línie (km ťažiska ~ 0,25 km línie). */
export const FRONT_CENTROID_WEIGHT = 0.25;

/**
 * Kotva značky smeru NA FRONTE (2026-09-24, vlastník: značky „✕ N" stáli v strede
 * záberu smeru — „30" pri Kosťantynivke hlboko v okupovanom území, „23" cez
 * Myrnohrad). Sídla menované v odseku smeru ležia na línii, takže kotva = to
 * z nich, ktoré je najbližšie k ich ťažisku váženému počtom zmienok (ťažisko
 * samo by pri zakrivenej línii padlo mimo). Keď poznáme líniu (`frontKm` —
 * vzdialenosť sídla k línii kontaktu z polygónov DeepState), vyhrá sídlo pri
 * línii a ťažisko rozhoduje len so štvrtinovou váhou (Pokrovsk: ťažisko padlo
 * k Svitlému v okupovanom území). Sídla bližšie než `minKm` ku kotve
 * iného smeru (`avoid`) sa preskočia, aby dve značky nestáli na sebe; keď
 * ostanú len také, vyhrá najbližšie. Bez sídiel null → stred záberu. Pure.
 * @param {Array<{name:string, lat:number, lon:number, mentions?:number}>} places
 * @param {{avoid?: Array<{lat:number, lon:number}>, minKm?: number, frontKm?: ((lon:number, lat:number) => (number|null))}} [opts]
 * Príznaky pre poctivú vetu na karte: `front` = kotva má vlastnú vzdialenosť k línii
 * (`frontKm`, km — polomer vzorkovania, kde sa strana zmenila), `displaced` = pre
 * susednú značku to nie je sídlo s najlepším skóre.
 * @returns {{name:string, en:(string|null), cls:(string|null), lat:number, lon:number, front:boolean, frontKm:(number|null), displaced:boolean}|null}
 */
export function directionAnchor(places, { avoid = [], minKm = 8, frontKm = null } = {}) {
  const list = (places || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (!list.length) return null;
  let w = 0; let lat = 0; let lon = 0;
  for (const p of list) { const m = Math.max(1, Number(p.mentions) || 1); w += m; lat += p.lat * m; lon += p.lon * m; }
  const c = { lat: lat / w, lon: lon / w };
  const fk = list.map((p) => {
    if (typeof frontKm !== 'function') return null;
    try { const v = frontKm(p.lon, p.lat); return typeof v === 'number' && !Number.isNaN(v) ? v : null; } catch { return null; }
  });
  // Líniu berieme do úvahy, len keď je aspoň jedno sídlo v dosahu vzorkovania.
  const useFront = fk.some((v) => Number.isFinite(v));
  const score = (p, i) => (useFront ? (Number.isFinite(fk[i]) ? fk[i] : FRONT_FAR_KM) + FRONT_CENTROID_WEIGHT * kmBetween(c, p) : kmBetween(c, p));
  const free = (p) => !avoid.some((a) => kmBetween(a, p) < minKm);
  let top = -1; let topD = Infinity;
  list.forEach((p, i) => { const d = score(p, i); if (d < topD) { topD = d; top = i; } });
  let best = -1; let bestD = Infinity;
  for (const pass of [true, false]) {
    list.forEach((p, i) => {
      if (pass && !free(p)) return;
      const d = score(p, i);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) break;
  }
  const b = list[best];
  const km = Number.isFinite(fk[best]) ? fk[best] : null;
  return { name: b.name, en: b.en ?? null, cls: b.cls ?? null, lat: b.lat, lon: b.lon, front: km !== null, frontKm: km, displaced: best !== top };
}

/**
 * Odseky jedného smeru → sídla s počtom zmienok. Pure.
 * @param {string[]} texts odseky (entry.texts z reportByScene)
 * @param {Map} index buildPlaceIndex
 * @param {{lat:number,lon:number}|null} center stred smeru
 */
export function directionPlaces(texts, index, center = null) {
  const byKey = new Map();
  const unresolved = [];
  for (const text of texts || []) {
    for (const raw of extractPlaceMentions(text)) {
      const hit = resolvePlace(raw, index, { center });
      if (!hit) { unresolved.push(raw); continue; }
      const key = placeKey(hit.name);
      const rec = byKey.get(key) || { ...hit, mentions: 0 };
      rec.mentions += 1;
      byKey.set(key, rec);
    }
  }
  return { places: [...byKey.values()], unresolved };
}
