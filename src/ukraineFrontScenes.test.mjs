// src/ukraineFrontScenes.test.mjs — presety smerov frontu (modul UKRAJINA, etapa 1).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRONT_SCENES,
  applyFrontScene,
  frontSceneByGsDirection,
  frontSceneById,
  frontSceneChoices,
  resolveFrontScene,
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
  assert.equal(lyman.pitchDeg, -64, 'strmšie než úžiny — horizont plný 3D dlaždíc stál CPU');
  assert.ok(lyman.lat < 49.0, 'kamera stojí južne od stredu');
  assert.ok(lyman.heightM >= 140_000 && lyman.heightM <= 180_000, `~160 km, dostali sme ${lyman.heightM}`);
  const front = frontSceneFraming(frontSceneById('front').rectDegrees, { overview: true });
  assert.equal(front.pitchDeg, -72);
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

// Prekladač ako v appke pre SK — resolver musí sedieť aj na preloženom mene,
// lebo práve to používateľ povie nahlas.
const SK_FRONT = {
  'front.front.name': 'Celý front',
  'front.lyman.name': 'Lymanský smer',
  'front.kupiansk.name': 'Kupianský smer',
  'front.pokrovsk.name': 'Pokrovský smer (Myrnohrad, Dobropillia)',
  'front.kherson.name': 'Ľavý breh Dnipra – Cherson',
  'front.kostiantynivka.name': 'Kosťantynivský smer (Časiv Jar, Toreck)',
};
const trSk = (key) => SK_FRONT[key] || key;

test('resolveFrontScene: id, ukrajinské meno z hlásenia, anglické aj preložené meno', () => {
  assert.equal(resolveFrontScene('lyman', trSk)?.id, 'lyman', 'holé id');
  assert.equal(resolveFrontScene('  LYMAN  ', trSk)?.id, 'lyman', 'veľkosť a medzery nerozhodujú');
  assert.equal(resolveFrontScene('Лиманський', trSk)?.id, 'lyman', 'meno smeru z hlásenia GŠ');
  assert.equal(resolveFrontScene("Куп'янський", trSk)?.id, 'kupiansk', 'apostrof v azbuke');
  assert.equal(resolveFrontScene('Lyman direction', trSk)?.id, 'lyman', 'anglické meno');
  assert.equal(resolveFrontScene('Lymanský smer', trSk)?.id, 'lyman', 'preložené meno');
});

test('resolveFrontScene skladá diakritiku — „lymansky smer" je to isté', () => {
  // Hlas aj klávesnica bez diakritiky sú bežné; bez skladania by to nenašlo nič.
  assert.equal(resolveFrontScene('lymansky smer', trSk)?.id, 'lyman');
  assert.equal(resolveFrontScene('kostantynivsky smer', trSk)?.id, 'kostiantynivka');
  assert.equal(resolveFrontScene('cely front', trSk)?.id, 'front');
});

test('resolveFrontScene nájde smer aj podľa mesta v zátvorke prekladu', () => {
  assert.equal(resolveFrontScene('Myrnohrad', trSk)?.id, 'pokrovsk');
  assert.equal(resolveFrontScene('Časiv Jar', trSk)?.id, 'kostiantynivka');
});

test('nejednoznačný dopyt vráti null, nie prvý v poradí', () => {
  // Pri hlase je lepšie spýtať sa než odletieť na iný úsek frontu.
  assert.equal(resolveFrontScene('smer', trSk), null, '„smer" sedí na viacero');
  assert.equal(resolveFrontScene('direction'), null);
  assert.equal(resolveFrontScene('xyz', trSk), null);
  assert.equal(resolveFrontScene('', trSk), null);
  assert.equal(resolveFrontScene(null, trSk), null);
  assert.equal(resolveFrontScene(undefined, trSk), null);
});

test('presné id vyhrá nad čiastočnou zhodou v inom mene', () => {
  // `front` je id celého frontu a zároveň podreťazec anglických mien ostatných.
  assert.equal(resolveFrontScene('front', trSk)?.id, 'front');
});

test('frontSceneChoices dá id + čitateľné meno pre každý smer', () => {
  const choices = frontSceneChoices(trSk);
  assert.equal(choices.length, FRONT_SCENES.length);
  assert.deepEqual(choices.map((c) => c.id), FRONT_SCENES.map((s) => s.id));
  assert.equal(choices.find((c) => c.id === 'lyman').label, 'Lymanský smer');
  assert.ok(choices.every((c) => c.label && c.label !== `front.${c.id}.name`), 'nikde holý kľúč');
});
