// scripts/lib/captureGuards.test.mjs — poistky nahrávania videa (bez prehliadača, falošná stránka a snímky):
// nové načítanie dokumentu sa zruší a spočíta; zaseknutá snímka = hneď nová scéna a ďalší pokus tou istou
// snímkou; iná chyba sa raz skúsi na tej istej stránke; po vyčerpaní pokusov čitateľná chyba.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockPageReloads, shootWithRecovery } from './captureGuards.mjs';

/** Falošná stránka puppeteera s jednou CDP reláciou. */
function fakePage({ failRequestRejects = false } = {}) {
  const sent = [];
  const handlers = {};
  const cdp = {
    async send(method, params) {
      sent.push([method, params]);
      if (method === 'Fetch.failRequest' && failRequestRejects) throw new Error('Target closed');
      return {};
    },
    on(event, fn) { handlers[event] = fn; },
  };
  return { page: { createCDPSession: async () => cdp }, sent, emit: (event, payload) => handlers[event]?.(payload) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('nové načítanie dokumentu sa zruší a spočíta; filter je len na dokumenty', async () => {
  const { page, sent, emit } = fakePage();
  const seen = [];
  const guard = await blockPageReloads(page, { onBlocked: (n) => seen.push(n) });
  assert.deepEqual(sent, [['Fetch.enable', { patterns: [{ resourceType: 'Document' }] }]], 'dáta a dlaždice sa nezachytávajú');
  assert.equal(guard.blocked, 0);
  emit('Fetch.requestPaused', { requestId: 'r1' });
  emit('Fetch.requestPaused', { requestId: 'r2' });
  await tick();
  assert.deepEqual(sent.slice(1), [
    ['Fetch.failRequest', { requestId: 'r1', errorReason: 'Aborted' }],
    ['Fetch.failRequest', { requestId: 'r2', errorReason: 'Aborted' }],
  ]);
  assert.equal(guard.blocked, 2);
  assert.deepEqual(seen, [1, 2]);
});

test('zlyhané zrušenie ani chyba v hlásení nahrávanie nezhodia', async () => {
  const { page, emit } = fakePage({ failRequestRejects: true });
  const guard = await blockPageReloads(page, { onBlocked: () => { throw new Error('log spadol'); } });
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    assert.doesNotThrow(() => emit('Fetch.requestPaused', { requestId: 'r1' }));
    await tick(); await tick();
  } finally { process.off('unhandledRejection', onUnhandled); }
  assert.equal(guard.blocked, 1);
  assert.deepEqual(unhandled, []);
});

test('snímka na prvý pokus: nič sa neotvára nanovo', async () => {
  const calls = { reopen: 0 };
  const jpg = await shootWithRecovery({ shoot: async () => 'jpg', reopen: async () => { calls.reopen += 1; }, timeoutMs: 1000 });
  assert.equal(jpg, 'jpg');
  assert.equal(calls.reopen, 0);
});

test('zaseknutá snímka: po časovom limite hneď nová scéna a tá istá snímka znova; hlásenie nesie krok', async () => {
  const log = [];
  const order = [];
  let shots = 0;
  const jpg = await shootWithRecovery({
    shoot: () => { shots += 1; order.push(`shoot${shots}`); return shots === 1 ? new Promise(() => {}) : Promise.resolve('jpg'); },
    reopen: async () => { order.push('reopen'); },
    timeoutMs: 20, label: 'snímka 67', step: () => 'fotka', log: (m) => log.push(m),
  });
  assert.equal(jpg, 'jpg');
  assert.deepEqual(order, ['shoot1', 'reopen', 'shoot2'], 'zaseknutá stránka sa sama nespamätá — nečaká sa na druhý limit');
  assert.deepEqual(log, ['snímka 67, pokus 1: časový limit: snímka 67 (krok: fotka)']);
});

test('iná chyba: raz sa skúsi na tej istej stránke, až potom nová scéna', async () => {
  const order = [];
  const log = [];
  let shots = 0;
  const jpg = await shootWithRecovery({
    shoot: async () => { shots += 1; order.push(`shoot${shots}`); if (shots < 3) throw new Error('Execution context was destroyed'); return 'jpg'; },
    reopen: async () => { order.push('reopen'); },
    timeoutMs: 1000, label: 'snímka 5', step: () => 'vrstvy', log: (m) => log.push(m),
  });
  assert.equal(jpg, 'jpg');
  assert.deepEqual(order, ['shoot1', 'shoot2', 'reopen', 'shoot3']);
  assert.deepEqual(log, [
    'snímka 5, pokus 1: Execution context was destroyed',
    'snímka 5, pokus 2: Execution context was destroyed',
  ], 'krok sa uvádza len pri zaseknutí');
});

test('vyčerpané pokusy: chyba FRAME_FAILED; po poslednom pokuse sa už neotvára; zlyhané otvorenie sa zapíše a skúša sa ďalej', async () => {
  const order = [];
  const log = [];
  let shots = 0;
  await assert.rejects(
    shootWithRecovery({
      shoot: async () => { shots += 1; order.push(`shoot${shots}`); throw new Error('zle'); },
      reopen: async () => { order.push('reopen'); throw new Error('OKO sa nenačítalo'); },
      timeoutMs: 1000, attempts: 3, label: 'snímka 9', log: (m) => log.push(m),
    }),
    (e) => e.code === 'FRAME_FAILED' && /snímka 9 sa nepodarila/.test(e.message),
  );
  assert.deepEqual(order, ['shoot1', 'shoot2', 'reopen', 'shoot3']);
  assert.ok(log.includes('nový prehliadač: OKO sa nenačítalo'));
});

test('časovač snímky po úspechu nevisí (proces môže skončiť)', async () => {
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  await shootWithRecovery({ shoot: async () => 1, reopen: async () => {}, timeoutMs: 60_000 });
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.equal(after, before);
});
