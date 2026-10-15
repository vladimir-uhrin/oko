// Úvod pre nového návštevníka (2026-10-15): zemeguľa, na telefóne k Slnku, potom prelet nad oblasť z IP.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  START_VIEW, areaViewFor, bearingDegrees, offsetPoint, portraitSunView, showStartView, startViewFor, subsolarPoint,
} from './camera.js';
import { mobileShipsHidden, MOBILE_SHIP_FAR_HIDE_M } from './data/aisLiveVessels.js';

test('Slnko v zenite: rovnodennosť na poludnie UTC pri rovníku a nultom poludníku, jún na obratníku', () => {
  const eq = subsolarPoint(Date.UTC(2026, 2, 20, 12, 0));
  assert.ok(Math.abs(eq.lat) < 1.5 && Math.abs(eq.lon) < 0.5, JSON.stringify(eq));
  const june = subsolarPoint(Date.UTC(2026, 5, 21, 18, 0));
  assert.ok(Math.abs(june.lat - 23.44) < 0.5);
  assert.ok(Math.abs(june.lon - -90) < 0.5, 'o 18:00 UTC je Slnko nad 90° z. d.');
  const night = subsolarPoint(Date.UTC(2026, 9, 15, 21, 0));
  assert.ok(night.lon < -120 && night.lon > -140, 'o 21:00 UTC nad Pacifikom');
});

test('azimut a posun po guli', () => {
  assert.ok(Math.abs(bearingDegrees(48, 17, 60, 17) - 0) < 0.01, 'na sever');
  assert.ok(Math.abs(bearingDegrees(0, 0, 0, 10) - 90) < 0.01, 'na východ');
  const p = offsetPoint(48.7, 19.5, 180, 1000);
  assert.ok(Math.abs(p.lat - (48.7 - 1000 / 111.2)) < 0.1 && Math.abs(p.lon - 19.5) < 0.01);
});

test('telefón na výšku: kamera za Slovenskom pozerá k Slnku; počítač má šikmú zemeguľu', () => {
  const noonUtc = Date.UTC(2026, 9, 15, 11, 0);
  const v = portraitSunView(noonUtc);
  const sun = subsolarPoint(noonUtc);
  assert.ok(Math.abs(v.headingDeg - bearingDegrees(48.7, 19.5, sun.lat, sun.lon)) < 0.01);
  assert.ok(v.latitude > 48.7, 'na poludnie je Slnko na juhu → kamera severne od SK');
  const evening = portraitSunView(Date.UTC(2026, 9, 15, 17, 0));
  assert.ok(evening.headingDeg > 200 && evening.headingDeg < 300, `večer na západ (${evening.headingDeg})`);
  assert.equal(startViewFor(390, 844, noonUtc).headingDeg, v.headingDeg);
  assert.equal(startViewFor(1600, 900, noonUtc), START_VIEW);
});

test('pohľad nad oblasť: mesto zblízka, krajina zďaleka, bez polohy nič', () => {
  const city = areaViewFor({ precision: 'city', lat: 48.15, lon: 17.11 });
  assert.ok(city.heightM < 400_000 && city.latitude < 48.15 && city.headingDeg === 0);
  const country = areaViewFor({ precision: 'country', lat: 48.15, lon: 17.11 });
  assert.ok(country.heightM > city.heightM);
  assert.equal(areaViewFor({ precision: 'none' }), null);
  assert.equal(areaViewFor(null), null);
  assert.equal(areaViewFor({ precision: 'city', lat: NaN, lon: 17 }), null);
});

function fakeViewer() {
  const calls = { setView: 0, flyTo: [], cancel: 0 };
  const pos = { x: 1, y: 2, z: 3 };
  const camera = {
    positionWC: pos,
    setView() { calls.setView += 1; },
    flyTo(opts) { calls.flyTo.push(opts); opts.complete?.(); },
    cancelFlight() { calls.cancel += 1; },
  };
  return { viewer: { canvas: { clientWidth: 1600, clientHeight: 900 }, camera }, calls, pos };
}
function fakeWin() {
  const handlers = new Map();
  return { addEventListener: (t, fn) => handlers.set(t, fn), removeEventListener: (t) => handlers.delete(t), fire: (t) => handlers.get(t)?.(), handlers };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** Počkať, kým platí podmienka (pod záťažou celej sady 20 ms nestačí), najviac 3 s. */
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await tick(10);
}

test('úvod: zemeguľa hneď, po skrytí úvodnej obrazovky prelet nad oblasť a hláška', async () => {
  const { viewer, calls } = fakeViewer();
  const win = fakeWin();
  const arrived = [];
  showStartView(viewer, { whenReady: Promise.resolve(), dwellMs: 1, win, locate: async () => ({ precision: 'city', lat: 48.15, lon: 17.11, city: 'Bratislava' }), onArrive: (g) => arrived.push(g.city) });
  assert.equal(calls.setView, 1);
  await until(() => arrived.length > 0);
  assert.equal(calls.flyTo.length, 1);
  assert.deepEqual(arrived, ['Bratislava']);
  assert.equal(win.handlers.size, 0, 'po prílete sa poslucháči vstupu odstránia');
});

test('úvod: dotyk pred preletom ho zruší; bez polohy ostane zemeguľa', async () => {
  const a = fakeViewer();
  const w = fakeWin();
  let release;
  showStartView(a.viewer, { whenReady: new Promise((r) => { release = r; }), dwellMs: 1, win: w, locate: async () => ({ precision: 'city', lat: 1, lon: 2 }) });
  w.fire('pointerdown');
  release();
  await tick();
  assert.equal(a.calls.flyTo.length, 0, 'návštevník už ťukol');
  const b = fakeViewer();
  showStartView(b.viewer, { whenReady: Promise.resolve(), dwellMs: 1, win: fakeWin(), locate: async () => ({ precision: 'none' }) });
  await tick();
  assert.equal(b.calls.flyTo.length, 0);
  const c = fakeViewer();
  showStartView(c.viewer, { whenReady: Promise.resolve(), dwellMs: 1, win: fakeWin(), locate: async () => { throw new Error('sieť'); } });
  await tick();
  assert.equal(c.calls.flyTo.length, 0, 'chyba zistenia polohy nezhodí úvod');
});

test('telefón: lode z obežnej dráhy skryté, zblízka a na počítači nie', () => {
  assert.equal(mobileShipsHidden(true, MOBILE_SHIP_FAR_HIDE_M + 1), true);
  assert.equal(mobileShipsHidden(true, 500_000), false);
  assert.equal(mobileShipsHidden(false, 9_000_000), false);
  assert.equal(mobileShipsHidden(true, undefined), false);
});
