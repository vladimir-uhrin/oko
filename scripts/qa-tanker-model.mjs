// Real WebGL acceptance of the Blender export in OKO's bundled Cesium runtime.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const url = new URL(process.argv[2] || 'http://localhost:4173/demos/tanker/index.html');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'QA must use localhost');
const out = 'qa-shots/blender-tanker';
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const errors = [], rejected = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const target = new URL(request.url());
    if (['data:', 'blob:'].includes(target.protocol)
        || (target.origin === url.origin && /^\/(demos\/tanker\/|models\/oko-tanker\.|cesium\/|favicon.ico)/.test(target.pathname))) {
      request.continue();
    } else { rejected.push(request.url()); request.abort(); }
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(url.href, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => document.body.dataset.modelReady === 'true' || document.body.dataset.modelError === 'true', { timeout: 30000 });
  assert.equal(await page.$eval('body', node => node.dataset.modelError), undefined,
    await page.$eval('#status', node => node.textContent));
  assert.match(await page.$eval('#size', node => node.textContent), /^\d+ kB$/);
  const canvas = await page.$('.cesium-widget canvas');
  const firstView = await canvas.screenshot();
  await page.screenshot({ path: `${out}/perspective.png` });
  for (const view of ['side', 'top']) {
    await page.click(`[data-view="${view}"]`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.$eval(`[data-view="${view}"]`, n => n.getAttribute('aria-pressed')), 'true');
    const viewImage = await canvas.screenshot();
    assert.notDeepEqual(viewImage, firstView, `${view}: camera must change the rendered image`);
    await page.screenshot({ path: `${out}/${view}.png` });
  }
  await page.click('[data-view="perspective"]');
  const beforeOrbit = await canvas.screenshot();
  await page.mouse.move(850, 480);
  await page.mouse.down();
  await page.mouse.move(1020, 510, { steps: 15 });
  await page.mouse.up();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.notDeepEqual(await canvas.screenshot(), beforeOrbit, 'mouse drag must orbit the model');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.click('[data-view="perspective"]');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/mobile.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(rejected, [], 'No external services or API requests are needed');
  console.log('PASS: Blender GLB renders in Cesium; three camera views, mouse orbit, mobile layout; zero external/API requests.');
} finally { await browser.close(); }
