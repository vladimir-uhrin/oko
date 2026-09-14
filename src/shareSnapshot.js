// src/shareSnapshot.js
// Snímka toho, čo používateľ vidí (2026-09-14, zdieľanie A+B): plátno Cesia
// (fotoreál, terén, ikony) + plátna prekryvov (#world-overlay-root: karty,
// detekcia) zložené do 1200×630 výrezom „cover" zo stredu, dole pás
// s pečiatkou OKO · dátum a atribúciou Google / Cesium ion (podmienky Map
// Tiles vyžadujú atribúciu aj na zdieľanom obrázku). DOM prvky (HUD, panely)
// v snímke nie sú — nesú sa v odkaze. Viewer má preserveDrawingBuffer,
// renderFreshCesiumFrame si vypýta čerstvý snímok pod idle governorom.
import { renderFreshCesiumFrame } from './voice/gevRealtime.js';
import {
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_MAX_BYTES,
  SHARE_IMAGE_WIDTH,
  dataUrlByteLength,
  fitCover,
} from './shareTargets.js';

const STRIP_HEIGHT_PX = 36;
const JPEG_QUALITIES = [0.82, 0.7, 0.58, 0.45];

/**
 * @param {object} input
 * @param {object} input.viewer Cesium Viewer (canvas + scene)
 * @param {Document} [input.document]
 * @param {number} [input.width]
 * @param {number} [input.height]
 * @param {string} [input.stamp] ľavý text pásu (OKO · dátum)
 * @param {string} [input.attribution] pravý text pásu (© Google · Cesium ion …)
 * @returns {Promise<{ canvas: HTMLCanvasElement, width: number, height: number, jpegDataUrl: string, pngBlob: () => Promise<Blob|null> }|null>}
 */
export async function captureShareSnapshot({
  viewer,
  document: doc = globalThis.document,
  width = SHARE_IMAGE_WIDTH,
  height = SHARE_IMAGE_HEIGHT,
  stamp = '',
  attribution = '',
} = {}) {
  if (!doc?.createElement) return null;
  const sources = [];
  const cesiumCanvas = viewer?.canvas || viewer?.scene?.canvas || null;
  if (cesiumCanvas) {
    try { await renderFreshCesiumFrame(viewer); } catch { /* starší snímok je stále obrázok */ }
    sources.push(cesiumCanvas);
  }
  for (const overlay of doc.querySelectorAll?.('#world-overlay-root canvas') || []) sources.push(overlay);
  if (!sources.length) return null;

  const target = doc.createElement('canvas');
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#06101a';
  ctx.fillRect(0, 0, width, height);
  for (const source of sources) {
    const sw = Number(source.width) || 0;
    const sh = Number(source.height) || 0;
    if (!sw || !sh) continue;
    const crop = fitCover(sw, sh, width, height);
    try { ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height); } catch { /* prázdne alebo cudzie plátno */ }
  }

  // Pás s pečiatkou a atribúciou.
  ctx.fillStyle = 'rgba(4, 10, 16, 0.72)';
  ctx.fillRect(0, height - STRIP_HEIGHT_PX, width, STRIP_HEIGHT_PX);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#dff3fb';
  ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
  if (stamp) ctx.fillText(stamp, 16, height - STRIP_HEIGHT_PX / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(223, 243, 251, 0.88)';
  ctx.font = '13px system-ui, "Segoe UI", sans-serif';
  if (attribution) ctx.fillText(attribution, width - 16, height - STRIP_HEIGHT_PX / 2);

  let jpegDataUrl = '';
  for (const quality of JPEG_QUALITIES) {
    jpegDataUrl = target.toDataURL('image/jpeg', quality);
    if (dataUrlByteLength(jpegDataUrl) <= SHARE_IMAGE_MAX_BYTES) break;
  }
  return {
    canvas: target,
    width,
    height,
    jpegDataUrl,
    pngBlob: () => new Promise((resolve) => {
      try { target.toBlob((blob) => resolve(blob || null), 'image/png'); } catch { resolve(null); }
    }),
  };
}

/** Pečiatka do pásu: OKO · 14. 9. 2026 14:26 (podľa jazyka). Pure. */
export function snapshotStamp(whenMs = Date.now(), lang = 'sk') {
  const locale = lang === 'en' ? 'en-GB' : 'sk-SK';
  let when;
  try {
    when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(whenMs));
  } catch {
    when = new Date(whenMs).toISOString().slice(0, 16).replace('T', ' ');
  }
  return `OKO · ${when}`;
}
