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

/** Nad touto výškou kamery (m) sú lode drobné a z diaľky — vždy ikona zhora, bez výpočtu. */
export const SILHOUETTE_MAX_CAMERA_M = 40_000;
/** Hranice pohľadu: nad TOP zhora, nad OBLIQUE šikmo, inak z boku; END = kužeľ okolo osi lode. */
export const SILHOUETTE_VIEW = Object.freeze({ topDeg: 55, obliqueDeg: 22, endConeDeg: 25 });
/** Rezerva okolo hraníc pohľadu (°) — proti preskakovaniu siluety na hranici pri pohybe kamery. */
export const VIEW_HYSTERESIS_DEG = 3;

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
 * Počet bárok tlačnej zostavy z mena lode (AIS ich hlási v mene: „MARIA+3BARGE",
 * „MICHAELA+1BARGE"); 0 = nie je zostava. Pure.
 */
export function convoyBarges(name) {
  const m = /\+\s*(\d{1,2})\s*(?:BARGES?|BARGEN|BG|B)\b/i.exec(String(name || ''));
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 12 ? n : 0;
}
/** Zostava: bárky v stĺpcoch (za sebou) a radoch (bok po boku) — od dvoch bárok dve vedľa seba. */
export function convoyColumns(barges) {
  const n = Math.max(0, Math.floor(barges || 0));
  return n <= 1 ? n : Math.ceil(n / 2);
}
export function convoyRows(barges) {
  return Math.floor(barges || 0) >= 2 ? 2 : 1;
}

/**
 * Typ lode z AIS (a meno — tlačná zostava) → rodina siluety. Pure.
 * @param {*} type AIS typ (text alebo číslo)
 * @param {string} [name] meno z AIS
 * @returns {'passenger'|'cargo'|'tanker'|'tug'|'fishing'|'pleasure'|'convoy'|'generic'}
 */
export function vesselFamily(type, name = '') {
  if (convoyBarges(name) > 0) return 'convoy';
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
export function vesselViewKind(angles, view = SILHOUETTE_VIEW, prevKind = null) {
  if (!angles) return { kind: 'top', bowRight: true };
  // Rezerva okolo hraníc (VIEW_HYSTERESIS_DEG): pri uhle tesne na hranici loď pri pohybe kamery
  // preskakovala medzi pohľadmi — doterajší pohľad sa drží, kým uhol hranicu zreteľne neprejde.
  // Bez predošlého pohľadu (prvé zobrazenie) platia čisté hranice.
  const h = prevKind == null ? 0 : VIEW_HYSTERESIS_DEG;
  const e = angles.elevationDeg;
  const topEdge = prevKind === 'top' ? view.topDeg - h : view.topDeg + h;
  if (e >= topEdge) return { kind: 'top', bowRight: true };
  const rel = angles.relAzimuthDeg * Math.PI / 180;
  // kamera po pravoboku (rel 0–180°) vidí príď vpravo
  const bowRight = Math.sin(rel) >= 0;
  const cone = view.endConeDeg + (prevKind === 'end' ? h : -h);
  if (Math.abs(Math.sin(rel)) < Math.sin(cone * Math.PI / 180)) return { kind: 'end', bowRight };
  const obliqueEdge = prevKind === 'oblique' || prevKind === 'top' ? view.obliqueDeg - h : view.obliqueDeg + h;
  return { kind: e >= obliqueEdge ? 'oblique' : 'side', bowRight };
}

// ── Kreslenie ───────────────────────────────────────────────────────────────────────────────

/** Farby siluety z farby typu: trup tmavší, strecha svetlejšia, paluba, náklad bárok. */
function palette(base) {
  return {
    base,
    light: mixHex(base, '#ffffff', 0.28),
    hull: mixHex(base, DARK, 0.45),
    deck: mixHex(base, DARK, 0.22),
    cargo: mixHex(base, '#5c6b75', 0.55),
  };
}

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
  passenger: 112, cargo: 108, tanker: 108, generic: 80, tug: 52, fishing: 44, pleasure: 40, convoy: 96,
});
/** Zostava z boku: tlačný čln 40 px + 56 px na stĺpec bárok. */
const CONVOY_PUSHER_PX = 40;
const CONVOY_BARGE_PX = 56;

/** Dĺžka trupu siluety z boku (px) — pri zostave podľa počtu bárok. Pure. */
export function sideHullPx(family, barges = 0) {
  if (family === 'convoy') return CONVOY_PUSHER_PX + Math.max(1, convoyColumns(barges)) * CONVOY_BARGE_PX;
  return FAMILY_LENGTH_PX[family] ?? FAMILY_LENGTH_PX.generic;
}

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

