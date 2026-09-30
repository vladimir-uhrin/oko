// src/eventsPanel.test.mjs — karta udalosti a kontrola vlastníkom (Udalosti, etapa 2b, 2026-09-30).
// Testy SPRÁVANIA na verejnom pohľade FZ1073 zo skutočných stôp: odkaz z príspevku otvorí kartu
// s momentmi, médiami a značkami, trasu nahrá do Histórie letov a PREHRAŤ ju spustí od okna udalosti;
// verejný návštevník sa na zoznam na kontrolu ani nepýta; vlastník zverejní až druhým klikom,
// FB zdieľanie otvorí len dialóg FB s odkazom, kopírovanie dá text príspevku.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS_CONFIRM_MS, EVENTS_REPLAY_SPEED, eventCardModel, eventIdFromHash, eventLeg, installEventsPanel, reviewRowModel } from './eventsPanel.js';
import { publicEventView } from './data/eventPost.js';
import { simplifyTrack } from './data/eventCard.js';
import { normalizeTrack } from './data/flightAnomalies.js';
import { fz1073, fz1073Event } from './data/fixtures/flightEventFixtures.mjs';

const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? ' ' + JSON.stringify(vars) : ''}`;
const ID = '8965d1-20260930T0521';
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };

async function fzView(extra = {}) {
  const e = await fz1073Event();
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  e.window = { fromT: e.firstT - 7200, toT: e.lastT + 3600 };
  return { ...publicEventView(e), preview: false, ...extra };
}

function fakeDoc() {
  const make = (tag) => {
    const node = {
      tag, children: [], dataset: {}, attributes: {}, listeners: {}, hidden: false, className: '', value: '', _text: '',
      get textContent() { return node._text + node.children.map((c) => c.textContent).join(''); },
      set textContent(v) { node._text = String(v); node.children = []; },
      get firstChild() { return node.children[0] || null; },
      appendChild(c) { node.children.push(c); return c; },
      append(...cs) { node.children.push(...cs); },
      insertBefore(c, ref) {
        const i = ref ? node.children.indexOf(ref) : -1;
        if (i < 0) node.children.push(c); else node.children.splice(i, 0, c);
        return c;
      },
      setAttribute(k, v) { node.attributes[k] = String(v); },
      getAttribute(k) { return node.attributes[k] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      click() { for (const fn of node.listeners.click || []) fn({ type: 'click' }); },
    };
    return node;
  };
  return { createElement: make, createTextNode: (text) => { const n = make('#text'); n.textContent = text; return n; } };
}
const all = (node) => [node, ...node.children.flatMap(all)];
const byClass = (root, cls) => all(root).filter((n) => String(n.className).split(' ').includes(cls));
const one = (root, cls) => byClass(root, cls)[0];
const visible = (root, node) => {
  // viditeľný = on ani žiadny predok nie je hidden
  const path = [];
  const walk = (n) => { path.push(n); if (n === node) return true; for (const c of n.children) if (walk(c)) return true; path.pop(); return false; };
  return walk(root) && path.every((n) => !n.hidden);
};

function setup({ ownerHost = false, list = null, view = null, post = null } = {}) {
  const doc = fakeDoc();
  const host = doc.createElement('div');
  const existing = doc.createElement('div');
  existing.className = 'history-row';
  host.appendChild(existing);
  const calls = { publicEvent: [], list: 0, post: [], publish: [], unpublish: [], shown: [], cleared: 0, flown: 0, legs: [], replay: [], opened: [], copied: [], revealed: 0 };
  const state = { view, list, post };
  const api = {
    publicEvent: async (id) => { calls.publicEvent.push(id); return typeof state.view === 'function' ? state.view(id) : state.view; },
    list: async () => { calls.list += 1; return state.list; },
    post: async (id) => { calls.post.push(id); return state.post; },
    publish: async (id) => { calls.publish.push(id); return {}; },
    unpublish: async (id) => { calls.unpublish.push(id); return {}; },
    cardUrl: (id, format = 'og') => `/api/events/${id}/card.jpg?format=${format}`,
  };
  const replay = {
    setSpeed: (x) => calls.replay.push(['speed', x]),
    seek: (s) => calls.replay.push(['seek', s]),
    play: () => calls.replay.push(['play']),
  };
  const history = {
    showLeg: async (leg) => { calls.legs.push(leg); },
    isShowing: (leg) => { const last = calls.legs.at(-1); return Boolean(last && last.icao24 === leg.icao24 && last.firstT === leg.firstT && !state.legClosed); },
    replay,
  };
  const markers = { show: (m) => calls.shown.push(m.length), clear: () => { calls.cleared += 1; }, flyTo: () => { calls.flown += 1; } };
  let nowMs = 1_000_000;
  const panel = installEventsPanel({
    host, t, doc, lang: () => 'sk', history, markers, api, ownerHost,
    reveal: () => { calls.revealed += 1; },
    clipboard: async (text) => { calls.copied.push(text); },
    openWindow: (url) => calls.opened.push(url),
    now: () => nowMs,
  });
  return { doc, host, panel, calls, state, section: host.children[0], advance: (ms) => { nowMs += ms; } };
}

test('id z odkazu a úsek na prehratie: len platné id; celá stopa udalosti, inak okno', async () => {
  assert.equal(eventIdFromHash(`#lat=29.1&lon=39.2&alt=900000&heading=0&pitch=-90&event=${ID}`), ID);
  assert.equal(eventIdFromHash('#lat=1&lon=2&event=../../etc'), null);
  assert.equal(eventIdFromHash(''), null);
  const view = await fzView();
  const leg = eventLeg(view);
  assert.deepEqual([leg.icao24, leg.callsign, leg.firstT, leg.lastT], ['8965d1', 'FDB1073', view.track[0][0], view.track.at(-1)[0]]);
  assert.deepEqual(eventLeg({ icao24: 'abc123', window: { fromT: 10, toT: 20 } }), { icao24: 'abc123', callsign: null, firstT: 10, lastT: 20 });
  assert.equal(eventLeg({ icao24: 'abc123' }), null);
});

