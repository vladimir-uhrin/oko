// src/data/screenPatternMaterials.test.mjs — šrafovanie 45° v obrazovkových px (KARTA K3).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { HATCH_DEFAULTS, HATCH_MATERIAL_TYPE, HatchMaterialProperty, ensureHatchMaterial, hatchMaterialFor } from './screenPatternMaterials.js';

test('registrácia raz, typ v cache, bez cache false', () => {
  assert.equal(ensureHatchMaterial(Cesium), true);
  assert.equal(ensureHatchMaterial(Cesium), true);
  const m = Cesium.Material._materialCache.getMaterial(HATCH_MATERIAL_TYPE);
  assert.ok(m);
  assert.match(m.fabric.source, /gl_FragCoord\.x \+ gl_FragCoord\.y/, 'čiary pod 45° v obrazovkových px');
  assert.equal(m.translucent, true);
  assert.equal(ensureHatchMaterial({}), false);
});

test('HatchMaterialProperty: typ, uniformy, farby z CSS', () => {
  const p = new HatchMaterialProperty();
  assert.equal(p.getType(), HATCH_MATERIAL_TYPE);
  assert.equal(p.isConstant, true);
  assert.equal(p.getValue().spacing, HATCH_DEFAULTS.spacingPx);
  const h = hatchMaterialFor('#b8b2aa', { lineAlpha: 0.6, fillAlpha: 0.12 });
  assert.ok(h instanceof HatchMaterialProperty);
  const u = h.getValue();
  assert.ok(Math.abs(u.lineColor.alpha - 0.6) < 1e-9 && Math.abs(u.fillColor.alpha - 0.12) < 1e-9);
  assert.equal(u.lineColor.withAlpha(1).toCssHexString(), '#b8b2aa');
  assert.equal(p.equals(p), true); assert.equal(p.equals(h), false);
});
