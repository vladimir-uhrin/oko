// src/ukraineFrontScenes.test.mjs — presety smerov frontu (modul UKRAJINA, etapa 1).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRONT_SCENES,
  applyFrontScene,
  frontSceneByGsDirection,
  frontSceneById,
  frontSceneFraming,
  frontSceneLabel,
  listFrontScenes,
  validateFrontScenes,
} from './ukraineFrontScenes.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

test('katalóg je platný: prehľad + 11 smerov, každý GŠ smer z 19. 9. 2026 má preset', () => {
  assert.equal(validateFrontScenes(), true);
  assert.equal(listFrontScenes(), FRONT_SCENES);
  assert.equal(FRONT_SCENES[0].id, 'front');
  assert.equal(FRONT_SCENES[0].overview, true);
  const gs = ['Північно-Слобожанський', 'Курський', 'Південно-Слобожанський', 'Куп\'янський', 'Лиманський', 'Слов\'янський',
    'Краматорський', 'Костянтинівський', 'Покровський', 'Олександрівський', 'Гуляйпільський', 'Оріхівський', 'Придніпровський'];
  for (const name of gs) assert.ok(frontSceneByGsDirection(name), `smer bez presetu: ${name}`);
  assert.equal(frontSceneByGsDirection('Куп’янський').id, 'kupiansk', 'typografický apostrof sa normalizuje');
  assert.equal(frontSceneByGsDirection('  лиманський '), frontSceneById('lyman'));
  assert.equal(frontSceneByGsDirection('Херсонський'), null);
  assert.equal(frontSceneById(' LYMAN '), frontSceneById('lyman'));
  assert.equal(frontSceneById('nope'), null);
  assert.equal(frontSceneById('oleksandrivka').approx, true, 'neoverená kotva je priznaná');
});

test('validátor odmietne duplikáty, stred mimo rámca a smer bez GŠ mena', () => {
  const ok = { id: 'x', name: 'X', center: { lat: 49, lon: 37 }, rectDegrees: [36, 48, 38, 50], gs: ['Х'] };
  assert.throws(() => validateFrontScenes([ok, { ...ok }]), /Duplicate/);
  assert.throws(() => validateFrontScenes([{ ...ok, center: { lat: 55, lon: 37 } }]), /outside rect/);
  assert.throws(() => validateFrontScenes([{ ...ok, gs: [] }]), /without GS/);
  assert.throws(() => validateFrontScenes([ok, { ...ok, id: 'y', gs: ['Х'] }]), /mapped twice/);
  assert.throws(() => validateFrontScenes([{ ...ok, id: 'Bad Id' }]), /bad id/);
});

test('i18n: každý preset má meno v EN aj SK a názvy sú rôzne', () => {
  for (const scene of FRONT_SCENES) {
    const key = `front.${scene.id}.name`;
    assert.ok(EN_STRINGS[key], `EN chýba ${key}`);
    assert.ok(SK_STRINGS[key], `SK chýba ${key}`);
  }
  assert.equal(frontSceneLabel(frontSceneById('lyman'), (k) => SK_STRINGS[k] ?? k), SK_STRINGS['front.lyman.name']);
  assert.equal(frontSceneLabel(frontSceneById('lyman'), (k) => k), 'Lyman direction', 'bez prekladu ostane EN meno');
  assert.equal(frontSceneLabel(null), '');
  assert.ok(EN_STRINGS['panel.ukraine'] && SK_STRINGS['panel.ukraine']);
  assert.ok(EN_STRINGS['front.pick'] && SK_STRINGS['front.pick']);
});

test('rámovanie: z juhu na sever, výška podľa rozpätia, prehľad strmšie a vyššie', () => {
  const lyman = frontSceneFraming(frontSceneById('lyman').rectDegrees);
  assert.equal(lyman.headingDeg, 0);
  assert.equal(lyman.pitchDeg, -58);
  assert.ok(lyman.lat < 49.0, 'kamera stojí južne od stredu');
  assert.ok(lyman.heightM >= 140_000 && lyman.heightM <= 180_000, `~160 km, dostali sme ${lyman.heightM}`);
  const front = frontSceneFraming(frontSceneById('front').rectDegrees, { overview: true });
  assert.equal(front.pitchDeg, -70);
  assert.ok(front.heightM > lyman.heightM);
  assert.equal(frontSceneFraming([0, 0, 0.1, 0.1]).heightM, 70_000, 'spodný strop');
  assert.equal(frontSceneFraming([0, 0, 40, 40]).heightM, 1_400_000, 'horný strop');
});

test('applyFrontScene: podklad najprv, rámovanie posledné a najlepšia snaha; neznáme id', async () => {
  const order = [];
  const result = await applyFrontScene('lyman', {
    showBase: async () => { order.push('base'); return true; },
    flyToRegion: async (scene) => { order.push(`fly:${scene.id}`); throw new Error('camera busy'); },
  });
  assert.deepEqual(order, ['base', 'fly:lyman']);
  assert.equal(result.ok, true);
  assert.equal(result.baseShown, true);
  const missing = await applyFrontScene('nope', { showBase: async () => true });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'unknown-front');
  const noBase = await applyFrontScene('sumy', { showBase: async () => { throw new Error('no snapshot'); } });
  assert.equal(noBase.ok, true, 'scéna prežije aj bez podkladu — kamera aspoň zarámuje');
  assert.equal(noBase.baseShown, false);
});
