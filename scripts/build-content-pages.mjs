// scripts/build-content-pages.mjs — vygeneruje obsahové stránky okolive.sk (2026-09-30, SEO).
// Zdroj: content/seo/pages.mjs. Výstup do public/ (Vite ho skopíruje do dist):
//   public/sk/index.html, public/en/index.html        rozcestníky tém
//   public/sk/<téma>/index.html, public/en/<topic>/…   stránky tém
//   public/sitemap.xml                                koreň, rozcestníky, témy, ochrana súkromia
// Spustenie: node scripts/build-content-pages.mjs   (test src/contentPages.test.mjs stráži aktuálnosť)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, pagePath, renderHub, renderPage, renderSitemap } from './lib/contentPages.mjs';
import { HUB, PAGES, SITE, SITEMAP_EXTRA } from '../content/seo/pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

/** Všetky výstupy: cesta v public/ → obsah (pure voči súborom; test ich porovnáva). */
export function buildOutputs() {
  const out = new Map();
  for (const lang of LANGS) {
    out.set(path.join(lang, 'index.html'), renderHub(lang, { pages: PAGES, site: SITE, hub: HUB }));
    for (const page of PAGES) out.set(path.join(lang, page[lang].slug, 'index.html'), renderPage(page, lang, { pages: PAGES, site: SITE }));
  }
  out.set('sitemap.xml', renderSitemap({ pages: PAGES, site: SITE, extra: SITEMAP_EXTRA }));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let written = 0;
  for (const [rel, html] of buildOutputs()) {
    const file = path.join(publicDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    written += 1;
  }
  console.log(`[content-pages] ${written} súborov do public/ (${PAGES.length} tém × ${LANGS.length} jazyky + rozcestníky + sitemap); ${PAGES.map((p) => pagePath('sk', p.sk.slug)).join(' ')}`);
}
