// src/data/contactHoverCard.test.mjs
// Kartička pod kurzorom (2026-09-03: „keď som ďaleko zazoomovaný, mohli by sa
// po prejdení myšou objaviť základné informácie"). Skladanie riadkov je čistá
// funkcia — testuje sa bez prehliadača.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hoverCardLines } from './contactHoverCard.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const t = (key) => EN_STRINGS[key] || key;

const RICH = {
  layerId: 'flights',
  id: '4b1815',
  callsign: 'SWR123',
  registration: 'HB-JCA',
  type: 'A220-300',
  operator: 'Swiss',
  category: 'commercial',
  military: false,
  onGround: false,
  altitudeM: 11277.6, // 37 000 ft
  speedMps: 231.5, // 450 kt
  verticalRateMps: 0,
  route: 'ZRH → LHR',
  stale: false,
};

/** Chudobný kontakt: presne to, čo tečie pri oddialenom pohľade. */
const SPARSE = {
  layerId: 'flights',
  id: '494116',
  callsign: 'NJE693K',
  registration: null,
  type: null,
  operator: null,
  category: 'bizjet',
  military: false,
  onGround: false,
  altitudeM: 609.6, // 2 000 ft
  speedMps: 56.07, // 109 kt
  verticalRateMps: -2.93,
  route: null,
  stale: false,
};

test('bohatý kontakt: identita, stroj, dopravca, trasa aj let', () => {
  const card = hoverCardLines(RICH, t);
  assert.equal(card.title, 'SWR123');
  assert.deepEqual(card.lines, [
    'A220-300 · HB-JCA',
    'Swiss',
    'ZRH → LHR',
    'FL370 · 450 kts',
  ]);
  assert.equal(card.military, false);
});

test('chudobný kontakt (oddialený pohľad): kategória zaskočí za chýbajúci typ', () => {
  // Pri oddialení netečie typ, dopravca ani trasa — enrichment beží prednostne
  // pre stroje na obrazovke. Kartička nesmie zostať prázdna ani ukazovať „—":
  // triedu vieme vždy, tak povie aspoň, ČO to je.
  const card = hoverCardLines(SPARSE, t);
  assert.equal(card.title, 'NJE693K');
  assert.equal(card.lines[0], EN_STRINGS['aircraft.category.bizjet']);
  // Klesanie -2.93 m/s je za prahom → šípka dole.
  assert.match(card.lines[1], /FL020↓/);
  assert.match(card.lines[1], /109 kts/);
  assert.equal(card.lines.length, 2, 'žiadne prázdne riadky za chýbajúce polia');
});

test('šípka stúpania/klesania rešpektuje prah, hladina ju nemá', () => {
  const trend = (rate) => hoverCardLines({ ...SPARSE, verticalRateMps: rate }, t).lines[1];
  assert.match(trend(8), /FL\d+↑/, 'stúpa');
  assert.match(trend(-8), /FL\d+↓/, 'klesá');
  assert.doesNotMatch(trend(0), /[↑↓]/, 'v hladine bez šípky');
  assert.doesNotMatch(trend(1.2), /[↑↓]/, 'drobné kolísanie nie je stúpanie');
  assert.doesNotMatch(trend(null), /[↑↓]/, 'neznáma vertikálna rýchlosť nič netvrdí');
});

test('stroj na zemi a kontakt bez fixu to povedia', () => {
  const ground = hoverCardLines({ ...SPARSE, onGround: true }, t);
  assert.ok(ground.lines.some((l) => l.includes(EN_STRINGS['hover.on-ground'])));
  assert.ok(!ground.lines.some((l) => /FL\d/.test(l)), 'na zemi sa letová hladina nekreslí');
  const stale = hoverCardLines({ ...SPARSE, stale: true }, t);
  assert.equal(stale.lines.at(-1), EN_STRINGS['hover.stale'], 'odhad je priznaný');
});

test('identita: bez volacieho znaku nastúpi registrácia, potom hex', () => {
  assert.equal(hoverCardLines({ ...SPARSE, callsign: null, registration: 'OM-ABC' }, t).title, 'OM-ABC');
  assert.equal(hoverCardLines({ ...SPARSE, callsign: null, registration: null }, t).title, '494116');
  // Registrácia sa neopakuje, keď JE identitou.
  const card = hoverCardLines({ ...SPARSE, callsign: null, registration: 'OM-ABC', type: null }, t);
  assert.ok(!card.lines[0].includes('OM-ABC'), 'registrácia sa nezopakuje pod titulkom');
});

test('vojenský kontakt je označený, prázdny vstup nekreslí nič', () => {
  assert.equal(hoverCardLines({ ...SPARSE, military: true }, t).military, true);
  assert.equal(hoverCardLines(null, t), null);
  assert.equal(hoverCardLines({ ...SPARSE, callsign: null, registration: null, id: '' }, t), null);
});

test('preklady existujú v oboch jazykoch a kartička nechytá myš', () => {
  for (const key of ['hover.on-ground', 'hover.stale']) {
    assert.ok(EN_STRINGS[key], `EN chýba ${key}`);
    assert.ok(SK_STRINGS[key], `SK chýba ${key}`);
  }
  // pointer-events: none je nosné — kartička sedí POD kurzorom a inak by
  // pohltila práve ten MOUSE_MOVE, ktorý ju drží nažive.
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  const block = /\.contact-hover-card \{[\s\S]*?\}/.exec(css)?.[0] || '';
  assert.match(block, /pointer-events:\s*none/);
});

test('tripwire: kartička žije nezávisle od prepínača DETEKCIA', async () => {
  // Zmysel celej featury: pri oddialenom pohľade sa dá zistiť identita stroja
  // aj so zhasnutými zameriavačmi. Keby kartičku niekto zavesil za detekciu,
  // vrátilo by to pôvodný stav, na ktorý používateľ upozornil.
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /installContactHoverCard\(\{/, 'kartička sa inštaluje z ui.js');
  assert.match(ui, /onHover: \(candidates, position\) => updateContactHoverCard/,
    'kŕmi ju hover pick, nie stav detekcie');
  const hover = readFileSync(new URL('./detectionHover.js', import.meta.url), 'utf8');
  assert.match(hover, /onHover\?\.\(candidates, position\)/, 'jeden pick, dvaja konzumenti');
  assert.match(hover, /onHover\?\.\(\[\], null\)/, 'odchod myši z canvasu kartičku zhasne');
});
