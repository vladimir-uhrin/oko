// src/gulfIncidentCards.test.mjs
// Hot karty po regiónoch (BLÍZKY VÝCHOD etapa 3, 2026-09-26): pri deviatich
// regiónoch správ sa dejisko prepína aj počas načítania. Karty musia patriť
// POSLEDNE vybranému regiónu — neskorá odpoveď predošlého regiónu ich
// neprekreslí a každý región sa pýta zvlášť. Falošný DOM podľa vzoru
// conflictBulletin.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOTCARD_CLIP_SELECTOR, HOTCARD_OBSTACLE_SELECTOR, HOTCARD_STATUS_ZONE, clipObstacleRect, createIncidentCards, hotCardAnchorShown, placeHotCards } from './gulfIncidentCards.js';

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '', textContent: '', hidden: false, title: '',
    children: [], parentNode: null, listeners: {},
    style: { setProperty(k, v) { node.style[k] = v; } },
    appendChild(child) { node.children.push(child); child.parentNode = node; return child; },
    replaceChildren(...kids) { node.children = []; kids.forEach((k) => node.appendChild(k)); },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node); },
  };
  return node;
}
const walk = (node, out = []) => { for (const c of node.children) { out.push(c); walk(c, out); } return out; };

function makeViewer() {
  const head = makeNode('head');
  const doc = { head, createElement: (tag) => makeNode(tag), getElementById: () => null, defaultView: { innerWidth: 1200, innerHeight: 800 } };
  const container = makeNode('div');
  container.ownerDocument = doc;
  container.clientWidth = 1200; container.clientHeight = 800;
  const viewer = { container, scene: { camera: { positionWC: { x: 0, y: 0, z: 1e7 } }, mode: 3 } };
  return { viewer, container };
}

/** Odložená odpoveď proxy — test rozhodne, ktorý región príde skôr. */
function deferredFetch() {
  const pending = new Map();
  const asked = [];
  const fetchImpl = (region) => { asked.push(region); return new Promise((resolve, reject) => pending.set(region, { resolve, reject })); };
  return { fetchImpl, asked, pending };
}
const item = (title, n) => ({ title, url: `https://x/${n}`, source: 'Test', publishedAt: 100, noImage: true });
const payload = {
  iran: { items: [item('Israeli strike hits Isfahan air base', 1)] },
  lebanon: { items: [item('Drone strike on Nabatieh kills two', 2)] },
};
const places = (container) => walk(container).filter((n) => n.className === 'oko-hc-place').map((n) => n.textContent);

test('a late answer for the previous theatre never redraws the cards of the current one', async () => {
  const { viewer, container } = makeViewer();
  const { fetchImpl, asked, pending } = deferredFetch();
  const cards = createIncidentCards({ viewer, fetch: fetchImpl, translate: (k) => k, lang: 'en', now: () => 1000 });
  const first = cards.showFor('iran');
  const second = cards.showFor('lebanon');
  assert.deepEqual(asked, ['iran', 'lebanon'], 'každý región sa pýta zvlášť (nie zdieľaný dopyt prvého)');
  pending.get('lebanon').resolve(payload.lebanon);
  assert.equal(await second, 1);
  assert.deepEqual(places(container), ['Nabatieh']);
  pending.get('iran').resolve(payload.iran);
  assert.equal(await first, 0, 'neskorá odpoveď Iránu nekreslí');
  assert.deepEqual(places(container), ['Nabatieh'], 'karty Libanonu ostali');
  assert.equal(cards.count, 1);
  // odpoveď Iránu je už v cache — návrat na Irán kreslí hneď a bez dopytu
  assert.equal(await cards.showFor('iran'), 1);
  assert.deepEqual(places(container), ['Isfahan']);
  assert.deepEqual(asked, ['iran', 'lebanon']);
  cards.destroy();
});

