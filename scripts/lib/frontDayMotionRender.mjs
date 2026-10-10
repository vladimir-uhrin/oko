// scripts/lib/frontDayMotionRender.mjs — denné video v2 (2026-10-10): grafická vrstva (src/data/frontDayMotion.js)
// ako priehľadné video, zvukové efekty pri strihoch (vygenerované ffmpeg, bez licencií) a zrýchlený hlas.
//   renderMotionTrack  SVG každej snímky → PNG (sharp) → ffmpeg (PNG v MOV, alfa); rovnaké snímky sa nekreslia znova
//   composeV2          obraz + grafika + zvuk → hotové MP4
//   ensureSfx/mixSfx   šum (strih), úder (háčik, záver), pípnutie (číslo) → pridané do zmiešaného zvuku
//   speedVoice         nahrávky viet zrýchlené (atempo) a znova zmerané (začiatok reči, koniec, pauzy)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FRONT_DAY_FORMAT } from '../../src/data/frontDayVideo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const run = (cmd, args, timeoutMs = 10 * 60_000) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: timeoutMs });

/** Grafika ako video s alfou: `svgAt(t)` pre každú snímku. Vracia cestu k MOV. */
export async function renderMotionTrack({ svgAt, totalFrames, fps = 30, out, ffmpeg = 'ffmpeg', onProgress = () => {} }) {
  const sharp = require('sharp');
  const { w: W, h: H } = FRONT_DAY_FORMAT;
  const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'png', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, out], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  ff.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  const exited = new Promise((resolve) => { ff.on('error', (e) => resolve({ code: -1, e })); ff.on('close', (code) => resolve({ code })); });
  let lastSvg = null; let lastPng = null; let drawn = 0;
  for (let f = 0; f < totalFrames; f += 1) {
    const svg = svgAt(f / fps);
    if (svg !== lastSvg) { lastPng = await sharp(Buffer.from(svg)).png({ compressionLevel: 1 }).toBuffer(); lastSvg = svg; drawn += 1; }
    if (!ff.stdin.write(lastPng)) await Promise.race([once(ff.stdin, 'drain').catch(() => {}), exited]);
    if (f % 150 === 0) onProgress('motion', { frame: f, frames: totalFrames });
  }
  ff.stdin.end();
  const r = await exited;
  if (r.code !== 0) throw Object.assign(new Error(`grafika: ffmpeg ${r.e?.message || r.code}: ${err.trim().slice(-300)}`), { code: 'MOTION_FAILED' });
  return { file: out, drawn };
}

/** Obraz (mapa + zábery) + grafika s alfou + zvuk → MP4 pre Reels. */
export function composeV2({ rawVideo, motion, audio, out, ffmpeg = 'ffmpeg' }) {
  const r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawVideo, '-i', motion, '-i', audio,
    '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[v]', '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest', out], 30 * 60_000);
  if (r.status !== 0) throw Object.assign(new Error(`zloženie v2: ${(r.stderr || '').slice(-400)}`), { code: 'COMPOSE_FAILED' });
  return out;
}

/** Zvukové efekty vygenerované ffmpeg (žiadne cudzie nahrávky, žiadna licencia): šum, úder, pípnutie. */
export const SFX_RECIPES = Object.freeze({
  whoosh: 'anoisesrc=d=0.42:c=pink:r=48000:a=0.9,highpass=f=350,lowpass=f=5200,afade=t=in:st=0:d=0.24:curve=exp,afade=t=out:st=0.24:d=0.18,volume=0.9',
  impact: 'sine=f=52:d=0.75:r=48000,volume=1.6,afade=t=out:st=0.03:d=0.72:curve=exp[a];anoisesrc=d=0.09:c=brown:r=48000:a=0.8,lowpass=f=1400,afade=t=out:st=0:d=0.09[b];[a][b]amix=inputs=2:normalize=0',
  pop: 'sine=f=880:d=0.09:r=48000,volume=0.35,afade=t=in:st=0:d=0.005,afade=t=out:st=0.01:d=0.08',
});

export function ensureSfx(dir, ffmpeg = 'ffmpeg') {
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [name, recipe] of Object.entries(SFX_RECIPES)) {
    const file = path.join(dir, `${name}.wav`);
    if (!fs.existsSync(file)) {
      const r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex', `${recipe}`, '-ac', '2', '-ar', '48000', file]);
      if (r.status !== 0) throw Object.assign(new Error(`efekt ${name}: ${(r.stderr || '').slice(-300)}`), { code: 'SFX_FAILED' });
    }
    files[name] = file;
  }
  return files;
}

/** Efekty do hotového zvuku: [{t, kind}] → adelay a sčítanie (efekty tichšie než hlas). */
export function mixSfx({ audioIn, events, sfx, out, ffmpeg = 'ffmpeg', gain = { whoosh: 1.4, impact: 1.0, pop: 4 } }) {
  // Úrovne zmerané (volumedetect): šum −15 dB, úder −7 dB, pípnutie −30 dB špičkovo → pod hlasom (−16 LUFS),
  // ale počuteľné: šum ≈ −12 dB, úder ≈ −7 dB, pípnutie ≈ −18 dB.
  const used = (events || []).filter((e) => sfx[e.kind]);
  if (!used.length) { fs.copyFileSync(audioIn, out); return out; }
  const inputs = ['-i', audioIn, ...used.flatMap((e) => ['-i', sfx[e.kind]])];
  const parts = used.map((e, k) => `[${k + 1}:a]adelay=${Math.max(0, Math.round(e.t * 1000))}:all=1,volume=${gain[e.kind] ?? 0.3}[s${k}]`);
  const filter = `${parts.join(';')};[0:a]${used.map((_, k) => `[s${k}]`).join('')}amix=inputs=${used.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[o]`;
  const r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[o]', '-c:a', 'pcm_s16le', '-ar', '48000', out]);
  if (r.status !== 0) throw Object.assign(new Error(`efekty: ${(r.stderr || '').slice(-300)}`), { code: 'SFX_FAILED' });
  return out;
}

/**
 * Zrýchlený hlas (tempo bez zmeny výšky): každá nahrávka → `<id>-tempo.wav`, nové časy reči.
 * @returns {{durations: object, bounds: object, voiceFiles: object}}
 */
export function speedVoice({ voiceFiles, factor = 1.1, workDir, measure, ffmpeg = 'ffmpeg' }) {
  const durations = {}; const bounds = {}; const files = {};
  fs.mkdirSync(workDir, { recursive: true });
  for (const [id, wav] of Object.entries(voiceFiles || {})) {
    const out = path.join(workDir, `hlas-${id}-tempo.wav`);
    const r = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-filter:a', `atempo=${factor}`, '-ar', '48000', out]);
    if (r.status !== 0) throw Object.assign(new Error(`tempo hlasu: ${(r.stderr || '').slice(-300)}`), { code: 'VOICE_TEMPO' });
    const m = measure(out);
    durations[id] = { lead: m.lead, speechEnd: m.speechEnd };
    bounds[id] = { pauses: m.pauses };
    files[id] = out;
  }
  return { durations, bounds, voiceFiles: files };
}
