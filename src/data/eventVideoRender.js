// src/data/eventVideoRender.js — video udalosti do MP4 na serveri (2026-10-01, vlastník: „sprav ale tak,
// aby sme rovnaký vzorec použili aj v budúcnosti"). Plán snímok z eventVideo.js, každý snímok kreslí
// buildEventCardSvg (ten istý kód ako obrázok udalosti): mapový podklad (more, hranice) sa vykreslí raz,
// na každý snímok sa naň položí meniaca sa vrstva (stopa, lietadlo, momenty, hodiny, zoznam). JPEG
// snímky idú rúrou do ffmpeg (H.264, yuv420p, +faststart — prehrá FB aj telefón). Bez prehliadača a GPU.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { CARD_FORMATS, buildEventCardSvg } from './eventCard.js';
import { basemapLoader, sharpOnce } from './eventCardRender.js';
import { videoPlan } from './eventVideo.js';

export const VIDEO_FORMAT = 'feed';
export const VIDEO_JPEG_QUALITY = 90;
/** Moduly, ktoré určujú, ako video vyzerá (kreslenie, tempo, texty) — ich zmena = nové video. */
export const VIDEO_CODE_FILES = Object.freeze(['eventCard.js', 'eventVideo.js', 'eventVideoRender.js', 'eventPost.js', 'eventTimeline.js']);

/** Verzia kódu videa: odtlačok zdrojových súborov VIDEO_CODE_FILES v adresári `codeDir`. */
export function videoCodeVersion(codeDir, readFile = (file) => fs.readFileSync(file)) {
  const hash = createHash('sha1');
  for (const name of VIDEO_CODE_FILES) {
    hash.update(name);
    try { hash.update(readFile(path.join(codeDir, name))); } catch { hash.update('?'); }
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * Argumenty ffmpeg: JPEG snímky zo stdin → MP4 H.264 pre siete. 3D video zo satelitných záberov má
 * veľa detailov — crf 26 dá pri FZ1073 22 MB namiesto 48 MB pri crf 21 a na pohľad sa nelíši. Pure.
 * @param {number} fps
 * @param {string} outFile
 * @param {{crf?: number, preset?: string}} [opts]
 */
export function ffmpegArgs(fps, outFile, { crf = 21, preset = 'veryfast' } = {}) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outFile,
  ];
}
/** Kompresia 3D videa v štýle OKO (scripts/capture-event-video.mjs). */
export const VIDEO_3D_ENCODE = Object.freeze({ crf: 26, preset: 'medium' });

/**
 * @param {{dataDir: string, ffmpegPath?: string, sharpLoader?: () => Promise<any>, spawnImpl?: typeof spawn,
 *   readFile?: (file: string) => string}} opts
 * @returns {(event: object, opts: {outFile: string, fps?: number, pacing?: object, onProgress?: (done: number, total: number) => void}) =>
 *   Promise<{outFile: string, frames: number, durationS: number, width: number, height: number}>}
 *   `pacing` = VIDEO_DEFAULTS na prepísanie (napr. kratšie video)
 */
export function createEventVideoRenderer({
  dataDir,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  sharpLoader,
  spawnImpl = spawn,
  readFile,
} = {}) {
  const loadBasemap = basemapLoader({ dataDir, readFile });
  const getSharp = sharpOnce(sharpLoader);
  return async function renderVideo(event, { outFile, fps = 30, pacing = {}, onProgress = null } = {}) {
    const plan = videoPlan(event, { ...pacing, fps });
    if (!plan) throw Object.assign(new Error('event has no track in its window'), { code: 'NO_TRACK' });
    const sharp = await getSharp();
    const { w, h } = CARD_FORMATS[VIDEO_FORMAT];
    const { marine, borders } = loadBasemap();
    const base = await sharp(Buffer.from(buildEventCardSvg(event, { format: VIDEO_FORMAT, marine, borders, layers: 'base' }))).png().toBuffer();
    const tmp = `${outFile}.part.mp4`;
    const ff = spawnImpl(ffmpegPath, ffmpegArgs(fps, tmp), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    ff.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    // Skončený (alebo nespustený) ffmpeg zastaví kreslenie — snímky by sa kreslili zbytočne.
    let ended = null;
    const exited = new Promise((resolve) => {
      ff.on('error', (error) => resolve({ code: -1, error }));
      ff.on('close', (code) => resolve({ code }));
    }).then((r) => { ended = r; return r; });
    let failed = null;
    ff.stdin.on('error', (error) => { failed = failed || error; });
    let written = 0;
    try {
      for (let i = 0; i < plan.totalFrames && !failed && !ended; i += 1) {
        const overlay = buildEventCardSvg(event, { format: VIDEO_FORMAT, layers: 'overlay', frame: plan.at(i) });
        const jpg = await sharp(base).composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).jpeg({ quality: VIDEO_JPEG_QUALITY }).toBuffer();
        if (ended) break;
        // Chyba rúry (ffmpeg skončil alebo chýba) sa zachytí cez `failed` a `exited` — čakanie nezlyhá samo.
        if (!ff.stdin.write(jpg)) await Promise.race([once(ff.stdin, 'drain').catch(() => {}), exited]);
        written += 1;
        if (onProgress && (i % 30 === 0 || i === plan.totalFrames - 1)) onProgress(i + 1, plan.totalFrames);
      }
    } finally {
      ff.stdin.end();
    }
    const result = await exited;
    if (failed || result.code !== 0 || written < plan.totalFrames) {
      try { fs.unlinkSync(tmp); } catch { /* nič nevzniklo */ }
      // ffmpeg na tomto počítači chýba (spawn ENOENT) — služba to povie ako „video nedostupné".
      const missing = result.error?.code === 'ENOENT';
      throw Object.assign(new Error(`ffmpeg failed (${result.error?.message || result.code}): ${(failed?.message || stderr).trim().slice(-500)}`), missing ? { code: 'FFMPEG_MISSING' } : {});
    }
    fs.renameSync(tmp, outFile);
    return { outFile, frames: plan.totalFrames, durationS: plan.durationS, width: w, height: h };
  };
}

