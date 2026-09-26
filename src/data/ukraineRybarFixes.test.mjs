// src/data/ukraineRybarFixes.test.mjs — opravy podľa vzorky Rybar (2026-09-26, vlastník):
// „tá modrá hmlistá to nie je Rybar" → „hmlovinu prerob na jasnejšiu, svetlejšiu s jasnými
// vymedzeniami približnými" (plochy zmeny ako vektor so zaoblenou hranou),
// „mal som tam aj kartičky s news a tie zmizli" (kartičky udalostí tesne za okrajom záberu).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { changeAreaPolygons, maskToGridRings, smoothRing } from './ukraineContactLine.js';
import { EDGE_CARD_PAD, EDGE_INSET_PX, NEAR_VIEW_FRACTION, clampAnchorToViewport, nudgeEdgeAnchor } from '../ukraineEventsLayer.js';
import { DEEPSTATE_STYLES } from '../ukraineDeepStateLayer.js';

test('maskToGridRings: štvorec s dierou = vonkajší prstenec + diera; samostatná plocha zvlášť', () => {
  const W = 6; const H = 5; const m = new Uint8Array(W * H);
  const set = (c, r) => { m[r * W + c] = 1; };
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) if (!(r === 1 && c === 1)) set(c, r);
  set(4, 4); set(5, 4);
  const rings = maskToGridRings(m, W, H);
  assert.equal(rings.length, 3);
  const keys = rings.map((r) => JSON.stringify([...r].sort((a, b) => a[0] - b[0] || a[1] - b[1])));
  assert.ok(keys.includes(JSON.stringify([[0, 0], [0, 3], [3, 0], [3, 3]])), 'vonkajší 3×3');
  assert.ok(keys.includes(JSON.stringify([[1, 1], [1, 2], [2, 1], [2, 2]])), 'diera');
  assert.ok(keys.includes(JSON.stringify([[4, 4], [4, 5], [6, 4], [6, 5]])), 'pás 2×1');
  assert.deepEqual(maskToGridRings(new Uint8Array(4), 2, 2), [], 'prázdna maska');
  // šachovnica: dve bunky len cez roh = dva prstence (sedlo sa rozpojí)
  const d = new Uint8Array([1, 0, 0, 1]);
  assert.equal(maskToGridRings(d, 2, 2).length, 2);
});

test('smoothRing: Chaikin zdvojnásobí body na iteráciu a ostane vo vnútri obalu', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const s2 = smoothRing(sq, 2);
  assert.equal(s2.length, 16);
  assert.ok(s2.every(([x, y]) => x > 0 - 1e-9 && x < 4 + 1e-9 && y > -1e-9 && y < 4 + 1e-9));
  assert.ok(!s2.some(([x, y]) => (x === 0 || x === 4) && (y === 0 || y === 4)), 'rohy zaoblené');
});

test('changeAreaPolygons: oslobodené (R) a obsadené (G) ako [lon,lat] polygóny s dierami; šum pod minCells preč', () => {
  const W = 5; const H = 4;
  const values = new Uint8Array(W * H); const ruValues = new Uint8Array(W * H);
  values[0] = 255; values[1] = 255; values[W] = 255; values[W + 1] = 255; // 2×2 oslobodené vľavo hore
  ruValues[3 * W + 4] = 255; // jedna bunka obsadená = šum
  const change = { bbox: { west: 37, north: 49 }, cellDeg: 0.01, width: W, height: H, values, ruValues };
  const p = changeAreaPolygons(change);
  assert.equal(p.lost.length, 1);
  assert.equal(p.gained.length, 0, 'jedna bunka < minCells 2');
  const ring = p.lost[0][0];
  assert.ok(ring.every(([lon, lat]) => lon >= 37 && lon <= 37.02 + 1e-9 && lat <= 49 && lat >= 48.98 - 1e-9), 'v obdĺžniku buniek');
  assert.equal(changeAreaPolygons(change, { minCells: 1 }).gained.length, 1);
  assert.deepEqual(changeAreaPolygons(null), { lost: [], gained: [] });
});

test('KARTA: zmena za 7 dní ako vektorové plochy so svetlou výplňou a jasnou hranou (nie rozmazaný raster)', () => {
  const k = DEEPSTATE_STYLES.karta.change;
  assert.equal(k.mode, 'vector');
  assert.ok(k.lostFill >= 0.4 && k.lostLine && k.gainedLine && k.lineWidth >= 2, 'svetlejšie a s hranou');
  assert.equal(DEEPSTATE_STYLES.default.change.mode, undefined, 'bežný štýl ostáva raster');
  const src = readFileSync(new URL('../ukraineDeepStateLayer.js', import.meta.url), 'utf8');
  assert.match(src, /if \(cfg\.mode === 'vector'\) \{\s*\/\/[^\n]*\n\s*const areas = changeAreaPolygons\(_change\);/);
  assert.match(src, /for \(const e of ds\.entities\.values\.filter\(\(x\) => String\(x\.id\)\.startsWith\(prefix\)\)\) ds\.entities\.remove\(e\);/, 'staré plochy preč pred novými');
});

test('kartičky pri okraji: kotva pritiahnutá k okraju, šípka k miestu, spod panelov k stredu s rezervou pre kartičku', () => {
  assert.ok(NEAR_VIEW_FRACTION > 0 && NEAR_VIEW_FRACTION <= 1);
  assert.deepEqual(clampAnchorToViewport(100, 200, 800, 600), { x: 100, y: 200, edge: false, angleDeg: 0 });
  const c = clampAnchorToViewport(-300, 300, 800, 600);
  assert.equal(c.x, EDGE_INSET_PX); assert.equal(c.y, 300); assert.equal(c.edge, true);
  assert.ok(Math.abs(Math.abs(c.angleDeg) - 180) < 1e-9, 'šípka doľava');
  const down = clampAnchorToViewport(400, 1500, 800, 600);
  assert.ok(Math.abs(down.angleDeg - 90) < 1e-9, 'šípka dole');
  // panel pozdĺž spodku (časová os) — kotva sa posunie nad neho aj s rezervou na kartičku
  const obstacles = [{ x: 0, y: 450, w: 800, h: 150 }];
  const n = nudgeEdgeAnchor(down, obstacles, 800, 600, { x: 400, y: 1500 });
  assert.ok(n && n.y < 450 - EDGE_CARD_PAD.y, `nad panelom s rezervou (${n?.y})`);
  assert.ok(Math.abs(n.angleDeg - 90) < 2, 'šípka stále dole k miestu');
  assert.equal(nudgeEdgeAnchor(down, [{ x: 0, y: 0, w: 800, h: 600 }], 800, 600, { x: 400, y: 1500 }), null, 'bez miesta null');
  const src = readFileSync(new URL('../ukraineEventsLayer.js', import.meta.url), 'utf8');
  assert.match(src, /_nearOnly = _lod === 'cards' \? eventsInView\(NEAR_VIEW_FRACTION\)\.filter\(\(ev\) => !inIds\.has\(ev\.id\)\) : \[\];/, 'okolie len pri kartách');
  assert.match(src, /const cardsIn = _lod === 'cards' \? pickCards\(_inView, \{ max: MAX_CARDS \}\) : \[\];/, 'najprv udalosti v zábere');
  assert.match(src, /inView: _inView\.length/, 'počet v zábere ostáva prísny');
  assert.match(src, /p\.c\.pin\.style\.visibility = p\.c\.kind === 'card' && !p\.edge \? 'visible' : 'hidden';/, 'bez miesta ani značka pri okraji');
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-ukr-pin\.is-edge \{[^}]*clip-path: polygon\(/);
});
