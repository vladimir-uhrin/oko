// src/data/gasFlows.test.mjs
// Toky plynu (2026-09-13): katalóg smerov, URL na ENTSOG, normalizácia
// kWh/d → GWh/d, súhrny, zostava proxy, model karty, citácia, fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTSOG_OPERATIONAL_DATA_URL, ENTSOG_TP_URL, GAS_FLOWS_API, GAS_FLOWS_STALE_DAYS, GAS_FLOW_GROUPS, GAS_FLOW_POINTS, GAS_FLOW_SPARK_DAYS,
  KWH_PER_M3, buildFlowsModel, buildFlowsPayload, entsogCitation, entsogFlowsUrl, fetchGasFlows, flowWindow, formatGwhDay,
  mcmPerDay, normalizeFlowRows, pointDirectionKey, summarizeSeries,
} from './gasFlows.js';

const NOW = Date.UTC(2026, 8, 13, 10);
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
// Tvar riadku ENTSOG operationalData (stiahnuté 2026-09-13), skrátený.
const row = (operatorKey, pointKey, directionKey, day, kwh, flowStatus = 'Provisional') => ({
  indicator: 'Physical Flow', periodType: 'day', periodFrom: `${day}T06:00:00+02:00`, periodTo: `${day}T06:00:00+02:00`,
  operatorKey, pointKey, directionKey, unit: 'kWh/d', value: kwh, flowStatus, lastUpdateDateTime: `${day}T06:35:00+02:00`,
});

test('katalóg: 32 smerov, jedinečné id, skupiny sk/east, kľúče ENTSOG, súradnice v Európe', () => {
  assert.equal(GAS_FLOW_POINTS.length, 32);
  assert.equal(new Set(GAS_FLOW_POINTS.map((p) => p.id)).size, 32, 'id sú jedinečné');
  assert.equal(new Set(GAS_FLOW_POINTS.map(pointDirectionKey)).size, 32, 'smery sú jedinečné');
  for (const p of GAS_FLOW_POINTS) {
    assert.ok(GAS_FLOW_GROUPS.includes(p.group), p.id);
    assert.match(p.operator, /^[A-Z]{2}-TSO-\d{4}$/, p.id);
    assert.match(p.point, /^(ITP|UGS)-\d{5}$/, p.id);
    assert.ok(['entry', 'exit'].includes(p.dir), p.id);
    assert.ok(p.lat > 35 && p.lat < 66 && p.lon > 10 && p.lon < 40, `${p.id} leží v Európe`);
    assert.ok(p.name && p.from && p.to, p.id);
  }
  assert.equal(pointDirectionKey(GAS_FLOW_POINTS[0]), 'sk-tso-0001itp-00051entry', 'malé písmená bez oddeľovačov — tak to berie API');
  assert.equal(GAS_FLOW_POINTS.filter((p) => p.group === 'sk').length, 14);
  const sudzha = GAS_FLOW_POINTS.find((p) => p.id === 'sudzha');
  assert.deepEqual([sudzha.operator, sudzha.point, sudzha.dir, sudzha.from, sudzha.to], ['UA-TSO-0001', 'ITP-00184', 'entry', 'RU', 'UA'], 'ukrajinský operátor je v ENTSOG (overené naživo)');
});

test('flowWindow a entsogFlowsUrl: 31 dní späť po zajtrajšok, jeden dopyt so všetkými smermi, CET, bez limitu', () => {
  assert.deepEqual(flowWindow(NOW), { from: '2026-08-13', to: '2026-09-14' });
  const url = new URL(entsogFlowsUrl(GAS_FLOW_POINTS, flowWindow(NOW)));
  assert.equal(url.origin + url.pathname, ENTSOG_OPERATIONAL_DATA_URL);
  const pd = url.searchParams.get('pointDirection').split(',');
  assert.equal(pd.length, 32);
  assert.ok(pd.includes('bg-tso-0001itp-00549entry'), 'TurkStream (Strandža 2)');
  assert.equal(url.searchParams.get('indicator'), 'Physical Flow');
  assert.equal(url.searchParams.get('periodType'), 'day');
  assert.equal(url.searchParams.get('timezone'), 'CET');
  assert.equal(url.searchParams.get('limit'), '-1');
  assert.equal(url.searchParams.get('from'), '2026-08-13');
});

