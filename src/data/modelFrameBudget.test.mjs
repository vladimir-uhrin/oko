// src/data/modelFrameBudget.test.mjs
// Automatický rozpočet modelov podľa času snímku (2026-09-09 „automaticky").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_BUDGET_DEFAULTS, createFrameCostMeter, nextModelBudget } from './modelFrameBudget.js';

test('nextModelBudget: pomalý snímok sťahuje ×0,8 (nie pod základ), rýchly pridáva +40 (nie nad strop), medzi tým drží; bez merania nemení', () => {
  const o = { baseCap: 150, maxCap: 600 };
  assert.equal(nextModelBudget(300, 30, o), 240, 'pomalý: ×0,8');
  assert.equal(nextModelBudget(160, 30, o), 150, 'nikdy pod základ');
  assert.equal(nextModelBudget(300, 10, o), 340, 'rýchly: +40');
  assert.equal(nextModelBudget(590, 10, o), 600, 'nikdy nad strop');
  assert.equal(nextModelBudget(300, 18, o), 300, 'medzi prahmi drží');
  assert.equal(nextModelBudget(300, NaN, o), 300, 'bez merania');
  assert.equal(nextModelBudget(NaN, 10, o), 190, 'neplatný rozpočet = základ, potom rast');
  assert.equal(nextModelBudget(900, 18, o), 600, 'orezanie do pásma');
  assert.equal(MODEL_BUDGET_DEFAULTS.slowMs, 22);
  assert.equal(MODEL_BUDGET_DEFAULTS.fastMs, 14);
});

test('createFrameCostMeter: preRender → postRender, kĺzavý priemer, destroy odhlási', () => {
  let t = 0;
  const listeners = { pre: [], post: [] };
  const scene = {
    preRender: { addEventListener(fn) { listeners.pre.push(fn); return () => { listeners.pre = listeners.pre.filter((f) => f !== fn); }; } },
    postRender: { addEventListener(fn) { listeners.post.push(fn); return () => { listeners.post = listeners.post.filter((f) => f !== fn); }; } },
  };
  const meter = createFrameCostMeter(scene, { now: () => t, emaAlpha: 0.5 });
  assert.ok(Number.isNaN(meter.renderMs()), 'bez snímku NaN');
  listeners.pre[0](); t = 20; listeners.post[0]();
  assert.equal(meter.renderMs(), 20, 'prvý snímok = priamo');
  listeners.pre[0](); t = 30; listeners.post[0]();
  assert.equal(meter.renderMs(), 15, 'EMA 0,5: (20 + 10) / 2');
  listeners.post[0](); // postRender bez preRender sa ignoruje
  assert.equal(meter.renderMs(), 15);
  meter.destroy();
  assert.deepEqual([listeners.pre.length, listeners.post.length], [0, 0]);
  assert.ok(Number.isNaN(meter.renderMs()));
  const noScene = createFrameCostMeter(null);
  assert.ok(Number.isNaN(noScene.renderMs()));
  noScene.destroy();
});
