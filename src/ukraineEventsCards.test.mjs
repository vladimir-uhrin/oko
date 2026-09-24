// src/ukraineEventsCards.test.mjs — karty udalostí UKRAJINA (2026-09-24, používateľ
// zakrúžkoval prázdne rámčeky a prekryté karty: „oprav aj tie kartičky … nemusia byť
// také veľké"): malá karta predvolene, plná po výbere; žiadny prázdny rámček
// (textový príspevok nie je médium, video bez náhľadu = odkaz v pätičke); karty
// obchádzajú panely a navzájom sa neprekrývajú; značky kotiev pod kartami.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import { CARD_OBSTACLE_SELECTOR, MAX_CARDS, clearOfObstacles, compactTimeText, createUkraineEventsLayer, layoutCards, obstacleBoxes, pluralForm, showableMedia } from './ukraineEventsLayer.js';

// ── čisté časti ─────────────────────────────────────────────────────────────
test('obstacleBoxes: okno → kontajner, orez na výrez, mimo výrezu a prázdne preč', () => {
  const boxes = obstacleBoxes([
    { left: 16, top: 601, width: 975, height: 346 }, // os
    { left: 282, top: 879, width: 444, height: 62 }, // dok (celý pod osou, v okne)
    { left: 0, top: 2000, width: 300, height: 50 }, // mimo výrezu
    { left: 10, top: 10, width: 0, height: 40 }, // prázdny
  ], { left: 0, top: 0 }, { w: 1007, h: 960 });
  assert.deepEqual(boxes.map((b) => [b.x, b.y, b.w, b.h]), [[16, 601, 975, 346], [282, 879, 444, 62]]);
  const shifted = obstacleBoxes([{ left: 110, top: 60, width: 50, height: 50 }], { left: 100, top: 50 }, { w: 30, h: 30 });
  assert.deepEqual(shifted.map((b) => [b.x, b.y, b.w, b.h]), [[10, 10, 20, 20]], 'orez na výrez kontajnera');
  assert.match(CARD_OBSTACLE_SELECTOR, /\.oko-ukr-timeline/);
  assert.match(CARD_OBSTACLE_SELECTOR, /#command-dock/);
  assert.match(CARD_OBSTACLE_SELECTOR, /#left-panel-stack/);
});

test('layoutCards: karta obíde prekážku, bez miesta sa neukáže, kotva pod panelom = nič; vybraná vždy', () => {
  const viewport = { w: 800, h: 600 };
  const timeline = { x: 0, y: 450, w: 800, h: 150 };
  // Kotva tesne nad osou: „dole" by zakrylo os → iná poloha.
  const a = layoutCards([{ id: 'a', x: 400, y: 440, w: 200, h: 50 }], { viewport, obstacles: [timeline] }).get('a');
  assert.ok(a && a.y + a.h <= 450 - 4, `karta nad osou (${JSON.stringify(a)})`);
  // Kotva pod osou: neukáže sa (bod je aj tak pod panelom).
  assert.equal(layoutCards([{ id: 'b', x: 400, y: 500, w: 200, h: 50 }], { viewport, obstacles: [timeline] }).get('b'), null);
  // …okrem vybranej.
  assert.ok(layoutCards([{ id: 'b', x: 400, y: 500, w: 200, h: 50, selected: true }], { viewport, obstacles: [timeline] }).get('b'));
  // Dve karty na tom istom mieste: druhá ide inam, nikdy cez prvú.
  const two = layoutCards([{ id: 'p', x: 400, y: 300, w: 200, h: 50 }, { id: 'q', x: 400, y: 300, w: 200, h: 50 }], { viewport });
  const p = two.get('p'); const q = two.get('q');
  assert.ok(p && q);
  const overlap = !(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y);
  assert.equal(overlap, false);
  // Plno: ďalšia karta sa skryje (predtým ležala cez inú).
  const crowd = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, x: 400, y: 300, w: 200, h: 50 }));
  const res = layoutCards(crowd, { viewport: { w: 700, h: 420 } });
  const shown = [...res.values()].filter(Boolean);
  assert.ok(shown.length < 12 && [...res.values()].some((b) => b === null), 'niektoré sa nezmestia → skryté, nie cez seba');
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const s = shown[i]; const t = shown[j];
      assert.ok(s.x + s.w <= t.x || t.x + t.w <= s.x || s.y + s.h <= t.y || t.y + t.h <= s.y, 'žiadne dve zobrazené karty sa neprekrývajú');
    }
  }
  assert.equal(MAX_CARDS, 6);
});

