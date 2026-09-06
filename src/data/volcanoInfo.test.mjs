// src/data/volcanoInfo.test.mjs
// Informácie pre kartu sopky (2026-09-05): rozbor názvu EONET, zhoda s OSM
// sidecarom (názov má prednosť, inak najbližšia do 8 km, inak nič), model karty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  VOLCANO_SOURCE_LABELS,
  buildVolcanoIndex,
  distanceKm,
  matchOsmVolcano,
  nameKey,
  parseEonetVolcanoTitle,
  volcanoCardModel,
  wikipediaUrlFromTag,
} from './volcanoInfo.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const tr = (strings) => (k, vars) => { let s = strings[k] || k; for (const [a, b] of Object.entries(vars || {})) s = s.replaceAll(`{${a}}`, String(b)); return s; };
const sk = tr(SK_STRINGS), en = tr(EN_STRINGS);

const OSM = [
  { id: 1, name: 'Etna', lat: 37.751, lon: 14.993, eleM: 3403, type: 'stratovolcano', status: 'active', wikipedia: 'it:Etna', description: 'Active composite stratovolcano.' },
  { id: 2, name: 'Crateri Silvestri inferiori', lat: 37.70, lon: 15.00, eleM: 1886, status: 'dormant' },
  { id: 3, name: 'Nevados de Chillán', localName: 'Nevados de Chillán', lat: -36.863, lon: -71.377, eleM: 3212, type: 'stratovolcano' },
  { id: 4, name: 'Somewhere Else', lat: 10, lon: 10, eleM: 100 },
];

test('sopky: názov EONET „Etna Volcano, Italy" → meno + krajina; kľúč názvu bez diakritiky a výplne', () => {
  assert.deepEqual(parseEonetVolcanoTitle('Etna Volcano, Italy'), { name: 'Etna', country: 'Italy' });
  assert.deepEqual(parseEonetVolcanoTitle('Nevados del Chillan Volcano, Chile'), { name: 'Nevados del Chillan', country: 'Chile' });
  assert.deepEqual(parseEonetVolcanoTitle('Kikai'), { name: 'Kikai', country: '' });
  assert.deepEqual(parseEonetVolcanoTitle(''), { name: '', country: '' });
  assert.equal(nameKey('Nevados del Chillán'), 'chillan');
  assert.equal(nameKey('Mount St. Helens Volcano'), 'st helens');
  assert.ok(distanceKm(37.751, 14.993, 37.70, 15.00) < 6);
});

test('sopky: zhoda s OSM — názov do 25 km má prednosť pred bližším cudzím uzlom, bez názvu len do 8 km, inak null', () => {
  const index = buildVolcanoIndex(OSM);
  assert.equal(index.size, 4);
  // EONET bod pri Etne je bližšie ku „Crateri Silvestri" (5 km) než k uzlu Etna? Nie — ale názov rozhodne aj tak.
  const etna = matchOsmVolcano(index, 37.72, 15.00, 'Etna Volcano, Italy');
  assert.equal(etna.volcano.name, 'Etna'); assert.equal(etna.byName, true);
  const chillan = matchOsmVolcano(index, -36.868, -71.378, 'Nevados del Chillan Volcano, Chile');
  assert.equal(chillan.volcano.id, 3, 'diakritika a „del/de" nevadia');
  const nearest = matchOsmVolcano(index, 37.72, 15.00, 'Unknown Peak Volcano, Italy');
  assert.equal(nearest.volcano.id, 2); assert.equal(nearest.byName, false);
  assert.equal(matchOsmVolcano(index, 37.95, 15.30, 'Unknown Volcano'), null, 'najbližší je ďalej než 8 km bez zhody názvu = nehádame');
  assert.equal(matchOsmVolcano(index, 0, 0, 'Etna'), null);
  assert.equal(matchOsmVolcano(null, 1, 1, 'x'), null);
  assert.equal(wikipediaUrlFromTag('it:Etna'), 'https://it.wikipedia.org/wiki/Etna');
  assert.equal(wikipediaUrlFromTag('en:Mount St. Helens'), 'https://en.wikipedia.org/wiki/Mount_St._Helens');
  assert.equal(wikipediaUrlFromTag('Etna'), null);
});

