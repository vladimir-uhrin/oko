// src/cockpitTower.test.mjs
// Veža cieľa v kokpite — LEN ONLINE STREAMY (2026-09-08): YouTube embed + vlastný stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { towerPickCamera, towerSearchQuery, towerSignature, towerSources, towerStatusLine } from './cockpitTower.js';

const DICT = {
  'cockpit.tower-own': 'own stream',
  'cockpit.tower-youtube': 'YouTube · {provider}',
  'cockpit.tower-searching': 'looking for a live stream…',
  'cockpit.tower-none': 'no online stream for {icao}',
};
const t = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), DICT[key] ?? key);

test('zdroje: kurátorovaná YouTube kamera (LKPR) hneď, vlastný stream z konfigurácie, vyhľadanie z cache; bez ICAO nič', () => {
  const lkpr = towerSources({ icao: 'lkpr' });
  assert.equal(lkpr.icao, 'LKPR');
  assert.equal(lkpr.camera?.videoId, 'kuOmmVkOGN8');
  assert.equal(lkpr.own, null);
  const own = towerSources({ icao: 'LZIB', streams: { LZIB: { url: 'https://example.org/lzib.mp3', label: 'BTS TWR' } } });
  assert.deepEqual(own.own, { url: 'https://example.org/lzib.mp3', label: 'BTS TWR' });
  assert.equal(own.camera, null);
  const found = towerSources({ icao: 'LOWW', lookup: { at: 1, camera: { videoId: 'abcdefghijk', provider: 'Kanál', source: 'search' } } });
  assert.equal(found.camera.videoId, 'abcdefghijk');
  assert.equal(towerSources({ icao: 'LOWW', searching: true }).searching, true);
  assert.equal(towerSources({ icao: 'LKPR', searching: true }).searching, false, 'kurátorovaná kamera = nehľadá sa');
  assert.equal(towerSources({ icao: '' }).icao, null);
  assert.equal(towerSources({ icao: 'LZIB', streams: { LZIB: 'ftp://x' } }).own, null, 'len http(s)');
});

test('stav: ICAO + zdroje; hľadá sa; nič = poctivé „žiadny online stream"', () => {
  assert.equal(towerStatusLine(towerSources({ icao: 'LKPR' }), t), 'LKPR · YouTube · SlowTV');
  const both = towerSources({ icao: 'LKPR', streams: { LKPR: 'https://example.org/a.mp3' } });
  assert.equal(towerStatusLine(both, t), 'LKPR · own stream + YouTube · SlowTV');
  assert.equal(towerStatusLine(towerSources({ icao: 'LZIB', searching: true }), t), 'LZIB · looking for a live stream…');
  assert.equal(towerStatusLine(towerSources({ icao: 'LZIB' }), t), 'no online stream for LZIB');
  assert.equal(towerStatusLine(towerSources({ icao: null }), t), '');
});

test('podpis: mení sa s ICAO, URL vlastného streamu, videom a stavom hľadania', () => {
  const a = towerSignature(towerSources({ icao: 'LKPR' }));
  const b = towerSignature(towerSources({ icao: 'LKPR', streams: { LKPR: 'https://e.org/x' } }));
  const c = towerSignature(towerSources({ icao: 'LZIB', searching: true }));
  assert.notEqual(a, b);
  assert.equal(c, 'LZIB|||s');
  assert.equal(towerSignature(towerSources({ icao: '' })), '');
});

test('vyhľadanie: dopyt zo záznamu letiska, výber len skutočne živého výsledku', () => {
  const airport = { icao: 'LOWW', iata: 'VIE', name: 'Vienna International Airport', municipality: 'Vienna' };
  assert.equal(towerSearchQuery(airport), 'Vienna Vienna airport VIE live'.replace('Vienna Vienna', 'Vienna'));
  const payload = { items: [
    { id: { videoId: 'aaaaaaaaaaa' }, snippet: { title: 'MSFS Vienna landing gameplay', liveBroadcastContent: 'live', channelTitle: 'Sim' } },
    { id: { videoId: 'bbbbbbbbbbb' }, snippet: { title: 'Vienna Airport VIE live cam + ATC', liveBroadcastContent: 'live', channelTitle: 'Cam' } },
  ] };
  assert.equal(towerPickCamera(payload, airport)?.videoId, 'bbbbbbbbbbb');
});

test('tripwire: kokpit má sekciu #cockpit-tower (skrytú, s <audio> a <iframe about:blank>), ui.js ju plní z updateDestinationServices a pri výstupe zhasne; žiadny LiveATC/Broadcastify stream', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<section id="cockpit-tower"[^>]*hidden>/);
  assert.match(html, /<audio id="cockpit-tower-audio"[^>]*preload="none"[^>]*hidden>/);
  assert.match(html, /<iframe id="cockpit-tower-frame"[^>]*src="about:blank"/);
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /this\.updateTower\(airport\?\.icao \?\? destination\?\.icao \?\? null, airport\);/);
  assert.match(ui, /this\.renderAcars\(null\);\s*this\.renderTower\(null\);/, 'výstup z kokpitu zastaví zvuk aj video');
  assert.match(ui, /atc-streams\.local\.json/);
  assert.match(ui, /\/api\/youtube-live\?q=/);
  assert.ok(!/liveatc\.net\/(play|hlisten|archive)|broadcastify\.com\/listen/i.test(ui), 'žiadne streamy LiveATC/Broadcastify');
  const tower = readFileSync(new URL('./cockpitTower.js', import.meta.url), 'utf8');
  assert.ok(!/liveatc\.net|broadcastify/i.test(tower.replace(/\/\/.*$/gm, '')), 'v kóde (mimo komentárov) žiadny LiveATC/Broadcastify');
  const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  for (const key of ['cockpit.tower-kicker', 'cockpit.tower-none', 'cockpit.tower-why']) {
    assert.equal((i18n.match(new RegExp(`'${key.replace('.', '\\.')}'`, 'g')) || []).length, 2, `${key} EN + SK`);
  }
});
