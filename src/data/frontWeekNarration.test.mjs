// src/data/frontWeekNarration.test.mjs — komentár videa „Týždeň na fronte": háčik je najsilnejšie číslo týždňa,
// každé tvrdenie nesie zdroj (strety „ukrajinský generálny štáb", územie „mapa frontu okolive.sk"), slovník je
// kritický voči agresorovi, žiadny výstup nemenuje poskytovateľa dát mapy, hlas dostane čísla slovami a o území
// sa bez týždenného porovnania mlčí.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHANGE_MIN_KM2, DIRECTION_SK, HOOK_MIN_KM2, MAP_SOURCE, attacksHereSentence, attacksPhrase, changePhrase, directionShots,
  directionSk, frontWeekHook, frontWeekLines, km2Phrase, rangeLabel, weekStory,
} from './frontWeekNarration.js';
import { FRONT_SCENES } from '../ukraineFrontScenes.js';

const N = ' ';
const dirRow = (id, week, extra = {}) => ({
  id, week, prev: week, weekDays: 7, prevDays: 7, trend: 'flat', changePct: 0,
  ruKm2: 0, uaKm2: 0, toGreyKm2: 0, ruAt: null, uaAt: null, series: [], ...extra,
});
const model = (change, directions, total = {}) => ({
  refDay: '2026-10-03', week: { from: '2026-09-27', to: '2026-10-03' }, prev: { from: '2026-09-20', to: '2026-09-26' },
  total: { week: 1494, prev: 1685, weekDays: 7, prevDays: 7, changePct: -11, trend: 'flat', series: [], ...total },
  change: change ? { fromDay: '2026-09-25', toDay: '2026-10-02', spanDays: 7, weekly: true, toGreyKm2: 0, fromGreyKm2: 0, ...change } : null,
  directions,
});
// Týždeň 27. 9. – 3. 10. 2026 tak, ako ho dali dáta.
const REAL = model({ ruKm2: 38.7, uaKm2: 36.4 }, [
  dirRow('pokrovsk', 169, { ruKm2: 16.5 }), dirRow('kostiantynivka', 165), dirRow('vovchansk', 61),
  dirRow('lyman', 56, { uaKm2: 36.4 }), dirRow('huliaipole', 42, { ruKm2: 8.3 }), dirRow('sloviansk-kramatorsk', 33, { ruKm2: 13.1 }),
]);

test('slovenské mená má každý smer frontu', () => {
  for (const s of FRONT_SCENES.filter((x) => !x.overview)) {
    assert.ok(DIRECTION_SK[s.id], `chýba ${s.id}`);
    assert.equal(DIRECTION_SK[s.id].title, DIRECTION_SK[s.id].name.toUpperCase());
    assert.match(DIRECTION_SK[s.id].at, /^(pri|na) /);
  }
  assert.deepEqual(directionSk('neznamy'), { name: 'neznamy', title: 'NEZNAMY', at: 'na tomto smere' });
});

test('čísla slovom pre hlas a číslicou pre titulok', () => {
  assert.deepEqual(km2Phrase(1), { value: 1, spoken: 'jeden kilometer štvorcový', caption: `1${N}km²` });
  assert.deepEqual(km2Phrase(3.4), { value: 3, spoken: 'tri kilometre štvorcové', caption: `3${N}km²` });
  assert.deepEqual(km2Phrase(38.7), { value: 39, spoken: 'tridsaťdeväť kilometrov štvorcových', caption: `39${N}km²` });
  assert.equal(km2Phrase(1234.6).caption, `1${N}235${N}km²`);
  assert.equal(km2Phrase(-5).value, 0);
  assert.deepEqual(attacksPhrase(1), { value: 1, spoken: 'jeden útok', caption: '1 útok' });
  assert.equal(attacksPhrase(2).spoken, 'dva útoky');
  assert.equal(attacksPhrase(169).spoken, 'sto šesťdesiatdeväť útokov');
  // Počty GŠ sú útoky nepriateľa — „ruské útoky" v správnom tvare.
  assert.deepEqual(attacksPhrase(1, { russian: true }), { value: 1, spoken: 'jeden ruský útok', caption: '1 ruský útok' });
  assert.equal(attacksPhrase(3, { russian: true }).caption, '3 ruské útoky');
  assert.equal(attacksPhrase(50, { russian: true }).caption, '50 ruských útokov');
  assert.deepEqual(attacksHereSentence(56), { spoken: 'Ruských útokov tu bolo päťdesiatšesť.', caption: 'Ruských útokov tu bolo 56.' });
  assert.equal(attacksHereSentence(1).caption, 'Ruský útok tu bol 1.');
  assert.equal(attacksHereSentence(3).spoken, 'Ruské útoky tu boli tri.');
  assert.equal(rangeLabel('2026-09-27', '2026-10-03'), `27.${N}9. – 3.${N}10. 2026`);
});

