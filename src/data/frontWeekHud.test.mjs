// src/data/frontWeekHud.test.mjs — popisy videa „Týždeň na fronte": zdroje na každej snímke, háčik so zdrojom,
// popisky „kde sa front pohol" len z týždenného porovnania a len na zmenenom území, karta smeru bez čísel,
// ktoré dáta nedávajú.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CAPTION_STYLE } from './eventCaptions.js';
import { FRONT_WEEK_SOURCES, LABEL_FLOOR_Y, buildFrontWeekHudSvg, changeCallouts, insetOccupiedRings, stackLabels, trendLabel } from './frontWeekHud.js';
import { frontWeekHook, frontWeekLines } from './frontWeekNarration.js';
import { FRONT_WEEK_VIDEO, frontWeekPlan } from './frontWeekVideo.js';

const N = ' ';
const series = (prev, week) => [...Array(7).fill(prev), ...Array(7).fill(week)].map((value, i) => ({ day: `d${i}`, value }));
const dirRow = (id, week, extra = {}) => ({
  id, week, prev: week, weekDays: 7, prevDays: 7, trend: 'flat', changePct: 0,
  ruKm2: 0, uaKm2: 0, toGreyKm2: 0, ruAt: null, uaAt: null, series: series(20, 24), ...extra,
});
const MODEL = {
  refDay: '2026-10-03', week: { from: '2026-09-27', to: '2026-10-03' }, prev: { from: '2026-09-20', to: '2026-09-26' },
  total: { week: 1494, prev: 1685, weekDays: 7, prevDays: 7, changePct: -11, trend: 'flat', series: series(240, 213) },
  change: { fromDay: '2026-09-25', toDay: '2026-10-02', spanDays: 7, weekly: true, ruKm2: 38.7, uaKm2: 36.4, toGreyKm2: 6.5, fromGreyKm2: 38.7 },
  directions: [
    dirRow('pokrovsk', 169, { ruKm2: 16.5, ruAt: { lon: 37.105, lat: 48.375 }, trend: 'up', changePct: 21 }),
    dirRow('kostiantynivka', 165),
    dirRow('vovchansk', 61),
    dirRow('lyman', 56, { uaKm2: 36.4, uaAt: { lon: 37.845, lat: 49.185 }, ruKm2: 0.8, ruAt: { lon: 37.945, lat: 49.245 } }),
    dirRow('huliaipole', 42, { ruKm2: 8.3, ruAt: { lon: 36.155, lat: 47.675 } }),
    dirRow('sloviansk-kramatorsk', 33, { ruKm2: 13.1, ruAt: { lon: 37.905, lat: 48.805 } }),
  ],
};
const LINES = frontWeekLines(MODEL);
const DUR = Object.fromEntries(LINES.map((l) => [l.id, { lead: 0.15, speechEnd: 0.15 + l.spoken.length / 12.7 }]));
const PLAN = frontWeekPlan(MODEL, LINES, DUR);
const HOOK = frontWeekHook(MODEL);
const shot = (id) => PLAN.shots.find((s) => s.id === id);
/** Stav snímky `sec` sekúnd po začiatku záberu. */
const at = (id, sec) => PLAN.at(Math.ceil((shot(id).start + sec) * PLAN.fps));
const OVERVIEW_ANCHORS = { 'lyman:ua': { x: 660, y: 515 }, 'pokrovsk:ru': { x: 600, y: 630 }, 'sloviansk-kramatorsk:ru': { x: 672, y: 568 }, 'huliaipole:ru': { x: 517, y: 724 } };
const count = (s, re) => (s.match(re) || []).length;

