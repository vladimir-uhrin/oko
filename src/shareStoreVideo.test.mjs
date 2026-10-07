// src/shareStoreVideo.test.mjs — video do náhľadu odkazu v úložisku zdieľaní (2026-10-07): overenie
// nahrávky podľa bajtov, okno na pripojenie, attachVideo, og:video na stránke odkazu, mazanie s videom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SHARE_UPLOAD_STALE_MS, SHARE_VIDEO_ATTACH_WINDOW_MS, SHARE_VIDEO_MAX_BYTES, canAttachVideo, createShareStore, renderSharePage, sniffVideoType,
  validateVideoUpload,
} from './shareStore.js';

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4000, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(4000, 2)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 3)]);

test('sniffVideoType + validateVideoUpload: WebM/MP4 podľa bajtov, deklarovaný typ musí sedieť, medze veľkosti, rozmerov a dĺžky', () => {
  assert.equal(sniffVideoType(WEBM), 'video/webm');
  assert.equal(sniffVideoType(MP4), 'video/mp4');
  assert.equal(sniffVideoType(JPEG), null);
  assert.equal(sniffVideoType(Buffer.alloc(4)), null);
  const ok = validateVideoUpload({ buffer: WEBM, contentType: 'video/webm;codecs=vp9', width: '1200', height: '630', durationMs: '6010.4' });
  assert.deepEqual(ok, { ok: true, value: { type: 'video/webm', ext: 'webm', width: 1200, height: 630, durationMs: 6010, bytes: WEBM.length } });
  assert.equal(validateVideoUpload({ buffer: MP4, contentType: 'video/mp4', width: 1200, height: 630, durationMs: 6000 }).value.ext, 'mp4');
  assert.equal(validateVideoUpload({ buffer: MP4, contentType: 'application/octet-stream', width: 1200, height: 630, durationMs: 6000 }).ok, true, 'bez typu rozhodnú bajty');
  assert.equal(validateVideoUpload({ buffer: JPEG, contentType: 'video/webm', width: 1200, height: 630, durationMs: 6000 }).error, 'video_type', 'obrázok nie je video');
  assert.equal(validateVideoUpload({ buffer: WEBM, contentType: 'video/mp4', width: 1200, height: 630, durationMs: 6000 }).error, 'video_type', 'deklarácia klame');
  assert.equal(validateVideoUpload({ buffer: Buffer.alloc(100), contentType: 'video/webm', width: 1200, height: 630, durationMs: 6000 }).error, 'video_too_small');
  assert.equal(validateVideoUpload({ buffer: Buffer.alloc(SHARE_VIDEO_MAX_BYTES + 1), contentType: 'video/webm', width: 1200, height: 630, durationMs: 6000 }).error, 'too_large');
  assert.equal(validateVideoUpload({ buffer: WEBM, contentType: 'video/webm', width: 100, height: 630, durationMs: 6000 }).error, 'video_size');
  assert.equal(validateVideoUpload({ buffer: WEBM, contentType: 'video/webm', width: 1200.5, height: 630, durationMs: 6000 }).error, 'video_size');
  assert.equal(validateVideoUpload({ buffer: WEBM, contentType: 'video/webm', width: 1200, height: 630, durationMs: 60_000 }).error, 'video_duration');
  assert.equal(validateVideoUpload({ buffer: WEBM, contentType: 'video/webm', width: 1200, height: 630, durationMs: 'x' }).error, 'video_duration');
});

test('canAttachVideo: len bez videa a do 15 min od vzniku', () => {
  const t0 = 1_700_000_000_000;
  assert.equal(canAttachVideo({ createdAt: t0 }, t0 + 1000), true);
  assert.equal(canAttachVideo({ createdAt: t0 }, t0 + SHARE_VIDEO_ATTACH_WINDOW_MS + 1), false, 'po okne nie — id nie je tajné');
  assert.equal(canAttachVideo({ createdAt: t0, video: { type: 'video/mp4' } }, t0 + 1000), false, 'druhé video nie');
  assert.equal(canAttachVideo({ createdAt: 'x' }, t0), false);
  assert.equal(canAttachVideo(null, t0), false);
});

