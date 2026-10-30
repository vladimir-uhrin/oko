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

test('kľúč duplicít: surový riadok z NASA a uložený štíhly riadok sú tá istá detekcia (zaokrúhlenie ako slimFire)', async () => {
  const { fireHistoryKey } = await import('./fireNews.js');
  const raw = fire({ lat: 44.73555, lon: 37.80925 });
  assert.equal(fireHistoryKey(raw), fireHistoryKey(slimFire(raw)));
  const dir = tmp();
  const store = createFireHistoryStore({ dir });
  await store.append([raw]);
  assert.equal(await createFireHistoryStore({ dir }).append([raw]), 0, 'po reštarte (kľúče zo súboru) sa surový riadok nezapíše znova');
});

test('dávka cez viac ako 3 dni s opakovanými detekciami: každá sa zapíše raz (pamäť dní sa nevyraďuje počas dávky)', async () => {
  const dir = tmp();
  const store = createFireHistoryStore({ dir });
  const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
  const all = days.flatMap((acqDate) => Array.from({ length: 20 }, (_, i) => fire({ acqDate, lat: 10 + i / 100 })));
  // prekladané dni a každá detekcia dvakrát (napr. zdroje sa prekrývajú)
  const batch = [];
  for (let i = 0; i < 20; i += 1) for (const d of days) batch.push(all.find((f) => f.acqDate === d && f.lat === 10 + i / 100));
  assert.equal(await store.append([...batch, ...batch]), all.length);
  assert.equal(await store.append(all), 0);
});

test('zápis veľkej dávky uvoľňuje slučku (2026-10-30: ~150 tis. ohnísk naraz blokovalo verejné /api)', async () => {
  const { createFireHistoryStore: create, APPEND_YIELD_EVERY } = await import('./fireHistoryStore.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  assert.equal(APPEND_YIELD_EVERY, 20_000);
  const dir = mkdtempSync(join(tmpdir(), 'oko-fires-yield-'));
  try {
    const store = create({ dir });
    const fires = Array.from({ length: 45_000 }, (_, i) => ({ lat: 10 + (i % 900) / 100, lon: 20 + Math.floor(i / 900) / 100, acqDate: '2026-10-30', acqTime: String(1000 + (i % 59)).padStart(4, '0'), satellite: 'N', instrument: 'VIIRS', frp: 1 }));
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 0);
    const n = await store.append(fires);
    clearInterval(timer);
    assert.ok(n > 0);
    assert.ok(ticks >= 2, `počas zápisu prebehli časovače (${ticks}×) — slučka nestála`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zapojenie: obnova FIRMS uvoľňuje slučku medzi parsovaním zdrojov, zlúčením, zápisom disku a históriou', async () => {
  const { readFileSync } = await import('node:fs');
  const cfg = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(cfg, /const yieldFirmsLoop = \(\) => new Promise\(\(resolve\) => setImmediate\(resolve\)\);/);
  assert.match(cfg, /const csv = await res\.text\(\);\n\s+await yieldFirmsLoop\(\);[^\n]*\n\s+const records = parseFirmsCsv\(csv\);/);
  assert.match(cfg, /for \(const \[i, source\] of SOURCES\.entries\(\)\) \{\n\s+await yieldFirmsLoop\(\);/);
  assert.match(cfg, /await yieldFirmsLoop\(\);\n\s+const merged = mergeGeoIntoFires\(fires, geo\);/);
  assert.match(cfg, /mem = fresh;\n\s+await yieldFirmsLoop\(\);\n\s+await writeDisk\(fresh\);/);
  assert.match(cfg, /await yieldFirmsLoop\(\);\n\s+const n = await history\.append\(fresh\.fires\);/);
});
