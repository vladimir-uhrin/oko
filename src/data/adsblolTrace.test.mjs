// src/data/adsblolTrace.test.mjs — spätný import stôp adsb.lol do histórie letov (2026-09-30).
// Vlastník: vládne lietadlá SR „aby sa ich aj spätne dalo trackovať". Testy SPRÁVANIA: stopa readsb
// sa prevedie verne (jednotky, príznaky, prenášané detaily), rozdelí na lety a zapíše tak, že
// let zachytený živým záznamom sa predĺži (nezdvojí), opakovaný import nič nepridá a počty sedia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globeHistoryUrl, shiftDay, traceToFlight, TRACE_SRC, utcDay } from './adsblolTrace.js';
import { LEG_GAP_S, POS_SRC, TRACE_LEG_GAP_S, openFlightHistory, splitLegs } from './flightHistoryStore.js';

const DAY0 = Date.UTC(2026, 8, 25) / 1000; // 2026-09-25 00:00 UTC
const det = (fields) => ({ type: 'adsb_icao', ...fields });
// [offset, lat, lon, alt, gs, track, flags, vr, details, source, geoAlt, geoVr, ias, roll]
const pt = (off, lat, lon, alt, { gs = 200, trk = 90, flags = 0, vr = 0, details = null, src = 'adsb_icao', geo = null, gvr = null, ias = null, roll = null } = {}) => [off, lat, lon, alt, gs, trk, flags, vr, details, src, geo, gvr, ias, roll];

/** Deň vládneho stroja: let BTS → X a po obrate 20 min späť (readsb označí druhý vzlet). */
function govDay() {
  return {
    icao: '505ABC',
    r: 'OM-TST',
    t: 'A319',
    desc: 'AIRBUS A-319',
    ownOp: 'Nejaký Prevádzkovateľ',
    year: '2010',
    timestamp: DAY0,
    trace: [
      pt(3600, 48.17, 17.21, 'ground', { gs: 5, flags: 2, details: det({ flight: 'SSG1    ', squawk: '1000', category: 'A3', ias: 0, ownOp: 'X' }) }),
      pt(3660, 48.18, 17.25, 3000, { gs: 150, vr: 2000, geo: 3100, gvr: 1900, ias: 160, roll: 2.5 }),
      pt(3720, 48.25, 17.40, 12000, { gs: 300, vr: 2500, flags: 4, details: det({ flight: 'SSG1    ', squawk: '1000', category: 'A3', tas: 320, mach: 0.5, nav_altitude_mcp: 36000 }) }),
      pt(3720.4, 48.25, 17.41, 12100), // tá istá sekunda — zahodí sa
      pt(7200, 50.90, 4.48, 'ground', { gs: 10 }),
      // druhý let po 20 min obrate, rovnaký volací znak, readsb príznak „nový úsek"
      pt(8400, 50.90, 4.49, 'ground', { gs: 5, flags: 2 }),
      pt(8460, 50.91, 4.52, 5000, { gs: 180, flags: 8, details: det({ flight: 'SSG1    ', squawk: '7700', category: 'A3' }) }),
      pt(12000, 48.17, 17.21, 'ground', { gs: 8 }),
      pt(12060, 'x', 17.2, 1000), // bez polohy — preskočí sa
    ],
  };
}

