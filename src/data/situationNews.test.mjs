import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SITUATION_REGIONS,
  buildSituationModel,
  fetchSituationNews,
  gdeltDocUrl,
  isDirectNewsUrl,
  mergeNewsItems,
  parseGdeltArticles,
  parseGdeltDate,
  relativeAge,
} from './situationNews.js';

test('the gulf region carries a Hormuz/Gulf GDELT query', () => {
  assert.ok(SITUATION_REGIONS.gulf);
  assert.match(SITUATION_REGIONS.gulf.query, /Hormuz/);
  assert.match(SITUATION_REGIONS.gulf.query, /Persian Gulf/);
});

test('the gulf region carries an RSS fallback query for when GDELT throttles', () => {
  assert.match(SITUATION_REGIONS.gulf.rssQuery, /Hormuz/);
  assert.match(SITUATION_REGIONS.gulf.rssQuery, /Gulf of Oman/);
});

test('the gulf region carries direct publisher RSS feeds + a region match', () => {
  assert.ok(Array.isArray(SITUATION_REGIONS.gulf.directRss) && SITUATION_REGIONS.gulf.directRss.length >= 2);
  assert.ok(SITUATION_REGIONS.gulf.directRss.every((u) => /^https:\/\//.test(u)));
  assert.match('Tanker struck near Hormuz', new RegExp(SITUATION_REGIONS.gulf.match, 'i'));
  assert.doesNotMatch('Local election results in Ohio', new RegExp(SITUATION_REGIONS.gulf.match, 'i'));
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
