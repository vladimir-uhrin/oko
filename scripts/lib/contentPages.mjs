// scripts/lib/contentPages.mjs — obsahové stránky okolive.sk (2026-09-30, SEO etapa 2).
//
// Čisté funkcie: z definícií v content/seo/pages.mjs vyrobia statické HTML stránky
// (/sk/<téma>/, /en/<topic>/), rozcestníky jazykov (/sk/, /en/) a sitemap.xml. Bez frameworku
// a bez závislostí — stránky sú ľahké (žiadny Cesium), aby ich Google prečítal a rýchlo načítal;
// z každej vedie tlačidlo do živej mapy (hlboký odkaz). Generuje scripts/build-content-pages.mjs,
// test src/contentPages.test.mjs stráži, aby súbory v public/ zodpovedali zdroju.

export const LANGS = Object.freeze(['sk', 'en']);
const LOCALE = Object.freeze({ sk: 'sk_SK', en: 'en_GB' });
const UI = Object.freeze({
  sk: {
    home: 'OKO', topics: 'Témy', facts: 'V skratke', faq: 'Časté otázky', sources: 'Zdroje a licencie',
    sourcesNote: 'Uvádzame hlavné zdroje témy; zdroj a licenciu každej vrstvy ukazuje aj samotná mapa.',
    related: 'Ďalšie témy', crumbs: 'Navigácia', madeBy: 'vytvoril', privacy: 'Ochrana súkromia',
    live: 'Živý 3D glóbus', langNav: 'Jazyk', open: 'Otvoriť',
  },
  en: {
    home: 'OKO', topics: 'Topics', facts: 'At a glance', faq: 'FAQ', sources: 'Sources and licences',
    sourcesNote: 'These are the main sources for this topic; the map itself also shows the source and licence of every layer.',
    related: 'More topics', crumbs: 'Breadcrumbs', madeBy: 'made by', privacy: 'Privacy',
    live: 'Live 3D globe', langNav: 'Language', open: 'Open',
  },
});

/** HTML escape (pure). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Riadok textu s odkazmi `[text](adresa)` → HTML (pure). Adresa musí byť relatívna (/...) alebo
 * https://; iné sa nechajú ako text. Vonkajšie odkazy dostanú rel="noopener".
 */
export function inline(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^\s)]*)\)/g, (_, label, href) => {
    const external = href.startsWith('https://');
    return `<a href="${href}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
  });
}

/** Text v jazyku stránky: reťazec platí pre oba jazyky, objekt { sk, en } sa vyberie (pure). */
export function pick(value, lang) {
  return value && typeof value === 'object' ? value[lang] : value;
}

/** Počet slov bez HTML a odkazov (pure). */
export function wordCount(text) {
  return String(text ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}

/** Cesta stránky (pure). Rozcestník jazyka má prázdny slug. */
export function pagePath(lang, slug = '') {
  return slug ? `/${lang}/${slug}/` : `/${lang}/`;
}

/** Všetok text stránky pre počet slov (pure). */
export function pageText(entry) {
  const parts = [entry.lead];
  for (const section of entry.sections || []) parts.push(...(section.p || []), ...(section.list || []));
  for (const item of entry.faq || []) parts.push(item.q, item.a);
  return parts.join(' ');
}

function head({ site, lang, title, description, canonical, alternates, ogType, image, imageAlt, jsonLd }) {
  const other = lang === 'sk' ? 'en' : 'sk';
  const links = alternates
    ? [
      `<link rel="alternate" hreflang="${lang}" href="${site.origin}${alternates[lang]}" />`,
      `<link rel="alternate" hreflang="${other}" href="${site.origin}${alternates[other]}" />`,
      `<link rel="alternate" hreflang="x-default" href="${site.origin}${alternates.sk}" />`,
    ].join('\n  ')
    : '';
  const img = image || { src: site.defaultImage, width: 1200, height: 630 };
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href="${site.origin}${canonical}" />
  ${links}
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="${escapeHtml(site.name)}" />
  <meta property="og:locale" content="${LOCALE[lang]}" />
  <meta property="og:locale:alternate" content="${LOCALE[other]}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${site.origin}${canonical}" />
  <meta property="og:image" content="${site.origin}${img.src}" />
  <meta property="og:image:width" content="${img.width}" />
  <meta property="og:image:height" content="${img.height}" />
  <meta property="og:image:alt" content="${escapeHtml(imageAlt || site.defaultImageAlt[lang])}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${site.origin}${img.src}" />
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <meta name="theme-color" content="#040a10" />
  <link rel="stylesheet" href="/content.css" />
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>`;
}

