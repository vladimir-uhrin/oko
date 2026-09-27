// src/data/vesselSilhouettes.test.mjs — siluety lodí podľa uhla pohľadu (2026-09-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FAMILY_LENGTH_PX,
  SILHOUETTE_MAX_CAMERA_M,
  SILHOUETTE_SCALE_BY_DISTANCE,
  SILHOUETTE_VIEW,
  shipSilhouettesEnabled,
  silhouetteDataUrl,
  silhouetteSvg,
  vesselFamily,
  vesselViewAngles,
  vesselViewFor,
  vesselViewKind,
} from './vesselSilhouettes.js';

// ECEF bod na rovníku a nultom poludníku: hore = +x, východ = +y, sever = +z
const R = 6378137;
const ship = { x: R, y: 0, z: 0 };
const at = (up, east, north) => ({ x: R + up, y: east, z: north });

test('rodina lode z AIS typu (text aj číselný kód)', () => {
  assert.equal(vesselFamily('Passenger'), 'passenger');
  assert.equal(vesselFamily('60'), 'passenger');
  assert.equal(vesselFamily('70'), 'cargo');
  assert.equal(vesselFamily('Crude Oil Tanker'), 'tanker');
  assert.equal(vesselFamily('52'), 'tug', 'TUG');
  assert.equal(vesselFamily('Towing'), 'tug');
  assert.equal(vesselFamily('30'), 'fishing');
  assert.equal(vesselFamily('37'), 'pleasure');
  assert.equal(vesselFamily('36'), 'pleasure', 'SAILING');
  assert.equal(vesselFamily(''), 'generic');
  assert.equal(vesselFamily(null), 'generic');
});

test('uhly pohľadu: kamera nad loďou = 90°, pri hladine z boku ~0°; azimut voči kurzu', () => {
  const above = vesselViewAngles(ship, at(1000, 0, 0), 0);
  assert.ok(Math.abs(above.elevationDeg - 90) < 1e-6);
  const east = vesselViewAngles(ship, at(10, 1000, 0), 0); // loď na sever, kamera na východe
  assert.ok(east.elevationDeg > 0 && east.elevationDeg < 1);
  assert.ok(Math.abs(east.relAzimuthDeg - 90) < 1e-6);
  const ahead = vesselViewAngles(ship, at(10, 0, 1000), 0); // kamera pred prídou
  assert.ok(Math.abs(ahead.relAzimuthDeg) < 1e-6 || Math.abs(ahead.relAzimuthDeg - 360) < 1e-6);
  const west = vesselViewAngles(ship, at(10, 0, 1000), 90); // loď na východ, kamera na severe = ľavobok
  assert.ok(Math.abs(west.relAzimuthDeg - 270) < 1e-6);
  assert.equal(vesselViewAngles(null, ship, 0), null);
  assert.equal(vesselViewAngles(ship, ship, 0), null, 'kamera v lodi');
});

test('druh pohľadu: zhora / šikmo / z boku / spredu a strana prídi', () => {
  assert.deepEqual(SILHOUETTE_VIEW, { topDeg: 55, obliqueDeg: 22, endConeDeg: 25 });
  assert.equal(vesselViewKind({ elevationDeg: 70, relAzimuthDeg: 90 }).kind, 'top');
  assert.equal(vesselViewKind({ elevationDeg: 35, relAzimuthDeg: 90 }).kind, 'oblique');
  assert.equal(vesselViewKind({ elevationDeg: 8, relAzimuthDeg: 90 }).kind, 'side');
  assert.equal(vesselViewKind({ elevationDeg: 8, relAzimuthDeg: 5 }).kind, 'end', 'pred prídou');
  assert.equal(vesselViewKind({ elevationDeg: 8, relAzimuthDeg: 185 }).kind, 'end', 'za kormou');
  // pravobok (kamera vpravo od smeru plavby) → príď vpravo na obrazovke
  assert.equal(vesselViewKind({ elevationDeg: 8, relAzimuthDeg: 90 }).bowRight, true);
  assert.equal(vesselViewKind({ elevationDeg: 8, relAzimuthDeg: 270 }).bowRight, false);
  assert.equal(vesselViewKind(null).kind, 'top');
});

