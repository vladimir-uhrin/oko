import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SITUATION_REGIONS,
  buildSituationModel,
  fetchSituationNews,
  gdeltDocUrl,
  isDirectNewsUrl,
  mergeNewsItems,
  normalizeDirectFeed,
  parseGdeltArticles,
  parseGdeltDate,
  relativeAge,
} from './situationNews.js';
import { isSanctionedMediaUrl } from './sanctionedMedia.js';

test('the gulf region carries a Hormuz/Gulf GDELT query', () => {
  assert.ok(SITUATION_REGIONS.gulf);
  assert.match(SITUATION_REGIONS.gulf.query, /Hormuz/);
  assert.match(SITUATION_REGIONS.gulf.query, /Persian Gulf/);
});

test('the gulf region carries an RSS fallback query for when GDELT throttles', () => {
  assert.match(SITUATION_REGIONS.gulf.rssQuery, /Hormuz/);
  assert.match(SITUATION_REGIONS.gulf.rssQuery, /Gulf of Oman/);
});

test('the mideast region is a broad conflict feed with its own query + match', () => {
  assert.ok(SITUATION_REGIONS.mideast, 'mideast region exists');
  assert.match(SITUATION_REGIONS.mideast.query, /Red Sea/);
  assert.match(SITUATION_REGIONS.mideast.query, /Suez Canal/);
  assert.ok(Array.isArray(SITUATION_REGIONS.mideast.directRss) && SITUATION_REGIONS.mideast.directRss.length >= 2);
  const re = new RegExp(SITUATION_REGIONS.mideast.match, 'i');
  assert.match('Houthi drone over the Red Sea', re);
  assert.match('Israeli strike near Damascus', re);
  assert.doesNotMatch('Local election results in Ohio', re);
});

