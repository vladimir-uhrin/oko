// src/cardCloseButtons.test.mjs — krížik v rohu kartičiek na glóbuse (2026-09-30). Vlastník: „kliknúť
// vedľa, aby sa karta zavrela, je amaterizmus. Aspoň malé X do rohu." Testy SPRÁVANIA na DOM dvojníkovi:
// krížik sa ukáže len pri nakreslenej karte, sedí v jej pravom hornom rohu, klik zavrie kartu cestou vrstvy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_CLOSE_INSET_PX, CARD_CLOSE_SIZE_PX, closeButtonPlacement, installCardCloseButtons } from './cardCloseButtons.js';

function fakeDom() {
  const make = (tag) => {
    const node = {
      tagName: tag, children: [], style: {}, hidden: false, className: '', textContent: '', attributes: {}, listeners: {}, dataset: {}, type: '', title: '',
      appendChild(c) { node.children.push(c); c.parentNode = node; return c; },
      remove() { const p = node.parentNode; if (p) p.children = p.children.filter((c) => c !== node); },
      setAttribute(k, v) { node.attributes[k] = String(v); },
      getAttribute(k) { return node.attributes[k] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      ownerDocument: null,
    };
    return node;
  };
  const doc = { createElement: (tag) => { const n = make(tag); n.ownerDocument = doc; return n; } };
  const body = make('body');
  body.ownerDocument = doc;
  return body;
}

test('krížik: pravý horný roh viditeľnej karty', () => {
  assert.deepEqual(closeButtonPlacement({ x: 100, y: 50, w: 400, h: 300 }), { x: 100 + 400 - CARD_CLOSE_SIZE_PX - CARD_CLOSE_INSET_PX, y: 50 + CARD_CLOSE_INSET_PX });
});

test('krížik na mobile (2026-10-04): karta širšia než okno → krížik ostane v okne; zmenšená karta ho má tiež', async () => {
  // Telefón 390 px na výšku, karta s grafmi 430 px od x = 24 — krížik bol na x = 421, mimo obrazovky.
  const viewport = { w: 390, h: 844 };
  const placed = closeButtonPlacement({ x: 24, y: 100, w: 430, h: 220 }, CARD_CLOSE_SIZE_PX, CARD_CLOSE_INSET_PX, viewport);
  assert.ok(placed.x + CARD_CLOSE_SIZE_PX <= viewport.w, `krížik celý v okne (x = ${placed.x})`);
  assert.equal(placed.x, 390 - CARD_CLOSE_SIZE_PX - CARD_CLOSE_INSET_PX);
  assert.deepEqual(closeButtonPlacement({ x: 10, y: 5, w: 300, h: 100 }, CARD_CLOSE_SIZE_PX, CARD_CLOSE_INSET_PX, viewport),
    { x: 10 + 300 - CARD_CLOSE_SIZE_PX - CARD_CLOSE_INSET_PX, y: 5 + CARD_CLOSE_INSET_PX }, 'karta v okne = roh karty');
  const { closeButtonVisibility } = await import('./cardCloseButtons.js');
  assert.ok(closeButtonVisibility({ x: 6, y: 100, w: 378, h: 190, alpha: 1, paintScale: 0.6 }), 'zmenšená karta (mobil) sa zavrieť dá');
  assert.equal(closeButtonVisibility({ x: 6, y: 100, w: 378, h: 190, alpha: 0.1, paintScale: 1 }), null, 'takmer neviditeľná karta bez krížika');
  assert.equal(closeButtonVisibility(null), null);
});

test('karta lietadla na úzkom okne: hostiteľ zmenší dokovanú kartu do šírky okna (worldOverlay)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./overlays/worldOverlay.js', import.meta.url), 'utf8');
  // Správanie overené v prehliadači (390×844): karta 430 px → zmestí sa; toto stráži, že
  // prispôsobenie ostane pred výpočtom šírky umiestnenia.
  const fit = src.indexOf('if (entry.dock) {\n    const roomW = _canvasWidth - 2 * DOCK_MARGIN_PX;');
  const width = src.indexOf('record.placementInput.width = record.layout.w * record.paintScale;');
  assert.ok(fit > 0 && width > fit, 'prispôsobenie mierky pred šírkou umiestnenia');
});