/**
 * Tlačná zostava z boku: vzadu tlačný čln s vysokou kormidlovňou, pred ním bárky s nákladom
 * (predná s lyžicovou prídou). Šikmo navyše pás paluby nad každou bárkou.
 */
function convoySide(barges, pal, oblique) {
  const cols = Math.max(1, convoyColumns(barges));
  let out = '';
  for (let c = 0; c < cols; c++) {
    const x0 = CONVOY_PUSHER_PX + c * CONVOY_BARGE_PX;
    const front = c === cols - 1;
    const x1 = x0 + CONVOY_BARGE_PX - 2;
    out += `<path d="M${x0},-5 L${front ? x1 - 6 : x1},-5 L${x1},${front ? -8 : -5} L${front ? x1 - 3 : x1},0 L${x0},0 Z" fill="${pal.hull}" stroke="${DARK}" stroke-width="0.8" stroke-linejoin="round"/>`;
    if (oblique) out += rect(x0 + 2, -9.5, CONVOY_BARGE_PX - 8, 3, pal.deck);
    out += rect(x0 + 4, -8, CONVOY_BARGE_PX - 12, 3, pal.cargo);
  }
  // tlačný čln: plochá tlačná príď vpravo (opiera sa o bárku)
  out += `<path d="M0,-6 L38,-6 L38,0 L3,0 Q0,0 0,-3 Z" fill="${pal.hull}" stroke="${DARK}" stroke-width="0.8" stroke-linejoin="round"/>`;
  if (oblique) out += rect(2, -8.5, 34, 2.5, pal.deck);
  out += rect(6, -13, 18, 7, pal.base) + rect(8, -25, 14, 12, pal.light) + windows(10, 20, -20.5)
    + line(15, -25, 15, -31, pal.base) + line(12, -29, 18, -29, pal.base, 0.8);
  return out;
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
    convoy: [[-10, -9, 20, 3, pal.cargo], [-5, -25, 10, 12, light]],
  }[family] || [];
  const deck = familyDeck(family);
  const half = family === 'pleasure' || family === 'fishing' ? 6 : family === 'tug' ? 8 : family === 'convoy' ? 12 : 10;
  let out = `<path d="M${-half},${-deck} L${half},${-deck} L${half - 3},0 L${-half + 3},0 Z" fill="${hull}" stroke="${DARK}" stroke-width="0.8" stroke-linejoin="round"/>`;
  for (const [x, y, w, h, fill] of blocks) out += rect(x, y, w, h, fill);
  if (family === 'passenger') out += windows(-6, 6, -9.5, 2) + windows(-5, 5, -16, 2);
  if (family === 'tug' || family === 'cargo' || family === 'tanker') out += windows(-3, 3, -14.5, 2);
  if (family === 'convoy') out += windows(-3, 3, -20.5, 2);
  if (family === 'fishing') out += line(0, -11, 0, -24, base, 1);
  return out;
}

// ── Skutočná veľkosť ────────────────────────────────────────────────────────────────────────
/**
 * Typická dĺžka a šírka trupu (m) pre rodinu, keď AIS dĺžku nehlási (AISHub ju nenesie):
 * výletná loď na Dunaji ~110 × 11,4 m, motorová nákladná ~100 × 11 m, remorkér / tlačný čln ~25 × 8 m.
 */
export const FAMILY_SIZE_M = Object.freeze({
  passenger: [110, 11.4], cargo: [100, 11], tanker: [100, 11], generic: [60, 9],
  tug: [25, 8], fishing: [20, 6], pleasure: [12, 4], convoy: [101.5, 11.4],
});
/** Dĺžka trupu v obrázku (px): silueta L (sideHullPx), zhora topHullPx, čelný pohľad šírka trupu. */
const END_HULL_PX = { pleasure: 12, fishing: 12, tug: 16 };
/**
 * Dĺžka trupu na obrazovke (px): najmenej `min`, aby loď zďaleka nezmizla; STROP pre 110 m loď
 * `cap` (menšie lode úmerne odmocnine dĺžky, v rozsahu capMin–capMax). 2026-09-27 vlastník po
 * skutočnej veľkosti zblízka: „zblízka nemusia byť veľké, vyzerá to nahovno" — remorkér mal stovky px
 * a zakrýval skutočné lode z 3D modelu. Zďaleka ostáva skutočná veľkosť, zblízka loď ďalej nerastie.
 */
