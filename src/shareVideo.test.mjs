// src/shareVideo.test.mjs — krátke živé video do náhľadu odkazu (2026-10-07): výber formátu záznamu,
// skladanie snímku (shareFrame.js), nahrávanie s falošným plátnom a MediaRecorderom, odoslanie na server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_STRIP_HEIGHT_PX, collectShareSources, drawShareFrame } from './shareFrame.js';
import {
  SHARE_VIDEO_DURATION_MS, SHARE_VIDEO_MIME_CANDIDATES, canRecordShareVideo, pickRecorderMimeType, recordShareVideo, uploadShareVideo,
} from './shareVideo.js';

function makeCtx() {
  const calls = [];
  const ctx = { fillStyle: '', font: '', textAlign: '', textBaseline: '' };
  for (const name of ['fillRect', 'drawImage', 'fillText']) ctx[name] = (...args) => calls.push([name, ...args]);
  return { ctx, calls };
}

test('shareFrame: plátna výrezom cover, rám nad pásom, pás s pečiatkou a atribúciou; prázdne plátno sa preskočí', () => {
  const { ctx, calls } = makeCtx();
  const cesium = { width: 1920, height: 1080 };
  const overlay = { width: 1920, height: 1080 };
  const decorated = [];
  drawShareFrame(ctx, { sources: [cesium, { width: 0, height: 0 }, overlay], width: 1200, height: 630, stamp: 'OKO · 7. 10. 2026', attribution: '© Google · Cesium ion', decorate: (c, w, h) => decorated.push([w, h]) });
  const draws = calls.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 2, 'dve plátna s rozmermi, prázdne nie');
  assert.equal(draws[0][1], cesium);
  assert.deepEqual(draws[0].slice(6), [0, 0, 1200, 630], 'cieľ je celý snímok');
  assert.deepEqual(decorated, [[1200, 630 - SHARE_STRIP_HEIGHT_PX]], 'rám dostane výšku nad pásom');
  const texts = calls.filter((c) => c[0] === 'fillText');
  assert.deepEqual(texts.map((c) => c[1]), ['OKO · 7. 10. 2026', '© Google · Cesium ion']);
  assert.equal(texts[1][2], 1200 - 16, 'atribúcia vpravo');
  const rects = calls.filter((c) => c[0] === 'fillRect');
  assert.deepEqual(rects.at(-1).slice(1), [0, 630 - SHARE_STRIP_HEIGHT_PX, 1200, SHARE_STRIP_HEIGHT_PX], 'pás dole');
});

test('collectShareSources: plátno Cesia a prekryvy, bez vieweru len prekryvy', () => {
  const overlays = [{ width: 10, height: 10 }];
  const doc = { querySelectorAll: (sel) => (sel === '#world-overlay-root canvas' ? overlays : []) };
  const canvas = { width: 1, height: 1 };
  assert.deepEqual(collectShareSources({ viewer: { canvas }, document: doc }), [canvas, overlays[0]]);
  assert.deepEqual(collectShareSources({ viewer: { scene: { canvas } }, document: doc }), [canvas, overlays[0]]);
  assert.deepEqual(collectShareSources({ viewer: null, document: doc }), [overlays[0]]);
  assert.deepEqual(collectShareSources({ viewer: null, document: {} }), []);
});

test('pickRecorderMimeType: prvý podporovaný v poradí MP4 → WebM; bez podpory null; chybná otázka sa preskočí', () => {
  assert.equal(pickRecorderMimeType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9');
  assert.equal(pickRecorderMimeType((t) => t === 'video/mp4'), 'video/mp4');
  assert.equal(pickRecorderMimeType(() => false), null);
  assert.equal(pickRecorderMimeType(null), null);
  assert.equal(pickRecorderMimeType((t) => { if (t.includes('mp4')) throw new Error('x'); return t === 'video/webm'; }), 'video/webm');
  assert.equal(SHARE_VIDEO_MIME_CANDIDATES[0], 'video/mp4;codecs=avc1.42E01E', 'Safari dá H.264 rovno, bez prevodu');
});

function makeRecorderWorld({ supported = ['video/webm;codecs=vp9'], manualFrames = true, failStart = false, emitData = true } = {}) {
  const world = { frames: 0, recorders: [], tracksStopped: 0, canvases: [] };
  class FakeRecorder {
    static isTypeSupported(type) { return supported.includes(type); }
    constructor(stream, options) {
      this.stream = stream; this.options = options; this.mimeType = options?.mimeType || ''; this.listeners = {}; this.state = 'inactive';
      world.recorders.push(this);
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    emit(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
    start() { if (failStart) throw new Error('start failed'); this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      setTimeout(() => { if (emitData) this.emit('dataavailable', { data: { size: 4096 } }); this.emit('stop'); }, 0);
    }
  }
  class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options?.type || ''; this.size = parts.reduce((sum, part) => sum + (part.size || 0), 0); } }
  const makeCanvas = () => {
    const { ctx } = makeCtx();
    const track = manualFrames ? { requestFrame: () => { world.frames += 1; }, stop: () => { world.tracksStopped += 1; } } : { stop: () => { world.tracksStopped += 1; } };
    const canvas = {
      width: 0, height: 0, getContext: () => ctx,
      captureStream: (fps) => { canvas.captureFps = fps; return { getVideoTracks: () => [track], getTracks: () => [track] }; },
    };
    world.canvases.push(canvas);
    return canvas;
  };
  const doc = { createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}), querySelectorAll: () => [] };
  let clock = 0;
  const win = { MediaRecorder: FakeRecorder, Blob: FakeBlob, performance: { now: () => clock } };
  const raf = (cb) => setTimeout(() => { clock += 40; cb(); }, 0); // 25 fps „čas"
  return { world, doc, win, raf, now: () => clock, FakeRecorder };
}