test('showableMedia: čisto textový príspevok nie je médium; video/fotky áno', () => {
  assert.deepEqual(showableMedia([{ kind: 'text', provider: 'telegram', thumb: null }]), []);
  assert.equal(showableMedia([{ kind: 'video', provider: 'file', thumb: null, videoUrl: 'x.mp4' }]).length, 1);
  assert.equal(showableMedia([{ kind: 'photo', provider: 'telegram', photos: ['a', 'b'] }]).length, 1);
  assert.deepEqual(showableMedia(null), []);
});

test('CSS: značky a čiary pod čipmi, čipy pod kartami, vybraná navrchu; žiadny prázdny rámček médií', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const z = (selector) => {
    const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
    const m = re.exec(css);
    assert.ok(m, `pravidlo ${selector}`);
    const zm = /z-index:\s*(\d+)/.exec(m[1]);
    assert.ok(zm, `z-index v ${selector}`);
    return Number(zm[1]);
  };
  const pin = z('.oko-ukr-pin'); const line = z('.oko-ukr-line'); const chip = z('.oko-ukr-minichip');
  const card = z('.oko-ukr-card'); const hover = z('.oko-ukr-card.is-hover');
  const selected = z('.oko-ukr-card.is-selected');
  assert.ok(pin < chip && line < chip && chip < card && card < hover && hover < selected, `${pin}/${line} < ${chip} < ${card} < ${hover} < ${selected}`);
  assert.doesNotMatch(css, /\.oko-ukr-card-media\.is-noimg/, 'prázdny rámček bez obrázka sa už nekreslí');
  assert.match(css, /\.oko-ukr-card:not\(\.is-selected\) \.oko-ukr-card-media,/, 'malá karta bez médií');
  assert.match(css, /\.oko-ukr-card \{\n[^}]*width: 204px/, 'malá karta ~204 px');
  assert.match(css, /\.oko-ukr-card\.is-selected \{[^}]*width: 252px/, 'plná karta 252 px (bola 264)');
});

// ── DOM kariet (falošný dokument) ───────────────────────────────────────────
function fakeDocument() {
  const makeEl = (tag) => {
    const classes = new Set();
    const styleProps = {};
    const el = {
      tag, children: [], parent: null, textContent: '', hidden: false, dataset: {}, listeners: {}, title: '', type: '', src: '', alt: '',
      style: { setProperty: (k, v) => { styleProps[k] = v; }, removeProperty: (k) => { delete styleProps[k]; } },
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); el.children.push(c); c.parent = el; return c; },
      insertBefore(c, ref) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); const i = ref ? el.children.indexOf(ref) : -1; if (i < 0) el.children.push(c); else el.children.splice(i, 0, c); c.parent = el; return c; },
      replaceChildren(...cs) { el.children = [...cs]; for (const c of cs) c.parent = el; },
      remove() { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
      addEventListener(t, fn) { el.listeners[t] = fn; }, removeEventListener() {},
      querySelector(sel) { const cls = sel.replace(/^\./, ''); return walk(el).find((n) => n.classList.contains(cls)) || null; },
      contains(n) { for (let p = n; p; p = p.parent) if (p === el) return true; return false; },
      closest() { return null; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1007, height: 960 }),
      clientWidth: 1007, clientHeight: 960, offsetWidth: 0, offsetHeight: 0,
      get href() { return el._href || ''; }, set href(v) { el._href = v; },
    };
    return el;
  };
  return { createElement: makeEl, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], defaultView: null };
}
const walk = (node, out = []) => { for (const c of node.children) { out.push(c); walk(c, out); } return out; };
const byClass = (root, cls) => walk(root).filter((n) => n.classList.contains(cls));

