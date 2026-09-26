// src/conflictBulletin.js
//
// "Mini spravodaj — Blízky východ" (2026-09-18). Originally a floating panel
// with its own tab; on 2026-09-18 the user asked to tidy the overlays and chose
// to MERGE it into the existing ZÁLIV panel rather than relocate it; since
// 2026-09-26 that panel is BLÍZKY VÝCHOD (#mideast-panel, mount `mideastPanel.newsMount`)
// and a theatre switch also switches the bulletin's region (main.js runMideastTheatre).
// It therefore no longer creates any positioned element of its own — it
// renders into a panel body it is handed, and the panel owns placement,
// collapse, height allocation and the mobile drawer.
//
// The merge exposed that ZÁLIV and the bulletin were showing two different
// feeds of the same story: region `gulf` (Hormuz / Persian Gulf) and region
// `mideast` (Red Sea, Suez, Yemen, Iran/Israel). Both are kept, switched by two
// chips in the panel, so nothing was lost by merging.
//
// It reuses the whole situation-news engine: the merged open-source feed
// (situationNews.js), keyword classification + gazetteer geolocation
// (gulfIncidents.js), and the hot-card renderer (gulfIncidentCards.js). Honesty
// (rules 2 & 6): aggregates + LINKS OUT to open journalism, every item marked
// "reported · unverified", models events/infrastructure — never people, faces or
// targeting. Neutral tone.

import { buildSituationModel, fetchSituationNews } from './data/situationNews.js';
import { classifyIncident, gazetteerForRegion, isVideoUrl, locateIncident } from './data/gulfIncidents.js';
import { createIncidentCards } from './gulfIncidentCards.js';
import { currentLanguage, t } from './i18n.js';

const REFRESH_TTL_MS = 12 * 60_000;
const MAX_ROWS = 16;
const LINK_IMAGE_API = '/api/link-image';

/** Both feeds the merged panel can show, narrow first. */
export const BULLETIN_REGIONS = Object.freeze([
  Object.freeze({ id: 'gulf', labelKey: 'panel.gulf' }),
  Object.freeze({ id: 'mideast', labelKey: 'bulletin.tab' }),
]);

const el = (doc, cls, text) => { const d = doc.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };

const INERT = {
  refresh: async () => {}, setRegion: () => {}, destroy: () => {}, element: null,
  get isOpen() { return false; }, get region() { return null; }, get loadedOnce() { return false; },
};

/**
 * Render the conflict bulletin inside an existing panel body.
 *
 * @param {object} opts
 * @param {Element} opts.mountTarget - element to render into (e.g. `mideastPanel.newsMount`, an element inside `#mideast-panel`).
 * @param {object|null} [opts.cards] - an existing incident-card layer to drive. Pass the app's
 *   single layer; without it a second one is created and the two fight over the same screen.
 */
