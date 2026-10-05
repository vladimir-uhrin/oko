import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOOK_END, HOOK_SHEET, PAD, REEL, captionChunks, captionsFor, hookBadge, keepNumbersTogether, narration, overlaySvg, padOverlaySvg, probeSeconds,
  reelFocus, reelHook, reelView, renderReel, silentCaptionText, wavSeconds } from './reel.js';
import { createStudio } from './index.js';
import { createMetaPublisher, isRetryableError } from './meta.js';
import { openAdminStore } from '../store.js';

const NOW = Date.UTC(2026, 9, 3, 12, 0);
const quakeCard = { kind: 'quake', kicker: 'ZEMETRASENIE', big: 'M 6,3', headline: 'Grécko', lines: ['70 km JZ od Atén'], point: { lat: 37.6, lon: 23.1 }, source: 'USGS', at: NOW };
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('reel: úder na miesto udalosti, potom okolie; posun pri prehľade', () => {
  const start = reelView(quakeCard, 0); const end = reelView(quakeCard, 6);
  assert.ok(Math.abs(start.span - 10) < 1e-9, 'háčik: zblízka od prvej snímky');
  assert.ok(Math.abs(end.span - 26) < 1e-9, 'potom okolie so štátmi');
  assert.deepEqual([start.lon, end.lon], [23.1, 23.1]);
  const digest = { ...quakeCard, point: undefined, points: [] };
  assert.ok(reelView(digest, 10).lon > reelView(digest, 0).lon);
  assert.equal(reelView(digest, 10).span, reelView(digest, 0).span);
});

// Ukrajinské karty (2026-10-04) nesú výrez `view`, plochy a body s polomerom — reel predtým ukazoval 12 s mapu sveta.
const frontCard = { kind: 'ua-front', kicker: 'FRONT · ZMENA ZA DEŇ', big: '8,3 km²', headline: 'obsadil ruský agresor za deň', lines: [],
  view: { west: 27.2, east: 42, south: 44.9, north: 50.7 },
  polygons: [{ rings: [[[36, 47], [38, 47], [38, 48], [36, 48]]], fill: '#ff5a3c', opacity: 0.28 }],
  points: [{ lat: 47.6, lon: 36.3, r: 12, color: '#ff5a3c', label: '+8,3 km²' }, { lat: 48.5, lon: 37.6, r: 12, color: '#ffd23c', label: '−1 km²' }],
  source: 'mapa frontu okolive.sk', at: NOW };

test('reel s výrezom: úder na miesto zmeny, potom celý výrez s plochami a bodmi', () => {
  const start = reelView(frontCard, 0); const end = reelView(frontCard, 6);
  assert.ok(end.span > start.span * 2, 'začína priblížený na mieste zmeny');
  assert.deepEqual([start.lon, start.lat], [36.3, 47.6], 'stred = bod háčika (prvý bod s popisom)');
  // Na konci sa celý výrez zmestí do okna mapy (1080 × 800) a stred je stred výrezu.
  const spanLat = end.span * 800 / 1080;
  assert.ok(end.lon - end.span / 2 <= 27.2 && end.lon + end.span / 2 >= 42, `dĺžka ${end.lon} ± ${end.span / 2}`);
  assert.ok(end.lat - spanLat / 2 <= 44.9 && end.lat + spanLat / 2 >= 50.7, `šírka ${end.lat} ± ${spanLat / 2}`);
  assert.ok(end.span < 25, 'nie mapa sveta');
  const early = overlaySvg(frontCard, 1);
  assert.ok(early.includes('+8,3 km²'), 'bod háčika je tam od začiatku');
  assert.ok(!early.includes('−1 km²'), 'ostatné body až pri odhalení');
  const done = overlaySvg(frontCard, 7);
  assert.match(done, /<path d="M[^"]+Z" fill="#ff5a3c" fill-opacity="0\.28"/, 'okupované územie');
  assert.ok(done.includes('+8,3 km²') && done.includes('−1 km²'), 'popisy bodov');
  assert.match(done, /fill="#ffd23c"/, 'farba bodu z karty');
  // Zemetrasenie a prehľad sa nezmenili.
  assert.ok(Math.abs(reelView(quakeCard, 6).span - 26) < 1e-9);
});

