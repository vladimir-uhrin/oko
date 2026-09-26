// src/data/mideastTheatres.test.mjs — dejiská modulu BLÍZKY VÝCHOD (etapa 1, 2026-09-26).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import {
  MIDEAST_THEATRES,
  OVERVIEW_BACKOFF_MAX_DEG,
  THEATRE_HEIGHT_CAP_M,
  THEATRE_REVEAL_GATE_M,
  applyMideastTheatre,
  listMideastTheatres,
  resolveTheatre,
  theatreById,
  theatreChoices,
  theatreFraming,
  theatreLabel,
  theatreSubtitle,
  validateMideastTheatres,
} from './mideastTheatres.js';
import { REGISTERED_LAYER_IDS } from './layerState.js';
import { SITUATION_REGIONS } from './situationNews.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const THEATRE_IDS = ['overview', 'hormuz', 'gulf', 'iran', 'south-lebanon', 'gaza', 'israel', 'west-bank', 'red-sea', 'yemen', 'south-syria', 'iraq'];

test('katalóg je platný: 12 dejísk z plánu (kap. 2), prehľad prvý, vrstvy registrované, regióny správ známe', () => {
  assert.equal(validateMideastTheatres(), true);
  assert.equal(listMideastTheatres(), MIDEAST_THEATRES);
  assert.deepEqual(MIDEAST_THEATRES.map((s) => s.id), THEATRE_IDS);
  assert.equal(MIDEAST_THEATRES[0].id, 'overview');
  assert.equal(MIDEAST_THEATRES[0].overview, true);
  assert.equal(MIDEAST_THEATRES.filter((s) => s.overview).length, 1, 'práve jeden prehľad');
  const registered = new Set(REGISTERED_LAYER_IDS);
  for (const scene of MIDEAST_THEATRES) {
    for (const layerId of scene.layerIds) assert.ok(registered.has(layerId), `${scene.id}: ${layerId}`);
    assert.ok(Object.hasOwn(SITUATION_REGIONS, scene.newsRegion), `${scene.id}: región správ ${scene.newsRegion}`);
    assert.ok(Object.isFrozen(scene) && Object.isFrozen(scene.layerIds) && Object.isFrozen(scene.control), `${scene.id} zmrazené`);
  }
  assert.ok(Object.isFrozen(MIDEAST_THEATRES));
  // námorné dejiská zapínajú lode, radar a trasy; Hormuz aj potrubia
  assert.deepEqual([...theatreById('hormuz').layerIds], ['ais-live-vessels', 'aishub-vessels', 'gfw-sar', 'local-shipping-lanes', 'local-ports', 'gas-pipelines']);
  assert.deepEqual([...theatreById('red-sea').layerIds], ['ais-live-vessels', 'aishub-vessels', 'gfw-sar', 'local-shipping-lanes', 'local-ports']);
  // `local-energy` je slovenská sieť (skEnergy.js) — na Zálive nikdy (oponentúra 2026-09-26).
  assert.deepEqual([...theatreById('gulf').layerIds], ['gas-pipelines', 'local-ports']);
  for (const scene of MIDEAST_THEATRES) assert.ok(!scene.layerIds.includes('local-energy'), `${scene.id}: local-energy je SK sieť`);
  assert.deepEqual([...theatreById('gaza').layerIds], []);
  assert.equal(theatreById('hormuz').newsRegion, 'gulf');
  assert.equal(theatreById('gaza').newsRegion, 'mideast');
  // kľúče modulov Wikipédie pre etapu 2 — len dáta
  assert.deepEqual([...theatreById('south-lebanon').control], ['israel-palestine', 'lebanon']);
  assert.deepEqual([...theatreById('gaza').control], ['israel-palestine']);
  assert.deepEqual([...theatreById('red-sea').control], ['yemen']);
  assert.deepEqual([...theatreById('south-syria').control], ['syria']);
  assert.deepEqual([...theatreById('iran').control], []);
});

