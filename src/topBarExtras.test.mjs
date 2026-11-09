// Horná lišta (2026-11-09): popisy pod ikonami a ponuka Viac.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOP_BAR_CAPTIONS, TOP_MENU_ITEMS, applyTopBarCaptions, visibleMenuItems } from './topBarExtras.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const fakeDoc = (els) => ({ getElementById: (id) => els[id] || null });
const fakeEl = (extra = {}) => ({
  attrs: {}, hidden: false,
  getAttribute(k) { return this.attrs[k] ?? null; },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  ...extra,
});

test('popis dostane každé tlačidlo, ktoré v lište je; chýbajúce nevadí', () => {
  const els = { 'share-btn': fakeEl(), 'cmd-launch': fakeEl() };
  const count = applyTopBarCaptions(fakeDoc(els), (k) => SK_STRINGS[k]);
  assert.equal(count, 2);
  assert.equal(els['share-btn'].attrs['data-caption'], 'Odkaz');
  assert.equal(els['cmd-launch'].attrs['data-caption'], 'Hľadať');
});

test('popisy a položky ponuky majú preklad v oboch jazykoch a krátky text', () => {
  const keys = [...Object.values(TOP_BAR_CAPTIONS), 'topmenu.open', 'topmenu.language', ...TOP_MENU_ITEMS.filter((i) => i.labelKey).map((i) => i.labelKey)];
  for (const key of keys) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  // Popis leží pod 36 px kruhom s rozostupom 22 px — dlhé slovo by sa prekrylo so susedom.
  for (const key of Object.values(TOP_BAR_CAPTIONS)) {
    assert.ok(SK_STRINGS[key].length <= 8 && EN_STRINGS[key].length <= 8, `${key} je krátky`);
  }
});

test('ponuka neukáže položku, ktorej cieľ chýba alebo je skrytý (Súkromie pred načítaním súhlasu)', () => {
  const els = {
    'share-btn': fakeEl(), 'reset-globe-view': fakeEl(), 'clear-selected-layers': fakeEl(),
    'topics-link': fakeEl(), 'consent-open': fakeEl({ hidden: true }),
  };
  const ids = visibleMenuItems(fakeDoc(els)).map((i) => i.id);
  assert.deepEqual(ids, ['welcome', 'share', 'home', 'clear', 'topics']);
});

test('štýl: na telefóne sú v lište len Hľadať, Účet a Viac s cieľom 44 px; na počítači je Viac skryté', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /#top-center-actions > #oko-more-btn \{ display: none; \}/);
  assert.match(css, /body\.oko-mobile #top-center-actions > #oko-more-btn \{ order: 3; display: flex; \}/);
  assert.match(css, /body\.oko-mobile #top-center-actions > #clear-selected-layers,\nbody\.oko-mobile #top-center-actions > #share-btn,\nbody\.oko-mobile #top-center-actions > #reset-globe-view \{ display: none; \}/);
  assert.match(css, /body\.oko-mobile #top-center-actions > button,\nbody\.oko-mobile #top-center-actions #account-btn \{ width: 44px; height: 44px; \}/);
  assert.match(css, /body\.oko-mobile \{ --oko-topbar-h: 56px; \}/);
});

test('štýl: jedno pravidlo viditeľného fokusu pre všetky ovládacie prvky', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /body :is\(button, a\[href\], input, select, textarea[^{]*:not\(canvas\):not\(\.oko-cmd-input\):focus-visible \{\n\s*outline: 2px solid var\(--accent\) !important;/);
});
