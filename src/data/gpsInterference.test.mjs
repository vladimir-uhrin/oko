// src/data/gpsInterference.test.mjs — rušenie GPS odvodené z presnosti polohy lietadiel
// (etapa 5d, 2026-10-03). Fixtúra = tri skutočné odpovede bodového rozhrania adsb.lol
// zo 3. 10. 2026 (Levanta, sever Zálivu, Hormuz) orezané na polia, ktoré výpočet číta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GPS_API, GPS_ATTRIBUTION, GPS_CELL_DEG, GPS_CIRCLES, GPS_HIGH, GPS_LOW, GPS_MIN_AIRCRAFT, fetchGpsInterference,
  gpsAddSnapshot, gpsCellBounds, gpsCellOf, gpsCircleUrl, gpsEmptyDay, gpsFinalizeDay, gpsLevel, gpsMergeDays, isGpsDegraded, isGpsSample,
} from './gpsInterference.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/adsblol-gps-circles-20261003.json', import.meta.url), 'utf8'));
const allAircraft = () => Object.values(fx).flatMap((j) => j.ac);
const ac = (over = {}) => ({ hex: 'abc123', type: 'adsb_icao', version: 2, lat: 32.1, lon: 35.2, alt_baro: 30000, nic: 8, nac_p: 9, seen_pos: 1, ...over });

test('vzorka: len priame ADS-B verzie 2, vo vzduchu, s čerstvou polohou a hlásenou presnosťou', () => {
  assert.equal(isGpsSample(ac()), true);
  assert.equal(isGpsSample(ac({ type: 'mlat' })), false, 'MLAT polohu počíta zem, nie GPS lietadla');
  assert.equal(isGpsSample(ac({ type: 'tisb_icao' })), false);
  assert.equal(isGpsSample(ac({ type: 'adsb_icao_nt' })), true);
  assert.equal(isGpsSample(ac({ version: 0 })), false, 'staršia norma hlási presnosť inak');
  assert.equal(isGpsSample(ac({ version: undefined })), false);
  assert.equal(isGpsSample(ac({ alt_baro: 'ground' })), false, 'na zemi je nízka presnosť bežná');
  assert.equal(isGpsSample(ac({ alt_baro: undefined })), false);
  assert.equal(isGpsSample(ac({ seen_pos: 120 })), false, 'stará poloha');
  assert.equal(isGpsSample(ac({ nic: undefined, nac_p: undefined })), false, 'bez hlásenej presnosti niet čo merať');
  assert.equal(isGpsSample(ac({ lat: undefined })), false);
  assert.equal(isGpsSample(ac({ hex: 'zzz' })), false);
  assert.equal(isGpsSample(ac({ hex: '~a1b2c3', type: 'adsb_other' })), true, 'neICAO adresa priameho ADS-B');
  assert.equal(isGpsSample(null), false);
});

test('zhoršená presnosť: NACp < 8 alebo NIC < 7', () => {
  assert.equal(isGpsDegraded(ac()), false);
  assert.equal(isGpsDegraded(ac({ nac_p: 8, nic: 7 })), false, 'na hranici predpisu je to ešte v poriadku');
  assert.equal(isGpsDegraded(ac({ nac_p: 7 })), true);
  assert.equal(isGpsDegraded(ac({ nic: 6 })), true);
  assert.equal(isGpsDegraded(ac({ nac_p: 0, nic: 0 })), true, 'typický obraz rušenia');
  assert.equal(isGpsDegraded(ac({ nac_p: undefined, nic: 8 })), false);
});

test('bunky 0,5°: index a hranice, aj na južnej a západnej pologuli', () => {
  assert.equal(GPS_CELL_DEG, 0.5);
  assert.deepEqual(gpsCellOf(31.72, 35.97), [63, 71]);
  assert.deepEqual(gpsCellBounds(63, 71), [35.5, 31.5, 36, 32]);
  assert.deepEqual(gpsCellOf(-0.1, -0.1), [-1, -1]);
  assert.deepEqual(gpsCellBounds(-1, -1), [-0.5, -0.5, 0, 0]);
});

test('skutočná snímka: lietadlo z prekrývajúcich sa kruhov raz, MLAT a zem von, rušenie pri Ammáne', () => {
  const work = gpsEmptyDay('2026-10-03');
  const snap = gpsAddSnapshot(work, allAircraft());
  assert.equal(snap.samples, 103, 'z 162 záznamov troch kruhov (24 lietadiel je v dvoch kruhoch)');
  assert.equal(snap.degraded, 11);
  assert.equal(work.snapshots, 1);
  const day = gpsFinalizeDay(work);
  assert.equal(day.aircraft, 103);
  assert.equal(day.cells.length, 66);
  assert.ok(day.cells.every((row) => row.length === 4 && row.every(Number.isInteger)), 'výsledok dňa nesie len čísla — žiadne adresy lietadiel');
  assert.equal(JSON.stringify(day).includes('"s"'), false);
  const merged = gpsMergeDays([day]);
  assert.deepEqual(merged.counts, { high: 1, medium: 0, none: 4, thin: 61 });
  const amman = merged.cells.find((c) => c.level === 'high');
  assert.deepEqual(gpsCellBounds(amman.latIdx, amman.lonIdx), [35.5, 31.5, 36, 32], 'bunka Ammán / Mŕtve more');
  assert.equal(amman.total, 4);
  assert.equal(amman.bad, 4);
  assert.equal(amman.badAdjusted, 3, 'jedno lietadlo sa odpočíta');
  assert.equal(amman.ratio, 0.75);
});

