// src/shareVideoServer.test.mjs — serverová časť videa v náhľade (2026-10-07): argumenty ffmpeg,
// prevod s falošným procesom, rozsah bajtov a odoslanie súboru s Range (206/416/404, HEAD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_VIDEO_OUTPUT_MAX_SECONDS, byteRangeFor, convertShareVideo, ffmpegArgsForShareVideo, resolveFfmpegPath, sendVideoFile,
} from './shareVideoServer.js';

test('ffmpegArgsForShareVideo: bez zvuku, párne rozmery, H.264 main + yuv420p + faststart, strop dĺžky', () => {
  const args = ffmpegArgsForShareVideo({ inputPath: 'in.webm', outputPath: 'out.mp4', width: 1201, height: 630, maxSeconds: 7 });
  assert.deepEqual(args.slice(0, 4), ['-y', '-hide_banner', '-loglevel', 'error']);
  assert.equal(args[args.indexOf('-i') + 1], 'in.webm');
  assert.equal(args[args.indexOf('-t') + 1], '7');
  assert.ok(args.includes('-an'), 'siete prehrávajú bez zvuku, zvuk by len zväčšil súbor');
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=1200:630:flags=lanczos,format=yuv420p', 'nepárny rozmer sa zaokrúhli nadol');
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-profile:v') + 1], 'main');
  assert.equal(args[args.indexOf('-movflags') + 1], '+faststart');
  assert.equal(args.at(-1), 'out.mp4');
  assert.equal(ffmpegArgsForShareVideo({ inputPath: 'a', outputPath: 'b', width: 1200, height: 630, maxSeconds: 99 })[7], String(SHARE_VIDEO_OUTPUT_MAX_SECONDS), 'dlhšie než strop sa oreže');
  assert.equal(resolveFfmpegPath({ FFMPEG_PATH: 'C:\\x\\ffmpeg.exe' }), 'C:\\x\\ffmpeg.exe');
  assert.equal(resolveFfmpegPath({}), 'ffmpeg');
});

test('convertShareVideo: spustí ffmpeg s argumentmi a vráti veľkosť; ENOENT = ffmpeg_missing; prázdny výstup = convert_failed', async () => {
  const calls = [];
  const execOk = (bin, args, options, callback) => { calls.push({ bin, args, options }); callback(null, '', ''); };
  const fsImpl = { statSync: () => ({ size: 123_456 }) };
  const ok = await convertShareVideo({ ffmpegPath: 'ffmpeg-test', inputPath: 'in.webm', outputPath: 'out.mp4', width: 1200, height: 630, maxSeconds: 7, execFileImpl: execOk, fsImpl });
  assert.deepEqual(ok, { ok: true, bytes: 123_456 });
  assert.equal(calls[0].bin, 'ffmpeg-test');
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].options.timeout >= 10_000, 'proces má časový limit');
  const missing = await convertShareVideo({ ffmpegPath: 'nope', inputPath: 'a', outputPath: 'b', width: 10, height: 10, execFileImpl: (b, a, o, cb) => cb(Object.assign(new Error('spawn nope ENOENT'), { code: 'ENOENT' }), '', ''), fsImpl });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'ffmpeg_missing');
  const failed = await convertShareVideo({ ffmpegPath: 'f', inputPath: 'a', outputPath: 'b', width: 10, height: 10, execFileImpl: (b, a, o, cb) => cb(new Error('exit 1'), '', 'Invalid data found'), fsImpl });
  assert.deepEqual(failed, { ok: false, error: 'convert_failed', detail: 'Invalid data found' });
  const empty = await convertShareVideo({ ffmpegPath: 'f', inputPath: 'a', outputPath: 'b', width: 10, height: 10, execFileImpl: (b, a, o, cb) => cb(null, '', ''), fsImpl: { statSync: () => { throw new Error('ENOENT'); } } });
  assert.equal(empty.error, 'convert_failed');
  const thrown = await convertShareVideo({ ffmpegPath: 'f', inputPath: 'a', outputPath: 'b', width: 10, height: 10, execFileImpl: () => { throw new Error('boom'); }, fsImpl });
  assert.equal(thrown.ok, false);
});

