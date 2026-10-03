import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REEL, narration, overlaySvg, reelView, renderReel, wavSeconds } from './reel.js';
import { createStudio } from './index.js';
import { createMetaPublisher } from './meta.js';
import { openAdminStore } from '../store.js';

const NOW = Date.UTC(2026, 9, 3, 12, 0);
const quakeCard = { kind: 'quake', kicker: 'ZEMETRASENIE', big: 'M 6,3', headline: 'Grécko', lines: ['70 km JZ od Atén'], point: { lat: 37.6, lon: 23.1 }, source: 'USGS', at: NOW };
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('reel: priblíženie k udalosti, posun pri prehľade', () => {
  const start = reelView(quakeCard, 0); const end = reelView(quakeCard, 6);
  assert.ok(Math.abs(start.span - 150) < 1e-9);
  assert.ok(Math.abs(end.span - 26) < 1e-9);
  assert.equal(end.lon, 23.1);
  const digest = { ...quakeCard, point: undefined, points: [] };
  assert.ok(reelView(digest, 10).lon > reelView(digest, 0).lon);
  assert.equal(reelView(digest, 10).span, reelView(digest, 0).span);
});

test('reel: odpočítanie čísla, escapovanie, výzva až na konci', () => {
  assert.match(overlaySvg(quakeCard, 0.95), />M 0,[0-9]</);
  assert.match(overlaySvg(quakeCard, 5), />M 6,3</);
  assert.match(overlaySvg({ ...quakeCard, big: '42' }, 5), />42</);
  const evil = overlaySvg({ ...quakeCard, headline: '<script>x</script>' }, 5);
  assert.ok(!evil.includes('<script>'));
  assert.match(overlaySvg(quakeCard, 11), /<g opacity="1\.00"><rect[^>]*\/>\s*<text[^>]*>Naživo na okolive\.sk/);
  assert.match(overlaySvg(quakeCard, 2), /<g opacity="0\.00"><rect/);
});

test('WAV dĺžka a text na nahovorenie', () => {
  const wav = Buffer.alloc(44 + 48000);
  wav.write('RIFF', 0); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
  wav.writeUInt32LE(24000, 28); wav.write('data', 36); wav.writeUInt32LE(48000, 40);
  assert.equal(wavSeconds(wav), 2);
  assert.equal(wavSeconds(Buffer.from('nope')), 0);
  assert.equal(narration({ title: 'Zemetrasenie M 6,3 – Grécko', text: '🌋 Zemetrasenie\n\nDnes o 14:00 zaznamenali otras. Ďalšia veta.\n#OKO' }),
    'Zemetrasenie M 6,3 – Grécko. Dnes o 14:00 zaznamenali otras.');
});

test('render MP4 (ffmpeg): H.264 1080×1920, AAC 48 kHz, faststart; bez zvuku tichá stopa', { skip: !hasFfmpeg && 'ffmpeg nie je nainštalovaný' }, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-reel-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.mp4');
  const result = await renderReel({ card: quakeCard, title: 'T', text: 't' }, file, { seconds: 2, fps: 10 });
  assert.equal(result.audio, 'ambient');
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).stdout);
  const video = probe.streams.find(s => s.codec_type === 'video'); const audio = probe.streams.find(s => s.codec_type === 'audio');
  assert.deepEqual([video.codec_name, video.width, video.height, video.pix_fmt], ['h264', 1080, 1920, 'yuv420p']);
  assert.deepEqual([audio.codec_name, audio.sample_rate, audio.channels], ['aac', '48000', 2]);
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.15);
  const head = readFileSync(file).subarray(0, 4096).toString('latin1');
  assert.ok(head.indexOf('moov') > 0 && head.indexOf('moov') < head.indexOf('mdat') || !head.includes('mdat'), 'moov pred mdat (faststart)');
  const silent = path.join(dir, 'b.mp4');
  assert.equal((await renderReel({ card: { ...quakeCard, point: undefined, points: [{ lat: 1, lon: 2, size: 5 }] }, title: 'T', text: 't' }, silent, { seconds: 1, fps: 5, audio: 'none' })).audio, 'none');
  assert.ok(JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', silent]).stdout).streams.some(s => s.codec_type === 'audio'));
});

