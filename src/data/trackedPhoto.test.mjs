// src/data/trackedPhoto.test.mjs
// Fotka sledovaného lietadla (Planespotters Photo API, 2026-09-05). Testy
// strážia podmienky zdroja: klientsky fetch, 24 h cache JSON (aj prázdny
// výsledok), <a> bez nofollow na stránku fotky, viditeľný kredit fotografa,
// žiadny serverový proxy; a ukotvenie pod kartou s preklopením pri okraji.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLANESPOTTERS_PHOTO_API,
  PHOTO_CACHE_TTL_MS,
  PHOTO_OVERLAP_PX,
  planespottersUrlForHex,
  parsePlanespottersPhoto,
  isPhotoCacheFresh,
  photoPlacement,
  photoVisibility,
  PHOTO_MIN_CARD_ALPHA,
  PHOTO_MIN_CARD_SCALE,
} from './trackedPhoto.js';

const RESPONSE = {
  photos: [{
    id: '1948036',
    thumbnail: { src: 'https://t.plnspttrs.net/48683/1948036_b79e755c4a_t.jpg', size: { width: 200, height: 112 } },
    thumbnail_large: { src: 'https://t.plnspttrs.net/48683/1948036_b79e755c4a_280.jpg', size: { width: 497, height: 280 } },
    link: 'https://www.planespotters.net/photo/1948036/d-aibd-lufthansa-airbus-a319-112?utm_source=api',
    photographer: 'Cornelius Grossmann',
  }],
};

test('foto: URL dopytu len pre platný 24-bitový hex', () => {
  assert.equal(planespottersUrlForHex('3C6444'), `${PLANESPOTTERS_PHOTO_API}3c6444`);
  assert.equal(planespottersUrlForHex(' 3c6444 '), `${PLANESPOTTERS_PHOTO_API}3c6444`);
  assert.equal(planespottersUrlForHex('3c64'), null);
  assert.equal(planespottersUrlForHex('zz6444'), null);
  assert.equal(planespottersUrlForHex(''), null);
  assert.match(PLANESPOTTERS_PHOTO_API, /^https:\/\/api\.planespotters\.net\/pub\/photos\/hex\/$/);
});

test('foto: parser berie prvú použiteľnú fotku — náhľad, odkaz z odpovede nezmenený, fotograf', () => {
  const photo = parsePlanespottersPhoto(RESPONSE);
  assert.deepEqual(photo, {
    src: 'https://t.plnspttrs.net/48683/1948036_b79e755c4a_t.jpg',
    width: 200,
    height: 112,
    link: 'https://www.planespotters.net/photo/1948036/d-aibd-lufthansa-airbus-a319-112?utm_source=api',
    photographer: 'Cornelius Grossmann',
  });
  assert.equal(parsePlanespottersPhoto({ photos: [] }), null, 'prázdny výsledok je bežný stav, nie chyba');
  assert.equal(parsePlanespottersPhoto(null), null);
  assert.equal(parsePlanespottersPhoto({ photos: [{ thumbnail: { src: 'http://insecure/x.jpg' }, link: 'https://x' }] }), null, 'len https');
  assert.equal(parsePlanespottersPhoto({ photos: [{ link: 'https://x' }] }), null);
});

test('foto: cache JSON platí najviac 24 h (podmienka API), budúcnosť ani poškodený záznam neplatí', () => {
  const now = 1_800_000_000_000;
  assert.equal(PHOTO_CACHE_TTL_MS, 24 * 3600 * 1000);
  assert.equal(isPhotoCacheFresh({ at: now - 1000 }, now), true);
  assert.equal(isPhotoCacheFresh({ at: now - PHOTO_CACHE_TTL_MS + 1 }, now), true);
  assert.equal(isPhotoCacheFresh({ at: now - PHOTO_CACHE_TTL_MS }, now), false);
  assert.equal(isPhotoCacheFresh({ at: now + 60_000 }, now), false);
  assert.equal(isPhotoCacheFresh({ at: 'x' }, now), false);
  assert.equal(isPhotoCacheFresh(null, now), false);
});

