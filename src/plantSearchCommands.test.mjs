import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlantIndex, createPlantSearchCommands, looksLikePlantQuery, matchPlants, plantHint, PLANT_GROUP } from './plantSearchCommands.js';

const line = (id, name, mw, extra = {}) => JSON.stringify({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [18.4, 48.2] }, properties: { name, mw, fuel: 'nuclear', cc: 'SK', ...extra } });
const TEXT = [
  line('a', 'Mochovce Nuclear Power Plant', 1411),
  line('b', 'Gabčíkovo', 720, { fuel: 'hydro' }),
  line('c', 'Small Gabcikovo Weir', 110, { fuel: 'hydro' }),
  line('d', 'Vojany', 880, { fuel: 'coal', status: 'closed' }),
  'nie json',
  '',
].join('\n');

test('dopyt: aspoň 3 písmená', () => {
  assert.equal(looksLikePlantQuery('mo'), false);
  assert.equal(looksLikePlantQuery('1234'), false);
  assert.equal(looksLikePlantQuery('Moch'), true);
});

test('index preskočí pokazené riadky', () => {
  const index = buildPlantIndex(TEXT);
  assert.equal(index.length, 4);
  assert.equal(index[1].fold, 'gabcikovo');
});

test('zhoda: diakritika, od začiatku pred slovom, väčšia skôr', () => {
  const index = buildPlantIndex(TEXT);
  assert.deepEqual(matchPlants(index, 'gabčík').map((p) => p.id), ['b', 'c']);
  assert.deepEqual(matchPlants(index, 'nuclear').map((p) => p.id), ['a']);
  assert.deepEqual(matchPlants(index, 'xx'), []);
});

test('nápoveda: palivo · výkon · štát, zatvorená označená', () => {
  const tr = (k) => k;
  const [vojany] = matchPlants(buildPlantIndex(TEXT), 'vojany');
  assert.equal(plantHint(vojany, tr, 'sk').replace(/\s/g, ' '), 'plant.fuel-coal · 880 MW · SK · cmd.plant.closed');
});

test('príkaz zapne vrstvu a preletí nad elektráreň; snímok sa stiahne raz', async () => {
  let fetches = 0;
  const fetchImpl = async () => { fetches += 1; return { ok: true, text: async () => TEXT }; };
  const enabled = [];
  const flights = [];
  const notes = [];
  const search = createPlantSearchCommands({
    url: '/p.geojsonl', fetchImpl, notify: (t) => notes.push(t),
    dataManager: { isEnabled: () => false, setEnabled: async (id, on) => { enabled.push([id, on]); } },
    viewer: { camera: { flyTo: (o) => flights.push(o) } },
    Cesium: { Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h }) } },
  });
  assert.deepEqual(await search.asyncResults('mo'), []);
  assert.equal(fetches, 0, 'krátky dopyt nesťahuje snímok');
  const cmds = await search.asyncResults('Mochovce');
  await search.asyncResults('Vojany');
  assert.equal(fetches, 1);
  assert.equal(cmds[0].group, PLANT_GROUP);
  assert.equal(cmds[0].id, 'plant:a');
  cmds[0].run();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(enabled, [['local-power-plants', true]]);
  assert.deepEqual(flights[0].destination, { lon: 18.4, lat: 48.2, h: 25_000 });
  assert.match(notes[0], /^Mochovce Nuclear Power Plant · /);
});

test('zlyhané stiahnutie sa skúsi znova', async () => {
  let n = 0;
  const search = createPlantSearchCommands({ url: '/p', fetchImpl: async () => (++n === 1 ? { ok: false, status: 503 } : { ok: true, text: async () => TEXT }) });
  await assert.rejects(() => search.asyncResults('Mochovce'));
  assert.equal((await search.asyncResults('Mochovce')).length, 1);
});

test('skutočný snímok: Mochovce, Temelín a Tri rokliny sa nájdu', () => {
  const text = fs.readFileSync(new URL('./data/local_data/power_plants/power-plants.geojsonl', import.meta.url), 'utf8');
  const index = buildPlantIndex(text);
  assert.ok(index.length > 7000);
  assert.equal(matchPlants(index, 'mochovce')[0]?.cc, 'SK');
  assert.equal(matchPlants(index, 'temelin')[0]?.cc, 'CZ');
  assert.ok(matchPlants(index, 'three gorges')[0]?.mw > 20_000);
});

test('i18n: skupina a značka zatvorenej v oboch jazykoch', () => {
  const src = fs.readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  for (const key of ['cmd.group.plants', 'cmd.plant.closed']) assert.equal(src.split(`'${key}':`).length - 1, 2, key);
});