test('hlas cez Piper predĺži video podľa dĺžky reči', { skip: (!hasFfmpeg || process.platform === 'win32') && 'ffmpeg/sh nie je k dispozícii' }, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-piper-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const piper = path.join(dir, 'piper');
  // Falošný Piper: zahodí text zo stdin a zapíše 4 s WAV na --output_file.
  writeFileSync(piper, '#!/bin/sh\ncat > /dev/null\nwhile [ "$1" != "--output_file" ]; do shift; done\nffmpeg -v error -y -f lavfi -i sine=frequency=300:sample_rate=22050 -t 4 "$2"\n');
  chmodSync(piper, 0o755);
  const result = await renderReel({ card: quakeCard, title: 'T', text: 'x\n\nVeta.' }, path.join(dir, 'v.mp4'),
    { seconds: 2, fps: 4, voice: true, env: { ...process.env, PIPER_PATH: piper, PIPER_MODEL: 'sk.onnx' } });
  assert.deepEqual([result.voice, result.seconds], [true, 7]);
});

function fakeStore(t) { const store = openAdminStore(':memory:'); t.after(() => store.close()); return store; }

test('Štúdio: video vo fronte po vytvorení, náhľad s Range, podpísané MP4 len pre schválený návrh', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-studio-video-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { time: NOW };
  const renders = [];
  const studio = createStudio({ store: fakeStore(t), env: {}, port: () => 1, now: () => clock.time, timers: false, mediaDir: dir, log: () => {},
    fetchJson: async () => ({ status: 200, headers: {}, body: { records: [{ id: 'q', sourceId: 'q', mag: 6.4, time: NOW - 60e3, lat: 37.6, lon: 23.1 }], fetchedAt: NOW } }),
    renderCard: async () => Buffer.from('jpg'), checkFfmpeg: async () => true,
    renderReel: async (item, file, options) => { renders.push([item.title, options.audio]); writeFileSync(file, Buffer.alloc(1000, 7)); return { seconds: 12 }; },
    publisher: { status: () => ({ facebook: false, instagram: false }) } });
  const { draft } = await studio.generate('quake');
  assert.equal(draft.videoStatus, 'queued');
  await studio.videosIdle();
  assert.deepEqual(renders, [['Zemetrasenie M 6,4 – Grécko', 'ambient']]);
  assert.equal(studio.get(draft.id).videoStatus, 'ready');
  assert.ok(existsSync(path.join(dir, `${draft.id}.mp4`)));
  const server = http.createServer((req, res) => { void studio.handleMedia(req, res, () => { res.statusCode = 418; res.end(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const local = url => `http://127.0.0.1:${server.address().port}${new URL(url).pathname}${new URL(url).search}`;
  const signed = studio.mediaUrl(draft.id, 3600e3, 'mp4');
  assert.equal((await fetch(local(signed))).status, 404, 'návrh ešte nie je schválený');
  studio.setStatus(draft.id, 'approved');
  const full = await fetch(local(signed));
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal((await full.arrayBuffer()).byteLength, 1000);
  const part = await fetch(local(signed), { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(local(signed), { headers: { Range: 'bytes=5000-' } })).status, 416);
  assert.equal((await fetch(local(signed.replace('.mp4', '.jpg')))).status, 404, 'podpis je viazaný na typ súboru');
  // Upratovanie: osirelý súbor zmizne.
  writeFileSync(path.join(dir, '00000000-0000-0000-0000-000000000000.mp4'), 'x');
  await studio.tick();
  assert.ok(!existsSync(path.join(dir, '00000000-0000-0000-0000-000000000000.mp4')));
  assert.ok(existsSync(path.join(dir, `${draft.id}.mp4`)));
});

test('Štúdio: chýbajúci ffmpeg = video zlyhá so srozumiteľnou chybou; reel nejde zverejniť bez videa', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-studio-noff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const studio = createStudio({ store: fakeStore(t), env: {}, port: () => 1, now: () => NOW, timers: false, mediaDir: dir, log: () => {},
    fetchJson: async () => ({ status: 200, headers: {}, body: { records: [{ id: 'q', sourceId: 'q', mag: 6.4, time: NOW - 60e3, lat: 37.6, lon: 23.1 }], fetchedAt: NOW } }),
    renderCard: async () => Buffer.from('jpg'), checkFfmpeg: async () => false,
    publisher: { status: () => ({ facebook: true, instagram: true }) } });
  const { draft } = await studio.generate('quake');
  await studio.videosIdle();
  assert.equal(studio.get(draft.id).videoStatus, 'failed');
  assert.match(studio.get(draft.id).videoError, /ffmpeg nie je nainštalovaný/);
  await assert.rejects(studio.publish(draft.id, ['facebook-reel']), /video_not_ready/);
});

test('Štúdio: reel na FB aj IG na pozadí; fotka a reel sa dajú zverejniť postupne', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-studio-pub-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const publisher = {
    status: () => ({ facebook: true, instagram: true }),
    facebookPhoto: async () => { calls.push('facebook'); return { id: 'p1', url: 'u1' }; },
    facebookReel: async ({ video }) => { calls.push(['facebook-reel', video.length]); return { id: 'r1', url: 'https://www.facebook.com/reel/r1' }; },
    instagramReel: async ({ videoUrl }) => { calls.push(['instagram-reel', new URL(videoUrl).pathname]); return { id: 'i1', url: 'u3' }; },
  };
  const studio = createStudio({ store: fakeStore(t), env: { AUTH_ORIGINS: 'https://okolive.sk' }, port: () => 1, now: () => NOW, timers: false, mediaDir: dir, log: () => {},
    fetchJson: async () => ({ status: 200, headers: {}, body: { records: [{ id: 'q', sourceId: 'q', mag: 6.4, time: NOW - 60e3, lat: 37.6, lon: 23.1 }], fetchedAt: NOW } }),
    renderCard: async () => Buffer.from('jpg'), checkFfmpeg: async () => true, publisher,
    renderReel: async (item, file) => { writeFileSync(file, Buffer.alloc(2048)); return {}; } });
  const { draft } = await studio.generate('quake');
  await studio.videosIdle();
  const photo = await (await studio.publish(draft.id, ['facebook'])).done;
  assert.equal(photo.draft.status, 'published');
  const reels = await (await studio.publish(draft.id, ['facebook', 'facebook-reel', 'instagram-reel'])).done;
  assert.equal(reels.draft.status, 'published');
  assert.deepEqual(calls, ['facebook', ['facebook-reel', 2048], ['instagram-reel', `/api/studio/media/${draft.id}.mp4`]]);
  assert.equal(reels.draft.results['facebook-reel'].url, 'https://www.facebook.com/reel/r1');
});

test('Meta: FB reel (start → rupload → finish) a IG reel s čakaním na spracovanie', async () => {
  const requests = [];
  const env = { META_PAGE_ID: '111111', META_PAGE_TOKEN: 'T'.repeat(40), META_IG_USER_ID: '222222' };
  let polls = 0;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    requests.push({ host: u.host, path: u.pathname, body: init.body, headers: init.headers || {} });
    const params = init.body instanceof URLSearchParams ? init.body : new URLSearchParams();
    if (u.pathname.endsWith('/video_reels') && params.get('upload_phase') === 'start') return Response.json({ video_id: 'v9', upload_url: 'https://rupload.facebook.com/video-upload/v23.0/v9' });
    if (u.host === 'rupload.facebook.com') return Response.json({ success: true });
    if (u.pathname.endsWith('/video_reels') && params.get('upload_phase') === 'finish') return Response.json({ success: true });
    if (u.pathname.endsWith('/media')) return Response.json({ id: 'c1' });
    if (u.pathname.endsWith('/c1')) return Response.json({ status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' });
    if (u.pathname.endsWith('/media_publish')) return Response.json({ id: 'm1' });
    if (u.pathname.endsWith('/m1')) return Response.json({ permalink: 'https://www.instagram.com/reel/abc/' });
    return Response.json({ error: { message: 'x' } }, { status: 400 });
  };
  const meta = createMetaPublisher({ env, fetchImpl });
  const fb = await meta.facebookReel({ video: Buffer.alloc(10), text: 'Popis' });
  assert.deepEqual(fb, { id: 'v9', url: 'https://www.facebook.com/reel/v9' });
  const upload = requests.find(r => r.host === 'rupload.facebook.com');
  assert.equal(upload.headers.Authorization, `OAuth ${env.META_PAGE_TOKEN}`);
  assert.equal(upload.headers.file_size, '10');
  const finish = requests.filter(r => r.path.endsWith('/video_reels'))[1];
  assert.equal(finish.body.get('video_state'), 'PUBLISHED');
  assert.equal(finish.body.get('description'), 'Popis');
  const waits = [];
  const ig = await meta.instagramReel({ videoUrl: 'https://okolive.sk/api/studio/media/x.mp4?exp=1&sig=s', text: 'IG', wait: async ms => { waits.push(ms); } });
  assert.deepEqual(ig, { id: 'm1', url: 'https://www.instagram.com/reel/abc/' });
  assert.equal(waits.length, 2);
  const container = requests.find(r => r.path.endsWith('/media')).body;
  assert.deepEqual([container.get('media_type'), container.get('share_to_feed')], ['REELS', 'true']);
  const bad = createMetaPublisher({ env, fetchImpl: async () => Response.json({ video_id: 'v1', upload_url: 'https://evil.example/upload' }) });
  await assert.rejects(bad.facebookReel({ video: Buffer.alloc(1), text: 't' }), /Neočakávaná adresa/);
});
