// src/data/czib.test.mjs — bulletiny EASA o konfliktných zónach (etapa 5b, 2026-10-03).
// Fixtúry sú skutočné odpovede EASA zo 3. 10. 2026 (export, RSS, <main> piatich stránok)
// a výrez Boundaries.geojson VATSpy — README v src/data/fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MIDEAST_CZIB_COUNTRIES, buildCzibBulletin, czibLapsed, czibScope, decodeEntities, detailLines, easaDay, easaTime,
  fetchAirspace, firCodesFromText, firPolygons, indexFirBoundaries, isMideastBulletin, mainRecommendation,
  parseCzibDetail, parseCzibExport, parseCzibFeed,
} from './czib.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const exportRows = () => parseCzibExport(JSON.parse(fixture('easa-czib-export-20261003.json')));

test('export EASA: 34 bulletinov, 16 aktívnych, dátumy a krajiny', () => {
  const rows = exportRows();
  assert.equal(rows.length, 34);
  assert.equal(rows.filter((r) => r.active).length, 16);
  const gulf = rows.find((r) => r.nid === '143899');
  assert.equal(gulf.name, 'Airspace of the Persian Gulf and Gulf of Oman');
  assert.deepEqual(gulf.countries, ['Bahrain', 'Kuwait', 'Qatar', 'Oman', 'United Arab Emirates']);
  assert.equal(gulf.validUntil, '2026-11-16');
  assert.equal(gulf.point, null, 'prázdne súradnice → bez bodu');
  assert.equal(gulf.updatedAt, Date.parse('2026-09-30T18:59:16+03:00'));
  const nk = rows.find((r) => r.nid === '22434');
  assert.match(nk.countries[0], /Democratic People's Republic of Korea/, 'entity &#039; dekódované');
  assert.equal(rows.find((r) => r.nid === '20599').point.lat, 33.5130695);
  // holé pole aj prázdny vstup
  assert.equal(parseCzibExport([{ Nid: '1', status: 'Active', name: 'X' }]).length, 1);
  assert.deepEqual(parseCzibExport(null), []);
  assert.deepEqual(parseCzibExport({ conflict_zones: [{ Nid: 'x' }] }), [], 'Nid musí byť číslo');
});

test('RSS EASA: Nid → odkaz na stránku bulletinu, len https na easa.europa.eu', () => {
  const links = parseCzibFeed(fixture('easa-czib-feed-20261003.xml'));
  assert.equal(links.size, 34);
  assert.equal(links.get('143862'), 'https://www.easa.europa.eu/domains/air-operations/czibs/czib-2026-05-r2');
  assert.equal(parseCzibFeed('<item><link>https://evil.example/x</link><guid>1 on Mon</guid></item>').size, 0);
});

test('stránka bulletinu: číslo, platnosť, dotknutý priestor a odporúčania (Irak)', () => {
  const d = parseCzibDetail(fixture('easa-czib-iraq-20261003.html'));
  assert.equal(d.czib, 'CZIB-2026-05-R2');
  assert.equal(d.status, 'Active');
  assert.equal(d.issued, '2026-07-08');
  assert.equal(d.revised, '2026-09-30');
  assert.equal(d.validUntil, '2026-11-16');
  assert.match(d.revisionNote, /validity was extended until 16 November 2026/);
  assert.equal(d.affected, 'FIR Baghdad (ORBB), all altitudes and flight levels.');
  assert.deepEqual(d.countries, ['Iraq']);
  assert.match(mainRecommendation(d.recommendations), /^Not operate within the airspace of Iraq, FIR Baghdad \(ORBB\)/);
});

test('kódy FIR len zo zátvoriek — „FIR KYIV" ani „EASA" nie sú kód; zoznam v Zálive', () => {
  const gulf = parseCzibDetail(fixture('easa-czib-gulf-20261003.html'));
  assert.deepEqual(firCodesFromText(gulf.affected), ['OBBB', 'OKAC', 'OTDF', 'OMAE', 'OOMM']);
  const ua = parseCzibDetail(fixture('easa-czib-ukraine-20261003.html'));
  assert.deepEqual(firCodesFromText(ua.affected), ['UKLV', 'UKBV', 'UKBU', 'UKDV', 'UKFV', 'UKOV']);
  assert.deepEqual(firCodesFromText('Sana’a Flight Information Region (FIR OYSC), all altitudes'), ['OYSC']);
  assert.deepEqual(firCodesFromText('EASA recommends; FIR KYIV is closed'), []);
});

test('rozsah: všetky výšky / pod FL, časť FIR, výnimky — odporúčanie má prednosť pred priestorom', () => {
  const scopeOf = (name) => { const d = parseCzibDetail(fixture(name)); return czibScope(d.affected, d.recommendations); };
  assert.deepEqual(scopeOf('easa-czib-iraq-20261003.html'), { altitude: 'all', fl: null, partial: false, partialHint: null, exceptions: false });
  const libya = scopeOf('easa-czib-libya-20261003.html');
  assert.equal(libya.altitude, 'below', 'priestor „all altitudes", odporúčanie „below FL 320"');
  assert.equal(libya.fl, 320);
  assert.equal(libya.exceptions, true, 'pobrežné letiská');
  const gulf = scopeOf('easa-czib-gulf-20261003.html');
  assert.equal(gulf.partial, true);
  assert.equal(gulf.partialHint, 'over the waters');
  assert.equal(gulf.exceptions, true);
  const syria = scopeOf('easa-czib-syria-20261003.html');
  assert.equal(syria.partial, true, 'západne od čiary cez body');
  assert.equal(syria.partialHint, 'west of the line');
  assert.equal(czibScope('Mali airspace, FIR Niamey (DRRR) and FIR Dakar (GOOO) at altitudes below Flight Level (FL) 260.', []).fl, 260);
  assert.equal(czibScope('', ['Not operate in the airspace of Somalia at or below FL 260.']).fl, 260);
});

test('bulletin: model z exportu + stránky; Blízky východ; uplynutá platnosť', () => {
  const row = exportRows().find((r) => r.nid === '143899');
  const b = buildCzibBulletin(row, parseCzibDetail(fixture('easa-czib-gulf-20261003.html')), 'https://www.easa.europa.eu/domains/air-operations/czibs/czib-2026-07r3');
  assert.equal(b.czib, 'CZIB-2026-07R3');
  assert.deepEqual(b.firs, ['OBBB', 'OKAC', 'OTDF', 'OMAE', 'OOMM']);
  assert.equal(b.scope.partial, true);
  assert.match(b.recommendation, /over the waters of the Persian Gulf/);
  assert.equal(isMideastBulletin(b), true);
  assert.equal(isMideastBulletin({ countries: ['Ukraine'] }), false);
  assert.ok(MIDEAST_CZIB_COUNTRIES.includes('Saudi Arabia'));
  assert.equal(czibLapsed({ validUntil: '2026-11-16' }, Date.parse('2026-11-16T12:00:00Z')), false, 'v posledný deň ešte platí');
  assert.equal(czibLapsed({ validUntil: '2026-11-16' }, Date.parse('2026-11-17T00:00:01Z')), true);
  assert.equal(czibLapsed({ validUntil: null }), false);
  // bez stránky (výpadok) ostáva aspoň export
  const bare = buildCzibBulletin(row, null, null);
  assert.equal(bare.czib, null);
  assert.deepEqual(bare.firs, []);
  assert.equal(bare.validUntil, '2026-11-16');
});

test('hranice FIR z VATSpy: len základné FIR (bez sektorov), zaokrúhlenie, zlé body von', () => {
  const index = indexFirBoundaries(JSON.parse(fixture('vatspy-boundaries-sample-20261003.geojson')));
  assert.ok(index.has('ORBB'));
  assert.ok(!index.has('ORBB-N'), 'sektor sa vynechá');
  assert.ok(index.has('OBBB') && index.has('UKBV'));
  assert.equal(index.size, 130);
  const [rings] = index.get('ORBB');
  assert.ok(rings[0].length > 50, 'vonkajší prstenec Bagdadu');
  assert.ok(rings[0].every(([lon, lat]) => Math.round(lon * 1000) === lon * 1000 && lat > 28 && lat < 38));
  assert.deepEqual(firPolygons({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0.2, 0.2], [999, 0]]] }), [[[[0, 0], [1, 0], [1, 1], [0, 0]]]], 'krátky/zlý prstenec von');
  assert.deepEqual(firPolygons(null), []);
});