test('theatreById: veľkosť písmen a medzery nerozhodujú, neznáme = null', () => {
  assert.equal(theatreById(' GAZA '), theatreById('gaza'));
  assert.equal(theatreById('South-Lebanon').id, 'south-lebanon');
  assert.equal(theatreById('nope'), null);
  assert.equal(theatreById(''), null);
  assert.equal(theatreById(null), null);
  assert.equal(theatreById(undefined), null);
});

test('validátor odmietne duplikát, stred mimo rámca, zlé id, neregistrovanú vrstvu, neznámy región, zlý prehľad', () => {
  const ok = { id: 'x', name: 'X', center: { lat: 29, lon: 45 }, rectDegrees: [40, 25, 50, 35], newsRegion: 'mideast', layerIds: [], control: [], overview: true };
  assert.equal(validateMideastTheatres([ok, { ...ok, id: 'y', overview: false }]), true);
  assert.throws(() => validateMideastTheatres([ok, { ...ok }]), /Duplicate/);
  assert.throws(() => validateMideastTheatres([{ ...ok, center: { lat: 55, lon: 45 } }]), /outside rect/);
  assert.throws(() => validateMideastTheatres([{ ...ok, rectDegrees: [50, 25, 40, 35] }]), /inverted rect/);
  assert.throws(() => validateMideastTheatres([{ ...ok, id: 'Bad Id' }]), /bad id/);
  assert.throws(() => validateMideastTheatres([{ ...ok, layerIds: ['not-a-real-layer'] }]), /not registered/);
  assert.throws(() => validateMideastTheatres([{ ...ok, newsRegion: 'atlantis' }]), /unknown news region/);
  assert.throws(() => validateMideastTheatres([{ ...ok, newsRegion: undefined }]), /unknown news region/);
  assert.throws(() => validateMideastTheatres([{ ...ok, overview: false }]), /exactly one overview/);
  assert.throws(() => validateMideastTheatres([{ ...ok, overview: false }, { ...ok, id: 'y' }]), /overview must be first/);
  assert.throws(() => validateMideastTheatres([{ ...ok, control: 'yemen' }]), /control/);
  assert.throws(() => validateMideastTheatres([{ ...ok, name: '' }]), /without name/);
  assert.throws(() => validateMideastTheatres([]), /empty/);
});

test('i18n: každé dejisko má meno + podtitul v EN aj SK, EN meno je bajtovo zhodné s katalógom', () => {
  for (const scene of MIDEAST_THEATRES) {
    for (const [lang, dict] of [['EN', EN_STRINGS], ['SK', SK_STRINGS]]) {
      assert.ok(dict[`theatre.${scene.id}.name`], `${lang} chýba theatre.${scene.id}.name`);
      assert.ok(dict[`theatre.${scene.id}.subtitle`], `${lang} chýba theatre.${scene.id}.subtitle`);
    }
    assert.equal(EN_STRINGS[`theatre.${scene.id}.name`], scene.name, `${scene.id}: EN slovník = katalóg (fallback bez prekladu)`);
    assert.equal(theatreLabel(scene, (k) => k), scene.name, 'bez prekladu ostane EN meno');
    assert.equal(theatreLabel(scene, (k) => SK_STRINGS[k] ?? k), SK_STRINGS[`theatre.${scene.id}.name`]);
    assert.equal(theatreSubtitle(scene, (k) => k), '', 'bez prekladu je podtitul prázdny');
    assert.equal(theatreSubtitle(scene, (k) => EN_STRINGS[k] ?? k), EN_STRINGS[`theatre.${scene.id}.subtitle`]);
  }
  // mená sú v každom jazyku jedinečné — inak by resolver vracal null pre presnú zhodu
  for (const dict of [EN_STRINGS, SK_STRINGS]) {
    const names = MIDEAST_THEATRES.map((s) => dict[`theatre.${s.id}.name`]);
    assert.equal(new Set(names).size, names.length, 'dve dejiská s rovnakým menom');
  }
  assert.equal(theatreLabel(null), '');
  assert.equal(theatreSubtitle(null), '');
  assert.ok(EN_STRINGS['mideast.pick'] && SK_STRINGS['mideast.pick']);
  assert.ok(EN_STRINGS['mideast.select-aria'] && SK_STRINGS['mideast.select-aria']);
});

