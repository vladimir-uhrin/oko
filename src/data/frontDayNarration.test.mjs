// Komentár a text príspevku „Deň na fronte": háčik = najsilnejší fakt, agentúrny štýl, kritický a presný, bez emoji.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStory, frontDayHook, frontDayLines, frontDayPostText } from './frontDayNarration.js';

const base = () => ({
  day: '2026-10-05', report: { total: 177, publishedAt: Date.parse('2026-10-05T05:00:00Z'), url: 'https://armyinform.com.ua/h' }, avg7: 212,
  directions: [{ id: 'pokrovsk', attacks: 24 }, { id: 'kostiantynivka', attacks: 23 }],
  strikes: { guidedBombs: 120, kamikazeDrones: 4100, shellings: 3900 },
  change: { ruKm2: 3.3, uaKm2: 0, toGreyKm2: 0, spanDays: 1, directions: [{ id: 'huliaipole', ruKm2: 3.3, uaKm2: 0 }] },
  air: { count: 18, kinds: ['missiles', 'drones', 'bombs'] },
  clips: [{ captionSk: 'Ukrajinské sily zničili ruskú samohybnú húfnicu', direction: 'huliaipole', url: 'https://armyinform.com.ua/c1' }],
});
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;

test('háčik: veľká mapa > nočná hrozba > malá mapa > strety', () => {
  const m = base();
  assert.equal(dayStory(m), 'air', '3 km² ustúpi 18 oblastiam pod hrozbou');
  assert.equal(dayStory({ ...m, change: { ...m.change, ruKm2: 14 } }), 'ru', '14 km² je silnejšie');
  assert.equal(dayStory({ ...m, air: { count: 4, kinds: [] } }), 'ru', 'bez veľkej hrozby stačí 3 km²');
  assert.equal(dayStory({ ...m, change: { ...m.change, ruKm2: 0, uaKm2: 12 } }), 'ua');
  assert.equal(dayStory({ ...m, change: null, air: null }), 'clashes');
});

test('vety: prvá = háčik, strety s porovnaním, smer, záber, údery, záver; titulok a hlas sa líšia len zápisom čísel', () => {
  const lines = frontDayLines({ ...base(), change: { ...base().change, ruKm2: 14, directions: [{ id: 'huliaipole', ruKm2: 14, uaKm2: 0 }] } });
  assert.deepEqual(lines.map(l => l.id), ['hook', 'clashes', 'top', 'clip0', 'change', 'air', 'strikes', 'portal']);
  assert.equal(lines[0].caption, 'Ruský agresor za uplynulý deň obsadil ďalších 14 km² Ukrajiny.');
  assert.equal(lines[0].spoken, 'Ruský agresor za uplynulý deň obsadil ďalších štrnásť kilometrov štvorcových Ukrajiny.');
  assert.match(lines[1].caption, /hlási za uplynulý deň 177 bojových stretov s ruskými okupačnými jednotkami\. To je menej ako v priemere za posledný týždeň\.$/);
  assert.equal(lines[2].caption, 'Najťažšie boje sú pri Pokrovsku, kde generálny štáb hlási 24 ruských útokov.');
  assert.equal(lines[2].shot, 'dir:pokrovsk');
  assert.equal(lines[3].caption, 'Na záberoch ministerstva obrany ukrajinské sily zničili ruskú samohybnú húfnicu pri Huliajpoli.');
  assert.equal(lines[3].shot, 'clip:0');
  assert.equal(lines[4].caption, 'Ruská okupácia sa rozšírila najmä pri Huliajpoli.');
  assert.match(lines[5].caption, /hrozbu ruských rakiet, dronov a riadených bômb pre 18 oblastí Ukrajiny\.$/, 'hrozba, nie potvrdený útok');
  assert.equal(lines[6].caption, 'Ruský agresor podľa hlásenia použil 4 100 dronov-kamikadze a 120 riadených leteckých bômb.');
  assert.equal(lines.at(-1).spoken, 'Počty stretov sú údaje jednej strany. Denný prehľad frontu na okolajv bodka es ká.');
  for (const l of lines) assert.ok(!EMOJI.test(l.caption + l.spoken), l.caption);
});

test('gramatika čísel: ďalší 1 / ďalšie 3 / ďalších 8 km²; dva dni odstupu sa povedia', () => {
  const at = (ruKm2, spanDays = 1) => frontDayLines({ ...base(), air: null, change: { ...base().change, ruKm2, spanDays } })[0].caption;
  assert.equal(at(3), 'Ruský agresor za uplynulý deň obsadil ďalšie 3 km² Ukrajiny.');
  assert.equal(at(8), 'Ruský agresor za uplynulý deň obsadil ďalších 8 km² Ukrajiny.');
  assert.equal(at(8, 2), 'Ruský agresor za posledné 2 dni obsadil ďalších 8 km² Ukrajiny.', 'zmena za dva dni sa nevydáva za dennú');
  assert.deepEqual(frontDayHook({ ...base(), air: null, change: { ...base().change, ruKm2: 3 } }).lines, ['RUSKÝ AGRESOR OBSADIL', 'ĎALŠIE 3 km²']);
});

test('text príspevku pre Facebook: háčik v prvom riadku, hlásenie za 24 h, zdroje, mapa, bez emoji a vyzývania', () => {
  const text = frontDayPostText(base());
  const [first] = text.split('\n');
  assert.ok(first.startsWith('V noci Vzdušné sily Ukrajiny hlásili hrozbu') && first.includes('nie o potvrdené zásahy'));
  assert.ok(first.length <= 160, `prvý riadok ${first.length} znakov`);
  assert.equal(text.match(/V noci Vzdušné sily/g).length, 1, 'odsek o noci sa neopakuje');
  assert.match(text, /v rannom hlásení 5\. 10\. 2026 uvádza za uplynulých 24 hodín 177 bojových stretov/);
  assert.match(text, /Záber: Ukrajinské sily zničili ruskú samohybnú húfnicu pri Huliajpoli — ArmyInform, Ministerstvo obrany Ukrajiny \(CC BY 4\.0\): https:\/\/armyinform\.com\.ua\/c1/);
  assert.ok(text.includes('údaje jednej strany') && text.includes('https://okolive.sk/?front=front'));
  assert.ok(!EMOJI.test(text), 'bez emoji');
  assert.ok(!/zdieľaj|označ|lajkni|komentuj/i.test(text), 'bez vyzývania na reakcie (FB ho trestá)');
  assert.ok(!/DeepState/i.test(text), 'zdroj mapy = okolive.sk');
});
