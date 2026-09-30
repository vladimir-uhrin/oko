// src/data/eventPost.test.mjs — titulok a text príspevku udalosti (Udalosti, etapa 2, 2026-09-30).
// Testy SPRÁVANIA na udalosti FZ1073 zo skutočných stôp: fakty s časom UTC, čo videla len jedna
// sieť je označené, médiá menom a odkazom, typ len pri zhode médií, žiadne dávne diery ani cestovná
// výška; bez overenia správami žiadna veta o médiách.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventHeadline, flightLabel, keyMoments, outletName, postText } from './eventPost.js';
import { fz1073Event } from './fixtures/flightEventFixtures.mjs';

test('titulok: typ podľa zhody médií, inak podľa dát; let s aerolinkou a trasou', async () => {
  const e = await fz1073Event();
  assert.equal(flightLabel(e), 'FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(eventHeadline(e), 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(eventHeadline({ ...e, news: { status: 'reported', type: null } }), 'Núdzový kód 7700: let FZ1073 (Fly Dubai) Dubai → Tel Aviv', 'bez zhody médií prvý núdzový kód z dát');
  assert.equal(eventHeadline({ ...e, route: null, news: null, triggers: e.triggers.filter((t) => t.kind === 'dive') }), 'Strmhlavé klesanie: let FDB1073');
  assert.equal(outletName('jta.org'), 'JTA');
  assert.equal(outletName('neznamy.example'), 'neznamy.example');
});

test('text príspevku: momenty udalosti s časom UTC, označené čo videla len jedna sieť, médiá a odkazy, zdroje údajov', async () => {
  const e = await fz1073Event();
  const kinds = keyMoments(e).map((m) => m.kind);
  assert.deepEqual(kinds, ['dive', 'gap', 'squawk', 'squawk', 'uturn', 'last-contact'], 'bez štartu, cestovnej výšky a dávnej diery nad Perzským zálivom');
  const text = postText(e, { url: 'https://okolive.sk/s/abc123XYZ0' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv, 30. 9. 2026');
  assert.ok(lines.includes('• 05:31 — transpondér vysiela 7700 (núdza) (len sieť adsb.lol)'), text);
  assert.ok(lines.includes('• 05:36 — transpondér vysiela 7500 (nezákonný zásah) (len sieť adsb.lol)'));
  assert.ok(lines.some((l) => /^• 05:2\d — strmhlavé klesanie \d{1,2} \d{3} ft\/min/.test(l) && !l.includes('len sieť')), 'klesanie videli obe siete');
  assert.ok(lines.includes('Médiá (JTA, The Jerusalem Post, The Guardian, Arab News) informujú o pokuse o únos lietadla.'));
  assert.equal(lines.filter((l) => l.startsWith('https://')).length, 3, 'najviac 3 odkazy na správy');
  assert.ok(lines.includes('Rekonštrukcia letu na mape: https://okolive.sk/s/abc123XYZ0'));
  assert.equal(lines.at(-1), 'Údaje: OpenSky Network, adsb.lol (ODbL) · okolive.sk');
  const draft = postText({ ...e, news: { status: 'reported', trusted: [{ domain: 'jta.org', url: 'https://x' }] } });
  assert.ok(!draft.includes('Médiá'), 'bez overenia správami žiadna veta o médiách');
  assert.ok(!draft.includes('Rekonštrukcia'), 'bez odkazu na OKO bez riadku odkazu');
});
