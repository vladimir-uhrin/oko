// src/data/acarsMessages.test.mjs
// ACARS/CPDLC správy sledovaného stroja z airframes.io (2026-09-08, LEN LOKÁLNE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACARS_ATTRIBUTION,
  ACARS_CACHE_TTL_MS,
  ACARS_FAILURE_TTL_MS,
  acarsCardLine,
  acarsClock,
  acarsCockpitRows,
  acarsLabelInfo,
  acarsStatusLine,
  acarsTextPreview,
  acarsTextReadable,
  cachedAcars,
  compactAirframesMessage,
  isAcarsDisabled,
  requestAcarsMessages,
  resetAcarsCache,
  sortAcarsMessages,
} from './acarsMessages.js';

const DICT = { 'cockpit.acars-count': '{n} msg · 24 h', 'cockpit.acars-stale': 'STALE' };
const t = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), DICT[key] ?? key);

// Reálna vzorka z api.airframes.io/v1/messages (2026-09-08), orezaná; stanica
// nesie meno používateľa, IP, polohu — nič z toho nesmie prejsť ku klientovi.
const upstream = {
  id: 7519566994,
  station: { id: 9, ident: 'BN-KNKX1-VDL2', ipAddress: '107.xxx.xxx.161', user: { username: 'Gnare', name: 'Gnare' }, latitude: 32.9, longitude: -117.2 },
  airframe: { id: 436757, tail: 'N5897K', icao: 'A79AAE', owner: 'AMAZON.COM SERVICES LLC' },
  flight: { id: 5551622343, flight: 'HA2616' },
  source: 'dumpvdl2', sourceType: 'vdl', linkDirection: null, fromHex: 'A79AAE', toHex: '1030DA',
  timestamp: '2026-09-08T03:39:18.835Z', tail: 'N5897K', flightNumber: 'HA2616', frequency: 136.975,
  label: 'H1', blockId: '4', messageNumber: 'D24', ack: '!',
  text: '004044000101011489065\r\nR04/A33004,1,1\r\nC1,.N5897K,26SEP06,20.08.26,KSBD,KCVG,ASA2616   ,4000,439',
};

test('kompaktná správa: len obsah + ident stanice — žiadne meno, IP ani poloha feedera; bez obsahu null', () => {
  const m = compactAirframesMessage(upstream);
  assert.deepEqual(m, {
    id: 7519566994, t: '2026-09-08T03:39:18.835Z', label: 'H1', text: upstream.text, src: 'vdl', station: 'BN-KNKX1-VDL2',
    from: 'A79AAE', to: '1030DA', flight: 'HA2616', tail: 'N5897K', freq: 136.975,
  });
  const json = JSON.stringify(m);
  for (const leak of ['Gnare', '107.', 'AMAZON', 'latitude', 'user']) assert.ok(!json.includes(leak), `únik: ${leak}`);
  assert.equal(compactAirframesMessage({ ...upstream, label: null, text: '' }), null, 'VDL2 rámec bez ACARS obsahu');
  assert.equal(compactAirframesMessage({ ...upstream, timestamp: 'nope' }), null);
  assert.equal(compactAirframesMessage(null), null);
});

test('labely: CPDLC/ADS-C/ATS = riadenie, Q0/SQ/SA/_d = šum (odfiltrovaný a zoradený od najnovšej), neznámy = data s kódom, null = VDL', () => {
  assert.deepEqual(acarsLabelInfo('BA'), { kind: 'atc', name: 'CPDLC ↑ ACFT→ATC' });
  assert.equal(acarsLabelInfo('aa').kind, 'atc');
  assert.equal(acarsLabelInfo('5Z').kind, 'ops');
  assert.equal(acarsLabelInfo('QA').kind, 'ooi');
  assert.deepEqual(acarsLabelInfo('4A'), { kind: 'data', name: '4A' });
  assert.deepEqual(acarsLabelInfo(null), { kind: 'data', name: 'VDL' });
  const sorted = sortAcarsMessages([
    { t: '2026-09-08T03:00:00Z', label: 'H1' },
    { t: '2026-09-08T03:05:00Z', label: 'Q0' },
    { t: '2026-09-08T03:10:00Z', label: 'BA' },
    null,
  ]);
  assert.deepEqual(sorted.map((m) => m.label), ['BA', 'H1']);
});