function fakeViewer(doc) {
  const container = doc.createElement('div');
  container.ownerDocument = doc;
  const evt = () => ({ addEventListener() {}, removeEventListener() {} });
  return {
    container,
    scene: {
      primitives: { add: (p) => p, remove() {} },
      requestRender() {},
      mode: Cesium.SceneMode.SCENE3D,
      canvas: null,
      camera: {
        positionCartographic: { height: 90_000 },
        computeViewRectangle: () => Cesium.Rectangle.fromDegrees(36, 47, 39, 50),
      },
    },
    camera: { moveEnd: evt(), changed: evt() },
  };
}
const BASE = { t: Date.UTC(2026, 8, 24, 5, 0), dayOnly: false, precision: 'settlement', approx: true, severity: 'major', level: 'official', src: 'media', reports: 1, sources: [{ name: 'Kanál', url: 'https://t.me/x/1' }], noImage: false };

test('karty: malá predvolene; textový príspevok bez rámčeka; video bez náhľadu = odkaz; YouTube s náhľadom', () => {
  const doc = fakeDocument();
  const layer = createUkraineEventsLayer({ viewer: fakeViewer(doc), documentRef: doc, translate: (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k), lang: 'en', terrainSampler: null, translateTextImpl: null });
  layer.setEvents([
    { ...BASE, id: 'tg-text', type: 'alert', place: 'Borova', lat: 49.38, lon: 37.62, image: null, media: [{ kind: 'text', provider: 'telegram', thumb: null, url: 'https://t.me/x/1' }], status: 'text only' },
    { ...BASE, id: 'ai-video', type: 'ground', place: 'Druzhkivka', lat: 48.62, lon: 37.53, image: null, media: [{ kind: 'video', provider: 'file', thumb: null, videoUrl: 'https://x/v.mp4', url: 'https://x' }], status: 'video without thumb' },
    { ...BASE, id: 'yt', type: 'strike', place: 'Kramatorsk', lat: 48.72, lon: 37.55, image: 'https://i.ytimg.com/vi/x/hqdefault.jpg', media: [{ kind: 'video', provider: 'youtube', thumb: 'https://i.ytimg.com/vi/x/hqdefault.jpg', embed: 'https://www.youtube-nocookie.com/embed/x' }], status: 'youtube' },
  ]);
  layer.show();
  const { cards } = layer._getStateForTest();
  const card = (id) => cards.get(id)?.el;
  for (const id of ['tg-text', 'ai-video', 'yt']) {
    assert.equal(cards.get(id)?.kind, 'card', `${id} je karta`);
    assert.equal(card(id).classList.contains('is-selected'), false, 'predvolene malá (bez is-selected)');
    const subject = byClass(card(id), 'oko-ukr-card-subject')[0];
    assert.ok(byClass(subject, 'oko-ukr-card-glyph').length && byClass(subject, 'oko-ukr-card-when').length, 'malá karta: glyf a čas v riadku miesta');
  }
  // Textový príspevok: žiadny rámček ani odkaz na médium.
  assert.equal(byClass(card('tg-text'), 'oko-ukr-card-media').length, 0);
  assert.equal(byClass(card('tg-text'), 'oko-ukr-card-medialink').length, 0);
  assert.equal(byClass(card('tg-text'), 'oko-ukr-card-mediaflag').length, 0);
  // Video bez náhľadu: odkaz v pätičke, žiadny prázdny rámček.
  assert.equal(byClass(card('ai-video'), 'oko-ukr-card-media').length, 0);
  const link = byClass(card('ai-video'), 'oko-ukr-card-medialink')[0];
  assert.ok(link, 'odkaz ▶ video v pätičke');
  assert.match(link.textContent, /^▶ ukraine\.card\.video$/);
  assert.equal(link.parent.classList.contains('oko-ukr-card-foot'), true);
  // YouTube s náhľadom: rámček s obrázkom (ukáže sa v plnej karte).
  const media = byClass(card('yt'), 'oko-ukr-card-media')[0];
  assert.ok(media && media.children.some((c) => c.tag === 'img'), 'náhľad s obrázkom');
  // MT označenie pod textom (za riadkom úrovne malej karty), nie pod obrázkom.
  const kids = card('yt').children.map((c) => c.className.split(' ')[0]);
  const iStatus = kids.indexOf('oko-ukr-card-status'); const iMeta = kids.indexOf('oko-ukr-card-meta'); const iMt = kids.indexOf('oko-ukr-card-mt');
  assert.ok(iStatus < iMeta && iMeta + 1 === iMt && iMt < kids.indexOf('oko-ukr-card-media'), kids.join(','));
  // Výber → plná karta.
  layer.select('yt');
  assert.equal(cards.get('yt').el.classList.contains('is-selected'), true);
  layer.destroy();
});