test('pomocníci: entity, dátumy EASA, riadky stránky', () => {
  assert.equal(decodeEntities('A&nbsp;&amp;&#039;B&#x2013;&rsquo;'), "A &'B–’");
  assert.equal(easaDay('30/11/2026'), '2026-11-30');
  assert.equal(easaDay('1/2/2027'), '2027-02-01');
  assert.equal(easaDay(''), null);
  assert.equal(easaTime('2026-07-08T00:00:00+0300'), Date.parse('2026-07-08T00:00:00+03:00'));
  assert.equal(easaTime('nope'), null);
  assert.deepEqual(detailLines('<main><p>A<br>-&nbsp;&nbsp;B</p><ul><li>C</li></ul></main>'), ['A', 'B', 'C']);
});

test('fetchAirspace: 200 s bulletinmi, chyba proxy so statusom, zlé telo', async () => {
  const ok = { bulletins: [], firs: {} };
  assert.deepEqual(await fetchAirspace({ fetcher: async () => ({ ok: true, json: async () => ok }) }), ok);
  await assert.rejects(fetchAirspace({ fetcher: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_airspace_snapshot' }) }) }), (e) => e.status === 404 && e.message === 'no_airspace_snapshot');
  await assert.rejects(fetchAirspace({ fetcher: async () => ({ ok: true, json: async () => ({ bulletins: 'x' }) }) }), /bad_airspace_payload/);
});
