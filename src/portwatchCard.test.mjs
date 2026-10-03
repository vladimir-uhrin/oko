// src/portwatchCard.test.mjs — karta PRECHODY ÚŽINAMI (BLÍZKY VÝCHOD, etapa 5a):
// lenivé sťahovanie pri rozbalení panela, riadky úžin (Ø 7 dní, zmena voči obdobiu
// pred krízou, posledný deň, pomenované okno), mini graf s čiarou priemeru,
// stavy (načítava, chýba, porucha so zachovanými číslami), zvýraznenie úžiny,
// ZASTARANÉ nad prahom, pätka s atribúciou MMF; drôty na panel, main.js, CSS a i18n.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createPortwatchCard, drawTransitSpark, PORTWATCH_REFRESH_MS } from './portwatchCard.js';
import { PORTWATCH_DATASET_URL, PORTWATCH_KEYS } from './data/portwatch.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

function fakeDocument({ canvas = false } = {}) {
  const makeEl = (tag) => {
    const classes = new Set();
    const el = {
      tag, children: [], textContent: '', hidden: false, dataset: {}, attrs: {}, listeners: {}, title: '', href: '', target: '', rel: '', width: 0, height: 0,
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      appendChild(c) { el.children.push(c); return c; },
      replaceChildren(...cs) { el.children = [...cs]; },
      addEventListener(t, fn) { el.listeners[t] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; },
    };
    if (canvas && tag === 'canvas') el.getContext = () => fakeCtx();
    return el;
  };
  return { createElement: makeEl };
}
function fakeCtx() {
  const calls = [];
  return {
    calls, fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect: (...a) => calls.push(['clearRect', ...a]), beginPath: () => calls.push(['beginPath']), closePath: () => calls.push(['closePath']),
    moveTo: (...a) => calls.push(['moveTo', ...a]), lineTo: (...a) => calls.push(['lineTo', ...a]), fill: () => calls.push(['fill']), stroke: () => calls.push(['stroke']),
    setLineDash: (d) => calls.push(['setLineDash', d]),
  };
}
const walk = (node, out = []) => { for (const c of node.children || []) { out.push(c); walk(c, out); } return out; };
const byClass = (root, cls) => walk(root).filter((n) => n.classList?.contains?.(cls));
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const tSk = (key, vars) => String(SK_STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));
const NOW = Date.UTC(2026, 8, 26, 12);

