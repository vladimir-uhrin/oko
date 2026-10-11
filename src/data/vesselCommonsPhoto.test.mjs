// src/data/vesselCommonsPhoto.test.mjs — fotky lodí z Wikimedia Commons (2026-10-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCommonsShipPhoto, parseCommonsImageInfo, parseCommonsMembers } from './vesselCommonsPhoto.js';

test('kategória IMO: súbory a podkategórie; len obrázky', () => {
  assert.deepEqual(parseCommonsMembers({ query: { categorymembers: [{ title: 'Category:Finnwave (ship, 2012)' }, { title: 'File:Finnwave.jpg' }, { title: 'File:Plan.pdf' }] } }),
    { files: ['File:Finnwave.jpg'], subcats: ['Category:Finnwave (ship, 2012)'] });
});

test('imageinfo: náhľad 330 px (Wikimedia berie len štandardné šírky; 320 = chyba 400), autor bez HTML a licencia v kredite', () => {
  const p = parseCommonsImageInfo({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/1280px-F.jpg', url: 'https://upload.wikimedia.org/F.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:F.jpg',
    extmetadata: { Artist: { value: '<a href="//x">kallerna</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } });
  assert.equal(p.thumb, 'https://upload.wikimedia.org/x/330px-F.jpg');
  assert.equal(p.credit, 'Wikimedia Commons · kallerna · CC BY-SA 4.0');
  assert.equal(p.page, 'https://commons.wikimedia.org/wiki/File:F.jpg');
});

test('hľadanie: IMO → podkategória lode → prvá fotka; zlé IMO a chyba siete = null', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams;
    calls.push(q.get('cmtitle') || q.get('titles'));
    if (q.get('cmtitle') === 'Category:IMO 9468932') return { ok: true, json: async () => ({ query: { categorymembers: [{ title: 'Category:Finnwave (ship, 2012)' }] } }) };
    if (q.get('cmtitle') === 'Category:Finnwave (ship, 2012)') return { ok: true, json: async () => ({ query: { categorymembers: [{ title: 'File:Finnwave.jpg' }] } }) };
    if (q.get('titles') === 'File:Finnwave.jpg') return { ok: true, json: async () => ({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://u/1280px-F.jpg', descriptionurl: 'https://c/F', extmetadata: {} }] } } } }) };
    return { ok: false, status: 404 };
  };
  const p = await findCommonsShipPhoto('9468932', fetchImpl);
  assert.equal(p.full, 'https://u/1280px-F.jpg');
  assert.deepEqual(calls, ['Category:IMO 9468932', 'Category:Finnwave (ship, 2012)', 'File:Finnwave.jpg']);
  assert.equal(await findCommonsShipPhoto('123', fetchImpl), null);
  assert.equal(await findCommonsShipPhoto('9696888', async () => { throw new Error('net'); }), null);
});
