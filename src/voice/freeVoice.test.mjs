// Bezplatný hlas (2026-10-05): rozklad vety na zámer a vykonanie cez tie isté akcie ako platený hlas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceIntent, layerFromWords } from './freeVoiceIntents.js';
import { createFreeVoice, describeTrackedForSpeech, queryVariants } from './freeVoice.js';

test('vety → zámery: miesto s diakritikou, vrstvy, sledovanie, kamera, rádio, kokpit, front, mapa', () => {
  const cases = [
    ['Choď do Košíc', { type: 'go', query: 'Košíc' }],
    ['ukáž mi Bratislavu, prosím', { type: 'go', query: 'Bratislavu' }],
    ['Zapni lode', { type: 'layer', on: true, layerId: 'ais-live-vessels', name: 'lode' }],
    ['vypni lietadlá', { type: 'layer', on: false, layerId: 'flights', name: 'lietadla' }],
    ['ukáž vojenské lietadlá', { type: 'layer', on: true, layerId: 'military', name: 'vojenske lietadla' }],
    ['Sleduj Ruslana', { type: 'track', query: 'Ruslana' }],
    ['sleduj lietadlo ADB3017', { type: 'track', query: 'ADB3017' }],
    ['priblíž trochu', { type: 'zoom', direction: 'in', amount: 'little' }],
    ['Oddiaľ veľa', { type: 'zoom', direction: 'out', amount: 'lot' }],
    ['celý svet', { type: 'globe' }],
    ['prestaň sledovať', { type: 'stop-tracking' }],
    ['čo je to?', { type: 'describe' }],
    ['pusti rádio', { type: 'radio', action: 'play' }],
    ['vypni rádio', { type: 'radio', action: 'stop' }],
    ['hlasitosť 30', { type: 'radio', action: 'volume', volumePct: 30 }],
    ['opusti kokpit', { type: 'cockpit', action: 'exit' }],
    ['Pokrovský smer', { type: 'front', name: 'pokrovsky' }],
    ['obyčajná mapa', { type: 'command', id: 'view:osm' }],
    ['stop', { type: 'stop-voice' }],
    ['Hormuz', { type: 'go', query: 'Hormuz' }],
    ['nájdi UR-82072', { type: 'go', query: 'UR-82072' }],
  ];
  for (const [heard, intent] of cases) assert.deepEqual(parseVoiceIntent(heard), intent, heard);
  assert.equal(parseVoiceIntent('   '), null);
  assert.equal(layerFromWords('požiare'), 'local-firms');
  assert.equal(layerFromWords('Bratislava'), null);
});

test('skloňovanie: „Ruslana" skúsi aj „Ruslan"; čísla sa nemenia', () => {
  assert.deepEqual(queryVariants('Ruslana'), ['Ruslana', 'Ruslan']);
  assert.deepEqual(queryVariants('ADB3017'), ['ADB3017']);
  assert.deepEqual(queryVariants(''), []);
});

test('popis sledovaného lietadla na prečítanie', () => {
  const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
  assert.equal(describeTrackedForSpeech(null, t), 'voice.free.nothing-tracked');
  assert.equal(describeTrackedForSpeech({ callsign: 'ADB3017', typeName: 'An-124', altitudeM: 9144, route: { origin: { city: 'Baku' }, destination: { city: 'Bratislava' } } }, t),
    'ADB3017, An-124, voice.free.altitude:{"m":9100}, voice.free.route:{"from":"Baku","to":"Bratislava"}');
});

function fakeUi() {
  const node = () => ({ textContent: '', title: '', dataset: {}, hidden: false, classList: { remove() {} } });
  return { root: node(), status: node(), detail: node(), errorDetail: node(), costValue: node(), tierButton: node(), helpDetail: node() };
}
function setup({ resolvers = {} } = {}) {
  const calls = []; const enabled = new Map(); const spoken = [];
  const ui = fakeUi();
  const v = createFreeVoice({
    ui, translate: (k, p) => (p ? `${k}:${Object.values(p).join('|')}` : k),
    run: async (name, args) => { calls.push([name, args]); return { ok: true }; },
    dataManager: { setEnabled: (id, on) => enabled.set(id, on) },
    SpeechRecognitionImpl: null,
    synth: { cancel() {}, getVoices: () => [], speak: (u) => { spoken.push(u.text); } },
    Utterance: function Utterance(text) { this.text = text; },
  });
  v.setResolvers(resolvers);
  return { v, ui, calls, enabled, spoken };
}

