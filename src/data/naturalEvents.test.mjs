// src/data/naturalEvents.test.mjs
// Prírodné udalosti NASA EONET (2026-09-05): normalizácia s trajektóriou a
// intenzitou, dve požiadavky (jadro vždy, požiare na čip), čipy kategórií,
// lifecycle ako pri vulkánoch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NATURAL_EVENTS_LAYER_ID,
  NATURAL_EVENT_CATEGORIES,
  NATURAL_EVENT_CORE_CATEGORIES,
  NATURAL_EVENT_DEFAULT_HIDDEN,
  createNaturalEventsLayer,
  magnitudeLabel,
  naturalEventChips,
  naturalEventIcon,
  naturalEventsFeedUrl,
  normalizeNaturalEvents,
} from './naturalEvents.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const storm = {
  id: 'EONET_23800', title: 'Hurricane Marie', closed: null, categories: [{ id: 'severeStorms' }],
  geometry: [
    { type: 'Point', coordinates: [-110, 15], date: '2026-09-03T00:00:00Z', magnitudeValue: 45, magnitudeUnit: 'kts' },
    { type: 'Point', coordinates: [-120.1, 21.6], date: '2026-09-05T12:00:00Z', magnitudeValue: 80, magnitudeUnit: 'kts' },
    { type: 'Point', coordinates: [-115, 18], date: '2026-09-04T06:00:00Z', magnitudeValue: 60, magnitudeUnit: 'kts' },
  ],
  sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/' }],
};
const fire = { id: 'EONET_9', title: 'Some Fire', closed: null, categories: [{ id: 'wildfires' }], geometry: [{ type: 'Point', coordinates: [-120, 40], date: '2026-09-05T00:00:00Z' }], sources: [] };
const reply = (events) => ({ ok: true, json: async () => ({ events }) });

function harness(fetchImpl) {
  let ds; let time = Date.parse('2026-09-05T00:00:00Z'); const publications = []; const calls = [];
  const layer = createNaturalEventsLayer({
    fetchImpl: (url, opts) => { calls.push(String(url)); return fetchImpl(url, opts); }, now: () => time,
    overlayHost: { setEntries: (id, entries) => publications.push({ id, entries }), setVisible() {}, clear() {} },
  });
  layer.init({ dataSources: { add: (s) => { ds = s; }, remove() {} } }); layer.enable();
  return { layer, publications, calls, get ds() { return ds; }, advance: () => { time += 600001; } };
}

test('EONET: normalizácia — posledný bod ako poloha, chronologická trajektória, intenzita, filtre', () => {
  const parsed = normalizeNaturalEvents({ events: [storm, { ...storm, id: 'closed', closed: '2026-09-04' }, { ...storm, id: 'volc', categories: [{ id: 'volcanoes' }] }, { ...storm, id: 'broken', geometry: [] }] });
  assert.equal(parsed.events.length, 1);
  const e = parsed.events[0];
  assert.equal(e.category, 'severeStorms');
  assert.deepEqual([e.lon, e.lat], [-120.1, 21.6], 'poloha = časovo posledný bod, nie posledný v poli');
  assert.deepEqual(e.track, [[-110, 15], [-115, 18], [-120.1, 21.6]], 'trajektória zoradená v čase');
  assert.deepEqual(e.magnitude, { value: 80, unit: 'kts' });
  assert.equal(magnitudeLabel(e.magnitude), '80 kts');
  assert.equal(magnitudeLabel(null), '');
  assert.equal(parsed.rejected, 1, 'záznam bez geometrie sa odmietne, vulkán a zavretá sa len preskočia');
  assert.throws(() => normalizeNaturalEvents({}));
  assert.equal(normalizeNaturalEvents({ events: [fire] }, ['severeStorms']).events.length, 0, 'allowed filter');
  assert.deepEqual(normalizeNaturalEvents({ events: [fire] }).events[0].track, [], 'jediný bod = žiadna trajektória');
});

test('EONET: dve požiadavky — jadro bez požiarov vždy, požiare až po zapnutí čipu', async () => {
  const h = harness(async (url) => reply(String(url).includes('wildfires') ? [fire] : [storm]));
  assert.equal(await h.layer.update(), true);
  assert.equal(h.calls.length, 1, 'pri predvolene skrytých požiaroch len jadrová požiadavka');
  const core = new URL(h.calls[0]);
  assert.equal(core.searchParams.get('status'), 'open');
  assert.deepEqual(core.searchParams.get('category').split(','), [...NATURAL_EVENT_CORE_CATEGORIES]);
  assert.ok(!core.searchParams.get('category').includes('wildfires'));
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.ds.entities.values.filter((e) => String(e.id).startsWith('natural-track:')).length, 1, 'búrka má trajektóriu');
  assert.equal(h.ds.entities.values.filter((e) => String(e.id).startsWith('natural:')).length, 1);
  // Čip požiarov existuje aj pri nule, inak by ich nemal kto zapnúť.
  const chips = h.layer.getRowControls().chips;
  const fireChip = chips.find((c) => c.id === 'cat-wildfires');
  assert.ok(fireChip && fireChip.active === false);
  assert.deepEqual(fireChip.params.hiddenNaturalEventCategories, []);
  assert.equal(h.layer.setParams(fireChip.params), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(h.calls.some((u) => u.includes('category=wildfires')), 'zapnutie čipu vyžiada požiare');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getRowControls().chips.find((c) => c.id === 'cat-wildfires').label, `${EN_STRINGS['natural.category.wildfires']} 1`);
  // Späť skryť: entity zmiznú, dáta ostanú (žiadna ďalšia požiadavka).
  const before = h.calls.length;
  h.layer.setParams({ hiddenNaturalEventCategories: ['wildfires'] });
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.calls.length, before);
  assert.deepEqual(h.layer.getParams(), { hiddenNaturalEventCategories: ['wildfires'] });
  h.layer.destroy();
});

