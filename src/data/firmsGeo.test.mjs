// src/data/firmsGeo.test.mjs — geostacionárne detekcie FIRMS (2026-10-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseGeoDetections, mergeGeoIntoFires, geoSatelliteName, geoConfidence01, GEO_WINDOW_MS } from './firmsGeo.js';
import { normalizeConfidence, adaptFirmsRecords } from './firmsAdapt.js';
import { ageBucket, satelliteFullName } from './firmsLabels.js';
import { buildSelectedFireCard, buildFireCard } from './firmsHeatmap.js';

const NOW = Date.UTC(2026, 9, 6, 12, 0);
const rec = (o = {}) => ({ lat: 48.1, lon: 17.1, frp: 20, confidence: 57, brightness: 300, daynight: 'D', acqDate: '2026-10-06', acqTime: '1140', satellite: 'Met12', instrument: '', ...o });

test('mená družíc: GOES/Himawari/Meteosat z kódov, prípona FRP preč; spoľahlivosť 0..1 aj 0..100', () => {
  assert.equal(geoSatelliteName('G19FRP'), 'GOES-19');
  assert.equal(geoSatelliteName('Him9'), 'Himawari-9');
  assert.equal(geoSatelliteName('Met12'), 'Meteosat-12');
  assert.equal(satelliteFullName('N20'), 'NOAA-20');
  assert.equal(satelliteFullName('N'), 'Suomi NPP');
  assert.equal(satelliteFullName('Met12'), 'Meteosat-12');
  assert.equal(geoConfidence01(0.698), 0.698);
  assert.equal(geoConfidence01(57), 0.57);
  assert.equal(normalizeConfidence(0.698), 0.698, 'Meteosat-12 hlási zlomok');
  assert.equal(normalizeConfidence(57), 0.57);
});

test('zlúčenie: opakovania toho istého miesta = jedna detekcia (posledný čas, max FRP, počet); staré mimo okna', () => {
  const geo = collapseGeoDetections([
    rec({ acqTime: '1100', frp: 10 }), rec({ acqTime: '1110', frp: 40 }), rec({ acqTime: '1150', frp: 20, lat: 48.1004 }),
    rec({ lat: 47.0, lon: 16.0, acqTime: '0700' }), // 5 h — mimo 3 h okna
    rec({ lat: 50.0, lon: 20.0, acqTime: '1155' }),
  ], NOW);
  assert.equal(geo.length, 2);
  const a = geo.find((g) => g.lat > 48);
  assert.equal(a.repeats, 3); assert.equal(a.frp, 40); assert.equal(a.acqTime, '1150'); assert.equal(a.lat, 48.1004);
  assert.equal(a.geo, true);
  assert.ok(GEO_WINDOW_MS === 3 * 3600_000);
});

test('pripojenie: geo do 4 km od VIIRS je potvrdenie, ďalej samostatné ohnisko', () => {
  const viirs = [{ lat: 48.1, lon: 17.1, frp: 5, acqDate: '2026-10-06', acqTime: '0130', satellite: 'N20' }];
  const geo = collapseGeoDetections([rec({ lat: 48.11, lon: 17.11, acqTime: '1150' }), rec({ lat: 48.6, lon: 17.1, acqTime: '1150' })], NOW);
  const out = mergeGeoIntoFires(viirs, geo);
  assert.equal(out.attached, 1); assert.equal(out.standalone, 1); assert.equal(out.fires.length, 2);
  assert.equal(viirs[0].geoSat, 'Met12');
  assert.equal(viirs[0].geoSeenMs, Date.UTC(2026, 9, 6, 11, 50));
  const fires = adaptFirmsRecords(out.fires);
  assert.equal(fires[0].geoSeenMs, Date.UTC(2026, 9, 6, 11, 50));
  assert.equal(fires[1].geo, true);
});

