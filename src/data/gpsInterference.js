// src/data/gpsInterference.js
/**
 * @module gpsInterference
 * @description RUŠENIE GPS (odvodené) — modul BLÍZKY VÝCHOD, etapa 5d (2026-10-03; plán
 * docs/drafts/blizky-vychod-plan.md kap. 6, prieskum D3).
 *
 * Princíp (rovnaký ako gpsjam.org, ale z vlastného zberu): lietadlo vysiela v ADS-B správach,
 * ako presne pozná svoju polohu — NACp (presnosť) a NIC (integrita). Keď GPS ruší rušička,
 * hodnoty padnú. Zberač na serveri sa pýta adsb.lol na lietadlá v šiestich kruhoch nad regiónom
 * a po bunkách 0,5° a dňoch (UTC) ráta, koľko RÔZNYCH lietadiel bunkou prešlo a koľko z nich
 * v nej hlásilo zhoršenú presnosť. Podiel = (zhoršené − 1) / všetky za deň — jedno lietadlo sa
 * odpočíta proti falošným poplachom (porucha jedného stroja nie je rušenie).
 *
 * Čo sa ráta ako vzorka: priama správa ADS-B (nie MLAT/TIS-B — tam polohu počíta zem), norma
 * DO-260B (`version` 2 — staršie verzie hlásia presnosť inak), lietadlo vo vzduchu, čerstvá
 * poloha. Zhoršená presnosť: NACp < 8 alebo NIC < 7 (pod hranicou, ktorú pre ADS-B žiadajú
 * predpisy — EPU > 93 m alebo Rc > 370 m).
 *
 * POCTIVOSŤ: je to ODVODENÝ ukazovateľ, nie meranie rušičiek. Bez lietadiel nie sú dáta (nad
 * Iránom a Irakom dnes civilná prevádzka takmer nie je), dosah je daný prijímačmi adsb.lol,
 * a spoofing (falošná, ale „presná" poloha) sa takto neodhalí. Lietadlá sa len počítajú —
 * archív drží ich adresy iba počas rozpracovaného dňa kvôli jedinečnosti, do výstupu nejdú.
 * Modul je čistý (bez DOM, bez Cesia).
 */

export const GPS_CELL_DEG = 0.5;
/** Prahy podielu lietadiel so zhoršenou presnosťou (ako gpsjam.org): 2 % a 10 %. */
export const GPS_LOW = 0.02;
export const GPS_HIGH = 0.10;
/** Bunka s menej lietadlami za okno sa nehodnotí (štatistika z dvoch strojov nič nehovorí). */
export const GPS_MIN_AIRCRAFT = 4;
/** Poloha staršia než toľko sekúnd sa neberie (lietadlo mimo dosahu prijímača). */
export const GPS_MAX_SEEN_POS_S = 60;
/** Farby stupňov — jedny pre bunky na mape aj vzorky legendy. */
export const GPS_COLORS = Object.freeze({ high: '#ff5a5f', medium: '#ffb547', none: '#52d68a' });
export const GPS_API = '/api/mideast/events/gps';
export const GPS_DAYS_DEFAULT = 2;
export const GPS_ATTRIBUTION = 'Aircraft data: adsb.lol contributors (ODbL 1.0) · share of aircraft reporting degraded position accuracy computed by OKO — a derived indicator, not a measurement of jammers';
export const GPS_LICENSE = 'ODbL 1.0';

/**
 * Kruhy zberu (stred, polomer v námorných míľach — rozhranie adsb.lol berie najviac 250).
 * Irán v zozname nie je: civilná prevádzka nad ním dnes takmer nelieta (odporúčanie EASA),
 * kruh by vracal prázdno.
 */
export const GPS_CIRCLES = Object.freeze([
  Object.freeze({ id: 'levant', lat: 33.0, lon: 35.5, nm: 250 }),
  Object.freeze({ id: 'iraq', lat: 33.3, lon: 44.0, nm: 250 }),
  Object.freeze({ id: 'gulf-north', lat: 28.5, lon: 49.5, nm: 250 }),
  Object.freeze({ id: 'hormuz', lat: 25.5, lon: 55.5, nm: 250 }),
  Object.freeze({ id: 'red-sea-north', lat: 27.0, lon: 34.5, nm: 250 }),
  Object.freeze({ id: 'bab-el-mandeb', lat: 14.5, lon: 43.5, nm: 250 }),
]);

