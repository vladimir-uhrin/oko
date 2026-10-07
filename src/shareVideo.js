// src/shareVideo.js
// Krátke živé video do náhľadu odkazu (2026-10-07, krok 1 odporúčania k „aby to nebol obrázok, ale live"):
// 6 s záznam toho istého výrezu ako snímka (plátno Cesia + prekryvy + pás s pečiatkou a atribúciou),
// MediaRecorder nad captureStream pomocného plátna, odoslanie na POST /api/share/<id>/video. Server
// z neho spraví MP4 (H.264, shareVideoServer.js) a stránka /s/<id> dostane og:video — Facebook ho podľa
// svojej dokumentácie pre webmasterov môže prehrať priamo vo feede („spôsobilé, nie zaručené"), Discord
// a Telegram MP4 z og:video prehrávajú; ostatné siete ostávajú pri obrázku. Keď prehliadač plátno
// nahrávať nevie alebo niečo zlyhá, odkaz ostáva s obrázkom — nič tu nehádže.
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from './shareTargets.js';
import { collectShareSources, drawShareFrame } from './shareFrame.js';

export const SHARE_VIDEO_DURATION_MS = 6000;
export const SHARE_VIDEO_FPS = 25;
export const SHARE_VIDEO_BITS_PER_SECOND = 2_500_000;
export const SHARE_VIDEO_API_URL = '/api/share';
/** Poradie formátov: MP4 (Safari dáva H.264 rovno), inak WebM (Chrome, Firefox) — server prevedie. */
export const SHARE_VIDEO_MIME_CANDIDATES = Object.freeze([
  'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
]);
/** Po zastavení nahrávania čakáme na posledný kúsok dát najviac takto dlho. */
export const SHARE_VIDEO_STOP_TIMEOUT_MS = 4000;

/** Prvý podporovaný formát záznamu alebo null. Pure. */
export function pickRecorderMimeType(isTypeSupported, candidates = SHARE_VIDEO_MIME_CANDIDATES) {
  if (typeof isTypeSupported !== 'function') return null;
  for (const type of candidates) {
    try { if (isTypeSupported(type)) return type; } catch { /* ďalší kandidát */ }
  }
  return null;
}

/** Vie prehliadač nahrať plátno (MediaRecorder + canvas.captureStream + podporovaný formát)? */
export function canRecordShareVideo({ window: win = globalThis.window, document: doc = globalThis.document } = {}) {
  const Recorder = win?.MediaRecorder;
  if (typeof Recorder !== 'function') return false;
  let canvas = null;
  try { canvas = doc?.createElement?.('canvas') || null; } catch { canvas = null; }
  if (!canvas || typeof canvas.captureStream !== 'function') return false;
  return Boolean(pickRecorderMimeType((type) => Recorder.isTypeSupported?.(type)));
}

/**
 * Nahraj krátke video výrezu zdieľania. Snímky kreslí sám (captureStream(0) + requestFrame; kde to
 * prehliadač nevie, tečie prúd s fps), každý snímok si vyžiada nové vykreslenie scény (pod governorom
 * nečinnosti by sa inak opakoval ten istý obraz). Vracia { blob, type, width, height, durationMs, frames }
 * alebo null — nikdy nehádže.
 * @param {object} input
 * @param {object} input.viewer Cesium Viewer
 * @param {string} [input.stamp] ľavý text pásu (OKO · dátum)
 * @param {string} [input.attribution] pravý text pásu (© Google · Cesium ion …)
 * @param {(ctx: CanvasRenderingContext2D, width: number, height: number) => void} [input.decorate]
 * @param {(info: { elapsedMs: number, frames: number }) => void} [input.onProgress]
 */
