// src/shareTargets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  buildAttributionLine,
  buildShareCopy,
  buildShareTargets,
  dataUrlByteLength,
  fitCover,
  shortShareUrl,
} from './shareTargets.js';

test('fitCover: širší zdroj oreže boky, vyšší zdroj oreže hore/dole, rovnaký pomer bez orezu, zlý vstup bezpečne', () => {
  assert.equal(SHARE_IMAGE_WIDTH, 1200);
  assert.equal(SHARE_IMAGE_HEIGHT, 630);
  assert.deepEqual(fitCover(1920, 1080, 1200, 630), { sx: 0, sy: 36, sw: 1920, sh: 1008 }, '16:9 → 1,9:1 oreže pás hore a dole');
  assert.deepEqual(fitCover(375, 812, 1200, 630), { sx: 0, sy: 308, sw: 375, sh: 197 }, 'telefón na výšku: stred');
  assert.deepEqual(fitCover(2400, 1260, 1200, 630), { sx: 0, sy: 0, sw: 2400, sh: 1260 }, 'rovnaký pomer bez orezu');
  assert.deepEqual(fitCover(0, 0, 1200, 630), { sx: 0, sy: 0, sw: 0, sh: 0 });
});

test('buildShareCopy: názov z objektu a miesta, popis z vrstiev a času, EN/SK', () => {
  const when = Date.UTC(2026, 8, 14, 12, 26);
  const sk = buildShareCopy({ subjectLabel: 'SWR11H', placeLabel: 'Bratislava', layerNames: ['Lietadlá', 'Plyn'], whenMs: when, lang: 'sk' });
  assert.equal(sk.title, 'OKO · SWR11H · Bratislava');
  assert.match(sk.description, /^Lietadlá, Plyn · .*2026/);
  assert.equal(sk.text, `${sk.title} — ${sk.description}`);
  const en = buildShareCopy({ layerNames: [], whenMs: when, lang: 'en' });
  assert.equal(en.title, 'OKO');
  assert.match(en.description, /^Live globe · /);
  const many = buildShareCopy({ layerNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], whenMs: when, lang: 'sk' });
  assert.match(many.description, /^a, b, c, d, e \+2 ďalších · /);
});

test('buildShareTargets: osem sietí v poradí, odkaz zakódovaný, text s odkazom tam, kde sieť nemá url parameter', () => {
  const targets = buildShareTargets({ url: 'https://oko.uhrin.digital/s/abc123', text: 'OKO · SWR11H — Lietadlá', title: 'OKO · SWR11H' });
  assert.deepEqual(targets.map((t) => t.id), ['facebook', 'x', 'linkedin', 'threads', 'bluesky', 'whatsapp', 'telegram', 'email']);
  assert.equal(targets[0].href, 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Foko.uhrin.digital%2Fs%2Fabc123');
  assert.match(targets[1].href, /^https:\/\/twitter\.com\/intent\/tweet\?url=https%3A%2F%2Foko\.uhrin\.digital%2Fs%2Fabc123&text=OKO/);
  assert.match(targets[3].href, /threads\.net\/intent\/post\?text=.*abc123$/, 'Threads: text aj odkaz v jednom');
  assert.match(targets[5].href, /^https:\/\/wa\.me\/\?text=.*Lietadl%C3%A1%20https%3A%2F%2Foko/);
  assert.match(targets[7].href, /^mailto:\?subject=OKO%20%C2%B7%20SWR11H&body=/);
  assert.deepEqual(buildShareTargets({ url: '' }), []);
});

test('buildAttributionLine: z kreditov Cesia bez odkazov, Google a Cesium ion vždy, bez duplicít', () => {
  assert.equal(buildAttributionLine('Cesium ion · Upgrade for commercial use · Google Maps · Data attribution'), '© Google · Cesium ion');
  assert.equal(buildAttributionLine('Cesium ion · Google · Airbus · CNES / Airbus · Maxar Technologies'), '© Google · Cesium ion · Airbus · CNES / Airbus · Maxar Technologies');
  assert.equal(buildAttributionLine(''), '© Google · Cesium ion');
  assert.equal(buildAttributionLine(null), '© Google · Cesium ion');
});

test('dataUrlByteLength: base64 dĺžka → bajty, bez čiarky 0', () => {
  assert.equal(dataUrlByteLength(`data:image/jpeg;base64,${Buffer.alloc(300, 1).toString('base64')}`), 300);
  assert.equal(dataUrlByteLength(`data:image/jpeg;base64,${Buffer.alloc(301, 1).toString('base64')}`), 301);
  assert.equal(dataUrlByteLength('nope'), 0);
});

test('shortShareUrl: pôvod bez lomky na konci, id bez cudzích znakov', () => {
  assert.equal(shortShareUrl('https://oko.uhrin.digital/', 'Ab12cd34EF'), 'https://oko.uhrin.digital/s/Ab12cd34EF');
  assert.equal(shortShareUrl('http://localhost:4173', 'x/../y'), 'http://localhost:4173/s/xy');
  assert.equal(shortShareUrl('', 'abc'), null);
  assert.equal(shortShareUrl('https://x', ''), null);
});
