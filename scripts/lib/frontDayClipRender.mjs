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
/** Video na šírku užšie ako toto ide vo v2 na celú šírku nad rozmazaným pozadím, nie orezom na 9:16. */
export const FIT_BELOW_W = 960;
/** Malé video na šírku → na celú šírku nad rozmazaným pozadím (inak orez na 9:16). Pure. */
export const fitWide = (probe) => probe?.width > probe?.height && probe.width < FIT_BELOW_W;
/** Úvod videí ArmyInform býva titulková karta / logo — okno začína najskôr tu (s). */
export const CLIP_SKIP_START_S = 2.5;

const runCapture = (cmd, args, timeoutMs = 5 * 60_000, maxErr = 200_000) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err = (err + d).slice(-maxErr); });
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
 * hovoriaca hlava (2026-10-05). Strih v okne pridá len trochu.
 * Videá ArmyInform idú od prípravy (ruky na ovládači, štart) k zásahu pred koncom, potom grafika a logo
 * (2026-10-06: vyhrali ruky na ovládači v 7. s, zásah bol v 40.–47. s) → statický koniec sa odreže a
 * neskoršie okno má prednosť (váha 0,5 na začiatku → 1,5 na konci obsahu). Bez úvodu (`skip`). Pure.
 * @param {Array<[number, number]>} frames [čas s, rozdiel snímky 0–1] (ffmpeg scene_score)
 * @param {number} total dĺžka videa (s)
 */
export function bestWindow(frames, total, dur, { skip = CLIP_SKIP_START_S, step = 0.25 } = {}) {
  const contentEnd = contentEndOf(frames, total);
  const last = Math.max(0, Math.min(total - dur - 1, contentEnd - dur));
  const first = Math.min(skip, last);
  let best = { start: first, score: -Infinity };
  for (let s = first; s <= last + 1e-9; s += step) {
    const w = frames.filter(([t]) => t >= s && t < s + dur);
    const mean = w.length ? w.reduce((a, f) => a + actionScore(f), 0) / w.length : 0;
    const pos = Math.min(1, (s + dur / 2) / Math.max(1, contentEnd));
    const score = mean * (0.5 + pos);
    if (score > best.score + 1e-12) best = { start: s, score };
  }
  return { start: Math.round(best.start * 100) / 100, dur: Math.min(dur, Math.max(0.5, total - best.start)) };
}

/** Strop pohybu snímky: trasúca sa ručná kamera (ruky, operátori) inak prebije plynulý záber z dronu. */
export const MOTION_CAP = 0.05;
/**
 * „Akčnosť" snímky [čas, pohyb, sýtosť?, jas?] (2026-10-06, merané na záberoch ArmyInform): pohyb so stropom;
 * strih = len trochu; farebné snímky (ruky na ovládači, ľudia, grafika značky — sýtosť nad 7) menej, termovízia
 * a záber z dronu sú takmer bez farby; tmavé (čierna, šum po zásahu, záverečná karta) skoro nič. Pure.
 */
export function actionScore([, v, sat, y]) {
  const motion = v > CUT_SCORE ? 0.02 : Math.min(v, MOTION_CAP);
  const color = !Number.isFinite(sat) || sat <= 7 ? 1 : sat <= 12 ? 0.55 : 0.25;
  const light = !Number.isFinite(y) || y >= 40 ? 1 : 0.15;
  return motion * color * light;
}

/** Pohyb pod týmto prahom = statický obraz (logo, titulková karta na konci). */
export const STILL_SCORE = 0.02;
/**
 * Koniec obsahu: po poslednej snímke s pohybom (statické logo / záverečná karta sa nepočíta). Bez pohybu
 * v celom videu = celá dĺžka. Pure.
 */
export function contentEndOf(frames, total) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const [t, v] = frames[i];
    if (v > STILL_SCORE && v <= CUT_SCORE) return Math.min(total, t + 0.2);
  }
  return total;
}

/**
 * Úseky akčného záberu: od 2,8 s dva najdynamickejšie neprekrývajúce sa úseky (polovica dĺžky každý, aspoň 1 s
 * od seba), zoradené v čase; kratší záber = jeden úsek. Pure.
 * @returns {Array<{start: number, dur: number}>}
 */
