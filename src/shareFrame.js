// src/shareFrame.js
// Jeden snímok zdieľania (2026-10-07, vyčlenené zo shareSnapshot.js, aby ho mohlo použiť aj video):
// plátno Cesia + plátna prekryvov (#world-overlay-root: karty, detekcia) zložené výrezom „cover" zo
// stredu, voliteľný rám (KARTA K5) a dole pás s pečiatkou OKO · dátum a atribúciou Google / Cesium ion
// (podmienky Map Tiles vyžadujú atribúciu aj na zdieľanom obrázku a videu). Čistý modul bez Cesia
// a bez DOM pri importe — testuje sa s falošným kontextom plátna.
import { fitCover } from './shareTargets.js';

export const SHARE_STRIP_HEIGHT_PX = 36;

/**
 * Plátna, z ktorých sa skladá snímka aj video: Cesium (fotoreál, terén, ikony) a prekryvy.
 * @param {{ viewer?: object, document?: Document }} input
 * @returns {HTMLCanvasElement[]}
 */
export function collectShareSources({ viewer, document: doc = globalThis.document } = {}) {
  const sources = [];
  const cesiumCanvas = viewer?.canvas || viewer?.scene?.canvas || null;
  if (cesiumCanvas) sources.push(cesiumCanvas);
  for (const overlay of doc?.querySelectorAll?.('#world-overlay-root canvas') || []) sources.push(overlay);
  return sources;
}

/**
 * Nakresli jeden snímok do kontextu: pozadie, plátna výrezom cover, rám, pás s pečiatkou a atribúciou.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ sources: HTMLCanvasElement[], width: number, height: number, stamp?: string, attribution?: string, decorate?: ((ctx: CanvasRenderingContext2D, width: number, height: number) => void)|null }} input
 */
export function drawShareFrame(ctx, { sources, width, height, stamp = '', attribution = '', decorate = null }) {
  ctx.fillStyle = '#06101a';
  ctx.fillRect(0, 0, width, height);
  for (const source of sources || []) {
    const sw = Number(source?.width) || 0;
    const sh = Number(source?.height) || 0;
    if (!sw || !sh) continue;
    const crop = fitCover(sw, sh, width, height);
    try { ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height); } catch { /* prázdne alebo cudzie plátno */ }
  }

  // Voliteľný rám (KARTA K5: titulok, legenda, mapka) sa zapečie nad pás atribúcie.
  if (typeof decorate === 'function') {
    try { decorate(ctx, width, height - SHARE_STRIP_HEIGHT_PX); } catch { /* rám je najlepšia snaha */ }
  }

  // Pás s pečiatkou a atribúciou.
  ctx.fillStyle = 'rgba(4, 10, 16, 0.72)';
  ctx.fillRect(0, height - SHARE_STRIP_HEIGHT_PX, width, SHARE_STRIP_HEIGHT_PX);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#dff3fb';
  ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
  if (stamp) ctx.fillText(stamp, 16, height - SHARE_STRIP_HEIGHT_PX / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(223, 243, 251, 0.88)';
  ctx.font = '13px system-ui, "Segoe UI", sans-serif';
  if (attribution) ctx.fillText(attribution, width - 16, height - SHARE_STRIP_HEIGHT_PX / 2);
}