test('EONET: čipy — počty, skryté ostávajú viditeľné ako čip, prázdne nefiltrované sa nekreslia', () => {
  const t = (k, vars) => { let s = EN_STRINGS[k] || k; for (const [a, b] of Object.entries(vars || {})) s = s.replaceAll(`{${a}}`, String(b)); return s; };
  const records = [{ category: 'severeStorms' }, { category: 'severeStorms' }, { category: 'floods' }];
  const { chips } = naturalEventChips(records, new Set(['floods', 'wildfires']), t);
  assert.deepEqual(chips.map((c) => c.id), ['cat-severeStorms', 'cat-floods', 'cat-wildfires']);
  assert.equal(chips[0].label, 'Severe storms 2');
  assert.equal(chips[0].active, true);
  // Klik na AKTÍVNY čip búrok ich skryje: nová množina = doterajšie skryté + búrky.
  assert.deepEqual(chips[0].params.hiddenNaturalEventCategories, ['floods', 'wildfires', 'severeStorms']);
  assert.equal(chips[1].active, false);
  assert.deepEqual(chips[1].params.hiddenNaturalEventCategories, ['wildfires'], 'klik na skrytý čip ho odkryje');
  assert.match(chips[1].title, /Show/);
  assert.equal(chips[2].label, 'Wildfires', 'skryté požiare bez dát: len meno');
  assert.deepEqual([...NATURAL_EVENT_DEFAULT_HIDDEN], ['wildfires']);
  for (const c of NATURAL_EVENT_CATEGORIES) {
    assert.match(naturalEventIcon(c), /^data:image\/svg\+xml,/, c);
    assert.ok(EN_STRINGS[`natural.category.${c}`] && SK_STRINGS[`natural.category.${c}`], `i18n ${c}`);
  }
  assert.equal(naturalEventsFeedUrl(['floods', 'floods', 'nonsense']), 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=floods&limit=500');
});

test('EONET: výpadok drží staré dáta ako stale, obnova ich prepíše; disable zahodí neskoré výsledky', async () => {
  let fail = false; let calls = 0;
  const h = harness(async () => { calls++; if (fail) throw new Error('offline'); return reply([storm]); });
  assert.equal(await h.layer.update(), true);
  assert.equal(await h.layer.update(), true); assert.equal(calls, 1, 'v perióde bez ďalšej požiadavky');
  h.advance(); fail = true; assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().stale, true); assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getAnalystRecords()[0].stale, true);
  fail = false; h.advance(); assert.equal(await h.layer.update(), true); assert.equal(h.layer.getStats().error, null);
  assert.match(h.publications.at(-1).entries[0].title, /Hurricane Marie · 80 kts/, 'popis nesie intenzitu');
  h.layer.disable(); assert.equal(h.ds.show, false); assert.deepEqual(h.layer.getAnalystRecords(), []);
  let finish; const h2 = harness(() => new Promise((resolve) => { finish = resolve; }));
  const pending = h2.layer.update(); h2.layer.disable(); finish(reply([storm]));
  assert.equal(await pending, false); assert.equal(h2.layer.getStats().count, 0); h2.layer.destroy(); h.layer.destroy();
});

test('EONET: tripwire — registrácia, token stavu, skupina hrozieb, kredity, DATA_SOURCES, žiadne emoji', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /dataManager\.register\(naturalEventsLayer\)/);
  const state = readFileSync(new URL('./layerState.js', import.meta.url), 'utf8');
  assert.match(state, new RegExp(`id: '${NATURAL_EVENTS_LAYER_ID}', token: '[a-z]'`));
  const panel = readFileSync(new URL('./naturalHazardsPanel.js', import.meta.url), 'utf8');
  assert.match(panel, new RegExp(`'${NATURAL_EVENTS_LAYER_ID}'`));
  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /nasa-eonet-natural-events/);
  const sources = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(sources, /Natural events — NASA EONET/);
  const src = readFileSync(new URL('./naturalEvents.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}]/u, 'ikony sú SVG, nie emoji');
  assert.match(src, /icon: '⚠︎'/, 'textová prezentácia glyfu (VS15), nie emoji');
});
