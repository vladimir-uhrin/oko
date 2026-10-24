// src/volbyMapMode.test.mjs — volebný režim mapy (2026-10-24): plány vstupu a návratu, hranice z JSON,
// životný cyklus s falošným podkladom/vrstvami a sledovanie panela, zapojenie v main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOLBY_HIDDEN_LAYERS, VOLBY_MAP_STACK, createVolbyMapMode, linesToDegrees, planEnter, planExit } from './volbyMapMode.js';

test('planEnter / planExit: zapamätá a vráti len to, čo bolo zapnuté; podklad len ak ho návštevník nezmenil', () => {
  const p = planEnter({ stack: 'photoreal', layersOn: ['flights', 'ais-live-vessels'] });
  assert.deepEqual(p, { saved: { stack: 'photoreal', layers: ['flights', 'ais-live-vessels'], obceWasOn: false }, hide: ['flights', 'ais-live-vessels'], setStack: VOLBY_MAP_STACK });
  assert.equal(planEnter({ stack: VOLBY_MAP_STACK, layersOn: [] }).setStack, null);
  assert.deepEqual(planExit(p.saved, { stack: VOLBY_MAP_STACK }), { setStack: 'photoreal', show: ['flights', 'ais-live-vessels'], hideObce: true });
  assert.equal(planExit(p.saved, { stack: 'osm' }).setStack, null, 'návštevník medzitým zvolil inú mapu');
  assert.deepEqual(planExit(null, { stack: 'x' }), { setStack: null, show: [], hideObce: false });
  assert.ok(VOLBY_HIDDEN_LAYERS.includes('flights') && VOLBY_HIDDEN_LAYERS.includes('ais-live-vessels'));
});

test('linesToDegrees: ploché pole, krátke a chybné čiary vypadnú', () => {
  assert.deepEqual(linesToDegrees({ lines: [[[17, 48], [17.1, 48.1]], [[1, 2]], [[NaN, 1], [2, 3]], 'x'] }), [[17, 48, 17.1, 48.1]]);
  assert.deepEqual(linesToDegrees(null), []);
});

function harness(initial = { stack: 'photoreal', on: ['flights', 'military'] }) {
  let stack = initial.stack;
  const on = new Set(initial.on);
  const calls = [];
  const added = [];
  const mode = createVolbyMapMode({
    viewer: { scene: { groundPrimitives: { add: (p) => { added.push(p); return p; }, remove() {} }, requestRender() {} } },
    getStack: () => stack,
    setStack: (id) => { calls.push(`stack:${id}`); stack = id; },
    isLayerOn: (id) => on.has(id),
    setLayer: (id, v) => { calls.push(`${id}:${v}`); if (v) on.add(id); else on.delete(id); },
    fetchImpl: async (url) => ({ ok: true, json: async () => ({ lines: [[[17, 48], [18, 49]]], url }) }),
    createPrimitive: ({ key }) => ({ key, show: true }),
    setTimeoutImpl: () => 0,
  });
  return { mode, calls, on, added, get stack() { return stack; }, setStackDirect: (s) => { stack = s; } };
}

test('enter/exit: tmavý podklad, lietadlá preč, obce zapnuté, hranice; návrat presne späť', async () => {
  const h = harness();
  assert.equal(await h.mode.enter(), true);
  assert.equal(await h.mode.enter(), false, 'druhý vstup nič nerobí');
  assert.deepEqual(h.calls, ['stack:stadia-dark', 'flights:false', 'military:false', 'volby-obce:true']);
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.added.map((p) => [p.key, p.show]), [['kraje', true], ['obce', true]]);
  assert.equal(await h.mode.exit(), true);
  assert.deepEqual(h.calls.slice(4), ['volby-obce:false', 'flights:true', 'military:true', 'stack:photoreal']);
  assert.deepEqual(h.added.map((p) => p.show), [false, false]);
  assert.deepEqual([...h.on].sort(), ['flights', 'military']);
  assert.equal(await h.mode.exit(), false);
  // Návštevník počas režimu prepne mapu → po zatvorení ju nechať.
  const h2 = harness({ stack: 'photoreal', on: ['volby-obce'] });
  await h2.mode.enter();
  h2.setStackDirect('osm');
  await h2.mode.exit();
  assert.equal(h2.stack, 'osm');
  assert.ok(h2.on.has('volby-obce'), 'mapa obcí bola zapnutá už predtým — ostáva');
});

test('reassert: lietadlá zapnuté obnovou po vstupe sa vypnú a po návrate vrátia', async () => {
  const h = harness({ stack: 'photoreal', on: [] });
  await h.mode.enter();
  h.on.add('flights'); h.on.delete('volby-obce');
  assert.equal(await h.mode.reassert(), 2);
  assert.ok(!h.on.has('flights') && h.on.has('volby-obce'));
  await h.mode.exit();
  assert.ok(h.on.has('flights'), 'po zatvorení sa lietadlá vrátia');
  assert.ok(!h.on.has('volby-obce'));
});

test('observe: trieda collapsed na paneli riadi režim', async () => {
  const h = harness();
  const classes = new Set(['collapsed']);
  const panel = { classList: { contains: (c) => classes.has(c) } };
  let cb = null;
  class MO { constructor(fn) { cb = fn; } observe() {} disconnect() {} }
  assert.equal(h.mode.observe(panel, MO), true);
  assert.equal(h.mode.active, false);
  classes.delete('collapsed'); cb();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.mode.active, true);
  classes.add('collapsed'); cb();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.mode.active, false);
});

test('zapojenie v main.js a hranice v public/volby', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ createVolbyMapMode \} from '\.\/volbyMapMode\.js';/);
  assert.match(main, /volbyMapMode\.observe\(document\.getElementById\('volby-panel'\)\)/);
  for (const f of ['hranice-kraje.json', 'hranice-obce.json']) {
    const j = JSON.parse(readFileSync(new URL(`../public/volby/${f}`, import.meta.url), 'utf8'));
    assert.ok(j.lines.length > 100, `${f}: ${j.lines.length} čiar`);
    assert.match(j.meta.licence, /ODbL/);
  }
});
