// Offline browser acceptance: real Cesium, layer controls and overlay host.
// No project Vite config, environment keys, paid tiles, or external requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import cesium from 'vite-plugin-cesium';
import puppeteer from 'puppeteer';
import { normalizeEarthquakeFeed } from '../src/data/earthquakeCatalog.js';

const output = path.resolve('.gev-cache/qa-earthquakes');
await fs.mkdir(output, { recursive: true });
const now = Date.now();
const catalogs = Object.fromEntries(['USGS', 'EMSC'].map(source => [source, {
  ...normalizeEarthquakeFeed({ features: [
    { id: source + '-fixture', geometry: { coordinates: source === 'USGS' ? [18, 48, 12] : [18.03, 48.02, -14] },
      properties: { mag: source === 'USGS' ? 4.2 : 4.4, depth: 14, time: now - 3600000,
        place: 'TEST · Central Slovakia', magtype: 'ml', magType: 'ml', status: 'reviewed' } },
    ...(source === 'EMSC' ? [{ id: 'EMSC-small', geometry: { coordinates: [18.8, 48.2, -8] },
      properties: { mag: 1.2, depth: 8, time: now - 1800000, flynn_region: 'TEST · Small regional event' } }] : []),
  ] }, source), fetchedAt: now,
}]));

