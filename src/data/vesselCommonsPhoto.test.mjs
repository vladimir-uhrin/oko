// src/data/vesselCommonsPhoto.test.mjs — fotky lodí z Wikimedia Commons (2026-10-11; výber súboru večer, bod 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCommonsShipPhoto, parseCommonsImageInfo, parseCommonsMembers, pickCommonsFile, pickCommonsSubcategory, scoreCommonsFile, shipNameFromCategory } from './vesselCommonsPhoto.js';

test('kategória IMO: súbory s časom a podkategórie; len obrázky', () => {
  assert.deepEqual(parseCommonsMembers({ query: { categorymembers: [{ title: 'Category:Finnwave (ship, 2012)' }, { title: 'File:Finnwave.jpg', timestamp: '2024-05-01T00:00:00Z' }, { title: 'File:Plan.pdf' }] } }),
    { files: [{ title: 'File:Finnwave.jpg', timestamp: '2024-05-01T00:00:00Z' }], subcats: ['Category:Finnwave (ship, 2012)'] });
  assert.equal(shipNameFromCategory('Category:Finnwave (ship, 2012)'), 'Finnwave');
});

test('výber súboru: meno lode a nový súbor pred detailom komína; samé detaily = nič; podkategória s dnešným menom', () => {
  const files = [
    { title: 'File:Finnwave funnel detail.jpg', timestamp: '2025-01-01T00:00:00Z' },
    { title: 'File:Finnwave in Helsinki 2019.jpg', timestamp: '2019-06-01T00:00:00Z' },
    { title: 'File:Ship at Vuosaari.jpg', timestamp: '2024-01-01T00:00:00Z' },
  ];
  assert.equal(pickCommonsFile(files, { name: 'FINNWAVE' }).title, 'File:Finnwave in Helsinki 2019.jpg');
  assert.equal(pickCommonsFile(files, { name: '' }).title, 'File:Ship at Vuosaari.jpg', 'bez mena vyhrá najnovší nie-detail');
  assert.equal(pickCommonsFile([{ title: 'File:Finnwave bridge.jpg' }, { title: 'File:Finnwave logo.png' }], { name: 'Finnwave' }), null);
  assert.ok(scoreCommonsFile({ title: 'File:X IMO 9468932.jpg' }) > scoreCommonsFile({ title: 'File:X.jpg' }));
  assert.equal(pickCommonsSubcategory(['Category:Old Name (ship, 2001)', 'Category:Nordic Star (ship, 2001)'], { name: 'NORDIC STAR' }), 'Category:Nordic Star (ship, 2001)');
  assert.equal(pickCommonsSubcategory(['Category:Old Name (ship, 2001)'], { name: 'NORDIC STAR' }), 'Category:Old Name (ship, 2001)');
});

test('imageinfo: náhľad 330 px, autor bez HTML a licencia v kredite; bývalé meno v kredite', () => {
  const ii = { query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/1280px-F.jpg', url: 'https://upload.wikimedia.org/F.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:F.jpg',
    extmetadata: { Artist: { value: '<a href="//x">kallerna</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } };
  const p = parseCommonsImageInfo(ii);
  assert.equal(p.thumb, 'https://upload.wikimedia.org/x/330px-F.jpg');
  assert.equal(p.credit, 'Wikimedia Commons · kallerna · CC BY-SA 4.0');
  assert.equal(parseCommonsImageInfo(ii, { formerName: 'Old Name' }).credit, 'ako Old Name · Wikimedia Commons · kallerna · CC BY-SA 4.0');
});

test('hľadanie: IMO → podkategória lode → najlepší súbor; premenovaná loď dostane „ako …"; zlé IMO a chyba siete = null', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams;
    calls.push(q.get('cmtitle') || q.get('titles'));
    if (q.get('cmtitle') === 'Category:IMO 9468932') return { ok: true, json: async () => ({ query: { categorymembers: [{ title: 'Category:Finnwave (ship, 2012)' }] } }) };
    if (q.get('cmtitle') === 'Category:Finnwave (ship, 2012)') return { ok: true, json: async () => ({ query: { categorymembers: [{ title: 'File:Finnwave funnel.jpg', timestamp: '2025-01-01T00:00:00Z' }, { title: 'File:Finnwave.jpg', timestamp: '2020-01-01T00:00:00Z' }] } }) };
    if (q.get('titles') === 'File:Finnwave.jpg') return { ok: true, json: async () => ({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://u/1280px-F.jpg', descriptionurl: 'https://c/F', extmetadata: {} }] } } } }) };
    return { ok: false, status: 404 };
  };
  const p = await findCommonsShipPhoto('9468932', fetchImpl, { name: 'FINNWAVE' });
  assert.equal(p.full, 'https://u/1280px-F.jpg');
  assert.deepEqual(calls, ['Category:IMO 9468932', 'Category:Finnwave (ship, 2012)', 'File:Finnwave.jpg']);
  assert.equal(p.credit, 'Wikimedia Commons');
  const renamed = await findCommonsShipPhoto('9468932', fetchImpl, { name: 'NEW STAR' });
  assert.match(renamed.credit, /^ako Finnwave · Wikimedia Commons/);
  assert.equal(await findCommonsShipPhoto('123', fetchImpl), null);
  assert.equal(await findCommonsShipPhoto('9696888', async () => { throw new Error('net'); }), null);
});
