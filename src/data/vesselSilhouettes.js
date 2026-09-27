// src/data/vesselSilhouettes.js
/**
 * @module vesselSilhouettes
 * @description Siluety lodí podľa uhla pohľadu (2026-09-27, vlastník: „aj tie lode by mohli byť pri
 * bočnom pohľade pekné a pri každom pohľade trocha realistickejšie, z akého uhla sa na ne pozeráš" →
 * „skús to, ale tak, aby sme sa vedeli vrátiť, a aby to vyzeralo lepšie"). 3D model (jeden nákladný
 * trup pre všetko) vlastník odmietol — tu sú ploché siluety v reči OKA, nakreslené pre typ lode:
 *
 *  - zhora (kamera nad 55°): ostáva doterajšia ikona trupu natočená podľa kurzu;
 *  - šikmo (22–55°): bok trupu + pás paluby zhora + nadstavby;
 *  - z boku (pod 22°): profil; príď na tej strane obrazovky, kam loď naozaj pláva;
 *  - spredu / zozadu (pohľad ±25° od osi lode): úzky čelný tvar.
 *
 * Typ lode z AIS → rodina (osobná, nákladná, tanker, remorkér, rybárska, rekreačná, iná) s vlastnou
 * dĺžkou a nadstavbou. Farby ostávajú podľa typu (vesselLabels TYPE_STYLES); trup je tmavší odtieň,
 * nadstavba plná farba, strecha svetlejšia.
 *
 * Návrat: `?lode=klasik` v adrese alebo localStorage `oko:lode` = `klasik` vráti klasické ikony
 * zhora (shipSilhouettesEnabled). Kód pred zmenou: git tag `zaloha-pred-siluetami-lodi`.
 *
 * Všetko tu je čisté (bez Cesia) — vrstvy si pózu kamery a polohu lode dodajú samy.
 */

import { normalizeVesselType } from './vesselLabels.js';

/**
 * Mierka siluety podľa vzdialenosti kamery (Cesium NearFarScalar): zblízka väčšia — skutočná 110 m
 * loď na 250 m zaberá tretinu obrazovky, 70 px ikona pôsobila ako hračka; z diaľky menšia.
 */
// 09-27 vlastník: „nie sú trochu veľké?" — 1,9 → 1,2 blízko, 0,6 → 0,5 ďaleko (~o tretinu menšie)
export const SILHOUETTE_SCALE_BY_DISTANCE = Object.freeze({ near: 250, nearScale: 1.2, far: 8000, farScale: 0.5 });

/** Nad touto výškou kamery (m) sú lode drobné a z diaľky — vždy ikona zhora, bez výpočtu. */
export const SILHOUETTE_MAX_CAMERA_M = 40_000;
/** Hranice pohľadu: nad TOP zhora, nad OBLIQUE šikmo, inak z boku; END = kužeľ okolo osi lode. */
export const SILHOUETTE_VIEW = Object.freeze({ topDeg: 55, obliqueDeg: 22, endConeDeg: 25 });

const DARK = '#04121a';

/**
 * Siluety zapnuté? Predvolene áno; `?lode=klasik` alebo localStorage `oko:lode=klasik` ich vypne.
 * @param {{search?: string, storage?: {getItem: Function}}} [env]
 * @returns {boolean}
 */
export function shipSilhouettesEnabled(env = {}) {
  const search = env.search ?? globalThis.location?.search ?? '';
  const m = /[?&]lode=([a-z]+)/i.exec(search);
  if (m) return m[1].toLowerCase() !== 'klasik';
  try {
    const storage = env.storage ?? globalThis.localStorage;
    if (storage?.getItem?.('oko:lode') === 'klasik') return false;
  } catch { /* úložisko nedostupné */ }
  return true;
}

/**
 * Typ lode z AIS → rodina siluety. Pure.
 * @param {*} type AIS typ (text alebo číslo)
 * @returns {'passenger'|'cargo'|'tanker'|'tug'|'fishing'|'pleasure'|'generic'}
 */
export function vesselFamily(type) {
  const text = String(normalizeVesselType(type) || type || '').toLowerCase();
  if (/tanker/.test(text)) return 'tanker';
  if (/passenger|ferry|cruise|high-speed|hsc/.test(text)) return 'passenger';
  if (/cargo|container|bulk|carrier/.test(text)) return 'cargo';
  if (/tug|tow|pilot|tender|service|supply|dredg|sar|law|anti-pollution|medical|military|port/.test(text)) return 'tug';
  if (/fishing/.test(text)) return 'fishing';
  if (/pleasure|sailing|yacht/.test(text)) return 'pleasure';
  return 'generic';
}

