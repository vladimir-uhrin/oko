// scripts/lib/frontDayClipRender.mjs — akčný záber do denného videa „Deň na fronte" (2026-10-05). Video ArmyInform
// (MP4 z armyinform.stream, CC BY 4.0) → najdynamickejšie okno dĺžky záberu (najviac zmien scény podľa ffmpeg,
// bez úvodných sekúnd s titulkovou kartou a bez konca) → snímka 1080×1920 v ráme OKO (rozmazané pozadie z toho
// istého videa, video na šírku v okne CLIP_BOX, rám s popisom a miestom z frontDayHud.buildClipOverlaySvg),
// bez zvuku (pod záberom ide hlas a hudba videa). Pure je len výber okna (`bestWindow`).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mediaHostAllowed } from '../../src/admin/server/studio/ukraine.js';
import { CLIP_BOX, buildClipOverlaySvg } from '../../src/data/frontDayHud.js';
import { FRONT_DAY_FORMAT } from '../../src/data/frontDayVideo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
/** Strop sťahovania videa (B) — ako Štúdio pri záberoch. */
export const CLIP_MAX_BYTES = 150 * 1024 * 1024;
/** Úvod videí ArmyInform býva titulková karta / logo — okno začína najskôr tu (s). */
export const CLIP_SKIP_START_S = 2.5;

const runCapture = (cmd, args, timeoutMs = 5 * 60_000) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err = (err + d).slice(-200_000); });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  child.on('error', (e) => { clearTimeout(timer); reject(e); });
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

