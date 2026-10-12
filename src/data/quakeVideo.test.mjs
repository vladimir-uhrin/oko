// Video o zemetrasení (Panama M 7,7, 9. 10. 2026): háčik s magnitúdou a krajinou, hĺbka, ľudia v silných
// otrasoch (odhad USGS, označený), dotrasy, následky len zo správ (inak odhad PAGER ako model), záver okolive.sk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aftershocksOf, magnitudeWords, quakeCountry, quakeOf, quakeScenario, roundedDown, strongShakingPeople } from './quakeVideo.js';
import { shotStat } from './frontDayMotion.js';

const feature = (id, mag, t, lon, lat, depth = 10, place = 'near X, Panama') => ({ id, properties: { mag, time: Date.parse(t), place, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, alert: null, tsunami: 0 }, geometry: { coordinates: [lon, lat, depth] } });
const main = quakeOf(feature('us6000u18k', 7.7, '2026-10-09T17:56:06Z', -80.769, 7.5868, 12.647, '12 km WSW of Pitaloza Arriba, Panama'));
const exposures = { population_exposure: { mmi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], aggregated_exposure: [0, 0, 794680, 3748470, 3031808, 1158758, 453543, 179658, 14159, 0] } };
const cities = [{ name: 'Santiago', lat: 8.1, lon: -80.98, pop: 45955, mmi: 7.5 }, { name: 'Chitre', lat: 7.97, lon: -80.43, pop: 46191, mmi: 7.2 }, { name: 'Tonosi', lat: 7.4, lon: -80.44, pop: 2257, mmi: 9 }];

test('magnitúda slovom aj číslom, krajina v páde, odhad zaokrúhlený nadol', () => {
  assert.deepEqual(magnitudeWords(7.7), { caption: '7,7', spoken: 'sedem celá sedem' });
  assert.equal(magnitudeWords(6).spoken, 'šesť');
  assert.deepEqual(quakeCountry('12 km WSW of Pitaloza Arriba, Panama'), { nom: 'Panama', acc: 'Panamu', loc: 'v Paname' });
  assert.equal(quakeCountry('Mid-Atlantic Ridge'), null);
  assert.equal(strongShakingPeople(exposures), 647360);
  assert.equal(roundedDown(647360), 640000);
  assert.equal(roundedDown(1_234_567), 1_200_000);
});

test('dotrasy: po hlavnom otrase, blízko, od M 4,5; vzdialené a skoršie nie', () => {
  const feed = [
    feature('a1', 6.6, '2026-10-09T20:25:39Z', -81.4687, 7.7176),
    feature('a2', 4.6, '2026-10-10T01:35:47Z', -81.32, 7.63),
    feature('a3', 4.4, '2026-10-10T02:00:00Z', -80.7, 7.6),
    feature('far', 5.5, '2026-10-10T02:00:00Z', -75.6, 5.27, 115, 'Filadelfia, Colombia'),
    feature('before', 5.0, '2026-10-09T10:00:00Z', -80.7, 7.6),
    feature('us6000u18k', 7.7, '2026-10-09T17:56:06Z', -80.769, 7.5868),
  ];
  assert.deepEqual(aftershocksOf(main, feed).map((q) => q.id), ['a1', 'a2']);
});

test('scenár: háčik, ohnisko s magnitúdou 7,7, silné otrasy, dotrasy, následky zo správ, záver; mapa reliéfu', () => {
  const aftershocks = [6.6, 6.0, 5.8, 5.5].map((m, i) => quakeOf(feature(`a${i}`, m, '2026-10-09T20:00:00Z', -80.6 - i * 0.2, 7.6)));
  const facts = { spoken: 'Podľa médií zatiaľ nikto nezahynul. Hlásia zranených a poškodené budovy.', title: 'BEZ OBETÍ', rows: ['zranení a poškodené budovy'],
    sources: [{ name: 'France 24' }, { name: 'AP (Yahoo News)' }] };
  const s = quakeScenario({ main, aftershocks, pager: { exposures, cities, economicLevel: 'red' }, facts });
  assert.equal(s.map, 'aster-relief');
  assert.equal(s.story, 'quake');
  assert.deepEqual(s.lines.map((l) => l.id), ['hook', 'epi', 'shake', 'after', 'impact', 'portal']);
  assert.equal(s.lines[0].caption, 'Zemetrasenie s magnitúdou 7,7 zasiahlo Panamu.');
  assert.equal(s.lines[0].spoken, 'Zemetrasenie s magnitúdou sedem celá sedem zasiahlo Panamu.');
  assert.deepEqual(s.hook.lines, ['MAGNITÚDA 7,7', 'PANAMA']);
  assert.equal(s.lines.find((l) => l.id === 'epi').caption, 'Ohnisko bolo len 13 kilometrov pod povrchom.');
  assert.equal(s.lines.find((l) => l.id === 'shake').caption, 'Silné otrasy podľa odhadu USGS zasiahli vyše 640 000 ľudí.');
  assert.equal(s.lines.find((l) => l.id === 'after').caption, 'Nasledovali 4 silnejšie dotrasy, najsilnejší mal magnitúdu 6,6.');
  assert.ok(s.post.includes('France 24, AP (Yahoo News)') && s.post.includes('ide o model, nie o hlásenie úradov'));
  assert.ok(s.post.includes('https://earthquake.usgs.gov/earthquakes/eventpage/us6000u18k'));
  assert.ok(s.model.sources.some((x) => /USGS/.test(x)) && s.model.sources.some((x) => /ASTER/.test(x)));
  for (const id of ['opening', 'epi', 'shake', 'after', 'impact', 'closing']) assert.ok(Number.isFinite(s.cameras[id]?.heightM), `kamera ${id}`);
  assert.ok(s.model.pins.some((p) => p.label.startsWith('EPICENTRUM')) && s.model.pins.some((p) => p.label === 'M 6,6'));
});

