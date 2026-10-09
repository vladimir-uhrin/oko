// scripts/lib/skTerrainUpstreamCache.test.mjs — strop diskovej cache upstream terénu (2026-10-09).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MAX_DAYS, DEFAULT_MAX_MB, formatMb, pruneUpstreamCache, tilesToPrune, upstreamCacheLimits,
} from './skTerrainUpstreamCache.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-09T21:00:00Z');
const MB = 1024 * 1024;
const tile = (name, ageDays, size) => ({ name, size, mtimeMs: NOW - ageDays * DAY });
const names = (list) => list.map((e) => e.name);

test('limity: predvolené 2 GB / 30 dní, .env prepíše, nezmysel sa ignoruje', () => {
  assert.deepEqual(upstreamCacheLimits({}), { maxBytes: DEFAULT_MAX_MB * MB, maxAgeMs: DEFAULT_MAX_DAYS * DAY });
  assert.deepEqual(upstreamCacheLimits({ SK_TERRAIN_UPSTREAM_CACHE_MAX_MB: '512', SK_TERRAIN_UPSTREAM_CACHE_MAX_DAYS: '7' }),
    { maxBytes: 512 * MB, maxAgeMs: 7 * DAY });
  assert.deepEqual(upstreamCacheLimits({ SK_TERRAIN_UPSTREAM_CACHE_MAX_MB: 'veľa', SK_TERRAIN_UPSTREAM_CACHE_MAX_DAYS: '-3' }),
    upstreamCacheLimits({}));
  assert.deepEqual(upstreamCacheLimits(undefined).maxBytes, DEFAULT_MAX_MB * MB);
});

test('vek: zmažú sa len dlaždice staršie než strop; cudzie súbory nikdy', () => {
  const entries = [
    tile('12-4482-3141.terrain', 0.1, 20_000),
    tile('0-0-0.terrain', 39, 75_000),
    tile('10-1138-787.terrain', 31, 75_000),
    tile('5-20-11.terrain', 29.9, 30_000),
    { name: 'README.txt', size: 10, mtimeMs: NOW - 400 * DAY },
    { name: 'layer.json', size: 10, mtimeMs: NOW - 400 * DAY },
  ];
  const out = tilesToPrune(entries, NOW, { maxBytes: 100 * MB, maxAgeMs: 30 * DAY });
  assert.deepEqual(names(out), ['0-0-0.terrain', '10-1138-787.terrain']);
});

test('veľkosť: nad stropom sa mažú najdlhšie nepoužité, kým súčet neklesne pod strop', () => {
  const entries = [
    tile('a-1-1.terrain', 1, 40), // najnovšia
    tile('b-1-1.terrain', 5, 40),
    tile('c-1-1.terrain', 9, 40), // najstaršia
    tile('d-1-1.terrain', 7, 40),
  ].map((e, i) => ({ ...e, name: `${i}-1-1.terrain` }));
  // mená podľa veku: 0 (1 d), 1 (5 d), 2 (9 d), 3 (7 d); strop 100 B → 160 B presahuje, 2 najstaršie preč
  const out = tilesToPrune(entries, NOW, { maxBytes: 100, maxAgeMs: 30 * DAY });
  assert.deepEqual(names(out), ['2-1-1.terrain', '3-1-1.terrain']);
  // tesne pod stropom = nič
  assert.deepEqual(tilesToPrune(entries, NOW, { maxBytes: 160, maxAgeMs: 30 * DAY }), []);
});

test('vek a veľkosť spolu: expirované sa počítajú do uvoľneného miesta, poradie od najstaršej', () => {
  const entries = [
    tile('1-1-1.terrain', 2, 50),
    tile('2-1-1.terrain', 40, 50), // expirovaná
    tile('3-1-1.terrain', 10, 50),
    tile('4-1-1.terrain', 4, 50),
  ];
  // 200 B, strop 120 B: expirovaná (−50 → 150) + najstaršia nepoužitá 3 (−50 → 100) a dosť
  const out = tilesToPrune(entries, NOW, { maxBytes: 120, maxAgeMs: 30 * DAY });
  assert.deepEqual(names(out), ['2-1-1.terrain', '3-1-1.terrain']);
});

test('neznámy mtime sa berie ako najstarší; prázdny vstup = nič', () => {
  const entries = [tile('1-1-1.terrain', 1, 10), { name: '2-1-1.terrain', size: 10, mtimeMs: NaN }];
  assert.deepEqual(names(tilesToPrune(entries, NOW, { maxBytes: 15, maxAgeMs: 30 * DAY })), ['2-1-1.terrain']);
  assert.deepEqual(tilesToPrune([], NOW, { maxBytes: 1, maxAgeMs: 1 }), []);
  assert.deepEqual(tilesToPrune(null, NOW, { maxBytes: 1, maxAgeMs: 1 }), []);
});

test('upratanie priečinka: zmaže podľa výberu, hlási počty a veľkosti; dry-run nič nemaže; chýbajúci priečinok = nuly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-sk-terrain-'));
  try {
    const write = async (name, bytes, ageDays) => {
      const file = path.join(dir, name);
      await fsp.writeFile(file, Buffer.alloc(bytes, 1));
      const t = new Date(NOW - ageDays * DAY);
      await fsp.utimes(file, t, t);
    };
    await write('0-0-0.terrain', 100, 45); // expirovaná
    await write('1-1-0.terrain', 100, 10);
    await write('2-2-1.terrain', 100, 1);
    await write('note.txt', 5, 400); // cudzí súbor, nechá sa
    const limits = { maxBytes: 150, maxAgeMs: 30 * DAY };

    const dry = await pruneUpstreamCache(dir, { nowMs: NOW, limits, dryRun: true });
    assert.deepEqual(dry, { scanned: 3, totalBytes: 300, deleted: 2, deletedBytes: 200, kept: 1, keptBytes: 100, dryRun: true });
    assert.deepEqual((await fsp.readdir(dir)).sort(), ['0-0-0.terrain', '1-1-0.terrain', '2-2-1.terrain', 'note.txt']);

    const real = await pruneUpstreamCache(dir, { nowMs: NOW, limits });
    assert.deepEqual(real, { scanned: 3, totalBytes: 300, deleted: 2, deletedBytes: 200, kept: 1, keptBytes: 100, dryRun: false });
    assert.deepEqual((await fsp.readdir(dir)).sort(), ['2-2-1.terrain', 'note.txt']);

    const again = await pruneUpstreamCache(dir, { nowMs: NOW, limits });
    assert.equal(again.deleted, 0);
    assert.equal(again.kept, 1);

    const missing = await pruneUpstreamCache(path.join(dir, 'neexistuje'), { nowMs: NOW, limits });
    assert.deepEqual(missing, { scanned: 0, totalBytes: 0, deleted: 0, deletedBytes: 0, kept: 0, keptBytes: 0, dryRun: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('formatMb', () => {
  assert.equal(formatMb(45 * MB + 0.25 * MB), '45.3 MB');
  assert.equal(formatMb(undefined), '0.0 MB');
});
