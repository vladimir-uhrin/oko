// scripts/build-sk-place-names.mjs
// Slovenské tvary mien miest (2026-10-08, „ako Windy" — mená v jazyku používateľa: Praha, Viedeň,
// Varšava namiesto Prague, Vienna, Warsaw). Z GeoNames alternateNamesV2.txt (CC BY 4.0, ~790 MB,
// stiahnuť a rozbaliť z https://download.geonames.org/export/dump/alternateNamesV2.zip na D:)
// vyberie mená s jazykom „sk" (nie historické ani hovorové; prednostne „preferred") a uloží
// medzivýsledok { geonameid: meno } — ten potom číta scripts/build-meteo-towns.mjs.
//   node scripts/build-sk-place-names.mjs <alternateNamesV2.txt> <výstup sk-names.json>
import fs from 'node:fs';
import readline from 'node:readline';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('použitie: node scripts/build-sk-place-names.mjs alternateNamesV2.txt sk-names.json'); process.exit(2); }

const names = new Map(); // id → { name, preferred, short }
const rl = readline.createInterface({ input: fs.createReadStream(input, { encoding: 'utf8' }), crlfDelay: Infinity });
let lines = 0;
for await (const line of rl) {
  lines += 1;
  const c = line.split('\t');
  if (c[2] !== 'sk') continue;
  const [, id, , name, preferred, short, colloquial, historic] = c;
  if (!name || colloquial === '1' || historic === '1') continue;
  const prev = names.get(id);
  const rank = (preferred === '1' ? 2 : 0) + (short === '1' ? 1 : 0);
  if (!prev || rank > prev.rank) names.set(id, { name, rank });
}
const out = {};
for (const [id, { name }] of names) out[id] = name;
fs.writeFileSync(output, JSON.stringify(out));
console.log(`${lines} riadkov, slovenských mien: ${names.size} → ${output}`);