test('foto: pás sedí na spodku karty — rovnaká šírka, prekrýva zaoblenie; pri spodnom okraji sa prilepí zhora', () => {
  const size = { w: 200, h: 68 };
  const view = { w: 1000, h: 800 };
  assert.deepEqual(photoPlacement({ x: 400, y: 100, w: 240, h: 80 }, size, view), { x: 400, y: 180 - PHOTO_OVERLAP_PX, w: 240, above: false });
  const flipped = photoPlacement({ x: 400, y: 740, w: 240, h: 80 }, size, view);
  assert.deepEqual(flipped, { x: 400, y: 740 - 68 + PHOTO_OVERLAP_PX, w: 240, above: true }, 'nad kartou, prilepený zhora');
  assert.equal(photoPlacement({ x: 10, y: 10, w: 180.4, h: 40 }, size, view).w, 180, 'šírka = šírka karty, celé px');
});

test('foto: viditeľnosť podľa hostiteľa — bledá alebo zmenšená karta (pohľad na svet) pás skryje, inak škálovaný rect + opacity', () => {
  assert.equal(photoVisibility(null), null);
  assert.equal(photoVisibility({ x: 0, y: 0, w: 200, h: 80, alpha: PHOTO_MIN_CARD_ALPHA - 0.01, paintScale: 1 }), null, 'karta takmer neviditeľná → bez pásu');
  assert.equal(photoVisibility({ x: 0, y: 0, w: 200, h: 80, alpha: 1, paintScale: PHOTO_MIN_CARD_SCALE - 0.01 }), null, 'karta zmenšená na diaľku → bez pásu');
  assert.deepEqual(photoVisibility({ x: 10, y: 20, w: 200, h: 80, alpha: 0.8, paintScale: 0.9 }), { x: 10, y: 20, w: 180, h: 72, opacity: 0.8 }, 'škálovaný rect, opacity karty');
  assert.deepEqual(photoVisibility({ x: 10, y: 20, w: 200, h: 80 }), { x: 10, y: 20, w: 200, h: 80, opacity: 1 }, 'hostiteľ bez polí = plná karta');
});