test('clear() cancels a pending load: an answer after it draws nothing', async () => {
  const { viewer, container } = makeViewer();
  const { fetchImpl, pending } = deferredFetch();
  const cards = createIncidentCards({ viewer, fetch: fetchImpl, translate: (k) => k, lang: 'en', now: () => 1000 });
  const shown = cards.showFor('iran');
  cards.clear(); // odchod na scénu bez regiónu správ
  pending.get('iran').resolve(payload.iran);
  assert.equal(await shown, 0);
  assert.equal(cards.count, 0);
  assert.deepEqual(places(container), []);
  cards.destroy();
});

test('a failed load clears only when it is still the current request', async () => {
  const { viewer, container } = makeViewer();
  const { fetchImpl, pending } = deferredFetch();
  const cards = createIncidentCards({ viewer, fetch: fetchImpl, translate: (k) => k, lang: 'en', now: () => 1000 });
  const failing = cards.showFor('iran');
  const current = cards.showFor('lebanon');
  pending.get('lebanon').resolve(payload.lebanon);
  await current;
  pending.get('iran').reject(new Error('502'));
  assert.equal(await failing, 0);
  assert.deepEqual(places(container), ['Nabatieh'], 'chyba starého dopytu nezmaže aktuálne karty');
  cards.destroy();
});

/// ── Rozmiestnenie kariet mimo rozhrania (2026-10-03, nález zo snímky po vydaní etapy 5) ─────────
// Obdĺžniky rozhrania sú ZMERANÉ v prehliadači (scripts/qa-mideast-panel.mjs, okno 1366 × 768,
// dejisko „Prehľad regiónu", rozbalený panel BLÍZKY VÝCHOD) — viditeľné časti po orezaní stĺpcom.
const VIEW = { w: 1366, h: 768 };
const UI = [
  { name: '#title-bar', x: 36, y: 32, w: 325, h: 75 },
  { name: '#top-center-actions', x: 574, y: 32, w: 218, h: 36 },
  { name: '#command-dock', x: 449, y: 691, w: 468, h: 62 },
  { name: '#mideast-panel', x: 52, y: 116, w: 350, h: 367 },
  { name: '#gas-panel', x: 52, y: 515, w: 176, h: 50 },
  { name: '#oil-panel', x: 52, y: 573, w: 176, h: 17 },
  { name: '.hud-bottom-left', x: 36, y: 599, w: 301, h: 50 },
  { name: '.cesium-widget-credits', x: 24, y: 738, w: 736, h: 18 },
  { name: '.oko-scale', x: 351, y: 635, w: 94, h: 12 },
];
const boxHit = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const cardBox = (p) => ({ x: p.cx, y: p.cy, w: p.w, h: p.h });
const card = (x, y, h = 110) => ({ x, y, w: 252, h, cx: 0, cy: 0 });
/** Karta je celá v okne, neleží na rozhraní a neprekrýva inú kartu. */
function assertClean(points, view, ui, label) {
  for (const p of points) {
    assert.ok(p.cx >= 8 && p.cy >= 8 && p.cx + p.w <= view.w - 8 + 0.01 && p.cy + p.h <= view.h - 8 + 0.01, `${label}: karta mimo okna ${JSON.stringify(cardBox(p))}`);
    for (const o of ui) assert.equal(boxHit(cardBox(p), o), false, `${label}: karta ${JSON.stringify(cardBox(p))} leží na ${o.name}`);
  }
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) assert.equal(boxHit(cardBox(points[i]), cardBox(points[j])), false, `${label}: karty ${i} a ${j} sa prekrývajú`);
}

test('karty: miesto mimo záberu drží kartu pri okraji mapy — nie na logu, paneli, lište ani atribúcii; karty sa neprekryjú', () => {
  // prehľad regiónu: Jeruzalem ďaleko vľavo hore, Červené more vľavo, Saná pod oknom, Omán vpravo, dve miesta v zábere
  const points = [card(-420, -260), card(-180, 420), card(520, 905, 124), card(1600, 330), card(700, 470), card(505, 560)];
  placeHotCards(points, VIEW, UI);
  assertClean(points, VIEW, UI, 'prehľad regiónu');
  // pred opravou: prvá karta v rohu okna (8, 8) cez logo, Saná cez dok a atribúciu
  const before = [card(-420, -260), card(520, 905, 124)];
  placeHotCards(before, VIEW, []);
  assert.ok(before.some((p) => UI.some((o) => boxHit(cardBox(p), o))), 'bez prekážok by karty ležali na rozhraní (kontrola, že test niečo stráži)');
});

