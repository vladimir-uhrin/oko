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
  assert.deepEqual(lines.map(l => l.id), ['hook', 'clashes', 'top', 'clip0', 'change', 'air', 'portal'], 'údery ustúpia nočnej hrozbe (ten istý záber)');
  assert.equal(lines[0].caption, 'Ruský agresor za uplynulý deň obsadil ďalších 14 km² Ukrajiny.');
  assert.equal(lines[0].spoken, 'Ruský agresor za uplynulý deň obsadil ďalších štrnásť kilometrov štvorcových Ukrajiny.');
  assert.match(lines[1].caption, /^Generálny štáb hlási 177\sbojových stretov, menej ako týždenný priemer\.$/);
  assert.match(lines[2].caption, /^Najťažšie boje sú pri Pokrovsku: 24\sruských útokov\.$/);
  assert.equal(lines[2].shot, 'dir:pokrovsk');
  assert.equal(lines[3].caption, 'Ukrajinské sily zničili ruskú samohybnú húfnicu pri Huliajpoli.');
  assert.equal(lines[3].shot, 'clip:0');
  assert.equal(lines[4].caption, 'Ruská okupácia sa rozšírila najmä pri Huliajpoli.');
  assert.match(lines[5].caption, /^V noci platila hrozba ruského útoku pre 18\soblastí\.$/, 'hrozba, nie potvrdený útok');
  const quiet = frontDayLines({ ...base(), air: { count: 3, kinds: [] } });
  assert.match(quiet.find(l => l.id === 'strikes').caption, /^Ruský agresor použil 4\s100\sdronov-kamikadze a 120\sriadených leteckých bômb\.$/);
  const airDay = frontDayLines(base());
  assert.match(airDay[0].caption, /^V noci platila hrozba ruského útoku pre 18\soblastí: rakety, drony a riadené bomby\.$/, 'háčik o noci s druhmi zbraní');
  assert.equal(lines.at(-1).spoken, 'Počty sú údaje jednej strany. Mapa frontu denne na okolajv bodka es ká.');
  for (const l of lines) assert.ok(!EMOJI.test(l.caption + l.spoken), l.caption);
  // Video 30–45 s: hlas vlastníka ~1,8 slova/s, s pauzami a zábermi → komentár do ~75 slov.
  const words = lines.reduce((n, l) => n + l.spoken.split(/\s+/).length, 0);
  assert.ok(words <= 75, `komentár má ${words} slov`);
  assert.ok(!lines.some(l => l.id !== 'strikes' && /bômb/.test(l.spoken)), 'hrozba bez „bômb" (rozpoznávanie reči píše „bomb")');
});

test('gramatika čísel: ďalší 1 / ďalšie 3 / ďalších 8 km²; dva dni odstupu sa povedia', () => {
  const at = (ruKm2, spanDays = 1) => frontDayLines({ ...base(), air: null, change: { ...base().change, ruKm2, spanDays } })[0].caption;
  assert.equal(at(3), 'Ruský agresor za uplynulý deň obsadil ďalšie 3 km² Ukrajiny.');
  assert.equal(at(8), 'Ruský agresor za uplynulý deň obsadil ďalších 8 km² Ukrajiny.');
  assert.equal(at(8, 2), 'Ruský agresor za posledné 2 dni obsadil ďalších 8 km² Ukrajiny.', 'zmena za dva dni sa nevydáva za dennú');
  assert.deepEqual(frontDayHook({ ...base(), air: null, change: { ...base().change, ruKm2: 3 } }).lines, ['RUSKÝ AGRESOR OBSADIL', 'ĎALŠIE 3 km²']);
});

test('útok s obeťami (7. 10.): háčik o obetiach, nie o hrozbe; miesta s deťmi a zraneniami; príspevok so zdrojmi', () => {
  const casualties = {
    total: { killed: 25, children: null, injured: 100, sources: [{ name: 'Ukrinform' }, { name: 'Al Jazeera' }] },
    places: [
      { en: 'Pryluky', sk: 'Pryluky', killed: 20, children: 5, injured: null, sources: [{ name: 'Ukrainska Pravda' }, { name: 'The Kyiv Independent' }] },
      { en: 'Kremenchuk', sk: 'Kremenčuk', killed: 2, children: null, injured: 47, sources: [{ name: 'Ukrinform' }, { name: 'Ukrainska Pravda' }] },
      { en: 'Kyiv', sk: 'Kyjev', killed: 2, children: null, injured: null, sources: [] },
    ],
  };
  const m = { ...base(), casualties };
  assert.equal(dayStory(m), 'strike', 'obete prebijú hrozbu aj mapu');
  assert.equal(dayStory({ ...m, casualties: { ...casualties, total: { ...casualties.total, killed: 3 } } }), 'air', 'pod 5 obetí nie');
  const hook = frontDayHook(m);
  assert.deepEqual(hook.lines, ['25 MŔTVYCH', 'PO RUSKOM ÚTOKU']);
  assert.match(hook.sub, /medzi nimi 5\sdetí · najmenej, podľa médií/);
  const lines = frontDayLines(m);
  assert.deepEqual(lines.map(l => l.id).slice(0, 2), ['hook', 'strike']);
  assert.ok(!lines.some(l => l.id === 'air' || l.id === 'strikes'), 'hrozba a údery v deň útoku nenaťahujú video');
  assert.ok(!lines.some(l => l.shot.startsWith('clip:')), 'v deň útoku s obeťami bez bojových záberov');
  assert.ok(!frontDayPostText(m).includes('Záber:'), 'ani v príspevku');
  assert.match(lines[0].caption, /^Pri ruskom útoku zahynulo podľa médií najmenej 25\sľudí, medzi nimi 5\sdetí\.$/);
  assert.equal(lines[0].spoken, 'Pri ruskom útoku zahynulo podľa médií najmenej dvadsaťpäť ľudí, medzi nimi päť detí.');
  assert.match(lines[1].caption, /^V meste Pryluky zahynulo najmenej 20\sľudí, z toho 5\sdetí\. V meste Kremenčuk zahynuli najmenej 2 ľudia, zranených je 47\.$/);
  assert.equal(lines[1].spoken, 'V meste Pryluky zahynulo najmenej dvadsať ľudí, z toho päť detí. V meste Kremenčuk zahynuli najmenej dvaja ľudia, zranených je štyridsaťsedem.');
  assert.equal(lines[1].shot, 'strike');
  const post = frontDayPostText(m);
  assert.ok(post.startsWith('Pri ruskom útoku zahynulo podľa médií najmenej 25'));
  assert.match(post, /Pryluky: najmenej 20\smŕtvych, z toho 5\sdetí\./);
  assert.match(post, /Kremenčuk: najmenej 2 mŕtvi, 47 zranených\./);
  assert.match(post, /aspoň dve médiá/);
  assert.ok(!/nie o potvrdené zásahy/.test(post), 'v deň útoku nepíšeme, že nejde o zásahy');
  const words = lines.reduce((n, l) => n + l.spoken.split(/\s+/).length, 0);
  assert.ok(words <= 80, `komentár má ${words} slov`);
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
