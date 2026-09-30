// src/seoBasics.test.mjs — technické SEO okolive.sk (2026-09-30, vlastník: „SEO, sitemap, GSC, GA4"
// a „podmienka noindex už neplatí"; plán docs/drafts/seo-plan.md, etapa 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../index.html');

test('hlavička koreňa: jazyk, titulok, popis, kanonická adresa, indexovanie', () => {
  assert.match(html, /<html lang="sk">/);
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  assert.equal(title, 'OKO — lietadlá, lode a konflikty naživo na 3D glóbuse');
  assert.ok(title.length <= 65, `titulok ${title.length} znakov — Google ukazuje asi 60`);
  const description = html.match(/<meta name="description" content="([^"]+)" \/>/)[1];
  assert.ok(description.length >= 120 && description.length <= 160, `popis ${description.length} znakov`);
  assert.match(description, /Ukrajina/);
  assert.match(html, /<link rel="canonical" href="https:\/\/okolive\.sk\/" \/>/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large" \/>/);
});

test('štruktúrované dáta: WebSite, WebApplication zadarmo a autor sa dajú načítať', () => {
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(block, 'JSON-LD v hlavičke');
  const data = JSON.parse(block[1]);
  const types = data['@graph'].map((node) => node['@type']);
  assert.deepEqual(types, ['WebSite', 'WebApplication', 'Person']);
  const app = data['@graph'][1];
  assert.equal(app.url, 'https://okolive.sk/');
  assert.equal(app.isAccessibleForFree, true);
  assert.equal(app.offers.price, '0');
  assert.equal(data['@graph'][2].name, 'Vladimír Uhrin');
});

test('sitemap.xml: koreň a ochrana súkromia; robots.txt statického servera na ňu ukazuje', () => {
  const sitemap = read('../public/sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"[ >]/);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // Od 2026-09-30 sitemap generuje scripts/build-content-pages.mjs (aj obsahové stránky —
  // ich úplný zoznam stráži src/contentPages.test.mjs); tu len koreň na prvom mieste a súkromie.
  assert.equal(locs[0], 'https://okolive.sk/');
  assert.ok(locs.includes('https://okolive.sk/privacy.html'));
  for (const loc of locs) assert.match(loc, /^https:\/\/okolive\.sk\//);
  for (const lastmod of sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) assert.match(lastmod[1], /^\d{4}-\d{2}-\d{2}$/);
  const server = read('../scripts/oko-static-server.mjs');
  assert.match(server, /Sitemap: https:\/\/okolive\.sk\/sitemap\.xml/);
});

test('Search Console: overovací súbor má presný obsah, ktorý Google čaká', () => {
  assert.equal(read('../public/google5f66f1e4a10096a1.html'), 'google-site-verification: google5f66f1e4a10096a1.html');
});

test('ochrana kvóty: roboty dostanú appku bez fotorealistických dlaždíc (rovnaká cesta ako ?qaBasemap=osm)', () => {
  const main = read('./main.js');
  assert.match(main, /import \{ isCrawlerUserAgent \} from '\.\/crawlerDetect\.js';/);
  assert.match(main, /const crawlerVisit = isCrawlerUserAgent\(navigator\.userAgent\);\n\s+try \{\n\s+if \(qaBasemapOsm\) throw[^\n]*\n\s+if \(crawlerVisit\) throw new Error/,
    'robot vyskočí z bloku skôr, než sa vytvorí fotoreálny tileset');
  assert.ok(main.indexOf('if (crawlerVisit) throw') < main.indexOf('await createPhotorealTileset('));
});