test('vykonanie: vrstva, kamera, sledovanie (aj po skloňovaní), scéna z palety, miesto, nerozumel', async () => {
  const ran = [];
  const geocoded = [];
  const { v, calls, enabled, spoken, ui } = setup({ resolvers: {
    commands: () => [{ id: 'layer:ais-live-vessels', label: 'Živé plavidlá AIS', run() {} }, { id: 'scene:hormuz', label: 'Hormuzský prieliv', run: () => ran.push('hormuz') }],
    aircraft: (q) => (q === 'Ruslan' ? [{ id: 'ac:508035', label: 'ADB3017 · Antonov An-124 Ruslan', run: () => ran.push('ruslan') }] : []),
    aircraftWorld: async () => [],
    geocode: async (q) => { geocoded.push(q); return q !== 'Xyzzy'; },
  } });
  assert.equal(await v.handleText('zapni lode'), 'voice.free.layer-on:Živé plavidlá AIS');
  assert.equal(enabled.get('ais-live-vessels'), true);
  assert.equal(ui.root.dataset.status, 'idle');
  await v.handleText('priblíž');
  assert.deepEqual(calls.at(-1), ['adjust_camera_zoom', { direction: 'in', amount: 'medium' }]);
  assert.equal(await v.handleText('sleduj Ruslana'), 'voice.free.tracking:ADB3017 · Antonov An-124 Ruslan');
  assert.equal(await v.handleText('Hormuz'), 'voice.free.done:Hormuzský prieliv');
  assert.equal(await v.handleText('choď do Košíc'), 'voice.free.flying:Košíc');
  assert.deepEqual(geocoded, ['Košíc']);
  assert.equal(await v.handleText('choď na Xyzzy'), 'voice.free.not-found:Xyzzy');
  assert.deepEqual(ran, ['ruslan', 'hormuz']);
  assert.equal(spoken.at(-1), 'voice.free.not-found:Xyzzy', 'odpoveď zaznie nahlas');
  // Neznámy objekt na sledovanie → akcia track_entity (lode, satelity), ako platený hlas.
  await v.handleText('sleduj ISS');
  assert.deepEqual(calls.at(-1), ['track_entity', { query: 'ISS' }]);
});

test('bez Web Speech API: jasná chyba, nič sa nespustí; pilulka ukazuje ZADARMO bez voľby modelu', () => {
  const { v, ui } = setup();
  v.applyUi();
  assert.equal(ui.costValue.textContent, 'voice.free.cost');
  assert.equal(ui.tierButton.hidden, true);
  v.toggle();
  assert.equal(v.isActive(), false);
  assert.equal(ui.root.dataset.status, 'error');
  assert.equal(ui.detail.textContent, 'voice.free.unsupported');
});

test('rozpoznávanie: klik počúva a reštartuje po pauze, medzerník je vysielačka, zakázaný mikrofón = chyba, 90 s ticha vypne', async () => {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); this.started = 0; this.aborted = 0; this.stopped = 0; }
    start() { this.started++; } abort() { this.aborted++; } stop() { this.stopped++; }
  }
  const timers = [];
  let clock = 0;
  const ui = fakeUi();
  const heard = [];
  const v = createFreeVoice({ ui, translate: k => k, run: async (name, args) => { heard.push([name, args]); return { ok: true }; },
    SpeechRecognitionImpl: FakeRecognition, synth: null, Utterance: null, lang: () => 'sk-SK',
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, now: () => clock });
  v.toggle();
  assert.equal(v.isActive(), true);
  assert.equal(instances[0].continuous, true);
  assert.equal(instances[0].lang, 'sk-SK');
  assert.equal(ui.root.dataset.status, 'listening');
  // Konečný výsledok sa vykoná.
  instances[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'priblíž' }], { isFinal: true })] });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(heard[0], ['adjust_camera_zoom', { direction: 'in', amount: 'medium' }]);
  // Prehliadač ukončí rozpoznávanie po pauze → reštart.
  instances[0].onend();
  timers.find(t => t.ms === 250).fn();
  assert.equal(instances.length, 2);
  // 90 s ticha → mikrofón sa vypne sám.
  clock = 91_000;
  timers.find(t => t.ms === 5000).fn();
  assert.equal(v.isActive(), false);
  assert.equal(ui.detail.textContent, 'voice.free.idle-off');
  // Medzerník: počúva len kým je dole.
  v.pushStart();
  const pushRec = instances.at(-1);
  assert.equal(pushRec.continuous, false);
  v.pushEnd();
  assert.equal(pushRec.stopped, 1);
  assert.equal(v.isActive(), false);
  // Zakázaný mikrofón.
  v.toggle();
  instances.at(-1).onerror({ error: 'not-allowed' });
  assert.equal(v.isActive(), false);
  assert.equal(ui.detail.textContent, 'voice.free.mic-denied');
});