export function clipCuts(frames, total, dur, { minSplitS = 2.8 } = {}) {
  if (dur < minSplitS) { const w = bestWindow(frames, total, dur); return [{ start: w.start, dur: w.dur }]; }
  const half = dur / 2;
  const a = bestWindow(frames, total, half);
  const rest = frames.map(([t, ...v]) => (t > a.start - half - 1 && t < a.start + half + 1 ? [t, 0, ...v.slice(1)] : [t, ...v]));
  const b = bestWindow(rest, total, half);
  const far = Math.abs(b.start - a.start) >= half + 1;
  if (!far) return [{ start: a.start, dur }].map((p) => ({ ...p, dur: Math.min(dur, Math.max(0.5, total - p.start)) }));
  return [a, b].sort((x, y) => x.start - y.start).map((p) => ({ start: p.start, dur: half }));
}

/** Záber na výšku (rozhovor, sociálny formát) do akčného okna na šírku nepatrí — vypadne. Pure. */
export const clipUsable = ({ width, height }) => Number(width) > 0 && Number(height) > 0 && width >= height;

/**
 * Výpis ffmpeg `metadata=print` → snímky [čas, pohyb, sýtosť, jas]. Pure.
 * @param {string} log stderr ffmpeg
 */
export function parseFrameStats(log) {
  const frames = []; let cur = null;
  for (const line of String(log).split('\n')) {
    const t = /pts_time:(\d+(?:\.\d+)?)/.exec(line);
    // Každý filter metadata=print píše vlastnú hlavičku snímky — tá istá snímka = ten istý čas.
    if (t) { if (!cur || cur[0] !== Number(t[1])) { cur = [Number(t[1]), 0, NaN, NaN]; frames.push(cur); } continue; }
    const m = /lavfi\.(scene_score|signalstats\.SATAVG|signalstats\.YAVG)=(\d+(?:\.\d+)?)/.exec(line);
    if (!m || !cur) continue;
    cur[m[1] === 'scene_score' ? 1 : m[1].endsWith('SATAVG') ? 2 : 3] = Number(m[2]);
  }
  return frames;
}

/** Dĺžka, rozmer a po snímkach pohyb, sýtosť a jas (5 snímok/s, ffmpeg scene_score + signalstats). */
export async function probeClip(file, { ffmpeg = 'ffmpeg', fps = 5 } = {}) {
  const print = (key) => `metadata=print:key=lavfi.${key}`;
  const r = await runCapture(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf',
    `fps=${fps},scale=320:-2,signalstats,select='gte(scene,0)',${print('scene_score')},${print('signalstats.SATAVG')},${print('signalstats.YAVG')}`,
    '-f', 'null', '-'], 10 * 60_000, 20_000_000);
  const total = (() => { const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.err); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0; })();
  const size = /Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(r.err);
  return { total, width: size ? Number(size[1]) : 0, height: size ? Number(size[2]) : 0, frames: parseFrameStats(r.err) };
}

/**
 * Snímka záberu do videa: `dur` s z najdynamickejšieho okna, 1080×1920, 30 fps, bez zvuku.
 * @returns {Promise<{file: string, start: number, dur: number, cuts: number}>}
 */
