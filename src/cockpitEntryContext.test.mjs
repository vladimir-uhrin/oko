// src/cockpitEntryContext.test.mjs
// Kokpit: Kontakty zapnuté vstupom sa pri odchode vrátia (2026-09-07,
// používateľ: „keď opustím kokpit, zostane fragment" — prstenec s kontaktnými
// šípkami a BRG/CRS štítkami, ktoré pred vstupom neboli).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');

test('vstup si pamätá, že Kontakty zapol on; odchod ich vráti cez onReleasePreparedEntry', () => {
  assert.match(ui, /const ready = await this\.onPrepareEntry\(\);\s*if \(!ready \|\| !this\.isEntryAllowed\(\)\) return false;\s*this\._preparedContext = true;/, 'flag sa nastaví len po úspešnej príprave');
  assert.match(ui, /this\.onExited\?\.\(\);\s*if \(this\._preparedContext\) \{\s*this\._preparedContext = false;\s*this\.onReleasePreparedEntry\?\.\(\);/, 'exit() uvoľní pripravený kontext raz');
  assert.match(ui, /onReleasePreparedEntry: \(\) => \{\s*void this\.setContextMode\(null, \{ claimVisualAuthority: false \}\);/, 'ui vracia kontext na null bez nároku na vizuálnu autoritu');
});

test('keď Kontakty bežali už pred vstupom, odchod ich nevypne (flag ostáva false)', () => {
  // requestEntry() volá onPrepareEntry LEN keď isEntryAllowed() zlyhá — pri
  // už zapnutých Kontaktoch sa vetva s flagom vôbec nevykoná.
  assert.match(ui, /if \(!this\.isEntryAllowed\(\)\) \{\s*if \(!this\.onPrepareEntry\) return false;/);
});