/**
 * Uhly pohľadu na loď: výška kamery nad horizontom lode a azimut kamery voči kurzu. Pure — polohy
 * sú ECEF {x,y,z} v metroch (Cesium Cartesian3 vyhovuje); zvislica je geocentrická (chyba < 0,2°).
 * @returns {{elevationDeg: number, relAzimuthDeg: number}|null} relAzimuth 0 = kamera pred prídou
 */
export function vesselViewAngles(shipPos, cameraPos, courseDeg) {
  if (!shipPos || !cameraPos) return null;
  const len = Math.hypot(shipPos.x, shipPos.y, shipPos.z);
  if (!(len > 0)) return null;
  const up = { x: shipPos.x / len, y: shipPos.y / len, z: shipPos.z / len };
  // východ = Z × hore (na póle degeneruje — tam je jedno, kam loď mieri)
  let ex = -up.y; let ey = up.x; const ez = 0;
  const el = Math.hypot(ex, ey);
  if (el < 1e-9) { ex = 1; ey = 0; } else { ex /= el; ey /= el; }
  const nx = up.y * ez - up.z * ey;
  const ny = up.z * ex - up.x * ez;
  const nz = up.x * ey - up.y * ex;
  const vx = cameraPos.x - shipPos.x;
  const vy = cameraPos.y - shipPos.y;
  const vz = cameraPos.z - shipPos.z;
  const vl = Math.hypot(vx, vy, vz);
  if (!(vl > 0)) return null;
  const upDot = (vx * up.x + vy * up.y + vz * up.z) / vl;
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, upDot))) * 180 / Math.PI;
  const east = vx * ex + vy * ey + vz * ez;
  const north = vx * nx + vy * ny + vz * nz;
  const bearing = Math.atan2(east, north) * 180 / Math.PI;
  const course = Number.isFinite(courseDeg) ? courseDeg : 0;
  const relAzimuthDeg = ((bearing - course) % 360 + 360) % 360;
  return { elevationDeg, relAzimuthDeg };
}

/**
 * Druh pohľadu z uhlov. Pure.
 * @param {{elevationDeg: number, relAzimuthDeg: number}|null} angles
 * @returns {{kind: 'top'|'oblique'|'side'|'end', bowRight: boolean}}
 */
export function vesselViewKind(angles, view = SILHOUETTE_VIEW) {
  if (!angles || !(angles.elevationDeg < view.topDeg)) return { kind: 'top', bowRight: true };
  const rel = angles.relAzimuthDeg * Math.PI / 180;
  // kamera po pravoboku (rel 0–180°) vidí príď vpravo
  const bowRight = Math.sin(rel) >= 0;
  const alongAxis = Math.abs(Math.sin(rel)) < Math.sin(view.endConeDeg * Math.PI / 180);
  if (alongAxis) return { kind: 'end', bowRight };
  return { kind: angles.elevationDeg >= view.obliqueDeg ? 'oblique' : 'side', bowRight };
}

// ── Kreslenie ───────────────────────────────────────────────────────────────────────────────

