// scripts/lib/volbyPages.mjs — statické stránky výsledkov volieb 2026 pre vyhľadávače (2026-10-25, vlastník:
// „stránky pre každú obec, ktoré nájde Google"). Ľudia hľadajú „výsledky volieb <obec>"; aplikácia ukazuje výsledky
// až po načítaní 3D glóbusu, ktorý Google neprečíta. Tu sa z hotových výsledkov ŠÚ SR vyrobia ľahké HTML stránky:
//   /volby-2026/                         prehľad: župani, zaujímavosti, okresy
//   /volby-2026/<okres>/                 okres: všetky obce so zvoleným starostom
//   /volby-2026/<okres>/<obec>/          obec: všetci kandidáti na starostu s hlasmi, účasť, odkaz do mapy
//   /sitemap-volby.xml
// Čisté funkcie (bez súborov a siete) — generuje scripts/build-volby-pages.mjs, test src/volbyPages.test.mjs.
// Texty neutrálne v rode (víťaz voľby, nie „starostom sa stal/stala"), bez emoji, zdroj ŠÚ SR pri každom čísle.

export const VOLBY_BASE = '/volby-2026/';
const SITE = 'https://okolive.sk';

/** HTML escape. Pure. */
export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Slug bez diakritiky: „Bratislava - Petržalka" → „bratislava-petrzalka", „Bratislava I" → „bratislava-i". Pure. */
export function slugify(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

const nf = (v, digits = 0) => (v == null || !Number.isFinite(Number(v)) ? '—'
  : new Intl.NumberFormat('sk-SK', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v)).replace(/\u00a0/g, ' '));
const pct = (v) => (v == null ? '—' : `${nf(v, 2)} %`);
const votesWord = (n) => (n === 1 ? 'hlas' : n >= 2 && n <= 4 ? 'hlasy' : 'hlasov');

/**
 * Adresy: slug okresu je jedinečný; obec v rámci okresu dostane kód, ak sa meno opakuje. Pure.
 * @param {Array<{code:string,name:string,okres:string}>} obce
 * @returns {Map<string, {okres:string, obec:string, path:string, okresPath:string}>} kód obce → cesty
 */
