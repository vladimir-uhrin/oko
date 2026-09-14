// src/sharePanel.test.mjs
// Zdieľacie okno (2026-09-14): tok odkaz → snímka → server → okno, zálohy bez
// snímky a bez servera, tlačidlá sietí, schránka. Falošný DOM bez innerHTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _getSharePanelForTest, openSharePanel, publishShareSnapshot } from './sharePanel.js';

function makeNode(tag) {
  const node = {
    tagName: tag.toUpperCase(), className: '', textContent: '', hidden: false, attributes: {}, children: [], listeners: {}, parentNode: null,
    appendChild(child) { node.children.push(child); child.parentNode = node; return child; },
    removeChild(child) { const i = node.children.indexOf(child); if (i >= 0) node.children.splice(i, 1); return child; },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name] ?? null; },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    async click() { for (const handler of node.listeners.click || []) await handler({}); },
  };
  return node;
}
function makeDocument() {
  const body = makeNode('body');
  return { body, listeners: {}, createElement: (tag) => makeNode(tag), addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }, getElementById: () => null };
}
const translate = (key) => key;
const snapshot = () => ({ jpegDataUrl: 'data:image/jpeg;base64,/9j/AAAA', width: 1200, height: 630, pngBlob: async () => ({ type: 'image/png' }) });

test('plný tok: snímka → server → krátky odkaz, náhľad, 8 sietí, kopírovanie odkazu do schránky', async () => {
  const doc = makeDocument();
  const written = [];
  const nav = { clipboard: { writeText: async (text) => { written.push(text); }, write: async () => {} }, share: async () => {}, canShare: () => true };
  const win = { ClipboardItem: function ClipboardItem(items) { this.items = items; }, File: function File(parts, name) { this.name = name; } };
  const published = [];
  const toasts = [];
  const session = await openSharePanel({
    document: doc, window: win, navigator: nav, translate, toast: (m) => toasts.push(m),
    buildLink: () => ({ href: 'https://oko.uhrin.digital/#v=2&lat=48.1&lon=17.1', hash: 'v=2&lat=48.1&lon=17.1' }),
    captureSnapshot: async () => snapshot(),
    publish: async (payload) => { published.push(payload); return { id: 'Ab12cd34EF', url: 'https://oko.uhrin.digital/s/Ab12cd34EF', image: 'https://oko.uhrin.digital/s/Ab12cd34EF.jpg' }; },
    copy: { title: 'OKO · SWR11H', description: 'Lietadlá', text: 'OKO · SWR11H — Lietadlá' },
  });
  assert.equal(session.url, 'https://oko.uhrin.digital/s/Ab12cd34EF');
  assert.equal(published[0].hash, 'v=2&lat=48.1&lon=17.1');
  assert.equal(published[0].title, 'OKO · SWR11H');
  assert.equal(published[0].width, 1200);
  const ui = _getSharePanelForTest(doc);
  assert.equal(ui.root.hidden, false);
  assert.equal(ui.preview.hidden, false);
  assert.equal(ui.preview.getAttribute('src'), 'data:image/jpeg;base64,/9j/AAAA');
  assert.equal(ui.urlBox.textContent, 'https://oko.uhrin.digital/s/Ab12cd34EF');
  assert.equal(ui.note.textContent, 'share.short-link');
  assert.equal(ui.copyImage.hidden, false, 'ClipboardItem je → kopírovanie obrázka');
  assert.equal(ui.native.hidden, false, 'navigator.share je → Zdieľať…');
  assert.deepEqual(ui.networks.children.map((a) => a.getAttribute('data-network')), ['facebook', 'x', 'linkedin', 'threads', 'bluesky', 'whatsapp', 'telegram', 'email']);
  assert.match(ui.networks.children[0].getAttribute('href'), /facebook\.com\/sharer.*Ab12cd34EF/);
  assert.equal(ui.networks.children[0].getAttribute('rel'), 'noopener noreferrer');
  assert.deepEqual(toasts, [], 'bez chýb bez hlášok');
  await ui.copyLink.click();
  assert.deepEqual(written, ['https://oko.uhrin.digital/s/Ab12cd34EF']);
  assert.deepEqual(toasts, ['share.link-copied']);
  await ui.copyImage.click();
  assert.deepEqual(toasts, ['share.link-copied', 'share.image-copied']);
  ui.hide();
  assert.equal(ui.root.hidden, true);
  // druhé otvorenie znova použije ten istý DOM
  await openSharePanel({ document: doc, window: win, navigator: nav, translate, buildLink: () => ({ href: 'https://x/#lat=1&lon=2', hash: 'lat=1&lon=2' }), captureSnapshot: null, publish: async () => null });
  assert.equal(_getSharePanelForTest(doc), ui);
  assert.equal(doc.body.children.length, 2, 'backdrop + okno, nie duplicitne');
});

