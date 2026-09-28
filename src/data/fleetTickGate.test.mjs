// src/data/fleetTickGate.test.mjs
// Brána tiku flotily (2026-09-28, „procesor je strašne vyťažený"): skrytý
// stroj sa neprepočítava; viditeľný zapisuje polohu až od pol pixela.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { fleetContactSkipsTick, metersPerPixelPerMeter, positionWriteThresholdM, pinBillboardBufferUsage } from './fleetTickGate.js';

test('pripnutý typ bufferov: Cesium už neprestavia celé vertex pole pri občasnej zmene farby/scale/obrázka', () => {
  const bc = new Cesium.BillboardCollection();
  assert.equal(typeof Cesium.BillboardCollection.prototype.computeNewBuffersUsage, 'function', 'Cesium má metódu, ktorú pripíname (pri zmene verzie prehodnotiť)');
  assert.equal(pinBillboardBufferUsage(bc), true);
  assert.equal(bc.computeNewBuffersUsage(), false, 'typ sa nemení → žiadna prestavba');
  assert.equal(pinBillboardBufferUsage(null), false);
  assert.equal(pinBillboardBufferUsage({}), false);
});

test('preskočí sa len stroj, ktorý už je skrytý a je skrytý aj podľa testu na najnovšom fixe', () => {
  assert.equal(fleetContactSkipsTick(false, true), true);
  assert.equal(fleetContactSkipsTick(true, true), false, 'čerstvo zhasnutý ide plnou cestou (zhasne aj model)');
  assert.equal(fleetContactSkipsTick(false, false), false, 'vynorený stroj ide naplno hneď');
  assert.equal(fleetContactSkipsTick(true, false), false, 'viditeľný vždy naplno');
});

test('metre na pixel: perspektíva z fovy a výšky plátna; bez perspektívy 0', () => {
  const f = metersPerPixelPerMeter(Math.PI / 3, 860); // 60° zvislo, 860 px
  assert.ok(Math.abs(f - 0.0013427) < 1e-6, String(f));
  assert.equal(metersPerPixelPerMeter(undefined, 860), 0, 'ortografická kamera plátna nemá fovy');
  assert.equal(metersPerPixelPerMeter(NaN, 860), 0);
  assert.equal(metersPerPixelPerMeter(Math.PI / 3, 0), 0);
  assert.equal(metersPerPixelPerMeter(-1, 860), 0);
});

test('prah zápisu: pol pixela pri vzdialenosti, najmenej 1 m', () => {
  const f = metersPerPixelPerMeter(Math.PI / 3, 860);
  assert.equal(positionWriteThresholdM(500, f), 1, 'blízko: každý meter');
  assert.ok(Math.abs(positionWriteThresholdM(50_000, f) - 33.6) < 0.1, '50 km ≈ 67 m/px → 34 m');
  assert.ok(Math.abs(positionWriteThresholdM(5_000_000, f) - 3357) < 1, 'pohľad na svet: kilometre');
  assert.equal(positionWriteThresholdM(50_000, 0), 1, 'bez perspektívy 1 m');
  assert.equal(positionWriteThresholdM(NaN, f), 1);
});