test('zmena oproti minulému týždňu slovom', () => {
  assert.equal(changePhrase(null), null);
  assert.equal(changePhrase(NaN), null);
  assert.equal(changePhrase(-4), 'približne rovnako ako týždeň predtým');
  assert.equal(changePhrase(-11), 'o desatinu menej než týždeň predtým');
  assert.equal(changePhrase(18), 'o pätinu viac než týždeň predtým');
  assert.equal(changePhrase(-30), 'o tretinu menej než týždeň predtým');
  assert.equal(changePhrase(45), 'takmer o polovicu viac než týždeň predtým');
  assert.equal(changePhrase(70), 'výrazne viac než týždeň predtým');
});

test('príbeh týždňa: kto sa pohol viac; malá zmena alebo žiadne porovnanie = strety', () => {
  assert.ok(CHANGE_MIN_KM2 < HOOK_MIN_KM2);
  assert.equal(weekStory(REAL), 'ru');
  assert.equal(weekStory(model({ ruKm2: 12, uaKm2: 40 }, [])), 'ua');
  assert.equal(weekStory(model({ ruKm2: 40, uaKm2: 40 }, [])), 'ua', 'pri rovnosti vedie strana, ktorá územie získala späť');
  assert.equal(weekStory(model({ ruKm2: 6, uaKm2: 4 }, [])), 'clashes');
  assert.equal(weekStory(model(null, [])), 'clashes');
  assert.equal(weekStory(model({ ruKm2: 80, uaKm2: 0, spanDays: 9, weekly: false }, [])), 'clashes', 'snímky nie sú týždeň od seba');
});

test('háčik: najsilnejšie číslo týždňa so zdrojom', () => {
  assert.deepEqual(frontWeekHook(REAL), {
    tag: 'TÝŽDEŇ NA FRONTE', lines: ['Ruský agresor obsadil', `ďalších 39${N}km²`], sub: `Ukrajina oslobodila 36${N}km²`,
    source: `z porovnania dvoch snímok mapy frontu okolive.sk · 25.${N}9. – 2.${N}10. 2026`,
  });
  const ua = frontWeekHook(model({ ruKm2: 0.4, uaKm2: 40 }, []));
  assert.deepEqual(ua.lines, ['Ukrajina oslobodila', `40${N}km²`]);
  assert.equal(ua.sub, null, 'pod 1 km² sa druhá strana neuvádza');
  const clashes = frontWeekHook(model(null, []));
  assert.deepEqual(clashes.lines, [`1${N}494 bojových stretov`, 'za sedem dní']);
  assert.match(clashes.source, /^podľa hlásení ukrajinského generálneho štábu · 27\./);
  assert.doesNotMatch(clashes.source, /DeepState/);
});

test('zábery smerov: dva s najviac útokmi a smer, kde sa front pohol', () => {
  assert.deepEqual(directionShots(REAL), [{ id: 'pokrovsk', role: 'top' }, { id: 'kostiantynivka', role: 'second' }, { id: 'lyman', role: 'counter' }]);
  // Smer príbehu je už medzi najbojovanejšími → nepridá sa druhý raz.
  const ru = model({ ruKm2: 30, uaKm2: 0 }, [dirRow('pokrovsk', 100, { ruKm2: 30 }), dirRow('lyman', 50)]);
  assert.deepEqual(directionShots(ru), [{ id: 'pokrovsk', role: 'top' }, { id: 'lyman', role: 'second' }]);
  // Príbeh inde než boje: tretí záber patrí smeru príbehu.
  const far = model({ ruKm2: 30, uaKm2: 0 }, [dirRow('pokrovsk', 100), dirRow('lyman', 50), dirRow('huliaipole', 10, { ruKm2: 30 })]);
  assert.deepEqual(directionShots(far).map((s) => `${s.id}:${s.role}`), ['pokrovsk:top', 'lyman:second', 'huliaipole:story']);
  // Smer s menej než 4 dňami údajov nie je „najviac útokov" (súčet by bol z pár dní).
  const thin = model(null, [dirRow('sumy', 90, { weekDays: 2 }), dirRow('pokrovsk', 80)]);
  assert.deepEqual(directionShots(thin), [{ id: 'pokrovsk', role: 'top' }]);
});

