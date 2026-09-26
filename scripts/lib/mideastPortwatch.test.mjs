// scripts/lib/mideastPortwatch.test.mjs — archív IMF PortWatch modulu BLÍZKY VÝCHOD
// (etapa 5a, 2026-09-26): celá séria po stranách, prírastková obnova s prekryvom
// (MMF opravuje predbežné dni), čerstvosť 6 h, poruchy (stale/error), telo trasy
// s priemerom okna pred krízou z celej série. Bez siete, dočasný koreň, falošný ArcGIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  PORTWATCH_FRESH_MS, PORTWATCH_OVERLAP_DAYS, USER_AGENT,
  isPortwatchKey, portwatchFile, portwatchPayload, portwatchRead, portwatchRefresh,
} from './mideastArchive.mjs';
import { PW } from '../../src/data/portwatch.js';

const NOW = Date.UTC(2026, 8, 26, 12);
const DAY = 86_400_000;
const tmpRoot = async () => fsp.mkdtemp(path.join(os.tmpdir(), 'oko-mideast-pw-'));
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Syntetická séria: 1. 1. 2023 → `last`; v okne pred vojnou 85 lodí/deň, od 28. 2. 2026 3/deň; `tweak` mení deň. */
function series(last = '2026-09-20', tweak = {}) {
  const out = [];
  for (let t = Date.UTC(2023, 0, 1); dayKey(t) <= last; t += DAY) {
    const d = dayKey(t);
    const total = tweak[d] ?? (d >= '2026-02-28' ? 3 : 85);
    out.push({ attributes: { date: d, n_total: total, n_tanker: Math.round(total / 2), n_container: 0, n_dry_bulk: 1, n_general_cargo: 0, n_roro: 0, capacity: total * 1000, capacity_tanker: 0 } });
  }
  return out;
}

/** Falošný ArcGIS: filtruje `date >= DATE 'x'` a stránkuje podľa resultOffset/resultRecordCount. */
function arcgis(rowsFor, calls = []) {
  return async (url, init) => {
    calls.push({ url, ua: init?.headers?.['User-Agent'] });
    const u = new URL(url);
    const where = u.searchParams.get('where') || '';
    const portid = /portid='([^']+)'/.exec(where)?.[1];
    const from = /date >= DATE '([^']+)'/.exec(where)?.[1] || null;
    const all = (rowsFor(portid) || []).filter((f) => !from || f.attributes.date >= from);
    const offset = Number(u.searchParams.get('resultOffset') || 0);
    const size = Number(u.searchParams.get('resultRecordCount') || 1000);
    const page = all.slice(offset, offset + size);
    const body = JSON.stringify({ features: page, ...(offset + size < all.length ? { exceededTransferLimit: true } : {}) });
    return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } };
  };
}

test('prvá obnova: celá séria po stranách (1 000), súbor s atribúciou a licenciou MMF, UA s kontaktom', async () => {
  const root = await tmpRoot();
  const calls = [];
  const r = await portwatchRefresh(root, 'hormuz', { fetchImpl: arcgis(() => series(), calls), now: NOW });
  assert.equal(r.status, 'updated');
  assert.equal(r.lastDay, '2026-09-20');
  assert.equal(r.count, 1359, '1. 1. 2023 → 20. 9. 2026');
  assert.equal(calls.length, 2, 'dve strany');
  assert.equal(new URL(calls[0].url).searchParams.get('where'), "portid='chokepoint6'", 'prvá obnova bez dátumového filtra');
  assert.equal(new URL(calls[1].url).searchParams.get('resultOffset'), '1000');
  assert.equal(calls[0].ua, USER_AGENT);
  const snap = await portwatchRead(root, 'hormuz');
  assert.equal(snap.portid, 'chokepoint6');
  assert.equal(snap.fetchedAt, NOW);
  assert.match(snap.attribution, /^Source: International Monetary Fund, PortWatch/);
  assert.match(snap.license, /attribution/);
  assert.deepEqual(snap.rows[0], ['2023-01-01', 85, 43, 0, 1, 0, 0, 85000, 0]);
});

