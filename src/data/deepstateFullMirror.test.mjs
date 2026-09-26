// src/data/deepstateFullMirror.test.mjs — sivá zóna z mirroru celej mapy DeepState
// (SmartFinn/wararchive-website, 2026-09-26, vlastník: „použi sivú zónu s mirrorov!").
// Výber commitu k dňu, model snímky, cache podľa SHA, pauza po chybe, napojenie
// v proxy (fallback na cyterat) a správanie vrstvy/legendy pri skutočnej sivej zóne.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEEPSTATE_FULL_MIRROR, createDeepStateFullMirror, deepstateSnapshotFromFullMirror, isUsableFullMirrorFile, pickCommitForDay,
} from './deepstateFullMirror.js';
import { deepstateMirrorAttribution, deepstateMirrorRepo } from './ukraineDeepState.js';
import { kartaLegendItems } from '../ukraineKartaOverlay.js';

const sq = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const feature = (name, coords) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: coords } });
const FILE = {
  type: 'FeatureCollection',
  features: [
    feature('Окупована територія /// Occupied /// geoJSON.status.occupied', sq(37.5, 48.0, 38.5, 48.8)),
    feature('Статус невідомий /// Unknown status /// geoJSON.status.unknown', sq(37.4, 48.0, 37.5, 48.8)),
    feature('Звільнено /// Liberated /// geoJSON.status.dismissed', sq(36.0, 49.0, 36.3, 49.3)),
    feature('Крим /// Crimea /// geoJSON.territories.crimea', sq(33, 44.5, 35, 46)),
    feature('Придністров’я /// Transnistria /// geoJSON.territories.transnistria', sq(29, 46.5, 29.5, 47.5)),
  ],
};

test('pickCommitForDay: posledný commit do konca dňa (UTC), poradie nehrá rolu', () => {
  const commits = [
    { sha: 'c', at: '2026-09-25T14:31:35Z' }, { sha: 'a', at: '2026-09-19T13:00:39Z' }, { sha: 'b', at: '2026-09-23T14:09:59Z' },
  ];
  assert.equal(pickCommitForDay(commits, '2026-09-26').sha, 'c');
  assert.equal(pickCommitForDay(commits, '2026-09-25').sha, 'c', 'commit v ten deň popoludní patrí k tomu dňu');
  assert.equal(pickCommitForDay(commits, '2026-09-24').sha, 'b');
  assert.equal(pickCommitForDay(commits, '2026-09-18'), null);
  assert.equal(pickCommitForDay(commits, 'včera'), null);
  assert.equal(DEEPSTATE_FULL_MIRROR.firstDay, '2025-06-29');
});

test('snímka z mirroru celej mapy: druhy ako archív z API (sivá zóna, oslobodené, Krym), bez Podnesterska; čas = commit', () => {
  assert.equal(isUsableFullMirrorFile(FILE), true);
  assert.equal(isUsableFullMirrorFile({ type: 'FeatureCollection', features: [FILE.features[1]] }), false, 'bez okupovaného nepoužiteľné');
  const snap = deepstateSnapshotFromFullMirror(FILE, { commitAt: '2026-09-25T14:31:35Z', sha: 'abc', requestedDay: '2026-09-26' });
  assert.deepEqual(snap.counts, { occupied: 1, grey: 1, liberated: 1, crimea: 1 });
  assert.equal(snap.source, 'mirror');
  assert.equal(snap.mirror, 'wararchive');
  assert.equal(snap.day, '2026-09-25');
  assert.equal(snap.at, '2026-09-25T14:31:35.000Z');
  assert.equal(snap.atApprox, true);
  assert.equal(snap.fallbackDays, 1);
  assert.equal(snap.mirrorSha, 'abc');
  assert.equal(deepstateMirrorRepo('wararchive'), 'SmartFinn/wararchive-website');
  assert.match(deepstateMirrorAttribution('wararchive'), /SmartFinn\/wararchive-website.*grey zone/);
});