test('vety týždňa: háčik, zdroje, smery, portál', () => {
  const lines = frontWeekLines(REAL);
  assert.deepEqual(lines.map((l) => [l.id, l.shot, l.caption]), [
    ['hook1', 'opening', `Ruský agresor za týždeň obsadil ďalších 39${N}km² Ukrajiny.`],
    ['hook2', 'overview', `Ukrajina oslobodila 36${N}km².`],
    ['src', 'overview', 'Ukazuje to mapa frontu na okolive.sk: porovnanie dvoch snímok s odstupom siedmich dní.'],
    ['total', 'overview', `Ukrajinský generálny štáb hlási za týždeň 1${N}494 bojových stretov — o desatinu menej než týždeň predtým.`],
    ['pokrovsk-a', 'dir:pokrovsk', 'Najviac ruských útokov je pri Pokrovsku: 169 za týždeň.'],
    ['pokrovsk-b', 'dir:pokrovsk', `Ruská okupácia sa tu rozšírila o 17${N}km².`],
    ['kostiantynivka-a', 'dir:kostiantynivka', 'Takmer rovnako útočí agresor pri Kosťantynivke: 165 útokov.'],
    ['lyman-a', 'dir:lyman', `Pri Lymane sa front pohol opačným smerom: Ukrajina tu oslobodila 36${N}km².`],
    ['lyman-b', 'dir:lyman', 'Ruských útokov tu bolo 56.'],
    ['portal', 'closing', 'Mapu frontu deň po dni nájdete na okolive.sk.'],
  ]);
  // Úvodná karta nesie jednu vetu — druhé číslo zaznie už nad mapou.
  assert.equal(lines.filter((l) => l.shot === 'opening').length, 1);
  // Hlas nedostane číslice ani značky, cudzie názvy číta foneticky.
  for (const l of lines) assert.doesNotMatch(l.spoken, /\d|km²|DeepState|okolive\.sk/, l.id);
  assert.equal(lines[0].spoken, 'Ruský agresor za týždeň obsadil ďalších tridsaťdeväť kilometrov štvorcových Ukrajiny.');
  assert.equal(lines.find((l) => l.id === 'src').spoken, `Ukazuje to mapa frontu na ${MAP_SOURCE.spokenSite}: porovnanie dvoch snímok s odstupom siedmich dní.`);
  assert.match(lines.find((l) => l.id === 'total').spoken, /tisíc štyristo deväťdesiatštyri bojových stretov/);
  // Vety s vlastnými menami sú označené (kontrola výslovnosti im mená odpustí); pevné vety s doménou (zdroj mapy,
  // portál) sú schválené — čísla v nich nie sú.
  assert.deepEqual(lines.filter((l) => l.names).map((l) => l.id), ['pokrovsk-a', 'kostiantynivka-a', 'lyman-a']);
  assert.deepEqual(lines.filter((l) => l.approved).map((l) => l.id), ['src', 'portal']);
  for (const l of lines.filter((x) => x.approved)) assert.doesNotMatch(l.caption, /\d/, 'schválená veta nesmie niesť číslo');
  // Meno autora v komentári nie je (rozhodnutie vlastníka).
  for (const l of lines) assert.doesNotMatch(`${l.spoken} ${l.caption}`, /Uhrin|Vladim/i);
});

test('keď Ukrajina získala viac, vedie háčik ona a Rusko je druhé', () => {
  const m = model({ ruKm2: 12, uaKm2: 40 }, [dirRow('pokrovsk', 100, { ruKm2: 12 }), dirRow('kostiantynivka', 50), dirRow('lyman', 20, { uaKm2: 40 })]);
  const lines = frontWeekLines(m);
  assert.equal(lines[0].caption, `Ukrajina za týždeň oslobodila 40${N}km².`);
  assert.deepEqual([lines[1].id, lines[1].shot, lines[1].caption], ['hook2', 'overview', `Ruský agresor za ten istý čas obsadil 12${N}km².`]);
  // Druhý smer ďaleko za prvým: len počet, bez „takmer rovnako".
  assert.equal(lines.find((l) => l.id === 'kostiantynivka-a').caption, 'Pri Kosťantynivke 50 ruských útokov.');
  assert.equal(lines.find((l) => l.id === 'lyman-a').caption, `Pri Lymane sa front pohol najviac: Ukrajina tu oslobodila 40${N}km².`);
});