export const VESSEL_HULL_PX = Object.freeze({ min: 14, cap: 72, capMin: 26, capMax: 90 });

/** Strop dĺžky trupu (px) pre loď danej dĺžky (m). Pure. */
export function vesselHullCapPx(lengthM) {
  const L = Number.isFinite(lengthM) && lengthM > 0 ? lengthM : 110;
  return Math.max(VESSEL_HULL_PX.capMin, Math.min(VESSEL_HULL_PX.capMax, VESSEL_HULL_PX.cap * Math.sqrt(L / 110)));
}

/**
 * Skutočná dĺžka / šírka lode (m): AIS, ak je rozumná (5–400 m), inak typická pre rodinu. Pure.
 * @returns {{lengthM: number, beamM: number}}
 */
export function vesselSizeM(family, lengthM, beamM, barges = 0) {
  if (family === 'convoy') {
    // AIS pri zostave často hlási len tlačný čln (MICHAELA+1BARGE: 23 m) — pod 60 m odhad z bárok
    // (Európa II: 76,5 × 11,4 m); šírka podľa počtu bárok vedľa seba
    const cols = Math.max(1, convoyColumns(barges));
    const L = Number.isFinite(lengthM) && lengthM >= 60 && lengthM <= 400 ? lengthM : 25 + cols * 76.5;
    const B = Number.isFinite(beamM) && beamM >= 8 && beamM <= 70 ? beamM : convoyRows(barges) * 11.4;
    return { lengthM: L, beamM: B };
  }
  const [defL, defB] = FAMILY_SIZE_M[family] || FAMILY_SIZE_M.generic;
  const L = Number.isFinite(lengthM) && lengthM >= 5 && lengthM <= 400 ? lengthM : defL;
  // bez šírky z AIS: typická šírka rodiny v pomere k dĺžke (dlhší trup = širší)
  const B = Number.isFinite(beamM) && beamM >= 2 && beamM <= 70 ? beamM : Math.max(2, Math.min(70, defB * (L / defL)));
  return { lengthM: L, beamM: B };
}

/**
 * Mierka billboardu lode tak, aby trup mal na obrazovke svoju skutočnú dĺžku (2026-09-27, vlastník:
 * „veľké, treba im upraviť aj veľkosť pri scrolovaní, aby to bolo čo najrealistickejšie"):
 * px na meter vo vzdialenosti lode = výška plátna / (2 · d · tan(fovy/2)). Zďaleka aspoň
 * VESSEL_HULL_PX.min, aby loď nezmizla. Pure.
 * @param {object} o
 * @param {'top'|'oblique'|'side'|'end'} o.kind
 * @param {string} o.family
 * @param {number} [o.lengthM] AIS dĺžka
 * @param {number} [o.beamM] AIS šírka
 * @param {number} o.distanceM vzdialenosť kamery od lode
 * @param {number} o.fovyRad zvislé zorné pole kamery
 * @param {number} o.viewportHeightPx výška plátna (CSS px)
 * @returns {number|null} násobok veľkosti obrázka; null = nedá sa spočítať
 */
export function vesselRealScale({ kind, family, lengthM, beamM, barges = 0, distanceM, fovyRad, viewportHeightPx }) {
  if (!(distanceM > 0) || !(fovyRad > 0) || !(viewportHeightPx > 0)) return null;
  const pxPerM = viewportHeightPx / (2 * distanceM * Math.tan(fovyRad / 2));
  const size = vesselSizeM(family, lengthM, beamM, barges);
  const cap = vesselHullCapPx(size.lengthM);
  if (kind === 'end') {
    // spredu: šírka trupu so stropom v pomere šírka/dĺžka
    const imagePx = END_HULL_PX[family] ?? (family === 'convoy' ? 24 : 20);
    const endCap = Math.max(VESSEL_HULL_PX.min * 0.5, cap * (size.beamM / size.lengthM) * 2.5);
    return Math.max(VESSEL_HULL_PX.min * 0.5, Math.min(endCap, size.beamM * pxPerM)) / imagePx;
  }
  const imagePx = kind === 'top' ? topHullPx(family, barges) : sideHullPx(family, barges);
  return Math.max(VESSEL_HULL_PX.min, Math.min(cap, size.lengthM * pxPerM)) / imagePx;
}

const _cache = new Map();