test('karta: tretí riadok s menom družice a minútami, geo potvrdenie, pixel; vek → tlmenie', () => {
  const base = { index: 0, lat: 48.1, lon: 17.1, frp: 30, confidence: 0.9, brightness: 300, night: false, acqMs: NOW - 2 * 3600_000, sensor: 'VIIRS', satellite: 'N20', geo: false, geoSeenMs: NOW - 8 * 60_000, geoSat: 'Met12', repeats: 0, scanKm: 0.4, trackKm: 0.5, contextEntity: null, position: null };
  const card = buildSelectedFireCard(base, NOW);
  assert.equal(card.details[2], 'NOAA-20 2h ago · + Meteosat-12 8m ago · pixel 0.4×0.5 km');
  assert.match(buildFireCard({ fire: base, position: {} }, NOW).details[0], /geo <1h$/);
  const geoOnly = { ...base, sensor: '', satellite: 'Met12', geo: true, geoSeenMs: 0, geoSat: '', repeats: 7, scanKm: 0, trackKm: 0, acqMs: NOW - 12 * 60_000 };
  assert.equal(buildSelectedFireCard(geoOnly, NOW).details[2], 'Meteosat-12 12m ago · 7× in 3h · pixel ~2–4 km');
  assert.equal(ageBucket(NOW, NOW - 60_000), 'fresh');
  assert.equal(ageBucket(NOW, NOW - 5 * 3600_000), 'recent');
  assert.equal(ageBucket(NOW, NOW - 20 * 3600_000), 'old');
  assert.equal(ageBucket(NOW, 0), 'old');
});

test('okno geo detekcií sa počíta od najnovšej dostupnej detekcie (FIRMS mešká ~3,5 h), nie od „teraz“', () => {
  // Všetko 5–6 h staré voči NOW: od „teraz“ by neostalo nič, od najnovšej ostane posledná hodina… a 3 h.
  const geo = collapseGeoDetections([
    rec({ acqTime: '0600', lat: 40, lon: 10 }), rec({ acqTime: '0700', lat: 41, lon: 11 }),
    rec({ acqTime: '0330', lat: 42, lon: 12 }), // 3,5 h pred najnovšou → mimo
  ], NOW);
  assert.deepEqual(geo.map((g) => g.lat).sort(), [40, 41]);
  assert.deepEqual(collapseGeoDetections([], NOW), []);
});

test('ďalšie družice: MODIS (Aqua/Terra, spoľahlivosť 0..100), Landsat (bez FRP, M), senzor podľa kódu', async () => {
  const { parseFirmsCsv } = await import('./firmsCsv.js');
  const { sensorFromSatellite } = await import('./firmsAdapt.js');
  const modis = parseFirmsCsv('latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n43.5361,39.58831,330.1,1.1,1,2026-10-06,1656,Terra,MODIS,82,6.1NRT,290,77.47,D\n');
  assert.equal(modis[0].frp, 77.47); assert.equal(modis[0].satellite, 'Terra'); assert.equal(modis[0].brightness, 330.1);
  const landsat = parseFirmsCsv('latitude,longitude,path,row,scan,track,acq_date,acq_time,satellite,confidence,daynight\n40.722322,-73.206394,108,212,756,2664,2026-10-06,232,L9,M,D\n');
  assert.equal(landsat.length, 1, 'Landsat bez stĺpca frp sa načíta');
  assert.equal(landsat[0].frp, 0);
  const [f] = adaptFirmsRecords(landsat);
  assert.equal(f.sensor, 'OLI'); assert.equal(f.confidence, 0.6);
  assert.equal(adaptFirmsRecords(modis)[0].confidence, 0.82);
  assert.deepEqual(['N', 'N20', 'N21', 'Aqua', 'Terra', 'L8', 'L9', 'Met12', 'G19FRP', 'Him9', 'X'].map(sensorFromSatellite), ['VIIRS', 'VIIRS', 'VIIRS', 'MODIS', 'MODIS', 'OLI', 'OLI', 'GEO', 'GEO', 'GEO', '']);
  assert.equal(satelliteFullName('L9'), 'Landsat 9'); assert.equal(satelliteFullName('Terra'), 'Terra');
  // karta: MODIS Terra
  const card = buildSelectedFireCard({ ...adaptFirmsRecords(modis)[0], contextEntity: null, position: null }, Date.UTC(2026, 9, 6, 18, 0));
  assert.match(card.details[0], /MODIS TERRA/); assert.equal(card.details[2], 'Terra 64m ago · pixel 1.1×1.0 km');
});