/** Adresa bodového rozhrania adsb.lol pre kruh. Pure. */
export function gpsCircleUrl(circle) {
  const lat = Number(circle?.lat); const lon = Number(circle?.lon); const nm = Number(circle?.nm);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(nm) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || nm <= 0 || nm > 250) throw new Error('bad circle');
  return `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`;
}

/** Je záznam lietadla použiteľná vzorka (priame ADS-B v2, vo vzduchu, čerstvá poloha, hlási presnosť)? Pure. */
export function isGpsSample(ac) {
  if (!ac || typeof ac.hex !== 'string' || !/^~?[0-9a-f]{6}$/i.test(ac.hex)) return false;
  if (typeof ac.type !== 'string' || !ac.type.startsWith('adsb_')) return false;
  if (ac.version !== 2) return false;
  if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon) || Math.abs(ac.lat) > 90 || Math.abs(ac.lon) > 180) return false;
  if (!Number.isFinite(ac.alt_baro)) return false; // 'ground' alebo chýba
  if (Number.isFinite(ac.seen_pos) && ac.seen_pos > GPS_MAX_SEEN_POS_S) return false;
  return Number.isFinite(ac.nac_p) || Number.isFinite(ac.nic);
}

/** Hlási lietadlo zhoršenú presnosť polohy (NACp < 8 alebo NIC < 7)? Pure. */
export function isGpsDegraded(ac) {
  return (Number.isFinite(ac?.nac_p) && ac.nac_p < 8) || (Number.isFinite(ac?.nic) && ac.nic < 7);
}

/** Bunka mriežky 0,5° pre polohu: indexy od rovníka a nultého poludníka. Pure. */
export function gpsCellOf(lat, lon) {
  return [Math.floor(lat / GPS_CELL_DEG), Math.floor(lon / GPS_CELL_DEG)];
}
/** Hranice bunky [západ, juh, východ, sever] v stupňoch. Pure. */
export function gpsCellBounds(latIdx, lonIdx) {
  return [lonIdx * GPS_CELL_DEG, latIdx * GPS_CELL_DEG, (lonIdx + 1) * GPS_CELL_DEG, (latIdx + 1) * GPS_CELL_DEG];
}

/** Prázdny rozpracovaný deň. Pure. */
export function gpsEmptyDay(day) {
  return { day, snapshots: 0, cells: {} };
}

/**
 * Pridá jednu snímku (lietadlá zo všetkých kruhov; to isté lietadlo z dvoch prekrývajúcich sa
 * kruhov sa ráta raz) do rozpracovaného dňa. Mení a vracia `work`. Pure voči I/O.
 * `work.cells[kľúč] = { s: [adresy videné], b: [adresy so zhoršenou presnosťou] }`.
 * @returns {{work: object, samples: number, degraded: number}}
 */
export function gpsAddSnapshot(work, aircraft) {
  const seenNow = new Set();
  let samples = 0; let degraded = 0;
  for (const ac of Array.isArray(aircraft) ? aircraft : []) {
    if (!isGpsSample(ac)) continue;
    const hex = ac.hex.toLowerCase();
    if (seenNow.has(hex)) continue;
    seenNow.add(hex);
    const [latIdx, lonIdx] = gpsCellOf(ac.lat, ac.lon);
    const key = `${latIdx}:${lonIdx}`;
    const cell = work.cells[key] || (work.cells[key] = { s: [], b: [] });
    if (!cell.s.includes(hex)) cell.s.push(hex);
    samples += 1;
    if (isGpsDegraded(ac)) {
      if (!cell.b.includes(hex)) cell.b.push(hex);
      degraded += 1;
    }
  }
  work.snapshots = (Number(work.snapshots) || 0) + 1;
  return { work, samples, degraded };
}

