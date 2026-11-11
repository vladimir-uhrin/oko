// Pás „Čo sa deje teraz" — DOM a správanie (2026-11-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NOW_ENDPOINTS, createNowStrip, quakeFilterRelax } from './nowStrip.js';
import { CARD_OBSTACLE_SELECTOR } from './ukraineEventsLayer.js';
import { SK_STRINGS, EN_STRINGS } from './i18nStrings.js';

const NOW = Date.parse('2026-11-11T21:00:00Z');
const H = 3_600_000;

function fakeDoc() {
  const listeners = {};
  let docRef = null;
  const make = (tag) => {
    const el = {
      get doc() { return docRef; }, scrollTop: 0,
      tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, listeners: {}, parent: null, hidden: false, className: '', focused: 0,
      _text: '',
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); if (v === '') { for (const c of this.children) c.parent = null; this.children = []; } },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
      contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; },
      focus() { this.focused += 1; if (el.doc) el.doc.activeElement = el; },
    };
    return el;
  };
  docRef = {
    body: make('body'), hidden: false,
    createElement: make,
    activeElement: null, capture: {},
    addEventListener(type, fn, cap) { (listeners[type] ||= []).push(fn); this.capture[type] = cap === true; },
    removeEventListener(type, fn, cap) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); this.capture[`${type}:removed`] = cap === true; },
    fire(type, event = {}) { for (const fn of listeners[type] || []) fn(event); },
    count: (type) => (listeners[type] || []).length,
  };
  return docRef;
}
const tr = (dict) => (key, vars) => { let s = dict[key] ?? key; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v)); return s; };
const find = (node, pred, out = []) => { if (pred(node)) out.push(node); for (const c of node.children || []) find(c, pred, out); return out; };
const FEEDS = {
  [NOW_ENDPOINTS.quakes]: { fetchedAt: NOW, records: [{ id: 'USGS:a', sourceId: 'a', mag: 6.4, time: NOW - 2 * H, lat: 10, lon: 20, place: 'Somewhere', status: 'reviewed', url: 'https://earthquake.usgs.gov/a', alert: null, tsunami: false }] },
  [NOW_ENDPOINTS.warnings]: { fetchedAt: new Date(NOW).toISOString(), warnings: [] },
  [NOW_ENDPOINTS.ukraine]: { ok: true, total: 125, reportedAt: new Date(NOW - 15 * H).toISOString(), reportedAtText: '08:00 11.11.', fetchedAt: NOW, url: 'https://armyinform.com.ua/x' },
};
const strip = (over = {}) => {
  const doc = fakeDoc();
  const ran = [];
  const s = createNowStrip({
    doc, win: { setInterval: () => 1, clearInterval: () => {} }, translate: tr(SK_STRINGS), lang: () => 'sk', now: () => NOW,
    fetchJson: async (url) => FEEDS[url],
    actions: { quake: (focus) => ran.push(['quake', focus.id]), ukraine: () => ran.push(['ukraine']) },
    ...over,
  });
  const root = doc.body.children[0];
  return { doc, s, ran, root, pill: root.children[0], list: root.children[1] };
};

test('bez udalostí ostáva pás skrytý — žiadna prázdna škatuľka; zlyhaný zdroj ostatné neblokuje', async () => {
  const empty = strip({ fetchJson: async () => null });
  assert.equal(empty.root.hidden, true);
  await empty.s.load();
  assert.equal(empty.root.hidden, true);
  const partial = strip({ fetchJson: async (url) => { if (url === NOW_ENDPOINTS.quakes) throw new Error('503'); return FEEDS[url]; } });
  await partial.s.load();
  assert.equal(partial.root.hidden, false);
  assert.deepEqual(partial.s.items().map((i) => i.kind), ['ukraine']);
});

test('pilulka: počet udalostí, sama sa nerozbalí, ťuknutie rozbalí a zbalí', async () => {
  const { s, pill, list, root } = strip();
  await s.load();
  assert.equal(root.hidden, false);
  assert.equal(pill.children[2].textContent, '2');
  assert.equal(list.hidden, true, 'po načítaní ostáva zbalená');
  assert.equal(pill.attrs['aria-expanded'], 'false');
  assert.equal(pill.attrs['aria-controls'], 'oko-now-list');
  pill.listeners.click();
  assert.equal(list.hidden, false);
  assert.equal(pill.attrs['aria-expanded'], 'true');
  pill.listeners.click();
  assert.equal(list.hidden, true);
});

