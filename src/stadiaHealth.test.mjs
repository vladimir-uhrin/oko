// Strážca podkladu Stadia (2026-10-15): po odmietnutiach dlaždíc bezplatná náhrada, zapamätané na 6 h.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STADIA_BLOCK_MS, STADIA_FAIL_THRESHOLD, STADIA_FALLBACK_STACK, STADIA_STORAGE_KEY, createStadiaHealth, isStadiaUrl,
} from './stadiaHealth.js';
import { meteoBasemapForHost } from './layerBasemap.js';
import { basemapForHost } from './data/meteoLayer.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

test('odmietnutia 401/403/429 až po prahu; chyby siete a 404 sa nepočítajú', () => {
  let now = 1_000_000;
  const storage = memoryStorage();
  const h = createStadiaHealth({ storage, now: () => now });
  let fired = 0;
  h.onBlocked(() => { fired += 1; });
  assert.equal(h.noteTileError(undefined), false);
  assert.equal(h.noteTileError(404), false);
  for (let i = 1; i < STADIA_FAIL_THRESHOLD; i += 1) assert.equal(h.noteTileError(429), false);
  assert.equal(h.blocked(), false);
  assert.equal(h.noteTileError(401), true, 'prah dosiahnutý');
  assert.equal(h.blocked(), true);
  assert.equal(fired, 1);
  assert.equal(Number(storage.map.get(STADIA_STORAGE_KEY)), now + STADIA_BLOCK_MS, 'zapamätané v prehliadači');
  assert.equal(h.noteTileError(403), false, 'už je mimo — znova sa nehlási');
  now += STADIA_BLOCK_MS + 1;
  assert.equal(h.blocked(), false, 'po 6 h sa Stadia skúsi znova');
});

test('ďalšie načítanie stránky: zapamätaný stav rovno obíde Stadia, localhost nikdy', () => {
  const now = 5_000_000;
  const storage = memoryStorage();
  storage.setItem(STADIA_STORAGE_KEY, String(now + 60_000));
  const h = createStadiaHealth({ storage, now: () => now });
  assert.equal(h.blocked(), true);
  assert.equal(h.usableHost('okolive.sk'), false);
  assert.equal(h.usableHost('www.okolive.sk'), false);
  assert.equal(h.usableHost('localhost'), true, 'lokálny vývoj ide bez účtu');
  assert.equal(h.usableHost('example.com'), false, 'neautorizovaná doména nikdy');
  const broken = createStadiaHealth({ storage: { getItem: () => { throw new Error('zakázané'); } }, now: () => now });
  assert.equal(broken.blocked(), false, 'nedostupné úložisko nezhodí strážcu');
});

test('náhrada pre každý štýl Stadia a rozpoznanie dlaždice', () => {
  assert.equal(STADIA_FALLBACK_STACK['stadia-dark'], 'gibs-blue-marble');
  for (const id of ['stadia-smooth', 'stadia-outdoors', 'stadia-terrain']) assert.equal(STADIA_FALLBACK_STACK[id], 'osm');
  assert.equal(isStadiaUrl('https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}@2x.png'), true);
  assert.equal(isStadiaUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), false);
});

test('podklad pre meteo: obe funkcie sa zhodujú (Stadia na autorizovanej doméne, inde Blue Marble)', () => {
  for (const host of ['localhost', 'okolive.sk', 'www.okolive.sk', 'example.com', '']) {
    assert.equal(meteoBasemapForHost(host), basemapForHost(host), host);
  }
  assert.equal(meteoBasemapForHost('example.com'), 'gibs-blue-marble');
});