test('ukážka textu a hodiny: CR/LF a riadiace znaky → medzera, orez s „…", UTC HH:MM', () => {
  assert.equal(acarsTextPreview('POS N33.6\r\nW116.3\x03\x00 FL250', 60), 'POS N33.6 W116.3 FL250');
  assert.equal(acarsTextPreview('abcdefghijklmnop', 8), 'abcdefg…');
  assert.equal(acarsTextPreview('   ', 8), '');
  assert.equal(acarsClock('2026-09-08T03:39:18.835Z'), '03:39');
  assert.equal(acarsClock('x'), '--:--');
});

test('riadok karty a riadky kokpitu: počet, čas, meno labelu, ukážka; prázdno/vypnuté = ""', () => {
  const entry = { messages: sortAcarsMessages([compactAirframesMessage(upstream), { t: '2026-09-08T03:40:00Z', label: 'BA', text: 'REQUEST CLIMB FL370' }]), stale: false, error: false, pending: false, disabled: false };
  assert.equal(acarsCardLine(entry), 'ACARS 2 · 03:40 CPDLC ↑ ACFT→ATC · REQUEST CLIMB FL370');
  assert.equal(acarsCardLine({ ...entry, stale: true }).startsWith('ACARS 2 · STALE · '), true);
  // Hexový H1 blok (787, namerané na KLM590) nie je čitateľný — karta ukáže len počet, čas a label; kokpit ho ako log ponechá.
  const hexEntry = { ...entry, messages: [{ t: '2026-09-08T03:54:43Z', label: 'H1', text: '004002000000\r\n0050000001140C64000000004002000000\r\n0074000001' }] };
  assert.equal(acarsCardLine(hexEntry), 'ACARS 1 · 03:54 DATA');
  assert.equal(acarsTextReadable('REQUEST CLIMB FL370'), true);
  assert.equal(acarsTextReadable('#M1BPOS/ID3C6444,DLH2ME/DTKSFO,,0356/ALT35000'), true);
  assert.equal(acarsTextReadable('0050000001140C64000000004002000000'), false);
  assert.equal(acarsTextReadable(''), false);
  assert.equal(acarsCockpitRows(hexEntry)[0].text.startsWith('004002000000 0050000001140C64'), true);
  assert.equal(acarsCardLine(null), '');
  assert.equal(acarsCardLine({ ...entry, messages: [] }), '', 'bez správ radšej nič než „0"');
  assert.equal(acarsCardLine({ ...entry, disabled: true }), '');
  const rows = acarsCockpitRows(entry, { limit: 1 });
  assert.deepEqual(rows, [{ time: '03:40', label: 'BA', kind: 'atc', name: 'CPDLC ↑ ACFT→ATC', text: 'REQUEST CLIMB FL370', station: '' }]);
  assert.equal(acarsCockpitRows(entry).length, 2);
  assert.equal(acarsStatusLine(entry, t), '2 msg · 24 h', 'placeholder sa dosadí');
  assert.equal(acarsStatusLine({ ...entry, error: true }, t), '2 msg · 24 h · STALE');
  assert.equal(acarsStatusLine({ ...entry, messages: [], pending: true }, t), 'cockpit.acars-pending');
  assert.equal(acarsStatusLine({ ...entry, messages: [], error: true }, t), 'cockpit.acars-unavailable');
  assert.equal(acarsStatusLine({ ...entry, messages: [] }, t), 'cockpit.acars-none');
  assert.equal(acarsStatusLine({ ...entry, disabled: true }, t), '');
});

