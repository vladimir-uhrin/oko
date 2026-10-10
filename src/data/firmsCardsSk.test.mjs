// src/data/firmsCardsSk.test.mjs — karty požiarov v slovenčine (2026-10-10: boli len po anglicky).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, _resetLanguageForTest } from '../i18n.js';
import { buildSelectedFireCard, buildFireCard, buildCellCard } from './firmsHeatmap.js';

const NOW = Date.UTC(2026, 9, 10, 12, 0);
const fire = { index: 0, lat: 47.588, lon: 36.9745, frp: 253, confidence: 0.9, brightness: 330, night: false, acqMs: NOW - 7 * 3600_000, sensor: 'SLSTR', satellite: 'S3B', geo: false, geoSeenMs: 0, repeats: 0, scanKm: 1.1, trackKm: 1.3, contextEntity: null, position: null };

test('slovenské karty: POŽIAR, spoľahlivosť, pred X h, DEŇ/NOC, ohniská podľa počtu', () => {
  setLanguage('sk', { reload: false });
  try {
    const sel = buildSelectedFireCard(fire, NOW);
    assert.equal(sel.title, 'POŽIAR · 253 MW');
    assert.equal(sel.details[0], 'spoľahlivosť vysoká · pred 7h · SLSTR S3B');
    assert.equal(sel.details[1], '47.588°N 36.974°E · DEŇ');
    assert.equal(sel.details[2], 'Sentinel-3B pred 7 h · pixel 1.1×1.3 km');
    assert.equal(buildFireCard({ fire: { ...fire, confidence: 0.5 }, position: {} }, NOW).details[0], 'stredná · 7h · S3B');
    const cell = (count) => buildCellCard({ cell: { count, maxFrp: 115, newestAcqMs: NOW - 9 * 3600_000, latCell: 1, lonCell: 2 }, position: {} }, NOW);
    assert.equal(cell(1).title, '1 OHNISKO');
    assert.equal(cell(3).title, '3 OHNISKÁ');
    assert.equal(cell(37).title, '37 OHNÍSK');
    assert.equal(cell(37).details[0], 'max 115 MW · posledné pred 9h');
  } finally {
    _resetLanguageForTest();
  }
});
