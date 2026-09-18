import assert from 'node:assert/strict';
import test from 'node:test';

import { GULF_GAZETTEER, buildIncidents, classifyIncident, locateIncident } from './gulfIncidents.js';

test('classifyIncident recognizes strikes, fires, seizures, blockades — else null', () => {
  assert.equal(classifyIncident('Missile strikes tanker near Hormuz').type, 'strike');
  assert.equal(classifyIncident('Ship ablaze after blast in Gulf of Oman').type, 'fire');
  assert.equal(classifyIncident('Iran seized a commercial vessel').type, 'seizure');
  assert.equal(classifyIncident('Threat to close the Strait of Hormuz').type, 'blockade');
  assert.equal(classifyIncident('Oil prices rise on Gulf tensions'), null);
  assert.equal(classifyIncident(''), null);
  assert.equal(classifyIncident('Drone attack').severity, 'critical');
  assert.equal(classifyIncident('Vessel boarded and detained').severity, 'major');
});

test('locateIncident matches the first named place, specific before broad', () => {
  assert.equal(locateIncident('Blast reported near Fujairah port').name, 'Fujairah');
  assert.equal(locateIncident('Tanker struck off Bandar Abbas').name, 'Bandar Abbas');
  // "Persian Gulf" is broad; a specific port in the same text wins by order
  assert.equal(locateIncident('Incident in the Persian Gulf near Dubai').name, 'Dubai');
  assert.equal(locateIncident('generic headline with no place'), null);
});

test('buildIncidents geolocates classified items, dedupes and flags approximate', () => {
  const items = [
    { title: 'Missile strikes tanker near Fujairah', url: 'https://a/1', source: 'a', publishedAt: 100 },
    { title: 'Oil prices climb on Gulf worry', url: 'https://a/2', source: 'a' }, // not an incident → skipped
    { title: 'Ship seized in the Persian Gulf', url: 'https://a/3', source: 'b', publishedAt: 90 }, // located at Persian Gulf
    { title: 'Explosion reported at sea', url: 'https://a/4', source: 'c' }, // no place → region default, approx
    { title: 'dup', url: 'https://a/1' }, // dup url → skipped
  ];
  const inc = buildIncidents(items, { region: 'gulf' });
  assert.equal(inc.length, 3);
  assert.equal(inc[0].place, 'Fujairah');
  assert.equal(inc[0].approx, false);
  assert.equal(inc[0].type, 'strike');
  const atSea = inc.find((i) => i.url === 'https://a/4');
  assert.equal(atSea.approx, true); // fell back to the region default
  assert.equal(atSea.place, 'Strait of Hormuz');
  assert.ok(inc.every((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon)));
});

test('every gazetteer entry has finite coordinates and lowercase aliases', () => {
  for (const p of GULF_GAZETTEER) {
    assert.ok(Number.isFinite(p.lat) && Math.abs(p.lat) <= 90, p.name);
    assert.ok(Number.isFinite(p.lon) && Math.abs(p.lon) <= 180, p.name);
    assert.ok(p.aliases.length && p.aliases.every((a) => a === a.toLowerCase()), p.name);
  }
});
