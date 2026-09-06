import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaPhotoSearchUrl, nearestAreaImage, createAreaPhotoLookup } from './earthquakeAreaPhoto.js';
import { earthquakeHoverModel, createEarthquakeHoverCard } from './earthquakeHoverCard.js';

const event = { id: 'USGS:1', mag: 4.2, lat: 48, lon: 18, place: 'Test region', association: 'probable',
  solutions: [{ source: 'USGS', sourceId: '1', mag: 4.2, magType: 'mw', lat: 48, lon: 18,
    depth: 12, time: 1700000000000, updated: 1700000060000, author: 'us', status: 'reviewed',
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/1' },
  { source: 'EMSC', sourceId: '2', mag: 4.4, lat: 48, lon: 18, depth: null, time: 1700000001000, stale: true }] };
const search = { query: { pages: { '1': { title: 'Nearby town', pageimage: 'Town.jpg',
  thumbnail: { source: 'https://upload.wikimedia.org/town.jpg' }, coordinates: [{ lat: 48.01, lon: 18 }] } } } };
const info = license => ({ query: { pages: { '2': { imageinfo: [{
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Town.jpg', extmetadata: {
    Artist: { value: '<a>Photographer</a>' }, LicenseShortName: { value: license },
    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  } }] } } } });
const response = json => ({ ok: true, json: async () => json });

test('hover exposes distinct source values, agency, timestamps, unknown depth and stale status', () => {
  const model = earthquakeHoverModel(event);
  assert.equal(model.solutions.length, 2); assert.equal(model.title, 'Test region');
  assert.match(JSON.stringify(model), /M4.2 mw/); assert.match(JSON.stringify(model), /M4.4/);
  assert.match(JSON.stringify(model), /2023-11-14/); assert.match(model.solutions[1].title, /cached/i);
  assert.equal(model.solutions[1].rows[1][1], '—');
});

test('area search is bounded to 10 km; nearest image requires coordinates and Wikimedia thumbnail', () => {
  assert.equal(areaPhotoSearchUrl(91, 0), null);
  assert.equal(new URL(areaPhotoSearchUrl(48, 18)).searchParams.get('ggsradius'), '10000');
  const photo = nearestAreaImage(search, 48, 18);
  assert.ok(photo.distanceKm > 1 && photo.distanceKm < 2);
  assert.equal(nearestAreaImage(search, -48, 18), null);
  assert.equal(nearestAreaImage({ query: { pages: { 1: { ...search.query.pages[1], thumbnail: { source: 'https://evil.example/image.jpg' } } } } }, 48, 18), null);
});

test('photo lookup supplies author/license and caches success and unavailable responses', async () => {
  let calls = 0;
  const lookup = createAreaPhotoLookup({ fetchImpl: async () => response(++calls === 1 ? search : info('CC BY-SA 4.0')) });
  const photo = await lookup(event); assert.equal(photo.artist, 'Photographer');
  assert.equal(photo.license, 'CC BY-SA 4.0'); assert.equal(await lookup(event), photo); assert.equal(calls, 2);
  let emptyCalls = 0;
  const empty = createAreaPhotoLookup({ fetchImpl: async () => { emptyCalls++; return response({}); } });
  assert.equal(await empty(event), null); assert.equal(await empty(event), null); assert.equal(emptyCalls, 1);
});

test('unlicensed pictures and failed/aborted lookups never supply a photo', async () => {
  let calls = 0;
  const lookup = createAreaPhotoLookup({ fetchImpl: async () => response(++calls === 1 ? search : info('Fair use')) });
  assert.equal(await lookup(event), null);
  const controller = new AbortController(); controller.abort();
  assert.equal(await lookup(event, { signal: controller.signal }), null);
  let failures = 0;
  const failed = createAreaPhotoLookup({ fetchImpl: async () => { failures++; throw new Error('offline'); } });
  assert.equal(await failed(event), null); assert.equal(await failed(event), null); assert.equal(failures, 1);
});

function dom() {
  class Element {
    children = []; style = {}; listeners = new Map(); offsetWidth = 370; offsetHeight = 600;
    appendChild(node) { this.children.push(node); node.parent = this; }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    contains(node) { return this === node || this.children.some(c => c.contains(node)); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name) { this.listeners.delete(name); }
    remove() { this.parent.children = this.parent.children.filter(c => c !== this); }
  }
  const doc = new Element(); doc.body = new Element(); doc.createElement = () => new Element();
  doc.documentElement = { clientWidth: 800, clientHeight: 700 };
  return doc;
}
function allText(node) { return [node.textContent || '', ...node.children.map(allText)].join(' '); }
test('card fits viewport, cancels dwell on leave and ignores a late photo from another event', async () => {
  const doc = dom(); let pending; let resolvePhoto; let calls = 0;
  const card = createEarthquakeHoverCard({ document: doc, setTimer: fn => { pending = fn; return 1; }, clearTimer: () => { pending = null; },
    lookupPhoto: async () => { calls++; return new Promise(resolve => { resolvePhoto = resolve; }); } });
  const root = doc.body.children[0]; card.show(event, { x: 790, y: 690 });
  assert.equal(root.style.left, '422px'); assert.equal(root.style.top, '92px');
  card.hide(); assert.equal(pending, null); assert.equal(calls, 0);
  card.show(event, { x: 100, y: 100 }); const completion = pending();
  card.show({ ...event, id: 'another', place: 'Another region' }, { x: 100, y: 100 });
  resolvePhoto({ title: 'OLD PHOTO' }); await completion;
  assert.match(allText(root), /Another region/); assert.doesNotMatch(allText(root), /OLD PHOTO/);
  card.destroy(); assert.equal(doc.body.children.length, 0); assert.equal(doc.listeners.size, 0);
});
