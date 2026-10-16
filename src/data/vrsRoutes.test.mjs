// Trasy z VRS standing-data (2026-10-12): tar, CSV, výber úseku, sťahovanie s kópiou na disku.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  adsbdbRouteAnswer, buildVrsDb, createVrsRouteDb, parseVrsArchiveInWorker, pickLeg, routeHintFromQuery, vrsRouteAnswer, vrsRouteFor, walkTar,
} from './vrsRoutes.js';
import { createEstimateTracker, fixFromState } from './flightEstimate.js';

function tarEntry(name, content, type = '0') {
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, pad]);
}

function pax(pathValue) {
  const body = ` path=${pathValue}\n`;
  let len = body.length + 2;
  while (`${len}${body}`.length !== len) len += 1;
  return `${len}${body}`;
}

const ROUTES = '﻿Callsign,Code,Number,AirlineCode,AirportCodes\nSIA810,SIA,810,SIA,WSSS-ZBAD\nQTR1,QTR,1,QTR,OTHH-EGLL-KJFK\nXXX1,XXX,1,XXX,ZZZZ-WSSS\n'
  // okružná trasa A-B-A a trasa, pri ktorej poloha 0,0 vyberie iný než prvý úsek (2026-10-15)
  + 'AAL1305,AAL,1305,AAL,KORD-CYVR-KORD\nAAL704,AAL,704,AAL,KLAX-KCLT-EDDF\n';
const AIRPORTS = 'Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet\n'
  + 'WSSS,Singapore Changi Airport,WSSS,SIN,Singapore,SG,1.35,103.99,22\n'
  + 'ZBAD,"Beijing Daxing International Airport, Beijing",ZBAD,PKX,Beijing,CN,39.51,116.41,98\n'
  + 'OTHH,Hamad International Airport,OTHH,DOH,Doha,QA,25.27,51.61,13\n'
  + 'EGLL,London Heathrow Airport,EGLL,LHR,London,GB,51.47,-0.46,83\n'
  + 'KJFK,John F Kennedy International Airport,KJFK,JFK,New York,US,40.64,-73.78,13\n'
  + 'KORD,Chicago O\'Hare International Airport,KORD,ORD,Chicago,US,41.98,-87.90,672\n'
  + 'CYVR,Vancouver International Airport,CYVR,YVR,Vancouver,CA,49.19,-123.18,14\n'
  + 'KLAX,Los Angeles International Airport,KLAX,LAX,Los Angeles,US,33.94,-118.41,125\n'
  + 'KCLT,Charlotte Douglas International Airport,KCLT,CLT,Charlotte,US,35.21,-80.94,748\n'
  + 'EDDF,Frankfurt am Main Airport,EDDF,FRA,Frankfurt,DE,50.03,8.57,364\n';

function sampleTar() {
  const longName = `standing-data-main/routes/schema-01/S/${'x'.repeat(80)}/SIA-all.csv`;
  return Buffer.concat([
    tarEntry('pax_global_header', pax('ignored'), 'g'),
    tarEntry('PaxHeader', pax(longName), 'x'),
    tarEntry('placeholder', ROUTES),
    tarEntry('standing-data-main/airports/schema-01/W/WS.csv', AIRPORTS),
    tarEntry('standing-data-main/README.md', '# readme'),
    Buffer.alloc(1024, 0),
  ]);
}

test('tar: súbory aj s pax dlhou cestou, globálna hlavička sa preskočí', () => {
  const names = [];
  walkTar(sampleTar(), (name) => names.push(name));
  assert.equal(names.length, 3);
  assert.match(names[0], /\/routes\/schema-01\/S\/x+\/SIA-all\.csv$/);
  assert.equal(names[1], 'standing-data-main/airports/schema-01/W/WS.csv');
});

test('databáza: trasy a letiská (BOM, čiarka v úvodzovkách), tvar ako adsbdb', () => {
  const db = buildVrsDb(sampleTar());
  assert.equal(db.routes.get('SIA810'), 'WSSS-ZBAD');
  assert.equal(db.airports.get('ZBAD').name, 'Beijing');
  const route = vrsRouteFor(db, 'sia810');
  assert.deepEqual(route.origin, { code: 'SIN', icao: 'WSSS', name: 'Singapore', lat: 1.35, lon: 103.99, country: 'SG' });
  assert.equal(route.destination.code, 'PKX');
  assert.equal(route.source, 'vrs');
});

