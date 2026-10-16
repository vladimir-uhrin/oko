// Index preložených ID lodí (2026-10-16): štart oko-api nesmie synchrónne čítať desaťtisíce súborov.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SHIP_ID_INDEX_FILE, SHIP_ID_MIGRATED_FILE, createShipIdIndex, formatShipIdLine, mmsiFromLegacyEntry, parseShipIdIndex, parseShipIdLine,
} from './shipIdIndex.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oko-shipids-'));
const quiet = { log() {}, warn() {} };

test('riadok indexu: ID, MMSI alebo „-", čas; neplatné ID nič', () => {
  assert.equal(formatShipIdLine('123456', '211234567', 1000.4), '123456\t211234567\t1000\n');
  assert.equal(formatShipIdLine(123, null, 5), '123\t-\t5\n');
  assert.equal(formatShipIdLine('12a', '211234567', 1), null);
  assert.deepEqual(parseShipIdLine('123456\t211234567\t1000'), ['123456', '211234567']);
  assert.deepEqual(parseShipIdLine('77\t-\t0'), ['77', null]);
  assert.equal(parseShipIdLine('x\t211234567'), null);
  assert.equal(parseShipIdLine(''), null);
  assert.equal(mmsiFromLegacyEntry({ mmsi: '211234567' }), '211234567');
  assert.equal(mmsiFromLegacyEntry({ ship: { mmsi: '311000000' } }), '311000000');
  assert.equal(mmsiFromLegacyEntry({ mmsi: 'abc' }), null);
});

test('parsovanie po dávkach uvoľňuje vlákno; posledný riadok pre ID vyhráva', async () => {
  const lines = [];
  for (let i = 0; i < 50; i += 1) lines.push(`${i}\t2110000${String(i).padStart(2, '0')}\t0`);
  lines.push('7\t-\t9', 'zlý riadok', '');
  const map = new Map();
  let yields = 0;
  const n = await parseShipIdIndex(lines.join('\r\n'), map, { chunk: 10, yieldFn: async () => { yields += 1; } });
  assert.equal(n, 51);
  assert.equal(map.size, 50);
  assert.equal(map.get('7'), null, 'neskorší riadok prepíše skorší');
  assert.equal(map.get('8'), '211000008');
  assert.ok(yields >= 5, `uvoľnení ${yields}`);
});

test('prvý štart: starý adresár mt/ sa prenesie raz na pozadí, ďalší štart číta len index', async () => {
  const dir = tmpDir();
  const mt = path.join(dir, 'mt');
  fs.mkdirSync(mt);
  fs.writeFileSync(path.join(mt, 'ship-100.json'), JSON.stringify({ at: 1, mmsi: '211000100' }));
  fs.writeFileSync(path.join(mt, 'ship-200.json'), JSON.stringify({ at: 1, ship: { mmsi: '311000200' } }));
  fs.writeFileSync(path.join(mt, 'ship-300.json'), JSON.stringify({ at: 1, mmsi: null }));
  fs.writeFileSync(path.join(mt, 'ship-400.json'), '{poškodený');
  fs.writeFileSync(path.join(mt, '211000100.id.json'), JSON.stringify({ at: 1, shipId: '100' }));
  const known = new Map([['200', '999999999']]); // čerstvý preklad z bežiacej slučky sa neprepíše
  const idx = createShipIdIndex({ dir, known, log: quiet, concurrency: 2 });
  await idx.load();
  assert.equal(known.get('100'), '211000100');
  assert.equal(known.get('200'), '999999999');
  assert.equal(known.get('300'), null);
  assert.equal(known.has('400'), false);
  assert.ok(fs.existsSync(path.join(dir, SHIP_ID_MIGRATED_FILE)));
  const text = fs.readFileSync(path.join(dir, SHIP_ID_INDEX_FILE), 'utf8');
  assert.equal(text.trim().split('\n').length, 3);

  // druhý štart: adresár mt/ sa už neotvára (opendir by zlyhal)
  const fsp = { ...fs.promises, opendir: async () => { throw new Error('nemá sa volať'); } };
  const known2 = new Map();
  const idx2 = createShipIdIndex({ dir, known: known2, fsp, log: quiet });
  assert.equal(await idx2.load(), 3);
  assert.equal(known2.get('200'), '311000200');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nové preklady sa pripíšu dávkou a po reštarte sú známe', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, SHIP_ID_MIGRATED_FILE), '1');
  let scheduled = null;
  const idx = createShipIdIndex({ dir, known: new Map(), log: quiet, setTimeoutImpl: (fn) => { scheduled = fn; return { unref() {} }; } });
  idx.append('500', '211000500', 10);
  idx.append('600', null, 11);
  idx.append('zlé', '211000700', 12);
  assert.equal(typeof scheduled, 'function', 'zápis je odložený, nie pri každom preklade');
  assert.equal(fs.existsSync(path.join(dir, SHIP_ID_INDEX_FILE)), false);
  await idx.flush();
  const known = new Map();
  await createShipIdIndex({ dir, known, log: quiet }).load();
  assert.equal(known.get('500'), '211000500');
  assert.equal(known.get('600'), null);
  assert.equal(known.size, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('createAisSupplements: start() sa vráti hneď, preklady z indexu sa doplnia asynchrónne', async () => {
  const { createAisSupplements } = await import('./supplements.js');
  const root = tmpDir();
  const infoDir = path.join(root, '.gev-cache', 'vessel-info');
  fs.mkdirSync(infoDir, { recursive: true });
  fs.writeFileSync(path.join(infoDir, SHIP_ID_INDEX_FILE), '900\t211000900\t1\n');
  fs.writeFileSync(path.join(infoDir, SHIP_ID_MIGRATED_FILE), '1');
  const logs = [];
  const sup = createAisSupplements({
    rootDir: root, env: {}, vessels: new Map(), tracks: new Map(), appendTrack() {}, cacheMax: 10,
    setIntervalImpl: () => ({ unref() {} }), fetchImpl: async () => { throw new Error('bez siete'); },
    log: { log: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  sup.start();
  assert.equal(sup.started(), true);
  for (let i = 0; i < 50 && !logs.some((m) => /\[ship-ids\] index: 1 /.test(m)); i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.ok(logs.some((m) => /\[ship-ids\] index: 1 prekladov/.test(m)), logs.join(' | '));
  sup.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

test('supplements.js pri štarte nečíta disk synchrónne (2026-10-16: 50–231 s zastavené oko-api)', () => {
  const src = fs.readFileSync(new URL('./supplements.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bfs\.(readFileSync|readdirSync|writeFileSync|mkdirSync|statSync|existsSync)\b/);
  assert.match(src, /createShipIdIndex\(\{ dir: infoDir, known: resolver\.known/);
  assert.match(src, /void idIndex\.load\(\)/);
});
