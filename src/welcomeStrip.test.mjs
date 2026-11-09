// Uvítací pás (2026-11-09): kedy sa ukáže sám a čo robia voľby.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shouldAutoShowWelcome, welcomeConsentWait, createWelcomeStrip, WELCOME_CHOICES, WELCOME_STORAGE_KEY } from './welcomeStrip.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

function fakeDoc() {
  const listeners = {};
  const make = (tag) => ({
    tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, listeners: {}, parent: null, textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
    contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; },
    set innerHTML(v) { this.html = v; },
  });
  return {
    body: make('body'), activeElement: null,
    createElement: make,
    addEventListener(type, fn) { listeners[type] = fn; },
    fire(type, event = {}) { listeners[type]?.(event); },
  };
}
const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const collect = (node, pred, out = []) => { if (pred(node)) out.push(node); for (const c of node.children || []) collect(c, pred, out); return out; };

test('sám sa ukáže len pri čistom štarte', () => {
  assert.equal(shouldAutoShowWelcome({}), true);
  assert.equal(shouldAutoShowWelcome({ seen: true }), false, 'už videný');
  assert.equal(shouldAutoShowWelcome({ hasShareState: true }), false, 'odkaz so stavom');
  assert.equal(shouldAutoShowWelcome({ search: '?front=front' }), false, 'hlboký odkaz');
  assert.equal(shouldAutoShowWelcome({ search: '?qaBasemap=osm' }), false, 'QA beh');
  assert.equal(shouldAutoShowWelcome({ crawler: true }), false, 'robot');
  assert.equal(shouldAutoShowWelcome({ embed: true }), false, 'vložený rámček');
  assert.equal(shouldAutoShowWelcome({ search: '?' }), true, 'prázdny otáznik nie je parameter');
});

test('na telefóne pás čaká na lištu súhlasu, na počítači nie', () => {
  assert.equal(welcomeConsentWait({ onPhone: true, consentOpen: true }), true);
  assert.equal(welcomeConsentWait({ onPhone: true, consentOpen: false }), false);
  assert.equal(welcomeConsentWait({ onPhone: false, consentOpen: true }), false);
  // zapojenie: main.js sa pýta tohto pravidla pred zobrazením
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(!welcomeConsentWait\(\{ onPhone: onPhone\(\), consentOpen: consentOpen\(\) \}\)\) \{ showWelcome\(\); return; \}/);
});

test('autoShow zapíše videné a druhýkrát sa už neukáže', () => {
  const doc = fakeDoc();
  const storage = fakeStorage();
  const strip = createWelcomeStrip({ doc, storage, translate: (k) => k, actions: { flights: () => {} } });
  assert.equal(strip.autoShow({}), true);
  assert.equal(storage.getItem(WELCOME_STORAGE_KEY), '1');
  strip.close();
  assert.equal(strip.autoShow({}), false);
  assert.equal(doc.body.children.length, 0);
});

test('voľba pás zavrie a spustí práve svoju akciu; voľba bez akcie sa nekreslí', () => {
  const doc = fakeDoc();
  const ran = [];
  const strip = createWelcomeStrip({
    doc, storage: fakeStorage(), translate: (k) => k,
    actions: { flights: () => ran.push('flights'), weather: () => ran.push('weather') },
  });
  strip.open();
  const choices = collect(doc.body.children[0], (n) => Boolean(n.dataset?.welcomeChoice));
  assert.deepEqual(choices.map((c) => c.dataset.welcomeChoice), ['flights', 'weather']);
  choices[1].listeners.click();
  assert.deepEqual(ran, ['weather']);
  assert.equal(strip.isOpen(), false);
});

test('chyba v akcii stránku nezhodí a udalosť oko:welcome-open pás otvorí znova', () => {
  const doc = fakeDoc();
  const strip = createWelcomeStrip({
    doc, storage: fakeStorage({ [WELCOME_STORAGE_KEY]: '1' }), translate: (k) => k,
    actions: { flights: () => { throw new Error('x'); } },
  });
  doc.fire('oko:welcome-open');
  assert.equal(strip.isOpen(), true);
  const [choice] = collect(doc.body.children[0], (n) => n.dataset?.welcomeChoice === 'flights');
  assert.doesNotThrow(() => choice.listeners.click());
});

test('každá voľba má preklad v oboch jazykoch', () => {
  for (const key of ['welcome.title', 'welcome.hint', 'welcome.close', ...WELCOME_CHOICES.map((c) => c.labelKey)]) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
});
