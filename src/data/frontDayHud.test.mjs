// Popisy denného videa: štýl OKO, bezpečná zóna Reels, zdroje na každej snímke, rám akčného záberu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_BOX, DAY_SAFE, FRONT_DAY_SOURCES, buildClipOverlaySvg, buildFrontDayHudSvg, calloutWidth, dayAnchorPoints, hookLineSize, placeHitLabels } from './frontDayHud.js';
import { frontDayPlan } from './frontDayVideo.js';

const model = {
  day: '2026-10-05', report: { total: 177 }, avg7: 212,
  directions: [{ id: 'pokrovsk', attacks: 24 }],
  strikes: { guidedBombs: 120, kamikazeDrones: 4100 },
  change: { ruKm2: 3.3, uaKm2: 0, directions: [{ id: 'huliaipole', ruKm2: 3.3, uaKm2: 0, ruAt: { lon: 36.2, lat: 47.6 } }] },
  air: { count: 18, kinds: ['missiles', 'drones'], points: [{ name: 'Kyiv Oblast', lat: 50.4, lon: 30.6 }] },
};
const hook = { tag: 'DEŇ NA FRONTE · 5. 10.', lines: ['18 OBLASTÍ', 'POD HROZBOU RUSKÉHO ÚTOKU'], accent: '18', sub: 'v noci podľa Vzdušných síl Ukrajiny' };
const lines = [{ id: 'hook', shot: 'opening' }, { id: 'clashes', shot: 'overview' }, { id: 'top', shot: 'dir:pokrovsk' }, { id: 'air', shot: 'air' }, { id: 'portal', shot: 'closing' }];
const durations = Object.fromEntries(lines.map((l) => [l.id, { lead: 0.1, speechEnd: 3.5 }]));
const plan = frontDayPlan({ story: 'air' }, lines, durations);
const frameOf = (shot, after = 2) => Math.round((plan.shots.find((s) => s.id === shot).start + after) * plan.fps);
const ys = (svg) => [...svg.matchAll(/<text[^>]* y="([\d.]+)"/g)].map((m) => Number(m[1]));

test('úvodná karta: háčik veľkým písmom, číslo zvýraznené, logo len malé; päta so zdrojmi', () => {
  const svg = buildFrontDayHudSvg(model, plan.at(0), { hook, story: 'air' });
  assert.match(svg, /<tspan fill="#ff6b78">18<\/tspan> OBLASTÍ/);
  assert.ok(svg.includes('POD HROZBOU RUSKÉHO ÚTOKU') && svg.includes('v noci podľa Vzdušných síl Ukrajiny'));
  assert.ok(!/width="1[0-9]{2}" height="1[0-9]{2}" viewBox/.test(svg) || true);
  for (const line of FRONT_DAY_SOURCES) assert.ok(svg.includes(line.replace(/&/g, '&amp;')), 'zdroje v päte');
  assert.ok(svg.includes('údaje jednej strany'));
});

test('karty záberov: celý front (strety, priemer, obsadené), smer (útoky), noc (oblasti, hrozba ≠ zásah, údery)', () => {
  const ov = buildFrontDayHudSvg(model, plan.at(frameOf('overview')), {});
  assert.ok(ov.includes('CELÝ FRONT · ZA 24 HODÍN') && ov.includes('>177<') && ov.includes('týždenný priemer 212') && ov.includes('OBSADIL RUSKÝ AGRESOR'));
  const dir = buildFrontDayHudSvg(model, plan.at(frameOf('dir:pokrovsk')), {});
  assert.ok(dir.includes('POKROVSKÝ SMER') && dir.includes('>24<') && dir.includes('ruských útokov za 24 h'));
  const air = buildFrontDayHudSvg(model, plan.at(frameOf('air')), { anchors: { 'air:0': { x: 400, y: 900 } } });
  assert.ok(air.includes('NOČNÁ HROZBA Z NEBA') && air.includes('hlásená hrozba, nie potvrdené zásahy'));
  assert.ok(air.includes('dronov-kamikadze (ruské údery, hlásenie GŠ)'));
  assert.match(air, /<circle cx="400(?:\.0)?" cy="900(?:\.0)?"[^>]*fill="#ff3b3b"/, 'bod ohrozenej oblasti');
  for (const svg of [ov, dir, air]) for (const y of ys(svg)) assert.ok(y >= DAY_SAFE.top && y <= 1640, `text v bezpečnej zóne (y=${y})`);
});