test('neznámy znak, súkromný znak alebo neznáme letisko = žiadna trasa', () => {
  const db = buildVrsDb(sampleTar());
  assert.equal(vrsRouteFor(db, 'DLH400'), null);
  assert.equal(vrsRouteFor(db, 'OKVVA'), null, 'registrácia nie je volací znak dopravcu');
  assert.equal(vrsRouteFor(db, 'XXX1'), null, 'ZZZZ v databáze letísk chýba');
});

test('medzipristátie: úsek, na ktorom lietadlo je', () => {
  const db = buildVrsDb(sampleTar());
  const overEurope = vrsRouteFor(db, 'QTR1', { lat: 45, lon: 20 });
  assert.equal(overEurope.origin.code, 'DOH');
  assert.equal(overEurope.destination.code, 'LHR');
  const overAtlantic = vrsRouteFor(db, 'QTR1', { lat: 52, lon: -35 });
  assert.equal(overAtlantic.origin.code, 'LHR');
  assert.equal(overAtlantic.destination.code, 'JFK');
  assert.deepEqual(pickLeg([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], null), [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }]);
});

test('sťahovanie: malá databáza sa odmietne, kópia na disku sa načíta bez siete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrs-'));
  const cacheFile = path.join(dir, 'standing-data.tar.gz');
  const gz = zlib.gzipSync(sampleTar());
  const vrs = createVrsRouteDb({
    cacheFile,
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '"e1"' }, arrayBuffer: async () => gz }),
  });
  assert.equal(await vrs.refresh(), 'error', 'testovací archív má < 1000 trás — poistka proti prázdnemu výpisu');
  assert.equal(vrs.ready(), false);
  assert.match(vrs.status().lastError, /malá databáza/);
  // Kópia na disku z predchádzajúceho behu (tu podstrčená) — start() ju načíta a sieť nevolá, kým je čerstvá.
  fs.writeFileSync(cacheFile, gz);
  fs.writeFileSync(`${cacheFile}.json`, JSON.stringify({ at: Date.now(), etag: '"e1"' }));
  let fetched = 0;
  let loaded = 0;
  const fromDisk = createVrsRouteDb({ cacheFile, fetchImpl: async () => { fetched += 1; throw new Error('nemá volať'); }, onLoaded: () => { loaded += 1; } });
  const realBuild = buildVrsDb(sampleTar());
  // Poistka na veľkosť platí aj pre disk — test overí cestu cez podstrčenú databázu.
  fromDisk._setDbForTest(realBuild);
  assert.equal(fromDisk.lookup('SIA810').destination.code, 'PKX');
  assert.equal(fromDisk.status().hits, 1);
  assert.equal(fetched, 0);
  assert.equal(loaded, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('304 Not Modified nechá databázu tak', async () => {
  let calls = 0;
  const vrs = createVrsRouteDb({
    fetchImpl: async (url, init) => { calls += 1; assert.equal(init.headers['If-None-Match'], undefined); return { ok: false, status: 304 }; },
  });
  assert.equal(await vrs.refresh(), 'unchanged');
  assert.equal(calls, 1);
});

// --- 2026-10-15: okružné trasy, poloha z dopytu, neúplná odpoveď, spracovanie vo vlákne ---

test('okružná trasa A-B-A: kurz vyberie úsek, ktorého cieľ je pred lietadlom', () => {
  const db = buildVrsDb(sampleTar());
  // Nad Montanou, letí na východ (98°) — spiatočný úsek Vancouver → Chicago.
  const back = vrsRouteFor(db, 'AAL1305', { lat: 46.31, lon: -109.07, trkDeg: 98 });
  assert.equal(back.origin.code, 'YVR');
  assert.equal(back.destination.code, 'ORD', 'cieľ pred lietadlom, nie za chvostom');
  // To isté miesto, kurz na západ — tam úsek Chicago → Vancouver.
  const out = vrsRouteFor(db, 'AAL1305', { lat: 46.31, lon: -109.07, trkDeg: 290 });
  assert.equal(out.origin.code, 'ORD');
  assert.equal(out.destination.code, 'YVR');
  // Bez kurzu doterajšie správanie (prvý z rovnako dobrých úsekov).
  assert.equal(vrsRouteFor(db, 'AAL1305', { lat: 46.31, lon: -109.07 }).destination.code, 'YVR');
  assert.equal(vrsRouteFor(db, 'AAL1305', { lat: 46.31, lon: -109.07, trkDeg: null }).destination.code, 'YVR');
});

test('kurz rozhoduje len medzi rovnako dobrými úsekmi — vzdialený úsek „pred nosom" polohu neprebije', () => {
  const LAX = { code: 'LAX', lat: 33.94, lon: -118.41 };
  const DEN = { code: 'DEN', lat: 39.86, lon: -104.67 };
  const ORD = { code: 'ORD', lat: 41.98, lon: -87.9 };
  const codes = (leg) => leg.map((s) => s.code).join('-');
  // Pred Denverom na priblížení od západu: aj Chicago je „pred nosom", ale lietadlo je na úseku LAX → DEN.
  assert.equal(codes(pickLeg([LAX, DEN, ORD], { lat: 39.75, lon: -105.3, trkDeg: 85 })), 'LAX-DEN');
  // Po odlete z Denveru na východ: úsek DEN → ORD.
  assert.equal(codes(pickLeg([LAX, DEN, ORD], { lat: 39.9, lon: -104.0, trkDeg: 80 })), 'DEN-ORD');
  // Katar–Londýn–New York nad Európou s kurzom späť na juhovýchod (vyčkávanie, obchádzka búrky):
  // cieľ najlepšieho úseku je za chvostom, iný úsek polohe nesedí — ostáva Doha → Londýn.
  const db = buildVrsDb(sampleTar());
  const holding = vrsRouteFor(db, 'QTR1', { lat: 45, lon: 20, trkDeg: 120 });
  assert.equal(holding.origin.code, 'DOH');
  assert.equal(holding.destination.code, 'LHR');
});

/** Bod `northKm` na sever a `eastKm` na východ od letiska (stačí na desiatky km). */
function offsetKm(p, northKm, eastKm) {
  return { lat: p.lat + northKm / 111.2, lon: p.lon + eastKm / (111.2 * Math.cos((p.lat * Math.PI) / 180)) };
}

test('bežná trasa A-B-C: kurz pri medzipristátí úsek nemení (LAX-CLT-FRA pred Charlotte ostáva LAX → CLT)', () => {
  // 2026-10-16: pri tolerancii 50 km lietadlo pred pristátím v Charlotte s kurzom od letiska (po vetre,
  // vektorovanie) dostalo CLT → FRA a karta to mala ako konečné; odhad ho pustil ďalej k Frankfurtu.
  const db = buildVrsDb(sampleTar());
  const CLT = { lat: 35.21, lon: -80.94 };
  const leg = (at) => { const r = vrsRouteFor(db, 'AAL704', at); return `${r.origin.code}-${r.destination.code}`; };
  for (const [north, east, trkDeg] of [[0, -15, 330], [0, -20, 330], [10, -20, 0]]) {
    assert.equal(leg({ ...offsetKm(CLT, north, east), trkDeg }), 'LAX-CLT', `${north} km S, ${east} km V, kurz ${trkDeg}`);
  }
  const LAX = { code: 'LAX', lat: 33.94, lon: -118.41 };
  const DEN = { code: 'DEN', lat: 39.86, lon: -104.67 };
  const ORD = { code: 'ORD', lat: 41.98, lon: -87.9 };
  const denLeg = pickLeg([LAX, DEN, ORD], { ...offsetKm(DEN, 10, -20), trkDeg: 0 });
  assert.equal(denLeg.map((s) => s.code).join('-'), 'LAX-DEN');
  // Celé okolie Charlotte (10–55 km, každý smer, každý kurz): úsek vždy ako bez kurzu, teda podľa polohy.
  let changed = 0;
  for (let r = 10; r <= 55; r += 5) {
    for (let b = 0; b < 360; b += 15) {
      const p = offsetKm(CLT, r * Math.cos((b * Math.PI) / 180), r * Math.sin((b * Math.PI) / 180));
      const byPosition = leg(p);
      for (let trkDeg = 0; trkDeg < 360; trkDeg += 30) if (leg({ ...p, trkDeg }) !== byPosition) changed += 1;
    }
  }
  assert.equal(changed, 0, 'kurz v koncovej oblasti medzipristátia nerozhoduje');
});

test('okružná trasa A-B-A: kurz rozhodne aj pri obratisku; takmer okružná A-B-A′ len mimo neho', () => {
  const ORD = { code: 'ORD', lat: 41.98, lon: -87.9 };
  const YVR = { code: 'YVR', lat: 49.19, lon: -123.18 };
  const MDW = { code: 'MDW', lat: 41.79, lon: -87.75 };
  const codes = (leg) => leg.map((s) => s.code).join('-');
  // Obrátený úsek (ORD→YVR a YVR→ORD má obchádzku bit po bite rovnakú): poloha nerozlíši nič, ani 30 km
  // od Vancouvru — odlet na východ je YVR → ORD, priblíženie od východu ORD → YVR.
  const nearYvr = offsetKm(YVR, 0, 30);
  assert.equal(codes(pickLeg([ORD, YVR, ORD], { ...nearYvr, trkDeg: 95 })), 'YVR-ORD');
  assert.equal(codes(pickLeg([ORD, YVR, ORD], { ...nearYvr, trkDeg: 275 })), 'ORD-YVR');
  // Chicago O'Hare → Vancouver → Chicago Midway: nad Montanou sa obchádzky líšia o ~1 km — rozhodne kurz.
  const montana = { lat: 46.31, lon: -109.07 };
  assert.equal(codes(pickLeg([ORD, YVR, MDW], { ...montana, trkDeg: 98 })), 'YVR-MDW');
  assert.equal(codes(pickLeg([ORD, YVR, MDW], { ...montana, trkDeg: 290 })), 'ORD-YVR');
  // Pri Vancouvri (spoločné letisko úsekov, nie obrátený úsek) rozhoduje poloha ako bez kurzu.
  const byPosition = codes(pickLeg([ORD, YVR, MDW], nearYvr));
  for (const trkDeg of [95, 275]) assert.equal(codes(pickLeg([ORD, YVR, MDW], { ...nearYvr, trkDeg })), byPosition);
});

test('odhad polohy (fix s kurzom) na spiatočnom úseku A-B-A letí k správnemu cieľu', () => {
  const db = buildVrsDb(sampleTar());
  const T = 1_791_000_000;
  // [hex, cs, krajina, tPos, tContact, lon, lat, baro, ground, gs, trk, vr, sensors, geo, squawk, spi, src, cat]
  const st = ['a1b2c3', 'AAL1305 ', 'United States', T, T, -109.07, 46.31, 11_000, false, 230, 98, 0, null, 11_050, '1000', false, 0, 3];
  const fix = fixFromState(st, T);
  const tracker = createEstimateTracker({ localRoute: (cs, f) => vrsRouteFor(db, cs, f) });
  tracker.seed([fix], (T + 60) * 1000);
  const [estimate] = tracker.list((T + 120) * 1000);
  assert.equal(estimate.route.origin.code, 'YVR');
  assert.equal(estimate.route.destination.code, 'ORD');
});

test('poloha z dopytu: chýbajúca alebo prázdna nie je 0,0 (prvý úsek), kurz sa normalizuje', () => {
  const q = (s) => routeHintFromQuery(new URLSearchParams(s));
  assert.equal(q(''), null, 'bez ?lat=&lon=');
  assert.equal(q('lat=&lon='), null, 'prázdne');
  assert.equal(q('lat=%20&lon=1'), null, 'medzera');
  assert.equal(q('lat=abc&lon=1'), null);
  assert.equal(q('lat=95&lon=1'), null, 'mimo rozsahu');
  assert.equal(q('lat=34&lon=-117').trkDeg, null);
  assert.deepEqual(q('lat=34&lon=-117&trk=-30'), { lat: 34, lon: -117, trkDeg: 330 });
  assert.equal(q('lat=34&lon=-117&trk=').trkDeg, null);
  assert.deepEqual(q('lat=0&lon=0'), { lat: 0, lon: 0, trkDeg: null }, 'výslovná nula platí');
  // Skutočný dopad: AAL704 KLAX-KCLT-EDDF bez polohy = prvý úsek (bod 0,0 by vybral Charlotte → Frankfurt).
  const db = buildVrsDb(sampleTar());
  const noQuery = vrsRouteFor(db, 'AAL704', q(''));
  assert.equal(`${noQuery.origin.code}-${noQuery.destination.code}`, 'LAX-CLT');
  const zero = vrsRouteFor(db, 'AAL704', { lat: 0, lon: 0 });
  assert.equal(`${zero.origin.code}-${zero.destination.code}`, 'CLT-FRA', 'kontrola testu: 0,0 naozaj vyberá iný úsek');
  const overCalifornia = vrsRouteFor(db, 'AAL704', q('lat=34.00&lon=-117.00&trk=80'));
  assert.equal(`${overCalifornia.origin.code}-${overCalifornia.destination.code}`, 'LAX-CLT');
});

test('odpoveď s trasou z VRS: pri zablokovanom adsbdb neúplná (partial), inak s dopravcom a IATA číslom', () => {
  const db = buildVrsDb(sampleTar());
  const vrs = vrsRouteFor(db, 'SIA810');
  const LIMITED = Object.freeze({ limited: true });
  const limited = vrsRouteAnswer(vrs, LIMITED, { limited: true });
  assert.equal(limited.found, true);
  assert.equal(limited.partial, true, 'klient sa o dopravcu spýta znova');
  assert.equal(limited.destination.code, 'PKX');
  assert.equal(limited.airline, undefined);
  assert.equal(limited.limited, undefined, 'značka obmedzenia sa do odpovede nedostane');
  const adsbdb = { airline: 'Singapore Airlines', callsignIata: 'SQ810', origin: { code: 'XXX' }, destination: { code: 'YYY' } };
  const full = vrsRouteAnswer(vrs, adsbdb, { limited: false });
  assert.equal(full.partial, undefined);
  assert.equal(full.airline, 'Singapore Airlines');
  assert.equal(full.callsignIata, 'SQ810');
  assert.equal(full.origin.code, 'SIN', 'trasa z VRS má prednosť');
  assert.equal(full.routeSource, 'vrs');
  const unknown = vrsRouteAnswer(vrs, null);
  assert.equal(unknown.found, true);
  assert.equal(unknown.partial, undefined, 'adsbdb znak nepozná — to je konečná odpoveď');
});

/** Archív s n trasami a m letiskami (prejde poistkou na veľkosť). */
function bigTar(nRoutes, nAirports) {
  const ap = [];
  let airports = 'Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet\n';
  for (let i = 0; i < nAirports; i += 1) {
    const code = `Z${i.toString(36).toUpperCase().padStart(3, '0')}`;
    ap.push(code);
    airports += `${code},Letisko ${i},${code},,Mesto ${i},SK,${(i % 160) - 80},${(i % 340) - 170},100\n`;
  }
  const rows = ['Callsign,Code,Number,AirlineCode,AirportCodes'];
  for (let i = 0; i < nRoutes; i += 1) {
    const cs = `AA${String.fromCharCode(65 + Math.floor(i / 100000))}${i % 100000}`;
    rows.push(`${cs},${cs.slice(0, 3)},${i},${cs.slice(0, 3)},${ap[i % nAirports]}-${ap[(i * 7 + 1) % nAirports]}`);
  }
  return Buffer.concat([
    tarEntry('standing-data-main/routes/schema-01/A/AAA-all.csv', `${rows.join('\n')}\n`),
    tarEntry('standing-data-main/airports/schema-01/Z/Z0.csv', airports),
    Buffer.alloc(1024, 0),
  ]);
}

test('vlákno: zbalená databáza nájde to isté ako Map z hlavného vlákna; poškodený archív = chyba dát', async () => {
  const fromWorker = await parseVrsArchiveInWorker(zlib.gzipSync(sampleTar()));
  const direct = buildVrsDb(sampleTar());
  for (const [cs, codes] of direct.routes) assert.equal(fromWorker.routes.get(cs), codes, cs);
  for (const [code, airport] of direct.airports) assert.deepEqual(fromWorker.airports.get(code), airport, code);
  assert.equal(fromWorker.routes.size, direct.routes.size);
  assert.equal(fromWorker.airports.get('WSSS'), fromWorker.airports.get('WSSS'), 'to isté letisko = ten istý objekt (ako z Map)');
  for (const cs of ['AAL1', 'AAL13', 'AAL1305X', 'SIA81', 'SIA8100', 'ZZZ9', 'sia810', '']) assert.equal(fromWorker.routes.get(cs), direct.routes.get(cs), `chýbajúci ${cs}`);
  assert.equal(fromWorker.airports.get('ZZZZ'), undefined);
  for (const [cs, at] of [['SIA810', null], ['QTR1', { lat: 52, lon: -35 }], ['AAL1305', { lat: 46.31, lon: -109.07, trkDeg: 98 }], ['XXX1', null]]) {
    assert.deepEqual(vrsRouteFor(fromWorker, cs, at), vrsRouteFor(direct, cs, at), cs);
  }
  await assert.rejects(parseVrsArchiveInWorker(Buffer.from('toto nie je gzip')), (error) => error.code === 'VRS_PARSE');
});

test('denná obnova: spracovanie archívu nezastaví hlavné vlákno (API odpovedá ďalej)', async (t) => {
  const gz = zlib.gzipSync(bigTar(200_000, 2_000));
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  const logs = [];
  const vrs = createVrsRouteDb({
    log: (m) => logs.push(m),
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '"e2"' }, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) }),
  });
  // Časovač = „požiadavky na API" počas obnovy: koľko ich slučka vybavila, kým obnova bežala,
  // a najdlhšia medzera medzi nimi. Pri spracovaní v hlavnom vlákne (sťahovanie je tu okamžité,
  // všetko beží v mikroúlohách) nevybaví ani jednu, kým sa archív nespracuje.
  let last = performance.now();
  let maxDelayMs = 0;
  let ticks = 0;
  let ticksDuringRefresh = -1;
  const ticker = setInterval(() => { const t = performance.now(); ticks += 1; maxDelayMs = Math.max(maxDelayMs, t - last); last = t; }, 5);
  const result = await vrs.refresh();
  ticksDuringRefresh = ticks;
  await new Promise((resolve) => { setTimeout(resolve, 30); }); // tik oneskorený prípadným blokom sa ešte zapíše
  clearInterval(ticker);
  assert.equal(result, 'updated', logs.join('\n'));
  assert.equal(vrs.status().routes, 200_000);
  assert.equal(vrs.lookup('AAA12').origin.icao, 'Z00C');
  assert.ok(!logs.some((m) => /hlavnom vlákne/.test(m)), 'spracovalo vlákno, nie záloha');
  // Koľko by to isté stálo v hlavnom vlákne na tomto stroji (porovnávacia miera, nie pevný limit —
  // pri záťaži počas celej sady sa spomalí oboje; zbalená databáza sa prenesie bez kopírovania).
  const t0 = performance.now();
  assert.equal(buildVrsDb(zlib.gunzipSync(gz)).routes.size, 200_000);
  const inThreadMs = performance.now() - t0;
  t.diagnostic(`počas obnovy ${ticksDuringRefresh} tikov, najdlhšie čakanie ${maxDelayMs.toFixed(0)} ms; v hlavnom vlákne ${inThreadMs.toFixed(0)} ms`);
  assert.ok(ticksDuringRefresh >= 5, `slučka udalostí počas spracovania stála (${ticksDuringRefresh} tikov)`);
  assert.ok(maxDelayMs < inThreadMs / 2, `slučka udalostí stála ${maxDelayMs.toFixed(0)} ms, v hlavnom vlákne by stála ~${inThreadMs.toFixed(0)} ms`);
});

