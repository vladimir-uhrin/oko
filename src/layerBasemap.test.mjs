// src/layerBasemap.test.mjs — mapa podľa vrstvy (2026-10-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYER_BASEMAPS, createLayerBasemapPolicy, parseAutoBasemapSetting } from './layerBasemap.js';
import { MAP_STACKS } from './mapStackController.js';

function harness({ active = 'photoreal', on = true, stacks = MAP_STACKS.map((s) => s.id) } = {}) {
  const h = { active, on, notes: [], sets: [] };
  h.policy = createLayerBasemapPolicy({
    getActiveId: () => h.active,
    hasStack: (id) => stacks.includes(id),
    setStack: (id) => { h.sets.push(id); h.active = id; h.policy.onMapChange(id); },
    notify: (info) => h.notes.push(info),
    isOn: () => h.on,
  });
  return h;
}
const user = (layerId, enabled) => ({ layerId, enabled, origin: 'user' });

test('dvojice: len existujúce mapy; lietadlá, lode, Ukrajina ani meteo mapu nemenia', () => {
  const ids = new Set(MAP_STACKS.map((s) => s.id));
  for (const [layer, map] of Object.entries(LAYER_BASEMAPS)) assert.ok(ids.has(map), `${layer} → ${map} existuje`);
  for (const layer of ['flights', 'military', 'ais-live-vessels', 'satellites', 'ukraine', 'meteo-gfs']) assert.equal(LAYER_BASEMAPS[layer], undefined, layer);
  assert.notEqual(LAYER_BASEMAPS.earthquakes, 'karta', 'KARTA je mapa frontu, nie reliéf sveta');
  assert.ok(!Object.values(LAYER_BASEMAPS).some((m) => m.startsWith('stadia')), 'Stadia na okolive.sk nefunguje (401)');
});

test('zapnutie vrstvy prepne mapu s hláškou, vypnutie vráti pôvodnú', () => {
  const h = harness();
  assert.equal(h.policy.onLayerChange(user('earthquakes', true)), true);
  assert.equal(h.active, 'aster-relief');
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].mapId, 'aster-relief');
  h.policy.onLayerChange(user('earthquakes', false));
  assert.equal(h.active, 'photoreal', 'späť na pôvodnú mapu');
  assert.deepEqual(h.policy.state().owners, []);
});

test('len kliknutie používateľa: obnova z odkazu ani program mapu neprepne; vypnutý vypínač tiež nie', () => {
  const h = harness();
  for (const origin of ['share-restore', 'local-restore', 'programmatic', 'context-restore']) {
    h.policy.onLayerChange({ layerId: 'earthquakes', enabled: true, origin });
  }
  assert.equal(h.active, 'photoreal');
  h.on = false;
  h.policy.onLayerChange(user('earthquakes', true));
  assert.equal(h.active, 'photoreal');
  assert.equal(h.policy.onLayerChange(user('flights', true)), false, 'lietadlá mapu nemenia');
});

test('viac vrstiev: platí naposledy zapnutá; po jej vypnutí mapa predošlej, nakoniec pôvodná', () => {
  const h = harness({ active: 'osm' });
  h.policy.onLayerChange(user('earthquakes', true));
  h.policy.onLayerChange(user('natural-events', true));
  assert.equal(h.active, 'gibs-truecolor');
  h.policy.onLayerChange(user('natural-events', false));
  assert.equal(h.active, 'aster-relief');
  h.policy.onLayerChange(user('volcanoes', true));
  assert.equal(h.notes.length, 2, 'rovnaká mapa = bez ďalšej hlášky');
  h.policy.onLayerChange(user('earthquakes', false));
  assert.equal(h.active, 'aster-relief', 'sopky reliéf stále potrebujú');
  h.policy.onLayerChange(user('volcanoes', false));
  assert.equal(h.active, 'osm');
});

test('ručná voľba mapy má prednosť do konca návštevy; „Vrátiť" tiež; vypínač automatiku obnoví', () => {
  const h = harness();
  h.policy.onLayerChange(user('earthquakes', true));
  h.active = 'osm';
  h.policy.onManualChoice();
  h.policy.onLayerChange(user('earthquakes', false));
  assert.equal(h.active, 'osm', 'vypnutie vrstvy ručnú voľbu neprepíše');
  h.policy.onLayerChange(user('natural-events', true));
  assert.equal(h.active, 'osm', 'ani ďalšia vrstva');
  h.policy.onSettingChange(true);
  h.policy.onLayerChange(user('natural-events', true));
  assert.equal(h.active, 'gibs-truecolor', 'po zapnutí vypínača znova funguje');
  h.notes.at(-1).undo();
  assert.equal(h.active, 'osm', '„Vrátiť" vráti mapu');
  h.policy.onLayerChange(user('earthquakes', true));
  assert.equal(h.active, 'osm', 'a automatiku pre návštevu vypne');
});