test('riadok: tlačidlo udalosti a samostatný odkaz na zdroj; ťuknutie zbalí a spustí práve svoju akciu', async () => {
  const { s, pill, list, ran } = strip();
  await s.load();
  pill.listeners.click();
  const rows = find(list, (n) => n.className === 'oko-now-row');
  const links = find(list, (n) => n.className === 'oko-now-src');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tagName, 'BUTTON');
  assert.equal(find(rows[0], (n) => n.tagName === 'A').length, 0, 'odkaz nie je vnorený v tlačidle');
  assert.equal(links[0].href, 'https://earthquake.usgs.gov/a');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.equal(links[0].textContent, 'Zdroj: USGS');
  assert.equal(rows[0].children[0].textContent, 'Zemetrasenie M6,4 · Somewhere');
  rows[0].listeners.click();
  assert.equal(pill.focused, 1, 'fokus sa po voľbe vráti na pilulku, neostane na skrytom riadku');
  assert.deepEqual(ran, [['quake', 'USGS:a']]);
  assert.equal(list.hidden, true, 'po voľbe sa zbalí — nezakrýva miesto, na ktoré doletel');
});

test('Escape a klik mimo zbalia; Escape vráti fokus na pilulku a nepustí sa ďalej', async () => {
  const { s, doc, pill, list } = strip();
  await s.load();
  pill.listeners.click();
  let stopped = 0; let prevented = 0;
  const esc = () => ({ key: 'Escape', stopImmediatePropagation: () => { stopped += 1; }, preventDefault: () => { prevented += 1; } });
  doc.fire('keydown', esc());
  assert.equal(list.hidden, true);
  assert.equal(pill.focused, 1);
  assert.deepEqual([stopped, prevented], [1, 1], 'Escape patrí len pásu — nezruší sledovanie letu za ním');
  assert.equal(doc.capture.keydown, true, 'zachytávacia fáza: pred poslucháčmi Escape na dokumente');
  doc.fire('keydown', esc());
  assert.deepEqual([stopped, prevented], [1, 1], 'zbalený pás Escape neberie');
  pill.listeners.click();
  doc.fire('pointerdown', { target: { parent: null } });
  assert.equal(list.hidden, true);
});

test('chyba v akcii stránku nezhodí; destroy odpojí poslucháče a odstráni pás', async () => {
  const { s, doc, pill, list } = strip({ actions: { quake: () => { throw new Error('x'); } } });
  await s.load();
  pill.listeners.click();
  assert.doesNotThrow(() => find(list, (n) => n.className === 'oko-now-row')[0].listeners.click());
  s.destroy();
  assert.equal(doc.body.children.length, 0);
  assert.equal(doc.count('keydown') + doc.count('pointerdown') + doc.count('visibilitychange'), 0);
});

test('obnova: na pozadí sa nesťahuje, po návrate na kartu áno', async () => {
  let calls = 0; let tick = null;
  const { s, doc } = strip({ fetchJson: async (url) => { calls += 1; return FEEDS[url]; }, win: { setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => {} } });
  s.start();
  await s.load();
  const afterStart = calls;
  doc.hidden = true;
  tick();
  await Promise.resolve();
  assert.equal(calls, afterStart, 'skrytá karta nič nesťahuje');
  doc.hidden = false;
  doc.fire('visibilitychange');
  await s.load();
  assert.ok(calls > afterStart);
});