test('foto: lifecycle s DOM dvojníkom — fetch len pri zmene hexu, cache aj prázdneho výsledku, <a rel=noopener> bez nofollow, kredit ako text', async () => {
  const mod = await import('./trackedPhoto.js');
  mod._resetTrackedPhotoForTest();
  // Minimalistický DOM dvojník: dosť na createElement/appendChild/hidden/style.
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', classList: { toggle() {} }, attrs: {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { const p = this.parentNode; if (p) p.children = p.children.filter((c) => c !== this); },
    get offsetWidth() { return 208; }, get offsetHeight() { return 132; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, defaultView: { innerWidth: 1000, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  const listeners = [];
  const viewer = { scene: { postRender: { addEventListener: (fn) => listeners.push(fn), removeEventListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } } } };
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); return { ok: true, json: async () => (url.endsWith('3c6444') ? RESPONSE : { photos: [] }) }; };
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  let now = 1_800_000_000_000;

  // Hostiteľ: aktívny tracked záznam + jeho obdĺžnik sa podstrčia cez moduly,
  // ktoré trackedPhoto číta — tu cez ich testovacie seams.
  const readout = await import('./trackedReadout.js');
  // trackedReadout registruje okenné udalosti výberu — v Node stačí tichý dvojník.
  const hadWindow = typeof globalThis.window !== 'undefined';
  if (!hadWindow) globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const entity = { gevTrackedId: 'flights:3c6444', gevLabelModel: { title: 'DLH1', details: [] }, gevDisplayPosition: () => null };
  const host = { setEntries() {}, setVisible() {}, clearSource() {} };
  readout._setTrackedOverlayHostForTest(host);
  readout.initTrackedReadout({ trackedEntity: entity, trackedEntityChanged: { addEventListener: () => () => {} } });
  assert.equal(readout.getActiveTrackedReadoutId(), 'flights:3c6444');

  mod.installTrackedPhoto(viewer, { container, fetchImpl, storage, now: () => now });
  assert.equal(listeners.length, 1, 'jeden postRender listener');
  const root = container.children[0];
  assert.equal(root.tagName, 'a');
  assert.equal(root.rel, 'noopener', 'ZÁMERNE bez nofollow — podmienka Planespotters');
  assert.equal(root.target, '_blank');

  listeners[0]();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(fetched, [`${PLANESPOTTERS_PHOTO_API}3c6444`]);
  let state = mod._getTrackedPhotoStateForTest();
  assert.equal(state.photo?.photographer, 'Cornelius Grossmann');
  assert.equal(state.href, RESPONSE.photos[0].link, 'odkaz z odpovede nezmenený');
  assert.match(state.credit, /Cornelius Grossmann/);
  assert.match(state.credit, /Planespotters\.net/);
  assert.ok(store.has('oko-planespotters:3c6444'), 'JSON cache v localStorage');

  // Bez obdĺžnika karty (hostiteľ ju v tomto snímku nenamaľoval) ostáva skrytá.
  listeners[0]();
  assert.equal(mod._getTrackedPhotoStateForTest().hidden, true);
  assert.equal(fetched.length, 1, 'ten istý hex = žiadny ďalší dopyt');

  // Iný stroj bez fotky: prázdny výsledok sa cachuje rovnako.
  entity.gevTrackedId = 'flights:aaaaaa';
  readout.refreshTrackedReadout(entity);
  listeners[0]();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetched.length, 2);
  assert.equal(mod._getTrackedPhotoStateForTest().photo, null);
  assert.equal(JSON.parse(store.get('oko-planespotters:aaaaaa')).photo, null);
  entity.gevTrackedId = 'flights:3c6444';
  readout.refreshTrackedReadout(entity);
  listeners[0]();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetched.length, 2, 'späť na prvý stroj = z cache, bez fetchu');

  // Po 24 h cache exspiruje → nový dopyt.
  now += PHOTO_CACHE_TTL_MS + 1;
  entity.gevTrackedId = 'flights:aaaaaa';
  readout.refreshTrackedReadout(entity);
  listeners[0]();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetched.length, 3);

  // Iná vrstva (satelit) → fotka mimo, žiadny dopyt.
  entity.gevTrackedId = 'satellites:25544';
  readout.refreshTrackedReadout(entity);
  listeners[0]();
  await new Promise((r) => setTimeout(r, 0));
  state = mod._getTrackedPhotoStateForTest();
  assert.equal(state.hidden, true);
  assert.equal(state.currentHex, null);
  assert.equal(fetched.length, 3);

  mod.destroyTrackedPhoto();
  assert.equal(listeners.length, 0, 'listener odhlásený');
  assert.equal(container.children.length, 0);
  readout.destroyTrackedReadout();
  readout._setTrackedOverlayHostForTest(null);
  if (!hadWindow) delete globalThis.window;
  mod._resetTrackedPhotoForTest();
});

test('foto: tripwire — žiadny serverový proxy pre planespotters, zdroj v DATA_SOURCES, kredit, i18n EN+SK, CSS, ui wiring', () => {
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  // Komentár o licenčnom rozhodnutí planespotters spomína — kód nesmie: žiadny
  // proxy endpoint ani serverový fetch na ich API.
  assert.ok(!/api\.planespotters\.net|\/api\/planespotters|plnspttrs/i.test(vite), 'podmienky API: obrázky a JSON ťahá prehliadač, nie server');
  const sources = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(sources, /Planespotters\.net Photo API/);
  assert.match(sources, /browser-only/);
  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'planespotters'/);
  const i18n = readFileSync(new URL('../i18nStrings.js', import.meta.url), 'utf8');
  assert.match(i18n, /'photo\.credit': 'Photo \{name\} · Planespotters\.net'/);
  assert.match(i18n, /'photo\.credit': 'Foto \{name\} · Planespotters\.net'/);
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.tracked-photo-credit/);
  // `display: flex` prebíja UA pravidlo pre [hidden] — bez explicitného
  // `display: none` ostal prázdny pás natrvalo v ľavom hornom rohu
  // (nález 2026-09-05). Rovnaká pasca čaká na každý skrývaný flex prvok.
  assert.match(css, /\.tracked-photo\[hidden\]\s*\{\s*display:\s*none/, 'skrytý pás sa naozaj nekreslí');
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /installTrackedPhoto\(viewer, \{ container: document\.body \}\)/);
  assert.match(ui, /destroyTrackedPhoto\(\);/);
  const src = readFileSync(new URL('./trackedPhoto.js', import.meta.url), 'utf8');
  assert.match(src, /root\.rel = 'noopener'/);
  assert.ok(!/nofollow'/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'kód nikdy nenastaví nofollow');
});

