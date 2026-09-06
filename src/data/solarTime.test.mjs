// src/data/solarTime.test.mjs
// Miestny čas a slnko pre kartu letiska (2026-09-05). Čisté funkcie, overené
// proti skutočným časom východu/západu s toleranciou 8 minút — presnejšie sa
// bez tabuľky časových pásiem a atmosférického modelu tvrdiť nedá.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_ALTITUDE_DEG,
  formatClock,
  formatOffset,
  localTimeSummary,
  longitudeOffsetHours,
  solarElevationDeg,
  solarPosition,
  sunTimes,
} from './solarTime.js';

const TOLERANCE_MIN = 8;

/** UTC minúty dňa z epochy. */
function utcMinutes(ms) {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

test('slnko: deklinácia a rovnica času v obratníkoch a rovnodennostiach', () => {
  const summer = solarPosition(Date.UTC(2026, 5, 21, 12));
  assert.ok(Math.abs(summer.declinationDeg - 23.44) < 0.2, `letný obrat ≈ +23,44°, dostal ${summer.declinationDeg}`);
  const winter = solarPosition(Date.UTC(2026, 11, 21, 12));
  assert.ok(Math.abs(winter.declinationDeg + 23.44) < 0.2, `zimný obrat ≈ −23,44°, dostal ${winter.declinationDeg}`);
  const equinox = solarPosition(Date.UTC(2026, 2, 20, 12));
  assert.ok(Math.abs(equinox.declinationDeg) < 0.5, 'jarná rovnodennosť ≈ 0°');
  // Rovnica času sa počas roka drží v pásme ±17 minút.
  for (const month of [0, 3, 6, 9]) {
    const { equationOfTimeMin } = solarPosition(Date.UTC(2026, month, 15, 12));
    assert.ok(Math.abs(equationOfTimeMin) < 17, `rovnica času mimo ±17 min v mesiaci ${month}`);
  }
});

test('slnko: výška nad obzorom — poludnie na rovníku v rovnodennosť je zenit, polnoc je hlboko pod obzorom', () => {
  assert.ok(solarElevationDeg(0, 0, Date.UTC(2026, 2, 20, 12, 7)) > 89, 'zenit nad rovníkom');
  assert.ok(solarElevationDeg(0, 0, Date.UTC(2026, 2, 21, 0, 7)) < -85, 'polnoc');
  assert.ok(solarElevationDeg(90, 0, Date.UTC(2026, 5, 21, 12)) > 20, 'polárny deň na severnom póle');
  assert.ok(solarElevationDeg(90, 0, Date.UTC(2026, 11, 21, 12)) < -20, 'polárna noc na severnom póle');
  assert.equal(solarElevationDeg(NaN, 0, Date.now()), null);
  assert.equal(solarElevationDeg(0, 0, NaN), null);
});

test('slnko: východ a západ sedia so skutočnosťou do 8 minút (Bratislava, Londýn, rovník)', () => {
  // Referenčné časy sú skutočné, prevedené do UTC.
  const cases = [
    // Bratislava 21. 6. 2026: 04:47 / 20:57 SELČ = 02:47 / 18:57 UTC
    { name: 'Bratislava jún', lat: 48.17, lon: 17.21, ms: Date.UTC(2026, 5, 21, 12), sunrise: 2 * 60 + 47, sunset: 18 * 60 + 57 },
    // Bratislava 21. 12. 2026: 07:34 / 15:57 SEČ = 06:34 / 14:57 UTC
    { name: 'Bratislava december', lat: 48.17, lon: 17.21, ms: Date.UTC(2026, 11, 21, 12), sunrise: 6 * 60 + 34, sunset: 14 * 60 + 57 },
    // Londýn 5. 9. 2026: 06:20 / 19:40 BST = 05:20 / 18:40 UTC
    { name: 'Londýn september', lat: 51.47, lon: -0.46, ms: Date.UTC(2026, 8, 5, 12), sunrise: 5 * 60 + 20, sunset: 18 * 60 + 40 },
  ];
  for (const c of cases) {
    const { sunriseMs, sunsetMs, polar } = sunTimes(c.lat, c.lon, c.ms);
    assert.equal(polar, null, c.name);
    assert.ok(Math.abs(utcMinutes(sunriseMs) - c.sunrise) <= TOLERANCE_MIN, `${c.name}: východ ${new Date(sunriseMs).toISOString()}`);
    assert.ok(Math.abs(utcMinutes(sunsetMs) - c.sunset) <= TOLERANCE_MIN, `${c.name}: západ ${new Date(sunsetMs).toISOString()}`);
  }
  // Na rovníku trvá deň zhruba 12 hodín po celý rok.
  const equator = sunTimes(0, 0, Date.UTC(2026, 2, 20, 12));
  const dayLengthMin = (equator.sunsetMs - equator.sunriseMs) / 60_000;
  assert.ok(Math.abs(dayLengthMin - 720) < 20, `deň na rovníku ≈ 12 h, dostal ${dayLengthMin} min`);
});

test('slnko: polárny deň a noc sú vlastný stav, nie chýbajúci údaj', () => {
  const summer = sunTimes(69.65, 18.96, Date.UTC(2026, 5, 21, 12)); // Tromsø
  assert.equal(summer.polar, 'day');
  assert.equal(summer.sunriseMs, null);
  const winter = sunTimes(69.65, 18.96, Date.UTC(2026, 11, 21, 12));
  assert.equal(winter.polar, 'night');
  assert.equal(winter.sunsetMs, null);
  assert.deepEqual(sunTimes(NaN, 0, Date.now()), { sunriseMs: null, sunsetMs: null, polar: null });
});

test('čas: posun z poludníka, formát hodín a UTC značka', () => {
  assert.equal(longitudeOffsetHours(17.21), 1, 'Bratislava ≈ UTC+1');
  assert.equal(longitudeOffsetHours(-74), -5, 'New York ≈ UTC−5');
  assert.equal(longitudeOffsetHours(151.2), 10, 'Sydney ≈ UTC+10');
  assert.equal(longitudeOffsetHours(0), 0);
  assert.equal(longitudeOffsetHours(NaN), null);
  assert.equal(formatOffset(0), 'UTC');
  assert.equal(formatOffset(2), 'UTC+2');
  assert.equal(formatOffset(-5), 'UTC−5');
  assert.equal(formatClock(Date.UTC(2026, 8, 5, 18, 2), 0), '18:02');
  assert.equal(formatClock(Date.UTC(2026, 8, 5, 18, 2), 1), '19:02');
  assert.equal(formatClock(Date.UTC(2026, 8, 5, 23, 30), 2), '01:30', 'prechod cez polnoc');
  assert.equal(formatClock(Date.UTC(2026, 8, 5, 1, 30), -3), '22:30', 'prechod späť cez polnoc');
  assert.equal(formatClock(NaN, 0), '');
});

test('čas: zhrnutie pre kartu — miestny odhad, UTC, východ/západ, deň/noc', () => {
  const noon = localTimeSummary(48.17, 17.21, Date.UTC(2026, 8, 5, 10, 0));
  assert.equal(noon.utcClock, '10:00');
  assert.equal(noon.localClock, '11:00');
  assert.equal(noon.offsetLabel, 'UTC+1');
  assert.equal(noon.isDay, true);
  // Pozor: hodiny sú v ODHADNUTOM pásme z poludníka (UTC+1), nie v letnom
  // čase (SELČ = UTC+2). Skutočný západ 19:25 SELČ sa tu ukáže ako 18:25 —
  // presne tá odchýlka, ktorú karta priznáva slovom „odhad".
  assert.match(noon.sunriseClock, /^0[4-6]:\d\d$/);
  assert.match(noon.sunsetClock, /^18:\d\d$/);
  assert.ok(noon.elevationDeg > 10);
  const night = localTimeSummary(48.17, 17.21, Date.UTC(2026, 8, 5, 23, 0));
  assert.equal(night.isDay, false);
  assert.ok(night.elevationDeg < DAY_ALTITUDE_DEG);
  const polar = localTimeSummary(69.65, 18.96, Date.UTC(2026, 11, 21, 12));
  assert.equal(polar.polar, 'night');
  assert.equal(polar.sunriseClock, '');
  assert.equal(localTimeSummary(NaN, 0, Date.now()), null);
});