// ── Pohľad zhora podľa typu (bod 5) ─────────────────────────────────────────────────────────
/** Dĺžka a šírka trupu zhora (px) podľa rodiny. */
const TOP_SIZE_PX = Object.freeze({
  passenger: [60, 10], cargo: [56, 10], tanker: [56, 10], generic: [40, 9],
  tug: [22, 9], fishing: [20, 7], pleasure: [18, 6],
});
const TOP_PUSHER_PX = 14;
const TOP_BARGE_PX = 28;
const TOP_BARGE_BEAM_PX = 9;

/** Dĺžka trupu v ikone zhora (px) — pre skutočnú veľkosť. Pure. */
export function topHullPx(family, barges = 0) {
  if (family === 'convoy') return TOP_PUSHER_PX + Math.max(1, convoyColumns(barges)) * TOP_BARGE_PX;
  return (TOP_SIZE_PX[family] || TOP_SIZE_PX.generic)[0];
}

/** Obrys trupu zhora, príď hore: špicatá príď, rovné boky, zaoblená korma. */
function topHullPath(L, B) {
  const t = -L / 2; const b = L / 2; const h = B / 2;
  const bow = Math.min(14, L * 0.3);
  return 'M0,' + t
    + ' C' + (h * 0.9) + ',' + (t + bow * 0.4) + ' ' + h + ',' + (t + bow * 0.8) + ' ' + h + ',' + (t + bow)
    + ' L' + h + ',' + (b - 2) + ' Q' + h + ',' + b + ' ' + (h - 2) + ',' + b
    + ' L' + (-h + 2) + ',' + b + ' Q' + (-h) + ',' + b + ' ' + (-h) + ',' + (b - 2)
    + ' L' + (-h) + ',' + (t + bow) + ' C' + (-h) + ',' + (t + bow * 0.8) + ' ' + (-h * 0.9) + ',' + (t + bow * 0.4) + ' 0,' + t + ' Z';
}

function sideWindows(x, y1, y2) {
  return '<line x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + y2 + '" stroke="' + DARK + '" stroke-width="1.2" stroke-dasharray="2 1.6" opacity="0.7"/>';
}

function topDetails(family, L, B, pal) {
  const t = -L / 2; const b = L / 2; const h = B / 2;
  switch (family) {
    case 'passenger':
      return rect(-h + 1.5, t + 12, B - 3, L - 16, pal.base) + rect(-2, t + 17, 4, L - 30, pal.light)
        + rect(-h + 2, t + 12, B - 4, 4, pal.light)
        + sideWindows(-h + 2.2, t + 18, b - 6) + sideWindows(h - 2.2, t + 18, b - 6);
    case 'cargo': {
      let out = '';
      const n = 4; const top = t + 10; const each = (L - 26) / n;
      for (let i = 0; i < n; i++) out += rect(-h + 2, top + i * each + 0.6, B - 4, each - 1.2, pal.cargo);
      return out + rect(-h + 1.5, b - 13, B - 3, 10, pal.base) + rect(-h + 3, b - 11, B - 6, 4, pal.light);
    }
    case 'tanker':
      return line(0, t + 8, 0, b - 15, pal.base, 1.4) + rect(-h + 2, -2, B - 4, 3, pal.base)
        + [0.3, 0.45, 0.6].map((f) => '<circle cx="0" cy="' + (t + L * f) + '" r="1.5" fill="' + pal.base + '" stroke="' + DARK + '" stroke-width="0.5"/>').join('')
        + rect(-h + 1.5, b - 13, B - 3, 10, pal.base) + rect(-h + 3, b - 11, B - 6, 4, pal.light);
    case 'tug':
      return rect(-3.5, t + 6, 7, 10, pal.base) + rect(-3, t + 7, 6, 4, pal.light);
    case 'fishing':
      return rect(-2.5, t + 5, 5, 5, pal.light) + line(0, t + 12, 0, b - 2, pal.base, 0.8);
    case 'pleasure':
      return rect(-2, t + 6, 4, 6, pal.light);
    default:
      return rect(-h + 2, -L * 0.1, B - 4, L * 0.3, pal.base) + rect(-h + 3, -L * 0.08, B - 6, L * 0.12, pal.light);
  }
}

/**
 * Ikona zhora podľa typu lode (bod 5; príď hore = sever, billboard ju otočí podľa kurzu):
 * výletná dlhá s palubami, nákladná s krytmi, tanker s potrubím, remorkér krátky,
 * zostava = tlačný čln vzadu a bárky pred ním (stĺpce × rady). Pure (reťazec).
 * @returns {{svg: string, width: number, height: number}}
 */