test('foto: zlyhaný dopyt (CORS/sieť/403) dostane cooldown — ten istý hex sa neskúša dookola, po cooldowne áno', async () => {
  const mod = await import('./trackedPhoto.js');
  const { PHOTO_FAILURE_COOLDOWN_MS } = mod;
  mod._resetTrackedPhotoForTest();
  const makeEl = (tag) => ({ tagName: tag, children: [], style: {}, hidden: false, className: '', classList: { toggle() {} }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, remove() {}, get offsetWidth() { return 208; }, get offsetHeight() { return 132; }, ownerDocument: null });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, defaultView: { innerWidth: 1000, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  const listeners = [];
  const viewer = { scene: { postRender: { addEventListener: (fn) => listeners.push(fn), removeEventListener: () => {} } } };
  let attempts = 0;
  const fetchImpl = async () => { attempts += 1; throw new TypeError('Failed to fetch'); };
  let now = 1_800_000_000_000;
  const readout = await import('./trackedReadout.js');
  const hadWindow = typeof globalThis.window !== 'undefined';
  if (!hadWindow) globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const entity = { gevTrackedId: 'flights:3c6444', gevLabelModel: { title: 'DLH1', details: [] }, gevDisplayPosition: () => null };
  readout._setTrackedOverlayHostForTest({ setEntries() {}, setVisible() {}, clearSource() {} });
  readout.initTrackedReadout({ trackedEntity: entity, trackedEntityChanged: { addEventListener: () => () => {} } });
  const realInfo = console.info; const infos = []; console.info = (...a) => infos.push(a.join(' '));
  try {
    mod.installTrackedPhoto(viewer, { container, fetchImpl, storage: null, now: () => now });
    listeners[0](); await new Promise((r) => setTimeout(r, 0));
    assert.equal(attempts, 1);
    assert.equal(infos.length, 1, 'jedno hlásenie na session');
    assert.match(infos[0], /CORS/);
    // Iný stroj a späť — ten istý hex v cooldowne sa neskúša.
    entity.gevTrackedId = 'flights:aaaaaa'; readout.refreshTrackedReadout(entity); listeners[0](); await new Promise((r) => setTimeout(r, 0));
    entity.gevTrackedId = 'flights:3c6444'; readout.refreshTrackedReadout(entity); listeners[0](); await new Promise((r) => setTimeout(r, 0));
    assert.equal(attempts, 2, 'nový hex = pokus, starý hex v cooldowne = bez pokusu');
    assert.equal(infos.length, 1, 'druhé zlyhanie už nehlási');
    now += PHOTO_FAILURE_COOLDOWN_MS + 1;
    entity.gevTrackedId = 'flights:aaaaaa'; readout.refreshTrackedReadout(entity); listeners[0](); await new Promise((r) => setTimeout(r, 0));
    entity.gevTrackedId = 'flights:3c6444'; readout.refreshTrackedReadout(entity); listeners[0](); await new Promise((r) => setTimeout(r, 0));
    assert.equal(attempts, 4, 'po cooldowne sa skúšajú znova oba hexy (aaaaaa aj 3c6444)');
    assert.equal(mod._getTrackedPhotoStateForTest().hidden, true);
  } finally {
    console.info = realInfo;
    mod.destroyTrackedPhoto();
    readout.destroyTrackedReadout();
    readout._setTrackedOverlayHostForTest(null);
    if (!hadWindow) delete globalThis.window;
    mod._resetTrackedPhotoForTest();
  }
});