test('jadro: zoznam commitov raz, súbor podľa SHA na disk (nemenný), pauza po chybe, deň pred históriou', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-dsfull-'));
  try {
    let t = Date.parse('2026-09-26T12:00:00Z');
    const calls = [];
    let fail = false;
    const fetchImpl = async (url) => {
      calls.push(url);
      if (fail) return { ok: false, status: 403, headers: { get: () => null }, text: async () => '' };
      if (url.includes('/commits?')) {
        const page = Number(/[?&]page=(\d+)/.exec(url)[1]); // nie „per_page=100"
        const list = page === 1 ? [{ sha: 'sha2', commit: { committer: { date: '2026-09-25T14:31:35Z' } } }, { sha: 'sha1', commit: { committer: { date: '2026-09-19T13:00:39Z' } } }] : [];
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(list) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(FILE) };
    };
    const m = createDeepStateFullMirror({ cacheDir: dir, fetchImpl, now: () => t, log: () => {} });
    const r = await m.lookup('2026-09-26');
    assert.equal(r.found.sha, 'sha2');
    assert.equal(r.found.at, '2026-09-25T14:31:35Z');
    assert.ok(existsSync(path.join(dir, 'sha2.geojson')) && existsSync(path.join(dir, 'commits.json')));
    assert.match(calls[0], /api\.github\.com\/repos\/SmartFinn\/wararchive-website\/commits\?path=data%2Fdeepstate\.geojson&per_page=100&page=1/);
    assert.match(calls.at(-1), /raw\.githubusercontent\.com\/SmartFinn\/wararchive-website\/sha2\/data\/deepstate\.geojson/);
    const n = calls.length;
    assert.equal((await m.lookup('2026-09-20')).found.sha, 'sha1');
    assert.equal(calls.length, n + 1, 'zoznam z pamäte, len nový súbor');
    assert.equal((await m.lookup('2026-09-26')).found.sha, 'sha2');
    assert.equal(calls.length, n + 1, 'súbor z pamäte');
    assert.equal((await m.lookup('2025-01-01')).reason, 'before_mirror');
    assert.equal((await m.lookup('2026-09-10')).reason, 'no_commit');
    // nový proces: zoznam aj súbor z disku, bez siete
    const m2 = createDeepStateFullMirror({ cacheDir: dir, fetchImpl: async () => { throw new Error('offline'); }, now: () => t, log: () => {} });
    assert.equal((await m2.lookup('2026-09-26')).found.sha, 'sha2');
    // po 3 h sa zoznam obnovuje; chyba = pauza, starý zoznam ostáva použiteľný
    t += 4 * 3_600_000; fail = true;
    const r3 = await m.lookup('2026-09-26');
    assert.equal(r3.found.sha, 'sha2', 'so starým zoznamom pokračuje');
    assert.ok(m._state().pausedUntil > t, 'pauza po 403');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('proxy: celá mapa má prednosť, príliš starý súbor alebo výpadok → cyterat; zapína ju len vite.config.js', () => {
  const src = readFileSync(new URL('./ukraineEventsProxy.js', import.meta.url), 'utf8');
  assert.match(src, /deepstateMirror = null, deepstateFullMirror = null \} = \{\}\)/);
  assert.match(src, /const fullMirrorOn = mirrorOn && Boolean\(deepstateFullMirror\) && String\(env\.UKRAINE_DEEPSTATE_FULL_MIRROR \|\| ''\)\.toLowerCase\(\) !== 'off';/);
  assert.match(src, /snapshot\.fallbackDays <= FULL_MIRROR_MAX_AGE_DAYS/);
  assert.match(src, /license: DEEPSTATE_FULL_MIRROR_LICENSE, note: DEEPSTATE_FULL_MIRROR_NOTE/);
  const iFull = src.indexOf('await deepstateFullMirror.lookup(dayReq)');
  const iCyt = src.indexOf("await getMirror().lookup({ requestedDate: key, maxFallback: 7 })");
  assert.ok(iFull > 0 && iCyt > iFull, 'najprv celá mapa, potom cyterat');
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /ukraineEventsProxy\(\{ deepstateMirror: createDeepStateMirror\(\{ mirrors: DEEPSTATE_MIRRORS \}\), deepstateFullMirror: createDeepStateFullMirror\(\) \}\)/);
});

test('vrstva a legenda: skutočná sivá zóna vypne odvodený pás; KARTA ju kreslí oranžovou šrafou; legenda „grey" a oslobodené', () => {
  const src = readFileSync(new URL('../ukraineDeepStateLayer.js', import.meta.url), 'utf8');
  assert.match(src, /if \(\(st\.zone \|\| st\.combatBand\) && _contact\.length && !hasGrey\) \{/);
  assert.match(src, /const partial = _snapshot\?\.source === 'mirror' && !_polyIndex\.some\(\(p\) => p\.kind === 'grey'\);/);
  const t = (k) => k;
  const full = { shown: true, source: 'mirror', features: 5, contact: 1, style: 'karta', counts: { occupied: 1, grey: 3, liberated: 2 } };
  const keys = kartaLegendItems({ deepstate: full, translate: t });
  const grey = keys.find((i) => i.key === 'grey');
  assert.ok(grey && grey.colorCss === '#f0922e' && grey.pattern === 'hatch', 'sivá zóna oranžovou šrafou');
  assert.ok(!keys.some((i) => i.key === 'contested'), 'odvodený pás v legende nie');
  assert.ok(keys.some((i) => i.key === 'liberated'), 'oslobodené má vzorku, keď je na mape');
  const partial = kartaLegendItems({ deepstate: { ...full, counts: { occupied: 1 } }, translate: t }).map((i) => i.key);
  assert.ok(partial.includes('contested') && !partial.includes('grey') && !partial.includes('liberated'), 'neúplný mirror = odvodený pás');
  // Oslobodené na KARTE bez obrysov (čiary naprieč Charkivskou oblasťou rušili); výplň ostáva.
  assert.match(src, /noLiberatedOutline: true,/);
  assert.match(src, /if \(!\(st\.noLiberatedOutline && \(f\.kind === 'liberated' \|\| f\.kind === 'liberated-recent'\)\)\) ds\.entities\.add\(\{/);
  const tl = readFileSync(new URL('../ukraineTimeline.js', import.meta.url), 'utf8');
  assert.match(tl, /dsBox\?\.classList\.toggle\('is-mirror', st\.source === 'mirror' && !hasGrey\);/);
  assert.match(tl, /mirror: deepstateMirrorRepo\(st\.mirror\)/);
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-ukr-tl-ds\.has-grey \.is-ds-zone,\n\.oko-ukr-tl-ds\.has-grey \.is-ds-zone-ru \{ display: none; \}/);
});

test('podklad: hranica oblasti na KARTE plná biela, mimo KARTY čiarkovaná', () => {
  const src = readFileSync(new URL('./ukraineBaseLayer.js', import.meta.url), 'utf8');
  assert.match(src, /export const OBLAST_KARTA_STYLE = Object\.freeze\(\{ width: 2\.2, color: '#e8eef3', alpha: 0\.78 \}\);/);
  assert.match(src, /item\.entity\.polyline\.material = karta \? oblastKartaMaterial : oblastMaterial;/);
  assert.match(src, /\{ line: OBLAST_STYLE\.width, oblast: true \}\);/);
});
