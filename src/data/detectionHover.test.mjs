// OKO — hover-inspect detection kontaktov: čistý resolver + kontraktové piny.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DETECTION_HOVER_THROTTLE_MS,
  hoverCandidatesFromPick,
} from './detectionHover.js';

test('hoverCandidatesFromPick: string id → flights+military, mmsi objekt → vessels', () => {
  // Flights aj military billboardy nesú surové icao24 stringy — pick nevie,
  // komu patrí, tak sa skúšajú oba páry (zlý tip sa v detection.js nematchne).
  assert.deepEqual(hoverCandidatesFromPick({ id: 'ab12cd' }), [
    { layerId: 'flights', sourceId: 'ab12cd' },
    { layerId: 'military', sourceId: 'ab12cd' },
  ]);
  // id môže sedieť aj na picked.primitive.id (BillboardCollection picky).
  assert.deepEqual(hoverCandidatesFromPick({ primitive: { id: 'ff00aa' } }), [
    { layerId: 'flights', sourceId: 'ff00aa' },
    { layerId: 'military', sourceId: 'ff00aa' },
  ]);
  // Lode: objektové id s mmsi → jeden kandidát na ais-live-vessels.
  assert.deepEqual(hoverCandidatesFromPick({ id: { mmsi: 269057419 } }), [
    { layerId: 'ais-live-vessels', sourceId: '269057419' },
  ]);
  // Trail, prázdny pick a cudzie objekty → nič.
  assert.deepEqual(hoverCandidatesFromPick({ id: 'gev-trail:mil-head-3' }), []);
  assert.deepEqual(hoverCandidatesFromPick(undefined), []);
  assert.deepEqual(hoverCandidatesFromPick({}), []);
  assert.deepEqual(hoverCandidatesFromPick({ id: { station: 'x' } }), []);
  assert.deepEqual(hoverCandidatesFromPick({ id: '' }), []);
});

test('hover kontrakty: throttle, inštalácia v ui.js a bypass v paint slučke', () => {
  // Event-driven pacing zrkadlí CCTV hover (≥120 ms medzi pickmi).
  assert.equal(DETECTION_HOVER_THROTTLE_MS, 120);

  const uiJs = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  // 2026-09-03: ten istý pick kŕmi aj kartičku pod kurzorom (onHover), takže
  // volanie už nie je holé — inštalácia z ui.js ale ostáva invariantom.
  assert.match(uiJs, /installDetectionHover\(viewer, \{/);

  const detectionJs = fs.readFileSync(new URL('./detection.js', import.meta.url), 'utf8');
  // Hovered kontakt obchádza range gate aj keyhole dim a vstupuje do kohorty
  // aj mimo keyhole; priorita mu garantuje slot na najbližšom solve.
  assert.match(detectionJs, /const hovered = _isHoveredObject\(obj\);/);
  assert.match(detectionJs, /!isTracked && !hovered && !_rangeGateDisabledForTest/);
  assert.match(detectionJs, /hovered\s*\?\s*1\s*:\s*detectionBracketAlpha\(/);
  assert.match(detectionJs, /keyholeAlpha > 0 \|\| hovered/);
  assert.match(detectionJs, /_semanticPriority\(obj\) \+ \(hovered \? 1e6 : 0\)/);
  // Callout hovered kontaktu obchádza keyhole dim aj v materializácii —
  // inak mal hover pri okraji obrazovky rámik, ale text s 1 % opacity.
  assert.match(detectionJs, /obj\._candidateHovered = hovered;/);
  assert.match(detectionJs, /if \(obj\._candidateHovered\) keyholeAlpha = 1;/);
});