// Háčik (vlastník 2026-10-04: „prvé 3 sekundy musia upútať, väčšina má vypnutý zvuk").
test('háčik: prvá snímka má celú vetu s číslom farebne, žiadne odpočítavanie od nuly', () => {
  const card = { ...frontCard, hook: { text: 'RUSKÝ AGRESOR OBSADIL 8,3 km² ZA DEŇ', accent: '8,3 km²' } };
  const first = overlaySvg(card, 0);
  for (const word of ['RUSKÝ', 'AGRESOR', 'OBSADIL', 'ZA', 'DEŇ']) assert.ok(first.includes(`>${word}<`), word);
  assert.match(first, /<tspan fill="#ff7a5c">8,3 km²<\/tspan>/, 'číslo s jednotkou farebne, pokope');
  assert.match(first, /MAPA FRONTU OKOLIVE\.SK/, 'zdroj a čas hneď hore');
  assert.ok(!/font-size="170"/.test(first), 'veľké číslo hlavičky až po háčiku');
  const after = overlaySvg(card, HOOK_END + 0.5);
  assert.ok(!after.includes('>RUSKÝ<'), 'háčik zmizne');
  assert.match(after, /font-size="170"[^>]*>8,3 km²</, 'potom číslo v hlavičke, celé');
  // Bez vety háčika v karte: číslo + nadpis, číslo nikdy od nuly.
  assert.deepEqual(reelHook({ big: '204', headline: 'bojových stretov za deň' }), { text: '204 bojových stretov za deň', accent: '204' });
  for (const t of [0, 0.3, 0.95, 1.5]) assert.match(overlaySvg({ ...quakeCard, big: '204' }, t), /<tspan fill="#ff7a5c">204<\/tspan>/, `t=${t}`);
});

