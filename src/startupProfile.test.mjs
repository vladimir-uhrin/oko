// src/startupProfile.test.mjs — jednorazový CPU profil dev servera po štarte (2026-09-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STARTUP_PROFILE_DIR,
  STARTUP_PROFILE_FLAG,
  startupProfileFileName,
  startupProfilePlugin,
} from '../scripts/lib/startupProfile.mjs';

function fakeFs(files) {
  return {
    existsSync: (p) => files.has(p),
    unlinkSync: (p) => files.delete(p),
    mkdirSync: () => {},
    writeFileSync: (p, data) => files.set(p, data),
  };
}

test('názov súboru nesie dátum a čas', () => {
  assert.equal(startupProfileFileName(new Date(2026, 8, 30, 16, 45, 3)), 'startup-20260930-164503.cpuprofile');
});

test('bez značky plugin nič nenahráva', () => {
  const files = new Map();
  let calls = 0;
  const plugin = startupProfilePlugin({ root: 'R', fsApi: fakeFs(files), record: async () => { calls += 1; return {}; }, log: () => {} });
  plugin.configureServer();
  assert.equal(calls, 0);
});

test('so značkou nahrá raz, značku zmaže a profil zapíše do logov', async () => {
  const flag = path.join('R', STARTUP_PROFILE_FLAG);
  const files = new Map([[flag, '']]);
  const logs = [];
  let calls = 0;
  const plugin = startupProfilePlugin({
    root: 'R',
    fsApi: fakeFs(files),
    record: async (ms) => { calls += 1; return { nodes: [], ms }; },
    log: (line) => logs.push(line),
    clock: () => new Date(2026, 8, 30, 16, 45, 3),
    durationMs: 5,
  });
  plugin.configureServer();
  plugin.configureServer(); // reštart servera počas nahrávania — druhé nahrávanie nezačne
  assert.equal(files.has(flag), false, 'značka je zmazaná hneď');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  const out = path.join('R', STARTUP_PROFILE_DIR, 'startup-20260930-164503.cpuprofile');
  assert.deepEqual(JSON.parse(files.get(out)), { nodes: [], ms: 5 });
  assert.ok(logs.some((l) => l.includes('zapísaný')));
});

test('vite.config.js plugin zapája pred posledný plugin', () => {
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /import \{ startupProfilePlugin \} from '\.\/scripts\/lib\/startupProfile\.mjs';/);
  assert.match(vite, /startupProfilePlugin\(\{ root: __dirname \}\),/);
});
