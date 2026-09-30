// src/data/flightHistoryProxy.test.mjs — plugin histórie letov z vite.config.js so zdvojeným serverom
// (2026-09-30). Testy SPRÁVANIA celej cesty obal → vlákno → SQLite:
//  - po zatvorení servera (reštart Vite) oneskorená odpoveď databázu znova NEOTVORÍ (v logu boli
//    dve otvorenia na každý reštart = vlákno, ktoré už nikto nezavrel),
//  - návštevník sa strážcovi hlási, vlastný dopyt strážcu nie; stav strážcu a disku len lokálne,
//  - pri nedostatku miesta sa nezapisuje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { flightHistoryProxy } from '../../vite.config.js';

const T0 = Math.floor(Date.now() / 1000) - 600;
const openSkyBody = (time, icao) => JSON.stringify({ time, states: [[icao, 'SWR11H', 'Switzerland', time, time, 17.2, 48.1, 10000, false, 230, 90, 0, null, 10030, '1000', false, 0, 4]] });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeServer() {
  const httpServer = new EventEmitter();
  httpServer.listening = false; // strážca sa nespustí (čaká na 'listening'), hlásenia návštevníkov áno
  httpServer.address = () => null;
  const routes = [];
  return { httpServer, routes, middlewares: { use(route, fn) { routes.push({ route, fn }); } } };
}
const handler = (srv, route) => srv.routes.find((r) => r.route === route).fn;

function fakeRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    writeHead(status, h = {}) { res.statusCode = status; for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return res; },
    write() { return true; },
    end(chunk) { res.body = chunk ?? null; return res; },
  };
  return res;
}
const visitorReq = (url = '/') => ({ url, headers: { host: 'okolive.sk', 'cf-connecting-ip': '198.51.100.7', 'cf-ray': 'x' }, socket: { remoteAddress: '127.0.0.1' } });
const localReq = (url = '/') => ({ url, headers: { host: 'localhost:4173' }, socket: { remoteAddress: '127.0.0.1' } });
const keeperReq = (url = '/') => ({ url, headers: { host: '127.0.0.1:4173', 'x-oko-history-keeper': '1' }, socket: { remoteAddress: '127.0.0.1' } });

