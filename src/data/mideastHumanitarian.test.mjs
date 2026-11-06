// src/data/mideastHumanitarian.test.mjs — HUMANITÁRNE SÚČTY Tech for Palestine (BLÍZKY VÝCHOD etapa 6,
// 2026-11-06): len súčty zo skutočného súhrnu v3, nikdy zoznamy mien; riadky karty po dejisku.
import test from 'node:test';
import assert from 'node:assert/strict';

import { HUMANITARIAN_THEATRES, T4P_SUMMARY_URL, fetchMideastHumanitarian, humanitarianKeyForTheatre, humanitarianRows, parseT4pSummary } from './mideastHumanitarian.js';
import { T4P_SUMMARY_V3 } from './fixtures/mideastStage6Fixtures.mjs';

test('súhrn v3 → len súčty; bloky mien (known_killed_in_gaza, press) sa nikdy neprenesú', () => {
  const s = parseT4pSummary(T4P_SUMMARY_V3);
  assert.deepEqual(Object.keys(s), ['gaza', 'west_bank', 'lebanon']);
  assert.equal(s.gaza.killed, 74618);
  assert.equal(s.gaza.children, 20179);
  assert.equal(s.gaza.press, 262);
  assert.equal(s.gaza.injured, 175925);
  assert.equal(s.gaza.lastUpdate, '2026-11-05');
  assert.equal(s.gaza.reports, 1126);
  assert.equal(s.west_bank.settlerAttacks, 5148);
  assert.equal(s.west_bank.injuredChildren, 1980);
  assert.equal(s.lebanon.killed, 8436);
  assert.equal(s.lebanon.firstReport, '2023-11-14');
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /known_killed|press_killed|records|pages|male|female/, 'nič zo zoznamov mien');
  assert.equal(T4P_SUMMARY_URL, 'https://data.techforpalestine.org/api/v3/summary.json', 'len súhrn — nikdy killed-in-gaza');
  assert.throws(() => parseT4pSummary(null), /not an object/);
  assert.throws(() => parseT4pSummary({ foo: 1 }), /no summary blocks/);
  const partial = parseT4pSummary({ gaza: { killed: { total: '12' }, last_update: 'bad' } });
  assert.equal(partial.gaza.killed, 12);
  assert.equal(partial.gaza.lastUpdate, null);
  assert.equal(partial.west_bank, null);
});

test('riadky karty po dejisku: Gaza 7 riadkov v poradí, Západný breh 5, Libanon 2, iné dejisko nič', () => {
  const s = parseT4pSummary(T4P_SUMMARY_V3);
  assert.deepEqual(humanitarianRows(s, 'gaza').map((r) => r.id), ['killed', 'children', 'women', 'medical', 'press', 'civilDefence', 'injured']);
  assert.deepEqual(humanitarianRows(s, 'west-bank').map((r) => [r.id, r.value]), [['killed', 1129], ['children', 240], ['injured', 12298], ['injuredChildren', 1980], ['settlerAttacks', 5148]]);
  assert.deepEqual(humanitarianRows(s, 'south-lebanon').map((r) => r.id), ['killed', 'injured']);
  assert.deepEqual(humanitarianRows(s, 'iran'), []);
  assert.deepEqual(humanitarianRows(null, 'gaza'), []);
  assert.deepEqual(HUMANITARIAN_THEATRES, { gaza: 'gaza', 'west-bank': 'west_bank', 'south-lebanon': 'lebanon' });
  assert.equal(humanitarianKeyForTheatre('overview'), null);
});

test('klient: trasa /humanitarian, 404 nesie stav', async () => {
  const calls = [];
  const json = await fetchMideastHumanitarian({ fetcher: async (url) => { calls.push(url); return new Response(JSON.stringify({ summary: { gaza: {} } }), { status: 200 }); } });
  assert.deepEqual(calls, ['/api/mideast/events/humanitarian']);
  assert.ok(json.summary.gaza);
  await assert.rejects(fetchMideastHumanitarian({ fetcher: async () => new Response(JSON.stringify({ error: 'no_humanitarian_snapshot' }), { status: 404 }) }), (e) => e.status === 404);
  await assert.rejects(fetchMideastHumanitarian({ fetcher: async () => new Response('{}', { status: 200 }) }), /bad_humanitarian_payload/);
});