export function buildPaths(obce) {
  const out = new Map();
  const seen = new Map();
  for (const o of obce) {
    const okres = slugify(o.okres || 'okres');
    const base = slugify(o.name);
    const key = `${okres}/${base}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const o of obce) {
    const okres = slugify(o.okres || 'okres');
    const base = slugify(o.name);
    const obec = seen.get(`${okres}/${base}`) > 1 ? `${base}-${o.code}` : base;
    out.set(o.code, { okres, obec, okresPath: `${VOLBY_BASE}${okres}/`, path: `${VOLBY_BASE}${okres}/${obec}/` });
  }
  return out;
}

function head({ title, description, canonical, image, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href="${SITE}${canonical}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="OKO – okolive.sk" />
  <meta property="og:locale" content="sk_SK" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${SITE}${canonical}" />
  <meta property="og:image" content="${SITE}${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${SITE}${image}" />
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <meta name="theme-color" content="#040a10" />
  <link rel="stylesheet" href="/content.css?v=volby-2026-10-25" />
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="c-top">
  <a class="c-brand" href="/"><img src="/logo.svg" alt="" width="30" height="30" /><span>OK<b>O</b></span></a>
  <nav class="c-lang" aria-label="Voľby"><a href="${VOLBY_BASE}">Voľby 2026</a></nav>
</header>
<main class="c-main">`;
}

function foot(updated) {
  return `  <p class="c-note v-source">Zdroj: Štatistický úrad SR – <a href="https://volbysr.sk/" rel="noopener">volbysr.sk</a> (výsledky), Ministerstvo vnútra SR – register kandidátov. Stav k ${esc(updated)}. Doterajší starosta je určený podľa zamestnania, ktoré kandidát uviedol v registri MV SR.</p>
</main>
<footer class="c-foot">
  <p><a href="/">OKO — živý 3D glóbus</a> · <a href="${VOLBY_BASE}">Výsledky volieb 2026</a> · <a href="/privacy.html">Ochrana súkromia</a></p>
</footer>
</body>
</html>
`;
}

const crumbsLd = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${path}` })) });
const crumbsHtml = (items) => `  <nav class="c-crumbs" aria-label="Navigácia">${items.map(([name, path], i) => (i === items.length - 1 ? `<span>${esc(name)}</span>` : `<a href="${path}">${esc(name)}</a>`)).join(' › ')}</nav>`;

const CLS_TEXT = { held: 'mandát obhájený', lost: 'nová tvár – doterajší starosta prehral', open: 'nová tvár – doterajší nekandidoval', none: 'starosta nezvolený' };
const officeOf = (o) => (/^(582000|599981)$/.test(o.code) ? 'primátora' : 'starostu');

/**
 * Stránka obce. Pure.
 * @param {object} o obec z modelu (code, name, okres, kraj, seats, typ)
 * @param {object} r obecResult (volbyObceSweep)
 * @param {Array} cands kandidáti na starostu s hlasmi (liveCandidates)
 * @param {{paths:Map, kraj:object|null, updated:string, neighbours:Array}} ctx
 */
export function renderObec(o, r, cands, { paths, kraj = null, updated, neighbours = [] }) {
  const p = paths.get(o.code);
  const office = officeOf(o);
  const title = `Výsledky volieb 2026 ${o.name} – voľba ${office}${r?.winner && r.elected ? `: ${r.winner.meno} ${r.winner.priezvisko}` : ''}`;
  const w = r?.elected ? r.winner : null;
  const lead = !r?.done ? `Výsledky komunálnych volieb 2026 v obci ${o.name} sa ešte spracúvajú.`
    : w ? `Voľba ${office} v obci ${o.name} (okres ${o.okres}): zvolený kandidát ${w.meno} ${w.priezvisko} (${w.strany === 'NEKA' ? 'nezávislý kandidát' : w.strany}) so ziskom ${pct(w.pct)} platných hlasov.${r.margin != null && r.second ? ` Druhý skončil kandidát ${r.second.meno} ${r.second.priezvisko}, rozdiel ${nf(r.margin)} ${votesWord(r.margin)}.` : r.single ? ' Bol jediným kandidátom.' : ''}`
      : `V obci ${o.name} nebol vo voľbách 2026 zvolený ${office === 'primátora' ? 'primátor' : 'starosta'}.`;
  const description = !w ? lead.slice(0, 155) : `${o.name}: zvolený kandidát vo voľbe ${office} ${w.meno} ${w.priezvisko}, ${pct(w.pct)}. Účasť ${pct(r.turnoutPct)}. Všetci kandidáti a hlasy podľa ŠÚ SR.`;
  const rows = cands.map((c) => `      <tr${c.elected ? ' class="v-win"' : ''}><td>${esc(c.n)}</td><td>${esc(`${c.meno} ${c.priezvisko}`)}${c.elected ? ' <b class="v-tag">zvolený</b>' : ''}${r?.incumbent && (c.n === r.incumbent.n) ? ' <span class="v-inc">doterajší</span>' : ''}</td><td>${esc(c.strany === 'NEKA' ? 'nezávislý kandidát' : c.strany)}</td><td class="v-num">${nf(c.votes)}</td><td class="v-num">${pct(c.pct)}</td></tr>`).join('\n');
  const facts = [
    ['Účasť', r?.turnoutPct != null ? `${pct(r.turnoutPct)} (${nf(r.voted)} z ${nf(r.registered)} voličov)` : '—'],
    ['Doterajší starosta', r?.incumbent ? `${r.incumbent.meno} ${r.incumbent.priezvisko} – ${r.cls === 'held' ? 'mandát obhájený' : r.cls === 'lost' ? 'mandát neobhájený' : '—'}` : 'nekandidoval (podľa registra)'],
    ['Poslanci zastupiteľstva', `${nf(r?.seats ?? o.seats)} mandátov – hlasy poslancov zverejní ŠÚ SR s definitívnymi výsledkami`],
    ...(kraj?.winner ? [[`Predseda – ${kraj.name}`, `${kraj.winner.meno} ${kraj.winner.priezvisko}, ${pct(kraj.winner.pct)}`]] : []),
  ];
  const crumbs = [['OKO', '/'], ['Voľby 2026', VOLBY_BASE], [`okres ${o.okres}`, p.okresPath], [o.name, p.path]];
  const jsonLd = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': `${SITE}${p.path}#page`, url: `${SITE}${p.path}`, name: title, description, inLanguage: 'sk', dateModified: updated.slice(0, 10) },
    crumbsLd(crumbs),
  ] };
  return `${head({ title, description, canonical: p.path, image: `/s/v${o.code}.jpg`, jsonLd })}
${crumbsHtml(crumbs)}
  <h1>Výsledky volieb 2026: ${esc(o.name)}</h1>
  <p class="c-lead">${esc(lead)}</p>
  <p><a class="c-cta" href="/?volby=${esc(o.code)}">Otvoriť ${esc(o.name)} na mape →</a></p>
  <section>
    <h2>Voľba ${office} – všetci kandidáti</h2>
    <div class="v-scroll"><table class="v-table">
      <thead><tr><th>Č.</th><th>Kandidát</th><th>Politický subjekt</th><th class="v-num">Hlasy</th><th class="v-num">Podiel</th></tr></thead>
      <tbody>
${rows || '      <tr><td colspan="5">Výsledky zatiaľ nie sú k dispozícii.</td></tr>'}
      </tbody>
    </table></div>
  </section>
  <section class="c-facts">
    <h2>V skratke</h2>
    <dl>
${facts.map(([k, v]) => `      <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
    </dl>
  </section>
