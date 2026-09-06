// src/data/countryFlags.test.mjs
// Vlajky štátov pre karty kontaktov (2026-09-05) — mapovanie kódov a mien,
// URL bundlovaných SVG, cache obrázkov, kreslenie do canvasu, tripwires
// (sada na disku, licencia, register zdrojov).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  FLAG_ASPECT,
  FLAG_ICONS_VERSION,
  normalizeIso2,
  countryIso2FromName,
  resolveFlagIso2,
  flagUrl,
  flagWidth,
  getFlagImage,
  paintFlag,
  setFlagReadyListener,
  _resetFlagCacheForTest,
} from './countryFlags.js';
import { selectIsoCountries } from '../../scripts/fetch-flags.mjs';

test('vlajky: normalizácia ISO2 — veľkosť písmen, medzery, neznámy kód', () => {
  assert.equal(normalizeIso2('SK'), 'sk');
  assert.equal(normalizeIso2(' fr '), 'fr');
  assert.equal(normalizeIso2('DE'), 'de');
  assert.equal(normalizeIso2('xx'), null, 'placeholder sady nie je štát');
  assert.equal(normalizeIso2('eu'), null, 'organizácie sa nebundlujú — len štáty');
  assert.equal(normalizeIso2('gb-eng'), null);
  assert.equal(normalizeIso2(''), null);
  assert.equal(normalizeIso2(null), null);
  assert.equal(normalizeIso2(42), null);
});

test('vlajky: meno štátu z OpenSky/adsbdb → ISO2 vrátane ICAO alokačných tvarov', () => {
  assert.equal(countryIso2FromName('Slovakia'), 'sk');
  assert.equal(countryIso2FromName('France'), 'fr');
  assert.equal(countryIso2FromName('United States'), 'us');
  assert.equal(countryIso2FromName('United States of America'), 'us');
  assert.equal(countryIso2FromName('United Kingdom'), 'gb');
  assert.equal(countryIso2FromName('Russian Federation'), 'ru');
  assert.equal(countryIso2FromName('Republic of Korea'), 'kr');
  assert.equal(countryIso2FromName('Czech Republic'), 'cz');
  assert.equal(countryIso2FromName('Czechia'), 'cz');
  assert.equal(countryIso2FromName('Türkiye'), 'tr');
  assert.equal(countryIso2FromName('Turkey'), 'tr');
  assert.equal(countryIso2FromName('Iran, Islamic Republic of'), 'ir');
  assert.equal(countryIso2FromName('Viet Nam'), 'vn');
  assert.equal(countryIso2FromName("Côte d'Ivoire"), 'ci', 'diakritika a apostrof nevadia');
  assert.equal(countryIso2FromName('Cote d’Ivoire'), 'ci');
  assert.equal(countryIso2FromName('Kingdom of the Netherlands'), 'nl');
  assert.equal(countryIso2FromName('Atlantis'), null);
  assert.equal(countryIso2FromName(''), null);
  assert.equal(countryIso2FromName(undefined), null);
});

test('vlajky: resolveFlagIso2 berie prvý použiteľný kandidát (kód pred menom, prázdne preskočí)', () => {
  assert.equal(resolveFlagIso2(null, 'DE'), 'de');
  assert.equal(resolveFlagIso2('', undefined, 'Germany'), 'de');
  assert.equal(resolveFlagIso2('FR', 'Germany'), 'fr', 'adsbdb ISO2 má prednosť pred OpenSky menom');
  assert.equal(resolveFlagIso2('??', 'Nowhere'), null);
  assert.equal(resolveFlagIso2(), null);
});

test('vlajky: URL a šírka — bundlovaný SVG súbor, pomer 4:3', () => {
  assert.match(flagUrl('SK'), /\/local_data\/flags\/4x3\/sk\.svg$/);
  assert.equal(flagUrl('xx'), null);
  assert.equal(FLAG_ASPECT, 4 / 3);
  assert.equal(flagWidth(9), 12);
  assert.equal(flagWidth(12), 16);
});