test('deň sa skladá zo snímok: to isté lietadlo v tej istej bunke raz, zhoršené stačí raz', () => {
  const work = gpsEmptyDay('2026-10-03');
  gpsAddSnapshot(work, [ac({ hex: 'aaa111' }), ac({ hex: 'bbb222' }), ac({ hex: 'aaa111' })]);
  gpsAddSnapshot(work, [ac({ hex: 'aaa111', nac_p: 0 }), ac({ hex: 'ccc333', lat: 33.4 })]);
  gpsAddSnapshot(work, [ac({ hex: 'AAA111' })]);
  assert.equal(work.snapshots, 3);
  const day = gpsFinalizeDay(work);
  assert.deepEqual(day.cells, [[64, 70, 2, 1], [66, 70, 1, 0]], 'aaa111 a bbb222 v jednej bunke, aaa111 raz zhoršené; ccc333 inde');
  assert.equal(day.aircraft, 3);
  assert.deepEqual(gpsFinalizeDay(null).cells, []);
});

test('stupne: pod 4 lietadlá sa nehodnotí, 2 % a 10 %; viac dní = odpočet jedného lietadla za každý deň', () => {
  assert.deepEqual(gpsLevel(GPS_MIN_AIRCRAFT - 1, 3), { ratio: null, level: 'thin' });
  assert.equal(gpsLevel(100, 1).level, 'none');
  assert.equal(gpsLevel(100, 2).level, 'medium');
  assert.equal(gpsLevel(100, 9).level, 'medium');
  assert.equal(gpsLevel(100, 10).level, 'high');
  assert.equal(GPS_LOW, 0.02);
  assert.equal(GPS_HIGH, 0.10);
  const d1 = { day: '2026-10-02', snapshots: 90, aircraft: 200, cells: [[63, 71, 20, 3], [50, 110, 30, 1]] };
  const d2 = { day: '2026-10-03', snapshots: 40, aircraft: 120, cells: [[63, 71, 10, 1], [50, 110, 10, 0]] };
  const m = gpsMergeDays([d2, d1, null]);
  assert.deepEqual(m.days, ['2026-10-02', '2026-10-03']);
  assert.equal(m.snapshots, 130);
  assert.equal(m.aircraft, 320);
  const amman = m.cells.find((c) => c.latIdx === 63);
  assert.deepEqual([amman.total, amman.bad, amman.badAdjusted, amman.level], [30, 4, 2, 'medium'], '(3−1) + (1−1) = 2 z 30 = 6,7 %');
  const gulf = m.cells.find((c) => c.latIdx === 50);
  assert.deepEqual([gulf.total, gulf.badAdjusted, gulf.level], [40, 0, 'none'], 'jedno pokazené lietadlo nie je rušenie');
  assert.deepEqual(gpsMergeDays(null).cells, []);
});

test('kruhy zberu a klient: adresa adsb.lol, najviac 250 NM, atribúcia ODbL', async () => {
  assert.equal(GPS_CIRCLES.length, 6);
  assert.equal(new Set(GPS_CIRCLES.map((c) => c.id)).size, 6);
  for (const c of GPS_CIRCLES) assert.match(gpsCircleUrl(c), /^https:\/\/api\.adsb\.lol\/v2\/lat\/[\d.]+\/lon\/[\d.]+\/dist\/250$/);
  assert.throws(() => gpsCircleUrl({ lat: 30, lon: 40, nm: 400 }), /bad circle/);
  assert.throws(() => gpsCircleUrl({ lat: 'x', lon: 40, nm: 100 }), /bad circle/);
  assert.match(GPS_ATTRIBUTION, /adsb\.lol.*ODbL.*derived indicator/);
  const asked = [];
  const ok = { cells: [] };
  assert.equal(await fetchGpsInterference({ days: 3, fetcher: async (url) => { asked.push(url); return { ok: true, json: async () => ok }; } }), ok);
  assert.deepEqual(asked, [`${GPS_API}?days=3`]);
  await assert.rejects(fetchGpsInterference({ fetcher: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_gps_snapshot' }) }) }), (e) => e.status === 404 && e.message === 'no_gps_snapshot');
  await assert.rejects(fetchGpsInterference({ fetcher: async () => ({ ok: true, json: async () => ({}) }) }), /bad_gps_payload/);
});
