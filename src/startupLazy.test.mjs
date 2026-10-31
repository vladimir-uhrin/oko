// src/startupLazy.test.mjs — odľahčený štart (2026-10-31, vlastník: „plyn, hranice, geoid a odhady letov
// načítaj až keď sú potrebné"): geoid až pri nízkej kamere, odhady letov po preloaderi a len zapnuté,
// hranice na počítači po skrytí preloadera. Panel plynu má vlastný test v gasPanel.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GEOID_NEEDED_BELOW_M, ensureGeoidReadyWhenLow, geoidHeight } from './data/geoid.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('geoid: vysoká kamera mriežku nesťahuje; načíta sa po poklese pod prah (camera.changed) a poslucháč sa odhlási', async () => {
  let height = 7_000_000;
  const listeners = [];
  let removed = 0;
  const scene = {
    camera: {
      positionCartographic: { get height() { return height; } },
      changed: { addEventListener(fn) { listeners.push(fn); return () => { removed += 1; }; } },
    },
  };
  const ready = ensureGeoidReadyWhenLow(scene);
  assert.equal(listeners.length, 1, 'čaká na pohyb kamery');
  assert.throws(() => geoidHeight(48, 17), 'mriežka ešte nie je načítaná');
  height = 6_000_000;
  listeners[0]();
  assert.throws(() => geoidHeight(48, 17), 'stále vysoko — nič sa nesťahuje');
  assert.equal(removed, 0);
  height = GEOID_NEEDED_BELOW_M - 1;
  listeners[0]();
  await ready;
  assert.equal(removed, 1, 'po načítaní sa poslucháč odhlási');
  assert.ok(Number.isFinite(geoidHeight(48, 17)), 'mriežka pripravená');
  // Ďalšia vrstva dostane hotovú mriežku hneď, bez registrácie poslucháča.
  const again = ensureGeoidReadyWhenLow({ camera: { positionCartographic: { height: 9e6 }, changed: { addEventListener() { throw new Error('nemá sa registrovať'); } } } });
  assert.equal(await again, undefined);
});

test('zapojenie: lety a vojenské lety berú geoid cez kameru; odhady letov po štarte, len zapnuté, každé 2 min; hranice na počítači po preloaderi', () => {
  for (const f of ['./data/flights.js', './data/militaryFlights.js']) {
    const src = read(f);
    assert.match(src, /ensureGeoidReadyWhenLow\(viewer\?\.scene\)\n\s+\.then\(\(\) => \{ _geoidReady = true; \}\)/, f);
    assert.doesNotMatch(src, /\n\s+ensureGeoidReady\(\)\n\s+\.then\(\(\) => \{ _geoidReady = true; \}\)/, `${f}: pri zapnutí vrstvy sa mriežka nesťahuje naslepo`);
  }
  const hud = read('./hud.js');
  assert.match(hud, /this\._geoidRequested = true;\n(?:\s+\/\/[^\n]*\n)*\s+ensureGeoidReadyWhenLow\(this\.viewer\?\.scene\)/, 'HUD (zapnutý aj so skrytými rohmi) žiada mriežku až pri nízkej kamere');
  assert.doesNotMatch(hud, /ensureGeoidReady\(\)/, 'HUD nikde nesťahuje mriežku naslepo');
  const flights = read('./data/flights.js');
  assert.match(flights, /const SERVER_ESTIMATES_INTERVAL_MS = 120_000;/);
  assert.match(flights, /async function _refreshServerEstimates\(\) \{\n(?:  \/\/[^\n]*\n)*  if \(!_estimatesVisible \|\| !isStartupReady\(\)\) return;/);
  const main = read('./main.js');
  assert.match(main, /if \(phoneStart\) void countryBoundaries\.prewarm\(\);\n\s+else void whenStartupReady\(\)\.then\(\(\) => countryBoundaries\.prewarm\(\)\);/);
});