export async function recordShareVideo({
  viewer,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  width = SHARE_IMAGE_WIDTH,
  height = SHARE_IMAGE_HEIGHT,
  stamp = '',
  attribution = '',
  decorate = null,
  durationMs = SHARE_VIDEO_DURATION_MS,
  fps = SHARE_VIDEO_FPS,
  bitsPerSecond = SHARE_VIDEO_BITS_PER_SECOND,
  mimeType = null,
  now = () => (win?.performance?.now?.() ?? Date.now()),
  raf = (callback) => win.requestAnimationFrame(callback),
  setTimeoutImpl = (callback, ms) => setTimeout(callback, ms),
  onProgress = () => {},
} = {}) {
  const Recorder = win?.MediaRecorder;
  if (typeof Recorder !== 'function' || !doc?.createElement) return null;
  const sources = collectShareSources({ viewer, document: doc });
  if (!sources.length) return null;
  const type = mimeType || pickRecorderMimeType((candidate) => Recorder.isTypeSupported?.(candidate));
  if (!type) return null;

  const target = doc.createElement('canvas');
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d');
  if (!ctx || typeof target.captureStream !== 'function') return null;

  let stream = null;
  let track = null;
  try { stream = target.captureStream(0); track = stream?.getVideoTracks?.()[0] || null; } catch { stream = null; }
  const manual = typeof track?.requestFrame === 'function';
  if (!manual) {
    try { stream = target.captureStream(fps); } catch { stream = null; }
  }
  if (!stream) return null;

  const chunks = [];
  let recorder;
  try { recorder = new Recorder(stream, { mimeType: type, videoBitsPerSecond: bitsPerSecond }); } catch { return null; }
  const stopped = new Promise((resolve) => {
    recorder.addEventListener('dataavailable', (event) => { if (event?.data?.size) chunks.push(event.data); });
    recorder.addEventListener('stop', () => resolve(true));
    recorder.addEventListener('error', () => resolve(false));
  });

  const frameInterval = 1000 / fps;
  let frames = 0;
  const drawOne = () => {
    drawShareFrame(ctx, { sources, width, height, stamp, attribution, decorate });
    if (manual) { try { track.requestFrame(); } catch { /* prúd skončil */ } }
    frames += 1;
  };
  drawOne(); // prvý snímok pred štartom, aby prúd mal obraz už v prvom kúsku
  try { recorder.start(); } catch { return null; }
  const startedAt = now();
  let lastFrameAt = startedAt;
  await new Promise((resolve) => {
    const tick = () => {
      const t = now();
      if (t - startedAt >= durationMs) { resolve(); return; }
      if (t - lastFrameAt >= frameInterval) {
        lastFrameAt = t;
        try { viewer?.scene?.requestRender?.(); } catch { /* bez governora netreba */ }
        drawOne();
        try { onProgress({ elapsedMs: t - startedAt, frames }); } catch { /* hlásenie nesmie zhodiť záznam */ }
      }
      raf(tick);
    };
    raf(tick);
  });
  const endedAt = now();
  try { recorder.stop(); } catch { return null; }
  const finished = await Promise.race([
    stopped,
    new Promise((resolve) => setTimeoutImpl(() => resolve(false), SHARE_VIDEO_STOP_TIMEOUT_MS)),
  ]);
  try { for (const streamTrack of stream.getTracks?.() || []) streamTrack.stop?.(); } catch { /* prúd už stojí */ }
  if (!finished || !chunks.length) return null;
  const BlobImpl = win?.Blob || globalThis.Blob;
  const blob = new BlobImpl(chunks, { type: recorder.mimeType || type });
  if (!(blob.size > 1000)) return null;
  return {
    blob,
    type: String(recorder.mimeType || type).split(';')[0],
    width,
    height,
    durationMs: Math.round(endedAt - startedAt),
    frames,
  };
}

/**
 * Pošli nahrávku k uloženému zdieľaniu; server ju prevedie na MP4 a stránka odkazu dostane og:video.
 * Vracia { url, width, height, durationMs } alebo null (server nedostupný, odmietol, sieť). Nikdy nehádže.
 */
export async function uploadShareVideo({
  id, blob, type, width, height, durationMs,
  fetchImpl = globalThis.fetch,
  url = SHARE_VIDEO_API_URL,
} = {}) {
  if (typeof fetchImpl !== 'function' || !id || !blob) return null;
  const params = new URLSearchParams({ w: String(Math.round(Number(width) || 0)), h: String(Math.round(Number(height) || 0)), ms: String(Math.round(Number(durationMs) || 0)) });
  try {
    const response = await fetchImpl(`${url}/${encodeURIComponent(String(id))}/video?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': type || blob.type || 'application/octet-stream' },
      body: blob,
      cache: 'no-store',
    });
    if (!response?.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data?.video) return null;
    return { url: String(data.video), width: Number(data.width) || width, height: Number(data.height) || height, durationMs: Number(data.durationMs) || durationMs };
  } catch {
    return null;
  }
}
