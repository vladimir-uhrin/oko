// src/contentPages.test.mjs — obsahové stránky okolive.sk (2026-09-30, SEO etapa 2).
// Stráži: kvalitu zdroja (dĺžky, rozsah textu, páry SK/EN), vykreslenie (canonical, hreflang,
// JSON-LD, Open Graph, index), aktuálnosť vygenerovaných súborov v public/ a zakázané tvrdenia
// (veci, ktoré verejná stránka nerobí alebo sú len lokálne).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, escapeHtml, inline, pagePath, pageText, pick, renderPage, wordCount } from '../scripts/lib/contentPages.mjs';
import { buildOutputs } from '../scripts/build-content-pages.mjs';
import { HUB, PAGES, SITE } from '../content/seo/pages.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('inline: odkazy len relatívne alebo https, zvyšok escapovaný', () => {
  assert.equal(inline('A [mapa](/?front=lyman) & <b>'), 'A <a href="/?front=lyman">mapa</a> &amp; &lt;b&gt;');
  assert.equal(inline('[x](https://example.org/a)'), '<a href="https://example.org/a" rel="noopener">x</a>');
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(escapeHtml('"\''), '&quot;&#39;');
  assert.equal(wordCount('Dve [slová](/x) a 123'), 3);
  assert.equal(pick('CC BY 4.0', 'sk'), 'CC BY 4.0');
  assert.equal(pick({ sk: 'voľné dielo', en: 'public domain' }, 'en'), 'public domain');
  assert.equal(pick(undefined, 'sk'), undefined);
});

test('zdroj: každá téma má SK aj EN, jedinečné adresy, dĺžky titulkov a popisov, dosť textu', () => {
  assert.ok(PAGES.length >= 6, `tém ${PAGES.length}`);
  const seen = new Set();
  for (const page of PAGES) {
    for (const lang of LANGS) {
      const e = page[lang];
      const where = `${page.id}/${lang}`;
      assert.ok(e, `${where}: chýba jazyk`);
      assert.match(e.slug, /^[a-z0-9-]+$/, `${where}: slug`);
      const url = pagePath(lang, e.slug);
      assert.ok(!seen.has(url), `${where}: duplicitná adresa ${url}`);
      seen.add(url);
      assert.ok(e.title.length <= 65, `${where}: titulok ${e.title.length} znakov`);
      assert.ok(e.description.length >= 110 && e.description.length <= 160, `${where}: popis ${e.description.length} znakov`);
      assert.ok(e.nav && e.teaser && e.h1 && e.lead, `${where}: nav/teaser/h1/lead`);
      // Slovenčina povie to isté menej slovami než angličtina; 300 slov je spodná hranica pre tému.
      assert.ok(wordCount(pageText(e)) >= 300, `${where}: ${wordCount(pageText(e))} slov`);
      assert.match(e.cta.href, /^\/[?#]?/, `${where}: CTA do appky`);
      assert.ok(e.faq.length >= 3, `${where}: aspoň 3 otázky`);
      assert.ok(e.sources.length >= 1, `${where}: zdroje`);
      for (const s of e.sources) {
        const name = pick(s.name, lang);
        assert.ok(typeof name === 'string' && name.trim(), `${where}: zdroj bez názvu v jazyku ${lang}`);
        if (s.license) assert.ok(typeof pick(s.license, lang) === 'string', `${where}: licencia ${name} v jazyku ${lang}`);
        if (s.url) assert.match(s.url, /^https:\/\//, `${where}: zdroj ${name}`);
      }
    }
  }
  for (const lang of LANGS) {
    assert.ok(HUB[lang].title.length <= 65);
    assert.ok(HUB[lang].description.length >= 110 && HUB[lang].description.length <= 160, `rozcestník ${lang}: ${HUB[lang].description.length}`);
  }
});

test('zakázané tvrdenia: verejná stránka nesľubuje lokálne, nehotové ani platené veci', () => {
  // DeepState: zdroj bez súhlasu na šírenie (riziko nahlásené vlastníkovi 2026-09-30) — verejné texty ho
  // nespomínajú ani neopisujú prvky z neho odvodené; Rybar je pod sankciami EÚ.
  const forbidden = [
    /deepstate/i, /rybar/i, /acars/i, /hlasov[éý]|voice control|openai/i, /\bzadarmo navždy\b/i,
    /okupovan|occupied|siv[áa] zón|grey zone|gray zone|pás bojov|combat band|línia dotyku|contact line/i,
    /nikdy v prehliadači|never in the browser/i,
  ];
  for (const page of PAGES) {
    for (const lang of LANGS) {
      const text = JSON.stringify(page[lang]);
      for (const re of forbidden) assert.doesNotMatch(text, re, `${page.id}/${lang}: ${re}`);
    }
  }
});

test('vykreslenie: canonical, hreflang páry, index, Open Graph, JSON-LD (WebPage, drobčeky, FAQ)', () => {
  for (const page of PAGES) {
    for (const lang of LANGS) {
      const html = renderPage(page, lang, { pages: PAGES, site: SITE });
      const own = `${SITE.origin}${pagePath(lang, page[lang].slug)}`;
      assert.match(html, new RegExp(`<html lang="${lang}">`));
      assert.ok(html.includes(`<link rel="canonical" href="${own}" />`));
      assert.ok(html.includes(`hreflang="sk" href="${SITE.origin}${pagePath('sk', page.sk.slug)}"`));
      assert.ok(html.includes(`hreflang="en" href="${SITE.origin}${pagePath('en', page.en.slug)}"`));
      assert.ok(html.includes('hreflang="x-default"'));
      assert.ok(html.includes('<meta name="robots" content="index, follow, max-image-preview:large" />'));
      assert.ok(html.includes(`<meta property="og:url" content="${own}" />`));
      const json = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.deepEqual(json['@graph'].map((n) => n['@type']), ['WebPage', 'BreadcrumbList', 'FAQPage', 'Person']);
      assert.equal((html.match(/<h1>/g) || []).length, 1, 'jedno H1');
      assert.ok(html.includes('href="/content.css"'));
      assert.doesNotMatch(html, /<script[^>]+src=/, 'obsahová stránka nenačítava žiadny skript (ani Cesium) — rýchla pre ľudí aj roboty');
    }
  }
});

test('vygenerované súbory v public/ zodpovedajú zdroju (inak: node scripts/build-content-pages.mjs)', () => {
  for (const [rel, expected] of buildOutputs()) {
    const actual = readFileSync(path.join(PUBLIC, rel), 'utf8');
    assert.equal(actual, expected, `${rel} je zastaraný`);
  }
});

test('sitemap: koreň, rozcestníky, všetky témy v oboch jazykoch s hreflang a ochrana súkromia', () => {
  const sitemap = readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs[0], `${SITE.origin}/`);
  for (const lang of LANGS) assert.ok(locs.includes(`${SITE.origin}/${lang}/`));
  for (const page of PAGES) for (const lang of LANGS) assert.ok(locs.includes(`${SITE.origin}${pagePath(lang, page[lang].slug)}`), `${page.id}/${lang}`);
  assert.ok(locs.includes(`${SITE.origin}/privacy.html`));
  assert.equal(new Set(locs).size, locs.length, 'bez duplicít');
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
});