test('vysoká kamera (drobné lode) = vždy ikona zhora, bez výpočtu', () => {
  assert.equal(SILHOUETTE_MAX_CAMERA_M, 40_000);
  assert.equal(vesselViewFor(ship, { position: at(10, 1000, 0), height: 50_000 }, 0).kind, 'top');
  assert.equal(vesselViewFor(ship, { position: at(10, 1000, 0), height: 300 }, 0).kind, 'side');
  assert.equal(vesselViewFor(ship, null, 0).kind, 'top');
});

test('silueta: dĺžka podľa rodiny, zrkadlenie pri prídi vľavo, brázda len v pohybe, farba typu', () => {
  assert.ok(FAMILY_LENGTH_PX.passenger > FAMILY_LENGTH_PX.tug, 'výletná loď dlhšia ako remorkér');
  const side = silhouetteSvg('passenger', 'side', '#ff7adf', { bowRight: true, moving: true });
  assert.equal(side.width, FAMILY_LENGTH_PX.passenger + 16);
  assert.match(side.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(side.svg, /fill="#ff7adf"/);
  assert.match(side.svg, /stroke="#bfeaff"/, 'brázda');
  assert.doesNotMatch(silhouetteSvg('passenger', 'side', '#ff7adf', { moving: false }).svg, /#bfeaff/);
  assert.match(silhouetteSvg('cargo', 'side', '#39d5ff', { bowRight: false }).svg, /scale\(-1,1\)/);
  assert.doesNotMatch(silhouetteSvg('cargo', 'side', '#39d5ff', { bowRight: true }).svg, /scale\(-1,1\)/);
  assert.equal(silhouetteSvg('tug', 'end', '#f7f0a3').width, 30);
  assert.match(silhouetteSvg('tug', 'oblique', '#f7f0a3').svg, /scale\(1,0\.42\)/, 'šikmo: pás paluby zhora');
  for (const fam of Object.keys(FAMILY_LENGTH_PX)) {
    for (const kind of ['side', 'oblique', 'end']) assert.ok(silhouetteSvg(fam, kind, '#39d5ff').svg.endsWith('</svg>'), `${fam}/${kind}`);
  }
  const a = silhouetteDataUrl('tug', 'side', '#f7f0a3', { bowRight: true });
  assert.equal(silhouetteDataUrl('tug', 'side', '#f7f0a3', { bowRight: true }), a, 'cache');
  assert.match(a, /^data:image\/svg\+xml;base64,/);
});

test('návrat ku klasickým ikonám: ?lode=klasik alebo localStorage oko:lode=klasik', () => {
  assert.equal(shipSilhouettesEnabled({ search: '', storage: { getItem: () => null } }), true);
  assert.equal(shipSilhouettesEnabled({ search: '?lode=klasik', storage: { getItem: () => null } }), false);
  assert.equal(shipSilhouettesEnabled({ search: '?x=1&lode=klasik' }), false);
  assert.equal(shipSilhouettesEnabled({ search: '', storage: { getItem: (k) => (k === 'oko:lode' ? 'klasik' : null) } }), false);
  assert.equal(shipSilhouettesEnabled({ search: '?lode=siluety', storage: { getItem: () => 'klasik' } }), true, 'adresa má prednosť');
});

test('vrstvy: živé AIS aj AISHub kreslia siluety cez ten istý modul, silueta stojí na hladine', () => {
  assert.deepEqual(SILHOUETTE_SCALE_BY_DISTANCE, { near: 250, nearScale: 1.2, far: 8000, farScale: 0.5 });
  const live = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  const hub = readFileSync(new URL('./aishubVessels.js', import.meta.url), 'utf8');
  assert.match(live, /shipSilhouettes: shipSilhouettesEnabled\(\),/);
  assert.match(live, /if \(state\.shipSilhouettes && view && view\.kind !== 'top'\) \{\s*return silhouetteDataUrl\(vesselFamily\(record\.type\)/);
  assert.match(live, /bb\.verticalOrigin = top \? Cesium\.VerticalOrigin\.CENTER : Cesium\.VerticalOrigin\.BOTTOM;/);
  assert.match(live, /if \(visible && doRotations && scene && applyVesselView\(record, camView\)\) \{/, 'natočenie len pre ikonu zhora');
  assert.match(hub, /const _silhouettes = shipSilhouettesEnabled\(\);/);
  assert.match(hub, /entry\.billboard\.verticalOrigin = next \? Cesium\.VerticalOrigin\.BOTTOM : Cesium\.VerticalOrigin\.CENTER;/);
  assert.match(hub, /entry\.billboard\.image = iconFor\(entry, selected\);/, 'výber lode kreslí tú istú siluetu');
});