test('vlajky: cache obrázkov — jeden Image na kód, onload zavolá listener prekreslenia, bez DOM null', () => {
  _resetFlagCacheForTest();
  assert.equal(getFlagImage('fr'), null, 'v Node bez Image sa nič nenačítava');
  let created = 0;
  const factory = () => { created += 1; return { set src(v) { this._src = v; }, get src() { return this._src; } }; };
  const a = getFlagImage('fr', { imageFactory: factory });
  const b = getFlagImage('FR', { imageFactory: factory });
  assert.equal(created, 1, 'druhý dopyt na ten istý kód nevytvára nový obrázok');
  assert.equal(a, b);
  assert.equal(a.ready, false);
  assert.match(a.image.src, /fr\.svg$/);
  let repaints = 0;
  setFlagReadyListener(() => { repaints += 1; });
  a.image.onload();
  assert.equal(a.ready, true);
  assert.equal(repaints, 1, 'dotiahnutá vlajka si vyžiada prekreslenie karty');
  const c = getFlagImage('de', { imageFactory: factory });
  c.image.onerror();
  assert.equal(c.failed, true);
  _resetFlagCacheForTest();
});

test('vlajky: paintFlag drží rozloženie — rezervuje šírku aj kým sa obrázok ťahá, 0 pre neznámy kód', () => {
  _resetFlagCacheForTest();
  const calls = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, clip() {}, roundRect(...a) { calls.push(['roundRect', ...a]); },
    drawImage(...a) { calls.push(['drawImage', ...a]); }, fillRect(...a) { calls.push(['fillRect', ...a]); },
    strokeRect(...a) { calls.push(['strokeRect', ...a]); },
  };
  assert.equal(paintFlag(ctx, 'zz', 0, 0, 9), 0, 'neznámy kód nič nekreslí a nezaberá miesto');
  assert.equal(calls.length, 0);
  const factory = () => ({ set src(v) { this._src = v; } });
  const entry = getFlagImage('sk', { imageFactory: factory });
  assert.equal(paintFlag(ctx, 'sk', 10, 20, 9), 12, 'šírka 4:3 aj pred načítaním');
  assert.ok(calls.some(([n]) => n === 'fillRect'), 'placeholder kým obrázok nie je pripravený');
  assert.ok(!calls.some(([n]) => n === 'drawImage'));
  calls.length = 0;
  entry.image.onload?.();
  entry.ready = true;
  assert.equal(paintFlag(ctx, 'sk', 10, 20, 9), 12);
  const draw = calls.find(([n]) => n === 'drawImage');
  assert.deepEqual(draw.slice(2), [10, 20, 12, 9]);
  _resetFlagCacheForTest();
});

test('vlajky: výber ISO štátov zo sady — bez sub-národných a organizácií, zoradené', () => {
  const picked = selectIsoCountries([
    { code: 'sk', name: 'Slovakia', iso: true },
    { code: 'gb-eng', name: 'England', iso: false },
    { code: 'eu', name: 'Europe', iso: false },
    { code: 'de', name: 'Germany', iso: true },
    null,
  ]);
  assert.deepEqual(picked, [{ code: 'de', name: 'Germany' }, { code: 'sk', name: 'Slovakia' }]);
});

test('vlajky: tripwire — sada na disku (SVG pre SK/FR/US), licencia MIT, verzia, DATA_SOURCES a kredit', () => {
  const dir = new URL('./local_data/flags/', import.meta.url);
  for (const code of ['sk', 'fr', 'us', 'ci', 'gb']) {
    const file = new URL(`./4x3/${code}.svg`, dir);
    assert.ok(existsSync(file), `${code}.svg je v bundli`);
    assert.match(readFileSync(file, 'utf8'), /^<svg /);
  }
  assert.match(readFileSync(new URL('./LICENSE', dir), 'utf8'), /MIT License/);
  assert.match(FLAG_ICONS_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(readFileSync(new URL('./SOURCE.md', dir), 'utf8'), /flag-icons/);
  const sources = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(sources, /flag-icons/);
  assert.match(sources, /\*\*MIT\*\*/);
  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'flag-icons'/);
});