test('rámovanie: z juhu na sever, strop výšky pod prahom brány, prehľad strmšie s obmedzeným odstupom', () => {
  assert.ok(THEATRE_HEIGHT_CAP_M < THEATRE_REVEAL_GATE_M, 'strop výšky musí byť pod prahom brány');
  const gaza = theatreFraming(theatreById('gaza').rectDegrees);
  assert.equal(gaza.headingDeg, 0);
  assert.equal(gaza.pitchDeg, -64, 'strmšie než úžiny — horizont plný 3D dlaždíc stál CPU');
  assert.equal(gaza.heightM, 70_000, 'spodný strop pre malý rámec');
  assert.ok(gaza.lat < 31.42, 'kamera stojí južne od stredu');
  const overview = theatreFraming(theatreById('overview').rectDegrees, { overview: true });
  assert.equal(overview.pitchDeg, -72);
  assert.equal(overview.heightM, THEATRE_HEIGHT_CAP_M, 'prehľad narazí na strop');
  assert.ok(overview.heightM < THEATRE_REVEAL_GATE_M);
  assert.equal(overview.lat, 25.5 - OVERVIEW_BACKOFF_MAX_DEG, 'odstup prehľadu je orezaný');
  assert.equal(theatreFraming([0, 0, 40, 40]).heightM, THEATRE_HEIGHT_CAP_M, 'horný strop');
  assert.equal(theatreFraming([0, 0, 0.1, 0.1]).heightM, 70_000, 'spodný strop');
});

test('brána priblíženia meria VZDIALENOSŤ kamery od stredu dejiska — každé dejisko ostane pod prahom s rezervou', () => {
  // sceneRevealGate: Cartesian3.distance(kamera, stred) ≤ 1 500 000 m → karty a čipy vidno.
  const distanceFor = (scene, framing) => Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(framing.lon, framing.lat, framing.heightM),
    Cesium.Cartesian3.fromDegrees(scene.center.lon, scene.center.lat),
  );
  for (const scene of MIDEAST_THEATRES) {
    const d = distanceFor(scene, theatreFraming(scene.rectDegrees, { overview: Boolean(scene.overview) }));
    assert.ok(d < THEATRE_REVEAL_GATE_M * 0.9, `${scene.id}: ${Math.round(d)} m je príliš blízko prahu ${THEATRE_REVEAL_GATE_M}`);
  }
  // Prečo strop 1,0 M m a orezaný odstup: s frontovým stropom 1,4 M m a odstupom
  // 0,18 × 33° by kamera prehľadu stála ~1,7 M m od stredu a brána by všetko schovala.
  const overview = theatreById('overview');
  const frontLike = distanceFor(overview, { lon: 46.5, lat: 25.5 - 33 * 0.18, heightM: 1_400_000 });
  assert.ok(frontLike > THEATRE_REVEAL_GATE_M, `frontové rámovanie by bránu preklopilo: ${Math.round(frontLike)} m`);
});

