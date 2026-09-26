// src/gulfIncidentCards.test.mjs
// Hot karty po regiónoch (BLÍZKY VÝCHOD etapa 3, 2026-09-26): pri deviatich
// regiónoch správ sa dejisko prepína aj počas načítania. Karty musia patriť
// POSLEDNE vybranému regiónu — neskorá odpoveď predošlého regiónu ich
// neprekreslí a každý región sa pýta zvlášť. Falošný DOM podľa vzoru
// conflictBulletin.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createIncidentCards } from './gulfIncidentCards.js';

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