const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head>
<body><div id="map" style="position:fixed;inset:0"></div>
<aside id="quake-qa-panel" style="position:fixed;left:20px;top:20px;width:300px;z-index:200;background:#101821;padding:18px;color:white">
<h2>TEST · Zemetrasenia</h2><div id="qa-controls"></div><p>Lokálne testovacie dáta · bez mapových služieb</p><button id="qa-hover">Ukázať hover detail</button></aside>
<script type="module">
import * as Cesium from 'cesium';
import { DataLayerManager } from '/src/data/manager.js';
import { initWorldOverlay } from '/src/overlays/worldOverlay.js';
import { createEarthquakesLayer } from '/src/data/earthquakes.js';
import { createEarthquakeHoverCard } from '/src/data/earthquakeHoverCard.js';
import { createVolcanoesLayer } from '/src/data/volcanoes.js';
const viewer = new Cesium.Viewer('map', { baseLayer:false, terrainProvider:new Cesium.EllipsoidTerrainProvider(),
geocoder:false, baseLayerPicker:false, animation:false, timeline:false, infoBox:false, selectionIndicator:false,
skyBox:false, skyAtmosphere:false, requestRenderMode:false });
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#1b2b3b');
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(18.1, 48, 300000) });
initWorldOverlay(viewer);
const layer = createEarthquakesLayer({ hoverFactory: () => createEarthquakeHoverCard({ lookupPhoto: async () => null }) });
const manager = new DataLayerManager(viewer);
manager.register(layer);
${process.argv.includes('--hazards') ? `
manager.register({ id:'local-firms', name:'Active fires', icon:'♨', source:'OFFLINE FIXTURE', updateInterval:-1,
  init(){}, enable(){}, disable(){}, update(){return true}, getStats(){return {count:12,lastUpdate:Date.now(),source:'OFFLINE FIXTURE'}} });
manager.register(createVolcanoesLayer({fetchImpl:async()=>({ok:true,json:async()=>({events:[{
  id:'test-volcano',title:'TEST · Volcano',categories:[{id:'volcanoes'}],closed:null,
  geometry:[{type:'Point',coordinates:[19,48.4],date:new Date().toISOString()}],sources:[]
}]})})}));
` : ''}
manager.buildTogglePanel(document.getElementById('qa-controls'));
await manager.setEnabled('earthquakes', true, {origin:'test'});
${process.argv.includes('--hazards') ? `await manager.setEnabled('local-firms',true,{origin:'test'}); await manager.setEnabled('volcanoes',true,{origin:'test'});` : ''}
window.qa = {viewer, layer, manager, Cesium};
document.getElementById('qa-hover').onclick = () => {
  const entity = viewer.dataSources.get(0).entities.values[0];
  const p = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, entity.position.getValue(Cesium.JulianDate.now()));
  const rect = viewer.scene.canvas.getBoundingClientRect();
  viewer.scene.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + p.x, clientY: rect.top + p.y }));
};
</script></body></html>`;

const fixturePlugin = { name: 'earthquake-offline-fixture', configureServer(server) {
server.middlewares.use(async (req, res, next) => {
  if (req.url === '/__quake_qa') {
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*;");
    res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__quake_qa', html)); return;
  }
  if (req.url?.startsWith('/api/earthquakes/')) {
    const source = req.url.split('/').at(-1).toUpperCase();
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(catalogs[source])); return;
  }
  next();
});
} };
console.log('Starting isolated offline fixture');
const server = await createServer({ configFile: false, envFile: false, plugins: [fixturePlugin, cesium()],
  optimizeDeps: { entries: [], include: ['cesium'] },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  console.log('Fixture listening');
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  if (process.argv.includes('--serve')) {
    console.log(origin + '/__quake_qa');
    await new Promise(resolve => process.once('SIGINT', resolve));
  } else {
  browser = await puppeteer.launch({ headless: true, protocolTimeout: 30_000,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'] });
  console.log('Browser ready');
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  console.log('Page ready');
  const errors = []; const blocked = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('Browser error: ' + error.message); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(origin + '/') || /^(data|blob):/.test(request.url())) request.continue();
    else { blocked.push(request.url().split('?')[0]); request.abort(); }
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('oko-lang', 'sk'));
  console.log('Loading fixture');
  await page.goto(origin + '/__quake_qa', { waitUntil: 'networkidle0' });
  console.log('Fixture loaded');
  await page.waitForFunction(() => window.qa?.layer.getStats().count === 1);
  await page.click('[data-chip-id="mag-1"]');
  await page.waitForFunction(() => window.qa.layer.getStats().count === 2);
  await page.waitForFunction(() => document.querySelectorAll('.quake-pulsar').length === 2);
  await page.click('[data-chip-id="pulsar"]');
  assert.equal(await page.$eval('.quake-pulsars', el => el.hidden), true);
  await page.click('[data-chip-id="pulsar"]');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await page.$eval('.quake-ring', el => getComputedStyle(el).animationName), 'none');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const point = await page.evaluate(() => {
    const entity = qa.viewer.dataSources.get(0).entities.values.find(e => e.id.includes('USGS'));
    const p = qa.Cesium.SceneTransforms.worldToWindowCoordinates(qa.viewer.scene, entity.position.getValue(qa.Cesium.JulianDate.now()));
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(point.x, point.y);
  await page.waitForSelector('.earthquake-hover-card:not([hidden])');
  const detailText = await page.$eval('.earthquake-hover-card', el => el.textContent);
  assert.match(detailText, /USGS/); assert.match(detailText, /EMSC/);
  assert.match(detailText, /M4.2/); assert.match(detailText, /M4.4/);
  await page.keyboard.press('Escape');
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => window.qa.layer.getSelectedInfo()?.solutions.length === 2);
  await page.screenshot({ path: path.join(output, 'selected.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.qa.layer.getSelectedInfo() === null);
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  const report = { externalRequests: blocked.length, browserErrors: errors, count: await page.evaluate(() => qa.layer.getStats().count), screenshot: path.join(output, 'selected.png') };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  }
} catch (error) { console.error(error); throw error; }
finally {
  let shutdownTimer;
  try {
    await Promise.race([browser?.close(), new Promise(resolve => {
      shutdownTimer = setTimeout(() => { browser?.disconnect(); browser?.process()?.kill(); resolve(); }, 5000);
    })]);
  } catch { /* already disconnected */ }
  finally { clearTimeout(shutdownTimer); }
  server.httpServer?.closeAllConnections?.();
  await server.close();
}
