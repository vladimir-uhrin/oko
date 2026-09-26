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
  const seenDomains = new Map();
  for (const outlet of SANCTIONED_MEDIA) {
    assert.ok(['annex-xv', 'annex-i', 'eu-iran-hr', 'eu-terror-list', 'eu-yemen'].includes(outlet.basis), outlet.name);
    assert.ok(outlet.domains.length >= 1, outlet.name);
    for (const d of outlet.domains) {
      assert.doesNotMatch(d, /^www\./, `bez www.: ${d}`);
      assert.equal(d, d.toLowerCase(), `malé písmená: ${d}`);
      // Doména patrí práve jednému záznamu — index je Map a posledný by ticho vyhral.
      assert.equal(seenDomains.has(d), false, `doména ${d} je v dvoch záznamoch (${seenDomains.get(d)} a ${outlet.name})`);
      seenDomains.set(d, outlet.name);
    }
    // Blízky východ: každý záznam mimo prílohy XV/I nesie právny akt alebo odvodený dôvod.
    if (!['annex-xv', 'annex-i'].includes(outlet.basis)) assert.ok(outlet.note && outlet.note.length > 10, `note: ${outlet.name}`);
  }
});

test('Blízky východ (2026-09-26): Irán, Jemen, Libanon, Palestína — domény, subdomény, URL', () => {
  // Irán — nar. 359/2011 (Press TV, IRIB a jej kanály, Tasnim) a teroristický zoznam (IRGC → Sepah, preventívne Fars).
  assert.equal(sanctionedMediaFor('presstv.ir').basis, 'eu-iran-hr');
  assert.equal(isSanctionedMediaHost('french.presstv.co.uk'), true, 'subdoména Press TV');
  assert.equal(isSanctionedMediaUrl('https://www.presstv.ir/Detail/2026/09/24/x'), true);
  assert.equal(isSanctionedMediaHost('iribnews.ir'), true);
  assert.equal(isSanctionedMediaHost('en.hispantv.com'), true, 'kanál IRIB');
  assert.equal(isSanctionedMediaHost('yjc.ir'), true, 'YJC = IRIB');
  assert.equal(isSanctionedMediaUrl('https://www.tasnimnews.com/en/news/2026/09/24/1'), true);
  assert.equal(sanctionedMediaFor('sepahnews.ir').basis, 'eu-terror-list');
  assert.equal(sanctionedMediaFor('farsnews.ir').basis, 'eu-terror-list', 'Fars preventívne (IRGC)');
  assert.match(sanctionedMediaFor('farsnews.ir').name, /precautionary/, 'preventívny záznam to hovorí v mene');
  // Jemen — nar. 1352/2014 (Ansarallah): Al-Masirah a Saba zo Saná; Saba z Adenu prejde.
  assert.equal(sanctionedMediaFor('english.masirahtv.net').basis, 'eu-yemen');
  assert.equal(isSanctionedMediaHost('almasirah.net.ye'), true);
  assert.equal(isSanctionedMediaHost('saba.ye'), true, 'Saná');
  assert.equal(isSanctionedMediaHost('sabanew.net'), false, 'Aden — uznaná vláda, nie je listovaná');
  // Libanon — Hizballáh (preventívne), Palestína — Hamas, PIJ.
  assert.equal(sanctionedMediaFor('english.almanar.com.lb').basis, 'eu-terror-list');
  assert.equal(isSanctionedMediaHost('alqassam.ps'), true);
  assert.equal(isSanctionedMediaHost('english.palinfo.com'), true);
  assert.equal(isSanctionedMediaHost('saraya.ps'), true);
});

test('Blízky východ: čo NIE je listované prejde — priame feedy regiónu a nelistované štátne agentúry', () => {
  for (const host of ['aljazeera.com', 'feeds.bbci.co.uk', 'bbc.com', 'iranintl.com', 'irna.ir', 'en.irna.ir', 'mehrnews.com', 'almayadeen.net', 'nna-leb.gov.lb', 'timesofisrael.com', 'haaretz.com', 'thenationalnews.com', 'english.aawsat.com', 'sabanew.net', 'paltoday.ps', 'presstv.ir.example.com', 'notpresstv.ir']) {
    assert.equal(isSanctionedMediaHost(host), false, host);
  }
});

test('filterSanctionedNews vyhodí aj podľa sourceHost (Google News: url = presmerovanie, source = meno vydavateľa)', () => {
  const { items, dropped } = filterSanctionedNews([
    { title: 'a', url: 'https://news.google.com/rss/articles/abc', source: 'Press TV', sourceHost: 'presstv.ir' },
    { title: 'b', url: 'https://news.google.com/rss/articles/def', source: 'Al Jazeera', sourceHost: 'aljazeera.com' },
    { title: 'c', url: 'https://news.google.com/rss/articles/ghi', source: 'Tasnim News Agency' },
  ]);
  assert.deepEqual(items.map((i) => i.title), ['b', 'c'], 'bez sourceHost sa meno vydavateľa nedá overiť — položka prejde (známy limit, preto proxy sourceHost dopĺňa)');
  assert.equal(dropped, 1);
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
