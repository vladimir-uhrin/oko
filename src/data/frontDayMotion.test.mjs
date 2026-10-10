// Grafika denného videa v2: titulky po slovách, veľké číslo podľa vety, háčik bez karty, zvukové efekty k strihom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMotionSvg, hookSize, motionEvents, shotStat, wordCues, wordGroups } from './frontDayMotion.js';

const model = {
  day: '2026-10-10', report: { total: 218 }, avg7: 200,
  directions: [{ id: 'pokrovsk', attacks: 22 }, { id: 'vovchansk', attacks: 18 }],
  change: { ruKm2: 13.4, uaKm2: 0, spanDays: 1, directions: [{ id: 'huliaipole', ruKm2: 13.4, uaKm2: 0 }] },
  air: { count: 23, kinds: ['drones', 'bombs'] },
  casualties: { total: { killed: 25 }, places: [{ sk: 'Pryluky', killed: 20, children: 5 }] },
};

test('titulky po 1–3 slovách, čísla s jednotkou spolu, koniec vety uzavrie skupinu', () => {
  const g = wordGroups('Generálny štáb hlási 218 bojových stretov, viac ako týždenný priemer.');
  assert.ok(g.every((x) => x.split(' ').length <= 3 && x.length <= 22), JSON.stringify(g));
  assert.ok(g.some((x) => x.includes('218 bojových')), 'číslo sa neodtrhne od slova');
  assert.ok(wordGroups('Obsadil 13 km² Ukrajiny.').some((x) => x.includes('13 km²')));
  const two = wordGroups('Prvá veta. Druhá veta.');
  assert.ok(two.indexOf('Prvá veta.') >= 0, 'koniec vety uzavrie skupinu');
});

test('časy titulkov idú za sebou v reči vety; úvod a záver bez titulkov', () => {
  const lines = [{ id: 'hook', shot: 'opening', caption: 'Háčik vety.' }, { id: 'clashes', shot: 'overview', caption: 'Generálny štáb hlási 218 bojových stretov.' }, { id: 'portal', shot: 'closing', caption: 'Mapa na okolive.sk.' }];
  const placement = [{ id: 'hook', start: 0, speechStart: 0.1, speechEnd: 2 }, { id: 'clashes', start: 3, speechStart: 3.2, speechEnd: 6 }, { id: 'portal', start: 7, speechStart: 7.1, speechEnd: 9 }];
  const cues = wordCues(lines, placement);
  assert.ok(cues.length >= 3 && cues.every((c) => c.line === 'clashes'), 'len stredná veta');
  assert.ok(Math.abs(cues[0].from - 3.2) < 1e-9);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].from >= cues[i - 1].from && cues[i - 1].to <= cues[i].from + 1e-9, 'bez prekrytia');
  assert.ok(cues.at(-1).to <= 6.6);
});

test('veľké číslo podľa vety: strety, útoky smeru, km², oblasti, obete', () => {
  assert.deepEqual([shotStat(model, 'clashes').value, shotStat(model, 'clashes').unit], [218, 'BOJOVÝCH STRETOV']);
  assert.match(shotStat(model, 'clashes').sub[0], /viac ako týždenný priemer \(200\)/);
  const top = shotStat(model, 'top', { sceneId: 'vovchansk' });
  assert.deepEqual([top.value, top.unit], [18, 'RUSKÝCH ÚTOKOV'], 'smer záberu, nie prvý v hlásení');
  assert.equal(shotStat(model, 'top', { sceneId: 'pokrovsk' }).kicker, 'POKROVSKÝ SMER');
  const ch = shotStat(model, 'change');
  assert.deepEqual([ch.prefix, ch.value, ch.unit], ['+', 13, 'OBSADIL RUSKÝ AGRESOR']);
  assert.deepEqual([shotStat(model, 'air').value, shotStat(model, 'air').unit], [23, 'OBLASTÍ POD HROZBOU']);
  assert.ok(shotStat(model, 'air').sub.includes('hlásená hrozba, nie potvrdené zásahy'), 'hrozba nie je zásah');
  assert.deepEqual([shotStat(model, 'strike').value, shotStat(model, 'strike').unit], [25, 'MŔTVYCH']);
  assert.equal(shotStat(model, 'hook'), null);
  assert.equal(shotStat({ ...model, change: null }, 'change'), null);
});

test('grafika: háčik bez karty, číslo sa dopočíta, záblesk pri strihu, záver so zdrojmi', () => {
  const shots = [{ id: 'opening', kind: 'opening', start: 0, dur: 2.5 }, { id: 'overview', kind: 'overview', start: 2.5, dur: 3 }, { id: 'closing', kind: 'closing', start: 5.5, dur: 2 }];
  const placement = [{ id: 'hook', shot: 'opening', start: 0, speechStart: 0.1, speechEnd: 2.3 }, { id: 'clashes', shot: 'overview', start: 2.5, speechStart: 2.7, speechEnd: 5.3 }, { id: 'portal', shot: 'closing', start: 5.5, speechStart: 5.6, speechEnd: 7 }];
  const hook = { tag: 'DEŇ NA FRONTE · 10. 10.', lines: ['23 OBLASTÍ', 'POD HROZBOU RUSKÉHO ÚTOKU'], accent: '23', sub: 'v noci podľa Vzdušných síl Ukrajiny' };
  const at = (t) => buildMotionSvg({ t, shots, lines: [], placement, cues: [], model, hook });
  assert.ok(at(0.6).includes('POD HROZBOU RUSKÉHO ÚTOKU') && !at(0.6).includes('BOJOVÝCH STRETOV'), 'úvod = háčik');
  assert.ok(!at(0.6).includes('<rect x="24"'), 'žiadna karta v rámčeku');
  assert.ok(at(2.52).includes('opacity="0.2'), 'záblesk pri strihu');
  assert.ok(at(3.6).includes('>218<'), 'po dopočítaní plné číslo');
  assert.ok(!at(2.55).includes('>218<'), 'na začiatku sa číslo ešte dopočítava');
  const end = at(6.4);
  assert.ok(end.includes('okolive.sk') && end.includes('údaje jednej strany'), 'záver so zdrojmi');
  assert.ok(hookSize('POD HROZBOU RUSKÉHO ÚTOKU') * 'POD HROZBOU RUSKÉHO ÚTOKU'.length * 0.64 <= 990);
});

test('zvukové efekty: úder na začiatku, šum pred strihom, pípnutie pri čísle', () => {
  const ev = motionEvents([{ kind: 'opening', start: 0 }, { kind: 'overview', start: 2.5 }, { kind: 'closing', start: 5.5 }], [{ id: 'clashes', start: 2.5 }]);
  assert.equal(ev[0].kind, 'impact');
  assert.ok(ev.some((e) => e.kind === 'whoosh' && Math.abs(e.t - 2.32) < 1e-9));
  assert.ok(ev.some((e) => e.kind === 'pop' && Math.abs(e.t - 2.6) < 1e-9));
});