/** Odpoveď proxy OpenSky tak, ako ju vidí obal (middleware histórie beží pred proxy). */
function serveOpenSky(srv, req, body) {
  const res = fakeRes();
  handler(srv, '/api/opensky')(req, res, () => {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}
async function historyStatus(srv, req = localReq('/status')) {
  const res = fakeRes();
  await handler(srv, '/api/history')(req, res);
  return JSON.parse(res.body);
}

async function withPlugin(env, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-fhp-'));
  const saved = {};
  const vars = { FLIGHT_HISTORY: 'on', FLIGHT_HISTORY_DB: path.join(dir, 'h.sqlite'), FLIGHT_HISTORY_KEEPER: 'off', FLIGHT_HISTORY_MIN_FREE_GB: '', ...env };
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  const logs = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => { logs.push(args.join(' ')); };
  console.warn = (...args) => { logs.push(args.join(' ')); };
  const srv = fakeServer();
  try {
    const plugin = flightHistoryProxy();
    plugin.configureServer(srv);
    await fn({ srv, logs, dbFile: vars.FLIGHT_HISTORY_DB });
  } finally {
    srv.httpServer.emit('close');
    await delay(300);
    console.log = origLog;
    console.warn = origWarn;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    // Upratovanie nesmie prekryť pôvodnú chybu testu (na Windows drží súbor každé otvorené vlákno).
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* dočasný priečinok */ }
  }
}

test('reštart Vite: oneskorená odpoveď po zatvorení servera databázu znova neotvorí a nezapíše', async () => {
  await withPlugin({}, async ({ srv, logs, dbFile }) => {
    serveOpenSky(srv, visitorReq(), openSkyBody(T0, '4b1805'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await historyStatus(srv)).fixes, 1, 'snímok návštevníka zapísaný');
    const opened = () => logs.filter((l) => l.includes('[flight-history] SQLite')).length;
    await delay(100);
    assert.equal(opened(), 1);

    srv.httpServer.emit('close'); // reštart: stará inštancia pluginu končí
    await delay(200); // staré vlákno sa ukončí
    serveOpenSky(srv, visitorReq(), openSkyBody(T0 + 30, '3c6444')); // odpoveď, ktorá dobehla neskôr
    const rows = () => {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      try { return db.prepare('SELECT COUNT(*) AS n FROM fixes').get().n; } finally { db.close(); }
    };
    // Znovuotvorenie je asynchrónne (vlákno, SQLite, log) — sleduj 3 s, či sa niečo z neho neukáže.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && opened() === 1 && rows() === 1) await delay(100);
    assert.equal(opened(), 1, 'po zatvorení sa databáza znova neotvorila (žiadne osirelé vlákno)');
    assert.equal(rows(), 1, 'neskorý snímok sa do starej inštancie nezapísal');
  });
});

test('strážca: návštevník sa hlási, vlastný dopyt strážcu nie; stav strážcu a disku len pre lokálny dopyt', async () => {
  await withPlugin({ FLIGHT_HISTORY_KEEPER: 'on' }, async ({ srv }) => {
    serveOpenSky(srv, keeperReq(), openSkyBody(T0, '4b1805'));
    await new Promise((resolve) => setImmediate(resolve));
    let st = await historyStatus(srv);
    assert.equal(st.fixes, 1, 'snímok strážcu sa zapisuje rovnako');
    assert.equal(st.keeper.streams.opensky.lastClientAt, null, 'strážca nie je návštevník');
    serveOpenSky(srv, visitorReq(), openSkyBody(T0 + 30, '4b1805'));
    await new Promise((resolve) => setImmediate(resolve));
    st = await historyStatus(srv);
    assert.ok(st.keeper.streams.opensky.lastClientAt > 0, 'návštevník strážcu pozdrží');
    assert.equal(st.keeper.streams.mil.lastClientAt, null, 'iný zdroj sa nemení');
    assert.equal(typeof st.disk.ok, 'boolean');
    assert.ok(st.path.endsWith('h.sqlite'));
    // Spoofnutá hlavička strážcu zvonku (cez tunel) sa neráta ako strážca.
    const spoof = visitorReq();
    spoof.headers['x-oko-history-keeper'] = '1';
    const before = st.keeper.streams.opensky.lastClientAt;
    await delay(5);
    serveOpenSky(srv, spoof, openSkyBody(T0 + 60, '4b1805'));
    await new Promise((resolve) => setImmediate(resolve)); // zápis ide do vlákna pred ďalším dopytom na stav
    st = await historyStatus(srv);
    assert.ok(st.keeper.streams.opensky.lastClientAt > before, 'hlavička zvonku nerobí zo zdroja strážcu');
    const pub = await historyStatus(srv, visitorReq('/status'));
    assert.equal(pub.keeper, undefined, 'verejnosť nevidí stav strážcu');
    assert.equal(pub.disk, undefined);
    assert.equal(pub.path, undefined);
    assert.equal(pub.fixes, 3);
  });
});

test('poistka disku: pod hranicou voľného miesta sa nezapisuje a varovanie príde raz', async () => {
  await withPlugin({ FLIGHT_HISTORY_MIN_FREE_GB: String(1e9) }, async ({ srv, logs }) => {
    serveOpenSky(srv, visitorReq(), openSkyBody(T0, '4b1805'));
    serveOpenSky(srv, visitorReq(), openSkyBody(T0 + 30, '4b1805'));
    await delay(200);
    const st = await historyStatus(srv);
    assert.equal(st.fixes, 0, 'nič sa nezapísalo');
    assert.equal(st.disk.ok, false);
    assert.equal(logs.filter((l) => l.includes('málo voľného miesta')).length, 1);
  });
});