test('bez týždenného porovnania mapy sa o území nehovorí vôbec', () => {
  for (const m of [
    model(null, [dirRow('pokrovsk', 169, { ruKm2: 16.5 }), dirRow('lyman', 56, { uaKm2: 36.4 })]),
    model({ ruKm2: 38.7, uaKm2: 36.4, spanDays: 10, weekly: false }, [dirRow('pokrovsk', 169, { ruKm2: 16.5 }), dirRow('lyman', 56, { uaKm2: 36.4 })]),
  ]) {
    const lines = frontWeekLines(m);
    assert.deepEqual(lines.map((l) => l.id), ['hook1', 'total', 'pokrovsk-a', 'lyman-a', 'portal']);
    assert.equal(lines[0].caption, `1${N}494 bojových stretov za sedem dní.`);
    assert.equal(lines[1].caption, 'Hlási ich ukrajinský generálny štáb — o desatinu menej než týždeň predtým.');
    for (const l of lines) assert.doesNotMatch(l.caption, /km²|obsadil|oslobodil|okupáci/, l.id);
  }
});

test('malá zmena územia: háčik sú strety a veta o smere si zdroj nesie sama', () => {
  const m = model({ ruKm2: 6, uaKm2: 4 }, [dirRow('pokrovsk', 169, { ruKm2: 6 }), dirRow('lyman', 56, { uaKm2: 4 })]);
  const lines = frontWeekLines(m);
  assert.equal(lines.find((l) => l.id === 'src'), undefined, 'veta o zdroji mapy v prehľade nie je');
  const b = lines.find((l) => l.id === 'pokrovsk-b');
  assert.equal(b.caption, `Podľa mapy frontu OKO sa tu ruská okupácia za týždeň rozšírila o 6${N}km².`);
  assert.equal(b.spoken, 'Podľa mapy frontu OKO sa tu ruská okupácia za týždeň rozšírila o šesť kilometrov štvorcových.');
  assert.equal(b.names, true);
  assert.equal(lines.find((l) => l.id === 'lyman-b').caption, `Podľa mapy frontu OKO tu Ukrajina za týždeň oslobodila 4${N}km².`);
});

test('pravidlá vlastníka: kritický voči agresorovi, zdroj mapy okolive.sk — poskytovateľ dát sa vo výstupoch nemenuje', () => {
  const variants = [
    REAL,
    model({ ruKm2: 12, uaKm2: 40 }, [dirRow('pokrovsk', 100, { ruKm2: 12 }), dirRow('lyman', 20, { uaKm2: 40 })]),
    model({ ruKm2: 6, uaKm2: 4 }, [dirRow('pokrovsk', 169, { ruKm2: 6 }), dirRow('lyman', 56, { uaKm2: 4 })]),
    model(null, [dirRow('pokrovsk', 169), dirRow('lyman', 56)]),
  ];
  for (const m of variants) {
    const hook = frontWeekHook(m);
    const texts = [...frontWeekLines(m).flatMap((l) => [l.spoken, l.caption]), hook.tag, ...hook.lines, hook.sub || '', hook.source];
    for (const t of texts) {
      assert.doesNotMatch(t, /deep\s*state|d[ií]pstejt/i, t);
      // Slovník agresora (postup ako „oslobodenie", neutrálna „kontrola") vo vetách nie je.
      assert.doesNotMatch(t, /rusk\S* kontrol|Rusko oslobodil|špeciáln\S* operáci/i, t);
    }
  }
  assert.equal(MAP_SOURCE.site, 'okolive.sk');
  // Keď Rusko postúpilo, prvá veta ho volá agresorom; zdroj na karte je mapa frontu portálu.
  assert.match(frontWeekLines(REAL)[0].caption, /^Ruský agresor /);
  assert.match(frontWeekHook(REAL).source, /mapy frontu okolive\.sk/);
  assert.match(frontWeekLines(REAL).at(-1).caption, /okolive\.sk\.$/);
});
