// src/data/portInbound.test.mjs — lode na ceste do prístavu (2026-10-11, bod 2) + súvislá stopa (bod 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationMatchesPort, inboundToPort, locodesInText, normalizeDestinationText } from './shipServer/portInbound.js';
import { _resetPortInboundForTest, portInboundLines, portInboundSync } from './portInbound.js';
import { historyLineEndpoint, mergeVesselTrackTimed, olderTrackPoints } from './aisLiveVessels.js';

const NOW = Date.parse('2026-10-11T12:00:00Z');

test('cieľ z AIS vs. prístav: LOCODE aj „NL RTM", meno aj viacslovné, „A>B" berie B, „Port of" sa ignoruje', () => {
  assert.equal(normalizeDestinationText('WILMINGTON.NC.USA'), 'WILMINGTON NC USA');
  assert.deepEqual([...locodesInText('NL RTM VIA DE HAM')], ['NLRTM', 'DEHAM']);
  const rtm = { locode: 'NLRTM', name: 'Rotterdam', lat: 51.9, lon: 4.4 };
  assert.equal(destinationMatchesPort('NLRTM', rtm), true);
  assert.equal(destinationMatchesPort('NL RTM', rtm), true);
  assert.equal(destinationMatchesPort('ROTTERDAM', rtm), true);
  assert.equal(destinationMatchesPort('PORT OF ROTTERDAM', rtm), true);
  assert.equal(destinationMatchesPort('SG SIN>NL RTM', rtm), true, 'cieľ za >');
  assert.equal(destinationMatchesPort('NL RTM>DE HAM', rtm), false, 'Rotterdam je len medzizastávka');
  assert.equal(destinationMatchesPort('ROTTERDAM', { locode: 'NLAMS', name: 'Amsterdam' }), false);
  assert.equal(destinationMatchesPort('PORT SAID', { name: 'Port Said', locode: 'EGPSD' }), true);
  assert.equal(destinationMatchesPort('SAID', { name: 'Port Said', locode: 'EGPSD' }), true, '„PORT" sa neberie, SAID stačí');
  assert.equal(destinationMatchesPort('', rtm), false);
});

test('lode do prístavu: zoradené podľa ETA, stojace bez ETA, v prístave a staré vynechané', () => {
  const rows = [
    { mmsi: '111111111', name: 'A', lat: 51.0, lon: 2.0, speed: 12, destination: 'NLRTM', last_position_epoch: NOW / 1000 - 60, type: '70' },
    { mmsi: '222222222', name: 'B', lat: 50.0, lon: 0.0, speed: 20, destination: 'ROTTERDAM', last_position_epoch: NOW / 1000 - 60 },
    { mmsi: '333333333', name: 'C', lat: 51.5, lon: 3.5, speed: 0.2, destination: 'NL RTM', last_position_epoch: NOW / 1000 - 60 },
    { mmsi: '444444444', name: 'D', lat: 51.9, lon: 4.4, speed: 0, destination: 'NLRTM', last_position_epoch: NOW / 1000 - 60 },
    { mmsi: '777777777', name: 'H', lat: 51.95, lon: 4.2, speed: 0.1, destination: 'NLRTM', last_position_epoch: NOW / 1000 - 60 }, // stojí 14 km od stredu = pri móle
    { mmsi: '555555555', name: 'E', lat: 40, lon: 0, speed: 10, destination: 'NLRTM', last_position_epoch: NOW / 1000 - 8 * 3600 },
    { mmsi: '666666666', name: 'F', lat: 40, lon: 0, speed: 10, destination: 'DEHAM', last_position_epoch: NOW / 1000 - 60 },
    { mmsi: 'mt-1', name: 'G', lat: 40, lon: 0, speed: 10, destination: 'NLRTM', last_position_epoch: NOW / 1000 - 60 },
  ];
  const out = inboundToPort(rows, { locode: 'NLRTM', name: 'Rotterdam', lat: 51.9, lon: 4.4 }, { nowMs: NOW });
  assert.equal(out.count, 3);
  assert.equal(out.moving, 2);
  assert.deepEqual(out.ships.map((s) => s.name), ['A', 'B', 'C']);
  assert.ok(out.ships[0].etaMs > NOW && out.ships[0].etaMs < out.ships[1].etaMs);
  assert.equal(out.ships[2].etaMs, null);
  assert.deepEqual(inboundToPort(rows, { lat: NaN, lon: 1 }), { count: 0, moving: 0, ships: [] });
});