test('karty: každé miesto bodu v okne aj mimo neho dá kartu mimo rozhrania', () => {
  for (let x = -300; x <= VIEW.w + 300; x += 150) {
    for (let y = -200; y <= VIEW.h + 200; y += 120) {
      const points = [card(x, y)];
      placeHotCards(points, VIEW, UI);
      assertClean(points, VIEW, UI, `bod ${x},${y}`);
    }
  }
});

test('karty: jedna sedí nad svojím bodom; viac kariet jedného miesta sa skladá nahor; pri hornom okraji pod bod', () => {
  const view = { w: 1600, h: 900 };
  const [one] = placeHotCards([card(800, 500)], view, []);
  assert.deepEqual([one.cx, one.cy], [800 - 126, 500 - 14 - 110], 'vystredená nad bodom s odstupom 14 px');
  const stack = placeHotCards([card(800, 500), card(804, 502), card(798, 498)], view, []);
  const tops = stack.map((p) => p.cy).sort((a, b) => b - a);
  assert.deepEqual(tops, [498 + 14, 502 - 14 - 110, 502 - 14 - 110 - 116], 'dve nad bodom s medzerou 6 px, tretia tesne pod ním — žiadna cez bodky');
  assert.ok(stack.every((p) => Math.abs(p.cx - (p.x - 126)) < 0.01), 'bez posunu do strán');
  for (const p of stack) for (const q of stack) assert.equal(q.x >= p.cx && q.x <= p.cx + p.w && q.y >= p.cy && q.y <= p.cy + p.h, false, 'karta nezakrýva žiadnu z bodiek miesta');
  const [top] = placeHotCards([card(800, 60)], view, []);
  assert.equal(top.cy, 60 + 14, 'nad bodom nie je miesto → pod ním');
  // karta, ktorej miesto nad bodom zaberá panel, sa posunie najkratšou cestou vedľa neho
  const [beside] = placeHotCards([card(380, 400)], VIEW, UI);
  assert.equal(beside.cx, 52 + 350 + 6, 'tesne vpravo od panela');
  assert.equal(beside.cy, 400 - 14 - 110, 'výška ostáva nad bodom');
  assert.deepEqual(placeHotCards([], VIEW, UI), []);
  // bod tesne pod hornou lištou: nad ním je lišta a stavový riadok → karta ide POD bod, nie naň ani ďaleko do strany
  const zone = { x: VIEW.w / 2 - HOTCARD_STATUS_ZONE.width / 2, y: HOTCARD_STATUS_ZONE.top, w: HOTCARD_STATUS_ZONE.width, h: HOTCARD_STATUS_ZONE.height };
  const [under] = placeHotCards([card(683, 190, 124)], VIEW, [...UI, zone]);
  assert.deepEqual([under.cx, under.cy], [683 - 126, 190 + 14], 'vystredená pod bodom');
});

test('karty: nabité okno — šesť kariet okolo jedného miesta sa rozloží bez prekrytia a mimo rozhrania', () => {
  const points = [card(700, 400), card(706, 404), card(694, 398), card(702, 408), card(698, 396), card(704, 402)];
  placeHotCards(points, VIEW, UI);
  assertClean(points, VIEW, UI, 'šesť kariet pri jednom mieste');
});