export async function renderClipSegment({ src, out, dur, clip, day, ffmpeg = 'ffmpeg', fps = 30, probe = null, layout = 'box' }) {
  const sharp = require('sharp');
  const { total, frames } = probe || await probeClip(src, { ffmpeg });
  if (!total) throw Object.assign(new Error('záber: nedá sa zistiť dĺžka videa'), { code: 'CLIP_PROBE' });
  // Fotka s priblížením zo scenára: vlastné video presne na dĺžku záberu, od začiatku.
  const win = Number.isFinite(clip?.fixedStart) ? { start: clip.fixedStart, dur } : bestWindow(frames, total, dur);
  const cuts = frames.filter(([, v]) => v > CUT_SCORE);
  if (layout === 'full') {
    // v2 (2026-10-10): záber na celú obrazovku (stred, orez na 9:16) s pomalým priblížením, bez rámu — popis a zdroj
    // pridá grafická vrstva. Okienko 1080×640 nad rozmazaným pozadím pôsobilo slabo aj pri výbuchu. Dlhší záber
    // = dva najdynamickejšie úseky za sebou s ostrým strihom (Reels: strih každé ~1,5 s).
    const { w: W, h: H } = FRONT_DAY_FORMAT;
    const parts = Number.isFinite(clip?.fixedStart) ? [{ start: win.start, dur }] : clipCuts(frames, total, dur);
    // Malé video na šírku (záchranári ДСНС z Telegramu, 640×352): orez na 9:16 by ho zväčšil ~5× → na celú
    // šírku nad vlastnou rozmazanou kópiou, ako fotky (photoMontageVideo).
    const fit = fitWide(probe);
    const chain = (k, d) => {
      const n = Math.max(1, Math.round(d * fps));
      if (fit) {
        return `[${k}:v]fps=${fps},split=2[a${k}][b${k}];[a${k}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=30,eq=brightness=-0.28[bg${k}];`
          + `[b${k}]scale=w='trunc(${W}*(1+0.07*n/${n})/2)*2':h=-2:eval=frame,eq=contrast=1.06:saturation=1.1[fg${k}];`
          + `[bg${k}][fg${k}]overlay=x=(W-w)/2:y=(H-h)/2-60,setsar=1,format=yuv420p[p${k}]`;
      }
      return `[${k}:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`
        + `scale=w='trunc(${W}*(1+0.08*n/${n})/2)*2':h=-2:eval=frame,crop=${W}:${H},eq=contrast=1.06:saturation=1.1,setsar=1,format=yuv420p[p${k}]`;
    };
    const inputs = parts.flatMap((p) => ['-ss', String(p.start), '-t', String(p.dur), '-i', src]);
    const filter = `${parts.map((p, k) => chain(k, p.dur)).join(';')};${parts.map((_, k) => `[p${k}]`).join('')}concat=n=${parts.length}:v=1:a=0[v]`;
    const r = await runCapture(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
      '-filter_complex', filter, '-map', '[v]', '-an', '-t', String(dur), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', out], 10 * 60_000);
    if (r.code !== 0 || !fs.existsSync(out)) throw Object.assign(new Error(`záber: ffmpeg ${r.err.trim().slice(-300)}`), { code: 'CLIP_RENDER' });
    return { file: out, start: parts[0].start, dur, cuts: cuts.length, parts };
  }
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

/** Bod [lon, lat] → pixel fotky s ohraničením bbox [w, s, e, n] (lineárne, malé územie). Pure. */
export function photoPixel(bbox, lon, lat, width, height) {
  const [w, s, e, n] = bbox;
  return { x: ((lon - w) / (e - w)) * width, y: ((n - lat) / (n - s)) * height };
}

/**
 * Fotka (napr. satelit Copernicus) → video s pomalým priblížením k bodu (Ken Burns), so značkami.
 * @param {{image: string, bbox: number[], focus: {lon, lat}, zoom?: number, marks?: Array<{lon, lat, label, color?}>}} photo
 */
export async function photoZoomVideo(photo, { out, dur, ffmpeg = 'ffmpeg', fps = 30 }) {
  const sharp = require('sharp');
  const meta = await sharp(photo.image).metadata();
  const W = meta.width; const H = meta.height;
  // Výrez v pomere okna záberu (CLIP_BOX), stred na bode priblíženia.
  const ratio = CLIP_BOX.w / CLIP_BOX.h;
  const cw = Math.min(W, Math.round(H * ratio)); const ch = Math.round(cw / ratio);
  // Bod priblíženia: súradnice (fotka zo satelitu s bbox) alebo podiel šírky a výšky (obyčajná fotka, {x: 0.5, y: 0.4}).
  const focus = photo.focus || { x: 0.5, y: 0.5 };
  const f = Number.isFinite(focus.lon) && photo.bbox ? photoPixel(photo.bbox, focus.lon, focus.lat, W, H) : { x: (focus.x ?? 0.5) * W, y: (focus.y ?? 0.5) * H };
  const cx = Math.round(Math.min(W - cw, Math.max(0, f.x - cw / 2))); const cy = Math.round(Math.min(H - ch, Math.max(0, f.y - ch / 2)));
  const marks = (photo.bbox ? photo.marks || [] : []).map((m) => ({ ...m, ...photoPixel(photo.bbox, m.lon, m.lat, W, H) }));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const k = W / 2500; // veľkosť značiek podľa rozlíšenia
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${marks.map((m) => {
    const c = m.color || '#ff7a1a';
    return `<circle cx="${m.x}" cy="${m.y}" r="${34 * k}" fill="none" stroke="${c}" stroke-width="${5 * k}"/><circle cx="${m.x}" cy="${m.y}" r="${9 * k}" fill="${c}" stroke="#fff" stroke-width="${3 * k}"/>`
      + (m.label ? `<rect x="${m.x + 48 * k}" y="${m.y - 26 * k}" width="${(String(m.label).length * 19 + 34) * k}" height="${52 * k}" rx="${10 * k}" fill="rgba(5,14,22,0.88)" stroke="${c}" stroke-width="${3 * k}"/>`
        + `<text x="${m.x + 64 * k}" y="${m.y + 11 * k}" font-family="Inter, Arial, sans-serif" font-weight="700" font-size="${32 * k}" fill="#fff">${esc(m.label)}</text>` : '');
  }).join('')}</svg>`;
  const still = `${out}.still.png`;
  // Najprv značky na celú fotku, potom výrez (sharp by inak orezal pred kreslením).
  const marked = await sharp(photo.image).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  await sharp(marked).extract({ left: cx, top: cy, width: cw, height: ch }).png().toFile(still);
  // Priblíženie k bodu: zoompan nad zväčšeným obrazom (menej trasenia pri zaokrúhľovaní).
  const N = Math.max(2, Math.round(dur * fps)); const Z = photo.zoom || 2.2;
  const fx = (f.x - cx) / cw; const fy = (f.y - cy) / ch;
  const vf = `scale=${CLIP_BOX.w * 4}:-2,zoompan=z='1+(${Z}-1)*on/${N}':x='max(0,min(iw-iw/zoom,${fx.toFixed(4)}*iw-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${fy.toFixed(4)}*ih-ih/zoom/2))':d=${N}:s=${CLIP_BOX.w}x${CLIP_BOX.h}:fps=${fps},format=yuv420p`;
  const r = await runCapture(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', still, '-vf', vf, '-frames:v', String(N), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out], 10 * 60_000);
  try { fs.rmSync(still, { force: true }); } catch { /* */ }
  if (r.code !== 0 || !fs.existsSync(out)) throw Object.assign(new Error(`fotka: ffmpeg ${r.err.trim().slice(-300)}`), { code: 'PHOTO_RENDER' });
  return out;
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

/** Strop fotky z CDN náhľadu Telegramu. */
export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;

/** Stiahne fotku z povoleného zdroja (len obrázok, strop veľkosti). */
export async function downloadImage(url, file, { fetchImpl = globalThis.fetch, maxBytes = IMAGE_MAX_BYTES } = {}) {
  if (!mediaHostAllowed(url)) throw Object.assign(new Error(`nepovolený zdroj fotky: ${url}`), { code: 'IMAGE_HOST' });
  const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw Object.assign(new Error(`fotka: HTTP ${res.status}`), { code: 'IMAGE_HTTP' });
  const type = res.headers.get('content-type') || '';
  if (!/^image\/(jpeg|png|webp)/.test(type)) throw Object.assign(new Error(`fotka: nie je obrázok (${type || 'bez typu'})`), { code: 'IMAGE_TYPE' });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw Object.assign(new Error('fotka: príliš veľká'), { code: 'IMAGE_SIZE' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

/**
 * Fotky (napr. záchranári ДСНС, ~800 px) → video 9:16: každá fotka na celú šírku nad svojou rozmazanou kópiou
 * s pomalým priblížením, rovnaký diel času, ostrý strih. Orez malej fotky na celú výšku by ju zväčšil ~3× (rozmazané).
 * @param {{images: string[], out: string, dur: number}} p
 */
export async function photoMontageVideo({ images, out, dur, ffmpeg = 'ffmpeg', fps = 30 }) {
  if (!images?.length) throw Object.assign(new Error('fotky: žiadna fotka'), { code: 'PHOTO_NONE' });
  const { w: W, h: H } = FRONT_DAY_FORMAT;
  const d = dur / images.length; const n = Math.max(2, Math.round(d * fps));
  const inputs = images.flatMap((img) => ['-loop', '1', '-framerate', String(fps), '-t', d.toFixed(3), '-i', img]);
  const chains = images.map((_, k) => `[${k}:v]split=2[a${k}][b${k}];`
    + `[a${k}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=30,eq=brightness=-0.28[bg${k}];`
    + `[b${k}]scale=w='trunc(${W}*(1+0.07*n/${n})/2)*2':h=-2:eval=frame[fg${k}];`
    + `[bg${k}][fg${k}]overlay=x=(W-w)/2:y=(H-h)/2-60,setsar=1,format=yuv420p[p${k}]`);
  const filter = `${chains.join(';')};${images.map((_, k) => `[p${k}]`).join('')}concat=n=${images.length}:v=1:a=0[v]`;
  const r = await runCapture(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-an',
    '-t', String(dur), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out], 10 * 60_000);
  if (r.code !== 0 || !fs.existsSync(out)) throw Object.assign(new Error(`fotky: ffmpeg ${r.err.trim().slice(-300)}`), { code: 'PHOTO_RENDER' });
  return out;
}