test('krížik: len pri nakreslenej karte, klik zavrie kartu cestou jej vrstvy a skryje sa; bledá/malá karta bez krížika', () => {
  const body = fakeDom();
  const listeners = [];
  const viewer = { scene: { postRender: { addEventListener: (fn) => listeners.push(fn), removeEventListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } } } };
  let tracked = 'flights:4b1805';
  let vessel = null;
  const closed = [];
  const rects = new Map([
    ['tracked|flights:4b1805', { x: 200, y: 80, w: 420, h: 260, alpha: 1, paintScale: 1 }],
    ['ais-live-vessels|vessel:211234560', { x: 50, y: 400, w: 300, h: 120, alpha: 0.2, paintScale: 1 }],
  ]);
  const ui = installCardCloseButtons(viewer, {
    container: body,
    t: (k) => (k === 'card.close' ? 'Zavrieť kartu' : k),
    paintRect: (sourceId, entryId) => rects.get(`${sourceId}|${entryId}`) ?? null,
    providers: [
      { id: 'tracked', active: () => (tracked ? { sourceId: 'tracked', entryId: tracked } : null), close: () => { closed.push(['tracked', tracked]); tracked = null; } },
      { id: 'vessel', active: () => (vessel ? { sourceId: 'ais-live-vessels', entryId: `vessel:${vessel}` } : null), close: () => { closed.push(['vessel', vessel]); vessel = null; } },
    ],
  });
  const [trackedBtn, vesselBtn] = body.children;
  assert.equal(trackedBtn.getAttribute('aria-label'), 'Zavrieť kartu', 'prístupný názov');
  listeners[0]();
  assert.equal(trackedBtn.hidden, false, 'sledované lietadlo má krížik');
  assert.equal(trackedBtn.style.transform, `translate(${200 + 420 - CARD_CLOSE_SIZE_PX - CARD_CLOSE_INSET_PX}px, ${80 + CARD_CLOSE_INSET_PX}px)`);
  assert.equal(vesselBtn.hidden, true, 'bez vybranej lode bez krížika');

  vessel = '211234560';
  listeners[0]();
  assert.equal(vesselBtn.hidden, true, 'bledá karta lode (zďaleka) — krížik by visel sám');
  rects.get('ais-live-vessels|vessel:211234560').alpha = 1;
  listeners[0]();
  assert.equal(vesselBtn.hidden, false);

  let propagationStopped = false;
  trackedBtn.listeners.click[0]({ stopPropagation: () => { propagationStopped = true; } });
  assert.deepEqual(closed, [['tracked', 'flights:4b1805']], 'zavrie cestou vrstvy');
  assert.equal(trackedBtn.hidden, true, 'hneď sa skryje');
  assert.equal(propagationStopped, true, 'klik nepadne do glóbusu (nevyberie iný objekt pod krížikom)');
  listeners[0]();
  assert.equal(trackedBtn.hidden, true, 'po zatvorení ostane skrytý');

  vesselBtn.listeners.click[0]();
  assert.deepEqual(closed.at(-1), ['vessel', '211234560']);
  ui.destroy();
  assert.equal(listeners.length, 0, 'listener odhlásený');
  assert.equal(body.children.length, 0, 'tlačidlá odstránené');
});

test('krížik: zapojenie v ui.js — sledovaný objekt aj vybraná loď, zatvára vrstva (stopTracking / clearSelection)', async () => {
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /installCardCloseButtons\(viewer, \{/);
  assert.match(ui, /module\.stopTracking\(\{ origin: 'user' \}\)/);
  assert.match(ui, /vesselsModule\(\)\?\.clearSelection\?\.\(\)/);
  const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  assert.match(i18n, /'card\.close': 'Close card'/);
  assert.match(i18n, /'card\.close': 'Zavrieť kartu'/);
});