test('normalizeFlowRows a summarizeSeries: kWh/d → GWh/d, deň z periodFrom, duplicitný deň = posledný vyhráva, cudzie riadky mimo', () => {
  const rows = [
    row('SK-TSO-0001', 'ITP-00051', 'entry', '2026-09-08', 21_520_000),
    row('SK-TSO-0001', 'ITP-00051', 'entry', '2026-09-07', 24_610_000),
    row('SK-TSO-0001', 'ITP-00051', 'entry', '2026-09-07', 24_000_000, 'Confirmed'),
    row('SK-TSO-0001', 'ITP-00051', 'entry', '2026-09-09', 0),
    { ...row('SK-TSO-0001', 'ITP-00168', 'entry', '2026-09-09', 7_780), unit: 'MWh/d' },
    { ...row('SK-TSO-0001', 'ITP-00168', 'entry', 'zle', 1) },
    { ...row('SK-TSO-0001', 'ITP-00168', 'entry', '2026-09-08', 'n/a') },
  ];
  const by = normalizeFlowRows(rows);
  assert.deepEqual(by.get('sk-tso-0001itp-00051entry'), [
    { date: '2026-09-07', gwh: 24, status: 'Confirmed' },
    { date: '2026-09-08', gwh: 21.52, status: 'Provisional' },
    { date: '2026-09-09', gwh: 0, status: 'Provisional' },
  ]);
  assert.deepEqual(by.get('sk-tso-0001itp-00168entry'), [{ date: '2026-09-09', gwh: 7.78, status: 'Provisional' }], 'MWh/d sa prepočíta, zlé dni a hodnoty sa zahodia');
  const s = summarizeSeries(by.get('sk-tso-0001itp-00051entry'));
  assert.equal(s.latest.date, '2026-09-09');
  assert.equal(s.prev.gwh, 21.52);
  assert.equal(s.avg7, Math.round(((24 + 21.52 + 0) / 3) * 1000) / 1000);
  assert.equal(s.max, 24);
  assert.deepEqual(summarizeSeries([]), { latest: null, prev: null, avg7: null, max: null });
});