export function createConflictBulletin({
  viewer = null,
  documentRef = globalThis.document,
  region = 'gulf',
  // Vlastný zoznam regiónov (UKRAJINA 2026-09-19: jeden región = bez čipov).
  regions = BULLETIN_REGIONS,
  mountTarget = null,
  cards: sharedCards = null,
  fetch: fetchImpl = fetchSituationNews,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement || !mountTarget) return INERT;
  ensureStyle(doc);

  const root = mountTarget;
  const ownerPanel = root.closest?.('[data-panel-id]') || null;
  // Only tear down a card layer we created ourselves; a shared one outlives us.
  const ownsCards = !sharedCards && Boolean(viewer);
  const cards = sharedCards || (viewer ? createIncidentCards({ viewer, translate, lang }) : null);
  // Only a layer we created ourselves may be revealed or retargeted from here.
  // A SHARED layer belongs to the scene reveal gate, which decides visibility by
  // camera distance — the user asked for hot cards only when zoomed in. Forcing
  // it visible because a side panel was expanded would defeat exactly that.
  const drivesCards = ownsCards ? cards : null;

  let activeRegion = regions.some((r) => r.id === region) ? region : regions[0].id;
  let open = false;
  let loadedOnce = false;
  const cache = new Map(); // region -> { payload, at }
  const inFlight = new Map(); // region -> promise
  const imgCache = new Map(); // article url -> og:image | null
  let observer = null;

  // Resolve an article's preview image via the server-side unfurl proxy (only for
  // items the feed did not already carry an image for).
  function unfurlImage(url) {
    if (imgCache.has(url)) return Promise.resolve(imgCache.get(url));
    return Promise.resolve(fetch(`${LINK_IMAGE_API}?url=${encodeURIComponent(url)}`, { cache: 'no-store' }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => { const s = j && typeof j.image === 'string' && /^https?:\/\//.test(j.image) ? j.image : null; imgCache.set(url, s); return s; })
      .catch(() => null);
  }

  function regionChips() {
    if (regions.length < 2) return null; // jediný región = prepínač nemá čo prepínať
    const row = el(doc, 'oko-bul-regions');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', translate('bulletin.title'));
    for (const r of regions) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `oko-bul-chip${r.id === activeRegion ? ' is-active' : ''}`;
      b.textContent = translate(r.labelKey);
      b.setAttribute('aria-pressed', String(r.id === activeRegion));
      b.addEventListener('click', () => setRegion(r.id));
      row.appendChild(b);
    }
    return row;
  }

  function rows(model) {
    if (!model?.ok) return [el(doc, 'oko-bul-note', translate('situation.unavailable'))];
    if (model.empty) return [el(doc, 'oko-bul-note', translate('situation.empty'))];
    const list = el(doc, 'oko-bul-list');
    for (const it of model.items.slice(0, MAX_ROWS)) {
      const a = doc.createElement('a');
      a.className = 'oko-bul-item';
      a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      // preview thumbnail (article og:image) — link-out, ▶ for a video link, never embeds
      const thumb = el(doc, 'oko-bul-thumb');
      thumb.hidden = true;
      const img = doc.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => { thumb.hidden = true; });
      img.addEventListener('load', () => { thumb.hidden = false; });
      thumb.appendChild(img);
      if (isVideoUrl(it.url)) { const p = el(doc, 'oko-bul-play'); p.textContent = '▶'; thumb.appendChild(p); }
      a.appendChild(thumb);
      // Load previews through the image proxy — reliable (bypasses slow/hotlink), cached.
      // Reveal the box the moment we have a URL: a display:none <img> is never
      // fetched (esp. with lazy-loading), which would deadlock the load handler.
      const setImg = (u) => { if (u) { thumb.hidden = false; img.src = `/api/img?url=${encodeURIComponent(u)}`; } };
      if (it.image) setImg(it.image);
      // `noImage` = zdroj nedovoľuje sťahovať náhľad (RFE/RL, Al Jazeera, UP) — bez unfurlu.
      else if (it.url && !it.noImage) void unfurlImage(it.url).then(setImg);

      const txt = el(doc, 'oko-bul-txt');
      const head = el(doc, 'oko-bul-head');
      const cls = classifyIncident(it.title, { region: activeRegion });
      if (cls) head.appendChild(el(doc, `oko-bul-badge oko-inc-${cls.severity}`, translate(`incident.type-${cls.type}`)));
      if (it.badge) head.appendChild(el(doc, 'oko-bul-badge oko-bul-src', translate(`source.${it.badge}`)));
      const loc = locateIncident(it.title, gazetteerForRegion(activeRegion));
      if (loc) head.appendChild(el(doc, 'oko-bul-place', loc.name));
      if (it.ageLabel) head.appendChild(el(doc, 'oko-bul-age', it.ageLabel));
      txt.appendChild(head);
      txt.appendChild(el(doc, 'oko-bul-title', it.title));
      txt.appendChild(el(doc, 'oko-bul-src', it.source || ''));
      a.appendChild(txt);
      list.appendChild(a);
    }
    const foot = el(doc, 'oko-bul-foot');
    foot.appendChild(el(doc, 'oko-bul-disc', translate('situation.disclaimer')));
    return [list, foot];
  }

  const render = (body) => root.replaceChildren(...[regionChips()].filter(Boolean), ...body);
  const paint = () => {
    const hit = cache.get(activeRegion);
    render(hit
      ? rows(buildSituationModel(hit.payload, { translate, nowMs: now(), limit: MAX_ROWS }))
      : [el(doc, 'oko-bul-note', translate('situation.loading'))]);
  };

  async function refresh() {
    const hit = cache.get(activeRegion);
    if (hit && now() - hit.at < REFRESH_TTL_MS) { paint(); return; }
    paint(); // loading state while the first fetch for this region is in flight
    const want = activeRegion;
    let request = inFlight.get(want);
    if (!request) {
      request = Promise.resolve(fetchImpl(want))
        .then((p) => { cache.set(want, { payload: p, at: now() }); return p; })
        .finally(() => { inFlight.delete(want); });
      inFlight.set(want, request);
    }
    try { await request; if (activeRegion === want) paint(); }
    catch { if (activeRegion === want) render([el(doc, 'oko-bul-note', translate('situation.unavailable'))]); }
  }

  function setRegion(next) {
    if (next === activeRegion || !regions.some((r) => r.id === next)) return;
    activeRegion = next;
    void refresh();
    if (drivesCards && open) void drivesCards.showFor(activeRegion);
  }

  function show() {
    if (open) return;
    open = true;
    loadedOnce = true;
    void refresh();
    if (drivesCards) { void drivesCards.showFor(activeRegion); drivesCards.setRevealed(true); }
  }
  function hide() {
    if (!open) return;
    open = false;
    if (drivesCards) drivesCards.setRevealed(false);
  }

  // The panel owns open/closed; mirror it. Fetch lazily on the first expand so a
  // collapsed panel costs no upstream request.
  if (ownerPanel) {
    const sync = () => {
      if (ownerPanel.classList.contains('collapsed')) hide(); else show();
    };
    try {
      observer = new MutationObserver(sync);
      observer.observe(ownerPanel, { attributes: true, attributeFilter: ['class'] });
    } catch { /* environments without MutationObserver */ }
    sync();
  } else {
    show();
  }

  function destroy() {
    hide();
    try { observer?.disconnect?.(); } catch { /* */ }
    if (ownsCards) { try { cards?.destroy?.(); } catch { /* */ } }
    try { root.replaceChildren(); } catch { /* */ }
  }

  return {
    refresh, setRegion, destroy, element: root,
    get isOpen() { return open; },
    get region() { return activeRegion; },
    get loadedOnce() { return loadedOnce; },
  };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-bulletin-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-bulletin-style';
  // Rows only. The bulletin no longer positions anything: it lives inside
  // its host panel (#mideast-panel or #ukraine-panel), which owns placement,
  // width, height allocation and the mobile drawer. Nothing here may be position:fixed.
  style.textContent = `
.oko-bul-regions{display:flex;gap:5px;margin:0 0 7px;flex:0 0 auto;}
.oko-bul-chip{appearance:none;cursor:pointer;flex:0 0 auto;padding:3px 8px;border-radius:7px;
  background:rgba(11,22,34,.5);color:#8aa0b6;border:1px solid rgba(120,150,180,.26);
  font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:8.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;}
.oko-bul-chip:hover{color:#dbeafe;border-color:rgba(120,150,180,.5);}
.oko-bul-chip.is-active{color:#fff;background:rgba(240,87,77,.22);border-color:rgba(240,87,77,.6);}
.oko-bul-list{display:flex;flex-direction:column;gap:7px;overflow-y:auto;flex:1 1 auto;min-height:0;}
.oko-bul-item{display:flex;gap:8px;text-decoration:none;color:inherit;padding:3px 0;border-bottom:1px solid rgba(120,150,180,.12);}
.oko-bul-item:last-child{border-bottom:0;}
.oko-bul-item:hover .oko-bul-title{color:#8fd9ff;}
.oko-bul-thumb{position:relative;width:56px;height:42px;flex:0 0 auto;border-radius:5px;overflow:hidden;background:#12202f;}
.oko-bul-thumb[hidden]{display:none;}
.oko-bul-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.oko-bul-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;
  background:rgba(11,22,34,.72);color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;padding-left:1px;box-shadow:0 0 0 1px rgba(255,255,255,.3);}
.oko-bul-txt{min-width:0;flex:1 1 auto;}
.oko-bul-head{display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap;}
.oko-bul-badge{font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:0 5px;border-radius:5px;border:1px solid currentColor;}
.oko-bul-badge.oko-inc-critical{color:#f87171;}
.oko-bul-badge.oko-inc-major{color:#ffb547;}
.oko-bul-badge.oko-inc-minor{color:#39d0ff;}
.oko-bul-badge.oko-bul-src{color:#8fd9ff;border-style:dashed;}
.oko-bul-place{font-size:9px;letter-spacing:.04em;color:#ffb547;text-transform:uppercase;}
.oko-bul-age{font-size:9px;color:#6f8398;margin-left:auto;}
.oko-bul-title{font-size:11px;line-height:1.3;color:#eaf2ff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.oko-bul-src{font-size:9px;color:#6f8398;margin-top:1px;}
.oko-bul-note{font-size:11px;color:#8aa0b6;padding:4px 0;}
.oko-bul-foot{margin-top:6px;flex:0 0 auto;}
.oko-bul-disc{font-size:8.5px;line-height:1.3;color:#6f8398;letter-spacing:.02em;}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
