// src/data/conflictsCatalog.test.mjs — katalóg zdieľateľných konfliktov (propagácia, krok 1).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFLICT_KINDS,
  buildConflictCardModel,
  conflictById,
  conflictFraming,
  conflictTitle,
  conflictsByRegion,
  listConflicts,
} from './conflictsCatalog.js';
import { drawKartaExport } from '../ukraineKartaOverlay.js';

test('listConflicts: front + smery + úžiny + situácia, každý s rámovaním a druhom', () => {
  const all = listConflicts();
  assert.ok(all.length > 10, 'aspoň front, smery a úžiny');
  for (const c of all) {
    assert.ok(CONFLICT_KINDS.includes(c.kind), `platný druh: ${c.kind}`);
    assert.ok(['ukraine', 'maritime', 'middle-east'].includes(c.region));
    assert.ok(Number.isFinite(c.center.lat) && Number.isFinite(c.center.lon), `stred: ${c.id}`);
    assert.equal(c.rectDegrees.length, 4);
    const [w, s, e, n] = c.rectDegrees;
    assert.ok(w < e && s < n, `neprevrátený obdĺžnik: ${c.id}`);
  }
  const ids = all.map((c) => c.id);
  assert.ok(ids.includes('ukraine:front') && ids.includes('ukraine:lyman'), 'Ukrajina: celý front + Lyman');
  assert.ok(ids.includes('chokepoint:hormuz') && ids.includes('chokepoint:bab-el-mandeb'), 'úžiny');
  assert.ok(ids.includes('gulf'), 'situácia Perzský záliv');
});

test('conflictById a conflictsByRegion', () => {
  assert.equal(conflictById('ukraine:lyman').kind, 'ukraine-front');
  assert.equal(conflictById('chokepoint:hormuz').kind, 'chokepoint');
  assert.equal(conflictById('gulf').region, 'middle-east');
  assert.equal(conflictById('nieco'), null);
  assert.ok(conflictsByRegion('ukraine').every((c) => c.kind === 'ukraine-front'));
  assert.ok(conflictsByRegion('maritime').every((c) => c.kind === 'chokepoint'));
  assert.deepEqual(conflictsByRegion('middle-east').map((c) => c.id), ['gulf']);
});

test('conflictFraming a conflictTitle', () => {
  const lyman = conflictById('ukraine:lyman');
  const fr = conflictFraming(lyman);
  assert.deepEqual(fr.center, lyman.center);
  assert.equal(fr.rectDegrees, lyman.rectDegrees);
  // identity translate → frontSceneLabel/chokepointSceneLabel vráti stabilné EN meno
  assert.equal(conflictTitle(lyman, (k) => k), 'Lyman direction');
  assert.equal(conflictTitle(conflictById('chokepoint:hormuz'), (k) => k), 'Strait of Hormuz');
  // situácia: titleKey s prekladom, inak fallback na meno
  assert.equal(conflictTitle(conflictById('gulf'), (k) => (k === 'conflict.gulf' ? 'Perzský záliv' : k)), 'Perzský záliv');
  assert.equal(conflictTitle(conflictById('gulf'), (k) => k), 'Persian Gulf');
  assert.equal(conflictTitle(null), '');
});

test('buildConflictCardModel: tvar pre drawKartaExport, zdroje spojené, viewRect fallback', () => {
  const c = conflictById('chokepoint:hormuz');
  const m = buildConflictCardModel(c, {
    dateText: 'stav k 20.9.2026',
    sources: ['GFW', '', 'Yahoo Finance'],
    legend: [{ key: 'ships', colorCss: '#5b8fd0', label: 'lode' }],
    legendHead: 'LEGENDA',
    translate: (k) => k,
  });
  assert.equal(m.title.title, 'Strait of Hormuz');
  assert.equal(m.title.subtitle, 'stav k 20.9.2026');
  assert.equal(m.title.sources, 'GFW · Yahoo Finance', 'prázdne zdroje vypadnú');
  assert.equal(m.legend.length, 1);
  assert.equal(m.legendHead, 'LEGENDA');
  assert.deepEqual(m.scene.center, c.center);
  assert.equal(m.viewRect, c.rectDegrees, 'bez viewRect padne späť na obdĺžnik konfliktu');
  const m2 = buildConflictCardModel(c, { viewRect: [1, 2, 3, 4] });
  assert.deepEqual(m2.viewRect, [1, 2, 3, 4]);
});

test('integrácia: model konfliktu sa nakreslí cez drawKartaExport (úžina Hormuz)', () => {
  const texts = [];
  const ctx = new Proxy({
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '',
    measureText: (t) => ({ width: String(t).length * 7 }),
    fillText: (t) => texts.push(t),
    save() {}, restore() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {},
  }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const model = buildConflictCardModel(conflictById('chokepoint:hormuz'), {
    dateText: 'stav k 20.9.2026', sources: ['GFW', 'Yahoo Finance'],
    legend: [{ key: 'ships', colorCss: '#5b8fd0', dot: true, label: 'lode' }], legendHead: 'LEGENDA', translate: (k) => k,
  });
  assert.doesNotThrow(() => drawKartaExport(ctx, model, 1200, 594));
  assert.ok(texts.includes('STRAIT OF HORMUZ') || texts.includes('Strait of Hormuz'), 'titulok úžiny na kartičke');
  assert.ok(texts.includes('lode'), 'legenda na kartičke');
});