test('čerstvosť 6 h bez dopytu; potom prírastok od posledného dňa − 45 dní a oprava predbežného dňa vyhráva', async () => {
  const root = await tmpRoot();
  await portwatchRefresh(root, 'hormuz', { fetchImpl: arcgis(() => series()), now: NOW });
  const calls = [];
  const fresh = await portwatchRefresh(root, 'hormuz', { fetchImpl: arcgis(() => series(), calls), now: NOW + PORTWATCH_FRESH_MS - 1 });
  assert.equal(fresh.status, 'fresh');
  assert.equal(calls.length, 0);
  const later = NOW + PORTWATCH_FRESH_MS + 1;
  const r = await portwatchRefresh(root, 'hormuz', { fetchImpl: arcgis(() => series('2026-09-27', { '2026-09-20': 9 }), calls), now: later });
  assert.equal(r.status, 'updated');
  assert.equal(r.lastDay, '2026-09-27');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('where'), `portid='chokepoint6' AND date >= DATE '${dayKey(Date.UTC(2026, 8, 20) - PORTWATCH_OVERLAP_DAYS * DAY)}'`);
  const snap = await portwatchRead(root, 'hormuz');
  assert.equal(snap.rows.length, 1366);
  assert.equal(snap.rows.find((x) => x[0] === '2026-09-20')[PW.total], 9, 'MMF opravil predbežný deň — novšie číslo vyhráva');
  assert.equal(new Set(snap.rows.map((x) => x[0])).size, snap.rows.length, 'bez duplicít');
});

test('poruchy: so starou sériou stale (súbor ostáva), bez nej error; chyba ArcGIS a zlé vstupy sa nehádžu', async () => {
  const root = await tmpRoot();
  const boom = async () => { throw new Error('network down'); };
  const e1 = await portwatchRefresh(root, 'suez', { fetchImpl: boom, now: NOW });
  assert.equal(e1.status, 'error');
  assert.match(e1.error, /network down/);
  await portwatchRefresh(root, 'suez', { fetchImpl: arcgis(() => series()), now: NOW });
  const st = await portwatchRefresh(root, 'suez', { fetchImpl: boom, now: NOW + PORTWATCH_FRESH_MS + 1 });
  assert.equal(st.status, 'stale');
  assert.equal(st.count, 1359);
  assert.equal((await portwatchRead(root, 'suez')).rows.length, 1359, 'stará séria ostala');
  const arcErr = async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(JSON.stringify({ error: { code: 400, message: 'Invalid query' } })) });
  const e2 = await portwatchRefresh(await tmpRoot(), 'cape', { fetchImpl: arcErr, now: NOW });
  assert.equal(e2.status, 'error');
  assert.match(e2.error, /PortWatch error 400: Invalid query/);
  const http = async () => ({ ok: false, status: 503, headers: { get: () => null }, arrayBuffer: async () => Buffer.from('busy') });
  assert.match((await portwatchRefresh(await tmpRoot(), 'cape', { fetchImpl: http, now: NOW })).error, /HTTP 503/);
  assert.equal((await portwatchRefresh(root, '../etc', { fetchImpl: boom, now: NOW })).status, 'error', 'neznámy kľúč = nikdy cesta na disk');
  assert.equal((await portwatchRefresh(root, 'hormuz', { fetchImpl: boom, now: NaN })).status, 'error');
  assert.equal(isPortwatchKey('hormuz'), true);
  assert.equal(isPortwatchKey('malacca'), false, 'karta má štyri úžiny Blízkeho východu');
  assert.equal(await portwatchRead(root, '../etc'), null);
  assert.match(portwatchFile(root, 'hormuz'), /[\\/]\.gev-cache[\\/]mideast[\\/]events[\\/]portwatch[\\/]hormuz\.json$/);
});

test('telo trasy: chvost `days` riadkov, priemer okna pred krízou z CELEJ série, chýbajúce úžiny vynechané', async () => {
  const root = await tmpRoot();
  await portwatchRefresh(root, 'hormuz', { fetchImpl: arcgis(() => series()), now: NOW });
  const json = await portwatchPayload(root, ['hormuz', 'suez'], { days: 30, nowMs: NOW });
  assert.equal(json.generatedAt, NOW);
  assert.match(json.attribution, /International Monetary Fund/);
  assert.equal(json.chokepoints.length, 1, 'Suez ešte nemá súbor');
  const h = json.chokepoints[0];
  assert.equal(h.key, 'hormuz');
  assert.equal(h.rows.length, 30);
  assert.equal(h.rows.at(-1)[0], '2026-09-20');
  assert.deepEqual({ id: h.baseline.id, from: h.baseline.from, to: h.baseline.to, mean: h.baseline.mean, days: h.baseline.days }, { id: 'iran-war', from: '2025-02-28', to: '2026-02-27', mean: 85, days: 365 });
  assert.equal(h.baseline.meanTanker, 43);
});
