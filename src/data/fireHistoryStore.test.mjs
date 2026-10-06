// src/data/fireHistoryStore.test.mjs — história požiarov na disku (2026-10-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFireHistoryStore, slimFire } from './fireHistoryStore.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oko-fires-'));
const fire = (o = {}) => ({ lat: 44.73559, lon: 37.80931, frp: 2.761, confidence: 'n', brightness: 330.7, brightnessTi5: 290, daynight: 'N', acqDate: '2026-10-06', acqTime: '3', satellite: 'N21', instrument: 'VIIRS', scan: 0.39, track: 0.36, ...o });

test('zápis: denné NDJSON podľa dňa detekcie, štíhle riadky, bez duplicít ani pri súbežných zápisoch', async () => {
  const dir = tmp();
  const store = createFireHistoryStore({ dir });
  assert.equal(await store.isEmpty(), true);
  const [a, b] = await Promise.all([
    store.append([fire(), fire({ acqDate: '2026-10-05', acqTime: '2320' }), fire({ lat: NaN })]),
    store.append([fire(), fire({ acqTime: '100', satellite: 'N' })]),
  ]);
  assert.equal(a + b, 3, 'tá istá detekcia raz, neplatná poloha nie');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-10-05.ndjson', '2026-10-06.ndjson']);
  const rows = fs.readFileSync(path.join(dir, '2026-10-06.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { lat: 44.7356, lon: 37.8093, frp: 2.76, confidence: 'n', brightness: 331, daynight: 'N', acqDate: '2026-10-06', acqTime: '3', satellite: 'N21', scan: 0.39, track: 0.36 });
  // nový obchod nad tým istým adresárom (reštart služby) duplicitu tiež spozná
  assert.equal(await createFireHistoryStore({ dir }).append([fire()]), 0);
  assert.equal(await store.isEmpty(), false);
});

test('čítanie: okruh v km, posledných N dní, najnovšie prvé, s acqMs', async () => {
  const dir = tmp();
  const now = Date.UTC(2026, 9, 6, 20);
  const store = createFireHistoryStore({ dir, now: () => now });
  await store.append([
    fire(), fire({ acqDate: '2026-10-05', acqTime: '2320' }),
    fire({ lat: 44.80, lon: 37.80931, acqTime: '200' }), // ~7 km severne
    fire({ acqDate: '2026-09-01', acqTime: '1000' }), // mimo 30 dní
  ]);
  const near = await store.around(44.7356, 37.8093, 5, 30);
  assert.deepEqual(near.map((f) => f.acqTime), ['3', '2320']);
  assert.equal(near[0].acqMs, Date.UTC(2026, 9, 6, 0, 3));
  assert.equal((await store.around(44.7356, 37.8093, 10, 30)).length, 3);
  assert.equal((await store.around(44.7356, 37.8093, 5, 1)).length, 1, 'len dnešný deň');
});

test('štíhly riadok: geo potvrdenie a samostatné geo; nezmyselná veľkosť pixla preč', () => {
  assert.deepEqual(slimFire(fire({ scan: 377, track: 1240, geo: true, repeats: 4, geoSeenMs: 5, geoSat: 'Met12' })),
    { lat: 44.7356, lon: 37.8093, frp: 2.76, confidence: 'n', brightness: 331, daynight: 'N', acqDate: '2026-10-06', acqTime: '3', satellite: 'N21', geo: true, repeats: 4, geoSeenMs: 5, geoSat: 'Met12' });
});
