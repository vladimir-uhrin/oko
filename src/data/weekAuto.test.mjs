// Automatický súhrn týždňa: útoky z denných úloh (číslo rastie počas záchrany → najvyššie, deň = prvý), príspevok
// ДСНС k útoku (nie neskorší o inom útoku), zábery ArmyInform bez opakovania, háčik o obetiach, vstup pre scenáre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoWeekInput, dateWords, strikePost, weekClips, weekStrikes } from './weekAuto.js';
import { weekScenarios } from './weekVideo.js';
import { locateUkText } from './ukraineMedia.js';

const place = (en, sk, killed, extra = {}) => ({ en, sk, lat: en === 'Kramatorsk' ? 48.74 : 47.85, lon: en === 'Kramatorsk' ? 37.58 : 35.12, killed, sources: [{ name: 'BBC News' }, { name: 'Ukrinform' }], ...extra });
const days = [
  { day: '2026-10-08', model: { casualties: { places: [place('Kramatorsk', 'Kramatorsk', 30)] }, clips: [{ videoUrl: 'https://a/1.mp4', captionSk: 'Ukrajinské sily zničili ruský dron', url: 'https://armyinform/1' }] } },
  { day: '2026-10-09', model: { casualties: { places: [place('Kramatorsk', 'Kramatorsk', 2)] }, clips: [{ videoUrl: 'https://a/1.mp4', captionSk: 'Ukrajinské sily zničili ruský dron' }] } },
  { day: '2026-10-10', model: { casualties: { places: [place('Zaporizhzhia', 'Záporožie', 4)] }, clips: [{ videoUrl: 'https://a/2.mp4', captionSk: 'Ukrajinské sily zničili ruský radar', url: 'https://armyinform/2' }] } },
  { day: '2026-10-11', model: { casualties: { places: [place('Zaporizhzhia', 'Záporožie', 20, { children: 3 })] }, clips: [{ videoUrl: 'https://a/3.mp4', captionSk: 'Ukrajinské sily zničili ruský radar' }, { captionSk: 'Záchranári', aftermath: true }] } },
];

test('útoky týždňa: Záporožie 4 → 20 v dvoch dňoch = jeden útok 10. 10. s 20 obeťami; Kramatorsk 30 z 8. 10.', () => {
  const s = weekStrikes(days);
  assert.deepEqual(s.map((x) => [x.sk, x.killed, x.day]), [['Kramatorsk', 30, '2026-10-08'], ['Záporožie', 20, '2026-10-10']]);
  assert.equal(s[1].children, 3);
  assert.deepEqual(weekStrikes(days, { minKilled: 25 }).map((x) => x.sk), ['Kramatorsk']);
});

test('zábery ArmyInform: rôzne videá aj popisy, nie záber záchranárov', () => {
  assert.deepEqual(weekClips(days).map((c) => c.caption), ['Ukrajinské sily zničili ruský radar', 'Ukrajinské sily zničili ruský dron']);
});

test('príspevok ДСНС: s počtom obetí zo dňa útoku, nie neskorší o inom útoku ani zranení', () => {
  const t = (d) => Date.parse(d);
  const media = [
    { url: 'https://t.me/dsns_telegram/76989', text: '#Донеччина: 33 людей загинули, ще 18 поранені через російський удар по автобусу в Краматорську', photos: ['a', 'b', 'c', 'd'], publishedAt: t('2026-10-08T10:09:00Z') },
    { url: 'https://t.me/dsns_telegram/77068', text: 'На Донеччині через російський обстріл загинув чоловік! У Краматорську внаслідок влучання', photos: ['a', 'b', 'c', 'd', 'e', 'f'], publishedAt: t('2026-10-09T08:06:00Z') },
    { url: 'https://t.me/dsns_telegram/77137', text: '#Запоріжжя. 5 людей загинули, та ще 11 осіб травмовані внаслідок російського удару', photos: ['a', 'b', 'c', 'd'], publishedAt: t('2026-10-10T05:34:00Z') },
    { url: 'https://t.me/dsns_telegram/77201', text: 'До 17 людей зросла кількість загиблих внаслідок російського удару по Запоріжжю', photos: ['a', 'b', 'c'], publishedAt: t('2026-10-10T15:15:00Z') },
  ];
  assert.deepEqual(strikePost(media, { day: '2026-10-08', killed: 30, lat: 48.74, lon: 37.58 }, locateUkText), { post: 76989, photos: 4 });
  assert.deepEqual(strikePost(media, { day: '2026-10-10', killed: 20, lat: 47.85, lon: 35.12 }, locateUkText), { post: 77201, photos: 3 }, '17 mŕtvych sedí, 11 zranených nie');
  assert.equal(strikePost(media, { day: '2026-09-01', killed: 20, lat: 47.85, lon: 35.12 }, locateUkText), null);
});

test('vstup: háčik o súčte obetí nad fotkou ДСНС, vety s dátumom slovom, zdroje; scenáre sa poskladajú', () => {
  const strikes = weekStrikes(days).map((s, i) => ({ ...s, dsns: { post: 76989 + i, pick: [0, 1] } }));
  const input = autoWeekInput({ week: { from: '2026-10-05', to: '2026-10-11' }, strikes, clips: weekClips(days) });
  assert.equal(input.hook.caption, 'Najmenej 50 mŕtvych civilistov za jediný týždeň. Ruské útoky zasiahli Kramatorsk a Záporožie.');
  assert.match(input.hook.spoken, /^Najmenej päťdesiat mŕtvych/);
  assert.deepEqual(input.hook.card.lines, ['50 MŔTVYCH CIVILISTOV', 'ZA JEDINÝ TÝŽDEŇ']);
  assert.deepEqual(input.hookPhoto, { post: 76989, pick: 0, credit: 'Foto: ДСНС України · Telegram' });
  assert.equal(input.strikes[0].mapLine.caption, '8. októbra zaútočil ruský agresor na mesto Kramatorsk.');
  assert.equal(input.strikes[0].mapLine.spoken, 'Ôsmeho októbra zaútočil ruský agresor na mesto Kramatorsk.');
  assert.equal(input.strikes[1].photoLine.caption, 'Zahynulo najmenej 20 ľudí, z toho 3 deti. Na mieste zasahovali záchranári.');
  assert.ok(input.sources[0].startsWith('Obete: BBC News, Ukrinform'));
  const { a, b, post } = weekScenarios({ ...input, front: { change: null, clashes: 1437 }, clips: [{ file: 'x.mp4', caption: 'Ukrajinské sily zničili ruský radar' }], hookPhoto: { ...input.hookPhoto, file: 'h.jpg' },
    strikes: input.strikes.map((s) => ({ ...s, photos: ['p.jpg'] })) });
  assert.equal(a.lines[0].shot, 'clip:0');
  assert.deepEqual(b.lines.map((l) => l.id), ['portal'], 'bez zemetrasenia len záver');
  assert.ok(post.includes('Kramatorsk (8. 10.): zahynulo najmenej 30 ľudí pri ruskom útoku. Zdroje: BBC News, Ukrinform.'));
  assert.deepEqual(dateWords('2026-10-21'), { caption: '21. októbra', spoken: 'dvadsiateho prvého októbra' });
});

test('slabý týždeň (bez útoku s obeťami): neutrálny háčik nad mapou, nie číslo', () => {
  const input = autoWeekInput({ week: { from: '2026-10-05', to: '2026-10-11' }, strikes: [] });
  assert.equal(input.hook.caption, 'Týždeň na fronte a vo svete.');
  assert.equal(input.hookPhoto, null);
});
