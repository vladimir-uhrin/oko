// OKO Štúdio — Fáza 2: reels 1080×1920 (9:16), 12 s, H.264 + AAC (2026-10-03).
//
// Bez prehliadača a bez Google: vlastná mapa z Natural Earth (public domain)
// sa animuje snímku po snímke (priblíženie k udalosti, pulzujúci bod, odpočítanie
// čísla), sharp skladá snímky a ffmpeg (systémový, zadarmo) z nich spraví MP4.
// Zvuk: tichý ambient generovaný ffmpeg (bez licencie), voliteľne hudba z vlastného
// priečinka (CC0) a slovenský hlas cez Piper TTS — oboje len ak sú nastavené.
// Bezpečné zóny reels: dôležitý obsah medzi y ≈ 220 a 1580 (hore/dole UI aplikácie).

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FONT, MONO, escapeXml, loadBorders, loadLand, stamp, wrap } from './card.js';

export const REEL = Object.freeze({ width: 1080, height: 1920, fps: 30, seconds: 12 });
const MAP = { x: 0, y: 640, w: 1080, h: 800 };
const ZOOM_FROM = 0.3; const ZOOM_TO = 4.6; // s

const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const fade = (t, from, len = 0.6) => clamp01((t - from) / len);
const num1 = v => v.toFixed(1).replace('.', ',');

// ── mapa ──────────────────────────────────────────────────────────────────
/** Výrez mapy v čase t: lon/lat stred + rozpätie v stupňoch dĺžky. */
export function reelView(card, t) {
  const aspect = MAP.h / MAP.w;
  if (card.point) {
    const k = ease(clamp01((t - ZOOM_FROM) / (ZOOM_TO - ZOOM_FROM)));
    const span = Math.exp(Math.log(150) + (Math.log(26) - Math.log(150)) * k);
    const lat = card.point.lat * (0.55 + 0.45 * k);
    return { lon: card.point.lon, lat: Math.max(-60 + span * aspect / 2, Math.min(80 - span * aspect / 2, lat)), span };
  }
  // Prehľad: pomalý posun cez svet.
  const span = 210;
  return { lon: -40 + 150 * (t / REEL.seconds), lat: 12, span };
}

function projector(view, w = MAP.w, h = MAP.h) {
  // Výška v stupňoch je vždy daná oknom mapy (MAP), aby panoráma a snímka mali rovnakú mierku.
  const spanLat = view.span * h / w;
  const west = view.lon - view.span / 2; const north = view.lat + spanLat / 2;
  return (lon, lat) => {
    let x = lon;
    while (x < west - 180) x += 360;
    while (x > west + 540) x -= 360;
    return [((x - west) / view.span) * w, ((north - lat) / spanLat) * h];
  };
}

function ringPath(project, ring, view, w = MAP.w, h = MAP.h) {
  const pad = 30;
  const xs = []; let inside = false;
  for (const [lon, lat] of ring) {
    const p = project(lon, lat);
    if (p[0] > -w * 0.5 - pad && p[0] < w * 1.5 + pad && p[1] > -h * 0.5 && p[1] < h * 1.5) inside = true;
    xs.push(p);
  }
  if (!inside || view.span <= 0) return '';
  return xs.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
}

