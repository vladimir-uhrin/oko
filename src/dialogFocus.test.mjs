// Spoločné správanie fokusu okien (2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rememberOpener, restoreOpener, claimEscape } from './dialogFocus.js';

const el = (extra = {}) => ({ tagName: 'BUTTON', focused: 0, focus() { this.focused += 1; }, ...extra });

test('rememberOpener: tlačidlo si zapamätá, pole na písanie, body a nič nie', () => {
  const button = el();
  assert.equal(rememberOpener({ activeElement: button, body: {} }), button);
  const body = el({ tagName: 'BODY' });
  assert.equal(rememberOpener({ activeElement: body, body }), null, 'body nie je cieľ');
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(rememberOpener({ activeElement: el({ tagName }), body: {} }), null, `${tagName} by znova vytiahol klávesnicu`);
  }
  assert.equal(rememberOpener({ activeElement: el({ isContentEditable: true }), body: {} }), null);
  assert.equal(rememberOpener({ activeElement: null, body: {} }), null);
  assert.equal(rememberOpener({}), null, 'falošný DOM bez activeElement');
  assert.equal(rememberOpener(null), null);
});

test('restoreOpener: vráti fokus živému prvku, odpojený alebo chýbajúci nechá', () => {
  const button = el();
  assert.equal(restoreOpener(button), true);
  assert.equal(button.focused, 1);
  assert.equal(restoreOpener(el({ isConnected: false })), false);
  assert.equal(restoreOpener(null), false);
  assert.equal(restoreOpener({ focus() { throw new Error('x'); } }), false, 'chyba fokusu stránku nezhodí');
});

test('claimEscape: zastaví predvolenú akciu aj bublanie, znesie udalosť bez metód', () => {
  const calls = [];
  claimEscape({ preventDefault: () => calls.push('p'), stopPropagation: () => calls.push('s') });
  assert.deepEqual(calls, ['p', 's']);
  assert.doesNotThrow(() => claimEscape({}));
  assert.doesNotThrow(() => claimEscape(undefined));
});

test('zapojenie: paleta, zdieľanie a výsuv telefónu vracajú fokus a Escape nepustia ďalej', () => {
  const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
  const palette = read('commandPalette.js');
  assert.match(palette, /_opener = rememberOpener\(doc\);/);
  assert.match(palette, /restoreOpener\(_opener\); _opener = null;/);
  assert.match(palette, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\?\.\(\); close\(\); \}/);
  const share = read('sharePanel.js');
  assert.match(share, /ui\.opener = rememberOpener\(doc\);/);
  assert.match(share, /restoreOpener\(ui\.opener\); ui\.opener = null;/);
  assert.match(share, /claimEscape\(event\); hide\(\); \} \}, true\);/, 'Escape v zachytávacej fáze — okno zdieľania je nad výsuvom');
  const shell = read('mobileShell.js');
  assert.match(shell, /function closeByUser\(\)/);
  assert.match(shell, /closeButton\?\.addEventListener\?\.\('click', \(\) => closeByUser\(\)\);/);
});
