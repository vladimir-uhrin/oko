// src/data/meteoLazy.test.mjs — lenivý zástupca meteo vrstvy.
import test from 'node:test';
import assert from 'node:assert/strict';

import lazy, { METEO_LAZY_META, METEO_LAZY_PARAMS, isMeteoLoaded, loadMeteoLayer, _resetMeteoLazyForTest } from './meteoLazy.js';
import real from './meteoLayer.js';

test('metadáta zástupcu sa zhodujú so skutočnou vrstvou (stráž proti rozídeniu)', () => {
  // Zástupca ich nesie zopakované zámerne — importovať ich z meteoLayer.js by
  // ten modul načítalo a lenivosť by padla. Preto ich stráži tento test.
  assert.equal(METEO_LAZY_META.id, real.id);
  assert.equal(METEO_LAZY_META.name, real.name);
  assert.equal(METEO_LAZY_META.icon, real.icon);
  assert.equal(METEO_LAZY_META.updateInterval, real.updateInterval);
});

test('zástupca pokrýva celý kontrakt, ktorý správca z modulu volá', () => {
  // Zoznam je odvodený z manager.js (entry.module.*) — keď tam pribudne člen,
  // zástupca ho musí mať tiež, inak vrstva po zlenivení ticho stratí schopnosť.
  for (const key of ['id', 'name', 'icon', 'source', 'updateInterval', 'init', 'enable',
    'disable', 'destroy', 'getStats', 'getParams', 'setParams', 'getRowControls']) {
    assert.ok(key in lazy, `zástupcovi chýba ${key}`);
  }
  for (const fn of ['init', 'enable', 'disable', 'destroy', 'getStats', 'getParams', 'setParams', 'getRowControls']) {
    assert.equal(typeof lazy[fn], 'function', `${fn} musí byť funkcia`);
  }
});

test('pred dotiahnutím nič nepadá a nevymýšľa si stav', () => {
  _resetMeteoLazyForTest();
  assert.equal(isMeteoLoaded(), false);
  assert.deepEqual(lazy.getParams(), { ...METEO_LAZY_PARAMS }, 'predvolby zhodné s vrstvou');
  // TVAR sa musí zhodovať so skutočnou vrstvou aj pred načítaním — prázdne
  // POLE tu bola chyba: UI číta .chips a spadlo by.
  const rc = lazy.getRowControls();
  assert.ok(!Array.isArray(rc), 'getRowControls vracia objekt, nie pole');
  assert.deepEqual(rc, { chips: [], legend: [] }, 'čipy patria až aktívnej vrstve');
  assert.equal(lazy.getStats().count, 0);
  assert.match(lazy.source, /THREDDS/, 'zdroj povie, čo je isté, bez vymysleného behu');
  // Volania životného cyklu pred init() nesmú hodiť.
  assert.doesNotThrow(() => { lazy.enable(); lazy.disable(); lazy.setParams({ field: 'temp' }); });
});

test('loadMeteoLayer dotiahne skutočnú vrstvu a ďalej deleguje', async () => {
  _resetMeteoLazyForTest();
  const loaded = await loadMeteoLayer();
  assert.equal(loaded, real, 'dotiahne ten istý modul');
  assert.equal(isMeteoLoaded(), true);
  assert.equal(lazy.getParams().field, real.getParams().field, 'po dotiahnutí deleguje');
  assert.equal(lazy.source, real.source);
  _resetMeteoLazyForTest();
});

test('predvolby zástupcu sedia so skutočnými počiatočnými parametrami vrstvy', () => {
  assert.deepEqual({ ...METEO_LAZY_PARAMS }, real.getParams(),
    'inak by appka pred dotiahnutím hlásila iný stav, než aký vrstva naozaj má');
});
