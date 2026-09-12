// src/data/contactLogos.test.mjs
// Logá na karte, klient (2026-09-12): cache s TTL, onDone po fetchi, 503 vypne,
// výber lôg pre stroj, obrázky s listenerom, kreslenie s pomerom strán.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGO_CACHE_TTL_MS, LOGO_HEIGHT_PX, LOGO_MAX_WIDTH_PX,
  _resetContactLogosForTest, cachedContactLogo, contactLogosFor, getLogoImage, logoDrawSize, logoKey, paintLogo,
  requestContactLogo, requestContactLogos, setLogoReadyListener,
} from './contactLogos.js';

const NOW = 1_800_000_000_000;
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const META = { ok: true, title: 'Eurowings', file: 'Eurowings Logo.svg', license: 'Public domain', author: '', url: '/api/logo/img/abc.png', width: 240, height: 60 };

test('requestContactLogo: dopyt na /api/logo, cache 24 h, onDone po fetchi, zamietnuté logo = null bez opakovania do TTL', async () => {
  _resetContactLogosForTest();
  const urls = [];
  let done = 0;
  const fetcher = async (url) => { urls.push(url); return okResponse(url.includes('Eurowings') ? META : { ok: false, reason: 'no_logo' }); };
  assert.equal(await requestContactLogo('airline', 'Eurowings', { fetcher, onDone: () => { done += 1; }, nowMs: NOW }), true);
  assert.equal(new URL(urls[0], 'http://x').searchParams.get('kind'), 'airline');
  assert.equal(new URL(urls[0], 'http://x').searchParams.get('name'), 'Eurowings');
  assert.equal(done, 1);
  assert.deepEqual(cachedContactLogo('airline', 'eurowings'), { kind: 'airline', name: 'Eurowings', title: 'Eurowings', file: 'Eurowings Logo.svg', license: 'Public domain', author: '', url: '/api/logo/img/abc.png', width: 240, height: 60 }, 'kľúč je bez ohľadu na veľkosť písmen');
  assert.equal(await requestContactLogo('airline', 'Eurowings', { fetcher, nowMs: NOW + 1000 }), false, 'v TTL bez dopytu');
  assert.equal(await requestContactLogo('airline', 'Eurowings', { fetcher, nowMs: NOW + LOGO_CACHE_TTL_MS + 1 }), true, 'po TTL znova');
  assert.equal(await requestContactLogo('airline', 'Nikto', { fetcher, onDone: () => { done += 1; }, nowMs: NOW }), true);
  assert.equal(cachedContactLogo('airline', 'Nikto'), null, 'bez loga = null');
  assert.equal(done, 2, 'onDone aj po zamietnutí (karta sa prebuduje raz); obnova po TTL bola bez onDone');
  assert.equal(await requestContactLogo('airline', 'Nikto', { fetcher, nowMs: NOW + 1000 }), false, 'negatívna cache');
  assert.equal(await requestContactLogo('airline', '', { fetcher, nowMs: NOW }), false);
  assert.equal(logoKey('manufacturer', '  Airbus '), 'manufacturer:airbus');
});

test('requestContactLogo: chyba drží staré metadáta; 503 (proxy vypnutá) zastaví ďalšie dopyty', async () => {
  _resetContactLogosForTest();
  let calls = 0;
  const flaky = async () => { calls += 1; return calls === 1 ? okResponse(META) : { ok: false, status: 500 }; };
  assert.equal(await requestContactLogo('airline', 'Eurowings', { fetcher: flaky, nowMs: NOW }), true);
  assert.equal(await requestContactLogo('airline', 'Eurowings', { fetcher: flaky, nowMs: NOW + LOGO_CACHE_TTL_MS + 1 }), false);
  assert.equal(cachedContactLogo('airline', 'Eurowings')?.url, '/api/logo/img/abc.png', 'po chybe ostáva posledné známe');
  _resetContactLogosForTest();
  let asked = 0;
  const off = async () => { asked += 1; return { ok: false, status: 503, json: async () => ({ error: 'disabled' }) }; };
  assert.equal(await requestContactLogo('airline', 'Eurowings', { fetcher: off, nowMs: NOW }), false);
  assert.equal(await requestContactLogo('manufacturer', 'Airbus', { fetcher: off, nowMs: NOW }), false);
  assert.equal(asked, 1, '503 = vypnuté, druhý dopyt už nejde');
  _resetContactLogosForTest();
});

