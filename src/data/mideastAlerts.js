// src/data/mideastAlerts.js — POPLACHY V IZRAELI, čistý model modulu BLÍZKY VÝCHOD
// (etapa 6, 2026-11-06; plán docs/drafts/blizky-vychod-plan.md kap. 6 a otázka 5).
//
// Čo to je: história výstrah Velenia domáceho frontu (Pikud HaOref) po OBLASTIACH
// (1 446 sídiel a zón) ako denná/týždenná mapa — koľko poplachov malo sídlo za obdobie.
// NIE JE to varovný systém: dáta prichádzajú z verejného mirroru s oneskorením hodín
// a OKO nikdy nehlási „živý alarm" (plán, kap. 4 bod 8). Oficiálne API je mimo Izraela
// geoblokované (403), Tzofar zakazuje zber — preto mirror (rozhodnutie vlastníka 24. 9.:
// mirrory áno, licenčný stav zapísať presne).
//
// Zdroje:
//  - história: `oref-alerts.github.io/events.js` — jeden súbor `const X = <JSON>;` (≈ 21 MB)
//    s katalógom oblastí a udalosťami po oblasti {d deň, s čas, sm/em minúta od/do, du trvanie,
//    k druh r/w/d, si index typu, et/ei koniec}. README tvrdí MIT, súbor LICENSE v repozitári
//    chýba (5. 11. 2026); obsahom sú úradné verejné výstrahy. Čítame ho ako DÁTA (JSON za
//    `const … =`), nikdy nespúšťame.
//  - polygóny oblastí: `amitfin/oref_alert` (MIT) `area_to_polygon.json.zip` — kľúč = hebrejské
//    meno, hodnota = obrys [[lat, lon], …]; `area_to_district.py` = oblasť → okres HFC.
// Mená sú hebrejské (oficiálne názvy HFC); OKO ich neprekladá — bublina ich ukazuje s okresom.
//
// Druhy (k): r = rakety a strely („ירי רקטות וטילים"), d = prienik nepriateľského lietadla
// (dron, „חדירת כלי טיס עוין"), w = predbežné upozornenie („v najbližších minútach …") — w sa
// ukazuje oddelene a do „poplachov" sa nepočíta, lebo je to varovanie pred varovaním.
//
// Etická čiara: oblasti sú sídla a zóny, nie osoby; žiadne polohy jednotiek, žiadne dopady —
// len to, kde znela siréna. Spoločné pre server (archív) aj klienta (vrstva, panel).

/** Prvý deň archívu — vojna s Iránom od 28. 2. 2026 (mirror začína tým istým dňom). */
export const MIDEAST_ALERTS_FIRST_DAY = '2026-02-28';
export const MIDEAST_ALERTS_API = '/api/mideast/events/alerts';
/** Strop okna trasy `/alerts?from&to` (denné súbory sú malé, celé obdobie ide jedným dopytom). */
export const MIDEAST_ALERTS_MAX_DAYS = 400;
export const ALERTS_MIRROR_URL = 'https://oref-alerts.github.io/events.js';
export const ALERTS_MIRROR_SITE = 'https://oref-alerts.github.io/';
export const ALERTS_POLYGON_ZIP_URL = 'https://raw.githubusercontent.com/amitfin/oref_alert/main/custom_components/oref_alert/metadata/area_to_polygon.json.zip';
export const ALERTS_DISTRICT_URL = 'https://raw.githubusercontent.com/amitfin/oref_alert/main/custom_components/oref_alert/metadata/area_to_district.py';
export const ALERTS_ATTRIBUTION = 'Pikud HaOref (Velenie domáceho frontu) cez mirror oref-alerts.github.io · polygóny oblastí amitfin/oref_alert (MIT)';
export const ALERTS_LICENSE = 'úradné verejné výstrahy; mirror: README MIT, súbor LICENSE chýba (stav 5. 11. 2026); polygóny MIT';
/** Druhy poplachu: id = `k` mirroru; `alarm` = počíta sa ako poplach (w je len predbežné upozornenie). */
export const ALERT_KINDS = Object.freeze([
  Object.freeze({ id: 'r', css: '#ff5a5a', alarm: true }),
  Object.freeze({ id: 'd', css: '#b48cff', alarm: true }),
  Object.freeze({ id: 'w', css: '#ffb547', alarm: false }),
]);
export const ALERT_KIND_IDS = Object.freeze(ALERT_KINDS.map((k) => k.id));
export const alertKindOf = (id) => ALERT_KINDS.find((k) => k.id === id) || null;
/** Dejiská, pri ktorých má vrstva zmysel (oblasti HFC ležia v Izraeli a na okupovaných územiach). */
export const ALERT_THEATRES = Object.freeze(['overview', 'israel', 'gaza', 'west-bank', 'south-lebanon']);
/** Obdobia osi: posledný deň s poplachom, 7 d, 30 d, od 28. 2. */
export const MIDEAST_ALERT_PERIODS = Object.freeze(['day', '7d', '30d', 'all']);
/** Stupne sýtosti výplne podľa počtu poplachov oblasti za obdobie (horná hranica vrátane). */
export const ALERT_LEVELS = Object.freeze([
  Object.freeze({ id: 'l1', max: 2, alpha: 0.28 }),
  Object.freeze({ id: 'l2', max: 9, alpha: 0.45 }),
  Object.freeze({ id: 'l3', max: 29, alpha: 0.62 }),
  Object.freeze({ id: 'l4', max: Infinity, alpha: 0.8 }),
]);
/** Tolerancia zjednodušenia obrysu v stupňoch (≈ 110 m) — 48 vrcholov na oblasť je priveľa pre 1 449 oblastí. */
export const ALERT_SIMPLIFY_DEG = 0.001;

