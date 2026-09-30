// src/shareStore.test.mjs
// Server zdieľania s náhľadom (2026-09-14): validácia verejného POST, id,
// OG stránka, pôvod z hlavičiek tunela, úložisko s retenciou.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SHARE_IMAGE_MAX_BYTES,
  clientKeyFromRequest,
  createShareStore,
  decodeJpegDataUrl,
  escapeHtml,
  isValidShareId,
  makeShareId,
  originFromRequest,
  renderSharePage,
  validateSharePayload,
} from './shareStore.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const jpegDataUrl = (buffer = JPEG) => `data:image/jpeg;base64,${buffer.toString('base64')}`;
const validBody = () => ({ hash: 'v=2&lat=48.15&lon=17.11&alt=800&subj=flights.t.4b1805', title: 'OKO · SWR11H', description: 'Lietadlá · 14. 9. 2026', image: jpegDataUrl(), width: 1200, height: 630 });

test('makeShareId: 10 znakov base62, náhodné, bez skreslenia; isValidShareId', () => {
  const id = makeShareId();
  assert.match(id, /^[A-Za-z0-9]{10}$/);
  assert.notEqual(makeShareId(), id);
  const fixed = makeShareId(4, (n) => Buffer.from(Array.from({ length: n }, (_, i) => (i === 0 ? 250 : i))));
  assert.equal(fixed, 'BCDE', 'bajt ≥ 248 sa preskočí (bez modulo skreslenia)');
  assert.equal(isValidShareId('Ab12cd34EF'), true);
  assert.equal(isValidShareId('short'), false);
  assert.equal(isValidShareId('../etc'), false);
  assert.equal(isValidShareId(null), false);
});

test('decodeJpegDataUrl: len JPEG s hlavičkou FF D8 FF, do stropu', () => {
  assert.ok(decodeJpegDataUrl(jpegDataUrl()).equals(JPEG));
  assert.equal(decodeJpegDataUrl(`data:image/png;base64,${JPEG.toString('base64')}`), null, 'PNG odmietnuté');
  assert.equal(decodeJpegDataUrl(`data:image/jpeg;base64,${Buffer.alloc(16, 0).toString('base64')}`), null, 'zlá hlavička');
  assert.equal(decodeJpegDataUrl(jpegDataUrl(Buffer.concat([JPEG, Buffer.alloc(SHARE_IMAGE_MAX_BYTES)]))), null, 'nad strop');
  assert.equal(decodeJpegDataUrl('data:image/jpeg;base64,***'), null);
  assert.equal(decodeJpegDataUrl(42), null);
});

test('validateSharePayload: hash s lat= a bezpečnou abecedou, texty orezané a bez riadiacich znakov, rozmery v medziach', () => {
  const ok = validateSharePayload(validBody());
  assert.equal(ok.ok, true);
  assert.equal(ok.value.hash, 'v=2&lat=48.15&lon=17.11&alt=800&subj=flights.t.4b1805');
  assert.equal(ok.value.title, 'OKO · SWR11H');
  assert.ok(Buffer.isBuffer(ok.value.image));
  assert.equal(validateSharePayload({ ...validBody(), hash: '#lat=1&lon=2' }).value.hash, 'lat=1&lon=2', 'vedúca mriežka preč');
  assert.equal(validateSharePayload({ ...validBody(), hash: 'lon=2' }).error, 'bad_hash', 'bez lat= nie je stav');
  assert.equal(validateSharePayload({ ...validBody(), hash: 'lat=1&x=<script>' }).error, 'bad_hash');
  assert.equal(validateSharePayload({ ...validBody(), hash: 'lat=1&' + 'a'.repeat(5000) }).error, 'bad_hash');
  assert.equal(validateSharePayload({ ...validBody(), image: 'nope' }).error, 'bad_image');
  assert.equal(validateSharePayload({ ...validBody(), width: 10 }).error, 'bad_size');
  assert.equal(validateSharePayload({ ...validBody(), width: 1200.5 }).error, 'bad_size');
  assert.equal(validateSharePayload({ ...validBody(), title: '  a\x00b\n\nc  ' + 'x'.repeat(200) }).value.title.length, 120);
  assert.equal(validateSharePayload({ ...validBody(), title: '' }).value.title, 'OKO');
  assert.equal(validateSharePayload({ ...validBody(), title: 'a\x01b' }).value.title, 'a b');
  assert.equal(validateSharePayload(null).error, 'bad_body');
  assert.equal(validateSharePayload('x').error, 'bad_body');
});

test('originFromRequest / clientKeyFromRequest: tunel (Host + X-Forwarded-Proto + CF-Connecting-IP) aj localhost', () => {
  const tunnel = { headers: { host: 'oko.uhrin.digital', 'x-forwarded-proto': 'https', 'cf-connecting-ip': '203.0.113.9' }, socket: { remoteAddress: '::1' } };
  assert.equal(originFromRequest(tunnel), 'https://oko.uhrin.digital');
  assert.equal(clientKeyFromRequest(tunnel), '203.0.113.9');
  const local = { headers: { host: 'localhost:4173' }, socket: { remoteAddress: '::1' } };
  assert.equal(originFromRequest(local), 'http://localhost:4173');
  assert.equal(clientKeyFromRequest(local), '::1');
  assert.equal(originFromRequest({ headers: { host: 'evil"><script>' } }), 'http://localhost:4173', 'cudzí Host → záloha');
  assert.equal(originFromRequest({ headers: { host: 'oko.uhrin.digital', 'cf-visitor': '{"scheme":"https"}' } }), 'https://oko.uhrin.digital');
  assert.equal(clientKeyFromRequest({ headers: { 'cf-connecting-ip': 'not an ip' }, socket: { remoteAddress: '10.0.0.5' } }), '10.0.0.5');
});

