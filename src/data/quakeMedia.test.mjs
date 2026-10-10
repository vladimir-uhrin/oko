// Zábery k zemetraseniu len s licenciou: ShakeMap USGS, Commons (voľná licencia, po otrase, krajina v názve, nie mapy);
// výber zemetrasenia, ku ktorému Štúdio pripraví video.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commonsSearchUrl, pickCommonsMedia, shakemapImageUrl } from './quakeMedia.js';
import { quakeVideoCandidate } from './quakeVideo.js';

const page = (title, { mime = 'image/jpeg', ts = '2026-10-10T09:32:34Z', license = 'CC BY-SA 4.0', artist = '<a href="x">Earthquake Global</a>' } = {}) => ({
  title, imageinfo: [{ mime, timestamp: ts, url: `https://upload.wikimedia.org/${encodeURIComponent(title)}`, thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}`,
    descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`, extmetadata: { LicenseShortName: { value: license }, Artist: { value: artist } } }] });
const after = Date.parse('2026-10-09T17:56:06Z');

test('Commons: fotka z miesta s autorom a licenciou; mapy, iná krajina, staršie a bez licencie nie; video prednostne', () => {
  const json = { query: { pages: {
    1: page('File:Earthquake in Panama, Herrera on October 9, 2026.jpg'),
    2: page('File:2026-10-09 Pitaloza Arriba, Panama M7.7 earthquake shakemap (USGS).jpg', { license: 'Public domain' }),
    3: page('File:Pereira after the earthquake - WCK.jpg', { license: 'CC BY 4.0' }),
    4: page('File:Panama 2019 earthquake.jpg', { ts: '2019-05-13T00:00:00Z' }),
    5: page('File:Panama earthquake damage.jpg', { license: 'All rights reserved' }),
    6: page('File:Panama earthquake 2026 street.webm', { mime: 'video/webm', license: 'CC BY 4.0', artist: 'Reporter' }),
  } } };
  const out = pickCommonsMedia(json, { countryEn: 'Panama', afterMs: after });
  assert.deepEqual(out.map((m) => m.kind), ['video', 'photo']);
  assert.equal(out[1].credit, 'Foto: Earthquake Global · CC BY-SA 4.0 · Wikimedia Commons');
  assert.ok(out[1].url.includes('/thumb/'), 'fotka v náhľade 1280 px');
  assert.equal(out[0].credit, 'Video: Reporter · CC BY 4.0 · Wikimedia Commons');
  assert.ok(commonsSearchUrl('Panama', 2026).includes('gsrsearch=Panama+earthquake+2026'));
});

test('ShakeMap: obrázok intenzity z detailu USGS', () => {
  assert.equal(shakemapImageUrl({ properties: { products: { shakemap: [{ contents: { 'download/intensity.jpg': { url: 'https://usgs/intensity.jpg' } } }] } } }), 'https://usgs/intensity.jpg');
  assert.equal(shakemapImageUrl({ properties: { products: {} } }), null);
});

test('výber zemetrasenia na video: od M 6,5 alebo oranžový/červený PAGER od M 5,5, až po 45 min, nie dotras ani hotové', () => {
  const t0 = Date.parse('2026-10-09T17:56:00Z');
  const q = (id, mag, dt, lon, lat, alert = null) => ({ id, properties: { mag, time: t0 + dt, alert }, geometry: { coordinates: [lon, lat, 10] } });
  const feed = [q('main', 7.7, 0, -80.77, 7.59, 'red'), q('after', 6.6, 2.5 * 3600_000, -81.47, 7.72), q('jp', 5.8, 0, 142, 38, 'orange'), q('weak', 6.0, 0, 20, 40, 'green')];
  assert.equal(quakeVideoCandidate(feed, { now: t0 + 30 * 60_000 }), null, 'prvých 45 min nie');
  assert.equal(quakeVideoCandidate(feed, { now: t0 + 60 * 60_000 }).id, 'main');
  const done = new Set(['main']);
  assert.equal(quakeVideoCandidate(feed, { now: t0 + 4 * 3600_000, done: (id) => done.has(id) }).id, 'jp', 'dotras hotového otrasu nie; oranžový PAGER áno');
  done.add('jp');
  assert.equal(quakeVideoCandidate(feed, { now: t0 + 4 * 3600_000, done: (id) => done.has(id) }), null, 'M 6,0 so zeleným PAGER nie');
  assert.equal(quakeVideoCandidate(feed, { now: t0 + 30 * 3600_000 }), null, 'po 24 h nie');
});