/** SVG mapy (bez značiek) pre daný výrez. */
export function mapLayerSvg(view, w = MAP.w, h = MAP.h) {
  const project = projector(view, w, h);
  const land = loadLand().map(ring => ringPath(project, ring, view, w, h)).filter(Boolean).map(d => d + 'Z').join('');
  const borders = loadBorders().map(line => ringPath(project, line, view, w, h)).filter(Boolean).join('');
  const grid = [];
  const step = view.span > 90 ? 30 : view.span > 40 ? 15 : 5;
  const spanLat = view.span * h / w;
  for (let lon = Math.ceil((view.lon - view.span / 2) / step) * step; lon <= view.lon + view.span / 2; lon += step) {
    const [x] = project(lon, 0); grid.push(`M${x.toFixed(1)},0V${h}`);
  }
  for (let lat = Math.ceil((view.lat - spanLat / 2) / step) * step; lat <= view.lat + spanLat / 2; lat += step) {
    const [, y] = project(view.lon, lat); grid.push(`M0,${y.toFixed(1)}H${w}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#061019"/>
  <path d="${grid.join('')}" stroke="#12283a" stroke-width="1.5" fill="none"/>
  <path d="${land}" fill="#14283a" stroke="#3f6c86" stroke-width="2" stroke-linejoin="round"/>
  <path d="${borders}" stroke="#2d5168" stroke-width="1.5" fill="none" stroke-dasharray="6 4"/>
</svg>`;
}

// ── vrstvy snímky ──────────────────────────────────────────────────────────
function backgroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL.width}" height="${REEL.height}">
  <defs><radialGradient id="g" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#10364a"/><stop offset="1" stop-color="#070d14"/></radialGradient>
  <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070d14"/><stop offset="1" stop-color="#070d14" stop-opacity="0"/></linearGradient>
  <linearGradient id="fadeBottom" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#070d14"/><stop offset="1" stop-color="#070d14" stop-opacity="0"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

/** Popredie: texty, značky, prechody. */
export function overlaySvg(card, t, { seconds = REEL.seconds, site = 'okolive.sk' } = {}) {
  const view = reelView(card, t);
  const project = projector(view);
  const parts = [];
  // prechod mapy do pozadia hore a dole
  parts.push(`<rect x="0" y="${MAP.y}" width="${MAP.w}" height="90" fill="url(#ft)"/><rect x="0" y="${MAP.y + MAP.h - 120}" width="${MAP.w}" height="120" fill="url(#fb)"/>`);
  // značky
  const pulse = (x, y, phase, base = 14) => {
    const out = [];
    for (let k = 0; k < 2; k++) {
      const p = ((t * 0.7 + phase + k * 0.5) % 1);
      out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(base + p * 90).toFixed(1)}" fill="none" stroke="#ff5a3c" stroke-width="${(4 * (1 - p)).toFixed(2)}" stroke-opacity="${(0.8 * (1 - p)).toFixed(2)}"/>`);
    }
    out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${base}" fill="#ff5a3c" stroke="#0a0f16" stroke-width="4"/>`);
    return out.join('');
  };
  if (card.point && t > 0.4) {
    const [x, y] = project(card.point.lon, card.point.lat);
    parts.push(`<g transform="translate(${MAP.x},${MAP.y})" opacity="${fade(t, 0.4, 0.5).toFixed(2)}">${pulse(x, y, 0)}</g>`);
  }
  (card.points || []).forEach((p, i) => {
    const appear = 1 + i * (5 / Math.max(1, card.points.length));
    if (t < appear) return;
    const [x, y] = project(p.lon, p.lat);
    if (x < -40 || x > MAP.w + 40) return;
    const r = Math.max(6, Math.min(18, (p.size - 3.5) * 5));
    parts.push(`<g transform="translate(${MAP.x},${MAP.y})" opacity="${fade(t, appear, 0.4).toFixed(2)}">${i < 3 ? pulse(x, y, i * 0.3, r) : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#ff5a3c" fill-opacity="0.8" stroke="#0a0f16" stroke-width="2"/>`}</g>`);
  });
  // hlavička
  const head = fade(t, 0, 0.6);
  parts.push(`<g opacity="${head.toFixed(2)}" font-family="${FONT}">
    <circle cx="96" cy="250" r="24" fill="none" stroke="#00d4ff" stroke-width="5"/><circle cx="96" cy="250" r="9" fill="#00d4ff"/>
    <text x="136" y="263" font-family="${MONO}" font-size="38" font-weight="700" letter-spacing="9" fill="#e8f1f7">OKO</text>
    <text x="1010" y="262" text-anchor="end" font-family="${MONO}" font-size="28" letter-spacing="5" fill="#00d4ff">${escapeXml(card.kicker)}</text></g>`);
  // veľké číslo: odpočítanie
  const countT = ease(clamp01((t - 0.9) / 1.4));
  let big = card.big;
  const magnitude = /^M (\d+,\d)$/.exec(card.big);
  if (magnitude) big = `M ${num1(Number(magnitude[1].replace(',', '.')) * countT)}`;
  else if (/^\d+$/.test(card.big)) big = String(Math.round(Number(card.big) * countT));
  const bigSize = String(card.big).length > 8 ? 110 : 170;
  parts.push(`<text x="70" y="${330 + bigSize * 0.8}" font-family="${FONT}" font-size="${bigSize}" font-weight="700" fill="#ff7a5c" opacity="${fade(t, 0.8, 0.5).toFixed(2)}">${escapeXml(big)}</text>`);
  const headline = wrap(card.headline, 24, 2);
  const headY = 395 + bigSize * 0.8;
  headline.forEach((line, i) => parts.push(`<text x="70" y="${headY + i * 64}" font-family="${FONT}" font-size="58" font-weight="600" fill="#e8f1f7" opacity="${fade(t, 2.2 + i * 0.15).toFixed(2)}">${escapeXml(line)}</text>`));
  // riadky pod mapou (bezpečná zóna)
  const lines = (card.lines || []).flatMap(line => wrap(line, 40, 2)).slice(0, 3);
  lines.forEach((line, i) => parts.push(`<text x="70" y="${MAP.y + MAP.h + 20 + i * 46}" font-family="${FONT}" font-size="36" fill="#cfe0ea" opacity="${fade(t, 3.2 + i * 0.25).toFixed(2)}">${escapeXml(line)}</text>`));
  const footY = MAP.y + MAP.h + 20 + lines.length * 46 + 26;
  parts.push(`<text x="70" y="${footY}" font-family="${FONT}" font-size="26" fill="#7f99aa" opacity="${fade(t, 4).toFixed(2)}">Zdroj: ${escapeXml(card.source)} · ${escapeXml(stamp(card.at))} · mapa: Natural Earth</text>`);
  // výzva na konci
  const cta = fade(t, seconds - 3.2, 0.7);
  parts.push(`<g opacity="${cta.toFixed(2)}"><rect x="70" y="${footY + 34}" width="${Math.min(940, 60 + site.length * 24 + 240)}" height="64" rx="32" fill="#00d4ff1f" stroke="#00d4ff88" stroke-width="2"/>
    <text x="100" y="${footY + 77}" font-family="${MONO}" font-size="30" fill="#bff2ff">Naživo na ${escapeXml(site)}</text></g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL.width}" height="${REEL.height}">
  <defs><linearGradient id="ft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2433"/><stop offset="1" stop-color="#0b2433" stop-opacity="0"/></linearGradient>
  <linearGradient id="fb" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#070d14"/><stop offset="1" stop-color="#070d14" stop-opacity="0"/></linearGradient></defs>
  ${parts.join('\n  ')}</svg>`;
}

// ── zvuk ───────────────────────────────────────────────────────────────────
/** Dĺžka WAV v sekundách z hlavičky (PCM). */
export function wavSeconds(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let offset = 12; let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4); const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') return byteRate ? Math.min(size, buffer.length - offset - 8) / byteRate : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

/** Krátky text na nahovorenie (titulok + prvá veta). */
export function narration(item) {
  const sentence = String(item.text || '').split('\n').map(s => s.trim()).filter(Boolean)[1] || '';
  return `${item.title}. ${sentence.split(/(?<=\.)\s/)[0] || ''}`.replace(/[#🌋📊🚀📡🌍]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function run(bin, args, { input = null, timeoutMs = 120_000 } = {}) {
  const child = spawn(bin, args, { stdio: [input === null ? 'ignore' : 'pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  if (input !== null) child.stdin.end(input);
  const [code] = await once(child, 'close').finally(() => clearTimeout(timer));
  if (code !== 0) throw new Error(`${path.basename(bin)} skončil s kódom ${code}: ${stderr.split('\n').filter(Boolean).slice(-2).join(' | ')}`);
}

/** Je ffmpeg dostupný? (cesta z FFMPEG_PATH alebo PATH) */
export async function ffmpegAvailable(bin = process.env.FFMPEG_PATH || 'ffmpeg') {
  try { await run(bin, ['-hide_banner', '-version'], { timeoutMs: 10_000 }); return true; } catch { return false; }
}

async function pickMusic(dir, seed) {
  if (!dir) return null;
  try {
    const files = (await readdir(dir)).filter(name => /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)).sort();
    if (!files.length) return null;
    let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return path.join(dir, files[h % files.length]);
  } catch { return null; }
}

/**
 * Vyrenderuje reel do `outFile`. Vracia { seconds, audio, voice }.
 * @param {object} item { card, title, text } z šablóny
 * @param {object} options { audio: 'ambient'|'music'|'none', voice: boolean, env, site, onProgress }
 */
export async function renderReel(item, outFile, { audio = 'ambient', voice = false, env = process.env, site = 'okolive.sk', onProgress = () => {},
  seconds: baseSeconds = REEL.seconds, fps = REEL.fps } = {}) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  const work = await mkdtemp(path.join(tmpdir(), 'oko-reel-'));
  try {
    // 1) hlas (voliteľný) určí dĺžku
    let voiceFile = null; let seconds = baseSeconds;
    if (voice && env.PIPER_PATH && env.PIPER_MODEL) {
      voiceFile = path.join(work, 'voice.wav');
      await run(env.PIPER_PATH, ['--model', env.PIPER_MODEL, '--output_file', voiceFile], { input: narration(item), timeoutMs: 60_000 });
      const length = wavSeconds(await readFile(voiceFile));
      seconds = Math.min(30, Math.max(baseSeconds, Math.ceil(length + 3)));
    }
    // 2) snímky → ffmpeg stdin (raw RGB)
    const frames = seconds * fps;
    const background = await sharp(Buffer.from(backgroundSvg())).png().toBuffer();
    const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      '-s', `${REEL.width}x${REEL.height}`, '-r', String(fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-g', String(fps * 2), '-flags', '+cgop', '-movflags', '+faststart', path.join(work, 'video.mp4')],
    { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let encoderError = '';
    encoder.stderr.on('data', chunk => { encoderError = (encoderError + chunk).slice(-4000); });
    const encoderDone = once(encoder, 'close');
    let staticMap = null; let lastMapKey = '';
    // Posun bez priblíženia (prehľad): mapa sa vyrenderuje raz ako panoráma a len sa oreže.
    let panorama = null;
    const first = reelView(item.card, 0); const last = reelView(item.card, seconds);
    if (!item.card.point && first.span === last.span) {
      const ppd = MAP.w / first.span;
      const west = Math.min(first.lon, last.lon) - first.span / 2;
      const spanAll = Math.abs(last.lon - first.lon) + first.span;
      const width = Math.ceil(spanAll * ppd) + 2;
      panorama = { west, ppd, width, image: await sharp(Buffer.from(mapLayerSvg({ lon: west + spanAll / 2, lat: first.lat, span: spanAll }, width, MAP.h))).png().toBuffer() };
    }
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const view = reelView(item.card, t);
      if (panorama) {
        const left = Math.max(0, Math.min(panorama.width - MAP.w, Math.round((view.lon - view.span / 2 - panorama.west) * panorama.ppd)));
        if (String(left) !== lastMapKey) {
          staticMap = await sharp(panorama.image).extract({ left, top: 0, width: MAP.w, height: MAP.h }).png({ compressionLevel: 1 }).toBuffer();
          lastMapKey = String(left);
        }
      } else {
        const key = `${view.lon.toFixed(3)}|${view.lat.toFixed(3)}|${view.span.toFixed(3)}`;
        if (key !== lastMapKey) { staticMap = await sharp(Buffer.from(mapLayerSvg(view))).png({ compressionLevel: 1 }).toBuffer(); lastMapKey = key; }
      }
      const frame = await sharp(background).composite([{ input: staticMap, left: MAP.x, top: MAP.y },
        { input: Buffer.from(overlaySvg(item.card, t, { seconds, site })), left: 0, top: 0 }]).removeAlpha().raw().toBuffer();
      if (!encoder.stdin.write(frame)) await once(encoder.stdin, 'drain');
      if (f % fps === 0) onProgress(f / frames);
    }
    encoder.stdin.end();
    const [code] = await encoderDone;
    if (code !== 0) throw new Error(`ffmpeg (video): ${encoderError.trim().split('\n').slice(-2).join(' | ')}`);
    // 3) zvuk
    const inputs = ['-i', path.join(work, 'video.mp4')];
    const filters = [];
    let mixInputs = 0;
    const fadeOut = Math.max(0, seconds - 2);
    if (audio === 'ambient' || (audio === 'music' && !(await pickMusic(env.STUDIO_MUSIC_DIR, item.title)))) {
      inputs.push('-f', 'lavfi', '-t', String(seconds), '-i', 'sine=frequency=110:sample_rate=48000',
        '-f', 'lavfi', '-t', String(seconds), '-i', 'sine=frequency=164.81:sample_rate=48000',
        '-f', 'lavfi', '-t', String(seconds), '-i', 'anoisesrc=color=brown:amplitude=0.6:sample_rate=48000');
      filters.push(`[1:a]volume=0.10,tremolo=f=0.15:d=0.5[a1]`, `[2:a]volume=0.06,tremolo=f=0.11:d=0.6[a2]`,
        `[3:a]lowpass=f=400,volume=0.05[a3]`, `[a1][a2][a3]amix=inputs=3:normalize=0,afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2[bed]`);
      mixInputs = 4;
    } else if (audio === 'music') {
      inputs.push('-stream_loop', '-1', '-i', await pickMusic(env.STUDIO_MUSIC_DIR, item.title));
      filters.push(`[1:a]atrim=0:${seconds},aresample=48000,volume=0.5,afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=2[bed]`);
      mixInputs = 2;
    }
    if (voiceFile) {
      inputs.push('-i', voiceFile);
      const v = mixInputs || 1;
      filters.push(`[${v}:a]aresample=48000,adelay=1200|1200,volume=1.4[voice]`);
      filters.push(mixInputs ? `[bed]volume=0.45[bedlow];[bedlow][voice]amix=inputs=2:normalize=0:duration=first[aout]` : `[voice]apad=whole_dur=${seconds}[aout]`);
    } else if (mixInputs) filters.push('[bed]anull[aout]');
    const out = path.join(work, 'final.mp4');
    if (filters.length) {
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'),
        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-shortest', '-movflags', '+faststart', out]);
    } else {
      // Bez zvuku: tichá stopa (niektoré platformy video bez zvuku odmietnu).
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(work, 'video.mp4'), '-f', 'lavfi', '-t', String(seconds),
        '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);
    }
    await writeFile(outFile, await readFile(out));
    onProgress(1);
    return { seconds, audio: filters.length ? (audio === 'music' && mixInputs === 2 ? 'music' : mixInputs ? 'ambient' : 'none') : 'none',
      voice: Boolean(voiceFile), bytes: (await stat(outFile)).size };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
