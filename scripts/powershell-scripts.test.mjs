// scripts/powershell-scripts.test.mjs
// Windows PowerShell 5.1 číta .ps1 bez BOM ako ANSI — slovenské znaky v reťazcoch
// (— „ ") rozbili terminátor reťazca (2026-09-08, „nepodarilo sa"). Každý .ps1
// v scripts/ preto musí začínať UTF-8 BOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url);

test('každý scripts/*.ps1 začína UTF-8 BOM (Windows PowerShell 5.1 inak číta ANSI)', () => {
  const files = readdirSync(dir).filter((name) => name.endsWith('.ps1'));
  assert.ok(files.length >= 2, 'oko-server.ps1 a install-oko-server-task.ps1 existujú');
  for (const name of files) {
    const bytes = readFileSync(new URL(name, dir));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} bez BOM`);
  }
});