test('model karty: titulok a let podľa jazyka, 6 momentov s časom UTC, „len adsb.lol", médiá len s http(s) odkazom, odznak podľa stavu', async () => {
  const view = await fzView();
  const sk = eventCardModel(view, t, 'sk');
  assert.equal(sk.headline, 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(sk.flightLine, 'Let FZ1073 · Fly Dubai · Dubai → Tel Aviv');
  assert.equal(sk.meta, '30. 9. 2026 · A6-FKF · B38M');
  assert.deepEqual([sk.badgeState, sk.badge], ['ok', 'events.badge-verified {"n":4}']);
  assert.equal(sk.moments.length, 6);
  const code = sk.moments.find((m) => m.text.includes('7500'));
  assert.deepEqual([code.time, code.only], ['05:36', 'events.only {"net":"adsb.lol"}']);
  assert.equal(eventCardModel(view, t, 'en').headline, 'Unlawful interference on board (hijacking): flight FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(eventCardModel(view, t, 'en').moments.find((m) => m.text.includes('7500')).text, 'transponder squawks 7500 (unlawful interference)');
  const withBad = { ...view, news: { sources: [...view.news.sources, { name: 'X', url: 'javascript:alert(1)' }] } };
  assert.equal(eventCardModel(withBad, t).sources.length, 4, 'odkaz javascript: vypadne');
  assert.equal(eventCardModel({ ...view, preview: true, publishable: false }, t).badge, 'events.badge-preview');
  assert.equal(eventCardModel({ ...view, preview: true }, t).badge, 'events.badge-preview-ready');
  assert.deepEqual([eventCardModel({ ...view, publishable: false }, t).badgeState], ['warn'], 'zverejnené, ale overenie sa zmenilo');
  const row = reviewRowModel({ id: ID, icao24: '8965d1', callsign: 'FDB1073', status: 'confirmed', firstT: view.firstT, kinds: ['dive', '7500'], news: 'verified', publishable: true, published: null }, t);
  assert.deepEqual([row.title, row.state, row.chips], ['FDB1073', 'ready', ['events.data-confirmed', 'events.news-verified']]);
  assert.match(row.sub, /^30\. 9\. 2026 05:2\d UTC · dive, 7500$/);
  assert.equal(reviewRowModel({ icao24: 'abc123', status: 'unverified', firstT: 0, news: null }, t).chips[1], 'events.news-pending');
});

test('verejný návštevník: odkaz otvorí kartu navrchu Histórie letov, značky na glóbuse, trasu v prehrávači; PREHRAŤ od okna udalosti 60×; zavrieť upratuje', async () => {
  const view = await fzView();
  const s = setup({ ownerHost: false, view });
  assert.equal(s.section.className, 'events-section', 'sekcia navrchu panela, pred vyhľadávaním');
  assert.equal(s.section.hidden, true, 'bez udalosti skrytá — žiadna medzera v paneli');
  await flush();
  assert.equal(s.calls.list, 0, 'verejná stránka sa na zoznam na kontrolu nepýta');
  assert.equal(await s.panel.open(ID), true);
  assert.equal(s.section.hidden, false);
  assert.equal(s.calls.revealed, 1, 'panel História letov sa otvorí');
  assert.equal(one(s.section, 'events-headline').textContent, 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  const moments = byClass(s.section, 'events-moment');
  assert.equal(moments.length, 6);
  assert.deepEqual(moments.map((li) => li.children[0].textContent), ['1', '2', '3', '4', '5', '6'], 'čísla ako značky na glóbuse a na obrázku');
  const links = byClass(s.section, 'events-source');
  assert.deepEqual(links.slice(0, 4).map((a) => [a.textContent, a.target, a.rel]), view.news.sources.map((src) => [src.name, '_blank', 'noopener noreferrer']));
  const via = one(s.section, 'events-via');
  assert.deepEqual([via.hidden, via.children[0].href], [false, 'https://www.gdeltproject.org/'], 'podmienky GDELT: citácia s odkazom');
  assert.deepEqual(s.calls.shown, [6], 'značky 6 momentov');
  assert.deepEqual(s.calls.legs.map((l) => l.icao24), ['8965d1'], 'trasa v prehrávači hneď (bez spustenia)');
  assert.equal(s.calls.flown, 1, 'prehrávač zarámoval celý let — kamera späť nad udalosť (až po nahratí trasy)');
  assert.equal(s.calls.replay.length, 0);
  assert.equal(one(s.section, 'events-owner').hidden, true, 'verejnosť nevidí kontrolu vlastníka');
  one(s.section, 'events-play').click();
  await flush();
  assert.deepEqual(s.calls.replay, [['speed', EVENTS_REPLAY_SPEED], ['seek', view.focus[0]], ['play']], 'od 20 min pred udalosťou, nie od štartu');
  assert.equal(s.calls.legs.length, 1, 'trasa už je v prehrávači — nenačítava sa znova (a nezarámuje celý let)');
  assert.equal(s.calls.flown, 2, 'PREHRAŤ vráti záber nad udalosť');
  // Používateľ medzitým v Histórii letov otvoril iný let → PREHRAŤ trasu udalosti nahrá znova.
  s.state.legClosed = true;
  one(s.section, 'events-play').click();
  await flush();
  assert.equal(s.calls.legs.length, 2);
  s.state.legClosed = false;
  one(s.section, 'events-close').click();
  assert.equal(one(s.section, 'events-card').hidden, true);
  assert.equal(s.section.hidden, true);
  assert.equal(s.calls.cleared, 1, 'značky preč');
  // Nezverejnená / stiahnutá udalosť: 404 → správa, žiadne značky.
  s.state.view = null;
  assert.equal(await s.panel.open(ID), false);
  assert.equal(one(s.section, 'events-headline').textContent, 'events.not-found');
  assert.deepEqual(s.calls.shown, [6]);
  assert.equal(await s.panel.open('nie-je-id'), false, 'neplatné id sa ani nepýta');
  assert.equal(s.calls.publicEvent.length, 2);
});

test('vlastník: zoznam na kontrolu, náhľad; ZVEREJNIŤ až druhým klikom do 5 s; potom FB dialóg s odkazom, kopírovanie textu a odkazu, obrázok do príspevku', async () => {
  const view = await fzView({ preview: true });
  const summary = { id: ID, icao24: '8965d1', callsign: 'FDB1073', status: 'confirmed', firstT: view.firstT, kinds: ['dive'], news: 'verified', publishable: true, published: null };
  const draft = { id: ID, publishable: true, headline: 'H', text: 'Text príspevku bez odkazu', published: null, facebook: null };
  const s = setup({ ownerHost: true, view, list: { events: [summary] }, post: draft });
  await flush();
  assert.equal(s.calls.list, 1);
  const toggle = one(s.section, 'events-review-toggle');
  assert.equal(toggle.textContent, 'events.review-title {"n":1} · events.review-ready {"n":1}');
  assert.equal(s.section.hidden, false);
  toggle.click();
  await flush();
  const row = one(s.section, 'events-review-btn');
  row.click();
  await flush();
  assert.equal(s.calls.flown, 1, 'zo zoznamu prelet nad udalosť');
  const owner = one(s.section, 'events-owner');
  assert.equal(owner.hidden, false);
  assert.equal(one(owner, 'events-preview').src.startsWith(`/api/events/${ID}/card.jpg?format=og&v=`), true, 'náhľad obrázka (nie z cache)');
  assert.equal(one(owner, 'events-post').value, 'Text príspevku bez odkazu');
  assert.equal(one(owner, 'events-share-fb'), undefined, 'pred zverejnením nič na FB');
  const pub = one(owner, 'events-publish');
  pub.click();
  await flush();
  assert.equal(s.calls.publish.length, 0, 'prvý klik len pýta potvrdenie');
  assert.equal(pub.textContent, 'events.publish-confirm');
  s.advance(EVENTS_CONFIRM_MS + 1);
  pub.click();
  await flush();
  assert.equal(s.calls.publish.length, 0, 'po 5 s znova len potvrdenie');
  // Zverejnené: server vráti odkaz a FB zdieľanie.
  const url = 'https://okolive.sk/s/Ab12cd34EF';
  s.state.post = { ...draft, text: `Text príspevku\n\nRekonštrukcia letu na mape: ${url}`, published: { url, shareId: 'Ab12cd34EF', t: 1 }, facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` };
  s.state.list = { events: [{ ...summary, published: url }] };
  s.state.view = { ...view, preview: false, published: { url, t: 1 } };
  pub.click();
  await flush();
  assert.deepEqual(s.calls.publish, [ID], 'druhý klik do 5 s zverejní');
  const owner2 = one(s.section, 'events-owner');
  assert.ok(one(owner2, 'events-owner-status').textContent.includes(url));
  one(owner2, 'events-share-fb').click();
  assert.deepEqual(s.calls.opened, [s.state.post.facebook], 'len dialóg FB s odkazom — príspevok odošle vlastník');
  assert.deepEqual(s.calls.copied, [s.state.post.text], 'text príspevku do schránky ešte pred otvorením okna FB (to berie fokus)');
  await flush();
  assert.equal(one(owner2, 'events-owner-msg').textContent, 'events.fb-copied');
  one(owner2, 'events-copy-text').click();
  one(owner2, 'events-copy-link').click();
  await flush();
  assert.deepEqual(s.calls.copied, [s.state.post.text, s.state.post.text, url]);
  const img = one(owner2, 'events-download');
  assert.deepEqual([img.href, img.download], [`/api/events/${ID}/card.jpg?format=feed`, `oko-udalost-${ID}.jpg`]);
  assert.equal(one(s.section, 'events-chip--published').textContent, 'events.published');
  // Stiahnutie tiež dvoma klikmi.
  const withdraw = one(owner2, 'events-unpublish');
  withdraw.click();
  await flush();
  assert.equal(s.calls.unpublish.length, 0);
  withdraw.click();
  await flush();
  assert.deepEqual(s.calls.unpublish, [ID]);
});

test('verejná adresa aj na localhoste: zoznam vráti 404 → žiadna kontrola vlastníka, karta ostáva verejná', async () => {
  const view = await fzView();
  const s = setup({ ownerHost: true, view, list: null });
  await flush();
  assert.equal(s.calls.list, 1);
  assert.equal(one(s.section, 'events-review').hidden, true);
  await s.panel.open(ID);
  assert.equal(one(s.section, 'events-owner').hidden, true);
  assert.equal(s.calls.post.length, 0, 'text príspevku sa nepýta');
});