test('the gulf region carries direct publisher RSS feeds + a region match', () => {
  assert.ok(Array.isArray(SITUATION_REGIONS.gulf.directRss) && SITUATION_REGIONS.gulf.directRss.length >= 2);
  // reťazec (staršie regióny) aj objekt s pravidlami (od 2026-09-26 aj ZÁLIV)
  assert.ok(SITUATION_REGIONS.gulf.directRss.every((u) => /^https:\/\//.test(typeof u === 'string' ? u : u.url)));
  assert.match('Tanker struck near Hormuz', new RegExp(SITUATION_REGIONS.gulf.match, 'i'));
  assert.doesNotMatch('Local election results in Ohio', new RegExp(SITUATION_REGIONS.gulf.match, 'i'));
});

// BLÍZKY VÝCHOD etapa 3 (2026-09-26): jeden región správ na dejisko.
const THEATRE_REGIONS = ['iran', 'lebanon', 'palestine', 'israel', 'redsea', 'syria', 'iraq'];

test('every Middle East theatre region has a GDELT query, a Google fallback and a title filter', () => {
  for (const id of THEATRE_REGIONS) {
    const r = SITUATION_REGIONS[id];
    assert.ok(r, id);
    assert.equal(r.id, id);
    assert.match(r.query, /sourcelang:english$/, `${id}: len anglické zdroje (preklad ide EN→SK)`);
    assert.match(r.query, /^\(.+\) \(.+\) sourcelang:english$/, `${id}: (miesta) (činnosť) jazyk`);
    assert.ok(typeof r.rssQuery === 'string' && r.rssQuery.length > 5, id);
    assert.equal(r.timespan, '2d');
    assert.ok(Number.isFinite(r.googleLimit) && r.googleLimit <= 20, id);
    assert.doesNotThrow(() => new RegExp(r.match, 'i'), id);
  }
});

test('the theatre title filters keep their theatre and drop the neighbours', () => {
  const m = (id) => new RegExp(SITUATION_REGIONS[id].match, 'i');
  assert.match('Israeli strike hits Isfahan air base', m('iran'));
  assert.match('IRGC navy seizes tanker', m('iran'));
  assert.match('Israeli drone strike in Nabatieh kills two', m('lebanon'));
  assert.match('UNIFIL reports fire near Naqoura', m('lebanon'));
  assert.match('Strike on Khan Younis tent camp', m('palestine'));
  assert.match('Settler attack near Nablus', m('palestine'));
  assert.match('Sirens sound in Kiryat Shmona', m('israel'));
  assert.match('Missile hits Beersheba', m('israel'));
  assert.match('Houthis claim attack on ship in Red Sea', m('redsea'));
  assert.match('Airstrike on Hodeidah port', m('redsea'));
  assert.match('Clashes in Suwayda leave 12 dead', m('syria'));
  assert.match('Drone hits Erbil airport', m('iraq'));
  // „Hamas" nie je Hama, domáce saudské správy nie sú Jemen
  assert.doesNotMatch('Hamas delegation arrives in Cairo', m('syria'));
  assert.doesNotMatch('Saudi Arabia hosts investment forum in Riyadh', m('redsea'));
  assert.doesNotMatch('Houthis claim attack on ship in Red Sea', m('lebanon'));
  for (const id of THEATRE_REGIONS) assert.doesNotMatch('Local election results in Ohio', m(id), id);
});

test('theatre feeds are headline + link only, capped per source, and never an EU-listed outlet', () => {
  for (const id of ['gulf', 'mideast', ...THEATRE_REGIONS]) {
    const feeds = SITUATION_REGIONS[id].directRss.map(normalizeDirectFeed);
    assert.ok(feeds.length >= 2, id);
    const urls = new Set();
    for (const f of feeds) {
      assert.ok(f && /^https:\/\//.test(f.url), `${id}: ${f?.url}`);
      assert.ok(!urls.has(f.url), `${id}: ${f.url} dvakrát`);
      urls.add(f.url);
      assert.equal(isSanctionedMediaUrl(f.url), false, `${id}: ${f.url} je na zozname EÚ`);
      assert.ok(f.limit <= 8, `${id}: ${f.url} strop ${f.limit}`);
      assert.ok(f.label, `${id}: ${f.url} bez mena`);
      // og:image sa sťahuje len z BBC (ako doteraz); Guardian dáva náhľad sám do feedu
      if (!/bbci\.co\.uk/.test(f.url)) assert.equal(f.unfurl, false, `${id}: ${f.url} unfurl`);
      if (!/bbci\.co\.uk|theguardian\.com/.test(f.url)) assert.equal(f.feedImage, false, `${id}: ${f.url} obrázok`);
    }
  }
  // štátna agentúra a OSN nesú štítok, exilová stanica tiež
  const all = THEATRE_REGIONS.flatMap((id) => SITUATION_REGIONS[id].directRss.map(normalizeDirectFeed));
  assert.equal(all.find((f) => /nna-leb/.test(f.url)).badge, 'official-lb');
  assert.equal(all.find((f) => /news\.un\.org/.test(f.url)).badge, 'un');
  assert.equal(all.find((f) => /iranintl/.test(f.url)).badge, 'exile');
});

test('isDirectNewsUrl distinguishes real article URLs from Google-News redirects', () => {
  assert.equal(isDirectNewsUrl('https://www.bbc.co.uk/news/articles/abc'), true);
  assert.equal(isDirectNewsUrl('https://news.google.com/rss/articles/CBMxyz'), false);
  assert.equal(isDirectNewsUrl('not a url'), false);
});

test('mergeNewsItems dedupes by story, preferring image > direct URL > redirect, then newest', () => {
  const google = [{ title: 'Iran strikes tanker in Strait of Hormuz - Reuters', url: 'https://news.google.com/rss/articles/AAA', publishedAt: 300, image: null }];
  const direct = [{ title: 'Iran strikes tanker in Strait of Hormuz', url: 'https://www.bbc.co.uk/news/articles/xyz', publishedAt: 250, image: null }];
  const gdelt = [{ title: 'Iran strikes tanker in Strait of Hormuz - AP', url: 'https://apnews.com/story', publishedAt: 200, image: 'https://img/1.jpg' }];
  const other = [{ title: 'Oil prices climb', url: 'https://news.google.com/rss/articles/BBB', publishedAt: 400, image: null }];
  const merged = mergeNewsItems([google, direct, gdelt, other]);
  assert.equal(merged.length, 2, 'the three Hormuz copies collapse into one');
  const hormuz = merged.find((m) => /Hormuz/.test(m.title));
  assert.equal(hormuz.image, 'https://img/1.jpg', 'the image-bearing GDELT copy wins over direct/redirect');
  // newest first overall
  assert.equal(merged[0].title, 'Oil prices climb');
});

test('gdeltDocUrl is keyless, JSON, sorted newest-first and clamps maxrecords', () => {
  const url = gdeltDocUrl('"Persian Gulf"', { maxrecords: 999 });
  assert.ok(url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc?'));
  assert.ok(url.includes('format=json'));
  assert.ok(url.includes('sort=datedesc'));
  assert.ok(url.includes('maxrecords=75')); // clamped
});

test('parseGdeltDate handles both GDELT timestamp shapes', () => {
  assert.equal(parseGdeltDate('20260913T120000Z'), Date.UTC(2026, 8, 13, 12, 0, 0));
  assert.equal(parseGdeltDate('20260913120000'), Date.UTC(2026, 8, 13, 12, 0, 0));
  assert.equal(parseGdeltDate('nonsense'), null);
});

test('parseGdeltArticles normalizes, dedupes by url and drops bad rows', () => {
  const json = {
    articles: [
      { title: 'Ship struck near Strait of Hormuz', url: 'https://a.com/1', domain: 'a.com', seendate: '20260913T090000Z', socialimage: 'https://img/1.jpg', language: 'English', sourcecountry: 'US' },
      { title: 'dup', url: 'https://a.com/1', domain: 'a.com', seendate: '20260913T100000Z' }, // dup url
      { title: 'Newer story', url: 'https://b.com/2', domain: 'b.com', seendate: '20260913T110000Z', socialimage: 'not-a-url' },
      { title: '', url: 'https://c.com/3' }, // no title
      { title: 'no url', url: 'ftp://x' }, // bad url
    ],
  };
  const items = parseGdeltArticles(json);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://b.com/2'); // newest first
  assert.equal(items[0].image, null); // "not-a-url" rejected
  assert.equal(items[1].image, 'https://img/1.jpg');
  assert.equal(items[1].source, 'a.com');
});

test('relativeAge buckets into minutes / hours / days via i18n keys', () => {
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);
  const tr = (k, v) => (v && v.n != null ? `${k}:${v.n}` : k);
  assert.equal(relativeAge(now - 30 * 60_000, now, tr), 'situation.ago-m:30');
  assert.equal(relativeAge(now - 3 * 3_600_000, now, tr), 'situation.ago-h:3');
  assert.equal(relativeAge(now - 2 * 86_400_000, now, tr), 'situation.ago-d:2');
  assert.equal(relativeAge(now - 10_000, now, tr), 'situation.now');
  assert.equal(relativeAge(null, now, tr), '');
});

test('buildSituationModel limits, ages and flags empty', () => {
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);
  const model = buildSituationModel({
    region: 'gulf',
    items: [
      { title: 'A', url: 'https://a/1', source: 'a', publishedAt: now - 3_600_000 },
      { title: 'B', url: 'https://b/2', source: 'b', publishedAt: now - 7_200_000 },
    ],
    fetchedAt: now,
  }, { nowMs: now, limit: 1, translate: (k, v) => `${k}:${v?.n ?? ''}` });
  assert.equal(model.count, 1); // limited
  assert.equal(model.items[0].ageLabel, 'situation.ago-h:1');
  assert.equal(buildSituationModel({ items: [] }).empty, true);
});

test('fetchSituationNews hits the region endpoint and raises the proxy error', async () => {
  let seen = '';
  const ok = await fetchSituationNews('gulf', { fetcher: async (u) => { seen = u; return { ok: true, json: async () => ({ items: [] }) }; } });
  assert.ok(seen.includes('region=gulf'));
  assert.deepEqual(ok.items, []);
  await assert.rejects(
    fetchSituationNews('gulf', { fetcher: async () => ({ ok: false, status: 503, json: async () => ({ error: 'rate_limited' }) }) }),
    (err) => err.message === 'rate_limited' && err.status === 503,
  );
});