test('renderSharePage: OG + Twitter značky s absolútnymi URL, presmerovanie do aplikácie, escapovanie', () => {
  const record = { id: 'Ab12cd34EF', hash: 'v=2&lat=48.15&lon=17.11', title: 'OKO · <SWR11H> & "Bratislava"', description: 'Lietadlá · 14. 9.', width: 1200, height: 630 };
  const html = renderSharePage({ record, origin: 'https://oko.uhrin.digital/' });
  assert.match(html, /<meta property="og:image" content="https:\/\/oko\.uhrin\.digital\/s\/Ab12cd34EF\.jpg" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/oko\.uhrin\.digital\/s\/Ab12cd34EF" \/>/);
  assert.match(html, /<meta property="og:title" content="OKO · &lt;SWR11H&gt; &amp; &quot;Bratislava&quot;" \/>/, 'escapované');
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, /<meta property="og:image:width" content="1200" \/>/);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(html, /http-equiv="refresh"/, 'crawler Facebooku nasleduje meta refresh a skončil by na koreni bez OG značiek');
  assert.match(html, /location\.replace\("https:\/\/oko\.uhrin\.digital\/#v=2&lat=48\.15&lon=17\.11"\)/, 'človek s JS ide do aplikácie');
  assert.match(html, /<a href="https:\/\/oko\.uhrin\.digital\/#v=2&amp;lat=48\.15&amp;lon=17\.11">/, 'bez JS ostáva odkaz');
  assert.doesNotMatch(html, /<SWR11H>/);
  assert.equal(escapeHtml(`<a href='x'>&</a>`), '&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
});

test('createShareStore: uloží json + jpg, číta späť, nevalidné id null, retencia maže staré, id sa neopakuje', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-share-'));
  let nowMs = Date.UTC(2026, 8, 14, 12);
  const ids = ['AAAAAAAAAA', 'AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC'];
  const store = createShareStore({ dir, now: () => nowMs, idFactory: () => ids.shift() || makeShareId() });
  const value = validateSharePayload(validBody()).value;
  const first = store.save(value);
  assert.equal(first.id, 'AAAAAAAAAA');
  assert.equal(first.imageBytes, JPEG.length);
  assert.ok(existsSync(path.join(dir, 'AAAAAAAAAA.jpg')));
  const second = store.save(value);
  assert.equal(second.id, 'BBBBBBBBBB', 'kolízia id sa preskočí');
  assert.deepEqual(store.read('AAAAAAAAAA').title, 'OKO · SWR11H');
  assert.equal(store.read('AAAAAAAAAA').image, undefined, 'obrázok nie je v JSON');
  assert.equal(store.read('nope'), null);
  assert.equal(store.read('../x'), null);
  assert.equal(store.read('ZZZZZZZZZZ'), null);
  // retencia: po 91 dňoch sú oba preč, nový ostáva
  nowMs += 91 * 86_400_000;
  const third = store.save(value);
  assert.equal(third.id, 'CCCCCCCCCC');
  assert.equal(store.read('AAAAAAAAAA'), null, 'starý záznam zmazaný pri ukladaní');
  assert.equal(existsSync(path.join(dir, 'AAAAAAAAAA.jpg')), false, 'aj obrázok');
  assert.deepEqual(readdirSync(dir).sort(), ['CCCCCCCCCC.jpg', 'CCCCCCCCCC.json']);
  assert.equal(store.prune(nowMs + 100 * 86_400_000), 1, 'ručné mazanie vracia počet');
  rmSync(dir, { recursive: true, force: true });
});

test('createShareStore: zverejnená udalosť (keep) retencia nemaže, verejný POST si keep nastaviť nevie', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-share-keep-'));
  let nowMs = Date.UTC(2026, 8, 30, 12);
  const ids = ['KEEPKEEP01', 'PLAINPLAIN'];
  const store = createShareStore({ dir, now: () => nowMs, idFactory: () => ids.shift() || makeShareId() });
  const value = validateSharePayload({ ...validBody(), keep: true }).value;
  assert.equal(value.keep, undefined, 'verejné telo s keep: true neprejde — trvalé záznamy len zo servera');
  const kept = store.save({ ...value, keep: true });
  const plain = store.save(value);
  assert.equal(kept.keep, true);
  assert.equal(plain.keep, undefined);
  nowMs += 400 * 86_400_000;
  assert.equal(store.prune(nowMs), 1, 'zmazaný len obyčajný záznam');
  assert.equal(store.read('PLAINPLAIN'), null);
  assert.equal(store.read('KEEPKEEP01').keep, true, 'odkaz v príspevku ostáva platný aj po roku');
  assert.ok(existsSync(path.join(dir, 'KEEPKEEP01.jpg')));
  // Stiahnutie udalosti vlastníkom: záznam aj obrázok preč, /s/<id> potom 404.
  assert.equal(store.remove('../KEEPKEEP01'), false, 'nevalidné id nič nemaže');
  assert.equal(store.remove('KEEPKEEP01'), true);
  assert.equal(store.read('KEEPKEEP01'), null);
  assert.equal(existsSync(path.join(dir, 'KEEPKEEP01.jpg')), false);
  assert.equal(store.remove('KEEPKEEP01'), false, 'druhé zmazanie nič nenájde');
  rmSync(dir, { recursive: true, force: true });
});
