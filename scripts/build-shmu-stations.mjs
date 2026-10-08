// scripts/build-shmu-stations.mjs
// Zoznam automatických staníc SHMÚ so súradnicami pre vrstvu meraní (2026-10-08). Otvorené dáta SHMÚ
// (opendata.shmu.sk/meteorology/climate/now, CC BY 4.0) nesú len kód stanice `ind_kli`, bez mena a polohy.
//   - mená: tabuľka aktuálneho počasia na shmu.sk (odkaz „…pre stanicu <meno>" s ii=<kód>),
//   - presná poloha: WMO OSCAR/Surface (verejný register staníc WMO) — podľa indexu WMO 0-20000-0-<kód>,
//     inak podľa zhodného mena, inak podľa mena s prívlastkom („RUŽOMBEROK/ŠTIAVNIČKA"),
//   - inak PRIBLIŽNÁ poloha = obec z GeoNames (SK.txt), označená `approx: true` (v UI „poloha podľa obce").
// Výstup: public/meteo-stations/shmu-aws.json = { "<kód>": { name, lat, lon, elev?, approx, src } } + SOURCE.md.
//   node scripts/build-shmu-stations.mjs <aws1min JSON> <shmu apocasie.html> <oscar search JSON> <GeoNames SK.txt>
// (aws1min: opendata.shmu.sk/meteorology/climate/now/data/<deň>/…json; apocasie: https://www.shmu.sk/sk/?page=1&id=meteo_apocasie_sk;
//  oscar: https://oscar.wmo.int/surface/rest/api/search/station?territoryName=SVK)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [awsPath, htmlPath, oscarPath, skPath] = process.argv.slice(2);
if (!awsPath || !htmlPath || !oscarPath || !skPath) { console.error('použitie: node scripts/build-shmu-stations.mjs aws.json apocasie.html oscar.json SK.txt'); process.exit(2); }

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ids = [...new Set(JSON.parse(fs.readFileSync(awsPath, 'utf8')).data.map((d) => String(d.ind_kli)))].sort();
const html = fs.readFileSync(htmlPath, 'utf8');
const names = new Map();
for (const m of html.matchAll(/pre stanicu ([^"]+)" href="\?page=1&amp;id=meteo_apocasie_sk&amp;ii=(\d+)/g)) names.set(m[2], m[1].trim());

const oscar = JSON.parse(fs.readFileSync(oscarPath, 'utf8')).stationSearchResults || [];
const byWmo = new Map();
const byName = new Map();
for (const s of oscar) {
  if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude) || /^radar/i.test(s.name)) continue;
  byName.set(fold(s.name), s);
  for (const w of s.wigosStationIdentifiers || []) {
    const m = /^0-20000-0-(\d{5})$/.exec(w.wigosStationIdentifier);
    if (m) byWmo.set(m[1], s);
  }
}
/**
 * Meno s prívlastkom: OSCAR „RUŽOMBEROK/ŠTIAVNIČKA" začína menom SHMÚ „Ružomberok", alebo SHMÚ „Žabokreky pri
 * Martine" začína menom OSCAR „ŽABOKREKY". Len jednoznačná zhoda a stanica OSCAR, ktorú ešte nemá iný kód
 * (Košice-Podhradová NIE JE Košice-letisko 11968).
 */
function oscarByPrefix(name, used) {
  const want = fold(name);
  const hits = oscar.filter((s) => {
    if (/^radar/i.test(s.name) || !Number.isFinite(s.latitude) || used.has(s)) return false;
    const got = fold(s.name);
    return got.startsWith(`${want} `) || want.startsWith(`${got} `);
  });
  return hits.length === 1 ? hits[0] : null;
}

// GeoNames: obce (PPL*, nie časti obcí PPLX). Meno, ktoré je v SR viackrát (Jakubovany v Liptove aj pri
// Sabinove), sa NEPRIRADÍ — radšej stanica bez polohy než stanica o 100 km vedľa.
const places = new Map(); // meno → [{ lat, lon }]
for (const line of fs.readFileSync(skPath, 'utf8').split('\n')) {
  const c = line.split('\t');
  if (c.length < 15 || c[6] !== 'P' || c[7] === 'PPLX') continue;
  const key = fold(c[1]);
  if (!places.has(key)) places.set(key, []);
  places.get(key).push({ lat: Number(c[4]), lon: Number(c[5]) });
}
function geonamesFor(name) {
  const full = fold(name);
  for (const k of [full, fold(String(name).split(' - ')[0]), full.replace(/ (pri|nad|pod) .*$/, '')]) {
    const list = places.get(k);
    if (list?.length === 1) return { ...list[0], key: k };
    if (list?.length > 1) return { ambiguous: true, key: k };
  }
  return null;
}

const out = {};
const stats = { wmo: 0, name: 0, prefix: 0, geonames: 0, missing: [] };
const used = new Set(byWmo.values());
const r4 = (v) => Math.round(v * 1e4) / 1e4;
for (const id of ids) {
  const name = names.get(id) || null;
  let s = byWmo.get(id);
  let src = 'oscar-wmo';
  if (!s && name) { s = byName.get(fold(name)); src = 'oscar-name'; if (s && used.has(s)) s = null; }
  if (!s && name) { s = oscarByPrefix(name, used); src = 'oscar-prefix'; }
  if (s) {
    used.add(s);
    out[id] ={ name: name || s.name, lat: r4(s.latitude), lon: r4(s.longitude), elev: Number.isFinite(s.elevation) ? s.elevation : null, approx: false, src };
    stats[src === 'oscar-wmo' ? 'wmo' : src === 'oscar-name' ? 'name' : 'prefix'] += 1;
    continue;
  }
  const g = name ? geonamesFor(name) : null;
  if (g && !g.ambiguous) {
    out[id] = { name, lat: r4(g.lat), lon: r4(g.lon), elev: null, approx: true, src: 'geonames' };
    stats.geonames += 1;
  } else stats.missing.push(`${id}:${name || '?'}${g?.ambiguous ? ' (meno viackrát)' : ''}`);
}

const dir = path.join(root, 'public', 'meteo-stations');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'shmu-aws.json'), JSON.stringify(out));
fs.writeFileSync(path.join(dir, 'SOURCE.md'), `# Automatické stanice SHMÚ — mená a polohy\n\nKódy staníc (ind_kli) z otvorených dát SHMÚ (opendata.shmu.sk, CC BY 4.0), mená z tabuľky aktuálneho počasia\nna shmu.sk. Polohy: WMO OSCAR/Surface (https://oscar.wmo.int, verejný register staníc WMO) podľa indexu WMO alebo\nmena (src oscar-wmo / oscar-name / oscar-prefix); kde OSCAR stanicu nemá, PRIBLIŽNÁ poloha obce z GeoNames\n(CC BY 4.0, src geonames, approx: true — UI ju tak označí). Postavené ${new Date().toISOString().slice(0, 10)} skriptom\nscripts/build-shmu-stations.mjs. Stanice: WMO ${stats.wmo}, meno ${stats.name}, prívlastok ${stats.prefix}, obec ${stats.geonames}.\n`);
console.log(JSON.stringify({ ...stats, total: Object.keys(out).length, of: ids.length }));