test('zapojenie: karty na mape pás obchádzajú, štýl ho skrýva v režimoch bez rozhrania, preklady v oboch jazykoch', () => {
  const obstacles = CARD_OBSTACLE_SELECTOR.split(',').map((x) => x.trim());
  assert.ok(obstacles.includes('.oko-now-pill') && obstacles.includes('.oko-now-list'), 'prekážkou sú namaľované časti, nie širší obal');
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  for (const sel of ['#global-loading-status:not([hidden]) ~ #oko-now:not(:has(.oko-now-list:not([hidden])))', 'body:has(#account-menu:not([hidden])) #oko-now',
    'body.oko-mobile:not(.oko-reveal-off):has(.oko-strait-chip:not([hidden])) #oko-now', '.oko-now-chip.is-stale', 'body:has(#oko-welcome) #oko-now', 'body.cockpit-mode #oko-now', 'body.ui-clean-view #oko-now',
    'body.scene-playback-mode #oko-now', 'body.recording-mode #oko-now', 'body.embed-mode #oko-now', 'body.oko-karta-clean #oko-now', 'body:has(> #oko-video-hud) #oko-now',
    'body.oko-sheet-open #oko-now', 'body.oko-mobile.oko-karta-frame #oko-now']) {
    assert.ok(css.includes(sel), `chýba pravidlo skrytia: ${sel}`);
  }
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import\('\.\/nowStrip\.js'\)/, 'pás sa načíta lenivo po štarte');
  assert.match(main, /quakeFilterRelax\(earthquakesLayer\.getParams\?\.\(\) \|\| \{\}, focus\.mag\)/, 'otras z pásu uvoľní len to, čo by ho skrylo');
  assert.match(main, /dataManager\.setLayerParams\('earthquakes', next, \{ origin: 'user' \}\)/, 'cez správcu vrstiev, nie priamo');
  for (const key of Object.keys(SK_STRINGS).filter((k) => k.startsWith('now.'))) assert.ok(EN_STRINGS[key], `EN ${key}`);
  assert.ok(Object.keys(SK_STRINGS).filter((k) => k.startsWith('now.')).length >= 18);
});

// ── opravy z nezávislej kontroly 2026-11-11 ──
test('filtre zemetrasení: uvoľní sa len to, čo by otras skrylo', () => {
  assert.equal(quakeFilterRelax({ period: 'week', minMagnitude: 2.5, significant: false }, 5.1), null, 'týždeň a nižší prah nechá tak');
  assert.equal(quakeFilterRelax({ period: 'month', minMagnitude: 4.5, significant: false }, 6.2), null, 'mesiac stačí pre M ≥ 4,5');
  assert.deepEqual(quakeFilterRelax({ period: 'day', minMagnitude: 4.5, significant: false }, 3.2), { minMagnitude: 2.5 }, 'prah skočí na existujúci čip');
  assert.deepEqual(quakeFilterRelax({ period: 'month', minMagnitude: 4.5, significant: true }, 3.2), { period: 'week', minMagnitude: 2.5, significant: false });
  assert.deepEqual(quakeFilterRelax({ period: 'day', minMagnitude: 2.5, significant: true }, 5.1), { significant: false });
  assert.equal(quakeFilterRelax({}, NaN), null);
});

test('výpadok zdroja: posledná dobrá odpoveď ostáva ako ZASTARANÁ, otvorený zoznam nezmizne', async () => {
  let fail = false;
  const { s, pill, list, root } = strip({ fetchJson: async (url) => { if (fail) throw new Error('503'); return FEEDS[url]; } });
  await s.load();
  const ids = s.items().map((i) => i.id);
  pill.listeners.click();
  fail = true;
  await s.load();
  assert.deepEqual(s.items().map((i) => i.id), ids);
  assert.ok(s.items().every((i) => i.state === 'stale'));
  assert.equal(root.hidden, false);
  assert.equal(list.hidden, false, 'zoznam pod prstom ostáva otvorený');
  assert.equal(find(list, (n) => n.className === 'oko-now-chip is-stale').length, ids.length);
});

test('obnova bez zmeny riadky nevymieňa; pri zmene ostáva fokus na tom istom riadku', async () => {
  let feeds = FEEDS;
  const { s, doc, pill, list } = strip({ fetchJson: async (url) => feeds[url] });
  await s.load();
  pill.listeners.click();
  const before = find(list, (n) => n.className === 'oko-now-row');
  await s.load();
  assert.equal(find(list, (n) => n.className === 'oko-now-row')[0], before[0], 'rovnaké dáta = ten istý uzol');
  // fokus na druhom riadku (hlásenie GŠ), potom pribudne výstraha
  before[1].focus();
  feeds = { ...FEEDS, [NOW_ENDPOINTS.warnings]: { fetchedAt: new Date(NOW).toISOString(), warnings: [{ id: 'w', level: 4, type: 'wind', onset: new Date(NOW - H).toISOString(), expires: new Date(NOW + 5 * H).toISOString(), codes: ['101'] }] } };
  await s.load();
  const rows = find(list, (n) => n.className === 'oko-now-row');
  assert.equal(rows.length, 3);
  assert.equal(doc.activeElement.parent.dataset.nowKind, 'ukraine', 'fokus ostal na hlásení GŠ, hoci sa poradie zmenilo');
});