${neighbours.length ? `  <nav class="c-related" aria-label="Ďalšie obce okresu">
    <h2>Ďalšie obce v okrese ${esc(o.okres)}</h2>
    <p class="v-links">${neighbours.map((n) => `<a href="${paths.get(n.code).path}">${esc(n.name)}</a>`).join(' · ')}</p>
    <p><a href="${p.okresPath}">Všetky obce okresu ${esc(o.okres)} →</a></p>
  </nav>` : ''}
${foot(updated)}`;
}

/** Stránka okresu: tabuľka obcí so zvoleným starostom. Pure. */
export function renderOkres(okres, list, { paths, updated }) {
  const path = paths.get(list[0].o.code).okresPath;
  const title = `Výsledky volieb 2026 – okres ${okres}: starostovia všetkých obcí`;
  const held = list.filter((x) => x.r?.cls === 'held').length;
  const description = `Zvolení starostovia ${list.length} obcí okresu ${okres} v komunálnych voľbách 2026: víťaz, podiel hlasov, účasť. Doterajší starosta obhájil v ${held} obciach. Zdroj ŠÚ SR.`;
  const crumbs = [['OKO', '/'], ['Voľby 2026', VOLBY_BASE], [`okres ${okres}`, path]];
  const rows = list.map(({ o, r }) => `      <tr><td><a href="${paths.get(o.code).path}">${esc(o.name)}</a></td><td>${r?.elected ? esc(`${r.winner.meno} ${r.winner.priezvisko}`) : '—'}</td><td class="v-num">${r?.elected ? pct(r.winner.pct) : '—'}</td><td class="v-num">${r?.turnoutPct != null ? pct(r.turnoutPct) : '—'}</td><td class="v-cls v-${esc(r?.cls || 'pending')}">${esc(CLS_TEXT[r?.cls] || '—')}</td></tr>`).join('\n');
  const jsonLd = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', url: `${SITE}${path}`, name: title, description, inLanguage: 'sk', dateModified: updated.slice(0, 10) }, crumbsLd(crumbs)] };
  return `${head({ title, description, canonical: path, image: '/s/volby2026.jpg', jsonLd })}
${crumbsHtml(crumbs)}
  <h1>Výsledky volieb 2026 – okres ${esc(okres)}</h1>
  <p class="c-lead">${esc(`Starostovia a primátori ${list.length} obcí okresu ${okres}. Doterajší starosta obhájil v ${held} z nich. Kliknite na obec pre všetkých kandidátov a hlasy.`)}</p>
  <p><a class="c-cta" href="/?volby">Mapa výsledkov všetkých obcí →</a></p>
  <div class="v-scroll"><table class="v-table">
    <thead><tr><th>Obec</th><th>Zvolený starosta</th><th class="v-num">Podiel</th><th class="v-num">Účasť</th><th>Výsledok</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table></div>
