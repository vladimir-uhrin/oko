import * as Cesium from 'cesium';

/**
 * Ostré hviezdy (2026-09-07, používateľ: „hviezdy ostré, nie rozmazané").
 *
 * Cesium má defaultný SkyBox z JPEG kociek Tycho-2 po 1024 px na stenu:
 * pri 60° zornom poli a 900 px výške sa každá stena roztiahne cez ~1,3
 * obrazovky, hviezdy sú mäkké fľaky s JPEG šumom. Tento modul postaví
 * VLASTNÝ skybox: šesť plátien po 2048 px, na ktoré nakreslí ~9 000
 * bodových hviezd s rozdelením jasu ako na oblohe (veľa slabých, málo
 * jasných) — 1 px body, jasné 2–3 px s nepatrným halo, mierne farebné
 * (modrobiela / biela / žltkastá). Nie je to hviezdny katalóg (súhvezdia
 * nesedia — Cesium ich ani predtým vo výreze nesľubovalo pre laika),
 * je to čistá obloha bez rozmazania, deterministická zo semienka.
 *
 * Steny sa stavajú z JEDNEJ množiny smerov na guli premietnutých do
 * štandardného cube-mapu (major axis), takže na hranách stien nič
 * neskáče. Výsledok ide do Cesia ako data URL (SkyBox berie URL/obrázok).
 * Generovanie ~100 ms, odložené za prvý snímok (main.js).
 */

export const STARFIELD_FACE_PX = 2048;
export const STARFIELD_STAR_COUNT = 11000;
export const STARFIELD_SEED = 20260907;
export const STARFIELD_FACES = Object.freeze(['positiveX', 'negativeX', 'positiveY', 'negativeY', 'positiveZ', 'negativeZ']);
/**
 * Pozadie z Cesium Tycho-2 kociek (2026-09-07, používateľ: „oprav ostrosť
 * hviezd" po tom, ako prázdna generovaná obloha nevyhovovala): tie isté
 * JPEG steny, ktoré kreslí predvolený SkyBox, sa položia pod ostré body —
 * mierne rozmazané a stlmené, takže dávajú Mliečnu dráhu a hustotu oblohy,
 * kým ostrosť robia body navrchu. Orientácia sedí bez transformácie: stena
 * `px` ide do toho istého slotu `positiveX`, kam ju dáva aj Cesium.
 */
export const TYCHO_FACE_FILES = Object.freeze({
  positiveX: 'px', negativeX: 'mx', positiveY: 'py', negativeY: 'my', positiveZ: 'pz', negativeZ: 'mz',
});
export const TYCHO_BACKGROUND_ALPHA = 0.6;
export const TYCHO_BACKGROUND_BLUR_PX = 1.2;
/** URL Tycho steny v Cesium assetoch (rovnaká cesta ako predvolený SkyBox). */
export function tychoFaceUrl(face) {
  return Cesium.buildModuleUrl(`Assets/Textures/SkyBox/tycho2t3_80_${TYCHO_FACE_FILES[face]}.jpg`);
}

/** Farby hviezd (spektrálne triedy zjednodušene): modrobiela, biela, krémová, žltkastá. */
export const STAR_TINTS = Object.freeze([
  [200, 216, 255],
  [255, 255, 255],
  [255, 244, 222],
  [255, 226, 186],
]);

/**
 * Deterministický PRNG (mulberry32). Pure.
 * @param {number} seed
 * @returns {() => number} 0..1
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Jas hviezdy 0..1 s rozdelením „veľa slabých, málo jasných" — približne
 * ako počty hviezd podľa magnitúdy (≈ ×3 na magnitúdu). Pure.
 * @param {number} u 0..1
 * @returns {number}
 */
export function starBrightness(u) {
  // u^2: 50 % hviezd pod 0,25 jasu, ~10 % nad 0,8. (Prvá verzia mala u^3 —
  // pre používateľa „slabučké", 2026-09-07 zosilnené.)
  return u * u;
}

/**
 * Náhodné smery rovnomerne na guli + jas + odtieň. Pure, deterministické.
 * @param {number} count
 * @param {number} seed
 * @returns {Array<{x:number,y:number,z:number,brightness:number,tint:number}>}
 */
export function generateStars(count, seed = STARFIELD_SEED) {
  const rand = mulberry32(seed);
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    const z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const brightness = starBrightness(rand());
    const tint = brightness > 0.6 ? Math.floor(rand() * STAR_TINTS.length) : 1;
    stars.push({ x: s * Math.cos(phi), y: s * Math.sin(phi), z, brightness, tint });
  }
  return stars;
}

/**
 * Stena cube-mapu a súradnice (u, v ∈ [0,1]) pre smer — štandardná
 * konvencia (major axis). Pure.
 * @param {{x:number,y:number,z:number}} d
 * @returns {{face: string, u: number, v: number}}
 */
export function cubeFaceOf(d) {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  let face;
  let sc;
  let tc;
  let ma;
  if (ax >= ay && ax >= az) {
    ma = ax;
    if (d.x > 0) { face = 'positiveX'; sc = -d.z; tc = -d.y; } else { face = 'negativeX'; sc = d.z; tc = -d.y; }
  } else if (ay >= ax && ay >= az) {
    ma = ay;
    if (d.y > 0) { face = 'positiveY'; sc = d.x; tc = d.z; } else { face = 'negativeY'; sc = d.x; tc = -d.z; }
  } else {
    ma = az;
    if (d.z > 0) { face = 'positiveZ'; sc = d.x; tc = -d.y; } else { face = 'negativeZ'; sc = -d.x; tc = -d.y; }
  }
  return { face, u: (sc / ma + 1) / 2, v: (tc / ma + 1) / 2 };
}