/**
 * Kľúč nahratého 3D videa: len údaje, ktoré video ukazuje (stopa, momenty, let, trasa, siete, overenie
 * a médiá) — nie časy kontrol správ ani stav zverejnenia. Zmena týchto údajov = video treba nahrať
 * znova. Pure.
 */
export function videoEventKey(event) {
  const e = event || {};
  const pick = {
    id: e.id, callsign: e.callsign ?? null, reg: e.reg ?? null, typeCode: e.typeCode ?? null, firstT: e.firstT, lastT: e.lastT,
    status: e.status, track: e.track || [], timeline: e.timeline || [], route: e.route || null, coverage: e.coverage || [],
    news: { status: e.news?.status ?? null, type: e.news?.type ?? null, trusted: (e.news?.trusted || []).map((t) => t?.domain || null) },
    // Doplnené zo správ (pristátie, pokles v diere) — video ich ukazuje, iné fakty = iné video. Bez faktov
    // sa kľúč nemení (videá starších udalostí ostávajú platné).
    ...(e.reported?.length ? { reported: e.reported.map((f) => ({ kind: f?.kind, t: f?.t, fromT: f?.fromT ?? null, airport: f?.airport?.icao ?? null, toFt: f?.toFt ?? null, domains: f?.domains || [] })) } : {}),
  };
  return createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 16);
}

/** Je to MP4 (ISO BMFF s hlavičkou `ftyp` a obsahom `moov`)? Pure. */
export function isMp4(buf) {
  return Buffer.isBuffer(buf) && buf.length > 64 && buf.subarray(4, 8).toString('latin1') === 'ftyp' && buf.includes('moov');
}

/** Strop nahratého videa (FZ1073: 818 snímok 1080×1350 ≈ 25 MB). */
export const VIDEO_UPLOAD_MAX_BYTES = 80 * 1024 * 1024;

/**
 * Nahraté 3D videá udalostí (scripts/capture-event-video.mjs) v `<dir>/<id>-<kľúč>.mp4`: jedno na
 * udalosť, platí len pre tie isté údaje (videoEventKey); staršie video tej istej udalosti sa pri
 * novom zmaže.
 * @param {{dir: string}} opts
 */
export function createEventVideoStore({ dir }) {
  const fileOf = (event) => path.join(dir, `${event.id}-${videoEventKey(event)}.mp4`);
  return {
    /** Video presne pre tieto údaje udalosti, inak null. */
    find(event) {
      const file = fileOf(event);
      return fs.existsSync(file) ? { file } : null;
    },
    /** Uloží video (zápis cez dočasný súbor); vracia { file, bytes } alebo vyhodí BAD_VIDEO. */
    save(event, buf) {
      if (!isMp4(buf)) throw Object.assign(new Error('not an mp4 video'), { code: 'BAD_VIDEO' });
      fs.mkdirSync(dir, { recursive: true });
      const file = fileOf(event);
      const tmp = `${file}.part`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`${event.id}-`) && path.join(dir, name) !== file) {
          try { fs.unlinkSync(path.join(dir, name)); } catch { /* ďalší pokus pri ďalšom nahratí */ }
        }
      }
      return { file, bytes: buf.length };
    },
  };
}

/**
 * Videá udalostí na disku: jedno na udalosť, kľúč = obsah udalosti + verzia kódu videa (zmena udalosti
 * alebo kódu = nové video, staršie tej istej udalosti sa zmažú). Naraz sa kreslí len jedno video (je
 * to ~30 s procesora); súbežné žiadosti o to isté video čakajú na ten istý výsledok.
 * @param {{dir: string, render: (event: object, opts: {outFile: string}) => Promise<any>, codeVersion: string}} opts
 * @returns {{get: (event: object) => Promise<{file: string, cached: boolean}>, keyOf: (event: object) => string}}
 */
export function createEventVideoCache({ dir, render, codeVersion }) {
  const jobs = new Map();
  let chain = Promise.resolve();
  const keyOf = (event) => createHash('sha1').update(String(codeVersion)).update(JSON.stringify(event)).digest('hex').slice(0, 16);
  const cleanup = (id, keep) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (!name.startsWith(`${id}-`) || !name.endsWith('.mp4') || path.join(dir, name) === keep) continue;
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* ďalší pokus pri ďalšom videu */ }
    }
  };
  return {
    keyOf,
    async get(event) {
      const file = path.join(dir, `${event.id}-${keyOf(event)}.mp4`);
      if (fs.existsSync(file)) return { file, cached: true };
      if (jobs.has(file)) return jobs.get(file);
      const job = chain.catch(() => {}).then(async () => {
        if (fs.existsSync(file)) return { file, cached: true };
        fs.mkdirSync(dir, { recursive: true });
        await render(event, { outFile: file });
        cleanup(event.id, file);
        return { file, cached: false };
      });
      chain = job;
      jobs.set(file, job);
      try {
        return await job;
      } finally {
        jobs.delete(file);
      }
    },
  };
}