test('klientska cache: dedup + TTL 60 s, onDone LEN po fetchi (nie z čerstvej cache), stale-if-error, {enabled:false} vypne zdroj natrvalo', async () => {
  resetAcarsCache();
  const calls = [];
  let nowMs = 1_000_000;
  const body = { enabled: true, stale: false, messages: [{ t: '2026-09-08T03:40:00Z', label: 'BA', text: 'X' }] };
  const fetcher = async (url) => { calls.push(url); return { ok: true, json: async () => body }; };
  let done = 0;
  assert.equal(await requestAcarsMessages('3C6444', { fetcher, nowMs, onDone: () => { done += 1; } }), true);
  assert.deepEqual(calls, ['/api/acars/messages?icao=3c6444'], 'hex malými (upstream ILIKE, a veľké písmená raz vrátili 404)');
  assert.equal(done, 1);
  assert.equal(cachedAcars('3C6444').messages.length, 1);
  assert.equal(await requestAcarsMessages('3c6444', { fetcher, nowMs: nowMs + ACARS_CACHE_TTL_MS - 1, onDone: () => { done += 1; } }), false, 'čerstvá cache');
  assert.equal(done, 1, 'onDone sa z cache nevolá — inak sa karta točí');
  assert.equal(await requestAcarsMessages('zz', { fetcher, nowMs }), false, 'nehex');
  // chyba po TTL: staré správy ostanú s príznakom stale, kratší TTL na retry
  nowMs += ACARS_CACHE_TTL_MS;
  const failing = async () => { throw new Error('boom'); };
  assert.equal(await requestAcarsMessages('3c6444', { fetcher: failing, nowMs }), true);
  const e = cachedAcars('3c6444');
  assert.equal(e.error, true);
  assert.equal(e.stale, true);
  assert.equal(e.messages.length, 1);
  assert.equal(e.ttl, ACARS_FAILURE_TTL_MS);
  // server hlási vypnuté → už sa nepýtame
  nowMs += ACARS_FAILURE_TTL_MS;
  const off = async () => ({ ok: true, json: async () => ({ enabled: false, messages: [] }) });
  assert.equal(await requestAcarsMessages('3c6444', { fetcher: off, nowMs }), true);
  assert.equal(isAcarsDisabled(), true);
  assert.equal(cachedAcars('3c6444').disabled, true);
  assert.equal(await requestAcarsMessages('abcdef', { fetcher, nowMs }), false);
  assert.equal(calls.length, 1, 'po vypnutí žiadny ďalší fetch');
  resetAcarsCache();
});

test('tripwire: proxy /api/acars je LEN LOKÁLNA (ACARS_MESSAGES + loopback), bez kľúča, s cache, stropom dopytov, Retry-After a zhutnením; karta aj kokpit ju používajú; atribúcia doslovne v markupe', () => {
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function airframesProxy\(\)/);
  assert.match(vite, /process\.env\.ACARS_MESSAGES/);
  assert.match(vite, /const local = isDirectLocalRequest\(req\);/, 'loopback soket nestačí — tunel doručuje verejnosť z 127.0.0.1 (2026-09-30)');
  assert.match(vite, /if \(!local\) return send\(403/);
  assert.match(vite, /if \(!on\) return send\(200, \{ enabled: false/);
  assert.match(vite, /api\.airframes\.io\/v1\/messages/);
  const proxyText = vite.slice(vite.indexOf('function airframesProxy()'), vite.indexOf('export { isLoopbackAddress };'));
  assert.ok(proxyText.length > 1000 && !/Bearer|X-API-KEY|AIRFRAMES_API_KEY/i.test(proxyText), 'žiadny kľúč — verejný endpoint, nič tajné nemá čo uniknúť');
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /this\.updateAcars\(info\);/, 'kokpit volá z updateRoute');
  assert.match(ui, /void requestAcarsMessages\(icao24, \{ onDone: \(\) => this\.renderAcars\(icao24\) \}\);/);
  assert.match(ui, /if \(!icao24 \|\| isAcarsDisabled\(\)\) \{\s*this\.renderAcars\(null\);/);
  assert.match(ui, /if \(this\.route\) this\.route\.hidden = true;\s*this\.renderAcars\(null\);/, 'výstup z kokpitu sekciu skryje');
  assert.match(ui, /li\.dataset\.kind = row\.kind;/, 'druh správy → farba (atc jantárovo)');
  assert.match(vite, /const RATE_PER_MIN = 30;/);
  assert.match(vite, /retry-after/);
  assert.match(vite, /json\.map\(compactAirframesMessage\)/);
  assert.match(vite, /exclude_labels=\$\{ACARS_NOISE_LABELS\.join\(','\)\}/);
  const plugins = vite.slice(vite.indexOf('    plugins: ['));
  assert.ok(plugins.includes('airframesProxy(),'));
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(flights, /acarsLine: acarsCardLine\(cachedAcars\(icao24\)\)/);
  assert.match(flights, /void requestAcarsMessages\(icao24, \{ onDone: \(\) => _updateTrackedLabelModel\(icao24\) \}\);/);
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cockpit-acars"[^>]*hidden/);
  assert.ok(html.includes(`>${ACARS_ATTRIBUTION}</a>`), 'predpísaná atribúcia doslovne, s odkazom');
  assert.match(html, /href="https:\/\/airframes\.io"/);
  const env = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.match(env, /^# ACARS_MESSAGES=on$/m, 'default vypnuté');
});
