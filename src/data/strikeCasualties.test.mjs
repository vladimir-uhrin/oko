// Obete ruských útokov zo správ: číslo len od dvoch médií, miesto z mapy, nie straty vojakov. Titulky zo 7. 10. 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attackCasualties, confirmedNumber, parseHeadline, placeIndex, placeSk } from './strikeCasualties.js';

const NOW = Date.parse('2026-10-07T19:10:00Z');
const at = (hhmm) => Date.parse(`2026-10-07T${hhmm}:00Z`);
const PLACES = placeIndex([
  { geometry: { coordinates: [32.387, 50.595] }, properties: { name: 'Прилуки', lang: 'uk', en: 'Pryluky', pop: 58890 } },
  { geometry: { coordinates: [30.52, 50.45] }, properties: { name: 'Київ', lang: 'uk', en: 'Kyiv', pop: 2900000 } },
  { geometry: { coordinates: [33.40, 49.06] }, properties: { name: 'Кременчук', lang: 'uk', en: 'Kremenchuk', pop: 226400 } },
  { geometry: { coordinates: [20, 48] }, properties: { name: 'Malá dedina', en: 'Mala', pop: 300 } },
]);
const NEWS = [
  ['19:04', 'Kyiv Post', '2 Killed in Fresh Russian Attack on Kyiv After Deadly Overnight Barrage'],
  ['18:58', 'Ukrinform', 'Russian attack on Kyiv kills two and injures 13 in Obolon and Solomianskyi districts'],
  ['18:55', 'Ukrainska Pravda', 'Death toll from Russian strike in Pryluky rises to 20, including five children – photos'],
  ['18:37', 'Ukrinform', 'Zelensky: Russian combined attack kills 25 and injures 100 people'],
  ['18:32', 'Al Jazeera', 'At least 24 killed as Russia launches massive attack on Ukraine'],
  ['18:22', 'Kyiv Post', '‘War Is His Nature’: Zelensky Says Putin’s Birthday ‘Gift’ Killed 25 Ukrainians'],
  ['18:12', 'BBC News', 'Children killed while they slept as Russian missile kills 19 in block of flats'],
  ['18:08', 'The Kyiv Independent', 'Ukraine war latest: Russian attack on Pryluky kills at least 20, including 5 children'],
  ['17:44', 'Ukrainska Pravda', 'Man injured, warehouse and logistics centre damaged in Russian attack on Kyiv Oblast'],
  ['17:38', 'Ukrinform', 'Injury toll after Russian attack on Kremenchuk rises to 47, two killed'],
  ['17:16', 'Ukrinform', 'Death toll from Russian attack in Pryluky rises to 19, another 55 people injured'],
  ['16:42', 'Ukrainska Pravda', 'Number injured in Kremenchuk rises to 47 after Russian attack, two people killed'],
  ['16:19', 'Ukrinform', 'Ukrainian forces push Russian troops back in Dobropillia area'],
  ['15:50', 'Kyiv Post', '5 Children, Including Three 1-Year-Old Boys, Among 19 Killed in Russian Strike on Pryluky'],
  ['13:21', 'The Kyiv Independent', 'Russian attacks kill at least 28, injure more than 138 over past day, rescue efforts continue in Pryluky'],
  ['11:06', 'RFE/RL', 'Massive Russian Attack Kills At Least 18, Devastates Pryluky Apartment Block'],
].map(([hhmm, source, title]) => ({ publishedAt: at(hhmm), source, title, url: `https://example.org/${source.length}` }));

test('7. 10.: Pryluky najmenej 20 mŕtvych z toho 5 detí, Kremenčuk 2 + 47 zranených, Kyjev 2; celok najmenej 25', () => {
  const r = attackCasualties(NEWS, { now: NOW, places: PLACES });
  const by = Object.fromEntries(r.places.map((p) => [p.en, p]));
  assert.equal(by.Pryluky.killed, 20, 'UP 20 + Kyiv Independent 20 (19 od Ukrinformu a Kyiv Post je menej)');
  assert.equal(by.Pryluky.children, 5);
  assert.equal(by.Kremenchuk.killed, 2);
  assert.equal(by.Kremenchuk.injured, 47);
  assert.equal(by.Kyiv.killed, 2);
  assert.equal(by.Kyiv.injured, null, '13 zranených hlási len Ukrinform');
  assert.equal(r.places[0].en, 'Pryluky', 'najviac obetí prvé');
  assert.equal(r.total.killed, 25, 'Kyiv Independent 28 sám, 25 Ukrinform aj Kyiv Post');
  assert.equal(by.Pryluky.sk, 'Pryluky');
  assert.equal(by.Kremenchuk.sk, 'Kremenčuk');
  assert.equal(by.Kyiv.sk, 'Kyjev');
});

test('číslo od jediného média sa nepoužije; dve médiá → druhé najvyššie', () => {
  assert.equal(confirmedNumber(new Map([['A', 28]])), null);
  assert.equal(confirmedNumber(new Map([['A', 28], ['B', 25], ['C', 25]])), 25);
  const one = attackCasualties(NEWS.filter((n) => n.source === 'Ukrinform'), { now: NOW, places: PLACES });
  assert.equal(one.total, null);
  assert.deepEqual(one.places, []);
});

test('nie straty vojakov, nie oblasť ako mesto, nie staré správy; čísla slovami', () => {
  assert.equal(parseHeadline('Ukrainian forces kill 120 Russian troops near Pokrovsk', PLACES), null);
  assert.equal(parseHeadline('Ukrainian forces push Russian troops back in Dobropillia area', PLACES), null);
  assert.equal(parseHeadline('Russian drone attack kills two in Kyiv Oblast', PLACES).place, null, 'Kyiv Oblast nie je mesto Kyjev');
  assert.equal(parseHeadline('Man injured, warehouse damaged in Russian attack on Kyiv Oblast', PLACES), null, 'bez čísla nič');
  const sum = parseHeadline('Russian attacks kill at least 28, injure more than 138 over past day, rescue efforts continue in Pryluky', PLACES);
  assert.deepEqual([sum.national, sum.place, sum.killed, sum.injured], [true, null, 28, 138], 'súčet za deň nepatrí Prylukám');
  assert.equal(parseHeadline('Russian attack on Kyiv kills two and injures 13', PLACES).killed, 2);
  assert.equal(parseHeadline('Death toll from Russian strike in Pryluky rises to 20, including five children', PLACES).children, 5);
  const old = attackCasualties(NEWS.map((n) => ({ ...n, publishedAt: n.publishedAt - 3 * 86400_000 })), { now: NOW, places: PLACES });
  assert.equal(old.total, null, 'mimo okna 30 h');
  assert.equal(PLACES.some((p) => p.en === 'Mala'), false, 'dediny pod 15 000 obyvateľov sa nehľadajú (falošné zhody)');
});

test('slovenské mená sídiel', () => {
  assert.equal(placeSk('Kharkiv'), 'Charkov');
  assert.equal(placeSk('Zhytomyr'), 'Žytomyr');
  assert.equal(placeSk('Kremenchuk'), 'Kremenčuk');
  assert.equal(placeSk('Pryluky'), 'Pryluky');
  assert.equal(placeSk('Shostka'), 'Šostka');
});