test('contactLogosFor a requestContactLogos: dopravca podľa mena, výrobca z typu; nič = null', async () => {
  _resetContactLogosForTest();
  const fetcher = async (url) => okResponse(url.includes('kind=manufacturer') ? { ...META, title: 'Airbus', url: '/api/logo/img/airbus.png', width: 300, height: 60 } : META);
  assert.equal(contactLogosFor({ airline: 'Eurowings', typeName: 'Airbus A319 132' }), null, 'pred fetchom nič');
  await requestContactLogos({ airline: 'Eurowings', typeName: 'Airbus A319 132' }, { fetcher, nowMs: NOW });
  const logos = contactLogosFor({ airline: 'Eurowings', typeName: 'Airbus A319 132' });
  assert.equal(logos.airline.title, 'Eurowings');
  assert.equal(logos.manufacturer.title, 'Airbus');
  assert.equal(contactLogosFor({ airline: '', typeName: 'TR-3B' }), null);
  assert.deepEqual(contactLogosFor({ airline: 'Eurowings', typeName: '' }), { airline: logos.airline, manufacturer: null });
});

test('getLogoImage, logoDrawSize a paintLogo: obrázok raz, listener po načítaní, šírka z pomeru strán so stropom, placeholder kým sa ťahá', () => {
  _resetContactLogosForTest();
  const images = [];
  const factory = () => { const img = { onload: null, onerror: null }; images.push(img); return img; };
  let ready = 0;
  setLogoReadyListener(() => { ready += 1; });
  const meta = { url: '/api/logo/img/abc.png', width: 240, height: 60 };
  const entry = getLogoImage(meta, { imageFactory: factory });
  assert.equal(getLogoImage(meta, { imageFactory: factory }), entry, 'jeden obrázok na URL');
  assert.equal(images.length, 1);
  assert.equal(images[0].src, '/api/logo/img/abc.png');
  assert.deepEqual(logoDrawSize(meta), { w: 56, h: LOGO_HEIGHT_PX }, '4:1 pri 14 px = 56 px');
  assert.deepEqual(logoDrawSize({ url: 'x', width: 2000, height: 100 }), { w: LOGO_MAX_WIDTH_PX, h: 5 + 1 }, 'extrémne široké logo sa zníži, nie roztiahne');
  assert.deepEqual(logoDrawSize({ url: 'x' }), { w: 42, h: LOGO_HEIGHT_PX }, 'bez rozmerov 3:1');
  const calls = [];
  const ctx = { drawImage: (...a) => calls.push(['drawImage', ...a]), fillRect: (...a) => calls.push(['fillRect', ...a]), save() {}, restore() {}, set fillStyle(v) { calls.push(['fillStyle', v]); } };
  assert.equal(paintLogo(ctx, meta, 10, 20), 56);
  assert.equal(calls.find((c) => c[0] === 'fillRect')?.[1], 10, 'kým sa obrázok ťahá, tichý obdĺžnik');
  images[0].onload();
  assert.equal(ready, 1, 'listener po načítaní');
  calls.length = 0;
  paintLogo(ctx, meta, 10, 20);
  const plate = calls.find((c) => c[0] === 'fillRect');
  assert.deepEqual(plate, ['fillRect', 8, 18, 60, LOGO_HEIGHT_PX + 4], 'svetlá doštička 2 px okolo načítaného loga (tmavé logá na tmavej karte)');
  assert.ok(calls.some((c) => c[0] === 'fillStyle' && String(c[1]).startsWith('rgba(255, 255, 255, 0.9')), 'doštička je biela');
  assert.deepEqual(calls.find((c) => c[0] === 'drawImage'), ['drawImage', images[0], 10, 20, 56, LOGO_HEIGHT_PX]);
  assert.equal(paintLogo(ctx, null, 0, 0), 0);
  _resetContactLogosForTest();
});
