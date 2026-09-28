// scripts/lib/cesiumHtmlTags.test.mjs
// Značky Cesia v index.html: defer (preloader pred stiahnutím Cesia) + verzia v URL (cache).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionedDeferredCesiumTags } from './cesiumHtmlTags.mjs';

const PLUGIN_TAGS = Object.freeze([
  { tag: 'link', attrs: { rel: 'stylesheet', href: '/cesium/Widgets/widgets.css' }, injectTo: 'head-prepend' },
  { tag: 'script', attrs: { src: '/cesium/Cesium.js' }, injectTo: 'head-prepend' },
]);

test('Cesium.js dostane defer a verziu, widgets.css verziu; ostatné a poradie nemenené', () => {
  const out = versionedDeferredCesiumTags([...PLUGIN_TAGS, { tag: 'meta', attrs: { name: 'x' } }], '1.138.0');
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { tag: 'link', attrs: { rel: 'stylesheet', href: '/cesium/Widgets/widgets.css?v=1.138.0' }, injectTo: 'head-prepend' });
  assert.deepEqual(out[1], { tag: 'script', attrs: { src: '/cesium/Cesium.js?v=1.138.0', defer: true, fetchpriority: 'high' }, injectTo: 'head-prepend' },
    'defer = neblokuje vykreslenie; fetchpriority high = Chrome ho nesťahuje ako posledný (A/B: 17 s → 7,5 s)');
  assert.deepEqual(out[2], { tag: 'meta', attrs: { name: 'x' } });
  assert.equal(PLUGIN_TAGS[1].attrs.defer, undefined, 'pôvodné značky pluginu sa nemenia');
});

test('bez verzie len defer; verzia sa zakóduje; prázdny vstup = prázdne pole', () => {
  assert.equal(versionedDeferredCesiumTags(PLUGIN_TAGS, '')[1].attrs.src, '/cesium/Cesium.js');
  assert.equal(versionedDeferredCesiumTags(PLUGIN_TAGS, '')[1].attrs.defer, true);
  assert.equal(versionedDeferredCesiumTags(PLUGIN_TAGS, '')[1].attrs.fetchpriority, 'high');
  assert.equal(versionedDeferredCesiumTags(PLUGIN_TAGS, '1.2.3 beta')[1].attrs.src, '/cesium/Cesium.js?v=1.2.3%20beta');
  assert.deepEqual(versionedDeferredCesiumTags(null, '1'), []);
});

test('vite.config.js obaľuje transformIndexHtml pluginu touto funkciou s verziou z node_modules/cesium', () => {
  const config = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /import \{ versionedDeferredCesiumTags \} from '\.\/scripts\/lib\/cesiumHtmlTags\.mjs';/);
  assert.match(config, /cesiumGlobe\.transformIndexHtml = function \(html, context\) \{\s*if \(context\.path === '\/account\.html'\) return \[\];\s*return versionedDeferredCesiumTags\(cesiumHtml\.call\(this, html, context\), cesiumVersion\);/);
  assert.match(config, /node_modules', 'cesium', 'package\.json'/);
});