test('buildFlowsPayload: katalóg + rady + súhrny, smer bez riadkov má prázdny rad a null; citácia podľa čl. 5.2', () => {
  const rows = [row('BG-TSO-0001', 'ITP-00549', 'entry', '2026-09-10', 44_100_000), row('UA-TSO-0001', 'ITP-00184', 'entry', '2026-09-10', 0)];
  const payload = buildFlowsPayload(rows, { fetchedAt: NOW, window: flowWindow(NOW) });
  assert.equal(payload.points.length, 32);
  const ts = payload.points.find((p) => p.id === 'strandzha2');
  assert.equal(ts.latest.gwh, 44.1);
  assert.equal(ts.avg7, 44.1);
  const sudzha = payload.points.find((p) => p.id === 'sudzha');
  assert.equal(sudzha.latest.gwh, 0);
  const mozyr = payload.points.find((p) => p.id === 'mozyr');
  assert.deepEqual([mozyr.series, mozyr.latest, mozyr.avg7], [[], null, null]);
  assert.equal(payload.citation, 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/');
  assert.equal(entsogCitation(Date.UTC(2026, 0, 5)), `ENTSOG TP 05-01-2026 ${ENTSOG_TP_URL}`);
});

test('formáty a prepočet: GWh/d SK/EN, nula, bez dát; mil. m³ pri 10,55 kWh/m³', () => {
  assert.equal(formatGwhDay(24.61, 'sk'), '24,6 GWh/d');
  assert.equal(formatGwhDay(24.61, 'en'), '24.6 GWh/d');
  assert.equal(formatGwhDay(0.01), '0 GWh/d');
  assert.equal(formatGwhDay(null), '—');
  assert.equal(KWH_PER_M3, 10.55);
  assert.equal(mcmPerDay(24.61), Math.round((24.61 / 10.55) * 100) / 100);
  assert.ok(Math.abs(mcmPerDay(24.61) - 2.33) < 0.01, '24,6 GWh ≈ 2,3 mil. m³');
  assert.equal(mcmPerDay(null), null);
});

test('buildFlowsModel: skupiny v poradí katalógu, úrovne flow/zero/nodata, texty pre laika, poznámky, sparkline, čerstvosť', () => {
  const rows = [];
  for (let d = 1; d <= 20; d += 1) {
    const day = `2026-08-${String(d + 11).padStart(2, '0')}`;
    rows.push(row('SK-TSO-0001', 'ITP-00051', 'entry', day, 20_000_000 + d * 100_000));
  }
  rows.push(row('SK-TSO-0001', 'ITP-00051', 'entry', '2026-09-11', 24_610_000));
  rows.push(row('SK-TSO-0001', 'ITP-00117', 'entry', '2026-09-11', 0));
  const payload = buildFlowsPayload(rows, { fetchedAt: NOW });
  const m = buildFlowsModel(payload, { lang: 'sk', translate: tKey, nowMs: NOW });
  assert.equal(m.ok, true);
  assert.deepEqual(m.groups.map((g) => [g.key, g.title, g.rows.length]), [['sk', 'gas.flows-sk', 14], ['east', 'gas.flows-east', 18]]);
  const lanzhot = m.groups[0].rows[0];
  assert.equal(lanzhot.id, 'lanzhot-in');
  assert.equal(lanzhot.route, 'CZ → SK');
  assert.equal(lanzhot.level, 'flow');
  assert.equal(lanzhot.text, '24,6 GWh/d');
  assert.equal(lanzhot.mcmText, 'gas.flow-mcm {"v":"2,3"}');
  assert.match(lanzhot.avg7Text, /^gas\.flow-avg7 /);
  assert.equal(lanzhot.dateText, '11. 9.');
  assert.equal(lanzhot.statusText, 'gas.flow-provisional');
  assert.equal(lanzhot.spark.length, GAS_FLOW_SPARK_DAYS, 'sparkline = posledných 14 dní');
  const kapusany = m.groups[0].rows.find((r) => r.id === 'kapusany-in');
  assert.equal(kapusany.level, 'zero');
  assert.equal(kapusany.text, '0 GWh/d');
  assert.equal(kapusany.mcmText, '');
  assert.equal(kapusany.note, 'gas.note-kapusany');
  const mozyr = m.groups[1].rows.find((r) => r.id === 'mozyr');
  assert.equal(mozyr.level, 'nodata');
  assert.equal(mozyr.text, 'gas.flow-nodata');
  assert.equal(m.note, 'gas.flows-note');
  assert.equal(m.sourceLine, 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/');
  assert.equal(m.freshness.latestDate, '2026-09-11');
  assert.equal(m.freshness.ageDays, 2);
  assert.equal(m.freshness.stale, false);
  const old = buildFlowsModel(payload, { translate: tKey, nowMs: NOW + (GAS_FLOWS_STALE_DAYS + 1) * 86_400_000 });
  assert.equal(old.freshness.stale, true);
  assert.equal(buildFlowsModel(buildFlowsPayload([], { fetchedAt: NOW }), { translate: tKey, nowMs: NOW }).freshness.stale, true, 'bez jediného dňa = zastarané');
  assert.deepEqual(buildFlowsModel(null), { ok: false, reason: 'empty' });
});

test('fetchGasFlows: JSON z proxy; chyba = výnimka so statusom', async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => ({ points: [] }) }; };
  assert.deepEqual(await fetchGasFlows({ fetcher: ok }), { points: [] });
  assert.equal(calls[0][0], GAS_FLOWS_API);
  await assert.rejects(fetchGasFlows({ fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }) }), (e) => e.status === 502 && e.message === 'upstream');
});
