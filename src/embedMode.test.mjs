// src/embedMode.test.mjs — živý rámček (2026-10-06): rozpoznanie `?embed=1`, adresy rámčeka a plnej appky,
// kód na vloženie bez prieniku do HTML, lišta s odkazom do hlavného okna a HUD vypnutý.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBED_TITLE_MAX, embedSnippet, embedTitleFromSearch, embedUrlFromAppUrl, fullAppUrl, installEmbedMode, isEmbedMode,
} from './embedMode.js';

test('?embed=1 zapína rámček, iné hodnoty nie', () => {
  assert.equal(isEmbedMode('?embed=1'), true);
  assert.equal(isEmbedMode('?t=x&embed=1'), true);
  assert.equal(isEmbedMode('?embed=0'), false);
  assert.equal(isEmbedMode('?embed'), false);
  assert.equal(isEmbedMode(''), false);
  assert.equal(isEmbedMode(undefined), false);
});

test('adresa rámčeka z adresy appky nesie hash a názov; plná appka hash bez query', () => {
  assert.equal(embedUrlFromAppUrl('https://okolive.sk/#v=2&lat=48.1&lon=17.1'), 'https://okolive.sk/?embed=1#v=2&lat=48.1&lon=17.1');
  assert.equal(embedUrlFromAppUrl('https://okolive.sk/#v=2', { title: 'OKO · SWR11H' }), 'https://okolive.sk/?embed=1&t=OKO+%C2%B7+SWR11H#v=2');
  assert.equal(embedUrlFromAppUrl('http://localhost:4173/?x=1#v=2', { title: '  a  b '.repeat(60) }).length < 300, true, 'názov sa oreže');
  assert.equal(embedTitleFromSearch('?embed=1&t=OKO+%C2%B7+SWR11H'), 'OKO · SWR11H');
  assert.equal(embedTitleFromSearch('?embed=1').length, 0);
  assert.equal(embedTitleFromSearch(`?t=${'x'.repeat(500)}`).length, EMBED_TITLE_MAX);
  assert.equal(fullAppUrl({ origin: 'https://okolive.sk', hash: '#v=2&lat=48.1', search: '?embed=1&t=a' }), 'https://okolive.sk/#v=2&lat=48.1');
  assert.equal(fullAppUrl({ origin: 'https://okolive.sk', hash: '' }), 'https://okolive.sk/');
});

test('kód na vloženie: iframe s adresou rámčeka, bez prieniku úvodzoviek a značiek', () => {
  const code = embedSnippet('https://okolive.sk/?embed=1&t=a"b<c>#v=2&lat=48.1');
  assert.match(code, /^<iframe src="https:\/\/okolive\.sk\/\?embed=1&amp;t=a&quot;b&lt;c&gt;#v=2&amp;lat=48\.1" width="640" height="400" /);
  assert.match(code, /allow="fullscreen" allowfullscreen title="OKO naživo"><\/iframe>$/);
  assert.match(embedSnippet('https://okolive.sk/?embed=1', { width: 300.6, height: 200, title: 'Mapa "frontu"' }), /width="301" height="200" .*title="Mapa &quot;frontu&quot;"/);
});

function makeNode(tag) {
  const node = {
    tagName: tag.toUpperCase(), className: '', textContent: '', attributes: {}, children: [], classes: new Set(),
    classList: { add(c) { node.classes.add(c); }, contains(c) { return node.classes.has(c); } },
    appendChild(child) { node.children.push(child); child.parentNode = node; return child; },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name] ?? null; },
  };
  return node;
}
const makeDocument = () => {
  const body = makeNode('body');
  const credits = makeNode('div');
  credits.style = {};
  body.appendChild(credits);
  return { body, credits, getElementById: (id) => (id === 'cesium-credits' ? credits : null), createElement: (tag) => makeNode(tag), createTextNode: (text) => ({ nodeType: 3, textContent: text, children: [] }) };
};
const translate = (key) => ({ 'embed.live': 'NAŽIVO', 'embed.open': 'Otvoriť v OKO' }[key] || key);

test('zapnutie rámčeka: trieda na body, HUD vypnutý cez režim nahrávania, lišta s odkazom do hlavného okna', () => {
  const doc = makeDocument();
  const calls = [];
  const styleManager = { setRecordingMode: (on, opts) => calls.push([on, opts]) };
  const win = { location: { origin: 'https://okolive.sk', hash: '#v=2&lat=48.1&lon=17.1&subj=flights.t.4b1805', search: '?embed=1&t=OKO+%C2%B7+SWR11H' } };
  const { bar, fullUrl, title } = installEmbedMode({ document: doc, window: win, styleManager, translate });
  assert.equal(doc.body.classList.contains('embed-mode'), true);
  assert.deepEqual(calls, [[true, { hidePanels: true, hudMode: 'off', safeFrame: '16:9' }]]);
  assert.deepEqual(doc.credits.style, { left: '10px', right: 'auto', bottom: '8px' }, 'kredity podkladu ostávajú, tesne v rohu');
  assert.equal(fullUrl, 'https://okolive.sk/#v=2&lat=48.1&lon=17.1&subj=flights.t.4b1805');
  assert.equal(title, 'OKO · SWR11H');
  assert.equal(doc.body.children.at(-1), bar);
  assert.equal(bar.getAttribute('id'), 'oko-embed-bar');
  const [brand, titleNode, open] = bar.children;
  assert.equal(brand.getAttribute('href'), fullUrl);
  assert.equal(brand.getAttribute('target'), '_top', 'z rámčeka na cudzom webe sa otvára hlavné okno');
  assert.equal(brand.children[0].textContent, 'OK');
  assert.equal(brand.children[0].children[0].textContent, 'O', 'azúrové O ako na webe');
  assert.equal(brand.children[1].children[1].textContent, 'NAŽIVO');
  assert.equal(titleNode.textContent, 'OKO · SWR11H');
  assert.equal(open.textContent, 'Otvoriť v OKO');
  assert.equal(open.getAttribute('href'), fullUrl);
  assert.equal(open.getAttribute('target'), '_top');
  assert.equal(open.getAttribute('rel'), 'noopener');
});

test('bez správcu štýlov a bez názvu rámček stále funguje', () => {
  const doc = makeDocument();
  const { bar, title } = installEmbedMode({ document: doc, window: { location: { origin: 'http://localhost:4173', hash: '', search: '?embed=1' } }, translate });
  assert.equal(title, '');
  assert.equal(bar.children[2].getAttribute('href'), 'http://localhost:4173/');
});