test('výber a nové karty sa rozmiestnia aj bez pohybu kamery (príznak po recompute ostáva)', () => {
  const doc = fakeDocument();
  const viewer = fakeViewer(doc);
  const post = [];
  viewer.scene.postRender = { addEventListener: (fn) => post.push(fn), removeEventListener() {} };
  const cam = viewer.scene.camera;
  cam.positionWC = new Cesium.Cartesian3(3.5e6, 2.7e6, 4.7e6);
  cam.heading = 0; cam.pitch = -1;
  const layer = createUkraineEventsLayer({ viewer, documentRef: doc, translate: (k) => k, lang: 'en', terrainSampler: null, translateTextImpl: null });
  const orig = Cesium.SceneTransforms.worldToWindowCoordinates;
  Cesium.SceneTransforms.worldToWindowCoordinates = () => new Cesium.Cartesian2(500, 300);
  try {
    layer.setEvents([{ ...BASE, id: 'a', type: 'strike', place: 'Kramatorsk', lat: 48.72, lon: 37.55, image: null, media: [], status: 's' }]);
    layer.show();
    post.forEach((fn) => fn());
    const card = layer._getStateForTest().cards.get('a').el;
    assert.equal(card.style.visibility, 'visible', 'nová karta sa rozmiestnila pri prvom snímku');
    const before = card.style.transform;
    card.offsetWidth = 252; card.offsetHeight = 214; // plná karta je väčšia
    layer.select('a');
    post.forEach((fn) => fn()); // kamera stojí
    assert.notEqual(card.style.transform, before, 'po výbere sa karta rozmiestnila znova podľa novej veľkosti');
  } finally {
    Cesium.SceneTransforms.worldToWindowCoordinates = orig;
    layer.destroy();
  }
});

// ── nálezy kontroly (2026-09-24) ─────────────────────────────────────────────
test('tvary „fotka / fotky / fotiek" a krátky čas malej karty', () => {
  assert.deepEqual([1, 2, 4, 5, 11].map((n) => pluralForm(n, 'sk')), ['one', 'few', 'few', 'many', 'many']);
  assert.deepEqual([1, 2, 5].map((n) => pluralForm(n, 'en')), ['one', 'many', 'many']);
  const now = Date.UTC(2026, 8, 24, 20, 0);
  assert.equal(compactTimeText({ t: Date.UTC(2026, 8, 24, 5, 7) }, now), '05:07 UTC', 'dnes = čas s pásmom (nie miestny)');
  assert.equal(compactTimeText({ t: Date.UTC(2026, 8, 23, 23, 0) }, now), '23.9.', 'iný deň = dátum');
  assert.equal(compactTimeText({ t: Date.UTC(2026, 8, 24), dayOnly: true }, now), '24.9.');
  assert.equal(compactTimeText({ t: NaN }, now), '');
});