const DAY_MS = 86_400_000;
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
export const dayToMs = (s) => (isDay(s) ? Date.parse(`${s}T00:00:00Z`) : null);

/** Hebrejské apostrofy a geršajim (׳ ״ ' ’ ` " aj zdvojené '') na jeden tvar — mirror a polygóny ich píšu rôzne. Pure. */
export const normaliseAreaName = (name) => String(name || '').replace(/[׳״‘’'`"]+/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Rozbor súboru mirroru: `const NAME = <JSON>;` riadky → objekt premenných. Súbor sa NIKDY nespúšťa
 * (žiadne eval/vm) — každá hodnota musí byť čistý JSON, inak chyba. Pure.
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parseMirrorVariables(text) {
  const vars = {};
  for (const m of String(text || '').matchAll(/^const (\w+) = ([\s\S]*?);\s*$/gm)) vars[m[1]] = JSON.parse(m[2]);
  return vars;
}

/**
 * Mirror → katalóg oblastí a počty po dňoch. Udalosť = jeden poplach v jednej oblasti (mirror ich
 * drží po oblastiach); `days[deň] = { r, w, d, areas: { slug: { r, w, d } } }`. Udalosti bez dňa alebo
 * s neznámym druhom sa preskočia a spočítajú do `skipped`. Pure.
 * @param {string} text obsah events.js
 * @param {{ minDay?: string }} [opts]
 * @returns {{ dataUpdated: string|null, catalog: Record<string, string>, days: Record<string, {r:number,w:number,d:number,areas:Record<string,{r:number,w:number,d:number}>}>, events: number, skipped: number }}
 */
export function parseAlertsMirror(text, { minDay = MIDEAST_ALERTS_FIRST_DAY } = {}) {
  const vars = parseMirrorVariables(text);
  const byArea = vars.EVENTS_BY_AREA;
  if (!byArea || typeof byArea !== 'object') throw new Error('alerts mirror: EVENTS_BY_AREA missing');
  const catalog = {};
  const days = {};
  let events = 0; let skipped = 0;
  for (const [slug, area] of Object.entries(byArea)) {
    const name = normaliseAreaName(area?.name || vars.AREA_CATALOG?.[slug]?.name || slug);
    catalog[slug] = name;
    for (const e of Array.isArray(area?.events) ? area.events : []) {
      const day = String(e?.d || '');
      const kind = String(e?.k || '');
      if (!isDay(day) || day < minDay || !ALERT_KIND_IDS.includes(kind)) { skipped += 1; continue; }
      const d = days[day] || (days[day] = { r: 0, w: 0, d: 0, areas: {} });
      const a = d.areas[slug] || (d.areas[slug] = { r: 0, w: 0, d: 0 });
      d[kind] += 1; a[kind] += 1; events += 1;
    }
  }
  return { dataUpdated: typeof vars.DATA_UPDATED === 'string' ? vars.DATA_UPDATED : null, catalog, days, events, skipped };
}

/** `"kľúč": "hodnota"` dvojice z generovaného Python slovníka (area_to_district.py). Pure. */
export function parsePythonStringDict(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) out[m[1]] = m[2];
  return out;
}

/** Vzdialenosť bodu od úsečky v rovine stupňov (stačí na zjednodušenie malých obrysov). */
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0]; const y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}
/** Douglas–Peucker nad uzavretým obrysom; vracia aspoň 3 body. Pure. */
export function simplifyRing(ring, tolerance = ALERT_SIMPLIFY_DEG) {
  const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length <= 4) return pts;
  const closed = pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] ? pts.slice(0, -1) : pts;
  const n = closed.length;
  const at = (i) => closed[i % n]; // index n = späť na prvý bod (uzavretie)
  const keep = new Uint8Array(n);
  const dp = (i, j) => {
    let best = -1; let bestD = tolerance;
    for (let k = i + 1; k < j; k += 1) {
      const d = segmentDistance(at(k), at(i), at(j));
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best < 0) return;
    keep[best % n] = 1; dp(i, best); dp(best, j);
  };
  // Obrys je uzavretý: ukotviť prvý bod a najvzdialenejší od neho, zjednodušiť obe polovice.
  let far = 0; let farD = -1;
  for (let k = 1; k < n; k += 1) {
    const dx = closed[k][0] - closed[0][0]; const dy = closed[k][1] - closed[0][1];
    const d = dx * dx + dy * dy;
    if (d > farD) { farD = d; far = k; }
  }
  keep[0] = 1; keep[far] = 1;
  dp(0, far);
  dp(far, n);
  const out = closed.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : closed.slice(0, 3);
}
/** Ťažisko obrysu (priemer vrcholov — na popisok stačí). Pure. */
export function ringCentre(ring) {
  let x = 0; let y = 0; let n = 0;
  for (const p of ring) { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { x += p[0]; y += p[1]; n += 1; } }
  return n ? [x / n, y / n] : null;
}