test('vlákno sa nedá spustiť → záloha v hlavnom vlákne; chyba dát zálohu nespúšťa', async () => {
  const gz = zlib.gzipSync(bigTar(1_200, 1_200));
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => gz });
  const logs = [];
  const broken = createVrsRouteDb({ fetchImpl, log: (m) => logs.push(m), parse: async () => { throw new Error('ERR_WORKER_INIT_FAILED'); } });
  assert.equal(await broken.refresh(), 'updated');
  assert.equal(broken.ready(), true);
  assert.ok(logs.some((m) => /vlákno zlyhalo.*hlavnom vlákne/.test(m)));
  let fallbacks = 0;
  const badData = createVrsRouteDb({
    fetchImpl,
    log: (m) => { if (/hlavnom vlákne/.test(m)) fallbacks += 1; },
    parse: async () => { throw Object.assign(new Error('incorrect header check'), { code: 'VRS_PARSE' }); },
  });
  assert.equal(await badData.refresh(), 'error');
  assert.equal(fallbacks, 0);
});

test('vlákno: hotový výsledok sa nezahodí, keď hlavné vlákno viselo dlhšie než časový limit', async () => {
  // 2026-10-16: služba po štarte visela 231 s. Prošlý časovač ide v slučke pred správou vlákna — databáza,
  // ktorú vlákno už poslalo, sa zahodila a archív sa spracoval znova v hlavnom vlákne (~3 s bloku navyše).
  const gz = zlib.gzipSync(sampleTar());
  const t0 = performance.now();
  await parseVrsArchiveInWorker(gz); // zahriatie a odhad, ako dlho vlákno na tomto stroji trvá
  const workerMs = performance.now() - t0;
  // Blok vo fáze check (setImmediate; rovnako kód na štarte modulu): ďalšia otáčka slučky začne fázou
  // časovačov, takže prošlý limit príde na rad skôr než správa vlákna. Overené na skutočnom archíve:
  // pôvodný kód zamietol pri bloku na štarte aj v setImmediate, pri bloku v časovači či I/O nie.
  const held = await new Promise((resolve) => {
    setImmediate(() => {
      const parsing = parseVrsArchiveInWorker(gz, { timeoutMs: 50 });
      const until = performance.now() + Math.max(1500, 5 * workerMs);
      while (performance.now() < until) { /* hlavné vlákno visí — vlákno medzitým skončí */ }
      resolve({ parsing });
    });
  });
  const db = await held.parsing;
  assert.equal(db.routes.get('SIA810'), 'WSSS-ZBAD');
  // Vlákno, ktoré naozaj nestihne, je časový limit (nie chyba dát a nie dôvod na hlavné vlákno).
  await assert.rejects(parseVrsArchiveInWorker(zlib.gzipSync(bigTar(30_000, 1_200)), { timeoutMs: 1 }), (error) => error.code === 'VRS_TIMEOUT');
});