test('vybraná karta nikdy pod panelom; mobilná lišta a výsuv sú prekážky', () => {
  const panel = { x: 16, y: 80, w: 360, h: 700 };
  const viewport = { w: 1400, h: 900 };
  const box = layoutCards([{ id: 's', x: 100, y: 400, w: 252, h: 214, selected: true }], { viewport, obstacles: [panel] }).get('s');
  assert.ok(box, 'vybraná sa ukáže');
  const hit = !(box.x + box.w <= panel.x || panel.x + panel.w <= box.x || box.y + box.h <= panel.y || panel.y + panel.h <= box.y);
  assert.equal(hit, false, `mimo panelu (${JSON.stringify(box)})`);
  const moved = clearOfObstacles({ x: 20, y: 100, w: 100, h: 50 }, [panel], viewport);
  const clear = moved.x + moved.w <= panel.x || moved.x >= panel.x + panel.w || moved.y + moved.h <= panel.y || moved.y >= panel.y + panel.h;
  assert.ok(clear && moved.x >= 6 && moved.y >= 6, `posun k najbližšiemu okraju panelu, v okne (${JSON.stringify(moved)})`);
  assert.deepEqual([moved.x, moved.y], [20, 24], 'najbližší je horný okraj (80 − 50 − 6)');
  assert.match(CARD_OBSTACLE_SELECTOR, /#oko-appbar/);
  assert.match(CARD_OBSTACLE_SELECTOR, /#oko-sheet/);
});

test('malá karta vždy ukáže úroveň overenia a po preklade aj „strojový preklad"; preklad kartu rozmiestni znova', async () => {
  const doc = fakeDocument();
  const viewer = fakeViewer(doc);
  let renders = 0;
  viewer.scene.requestRender = () => { renders += 1; };
  const layer = createUkraineEventsLayer({ viewer, documentRef: doc, translate: (k) => k, lang: 'sk', terrainSampler: null, translateTextImpl: async () => 'Preložený text' });
  layer.setEvents([{ ...BASE, id: 'n', src: 'news', level: 'reported', type: 'strike', place: 'Kramatorsk', lat: 48.72, lon: 37.55, image: null, media: [], status: 'Original text' }]);
  layer.show();
  const card = layer._getStateForTest().cards.get('n').el;
  const meta = byClass(card, 'oko-ukr-card-meta')[0];
  assert.ok(meta, 'riadok úrovne v malej karte');
  const level = byClass(meta, 'oko-ukr-card-meta-level')[0]; const mtFlag = byClass(meta, 'oko-ukr-card-meta-mt')[0];
  assert.equal(level.textContent, 'ukraine.level.reported');
  assert.equal(mtFlag.hidden, true, 'pred prekladom bez MT');
  assert.equal(meta.classList.contains('is-reported'), true);
  const before = renders;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(byClass(card, 'oko-ukr-card-status')[0].textContent, 'Preložený text');
  assert.equal(mtFlag.hidden, false, 'MT označenie aj v malej karte');
  assert.equal(meta.children[0], mtFlag, 'MT vpredu — skracuje sa len úroveň');
  assert.equal(meta.title, 'ukraine.card.mt · ukraine.level.reported', 'celý text v title');
  assert.ok(renders > before, 'po preklade (iná výška) sa pýta nový snímok');
  layer.destroy();
});

test('zlyhaný náhľad: ikona média zmizne, keď nie je čo ukázať; fotka otvorí príspevok, nie čierny lightbox', () => {
  const doc = fakeDocument();
  const viewer = fakeViewer(doc);
  let renders = 0;
  viewer.scene.requestRender = () => { renders += 1; };
  const layer = createUkraineEventsLayer({ viewer, documentRef: doc, translate: (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k), lang: 'sk', terrainSampler: null, translateTextImpl: null });
  layer.setEvents([
    { ...BASE, id: 'og', src: 'news', type: 'strike', place: 'Kramatorsk', lat: 48.72, lon: 37.55, image: 'https://x/og.jpg', media: [], status: 's' },
    { ...BASE, id: 'ph', type: 'strike', place: 'Sloviansk', lat: 48.85, lon: 37.61, image: 'https://cdn/p1.jpg', media: [{ kind: 'photo', provider: 'telegram', thumb: 'https://cdn/p1.jpg', photos: ['https://cdn/p1.jpg'], url: 'https://t.me/x/9' }], status: 's' },
  ]);
  layer.show();
  const { cards } = layer._getStateForTest();
  const fail = (id) => {
    const box = byClass(cards.get(id).el, 'oko-ukr-card-media')[0];
    assert.ok(box.classList.contains('is-loading'), 'kým obrázok nepríde, zástupný stav (nie prázdny rámček)');
    const img = box.children.find((c) => c.tag === 'img');
    assert.equal(img.loading, 'eager', 'načíta sa už pri malej karte');
    const r0 = renders;
    img.listeners.error();
    assert.ok(renders > r0, 'zmena veľkosti → nový snímok');
  };
  fail('og');
  assert.equal(byClass(cards.get('og').el, 'oko-ukr-card-media').length, 0);
  assert.equal(byClass(cards.get('og').el, 'oko-ukr-card-mediaflag').length, 0, 'bez média ani ikona ▣');
  assert.equal(byClass(cards.get('og').el, 'oko-ukr-card-medialink').length, 0);
  fail('ph');
  const link = byClass(cards.get('ph').el, 'oko-ukr-card-medialink')[0];
  assert.equal(link.textContent, '▣ ukraine.card.photos.one {"n":1} ↗', 'správny tvar a šípka von');
  const opened = [];
  const origOpen = globalThis.open;
  globalThis.open = (url) => { opened.push(url); };
  try { link.listeners.click({ preventDefault() {}, stopPropagation() {} }); } finally { globalThis.open = origOpen; }
  assert.deepEqual(opened, ['https://t.me/x/9'], 'otvorí príspevok, lightbox by zlyhal znova');
  layer.destroy();
});

test('skryté panely (čistý pohľad) nie sú prekážky; klik/kláves prepočíta rozmiestnenie', async () => {
  const doc = fakeDocument();
  const hiddenPanel = { closest: () => null, checkVisibility: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1007, height: 960 }) };
  doc.querySelectorAll = () => [hiddenPanel];
  const docListeners = {};
  doc.addEventListener = (t, fn) => { docListeners[t] = fn; };
  const viewer = fakeViewer(doc);
  const post = [];
  viewer.scene.postRender = { addEventListener: (fn) => post.push(fn), removeEventListener() {} };
  let renders = 0;
  viewer.scene.requestRender = () => { renders += 1; };
  const cam = viewer.scene.camera;
  cam.positionWC = new Cesium.Cartesian3(3.5e6, 2.7e6, 4.7e6);
  cam.heading = 0; cam.pitch = -1;
  const layer = createUkraineEventsLayer({ viewer, documentRef: doc, translate: (k) => k, lang: 'en', terrainSampler: null, translateTextImpl: null });
  const orig = Cesium.SceneTransforms.worldToWindowCoordinates;
  Cesium.SceneTransforms.worldToWindowCoordinates = () => new Cesium.Cartesian2(500, 300);
  try {
    layer.setEvents([{ ...BASE, id: 'a', type: 'strike', place: 'Kramatorsk', lat: 48.72, lon: 37.55, image: null, media: [], status: 's' }]);
    layer.show();
    post.forEach((fn) => fn());
    assert.equal(layer._getStateForTest().cards.get('a').el.style.visibility, 'visible', 'neviditeľný panel cez celé okno kartu neskryl');
    assert.equal(typeof docListeners.click, 'function', 'poslucháč klikov (rozbalenie panelov)');
    assert.equal(typeof docListeners.keyup, 'function', 'poslucháč kláves (čistý pohľad V)');
    const r0 = renders;
    docListeners.click();
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(renders > r0, 'po zmene panelov nový snímok aj bez pohybu kamery');
  } finally {
    Cesium.SceneTransforms.worldToWindowCoordinates = orig;
    layer.destroy();
  }
});

