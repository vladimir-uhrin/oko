// scripts/lib/meteoBakeFreshness.test.mjs — prepečenie rezov GFS pri novom behu modelu (2026-10-09).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsRebake } from './meteoBakeFreshness.mjs';

const NEW = '2026-10-09T06:00:00.000Z';

test('chýbajúci rez sa upečie; rez bez behu tiež', () => {
  assert.equal(needsRebake(null, NEW), true);
  assert.equal(needsRebake({ run: null }, NEW), true);
});

test('základné pole: starší beh sa prepečie, rovnaký nie (predtým sa staré rezy nikdy neobnovili)', () => {
  assert.equal(needsRebake({ run: '2026-10-06T18:00:00.000Z' }, NEW), true);
  assert.equal(needsRebake({ run: '2026-10-09T00:00:00.000Z' }, NEW), true);
  assert.equal(needsRebake({ run: NEW }, NEW), false);
});

test('výšková hladina vetra: až keď zaostáva o viac než 12 h', () => {
  assert.equal(needsRebake({ run: '2026-10-09T00:00:00.000Z' }, NEW, { isLevel: true }), false);
  assert.equal(needsRebake({ run: '2026-10-08T12:00:00.000Z' }, NEW, { isLevel: true }), true);
});

test('bez známeho najnovšieho behu sa existujúce rezy nenútia', () => {
  assert.equal(needsRebake({ run: '2026-10-01T00:00:00.000Z' }, null), false);
});

test('upratovanie: zmažú sa len rezy krokov staršie než 48 h, iné súbory nie', async () => {
  const { slicesToPrune } = await import('./meteoBakeFreshness.mjs');
  const now = Date.parse('2026-10-09T17:00:00Z');
  const names = ['2026-10-07T150000Z.png', '2026-10-07T150000Z.json', '2026-10-07T180000Z.png', '2026-10-09T180000Z.png', 'README.txt', 'ring.json'];
  assert.deepEqual(slicesToPrune(names, now), ['2026-10-07T150000Z.png', '2026-10-07T150000Z.json']);
});