test('stopa readsb → body: čas, jednotky, zem, výška GNSS, zdroj polohy, prenášaný volací znak, doplnky bez prevádzkovateľa', () => {
  const flight = traceToFlight(govDay());
  assert.equal(flight.icao24, '505abc');
  assert.deepEqual([flight.reg, flight.acType, flight.acDesc], ['OM-TST', 'A319', 'AIRBUS A-319']);
  assert.equal(flight.points.length, 7, 'duplicitná sekunda a bod bez polohy vynechané');
  const [p0, p1, p2] = flight.points;
  assert.equal(p0.t, DAY0 + 3600);
  assert.equal(p0.gnd, 1);
  assert.equal(p0.alt, 0);
  assert.equal(p0.callsign, 'SSG1');
  assert.equal(p0.squawk, '1000');
  assert.equal(p0.cat, 4, 'A3 = OpenSky 4');
  assert.equal(p0.newLeg, true);
  assert.equal(p1.callsign, 'SSG1', 'volací znak sa prenáša na body bez detailov');
  assert.ok(Math.abs(p1.alt - 3000 * 0.3048) < 1e-9);
  assert.ok(Math.abs(p1.geoAlt - 3100 * 0.3048) < 1e-9);
  assert.ok(Math.abs(p1.gs - 150 * 0.514444) < 1e-9);
  assert.ok(Math.abs(p1.vr - 2000 * 0.00508) < 1e-9);
  assert.equal(p1.posSrc, POS_SRC.ADSB);
  assert.deepEqual(JSON.parse(p1.x), { geom_rate: 1900, ias: 160, roll: 2.5 }, 'rýchlosti bodu v doplnkoch');
  const x2 = JSON.parse(p2.x);
  assert.equal(x2.tas, 320);
  assert.equal(x2.nav_altitude_mcp, 36000);
  for (const p of flight.points) assert.doesNotMatch(String(p.x), /Prevádzkovateľ|ownOp/, 'majiteľ/prevádzkovateľ sa nikdy neuloží');
  // Príznak 8: výška je geometrická → poslúži aj ako geoAlt.
  const geoFlagged = flight.points.find((p) => p.t === DAY0 + 8460);
  assert.ok(Math.abs(geoFlagged.geoAlt - 5000 * 0.3048) < 1e-9);
  // Druhý vzlet (príznak 2): volací znak a squawk prvého letu sa neprenesú — do nových detailov neznáme.
  const secondTakeoff = flight.points.find((p) => p.t === DAY0 + 8400);
  assert.equal(secondTakeoff.callsign, '');
  assert.equal(secondTakeoff.squawk, null);
  assert.equal(geoFlagged.squawk, '7700');
});

test('neplatné stopy a adresy mimo ICAO sa neimportujú', () => {
  assert.equal(traceToFlight(null), null);
  assert.equal(traceToFlight({ icao: '~29905c', timestamp: DAY0, trace: [pt(0, 1, 2, 100)] }), null, 'TIS-B adresa nie je jednoznačná');
  assert.equal(traceToFlight({ icao: 'abc', timestamp: DAY0, trace: [] }), null);
  assert.equal(traceToFlight({ icao: 'abcdef', trace: [] }), null, 'bez času');
  assert.deepEqual(traceToFlight({ icao: 'abcdef', timestamp: DAY0, trace: [] }).points, []);
});

