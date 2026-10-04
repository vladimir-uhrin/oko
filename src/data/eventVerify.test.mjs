// src/data/eventVerify.test.mjs — overenie druhou, nezávislou sieťou (Udalosti, etapa 1, 2026-09-30,
// vlastník: „potrebujem len overené, nie fake!"). Testy SPRÁVANIA na skutočných prípadoch: štyri
// „7500" z archívu OKO, ktoré adsb.lol v tom istom čase videla s bežným kódom, musia byť zahodené;
// FZ1073 musí prejsť. Bez údajov druhej siete nič nie je „overené".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIVE_VR_MPS, normalizeTrack } from './flightAnomalies.js';
import { verifyEvent, verifyTrigger } from './eventVerify.js';
import { NOISE_CASES, fz1073, noiseCase } from './fixtures/flightEventFixtures.mjs';

const P = (t, extra = {}) => ({ t, lat: 48, lon: 17, alt: 10_000, gs: 230, trk: 90, vr: 0, squawk: null, gnd: false, ...extra });
const net = (id, points) => ({ id, points: normalizeTrack(points) });

test('kód: druhá sieť s tým istým kódom potvrdí, s iným vyvráti; bez bodov alebo bez kódov sa nerozhodne', () => {
  const trig = { kind: 'squawk', code: '7500', startT: 100, endT: 200 };
  assert.equal(verifyTrigger(trig, normalizeTrack([P(150, { squawk: '7500' })])).status, 'confirmed');
  const bad = verifyTrigger(trig, normalizeTrack([P(150, { squawk: '5323' })]));
  assert.deepEqual([bad.status, bad.codes], ['contradicted', ['5323']]);
  assert.equal(verifyTrigger(trig, []).status, 'no-data');
  assert.equal(verifyTrigger(trig, normalizeTrack([P(150)])).status, 'no-data', 'sieť kód nepreniesla');
  assert.equal(verifyTrigger(trig, normalizeTrack([P(1000, { squawk: '5323' })])).status, 'no-data', 'mimo okna');
});

test('klesanie: prudké klesanie alebo strata výšky v druhej sieti potvrdí; pokojný let pred aj po vyvráti; riedke body nerozhodnú', () => {
  const dive = { kind: 'dive', t: 100, vr: DIVE_VR_MPS * 2 };
  assert.equal(verifyTrigger(dive, normalizeTrack([P(95, { vr: -30 })])).status, 'confirmed');
  assert.equal(verifyTrigger(dive, normalizeTrack([P(60, { alt: 10_000 }), P(170, { alt: 8000 })])).status, 'confirmed');
  assert.equal(verifyTrigger(dive, normalizeTrack([P(60), P(140)])).status, 'contradicted');
  assert.equal(verifyTrigger(dive, normalizeTrack([P(140)])).status, 'no-data', 'len bod po — krátky pád mohla preskočiť');
});

test('skutočný šum: štyri „7500" z archívu OKO vyvrátené — adsb.lol v tom čase hlásila bežný kód', () => {
  for (const c of NOISE_CASES) {
    const { oko, adsblol } = noiseCase(c);
    const r = verifyEvent(net('opensky', oko), net('adsblol', adsblol));
    assert.equal(r.status, 'rejected', c.hex);
    const [trig] = r.triggers;
    assert.equal(trig.code, '7500');
    assert.equal(trig.status, 'contradicted');
    assert.deepEqual(trig.verification.adsblol.codes, [c.otherCode], `${c.hex}: kód druhej siete`);
  }
});

test('skutočný FZ1073: klesanie videli obe siete (overené), kódy 7700/7500 len adsb.lol (v archíve OKO bez kódu)', () => {
  const { oko, adsblol } = fz1073();
  const r = verifyEvent(net('opensky', oko), net('adsblol', adsblol));
  assert.equal(r.status, 'confirmed');
  const dive = r.triggers.find((t) => t.kind === 'dive');
  assert.deepEqual(dive.seenBy, ['opensky', 'adsblol']);
  assert.equal(dive.status, 'confirmed');
  const codes = r.triggers.filter((t) => t.kind === 'squawk');
  assert.deepEqual(codes.map((t) => [t.code, t.status, t.seenBy.join()]), [['7700', 'no-data', 'adsblol'], ['7500', 'no-data', 'adsblol']]);
});

test('bez druhej siete nič nie je overené; šum v druhej sieti vyvráti prvá; spojený spúšťač z oboch = overený', () => {
  const { oko } = fz1073();
  assert.equal(verifyEvent(net('opensky', oko), net('adsblol', [])).status, 'unverified');
  const noisy = [P(100, { squawk: '7500' }), P(130, { squawk: '7500' })];
  const calm = [P(90, { squawk: '2000' }), P(120, { squawk: '2000' })];
  assert.equal(verifyEvent(net('opensky', calm), net('adsblol', noisy)).status, 'rejected');
  const both = verifyEvent(net('opensky', noisy), net('adsblol', [P(110, { squawk: '7500' })]));
  assert.equal(both.status, 'confirmed');
  assert.deepEqual(both.triggers.map((t) => t.seenBy.join()), ['opensky,adsblol'], 'jeden spúšťač, nie dva');
});