test('bodka a vodiaca čiara len pri mieste, ktoré je v okne a nie je pod panelom', () => {
  assert.equal(hotCardAnchorShown(700, 400, VIEW, UI), true);
  assert.equal(hotCardAnchorShown(-40, 400, VIEW, UI), false, 'mimo okna vľavo');
  assert.equal(hotCardAnchorShown(700, 900, VIEW, UI), false, 'mimo okna dole');
  assert.equal(hotCardAnchorShown(200, 300, VIEW, UI), false, 'pod panelom');
  assert.equal(hotCardAnchorShown(600, 700, VIEW, UI), false, 'pod dokom');
  assert.equal(hotCardAnchorShown(430, 300, VIEW, UI), true, 'tesne vedľa panela');
  assert.equal(hotCardAnchorShown(Number.NaN, 10, VIEW, UI), false);
});

test('prekážka je len viditeľná časť panela: stĺpec panelov roluje a orezáva', () => {
  const stack = { left: 52, top: 116, width: 350, height: 474 }; // stĺpec panelov: podľa merania končí viditeľná časť na y = 590
  assert.deepEqual(clipObstacleRect({ left: 52, top: 573, width: 176, height: 50 }, stack), { left: 52, top: 573, width: 176, height: 17 }, 'ROPA trčí pod okraj stĺpca — počíta sa len 17 px');
  assert.equal(clipObstacleRect({ left: 52, top: 655, width: 176, height: 38 }, stack), null, 'SCÉNY sú odrolované celé — nie sú prekážkou');
  assert.equal(clipObstacleRect({ left: 52, top: -65, width: 176, height: 38 }, stack), null, 'DÁTA odrolované nad stĺpec');
  const whole = { left: 36, top: 32, width: 325, height: 75 };
  assert.equal(clipObstacleRect(whole, null), whole, 'mimo orezávajúceho kontajnera celý obdĺžnik');
  assert.equal(clipObstacleRect(null, stack), null);
});

test('prekážky kariet: panely a lišty ako pri UKRAJINE + riadok atribúcie a rohy HUD', () => {
  const list = HOTCARD_OBSTACLE_SELECTOR.split(',').map((s) => s.trim());
  for (const sel of ['#left-panel-stack > .panel-collapsible', '#title-bar', '#top-center-actions', '#command-dock', '#cesium-credits .cesium-widget-credits', '.hud-top-right', '.hud-bottom-left']) {
    assert.ok(list.includes(sel), `chýba prekážka ${sel}`);
  }
  assert.ok(HOTCARD_CLIP_SELECTOR.split(',').map((s) => s.trim()).includes('#left-panel-stack'));
});

test('miesto stavového riadka pod hornou lištou je vyhradené stále — karta pri obnove dát neposkočí', () => {
  // riadok je vystredený, top 74 px; zmeraný pri „OBNOVUJEM ŽIVÉ DÁTA · LIVE AIS VESSELS" v okne 1366 px: x 558–806, y 76–96
  const zone = { x: VIEW.w / 2 - HOTCARD_STATUS_ZONE.width / 2, y: HOTCARD_STATUS_ZONE.top, w: HOTCARD_STATUS_ZONE.width, h: HOTCARD_STATUS_ZONE.height };
  assert.ok(zone.x <= 558 && zone.x + zone.w >= 806 && zone.y <= 76 && zone.y + zone.h >= 96, 'vyhradené miesto pokrýva zmeraný riadok');
  // karta miesta tesne pod lištou: s vyhradeným miestom leží mimo neho — a rovnako, keď je riadok práve vidieť
  const hidden = placeHotCards([card(540, 230)], VIEW, [...UI, zone]);
  const shown = placeHotCards([card(540, 230)], VIEW, [...UI, zone, { x: 558, y: 76, w: 248, h: 20 }]);
  assert.equal(boxHit(cardBox(hidden[0]), zone), false);
  assert.deepEqual([shown[0].cx, shown[0].cy], [hidden[0].cx, hidden[0].cy], 'objavenie riadka kartou nepohne');
  assert.ok(HOTCARD_OBSTACLE_SELECTOR.split(',').map((s) => s.trim()).includes('#global-loading-status'));
});