test('sopky: model karty — typ · výška · krajina, stav, aktivita s počtom hlásení, odkazy s čitateľnými menami', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const event = {
    id: 'EONET_1', title: 'Etna Volcano, Italy', lat: 37.751, lon: 14.993, description: '',
    time: now - 3 * 86_400_000, firstTime: now - 82 * 86_400_000, reports: 4,
    sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=211060' }, { id: 'EO', url: 'https://science.nasa.gov/x' }, { id: 'bad', url: 'ftp://x' }],
  };
  const match = matchOsmVolcano(buildVolcanoIndex(OSM), event.lat, event.lon, event.title);
  const m = volcanoCardModel(event, match, now, sk);
  assert.equal(m.title, 'Etna');
  assert.equal(m.factsLine, 'Stratovulkán · 3 403 m · Italy');
  assert.equal(m.statusLabel, 'Aktívna');
  assert.equal(m.activity, 'Hlásené od 15. 6. 2026 · posledné pred 3 d · 4 hlásení');
  assert.equal(m.description, 'Active composite stratovolcano.');
  assert.equal(m.matchNote, '', 'zhoda názvom = bez poznámky');
  assert.deepEqual(m.links.map((l) => l.label), ['Smithsonian GVP', 'NASA Earth Observatory', 'Wikipedia', 'NASA EONET']);
  assert.equal(m.links[0].href, 'https://volcano.si.edu/volcano.cfm?vn=211060');
  assert.equal(m.wikipediaUrl, 'https://it.wikipedia.org/wiki/Etna');
  assert.equal(m.coords, '37.751°, 14.993°');
  assert.equal(VOLCANO_SOURCE_LABELS.SIVolcano, 'Smithsonian GVP');

  const single = volcanoCardModel({ ...event, reports: 1, firstTime: event.time }, null, now, en);
  assert.equal(single.activity, 'Reported 2. 9. 2026 (3 d ago)');
  assert.equal(single.factsLine, 'Italy', 'bez OSM ostáva len krajina');
  assert.equal(single.matchNote, EN_STRINGS['volcano.no-osm']);
  assert.deepEqual(single.links.map((l) => l.key), ['SIVolcano', 'EO', 'eonet']);
  const nearest = volcanoCardModel(event, { volcano: OSM[1], km: 5.4, byName: false }, now, sk);
  assert.match(nearest.matchNote, /najbližšej zmapovanej sopky \(5 km\)/);
  assert.equal(volcanoCardModel(null, null, now, sk), null);
});

test('sopky: sidecar OSM existuje, má rozumnú veľkosť a nie je tam Smithsonian GVP (nekomerčná licencia)', () => {
  const file = new URL('./local_data/volcanoes/osm-volcanoes.json', import.meta.url);
  assert.ok(existsSync(file), 'sidecar chýba — node scripts/build-volcanoes.mjs');
  assert.ok(statSync(file).size < 900 * 1024, 'sidecar nad 900 kB by spomalil prvé otvorenie karty');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  assert.match(json.source, /OpenStreetMap/);
  assert.ok(json.volcanoes.length > 3000);
  const etna = json.volcanoes.find((v) => v.name === 'Etna' && Math.abs(v.lat - 37.75) < 0.1);
  assert.ok(etna && etna.eleM > 3000 && etna.wikipedia, 'Etna s výškou a Wikipédiou');
  // Prázdny tag `ele` sa NESMIE zapísať ako 0 (chyba prvého buildu: 4 991/4 991 malo výšku).
  const withEle = json.volcanoes.filter((v) => v.eleM !== undefined).length;
  assert.ok(withEle > 2000 && withEle < json.volcanoes.length, `výšku má ${withEle} z ${json.volcanoes.length}, nie všetky`);
  assert.ok(json.volcanoes.every((v) => v.eleM === undefined || Math.abs(v.eleM) < 9000));
  const readme = readFileSync(new URL('./local_data/volcanoes/README.md', import.meta.url), 'utf8');
  assert.match(readme, /ODbL/); assert.match(readme, /non-commercial/i);
  const sources = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(sources, /GVP data itself is not\s+bundled/);
  for (const k of ['volcano.section.activity', 'volcano.activity-since', 'volcano.status.active', 'volcano.type.stratovolcano', 'volcano.no-osm']) {
    assert.ok(EN_STRINGS[k] && SK_STRINGS[k], k);
  }
});
