// src/schedulerTasks.test.mjs
// Tripwire (2026-09-14): úlohy Plánovača, ktoré držia dev server, statický
// server a cloudflared, musia bežať s prioritou Normal. Predvolená priorita
// úlohy je 7 = BelowNormal — pri vyťaženom stroji (Docker, prehliadač,
// Defender) dev server nedostával CPU, /api odpovedalo 80–100 s a verejná
// adresa vracala 502. Po prepnutí bežiaceho procesu na Normal klesla odozva
// /robots.txt z 3–10 s na 2–5 ms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SCRIPTS = [
  'install-oko-server-task.ps1',
  'oko-publish.ps1',
  'oko-tunnel-setup.ps1',
];

test('úlohy Plánovača (dev server, statický server, tunel) sa registrujú s -Priority 4 (Normal), nie s predvolenou 7 (BelowNormal)', () => {
  for (const name of SCRIPTS) {
    const src = readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    const settingsLines = src.split(/\r?\n/).filter((line) => line.includes('New-ScheduledTaskSettingsSet'));
    assert.ok(settingsLines.length >= 1, `${name}: registruje úlohu cez New-ScheduledTaskSettingsSet`);
    // PowerShell riadok môže pokračovať backtickom na ďalších riadkoch — hľadaj -Priority 4 v celom bloku.
    const block = src.slice(src.indexOf('New-ScheduledTaskSettingsSet'), src.indexOf('Register-ScheduledTask'));
    assert.match(block, /-Priority 4\b/, `${name}: New-ScheduledTaskSettingsSet musí mať -Priority 4`);
  }
});

test('skripty Plánovača ostávajú UTF-8 s BOM (PowerShell 5.1 inak číta diakritiku v komentároch zle)', () => {
  for (const name of SCRIPTS) {
    const bytes = readFileSync(new URL(`../scripts/${name}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name}: chýba BOM`);
  }
});