/**
 * Katalóg oblastí mirroru + polygóny (kľúč hebrejské meno, body [lat, lon]) + okresy → oblasti pre
 * klienta: `{ slug: { name, district, lat, lon, ring: [[lon, lat], …] } }`. Oblasť bez polygónu sa
 * vynechá (počíta sa v súčtoch, na mape nie je). Súradnice na 4 desatiny (≈ 11 m). Pure.
 * @param {{ catalog: Record<string,string>, polygons: Record<string, number[][]>, districts?: Record<string,string>, tolerance?: number }} o
 * @returns {{ areas: Record<string, {name:string, district:string|null, lat:number, lon:number, ring:number[][]}>, missing: string[] }}
 */
export function buildAlertAreas({ catalog, polygons, districts = {}, tolerance = ALERT_SIMPLIFY_DEG }) {
  const byName = new Map();
  for (const [name, ring] of Object.entries(polygons || {})) byName.set(normaliseAreaName(name), ring);
  const districtByName = new Map();
  for (const [name, district] of Object.entries(districts || {})) districtByName.set(normaliseAreaName(name), normaliseAreaName(district));
  const areas = {};
  const missing = [];
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  for (const [slug, rawName] of Object.entries(catalog || {})) {
    const name = normaliseAreaName(rawName);
    const raw = byName.get(name);
    if (!Array.isArray(raw) || raw.length < 3) { missing.push(slug); continue; }
    // polygóny sú [lat, lon] → klient chce [lon, lat]
    const ring = simplifyRing(raw.map((p) => [Number(p[1]), Number(p[0])]), tolerance).map((p) => [r4(p[0]), r4(p[1])]);
    const centre = ringCentre(ring);
    if (!centre) { missing.push(slug); continue; }
    areas[slug] = { name, district: districtByName.get(name) || null, lat: r4(centre[1]), lon: r4(centre[0]), ring };
  }
  return { areas, missing };
}

