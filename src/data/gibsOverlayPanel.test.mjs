// src/data/gibsOverlayPanel.test.mjs
// Skupina „Zem zo satelitu (NASA)" (2026-09-06): členovia, živý súhrn s dňom mozaiky, štýl panelu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGibsDayRow, createGibsOverlayPanel, gibsDayLabel, gibsOverlaySummary, isGibsOverlayLayer } from './gibsOverlayPanel.js';
import { GIBS_DAY_MAX_BACK, _resetGibsDayForTest, getGibsDayOffset } from './gibsDay.js';
import { GIBS_OVERLAY_LAYER_IDS } from './gibsOverlays.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const tr = (strings) => (k, vars) => { let s = strings[k] || k; for (const [a, b] of Object.entries(vars || {})) s = s.replaceAll(`{${a}}`, String(b)); return s; };

test('satelit: členovia skupiny = päť GIBS prekryvov, nič iné', () => {
  for (const id of GIBS_OVERLAY_LAYER_IDS) assert.equal(isGibsOverlayLayer(id), true);
  assert.equal(isGibsOverlayLayer('shmu-radar'), false);
  assert.equal(isGibsOverlayLayer('gibs-truecolor'), false, 'podklad nie je prekryv');
});

test('satelit: živý súhrn — zapnuté vrstvy a deň mozaiky (spoločný raz, rôzne pri každej)', () => {
  const same = [
    { id: 'gibs-sst', enabled: true, stats: { day: '2026-09-05' } },
    { id: 'gibs-precip', enabled: true, stats: { day: '2026-09-05' } },
    { id: 'gibs-snow', enabled: false, stats: { day: '2026-09-05' } },
  ];
  assert.equal(gibsOverlaySummary(same, tr(SK_STRINGS)), 'teplota mora · zrážky · 2026-09-05 UTC');
  assert.equal(gibsOverlaySummary(same, tr(EN_STRINGS)), 'sea temperature · precipitation · 2026-09-05 UTC');
  const mixed = [
    { id: 'gibs-sst', enabled: true, stats: { day: '2026-09-05' } },
    { id: 'gibs-sea-ice', enabled: true, stats: { day: '2026-09-03' } },
  ];
  assert.equal(gibsOverlaySummary(mixed, tr(SK_STRINGS)), 'teplota mora 2026-09-05 · morský ľad 2026-09-03');
  // Pred prvou sondou deň nie je — meno bez dňa, žiadne „null".
  assert.equal(gibsOverlaySummary([{ id: 'gibs-snow', enabled: true, stats: { day: null } }], tr(SK_STRINGS)), 'sneh');
  assert.equal(gibsOverlaySummary([], tr(SK_STRINGS)), SK_STRINGS['gibs.none-enabled']);
  assert.equal(gibsOverlaySummary(null, tr(EN_STRINGS)), EN_STRINGS['gibs.none-enabled']);
});

test('satelit: sekcia v jazyku panelu — zdieľa triedu hrozieb, vlastnú značku pre manažér', () => {
  const made = [];
  const doc = { createElement: (tag) => { const el = { tag, className: '', textContent: '', children: [], attrs: {}, appendChild(c) { this.children.push(c); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }; made.push(el); return el; } };
  const root = createGibsOverlayPanel(doc, []);
  assert.equal(root.tag, 'section');
  assert.ok(root.className.split(' ').includes('natural-hazards-card'), 'alias štýlu sekcie');
  assert.ok(root.className.split(' ').includes('gibs-overlay-card'), 'vlastná značka pre živý podtitul');
  assert.equal(root.children[0].tag, 'h3');
  assert.equal(root.children[1].tag, 'p');
  assert.equal(root.children[1].textContent, EN_STRINGS['gibs.none-enabled']);

  const manager = readFileSync(new URL('./manager.js', import.meta.url), 'utf8');
  assert.match(manager, /isGibsOverlayLayer\(layer\.id\)/, 'manažér skupinu skladá');
  assert.match(manager, /\.gibs-overlay-card > p/, 'živý podtitul sa obnovuje na mieste');
  assert.match(manager, /\.natural-hazards-card:not\(\.gibs-overlay-card\) > p/, 'podtitul hrozieb nesmie prepísať satelit');
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.natural-hazards-card \+ \.natural-hazards-card \{/, 'dve skupiny za sebou bez dvojitej čiary');
});

test('posuvník dňa: v hlavičke skupiny, zapisuje do gibsDay.js, text s dátumom', () => {
  _resetGibsDayForTest();
  const NOW = Date.UTC(2026, 8, 6, 15, 0);
  assert.equal(gibsDayLabel(0, NOW, tr(SK_STRINGS)), 'najnovší (2026-09-05)');
  assert.equal(gibsDayLabel(16, NOW, tr(SK_STRINGS)), '2026-08-20 · 16 d dozadu');
  assert.equal(gibsDayLabel(16, NOW, tr(EN_STRINGS)), '2026-08-20 · 16 d back');

  const doc = { createElement: (tag) => ({ tag, className: '', textContent: '', children: [], attrs: {}, listeners: {}, appendChild(c) { this.children.push(c); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } }) };
  const root = createGibsOverlayPanel(doc, []);
  const row = root.children[2];
  assert.equal(row.className, 'gibs-day-row', 'posuvník je tretí prvok skupiny (h3, p, riadok)');
  const [label, slider, value] = row.children;
  assert.equal(label.textContent, EN_STRINGS['gibs.day-label']);
  assert.equal(slider.type, 'range');
  assert.equal(slider.min, '0');
  assert.equal(slider.max, String(GIBS_DAY_MAX_BACK));
  assert.equal(slider.value, '0');
  assert.ok(slider.className.split(' ').includes('param-slider'), 'rovnaký vzhľad ako ostatné posuvníky');
  assert.equal(slider.attrs['aria-label'], EN_STRINGS['gibs.day-aria']);
  assert.match(value.textContent, /^latest \(\d{4}-\d{2}-\d{2}\)$/);

  slider.value = '12';
  for (const fn of slider.listeners.input) fn();
  assert.equal(getGibsDayOffset(), 12, 'input zapisuje do zdieľaného stavu');
  assert.match(value.textContent, /· 12 d back$/);

  // Nový riadok po prebudovaní panelu nesie aktuálnu hodnotu.
  const again = createGibsDayRow(doc);
  assert.equal(again.children[1].value, '12');
  _resetGibsDayForTest();
});
