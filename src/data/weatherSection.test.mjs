// src/data/weatherSection.test.mjs — sekcia POČASIE (2026-10-07): glóbus GFS a radar SHMÚ v jednom
// paneli. Súhrn, veta o zdrojoch, a hlavne správanie správcu: riadky oboch vrstiev idú do panela
// POČASIE v pevnom poradí, ostatné ostávajú v Dátových vrstvách, súhrn sa obnovuje po zapnutí;
// bez panela ostáva všetko v Dátových vrstvách.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_LAYER_IDS, createWeatherIntro, isWeatherLayer, weatherSummary } from './weatherSection.js';
import { isNaturalHazardLayer } from './naturalHazardsPanel.js';
import { DataLayerManager } from './manager.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const tr = (strings) => (k, vars) => { let s = strings[k] || k; for (const [a, b] of Object.entries(vars || {})) s = s.replaceAll(`{${a}}`, String(b)); return s; };

test('členovia: glóbus GFS, výstrahy SHMÚ a radar SHMÚ, radar už nie je v hrozbách', () => {
  assert.deepEqual([...WEATHER_LAYER_IDS], ['meteo-gfs', 'shmu-warnings', 'shmu-stations', 'shmu-radar', 'opera-radar']);
  assert.equal(isWeatherLayer('shmu-stations'), true);
  assert.equal(isWeatherLayer('opera-radar'), true);
  assert.equal(isWeatherLayer('meteo-gfs'), true);
  assert.equal(isWeatherLayer('shmu-warnings'), true);
  assert.equal(isWeatherLayer('shmu-radar'), true);
  assert.equal(isWeatherLayer('flights'), false);
  assert.equal(isNaturalHazardLayer('shmu-radar'), false, 'jeden riadok nemôže byť v dvoch skupinách');
});

test('súhrn a veta o zdrojoch: model vs meranie, SK aj EN', () => {
  const layers = [{ id: 'meteo-gfs', enabled: true }, { id: 'shmu-warnings', enabled: true }, { id: 'shmu-radar', enabled: false }];
  assert.equal(weatherSummary(layers, tr(SK_STRINGS)), 'Glóbus (GFS) zapnutý · výstrahy SHMÚ zapnuté · stanice SHMÚ vypnuté · radar SHMÚ vypnutý · radar Európy vypnutý');
  assert.equal(weatherSummary(layers, tr(EN_STRINGS)), 'Globe (GFS) on · SHMÚ warnings on · SHMÚ stations off · SHMÚ radar off · Europe radar off');
  assert.equal(weatherSummary(null, tr(SK_STRINGS)), 'Glóbus (GFS) vypnutý · výstrahy SHMÚ vypnuté · stanice SHMÚ vypnuté · radar SHMÚ vypnutý · radar Európy vypnutý');
  assert.match(SK_STRINGS['weather.note'], /Výstrahy SHMÚ = oficiálne výstrahy po okresoch/);
  assert.match(SK_STRINGS['weather.note'], /predpoveď modelu NOAA GFS/);
  assert.match(SK_STRINGS['weather.note'], /namerané zrážky nad Slovenskom/);
  const mk = (tag) => ({ tag, children: [], className: '', textContent: '', appendChild(c) { this.children.push(c); return c; } });
  const intro = createWeatherIntro({ createElement: mk }, layers, tr(SK_STRINGS));
  assert.equal(intro.className, 'weather-intro');
  assert.deepEqual(intro.children.map((c) => c.className), ['weather-summary', 'weather-note']);
  assert.equal(intro.children[0].textContent, 'Glóbus (GFS) zapnutý · výstrahy SHMÚ zapnuté · stanice SHMÚ vypnuté · radar SHMÚ vypnutý · radar Európy vypnutý');
});