test('URL dňa a počítanie dní UTC', () => {
  assert.equal(globeHistoryUrl('505ABC', '2024-01-15'), 'https://adsb.lol/globe_history/2024/01/15/traces/bc/trace_full_505abc.json');
  assert.equal(globeHistoryUrl('xyz', '2024-01-15'), null);
  assert.equal(globeHistoryUrl('505abc', '2024-1-5'), null);
  assert.equal(utcDay(Date.UTC(2026, 8, 30, 23, 59)), '2026-09-30');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('rozdelenie na lety: nový vzlet, medzera, zmena volacieho znaku', () => {
  const flight = traceToFlight(govDay());
  // Stopa má za letu hodinovú dieru v pokrytí (3720 → 7200 s): pri stope delí príznak readsb, nie 30 min.
  assert.equal(splitLegs(flight.points).length, 4, 'pravidlo živého záznamu (30 min) by lety rozsekalo');
  const legs = splitLegs(flight.points, TRACE_LEG_GAP_S);
  assert.equal(legs.length, 2, 'dva lety (readsb príznak druhého vzletu), hoci obrat trval len 20 min');
  assert.equal(legs[0].callsign, 'SSG1');
  assert.equal(legs[0].firstT, DAY0 + 3600);
  assert.equal(legs[0].lastT, DAY0 + 7200);
  assert.equal(legs[1].callsign, 'SSG1', 'volací znak druhého letu z jeho vlastných detailov');
  assert.deepEqual(legs[1].squawks, ['7700']);
  assert.equal(legs[0].cat, 4);
  const byGap = splitLegs([{ t: 0, alt: 1, gs: 1, callsign: 'A' }, { t: LEG_GAP_S + 1, alt: 1, gs: 1, callsign: 'A' }]);
  assert.equal(byGap.length, 2);
  const byCallsign = splitLegs([{ t: 0, alt: 1, gs: 1, callsign: 'A' }, { t: 60, alt: 1, gs: 1, callsign: 'B' }]);
  assert.equal(byCallsign.length, 2);
});

test('import: dva lety, identita stroja, počty sedia s COUNT(*), opakovaný import nič nepridá', () => {
  const store = openFlightHistory(':memory:', { now: () => (DAY0 + 86_400) * 1000 });
  const r1 = store.importFlight(traceToFlight(govDay()), TRACE_SRC);
  assert.deepEqual(r1, { inserted: 7, legsInserted: 2, legsExtended: 0 });
  const flights = store.flightsOf('505abc');
  assert.equal(flights.length, 2, 'dva lety — obrat 20 min ich nezlial');
  assert.equal(flights[0].firstT, DAY0 + 8400, 'najnovší prvý');
  assert.equal(flights[1].registration, 'OM-TST');
  assert.equal(flights[1].typeCode, 'A319');
  assert.equal(flights[1].category, 4);
  assert.equal(flights[1].src, TRACE_SRC);
  assert.equal(flights[1].fixes, 4);
  assert.deepEqual(flights[1].first, { t: DAY0 + 3600, lat: 48.17, lon: 17.21, altM: 0, gnd: true });
  assert.deepEqual(flights[1].last, { t: DAY0 + 7200, lat: 50.9, lon: 4.48, altM: 0, gnd: true });
  assert.deepEqual(store.status().fixes, 7);
  assert.deepEqual(store.recount(), { fixes: 7, legs: 2 }, 'meta počítadlá = COUNT(*)');
  const again = store.importFlight(traceToFlight(govDay()), TRACE_SRC);
  assert.deepEqual(again, { inserted: 0, legsInserted: 0, legsExtended: 0 }, 'opakovaný import nič nepridá');
  assert.deepEqual(store.recount(), { fixes: 7, legs: 2 });
  assert.equal(store.flightsOf('505abc', { beforeS: DAY0 + 8000 }).length, 1, 'stránkovanie do minulosti');
  store.close();
});

test('import predĺži let, ktorý čiastočne zachytil živý záznam — nevznikne druhý', () => {
  const store = openFlightHistory(':memory:', { now: () => (DAY0 + 86_400) * 1000 });
  // Živý snímok OpenSky uprostred prvého letu (iná sekunda než body stopy).
  const t = DAY0 + 3700;
  store.recordOpenSkyBody(JSON.stringify({ time: t, states: [['505abc', 'SSG1', 'Slovakia', t, t, 17.3, 48.2, 9000, false, 250, 90, 5, null, 9100, '1000', false, 0, 4]] }));
  assert.equal(store.flightsOf('505abc').length, 1);
  const r = store.importFlight(traceToFlight(govDay()), TRACE_SRC);
  assert.equal(r.legsExtended, 1, 'prvý let sa napojil na živý');
  assert.equal(r.legsInserted, 1, 'druhý let je nový');
  const flights = store.flightsOf('505abc');
  assert.equal(flights.length, 2);
  const first = flights[1];
  assert.equal(first.src, 'opensky', 'živý let ostal, len sa predĺžil');
  assert.equal(first.firstT, DAY0 + 3600);
  assert.equal(first.lastT, DAY0 + 7200);
  assert.equal(first.fixes, 1 + 4);
  assert.equal(first.registration, 'OM-TST', 'identita doplnená zo stopy');
  assert.deepEqual(store.recount(), { fixes: 8, legs: 2 });
  store.close();
});
