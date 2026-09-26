import assert from 'node:assert/strict';
import test from 'node:test';

import { GULF_GAZETTEER, buildIncidentCards, buildIncidents, classifyIncident, cleanHeadline, gazetteerForRegion, isVideoUrl, locateIncident, regionDefaultFor } from './gulfIncidents.js';

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
    assert.ok(p.kind === undefined || ['area', 'sea', 'country'].includes(p.kind), `${p.name}: druh ${p.kind}`);
  }
  // mená miest sú jedinečné (karta sa zoskupuje podľa súradníc a nesie meno)
  const names = GULF_GAZETTEER.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  // žiadny alias nepatrí dvom miestam
  const aliases = GULF_GAZETTEER.flatMap((p) => p.aliases);
  assert.equal(new Set(aliases).size, aliases.length);
  // body dejísk BLÍZKEHO VÝCHODU ležia v regióne (10–40° s. š., 25–62° v. d.)
  for (const p of GULF_GAZETTEER) assert.ok(p.lat > 10 && p.lat < 40 && p.lon > 25 && p.lon < 62, p.name);
});

// BLÍZKY VÝCHOD etapa 3 (2026-09-26): kartička patrí miestu udalosti, nie útočníkovi.
test('locateIncident picks the place struck, not the actor (Middle East)', () => {
  const at = (t) => locateIncident(t)?.name ?? null;
  assert.equal(at('Israel strikes Iran nuclear sites'), 'Iran');
  assert.equal(at('Iran fires missiles at Israel'), 'Israel');
  assert.equal(at('Hezbollah fires rockets into northern Israel'), 'Israel');
  assert.equal(at('Israel strikes Houthi targets'), 'Yemen');
  assert.equal(at('Israeli strikes kill 12 across Lebanon'), 'Lebanon');
  assert.equal(at('Tehran says it struck Israeli bases'), 'Israel', 'mesto ako aktér ustúpi štátu v role cieľa');
  assert.equal(at('Tehran hit by Israeli strikes'), 'Tehran', 'trpný rod: „hit by" nie je aktér');
  assert.equal(at('Tanker seized by Iran in Gulf of Oman'), 'Gulf of Oman', '„by X" je pôvodca');
  assert.equal(at('Missile launched from Yemen towards Israel intercepted'), 'Israel', '„from X" je odkiaľ');
  assert.equal(at('Israel intercepts missile launched from Yemen'), 'Israel', 'zachytenie sa deje nad Izraelom');
  assert.equal(at('Israel strikes Hezbollah in Syria'), 'Syria', 'predložka miesta prebije predmet');
  assert.equal(at('Iran-backed militia attacks US base in Iraq'), 'Iraq');
  assert.equal(at('Israel strikes Iranian military base'), 'Iran', 'zasiahnutý objekt s demonymom je cieľ');
  assert.equal(at('US strikes Houthi missile launchers'), 'Yemen');
  assert.equal(at('Israeli drones strike Hezbollah positions'), 'Lebanon');
  // demonymum pred zbraňou hovorí, kto útočí — bez iného miesta radšej žiadna kartička
  assert.equal(at('Hezbollah fighters killed in Israeli strike'), null);
  assert.equal(at('Security update: Israeli artillery shelling of outskirts of Mayfadoun town, Israeli drone explodes on house'), null);
  // menované miesto má prednosť pred oblasťou, morom aj štátom
  assert.equal(at('Hamas says Israeli strike killed 3 in Khan Younis'), 'Khan Younis');
  assert.equal(at('Strike in Gaza kills 5 near Rafah'), 'Rafah');
  assert.equal(at('Israeli strikes kill 12 in southern Lebanon'), 'South Lebanon');
  assert.equal(at('Settlers attack village near Ramallah in the West Bank'), 'Ramallah');
  assert.equal(at("Iran’s Revolutionary Guards say they hit Israel’s Nevatim base"), 'Nevatim');
  assert.equal(at('Houthis claim attack on ship in Red Sea'), 'Red Sea');
});

test('locateIncident matches whole words and the longest name', () => {
  const at = (t) => locateIncident(t)?.name ?? null;
  assert.equal(at('Clashes in Hama as Hamas leaders meet'), 'Hama', '„Hamas" nie je Hama');
  assert.equal(at('Hamas leaders meet in Cairo'), null);
  assert.equal(at('Bin Laden documentary released'), null, '„Laden" nie je Aden');
  assert.equal(at('Ship attacked in the Gulf of Aden'), 'Gulf of Aden', '„aden" vnútri „gulf of aden" sa nepočíta');
  assert.equal(at('Mine found in the Gulf of Oman'), 'Gulf of Oman');
  assert.equal(at('Drone attack on Ain al-Asad air base'), 'Ain al-Asad');
});

test('broad places (countries, wide seas) come back approximate; a card says so', () => {
  assert.equal(locateIncident('US strike hits Iran facility').approx, true);
  assert.equal(locateIncident('Ship attacked in the Red Sea').approx, true);
  assert.equal(locateIncident('Tanker struck off Bandar Abbas').approx, undefined);
  assert.equal(locateIncident('Two tankers hit in Strait of Hormuz').approx, undefined, 'úžina je úzka — presná');
  const [inc] = buildIncidents([{ title: 'Israel strikes Iran nuclear sites', url: 'https://a/1', source: 'a' }], { region: 'iran' });
  assert.equal(inc.place, 'Iran');
  assert.equal(inc.approx, true);
});

test('Middle East theatres have no default point: no named place, no card', () => {
  for (const region of ['iran', 'lebanon', 'palestine', 'israel', 'redsea', 'syria', 'iraq']) {
    assert.equal(regionDefaultFor(region), null, region);
    assert.equal(gazetteerForRegion(region), GULF_GAZETTEER, region);
    assert.deepEqual(buildIncidents([{ title: 'Explosion reported overnight', url: 'https://a/1' }], { region }), [], region);
  }
  assert.equal(regionDefaultFor('gulf').name, 'Strait of Hormuz', 'ZÁLIV si predvolený bod drží');
});

test('classifyIncident: generic „blocked/closed" needs a route; a labour strike or a deal is no attack', () => {
  assert.equal(classifyIncident('CNN Blocked from Trump Trip on Saturday'), null);
  assert.equal(classifyIncident('Iranians report SIM cards blocked over political posts'), null);
  assert.equal(classifyIncident("India's three-day bank strike could impact residents in UAE"), null);
  assert.equal(classifyIncident('US and Iran strike deal on Hormuz'), null);
  assert.equal(classifyIncident('Netanyahu Says October 7 Attack On Israel Is Like 9/11 Happening 16 Times'), null, 'retrospektíva nie je dnešná udalosť');
  assert.equal(classifyIncident('Israel received repeated warnings before Oct. 7 Hamas attack'), null);
  assert.equal(classifyIncident('Drone attack on Eilat port on October 7th anniversary').type, 'strike', 'dnešný útok v deň výročia ostáva');
  assert.equal(classifyIncident('Egypt closes Rafah crossing').type, 'blockade');
  assert.equal(classifyIncident('Hormuz blockade continues').type, 'blockade');
  assert.equal(classifyIncident('Airspace closed over Iraq').type, 'blockade');
  assert.equal(classifyIncident('Drone strike on Sanaa').type, 'strike');
});
