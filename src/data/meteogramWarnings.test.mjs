// src/data/meteogramWarnings.test.mjs
// Výstraha SHMÚ v páse predpovede (2026-10-08): okres bodu, výstrahy okresu, značky hodín, lenivý
// načítač (mimo Slovenska nič nesťahuje, výstrahy z cache). Správanie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { columnWarningLevels, createPointWarningsLookup, districtAtPoint, inSlovakiaBox, warningsForDistrict } from './meteogramWarnings.js';

const DISTRICTS = JSON.parse(readFileSync(new URL('../../public/meteo-warnings/sk-okresy.json', import.meta.url), 'utf8'));
const H = 3600_000;
const T0 = Date.parse('2026-10-08T18:00:00Z');
const W = (o) => ({ level: 2, type: 'wind', codes: ['107'], onset: '2026-10-08T21:00:00Z', expires: '2026-10-09T02:00:00Z', ...o });

test('okres bodu z polygónov: Pezinok, Martin, Bratislava; mimo SR nič', () => {
  assert.equal(districtAtPoint(DISTRICTS, 48.29, 17.26).name, 'Pezinok');
  assert.equal(districtAtPoint(DISTRICTS, 49.07, 18.92).code, '506');
  assert.match(districtAtPoint(DISTRICTS, 48.144, 17.108).name, /^Bratislava I/);
  assert.equal(districtAtPoint(DISTRICTS, 48.21, 16.37), null); // Viedeň
  assert.equal(inSlovakiaBox(48.21, 16.37), false);
  assert.equal(inSlovakiaBox(48.29, 17.26), true);
});

test('výstrahy okresu: len jeho, bez skončených, najvyšší stupeň prvý', () => {
  const list = warningsForDistrict([W(), W({ level: 3, onset: '2026-10-09T00:00:00Z' }), W({ codes: ['506'] }), W({ expires: '2026-10-08T17:00:00Z' })], '107', T0);
  assert.equal(list.length, 2);
  assert.equal(list[0].level, 3);
});

test('značky hodín: stĺpec dostane najvyšší stupeň výstrahy, ktorá v jeho 3 h okne platí', () => {
  const cols = [0, 3, 6, 9].map((k) => ({ t: T0 + k * H })); // 18, 21, 00, 03 UTC
  const levels = columnWarningLevels(cols, [W(), W({ level: 3, onset: '2026-10-09T00:00:00Z', expires: '2026-10-09T01:00:00Z' })]);
  assert.deepEqual(levels.map((l) => l.level), [0, 2, 3, 0]);
  assert.equal(levels[1].color, '#ffd200');
  assert.equal(levels[0].color, null);
});

test('načítač: mimo Slovenska nesťahuje nič; v SR okresy raz a výstrahy z cache', async () => {
  const calls = [];
  let now = T0;
  const doFetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => (url.includes('sk-okresy') ? DISTRICTS : { warnings: [W()] }) };
  };
  const lookup = createPointWarningsLookup(doFetch, () => now);
  assert.equal(await lookup(48.21, 16.37), null);
  assert.equal(calls.length, 0);
  const r = await lookup(48.29, 17.26);
  assert.equal(r.district.name, 'Pezinok');
  assert.equal(r.warnings.length, 1);
  const r2 = await lookup(49.07, 18.92); // Martin — iný okres, bez výstrahy
  assert.equal(r2.warnings.length, 0);
  assert.equal(calls.length, 2, 'okresy aj výstrahy len raz');
  now += 3 * 60_000;
  await lookup(48.29, 17.26);
  assert.equal(calls.length, 3, 'po 2 min sa výstrahy obnovia');
});

test('načítač: chyba servera = žiadny pásik, nie výnimka', async () => {
  const lookup = createPointWarningsLookup(async () => ({ ok: false, status: 502 }));
  assert.equal(await lookup(48.29, 17.26), null);
});
