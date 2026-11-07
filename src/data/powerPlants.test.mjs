import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLANT_CLOSED_COLOR, PLANT_FUELS, POWER_PLANTS_DATA_YEAR, formatPlantGwh, formatPlantMw, plantColor, plantFuelGroup, plantImportance, plantOverlayCopy, plantTitleFlag,
} from './powerPlants.js';
import { POWER_MIX_GROUPS } from './powerMarket.js';

const tr = (key, vars = {}) => `${key}${Object.keys(vars).length ? `(${Object.values(vars).join('|')})` : ''}`;

test('palivá WRI → skupiny mixu výroby', () => {
  assert.equal(plantFuelGroup('Nuclear'), 'nuclear');
  assert.equal(plantFuelGroup('Wave and Tidal'), 'bio');
  assert.equal(plantFuelGroup('Waste'), 'bio');
  assert.equal(plantFuelGroup('Petcoke'), 'oil');
  assert.equal(plantFuelGroup('Storage'), 'other');
  assert.equal(plantFuelGroup(''), 'other');
  for (const fuel of PLANT_FUELS) assert.ok(POWER_MIX_GROUPS.some((g) => g.key === fuel), `${fuel} má farbu z panelu`);
});

test('farba: palivo z panelu energie, zatvorená sivá', () => {
  assert.equal(plantColor({ fuel: 'nuclear' }), POWER_MIX_GROUPS.find((g) => g.key === 'nuclear').color);
  assert.equal(plantColor({ fuel: 'coal', status: 'closed' }), PLANT_CLOSED_COLOR);
  assert.match(plantColor({ fuel: 'nonsense' }), /^#/);
});

test('dôležitosť: z kontinentu len ≥ 1 GW, zatvorené len zblízka', () => {
  assert.equal(plantImportance({ mw: 1411 }), 300);
  assert.equal(plantImportance({ mw: 430 }), 150);
  assert.equal(plantImportance({ mw: 120 }), 60);
  assert.equal(plantImportance({ mw: 880, status: 'closed' }), 60);
  assert.equal(plantImportance({}), 0);
});

test('formát výkonu a výroby', () => {
  assert.equal(formatPlantMw(1411, 'sk').replace(/\s/g, ' '), '1 411 MW');
  assert.equal(formatPlantMw(22500, 'sk'), '22,5 GW');
  assert.equal(formatPlantMw(22500, 'en'), '22.5 GW');
  assert.equal(formatPlantMw(null), '');
  assert.equal(formatPlantGwh(7197, 'sk'), '7,2 TWh');
  assert.equal(formatPlantGwh(450, 'sk'), '450 GWh');
});

test('karta: palivo · výkon, výroba, rok, vlastník, rok databázy', () => {
  const lines = plantOverlayCopy({ fuel: 'nuclear', mw: 1411, gen_gwh: 7197, gen_year: 2017, year: 1998, owner: 'SE', corrected: true }, tr, 'sk');
  assert.equal(lines[0].replace(/\s/g, ' '), 'plant.fuel-nuclear · 1 411 MW');
  assert.equal(lines[1], 'plant.generation(7,2 TWh|2017)');
  assert.equal(lines[2], 'plant.commissioned(1998)');
  assert.equal(lines[3], 'SE');
  assert.equal(lines.at(-1), `plant.data-corrected(${POWER_PLANTS_DATA_YEAR})`);
  const closed = plantOverlayCopy({ fuel: 'coal', mw: 880, gen_gwh: 708, gen_year: 2017, status: 'closed', closed: '2024-03' }, tr, 'sk');
  assert.equal(closed[1], 'plant.closed(2024-03)', 'zatvorená neukazuje starú výrobu');
  assert.equal(closed.at(-1), `plant.data-year(${POWER_PLANTS_DATA_YEAR})`);
});

test('vlajka len z platného ISO2', () => {
  assert.equal(plantTitleFlag({ cc: 'sk' }), 'SK');
  assert.equal(plantTitleFlag({ cc: 'SVK' }), null);
  assert.equal(plantTitleFlag({}), null);
});

test('i18n: každý kľúč karty v oboch jazykoch', () => {
  const src = fs.readFileSync(new URL('../i18nStrings.js', import.meta.url), 'utf8');
  const keys = [...PLANT_FUELS.map((f) => `plant.fuel-${f}`), 'plant.generation', 'plant.commissioned', 'plant.closed', 'plant.data-year', 'plant.data-corrected', 'layer.local-power-plants.name'];
  for (const key of keys) assert.equal(src.split(`'${key}':`).length - 1, 2, key);
});

test('bundlovaný snímok: tvar, prah a slovenské opravy', () => {
  const text = fs.readFileSync(new URL('./local_data/power_plants/power-plants.geojsonl', import.meta.url), 'utf8');
  const features = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(features.length > 7000);
  assert.ok(features.every((f) => f.geometry.type === 'Point' && f.properties.mw >= 100 && PLANT_FUELS.includes(f.properties.fuel)));
  const byId = new Map(features.map((f) => [f.id, f.properties]));
  assert.equal(byId.get('GEODB0042632').status, 'closed', 'Vojany');
  assert.equal(byId.get('GEODB0042634').status, 'closed', 'Nováky');
  assert.equal(byId.get('GEODB0004330').mw, 1411, 'Mochovce');
});
