import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import sharp from 'sharp';
import { encodePhoto, receivePhoto } from './photos.js';
import { fixture, credentials } from './account-test-helpers.mjs';
import { PHOTO_MAX_BYTES, validatePhotoFile } from '../photoPolicy.js';

const png = () => sharp({ create: { width: 480, height: 320, channels: 3, background: '#17b8cc' } }).png().toBuffer();
const upload = (f, client, bytes, type = 'image/png', headers = {}) => fetch(f.base + '/api/account/photo', {
  method: 'PUT', headers: { Cookie: client.cookie, Origin: f.base, 'X-CSRF-Token': client.csrf, 'Content-Type': type, ...headers }, body: bytes,
});
test('avatar round trip, private raster response, versioning, session/profile preservation and deletion', async t => {
  const f = await fixture(t); const a = f.client(); await a.register();
  const res = await upload(f, a, await png()); assert.equal(res.status, 200);
  const { user } = await res.json(); assert.match(user.photoVersion, /^[a-f0-9-]{36}$/);
  assert.equal(user.role, 'member'); assert.equal(user.bytes, undefined);
  const photo = await fetch(f.base + '/api/account/photo', { headers: { Cookie: a.cookie } });
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/webp');
  assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  assert.match(photo.headers.get('cache-control'), /private, no-store/);
  const meta = await sharp(Buffer.from(await photo.arrayBuffer())).metadata();
  assert.equal(meta.width, 256); assert.equal(meta.height, 256);
  assert.equal((await a.request('/api/auth/session')).data.user.photoVersion, user.photoVersion);
  assert.equal((await a.request('/api/account', { method: 'PATCH', body: { bio: 'Photo owner' } })).data.user.photoVersion, user.photoVersion);
  const second = await upload(f, a, await png()); assert.notEqual((await second.json()).user.photoVersion, user.photoVersion);
  const removed = await a.request('/api/account/photo', { method: 'DELETE', body: {} });
  assert.equal(removed.status, 200); assert.equal(removed.data.user.photoVersion, null);
  assert.equal((await a.request('/api/account/photo')).status, 404);
  assert.deepEqual((await a.request('/api/account/security')).data.events.slice(0, 3).map(e => e.type), ['photo_removed', 'photo_updated', 'profile_updated']);
});