test('byteRangeFor: celý súbor bez hlavičky, začiatok-koniec v medziach, prípona, neplatné = 416', () => {
  assert.equal(byteRangeFor(undefined, 100), null);
  assert.deepEqual(byteRangeFor('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(byteRangeFor('bytes=10-20', 100), { start: 10, end: 20 });
  assert.deepEqual(byteRangeFor('bytes=90-500', 100), { start: 90, end: 99 }, 'koniec za súborom sa oreže');
  assert.deepEqual(byteRangeFor('bytes=-10', 100), { start: 90, end: 99 }, 'posledných 10 bajtov');
  assert.deepEqual(byteRangeFor('bytes=100-', 100), { invalid: true }, 'začiatok za koncom');
  assert.deepEqual(byteRangeFor('bytes=20-10', 100), { invalid: true });
  assert.deepEqual(byteRangeFor('bytes=-', 100), { invalid: true });
  assert.deepEqual(byteRangeFor('items=0-1', 100), { invalid: true });
  assert.deepEqual(byteRangeFor('bytes=0-1', 0), { invalid: true }, 'prázdny súbor');
});

function makeRes() {
  const res = { status: null, headers: null, body: '', ended: false, destroyed: false };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = (body = '') => { res.body += body; res.ended = true; };
  res.destroy = () => { res.destroyed = true; };
  res.write = (chunk) => { res.body += chunk; };
  res.on = () => {};
  res.once = () => {};
  res.emit = () => {};
  return res;
}
function makeFs(size, data = 'x'.repeat(size)) {
  const reads = [];
  return {
    reads,
    statSync: () => ({ size }),
    createReadStream: (file, { start, end }) => {
      reads.push([start, end]);
      const chunk = data.slice(start, end + 1);
      return { on() {}, pipe(res) { res.write(chunk); res.end(); } };
    },
  };
}

test('sendVideoFile: 200 celý súbor s Accept-Ranges a nemenným cache; 206 s Content-Range; HEAD bez tela; 416; 404', () => {
  const fsImpl = makeFs(1000);
  const full = makeRes();
  sendVideoFile({ req: { headers: {}, method: 'GET' }, res: full, filePath: 'v.mp4', fsImpl });
  assert.equal(full.status, 200);
  assert.equal(full.headers['Content-Type'], 'video/mp4');
  assert.equal(full.headers['Accept-Ranges'], 'bytes');
  assert.equal(full.headers['Content-Length'], '1000');
  assert.equal(full.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(full.body.length, 1000);
  assert.deepEqual(fsImpl.reads.at(-1), [0, 999]);

  const part = makeRes();
  sendVideoFile({ req: { headers: { range: 'bytes=100-199' }, method: 'GET' }, res: part, filePath: 'v.mp4', fsImpl });
  assert.equal(part.status, 206);
  assert.equal(part.headers['Content-Range'], 'bytes 100-199/1000');
  assert.equal(part.headers['Content-Length'], '100');
  assert.equal(part.body.length, 100);

  const head = makeRes();
  sendVideoFile({ req: { headers: {}, method: 'HEAD' }, res: head, filePath: 'v.mp4', fsImpl });
  assert.equal(head.status, 200);
  assert.equal(head.body, '', 'HEAD bez tela');

  const bad = makeRes();
  sendVideoFile({ req: { headers: { range: 'bytes=5000-' }, method: 'GET' }, res: bad, filePath: 'v.mp4', fsImpl });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers['Content-Range'], 'bytes */1000');

  const missing = makeRes();
  sendVideoFile({ req: { headers: {}, method: 'GET' }, res: missing, filePath: 'v.mp4', fsImpl: { statSync: () => { throw new Error('ENOENT'); } } });
  assert.equal(missing.status, 404);
});
