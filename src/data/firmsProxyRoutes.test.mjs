// src/data/firmsProxyRoutes.test.mjs — trasy /api/firms/history a /api/firms/news (2026-10-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-fires-route-'));
process.env.FIRE_HISTORY_DIR = dir;
const { firmsProxy } = await import('../../vite.config.js');
const { createFireHistoryStore } = await import('./fireHistoryStore.js');

function handlerOf(plugin) {
  let h = null;
  plugin.configureServer({ middlewares: { use: (p, fn) => { if (p === '/api/firms') h = fn; } } });
  return h;
}
async function call(h, url) {
  return new Promise((resolve) => {
    const res = { headersSent: false, status: 0, body: '', writeHead(s) { this.status = s; this.headersSent = true; return this; }, setHeader() {}, end(b) { this.body = String(b || ''); resolve(this); } };
    void h({ url, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
  });
}

test('/history: detekcie z disku v okruhu + štatistika; zlé súradnice 400', async () => {
  const d = new Date().toISOString().slice(0, 10);
  await createFireHistoryStore({ dir }).append([
    { lat: 44.7356, lon: 37.8093, frp: 3, confidence: 'n', brightness: 330, daynight: 'N', acqDate: d, acqTime: '3', satellite: 'N21' },
    { lat: 44.7357, lon: 37.8094, frp: 5.5, confidence: 'n', brightness: 330, daynight: 'D', acqDate: d, acqTime: '1104', satellite: 'N20' },
  ]);
  const h = handlerOf(firmsProxy());
  const r = await call(h, '/history?lat=44.7356&lon=37.8093&km=5&days=3');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.stats.count, 2); assert.equal(j.stats.passes, 2); assert.equal(j.stats.maxFrp, 5.5);
  assert.equal(j.detections.length, 2);
  assert.match(j.source, /OKO fire history/);
  assert.equal((await call(h, '/history?lat=x&lon=1')).status, 400);
  assert.equal((await call(h, '/news?lat=100&lon=1')).status, 400);
});

test('/api/firms: zastaraná cache sa vráti hneď (NASA visí), obnova beží na pozadí; po zlyhaní 5 min pauza', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-firms-cache-'));
  const now = Date.now();
  const d = new Date(now - 3600_000).toISOString().slice(0, 10);
  const hh = new Date(now - 3600_000).toISOString().slice(11, 13);
  fs.writeFileSync(path.join(cacheDir, 'firms.json'), JSON.stringify({ at: now - 2 * 3600_000, sources: [{ source: 'VIIRS_SNPP_NRT', count: 1, ok: true }], fires: [{ lat: 1, lon: 2, frp: 3, confidence: 'n', brightness: 300, daynight: 'D', acqDate: d, acqTime: `${hh}00`, satellite: 'N' }] }));
  process.env.FIRMS_CACHE_DIR = cacheDir;
  process.env.FIRMS_MAP_KEY = 'test-key';
  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = (url, opts = {}) => { upstreamCalls += 1; return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))); };
  try {
    const h = handlerOf(firmsProxy());
    const t0 = Date.now();
    const r = await call(h, '/');
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 2000, `odpoveď do 2 s, nie po timeoute NASA (${Date.now() - t0} ms)`);
    const j = JSON.parse(r.body);
    assert.equal(j.stale, true); assert.equal(j.count, 1);
    assert.ok(upstreamCalls >= 1, 'obnova sa na pozadí spustila');
    const before = upstreamCalls;
    await call(h, '/');
    assert.equal(upstreamCalls, before, 'kým beží obnova, ďalší dopyt nespúšťa novú');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.FIRMS_CACHE_DIR; delete process.env.FIRMS_MAP_KEY;
  }
});

test('obnova: zdroje NASA naraz; zlyhaný zdroj dostane posledné úspešné ohniská (reused); výpadok všetkého s cache nie je chyba', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-firms-par-'));
  process.env.FIRMS_CACHE_DIR = cacheDir;
  process.env.FIRMS_MAP_KEY = 'test-key';
  const realFetch = globalThis.fetch; const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  const t = new Date(realNow());
  const d = t.toISOString().slice(0, 10); const hhmm = t.toISOString().slice(11, 16).replace(':', '');
  const csv = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n' + `10,20,300,0.4,0.4,${d},${hhmm},N,VIIRS,n,2.0NRT,290,5,D\n`;
  let viirsUp = true; const starts = [];
  globalThis.fetch = (url) => {
    const u = String(url);
    if (u.includes('mapkey_status')) return Promise.resolve(new Response('{}'));
    starts.push(realNow());
    if (viirsUp && u.includes('/VIIRS_SNPP_NRT/')) return new Promise((r) => setTimeout(() => r(new Response(csv)), 60));
    return new Promise((r) => setTimeout(() => r(new Response('Invalid MAP_KEY', { status: 500 })), 60));
  };
  try {
    const h = handlerOf(firmsProxy());
    let j = JSON.parse((await call(h, '/')).body);
    assert.equal(j.count, 1, 'prvá obnova: VIIRS SNPP prišiel');
    assert.ok(Math.max(...starts) - Math.min(...starts) < 50, 'všetky zdroje sa pýtali naraz, nie za sebou');
    const snpp = j.sources.find((s) => s.source === 'VIIRS_SNPP_NRT');
    assert.equal(snpp.ok, true);
    // o 31 min: cache zastaraná → vráti sa hneď, obnova na pozadí; NASA celá dole
    viirsUp = false; offset = 31 * 60_000;
    j = JSON.parse((await call(h, '/')).body);
    assert.equal(j.stale, true); assert.equal(j.count, 1);
    await new Promise((r) => setTimeout(r, 300)); // obnova na pozadí dobehne
    j = JSON.parse((await call(h, '/')).body);
    assert.equal(j.stale, false, 'obnova bez NASA prešla — nie je to chyba, máme posledné ohniská');
    assert.equal(j.count, 1);
    const again = j.sources.find((s) => s.source === 'VIIRS_SNPP_NRT');
    assert.equal(again.ok, false); assert.equal(again.reused, true); assert.equal(again.count, 1);
  } finally {
    globalThis.fetch = realFetch; Date.now = realNow;
    delete process.env.FIRMS_CACHE_DIR; delete process.env.FIRMS_MAP_KEY;
  }
});

test('stav vrstvy: chýbajúce skupiny družíc (skupina chýba až keď zlyhajú všetky jej zdroje)', async () => {
  const { downSourceGroups } = await import('./firmsLabels.js');
  assert.deepEqual(downSourceGroups([
    { source: 'VIIRS_NOAA20_NRT', ok: false, reused: true }, { source: 'VIIRS_SNPP_NRT', ok: false },
    { source: 'MODIS_NRT', ok: false }, { source: 'LANDSAT_NRT', ok: true },
    { source: 'GOES_NRT', ok: false }, { source: 'SENTINEL3_SLSTR_FRP', ok: true }, { source: 'X', ok: false },
  ]), [{ group: 'VIIRS', reused: true }, { group: 'MODIS', reused: false }, { group: 'Meteosat/GOES', reused: false }]);
  assert.deepEqual(downSourceGroups([{ source: 'VIIRS_NOAA20_NRT', ok: false }, { source: 'VIIRS_SNPP_NRT', ok: true }]), []);
  assert.deepEqual(downSourceGroups(null), []);
});
