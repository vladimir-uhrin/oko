// Satelit pred a po zemetrasení: mesto s najsilnejšími otrasmi, výrez, najmenej zamračená snímka, dopyt Process API;
// mapa otrasov na glóbuse (world file → súradnice, priehľadnosť slabých otrasov); magnitúda bez počítania.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogBody, clearestScene, processBody, satDay, satelliteBbox, satelliteTown } from './quakeSatellite.js';
import { mmiRoman, overlayAlpha, worldFileBbox } from './quakeMedia.js';
import { buildMotionSvg, motionEvents } from './frontDayMotion.js';
import { frontDayPlan } from './frontDayVideo.js';

const cities = [{ name: 'Tonosi', lat: 7.4, lon: -80.44, pop: 2257, mmi: 9.0 }, { name: 'Las Tablas', lat: 7.7667, lon: -80.2833, pop: 11358, mmi: 7.7 },
  { name: 'Chitre', lat: 7.9667, lon: -80.4333, pop: 46191, mmi: 7.2 }, { name: 'Panama', lat: 8.99, lon: -79.52, pop: 408168, mmi: 5.1, iscap: true }];

test('mesto pre satelit: najväčšie s intenzitou VII,5+ (Las Tablas), nie malá dedina ani hlavné mesto ďaleko', () => {
  assert.equal(satelliteTown(cities).name, 'Las Tablas');
  assert.equal(satelliteTown(cities.filter((c) => c.name !== 'Las Tablas')).name, 'Chitre', 'bez VII,5+ najsilnejšie od 5 000 obyvateľov');
  assert.equal(satelliteTown([]), null);
  const [w, s, e, n] = satelliteBbox({ lat: 7.7667, lon: -80.2833 });
  assert.ok(Math.abs((n - s) - 0.064) < 1e-9 && e - w > 0.064 && w < -80.2833 && e > -80.2833);
});

test('snímka: najmenej zamračená do 60 %, inak žiadna; dopyt na jeden deň scény', () => {
  const cat = { features: [{ properties: { datetime: '2026-10-08T16:01:00Z', 'eo:cloud_cover': 79 } }, { properties: { datetime: '2026-10-05T15:51:00Z', 'eo:cloud_cover': 22 } }] };
  assert.equal(clearestScene(cat).at, '2026-10-05T15:51:00Z');
  assert.equal(clearestScene({ features: [{ properties: { datetime: '2026-10-08T16:01:00Z', 'eo:cloud_cover': 79 } }] }), null);
  assert.equal(clearestScene({ features: [] }), null, 'po otrase ešte žiadna snímka → záber sa vynechá');
  const body = processBody([1, 2, 3, 4], '2026-10-05T15:51:00Z');
  assert.deepEqual(body.input.data[0].dataFilter.timeRange, { from: '2026-10-05T00:00:00Z', to: '2026-10-05T23:59:59Z' });
  assert.equal(body.input.data[0].type, 'sentinel-2-l2a');
  assert.equal(catalogBody([1, 2, 3, 4], 'a', 'b').datetime, 'a/b');
  assert.equal(satDay('2026-10-05T15:51:00Z'), '5. 10.');
});

test('mapa otrasov na glóbuse: world file USGS → súradnice; slabé otrasy priehľadné; intenzita rímsky', () => {
  const bbox = worldFileBbox('0.0107\n0.0\n0.0\n-0.0106\n-84.5333\n11.1833\n', 732, 684);
  assert.ok(Math.abs(bbox[0] - -84.53865) < 1e-6 && Math.abs(bbox[3] - 11.1886) < 1e-6, JSON.stringify(bbox));
  assert.ok(Math.abs(bbox[2] - (-84.53865 + 0.0107 * 732)) < 1e-6 && Math.abs(bbox[1] - (11.1886 - 0.0106 * 684)) < 1e-6);
  assert.equal(worldFileBbox('nič', 1, 1), null);
  assert.equal(overlayAlpha(255, 255, 255), 0, 'I biela');
  assert.equal(overlayAlpha(172, 216, 233), 0, 'II–III svetlomodrá');
  assert.ok(overlayAlpha(247, 16, 12) > 100, 'IX červená ostane');
  assert.equal(mmiRoman(9.14), 'IX');
});

test('magnitúda 7,7 naskočí celá (nie „7,6" pri počítaní) s úderom; počet dotrasov sa počíta s pípnutím', () => {
  const model = { spots: { epi: { tag: 'ZEMETRASENIE', value: 7.7, decimals: 1, unit: 'MAGNITÚDA' }, after: { tag: 'DOTRASY', value: 39, unit: 'DOTRASOV' } } };
  const lines = [{ id: 'hook', shot: 'opening' }, { id: 'epi', shot: 'spot:epi' }, { id: 'after', shot: 'spot:after' }, { id: 'portal', shot: 'closing' }];
  const plan = frontDayPlan({ story: 'quake' }, lines, Object.fromEntries(lines.map((l) => [l.id, { lead: 0.1, speechEnd: 3 }])));
  const epi = plan.shots.find((s) => s.id === 'spot:epi');
  const svg = buildMotionSvg({ t: epi.start + 0.4, shots: plan.shots, lines, placement: plan.placement, cues: [], model, hook: null, logoMarkup: '' });
  assert.ok(svg.includes('>7,7<'), 'celé číslo hneď');
  const ev = motionEvents(plan.shots, plan.placement, model.spots);
  const at = (id) => plan.placement.find((p) => p.id === id).start + 0.1;
  assert.ok(ev.some((e) => e.kind === 'impact' && Math.abs(e.t - at('epi')) < 1e-9));
  assert.ok(ev.some((e) => e.kind === 'pop' && Math.abs(e.t - at('after')) < 1e-9));
});