/** Telo proxy: Hormuz 60 dní (3/deň, posledný 1), Mys 60 dní (90/deň); priemery pred krízou zo servera. */
function payload({ lastDay = '2026-09-20' } = {}) {
  const rows = (total, last) => Array.from({ length: 60 }, (_, i) => {
    const d = new Date(Date.parse(`${lastDay}T00:00:00Z`) - (59 - i) * 86_400_000).toISOString().slice(0, 10);
    return [d, i === 59 ? last : total, 1, 0, 0, 0, 0, 1000, 0];
  });
  return {
    attribution: 'Source: International Monetary Fund, PortWatch',
    chokepoints: [
      { key: 'hormuz', rows: rows(3, 1), baseline: { id: 'iran-war', from: '2025-02-28', to: '2026-02-27', mean: 84.8, meanTanker: 47.6, days: 365 } },
      { key: 'cape', rows: rows(90, 90), baseline: { id: 'red-sea', from: '2023-01-01', to: '2023-11-15', mean: 48.9, meanTanker: 9.1, days: 319 } },
    ],
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test('bez cieľa alebo dokumentu je karta neškodná', () => {
  const inert = createPortwatchCard({ mountTarget: null, documentRef: fakeDocument() });
  assert.equal(inert.element, null);
  assert.doesNotThrow(() => { inert.setActive('hormuz'); inert.destroy(); });
});

test('bez panela-vlastníka sťahuje hneď: riadky úžin, Ø 7 dní, zmena voči obdobiu pred krízou, posledný deň, okno, pätka s MMF', async () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const calls = [];
  const timers = [];
  const card = createPortwatchCard({
    mountTarget: mount, documentRef: doc, translate: tKey, lang: 'en', now: () => NOW,
    fetchImpl: async (keys) => { calls.push(keys); return payload(); },
    setTimer: (fn, ms) => { timers.push(ms); return 1; }, clearTimer: () => {},
  });
  assert.equal(byClass(mount, 'oko-pw-status')[0].dataset.state, 'loading');
  await flush();
  assert.deepEqual(calls, [PORTWATCH_KEYS]);
  assert.deepEqual(timers, [PORTWATCH_REFRESH_MS], 'obnova raz za 30 min, kým je otvorené');
  assert.equal(card.loadedOnce, true);
  const rows = byClass(mount, 'oko-pw-row');
  assert.deepEqual(rows.map((r) => r.dataset.key), ['hormuz', 'cape']);
  const hormuz = rows[0];
  assert.equal(byClass(hormuz, 'oko-pw-name')[0].textContent, 'Strait of Hormuz', 'bez prekladu anglické meno z katalógu, nikdy holý kľúč');
  assert.equal(byClass(hormuz, 'oko-pw-avg')[0].textContent, 'mideast.pw.avg7 {"n":"2.7"}', '6 × 3 + 1 = 19 / 7');
  const pct = byClass(hormuz, 'oko-pw-pct')[0];
  assert.ok(pct.classList.contains('is-down'));
  assert.equal(pct.textContent, new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(-0.97));
  assert.equal(byClass(hormuz, 'oko-pw-sub')[0].textContent, 'mideast.pw.last {"date":"20/09/2026","n":"1","k":"1.0"}');
  assert.equal(byClass(hormuz, 'oko-pw-base')[0].textContent, 'mideast.pw.baseline.iran-war {"n":"84.8","k":"47.6"}');
  assert.ok(byClass(rows[1], 'oko-pw-pct')[0].classList.contains('is-up'), 'obchádzka okolo Afriky rastie');
  const link = byClass(mount, 'oko-pw-link')[0];
  assert.equal(link.href, PORTWATCH_DATASET_URL);
  assert.equal(link.rel, 'noopener noreferrer');
  assert.match(link.title, /International Monetary Fund/);
  assert.equal(byClass(mount, 'oko-pw-since')[0].textContent, 'mideast.pw.since {"date":"20/09/2026"}');
  assert.equal(byClass(mount, 'oko-pw-age').length, 1, 'vek bez ZASTARANÉ (6 dní)');
  assert.equal(byClass(mount, 'oko-pw-status')[0].hidden, true, 'hotové = stavový riadok skrytý');
  assert.equal(byClass(mount, 'oko-pw-note')[0].textContent, 'mideast.pw.note');
});

test('SK: skutočné texty — Ø 7 dní, posledný deň, rok pred vojnou s Iránom', async () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  createPortwatchCard({ mountTarget: mount, documentRef: doc, translate: tSk, lang: 'sk', now: () => NOW, fetchImpl: async () => payload(), setTimer: () => 1, clearTimer: () => {} });
  await flush();
  const hormuz = byClass(mount, 'oko-pw-row')[0];
  assert.equal(byClass(hormuz, 'oko-pw-name')[0].textContent, 'Hormuzský prieliv');
  assert.equal(byClass(hormuz, 'oko-pw-avg')[0].textContent, 'Ø 7 dní 2,7/deň');
  assert.equal(byClass(hormuz, 'oko-pw-sub')[0].textContent, 'posledný deň 20. 9. 2026 · počet lodí: 1 · tankery Ø 7 dní 1,0/deň', 'bez zhody s číslovkou („1 lodí" bolo zle)');
  assert.equal(byClass(hormuz, 'oko-pw-base')[0].textContent, 'rok pred vojnou s Iránom (28. 2. 2025 – 27. 2. 2026): Ø 84,8/deň, tankery 47,6');
  assert.equal(byClass(mount, 'oko-pw-row')[1].children[0].children[0].textContent, 'Mys dobrej nádeje (obchádzka)');
});