/**
 * Okno obdobia: 'day' = posledný deň s poplachom (`lastDay`, inak dnes), '7d'/'30d' = posledných N
 * dní po dnešok, 'all' = od 28. 2. Pure.
 * @returns {{ from: string, to: string }}
 */
export function alertPeriodRange(period, nowMs = Date.now(), lastDay = null) {
  const to = dayKey(nowMs);
  if (period === 'day') { const d = isDay(lastDay) ? lastDay : to; return { from: d, to: d }; }
  const span = period === '7d' ? 7 : (period === '30d' ? 30 : null);
  const first = dayToMs(MIDEAST_ALERTS_FIRST_DAY);
  const fromMs = span ? Math.max(dayToMs(to) - (span - 1) * DAY_MS, first) : first;
  return { from: dayKey(fromMs), to };
}

/** Počet poplachov (r + d) v `days` medzi from a to vrátane. Pure. */
export function alarmsInRange(days, from, to) {
  let n = 0;
  for (const [day, v] of Object.entries(days || {})) if (day >= from && day <= to) n += (Number(v?.r) || 0) + (Number(v?.d) || 0);
  return n;
}
/** Posledný deň s poplachom (r alebo d) v `days` ≤ to. Pure. */
export function lastAlarmDay(days, to = '9999-12-31') {
  let best = null;
  for (const [day, v] of Object.entries(days || {})) if (day <= to && ((Number(v?.r) || 0) + (Number(v?.d) || 0)) > 0 && (!best || day > best)) best = day;
  return best;
}
/** Stupeň podľa počtu poplachov oblasti (0 = žiadny, nekreslí sa). Pure. */
export function alertLevel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return ALERT_LEVELS.find((l) => n <= l.max) || ALERT_LEVELS.at(-1);
}
/** Prevládajúci druh poplachu oblasti (r pred d; w len ak nič iné). Pure. */
export function dominantKind(counts) {
  const r = Number(counts?.r) || 0; const d = Number(counts?.d) || 0; const w = Number(counts?.w) || 0;
  if (!r && !d) return w ? 'w' : null;
  return d > r ? 'd' : 'r';
}

/**
 * Súhrn obdobia pre legendu: súčty po druhoch, počet oblastí s poplachom a prvých `top` oblastí
 * podľa počtu poplachov (r + d). Pure.
 * @param {Record<string,{r:number,w:number,d:number}>} areaCounts `areas` z trasy
 * @param {Record<string, {name:string, district?:string|null}>} areas katalóg
 */
export function alertsSummary(areaCounts, areas = {}, { top = 5 } = {}) {
  const totals = { r: 0, w: 0, d: 0 };
  const rows = [];
  for (const [slug, c] of Object.entries(areaCounts || {})) {
    const r = Number(c?.r) || 0; const d = Number(c?.d) || 0; const w = Number(c?.w) || 0;
    totals.r += r; totals.d += d; totals.w += w;
    if (r + d > 0) rows.push({ slug, name: areas[slug]?.name || slug, district: areas[slug]?.district || null, alarms: r + d, r, d, w });
  }
  rows.sort((a, b) => b.alarms - a.alarms || (a.name < b.name ? -1 : 1));
  return { totals, alarms: totals.r + totals.d, areas: rows.length, top: rows.slice(0, top) };
}

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
/** Klient: počty po dňoch a po oblastiach za okno. */
export async function fetchMideastAlerts({ from, to, fetcher = (...a) => fetch(...a), base = MIDEAST_ALERTS_API } = {}) {
  const json = await getJson(fetcher, `${base}?${new URLSearchParams({ from, to })}`, 'bad_alerts_payload');
  if (!json.days || typeof json.days !== 'object' || !json.areas || typeof json.areas !== 'object') throw new Error('bad_alerts_payload');
  return json;
}
/** Klient: katalóg oblastí s obrysmi (raz za reláciu). */
export async function fetchMideastAlertAreas({ fetcher = (...a) => fetch(...a), base = MIDEAST_ALERTS_API } = {}) {
  const json = await getJson(fetcher, `${base}/areas`, 'bad_alert_areas_payload');
  if (!json.areas || typeof json.areas !== 'object') throw new Error('bad_alert_areas_payload');
  return json;
}
