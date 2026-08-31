// OKO — FR24-štýl obohatenie karty letu: čistá matematika a formátovanie.
// Testy písané PRED implementáciou (pokyn používateľa) — vrátane chybových
// ciest: každá funkcia musí byť null-safe a nikdy nehodiť výnimku.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ETA_MIN_SPEED_MPS,
  formatEta,
  formatRouteLine,
  greatCircleKm,
  parseSquawk,
  PROGRESS_BAR_SEGMENTS,
  progressLine,
  routeProgress,
  squawkAlert,
  VERTICAL_TREND_THRESHOLD_MPS,
  verticalTrendGlyph,
} from './flightProgress.js';

test('greatCircleKm: známe dvojice, antimeridián, póly, degenerácie', () => {
  // Nulová vzdialenosť sama so sebou.
  assert.equal(greatCircleKm(48.1419, 17.1077, 48.1419, 17.1077), 0);
  // Viedeň (VIE) → Bratislava (BTS): ~48 km.
  const vieBts = greatCircleKm(48.1103, 16.5697, 48.1702, 17.2127);
  assert.ok(vieBts > 46 && vieBts < 51, `VIE→BTS ${vieBts}`);
  // Londýn (LHR) → New York (JFK): ~5540 km.
  const lhrJfk = greatCircleKm(51.47, -0.4543, 40.6413, -73.7781);
  assert.ok(lhrJfk > 5480 && lhrJfk < 5620, `LHR→JFK ${lhrJfk}`);
  // Cez antimeridián: Tokio (HND) → Los Angeles (LAX): ~8815 km, NIE ~31000.
  const hndLax = greatCircleKm(35.5533, 139.7811, 33.9416, -118.4085);
  assert.ok(hndLax > 8700 && hndLax < 8950, `HND→LAX ${hndLax}`);
  // Blízko pólu sa ide cez pól (~222 km), nie polovica obvodu Zeme.
  const polar = greatCircleKm(89, 0, 89, 180);
  assert.ok(polar > 200 && polar < 250, `pól ${polar}`);
  // Chybové cesty: nevalidný vstup → null, žiadna výnimka.
  assert.equal(greatCircleKm(NaN, 0, 0, 0), null);
  assert.equal(greatCircleKm(0, 0, undefined, 0), null);
  assert.equal(greatCircleKm(null, null, null, null), null);
});

test('routeProgress: frakcia, zostatok, ETA — a clamp pred/za trasou', () => {
  // Trasa po rovníku (0,0)→(0,10): total ~1113 km; poloha (0,6) = 60 %.
  const route = { origin: { lat: 0, lon: 0 }, destination: { lat: 0, lon: 10 } };
  const mid = routeProgress({ ...route, lat: 0, lon: 6, speedMps: 250 });
  assert.ok(mid, 'stred trasy musí byť vypočítateľný');
  assert.ok(Math.abs(mid.fractionDone - 0.6) < 0.01, `frakcia ${mid.fractionDone}`);
  assert.ok(Math.abs(mid.remainingKm - 445) < 5, `zostatok ${mid.remainingKm}`);
  assert.ok(Math.abs(mid.etaMinutes - 29.7) < 0.5, `ETA ${mid.etaMinutes}`);

  // Pred odletovým letiskom (zostatok > total) → 0 %, nie záporné číslo.
  const before = routeProgress({ ...route, lat: 0, lon: -2, speedMps: 250 });
  assert.equal(before.fractionDone, 0);

  // Za cieľom (nalietané > total) → clamp na 1.
  const past = routeProgress({ ...route, lat: 0, lon: 11, speedMps: 250 });
  assert.equal(past.fractionDone, 1);

  // Pomalé/nulové/nevalidné rýchlosti: frakcia áno, ETA nie — pod prahom
  // by ETA bola veštenie.
  assert.ok(ETA_MIN_SPEED_MPS > 0);
  for (const speedMps of [ETA_MIN_SPEED_MPS - 1, 0, -50, null, undefined, NaN]) {
    const slow = routeProgress({ ...route, lat: 0, lon: 6, speedMps });
    assert.ok(slow, `speed=${speedMps} nesmie zhodiť výpočet`);
    assert.equal(slow.etaMinutes, null, `speed=${speedMps} → ETA null`);
  }

  // Chybové cesty → null, žiadna výnimka.
  assert.equal(routeProgress(null), null);
  assert.equal(routeProgress({}), null);
  assert.equal(routeProgress({ origin: { lat: null, lon: 0 }, destination: { lat: 0, lon: 10 }, lat: 0, lon: 5, speedMps: 250 }), null);
  assert.equal(routeProgress({ origin: { lat: 0, lon: 0 }, destination: {}, lat: 0, lon: 5, speedMps: 250 }), null);
  assert.equal(routeProgress({ ...route, lat: NaN, lon: 5, speedMps: 250 }), null);
  // Degenerovaná „trasa" na jedno letisko (< 5 km) → null, delenie nulou nehrozí.
  assert.equal(routeProgress({
    origin: { lat: 48.17, lon: 17.21 },
    destination: { lat: 48.17, lon: 17.21 },
    lat: 48.17, lon: 17.21, speedMps: 250,
  }), null);
});