test('náhľad Ukrajiny: len ruské plochy, zriedené, bez drobností', () => {
  const big = Array.from({ length: 400 }, (_, i) => [36 + Math.cos((i / 400) * Math.PI * 2) * 1.23456, 48 + Math.sin((i / 400) * Math.PI * 2)]);
  const rings = insetOccupiedRings({ features: [
    { kind: 'occupied', type: 'Polygon', rings: [big] },
    { kind: 'occupied', type: 'Polygon', rings: [[[37, 48], [37.05, 48], [37.05, 48.05], [37, 48.05]]] },
    { kind: 'grey', type: 'Polygon', rings: [big] },
    { kind: 'liberated', type: 'Polygon', rings: [big] },
    { kind: 'occupied', type: 'LineString', rings: [big] },
  ] });
  assert.equal(rings.length, 1, 'sivá zóna, oslobodené, čiary a drobné plochy do náhľadu nejdú');
  assert.ok(rings[0].length <= 90 && rings[0].length >= 60, `bodov ${rings[0].length}`);
  for (const [x, y] of rings[0]) { assert.equal(x, Math.round(x * 100) / 100); assert.equal(y, Math.round(y * 100) / 100); }
  assert.deepEqual(insetOccupiedRings(null), []);
});

test('popisky v stĺpci: rozstup, poradie vstupu a medze', () => {
  assert.deepEqual(stackLabels([]), []);
  const ys = stackLabels([515, 630, 568, 724], { gap: 62, min: 262, max: 873 });
  const sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] >= 62 - 1e-9);
  assert.ok(ys[0] < ys[2] && ys[2] < ys[1] && ys[1] < ys[3], 'popisok ostáva pri svojom bode (poradie podľa výšky bodu)');
  // Body natlačené pri sebe: stĺpec sa rozostúpi okolo ich stredu, nie len nadol.
  const tight = stackLabels([500, 502, 504], { gap: 60, min: 0, max: 2000 });
  assert.deepEqual(tight.map((v) => Math.round(v)), [442, 502, 562]);
  // Medze: stĺpec sa posunie celý.
  const low = stackLabels([890, 900], { gap: 60, min: 250, max: 880 });
  assert.equal(Math.round(low[1]), 880);
  assert.equal(Math.round(low[0]), 820);
  assert.equal(Math.round(stackLabels([100], { min: 250 })[0]), 250);
});

test('popisy zmeny: od prahu, s bodom na území, od najväčšej, len z týždenného porovnania', () => {
  assert.deepEqual(changeCallouts(MODEL).map((c) => `${c.id}=${c.km2}`), ['lyman:ua=36.4', 'pokrovsk:ru=16.5', 'sloviansk-kramatorsk:ru=13.1', 'huliaipole:ru=8.3']);
  assert.deepEqual(changeCallouts(MODEL)[0], { id: 'lyman:ua', sceneId: 'lyman', side: 'ua', km2: 36.4, lon: 37.845, lat: 49.185 });
  assert.equal(changeCallouts(MODEL, { max: 2 }).length, 2);
  // Zmena bez bodu (model ho nedal) sa nekreslí — popis by nemal kam ukázať.
  const noAnchor = { ...MODEL, directions: [dirRow('pokrovsk', 169, { ruKm2: 16.5 })] };
  assert.deepEqual(changeCallouts(noAnchor), []);
  assert.deepEqual(changeCallouts({ ...MODEL, change: { ...MODEL.change, weekly: false } }), []);
  assert.deepEqual(changeCallouts({ ...MODEL, change: null }), []);
  assert.deepEqual(changeCallouts(null), []);
});

test('trend smeru slovom', () => {
  assert.equal(trendLabel({ trend: 'up', changePct: 21 }).text, `+21${N}% oproti minulému týždňu`);
  assert.equal(trendLabel({ trend: 'down', changePct: -30 }).text, `−30${N}% oproti minulému týždňu`);
  assert.equal(trendLabel({ trend: 'flat', changePct: 3 }).text, 'približne ako minulý týždeň');
  assert.equal(trendLabel({ trend: null, changePct: null }).text, 'bez porovnania');
  assert.equal(trendLabel(null).text, 'bez porovnania');
});

