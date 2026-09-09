// Offline panel acceptance: no server, maps, keys or external requests.
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bundle = await build({
  stdin: { contents: `
    import { createMaritimeHistoryPanel, createMaritimeHistorySession } from './src/data/maritimeHistoryPanel.js';
    const enabled = new Set(['local-ports', 'ais-live-vessels']);
    const listeners = new Set();
    let activeStack = 'photoreal';
    const manager = {
      mapStackController: {
        getActiveId: () => activeStack,
        async setStack(id) { activeStack = id; return { activeId: id }; },
      },
      viewer: { camera: { flyTo: () => { window.focusedGulf = true; } } },
      isEnabled: id => enabled.has(id),
      subscribeVisibilityRequests(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async setEnabled(id, value, options) {
        listeners.forEach(fn => fn({ layerId: id, ...options }));
        if (value) enabled.add(id); else enabled.delete(id);
      },
    };
    window.enabledLayers = () => [...enabled].sort();
    window.activeStack = () => activeStack;
    document.body.append(createMaritimeHistoryPanel(document, manager, createMaritimeHistorySession(manager)));
  `, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const browser = await puppeteer.launch({ headless: true, timeout: 30000, protocolTimeout: 15000 });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  await page.setViewport({ width: 390, height: 700 });
  const requests = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith('data:')) { request.continue(); return; }
    requests.push(request.url()); request.abort();
  });
  await page.setContent('<!doctype html><html><body style="background:#10191e;color:#dce9ef;max-width:300px"></body></html>');
  await page.addStyleTag({ content: await readFile('style.css', 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  assert.match(await page.$eval('.maritime-history-panel', n => n.textContent), /2015.*2021/);
  const buttons = await page.$$('.maritime-history-panel button');
  assert.equal(buttons.length, 3);
  assert.equal(await buttons[1].evaluate(n => n.disabled), true);
  await buttons[0].click();
  await page.waitForFunction(() => !document.querySelectorAll('.maritime-history-panel button')[1].disabled);
  assert.deepEqual(await page.evaluate(() => window.enabledLayers()), [
    'ais-live-vessels', 'local-ports', 'local-ship-density', 'local-shipping-lanes',
  ]);
  assert.equal(await page.evaluate(() => window.activeStack()), 'osm');
  await buttons[2].click();
  assert.equal(await page.evaluate(() => window.focusedGulf), true);
  await buttons[1].click();
  await page.waitForFunction(() => document.querySelectorAll('.maritime-history-panel button')[1].disabled);
  assert.deepEqual(await page.evaluate(() => window.enabledLayers()), ['ais-live-vessels', 'local-ports']);
  assert.equal(await page.evaluate(() => window.activeStack()), 'photoreal');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
  assert.equal(requests.length, 0, 'offline fixture must not fetch any resources');
  console.log('PASS: offline panel show, undo, existing AIS/ports, Gulf focus and narrow layout; zero requests');
} finally { await browser.close(); }
