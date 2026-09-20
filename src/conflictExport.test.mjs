// src/conflictExport.test.mjs — jadro exportu kartičiek konfliktov (propagácia).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_RATIOS,
  CARD_RATIO_IDS,
  cardRatio,
  conflictCardFilename,
  conflictCardModel,
  defaultConflictFacts,
  downloadCardSnapshot,
} from './conflictExport.js';
import { conflictById } from './data/conflictsCatalog.js';

test('pomery kartičiek: feed/štvorec/story, fallback na feed', () => {
  assert.deepEqual(CARD_RATIO_IDS, ['feed', 'square', 'story']);
  assert.deepEqual(cardRatio('feed'), CARD_RATIOS.feed);
  assert.deepEqual(cardRatio('square'), { id: 'square', w: 1080, h: 1080 });
  assert.deepEqual(cardRatio('story'), { id: 'story', w: 1080, h: 1920 });
  assert.deepEqual(cardRatio('nieco'), CARD_RATIOS.feed, 'neznámy = feed');
});

test('defaultConflictFacts: zdroje podľa druhu, Ukrajina prázdna (dodá KARTA)', () => {
  assert.ok(defaultConflictFacts(conflictById('chokepoint:hormuz')).sources.includes('Global Fishing Watch'));
  assert.ok(defaultConflictFacts(conflictById('gulf')).sources.includes('GDELT'));
  assert.deepEqual(defaultConflictFacts(conflictById('ukraine:lyman')).sources, []);
  assert.deepEqual(defaultConflictFacts(null), { sources: [], legend: [], legendHead: '' });
});

test('conflictCardModel: Ukrajina z KARTA prekryvu, inak z katalógu', () => {
  const overlayModel = { title: { title: 'KARTA-LIVE' }, legend: [{ key: 'x' }], scene: { center: { lon: 37, lat: 49 } } };
  const kartaOverlay = { getModel: () => overlayModel };
  const ua = conflictCardModel(conflictById('ukraine:lyman'), { kartaOverlay });
  assert.equal(ua, overlayModel, 'ukrajinský smer berie živý model KARTA');
  // úžina bez prekryvu → z katalógu (titulok + inset sveta)
  const hz = conflictCardModel(conflictById('chokepoint:hormuz'), { dateText: 'stav k dnes', sources: ['GFW'], translate: (k) => k });
  assert.equal(hz.title.title, 'Strait of Hormuz');
  assert.equal(hz.title.subtitle, 'stav k dnes');
  assert.ok(hz.inset && Array.isArray(hz.inset.rings) && hz.inset.rings.length > 10, 'globálny konflikt má obrys sveta');
  // aj bez prekryvu ukrajinský smer padne na katalóg (inset = Ukrajina/default)
  const uaCat = conflictCardModel(conflictById('ukraine:lyman'), { translate: (k) => k });
  assert.equal(uaCat.inset, null, 'Ukrajina = predvolený obrys (Ukrajina)');
});

test('conflictCardFilename: bezpečný názov s pomerom a dátumom', () => {
  assert.equal(conflictCardFilename(conflictById('chokepoint:hormuz'), 'square', '2026-09-20T10:00:00Z'), 'oko-chokepoint-hormuz-square-2026-09-20.jpg');
  assert.equal(conflictCardFilename(conflictById('ukraine:lyman'), 'feed', ''), 'oko-ukraine-lyman-feed.jpg');
  assert.equal(conflictCardFilename(null, 'story'), 'oko-conflict-story.jpg');
});

test('downloadCardSnapshot: klikne odkaz s dataURL, bez dataURL nič', () => {
  const clicks = [];
  const node = { href: '', download: '', click() { clicks.push([this.href, this.download]); }, remove() {} };
  const doc = { createElement: () => node, body: { appendChild() {}, removeChild() {} } };
  assert.equal(downloadCardSnapshot({ jpegDataUrl: 'data:image/jpeg;base64,AAA' }, 'x.jpg', doc), true);
  assert.deepEqual(clicks, [['data:image/jpeg;base64,AAA', 'x.jpg']]);
  assert.equal(downloadCardSnapshot(null, 'x.jpg', doc), false);
  assert.equal(downloadCardSnapshot({ jpegDataUrl: '' }, 'x.jpg', doc), false);
});