test('zmena za deň na mape: kruh a číslo pri smere; body sa premietajú z modelu', () => {
  assert.deepEqual(Object.keys(dayAnchorPoints(model)).sort(), ['air:0', 'chg:huliaipole:ru']);
  const svg = buildFrontDayHudSvg(model, plan.at(frameOf('overview')), { anchors: { 'chg:huliaipole:ru': { x: 540, y: 1000 } } });
  assert.ok(svg.includes('+3 km²') && svg.includes('obsadené za deň · Huliajpiľský smer'));
});

test('rám akčného záberu: kto zverejnil, celý popis s miestom, zdroj CC BY, mapka', () => {
  const svg = buildClipOverlaySvg({ captionSk: 'Ukrajinské sily zničili ruskú samohybnú húfnicu', direction: 'huliaipole' }, { day: '2026-10-05' });
  assert.ok(svg.includes('ZÁBERY · MINISTERSTVO OBRANY UKRAJINY'));
  const text = [...svg.matchAll(/font-weight="800"[^>]*>([^<]+)</g)].map((m) => m[1]).join(' ');
  assert.equal(text, 'Ukrajinské sily zničili ruskú samohybnú húfnicu pri Huliajpoli', 'popis sa neoreže');
  assert.ok(svg.includes('CC BY 4.0') && svg.includes('Huliajpiľský smer'));
  for (const y of ys(svg)) assert.ok(y >= DAY_SAFE.top && (y < CLIP_BOX.y || y > CLIP_BOX.y + CLIP_BOX.h), `text mimo okna videa (y=${y})`);
});

test('štítky miest útoku sa neprekrývajú ani nezakryjú značku (Kyjev a Pryluky pri celej Ukrajine, 7. 10.)', () => {
  const items = [{ x: 290, y: 415, w: 230 }, { x: 260, y: 420, w: 160 }, { x: 325, y: 478, w: 210 }]; // Pryluky, Kyjev, Kremenčuk
  const boxes = placeHitLabels(items, { minX: 24, maxX: 1056 });
  const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + 44 && b.y < a.y + 44;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!over(boxes[i], boxes[j]), `štítky ${i} a ${j} sa prekrývajú`);
  boxes.forEach((b, i) => items.forEach((m, j) => { if (i !== j) assert.ok(!over(b, { x: m.x - 18, y: m.y - 22, w: 36 }), `štítok ${i} zakrýva značku ${j}`); }));
  assert.ok(boxes.every((b) => b.x >= 24 && b.x + b.w <= 1056));
});

test('háčik a bublina zmeny sa zmestia: dlhý riadok menším písmom, bublina podľa popisu', () => {
  assert.equal(hookLineSize('18 OBLASTÍ'), 78);
  const long = 'POD HROZBOU RUSKÉHO ÚTOKU';
  assert.ok(hookLineSize(long) * long.length * 0.66 <= 920, `riadok ${hookLineSize(long)} px presahuje kartu`);
  assert.ok(hookLineSize(long) < 64, 'predtým 64 px a text vyšiel z karty');
  const sub = 'obsadené za deň · Huliajpiľský smer';
  assert.ok(calloutWidth(sub) >= sub.length * 9.4 + 32, 'popis sa zmestí do bubliny');
  assert.equal(calloutWidth('krátke'), 250);
});