function topBar(lang, alternates, ui) {
  const other = lang === 'sk' ? 'en' : 'sk';
  return `<header class="c-top">
  <a class="c-brand" href="/"><img src="/logo.svg" alt="" width="30" height="30" /><span>OK<b>O</b></span></a>
  <nav class="c-lang" aria-label="${ui.langNav}"><span aria-current="true">${lang.toUpperCase()}</span> · <a href="${alternates[other]}" hreflang="${other}" lang="${other}">${other.toUpperCase()}</a></nav>
</header>`;
}

function footer(site, lang, ui) {
  return `<footer class="c-foot">
  <p><a href="/">OKO — ${ui.live}</a> · <a href="${pagePath(lang)}">${ui.topics}</a> · <a href="/privacy.html">${ui.privacy}</a></p>
  <p>${ui.madeBy} ${escapeHtml(site.author)} · okolive.sk</p>
</footer>
</body>
</html>
`;
}

function person(site) {
  return { '@type': 'Person', '@id': `${site.origin}/#author`, name: site.author };
}

/** Obsahová stránka jednej témy v jednom jazyku (pure). */
export function renderPage(page, lang, { pages, site }) {
  const ui = UI[lang];
  const entry = page[lang];
  const canonical = pagePath(lang, entry.slug);
  const alternates = { sk: pagePath('sk', page.sk.slug), en: pagePath('en', page.en.slug) };
  const hub = pagePath(lang);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${site.origin}${canonical}#page`,
        url: `${site.origin}${canonical}`,
        name: entry.title,
        description: entry.description,
        inLanguage: lang,
        dateModified: page.updated,
        isPartOf: { '@id': `${site.origin}/#website` },
        author: { '@id': `${site.origin}/#author` },
        primaryImageOfPage: `${site.origin}${(page.image || { src: site.defaultImage }).src}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'OKO', item: `${site.origin}/` },
          { '@type': 'ListItem', position: 2, name: ui.topics, item: `${site.origin}${hub}` },
          { '@type': 'ListItem', position: 3, name: entry.nav, item: `${site.origin}${canonical}` },
        ],
      },
      ...(entry.faq?.length ? [{
        '@type': 'FAQPage',
        mainEntity: entry.faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') } })),
      }] : []),
      person(site),
    ],
  };
  const sections = (entry.sections || []).map((section) => `  <section>
    <h2>${escapeHtml(section.h2)}</h2>
${(section.p || []).map((p) => `    <p>${inline(p)}</p>`).join('\n')}${section.list?.length ? `\n    <ul>\n${section.list.map((li) => `      <li>${inline(li)}</li>`).join('\n')}\n    </ul>` : ''}
  </section>`).join('\n');
  const facts = entry.facts?.length ? `  <section class="c-facts">
    <h2>${ui.facts}</h2>
    <dl>
${entry.facts.map(([k, v]) => `      <div><dt>${escapeHtml(k)}</dt><dd>${inline(v)}</dd></div>`).join('\n')}
    </dl>
  </section>` : '';
  const faq = entry.faq?.length ? `  <section class="c-faq">
    <h2>${ui.faq}</h2>
${entry.faq.map((item) => `    <details><summary>${escapeHtml(item.q)}</summary><p>${inline(item.a)}</p></details>`).join('\n')}
  </section>` : '';
  const sources = entry.sources?.length ? `  <section class="c-sources">
    <h2>${ui.sources}</h2>
    <ul>
${entry.sources.map((s) => {
    const name = escapeHtml(pick(s.name, lang));
    const license = pick(s.license, lang);
    return `      <li>${s.url ? `<a href="${escapeHtml(s.url)}" rel="noopener">${name}</a>` : name}${license ? ` — ${escapeHtml(license)}` : ''}</li>`;
  }).join('\n')}
    </ul>
    <p class="c-note">${ui.sourcesNote}</p>
  </section>` : '';
  const related = pages.filter((p) => p.id !== page.id);
  const hero = page.image ? `  <figure class="c-hero">
    <img src="${page.image.src}" alt="${escapeHtml(entry.imageAlt || '')}" width="${page.image.width}" height="${page.image.height}" fetchpriority="high" />
    ${page.image.credit ? `<figcaption>${escapeHtml(page.image.credit)}</figcaption>` : ''}
  </figure>` : '';
  return `${head({ site, lang, title: entry.title, description: entry.description, canonical, alternates, ogType: 'article', image: page.image, imageAlt: entry.imageAlt, jsonLd })}
<body>
${topBar(lang, alternates, ui)}
<main class="c-main">
  <nav class="c-crumbs" aria-label="${ui.crumbs}"><a href="/">OKO</a> › <a href="${hub}">${ui.topics}</a> › <span>${escapeHtml(entry.nav)}</span></nav>
  <h1>${escapeHtml(entry.h1)}</h1>
  <p class="c-lead">${inline(entry.lead)}</p>
  <p><a class="c-cta" href="${escapeHtml(entry.cta.href)}">${escapeHtml(entry.cta.label)} →</a></p>
${hero}
${sections}
${facts}
${faq}
${sources}
  <nav class="c-related" aria-label="${ui.related}">
    <h2>${ui.related}</h2>
    <ul>
${related.map((p) => `      <li><a href="${pagePath(lang, p[lang].slug)}">${escapeHtml(p[lang].nav)}</a> — ${escapeHtml(p[lang].teaser)}</li>`).join('\n')}
    </ul>
  </nav>
  <p class="c-bottom-cta"><a class="c-cta" href="${escapeHtml(entry.cta.href)}">${escapeHtml(entry.cta.label)} →</a></p>
</main>
${footer(site, lang, ui)}`;
}

/** Rozcestník tém jedného jazyka (pure). */
export function renderHub(lang, { pages, site, hub }) {
  const ui = UI[lang];
  const entry = hub[lang];
  const canonical = pagePath(lang);
  const alternates = { sk: pagePath('sk'), en: pagePath('en') };
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${site.origin}${canonical}#page`,
        url: `${site.origin}${canonical}`,
        name: entry.title,
        description: entry.description,
        inLanguage: lang,
        isPartOf: { '@id': `${site.origin}/#website` },
        hasPart: pages.map((p) => ({ '@type': 'WebPage', url: `${site.origin}${pagePath(lang, p[lang].slug)}`, name: p[lang].title })),
      },
      person(site),
    ],
  };
  return `${head({ site, lang, title: entry.title, description: entry.description, canonical, alternates, ogType: 'website', image: null, imageAlt: null, jsonLd })}
<body>
${topBar(lang, alternates, ui)}
<main class="c-main">
  <h1>${escapeHtml(entry.h1)}</h1>
  <p class="c-lead">${inline(entry.lead)}</p>
  <p><a class="c-cta" href="/">${escapeHtml(entry.cta)} →</a></p>
  <ul class="c-cards">
${pages.map((p) => `    <li><a href="${pagePath(lang, p[lang].slug)}"><strong>${escapeHtml(p[lang].nav)}</strong><span>${escapeHtml(p[lang].teaser)}</span></a></li>`).join('\n')}
  </ul>
</main>
${footer(site, lang, ui)}`;
}

/** sitemap.xml: koreň, rozcestníky, témy (s hreflang) a ďalšie stránky (pure). */
export function renderSitemap({ pages, site, extra = [] }) {
  const alt = (sk, en) => `\n    <xhtml:link rel="alternate" hreflang="sk" href="${site.origin}${sk}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${site.origin}${en}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${site.origin}${sk}"/>`;
  const url = (loc, lastmod, changefreq, priority, alternates = '') => `  <url>\n    <loc>${site.origin}${loc}</loc>${alternates}\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  const rows = [url('/', site.updated, 'daily', '1.0')];
  for (const lang of LANGS) rows.push(url(pagePath(lang), site.updated, 'weekly', '0.8', alt(pagePath('sk'), pagePath('en'))));
  for (const page of pages) {
    const sk = pagePath('sk', page.sk.slug);
    const en = pagePath('en', page.en.slug);
    for (const lang of LANGS) rows.push(url(lang === 'sk' ? sk : en, page.updated, 'weekly', '0.7', alt(sk, en)));
  }
  for (const item of extra) rows.push(url(item.loc, item.lastmod, item.changefreq, item.priority));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
}
