// scripts/lib/frontWeekPipeline.test.mjs — linka videa „Týždeň na fronte" bez siete a bez prehliadača:
// načítanie týždňa zo služby OKO (falošný fetch): posledné hlásenie určí týždeň, snímka mapy „spred týždňa"
// smie byť o deň–dva staršia (zrkadlo zapisuje len pri zmene), pri väčšej diere sa o území mlčí;
// text príspevku je kritický voči agresorovi, zdroj mapy volá okolive.sk a nesie odkaz na mapu frontu;
// nahrávanie obrazu hlási priebeh a zlyhanie čitateľne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_SNAPSHOT_FALLBACK_DAYS, loadFrontWeek } from './frontWeekData.mjs';
import { captureFrontWeek, frontWeekPostText } from './frontWeekPipeline.mjs';

const rect = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const poly = (kind, ...r) => ({ kind, type: 'Polygon', rings: [rect(...r)] });
const P = 'Покровський';
const rep = (total, attacks) => ({ total, reportedAtText: '08:00 1.10.', directions: [{ gs: P, attacks, text: '', shared: false }] });
const DAYS = {};
for (let d = 13; d <= 30; d += 1) DAYS[`2026-09-${d}`] = rep(200, 20);
for (let d = 1; d <= 3; d += 1) DAYS[`2026-10-0${d}`] = rep(220, 25);
const NOW = { day: '2026-10-02', features: [poly('occupied', 37.26, 48.20, 37.60, 48.40)] };
const BEFORE = { day: '2026-09-25', features: [poly('occupied', 37.30, 48.20, 37.60, 48.40)] };

