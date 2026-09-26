// src/data/conflictsCatalog.test.mjs — katalóg zdieľateľných konfliktov (propagácia, krok 1).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFLICT_KINDS,
  SITUATION_CONFLICTS,
  buildConflictCardModel,
  conflictById,
  conflictFraming,
  conflictTitle,
  conflictsByRegion,
  listConflicts,
} from './conflictsCatalog.js';
import { MIDEAST_THEATRES } from './mideastTheatres.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { drawKartaExport } from '../ukraineKartaOverlay.js';

test('listConflicts: front + smery + úžiny + dejiská Blízkeho východu, každý s rámovaním a druhom', () => {
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
  assert.equal(new Set(ids).size, ids.length, 'id sú jedinečné naprieč rodinami');
  assert.ok(ids.includes('ukraine:front') && ids.includes('ukraine:lyman'), 'Ukrajina: celý front + Lyman');
  assert.ok(ids.includes('chokepoint:hormuz') && ids.includes('chokepoint:bab-el-mandeb'), 'úžiny');
  assert.ok(ids.includes('mideast:overview') && ids.includes('mideast:hormuz') && ids.includes('mideast:gaza'), 'dejiská Blízkeho východu');
  // 2026-09-26: situáciu „Perzský záliv" nahradili dejiská mideast:gulf a mideast:hormuz
  assert.ok(!ids.includes('gulf'), 'stará situácia gulf už nie je v katalógu');
  assert.deepEqual(SITUATION_CONFLICTS, [], 'situácie sú prázdne, mechanika druhu ostáva');
  assert.ok(Object.isFrozen(SITUATION_CONFLICTS));
  assert.ok(CONFLICT_KINDS.includes('situation') && CONFLICT_KINDS.includes('mideast-theatre'));
});

test('dejiská v katalógu: id mideast:<id>, región middle-east, prehľad prvý, odkaz na preset', () => {
  const theatres = conflictsByRegion('middle-east');
  assert.deepEqual(theatres.map((c) => c.id), MIDEAST_THEATRES.map((s) => `mideast:${s.id}`));
  assert.ok(theatres.every((c) => c.kind === 'mideast-theatre'));
  assert.equal(theatres[0].id, 'mideast:overview');
  assert.equal(theatres[0].overview, true, 'prehľad nesie príznak (panel/hlas ho môžu zoradiť prvý)');
  assert.ok(theatres.slice(1).every((c) => c.overview === false));
  const gaza = conflictById('mideast:gaza');
  assert.equal(gaza.sceneId, 'gaza');
  assert.equal(gaza.scene, MIDEAST_THEATRES.find((s) => s.id === 'gaza'), 'odkaz na preset pre prekladač a vrstvy');
  assert.equal(gaza.name, 'Gaza');
  assert.deepEqual(gaza.center, { lat: 31.42, lon: 34.38 });
  assert.deepEqual([...gaza.rectDegrees], [34.15, 31.2, 34.6, 31.65]);
});

test('conflictById a conflictsByRegion', () => {
  assert.equal(conflictById('ukraine:lyman').kind, 'ukraine-front');
  assert.equal(conflictById('chokepoint:hormuz').kind, 'chokepoint');
  assert.equal(conflictById('mideast:gulf').region, 'middle-east');
  assert.equal(conflictById('mideast:gulf').kind, 'mideast-theatre');
  assert.equal(conflictById('gulf'), null, 'holé gulf už nič nenájde');
  assert.equal(conflictById('nieco'), null);
  assert.ok(conflictsByRegion('ukraine').every((c) => c.kind === 'ukraine-front'));
  assert.ok(conflictsByRegion('maritime').every((c) => c.kind === 'chokepoint'));
  assert.equal(conflictsByRegion('middle-east').length, MIDEAST_THEATRES.length);
});

test('conflictFraming a conflictTitle', () => {
  const lyman = conflictById('ukraine:lyman');
  const fr = conflictFraming(lyman);
  assert.deepEqual(fr.center, lyman.center);
  assert.equal(fr.rectDegrees, lyman.rectDegrees);
  // identity translate → frontSceneLabel/chokepointSceneLabel/theatreLabel vráti stabilné EN meno
  assert.equal(conflictTitle(lyman, (k) => k), 'Lyman direction');
  assert.equal(conflictTitle(conflictById('chokepoint:hormuz'), (k) => k), 'Strait of Hormuz');
  assert.equal(conflictTitle(conflictById('mideast:hormuz'), (k) => k), 'Hormuz and the blockade');
  assert.equal(conflictTitle(conflictById('mideast:hormuz'), (k) => SK_STRINGS[k] ?? k), SK_STRINGS['theatre.hormuz.name']);
  assert.equal(conflictTitle(conflictById('mideast:south-lebanon'), (k) => EN_STRINGS[k] ?? k), 'South Lebanon');
  // situácia (bez presetu): titleKey s prekladom, inak fallback na meno — mechanika ostáva pre budúce regióny
  const situation = { id: 'x', kind: 'situation', region: 'middle-east', name: 'Somewhere', titleKey: 'conflict.x', scene: null };
  assert.equal(conflictTitle(situation, (k) => (k === 'conflict.x' ? 'Niekde' : k)), 'Niekde');
  assert.equal(conflictTitle(situation, (k) => k), 'Somewhere');
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
  // dejisko mimo Ukrajiny dostane obrys sveta s bodkou miesta
  const th = buildConflictCardModel(conflictById('mideast:gaza'), { translate: (k) => k });
  assert.equal(th.title.title, 'Gaza');
  assert.ok(th.inset && Array.isArray(th.inset.rings) && th.inset.rings.length > 10, 'inset sveta');
  assert.deepEqual(th.scene.center, { lat: 31.42, lon: 34.38 });
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
