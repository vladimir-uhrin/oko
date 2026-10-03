// src/data/ukmto.test.mjs — incidenty lodí z rozhrania UKMTO (etapa 5c, 2026-10-03).
// Fixtúra = 21 skutočných incidentov z odpovede `sccd.royalnavy.mod.uk/api/ukmto/all`
// zo 3. 10. 2026 (všetky tvary hlavičky textu, každý druh a oblasť) — README v src/data/fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  UKMTO_API, UKMTO_API_URL, UKMTO_ATTRIBUTION, UKMTO_CHOKEPOINT_SCENES, UKMTO_TYPES, fetchUkmto, mergeUkmtoIncidents,
  parseUkmtoIncidents, ukmtoAge, ukmtoBody, ukmtoRef, ukmtoReporter, ukmtoSummary, ukmtoType,
} from './ukmto.js';
import { listChokepointScenes } from '../chokepointScenes.js';

const raw = () => JSON.parse(readFileSync(new URL('./fixtures/ukmto-all-20261003.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-03T16:00:00Z');

test('odpoveď rozhrania → incidenty: najnovšie prvé, číslo varovania, druh, poloha, oblasť, bez mena plavidla', () => {
  const list = parseUkmtoIncidents(raw());
  assert.equal(list.length, 21);
  assert.deepEqual(list.slice(0, 3).map((x) => x.ref), ['149-26', '148-26', '147-26']);
  assert.ok(list.every((x, i) => i === 0 || list[i - 1].t >= x.t), 'zoradené od najnovšieho');
  const newest = list[0];
  assert.equal(newest.type, 'attack');
  assert.equal(newest.typeName, 'Attack');
  assert.equal(newest.place, 'Strait of Hormuz');
  assert.equal(newest.vesselType, 'Tanker');
  assert.equal(newest.t, Date.parse('2026-10-02T23:11:00Z'));
  assert.ok(Math.abs(newest.lat - 26.22) < 0.01 && Math.abs(newest.lon - 56.57) < 0.01);
  assert.match(newest.text, /^UKMTO has received a report of an incident 4nm east of Oman\./);
  assert.match(newest.id, /^[0-9a-f-]{36}$/);
  for (const it of list) {
    assert.ok(!('vesselName' in it), 'meno plavidla sa neberie');
    assert.match(it.ref, /^\d{3}-26$/);
    assert.ok(it.text.length > 40 && it.text.length <= 700);
    assert.doesNotMatch(it.text, /Report Date:|Issue Date:|\r|\n/, `${it.ref}: hlavička a zalomenia sú preč`);
  }
  assert.deepEqual([...new Set(list.map((x) => x.type))].sort(), ['advisory', 'attack', 'hijack', 'suspicious']);
  assert.equal(list.find((x) => x.number === 114).hijacked, true, 'loď pod kontrolou pirátov');
  assert.equal(list.find((x) => x.number === 78).reporter, 'Master');
});

test('zlé riadky sa vynechajú, nepole je chyba, duplicitné id raz', () => {
  const good = raw()[0];
  const rows = [
    good,
    { ...good },
    { ...good, sitecoreId: 'x', incidentNumber: 150, utcDateOfIncident: 'nope' },
    { ...good, sitecoreId: 'y', locationLatitude: 0, locationLongitude: 0 },
    { ...good, sitecoreId: 'z', locationLatitude: 95 },
    { ...good, sitecoreId: 'not-a-guid', incidentNumber: 151 },
  ];
  const list = parseUkmtoIncidents(rows);
  assert.equal(list.length, 2, 'dobrý + ten s neplatným sitecoreId (dostane náhradné id)');
  assert.match(list.find((x) => x.number === 151).id, /^n151-2026-10-02T23:11$/);
  assert.throws(() => parseUkmtoIncidents({ error: 'x' }), /not an array/);
  assert.deepEqual(parseUkmtoIncidents([]), [], 'prázdne pole = pokoj na mori, nie chyba');
});

test('text, hlásiaci a číslo varovania z rôznych tvarov hlavičky', () => {
  const full = 'UKMTO WARNING 078-26 - SUSPICIOUS ACTIVITY\r\nReport Date: 01 Jul 2026 \r\nReport Time:0945UTC\r\nIssue Date: 01 Jul 2026\r\nSource: Master\r\n\r\n\r\nUKMTO has received a report of an incident 85NM south of Balhaf, Yemen.\r\nThe Master of a tanker had reported a small craft.';
  assert.equal(ukmtoBody(full), 'UKMTO has received a report of an incident 85NM south of Balhaf, Yemen. The Master of a tanker had reported a small craft.');
  assert.equal(ukmtoReporter(full), 'Master');
  assert.equal(ukmtoReporter('Source: Company Security \r\nOfficer\r\nUKMTO has received'), 'Company Security Officer');
  assert.equal(ukmtoReporter('UKMTO has received a report'), null);
  assert.equal(ukmtoBody('UKMTO_WARNING_81-26. UKMTO has received a report of an incident.'), 'UKMTO has received a report of an incident.');
  assert.equal(ukmtoBody('UKMTO ADVISORY 109-26 - UKMTO have received a report.'), 'UKMTO have received a report.');
  assert.equal(ukmtoBody('UKMTO WARNING 200-26\r\nSource: Master\r\nA vessel was hit.'), 'A vessel was hit.', 'bez vety „UKMTO has…" len bez riadkov hlavičky');
  assert.equal(ukmtoRef(full, 78, Date.parse('2026-07-01T11:22:00Z')), '078-26');
  assert.equal(ukmtoRef('UKMTO_WARNING_81-26. UKMTO has', 81, NOW), '081-26');
  assert.equal(ukmtoRef('UKMTO ADVISORY 091 -26 - UKMTO has', 91, NOW), '091-26');
  assert.equal(ukmtoRef('UKMTO has received a report of an incident 9NM east of Oman.', 83, Date.parse('2026-07-11T23:39:00Z')), '083-26', 'bez hlavičky z čísla a roka udalosti');
  assert.equal(ukmtoRef('UKMTO WARNING 099-26', 83, NOW), '083-26', 'číslo v texte nesedí s rozhraním → platí rozhranie');
  assert.equal(ukmtoRef('', null, NOW), null);
});

test('druhy incidentov: číselník rozhrania → triedy s farbou; neznámy druh = other', () => {
  const names = ['Advisory', 'Attack', 'Attempted Boarding', 'Electronic Interference', 'Hijack', 'Illegal Boarding', 'Kidnap', 'Suspicious Activity'];
  assert.deepEqual(names.map((n) => ukmtoType(n).id), ['advisory', 'attack', 'boarding', 'interference', 'hijack', 'boarding', 'kidnap', 'suspicious']);
  assert.equal(ukmtoType('Something New').id, 'other');
  assert.equal(ukmtoType(null).id, 'other');
  assert.equal(new Set(UKMTO_TYPES.map((x) => x.id)).size, UKMTO_TYPES.length);
  for (const type of UKMTO_TYPES) assert.match(type.css, /^#[0-9a-f]{6}$/);
});

test('zlúčenie s archívom: staré incidenty ostanú, rovnaké id prepíše novší záznam', () => {
  const list = parseUkmtoIncidents(raw());
  const old = { id: 'old-1', t: Date.parse('2026-03-01T00:00:00Z'), type: 'attack', ref: '012-26' };
  const updated = { ...list[0], text: 'Update 001: …' };
  const merged = mergeUkmtoIncidents([old, ...list], [updated]);
  assert.equal(merged.length, 22);
  assert.equal(merged[0].text, 'Update 001: …');
  assert.equal(merged.at(-1).id, 'old-1', 'incident, ktorý už rozhranie nevracia, v archíve ostal');
  assert.deepEqual(mergeUkmtoIncidents(null, null), []);
});

test('vek a súhrn pre legendu: 7 / 30 dní, počty podľa druhu zoradené podľa vážnosti', () => {
  assert.equal(ukmtoAge(NOW - 6 * 86_400_000, NOW), 'fresh');
  assert.equal(ukmtoAge(NOW - 20 * 86_400_000, NOW), 'recent');
  assert.equal(ukmtoAge(NOW - 31 * 86_400_000, NOW), 'old');
  const s = ukmtoSummary(parseUkmtoIncidents(raw()), { nowMs: NOW, days: 30, latest: 3 });
  assert.equal(s.total, 5, 'za 30 dní: 149, 148, 147 (Hormuz), 130 (útok 9. 9.) a 127 (upozornenie 5. 9.)');
  assert.deepEqual(s.byType.map((x) => [x.type, x.count]), [['attack', 4], ['advisory', 1]]);
  assert.deepEqual(s.latest.map((x) => x.ref), ['149-26', '148-26', '147-26']);
  assert.deepEqual(ukmtoSummary(null).byType, []);
});

test('klient a konštanty: zdroj UKMTO (nie mscio.eu), OGL v atribúcii, úžiny existujú v katalógu scén', async () => {
  assert.equal(UKMTO_API_URL, 'https://sccd.royalnavy.mod.uk/api/ukmto/all');
  assert.match(UKMTO_ATTRIBUTION, /UKMTO.*Open Government Licence v3\.0/);
  const sceneIds = listChokepointScenes().map((s) => s.id);
  for (const id of UKMTO_CHOKEPOINT_SCENES) assert.ok(sceneIds.includes(id), id);
  const asked = [];
  const ok = { incidents: [] };
  assert.equal(await fetchUkmto({ days: 30, fetcher: async (url) => { asked.push(url); return { ok: true, json: async () => ok }; } }), ok);
  assert.deepEqual(asked, [`${UKMTO_API}?days=30`]);
  await assert.rejects(fetchUkmto({ fetcher: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_ukmto_snapshot' }) }) }), (e) => e.status === 404 && e.message === 'no_ukmto_snapshot');
  await assert.rejects(fetchUkmto({ fetcher: async () => ({ ok: true, json: async () => ({}) }) }), /bad_ukmto_payload/);
});
