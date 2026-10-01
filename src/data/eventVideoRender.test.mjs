// src/data/eventVideoRender.test.mjs — video udalosti do MP4 (2026-10-01). Testy SPRÁVANIA: každý snímok
// plánu ide do ffmpeg ako JPEG, výsledok sa objaví až celý (dočasný súbor → premenovanie), chyba ffmpeg
// nezanechá polovičné video, chýbajúci ffmpeg je „nedostupné"; skutočné MP4 cez ffmpeg (ak je na
// počítači) má hlavičku pred dátami (+faststart — FB a telefón ho prehrajú hneď); videá na disku
// sa kreslia raz, naraz len jedno, a znova len pri zmene udalosti alebo kódu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { videoPlan } from './eventVideo.js';
import { VIDEO_CODE_FILES, createEventVideoCache, createEventVideoRenderer, ffmpegArgs, videoCodeVersion } from './eventVideoRender.js';

const LOCAL_DATA = new URL('./local_data', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FAST = { introS: 0.1, playS: 0.6, holdS: 0.1, gapS: 0.1, minSegmentS: 0.05, outroS: 0.2 };
const T0 = 1_790_000_000;
function uturnEvent(id = 'abc123-20260922T1320') {
  const lons = [30.0, 30.2, 30.4, 30.6, 30.8, 30.6, 30.4, 30.2];
  const track = lons.map((lon, i) => [T0 + i * 60, 30, lon, 30_000]);
  return {
    id, icao24: 'abc123', status: 'unverified', firstT: track[2][0], lastT: track[4][0], track,
    timeline: [
      { kind: 'dive', t: track[2][0], fpm: -12_000, alt: 9000, lat: 30, lon: 30.4, seenBy: ['opensky'] },
      { kind: 'uturn', t: track[4][0], turnDeg: -180, lat: 30, lon: 30.8, seenBy: ['opensky', 'adsblol'] },
    ],
  };
}

/** Falošný ffmpeg: zbiera, čo dostane na vstup; po konci vstupu zapíše výstup a skončí s `code`. */
function fakeSpawn({ code = 0, stderr = '', missing = false } = {}) {
  const runs = [];
  const spawnImpl = (cmd, args) => {
    const proc = new EventEmitter();
    const chunks = [];
    proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.stdin.write = (buf) => { chunks.push(Buffer.from(buf)); return true; };
    proc.stdin.end = () => {
      setImmediate(() => {
        if (missing) { proc.emit('error', Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' })); return; }
        if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
        if (code === 0) writeFileSync(args.at(-1), Buffer.from('fake mp4'));
        else writeFileSync(args.at(-1), Buffer.from('polovičné'));
        proc.emit('close', code);
      });
    };
    runs.push({ cmd, args, chunks });
    return proc;
  };
  return { spawnImpl, runs };
}

test('ffmpeg: JPEG zo vstupu → H.264 yuv420p s hlavičkou na začiatku (+faststart)', () => {
  const args = ffmpegArgs(30, 'out.mp4');
  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 8), ['-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', 'pipe:0']);
  for (const [k, v] of [['-c:v', 'libx264'], ['-pix_fmt', 'yuv420p'], ['-movflags', '+faststart']]) assert.equal(args[args.lastIndexOf(k) + 1], v);
  assert.equal(args.at(-1), 'out.mp4');
});

test('každý snímok plánu ide do ffmpeg ako JPEG (snímky sa líšia); výsledok až po úspechu, bez dočasného súboru', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-video-'));
  try {
    const { spawnImpl, runs } = fakeSpawn();
    const render = createEventVideoRenderer({ dataDir: LOCAL_DATA, ffmpegPath: 'ffmpeg-test', spawnImpl });
    const e = uturnEvent();
    const outFile = path.join(dir, 'v.mp4');
    const progress = [];
    const res = await render(e, { outFile, fps: 10, pacing: FAST, onProgress: (done, total) => progress.push([done, total]) });
    const plan = videoPlan(e, { ...FAST, fps: 10 });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].cmd, 'ffmpeg-test');
    assert.equal(runs[0].chunks.length, plan.totalFrames, 'jeden JPEG na snímok');
    for (const c of runs[0].chunks) assert.deepEqual([c[0], c[1], c.at(-2), c.at(-1)], [0xff, 0xd8, 0xff, 0xd9]);
    assert.notDeepEqual(runs[0].chunks[0], runs[0].chunks.at(-1), 'video sa hýbe');
    assert.deepEqual([res.frames, res.width, res.height], [plan.totalFrames, 1080, 1350]);
    assert.equal(readFileSync(outFile, 'utf8'), 'fake mp4');
    assert.deepEqual(readdirSync(dir), ['v.mp4'], 'dočasný súbor premenovaný');
    assert.deepEqual(progress.at(-1), [plan.totalFrames, plan.totalFrames]);
    await assert.rejects(render({ ...e, track: [] }, { outFile, fps: 10 }), (err) => err.code === 'NO_TRACK');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chyba ffmpeg nezanechá polovičné video; chýbajúci ffmpeg = FFMPEG_MISSING', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-video-'));
  try {
    const outFile = path.join(dir, 'v.mp4');
    const bad = createEventVideoRenderer({ dataDir: LOCAL_DATA, spawnImpl: fakeSpawn({ code: 1, stderr: 'Invalid data found' }).spawnImpl });
    await assert.rejects(bad(uturnEvent(), { outFile, fps: 10, pacing: FAST }), /Invalid data found/);
    assert.deepEqual(readdirSync(dir), [], 'ani výsledok, ani dočasný súbor');
    const none = createEventVideoRenderer({ dataDir: LOCAL_DATA, spawnImpl: fakeSpawn({ missing: true }).spawnImpl });
    await assert.rejects(none(uturnEvent(), { outFile, fps: 10, pacing: FAST }), (err) => err.code === 'FFMPEG_MISSING');
    // Skutočné spustenie programu, ktorý neexistuje (služba bez ffmpeg v PATH): kreslenie sa hneď zastaví.
    const realSharp = (await import('sharp')).default;
    let composites = 0;
    const countingSharp = (input) => {
      const s = realSharp(input);
      const composite = s.composite.bind(s);
      s.composite = (...a) => { composites += 1; return composite(...a); };
      return s;
    };
    const real = createEventVideoRenderer({ dataDir: LOCAL_DATA, ffmpegPath: path.join(dir, 'ziadny-ffmpeg.exe'), sharpLoader: async () => countingSharp });
    await assert.rejects(real(uturnEvent(), { outFile, fps: 10, pacing: FAST }), (err) => err.code === 'FFMPEG_MISSING');
    assert.ok(videoPlan(uturnEvent(), { ...FAST, fps: 10 }).totalFrames > 10);
    assert.ok(composites <= 2, `bez ffmpeg sa nekreslí celé video (${composites} snímok)`);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** ffmpeg na tomto počítači: FFMPEG_PATH, chocolatey alebo PATH. */
function findFfmpeg() {
  for (const cand of [process.env.FFMPEG_PATH, 'C:/ProgramData/chocolatey/bin/ffmpeg.exe', 'ffmpeg'].filter(Boolean)) {
    try {
      if (spawnSync(cand, ['-version'], { windowsHide: true, timeout: 10_000 }).status === 0) return cand;
    } catch { /* ďalší kandidát */ }
  }
  return null;
}
const FFMPEG = findFfmpeg();

test('skutočné MP4 cez ffmpeg: H.264, hlavička (moov) pred dátami (mdat) — prehrá sa hneď', { skip: FFMPEG ? false : 'ffmpeg na tomto počítači nie je' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-video-'));
  try {
    const render = createEventVideoRenderer({ dataDir: LOCAL_DATA, ffmpegPath: FFMPEG });
    const outFile = path.join(dir, 'v.mp4');
    await render(uturnEvent(), { outFile, fps: 10, pacing: FAST });
    const mp4 = readFileSync(outFile);
    assert.equal(mp4.subarray(4, 8).toString('latin1'), 'ftyp');
    const moov = mp4.indexOf('moov');
    const mdat = mp4.indexOf('mdat');
    assert.ok(moov > 0 && mdat > 0 && moov < mdat, `moov ${moov} pred mdat ${mdat}`);
    assert.ok(mp4.includes('avc1'), 'H.264');
    assert.deepEqual(readdirSync(dir), ['v.mp4']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('videá na disku: raz na udalosť a verziu kódu, súbežné žiadosti čakajú na to isté, naraz sa kreslí len jedno; zmena = nové, staré preč', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-video-cache-'));
  try {
    let active = 0;
    let maxActive = 0;
    const drawn = [];
    let fail = false;
    const render = async (event, { outFile }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      if (fail) { fail = false; throw new Error('ffmpeg spadol'); }
      drawn.push(event.id);
      writeFileSync(outFile, `video ${event.id} ${drawn.length}`);
    };
    const cache = createEventVideoCache({ dir, render, codeVersion: 'v1' });
    const a = uturnEvent('aaaaaa-20260922T1320');
    const b = uturnEvent('bbbbbb-20260922T1320');
    const [r1, r2, r3] = await Promise.all([cache.get(a), cache.get(a), cache.get(b)]);
    assert.deepEqual(drawn, [a.id, b.id], 'to isté video raz');
    assert.equal(maxActive, 1, 'naraz len jedno');
    assert.equal(r1.file, r2.file);
    assert.notEqual(r1.file, r3.file);
    const again = await cache.get(a);
    assert.deepEqual([again.file, again.cached, drawn.length], [r1.file, true, 2], 'druhý raz z disku');
    // Zmena udalosti (napr. pribudli médiá) → nové video, staré tej istej udalosti zmazané.
    const changed = { ...a, news: { status: 'verified', trusted: [] } };
    const r4 = await cache.get(changed);
    assert.notEqual(r4.file, r1.file);
    assert.ok(!existsSync(r1.file) && existsSync(r4.file) && existsSync(r3.file), 'iná udalosť ostáva');
    // Nová verzia kódu (iný vzhľad) → nové video aj pri tej istej udalosti.
    const cache2 = createEventVideoCache({ dir, render, codeVersion: 'v2' });
    assert.notEqual((await cache2.get(changed)).file, r4.file);
    // Zlyhanie sa nepamätá — ďalšia žiadosť kreslí znova.
    fail = true;
    const c = uturnEvent('cccccc-20260922T1320');
    await assert.rejects(cache.get(c), /ffmpeg spadol/);
    assert.equal((await cache.get(c)).cached, false);
    assert.equal(readdirSync(dir).filter((n) => n.startsWith('cccccc-')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verzia kódu videa: odtlačok zdrojových súborov — zmena ktoréhokoľvek = iná verzia', () => {
  const files = Object.fromEntries(VIDEO_CODE_FILES.map((n) => [n, `// ${n}`]));
  const read = (file) => {
    const name = path.basename(file);
    if (!(name in files)) throw new Error('ENOENT');
    return Buffer.from(files[name]);
  };
  const v1 = videoCodeVersion('/src/data', read);
  assert.equal(videoCodeVersion('/src/data', read), v1, 'stabilná');
  files['eventCard.js'] += ' zmena kreslenia';
  assert.notEqual(videoCodeVersion('/src/data', read), v1);
  assert.match(videoCodeVersion(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), /^[0-9a-f]{12}$/, 'skutočné súbory');
});