test('obe letecké vrstvy: brána stojí v _fleetTick PRED dead reckoningom, číta najnovší fix, jediný test skrytia slúži obom miestam, zápis polohy má prah', () => {
  for (const file of ['flights.js', 'militaryFlights.js']) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(src, /import \{ fleetContactSkipsTick, metersPerPixelPerMeter, pinBillboardBufferUsage, positionWriteThresholdM \} from '\.\/fleetTickGate\.js';/, file);
    assert.match(src, /_billboardCollection = new Cesium\.BillboardCollection\(\);\s*pinBillboardBufferUsage\(_billboardCollection\);/, `${file}: typ bufferov flotily je pripnutý`);
    // Stroj s modelom: show ostáva false (žiadne zapni/vypni v jednom tiku).
    assert.match(src, /if \(bb\.show === beyondHorizon && !\(ownsVisualNow && !beyondHorizon\)\) bb\.show = !beyondHorizon;/, `${file}: model-owned stroj sa v tiku nezapína`);
    const tick = src.slice(src.indexOf('function _fleetTick() {'));
    const gate = tick.indexOf('if (fleetContactSkipsTick(bb.show, _fleetContactHidden(info, newest ? newest.position : bb.position, occluder))) {');
    const dr = tick.indexOf('const dr = _deadReckon(icao24, _scratchFleetPos);');
    assert.ok(gate > 0 && dr > gate, `${file}: brána pred _deadReckon v hlavnej slučke, pozičné argumenty (bez alokácie)`);
    assert.match(tick, /const beyondHorizon = _fleetContactHidden\(info, bb\.position, occluder\);/, `${file}: po dead reckoningu sa testuje ZOBRAZENÁ poloha`);
    // Zapamätaný verdikt: skrytý stroj sa znova testuje až pri novej epoche brány alebo novom fixe.
    const cached = tick.slice(tick.indexOf('if (!bb.show) {'), gate);
    assert.match(cached, /const newest = _newestFix\(icao24\);\s*const fixMs = newest \? \(newest\.epochMs \?\? -2\) : -1;\s*if \(bb\._gevGateEpoch === _fleetGateEpoch && bb\._gevGateFixMs === fixMs\) continue;/, `${file}: verdikt „skrytý" sa pamätá`);
    // Preskočený stroj si verdikt zapíše a zhasne aj svoj 3D model (zrkadlo vetvy beyondHorizon).
    const skipBranch = tick.slice(gate, dr);
    assert.match(skipBranch, /bb\._gevGateEpoch = _fleetGateEpoch;\s*bb\._gevGateFixMs = fixMs;\s*if \(_models\.size\) \{\s*const m = _models\.get\(icao24\);\s*if \(m && m\.show\) m\.show = false;\s*\}\s*continue;/, file);
    // Epocha brány rastie pri pohybe kamery a zmene filtra kategórií.
    assert.match(tick, /if \(poseSig !== _lastGatePoseSig\) \{\s*_lastGatePoseSig = poseSig;\s*_fleetGateEpoch\+\+;/, `${file}: pohyb kamery zdvihne epochu`);
    assert.match(src, /_hiddenCategories = next;[\s\S]{0,260}?_lastFleetTickMs = 0;[^\n]*\n\s*_fleetGateEpoch\+\+;/, `${file}: zmena filtra kategórií zdvihne epochu`);
    assert.match(src, /function _fleetContactHidden\(info, position, occluder\) \{[\s\S]{0,60}?!_categoryVisible\(info\?\.klass\)\s*\|\| !occluder\.isPointVisible\(info\?\.cullPosition \|\| position\);/, file);
    assert.match(src, /function _newestFix\(icao24\) \{\s*const history = _positionHistory\.get\(icao24\);\s*return history && history\.length \? history\[history\.length - 1\] : null;/, `${file}: brána číta najnovší fix`);
    assert.match(tick, /const mppPerM = metersPerPixelPerMeter\(camera\.frustum\?\.fovy, scene\.drawingBufferHeight\);/, file);
    assert.match(tick, /positionWriteThresholdM\(Cesium\.Cartesian3\.distance\(camera\.positionWC, bb\.position\), mppPerM\)/, `${file}: prah zápisu polohy`);
    assert.match(tick, /Math\.abs\(rot - bb\.rotation\) > 0\.01\)/, `${file}: pásmo necitlivosti rotácie 0,01 rad`);
    assert.doesNotMatch(tick, /_fleetTickSerial|HIDDEN_DR_STRIDE|_fleetGatePosition/, `${file}: pruhy skrytých strojov sú preč (zápisy = drahá cesta Cesia)`);
  }
  const flightsSrc = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(flightsSrc, /_densityMode = next;\s*_densityPoints\.show = next;\s*_fleetGateEpoch\+\+;/, 'flights: prepnutie hustoty zdvihne epochu brány');
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(flights, /function _fleetContactHidden\(info, position, occluder\) \{\s*return _densityMode\s*\|\| !_categoryVisible/, 'flights: hustota je člen tej istej brány');
});
