// src/data/flightsBrightness.test.mjs — jas ikon flotily pri pohľade na Zem z výšky (2026-10-16, vlastník:
// „svetlosť lietadiel ako kompromis medzi žiarou miest a lietadlami").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import flightsLayer, { FLEET_FAR_BRIGHTNESS, fleetTint } from './flights.js';

test('fleetTint: tón × jas, alfa zachovaná; jas 1 vracia pôvodnú farbu; podlaha 0,2', () => {
  const white = Cesium.Color.WHITE.withAlpha(0.45);
  const dim = fleetTint(white, 0.6);
  assert.ok(Math.abs(dim.red - 0.6) < 1e-9 && Math.abs(dim.green - 0.6) < 1e-9 && Math.abs(dim.blue - 0.6) < 1e-9);
  assert.equal(dim.alpha, 0.45, 'alfa (čerstvosť) sa nemení');
  assert.equal(fleetTint(white, 1), white, 'jas 1 = tá istá farba');
  assert.equal(fleetTint(white, 0.05).red, 0.2, 'podlaha 0,2 — ikony nikdy nezmiznú');
  assert.equal(fleetTint(null, 0.5), null);
});

test('škvrny hustoty nesú ten istý jas: prepočet použije fleetTint a zmena jasu vynúti prepočet', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./flights.js', import.meta.url), 'utf8');
  const rebuild = src.slice(src.indexOf('function _rebuildTrafficDensityCells('), src.indexOf('function _rebuildTrafficDensityCells(') + 2500);
  assert.match(rebuild, /const color = fleetTint\(cell\.military > 0 \? MIL_TINT : DENSITY_CIVIL_TINT, _fleetBrightness\)/, 'tón bunky × jas flotily');
  const restyle = src.slice(src.indexOf('function _restyleFleetBrightness('), src.indexOf('function _restyleFleetBrightness(') + 600);
  assert.match(restyle, /_densityRebuiltAtMs = -Infinity;/, 'po zmene jasu sa škvrny prepočítajú hneď pri ďalšom tiku');
  const dim = fleetTint(Cesium.Color.fromCssColorString('#a78bde'), FLEET_FAR_BRIGHTNESS);
  assert.ok(dim.red < 0.4 && dim.blue < 0.53, 'fialová škvrna z výšky stlmená');
});

test('vrstva letov: setFleetBrightness orezáva na 0,2–1, bez zmeny nič nerobí, z výšky 0,6', () => {
  assert.equal(FLEET_FAR_BRIGHTNESS, 0.6);
  assert.equal(flightsLayer.fleetBrightness, 1);
  assert.equal(flightsLayer.setFleetBrightness(FLEET_FAR_BRIGHTNESS), 0.6, 'bez viewera a billboardov len zmení faktor');
  assert.equal(flightsLayer.fleetBrightness, 0.6);
  assert.equal(flightsLayer.setFleetBrightness(0.6), 0.6, 'rovnaká hodnota = bez práce');
  assert.equal(flightsLayer.setFleetBrightness(5), 1);
  assert.equal(flightsLayer.setFleetBrightness(0), 0.2);
  assert.equal(flightsLayer.setFleetBrightness(NaN), 1, 'neplatné = späť na 1');
});
