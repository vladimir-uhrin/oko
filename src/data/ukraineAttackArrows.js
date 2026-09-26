// src/data/ukraineAttackArrows.js
/**
 * @module ukraineAttackArrows
 * @description Šípky smerov útoku pre KARTU (2026-09-26, vlastník so vzorkou Rybar:
 * „a šípky smerov útoku?"). DeepState API smery útokov nesie, mirror nie — a súhlas
 * nie je. Šípka sa preto ODVODÍ z dvoch vecí, ktoré máme: sídlo, pri ktorom podľa
 * denného hlásenia GŠ ZSU nepriateľ útočil (blesk), a dnešná línia kontaktu
 * z DeepState. Šípka vedie od najbližšieho bodu línie (začína `backKm` za ňou,
 * v okupovanom území) k sídlu, končí kúsok pred ním; dlhé vzdialenosti sa
 * zastrihnú na `maxKm`. Mierne sa prehýba (kvadratická Bézierova krivka, strana
 * podľa mena, aby susedné šípky neležali rovnobežne). Je to geometria, nie mapa GŠ —
 * legenda aj karta to hovoria. Čisté funkcie bez Cesia.
 */

/** Sídlo bližšie k línii než toto (km) šípku nedostane — smer by bol náhodný. */
export const ARROW_MIN_KM = 0.8;
/** Sídlo ďalej od línie sa neberie (hlásenie hovorí o smere, nie o dosahu útoku). */
export const ARROW_MAX_KM = 12;
/** Koľko km za líniou (v okupovanom území) sa pripočíta k dĺžke šípky pri vzdialenom sídle. */
export const ARROW_BACK_KM = 3;
/**
 * Dĺžka šípky (km): najmenej ARROW_LEN_MIN — sídlo tesne pri línii by inak dostalo
 * 1–2 km pahýľ (Kopanky: 1,2 km od línie = 10 px), u Rybara má každá šípka podobnú
 * dĺžku a hrot sedí pri sídle; najviac ARROW_LEN_MAX.
 */
export const ARROW_LEN_MIN = 7;
export const ARROW_LEN_MAX = 14;
/** Koniec šípky pred sídlom, aby hrot nezakryl blesk (km). */
export const ARROW_HEAD_GAP_KM = 0.6;
/** Prehnutie: odchýlka riadiaceho bodu ako podiel dĺžky. */
export const ARROW_BEND = 0.16;
export const ARROW_SAMPLES = 16;
/** Farba šípky (útok podľa hlásenia GŠ = ruský útok; v OKO je ruská strana červená) a jej lem. */
export const ARROW_CSS = '#ff3b30';
export const ARROW_OUTLINE_CSS = '#0b1622';
const KM_PER_DEG = 111.32;

/** Strana prehnutia z mena (stabilná medzi prekresleniami): +1 alebo −1. Pure. */
export function arrowBendSign(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 ? 1 : -1;
}

/**
 * Cesta šípky ako [lon, lat][] od bodu línie `from` k sídlu `to`: hrot končí
 * `headGapKm` pred sídlom (ďaleké sídlo: najviac `maxKm` od línie), dĺžka
 * clamp(d + backKm, lenMinKm, lenMaxKm) — začiatok teda leží za líniou
 * v okupovanom území. Null, keď je sídlo prakticky na línii (< `minKm`) alebo
 * vstup nie je číselný. Pure.
 * @param {{lon:number, lat:number}} from najbližší bod línie kontaktu
 * @param {{lon:number, lat:number}} to sídlo z hlásenia
 */
export function attackArrowPath(from, to, {
  name = '', backKm = ARROW_BACK_KM, maxKm = ARROW_MAX_KM, minKm = ARROW_MIN_KM,
  lenMinKm = ARROW_LEN_MIN, lenMaxKm = ARROW_LEN_MAX,
  headGapKm = ARROW_HEAD_GAP_KM, bend = ARROW_BEND, samples = ARROW_SAMPLES,
} = {}) {
  if (!from || !to || ![from.lon, from.lat, to.lon, to.lat].every(Number.isFinite)) return null;
  const lat0 = (from.lat + to.lat) / 2;
  const kx = KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const ky = KM_PER_DEG;
  const vx = (to.lon - from.lon) * kx;
  const vy = (to.lat - from.lat) * ky;
  const d = Math.hypot(vx, vy);
  if (!(d >= minKm)) return null;
  const ux = vx / d; const uy = vy / d;
  const endKm = Math.min(Math.max(d - headGapKm, 0.4), maxKm);
  const len = Math.max(lenMinKm, Math.min(d + backKm, lenMaxKm));
  const ex = ux * endKm; const ey = uy * endKm;
  const sx = ex - ux * len; const sy = ey - uy * len;
  const mx = (sx + ex) / 2; const my = (sy + ey) / 2;
  const sign = arrowBendSign(name);
  const cx = mx - uy * bend * len * sign; const cy = my + ux * bend * len * sign;
  const n = Math.max(3, Math.floor(samples));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const a = (1 - t) * (1 - t); const b = 2 * (1 - t) * t; const c = t * t;
    const x = a * sx + b * cx + c * ex;
    const y = a * sy + b * cy + c * ey;
    out.push([from.lon + x / kx, from.lat + y / ky]);
  }
  return out;
}