test('canRecordShareVideo: MediaRecorder + captureStream + podporovaný formát; inak false', () => {
  const ok = makeRecorderWorld();
  assert.equal(canRecordShareVideo({ window: ok.win, document: ok.doc }), true);
  const noFormat = makeRecorderWorld({ supported: [] });
  assert.equal(canRecordShareVideo({ window: noFormat.win, document: noFormat.doc }), false);
  assert.equal(canRecordShareVideo({ window: {}, document: ok.doc }), false, 'bez MediaRecorder');
  assert.equal(canRecordShareVideo({ window: ok.win, document: { createElement: () => ({}) } }), false, 'bez captureStream');
});

test('recordShareVideo: snímky po ~40 ms cez requestFrame s novým vykreslením scény, 6 s, stop → blob s typom a rozmermi', async () => {
  const { world, doc, win, raf, now } = makeRecorderWorld();
  let renders = 0;
  const viewer = { canvas: { width: 1920, height: 1080 }, scene: { requestRender: () => { renders += 1; } } };
  const progress = [];
  const clip = await recordShareVideo({ viewer, document: doc, window: win, raf, now, stamp: 'OKO · test', attribution: '© test', durationMs: 1000, fps: 25, onProgress: (p) => progress.push(p) });
  assert.ok(clip, 'nahrávka vznikla');
  assert.equal(clip.type, 'video/webm');
  assert.equal(clip.width, 1200);
  assert.equal(clip.height, 630);
  assert.ok(clip.durationMs >= 1000 && clip.durationMs < 1200, `dĺžka ≈ 1 s (${clip.durationMs})`);
  assert.ok(clip.frames >= 20 && clip.frames <= 27, `~25 snímok za sekundu (${clip.frames})`);
  assert.equal(world.frames, clip.frames, 'každý snímok si vyžiadal requestFrame');
  assert.equal(renders, clip.frames - 1, 'každý snímok okrem prvého si vyžiadal nové vykreslenie scény (governor nečinnosti)');
  assert.equal(world.canvases[0].captureFps, 0, 'captureStream(0) = snímky riadime sami');
  assert.deepEqual(world.recorders[0].options, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2_500_000 });
  assert.equal(world.tracksStopped, 1, 'prúd po nahrávaní zastavený');
  assert.ok(progress.length > 0 && progress.at(-1).elapsedMs < 1000);
  assert.equal(clip.blob.size, 4096);
  assert.equal(SHARE_VIDEO_DURATION_MS, 6000);
});

test('recordShareVideo: bez requestFrame tečie prúd s fps; bez dát alebo bez plátien null; zlyhanie štartu null', async () => {
  const fpsWorld = makeRecorderWorld({ manualFrames: false });
  const viewer = { canvas: { width: 100, height: 50 }, scene: {} };
  const clip = await recordShareVideo({ viewer, document: fpsWorld.doc, window: fpsWorld.win, raf: fpsWorld.raf, now: fpsWorld.now, durationMs: 200, fps: 25 });
  assert.ok(clip);
  assert.equal(fpsWorld.world.canvases[0].captureFps, 25, 'záloha: captureStream(fps)');

  const noData = makeRecorderWorld({ emitData: false });
  assert.equal(await recordShareVideo({ viewer, document: noData.doc, window: noData.win, raf: noData.raf, now: noData.now, durationMs: 100 }), null);
  const noStart = makeRecorderWorld({ failStart: true });
  assert.equal(await recordShareVideo({ viewer, document: noStart.doc, window: noStart.win, raf: noStart.raf, now: noStart.now, durationMs: 100 }), null);
  const ok = makeRecorderWorld();
  assert.equal(await recordShareVideo({ viewer: null, document: ok.doc, window: ok.win, raf: ok.raf, now: ok.now, durationMs: 100 }), null, 'bez plátien');
  assert.equal(await recordShareVideo({ viewer, document: ok.doc, window: {}, raf: ok.raf, now: ok.now }), null, 'bez MediaRecorder');
});

test('uploadShareVideo: POST /api/share/<id>/video?w&h&ms s telom a typom; odpoveď {video} → url; chyby null', async () => {
  const calls = [];
  const blob = { size: 5000, type: 'video/webm' };
  const fetchImpl = async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ id: 'Ab12cd34EF', video: 'https://okolive.sk/s/Ab12cd34EF.mp4', width: 1200, height: 630, durationMs: 6010 }) }; };
  const result = await uploadShareVideo({ id: 'Ab12cd34EF', blob, type: 'video/webm', width: 1200, height: 630, durationMs: 6010, fetchImpl });
  assert.deepEqual(result, { url: 'https://okolive.sk/s/Ab12cd34EF.mp4', width: 1200, height: 630, durationMs: 6010 });
  assert.equal(calls[0][0], '/api/share/Ab12cd34EF/video?w=1200&h=630&ms=6010');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].body, blob);
  assert.deepEqual(calls[0][1].headers, { 'Content-Type': 'video/webm' });
  assert.equal(await uploadShareVideo({ id: 'A', blob, fetchImpl: async () => ({ ok: false, status: 409 }) }), null, 'odmietnuté = null');
  assert.equal(await uploadShareVideo({ id: 'A', blob, fetchImpl: async () => { throw new Error('net'); } }), null);
  assert.equal(await uploadShareVideo({ id: '', blob, fetchImpl }), null, 'bez id sa neposiela');
  assert.equal(await uploadShareVideo({ id: 'A', blob: null, fetchImpl }), null, 'bez nahrávky sa neposiela');
});