export function topSilhouetteSvg(family, color, { dim = false, barges = 0 } = {}) {
  const pal = palette(color);
  let L; let B; let inner;
  if (family === 'convoy') {
    const cols = Math.max(1, convoyColumns(barges));
    const rows = convoyRows(barges);
    L = topHullPx('convoy', barges);
    B = rows * TOP_BARGE_BEAM_PX + (rows - 1);
    const t = -L / 2;
    inner = '';
    for (let c = 0; c < cols; c++) {
      for (let rr = 0; rr < rows; rr++) {
        const x = -B / 2 + rr * (TOP_BARGE_BEAM_PX + 1);
        const y = t + c * TOP_BARGE_PX;
        inner += rect(x, y + 0.5, TOP_BARGE_BEAM_PX, TOP_BARGE_PX - 1, pal.hull) + rect(x + 1.5, y + 3, TOP_BARGE_BEAM_PX - 3, TOP_BARGE_PX - 6, pal.cargo);
      }
    }
    const py = t + cols * TOP_BARGE_PX;
    const pe = py + TOP_PUSHER_PX;
    inner += '<path d="M-4.5,' + py + ' L4.5,' + py + ' L4.5,' + (pe - 3) + ' Q4.5,' + pe + ' 1.5,' + pe + ' L-1.5,' + pe + ' Q-4.5,' + pe + ' -4.5,' + (pe - 3) + ' Z" fill="' + pal.hull + '" stroke="' + DARK + '" stroke-width="0.8"/>'
      + rect(-3, py + 3, 6, 7, pal.light);
  } else {
    [L, B] = TOP_SIZE_PX[family] || TOP_SIZE_PX.generic;
    inner = '<path d="' + topHullPath(L, B) + '" fill="' + pal.hull + '" stroke="' + DARK + '" stroke-width="0.8" stroke-linejoin="round"/>' + topDetails(family, L, B, pal);
  }
  const width = Math.ceil(B + 6); const height = Math.ceil(L + 6);
  const g = dim ? '<g opacity="' + DIM_OPACITY + '">' : '<g>';
  return {
    width,
    height,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="' + (-width / 2) + ' ' + (-height / 2) + ' ' + width + ' ' + height + '">' + g + inner + '</g></svg>',
  };
}

/** Data URL ikony zhora podľa typu (cache). */
export function topSilhouetteDataUrl(family, color, opts = {}) {
  const key = 'top|' + family + '|' + color + '|' + (opts.dim ? 'd' : 'f') + '|' + (opts.barges || 0);
  const hit = _cache.get(key);
  if (hit) return hit;
  const url = 'data:image/svg+xml;base64,' + globalThis.btoa(topSilhouetteSvg(family, color, opts).svg);
  _cache.set(key, url);
  return url;
}

// ── Prekryv kotviacich lodí ─────────────────────────────────────────────────────────────────
/** Krytie siluety, ktorú zakrýva bližšia loď (zapečené v obrázku — farbu billboardu drží fokus). */
export const DIM_OPACITY = 0.42;
/** Podiel plochy menšej siluety, od ktorého sa prekryv berie ako „loď za loďou". */
export const OVERLAP_SHARE = 0.35;

/** Rozmer obrázka siluety (px pri mierke 1). Pure. */
export function silhouetteImageSize(family, kind, barges = 0) {
  if (kind === 'end') return { width: 30, height: 34 };
  return { width: sideHullPx(family, barges) + 16, height: 34 };
}

/**
 * Ktoré siluety stlmiť: bez hĺbkového testu sa vzdialenejšia loď môže nakresliť CEZ bližšiu a lode
 * vyviazané bok po boku splývali do jednej škvrny (2026-09-27). Každú siluetu, ktorú z väčšej časti
 * zakrýva BLIŽŠIA, stlmí — bližšia ostane čitateľná navrchu. Pure.
 * @param {Array<{key: *, x: number, y: number, w: number, h: number, distance: number}>} items
 *   obdĺžnik na obrazovke (x, y = ľavý horný roh) a vzdialenosť od kamery
 * @returns {Set<*>} kľúče na stlmenie
 */
