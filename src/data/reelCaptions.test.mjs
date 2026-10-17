// Titulky reelu v3: číslo so slovom, predložka nevisí na konci, časy v rámci reči vety.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindsForward, captionGroups, captionTimeline } from './reelCaptions.js';

test('číslo sa neodtrhne od slova za ním', () => {
  assert.deepEqual(captionGroups('Potom vyše 9 hodín nič.'), ['Potom vyše', '9 hodín nič.']);
  const g = captionGroups('Starosta Sobjanin hlási 144 zostrelených dronov.');
  assert.ok(g.some((x) => /144 zostrelených/.test(x)), g.join(' | '));
  assert.ok(g.every((x) => x.length <= 18 || !x.includes(' ')), g.join(' | '));
});

test('najmenej skupín, vyrovnané dĺžky (nevisí jedno krátke slovo)', () => {
  assert.deepEqual(captionGroups('Večer plné nebo.'), ['Večer plné nebo.']);
  assert.deepEqual(captionGroups('Moskva druhú noc po sebe zavrela letiská.').length, 3);
  for (const g of captionGroups('Moskva druhú noc po sebe zavrela letiská.')) assert.ok(g.length >= 6, g);
});

test('predložka a spojka nevisia na konci skupiny', () => {
  assert.deepEqual(captionGroups('Ľudia na Šeremeteve čakali celú noc.'), ['Ľudia', 'na Šeremeteve', 'čakali celú noc.']);
  for (const g of captionGroups('Aeroflot posúval odlet do Biškeku znova a znova. 13 hodín.')) {
    const last = g.split(' ').at(-1);
    assert.equal(bindsForward(last), false, `skupina „${g}" končí viazaným slovom`);
  }
});

test('koniec vety uzavrie skupinu, nič sa nestratí', () => {
  const text = 'Lety spred polnoci odložili až na obed. Spali na zemi.';
  const g = captionGroups(text);
  assert.equal(g.join(' '), text);
  assert.ok(g.some((x) => x.endsWith('obed.')));
  assert.ok(g.every((x) => x.length <= 22));
});

test('časy titulkov ležia v reči vety a idú za sebou', () => {
  const lines = [{ id: 'a', caption: 'Večer plné nebo.' }, { id: 'b', caption: 'Potom vyše 9 hodín nič.' }, { id: 'c', caption: 'okolive.sk', noCaption: true }];
  const placement = [{ id: 'a', speechStart: 0.3, speechEnd: 1.5 }, { id: 'b', speechStart: 1.8, speechEnd: 3.8 }, { id: 'c', speechStart: 4, speechEnd: 5 }];
  const cues = captionTimeline(lines, placement);
  assert.deepEqual(cues.map((c) => c.line), ['a', 'b', 'b']);
  assert.equal(cues[0].start, 0.3);
  for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i].start >= cues[i - 1].start);
  assert.ok(cues.at(-1).end <= 3.8 + 0.36);
  assert.ok(cues[0].end <= cues[1].start + 1e-9, 'prvá veta zmizne najneskôr so začiatkom druhej');
});