test('úložisko: attachVideo doplní záznam, stránka dostane og:video + video.other, remove a prune mažú aj mp4, stará nahrávka ide preč', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-share-video-'));
  let clock = 1_700_000_000_000;
  const store = createShareStore({ dir, now: () => clock, idFactory: () => 'VidTest001' });
  const record = store.save({ hash: 'v=2&lat=48.1&lon=17.1', title: 'OKO · test', description: 'Lietadlá', width: 1200, height: 630, image: JPEG });
  assert.equal(record.id, 'VidTest001');
  assert.doesNotMatch(renderSharePage({ record, origin: 'https://okolive.sk' }), /og:video/, 'bez videa žiadne video značky');
  assert.match(renderSharePage({ record, origin: 'https://okolive.sk' }), /<meta property="og:type" content="website" \/>/);

  fs.writeFileSync(store.videoPath(record.id), MP4);
  clock += 30_000;
  const updated = store.attachVideo(record.id, { width: 1200, height: 630, durationMs: 6010, bytes: MP4.length });
  assert.deepEqual(updated.video, { type: 'video/mp4', width: 1200, height: 630, durationMs: 6010, bytes: MP4.length, attachedAt: clock });
  assert.deepEqual(store.read(record.id).video, updated.video, 'zapísané na disk');
  assert.equal(store.attachVideo(record.id, { width: 1200, height: 630, durationMs: 6000, bytes: 1 }), null, 'druhýkrát nie');
  assert.equal(store.attachVideo('Nope000001', {}), null);

  const html = renderSharePage({ record: store.read(record.id), origin: 'https://okolive.sk/' });
  assert.match(html, /<meta property="og:type" content="video.other" \/>/);
  assert.match(html, /<meta property="og:video" content="https:\/\/okolive\.sk\/s\/VidTest001\.mp4" \/>/);
  assert.match(html, /<meta property="og:video:secure_url" content="https:\/\/okolive\.sk\/s\/VidTest001\.mp4" \/>/, 'Facebook: bez secure_url nie je video spôsobilé na prehrávanie vo feede');
  assert.match(html, /<meta property="og:video:type" content="video\/mp4" \/>/);
  assert.match(html, /<meta property="og:video:width" content="1200" \/>\n<meta property="og:video:height" content="630" \/>/, 'rozmery sú pre video povinné');
  assert.match(html, /<meta property="video:duration" content="6" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/okolive\.sk\/s\/VidTest001\.jpg" \/>/, 'obrázok ostáva (siete bez videa)');
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/, 'X ostáva pri obrázku (player card chce schválenie)');
  assert.match(html, /<iframe class="oko-live"/, 'živý rámček ostáva');

  // Stará rozpracovaná nahrávka a mazanie
  const stale = store.uploadPath('Stale00001', 'webm');
  fs.writeFileSync(stale, WEBM);
  const old = clock - SHARE_UPLOAD_STALE_MS - 1000;
  fs.utimesSync(stale, old / 1000, old / 1000);
  const fresh = store.uploadPath(record.id, 'webm');
  fs.writeFileSync(fresh, WEBM);
  store.prune(clock);
  assert.equal(fs.existsSync(stale), false, 'stará nahrávka po páde prevodu zmazaná');
  assert.equal(fs.existsSync(fresh), true, 'čerstvá nahrávka ostáva');
  assert.equal(fs.existsSync(store.videoPath(record.id)), true, 'záznam v retencii ostáva aj s videom');
  assert.equal(store.remove(record.id), true);
  assert.equal(fs.existsSync(store.videoPath(record.id)), false, 'remove maže aj video');
  fs.unlinkSync(fresh);

  const second = store.save({ hash: 'v=2&lat=1&lon=2', title: 'x', description: '', width: 1200, height: 630, image: JPEG });
  fs.writeFileSync(store.videoPath(second.id), MP4);
  store.prune(clock + 91 * 86_400_000);
  assert.equal(fs.existsSync(store.videoPath(second.id)), false, 'retencia maže aj video');
  fs.rmSync(dir, { recursive: true, force: true });
});
