// src/data/mideastControlClient.test.mjs — klient snímok KONTROLY SÍDIEL Blízkeho východu
// (etapa 2, 2026-09-26): URL s modulom a dňom, chyba so stavom (404 = no_control_snapshot),
// sklad s TTL podľa modul+deň, alias pod vlastným dňom snímky, zdieľaný sľub, zlyhanie sa necachuje.
import test from 'node:test';
import assert from 'node:assert/strict';

import { MIDEAST_CONTROL_TTL_MS, MIDEAST_EVENTS_API, createMideastControlStore, fetchMideastControl } from './mideastControlClient.js';

const snapshot = (moduleId, day) => ({ day, module: moduleId, revisionAt: `${day}T10:00:00Z`, count: 1, summary: { settlements: {}, infrastructure: {} }, points: [], license: 'CC BY-SA 4.0' });
const okResponse = (json) => ({ ok: true, status: 200, json: async () => json });
const errResponse = (status, json) => ({ ok: false, status, json: async () => json });

test('fetchMideastControl: URL nesie modul aj deň, no-store; 404 → Error no_control_snapshot so status; 400 bad_module; nečitateľné telo → HTTP <status>; 200 bez points → bad_control_payload', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init]); return okResponse(snapshot('yemen', '2026-09-24')); };
  const json = await fetchMideastControl('yemen', '2026-09-26', { fetcher });
  assert.equal(json.module, 'yemen');
  assert.deepEqual(calls, [[`${MIDEAST_EVENTS_API}/control?module=yemen&at=2026-09-26`, { cache: 'no-store' }]]);
  assert.equal(MIDEAST_EVENTS_API, '/api/mideast/events');
  await fetchMideastControl('israel-palestine', '2026-09-26', { fetcher, base: '/x' });
  assert.equal(calls[1][0], '/x/control?module=israel-palestine&at=2026-09-26');

  await assert.rejects(fetchMideastControl('lebanon', '2026-09-26', { fetcher: async () => errResponse(404, { error: 'no_control_snapshot', module: 'lebanon', at: '2026-09-26', days: 0 }) }), (err) => {
    assert.equal(err.message, 'no_control_snapshot');
    assert.equal(err.status, 404);
    assert.equal(err.body?.module, 'lebanon');
    return true;
  });
  await assert.rejects(fetchMideastControl('mars', '2026-09-26', { fetcher: async () => errResponse(400, { error: 'bad_module' }) }), (err) => err.message === 'bad_module' && err.status === 400);
  await assert.rejects(fetchMideastControl('yemen', '2026-09-26', { fetcher: async () => ({ ok: false, status: 502, json: async () => { throw new Error('nie JSON'); } }) }), /HTTP 502/);
  // 200 bez snímky (HTML z presmerovaného /api → telo nie je JSON; alebo objekt bez `points`) nie je
  // prázdna snímka — vrstva by inak ostala navždy „načítava sa" bez chyby.
  await assert.rejects(fetchMideastControl('yemen', '2026-09-26', { fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new Error('nie JSON'); } }) }), (err) => {
    assert.equal(err.message, 'bad_control_payload'); assert.equal(err.status, 200); assert.equal(err.body, null); return true;
  });
  await assert.rejects(fetchMideastControl('yemen', '2026-09-26', { fetcher: async () => okResponse({ day: '2026-09-26', module: 'yemen', points: 'nie pole' }) }), (err) => err.message === 'bad_control_payload' && err.body?.module === 'yemen');
  await assert.rejects(fetchMideastControl('yemen', '2026-09-26', { fetcher: async () => okResponse(null) }), /bad_control_payload/);
  assert.deepEqual((await fetchMideastControl('yemen', '2026-09-26', { fetcher: async () => okResponse({ ...snapshot('yemen', '2026-09-24'), points: [] }) })).points, [], 'prázdne pole bodov je platná (prázdna) snímka');
});

test('sklad: TTL 15 min podľa modul+deň, iný modul = iný dopyt, snímka sa uloží aj pod vlastným dňom, po TTL znova', async () => {
  let t = 1_000_000;
  const calls = [];
  const store = createMideastControlStore({ now: () => t, fetchControl: async (moduleId, day) => { calls.push(`${moduleId}:${day}`); return snapshot(moduleId, '2026-09-24'); } });
  assert.equal(MIDEAST_CONTROL_TTL_MS, 15 * 60_000);
  const a = await store.control('yemen', '2026-09-26');
  const b = await store.control('yemen', '2026-09-26');
  assert.equal(a, b, 'druhý dopyt z cache');
  assert.deepEqual(calls, ['yemen:2026-09-26']);
  // Snímka platná pre 26. 9. je z 24. 9. — pod svojím dňom je tiež v cache.
  assert.equal(await store.control('yemen', '2026-09-24'), a);
  assert.deepEqual(calls, ['yemen:2026-09-26']);
  // Epocha ms → deň.
  assert.equal(await store.control('yemen', Date.UTC(2026, 8, 26, 15)), a);
  assert.deepEqual(calls, ['yemen:2026-09-26']);
  // Iný modul v ten istý deň = vlastný dopyt.
  const s = await store.control('syria', '2026-09-26');
  assert.equal(s.module, 'syria');
  assert.deepEqual(calls, ['yemen:2026-09-26', 'syria:2026-09-26']);
  // Po TTL ide dopyt znova.
  t += MIDEAST_CONTROL_TTL_MS + 1;
  await store.control('yemen', '2026-09-26');
  assert.deepEqual(calls, ['yemen:2026-09-26', 'syria:2026-09-26', 'yemen:2026-09-26']);
  // clear(modul) zahodí len jeho kľúče.
  store.clear('syria');
  assert.ok([...store._cache.keys()].every((k) => k.startsWith('yemen:')));
  store.clear();
  assert.equal(store._cache.size, 0);
});

test('sklad: súbežné dopyty zdieľajú sľub; zlyhanie (404) sa necachuje a ďalší pokus ide na server', async () => {
  let fail = true;
  const calls = [];
  const store = createMideastControlStore({ now: () => 5, fetchControl: async (moduleId, day) => {
    calls.push(day);
    await new Promise((r) => setTimeout(r, 1));
    if (fail) { const err = new Error('no_control_snapshot'); err.status = 404; throw err; }
    return snapshot(moduleId, day);
  } });
  const p1 = store.control('lebanon', '2026-09-26');
  const p2 = store.control('lebanon', '2026-09-26');
  assert.equal(p1, p2, 'ten istý sľub');
  await assert.rejects(p1, (err) => err.status === 404);
  assert.deepEqual(calls, ['2026-09-26']);
  assert.equal(store._cache.has('lebanon:2026-09-26'), false, 'chyba sa necachuje');
  fail = false;
  const ok = await store.control('lebanon', '2026-09-26');
  assert.equal(ok.module, 'lebanon');
  assert.deepEqual(calls, ['2026-09-26', '2026-09-26']);
  // Strop kľúčov: najstaršie sa vyhodia.
  const small = createMideastControlStore({ now: () => 5, max: 2, fetchControl: async (m, d) => snapshot(m, d) });
  await small.control('a', '2026-01-01'); await small.control('b', '2026-01-01'); await small.control('c', '2026-01-01');
  assert.deepEqual([...small._cache.keys()], ['b:2026-01-01', 'c:2026-01-01']);
});
