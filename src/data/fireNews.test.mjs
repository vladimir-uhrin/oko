// src/data/fireNews.test.mjs — správy a história k ohnisku (2026-10-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireNewsQuery, fireNewsCellKey, fireNewsVerdict, fireHistoryKey, fireHistoryDays, fireHistoryStats } from './fireNews.js';
import { historyLine } from '../fireNewsCard.js';

test('dopyt GDELT: mesto + štát + slová udalosti; bez sídla región; bez ničoho null; úvodzovky preč', () => {
  assert.equal(fireNewsQuery({ locality: 'Sochi', region: 'Krasnodar Krai', country: 'Russia' }), '"Sochi" "Russia" (fire OR wildfire OR blaze OR explosion OR burning OR smoke)');
  assert.equal(fireNewsQuery({ locality: null, region: 'Krasnodar Krai', country: 'Russia' }), '"Krasnodar Krai" "Russia" (fire OR wildfire OR blaze OR explosion OR burning OR smoke)');
  assert.equal(fireNewsQuery({ locality: 'Mo"na(co)', country: 'Mo"na(co)' }), '"Mo na co" (fire OR wildfire OR blaze OR explosion OR burning OR smoke)', 'mesto = štát sa neopakuje; úvodzovky a zátvorky preč');
  assert.equal(fireNewsQuery({ country: 'Russia' }), null, 'len štát = šum');
  assert.equal(fireNewsQuery(null), null);
  assert.equal(fireNewsCellKey(43.64727, 17.59495), '43.6:17.6');
});

test('verdikt: dôveryhodné domény (aj subdomény) → potvrdené od 2 rôznych; dôveryhodné a s obrázkom prvé', () => {
  const trusted = ['reuters.com', 'bbc.co.uk'];
  const arts = [
    { title: 'a', url: 'https://x.example/1', source: 'x.example', image: 'https://x.example/i.jpg', publishedAt: 3 },
    { title: 'b', url: 'https://www.reuters.com/2', source: 'www.reuters.com', publishedAt: 1 },
    { title: 'c', url: 'https://news.bbc.co.uk/3', source: '', publishedAt: 2 },
  ];
  const v = fireNewsVerdict(arts, trusted, 10);
  assert.equal(v.confirmed, true);
  assert.deepEqual(v.trustedDomains.sort(), ['bbc.co.uk', 'reuters.com']);
  assert.deepEqual(v.items.map((i) => i.title), ['c', 'b', 'a'], 'dôveryhodné prvé (novšie skôr), potom s obrázkom');
  assert.equal(fireNewsVerdict(arts.slice(0, 2), trusted, 10).confirmed, false, 'jedno dôveryhodné médium nestačí');
  assert.equal(fireNewsVerdict([{ title: 'z', url: 'https://reuters.com.evil.example/', source: 'reuters.com.evil.example' }], trusted).confirmed, false);
  const old = fireNewsVerdict([{ title: 'o', url: 'https://reuters.com/old', source: 'reuters.com', publishedAt: 1 }, { title: 'o2', url: 'https://bbc.co.uk/old', source: 'bbc.co.uk', publishedAt: 2 }], trusted, 10 * 86_400_000);
  assert.equal(old.items.length, 0, 'staršie než 3 dni sa k ohnisku nerátajú');
  assert.equal(old.confirmed, false);
});

test('história: kľúč bez duplicít, dni späť, štatistika (prelety = rôzne 10-min okná)', () => {
  const f = { lat: 44.73559, lon: 37.80931, acqDate: '2026-10-06', acqTime: '3', satellite: 'N21' };
  assert.equal(fireHistoryKey(f), '44.7356:37.8093:2026-10-06:3:N21');
  assert.deepEqual(fireHistoryDays(Date.UTC(2026, 9, 6, 12), 3), ['2026-10-06', '2026-10-05', '2026-10-04']);
  const T = Date.UTC(2026, 9, 6, 0, 3);
  const s = fireHistoryStats([
    { acqMs: T, frp: 2.8, satellite: 'N21' }, { acqMs: T + 60_000, frp: 1.5, satellite: 'N21' },
    { acqMs: T - 3 * 86_400_000, frp: 5, satellite: 'N' }, { acqMs: NaN, frp: 99 },
  ]);
  assert.equal(s.count, 3); assert.equal(s.passes, 2); assert.equal(s.maxFrp, 5); assert.equal(s.firstMs, T - 3 * 86_400_000);
  assert.deepEqual(s.satellites.sort(), ['N', 'N21']);
  assert.deepEqual(fireHistoryStats([]), { count: 0, passes: 0, firstMs: null, lastMs: null, maxFrp: 0, satellites: [] });
});