test('CSS: malá karta je klikateľná (var(--cursor-pointer)), riadok úrovne a zástupný stav náhľadu', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-ukr-card:not\(\.is-selected\) \{ cursor: var\(--cursor-pointer\); \}/);
  assert.match(css, /\.oko-ukr-card-meta \{[^}]*text-transform: uppercase/);
  assert.match(css, /\.oko-ukr-card\.is-selected \.oko-ukr-card-meta \{ display: none; \}/, 'v plnej karte nesie úroveň hlavička');
  assert.doesNotMatch(css, /\.oko-ukr-card:not\(\.is-selected\) \.oko-ukr-card-meta/, 'v malej karte sa riadok úrovne neskrýva');
  assert.match(css, /\.oko-ukr-card-media\.is-loading \{/);
  assert.match(css, /\.oko-ukr-card-meta-mt \{ flex: 0 0 auto;/, 'MT sa neskracuje');
  assert.match(css, /\.oko-ukr-card-meta-level \{[^}]*text-overflow: ellipsis/, 'skracuje sa len úroveň');
});

test('úroveň OSINT nesie meno svojho zdroja (kanál DeepState nie je GeoConfirmed)', async () => {
  const { eventCardModel } = await import('./data/ukraineEvents.js');
  const tr = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  const ds = eventCardModel({ id: 'x', t: 0, level: 'osint', src: 'media', sources: [{ name: 'DeepState' }] }, { translate: tr });
  assert.equal(ds.levelText, 'ukraine.level.osint-source {"source":"DeepState"}');
  const gc = eventCardModel({ id: 'y', t: 0, level: 'osint', src: 'geoconfirmed', sources: [] }, { translate: tr });
  assert.equal(gc.levelText, 'ukraine.level.osint');
});

