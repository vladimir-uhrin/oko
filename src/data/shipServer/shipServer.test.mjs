// src/data/shipServer/shipServer.test.mjs — lodná časť servera (2026-10-11, bod 8 presun z vite.config.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aisLiveHealth, contactFromRow, createShipServer } from './index.js';
import { shipHistoryDirFromEnv } from './history.js';
import { SUPPLEMENT_INTERVALS, isLoopbackRequest } from './supplements.js';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const guard = () => ({ ok: () => true });

test('zdravie: čerstvé = live; stíchnutý zdroj = stale; po štarte milosť; oceán vypnutý sa nehodnotí', () => {
  const fresh = { at: NOW - 60_000, rows: 1, merged: 1, error: null, unresolved: 0 };
  const live = aisLiveHealth({ feed: { lastMessageAt: NOW - 1000, status: 'live' }, supplements: { openseafeed: fresh, aiscast: fresh, ocean: fresh }, oceanActive: true, dma: { active: true, lastDoneAt: NOW - 3600_000 }, history: { written: 5 }, retained: 10, nowMs: NOW, uptimeMs: 3_600_000 });
  assert.equal(live.status, 'live');
  assert.deepEqual(Object.keys(live.checks), ['aisstream', 'openseafeed', 'aiscast', 'ocean', 'dma', 'shipHistory']);
  const stale = aisLiveHealth({ feed: { lastMessageAt: NOW - 1000 }, supplements: { openseafeed: { ...fresh, at: NOW - 20 * 60_000 }, aiscast: fresh, ocean: fresh }, oceanActive: false, dma: { active: false }, history: null, retained: 0, nowMs: NOW, uptimeMs: 3_600_000 });
  assert.equal(stale.ok, false);
  assert.equal(stale.checks.openseafeed.ok, false);
  assert.equal(stale.checks.ocean, undefined, 'oceán vypnutý');
  assert.equal(stale.checks.dma, undefined);
  const young = aisLiveHealth({ feed: { lastMessageAt: NOW - 1000 }, supplements: { openseafeed: { at: 0 }, aiscast: { at: 0 }, ocean: { at: 0 } }, oceanActive: true, dma: { active: true, lastDoneAt: null }, history: null, retained: 0, nowMs: NOW, uptimeMs: 60_000 });
  assert.equal(young.ok, true, 'milosť po štarte');
  assert.equal(aisLiveHealth({ feed: { lastMessageAt: NOW - 11 * 60_000 }, supplements: null, dma: { active: false }, retained: 0, nowMs: NOW, uptimeMs: 1e7 }).checks.aisstream.ok, false);
});

test('kontakt pre strážcu: čerstvý riadok áno, starý null; loopback bez Cloudflare; priečinok histórie', () => {
  const row = { lat: 1, lon: 2, speed: 9.5, nav_status: 0, last_position_epoch: NOW / 1000 - 60, name: 'X' };
  assert.deepEqual(contactFromRow(row, NOW, 6 * 3600_000), { lat: 1, lon: 2, sog: 9.5, navStatus: 0, lastPositionEpoch: NOW / 1000 - 60, feed: 'aisstream', name: 'X' });
  assert.equal(contactFromRow({ ...row, last_position_epoch: NOW / 1000 - 7 * 3600 }, NOW, 6 * 3600_000), null);
  assert.equal(contactFromRow(undefined, NOW, 1), null);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::1' }, headers: {} }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-connecting-ip': '1.2.3.4' } }), false, 'za tunelom = návštevník');
  assert.equal(shipHistoryDirFromEnv({ FLIGHT_HISTORY_DB: 'D:\\oko-history\\flight-history.sqlite' }, 'C:/x'), path.join('D:\\oko-history', 'ships'));
  assert.equal(shipHistoryDirFromEnv({}, 'C:/x'), path.join('C:/x', '.gev-cache', 'ship-history'));
  assert.ok(SUPPLEMENT_INTERVALS.openseafeed[1] > SUPPLEMENT_INTERVALS.openseafeed[0], 'bez návštevníka redšie');
});

test('server: trasy /contact, /history, /health; skúšobná inštancia (persist off) nič nezapisuje; v službe áno', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipsrv-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vessels = new Map([['232063671', { mmsi: '232063671', lat: 51.2, lon: 1.9, speed: 11, nav_status: 0, last_position_epoch: NOW / 1000 - 30, name: 'JANE' }]]);
  const make = (persist) => createShipServer({ rootDir: root, env: { SHIP_HISTORY_DIR: path.join(root, 'ships'), AIS_SUPPLEMENTS: 'off', DMA_BACKFILL: 'off' }, vessels, tracks: new Map(), appendTrack: () => {}, cacheMax: 10, staleMs: 6 * 3600_000, feedStatus: () => ({ lastMessageAt: NOW, status: 'live' }), persistEnabled: () => persist, createDiskGuard: guard, now: () => NOW });
  const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } });
  const qa = make(false);
  assert.equal(qa.start(), false, 'skúšobná inštancia nezapisuje');
  assert.equal(qa.recordPosition('232063671', 51.2, 1.9, NOW / 1000), false);
  let r = res();
  assert.equal(await qa.handleRoute({ socket: { remoteAddress: '1.2.3.4' }, headers: {} }, r, new URL('http://x/contact?mmsi=232063671')), true);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.contact.sog, 11);
  r = res();
  await qa.handleRoute({ socket: {}, headers: {} }, r, new URL('http://x/contact?mmsi=12'));
  assert.equal(r.statusCode, 400);
  r = res();
  await qa.handleRoute({ socket: {}, headers: {} }, r, new URL('http://x/health'));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.checks.openseafeed, undefined, 'zdroje navyše nebežia → nehodnotia sa');
  assert.equal(await qa.handleRoute({ socket: {}, headers: {} }, res(), new URL('http://x/track?mmsi=1')), false, 'cudzie trasy nechá');
  const svc = make(true);
  assert.equal(svc.start(), true);
  t.after(() => svc.stop());
  assert.equal(svc.recordPosition('232063671', 51.2, 1.9, NOW / 1000 - 600, 11, 90), true);
  assert.equal(svc.recordPosition('232063671', 51.3, 1.9, NOW / 1000, 11, 90), true);
  r = res();
  await svc.handleRoute({ socket: {}, headers: {} }, r, new URL('http://x/history?mmsi=232063671&days=1'));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.total, 2, 'číta aj nezapísané');
  assert.equal(r.body.samples[1].sog, 11);
  assert.equal(svc.supplements.visitorsRecent(), true, 'požiadavka bez loopback adresy = návštevník → plný takt');
});
