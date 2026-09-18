// src/overlayIslands.test.mjs
//
// Zub proti dorastaniu neporiadku (2026-09-18). Každá novšia funkcia si roky
// pridávala vlastný `position: fixed` ostrovček s ručne vybranými súradnicami
// a z-indexom v JS-vstreknutom <style> — bulletin, čip ROPA, čip ÚŽINA, karta
// situácie, značky incidentov. Nikto ich nekoordinoval, prekrývali sa navzájom
// aj s chrómom, a keďže ich geometria nebola v style.css, nevidel ich ani
// stylesheet, ani strážne testy prekážok.
//
// Tento test nepotrebuje register ani novú abstrakciu: stačí, aby sa box
// každého plávajúceho prvku písal do style.css. Kto potrebuje výnimku, musí ju
// sem vymenovať aj s dôvodom — a to je presne tá chvíľa, keď sa niekto zamyslí.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Selectors allowed to declare `position: fixed` from a JS-injected stylesheet.
 * A full-bleed `inset: 0` surface has no coordinates to get wrong and nothing to
 * collide with, so it is not an "island" in the sense this test guards against.
 */
const ALLOWED = new Map([
  ['.gev-screen-whiteboard', 'full-bleed inset:0 annotation surface, pointer-events:none — no placed box'],
]);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(node_modules|dist|local_data)$/.test(entry.name)) sourceFiles(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/** Every `position: fixed` rule inside a JS-injected stylesheet, with its selector. */
function injectedFixedRules(source) {
  const found = [];
  const injection = /textContent\s*=\s*`([\s\S]*?)`/g;
  let block;
  while ((block = injection.exec(source)) !== null) {
    const css = block[1];
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = rule.exec(css)) !== null) {
      if (!/position\s*:\s*fixed/.test(match[2])) continue;
      // A rule may be written over several lines; the selector is the last one.
      const selector = match[1].trim().split('\n').pop().trim();
      const zIndex = (match[2].match(/z-index\s*:\s*([^;]+)/) || [])[1];
      found.push({ selector, zIndex: zIndex ? zIndex.trim() : null });
    }
  }
  return found;
}

test('no module may invent a floating island in a JS-injected stylesheet', () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    if (/\.test\.mjs$|\.test\.js$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const { selector, zIndex } of injectedFixedRules(source)) {
      if (ALLOWED.has(selector)) continue;
      offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')} → ${selector} (z-index ${zIndex ?? 'none'})`);
    }
  }
  assert.deepEqual(
    offenders, [],
    'Put the element\'s box (position, top/right/bottom/left, width, z-index) in style.css '
    + 'instead of a JS-injected <style>. The shipped stylesheet is the single place that '
    + 'decides how anything stacks, and the overlay obstacle tests read stacking from its '
    + 'text. Inner styling may stay in the module. If the element genuinely has no placed '
    + 'box (a full-bleed inset:0 surface), add it to ALLOWED here with the reason.\n'
    + `Offenders:\n  ${offenders.join('\n  ')}`,
  );
});

test('the allow-list stays short and every entry still exists', () => {
  assert.ok(ALLOWED.size <= 3, 'an allow-list this long means the rule is not being followed');
  const all = sourceFiles(SRC)
    .filter((f) => !/\.test\.mjs$|\.test\.js$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  for (const [selector, reason] of ALLOWED) {
    assert.ok(reason && reason.length > 20, `${selector} needs a real reason, not a placeholder`);
    assert.ok(all.includes(selector), `${selector} is allow-listed but no longer exists — drop it`);
  }
});