/**
 * Rozpracovaný deň → výsledok dňa BEZ adries lietadiel: `[latIdx, lonIdx, lietadiel, zhoršených]`
 * a počet rôznych lietadiel za deň. Pure.
 */
export function gpsFinalizeDay(work) {
  const cells = [];
  const all = new Set();
  for (const [key, cell] of Object.entries(work?.cells || {})) {
    const [latIdx, lonIdx] = key.split(':').map(Number);
    if (!Number.isInteger(latIdx) || !Number.isInteger(lonIdx) || !Array.isArray(cell?.s) || !cell.s.length) continue;
    for (const hex of cell.s) all.add(hex);
    cells.push([latIdx, lonIdx, cell.s.length, Array.isArray(cell.b) ? cell.b.length : 0]);
  }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { day: work?.day || null, cellDeg: GPS_CELL_DEG, snapshots: Number(work?.snapshots) || 0, aircraft: all.size, cells };
}

/**
 * Stupeň bunky z počtov: podiel = upravené zhoršené / všetky; pod `GPS_MIN_AIRCRAFT` lietadiel
 * sa nehodnotí ('thin'). Pure.
 * @returns {{ratio:number|null, level:'thin'|'none'|'medium'|'high'}}
 */
export function gpsLevel(total, badAdjusted) {
  if (!Number.isFinite(total) || total < GPS_MIN_AIRCRAFT) return { ratio: null, level: 'thin' };
  const ratio = Math.max(0, badAdjusted) / total;
  return { ratio, level: ratio >= GPS_HIGH ? 'high' : (ratio >= GPS_LOW ? 'medium' : 'none') };
}

/**
 * Zlúči výsledky dní do buniek okna: lietadlá a zhoršené sa sčítajú (lietadlo-dni), od zhoršených
 * sa za KAŽDÝ deň odpočíta jedno lietadlo. Pure.
 * @param {Array<{day:string, snapshots:number, aircraft:number, cells:Array<[number,number,number,number]>}>} days
 * @returns {{days:string[], snapshots:number, aircraft:number, cells:Array<{latIdx:number, lonIdx:number, total:number, bad:number, badAdjusted:number, ratio:number|null, level:string}>, counts:{high:number, medium:number, none:number, thin:number}}}
 */
export function gpsMergeDays(days) {
  const map = new Map();
  const used = [];
  let snapshots = 0; let aircraft = 0;
  for (const d of Array.isArray(days) ? days : []) {
    if (!d || !Array.isArray(d.cells)) continue;
    used.push(d.day);
    snapshots += Number(d.snapshots) || 0;
    aircraft += Number(d.aircraft) || 0;
    for (const row of d.cells) {
      const [latIdx, lonIdx, total, bad] = row;
      if (!Number.isInteger(latIdx) || !Number.isInteger(lonIdx) || !(total > 0)) continue;
      const key = `${latIdx}:${lonIdx}`;
      const cell = map.get(key) || { latIdx, lonIdx, total: 0, bad: 0, badAdjusted: 0 };
      cell.total += total;
      cell.bad += bad || 0;
      cell.badAdjusted += Math.max(0, (bad || 0) - 1);
      map.set(key, cell);
    }
  }
  const counts = { high: 0, medium: 0, none: 0, thin: 0 };
  const cells = [...map.values()].map((cell) => {
    const { ratio, level } = gpsLevel(cell.total, cell.badAdjusted);
    counts[level] += 1;
    return { ...cell, ratio, level };
  }).sort((a, b) => a.latIdx - b.latIdx || a.lonIdx - b.lonIdx);
  return { days: used.filter(Boolean).sort(), snapshots, aircraft, cells, counts };
}

/**
 * Klient: bunky za posledných `days` dní z archívu servera. Chyba proxy = výnimka s `status`.
 * @param {{fetcher?: typeof fetch, base?: string, days?: number}} [o]
 */
export async function fetchGpsInterference({ fetcher = (...a) => fetch(...a), base = GPS_API, days = GPS_DAYS_DEFAULT } = {}) {
  const response = await fetcher(`${base}?days=${encodeURIComponent(days)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || !Array.isArray(json.cells)) throw new Error('bad_gps_payload');
  return json;
}
