// src/startupGate.test.mjs — brána štartu (2026-09-29, „živé vrstvy až po zobrazení mapy").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STARTUP_GATE_TIMEOUT_MS, armStartupGate, isStartupReady, releaseStartupGate, whenStartupReady, _resetStartupGateForTest,
} from './startupGate.js';

test('nezapnutá brána je otvorená (testy, account.html, vrstva zapnutá neskôr)', async () => {
  _resetStartupGateForTest();
  assert.equal(isStartupReady(), true);
  await whenStartupReady();
});

test('zapnutá brána drží, kým ju štart neuvoľní; uvolnenie je raz a navždy', async () => {
  _resetStartupGateForTest();
  const timers = [];
  armStartupGate({ setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  assert.equal(isStartupReady(), false);
  assert.equal(timers[0].ms, STARTUP_GATE_TIMEOUT_MS);
  let done = false;
  const waiting = whenStartupReady().then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  releaseStartupGate();
  await waiting;
  assert.equal(done, true);
  assert.equal(isStartupReady(), true);
  armStartupGate(); // po uvoľnení sa už nezatvorí
  assert.equal(isStartupReady(), true);
  _resetStartupGateForTest();
});

test('poistka: štart, ktorý bránu nikdy neuvoľní, ju neuzamkne navždy', async () => {
  _resetStartupGateForTest();
  let fire = null;
  armStartupGate({ timeoutMs: 20000, setTimer: (fn) => { fire = fn; return 1; } });
  assert.equal(isStartupReady(), false);
  fire();
  assert.equal(isStartupReady(), true);
  await whenStartupReady();
  _resetStartupGateForTest();
});

test('zapojenie: main.js bránu zapne na začiatku init a uvoľní pri skrytí preloadera; lode ju rešpektujú', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ armStartupGate, releaseStartupGate \} from '\.\/startupGate\.js';/);
  assert.match(main, /async function init\(\) \{[\s\S]{0,400}?armStartupGate\(\);/, 'zapnutie na začiatku init');
  assert.match(main, /loadingScreen\.classList\.add\('hidden'\);\s*releaseStartupGate\(\);/, 'uvoľnenie pri skrytí preloadera');
  const ais = readFileSync(new URL('./data/aisLiveVessels.js', import.meta.url), 'utf8');
  assert.match(ais, /import \{ isStartupReady, whenStartupReady \} from '\.\.\/startupGate\.js';/);
  // zapnutie počas štartu nečaká na dáta; mimo štartu ako doteraz
  assert.match(ais, /if \(!isStartupReady\(\)\) \{\s*const sessionId = state\.sessionId;\s*void whenStartupReady\(\)\.then\(\(\) => \{\s*if \(state\.enabled && state\.sessionId === sessionId\) void loadLivePositions\(state\.viewer \|\| activeViewer\);\s*\}\);\s*return undefined;\s*\}\s*return loadLivePositions\(activeViewer\);/);
  // periodická obnova aj obnova podľa výrezu počas štartu čakajú
  assert.match(ais, /if \(!state\.enabled \|\| !isStartupReady\(\)\) return Promise\.resolve\(\);/);
  assert.match(ais, /&& !state\.loading && state\.enabled && isStartupReady\(\)\) \{/);
  // načítaný výrez sa zapíše, nech prvá kontrola výrezu nespustí druhé stiahnutie
  assert.match(ais, /const url = liveApiUrl\(\);[\s\S]{0,300}?state\.viewKey = vesselViewBounds\(\);\s*state\.viewRequestedAt = performance\.now\(\);/);
});

test('lietadlá: tik flotily pod preloaderom nebeží (1,4 s hlavného vlákna pri štarte, nikto ich nevidí)', () => {
  for (const file of ['flights.js', 'militaryFlights.js']) {
    const src = readFileSync(new URL(`./data/${file}`, import.meta.url), 'utf8');
    assert.match(src, /import \{ isStartupReady \} from '\.\.\/startupGate\.js';/, file);
    const tick = src.slice(src.indexOf('function _fleetTick() {'));
    // brána hneď na začiatku tiku, pred akoukoľvek prácou nad flotilou
    assert.match(tick, /^function _fleetTick\(\) \{\s*_tickNowActive = false;[^\n]*\n(\s*\/\/[^\n]*\n)*\s*if \(!isStartupReady\(\)\) return;/, file);
  }
});
