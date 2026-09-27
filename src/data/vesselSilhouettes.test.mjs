// src/data/vesselSilhouettes.test.mjs — siluety lodí podľa uhla pohľadu (2026-09-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FAMILY_LENGTH_PX,
  SILHOUETTE_MAX_CAMERA_M,
  FAMILY_SIZE_M,
  VESSEL_HULL_PX,
  SILHOUETTE_VIEW,
  shipSilhouettesEnabled,
  silhouetteDataUrl,
  silhouetteSvg,
  vesselFamily,
  vesselViewAngles,
  vesselViewFor,
  vesselHullCapPx,
  vesselRealScale,
  vesselSizeM,
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
  const live = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  const hub = readFileSync(new URL('./aishubVessels.js', import.meta.url), 'utf8');
  assert.match(live, /shipSilhouettes: shipSilhouettesEnabled\(\),/);
  assert.match(live, /if \(Number\.isFinite\(record\.realScale\)\) return record\.realScale;/, 'skutočná veľkosť v jednom mieste (shipScale)');
  assert.match(hub, /return Number\.isFinite\(entry\.realScale\) \? entry\.realScale : hullScaleFor\(entry\.row\.sog\);/);
  assert.doesNotMatch(live + hub, /scaleByDistance/, 'veľkosť dáva skutočná dĺžka, nie krivka podľa vzdialenosti');
  assert.match(live, /if \(state\.shipSilhouettes && view && view\.kind !== 'top'\) \{\s*return silhouetteDataUrl\(vesselFamily\(record\.type\)/);
  assert.match(live, /bb\.verticalOrigin = top \? Cesium\.VerticalOrigin\.CENTER : Cesium\.VerticalOrigin\.BOTTOM;/);
  assert.match(live, /if \(visible && scene && \(doRotations \|\| record\.realScale === undefined\) && applyVesselView\(record, camView\)\) \{/, 'natočenie len pre ikonu zhora; nová loď dostane veľkosť hneď');
  assert.match(hub, /const _silhouettes = shipSilhouettesEnabled\(\);/);
  assert.match(hub, /entry\.billboard\.verticalOrigin = next \? Cesium\.VerticalOrigin\.BOTTOM : Cesium\.VerticalOrigin\.CENTER;/);
  assert.match(hub, /entry\.billboard\.image = iconFor\(entry, selected\);/, 'výber lode kreslí tú istú siluetu');
});

test('skutočná veľkosť: trup má na obrazovke svoju dĺžku v metroch, zďaleka aspoň 14 px (vlastník: „čo najrealistickejšie pri scrolovaní")', () => {
  const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
  const cam = { fovyRad: Math.PI / 3, viewportHeightPx: 860 };
  const pxPerM = 860 / (2 * 1000 * Math.tan(Math.PI / 6)); // ~0,745 px/m na 1 km
  // výletná loď 110 m z boku na 2 km: ~41 px trupu (pod stropom); obrázok má trup 112 px
  const px2 = (110 * pxPerM) / 2;
  const side = vesselRealScale({ kind: 'side', family: 'passenger', distanceM: 2000, ...cam });
  assert.ok(near(side, px2 / 112));
  // dvakrát ďalej = polovičná (bez stropu a podlahy)
  assert.ok(near(vesselRealScale({ kind: 'side', family: 'passenger', distanceM: 4000, ...cam }), side / 2));
  // AIS dĺžka má prednosť pred typickou
  assert.ok(vesselRealScale({ kind: 'side', family: 'passenger', lengthM: 135, distanceM: 2000, ...cam }) > side);
  // zďaleka podlaha 14 px (loď nezmizne)
  assert.ok(near(vesselRealScale({ kind: 'side', family: 'passenger', distanceM: 60_000, ...cam }), VESSEL_HULL_PX.min / 112));
  // zblízka STROP (vlastník: „zblízka nemusia byť veľké"): 110 m loď najviac 72 px, remorkér ~34 px
  assert.deepEqual(VESSEL_HULL_PX, { min: 14, cap: 72, capMin: 26, capMax: 90 });
  assert.ok(near(vesselRealScale({ kind: 'side', family: 'passenger', distanceM: 5, ...cam }), 72 / 112));
  assert.ok(near(vesselHullCapPx(25), 72 * Math.sqrt(25 / 110)));
  assert.ok(near(vesselRealScale({ kind: 'side', family: 'tug', distanceM: 5, ...cam }), vesselHullCapPx(25) / FAMILY_LENGTH_PX.tug));
  assert.equal(vesselHullCapPx(400), 90);
  assert.equal(vesselHullCapPx(5), 26);
  // ikona zhora: trup 28 px v obrázku; remorkér menší ako výletná loď
  assert.ok(near(vesselRealScale({ kind: 'top', family: 'passenger', distanceM: 2000, ...cam }), px2 / 28));
  assert.ok(vesselRealScale({ kind: 'top', family: 'tug', distanceM: 1000, ...cam }) < vesselRealScale({ kind: 'top', family: 'passenger', distanceM: 1000, ...cam }));
  // spredu: šírka trupu
  assert.ok(near(vesselRealScale({ kind: 'end', family: 'passenger', distanceM: 1000, ...cam }), (11.4 * pxPerM) / 20));
  // nezmysly = null (vrstva nechá doterajšiu veľkosť)
  assert.equal(vesselRealScale({ kind: 'side', family: 'cargo', distanceM: 0, ...cam }), null);
  assert.equal(vesselRealScale({ kind: 'side', family: 'cargo', distanceM: 100, fovyRad: 0, viewportHeightPx: 860 }), null);
  // rozmery: AIS v rozumnom rozsahu, inak typické pre rodinu
  assert.deepEqual(vesselSizeM('tug', 30, 9), { lengthM: 30, beamM: 9 });
  assert.deepEqual(vesselSizeM('tug', 0, null), { lengthM: FAMILY_SIZE_M.tug[0], beamM: FAMILY_SIZE_M.tug[1] });
  assert.equal(vesselSizeM('cargo', 1200).lengthM, FAMILY_SIZE_M.cargo[0], '1200 m je chyba AIS');
});

test('smer lode na zobrazenie: heading → v pohybe COG → stojaca pri rieke proti prúdu → COG (vlastník: „začni a poctivo")', async () => {
  const { vesselDisplayCourseDeg, MOORED_SPEED_KN } = await import('./vesselSilhouettes.js');
  const river = () => 270;
  assert.equal(MOORED_SPEED_KN, 0.5);
  assert.equal(vesselDisplayCourseDeg({ heading: 268, course: 173, speedKn: 0 }, river), 268, 'gyro heading platí aj v stoji');
  assert.equal(vesselDisplayCourseDeg({ heading: 511, course: 173, speedKn: 0 }, river), 270, '511 = nedostupné');
  assert.equal(vesselDisplayCourseDeg({ heading: null, course: 355.6, speedKn: 0 }, river), 270, 'COG stojacej lode je šum');
  assert.equal(vesselDisplayCourseDeg({ heading: null, course: 95, speedKn: 6 }, river), 95, 'v pohybe COG');
  assert.equal(vesselDisplayCourseDeg({ heading: null, course: 355.6, speedKn: 0 }, () => null), 355.6, 'mimo rieky ako doteraz');
  assert.equal(vesselDisplayCourseDeg({ heading: null, course: null, speedKn: 0 }, () => null), null);
  const live = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  const hub = readFileSync(new URL('./aishubVessels.js', import.meta.url), 'utf8');
  assert.match(live, /const direction = vesselDisplayCourseDeg\(\{[\s\S]*?\}, riverUpstreamBearing\);/);
  assert.match(hub, /const course = aishubDisplayCourseDeg\(row\);/);
  assert.match(live + hub, /void loadRiverIndex\(\);/);
});

test('rezerva hraníc pohľadu: pri uhle tesne na hranici loď nepreskakuje', async () => {
  const { VIEW_HYSTERESIS_DEG } = await import('./vesselSilhouettes.js');
  assert.equal(VIEW_HYSTERESIS_DEG, 3);
  const at = (e, rel = 90) => ({ elevationDeg: e, relAzimuthDeg: rel });
  // prvé zobrazenie: čisté hranice
  assert.equal(vesselViewKind(at(54)).kind, 'oblique');
  assert.equal(vesselViewKind(at(56)).kind, 'top');
  // zhora sa drží do 52°, šikmo sa stane zhora až od 58°
  assert.equal(vesselViewKind(at(53), SILHOUETTE_VIEW, 'top').kind, 'top');
  assert.equal(vesselViewKind(at(51), SILHOUETTE_VIEW, 'top').kind, 'oblique');
  assert.equal(vesselViewKind(at(57), SILHOUETTE_VIEW, 'oblique').kind, 'oblique');
  assert.equal(vesselViewKind(at(58.5), SILHOUETTE_VIEW, 'oblique').kind, 'top');
  // šikmo / z boku okolo 22°
  assert.equal(vesselViewKind(at(20), SILHOUETTE_VIEW, 'oblique').kind, 'oblique');
  assert.equal(vesselViewKind(at(18.5), SILHOUETTE_VIEW, 'oblique').kind, 'side');
  assert.equal(vesselViewKind(at(24), SILHOUETTE_VIEW, 'side').kind, 'side');
  assert.equal(vesselViewKind(at(25.5), SILHOUETTE_VIEW, 'side').kind, 'oblique');
  // kužeľ spredu 25° ± 3°
  assert.equal(vesselViewKind(at(10, 27), SILHOUETTE_VIEW, 'end').kind, 'end');
  assert.equal(vesselViewKind(at(10, 23), SILHOUETTE_VIEW, 'side').kind, 'side');
  assert.equal(vesselViewKind(at(10, 21), SILHOUETTE_VIEW, 'side').kind, 'end');
});

test('lode bok po boku: siluetu za bližšou loďou stlmiť, bližšia ostane navrchu; rohy zameriavača len pri hoveri', async () => {
  const { overlappedSilhouettes, silhouetteImageSize, DIM_OPACITY, OVERLAP_SHARE } = await import('./vesselSilhouettes.js');
  assert.equal(OVERLAP_SHARE, 0.35);
  const near = { key: 'near', x: 100, y: 100, w: 80, h: 24, distance: 400 };
  const far = { key: 'far', x: 110, y: 104, w: 80, h: 24, distance: 430 };
  const apart = { key: 'apart', x: 400, y: 100, w: 80, h: 24, distance: 450 };
  const graze = { key: 'graze', x: 170, y: 100, w: 80, h: 24, distance: 460 }; // prekryv 10 px z 80
  const dim = overlappedSilhouettes([far, apart, near, graze]);
  assert.deepEqual([...dim].sort(), ['far'], 'len loď z väčšej časti za bližšou');
  assert.equal(overlappedSilhouettes([]).size, 0);
  assert.deepEqual(silhouetteImageSize('passenger', 'side'), { width: FAMILY_LENGTH_PX.passenger + 16, height: 34 });
  assert.deepEqual(silhouetteImageSize('tug', 'end'), { width: 30, height: 34 });
  // stlmená silueta = krytie zapečené v obrázku (farbu billboardu drží fokus), vlastná cache
  const faded = silhouetteSvg('passenger', 'side', '#ff7adf', { dim: true }).svg;
  assert.match(faded, new RegExp(`opacity="${DIM_OPACITY}"`));
  assert.notEqual(silhouetteDataUrl('passenger', 'side', '#ff7adf', { dim: true }), silhouetteDataUrl('passenger', 'side', '#ff7adf', {}));
  assert.match(silhouetteSvg('tug', 'end', '#f7f0a3', { dim: true }).svg, /opacity=/);
  // detekcia: silueta bez rohov, kým na ňu nejde myš alebo nie je sledovaná; popisok ostáva
  const detection = readFileSync(new URL('./detection.js', import.meta.url), 'utf8');
  assert.match(detection, /const drawBracket = !obj\.quietBracket \|\| hovered \|\| isTracked;/);
  assert.match(detection, /if \(drawBracket\) appendCornerBracket\(pathFor\(bracketPaths, color, bracketAlpha\), sx, sy, halfW, halfH\);/);
  const live = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  const hub = readFileSync(new URL('./aishubVessels.js', import.meta.url), 'utf8');
  assert.match(live, /quietBracket: Boolean\(state\.shipSilhouettes && record\.view\),/);
  assert.match(hub, /object\.quietBracket = Boolean\(_silhouettes && entry\.view\);/);
  assert.match(live, /if \(doRotations && camView && scene && camera\) refreshSilhouetteOverlap\(scene, camera\);/);
});