/**
 * Nakresli hviezdy na šesť plátien. Body sú OSTRÉ, ale nie pod 2 px:
 * pri 60° zornom poli sa 2048 px stena kreslí na ~0,65 mierku, takže
 * 1 px hviezda by po filtrovaní stratila polovicu jasu (prvá verzia —
 * „slabučké"). Slabé = 2 px štvorček s alfou, stredné 3 px, jasné kruh
 * + halo, najjasnejšie väčší kruh + širšie halo (jediné „rozmazanie",
 * a to len pri ~16 % / ~4 % hviezd).
 * @param {Document} doc
 * @param {object} [options]
 * @param {number} [options.facePx]
 * @param {number} [options.count]
 * @param {number} [options.seed]
 * @returns {Record<string, HTMLCanvasElement>}
 */
export function paintStarfieldFaces(doc, { facePx = STARFIELD_FACE_PX, count = STARFIELD_STAR_COUNT, seed = STARFIELD_SEED, backgrounds = null } = {}) {
  const faces = {};
  for (const face of STARFIELD_FACES) {
    const canvas = doc.createElement('canvas');
    canvas.width = facePx;
    canvas.height = facePx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, facePx, facePx);
    // Tycho pozadie (voliteľné): stlmené a jemne rozmazané, nech JPEG šum
    // nesúperí s ostrými bodmi, ale Mliečna dráha ostane.
    const bg = backgrounds?.[face];
    if (bg && typeof ctx.drawImage === 'function') {
      ctx.save?.();
      if ('filter' in ctx) ctx.filter = `blur(${TYCHO_BACKGROUND_BLUR_PX}px)`;
      ctx.globalAlpha = TYCHO_BACKGROUND_ALPHA;
      ctx.drawImage(bg, 0, 0, facePx, facePx);
      ctx.restore?.();
      ctx.globalAlpha = 1;
      if ('filter' in ctx) ctx.filter = 'none';
    }
    faces[face] = { canvas, ctx };
  }
  for (const star of generateStars(count, seed)) {
    const { face, u, v } = cubeFaceOf(star);
    const { ctx } = faces[face];
    const x = Math.floor(u * facePx);
    const y = Math.floor(v * facePx);
    const [r, g, b] = STAR_TINTS[star.tint];
    const br = star.brightness;
    if (br < 0.3) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.55 + br * 1.5})`;
      ctx.fillRect(x, y, 2, 2);
    } else if (br < 0.7) {
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, 3, 3);
    } else {
      const strong = br >= 0.92;
      const core = strong ? 3.5 : 2.5;
      const haloR = strong ? 10 : 6;
      const halo = ctx.createRadialGradient(x + 1, y + 1, 0, x + 1, y + 1, haloR);
      halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.75)`);
      halo.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.25)`);
      halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(x + 1 - haloR, y + 1 - haloR, haloR * 2, haloR * 2);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.beginPath();
      ctx.arc(x + 1, y + 1, core, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const out = {};
  for (const face of STARFIELD_FACES) out[face] = faces[face].canvas;
  return out;
}

/** Načítaj obrázok (null pri zlyhaní — obloha potom ide bez pozadia). */
export function loadImageElement(url, doc = globalThis.document) {
  return new Promise((resolve) => {
    const img = doc?.createElement ? doc.createElement('img') : (typeof Image === 'function' ? new Image() : null);
    if (!img) { resolve(null); return; }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Šesť Tycho stien (chýbajúca = null pre danú stenu). */
export async function loadTychoFaces(imageLoader = loadImageElement) {
  const entries = await Promise.all(STARFIELD_FACES.map(async (face) => [face, await imageLoader(tychoFaceUrl(face))]));
  const out = {};
  for (const [face, img] of entries) out[face] = img || null;
  return out;
}

/**
 * Vymeň Cesium skybox za ostrý (Tycho pozadie + generované body). Vracia
 * funkciu, ktorá vráti pôvodný; jej `.ready` je Promise<boolean> — true, keď
 * sa obloha naozaj nasadila (pozadie sa načítava asynchrónne).
 * @param {object} viewer
 * @param {object} [deps]
 * @param {Document} [deps.doc]
 * @param {(faces: Record<string, HTMLCanvasElement>) => object} [deps.skyBoxFactory]
 * @param {(url: string) => Promise<object|null>} [deps.imageLoader]
 * @param {boolean} [deps.background] false = len body (bez Tycho)
 * @returns {(() => void)|null}
 */
export function installSharpStarfield(viewer, {
  doc = globalThis.document,
  skyBoxFactory = (faces) => {
    const sources = {};
    for (const face of STARFIELD_FACES) sources[face] = faces[face].toDataURL('image/png');
    return new Cesium.SkyBox({ sources });
  },
  imageLoader = loadImageElement,
  background = true,
} = {}) {
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return null;
  let previous;
  let applied = false;
  let cancelled = false;
  const revert = () => {
    cancelled = true;
    if (!applied) return;
    applied = false;
    scene.skyBox = previous;
    scene.requestRender?.();
  };
  revert.ready = (async () => {
    const backgrounds = background ? await loadTychoFaces(imageLoader) : null;
    if (cancelled) return false;
    const faces = paintStarfieldFaces(doc, { backgrounds });
    previous = scene.skyBox;
    scene.skyBox = skyBoxFactory(faces);
    applied = true;
    scene.requestRender?.();
    return true;
  })();
  return revert;
}
