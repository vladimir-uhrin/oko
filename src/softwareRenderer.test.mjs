// src/softwareRenderer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSoftwareRendererName, webglRendererName, applySoftwareRendererBudget, SOFTWARE_FRAME_RATE, SOFTWARE_RESOLUTION_SCALE } from './softwareRenderer.js';

test('softvérové rasterizéry sa rozpoznajú, skutočné GPU nie', () => {
  assert.equal(isSoftwareRendererName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), true);
  assert.equal(isSoftwareRendererName('Google SwiftShader'), true);
  assert.equal(isSoftwareRendererName('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
  assert.equal(isSoftwareRendererName('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)'), true);
  assert.equal(isSoftwareRendererName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), false);
  assert.equal(isSoftwareRendererName('Apple GPU'), false);
  assert.equal(isSoftwareRendererName('Adreno (TM) 650'), false);
  assert.equal(isSoftwareRendererName(''), false);
  assert.equal(isSoftwareRendererName(undefined), false);
});

test('názov z WebGL: najprv nemaskovaný, inak RENDERER, chyba = prázdny', () => {
  const gl = (ext, renderer) => ({
    RENDERER: 1,
    getExtension: () => ext,
    getParameter: (p) => (p === 1 ? renderer : p === 99 ? 'SwiftShader' : null),
  });
  assert.equal(webglRendererName(gl({ UNMASKED_RENDERER_WEBGL: 99 }, 'WebKit WebGL')), 'SwiftShader');
  assert.equal(webglRendererName(gl(null, 'llvmpipe')), 'llvmpipe');
  assert.equal(webglRendererName({ getExtension: () => { throw new Error('x'); } }), '');
  assert.equal(webglRendererName(null), '');
});

test('úsporný režim len pri softvérovom kreslení', () => {
  const mk = () => ({ targetFrameRate: 60, resolutionScale: 1, useBrowserRecommendedResolution: false, scene: { msaaSamples: 4 } });
  const sw = mk();
  assert.equal(applySoftwareRendererBudget(sw, 'Google SwiftShader'), true);
  assert.equal(sw.targetFrameRate, SOFTWARE_FRAME_RATE);
  assert.equal(sw.resolutionScale, SOFTWARE_RESOLUTION_SCALE);
  assert.equal(sw.useBrowserRecommendedResolution, true);
  assert.equal(sw.scene.msaaSamples, 1);
  const gpu = mk();
  assert.equal(applySoftwareRendererBudget(gpu, 'Apple GPU'), false);
  assert.deepEqual(gpu, mk());
});

test('úsporný režim bez GPU (2026-10-31): príznak pre vrstvy, atmosféra, hmla, HDR a FXAA vypnuté', async () => {
  const { isSoftwareRenderActive, _setSoftwareRenderActiveForTest } = await import('./softwareRenderer.js');
  _setSoftwareRenderActiveForTest(false);
  assert.equal(isSoftwareRenderActive(), false);
  const scene = { msaaSamples: 4, skyAtmosphere: { show: true }, fog: { enabled: true }, globe: { showGroundAtmosphere: true }, highDynamicRange: true, postProcessStages: { fxaa: { enabled: true } } };
  assert.equal(applySoftwareRendererBudget({ targetFrameRate: 60, resolutionScale: 1, useBrowserRecommendedResolution: false, scene }, 'llvmpipe'), true);
  assert.equal(isSoftwareRenderActive(), true);
  assert.deepEqual(scene, { msaaSamples: 1, skyAtmosphere: { show: false }, fog: { enabled: false }, globe: { showGroundAtmosphere: false }, highDynamicRange: false, postProcessStages: { fxaa: { enabled: false } } });
  _setSoftwareRenderActiveForTest(false);
  assert.equal(applySoftwareRendererBudget({ targetFrameRate: 60, scene: {} }, 'Apple GPU'), false, 'GPU: nič sa nemení');
  assert.equal(isSoftwareRenderActive(), false);
});

test('bez GPU: modely flotily, cieľ kamery, Slnko/Mesiac, hviezdy a atmosféra vypnuté (pripnutie zdrojov)', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const f of ['./data/flights.js', './data/militaryFlights.js']) {
    assert.match(read(f), /function _modelRegimeActive\(\) \{\n  if \(!_models3dEnabled\) return false;\n(?:  \/\/[^\n]*\n)*  if \(isSoftwareRenderActive\(\)\) return false;/, f);
    assert.match(read(f), /import \{ isSoftwareRenderActive \} from '\.\.\/softwareRenderer\.js';/, f);
  }
  assert.match(read('./voice/gevActions.js'), /pickPositionSupported && typeof scene\.pickPosition === 'function' && !isSoftwareRenderActive\(\)/);
  const main = read('./main.js');
  assert.match(main, /if \(!softwareRender\) \{\n\s*viewer\.scene\.sun = new Cesium\.Sun\(\);\n\s*viewer\.scene\.moon = new Cesium\.Moon\(\);/);
  assert.match(main, /if \(!sharpStars \|\| softwareRender\) return;/);
  assert.match(main, /viewer\.scene\.skyAtmosphere\.show = !softwareRender;/);
});
