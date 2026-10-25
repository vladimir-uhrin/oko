// scripts/build-volby-pages.mjs — statické stránky výsledkov volieb 2026 pre vyhľadávače (2026-10-25).
// Číta: model kandidátov (MV SR, cache .gev-cache/volby — rovnaká ako služba), výsledky všetkých obcí zo zberu
// (.gev-cache/volby/obce-sweep.json, src/data/volbyObceSweep.js) a predsedov krajov z JSON stránky ŠÚ SR (8 súborov).
// Píše: public/volby-2026/**/index.html a public/sitemap-volby.xml (Vite ich skopíruje do buildu; okolive.sk
// ich podáva statický server). Spustenie po konečných výsledkoch:  node scripts/build-volby-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVolbyService } from '../src/data/volbyService.js';
import { volbyRecords } from '../src/data/volbyObceSweep.js';
import { createVolbyLive, liveCandidates } from '../src/data/volbyLive.js';
import { buildPaths, renderHub, renderObec, renderOkres, renderVolbySitemap, slugify, VOLBY_BASE } from './lib/volbyPages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'volby-2026');
const quiet = { info() {}, warn: (m) => console.warn(m) };

const service = createVolbyService({ cacheDir: path.join(root, '.gev-cache', 'volby'), log: quiet });
const model = await service.ensure();
const sweep = service._sweep();
const raw = sweep?._raw() || {};
const obce = model.obce.filter((o) => raw[o.code]);
if (obce.length < model.obce.length * 0.95) throw new Error(`zber obcí nie je úplný: ${obce.length}/${model.obce.length} — najprv nechať dobehnúť službu`);

const live = createVolbyLive();
const kraje = [];
for (const k of model.kraje) {
  const list = await live.predseda(k.code);
  kraje.push({ code: k.code, name: k.name, winner: list?.find((c) => c.elected) || list?.[0] || null });
}
const krajByName = new Map(kraje.map((k) => [k.name, k]));

const updatedRaw = Object.values(raw).map((e) => e.fetchedAt || 0).reduce((a, b) => Math.max(a, b), 0);
const updated = new Date(updatedRaw || Date.now()).toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const lastmod = new Date(updatedRaw || Date.now()).toISOString().slice(0, 10);

const paths = buildPaths(obce);
const results = new Map(obce.map((o) => [o.code, sweep.result(o)]));
const records = volbyRecords([...results.values()].filter(Boolean), { excludeCodes: new Set(['582000', '599981']) });

fs.rmSync(outDir, { recursive: true, force: true });
const write = (rel, html) => { const file = path.join(root, 'public', rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html); };
const sortSk = (a, b) => a.name.localeCompare(b.name, 'sk');

// okresy
const byOkres = new Map();
for (const o of obce) { const key = o.okres || '—'; if (!byOkres.has(key)) byOkres.set(key, []); byOkres.get(key).push(o); }
const okresy = [];
let pages = 0;
for (const [okres, list] of [...byOkres.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sk'))) {
  list.sort(sortSk);
  const items = list.map((o) => ({ o, r: results.get(o.code) }));
  write(path.join('volby-2026', slugify(okres), 'index.html'), renderOkres(okres, items, { paths, updated }));
  pages += 1;
  okresy.push({ name: okres, kraj: list[0].kraj, path: paths.get(list[0].code).okresPath });
  list.forEach((o, i) => {
    const e = raw[o.code];
    const neighbours = list.filter((x) => x.code !== o.code).slice(Math.max(0, i - 6), Math.max(0, i - 6) + 12);
    write(path.join('volby-2026', paths.get(o.code).okres, paths.get(o.code).obec, 'index.html'),
      renderObec(o, results.get(o.code), e?.tab05 ? liveCandidates(e.tab05) : [], { paths, kraj: krajByName.get(o.kraj) || null, updated, neighbours }));
    pages += 1;
  });
}
const krajOrder = new Map(model.kraje.map((k, i) => [k.name, i]));
okresy.sort((a, b) => (krajOrder.get(a.kraj) ?? 9) - (krajOrder.get(b.kraj) ?? 9) || a.name.localeCompare(b.name, 'sk'));
write(path.join('volby-2026', 'index.html'), renderHub({ kraje, okresy, records, paths, updated }));
pages += 1;
write('sitemap-volby.xml', renderVolbySitemap(paths, okresy.map((x) => x.path), lastmod));
console.log(`[volby-pages] ${pages} stránok do public${VOLBY_BASE} (${obce.length} obcí, ${okresy.length} okresov) + sitemap-volby.xml, stav ${updated}`);
process.exit(0);
