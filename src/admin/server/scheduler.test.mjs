// Automatiku adminu spúšťa len vydaná služba oko-api (súbor RELEASE), nie oko-dev z pracovného stromu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adminScheduler } from './scheduler.js';

test('automatika: vydanie (RELEASE) áno, pracovný strom nie', t => {
  const release = mkdtempSync(path.join(tmpdir(), 'oko-release-'));
  const tree = mkdtempSync(path.join(tmpdir(), 'oko-tree-'));
  t.after(() => { rmSync(release, { recursive: true, force: true }); rmSync(tree, { recursive: true, force: true }); });
  writeFileSync(path.join(release, 'RELEASE'), '1403907');
  assert.deepEqual(adminScheduler({ root: release, env: {} }), { enabled: true, reason: 'release' });
  assert.deepEqual(adminScheduler({ root: tree, env: {} }), { enabled: false, reason: 'working-tree' });
});

test('automatika: STUDIO_SCHEDULER prebije rozhodnutie podľa RELEASE', () => {
  const withRelease = () => true; const without = () => false;
  assert.equal(adminScheduler({ root: 'x', env: { STUDIO_SCHEDULER: 'on' }, exists: without }).enabled, true, 'lokálne skúšanie');
  assert.equal(adminScheduler({ root: 'x', env: { STUDIO_SCHEDULER: ' OFF ' }, exists: withRelease }).enabled, false, 'vypnutie vo vydaní');
  assert.equal(adminScheduler({ root: 'x', env: { STUDIO_SCHEDULER: 'nieco' }, exists: withRelease }).reason, 'release', 'neznáma hodnota = predvolené');
});