test('bez servera: dlhý odkaz + hláška; bez snímky: hláška a bez obrázkových tlačidiel; bez odkazu: nič', async () => {
  const doc = makeDocument();
  const nav = { clipboard: { writeText: async () => {} } };
  const toasts = [];
  const offline = await openSharePanel({
    document: doc, window: {}, navigator: nav, translate, toast: (m) => toasts.push(m),
    buildLink: () => ({ href: 'https://x/#lat=1&lon=2', hash: 'lat=1&lon=2' }),
    captureSnapshot: async () => snapshot(),
    publish: async () => null,
    copy: { title: 'OKO', description: '', text: 'OKO' },
  });
  assert.equal(offline.url, 'https://x/#lat=1&lon=2');
  assert.equal(offline.shortLink, null);
  assert.deepEqual(toasts, ['share.upload-failed']);
  const ui = _getSharePanelForTest(doc);
  assert.equal(ui.note.textContent, 'share.long-link');
  assert.equal(ui.copyImage.hidden, true, 'bez ClipboardItem sa obrázok nekopíruje');
  assert.equal(ui.native.hidden, true, 'bez navigator.share');
  assert.equal(ui.download.hidden, false, 'snímka je → uložiť');

  const noSnapshot = await openSharePanel({
    document: doc, window: {}, navigator: nav, translate, toast: (m) => toasts.push(m),
    buildLink: () => ({ href: 'https://x/#lat=1&lon=2', hash: 'lat=1&lon=2' }),
    captureSnapshot: async () => { throw new Error('webgl'); },
    publish: async () => { throw new Error('must not be called'); },
  });
  assert.equal(noSnapshot.snapshot, null);
  assert.equal(toasts.at(-1), 'share.image-failed');
  assert.equal(ui.download.hidden, true);
  assert.equal(ui.preview.hidden, true);

  assert.equal(await openSharePanel({ document: doc, window: {}, navigator: nav, translate, toast: (m) => toasts.push(m), buildLink: () => null }), null);
  assert.equal(toasts.at(-1), 'toast.copy-failed');
});

test('publishShareSnapshot: POST JSON na /api/share, {url} späť; chyby a odmietnutia = null', async () => {
  const calls = [];
  const okFetch = async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ id: 'A', url: 'https://x/s/A', image: 'https://x/s/A.jpg' }) }; };
  const result = await publishShareSnapshot({ hash: 'lat=1&lon=2', title: 'OKO', description: 'd', image: 'data:image/jpeg;base64,/9j/', width: 1200, height: 630, fetchImpl: okFetch });
  assert.deepEqual(result, { id: 'A', url: 'https://x/s/A', image: 'https://x/s/A.jpg' });
  assert.equal(calls[0][0], '/api/share');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(JSON.parse(calls[0][1].body).hash, 'lat=1&lon=2');
  assert.equal(await publishShareSnapshot({ hash: 'lat=1', image: 'x', fetchImpl: async () => ({ ok: false, status: 429 }) }), null);
  assert.equal(await publishShareSnapshot({ hash: 'lat=1', image: 'x', fetchImpl: async () => { throw new Error('net'); } }), null);
  assert.equal(await publishShareSnapshot({ hash: 'lat=1', image: '', fetchImpl: okFetch }), null, 'bez obrázka sa neposiela');
});
