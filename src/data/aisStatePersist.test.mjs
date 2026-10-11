// src/data/aisStatePersist.test.mjs — stav AIS prežije reštart servera
// (2026-10-10: po každom vydaní oko-api mali lode prázdny cieľ aj stopu).
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { AIS_STATE_STATIC_MAX_AGE_MS, readAisStateFile, restoreAisState, serializeAisState, writeAisStateFile } from './aisStatePersist.js';

function ring(points, cap = 4) {
  const track = { lats: new Float32Array(cap), lons: new Float32Array(cap), times: new Uint32Array(cap), head: 0, len: 0 };
  for (const [lat, lon, t] of points) {
    track.lats[track.head] = lat; track.lons[track.head] = lon; track.times[track.head] = t;
    track.head = (track.head + 1) % cap; track.len = Math.min(track.len + 1, cap);
  }
  return track;
}

test('snímka a obnova: ciele, polohy a stopa v chronologickom poradí aj po pretočení ringu', async () => {
  const now = Date.parse('2026-10-10T20:00:00Z');
  const nowSec = now / 1000;
  const vessels = new Map([
    ['244770393', { mmsi: '244770393', name: 'FWN SUN', lat: 50.9, lon: 1.48, _updatedAt: now - 60_000 }],
    ['111111111', { mmsi: '111111111', name: 'STARÁ', lat: 1, lon: 1, _updatedAt: now - 3 * 3600_000 }],
  ]);
  const statics = new Map([
    ['244770393', { destination: 'NLRTM', lengthM: 123, _savedAt: now - 3600_000 }],
    ['222222222', { destination: 'STARÁ', _savedAt: now - AIS_STATE_STATIC_MAX_AGE_MS - 1 }],
  ]);
  // 5 bodov do ringu s kapacitou 4 → prvý vypadne, poradie ostáva chronologické.
  const tracks = new Map([['244770393', ring([[50, 1, nowSec - 500], [50.1, 1.1, nowSec - 400], [50.2, 1.2, nowSec - 300], [50.3, 1.3, nowSec - 200], [50.4, 1.4, nowSec - 100]])]]);
  const snap = serializeAisState({ vessels, statics, tracks, nowMs: now });
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ais-state-'));
  try {
    const file = path.join(dir, 'state.json.gz');
    assert.ok(await writeAisStateFile(file, snap) > 0);
    const back = await readAisStateFile(file);
    const restored = restoreAisState(back, { nowMs: now + 5 * 60_000, vesselMaxAgeMs: 30 * 60_000 });
    assert.deepEqual(restored.vessels.map((v) => v.mmsi), ['244770393'], 'poloha staršia ako okno AIS sa zahodí');
    assert.deepEqual(restored.statics.map(([m, d]) => [m, d.destination]), [['244770393', 'NLRTM']], 'statika staršia ako 7 dní preč');
    const [[mmsi, pts]] = restored.tracks;
    assert.equal(mmsi, '244770393');
    assert.deepEqual(pts.map((p) => p.t), [nowSec - 400, nowSec - 300, nowSec - 200, nowSec - 100]);
    assert.equal(pts[0].lat, 50.1);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('obnova: chýbajúci alebo cudzí súbor = prázdny stav, stopa staršia ako 24 h preč', async () => {
  assert.equal(await readAisStateFile(path.join(os.tmpdir(), 'oko-neexistuje', 'x.json.gz')), null);
  assert.deepEqual(restoreAisState(null, { vesselMaxAgeMs: 1 }), { vessels: [], statics: [], tracks: [] });
  assert.deepEqual(restoreAisState({ version: 99 }, { vesselMaxAgeMs: 1 }), { vessels: [], statics: [], tracks: [] });
  const now = Date.parse('2026-10-10T20:00:00Z');
  const old = restoreAisState({ version: 1, vessels: [], statics: [], tracks: [['1', [50, 1, now / 1000 - 25 * 3600, 50, 1, now / 1000 - 60]]] }, { nowMs: now, vesselMaxAgeMs: 1 });
  assert.equal(old.tracks[0][1].length, 1, 'len bod z posledných 24 h');
});

test('JSON po častiach = JSON.stringify (zápis stavu neblokuje vlákno, 2026-10-11)', async () => {
  const { stringifyAisStateChunked } = await import('./aisStatePersist.js');
  const snapshot = { version: 1, savedAt: 5, vessels: Array.from({ length: 25 }, (_, i) => ({ mmsi: String(i), lat: i / 3, name: 'A"B' })), statics: [], tracks: [['1', [1, 2, 3]]] };
  let yields = 0;
  const out = await stringifyAisStateChunked(snapshot, { chunk: 10, yieldFn: async () => { yields += 1; } });
  assert.equal(out, JSON.stringify(snapshot));
  assert.equal(yields, 3 + 4, '3 kusy poľa lodí + 4 ostatné kľúče');
});