/**
 * Úrovne detailu podľa vzdialenosti kamery (m): zblízka pôvodná šípka, pri
 * pohľade na celý smer (≈ 180 km, 1 km ≈ 2–5 px) dvojnásobne hrubšia a dlhšia —
 * inak by bola 10–30 px čiarka. Rozsah dĺžok (km) platí pre attackArrowPath.
 */
export const ARROW_LODS = Object.freeze([
  Object.freeze({ id: 'near', near: 0, far: 90_000, scale: 1, lenMinKm: ARROW_LEN_MIN, lenMaxKm: ARROW_LEN_MAX }),
  Object.freeze({ id: 'far', near: 90_000, far: 460_000, scale: 2, lenMinKm: 11, lenMaxKm: 18 }),
]);

/** Mierka tela šípky podľa počtu útokov smeru: 1–9 = 1, 10–24 = 1,25, 25+ = 1,5; bez útokov 0 (nekreslí sa). Pure. */
export function arrowScale(attacks) {
  if (!(attacks > 0)) return 0;
  return attacks >= 25 ? 1.5 : attacks >= 10 ? 1.25 : 1;
}

/** Telo šípky v km (mierka 1): šírka drieku, šírka a dĺžka hrotu. Pozemný polygón — s mapou sa zväčšuje ako u Rybara. */
export const ARROW_SHAFT_KM = 0.7;
export const ARROW_HEAD_W_KM = 2.4;
export const ARROW_HEAD_L_KM = 2.0;

/**
 * Telo šípky ako uzavretý prstenec [lon, lat][] okolo stredovej čiary `path`:
 * driek konštantnej šírky po bod `headLKm` pred koncom, potom trojuholníkový
 * hrot so špičkou na konci čiary. Materiál PolylineArrow na primknutých čiarach
 * Cesium nekreslí (tenká čiara bez hrotu — 2026-09-26 v pane), preto polygón.
 * Null pri krátkej alebo neplatnej čiare. Pure.
 */
export function attackArrowPolygon(path, { scale = 1, shaftKm = ARROW_SHAFT_KM, headWKm = ARROW_HEAD_W_KM, headLKm = ARROW_HEAD_L_KM } = {}) {
  if (!Array.isArray(path) || path.length < 2 || !(scale > 0)) return null;
  const lat0 = path.reduce((s, p) => s + p[1], 0) / path.length;
  const kx = KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const ky = KM_PER_DEG;
  const [ox, oy] = path[0];
  const pts = path.map(([lon, lat]) => [(lon - ox) * kx, (lat - oy) * ky]);
  // dĺžky úsekov od konca → bod rezu drieku `headL` pred špičkou
  const headL = headLKm * scale; const halfShaft = (shaftKm * scale) / 2; const halfHead = (headWKm * scale) / 2;
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (!(total > headL + 0.2)) return null;
  const cutAt = total - headL;
  const left = []; const right = [];
  let acc = 0; let cut = null; let cutDir = null;
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
    const dx = bx - ax; const dy = by - ay; const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const ux = dx / len; const uy = dy / len;
    if (i === 1) { left.push([ax - uy * halfShaft, ay + ux * halfShaft]); right.push([ax + uy * halfShaft, ay - ux * halfShaft]); }
    if (acc + len >= cutAt) {
      const t = (cutAt - acc) / len;
      cut = [ax + dx * t, ay + dy * t]; cutDir = [ux, uy];
      break;
    }
    acc += len;
    left.push([bx - uy * halfShaft, by + ux * halfShaft]); right.push([bx + uy * halfShaft, by - ux * halfShaft]);
  }
  if (!cut) return null;
  const [ux, uy] = cutDir;
  const tip = pts[pts.length - 1];
  const ring = [
    ...left, [cut[0] - uy * halfShaft, cut[1] + ux * halfShaft], [cut[0] - uy * halfHead, cut[1] + ux * halfHead],
    tip,
    [cut[0] + uy * halfHead, cut[1] - ux * halfHead], [cut[0] + uy * halfShaft, cut[1] - ux * halfShaft], ...right.reverse(),
  ];
  return ring.map(([x, y]) => [ox + x / kx, oy + y / ky]);
}