test('háčik: prechod za sebou, horný riadok sa zmestí, prehľad ukáže celok hneď', () => {
  const card = { ...frontCard, hook: { text: 'RUSKÝ AGRESOR OBSADIL 8,3 km² ZA DEŇ', accent: '8,3 km²' } };
  // Nikdy dva texty cez seba: kým háčik mizne, hlavička ešte nie je.
  for (const t of [HOOK_END, HOOK_END + 0.05, HOOK_END + 0.1, HOOK_END + 0.14]) {
    assert.ok(!/font-size="170"[^>]*opacity="(?!0\.00)/.test(overlaySvg(card, t)), `t=${t}: hlavička ešte nie`);
  }
  assert.ok(!overlaySvg(card, HOOK_END + 0.2).includes('>RUSKÝ<'), 'háčik už preč, keď nastupuje hlavička');
  const badge = hookBadge({ at: NOW, source: 'Generálny štáb Ukrajiny · ArmyInform' });
  assert.ok(badge.length <= 44 && badge.includes('GENERÁLNY ŠTÁB UKRAJINY') && !badge.includes('ARMYINFORM'), badge);
  // Hlásenie GŠ (focus: false) a prehľady: celok s bodmi hneď na prvej snímke.
  const report = { ...frontCard, focus: false, polygons: [], points: [{ lat: 48.3, lon: 37.2, r: 30, label: '31' }, { lat: 48.6, lon: 37.8, r: 20, label: '16' }] };
  assert.equal(reelFocus(report), null);
  const first = overlaySvg(report, 0);
  assert.ok(first.includes('>31<') && first.includes('>16<'), 'všetky smery od prvej snímky');
  assert.ok(reelView(report, 0).span > reelView(report, 6).span, 'jemný nájazd, nie úder');
  const many = { ...quakeCard, point: undefined, points: Array.from({ length: 12 }, (_, i) => ({ lat: 40 + i, lon: 20 + i, size: 5 })) };
  assert.equal((overlaySvg(many, 0).match(/<circle[^>]*fill="#ff5a3c"/g) || []).length >= 12, true, 'všetky body na prvej snímke');
  assert.equal(silentCaptionText({ title: 'Nadpis', text: '⚔️ Nadpis\nPrvá veta. Druhá veta.' }), 'Prvá veta.');
});

test('reel: číslo celé, escapovanie, výzva až na konci', () => {
  assert.match(overlaySvg(quakeCard, 0.95), /<tspan fill="#ff7a5c">M<\/tspan> <tspan fill="#ff7a5c">6,3<\/tspan>/);
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

test('import z Udalostí: návrh s obrázkom a videom, reel vznikne doplnením 4:5 → 9:16, pôvodné video ostáva', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-studio-import-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'event.mp4');
  writeFileSync(src, Buffer.alloc(3000, 2));
  const pads = [];
  const studio = createStudio({ store: fakeStore(t), env: {}, port: () => 1, now: () => NOW, timers: false, mediaDir: dir, log: () => {},
    renderCard: async () => Buffer.from('card'), checkFfmpeg: async () => true,
    renderReel: async () => { throw new Error('nemá sa renderovať'); },
    padToReel: async (input, output) => { pads.push([path.basename(input), path.basename(output)]); writeFileSync(output, Buffer.alloc(100)); return {}; },
    publisher: { status: () => ({ facebook: false, instagram: false }) } });
  const first = await studio.importDraft({ template: 'event', eventKey: 'event:abc', title: 'Núdzová situácia FZ1073', text: 'Text príspevku', image: Buffer.from('jpg'), videoFile: src });
  assert.equal(first.created, true);
  assert.equal(first.draft.card.kind, 'import');
  assert.equal(first.draft.videoStatus, 'queued');
  await studio.videosIdle();
  assert.deepEqual(pads, [[`${first.draft.id}.src.mp4`, `${first.draft.id}.mp4`]]);
  assert.equal(studio.get(first.draft.id).videoStatus, 'ready');
  assert.ok(existsSync(studio.sourceVideoPath(first.draft.id)));
  assert.equal((await studio.importDraft({ template: 'event', eventKey: 'event:abc', title: 'x', text: 'y' })).reason, 'exists');
  await assert.rejects(studio.importDraft({ template: 'event', eventKey: 'event:z', title: ' ', text: 'y' }), /draft_incomplete/);
  // Bez obrázka: poster z videa; bez videa: karta.
  const second = await studio.importDraft({ template: 'front-week', eventKey: 'fw:1', title: 'Týždeň', text: 'T', image: null, videoFile: null });
  assert.equal(Buffer.from(studio.image(second.draft.id)).toString(), 'card');
});

test('padToReel (ffmpeg): z 4:5 videa vznikne 1080×1920 so zvukom', { skip: !hasFfmpeg && 'ffmpeg nie je nainštalovaný' }, async t => {
  const { padToReel, posterFrame } = await import('./reel.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-pad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'in.mp4');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=540x676:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  assert.equal(made.status, 0, String(made.stderr));
  const out = path.join(dir, 'out.mp4');
  await padToReel(src, out);
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', out]).stdout);
  const video = probe.streams.find(s => s.codec_type === 'video');
  assert.deepEqual([video.width, video.height, video.codec_name], [1080, 1920, 'h264']);
  assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
  const poster = await posterFrame(src, { at: 0.2 });
  assert.equal(poster[0], 0xff);
});

test('padToReel s card.vertical (ffmpeg): hotové 9:16 sa neprerába, len pás háčika', { skip: !hasFfmpeg && 'ffmpeg nie je nainštalovaný' }, async t => {
  const { padToReel } = await import('./reel.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-vert-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'in.mp4');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=540x960:rate=10', '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
  assert.equal(made.status, 0, String(made.stderr));
  const out = path.join(dir, 'out.mp4'); const sheet = path.join(dir, 'hook.jpg');
  const result = await padToReel(src, out, { card: { vertical: true, hook: { text: 'DEŇ NA FRONTE', accent: '' } }, hookSheet: sheet });
  assert.deepEqual(readFileSync(out), readFileSync(src), 'rovnaké video, bez nového kódovania');
  assert.ok(result.seconds > 1 && result.seconds < 2);
  assert.ok(statSync(sheet).size > 0, 'pás háčika pre admin');
});

// Rám importovaného videa (2026-10-04, háčik): video v bezpečnej zóne, háčik → titulok nad ním, zdroj pod ním.
test('rám importu: háčik 0–2,8 s, potom titulok, zdroj a výzva; texty mimo prekrytia Instagramu', () => {
  const card = { kicker: 'LETECKÁ UDALOSŤ', hook: { text: 'NÚDZOVÝ KÓD 7700: LET FZ1073', accent: 'FZ1073' }, headline: 'Let FZ1073 · Fly Dubai · Dubai → Tel Aviv',
    source: 'OpenSky Network, adsb.lol', at: NOW };
  const hook = padOverlaySvg(card, 'hook');
  assert.ok(hook.includes('>NÚDZOVÝ<') && /<tspan fill="#ff7a5c">FZ1073<\/tspan>/.test(hook), 'veta háčika, let farebne');
  assert.ok(hook.includes('OPENSKY NETWORK<'), 'čas a zdroj hore; dlhý zdroj sa skráti o celý zdroj za čiarkou, nie v polovici slova');
  const title = padOverlaySvg(card, 'title');
  assert.ok(title.includes('Let FZ1073 · Fly Dubai') && title.includes('LETECKÁ UDALOSŤ') && !title.includes('NÚDZOVÝ'));
  const bottom = padOverlaySvg(card, 'bottom');
  assert.ok(bottom.includes('Zdroj: OpenSky Network, adsb.lol') && bottom.includes('Naživo na okolive.sk'));
  // Všetky texty v bezpečnej zóne y 220–1760 (hore je hlavička aplikácie), video 400–1600.
  for (const svg of [hook, title, bottom]) {
    for (const y of [...svg.matchAll(/<text[^>]* y="([\d.]+)"/g)].map(m => Number(m[1]))) assert.ok(y >= 230 && y <= 1760, `y=${y}`);
  }
  for (const y of [...hook.matchAll(/<text[^>]* y="([\d.]+)"/g)].map(m => Number(m[1]))) assert.ok(y < PAD.y, 'háčik nad videom');
  // Dlhá veta háčika sa zmenší, neoreže.
  // Najdlhší skutočný háčik udalosti sa zmenší, neoreže.
  const long = padOverlaySvg({ ...card, hook: { text: 'NEZÁKONNÝ ZÁSAH NA PALUBE (ÚNOS): LET FZ1073', accent: 'FZ1073' } }, 'hook');
  const hookRows = [...long.matchAll(/font-weight="800"[^>]*>(.*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, '')).join(' ');
  assert.equal(hookRows, 'NEZÁKONNÝ ZÁSAH NA PALUBE (ÚNOS): LET FZ1073', 'nič sa nestratí');
  assert.ok(Number(/font-size="(\d+)" font-weight="800"/.exec(long)[1]) < 64, 'menšie písmo');
});

test('padToReel s kartou (ffmpeg): rám 1080×1920 a pás prvých 3 sekúnd', { skip: !hasFfmpeg && 'ffmpeg nie je nainštalovaný' }, async t => {
  const { padToReel } = await import('./reel.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-pad-card-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'in.mp4');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=540x676:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]).status, 0);
  const out = path.join(dir, 'out.mp4'); const sheet = path.join(dir, 'out.hook.jpg');
  const made = await padToReel(src, out, { card: { hook: { text: 'NÚDZOVÝ KÓD 7700: LET FZ1073', accent: 'FZ1073' }, headline: 'Let FZ1073', source: 'OpenSky', at: NOW }, hookSheet: sheet });
  assert.ok(Math.abs(made.seconds - 4) < 0.3, `dĺžka ${made.seconds}`);
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', out]).stdout);
  assert.deepEqual(probe.streams.filter(s => s.codec_type === 'video').map(s => [s.width, s.height]), [[1080, 1920]]);
  const { default: sharp } = await import('sharp');
  const meta = await sharp(sheet).metadata();
  assert.deepEqual([meta.width, meta.height], [HOOK_SHEET.w * 4 + HOOK_SHEET.gap * 3, HOOK_SHEET.h]);
  // Horný pás v 1. a 3,5. sekunde je iný (háčik → titulok) — overené na skutočných snímkach.
  const top = async at => sharp(spawnSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', out, '-frames:v', '1', '-vf', 'crop=1080:180:0:220', '-f', 'image2pipe', '-vcodec', 'png', '-']).stdout).raw().toBuffer();
  const [a, b] = [await top(1), await top(3.5)];
  let diff = 0; for (let i = 0; i < a.length; i += 3) diff += Math.abs(a[i] - b[i]);
  assert.ok(diff / (a.length / 3) > 3, `horný pás sa zmenil (rozdiel ${(diff / (a.length / 3)).toFixed(1)})`);
});

test('hlas vlastníka: voiceProvider má prednosť pred Piperom a predĺži video', { skip: !hasFfmpeg && 'ffmpeg nie je nainštalovaný' }, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-voice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wav = path.join(dir, 'own.wav');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=22050', '-t', '3', wav]);
  const asked = [];
  const result = await renderReel({ card: quakeCard, title: 'Titulok', text: 'x\n\nVeta.' }, path.join(dir, 'v.mp4'),
    { seconds: 2, fps: 4, voice: true, env: { ...process.env, PIPER_PATH: '/nonexistent' }, voiceProvider: async text => { asked.push(text); return wav; } });
  assert.deepEqual(asked, ['Titulok. Veta.']);
  assert.deepEqual([result.voice, result.seconds], [true, 6]);
  const none = await renderReel({ card: quakeCard, title: 'T', text: 't' }, path.join(dir, 'n.mp4'), { seconds: 1, fps: 4, voice: true, env: { PATH: process.env.PATH }, voiceProvider: async () => null });
  assert.equal(none.voice, false, 'poskytovateľ bez nahrávky = bez hlasu, nie chyba');
});

// ── 2026-10-04: titulky v reeloch, dĺžka videa, karusel cez Meta, dočasné chyby ──
test('titulky: vety narácie v čase úmerne dĺžke, v bezpečnej zóne, escapované', () => {
  const item = { title: 'Zemetrasenie M 6,3 – Grécko', text: 'x\nDnes o 13:20 zasiahlo zemetrasenie oblasť 70 km JZ od Atén. Hĺbka 12 km.' };
  const rows = captionsFor(item, { start: 1.2, length: 9 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].from, 1.2);
  assert.equal(rows[1].from, rows[0].to, 'nadväzujú');
  assert.ok(rows[1].to - rows[1].from > rows[0].to - rows[0].from, 'dlhšia veta = dlhší titulok');
  assert.deepEqual(captionsFor('', { length: 5 }), []);
  const svg = overlaySvg(quakeCard, HOOK_END + 0.2, { captions: [{ from: 0, to: 5, text: '<b>Veta & veta</b>' }] });
  assert.ok(svg.includes('&lt;b&gt;Veta') && svg.includes('&amp;') && !svg.includes('<b>'), 'escapované');
  assert.ok(!overlaySvg(quakeCard, 6, { captions: [{ from: 0, to: 5, text: 'Koniec' }] }).includes('Koniec'), 'mimo času sa nekreslí');
  assert.ok(!overlaySvg(quakeCard, 1.5, { captions: [{ from: 0, to: 5, text: 'Skoro' }] }).includes('Skoro'), 'počas háčika titulok nie');
  const [, y, h] = /<rect x="50" y="(\d+)" width="980" height="(\d+)"/.exec(svg).map(Number);
  assert.ok(y > 1100 && y + h <= 1440, `titulok nad spodkom mapy, neprekrýva riadky pod ňou (y=${y}, h=${h})`);
  const long = captionsFor('Toto je veľmi dlhá veta, ktorá by sa do troch riadkov titulku nikdy nezmestila, a preto sa musí rozdeliť na viac častí po slovách bez orezania.', { length: 9 });
  assert.ok(long.length >= 2 && long.every(row => row.text.length <= 90), 'dlhá veta sa delí');
  assert.equal(long.map(row => row.text).join(' ').endsWith('orezania.'), true, 'nič sa nestratí');
  // Krátke frázy pre mobil bez zvuku: do 4 slov, nič sa nestratí, čísla farebne.
  const sentence = 'Ukrajinský generálny štáb hlási za uplynulý deň 204 bojových stretov s ruskými jednotkami.';
  const chunks = captionChunks(sentence);
  assert.ok(chunks.length >= 3 && chunks.every(c => c.split(' ').length <= 4), chunks.join(' | '));
  assert.equal(chunks.join(' '), sentence);
  const timed = [{ from: HOOK_END, to: HOOK_END + 6, text: sentence }];
  const firstChunk = overlaySvg(quakeCard, HOOK_END + 0.1, { captions: timed });
  const lastChunk = overlaySvg(quakeCard, HOOK_END + 5.9, { captions: timed });
  assert.ok(firstChunk.includes('>Ukrajinský<') && !firstChunk.includes('>jednotkami.<'), 'na začiatku prvá fráza');
  assert.ok(lastChunk.includes('>jednotkami.<') && !lastChunk.includes('>Ukrajinský<'), 'na konci posledná fráza');
  const frames = Array.from({ length: 60 }, (_, i) => overlaySvg(quakeCard, HOOK_END + i * 0.1, { captions: timed }));
  assert.ok(frames.some(svg => /<tspan fill="#ffd23c">204<\/tspan>/.test(svg)), 'číslo v titulku farebne');
  // Číslo drží pokope (šablóny dávajú obyčajnú medzeru tisícok): v háčiku jedno zvýraznené slovo, v titulku jedna fráza.
  const big = overlaySvg({ ...quakeCard, hook: { text: 'RUSKÝ AGRESOR OBSADIL 1 186 km² ZA DEŇ', accent: '1 186 km²' } }, 0);
  assert.match(big, /<tspan fill="#ff7a5c">1 186 km²<\/tspan>/);
  assert.ok(!/<tspan[^>]*>186</.test(big), '„186" nie je samostatné slovo');
  assert.deepEqual(captionChunks('ruský agresor obsadil 1 186 km² územia za týždeň').map(c => c.includes('1 186 km²')).filter(Boolean).length, 1);
  assert.equal(keepNumbersTogether('o 8,3 km a 12 %, rok 2026 bol'), 'o 8,3 km a 12 %, rok 2026 bol');
  assert.ok(captionChunks('Mapa frontu k 2. 10. 2026 oproti predchádzajúcemu dňu').some(c => c.includes('2. 10. 2026')), 'dátum sa nerozdelí');
});

test('render s titulkami a zistenie dĺžky videa', { skip: !hasFfmpeg && 'ffmpeg nie je nainštalovaný' }, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-reel-cap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'r.mp4');
  const sheet = path.join(dir, 'r.hook.jpg');
  const made = await renderReel({ card: quakeCard, title: 'Grécko', text: 'x\nVeta jedna. Veta dva.' }, file, { audio: 'none', seconds: 4, fps: 10, hookSheet: sheet });
  assert.equal(made.captions, 1, 'bez hlasu len prvá veta — nadpis povedal háčik');
  // Pás háčika: 4 snímky (0, 1, 2, 3 s) vedľa seba.
  const { default: sharp } = await import('sharp');
  const meta = await sharp(sheet).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', HOOK_SHEET.w * 4 + HOOK_SHEET.gap * 3, HOOK_SHEET.h]);
  const seconds = await probeSeconds(file);
  assert.ok(Math.abs(seconds - 4) < 0.3, `dĺžka ${seconds}`);
  assert.equal(await probeSeconds(path.join(dir, 'nie.mp4')), null);
});

test('Meta karusel: FB nezverejnené fotky + /feed attached_media, IG kontajnery + CAROUSEL; dočasné vs. trvalé chyby', async () => {
  const requests = [];
  const env = { META_PAGE_ID: '111111', META_PAGE_TOKEN: 'T'.repeat(40), META_IG_USER_ID: '222222' };
  let photo = 0; let child = 0;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const form = init.body instanceof FormData ? init.body : null;
    const params = init.body instanceof URLSearchParams ? init.body : new URLSearchParams();
    requests.push({ path: u.pathname, form, params });
    if (u.pathname.endsWith('/photos')) return Response.json({ id: `ph${++photo}` });
    if (u.pathname.endsWith('/feed')) return Response.json({ id: '111111_99' });
    if (u.pathname.endsWith('/222222/media')) return Response.json({ id: params.get('media_type') === 'CAROUSEL' ? 'car' : `ch${++child}` });
    if (/\/(ch\d|car)$/.test(u.pathname)) return Response.json({ status_code: 'FINISHED' });
    if (u.pathname.endsWith('/media_publish')) return Response.json({ id: 'igpost' });
    if (u.pathname.endsWith('/igpost')) return Response.json({ permalink: 'https://www.instagram.com/p/car/' });
    return Response.json({ error: { message: 'x' } }, { status: 400 });
  };
  const meta = createMetaPublisher({ env, fetchImpl });
  const fb = await meta.facebookCarousel({ images: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')], text: 'Popis' });
  assert.deepEqual(fb, { id: '111111_99', url: 'https://www.facebook.com/111111_99', slides: 3 });
  const photos = requests.filter(r => r.path.endsWith('/photos'));
  assert.equal(photos.length, 3);
  assert.ok(photos.every(r => r.form.get('published') === 'false'), 'snímky nezverejnené samostatne');
  const feed = requests.find(r => r.path.endsWith('/feed')).params;
  assert.equal(feed.get('message'), 'Popis');
  assert.deepEqual([0, 1, 2].map(i => JSON.parse(feed.get(`attached_media[${i}]`)).media_fbid), ['ph1', 'ph2', 'ph3']);
  const ig = await meta.instagramCarousel({ imageUrls: ['https://okolive.sk/1.jpg', 'https://okolive.sk/2.jpg'], text: 'IG', wait: async () => {} });
  assert.deepEqual(ig, { id: 'igpost', url: 'https://www.instagram.com/p/car/', slides: 2 });
  const children = requests.filter(r => r.path.endsWith('/222222/media') && r.params.get('is_carousel_item') === 'true');
  assert.equal(children.length, 2);
  const carousel = requests.find(r => r.params.get('media_type') === 'CAROUSEL').params;
  assert.deepEqual([carousel.get('children'), carousel.get('caption')], ['ch1,ch2', 'IG']);
  // Jedna snímka = obyčajná fotka.
  photo = 0;
  const single = await meta.facebookCarousel({ images: [Buffer.from('a')], text: 'Jedna' });
  assert.ok(single.id);
  // Dočasné chyby sa opakujú, chybná konfigurácia nie.
  assert.equal(isRetryableError(Object.assign(new Error('x'), { code: 2, status: 400 })), true);
  assert.equal(isRetryableError(Object.assign(new Error('x'), { status: 503 })), true);
  assert.equal(isRetryableError(new Error('The operation was aborted due to timeout')), true);
  assert.equal(isRetryableError(Object.assign(new Error('Invalid OAuth'), { code: 190, status: 400 })), false);
  assert.equal(isRetryableError(Object.assign(new Error('Bad param'), { status: 400 })), false);
  assert.equal(isRetryableError(null), false);
});