test('zdroje sú na každej snímke a SVG je uzavreté', () => {
  const frames = [at('opening', 1), at('overview', 3), at('dir:pokrovsk', 4), at('dir:lyman', 4), PLAN.at(PLAN.totalFrames - 1)];
  for (const fs of frames) {
    const svg = buildFrontWeekHudSvg(MODEL, fs, { hook: HOOK, anchors: OVERVIEW_ANCHORS, viewRect: [36.6, 47.9, 37.9, 48.7], mapDay: '2026-10-02' });
    assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), fs.shot.id);
    assert.equal(count(svg, /<g[ >]/g), count(svg, /<\/g>/g), `${fs.shot.id}: neuzavretá skupina`);
    assert.match(svg, /mapa frontu a výpočet zmeny územia: okolive\.sk/, fs.shot.id);
    assert.doesNotMatch(svg, /deep\s*state/i, fs.shot.id);
    assert.match(svg, /Generálny štáb Ukrajiny cez armyinform\.com\.ua \(údaje jednej strany\)/, fs.shot.id);
    assert.match(svg, /© OpenStreetMap/, fs.shot.id);
    assert.ok(svg.includes(`>${FRONT_WEEK_SOURCES}<`), fs.shot.id);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/, fs.shot.id);
  }
});

test('úvodná karta: háčik so zdrojom a adresou', () => {
  const svg = buildFrontWeekHudSvg(MODEL, at('opening', 1), { hook: HOOK });
  assert.match(svg, />TÝŽDEŇ NA FRONTE</);
  assert.match(svg, />Ruský agresor obsadil</);
  assert.ok(svg.includes(`>ďalších 39${N}km²<`));
  assert.ok(svg.includes(`>Ukrajina oslobodila 36${N}km²<`));
  assert.ok(svg.includes(`z porovnania dvoch snímok mapy frontu okolive.sk · 25.${N}9. – 2.${N}10. 2026`));
  assert.match(svg, />okolive\.sk</);
  // Hlavná vrstva (karta s číslami) ešte nie je.
  assert.doesNotMatch(svg, /CELÝ FRONT/);
  // Text háčika sa do SVG dostane bezpečne.
  const odd = buildFrontWeekHudSvg(MODEL, at('opening', 1), { hook: { tag: 'A&B', lines: ['<x>'], sub: null, source: 's' } });
  assert.match(odd, /A&amp;B/);
  assert.match(odd, /&lt;x&gt;/);
});

test('prehľad: čísla týždňa, poradie smerov a popisky kde sa front pohol', () => {
  const svg = buildFrontWeekHudSvg(MODEL, at('overview', 4), { hook: HOOK, anchors: OVERVIEW_ANCHORS, mapDay: '2026-10-02' });
  assert.ok(svg.includes(`>1${N}494<`));
  assert.match(svg, />BOJOVÝCH STRETOV</);
  assert.ok(svg.includes(`▼ −11${N}%`));
  assert.ok(svg.includes(`>+39${N}km²<`) && svg.includes('>RUSKO OBSADILO<'));
  assert.ok(svg.includes(`>+36${N}km²<`) && svg.includes('>UKRAJINA OSLOBODILA<'));
  assert.ok(svg.includes(`mapa: stav k 2.${N}10.${N}2026`));
  // Päť smerov podľa útokov, šiesty už nie.
  for (const t of ['POKROVSKÝ SMER', 'KOSŤANTYNIVSKÝ SMER', 'VOVČANSK', 'LYMANSKÝ SMER', 'HULIAJPIĽSKÝ SMER']) assert.ok(svg.includes(`>${t}<`), t);
  // Popisky zmeny: štyri, s menom smeru, číslom a stranou.
  assert.equal(count(svg, />Rusko obsadilo</g), 3);
  assert.equal(count(svg, />Ukrajina oslobodila</g), 1);
  assert.ok(svg.includes('>SLOVIANSK – KRAMATORSK<'), 'smer mimo prvej päťky útokov má popisok zmeny');
  assert.ok(svg.includes(`>+13${N}km²<`) && svg.includes(`>+8${N}km²<`) && svg.includes(`>+17${N}km²<`));
  // Náhľad Ukrajiny v prehľade nie je (mapa je prehľad sama).
  assert.doesNotMatch(svg, /fill="rgba\(255,255,255,0\.2\)"/);

  // Bez premietnutých bodov sa popisky nekreslia (čísla karty ostávajú).
  const plain = buildFrontWeekHudSvg(MODEL, at('overview', 4), { hook: HOOK });
  assert.equal(count(plain, />Ukrajina oslobodila</g), 0);
  assert.ok(plain.includes('>UKRAJINA OSLOBODILA<'));
  // Popisky nabiehajú postupne od najväčšej zmeny.
  const early = buildFrontWeekHudSvg(MODEL, at('overview', 0.8), { hook: HOOK, anchors: OVERVIEW_ANCHORS });
  assert.equal(count(early, />Ukrajina oslobodila</g), 1);
  assert.equal(count(early, />Rusko obsadilo</g), 0);
  // Bod mimo obrazu (pod kartou) popisok nedostane.
  const off = buildFrontWeekHudSvg(MODEL, at('overview', 4), { hook: HOOK, anchors: { ...OVERVIEW_ANCHORS, 'lyman:ua': { x: 660, y: 1100 } } });
  assert.equal(count(off, />Ukrajina oslobodila</g), 0);
});