test('lenivo: zavretý panel nič nesťahuje, rozbalenie stiahne a spustí obnovu, zavretie ju zastaví', async () => {
  const doc = fakeDocument();
  const panelClasses = new Set(['collapsed']);
  const panel = { classList: { contains: (c) => panelClasses.has(c) } };
  const mount = doc.createElement('div');
  mount.closest = (sel) => (sel === '[data-panel-id]' ? panel : null);
  let observed = null;
  const calls = []; const timers = []; const cleared = [];
  const card = createPortwatchCard({
    mountTarget: mount, documentRef: doc, translate: tKey, now: () => NOW,
    fetchImpl: async (keys) => { calls.push(keys); return payload(); },
    setTimer: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimer: (id) => cleared.push(id),
    observerFactory: (fn) => ({ observe: () => { observed = fn; }, disconnect: () => { observed = null; } }),
  });
  await flush();
  assert.equal(calls.length, 0, 'zavretý panel = žiadny dopyt');
  assert.equal(card.isOpen, false);
  panelClasses.delete('collapsed'); observed();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(card.isOpen, true);
  assert.equal(timers.length, 1);
  panelClasses.add('collapsed'); observed();
  assert.equal(card.isOpen, false);
  assert.deepEqual(cleared, [1], 'zavretie zastaví obnovu');
  card.destroy();
  assert.equal(observed, null, 'destroy odpojí pozorovateľa');
  assert.deepEqual(mount.children, []);
});

test('stavy: 404 bez čísel = chýba, porucha po načítaní = čísla ostávajú + „posledné načítané"', async () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  let mode = 'missing';
  const fetchImpl = async () => {
    if (mode === 'missing') { const e = new Error('no_portwatch_snapshot'); e.status = 404; throw e; }
    if (mode === 'ok') return payload();
    const e = new Error('boom'); e.status = 500; throw e;
  };
  const card = createPortwatchCard({ mountTarget: mount, documentRef: doc, translate: tKey, now: () => NOW, fetchImpl, setTimer: () => 1, clearTimer: () => {} });
  await flush();
  const status = byClass(mount, 'oko-pw-status')[0];
  assert.equal(status.dataset.state, 'empty');
  assert.equal(status.textContent, 'mideast.pw.missing');
  mode = 'ok'; await card.refresh();
  assert.equal(byClass(mount, 'oko-pw-row').length, 2);
  mode = 'error'; await card.refresh();
  assert.equal(status.dataset.state, 'error');
  assert.equal(status.textContent, 'mideast.pw.error · mideast.pw.kept');
  assert.equal(status.hidden, false);
  assert.equal(byClass(mount, 'oko-pw-row').length, 2, 'čísla ostali');
});

test('zvýraznenie úžiny dejiska a ZASTARANÉ nad 14 dní', async () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const card = createPortwatchCard({ mountTarget: mount, documentRef: doc, translate: tKey, now: () => Date.UTC(2026, 9, 10), fetchImpl: async () => payload(), setTimer: () => 1, clearTimer: () => {} });
  card.setActive('hormuz');
  await flush();
  const [hormuz, cape] = byClass(mount, 'oko-pw-row');
  assert.ok(hormuz.classList.contains('is-active'), 'zvýraznenie prežije prekreslenie');
  assert.ok(!cape.classList.contains('is-active'));
  card.setActive('cape');
  assert.ok(cape.classList.contains('is-active'));
  assert.ok(!hormuz.classList.contains('is-active'));
  card.setActive('malacca');
  assert.equal(card.activeKey, null, 'úžina mimo karty = nič');
  assert.ok(hormuz.classList.contains('is-stale'), '20. 9. voči 10. 10. = 20 dní');
  const stale = byClass(mount, 'oko-pw-age').find((n) => n.classList.contains('is-stale'));
  assert.equal(stale.textContent, 'ukraine.src.stale');
});

