// src/sharePanelVideo.test.mjs — zdieľacie okno s videom do náhľadu (2026-10-07): poradie krokov
// (náhľad hneď, stav nahrávania a posielania, odkaz až po videu), hláška pri úspechu aj zlyhaní,
// bez nahrávania sa nič nemení. Falošný DOM bez innerHTML ako v sharePanel.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _getSharePanelForTest, openSharePanel } from './sharePanel.js';

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
const shortLink = { id: 'Ab12cd34EF', url: 'https://okolive.sk/s/Ab12cd34EF', image: 'https://okolive.sk/s/Ab12cd34EF.jpg' };

test('s videom: náhľad hneď po snímke, stav nahrávam → posielam, nahrávka ide na server s id, hláška o videu, udalosť share_create', async () => {
  const doc = makeDocument();
  const steps = [];
  const uploads = [];
  const clip = { blob: { size: 5000 }, type: 'video/webm', width: 1200, height: 630, durationMs: 6010, frames: 150 };
  const session = await openSharePanel({
    document: doc, window: {}, navigator: { clipboard: { writeText: async () => {} } }, translate,
    buildLink: () => ({ href: 'https://okolive.sk/#v=2&lat=48.1&lon=17.1', hash: 'v=2&lat=48.1&lon=17.1' }),
    captureSnapshot: async () => snapshot(),
    publish: async () => shortLink,
    recordVideo: async () => {
      const ui = _getSharePanelForTest(doc);
      steps.push(['record', ui.status.textContent, ui.preview.hidden, ui.urlBox.textContent]);
      return clip;
    },
    uploadVideo: async (payload) => {
      const ui = _getSharePanelForTest(doc);
      steps.push(['upload', ui.status.textContent]);
      uploads.push(payload);
      return { url: 'https://okolive.sk/s/Ab12cd34EF.mp4', width: 1200, height: 630, durationMs: 6010 };
    },
  });
  assert.deepEqual(steps, [
    ['record', 'share.video-recording', false, ''],
    ['upload', 'share.video-uploading'],
  ], 'počas nahrávania je náhľad vidieť, odkaz ešte nie (Facebook si stránku pri prvom vložení uloží do cache)');
  assert.equal(uploads[0].id, 'Ab12cd34EF');
  assert.equal(uploads[0].blob, clip.blob);
  assert.equal(uploads[0].durationMs, 6010);
  assert.deepEqual(session.video, { url: 'https://okolive.sk/s/Ab12cd34EF.mp4', width: 1200, height: 630, durationMs: 6010 });
  assert.equal(session.videoTried, true);
  const ui = _getSharePanelForTest(doc);
  assert.equal(ui.status.hidden, true, 'po dokončení stav zmizne');
  assert.equal(ui.urlBox.textContent, 'https://okolive.sk/s/Ab12cd34EF');
  assert.equal(ui.videoNote.hidden, false);
  assert.equal(ui.videoNote.textContent, 'share.video-ready');
  assert.deepEqual(ui.lastOptions.recordVideo !== null && typeof ui.lastOptions.uploadVideo === 'function', true, 'Skúsiť znova zopakuje aj video');
});

test('video zlyhá (nahrávka null, výnimka, server odmietne): odkaz ostáva s obrázkom a hláškou; bez nahrávania žiadna hláška', async () => {
  const doc = makeDocument();
  const base = {
    document: doc, window: {}, navigator: { clipboard: { writeText: async () => {} } }, translate,
    buildLink: () => ({ href: 'https://okolive.sk/#v=2&lat=48.1&lon=17.1', hash: 'v=2&lat=48.1&lon=17.1' }),
    captureSnapshot: async () => snapshot(),
    publish: async () => shortLink,
  };
  const ui = () => _getSharePanelForTest(doc);
  const nullClip = await openSharePanel({ ...base, recordVideo: async () => null, uploadVideo: async () => { throw new Error('must not upload'); } });
  assert.equal(nullClip.video, null);
  assert.equal(nullClip.videoTried, true);
  assert.equal(ui().videoNote.textContent, 'share.video-failed');
  assert.equal(ui().urlBox.textContent, 'https://okolive.sk/s/Ab12cd34EF', 'krátky odkaz ostáva');

  const thrown = await openSharePanel({ ...base, recordVideo: async () => { throw new Error('captureStream'); } });
  assert.equal(thrown.video, null);
  assert.equal(ui().videoNote.textContent, 'share.video-failed');

  const rejected = await openSharePanel({ ...base, recordVideo: async () => ({ blob: { size: 10 } }), uploadVideo: async () => null });
  assert.equal(rejected.video, null);
  assert.equal(ui().videoNote.textContent, 'share.video-failed');

  const noVideo = await openSharePanel({ ...base });
  assert.equal(noVideo.videoTried, false);
  assert.equal(ui().videoNote.hidden, true, 'bez nahrávania sa o videu nehovorí');

  const noShortLink = await openSharePanel({ ...base, publish: async () => null, recordVideo: async () => { throw new Error('must not record without a short link'); } });
  assert.equal(noShortLink.videoTried, false, 'bez krátkeho odkazu niet kam video pripojiť');
});
