// Zdieľať a História letu v rohu karty lietadla (2026-10-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { flightActionPlacements, flightCardHex } from './flightCardActions.js';
import { closeButtonPlacement } from './cardCloseButtons.js';

test('hex len z karty letu (civilný aj vojenský), satelit a nezmysel nie', () => {
  assert.equal(flightCardHex('flights:78115F'), '78115f');
  assert.equal(flightCardHex('military:ae1234'), 'ae1234');
  assert.equal(flightCardHex('satellites:25544'), null);
  assert.equal(flightCardHex('flights:xyz'), null);
  assert.equal(flightCardHex(null), null);
});

test('tlačidlá sedia vľavo od krížika v tej istej výške, neprekrývajú sa', () => {
  const rect = { x: 300, y: 440, w: 600, h: 220 };
  const close = closeButtonPlacement(rect);
  const [share, history] = flightActionPlacements(rect, 2, { w: 1200, h: 800 });
  assert.equal(share.y, close.y);
  assert.equal(history.y, close.y);
  assert.ok(share.x < close.x && close.x - share.x >= 26, 'zdieľať hneď vedľa krížika');
  assert.ok(history.x < share.x && share.x - history.x >= 26, 'história ďalej vľavo');
});

test('na úzkej karte neutečú z obrazovky doľava', () => {
  const spots = flightActionPlacements({ x: 0, y: 10, w: 40, h: 100 }, 2, { w: 360, h: 700 });
  for (const spot of spots) assert.ok(spot.x >= 6);
});