test('bez overených správ sa o obetiach nehovorí; červený PAGER ako odhad modelu', () => {
  const s = quakeScenario({ main, aftershocks: [], pager: { exposures, cities, economicLevel: 'red' } });
  const impact = s.lines.find((l) => l.id === 'impact');
  assert.equal(impact.caption, 'USGS podľa modelu odhaduje rozsiahle škody.');
  assert.ok(!s.lines.some((l) => /zahynul|obet|mŕtv/.test(l.caption)), 'žiadne obete bez správ');
  assert.ok(!s.lines.some((l) => l.id === 'after'), 'bez dotrasov bez vety');
  assert.equal(s.model.spots.impact.rows[0], 'model, nie hlásenie úradov');
  const calm = quakeScenario({ main, pager: null });
  assert.deepEqual(calm.lines.map((l) => l.id), ['hook', 'epi', 'portal']);
});

test('veľké číslo záberu: magnitúda s desatinnou čiarkou, počet dotrasov celé číslo', () => {
  const s = quakeScenario({ main, aftershocks: [6.6, 6.0, 5.8].map((m, i) => quakeOf(feature(`a${i}`, m, '2026-10-09T20:00:00Z', -80.6, 7.6))), pager: { exposures, cities } });
  const epi = shotStat(s.model, 'epi', { kind: 'spot', sceneId: 'epi' });
  assert.deepEqual([epi.value, epi.decimals, epi.unit], [7.7, 1, 'MAGNITÚDA']);
  const after = shotStat(s.model, 'after', { kind: 'spot', sceneId: 'after' });
  assert.deepEqual([after.value, after.decimals, after.unit], [3, 0, 'DOTRASY']);
});

test('mapa otrasov na glóbuse namiesto obrázka (záber spot s legendou MMI); satelit pred/po s kreditom Copernicus', () => {
  const withMmi = { ...main, mmi: 9.14 };
  const media = { overlay: { file: 'vrstva.png', bbox: [-84.5, 3.9, -76.7, 11.2] }, shakemap: { file: 'shakemap.jpg' },
    satellite: { files: ['pred.jpg', 'po.jpg'], town: 'Las Tablas', year: 2026 } };
  const s = quakeScenario({ main: withMmi, pager: { exposures, cities }, media });
  const line = s.lines.find((l) => l.id === 'shakemap');
  assert.equal(line.shot, 'spot:shakemap', 'na glóbuse, nie plochý obrázok');
  assert.deepEqual(s.overlay, { ...media.overlay, shots: ['shakemap'] }, 'vrstva len v zábere mapy otrasov');
  assert.equal(s.model.spots.shakemap.title, 'INTENZITA AŽ IX');
  assert.ok(s.model.spots.shakemap.legend.length >= 5);
  assert.ok(Number.isFinite(s.cameras.shakemap.heightM));
  const sat = s.lines.find((l) => l.id === 'satellite');
  assert.equal(sat.caption, 'Satelit Sentinel-2 ukazuje mesto Las Tablas pred zemetrasením a po ňom.');
  const clip = s.media[Number(sat.shot.slice(5))];
  assert.deepEqual(clip.files, ['pred.jpg', 'po.jpg']);
  assert.ok(s.model.sources.some((x) => /Copernicus Sentinel \(2026\)/.test(x)) && s.post.includes('Copernicus Sentinel (2026)'));
  const noOverlay = quakeScenario({ main: withMmi, pager: { exposures, cities }, media: { shakemap: { file: 'shakemap.jpg' } } });
  assert.match(noOverlay.lines.find((l) => l.id === 'shakemap').shot, /^clip:/, 'bez vrstvy obrázok ShakeMap');
  assert.ok(!noOverlay.lines.some((l) => l.id === 'satellite'), 'bez snímky po otrase bez satelitu');
});
