// src/data/airportPhoto.test.mjs
// Fotka letiska z Wikipédie/Commons (2026-09-05): parsery odpovedí API,
// rozpoznanie slobodnej licencie, kredit, cache a lifecycle fetchu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AIRPORT_PHOTO_CACHE_TTL_MS,
  fetchAirportPhoto,
  imageInfoApiUrl,
  isFreeLicense,
  pageImageApiUrl,
  parseImageInfo,
  parsePageImage,
  photoCreditText,
  stripHtml,
  wikipediaTitleFromUrl,
  _resetAirportPhotoCacheForTest,
} from './airportPhoto.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const t = (key, vars) => { let s = EN_STRINGS[key] || key; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v)); return s; };

const PAGE_JSON = { batchcomplete: '', query: { normalized: [{ from: 'Bratislava_Airport', to: 'Bratislava Airport' }], pages: { 1534689: { pageid: 1534689, ns: 0, title: 'Bratislava Airport', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/BRATISLAVSK%C3%9D_TERMIN%C3%81L_-_panoramio.jpg/500px-BRATISLAVSK%C3%9D_TERMIN%C3%81L_-_panoramio.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail', width: 480, height: 360 }, original: { source: 'https://upload.wikimedia.org/x.jpg' }, pageimage: 'BRATISLAVSKÝ_TERMINÁL_-_panoramio.jpg' } } } };
const INFO_JSON = { query: { pages: { '-1': { ns: 6, title: 'File:BRATISLAVSKÝ TERMINÁL - panoramio.jpg', imagerepository: 'shared', imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/x.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:BRATISLAVSK%C3%9D_TERMIN%C3%81L_-_panoramio.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 3.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' }, Artist: { value: '<a rel="nofollow" href="http://www.panoramio.com/user/1">Jozef Kotulič</a>' }, AttributionRequired: { value: 'true' } } }] } } } };

test('wiki: názov článku z odkazu — jazyk, dekódovanie, mobilná doména, nič pre cudzie URL', () => {
  assert.deepEqual(wikipediaTitleFromUrl('https://en.wikipedia.org/wiki/Bratislava_Airport'), { lang: 'en', title: 'Bratislava_Airport' });
  assert.deepEqual(wikipediaTitleFromUrl('https://sk.m.wikipedia.org/wiki/Letisko_M._R._%C5%A0tef%C3%A1nika#Hist%C3%B3ria'), { lang: 'sk', title: 'Letisko_M._R._Štefánika' });
  assert.equal(wikipediaTitleFromUrl('https://www.bts.aero/'), null);
  assert.equal(wikipediaTitleFromUrl(null), null);
  const pageUrl = pageImageApiUrl({ lang: 'en', title: 'Bratislava_Airport' });
  assert.match(pageUrl, /^https:\/\/en\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(pageUrl, /prop=pageimages/);
  assert.match(pageUrl, /origin=\*/, 'CORS: origin=* (URLSearchParams hviezdičku nekóduje)');
  assert.match(imageInfoApiUrl({ lang: 'en', file: 'A b.jpg' }), /titles=File%3AA\+b\.jpg/);
});

test('wiki: parser hlavného obrázka — súbor + náhľad bez utm sledovania, len upload.wikimedia.org', () => {
  const img = parsePageImage(PAGE_JSON);
  assert.equal(img.file, 'BRATISLAVSKÝ_TERMINÁL_-_panoramio.jpg');
  assert.equal(img.thumb, 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/BRATISLAVSK%C3%9D_TERMIN%C3%81L_-_panoramio.jpg/500px-BRATISLAVSK%C3%9D_TERMIN%C3%81L_-_panoramio.jpg');
  assert.equal(img.width, 480);
  assert.equal(parsePageImage({ query: { pages: { '-1': { missing: '' } } } }), null);
  assert.equal(parsePageImage({ query: { pages: { 1: { pageimage: 'x.jpg', thumbnail: { source: 'https://evil.example/x.jpg' } } } } }), null, 'len Wikimedia hosting');
  assert.equal(parsePageImage(null), null);
});

test('wiki: licencia a autor — HTML odstránené, slobodná licencia rozpoznaná, fair use odmietnutý', () => {
  const info = parseImageInfo(INFO_JSON);
  assert.deepEqual(info, {
    artist: 'Jozef Kotulič',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
    filePage: 'https://commons.wikimedia.org/wiki/File:BRATISLAVSK%C3%9D_TERMIN%C3%81L_-_panoramio.jpg',
    free: true,
  });
  assert.equal(stripHtml('<b>A</b> &amp; B  '), 'A &amp; B');
  for (const ok of ['CC BY-SA 4.0', 'CC BY 2.0', 'Public domain', 'CC0', 'GFDL', 'Attribution']) assert.equal(isFreeLicense(ok), true, ok);
  for (const no of ['Fair use', 'Non-free logo', '', undefined, 'All rights reserved']) assert.equal(isFreeLicense(no), false, String(no));
  assert.equal(parseImageInfo({ query: { pages: { 1: { imageinfo: [{ extmetadata: { LicenseShortName: { value: 'Fair use' } } }] } } } }).free, false);
  assert.equal(parseImageInfo({ query: { pages: {} } }), null);
});

test('wiki: kredit pod fotkou nesie autora a licenciu; bez nich poctivé „neznámy"', () => {
  assert.equal(photoCreditText({ artist: 'Jozef Kotulič', license: 'CC BY-SA 3.0' }, t), 'Photo: Jozef Kotulič · CC BY-SA 3.0 · Wikimedia Commons');
  assert.equal(photoCreditText({ artist: '', license: 'Public domain' }, t), 'Photo: Public domain · Wikimedia Commons');
  assert.equal(photoCreditText({}, t), `Photo: ${EN_STRINGS['airport.photo-credit-unknown']} · Wikimedia Commons`);
  for (const key of ['airport.photo-credit', 'airport.photo-credit-unknown']) { assert.ok(EN_STRINGS[key]); assert.ok(SK_STRINGS[key]); }
});

test('wiki: fetch — dva dopyty (obrázok, licencia), cache 7 dní aj negatívna, fair use = null, chyba siete = null bez cache', async () => {
  _resetAirportPhotoCacheForTest();
  const calls = [];
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('prop=pageimages')) return { ok: true, json: async () => PAGE_JSON };
    return { ok: true, json: async () => INFO_JSON };
  };
  let now = 1_800_000_000_000;
  const photo = await fetchAirportPhoto('https://en.wikipedia.org/wiki/Bratislava_Airport', { fetchImpl, storage, now });
  assert.equal(calls.length, 2);
  assert.equal(photo.artist, 'Jozef Kotulič');
  assert.equal(photo.license, 'CC BY-SA 3.0');
  assert.match(photo.thumb, /^https:\/\/upload\.wikimedia\.org\//);
  assert.equal(photo.articleUrl, 'https://en.wikipedia.org/wiki/Bratislava_Airport');
  assert.ok(store.has('oko-wikiphoto:en:Bratislava_Airport'));
  await fetchAirportPhoto('https://en.wikipedia.org/wiki/Bratislava_Airport', { fetchImpl, storage, now: now + 1000 });
  assert.equal(calls.length, 2, 'z cache');
  now += AIRPORT_PHOTO_CACHE_TTL_MS + 1;
  await fetchAirportPhoto('https://en.wikipedia.org/wiki/Bratislava_Airport', { fetchImpl, storage, now });
  assert.equal(calls.length, 4, 'po 7 dňoch znova');
  // Fair use → null a negatívna cache.
  const unfree = async (url) => (url.includes('prop=pageimages') ? { ok: true, json: async () => PAGE_JSON } : { ok: true, json: async () => ({ query: { pages: { 1: { imageinfo: [{ extmetadata: { LicenseShortName: { value: 'Fair use' } } }] } } } }) });
  assert.equal(await fetchAirportPhoto('https://en.wikipedia.org/wiki/Some_Logo_Article', { fetchImpl: unfree, storage, now }), null);
  assert.equal(JSON.parse(store.get('oko-wikiphoto:en:Some_Logo_Article')).photo, null);
  // Sieťová chyba → null bez cache (ďalší klik skúsi znova).
  assert.equal(await fetchAirportPhoto('https://en.wikipedia.org/wiki/Other', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, storage, now }), null);
  assert.equal(store.has('oko-wikiphoto:en:Other'), false);
  assert.equal(await fetchAirportPhoto(null, { fetchImpl, storage, now }), null);
  _resetAirportPhotoCacheForTest();
});

test('wiki: tripwire — karta letiska fotku používa, DATA_SOURCES a kredit poznajú Wikimedia Commons', () => {
  const card = readFileSync(new URL('./airportCard.js', import.meta.url), 'utf8');
  assert.match(card, /fetchAirportPhoto\(/);
  assert.match(card, /airport-card-photo-credit/);
  const sources = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(sources, /Wikimedia Commons/);
  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'wikimedia-airport-photos'/);
});