test('cudzia zmena mapy (scéna frontu, meteo): vrstvu už neriadime a pri vypnutí nič nevraciame', () => {
  const h = harness();
  h.policy.onLayerChange(user('earthquakes', true));
  h.active = 'karta'; // scéna frontu
  h.policy.onMapChange('karta');
  h.policy.onLayerChange(user('earthquakes', false));
  assert.equal(h.active, 'karta');
  assert.equal(h.policy.state().manualLock, false, 'nie je to ručná voľba — automatika žije ďalej');
  h.policy.onLayerChange(user('volcanoes', true));
  assert.equal(h.active, 'aster-relief');
});

test('mapa už je tá správna alebo nedostupná: bez prepnutia a bez hlášky', () => {
  const same = harness({ active: 'aster-relief' });
  assert.equal(same.policy.onLayerChange(user('earthquakes', true)), false);
  assert.equal(same.notes.length, 0);
  same.policy.onLayerChange(user('earthquakes', false));
  assert.equal(same.active, 'aster-relief', 'nebola naša — nevraciame');
  const missing = harness({ stacks: ['photoreal', 'osm'] });
  assert.equal(missing.policy.onLayerChange(user('earthquakes', true)), false);
  assert.equal(missing.active, 'photoreal');
});

test('nastavenie a zapojenie: predvolene zapnuté, vypínač v Zobrazení, ručná voľba z čipov', () => {
  assert.equal(parseAutoBasemapSetting(null), true);
  assert.equal(parseAutoBasemapSetting('off'), false);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="map-auto-basemap"/);
  const chips = readFileSync(new URL('./mapStackChips.js', import.meta.url), 'utf8');
  assert.equal(chips.split('announceManualChoice(ownerDoc').length - 1, 2, 'oba ručné výbery (čipy aj varianty) hlásia ručnú voľbu');
  const strings = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  for (const key of ['presets.auto-basemap', 'basemap.auto-toast']) assert.equal((strings.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length, 2, key);
});

test('priblíženie: zblízka pôvodná mapa, z diaľky mapa vrstvy, medzi prahmi sa nič nemení', async () => {
  const { AUTO_BASEMAP_FAR_M, AUTO_BASEMAP_NEAR_M } = await import('./layerBasemap.js');
  const h = harness();
  h.policy.onCameraHeight(9_000_000);
  h.policy.onLayerChange(user('earthquakes', true));
  assert.equal(h.active, 'aster-relief');
  assert.equal(h.policy.onCameraHeight(AUTO_BASEMAP_NEAR_M - 1), true);
  assert.equal(h.active, 'photoreal', 'zblízka Google 3D');
  assert.equal(h.policy.onCameraHeight((AUTO_BASEMAP_NEAR_M + AUTO_BASEMAP_FAR_M) / 2), false, 'medzi prahmi bez kmitania');
  assert.equal(h.active, 'photoreal');
  assert.equal(h.policy.onCameraHeight(AUTO_BASEMAP_FAR_M + 1), true);
  assert.equal(h.active, 'aster-relief', 'z diaľky znova reliéf');
  assert.equal(h.notes.length, 1, 'hláška len raz');
  // Vypnutie zblízka: ostáva pôvodná mapa a po oddialení sa už nič neprepne.
  h.policy.onCameraHeight(50_000);
  h.policy.onLayerChange(user('earthquakes', false));
  h.policy.onCameraHeight(9_000_000);
  assert.equal(h.active, 'photoreal');
});

test('priblíženie: vrstva zapnutá zblízka prepne mapu (s hláškou) až pri oddialení; ručná voľba to zruší', () => {
  const h = harness();
  h.policy.onCameraHeight(20_000);
  assert.equal(h.policy.onLayerChange(user('natural-events', true)), false);
  assert.equal(h.active, 'photoreal');
  assert.equal(h.notes.length, 0);
  h.policy.onCameraHeight(5_000_000);
  assert.equal(h.active, 'gibs-truecolor');
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].layerId, 'natural-events');
  h.policy.onCameraHeight(20_000);
  h.active = 'osm';
  h.policy.onManualChoice();
  h.policy.onCameraHeight(5_000_000);
  assert.equal(h.active, 'osm', 'po ručnej voľbe sa pri oddialení nič neprepne');
});

test('hláška: zrozumiteľné mená mapy a vrstvy v SK aj EN', () => {
  const strings = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  assert.match(strings, /'basemap\.auto-toast': 'Mapa prepnutá na \{map\} kvôli vrstve \{layer\} · ťukni pre návrat'/);
  for (const map of new Set(Object.values(LAYER_BASEMAPS))) {
    assert.equal(strings.split(`'basemap.name.${map}':`).length - 1, 2, `meno mapy ${map} v oboch jazykoch`);
  }
  for (const layer of Object.keys(LAYER_BASEMAPS)) assert.ok(strings.includes(`'layer.${layer}.name':`), `meno vrstvy ${layer}`);
});
