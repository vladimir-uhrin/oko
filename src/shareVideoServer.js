// src/shareVideoServer.js
// Serverová časť krátkeho videa v náhľade odkazu (2026-10-07, Node): prevod nahrávky z prehliadača
// (WebM/MP4 z MediaRecorderu) na MP4 H.264 cez ffmpeg (FFMPEG_PATH v .env, zadarmo) — siete prehrajú
// len MP4 s yuv420p a faststart — a odoslanie súboru s podporou Range (prehrávače aj crawler Facebooku
// žiadajú rozsahy bajtov). Čisté časti (argumenty ffmpeg, rozsah) sa testujú bez procesu a bez disku.
import { execFile } from 'node:child_process';
import fs from 'node:fs';

/** Najdlhšie video v náhľade (klient nahráva 6 s; dlhšie sa oreže). */
export const SHARE_VIDEO_OUTPUT_MAX_SECONDS = 10;
export const SHARE_VIDEO_CONVERT_TIMEOUT_MS = 60_000;

/** Cesta k ffmpeg: FFMPEG_PATH z .env, inak `ffmpeg` z PATH. Pure. */
export function resolveFfmpegPath(env = process.env) {
  return String(env?.FFMPEG_PATH || 'ffmpeg');
}

/** Argumenty prevodu (pure): bez zvuku, pevné párne rozmery, H.264 main, faststart pre prehrávanie zo siete. */
export function ffmpegArgsForShareVideo({ inputPath, outputPath, width, height, maxSeconds = SHARE_VIDEO_OUTPUT_MAX_SECONDS }) {
  const even = (value, fallback) => {
    const n = Math.round(Number(value) || fallback);
    return Math.max(2, n - (n % 2));
  };
  const w = even(width, 1200);
  const h = even(height, 630);
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-t', String(Math.max(1, Math.min(SHARE_VIDEO_OUTPUT_MAX_SECONDS, Number(maxSeconds) || SHARE_VIDEO_OUTPUT_MAX_SECONDS))),
    '-an',
    '-vf', `scale=${w}:${h}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'main', '-level', '4.0',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ];
}

/**
 * Preveď nahrávku na MP4. Vracia { ok: true, bytes } alebo { ok: false, error: 'ffmpeg_missing'|'convert_failed', detail }.
 * Nikdy nehádže; proces má časový limit.
 */
export function convertShareVideo({
  ffmpegPath = resolveFfmpegPath(),
  inputPath, outputPath, width, height, maxSeconds,
  execFileImpl = execFile,
  fsImpl = fs,
  timeoutMs = SHARE_VIDEO_CONVERT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    const args = ffmpegArgsForShareVideo({ inputPath, outputPath, width, height, maxSeconds });
    try {
      execFileImpl(ffmpegPath, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (error, _stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: error.code === 'ENOENT' ? 'ffmpeg_missing' : 'convert_failed', detail: String(stderr || error.message || '').slice(0, 400) });
          return;
        }
        let bytes = 0;
        try { bytes = fsImpl.statSync(outputPath).size; } catch { bytes = 0; }
        if (!bytes) { resolve({ ok: false, error: 'convert_failed', detail: 'empty output' }); return; }
        resolve({ ok: true, bytes });
      });
    } catch (error) {
      resolve({ ok: false, error: 'convert_failed', detail: String(error?.message || error).slice(0, 400) });
    }
  });
}

/**
 * Rozsah bajtov z hlavičky Range (pure): { start, end } v rámci size; null = celý súbor;
 * { invalid: true } = 416 (neplatný tvar, mimo súboru, prázdny rozsah).
 */
export function byteRangeFor(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match || !(size > 0)) return { invalid: true };
  const [, first, last] = match;
  if (first === '' && last === '') return { invalid: true };
  let start;
  let end;
  if (first === '') {
    const suffix = Number(last);
    if (!suffix) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(first);
    end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return { invalid: true };
  return { start, end };
}

/** Odošli súbor videa (GET/HEAD) s Accept-Ranges a 206 pri rozsahu; 404 bez súboru, 416 pri zlom rozsahu. */
export function sendVideoFile({ req, res, filePath, fsImpl = fs, type = 'video/mp4', cacheControl = 'public, max-age=31536000, immutable' }) {
  let stat;
  try { stat = fsImpl.statSync(filePath); } catch { stat = null; }
  if (!stat || !(stat.size > 0)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not Found');
    return;
  }
  const range = byteRangeFor(req?.headers?.range, stat.size);
  if (range?.invalid) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : stat.size - 1;
  res.writeHead(range ? 206 : 200, {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'Content-Length': String(end - start + 1),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
  });
  if (req?.method === 'HEAD') { res.end(); return; }
  const stream = fsImpl.createReadStream(filePath, { start, end });
  stream.on('error', () => { try { res.destroy(); } catch { /* spojenie už zatvorené */ } });
  stream.pipe(res);
}