test('časový limit vlákna ani štart služby archív v hlavnom vlákne nespracujú', async () => {
  const gz = zlib.gzipSync(bigTar(1_200, 1_200));
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => gz });
  const logs = [];
  const log = (m) => logs.push(m);
  // Časový limit: vlákno je pomalé, lebo stroj je vyťažený — hlavné vlákno by stálo ešte dlhšie.
  const slow = createVrsRouteDb({ fetchImpl, log, parse: async () => { throw Object.assign(new Error('vlákno VRS: časový limit'), { code: 'VRS_TIMEOUT' }); } });
  assert.equal(await slow.refresh(), 'error');
  assert.equal(slow.ready(), false);
  assert.ok(!logs.some((m) => /hlavnom vlákne/.test(m)), logs.join('\n'));
  // Štart: vlákno sa nedá spustiť — kópia z disku ani prvé stiahnutie sa v hlavnom vlákne nespracujú.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrs-nofallback-'));
  const cacheFile = path.join(dir, 'standing-data.tar.gz');
  fs.writeFileSync(cacheFile, gz);
  fs.writeFileSync(`${cacheFile}.json`, JSON.stringify({ at: Date.now(), etag: '"e4"' }));
  let parses = 0;
  const broken = createVrsRouteDb({ cacheFile, fetchImpl, log, parse: async () => { parses += 1; throw new Error('ERR_WORKER_INIT_FAILED'); } });
  logs.length = 0;
  await broken.start();
  broken.stop();
  assert.equal(parses, 2, 'disk aj stiahnutie skúsili vlákno');
  assert.equal(broken.ready(), false, 'pri štarte nič v hlavnom vlákne');
  assert.ok(!logs.some((m) => /hlavnom vlákne/.test(m)), logs.join('\n'));
  assert.ok(logs.some((m) => /kópia z disku sa nenačítala: ERR_WORKER_INIT_FAILED/.test(m)), 'zlyhanie disku je v logu');
  // Neskoršia obnova (hodinový časovač) už zálohu smie — radšej ~3 s raz za deň než trasy žiadne.
  assert.equal(await broken.refresh(), 'updated');
  assert.equal(broken.ready(), true);
  assert.ok(logs.some((m) => /vlákno zlyhalo.*hlavnom vlákne/.test(m)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('štart: kým sa databáza prvý raz načítava, je „pending" — odpoveď len z adsbdb je vtedy neúplná', async () => {
  const gz = zlib.gzipSync(bigTar(1_200, 1_200));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const vrs = createVrsRouteDb({
    fetchImpl: async () => { await gate; return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => gz }; },
    parse: async (buf) => buildVrsDb(zlib.gunzipSync(buf)),
  });
  assert.equal(vrs.pending(), false, 'pred štartom nič nečaká');
  const started = vrs.start();
  assert.equal(vrs.pending(), true);
  assert.equal(vrs.status().pending, true);
  // Handler /api/adsbdb/route: VRS ešte nemá → odpoveď z adsbdb aj „nenájdené" sú len dočasné.
  const adsbdb = { airline: 'Austrian Airlines', callsignIata: 'OS555', origin: { code: 'VIE' }, destination: { code: 'ZRH' } };
  assert.deepEqual(adsbdbRouteAnswer(adsbdb, { vrsPending: vrs.pending() }), { found: true, ...adsbdb, partial: true });
  assert.deepEqual(adsbdbRouteAnswer(null, { vrsPending: vrs.pending() }), { found: false, partial: true });
  release();
  await started;
  vrs.stop();
  assert.equal(vrs.ready(), true);
  assert.equal(vrs.pending(), false);
  assert.deepEqual(adsbdbRouteAnswer(adsbdb, { vrsPending: vrs.pending() }), { found: true, ...adsbdb }, 'VRS hotová a znak nepozná = konečné');
  assert.deepEqual(adsbdbRouteAnswer(null), { found: false });
  // Prvé načítanie zlyhalo (bez disku, sieť nedostupná): VRS nebude — odpovede adsbdb sú konečné ako predtým.
  const offline = createVrsRouteDb({ fetchImpl: async () => { throw new Error('offline'); } });
  await offline.start();
  offline.stop();
  assert.equal(offline.ready(), false);
  assert.equal(offline.pending(), false);
});

test('server /api/adsbdb/route: stav „pending" zistí spolu s hľadaním v VRS a odpoveď bez VRS dá cez adsbdbRouteAnswer', () => {
  const config = fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const handler = config.slice(config.indexOf("if (kind === 'route') {"), config.indexOf("if (kind === 'type') {"));
  assert.match(handler, /const vrs = _vrsRoutes \? _vrsRoutes\.lookup\(cs, hint\) : null;\s*const vrsPending = Boolean\(_vrsRoutes\?\.pending\(\)\);/);
  assert.match(handler, /return send\(200, adsbdbRouteAnswer\(data, \{ vrsPending \}\)\);/);
  assert.ok(handler.indexOf('vrsPending = ') < handler.indexOf("await lookup('route', cs)"), 'pred čakaním na adsbdb, nie po ňom');
  // Plnenie odhadov z Histórie počká, kým sa VRS načíta (predtým ho zaručovalo synchrónne načítanie).
  const seed = config.slice(config.indexOf('async function seedEstimatesFromHistory()'), config.indexOf('const store = _historyStoreForEstimates();'));
  assert.match(seed, /if \(_vrsRoutes\?\.pending\(\)\) return;/);
});

test('štart: kópia z disku sa načíta bez čakania hlavného vlákna, čerstvá kópia sieť nevolá', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrs-start-'));
  const cacheFile = path.join(dir, 'standing-data.tar.gz');
  fs.writeFileSync(cacheFile, zlib.gzipSync(bigTar(1_200, 1_200)));
  fs.writeFileSync(`${cacheFile}.json`, JSON.stringify({ at: Date.now(), etag: '"e3"' }));
  let fetched = 0;
  let loaded = 0;
  const vrs = createVrsRouteDb({ cacheFile, fetchImpl: async () => { fetched += 1; throw new Error('nemá volať'); }, onLoaded: () => { loaded += 1; } });
  const started = vrs.start();
  assert.equal(vrs.ready(), false, 'start() nečaká na spracovanie');
  await started;
  vrs.stop();
  assert.equal(vrs.ready(), true);
  assert.equal(loaded, 1);
  assert.equal(fetched, 0);
  assert.equal(vrs.lookup('AAA5').destination.icao, 'Z010', 'letisko č. 36 (5 × 7 + 1)');
  fs.rmSync(dir, { recursive: true, force: true });
});
