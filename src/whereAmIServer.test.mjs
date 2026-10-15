// /api/whereami (2026-10-15): poloha návštevníka len z hlavičiek Cloudflare, nič sa neukladá ani nekešuje.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { whereAmIMiddleware, whereAmIPayload } from './whereAmIServer.js';

const req = (headers) => ({ headers });

test('mesto z hlavičiek Cloudflare (zaokrúhlené), inak hlavné mesto krajiny, inak nič', () => {
  const city = whereAmIPayload(req({ 'cf-ipcountry': 'SK', 'cf-ipcity': 'Bratislava', 'cf-iplatitude': '48.1486', 'cf-iplongitude': '17.1077' }));
  assert.equal(city.precision, 'city');
  assert.equal(city.city, 'Bratislava');
  assert.equal(city.country, 'SK');
  assert.ok(Math.abs(city.lat - 48.1) < 1e-9 && Math.abs(city.lon - 17.1) < 1e-9, JSON.stringify(city));
  const country = whereAmIPayload(req({ 'cf-ipcountry': 'SK', 'cf-ipcity': 'Košice' }));
  assert.equal(country.precision, 'country');
  assert.equal(country.city, '', 'pri presnosti krajiny sa mesto nevracia');
  assert.ok(Number.isFinite(country.lat) && Number.isFinite(country.lon));
  assert.deepEqual(whereAmIPayload(req({})), { precision: 'none' });
  assert.deepEqual(whereAmIPayload(req({ 'cf-ipcountry': 'XX' })), { precision: 'none' });
});

test('odpoveď sa nekešuje a nesie len polohu', () => {
  const headers = {};
  let body = '';
  const res = { statusCode: 0, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (b) => { body = b; } };
  whereAmIMiddleware(req({ 'cf-ipcountry': 'DE', 'cf-iplatitude': '52.52', 'cf-iplongitude': '13.40', 'cf-connecting-ip': '203.0.113.9' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(headers['cache-control'], /no-store/);
  assert.match(headers['cache-control'], /private/);
  const json = JSON.parse(body);
  assert.deepEqual(Object.keys(json).sort(), ['city', 'country', 'lat', 'lon', 'precision']);
  assert.ok(!body.includes('203.0.113.9'), 'IP adresa sa nevracia');
});

test('vite.config.js registruje /api/whereami len s API pluginmi (služba oko-api)', () => {
  const src = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ whereAmIPlugin \} from '\.\/src\/whereAmIServer\.js';/);
  assert.match(src, /\.\.\.\(apiPlugins \? \[[^\]]*whereAmIPlugin\(\)[^\]]*\] : \[\]\)/);
});