/** Falošná služba OKO: hlásenia po dňoch a snímky mapy podľa `at`. */
function fakeOko({ days = DAYS, snapshots = {}, deepstateStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (u.pathname === '/api/ukraine/events/directions') {
      const from = u.searchParams.get('from'); const to = u.searchParams.get('to');
      return json({ days: Object.fromEntries(Object.entries(days).filter(([d]) => d >= from && d <= to)) });
    }
    if (u.pathname === '/api/ukraine/events/deepstate') {
      if (deepstateStatus !== 200) return json({ error: 'x' }, deepstateStatus);
      const snap = snapshots[u.searchParams.get('at')];
      return snap ? json(snap) : json({ error: 'no snapshot' }, 404);
    }
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

test('týždeň končí posledným hlásením; snímky mapy sú presne 7 dní od seba', async () => {
  const oko = fakeOko({ snapshots: { '2026-10-03': NOW, '2026-09-25': BEFORE } });
  const { model, inputs } = await loadFrontWeek({ baseUrl: 'http://localhost:4173/', fetchImpl: oko.fetchImpl, today: '2026-10-03' });
  assert.deepEqual(model.week, { from: '2026-09-27', to: '2026-10-03' });
  assert.equal(Object.keys(inputs.days).length, 14, 'len 14 dní modelu');
  assert.equal(model.total.week, 200 * 4 + 220 * 3);
  assert.equal(model.total.prev, 1400);
  // Druhá snímka sa pýta na deň 7 dní pred dňom prvej (nie pred dňom hlásenia).
  assert.ok(oko.calls.includes('http://localhost:4173/api/ukraine/events/deepstate?at=2026-10-03'));
  assert.ok(oko.calls.includes('http://localhost:4173/api/ukraine/events/deepstate?at=2026-09-25'));
  assert.equal(model.change.fromDay, '2026-09-25');
  assert.equal(model.change.toDay, '2026-10-02');
  assert.equal(model.change.weekly, true);
  assert.ok(model.change.ruKm2 > 50, `Rusko obsadilo pás pri Pokrovsku: ${model.change.ruKm2}`);
  assert.equal(model.directions[0].id, 'pokrovsk');
  assert.ok(model.directions[0].ruAt);
});

test('zvolený deň: týždeň končí ním, aj keď archív má novšie hlásenia', async () => {
  const oko = fakeOko({ snapshots: { '2026-09-30': { ...NOW, day: '2026-09-30' }, '2026-09-23': { ...BEFORE, day: '2026-09-23' } } });
  const { model } = await loadFrontWeek({ baseUrl: 'http://localhost:4173', refDay: '2026-09-30', fetchImpl: oko.fetchImpl, today: '2026-10-03' });
  assert.deepEqual(model.week, { from: '2026-09-24', to: '2026-09-30' });
  assert.equal(model.total.week, 1400);
  assert.equal(model.change.weekly, true);
});

test('snímka spred týždňa o deň–dva staršia platí ako stav k žiadanému dňu; pri väčšej diere sa o území mlčí', async () => {
  assert.equal(MAX_SNAPSHOT_FALLBACK_DAYS, 2);
  // Zrkadlo 25. 9. nezapísalo (mapa sa nezmenila) — služba vráti snímku z 24. 9.
  const near = fakeOko({ snapshots: { '2026-10-03': NOW, '2026-09-25': { ...BEFORE, day: '2026-09-24' } } });
  const a = await loadFrontWeek({ baseUrl: 'http://x', fetchImpl: near.fetchImpl, today: '2026-10-03' });
  assert.equal(a.model.change.fromDay, '2026-09-25');
  assert.equal(a.model.change.weekly, true);
  assert.equal(a.inputs.snapshotBefore.day, '2026-09-24');
  // Výpadok zrkadla: najbližšia snímka je z 20. 9. — porovnanie by nebolo za týždeň.
  const far = fakeOko({ snapshots: { '2026-10-03': NOW, '2026-09-25': { ...BEFORE, day: '2026-09-20' } } });
  const b = await loadFrontWeek({ baseUrl: 'http://x', fetchImpl: far.fetchImpl, today: '2026-10-03' });
  assert.equal(b.model.change, null);
  assert.equal(b.inputs.snapshotBefore, null);
  // Snímka z budúcnosti voči žiadanému dňu (chyba služby) sa nepoužije.
  const future = fakeOko({ snapshots: { '2026-10-03': NOW, '2026-09-25': { ...BEFORE, day: '2026-09-27' } } });
  assert.equal((await loadFrontWeek({ baseUrl: 'http://x', fetchImpl: future.fetchImpl, today: '2026-10-03' })).model.change, null);
});

test('bez mapy video stojí na hláseniach; bez hlásení nie je čo robiť', async () => {
  const noMap = fakeOko({ deepstateStatus: 502 });
  const { model } = await loadFrontWeek({ baseUrl: 'http://x', fetchImpl: noMap.fetchImpl, today: '2026-10-03' });
  assert.equal(model.change, null);
  assert.equal(model.total.week, 200 * 4 + 220 * 3);
  await assert.rejects(loadFrontWeek({ baseUrl: 'http://x', fetchImpl: fakeOko({ days: {} }).fetchImpl, today: '2026-10-03' }), { code: 'FRONT_WEEK_NO_REPORTS' });
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(loadFrontWeek({ baseUrl: 'http://x', fetchImpl: down, today: '2026-10-03' }), { code: 'FRONT_WEEK_FETCH', status: 503 });
});

test('údery z archívu hlásení sa pripoja k dňom, ktoré ich nesú', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-front-week-'));
  try {
    fs.mkdirSync(path.join(dir, 'reports'));
    fs.writeFileSync(path.join(dir, 'reports', '2026-10-02.json'), JSON.stringify({ strikes: { kab: 150, drones: 4000 } }));
    fs.writeFileSync(path.join(dir, 'reports', '2026-10-03.json'), JSON.stringify({ strikes: { kab: 100 } }));
    fs.writeFileSync(path.join(dir, 'reports', '2026-10-01.json'), '{ poškodený súbor');
    const oko = fakeOko();
    const { model, inputs } = await loadFrontWeek({ baseUrl: 'http://x', fetchImpl: oko.fetchImpl, archiveDir: dir, today: '2026-10-03' });
    assert.deepEqual(inputs.days['2026-10-02'].strikes, { kab: 150, drones: 4000 });
    assert.equal(inputs.days['2026-10-01'].strikes, undefined);
    assert.deepEqual(model.strikes, { kab: { sum: 250, days: 2 }, drones: { sum: 4000, days: 1 } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const dirRow = (id, week, extra = {}) => ({ id, week, prev: week, weekDays: 7, prevDays: 7, trend: 'flat', changePct: 0, ruKm2: 0, uaKm2: 0, toGreyKm2: 0, ruAt: null, uaAt: null, series: [], ...extra });
const MODEL = {
  refDay: '2026-10-03', week: { from: '2026-09-27', to: '2026-10-03' }, prev: { from: '2026-09-20', to: '2026-09-26' },
  total: { week: 1494, prev: 1685, weekDays: 7, prevDays: 7, changePct: -11, trend: 'flat', series: [] },
  change: { fromDay: '2026-09-25', toDay: '2026-10-02', spanDays: 7, weekly: true, ruKm2: 38.7, uaKm2: 36.4, toGreyKm2: 6.5, fromGreyKm2: 38.7 },
  directions: [dirRow('pokrovsk', 169, { ruKm2: 16.5 }), dirRow('kostiantynivka', 165), dirRow('vovchansk', 61), dirRow('lyman', 56, { uaKm2: 36.4 }), dirRow('kherson', 0)],
};

test('text príspevku: háčik, čísla, zdroje, odkaz na mapu frontu', () => {
  const text = frontWeekPostText(MODEL);
  const lines = text.split('\n');
  assert.match(lines[0], /^Ruský agresor obsadil ďalších 39 km² — Ukrajina oslobodila 36 km²\.$/);
  assert.match(text, /Týždeň na fronte \(27\. 9\. – 3\. 10\. 2026\):/);
  assert.match(text, /• 1 494 bojových stretov podľa ukrajinského generálneho štábu/);
  assert.match(text, /• najviac ruských útokov: Pokrovský smer 169, Kosťantynivský smer 165, Vovčansk 61/);
  assert.match(text, /• zmena územia 25\. 9\. – 2\. 10\. 2026: Rusko obsadilo 39 km², Ukrajina oslobodila 36 km²/);
  assert.match(text, /vypočítaná z porovnania dvoch snímok mapy frontu na okolive\.sk s odstupom 7 dní/);
  // Pravidlo vlastníka: zdroj mapy je okolive.sk — poskytovateľ dát sa vo výstupoch nemenuje.
  assert.doesNotMatch(text, /deep\s*state/i);
  assert.match(text, /údaje jednej strany/);
  assert.match(text, /^Mapa frontu deň po dni: https:\/\/okolive\.sk\/\?front=front$/m);
  // ArmyInform žiada pri prevzatí priamy odkaz; zdroj mapy je portál.
  assert.match(lines.at(-1), /^Zdroje: mapa frontu okolive\.sk · hlásenia Generálneho štábu Ukrajiny cez ArmyInform \(https:\/\/armyinform\.com\.ua\) · podklad © OpenStreetMap$/);
  assert.ok(text.indexOf('okolive.sk') < text.indexOf('armyinform.com.ua'), 'odkaz na OKO je prvý');
  assert.doesNotMatch(text, /Uhrin|undefined|null|NaN/);
  assert.doesNotMatch(text, /kherson|Chersonský/, 'smer bez útokov sa neuvádza');
});

test('text príspevku bez týždenného porovnania mapy o území mlčí', () => {
  for (const change of [null, { ...MODEL.change, spanDays: 9, weekly: false }]) {
    const text = frontWeekPostText({ ...MODEL, change });
    assert.match(text.split('\n')[0], /^1 494 bojových stretov za sedem dní\.$/);
    assert.doesNotMatch(text, /km²|DeepState|zmena územia/);
    assert.match(text, /údaje jednej strany/);
    assert.match(text.split('\n').at(-1), /^Zdroje: mapa frontu okolive\.sk · hlásenia Generálneho štábu Ukrajiny cez ArmyInform \(https:\/\/armyinform\.com\.ua\) · podklad © OpenStreetMap$/);
  }
});

test('nahrávanie obrazu: hlási priebeh, zlyhanie vráti čitateľne', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-front-capture-'));
  try {
    const okScript = path.join(dir, 'ok.mjs');
    fs.writeFileSync(okScript, `import fs from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
console.log('[front-week] 0/300 (0 s)');
console.log('[front-week] 200/300 (41 s)');
fs.writeFileSync(out, 'mp4');
`);
    const out = path.join(dir, 'obraz.mp4');
    const seen = [];
    const result = await captureFrontWeek({ jobFile: path.join(dir, 'uloha.json'), out, capture: { script: okScript, baseUrl: 'http://localhost:4173' }, ffmpeg: 'ffmpeg', onProgress: (stage, d) => seen.push([stage, d.frame, d.frames]) });
    assert.equal(result, out);
    assert.deepEqual(seen.at(-1), ['capture', 200, 300]);
    const log = fs.readFileSync(`${out}.log`, 'utf8');
    assert.match(log, /--job .*uloha\.json --out .*obraz\.mp4 --url http:\/\/localhost:4173/);
    assert.match(log, /200\/300/);

    const badScript = path.join(dir, 'bad.mjs');
    fs.writeFileSync(badScript, 'console.error("Error: OKO sa nenačítalo (beží oko-dev na localhoste?)"); process.exit(3);\n');
    await assert.rejects(
      captureFrontWeek({ jobFile: 'x.json', out: path.join(dir, 'zle.mp4'), capture: { script: badScript }, ffmpeg: 'ffmpeg' }),
      (e) => e.code === 'CAPTURE_FAILED' && /kód 3/.test(e.message) && /OKO sa nenačítalo/.test(e.message),
    );
    // Skript skončil nulou, ale video nevzniklo — tiež zlyhanie.
    const emptyScript = path.join(dir, 'empty.mjs');
    fs.writeFileSync(emptyScript, 'console.log("hotovo");\n');
    await assert.rejects(captureFrontWeek({ jobFile: 'x.json', out: path.join(dir, 'nic.mp4'), capture: { script: emptyScript }, ffmpeg: 'ffmpeg' }), { code: 'CAPTURE_FAILED' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