/** Stiahne video záberu (len povolený hostiteľ, https, strop veľkosti, bez presmerovania mimo). */
export async function downloadClip(url, file, { fetchImpl = globalThis.fetch, maxBytes = CLIP_MAX_BYTES } = {}) {
  if (!mediaHostAllowed(url)) throw Object.assign(new Error(`nepovolený zdroj záberu: ${url}`), { code: 'CLIP_HOST' });
  const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw Object.assign(new Error(`záber: HTTP ${res.status}`), { code: 'CLIP_HTTP' });
  const type = res.headers.get('content-type') || '';
  if (type && !/video|octet-stream/.test(type)) throw Object.assign(new Error(`záber: nie je video (${type})`), { code: 'CLIP_TYPE' });
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error('záber: video je príliš veľké'), { code: 'CLIP_SIZE' });
  // Postupne do súboru (celé video naraz cez arrayBuffer zhodilo undici: „assert(!this.paused)", 2026-10-05).
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(`${file}.part`, 'w');
  let size = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => {}); throw Object.assign(new Error('záber: video je príliš veľké'), { code: 'CLIP_SIZE' }); }
      fs.writeSync(fd, value);
    }
  } catch (error) {
    fs.closeSync(fd); fs.rmSync(`${file}.part`, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  fs.renameSync(`${file}.part`, file);
  return file;
}

/** Rozdiel susedných snímok nad týmto prahom = strih (nie pohyb v zábere). */
export const CUT_SCORE = 0.3;

/**
 * Najdynamickejšie okno dĺžky `dur` (s) podľa POHYBU v obraze (priemerný rozdiel susedných snímok bez strihov).
 * Počet strihov rozhodoval zle: rozhovor prestrihaný ilustračnými zábermi ich má veľa, a pritom je to
 * hovoriaca hlava (2026-10-05). Strih v okne pridá len trochu, pri zhode bližšie k tretine videa.
 * Bez úvodu (`skip`) a posledná sekunda mimo. Pure.
 * @param {Array<[number, number]>} frames [čas s, rozdiel snímky 0–1] (ffmpeg scene_score)
 * @param {number} total dĺžka videa (s)
 */
export function bestWindow(frames, total, dur, { skip = CLIP_SKIP_START_S, step = 0.25 } = {}) {
  const last = Math.max(0, total - dur - 1);
  const first = Math.min(skip, last);
  let best = { start: first, score: -Infinity };
  for (let s = first; s <= last + 1e-9; s += step) {
    const w = frames.filter(([t]) => t >= s && t < s + dur);
    const motion = w.filter(([, v]) => v <= CUT_SCORE);
    const mean = motion.length ? motion.reduce((a, [, v]) => a + v, 0) / motion.length : 0;
    const cuts = w.length - motion.length;
    const score = mean + 0.004 * Math.min(cuts, 3) - Math.abs(s + dur / 2 - total / 3) / Math.max(1, total) * 0.002;
    if (score > best.score) best = { start: s, score };
  }
  return { start: Math.round(best.start * 100) / 100, dur: Math.min(dur, Math.max(0.5, total - best.start)) };
}

/** Záber na výšku (rozhovor, sociálny formát) do akčného okna na šírku nepatrí — vypadne. Pure. */
export const clipUsable = ({ width, height }) => Number(width) > 0 && Number(height) > 0 && width >= height;

/** Dĺžka, rozmer a pohyb po snímkach (5 snímok/s, ffmpeg scene_score). */
export async function probeClip(file, { ffmpeg = 'ffmpeg', fps = 5 } = {}) {
  const r = await runCapture(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf',
    `fps=${fps},scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score`, '-f', 'null', '-'], 10 * 60_000);
  const total = (() => { const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.err); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0; })();
  const size = /Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(r.err);
  const frames = [...r.err.matchAll(/pts_time:(\d+(?:\.\d+)?)[^\n]*\n[^\n]*lavfi\.scene_score=(\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  return { total, width: size ? Number(size[1]) : 0, height: size ? Number(size[2]) : 0, frames };
}

/**
 * Snímka záberu do videa: `dur` s z najdynamickejšieho okna, 1080×1920, 30 fps, bez zvuku.
 * @returns {Promise<{file: string, start: number, dur: number, cuts: number}>}
 */
export async function renderClipSegment({ src, out, dur, clip, day, ffmpeg = 'ffmpeg', fps = 30, probe = null }) {
  const sharp = require('sharp');
  const { total, frames } = probe || await probeClip(src, { ffmpeg });
  if (!total) throw Object.assign(new Error('záber: nedá sa zistiť dĺžka videa'), { code: 'CLIP_PROBE' });
  const win = bestWindow(frames, total, dur);
  const cuts = frames.filter(([, v]) => v > CUT_SCORE);
  const logoSvg = fs.readFileSync(path.join(ROOT, 'public', 'logo.svg'), 'utf8');
  const { inlineLogoMarkup } = await import('../../src/data/eventVideoHud.js');
  const overlay = `${out}.ram.png`;
  await sharp(Buffer.from(buildClipOverlaySvg(clip, { logoMarkup: inlineLogoMarkup(logoSvg), day }))).png().toFile(overlay);
  const { w: W, h: H } = FRONT_DAY_FORMAT;
  const filter = `[0:v]split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=26,eq=brightness=-0.3[bg];`
    + `[b]scale=${CLIP_BOX.w}:${CLIP_BOX.h}:force_original_aspect_ratio=decrease[fg];`
    + `[bg][fg]overlay=${CLIP_BOX.x}+(${CLIP_BOX.w}-w)/2:${CLIP_BOX.y}+(${CLIP_BOX.h}-h)/2[base];[base][1:v]overlay=0:0,fps=${fps},format=yuv420p[v]`;
  const r = await runCapture(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(win.start), '-t', String(dur), '-i', src, '-i', overlay,
    '-filter_complex', filter, '-map', '[v]', '-an', '-t', String(dur), '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', out], 10 * 60_000);
  try { fs.rmSync(overlay, { force: true }); } catch { /* */ }
  if (r.code !== 0 || !fs.existsSync(out)) throw Object.assign(new Error(`záber: ffmpeg ${r.err.trim().slice(-300)}`), { code: 'CLIP_RENDER' });
  return { file: out, start: win.start, dur, cuts: cuts.length };
}

/**
 * Vloží hotové zábery do nahratého obrazu na ich miesto v čase (čierne snímky mapy sa prekryjú).
 * @param {Array<{file: string, start: number, dur: number}>} segments
 */
export async function overlayClips({ rawVideo, segments, out, ffmpeg = 'ffmpeg' }) {
  if (!segments.length) { fs.copyFileSync(rawVideo, out); return out; }
  const inputs = ['-i', rawVideo]; const filters = []; let last = '0:v';
  segments.forEach((s, k) => {
    inputs.push('-i', s.file);
    filters.push(`[${k + 1}:v]setpts=PTS-STARTPTS+${s.start.toFixed(3)}/TB[c${k}]`);
    filters.push(`[${last}][c${k}]overlay=0:0:eof_action=pass:enable='between(t,${s.start.toFixed(3)},${(s.start + s.dur).toFixed(3)})'[o${k}]`);
    last = `o${k}`;
  });
  const r = await runCapture(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', `[${last}]`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', out], 20 * 60_000);
  if (r.code !== 0) throw Object.assign(new Error(`vloženie záberov: ${r.err.trim().slice(-300)}`), { code: 'CLIP_OVERLAY' });
  return out;
}