test('applyMideastTheatre: vypnúť cudzie → zapnúť vlastné → prekryvy → rámovanie POSLEDNÉ (a najlepšia snaha)', async () => {
  const order = [];
  const out = await applyMideastTheatre('hormuz', {
    listLayers: () => [
      { id: 'flights', enabled: true, showInTogglePanel: true },
      { id: 'ais-live-vessels', enabled: true, showInTogglePanel: true }, // dejisko ju o chvíľu zapne — nevypínať
      { id: 'military-awareness', enabled: true, showInTogglePanel: false }, // interná — nedotknuť
      { id: 'volcanoes', enabled: false, showInTogglePanel: true }, // už vypnutá
    ],
    disableLayer: (id) => { order.push(`disable:${id}`); return true; },
    setLayerEnabled: async (id) => { order.push(`enable:${id}`); return id !== 'gfw-sar'; },
    showOverlays: (scene) => { order.push(`overlays:${scene.id}`); return true; },
    flyToRegion: async (scene) => { order.push(`fly:${scene.id}`); throw new Error('camera busy'); },
  });
  assert.deepEqual(order, [
    'disable:flights',
    'enable:ais-live-vessels', 'enable:aishub-vessels', 'enable:gfw-sar', 'enable:local-shipping-lanes', 'enable:local-ports', 'enable:gas-pipelines',
    'overlays:hormuz',
    'fly:hormuz',
  ]);
  assert.equal(out.id, 'hormuz');
  assert.equal(out.scene, theatreById('hormuz'));
  assert.deepEqual(out.disabledLayerIds, ['flights']);
  assert.deepEqual(out.failedLayerIds, ['gfw-sar'], 'zlyhané zapnutie sa prizná');
  assert.equal(out.ok, false, 'ok rozhodujú vrstvy, nie let');
  assert.equal(out.overlaysShown, true);
});

test('applyMideastTheatre: neznáme id, dejisko bez vrstiev, bez správcu vrstiev, zlyhané závislosti', async () => {
  const missing = await applyMideastTheatre('nope', { flyToRegion: () => { throw new Error('nemá letieť'); } });
  assert.deepEqual(missing, { ok: false, id: 'nope', disabledLayerIds: [], failedLayerIds: [], overlaysShown: false, error: 'unknown-theatre' });

  const bare = await applyMideastTheatre('gaza', {});
  assert.equal(bare.ok, true, 'dejisko bez vrstiev prežije aj bez závislostí');
  assert.deepEqual(bare.disabledLayerIds, []);
  assert.deepEqual(bare.failedLayerIds, []);
  assert.equal(bare.overlaysShown, false);

  const flown = [];
  const gaza = await applyMideastTheatre('gaza', { flyToRegion: (scene) => flown.push(scene.id) });
  assert.equal(gaza.ok, true);
  assert.deepEqual(flown, ['gaza'], 'let dostane celú scénu');

  const noEnabler = await applyMideastTheatre('red-sea', { flyToRegion: (scene) => flown.push(scene.id) });
  assert.equal(noEnabler.ok, false, 'bez správcu sa námorné vrstvy nezapnú — poctivo');
  assert.deepEqual(noEnabler.failedLayerIds, [...theatreById('red-sea').layerIds]);
  assert.deepEqual(flown, ['gaza', 'red-sea'], 'aj tak zarámuje');

  const calls = [];
  const rough = await applyMideastTheatre('gulf', {
    listLayers: () => { throw new Error('správca padol'); },
    disableLayer: (id) => { calls.push(`disable:${id}`); return true; },
    setLayerEnabled: (id) => { calls.push(`enable:${id}`); if (id === 'local-ports') throw new Error('bez snímku'); return true; },
    showOverlays: () => { throw new Error('prekryv ešte nie je'); },
    flyToRegion: () => { calls.push('fly'); },
  });
  assert.deepEqual(calls, ['enable:gas-pipelines', 'enable:local-ports', 'fly']);
  assert.deepEqual(rough.disabledLayerIds, [], 'padnutý zoznam vrstiev = nič nevypíname');
  assert.deepEqual(rough.failedLayerIds, ['local-ports']);
  assert.equal(rough.overlaysShown, false);
  assert.equal(rough.ok, false);

  const skipped = await applyMideastTheatre('iraq', {
    listLayers: () => [{ id: 'flights', enabled: true }, { id: 'gas-pipelines', enabled: true }],
    disableLayer: (id) => { if (id === 'flights') throw new Error('zaseknuté'); return true; },
  });
  assert.deepEqual(skipped.disabledLayerIds, ['gas-pipelines'], 'výnimka pri jednej vrstve nezastaví ostatné');
  assert.equal(skipped.ok, true);
});