test('mini graf: plocha + čiara + prerušovaná čiara priemeru pred krízou; mierka zahŕňa priemer; málo bodov = nič', () => {
  const ctx = fakeCtx();
  assert.equal(drawTransitSpark(ctx, [3, 2, 1], 85, { width: 100, height: 20 }), true);
  const dash = ctx.calls.filter((c) => c[0] === 'setLineDash');
  assert.deepEqual(dash, [['setLineDash', [3, 3]], ['setLineDash', []]]);
  const lastMove = ctx.calls.filter((c) => c[0] === 'moveTo').at(-1);
  assert.equal(lastMove[2], 20 - 1 - (85 / 85) * (20 - 3), 'priemer 85 je vrch mierky, séria 3 sa krčí pri dne');
  const empty = fakeCtx();
  assert.equal(drawTransitSpark(empty, [5], 10, { width: 100, height: 20 }), false);
  const noBase = fakeCtx();
  drawTransitSpark(noBase, [1, 2, 3], null, { width: 100, height: 20 });
  assert.equal(noBase.calls.filter((c) => c[0] === 'setLineDash').length, 0, 'bez priemeru bez čiary');
});

test('drôty: sekcia v paneli pred správami, karta v main.js, zvýraznenie z dejísk a scén úžin, CSS, i18n EN/SK', () => {
  const panel = readFileSync(new URL('./mideastPanel.js', import.meta.url), 'utf8');
  // Prechody stoja za čipmi a legendami vrstiev (ich počet tento drôt nezaujíma) a PRED správami.
  assert.match(panel, /mountTarget\.replaceChildren\(status, dirsTitle, dirs, [^;]*\.filter\(Boolean\), transitsTitle, transits, newsTitle, news, note\);/);
  assert.match(panel, /transitsMount: transits,/);
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /createPortwatchCard\(\{ mountTarget: mideastPanel\.transitsMount \}\)/);
  assert.match(main, /window\.__godsEyeView\.portwatchCard = portwatchCard;/);
  assert.match(main, /portwatchCard\?\.setActive\?\.\(portwatchKeyForTheatre\(scene\?\.id\)\)/);
  assert.match(main, /portwatchCard\?\.setActive\?\.\(PORTWATCH_KEYS\.includes\(scene\?\.id\) \? scene\.id : null\)/);
  assert.ok((main.match(/portwatchCard\?\.setActive\?\.\(null\)/g) || []).length >= 2, 'front aj všeobecný rám zvýraznenie zrušia');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const sel of ['.oko-pw-row.is-active', '.oko-pw-pct.is-down', '.oko-pw-pct.is-up', '.oko-pw-age.is-stale', '.oko-pw-status[hidden]']) assert.ok(css.includes(sel), sel);
  const keys = ['mideast.pw.title', 'mideast.pw.hormuz', 'mideast.pw.bab-el-mandeb', 'mideast.pw.suez', 'mideast.pw.cape', 'mideast.pw.avg7', 'mideast.pw.pct-tip', 'mideast.pw.last', 'mideast.pw.baseline.iran-war', 'mideast.pw.baseline.red-sea', 'mideast.pw.note', 'mideast.pw.since', 'mideast.pw.source', 'mideast.pw.loading', 'mideast.pw.missing', 'mideast.pw.error', 'mideast.pw.kept'];
  for (const k of keys) { assert.ok(EN_STRINGS[k], `EN ${k}`); assert.ok(SK_STRINGS[k], `SK ${k}`); }
  for (const k of PORTWATCH_KEYS) assert.ok(SK_STRINGS[`mideast.pw.${k}`], `každá úžina karty má SK meno: ${k}`);
  assert.match(SK_STRINGS['mideast.pw.note'], /odhady MMF z AIS/, 'poctivé: odhad, nie meranie');
  assert.match(SK_STRINGS['mideast.pw.note'], /odvodené/);
});
