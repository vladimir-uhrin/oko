// „Týždeň v OKU": háčik nad fotkou z miesta útoku, útoky s obeťami (mapa → fotky ДСНС), front za týždeň,
// zábery ArmyInform, svet okrajovo na reliéfe (trasa tankera, mapa otrasov), záver; text príspevku so zdrojmi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekScenarios } from './weekVideo.js';
import { spanWords } from './frontDayHud.js';

const input = () => ({
  week: { from: '2026-10-05', to: '2026-10-11' },
  hook: { spoken: 'Najmenej päťdesiattri mŕtvych civilistov za jediný týždeň.', caption: 'Najmenej 53 mŕtvych civilistov za jediný týždeň.', card: { lines: ['53 MŔTVYCH CIVILISTOV'], accent: '53' } },
  hookPhoto: { file: 'hacik.jpg', credit: 'Foto: ДСНС України · Telegram' },
  strikes: [{ id: 'kram', name: 'Kramatorsk', lat: 48.74, lon: 37.58, day: '2026-10-08', killed: 33, what: 'riadená bomba · dva autobusy',
    mapLine: { spoken: 'a', caption: 'a' }, photoLine: { spoken: 'b', caption: 'b' }, photos: ['k.jpg'], credit: 'Foto: ДСНС України · Telegram', sources: ['Meduza', 'NBC News'], postText: 'zahynulo najmenej 33 ľudí.' },
  { id: 'zap', name: 'Záporožie', lat: 47.84, lon: 35.14, day: '2026-10-10', killed: 20, children: 3, what: 'obytný dom',
    mapLine: { spoken: 'c', caption: 'c' }, photoLine: { spoken: 'd', caption: 'd' }, photos: ['z1.jpg', 'z2.jpg'], credit: 'Foto: ДСНС України · Telegram', sources: ['Ukrainska Pravda', 'ABC News'], postText: 'zahynulo 20 ľudí.' }],
  front: { change: { ruKm2: 32.9, uaKm2: 0, spanDays: 7, fromDay: '2026-10-03', toDay: '2026-10-10', directions: [{ id: 'pokrovsk', ruKm2: 8.2 }, { id: 'huliaipole', ruKm2: 12.1 }] }, clashes: 1437 },
  clips: [{ file: 'ai.mp4', caption: 'Ukrajinské sily zničili ruský radar' }],
  world: [{ id: 'tanker', line: { spoken: 't', caption: 't' }, spot: { tag: 'SVET', title: 'RUSKÁ NAFTA PRE USA' }, camera: { lon: -24, lat: 52, heightM: 1e7 },
    pins: [{ lon: 30.2, lat: 59.95, label: 'PETROHRAD' }], route: [{ lon: 30.2, lat: 59.95 }, { lon: -75.5, lat: 34.5 }], postText: 'Tanker.' },
  { id: 'panama', line: { spoken: 'p', caption: 'p' }, spot: { tag: 'SVET', value: 7.7, decimals: 1 }, camera: { lon: -80.8, lat: 8.5, heightM: 9e5 }, overlay: { file: 'v.png', bbox: [1, 2, 3, 4] } }],
  sources: ['Obete: Meduza'], musicCredit: 'Hudba: Kevin MacLeod', credits: ['Foto: https://t.me/dsns_telegram/76989'],
});

test('Ukrajina: háčik nad fotkou z miesta (nie mapa), útok = mapa s číslom → fotky, front za týždeň, strety, ArmyInform', () => {
  const { a } = weekScenarios(input());
  assert.deepEqual(a.lines.map((l) => l.id), ['hook', 'kram-map', 'kram-photo', 'zap-map', 'zap-photo', 'change', 'clashes', 'armyinform0']);
  assert.equal(a.lines[0].shot, 'clip:0', 'prvé sekundy = fotka');
  assert.equal(a.model.hookOverClip, true);
  assert.equal(a.media[0].keepCaptions, false, 'nad háčikom bez titulkov');
  assert.deepEqual([a.model.spots.kram.value, a.model.spots.kram.unit], [33, 'MŔTVYCH']);
  assert.match(a.model.spots.zap.rows[1], /z toho 3 deti/);
  assert.equal(a.lines.find((l) => l.id === 'change').caption, 'Na fronte ruský agresor za týždeň obsadil ďalších 33 kilometrov štvorcových, najviac pri Huliajpoli.');
  assert.equal(a.lines.find((l) => l.id === 'clashes').caption, 'Generálny štáb Ukrajiny hlási za týždeň 1 437 bojových stretov s ruskými okupantmi.');
  assert.equal(a.model.change.spanDays, 7, 'mapa zmeny za 7 dní');
  assert.equal(a.media.at(-1).credit, 'Ministerstvo obrany Ukrajiny · CC BY 4.0');
  assert.ok(!a.map, 'Ukrajina na mape KARTA');
  const noPhoto = weekScenarios({ ...input(), hookPhoto: null }).a;
  assert.equal(noPhoto.lines[0].shot, 'opening');
  assert.equal(noPhoto.model.hookOverClip, false);
});

test('svet okrajovo: reliéf, trasa tankera a mapa otrasov len vo svojom zábere, záver Týždeň v OKU, autor hudby', () => {
  const { b, post } = weekScenarios(input());
  assert.equal(b.map, 'aster-relief');
  assert.deepEqual(b.lines.map((l) => l.id), ['tanker', 'panama', 'portal']);
  assert.deepEqual(b.model.route, { points: [{ lon: 30.2, lat: 59.95 }, { lon: -75.5, lat: 34.5 }], shots: ['tanker'] });
  assert.deepEqual(b.overlay.shots, ['panama']);
  assert.equal(b.lines.at(-1).caption, 'Týždeň v OKU. Svet naživo na okolive.sk.');
  assert.equal(b.model.musicCredit, 'Hudba: Kevin MacLeod');
  assert.ok(post.startsWith('Najmenej 53 mŕtvych civilistov za jediný týždeň.'));
  assert.ok(post.includes('Kramatorsk (8. 10.): zahynulo najmenej 33 ľudí. Zdroje: Meduza, NBC News.'));
  assert.ok(post.includes('ďalších 33 km²') && post.includes('1 437 bojových stretov') && post.includes('Tanker.') && post.includes('https://okolive.sk/?front=front'));
});

test('obdobie zmeny mapy po slovensky: deň, týždeň, 3 dni, 10 dní', () => {
  assert.deepEqual([1, 7, 3, 10].map(spanWords), ['za deň', 'za týždeň', 'za 3 dni', 'za 10 dní']);
});