test('smer: karta s útokmi a zmenou, kruh na zmenenom území, sused s menom', () => {
  const anchors = { 'pokrovsk:ru': { x: 446, y: 458 }, 'sloviansk-kramatorsk:ru': { x: 900, y: 240 }, 'lyman:ua': { x: 2000, y: -300 } };
  const fs = at('dir:pokrovsk', FRONT_WEEK_VIDEO.flyS + 1);
  const svg = buildFrontWeekHudSvg(MODEL, fs, { hook: HOOK, anchors, viewRect: [36.6, 47.9, 37.9, 48.7], mapDay: '2026-10-02' });
  assert.ok(svg.includes('>POKROVSKÝ SMER<'));
  assert.ok(svg.includes('>169<') && svg.includes('>ruských útokov za týždeň<'));
  assert.ok(svg.includes(`▲ +21${N}% oproti minulému týždňu`));
  assert.ok(svg.includes(`>RU +17${N}km²<`) && svg.includes('>ruská okupácia sa rozšírila<'));
  // Vlastná zmena smeru: „obsadené za týždeň"; zmena suseda v zábere nesie jeho meno; zmena mimo obrazu nič.
  assert.equal(count(svg, />obsadené za týždeň</g), 2, 'legenda + popis pri kruhu');
  assert.ok(svg.includes('>Sloviansk – Kramatorsk<'));
  assert.ok(svg.includes(`>+13${N}km²<`));
  assert.doesNotMatch(svg, />oslobodené za týždeň<.*>oslobodené za týždeň</s, 'Lyman je mimo záberu — len legenda');
  // Popis suseda neprekryje náhľad Ukrajiny vpravo hore: ide vľavo od kruhu.
  const m = /<rect x="([\d.]+)" y="([\d.]+)" width="236" height="62"[^>]*\/><text[^>]*>\+13/.exec(svg);
  assert.ok(m, 'popis suseda je nakreslený');
  assert.ok(Number(m[1]) + 236 <= 900 - 40, `popis vľavo od kruhu, x=${m[1]}`);
  // Náhľad s výrezom záberu.
  assert.match(svg, /fill="rgba\(255,255,255,0\.2\)"/);

  // Počas príletu kamery popisy zmeny ešte nie sú.
  const flying = buildFrontWeekHudSvg(MODEL, at('dir:pokrovsk', 0.5), { hook: HOOK, anchors });
  assert.equal(count(flying, />obsadené za týždeň</g), 1, 'len legenda');

  // Smer bez zmeny: „línia bez zmeny"; Lyman: Ukrajina späť.
  const kost = buildFrontWeekHudSvg(MODEL, at('dir:kostiantynivka', 3), { hook: HOOK, anchors: {} });
  assert.ok(kost.includes('>línia bez zmeny<'));
  assert.doesNotMatch(kost, />RU \+|>UA \+/);
  const lyman = buildFrontWeekHudSvg(MODEL, at('dir:lyman', 3), { hook: HOOK, anchors: { 'lyman:ua': { x: 555, y: 378 } } });
  assert.ok(lyman.includes(`>UA +36${N}km²<`) && lyman.includes('>Ukrajina oslobodila<'));
  assert.equal(count(lyman, />oslobodené za týždeň</g), 2);
});

