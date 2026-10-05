// Zdravie karty lietadla z prehliadača (2026-10-05): čo sa pošle na /api/telemetry/hit po 45 s sledovania.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardHealthSample } from './siteTelemetry.js';

test('vzorka len pre dopravné lietadlo vo vzduchu; nesie iba áno/nie, žiadny volací znak ani polohu', () => {
  const full = { icao24: '471f05', callsign: 'WZZ6771', onGround: false, latitude: 45.1, longitude: 19.9, airline: 'Wizz Air', typeCode: 'A321',
    route: { origin: { code: 'LGW' }, destination: { code: 'LCA' } } };
  assert.deepEqual(cardHealthSample(full), { t: 'card', route: true, type: true, airline: true });
  assert.deepEqual(cardHealthSample({ icao24: '471f05', callsign: 'WZZ6771', route: null }), { t: 'card', route: false, type: false, airline: false },
    'výpadok adsbdb: karta bez trasy, typu aj dopravcu');
  assert.deepEqual(cardHealthSample({ ...full, route: { origin: { code: 'LGW' }, destination: null } }).route, false, 'polovičná trasa nie je trasa');
  assert.equal(cardHealthSample({ icao24: 'abc123', callsign: 'OMBYK' }), null, 'malé lietadlo bez čísla letu trasu nemá ani normálne');
  assert.equal(cardHealthSample({ ...full, onGround: true }), null);
  assert.equal(cardHealthSample(null), null);
  assert.ok(!JSON.stringify(cardHealthSample(full)).includes('WZZ'));
});
