// src/data/naturalHazardsPanel.test.mjs
// Skupina „Prírodné hrozby" (2026-09-05): členovia, živý súhrn, štýl v jazyku panelu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NATURAL_HAZARD_LAYER_IDS, createNaturalHazardsPanel, hazardsSummary, isNaturalHazardLayer } from './naturalHazardsPanel.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const tr = (strings) => (k, vars) => { let s = strings[k] || k; for (const [a, b] of Object.entries(vars || {})) s = s.replaceAll(`{${a}}`, String(b)); return s; };

test('hrozby: členovia skupiny — zemetrasenia, vulkány, EONET udalosti, FIRMS, radar', () => {
  assert.deepEqual([...NATURAL_HAZARD_LAYER_IDS], ['earthquakes', 'volcanoes', 'natural-events', 'local-firms', 'shmu-radar']);
  assert.equal(isNaturalHazardLayer('shmu-radar'), true);
  assert.equal(isNaturalHazardLayer('flights'), false);
});

test('hrozby: živý súhrn počíta len zapnuté vrstvy, radar slovom, nič zapnuté = veta', () => {
  const layers = [
    { id: 'earthquakes', enabled: true, stats: { count: 176 } },
    { id: 'volcanoes', enabled: false, stats: { count: 32 } },
    { id: 'natural-events', enabled: true, stats: { count: 6 } },
    { id: 'local-firms', enabled: true, stats: { count: 0 } },
    { id: 'shmu-radar', enabled: true, stats: {} },
  ];
  assert.equal(hazardsSummary(layers, tr(SK_STRINGS)), '176 zemetrasení · 6 udalostí EONET · 0 požiarov FIRMS · radar zapnutý');
  assert.equal(hazardsSummary(layers, tr(EN_STRINGS)), '176 earthquakes · 6 EONET events · 0 FIRMS fires · radar on');
  assert.equal(hazardsSummary([], tr(SK_STRINGS)), SK_STRINGS['hazards.none-enabled']);
  assert.equal(hazardsSummary(null, tr(EN_STRINGS)), EN_STRINGS['hazards.none-enabled']);
});

test('hrozby: panel DOM — nadpis, súhrn ako podtitul, aria', () => {
  const mk = (tag) => ({ tag, children: [], attrs: {}, className: '', textContent: '', appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const doc = { createElement: mk };
  const root = createNaturalHazardsPanel(doc, [{ id: 'earthquakes', enabled: true, stats: { count: 3 } }]);
  assert.equal(root.className, 'natural-hazards-card');
  assert.equal(root.attrs['aria-label'], EN_STRINGS['hazards.title']);
  assert.equal(root.children[0].textContent, EN_STRINGS['hazards.title']);
  assert.equal(root.children[1].textContent, '3 earthquakes');
});

test('hrozby: tripwire — manažér posiela živé vrstvy, štýl je v jazyku panelu (žiadna oranžová škatuľa), FIRMS bez kľúča po slovensky', () => {
  const manager = readFileSync(new URL('./manager.js', import.meta.url), 'utf8');
  assert.match(manager, /createNaturalHazardsPanel\(document, this\.getAll\(\)\)/);
  // _refreshTogglePanel obnovuje riadky NA MIESTE — súhrn mimo riadkov musí obnoviť sám.
  assert.match(manager, /hazardsSummary\(this\.getAll\(\)\)/, 'živý súhrn sa obnovuje aj pri in-place refreshi');
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('.natural-hazards-card {'), css.indexOf('.natural-hazards-card {') + 1200);
  assert.doesNotMatch(block, /255,\s*173,\s*86/, 'oranžový rámik preč');
  assert.match(block, /var\(--font-mono\)/, 'nadpis v mono ako .panel-title');
  assert.match(block, /text-transform: uppercase/);
  const firms = readFileSync(new URL('./firmsHeatmap.js', import.meta.url), 'utf8');
  assert.match(firms, /t\('firms\.key-required'\)/, 'KEY REQUIRED ide cez i18n');
  assert.ok(SK_STRINGS['firms.key-required'] && EN_STRINGS['firms.key-required']);
  assert.match(SK_STRINGS['firms.key-required'], /zdarma/);
  assert.match(SK_STRINGS['layer.local-firms.name'], /^Požiare/, 'kratšie meno, nezalamuje sa na 3 riadky');
});