// Prekladač ako v appke pre SK — resolver musí sedieť aj na preloženom mene,
// lebo práve to používateľ povie nahlas.
const trSk = (key) => SK_STRINGS[key] ?? key;

test('resolveTheatre: id, anglické aj preložené meno, bez diakritiky', () => {
  assert.equal(resolveTheatre('gaza', trSk)?.id, 'gaza', 'holé id');
  assert.equal(resolveTheatre('  GAZA  ', trSk)?.id, 'gaza', 'veľkosť a medzery nerozhodujú');
  assert.equal(resolveTheatre('South Lebanon', trSk)?.id, 'south-lebanon', 'anglické meno');
  assert.equal(resolveTheatre('Južný Libanon', trSk)?.id, 'south-lebanon', 'preložené meno');
  assert.equal(resolveTheatre('juzny libanon', trSk)?.id, 'south-lebanon', 'bez diakritiky');
  assert.equal(resolveTheatre('Irán', trSk)?.id, 'iran', 'diakritika sa skladá aj na id');
  assert.equal(resolveTheatre('Irak', trSk)?.id, 'iraq', 'SK meno');
  assert.equal(resolveTheatre('Záliv', trSk)?.id, 'gulf', 'prefix SK mena');
  assert.equal(resolveTheatre('blockade', trSk)?.id, 'hormuz', 'čiastočná zhoda, jediná');
  assert.equal(resolveTheatre('Yemen and Bab', trSk)?.id, 'red-sea', 'prefix EN mena');
  assert.equal(resolveTheatre('Prehľad regiónu', trSk)?.id, 'overview');
});

test('resolveTheatre: presná zhoda vyhrá nad čiastočnou — „Jemen" je celá krajina, nie Báb al-Mandab', () => {
  assert.equal(resolveTheatre('Jemen', trSk)?.id, 'yemen');
  assert.equal(resolveTheatre('Yemen', trSk)?.id, 'yemen');
  assert.equal(resolveTheatre('Gulf', trSk)?.id, 'gulf', 'id vyhrá nad menom Hormuzu');
});

test('nejednoznačný dopyt vráti null, nie prvý v poradí', () => {
  // Pri hlase je lepšie spýtať sa než odletieť na iné dejisko.
  assert.equal(resolveTheatre('south', trSk), null, 'Libanon aj Sýria');
  assert.equal(resolveTheatre('Južn', trSk), null);
  assert.equal(resolveTheatre('and', trSk), null, 'Hormuz aj Červené more');
  assert.equal(resolveTheatre('xyz', trSk), null);
  assert.equal(resolveTheatre('', trSk), null);
  assert.equal(resolveTheatre(null, trSk), null);
  assert.equal(resolveTheatre(undefined, trSk), null);
});

test('theatreChoices dá id + čitateľné meno pre každé dejisko v poradí katalógu', () => {
  const choices = theatreChoices(trSk);
  assert.equal(choices.length, MIDEAST_THEATRES.length);
  assert.deepEqual(choices.map((c) => c.id), THEATRE_IDS);
  assert.equal(choices[0].id, 'overview', 'prehľad prvý');
  assert.equal(choices.find((c) => c.id === 'south-lebanon').label, 'Južný Libanon');
  assert.ok(choices.every((c) => c.label && c.label !== `theatre.${c.id}.name`), 'nikde holý kľúč');
  assert.equal(theatreChoices((k) => k).find((c) => c.id === 'hormuz').label, 'Hormuz and the blockade', 'bez prekladu EN meno');
});
