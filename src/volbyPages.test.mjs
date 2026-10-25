// src/volbyPages.test.mjs — statické stránky výsledkov volieb 2026 pre vyhľadávače (scripts/lib/volbyPages.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPaths, renderHub, renderObec, renderOkres, renderVolbySitemap, slugify, VOLBY_BASE } from '../scripts/lib/volbyPages.mjs';

const O = { code: '501921', name: 'Topoľníky', okres: 'Dunajská Streda', kraj: 'Trnavský kraj', seats: 9 };
const R = { code: '501921', name: 'Topoľníky', done: true, cls: 'lost', elected: true, turnoutPct: 67.07, voted: 1770, registered: 2639, seats: 9,
  winner: { n: 2, meno: 'Tünde', priezvisko: 'Várady', strany: 'NEKA', pct: 67.01 }, second: { n: 1, meno: 'László', priezvisko: 'Bacsó' }, margin: 589, single: false,
  incumbent: { n: 1, meno: 'László', priezvisko: 'Bacsó' } };
const C = [{ n: 2, meno: 'Tünde', priezvisko: 'Várady', strany: 'NEKA', votes: 1160, pct: 67.01, elected: true }, { n: 1, meno: 'László', priezvisko: 'Bacsó', strany: 'Magyar Szövetség', votes: 571, pct: 32.98, elected: false }];

test('slugify a adresy: bez diakritiky, mestské časti, opakované meno v okrese dostane kód', () => {
  assert.equal(slugify('Bratislava - Petržalka'), 'bratislava-petrzalka');
  assert.equal(slugify('Bratislava I'), 'bratislava-i');
  assert.equal(slugify('Šumiac'), 'sumiac');
  const paths = buildPaths([O, { code: '1', name: 'Lehota', okres: 'Nitra' }, { code: '2', name: 'Lehota', okres: 'Nitra' }, { code: '3', name: 'Lehota', okres: 'Prešov' }]);
  assert.equal(paths.get('501921').path, '/volby-2026/dunajska-streda/topolniky/');
  assert.equal(paths.get('1').path, '/volby-2026/nitra/lehota-1/');
  assert.equal(paths.get('3').path, '/volby-2026/presov/lehota/');
});

test('stránka obce: titulok pre vyhľadávanie, všetci kandidáti, účasť, doterajší starosta, odkaz do mapy a karta, neutrálny rod', () => {
  const paths = buildPaths([O]);
  const html = renderObec(O, R, C, { paths, kraj: { name: 'Trnavský kraj', winner: { meno: 'Jozef', priezvisko: 'Viskupič', pct: 54.04 } }, updated: '25. 10. 2026 08:11' });
  assert.match(html, /<title>Výsledky volieb 2026 Topoľníky – voľba starostu: Tünde Várady<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/okolive\.sk\/volby-2026\/dunajska-streda\/topolniky\/" \/>/);
  assert.match(html, /<meta name="robots" content="index, follow/);
  assert.match(html, /og:image" content="https:\/\/okolive\.sk\/s\/v501921\.jpg"/);
  assert.match(html, /href="\/\?volby=501921"/);
  assert.match(html, /1 160<\/td><td class="v-num">67,01 %/);
  assert.match(html, /67,07 % \(1 770 z 2 639 voličov\)/);
  assert.match(html, /László Bacsó – mandát neobhájený/);
  assert.match(html, /rozdiel 589 hlasov/);
  assert.match(html, /Jozef Viskupič, 54,04 %/);
  assert.doesNotMatch(html, /\(a\)/, 'žiadne „vyhral(a)"');
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}]/u, 'bez emoji');
  assert.match(html, /"@type":"BreadcrumbList"/);
});

test('okres, prehľad a sitemap', () => {
  const paths = buildPaths([O]);
  const ok = renderOkres('Dunajská Streda', [{ o: O, r: R }], { paths, updated: 'x' });
  assert.match(ok, /<a href="\/volby-2026\/dunajska-streda\/topolniky\/">Topoľníky<\/a>/);
  assert.match(ok, /nová tvár – doterajší starosta prehral/);
  const hub = renderHub({ kraje: [{ name: 'Trnavský kraj', winner: { meno: 'Jozef', priezvisko: 'Viskupič', strany: 'PS', pct: 54.04 } }],
    okresy: [{ name: 'Dunajská Streda', kraj: 'Trnavský kraj', path: '/volby-2026/dunajska-streda/' }],
    records: { counts: { done: 2921, held: 2075, lost: 316, open: 521, none: 9, single: 1026, independent: 1593 }, closest: [{ code: '501921', name: 'Topoľníky', margin: 1 }] }, paths, updated: 'x' });
  assert.match(hub, /Topoľníky<\/a> \(1 hlas\)/);
  assert.match(hub, /Jozef Viskupič/);
  const sm = renderVolbySitemap(paths, ['/volby-2026/dunajska-streda/'], '2026-10-25');
  assert.match(sm, /<loc>https:\/\/okolive\.sk\/volby-2026\/<\/loc>/);
  assert.match(sm, /<loc>https:\/\/okolive\.sk\/volby-2026\/dunajska-streda\/topolniky\/<\/loc><lastmod>2026-10-25<\/lastmod>/);
});

test('vygenerované súbory sú v public/ a robots.txt ukazuje na sitemap-volby.xml', () => {
  assert.ok(fs.existsSync(new URL(`../public${VOLBY_BASE}index.html`, import.meta.url)), 'spustiť node scripts/build-volby-pages.mjs');
  assert.ok(fs.existsSync(new URL('../public/volby-2026/dunajska-streda/topolniky/index.html', import.meta.url)));
  const sm = fs.readFileSync(new URL('../public/sitemap-volby.xml', import.meta.url), 'utf8');
  assert.ok((sm.match(/<url>/g) || []).length > 2900, 'všetky obce v sitemap');
  const server = fs.readFileSync(new URL('../scripts/oko-static-server.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes('Sitemap: https://okolive.sk/sitemap-volby.xml'));
  assert.ok(fs.readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8').includes('https://okolive.sk/volby-2026/'));
});
