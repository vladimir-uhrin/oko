// src/data/portsData.test.mjs
// Čisté funkcie prístavného datasetu (World Port Index, NGA Pub 150):
// filter riadkov, tvar feature a text karty. Build skript aj vrstva
// konzumujú presne tieto funkcie.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PORTS_LAYER_ID,
  portFeatureFromRow,
  portImportance,
  portOverlayCopy,
  portRowAccepted,
} from './portsData.js';

const ROTTERDAM = {
  'World Port Index Number': '31140.0',
  'Main Port Name': 'Rotterdam',
  'UN/LOCODE': 'NL RTM',
  'Country Code': 'Netherlands',
  'Harbor Size': 'Large',
  'Harbor Type': 'River (Basins)',
  'Channel Depth (m)': '11.0',
  'Maximum Vessel Draft (m)': '12.5',
  Latitude: '51.95',
  Longitude: '4.13333',
};

test('filter: prístav potrebuje meno a platné súradnice, veľkosť sa neselektuje', () => {
  assert.equal(portRowAccepted(ROTTERDAM), true);
  assert.equal(portRowAccepted({ ...ROTTERDAM, 'Harbor Size': 'Very Small' }), true,
    'aj Very Small ostáva — dôležitosť rieši kohorta štítkov, nie filter');
  assert.equal(portRowAccepted({ ...ROTTERDAM, 'Main Port Name': ' ' }), false);
  assert.equal(portRowAccepted({ ...ROTTERDAM, Latitude: '' }), false);
  assert.equal(portRowAccepted({ ...ROTTERDAM, Latitude: '91' }), false);
  assert.equal(portRowAccepted({ ...ROTTERDAM, Longitude: '181' }), false);
  assert.equal(portRowAccepted({}), false);
});

test('feature: Rotterdam s LOCODE bez medzery, hĺbkami a WPI id', () => {
  const feature = portFeatureFromRow(ROTTERDAM);
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.id, 'wpi-31140');
  assert.deepEqual(feature.geometry, { type: 'Point', coordinates: [4.13333, 51.95] });
  assert.deepEqual(feature.properties, {
    name: 'Rotterdam',
    locode: 'NLRTM',
    country: 'Netherlands',
    size: 'Large',
    harborType: 'River (Basins)',
    chanDepthM: 11,
    maxDraftM: 12.5,
  });
});

test('feature: 0.0 je no-data sentinel hĺbok (WPI nemá nully), nie nulová hĺbka', () => {
  // Pasca z prieskumu: WPI kóduje "neuvedené" ako 0.0 vo VŠETKÝCH
  // hĺbkových/rozmerových stĺpcoch — surové čítanie by hlásilo
  // prístavy s nulovým ponorom.
  const bare = portFeatureFromRow({
    ...ROTTERDAM,
    'Channel Depth (m)': '0.0',
    'Maximum Vessel Draft (m)': '0',
    'UN/LOCODE': ' ',
    'Harbor Size': '',
  });
  assert.equal(bare.properties.chanDepthM, null);
  assert.equal(bare.properties.maxDraftM, null);
  assert.equal(bare.properties.locode, null);
  assert.equal(bare.properties.size, null);
});

test('feature: bez WPI čísla je id z mena a súradníc — stabilné a unikátne', () => {
  const feature = portFeatureFromRow({ ...ROTTERDAM, 'World Port Index Number': '' });
  assert.equal(feature.id, 'port-Rotterdam-51.95-4.13333');
});

test('karta: LOCODE/veľkosť/typ, potom hĺbky a krajina — prázdne časti odpadnú', () => {
  assert.deepEqual(portOverlayCopy({
    locode: 'NLRTM', size: 'Large', harborType: 'River (Basins)',
    chanDepthM: 11, maxDraftM: 12.5, country: 'Netherlands',
  }), [
    'NLRTM · LARGE · RIVER (BASINS)',
    'CH 11M · DRAFT 12.5M · Netherlands',
  ]);
  assert.deepEqual(portOverlayCopy({ size: 'Very Small', country: 'Chile' }), [
    'VERY SMALL',
    'Chile',
  ]);
  assert.deepEqual(portOverlayCopy({}), []);
});

test('dôležitosť: Large > Medium > Small > Very Small', () => {
  const l = portImportance({ size: 'Large' });
  const m = portImportance({ size: 'Medium' });
  const s = portImportance({ size: 'Small' });
  const v = portImportance({ size: 'Very Small' });
  assert.ok(l > m && m > s && s > v && v > 0);
  assert.equal(portImportance({}), 0);
});

test('layer id je stabilný', () => {
  assert.equal(PORTS_LAYER_ID, 'local-ports');
});
