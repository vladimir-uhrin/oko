import assert from 'node:assert/strict';
import test from 'node:test';

import { GULF_GAZETTEER, buildIncidentCards, buildIncidents, classifyIncident, cleanHeadline, isVideoUrl, locateIncident } from './gulfIncidents.js';

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

test('cleanHeadline strips a trailing " - Outlet" but keeps a dashless title', () => {
  assert.equal(cleanHeadline('Iran strikes tanker in Strait of Hormuz - Reuters'), 'Iran strikes tanker in Strait of Hormuz');
  assert.equal(cleanHeadline('IRGC hits vessel — Al Jazeera'), 'IRGC hits vessel');
  assert.equal(cleanHeadline('No dash here'), 'No dash here');
  assert.equal(cleanHeadline(''), '');
});

test('buildIncidentCards makes ONE card per place, counting the stories there', () => {
  const items = [
    { title: 'Iran says it struck a tanker in the Strait of Hormuz - Reuters', url: 'https://a/1', source: 'Reuters', publishedAt: 300 },
    { title: 'Iran says it struck a tanker in the Strait of Hormuz - Anadolu', url: 'https://a/2', source: 'Anadolu', publishedAt: 310 },
    { title: 'Drone attack on a second tanker in the Strait of Hormuz — Al Jazeera', url: 'https://a/3', source: 'Al Jazeera', publishedAt: 320 },
    { title: 'Vessel seized off Fujairah - The Hindu', url: 'https://a/4', source: 'The Hindu', publishedAt: 200 },
    { title: 'Oil prices rise on Gulf risk - CNBC', url: 'https://a/5', source: 'CNBC', publishedAt: 400 }, // not an incident
  ];
  const cards = buildIncidentCards(items, { region: 'gulf' });
  assert.equal(cards.length, 2, 'strait (all Hormuz reports) + Fujairah — one card each');
  const strait = cards.find((c) => c.place === 'Strait of Hormuz');
  assert.equal(strait.title, 'Drone attack on a second tanker in the Strait of Hormuz', 'newest story at the place, outlet suffix stripped');
  assert.equal(strait.storyCount, 2, 'two distinct stories at the strait');
  assert.equal(strait.sourceCount, 3, 'three outlets at the strait');
  assert.equal(strait.severity, 'critical');
  // most-severe first: the strait strike (critical) outranks the Fujairah seizure (major)
  assert.equal(cards[0].place, 'Strait of Hormuz');
  assert.equal(cards[1].type, 'seizure');
  assert.equal(cards[1].place, 'Fujairah');
  assert.ok(cards.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon)));
});

test('isVideoUrl flags video hosts and /video//watch paths', () => {
  assert.equal(isVideoUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isVideoUrl('https://youtu.be/abc'), true);
  assert.equal(isVideoUrl('https://vimeo.com/12345'), true);
  assert.equal(isVideoUrl('https://www.aljazeera.com/video/newsfeed/2026/9/x'), true); // /video/ path
  assert.equal(isVideoUrl('https://www.reuters.com/world/story'), false);
  assert.equal(isVideoUrl('not a url'), false);
});

test('cards carry a preview image (from the item, or any item at the place) and a video flag', () => {
  const items = [
    { title: 'Missile strike near Fujairah', url: 'https://youtu.be/x1', source: 'a', publishedAt: 300, image: null },
    { title: 'Drone attack near Fujairah', url: 'https://b/2', source: 'b', publishedAt: 250, image: 'https://img/2.jpg' },
  ];
  const [card] = buildIncidentCards(items, { region: 'gulf' });
  assert.equal(card.place, 'Fujairah');
  assert.equal(card.isVideo, true, 'representative (newest) is a youtube link');
  assert.equal(card.image, 'https://img/2.jpg', 'borrows the image from the other report at the same place');
  // a bad image url is dropped by buildIncidents
  const [c2] = buildIncidentCards([{ title: 'Blast near Dubai', url: 'https://c/3', source: 'c', image: 'javascript:evil' }], { region: 'gulf' });
  assert.equal(c2.image, null);
});

test('buildIncidentCards caps the number of PLACES to the limit', () => {
  // distinct gazetteer places → distinct location cards
  const places = ['Fujairah', 'Bandar Abbas', 'Dubai', 'Kharg', 'Basra', 'Bushehr'];
  const items = places.map((p, i) => ({ title: `Missile strike near ${p}`, url: `https://a/${i}`, source: `s${i}`, publishedAt: i }));
  assert.equal(buildIncidentCards(items, { region: 'gulf' }).length, 6);
  assert.equal(buildIncidentCards(items, { region: 'gulf', limit: 4 }).length, 4);
  assert.deepEqual(buildIncidentCards([], { region: 'gulf' }), []);
});

test('the expanded gazetteer geolocates the wider conflict (specific place wins over country)', () => {
  assert.equal(locateIncident('Ship attacked near Bab el-Mandeb').name, 'Bab-el-Mandeb');
  assert.equal(locateIncident('Explosion at the Suez Canal').name, 'Suez');
  assert.equal(locateIncident('Houthi missile toward Eilat').name, 'Eilat'); // specific city before Yemen/Israel
  assert.equal(locateIncident('Israeli strike in Sanaa').name, "Sana'a"); // Sanaa (specific) before Israel/Yemen
  assert.equal(locateIncident('Houthis launch drone').name, 'Yemen'); // houthi → Yemen
  assert.equal(locateIncident('US strike hits Iran facility').name, 'Iran'); // country fallback, not the region default
});

test('every gazetteer entry has finite coordinates and lowercase aliases', () => {
  for (const p of GULF_GAZETTEER) {
    assert.ok(Number.isFinite(p.lat) && Math.abs(p.lat) <= 90, p.name);
    assert.ok(Number.isFinite(p.lon) && Math.abs(p.lon) <= 180, p.name);
    assert.ok(p.aliases.length && p.aliases.every((a) => a === a.toLowerCase()), p.name);
  }
});