test('private owner-scoped access, no IDOR, no anonymous writes, and mandatory CSRF/Origin', async t => {
  const f = await fixture(t); const a = f.client(); const b = f.client();
  const { data } = await a.register(); await b.register({ ...credentials, email: 'other@example.com' });
  const bytes = await png(); assert.equal((await upload(f, a, bytes)).status, 200);
  assert.equal((await f.client().request('/api/account/photo')).status, 401);
  assert.equal((await upload(f, f.client(), bytes)).status, 401);
  assert.equal((await upload(f, a, bytes, 'image/png', { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await upload(f, a, bytes, 'image/png', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await b.request('/api/account/photo?userId=' + data.user.id)).status, 404);
  assert.equal((await b.request('/api/account/photo/' + data.user.id)).status, 404);
  assert.equal((await b.request('/api/account/photo', { method: 'DELETE', body: { userId: data.user.id } })).status, 400);
  assert.ok(f.store.photo(data.user.id));
});

test('invalid uploads preserve previous avatar and enforce file limits / signature / decoder validation', async t => {
  const f = await fixture(t); const a = f.client(); const { data } = await a.register();
  await upload(f, a, await png()); const before = f.store.photo(data.user.id);
  for (const [bytes, type, status] of [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png', 415],
    [await png(), 'image/jpeg', 415], [Buffer.alloc(0), 'image/png', 415],
    [Buffer.from([255, 216, 255, 0]), 'image/jpeg', 400],
    [await png(), 'image/svg+xml', 415],
  ]) assert.equal((await upload(f, a, bytes, type)).status, status);
  assert.deepEqual(f.store.photo(data.user.id), before);
  assert.equal((await upload(f, a, await png(), 'image/png', { 'Content-Encoding': 'gzip' })).status, 415);
  // Check early size refusal without racing an in-flight 5 MB body against the
  // intentional Connection: close response (Windows may reset that connection).
  const tooLarge = await new Promise((resolve, reject) => {
    const req = http.request(f.base + '/api/account/photo', { method: 'PUT', headers: {
      Cookie: a.cookie, Origin: f.base, 'X-CSRF-Token': a.csrf, 'Content-Type': 'image/png', 'Content-Length': PHOTO_MAX_BYTES + 1,
    } }, res => { res.resume(); res.on('end', () => { resolve(res.statusCode); req.destroy(); }); });
    req.on('error', reject); req.flushHeaders();
  });
  assert.equal(tooLarge, 413); assert.deepEqual(f.store.photo(data.user.id), before);
});

test('decoder re-encodes all allowed formats, strips private metadata and refuses oversized dimensions / animation', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await sharp(await png()).withExif({ IFD0: { Artist: 'PRIVATE TEST METADATA' } }).toFormat(format).toBuffer();
    const output = await encodePhoto(bytes, `image/${format}`); const meta = await sharp(output).metadata();
    assert.equal(meta.format, 'webp'); assert.equal(meta.exif, undefined); assert.equal(meta.xmp, undefined); assert.equal(meta.icc, undefined);
    assert.ok(!output.includes(Buffer.from('PRIVATE TEST METADATA')));
  }
  const huge = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#eee' } }).png().toBuffer();
  await assert.rejects(encodePhoto(huge, 'image/png'), /photo_invalid/);
  const frames = await Promise.all(['#f00', '#00f'].map(background => sharp({ create: { width: 2, height: 2, channels: 3, background } }).png().toBuffer()));
  const animated = await sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(encodePhoto(animated, 'image/webp'), /photo_invalid/);
});

test('revoking a session during streaming upload prevents its eventual write', async t => {
  const f = await fixture(t); const a = f.client(); const { data } = await a.register(); const bytes = await png();
  let entered, consumed = 0;
  const authorized = new Promise(resolve => { entered = resolve; });
  const consume = f.store.consume;
  f.store.consume = (...args) => { const result = consume(...args); if (++consumed === 3) entered(); return result; };
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(f.base + '/api/account/photo', { method: 'PUT', headers: {
      Cookie: a.cookie, Origin: f.base, 'X-CSRF-Token': a.csrf, 'Content-Type': 'image/png', 'Content-Length': bytes.length,
    } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    request.on('error', reject); request.write(bytes.subarray(0, 16));
  });
  // Wait for the handler to consume its rate-limit entry, proving authorization
  // was checked before revocation and before the upload body is completed.
  await authorized; f.store.consume = consume;
  f.store.deleteUserSessions(data.user.id); request.end(bytes.subarray(16));
  assert.equal(await response, 403); assert.equal(f.store.photo(data.user.id), undefined);
});

test('client file preflight rejects empty/oversized/unsupported files', () => {
  assert.equal(validatePhotoFile({ type: 'image/jpeg', size: PHOTO_MAX_BYTES }), null);
  assert.equal(validatePhotoFile({ type: 'image/png', size: PHOTO_MAX_BYTES + 1 }), 'photo_size');
  assert.equal(validatePhotoFile({ type: 'image/webp', size: 0 }), 'photo_size');
  assert.equal(validatePhotoFile({ type: 'image/svg+xml', size: 10 }), 'photo_format');
});

test('chunked bodies cannot bypass the avatar size limit', async () => {
  const req = Readable.from([Buffer.alloc(PHOTO_MAX_BYTES), Buffer.alloc(1)]);
  req.headers = { 'content-type': 'image/png' };
  await assert.rejects(receivePhoto(req), error => error.status === 413 && error.message === 'photo_size');
});

test('only two uploads may buffer/decode concurrently; slots are released after success or errors', async () => {
  const first = new PassThrough(), second = new PassThrough(), third = new PassThrough();
  for (const stream of [first, second, third]) stream.headers = { 'content-type': 'image/png' };
  const pending = [receivePhoto(first), receivePhoto(second)];
  await assert.rejects(receivePhoto(third), error => error.status === 503 && error.message === 'photo_busy');
  first.end(await png()); second.end(Buffer.from('invalid')); third.destroy();
  const results = await Promise.allSettled(pending);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.message, 'photo_format');
  const next = Readable.from([await png()]); next.headers = { 'content-type': 'image/png' };
  assert.ok((await receivePhoto(next)).length > 0);
});
