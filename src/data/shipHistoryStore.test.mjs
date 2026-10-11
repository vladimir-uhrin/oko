// src/data/shipHistoryStore.test.mjs — história lodí na disku (2026-10-11, bod 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SHIP_HISTORY_RECORD_BYTES,
  createShipHistoryStore,
  decodeShipSamples,
  encodeShipSamples,
  shipHistoryMonths,
  shouldRecordShipSample,
  thinShipSamples,
} from './shipHistoryStore.js';

const T0 = Date.parse('2026-10-10T02:00:00Z') / 1000;

test('záznam 16 B tam a späť; neznáma rýchlosť/kurz; neúplný chvost sa ignoruje', () => {
  const buf = encodeShipSamples([
    { t: T0, lat: 34.13, lon: -68.88, sog: 12.4, cog: 211.5 },
    { t: T0 + 600, lat: 34.1, lon: -68.9, sog: null, cog: undefined },
  ]);
  assert.equal(buf.length, 2 * SHIP_HISTORY_RECORD_BYTES);
  const out = decodeShipSamples(Buffer.concat([buf, Buffer.alloc(5)]));
  assert.deepEqual(out, [
    { t: T0, lat: 34.13, lon: -68.88, sog: 12.4, cog: 211.5 },
    { t: T0 + 600, lat: 34.1, lon: -68.9, sog: null, cog: null },
  ]);
});

test('zriedenie: 10 min a 500 m pri plavbe, raz za 6 h v prístave', () => {
  const a = { t: T0, lat: 50, lon: 10 };
  assert.equal(shouldRecordShipSample(null, a), true);
  assert.equal(shouldRecordShipSample(a, { t: T0 + 300, lat: 50.1, lon: 10 }), false, 'priskoro');
  assert.equal(shouldRecordShipSample(a, { t: T0 + 600, lat: 50.01, lon: 10 }), true, '1,1 km po 10 min');
  assert.equal(shouldRecordShipSample(a, { t: T0 + 3600, lat: 50.001, lon: 10 }), false, 'stojí');
  assert.equal(shouldRecordShipSample(a, { t: T0 + 6 * 3600, lat: 50.001, lon: 10 }), true, 'stojí, ale po 6 h raz');
});

test('mesiace intervalu cez prelom roka', () => {
  assert.deepEqual(shipHistoryMonths(Date.parse('2025-11-20T00:00:00Z') / 1000, Date.parse('2026-02-01T00:00:00Z') / 1000),
    ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('preriedenie zachová prvý a posledný bod', () => {
  const s = Array.from({ length: 10_000 }, (_, i) => ({ t: i }));
  const out = thinShipSamples(s, 100);
  assert.equal(out.length, 100);
  assert.equal(out[0].t, 0);
  assert.equal(out.at(-1).t, 9999);
});

test('úložisko: zápis cez mesiace, čítanie disk + nezapísané, mazanie starých mesiacov, plný disk nezapisuje', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let ok = true;
  const store = createShipHistoryStore({ dir, now: () => Date.parse('2026-10-11T00:00:00Z'), months: 2, diskOk: () => ok });
  const sep30 = Date.parse('2026-09-30T23:50:00Z') / 1000;
  assert.equal(store.record('241190000', 34.0, -69.0, sep30, 12, 200), true);
  assert.equal(store.record('241190000', 34.0001, -69.0, sep30 + 60, 12, 200), false, 'zriedené');
  assert.equal(store.record('241190000', 33.9, -69.1, sep30 + 900, 12.5, 201), true, 'už október');
  assert.equal(store.record('12345', 1, 1, sep30), false, 'zlé MMSI');
  assert.equal(store.record('241190001', 0, 0, sep30), false, 'nulová poloha');
  assert.equal(await store.flush(), 2);
  assert.ok(fs.existsSync(path.join(dir, '2026-09', '00', '241190000.bin')));
  assert.ok(fs.existsSync(path.join(dir, '2026-10', '00', '241190000.bin')));
  store.record('241190000', 33.8, -69.2, sep30 + 1800, 13, 202);
  const all = await store.read('241190000', sep30 - 10, sep30 + 4000);
  assert.deepEqual(all.map((s) => s.t), [sep30, sep30 + 900, sep30 + 1800], 'disk + čakajúce, zoradené');
  assert.equal(all[1].sog, 12.5);
  // Plný disk: dávka sa zahodí, nič sa nezapíše.
  ok = false;
  assert.equal(await store.flush(), 0);
  ok = true;
  // Mazanie: drží 2 mesiace (09, 10) — starý august ide preč.
  await fsp.mkdir(path.join(dir, '2026-08', '00'), { recursive: true });
  assert.deepEqual(await store.prune(), ['2026-08']);
  assert.ok(fs.existsSync(path.join(dir, '2026-09')));
});