test('klient: jeden dopyt, potom z cache; riadky do karty', async () => {
  _resetPortInboundForTest();
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => ({ count: 2, moving: 1, ships: [{ mmsi: '111111111', name: 'A', distanceKm: 120, etaMs: NOW + 6 * 3600_000 }, { mmsi: '222222222', name: null, distanceKm: 300, etaMs: null }] }) }; };
  const port = { locode: 'NLRTM', name: 'Rotterdam', lat: 51.9, lon: 4.4 };
  let ready = 0;
  assert.equal(portInboundSync(port, () => { ready += 1; }, { nowMs: NOW, fetchImpl }), null);
  assert.equal(portInboundSync(port, () => { ready += 1; }, { nowMs: NOW, fetchImpl }), null, 'počas dopytu nič nové');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ready, 2);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/api\/ais-live\/inbound\?lat=51\.9000&lon=4\.4000&locode=NLRTM&name=Rotterdam/);
  const data = portInboundSync(port, null, { nowMs: NOW + 1000, fetchImpl });
  assert.equal(data.count, 2);
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
  assert.deepEqual(portInboundLines(data, t, { nowMs: NOW }), ['port.inbound.count{"n":2}', 'A · 120 km · port.inbound.eta{"eta":"6 h"}', 'MMSI 222222222 · 300 km · port.inbound.stopped']);
  assert.deepEqual(portInboundLines({ count: 0, ships: [] }, t), ['port.inbound.none']);
  _resetPortInboundForTest();
});

test('súvislá stopa: história z disku + register pred vlastným ringom, bez duplicít, zriedená; koniec čiary prístavov na stope', () => {
  const disk = [{ t: NOW / 1000 - 3 * 86400, lat: 50, lon: 0, sog: 10 }, { t: NOW / 1000 - 2 * 86400, lat: 50.5, lon: 0.5, sog: 11 }];
  const reg = [{ t: NOW - 2 * 86400_000, lat: 50.5, lon: 0.5, speedKn: 11 }, { t: NOW - 86400_000, lat: 51, lon: 1 }];
  const older = olderTrackPoints(reg, disk);
  assert.deepEqual(older.map((p) => [p.lat, p.lon]), [[50, 0], [50.5, 0.5], [51, 1]], 'rovnaký čas = jeden bod');
  const own = [{ lat: 51.2, lon: 1.2, t: NOW / 1000 - 3600 }, { lat: 51.3, lon: 1.3, t: NOW / 1000 }];
  const timed = mergeVesselTrackTimed(own, older);
  assert.deepEqual(timed.map((p) => p.t), [NOW / 1000 - 3 * 86400, NOW / 1000 - 2 * 86400, NOW / 1000 - 86400, NOW / 1000 - 3600, NOW / 1000]);
  const many = Array.from({ length: 5000 }, (_, i) => ({ lat: 50 + i * 0.001, lon: 0, t: NOW - (5000 - i) * 60_000 }));
  const thinned = mergeVesselTrackTimed(own, many, 400);
  assert.equal(thinned.length, 400);
  assert.equal(thinned.at(-1).t, NOW / 1000, 'najnovšie ostanú presné');
  const calls = [{ name: 'Rotterdam', lat: 51.9, lon: 4.4 }, { name: 'Dover', lat: 50.01, lon: 0.01 }];
  assert.deepEqual(historyLineEndpoint(calls, timed, { lat: 9, lon: 9 }), { lat: 50, lon: 0 }, 'posledný prístav je pri začiatku stopy → čiara končí tam');
  assert.deepEqual(historyLineEndpoint([{ name: 'X', lat: 10, lon: 10 }], timed, { lat: 9, lon: 9 }), { lat: 9, lon: 9 }, 'prístav ďaleko od stopy → na lodi');
  assert.deepEqual(historyLineEndpoint(calls, own, { lat: 9, lon: 9 }), { lat: 9, lon: 9 }, 'krátka stopa → na lodi');
});