test('popisky zmeny ostávajú nad pásom titulkov, aj keď bod zmeny leží nízko', () => {
  assert.ok(LABEL_FLOOR_Y < CAPTION_STYLE.bottomPx - 2 * CAPTION_STYLE.fontPx * 1.24 - 30, 'hranica je nad dvojriadkovým titulkom');
  // Smer: bod tesne nad kartou → popis vedľa kruhu by padol do titulkov, ide vyššie.
  const dir = buildFrontWeekHudSvg(MODEL, at('dir:pokrovsk', FRONT_WEEK_VIDEO.flyS + 1), { hook: HOOK, anchors: { 'pokrovsk:ru': { x: 500, y: 905 } } });
  const m = /<rect x="([\d.]+)" y="([\d.]+)" width="236" height="62"[^>]*\/><text[^>]*>\+17/.exec(dir);
  assert.ok(m, 'popis je nakreslený');
  assert.ok(Number(m[2]) + 62 <= LABEL_FLOOR_Y, `spodok popisu ${Number(m[2]) + 62}`);
  // Prehľad: body nízko pri karte → celý stĺpec popiskov sa posunie nad titulky.
  const low = { 'lyman:ua': { x: 660, y: 860 }, 'pokrovsk:ru': { x: 600, y: 900 }, 'sloviansk-kramatorsk:ru': { x: 672, y: 880 }, 'huliaipole:ru': { x: 517, y: 925 } };
  const overview = buildFrontWeekHudSvg(MODEL, at('overview', 4), { hook: HOOK, anchors: low });
  const boxes = [...overview.matchAll(/<rect x="\d+" y="([\d.]+)" width="292" height="54"/g)].map((x) => Number(x[1]));
  assert.equal(boxes.length, 4);
  for (const y of boxes) assert.ok(y + 54 <= LABEL_FLOOR_Y + 0.11, `spodok popisku ${y + 54}`);
});

test('bez týždenného porovnania popisy o území mlčia', () => {
  const m = { ...MODEL, change: { ...MODEL.change, spanDays: 10, weekly: false } };
  const lines = frontWeekLines(m);
  const plan = frontWeekPlan(m, lines, Object.fromEntries(lines.map((l) => [l.id, { lead: 0.1, speechEnd: 3 }])));
  const frame = (id, sec) => plan.at(Math.ceil((plan.shots.find((s) => s.id === id).start + sec) * plan.fps));
  const overview = buildFrontWeekHudSvg(m, frame('overview', 2), { hook: frontWeekHook(m), anchors: OVERVIEW_ANCHORS });
  assert.doesNotMatch(overview, /RUSKO OBSADILO|UKRAJINA OSLOBODILA|>Rusko obsadilo<|>Ukrajina oslobodila</);
  assert.ok(overview.includes(`>1${N}494<`));
  const dir = buildFrontWeekHudSvg(m, frame('dir:pokrovsk', 3), { hook: frontWeekHook(m), anchors: { 'pokrovsk:ru': { x: 446, y: 458 } } });
  assert.doesNotMatch(dir, />RU \+|línia bez zmeny|ruská okupácia/);
  assert.ok(dir.includes('>169<'));
});

test('koncová karta: značka a heslo, hlavná vrstva zmizne', () => {
  const svg = buildFrontWeekHudSvg(MODEL, PLAN.at(PLAN.totalFrames - 1), { hook: HOOK });
  assert.match(svg, /Lietadlá, lode a konflikty naživo v 3D/);
  assert.match(svg, /okolive\.sk/);
  assert.doesNotMatch(svg, /CELÝ FRONT|útokov za týždeň/);
});
