// Denné video nesmie vydať starú alebo už použitú zmenu mapy za „uplynulý deň" (2026-10-09/10: zrkadlo mapy
// stálo od 8. 10. a dve videá po sebe ohlásili tú istú zmenu 7. → 8. 10.).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshChange } from './frontDayData.mjs';
import { usedChangeDays } from './frontDayPipeline.mjs';

const change = (toDay, fromDay = '2026-10-07') => ({ ruKm2: 13.4, uaKm2: 0, fromDay, toDay, spanDays: 1, directions: [] });

test('čerstvá a nová zmena prejde; stará alebo už použitá nie', () => {
  assert.equal(freshChange(change('2026-10-08'), { day: '2026-10-08' }).change.toDay, '2026-10-08', 'snímka z dňa hlásenia');
  assert.equal(freshChange(change('2026-10-08'), { day: '2026-10-09' }).change.toDay, '2026-10-08', 'deň starú smie, ak ju nikto nepoužil');
  const used = freshChange(change('2026-10-08'), { day: '2026-10-09', usedToDays: ['2026-10-08'] });
  assert.equal(used.change, null, '9. 10.: tú istú zmenu už ohlásilo video 8. 10.');
  assert.match(used.reason, /^map_already_used:2026-10-08$/);
  const stale = freshChange(change('2026-10-08'), { day: '2026-10-10' });
  assert.equal(stale.change, null, '10. 10.: snímka z 8. 10. je stará');
  assert.match(stale.reason, /^map_stale:2026-10-08$/);
  assert.deepEqual(freshChange(null, { day: '2026-10-10' }), { change: null, reason: null });
});

test('použité dni mapy z úloh predošlých denných videí (len staršie priečinky)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-fd-used-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const job = (name, toDay) => { fs.mkdirSync(path.join(dir, name)); fs.writeFileSync(path.join(dir, name, 'uloha.json'), JSON.stringify({ model: { change: toDay ? { toDay } : null } })); };
  job('2026-10-07', '2026-10-07'); job('2026-10-08', '2026-10-08'); job('2026-10-09', null); job('2026-10-10', '2026-10-08');
  fs.mkdirSync(path.join(dir, 'iny-priecinok'));
  assert.deepEqual(usedChangeDays(dir, '2026-10-10').sort(), ['2026-10-07', '2026-10-08'], 'dnešok a novšie sa nerátajú');
  assert.deepEqual(usedChangeDays(path.join(dir, 'neexistuje'), '2026-10-10'), []);
});