function mixHex(a, b, t) {
  const pa = parseInt(String(a).replace('#', ''), 16);
  const pb = parseInt(String(b).replace('#', ''), 16);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return a;
  const ch = (p, s) => (p >> s) & 255;
  const c = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${[c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Dĺžka trupu (px siluety) podľa rodiny — výletná loď dlhšia ako remorkér. */
export const FAMILY_LENGTH_PX = Object.freeze({
  passenger: 112, cargo: 108, tanker: 108, generic: 80, tug: 52, fishing: 44, pleasure: 40,
});

const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.8" fill="${fill}" stroke="${DARK}" stroke-width="0.7"${extra}/>`;
const windows = (x1, x2, y, w = 2.2) => (x2 > x1 ? `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${DARK}" stroke-width="${w}" stroke-dasharray="2.4 1.6" opacity="0.8"/>` : '');
const line = (x1, y1, x2, y2, color, w = 0.9, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;

/** Trup z boku: paluba vo výške deck, príď stúpa (sheer) k špičke. */
function hullSide(L, deck, sheer, fill) {
  return `<path d="M0,${-deck} L${L - 9},${-deck} L${L},${-deck - sheer} L${L - 3},0 L3,0 Q0,0 0,${-deck / 2} Z" fill="${fill}" stroke="${DARK}" stroke-width="0.8" stroke-linejoin="round"/>`;
}

/** Nadstavby rodiny z boku (x od kormy 0 po príď L, hladina y = 0, hore záporné). */
function sideUpperworks(family, L, pal) {
  const { base, light } = pal;
  switch (family) {
    case 'passenger':
      return rect(6, -13, L - 24, 7, base) + rect(10, -19, L - 34, 6, base)
        + line(10, -13, L - 18, -13, light, 0.6, ' opacity="0.7"')
        + line(12, -21.2, L - 30, -21.2, base, 0.8, ' opacity="0.85"')
        + rect(Math.round(L * 0.34), -24, 16, 2.5, light)
        + rect(L - 30, -25, 10, 6, light)
        + windows(9, L - 20, -9.5) + windows(13, L - 26, -16);
    case 'cargo':
      return rect(26, -10, L - 40, 3, base)
        + `<line x1="27" y1="-8.5" x2="${L - 15}" y2="-8.5" stroke="${DARK}" stroke-width="3" stroke-dasharray="0.8 7" opacity="0.7"/>`
        + rect(L - 12, -10, 5, 3, base)
        + rect(4, -14, 18, 7, base) + rect(6, -22, 14, 8, light) + windows(8, 18, -18)
        + line(13, -22, 13, -28, base);
    case 'tanker':
      return line(24, -9, L - 10, -9, base, 1.1)
        + [0.3, 0.45, 0.6, 0.75].map((f) => `<circle cx="${Math.round(L * f)}" cy="-7.6" r="1.6" fill="${base}" stroke="${DARK}" stroke-width="0.5"/>`).join('')
        + rect(Math.round(L / 2) - 3, -12, 6, 5, base)
        + rect(4, -14, 18, 7, base) + rect(6, -22, 14, 8, light) + windows(8, 18, -18)
        + line(13, -22, 13, -28, base);
    case 'tug':
      return rect(10, -13, 24, 7, base) + rect(14, -22, 16, 9, light) + windows(16, 28, -18.5)
        + line(22, -22, 22, -30, base) + line(19, -27, 25, -27, base, 0.8)
        + line(2, -6, L - 8, -6, DARK, 1.6, ' opacity="0.55"');
    case 'fishing':
      return rect(L - 20, -12, 12, 7, light) + windows(L - 18, L - 11, -9)
        + line(10, -5, 10, -24, base, 1) + line(10, -21, 26, -10, base, 0.8);
    case 'pleasure':
      return `<path d="M9,-4 L27,-4 L23,-9.5 L13,-9.5 Z" fill="${light}" stroke="${DARK}" stroke-width="0.7"/>` + windows(14, 22, -6.8, 1.8);
    default:
      return rect(Math.round(L * 0.28), -13, Math.round(L * 0.32), 7, base)
        + rect(Math.round(L * 0.32), -19, Math.round(L * 0.2), 6, light)
        + windows(Math.round(L * 0.34), Math.round(L * 0.5), -15.8);
  }
}

/** Obrys trupu zhora (šikmý pohľad: pás paluby). */
function deckTop(L, beam) {
  const b = beam / 2;
  return `M0,${-b} L${L - 14},${-b} C${L - 4},${-b} ${L},${-b * 0.25} ${L},0 C${L},${b * 0.25} ${L - 4},${b} ${L - 14},${b} L0,${b} Z`;
}

function familyDeck(family) {
  return { passenger: 6, cargo: 7, tanker: 6, tug: 6, fishing: 5, pleasure: 4, generic: 6 }[family] ?? 6;
}

/** Brázda za kormou a vlnka pri prídi (len v pohybe). */
function wake(L, moving) {
  if (!moving) return '';
  return line(-10, 0.9, Math.round(L * 0.3), 0.9, '#bfeaff', 1, ' opacity="0.35"')
    + `<path d="M${L - 4},0.6 q4,-1.8 8,-0.4" fill="none" stroke="#bfeaff" stroke-width="0.8" opacity="0.4"/>`;
}

/** Čelný pohľad (spredu/zozadu): úzky trup + nadstavby rodiny. */
function endView(family, pal) {
  const { base, light, hull } = pal;
  const blocks = {
    passenger: [[-8, -13, 16, 7, base], [-7, -19, 14, 6, base], [-3, -25, 6, 6, light]],
    cargo: [[-9, -10, 18, 3, base], [-5, -18, 10, 8, light]],
    tanker: [[-2, -12, 4, 5, base], [-5, -18, 10, 8, light]],
    tug: [[-6, -13, 12, 7, base], [-5, -22, 10, 9, light]],
    fishing: [[-4, -11, 8, 6, light]],
    pleasure: [[-5, -8, 10, 4, light]],
    generic: [[-6, -13, 12, 7, base], [-4, -19, 8, 6, light]],
  }[family] || [];
  const deck = familyDeck(family);
  const half = family === 'pleasure' || family === 'fishing' ? 6 : family === 'tug' ? 8 : 10;
  let out = `<path d="M${-half},${-deck} L${half},${-deck} L${half - 3},0 L${-half + 3},0 Z" fill="${hull}" stroke="${DARK}" stroke-width="0.8" stroke-linejoin="round"/>`;
  for (const [x, y, w, h, fill] of blocks) out += rect(x, y, w, h, fill);
  if (family === 'passenger') out += windows(-6, 6, -9.5, 2) + windows(-5, 5, -16, 2);
  if (family === 'tug' || family === 'cargo' || family === 'tanker') out += windows(-3, 3, -14.5, 2);
  if (family === 'fishing') out += line(0, -11, 0, -24, base, 1);
  return out;
}

const _cache = new Map();

/**
 * SVG siluety. Pure (reťazec).
 * @param {string} family vesselFamily
 * @param {'oblique'|'side'|'end'} kind
 * @param {string} color CSS farba typu (#rrggbb)
 * @param {{bowRight?: boolean, moving?: boolean}} [o]
 * @returns {{svg: string, width: number, height: number}}
 */
export function silhouetteSvg(family, kind, color, { bowRight = true, moving = false } = {}) {
  const base = color;
  const pal = { base, light: mixHex(base, '#ffffff', 0.28), hull: mixHex(base, DARK, 0.45), deck: mixHex(base, DARK, 0.22) };
  if (kind === 'end') {
    const width = 30; const height = 34;
    const inner = endView(family, pal);
    return { width, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-15 -32 ${width} ${height}">${inner}</svg>` };
  }
  const L = FAMILY_LENGTH_PX[family] ?? FAMILY_LENGTH_PX.generic;
  const width = L + 16; const height = 34;
  const deck = familyDeck(family);
  let inner = wake(L, moving);
  if (kind === 'oblique') {
    // šikmo: nižší bok trupu a nad ním pás paluby zhora (zúžený podľa sklonu)
    const beam = family === 'pleasure' || family === 'fishing' ? 9 : family === 'tug' ? 11 : 13;
    inner += `<g transform="translate(0,${-deck - 2.4}) scale(1,0.42)"><path d="${deckTop(L, beam)}" fill="${pal.deck}" stroke="${DARK}" stroke-width="1.6" stroke-linejoin="round"/></g>`;
    inner += hullSide(L, deck - 1.5, 2.5, pal.hull);
  } else {
    inner += hullSide(L, deck, family === 'pleasure' ? 3 : 5, pal.hull);
  }
  inner += sideUpperworks(family, L, pal);
  const flip = bowRight ? '' : ` transform="translate(${L - 8},0) scale(-1,1)"`;
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-12 -32 ${width} ${height}"><g${flip}>${inner}</g></svg>`,
  };
}

/**
 * Data URL siluety s cache (vrstvy ho priraďujú billboardu). Pure okrem cache a btoa.
 * @returns {string}
 */
export function silhouetteDataUrl(family, kind, color, opts = {}) {
  const key = `${family}|${kind}|${color}|${opts.bowRight !== false ? 'r' : 'l'}|${opts.moving ? 'm' : 's'}`;
  const hit = _cache.get(key);
  if (hit) return hit;
  const { svg } = silhouetteSvg(family, kind, color, opts);
  const url = 'data:image/svg+xml;base64,' + globalThis.btoa(svg);
  _cache.set(key, url);
  return url;
}

/**
 * Pohľad na loď pre aktuálnu kameru: druh + strana prídi. Pri vysokej kamere (drobné lode) vždy zhora.
 * @param {{x:number,y:number,z:number}} shipPos
 * @param {{position?: object, height?: number}} cam poloha kamery (ECEF) a jej výška nad zemou
 * @param {number} courseDeg
 */
export function vesselViewFor(shipPos, cam, courseDeg) {
  if (!cam?.position || !(cam.height < SILHOUETTE_MAX_CAMERA_M)) return { kind: 'top', bowRight: true };
  return vesselViewKind(vesselViewAngles(shipPos, cam.position, courseDeg));
}