test('vybraná karta: posun v oboch osiach — vpravo od panela A nad osou (notebook 1366×768)', () => {
  const viewport = { w: 1366, h: 768 };
  const panel = { x: 52, y: 200, w: 360, h: 368 };
  const timeline = { x: 93, y: 614, w: 1180, h: 140 };
  const box = layoutCards([{ id: 's', x: 500, y: 650, w: 252, h: 250, selected: true }], { viewport, obstacles: [panel, timeline] }).get('s');
  const hit = (o) => !(box.x + box.w <= o.x || o.x + o.w <= box.x || box.y + box.h <= o.y || o.y + o.h <= box.y);
  assert.equal(hit(panel), false, `nie pod panelom (${JSON.stringify(box)})`);
  assert.equal(hit(timeline), false, 'nie pod osou');
  assert.ok(box.x >= 6 && box.y >= 6 && box.x + box.w <= viewport.w - 6 && box.y + box.h <= viewport.h - 6, 'v okne');
});

test('lightbox: fotka, ktorá sa nenačíta, nahradí sa príspevkom a zmiznú aj šípky a počítadlo', () => {
  const doc = fakeDocument();
  const viewer = fakeViewer(doc);
  const layer = createUkraineEventsLayer({ viewer, documentRef: doc, translate: (k) => k, lang: 'sk', terrainSampler: null, translateTextImpl: null });
  const media = { kind: 'photo', provider: 'telegram', photos: ['a', 'b', 'c'], embed: 'https://t.me/x/9?embed=1', url: 'https://t.me/x/9' };
  layer.openMedia(media, { title: 't', list: [media] });
  const { lightbox } = layer._getStateForTest();
  const body = walk(lightbox).find((n) => n.classList.contains('oko-ukr-lb-body'));
  const img = body.children.find((c) => c.tag === 'img');
  assert.ok(body.children.some((c) => c.classList.contains('oko-ukr-lb-nav')), 'galéria so šípkami');
  img.replaceWith = (n) => { const i = body.children.indexOf(img); body.children.splice(i, 1, n); n.parent = body; };
  img.listeners.error();
  assert.equal(body.children.length, 1, 'len náhrada');
  assert.equal(body.children[0].tag, 'iframe');
  layer.destroy();
});