export function overlappedSilhouettes(items, share = OVERLAP_SHARE) {
  const sorted = [...(items || [])].filter((i) => i && i.w > 0 && i.h > 0).sort((a, b) => a.distance - b.distance);
  const dim = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const far = sorted[i];
    for (let j = 0; j < i; j++) {
      const near = sorted[j];
      const ix = Math.min(far.x + far.w, near.x + near.w) - Math.max(far.x, near.x);
      const iy = Math.min(far.y + far.h, near.y + near.h) - Math.max(far.y, near.y);
      if (ix <= 0 || iy <= 0) continue;
      if ((ix * iy) / Math.min(far.w * far.h, near.w * near.h) >= share) { dim.add(far.key); break; }
    }
  }
  return dim;
}

/**
 * SVG siluety. Pure (reťazec).
 * @param {string} family vesselFamily
 * @param {'oblique'|'side'|'end'} kind
 * @param {string} color CSS farba typu (#rrggbb)
 * @param {{bowRight?: boolean, moving?: boolean}} [o]
 * @returns {{svg: string, width: number, height: number}}
 */
export function silhouetteSvg(family, kind, color, { bowRight = true, moving = false, dim = false, barges = 0 } = {}) {
  const pal = palette(color);
  if (kind === 'end') {
    const width = 30; const height = 34;
    const inner = endView(family, pal);
    return { width, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-15 -32 ${width} ${height}"><g${dim ? ` opacity="${DIM_OPACITY}"` : ''}>${inner}</g></svg>` };
  }
  const L = sideHullPx(family, barges);
  const width = L + 16; const height = 34;
  const deck = familyDeck(family);
  let inner = wake(L, moving);
  if (family === 'convoy') {
    inner += convoySide(barges, pal, kind === 'oblique');
  } else if (kind === 'oblique') {
    // šikmo: nižší bok trupu a nad ním pás paluby zhora (zúžený podľa sklonu)
    const beam = family === 'pleasure' || family === 'fishing' ? 9 : family === 'tug' ? 11 : 13;
    inner += `<g transform="translate(0,${-deck - 2.4}) scale(1,0.42)"><path d="${deckTop(L, beam)}" fill="${pal.deck}" stroke="${DARK}" stroke-width="1.6" stroke-linejoin="round"/></g>`;
    inner += hullSide(L, deck - 1.5, 2.5, pal.hull);
  } else {
    inner += hullSide(L, deck, family === 'pleasure' ? 3 : 5, pal.hull);
  }
  if (family !== 'convoy') inner += sideUpperworks(family, L, pal);
  const flip = (bowRight ? '' : ` transform="translate(${L - 8},0) scale(-1,1)"`) + (dim ? ` opacity="${DIM_OPACITY}"` : '');
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
  const key = `${family}|${kind}|${color}|${opts.bowRight !== false ? 'r' : 'l'}|${opts.moving ? 'm' : 's'}|${opts.dim ? 'd' : 'f'}|${opts.barges || 0}`;
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
export function vesselViewFor(shipPos, cam, courseDeg, prevKind = null) {
  if (!cam?.position || !(cam.height < SILHOUETTE_MAX_CAMERA_M)) return { kind: 'top', bowRight: true };
  return vesselViewKind(vesselViewAngles(shipPos, cam.position, courseDeg), SILHOUETTE_VIEW, prevKind);
}

// ── Smer lode na zobrazenie ─────────────────────────────────────────────────────────────────
/** Pod touto rýchlosťou (uzly) loď stojí a jej COG je šum. */
export const MOORED_SPEED_KN = 0.5;
const validDeg = (v) => Number.isFinite(v) && v >= 0 && v < 360;

/**
 * Smer, ktorým má ikona / silueta lode mieriť (2026-09-27, „začni a poctivo"): heading, ak ho loď
 * hlási (gyro — presný aj v stoji; 511 = nedostupné); v pohybe COG; v stoji bez headingu smer
 * PROTI PRÚDU z osi rieky (riečne lode sa vyväzujú prídou proti prúdu) — COG stojacej lode je šum
 * (vedľa seba 355°, 287°, 193°); inak COG ako doteraz. Pure (riverBearing dodá volajúci).
 * @param {{heading?: number, course?: number, speedKn?: number, lat?: number, lon?: number}} v
 * @param {(lat: number, lon: number) => number|null} [riverBearing]
 * @returns {number|null}
 */
export function vesselDisplayCourseDeg({ heading, course, speedKn, lat, lon } = {}, riverBearing = null) {
  if (validDeg(heading)) return heading;
  if (Number(speedKn) >= MOORED_SPEED_KN && validDeg(course)) return course;
  const up = typeof riverBearing === 'function' ? riverBearing(lat, lon) : null;
  if (validDeg(up)) return up;
  return validDeg(course) ? course : null;
}