${foot(updated)}`;
}

/** Prehľad: župani, čísla, zaujímavosti, okresy podľa krajov. Pure. */
export function renderHub({ kraje, okresy, records, paths, updated }) {
  const c = records?.counts || {};
  const title = 'Výsledky volieb 2026 – starostovia všetkých obcí a predsedovia krajov';
  const description = `Výsledky komunálnych a župných volieb 2026 podľa ŠÚ SR: zvolení starostovia a primátori ${nf(c.done)} obcí, predsedovia 8 krajov, účasť, najtesnejšie víťazstvá.`;
  const crumbs = [['OKO', '/'], ['Voľby 2026', VOLBY_BASE]];
  const kRows = kraje.map((k) => `      <tr><td>${esc(k.name)}</td><td>${k.winner ? esc(`${k.winner.meno} ${k.winner.priezvisko}`) : '—'}</td><td>${k.winner ? esc(k.winner.strany === 'NEKA' ? 'nezávislý kandidát' : k.winner.strany) : ''}</td><td class="v-num">${k.winner ? pct(k.winner.pct) : '—'}</td></tr>`).join('\n');
  const link = (r) => (paths.get(r.code) ? `<a href="${paths.get(r.code).path}">${esc(r.name)}</a>` : esc(r.name));
  const closest = (records?.closest || []).map((r) => `${link(r)} (${nf(r.margin)} ${votesWord(r.margin)})`).join(' · ');
  const highest = (records?.highest || []).map((r) => `${link(r)} ${pct(r.turnoutPct)}`).join(' · ');
  const lostBig = (records?.lostBig || []).map((r) => `${link(r)}${r.incumbent ? ` (${esc(r.incumbent)})` : ''}`).join(' · ');
  const byKraj = new Map();
  for (const ok of okresy) { if (!byKraj.has(ok.kraj)) byKraj.set(ok.kraj, []); byKraj.get(ok.kraj).push(ok); }
  const okresHtml = [...byKraj.entries()].map(([kraj, list]) => `  <h3>${esc(kraj)}</h3>
  <p class="v-links">${list.map((ok) => `<a href="${ok.path}">${esc(ok.name)}</a>`).join(' · ')}</p>`).join('\n');
  const jsonLd = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', url: `${SITE}${VOLBY_BASE}`, name: title, description, inLanguage: 'sk', dateModified: updated.slice(0, 10) }, crumbsLd(crumbs)] };
  return `${head({ title, description, canonical: VOLBY_BASE, image: '/s/volby2026.jpg', jsonLd })}
${crumbsHtml(crumbs)}
  <h1>Výsledky volieb 2026</h1>
  <p class="c-lead">${esc(`Komunálne a župné voľby 24. októbra 2026. Z ${nf(c.done)} obcí doterajší starosta obhájil v ${nf(c.held)}, prehral v ${nf(c.lost)} a v ${nf(c.open)} nekandidoval; v ${nf(c.none)} obciach starosta zvolený nebol.`)}</p>
  <p><a class="c-cta" href="/?volby">Mapa výsledkov všetkých obcí →</a></p>
  <section>
    <h2>Predsedovia samosprávnych krajov</h2>
    <div class="v-scroll"><table class="v-table">
      <thead><tr><th>Kraj</th><th>Zvolený predseda</th><th>Politický subjekt</th><th class="v-num">Podiel</th></tr></thead>
      <tbody>
${kRows}
      </tbody>
    </table></div>
  </section>
  <section>
    <h2>Zaujímavosti</h2>
    <ul>
${closest ? `      <li>Rozhodlo pár hlasov: ${closest}</li>` : ''}
${highest ? `      <li>Najvyššia účasť: ${highest}</li>` : ''}
${lostBig ? `      <li>Najväčšie mestá, kde starosta prehral: ${lostBig}</li>` : ''}
      <li>Jediný kandidát na starostu v ${nf(c.single)} obciach; nezávislí kandidáti vyhrali v ${nf(c.independent)} obciach.</li>
    </ul>
  </section>
  <section>
    <h2>Výsledky podľa okresov</h2>
${okresHtml}
  </section>
${foot(updated)}`;
}

/** sitemap-volby.xml. Pure. */
export function renderVolbySitemap(paths, okresPaths, lastmod) {
  const urls = [VOLBY_BASE, ...okresPaths, ...[...paths.values()].map((p) => p.path)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}
