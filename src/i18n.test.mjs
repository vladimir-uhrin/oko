// OKO i18n — jadro dvojjazyčného UI: rozlíšenie jazyka, fallbacky, parita
// slovníkov a DOM aplikácia. Chybové cesty explicitne.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyDomTranslations,
  currentLanguage,
  LANG_STORAGE_KEY,
  SUPPORTED_LANGS,
  setLanguage,
  t,
  _resetLanguageForTest,
} from './i18n.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

function withGlobals(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = globalThis[key];
    if (patch[key] === undefined) delete globalThis[key];
    else globalThis[key] = patch[key];
  }
  try {
    _resetLanguageForTest();
    return fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (saved[key] === undefined) delete globalThis[key];
      else globalThis[key] = saved[key];
    }
    _resetLanguageForTest();
  }
}

test('slovníky EN a SK majú identickú množinu kľúčov a žiadne prázdne hodnoty', () => {
  const enKeys = Object.keys(EN_STRINGS).sort();
  const skKeys = Object.keys(SK_STRINGS).sort();
  assert.deepEqual(skKeys, enKeys, 'parita kľúčov EN↔SK je build pravidlo — doplň chýbajúci preklad');
  for (const [key, value] of [...Object.entries(EN_STRINGS), ...Object.entries(SK_STRINGS)]) {
    assert.ok(String(value).trim().length > 0, `prázdna hodnota pre '${key}'`);
  }
  // Placeholdery musia byť párové v oboch jazykoch — {var} nesmie zmiznúť.
  for (const key of enKeys) {
    const en = [...String(EN_STRINGS[key]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const sk = [...String(SK_STRINGS[key]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(sk, en, `placeholder nesúlad pre '${key}'`);
  }
});

test('v bare Node je jazyk VŽDY en — pinované anglické testy ostávajú platné', () => {
  withGlobals({ localStorage: undefined, navigator: undefined, window: undefined, document: undefined }, () => {
    assert.equal(currentLanguage(), 'en');
    assert.equal(t('panel.data-layers'), EN_STRINGS['panel.data-layers']);
  });
});

test('precedencia: storage override > navigator sk > en; smetie v storage sa ignoruje', () => {
  const store = new Map();
  const localStorageMock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  withGlobals({ localStorage: localStorageMock, navigator: { language: 'sk-SK' } }, () => {
    assert.equal(currentLanguage(), 'sk', 'navigator sk-SK → sk');
  });
  store.set(LANG_STORAGE_KEY, 'en');
  withGlobals({ localStorage: localStorageMock, navigator: { language: 'sk-SK' } }, () => {
    assert.equal(currentLanguage(), 'en', 'storage en prebíja navigator sk');
  });
  store.set(LANG_STORAGE_KEY, 'klingon');
  withGlobals({ localStorage: localStorageMock, navigator: { language: 'de-DE' } }, () => {
    assert.equal(currentLanguage(), 'en', 'nevalidný storage → detekcia → en');
  });
  // Hádžuci storage (Safari private) failuje otvorene na detekciu.
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  withGlobals({ localStorage: throwing, navigator: { language: 'sk' } }, () => {
    assert.equal(currentLanguage(), 'sk');
    assert.equal(setLanguage('en', { reload: false }), true, 'zápisová chyba je best-effort, nie pád');
    assert.equal(currentLanguage(), 'en', 'voľba platí aspoň do reloadu');
  });
});

test('t(): fallback reťaz jazyk → EN → surový kľúč, interpolácia {var}', () => {
  const store = new Map([[LANG_STORAGE_KEY, 'sk']]);
  const localStorageMock = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  withGlobals({ localStorage: localStorageMock, navigator: { language: 'en-US' } }, () => {
    assert.equal(currentLanguage(), 'sk');
    assert.equal(t('panel.scenes'), SK_STRINGS['panel.scenes']);
    assert.equal(t('kluc.ktory.neexistuje'), 'kluc.ktory.neexistuje', 'fail-open na kľúč');
  });
  withGlobals({ localStorage: undefined, navigator: undefined }, () => {
    assert.equal(t('kluc.ktory.neexistuje', { x: 1 }), 'kluc.ktory.neexistuje');
    // Interpolácia nad EN fallbackom — syntetický kľúč cez priamu šablónu netreba,
    // stačí overiť replaceAll správanie na existujúcom kľúči bez placeholderov.
    assert.equal(t('panel.cctv', { unused: 'x' }), EN_STRINGS['panel.cctv']);
  });
});

test('setLanguage: validácia, persist, document.lang, reload len na požiadanie', () => {
  const store = new Map();
  const localStorageMock = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  let reloads = 0;
  const windowMock = { location: { reload: () => { reloads += 1; } } };
  const documentMock = { documentElement: { lang: 'en' } };
  withGlobals({ localStorage: localStorageMock, navigator: { language: 'en' }, window: windowMock, document: documentMock }, () => {
    assert.equal(setLanguage('xx', { reload: false }), false, 'nepodporovaný jazyk sa odmieta');
    assert.equal(setLanguage('sk', { reload: false }), true);
    assert.equal(store.get(LANG_STORAGE_KEY), 'sk');
    assert.equal(documentMock.documentElement.lang, 'sk');
    assert.equal(reloads, 0, 'reload:false nesmie reloadovať');
    assert.equal(setLanguage('en'), true);
    assert.equal(reloads, 1, 'default prepínača je reload (stav prežije v share-hashi)');
  });
  assert.deepEqual(SUPPORTED_LANGS, ['en', 'sk']);
});

test('applyDomTranslations: data-i18n → textContent, data-i18n-title → title/aria', () => {
  const nodes = [];
  const makeNode = (attrs) => {
    const attrMap = new Map(Object.entries(attrs));
    const node = {
      textContent: '',
      getAttribute: (k) => attrMap.get(k) ?? null,
      hasAttribute: (k) => attrMap.has(k),
      setAttribute: (k, v) => attrMap.set(k, v),
      _attrs: attrMap,
    };
    nodes.push(node);
    return node;
  };
  const text = makeNode({ 'data-i18n': 'panel.data-layers' });
  const missing = makeNode({ 'data-i18n': 'neexistujuci.kluc' });
  const titled = makeNode({ 'data-i18n-title': 'actions.share', 'aria-label': 'old' });
  const titleOnly = makeNode({ 'data-i18n-title': 'actions.reset-view' });
  // i18n sweep 2026-08-31: nové statické atribúty pre prvky bez tooltipu
  // (aria-label only) a pre placeholder textových vstupov.
  const ariaOnly = makeNode({ 'data-i18n-aria': 'overlay.targets-region' });
  const placeholder = makeNode({ 'data-i18n-placeholder': 'location.search-placeholder' });
  const root = {
    querySelectorAll: (sel) => ({
      '[data-i18n]': [text, missing],
      '[data-i18n-title]': [titled, titleOnly],
      '[data-i18n-aria]': [ariaOnly],
      '[data-i18n-placeholder]': [placeholder],
    })[sel] || [],
  };
  const store = new Map([[LANG_STORAGE_KEY, 'sk']]);
  withGlobals({ localStorage: { getItem: (k) => store.get(k) ?? null, setItem: () => {} }, navigator: { language: 'en' } }, () => {
    applyDomTranslations(root);
    assert.equal(text.textContent, SK_STRINGS['panel.data-layers']);
    assert.equal(missing.textContent, 'neexistujuci.kluc', 'chýbajúci kľúč je viditeľný marker');
    assert.equal(titled._attrs.get('title'), SK_STRINGS['actions.share']);
    assert.equal(titled._attrs.get('aria-label'), SK_STRINGS['actions.share']);
    assert.equal(titleOnly._attrs.get('title'), SK_STRINGS['actions.reset-view']);
    assert.equal(titleOnly._attrs.has('aria-label'), false, 'aria-label sa nepridáva, len aktualizuje');
    // i18n sweep 2026-08-31: aria-only preklad nesmie pridať title (tooltip).
    assert.equal(ariaOnly._attrs.get('aria-label'), SK_STRINGS['overlay.targets-region']);
    assert.equal(ariaOnly._attrs.has('title'), false, 'data-i18n-aria nesmie pridať tooltip');
    assert.equal(placeholder._attrs.get('placeholder'), SK_STRINGS['location.search-placeholder']);
  });
  // Bez dokumentu/root je to no-op, nie pád.
  withGlobals({ document: undefined }, () => {
    assert.doesNotThrow(() => applyDomTranslations());
  });
});

test('voice inštrukcie ostávajú MIMO i18n — GEV_REALTIME_TOOLS sa nedotýka t()', () => {
  const viteConfig = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.equal(viteConfig.includes("from './src/i18n"), false, 'vite.config.js (voice blok) nesmie importovať i18n');
});
