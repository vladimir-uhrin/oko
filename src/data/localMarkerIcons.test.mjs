// src/data/localMarkerIcons.test.mjs
// Značky na mape (2026-09-05): lietadlo v kruhu pre letisko, kotva pre
// prístav — namiesto holej bodky. Monochromatické SVG vo farbe vrstvy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCAL_MARKER_BASE_PX,
  airportMarkerImage,
  airportMarkerSvg,
  portMarkerImage,
  portMarkerSvg,
  svgDataUri,
} from './localMarkerIcons.js';

test('značky: SVG nesie farbu vrstvy, kruh a piktogram; letisko ≠ prístav', () => {
  const a = airportMarkerSvg('#8ab4f8');
  const p = portMarkerSvg('#7fd1c0');
  for (const svg of [a, p]) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<circle cx="12" cy="12" r="10\.2"/, 'kruh odlišuje statickú značku od letiaceho lietadla');
    assert.doesNotMatch(svg, /[\u{1F300}-\u{1FAFF}]/u, 'žiadne emoji');
  }
  assert.match(a, /stroke="#8ab4f8"/); assert.match(a, /fill="#8ab4f8"/);
  assert.match(p, /stroke="#7fd1c0"/);
  assert.notEqual(a.replace(/#8ab4f8/g, 'X'), p.replace(/#7fd1c0/g, 'X'), 'iný piktogram');
  assert.ok(LOCAL_MARKER_BASE_PX >= 18 && LOCAL_MARKER_BASE_PX <= 28);
});

test('značky: data URI je bezpečne zakódované a stabilné pre tú istú farbu', () => {
  const uri = airportMarkerImage('#8ab4f8');
  assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.doesNotMatch(uri, /[<>"#]/, 'žiadne surové znaky, ktoré by rozbili URI');
  assert.equal(decodeURIComponent(uri.split(',')[1]), airportMarkerSvg('#8ab4f8'));
  assert.equal(airportMarkerImage('#8ab4f8'), uri, 'deterministické');
  assert.equal(svgDataUri('<svg/>'), 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');
  assert.notEqual(portMarkerImage('#7fd1c0'), uri);
});

test('značky: tripwire — letiská aj prístavy majú piktogram, vrstva ho škáluje stupňami', () => {
  const layers = readFileSync(new URL('./localLayers.js', import.meta.url), 'utf8');
  assert.match(layers, /markerImage: airportMarkerImage/);
  assert.match(layers, /markerImage: portMarkerImage/);
  const geo = readFileSync(new URL('./localGeojson.js', import.meta.url), 'utf8');
  assert.match(geo, /feature\.billboard = new Cesium\.BillboardGraphics\(\{\s*\n\s*image: _markerImageUri/);
  assert.match(geo, /record\.entity\.billboard\.scale = style\.pixelSize \/ 10/, 'stupne škálujú piktogram rovnakou krivkou ako bodku');
  assert.match(geo, /disableDepthTestDistance: Number\.POSITIVE_INFINITY/, 'značka sa nezareže do fotorealistického meshu');
});