test('formatEta: H:MM formát, zaokrúhlenie s prenosom, chybové vstupy', () => {
  assert.equal(formatEta(29.69), '0:30');
  assert.equal(formatEta(84), '1:24');
  assert.equal(formatEta(0), '0:00');
  assert.equal(formatEta(60.4), '1:00');
  // 59.6 min sa zaokrúhli na 60 → musí preniesť na 1:00, nie 0:60.
  assert.equal(formatEta(59.6), '1:00');
  assert.equal(formatEta(605), '10:05');
  for (const bad of [null, undefined, NaN, -5, Infinity]) {
    assert.equal(formatEta(bad), '', `formatEta(${bad})`);
  }
});

test('progressLine: monochromatický bar z ▰▱ glyfov, bez emoji', () => {
  assert.equal(PROGRESS_BAR_SEGMENTS, 8);
  assert.equal(
    progressLine({ fractionDone: 0.6, remainingKm: 445, etaMinutes: 29.69 }),
    '▰▰▰▰▰▱▱▱ 60% · ETA 0:30',
  );
  assert.equal(progressLine({ fractionDone: 0, etaMinutes: null }), '▱▱▱▱▱▱▱▱ 0%');
  assert.equal(progressLine({ fractionDone: 1, etaMinutes: 5 }), '▰▰▰▰▰▰▰▰ 100% · ETA 0:05');
  // Bez ETA sa vynechá celý ETA segment — žiadne visiace oddeľovače.
  assert.equal(progressLine({ fractionDone: 0.5, etaMinutes: null }), '▰▰▰▰▱▱▱▱ 50%');
  // Chybové cesty → prázdny reťazec.
  assert.equal(progressLine(null), '');
  assert.equal(progressLine({}), '');
  assert.equal(progressLine({ fractionDone: NaN }), '');
  // Sanita štýlu: v riadku nesmie byť nič mimo povolenej glyfovej rodiny.
  const line = progressLine({ fractionDone: 0.37, etaMinutes: 123 });
  assert.match(line, /^[▰▱]{8} \d{1,3}% · ETA \d+:\d{2}$/);
});

test('formatRouteLine: kód + mesto, tvrdé skrátenie dlhých miest', () => {
  assert.equal(
    formatRouteLine({ origin: { code: 'VIE', name: 'Vienna' }, destination: { code: 'OTP', name: 'Bucharest' } }),
    'VIE Vienna → OTP Bucharest',
  );
  // Dlhé mesto sa tvrdo skráti na 14 znakov vrátane výpustky.
  const truncated = formatRouteLine({ origin: { code: 'FRA', name: 'Frankfurt am Main' }, destination: { code: 'BTS', name: 'Bratislava' } });
  assert.match(truncated, /^FRA .{1,14} → BTS Bratislava$/u);
  assert.ok(truncated.includes('…'), 'skrátenie končí výpustkou');
  assert.ok(!truncated.includes('Frankfurt am Main'), 'plné 17-znakové meno sa musí skrátiť');
  // Chýbajúce meno → len kód; chýbajúce oboje na jednej strane → kód/meno čo je.
  assert.equal(
    formatRouteLine({ origin: { code: 'VIE', name: '' }, destination: { code: 'OTP', name: 'Bucharest' } }),
    'VIE → OTP Bucharest',
  );
  // Chybové cesty → prázdny reťazec.
  assert.equal(formatRouteLine(null), '');
  assert.equal(formatRouteLine({}), '');
  assert.equal(formatRouteLine({ origin: {}, destination: {} }), '');
});

test('verticalTrendGlyph: ↑/↓ od prahu, ticho v hladine, chybové vstupy', () => {
  assert.equal(VERTICAL_TREND_THRESHOLD_MPS, 2.5);
  assert.equal(verticalTrendGlyph(3), '↑');
  assert.equal(verticalTrendGlyph(-3), '↓');
  assert.equal(verticalTrendGlyph(VERTICAL_TREND_THRESHOLD_MPS), '↑');
  assert.equal(verticalTrendGlyph(-VERTICAL_TREND_THRESHOLD_MPS), '↓');
  assert.equal(verticalTrendGlyph(2.4), '');
  assert.equal(verticalTrendGlyph(-1), '');
  assert.equal(verticalTrendGlyph(0), '');
  for (const bad of [null, undefined, NaN, 'x']) {
    assert.equal(verticalTrendGlyph(bad), '', `verticalTrendGlyph(${bad})`);
  }
});

test('parseSquawk + squawkAlert: normalizácia, oktalová validácia, núdzové kódy', () => {
  assert.equal(parseSquawk('7700'), '7700');
  assert.equal(parseSquawk(7700), '7700');
  assert.equal(parseSquawk('0754'), '0754');
  assert.equal(parseSquawk(754), '0754');
  assert.equal(parseSquawk(' 7000 '), '7000');
  // 8 a 9 v transpondéri neexistujú (oktal) — a smetie sa odmieta.
  for (const bad of ['7780', '1289', 'abcd', '', '12345', '12', null, undefined, NaN, {}, -1]) {
    assert.equal(parseSquawk(bad), null, `parseSquawk(${JSON.stringify(bad)})`);
  }
  assert.deepEqual(squawkAlert('7500'), { code: '7500', label: 'HIJACK' });
  assert.deepEqual(squawkAlert('7600'), { code: '7600', label: 'RADIO FAILURE' });
  assert.deepEqual(squawkAlert(7700), { code: '7700', label: 'EMERGENCY' });
  assert.equal(squawkAlert('7000'), null);
  assert.equal(squawkAlert('1200'), null);
  assert.equal(squawkAlert(null), null);
  assert.equal(squawkAlert('smetie'), null);
});