test('riadok histórie na karte: odkedy horí, počty; bez detekcií hláška', () => {
  const tr = (k, p = {}) => k.replace('{since}', p.since).replace('{n}', p.n).replace('{passes}', p.passes).replace('{frp}', p.frp);
  const now = Date.UTC(2026, 9, 6, 20);
  assert.equal(historyLine({ count: 27, passes: 11, firstMs: Date.UTC(2026, 9, 3, 11), maxFrp: 5.58 }, now, tr), 'firms.history.line'.replace(/.*/, 'firms.history.line').length ? tr('firms.history.line', { since: tr('firms.history.days', { n: 3 }), n: 27, passes: 11, frp: 6 }) : '');
  assert.equal(historyLine({ count: 2, passes: 1, firstMs: now - 3600_000, maxFrp: 1 }, now, tr), tr('firms.history.line', { since: 'firms.history.today', n: 2, passes: 1, frp: 1 }));
  assert.equal(historyLine({ count: 0 }, now, tr), 'firms.history.none');
  assert.equal(historyLine(null, now, tr), 'firms.history.none');
});

test('more: najbližšie mesto zo zoznamu Natural Earth (tanker pri Soči → Soči 33 km); ďaleko nič', async () => {
  const { nearestPlace } = await import('./fireNews.js');
  const { readFileSync } = await import('node:fs');
  const places = JSON.parse(readFileSync(new URL('./local_data/natural_earth/places.json', import.meta.url), 'utf8')).places;
  assert.deepEqual(nearestPlace(places, 43.3255, 39.9077), { name: 'Sochi', km: 33 });
  assert.equal(nearestPlace(places, 0, -30), null, 'stred Atlantiku');
  assert.equal(nearestPlace([['A', 1, 1], 'zlé', ['B', null, 2]], 1.1, 1).name, 'A');
});

test('Bing News RSS: priamy odkaz z apiclick, náhľad cez https, zdroj = doména; bez titulku/odkazu preč', async () => {
  const { parseBingNewsRss, bingNewsUrl } = await import('./fireNews.js');
  const xml = `<rss><channel><title>Sochi fire - Bing</title><link>https://www.bing.com/news/search?q=x</link>
<item><title>Tanker Catches Fire, Spills Oil off Russian Resort Town of Sochi</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fmaritime-executive.com%2farticle%2ftanker-catches-fire&amp;c=1</link><pubDate>Tue, 06 Oct 2026 12:41:38 GMT</pubDate><News:Source>The Maritime Executive</News:Source><News:Image>http://www.bing.com/th?id=ONUT.abc&amp;pid=News</News:Image></item>
<item><title>Russia&#39;s &quot;shadow&quot; tanker</title><link>https://www.reuters.com/world/x</link><pubDate>bad</pubDate></item>
<item><title></title><link>https://x.example/</link></item>
<item><title>bing self</title><link>https://www.bing.com/news/search?q=y</link></item>
</channel></rss>`;
  const items = parseBingNewsRss(xml);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { title: 'Tanker Catches Fire, Spills Oil off Russian Resort Town of Sochi', url: 'https://maritime-executive.com/article/tanker-catches-fire', source: 'maritime-executive.com', sourceName: 'The Maritime Executive', publishedAt: null, image: 'https://www.bing.com/th?id=ONUT.abc&pid=News' });
  assert.equal(items[1].title, 'Russia\'s "shadow" tanker'); assert.equal(items[1].source, 'reuters.com'); assert.equal(items[1].publishedAt, null); assert.equal(items[1].image, null);
  assert.match(bingNewsUrl('"Sochi" (fire OR blaze)'), /^https:\/\/www\.bing\.com\/news\/search\?q=%22Sochi%22\+%28fire\+OR\+blaze%29&format=rss&count=30&qft=interval%3D%227%22/);
});

test('relevancia: titulok musí spomínať miesto; ostatné na koniec a do potvrdenia sa nerátajú', async () => {
  const { fireNewsVerdict, titleMentionsPlace } = await import('./fireNews.js');
  assert.equal(titleMentionsPlace("Fire erupts on tanker near Russia's Sochi", 'Sochi'), true);
  assert.equal(titleMentionsPlace('Novorossiysk-based terminal hit', 'Novorossiysk'), true);
  assert.equal(titleMentionsPlace('Drone strike in Sumy', 'Sochi'), false);
  assert.equal(titleMentionsPlace('Požiar v Košiciach', 'Košice'), true, 'diakritika a pád');
  assert.equal(titleMentionsPlace('cokoľvek', null), true);
  const v = fireNewsVerdict([
    { title: 'Drone strike in Sumy', url: 'https://reuters.com/a', source: 'reuters.com', image: 'x' },
    { title: 'Kherson shelling', url: 'https://bbc.co.uk/b', source: 'bbc.co.uk' },
    { title: 'Tanker ablaze off Sochi', url: 'https://x.example/c', source: 'x.example' },
  ], ['reuters.com', 'bbc.co.uk'], 10, 'Sochi');
  assert.equal(v.items[0].title, 'Tanker ablaze off Sochi');
  assert.equal(v.confirmed, false, 'dôveryhodné médiá o inom mieste nepotvrdzujú');
  assert.deepEqual(v.trustedDomains, []);
});
