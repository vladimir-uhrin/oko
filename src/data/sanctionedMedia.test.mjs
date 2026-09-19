// src/data/sanctionedMedia.test.mjs — blocklist médií prílohy XV (+ Rybar): domény,
// subdomény, cesty na t.me, filter správ; TASS zámerne mimo.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SANCTIONED_MEDIA,
  SANCTIONED_MEDIA_STATUS,
  filterSanctionedNews,
  isSanctionedMediaHost,
  isSanctionedMediaUrl,
  sanctionedMediaFor,
} from './sanctionedMedia.js';

test('zoznam má dátum overenia, právny základ a zdroje', () => {
  assert.match(SANCTIONED_MEDIA_STATUS.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(SANCTIONED_MEDIA_STATUS.basis, /Annex XV/);
  assert.ok(SANCTIONED_MEDIA_STATUS.sources.some((u) => u.includes('eur-lex')));
  assert.ok(SANCTIONED_MEDIA.length >= 20);
  for (const outlet of SANCTIONED_MEDIA) {
    assert.ok(['annex-xv', 'annex-i'].includes(outlet.basis), outlet.name);
    assert.ok(outlet.domains.length >= 1, outlet.name);
    for (const d of outlet.domains) assert.doesNotMatch(d, /^www\./, `bez www.: ${d}`);
  }
});

test('domény, subdomény, veľkosť písmen, www, URL s cestou', () => {
  assert.equal(isSanctionedMediaHost('rt.com'), true);
  assert.equal(isSanctionedMediaHost('www.RT.com'), true);
  assert.equal(isSanctionedMediaHost('russian.rt.com'), true, 'subdoména');
  assert.equal(isSanctionedMediaHost('ria.ru'), true);
  assert.equal(isSanctionedMediaHost('lenta.ru'), true);
  assert.equal(isSanctionedMediaHost('tvzvezda.ru'), true);
  assert.equal(isSanctionedMediaHost('ukraina.ru'), true, 'projekt RIA');
  assert.equal(isSanctionedMediaUrl('https://www.rt.com/news/12345-x/'), true);
  assert.equal(isSanctionedMediaUrl('https://ria.ru/20260919/x.html'), true);
  assert.equal(sanctionedMediaFor('iz.ru').basis, 'annex-xv');
  assert.equal(sanctionedMediaFor('nope.example'), null);
  assert.equal(sanctionedMediaFor(''), null);
});

test('Rybar: doména aj kanál na Telegrame (príloha I, nie XV)', () => {
  assert.equal(sanctionedMediaFor('map.rybar.ru').basis, 'annex-i');
  assert.equal(isSanctionedMediaUrl('https://t.me/rybar/12345'), true);
  assert.equal(isSanctionedMediaUrl('https://t.me/s/rybar'), true);
  assert.equal(isSanctionedMediaUrl('https://t.me/GeneralStaffZSU/1'), false, 'iný kanál na tej istej doméne prejde');
});

test('čo NIE je na zozname prejde: TASS (stav 12/2025), Meduza, Kyiv Independent, BBC, podobné mená', () => {
  for (const host of ['tass.com', 'tass.ru', 'meduza.io', 'kyivindependent.com', 'bbc.co.uk', 'understandingwar.org', 'armyinform.com.ua', 'rt.com.au', 'party.com', 'lenta.ru.example.com']) {
    assert.equal(isSanctionedMediaHost(host), false, host);
  }
  assert.equal(isSanctionedMediaHost('notrt.com'), false, 'zhoda len na hranici domény');
});

test('filterSanctionedNews vyhodí podľa URL aj podľa source a spočíta vyhodené', () => {
  const { items, dropped } = filterSanctionedNews([
    { title: 'a', url: 'https://kyivindependent.com/x', source: 'kyivindependent.com' },
    { title: 'b', url: 'https://ria.ru/x', source: 'ria.ru' },
    { title: 'c', url: 'https://news.google.com/rss/articles/abc', source: 'lenta.ru' },
    { title: 'd', url: 'https://www.bbc.co.uk/news/x', source: 'BBC News' },
    null,
  ]);
  assert.deepEqual(items.map((i) => i.title), ['a', 'd']);
  assert.equal(dropped, 2);
  assert.deepEqual(filterSanctionedNews(null), { items: [], dropped: 0 });
});