function makeElement() {
  const element = {
    children: [], className: '', dataset: {}, textContent: '', disabled: false, attributes: {},
    classList: { toggle() {} },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector(selector) {
      const visit = (node, match) => {
        for (const child of node.children || []) {
          if (match(child)) return child;
          const found = visit(child, match);
          if (found) return found;
        }
        return null;
      };
      if (selector.startsWith('[data-layer-id="')) {
        const id = selector.slice(16, -2);
        return visit(this, (n) => n.dataset?.layerId === id);
      }
      const className = selector.startsWith('.') ? selector.slice(1) : '';
      return visit(this, (n) => String(n.className).split(/\s+/).includes(className));
    },
    set innerHTML(value) { if (value === '') this.children = []; },
    get innerHTML() { return ''; },
  };
  return element;
}

function makeLayer(id) {
  return {
    id, name: id, icon: '', enabled: false, showInTogglePanel: true, updateInterval: -1,
    async init() {}, enable() { this.enabled = true; }, disable() { this.enabled = false; }, async update() {},
    getStats() { return { count: 0 }; }, destroy() {},
  };
}

async function withFakeDocument(fn) {
  const original = globalThis.document;
  globalThis.document = { createElement: makeElement };
  try { await fn(); } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
}

test('správca: riadky glóbusu a radaru idú do POČASIA (GFS prvý), ostatné ostávajú v Dátových vrstvách; súhrn sa obnoví', async () => {
  await withFakeDocument(async () => {
    const mgr = new DataLayerManager({});
    // Radar registrovaný skôr než glóbus — poradie v sekcii aj tak drží WEATHER_LAYER_IDS.
    for (const id of ['flights', 'shmu-radar', 'meteo-gfs']) mgr.register(makeLayer(id));
    const data = makeElement();
    const weather = makeElement();
    try {
      mgr.buildWeatherPanel(weather);
      mgr.buildTogglePanel(data);
      assert.ok(data.querySelector('[data-layer-id="flights"]'), 'lietadlá ostávajú v Dátových vrstvách');
      assert.equal(data.querySelector('[data-layer-id="meteo-gfs"]'), null);
      assert.equal(data.querySelector('[data-layer-id="shmu-radar"]'), null);
      assert.equal(weather.children[0].className, 'weather-intro', 'navrchu súhrn a veta o zdrojoch');
      assert.deepEqual(weather.children.slice(1).map((r) => r.dataset.layerId), ['meteo-gfs', 'shmu-radar']);
      assert.equal(weather.querySelector('.weather-summary').textContent, 'Globe (GFS) off · SHMÚ warnings off · SHMÚ stations off · SHMÚ radar off · Europe radar off');

      assert.equal(await mgr.setEnabled('shmu-radar', true, { origin: 'user' }), true);
      mgr._refreshTogglePanel();
      assert.equal(weather.querySelector('.weather-summary').textContent, 'Globe (GFS) off · SHMÚ warnings off · SHMÚ stations off · SHMÚ radar on · Europe radar off', 'súhrn žije');
      assert.ok(mgr._findToggleRow('shmu-radar'), 'obnova riadkov nájde riadok aj v sekcii POČASIE');

      // Opakované vykreslenie neduplikuje riadky ani súhrn.
      mgr._renderToggles();
      assert.equal(weather.children.length, 3);
    } finally {
      await mgr.destroyAll();
    }
  });
});

test('správca bez panela POČASIE: všetky riadky ostávajú v Dátových vrstvách (testy, cudzí dokument)', async () => {
  await withFakeDocument(async () => {
    const mgr = new DataLayerManager({});
    for (const id of ['meteo-gfs', 'shmu-radar']) mgr.register(makeLayer(id));
    const data = makeElement();
    try {
      mgr.buildTogglePanel(data);
      assert.ok(data.querySelector('[data-layer-id="meteo-gfs"]'));
      assert.ok(data.querySelector('[data-layer-id="shmu-radar"]'));
    } finally {
      await mgr.destroyAll();
    }
  });
});
