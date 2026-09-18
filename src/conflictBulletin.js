// src/conflictBulletin.js
//
// "Mini spravodaj — Blízky východ" (2026-09-18, user: „chcem sa zamerať na
// konflikt Irán/Blízky východ/Suez/Jemen ako mini spravodaj"). A compact,
// toggleable bulletin of the latest open-source conflict news for a broad region
// (default `mideast`), plus — while it is open — map-anchored incident markers
// across the region (its own gulfIncidentCards instance).
//
// It reuses the whole situation-news engine: the merged open-source feed
// (situationNews.js), keyword classification + gazetteer geolocation
// (gulfIncidents.js), and the hot-card renderer (gulfIncidentCards.js). Honesty
// (rules 2 & 6): aggregates + LINKS OUT to open journalism, every item marked
// "reported · unverified", models events/infrastructure — never people, faces or
// targeting. Neutral tone.

import { buildSituationModel, fetchSituationNews } from './data/situationNews.js';
import { classifyIncident, isVideoUrl, locateIncident } from './data/gulfIncidents.js';
import { createIncidentCards } from './gulfIncidentCards.js';
import { currentLanguage, t } from './i18n.js';

const REFRESH_TTL_MS = 12 * 60_000;
const MAX_ROWS = 16;
const LINK_IMAGE_API = '/api/link-image';

const el = (doc, cls, text) => { const d = doc.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };

export function createConflictBulletin({
  viewer = null,
  documentRef = globalThis.document,
  region = 'mideast',
  fetch: fetchImpl = fetchSituationNews,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement) return { show: () => {}, hide: () => {}, toggle: () => {}, destroy: () => {}, element: null, get isOpen() { return false; } };
  ensureStyle(doc);

  // Region incident markers — own instance, shown only while the bulletin is open.
  const cards = viewer ? createIncidentCards({ viewer, translate, lang }) : null;

  const root = doc.createElement('aside');
  root.className = 'oko-bulletin';
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');
  (doc.body || doc.documentElement).appendChild(root);

  const tab = doc.createElement('button');
  tab.type = 'button';
  tab.className = 'oko-bulletin-tab';
  tab.textContent = translate('bulletin.tab');
  tab.setAttribute('aria-label', translate('bulletin.title'));
  tab.addEventListener('click', () => (open ? hide() : show()));
  (doc.body || doc.documentElement).appendChild(tab);

  let open = false;
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;
  const imgCache = new Map(); // article url -> og:image | null

  // Resolve an article's preview image via the server-side unfurl proxy (only for
  // items the feed did not already carry an image for).
  function unfurlImage(url) {
    if (imgCache.has(url)) return Promise.resolve(imgCache.get(url));
    return Promise.resolve(fetch(`${LINK_IMAGE_API}?url=${encodeURIComponent(url)}`, { cache: 'no-store' }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => { const s = j && typeof j.image === 'string' && /^https?:\/\//.test(j.image) ? j.image : null; imgCache.set(url, s); return s; })
      .catch(() => null);
  }

  function header() {
    const h = el(doc, 'oko-bul-header');
    h.appendChild(el(doc, 'oko-bul-h-title', translate('bulletin.title')));
    const x = doc.createElement('button');
    x.type = 'button'; x.className = 'oko-bul-close'; x.textContent = '×';
    x.setAttribute('aria-label', translate('situation.close'));
    x.addEventListener('click', hide);
    h.appendChild(x);
    return h;
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
      else if (it.url) void unfurlImage(it.url).then(setImg);

      const txt = el(doc, 'oko-bul-txt');
      const head = el(doc, 'oko-bul-head');
      const cls = classifyIncident(it.title);
      if (cls) head.appendChild(el(doc, `oko-bul-badge oko-inc-${cls.severity}`, translate(`incident.type-${cls.type}`)));
      const loc = locateIncident(it.title);
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

  const paint = () => { if (cached) root.replaceChildren(header(), ...rows(buildSituationModel(cached, { translate, nowMs: now(), limit: MAX_ROWS }))); };

  async function refresh() {
    if (cached && now() - cachedAt < REFRESH_TTL_MS) { paint(); return; }
    if (!cached) root.replaceChildren(header(), el(doc, 'oko-bul-note', translate('situation.loading')));
    if (!inFlight) inFlight = Promise.resolve(fetchImpl(region)).then((p) => { cached = p; cachedAt = now(); return p; }).finally(() => { inFlight = null; });
    try { await inFlight; paint(); }
    catch { root.replaceChildren(header(), el(doc, 'oko-bul-note', translate('situation.unavailable'))); }
  }

  function show() {
    open = true;
    root.hidden = false;
    tab.classList.add('is-open');
    void refresh();
    if (cards) { void cards.showFor(region); cards.setRevealed(true); }
  }
  function hide() {
    open = false;
    root.hidden = true;
    tab.classList.remove('is-open');
    if (cards) cards.setRevealed(false);
  }
  function destroy() {
    hide();
    try { cards?.destroy?.(); } catch { /* */ }
    try { root.remove(); tab.remove(); } catch { /* */ }
  }

  return { show, hide, toggle: () => (open ? hide() : show()), refresh, destroy, element: root, get isOpen() { return open; } };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-bulletin-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-bulletin-style';
  style.textContent = `
.oko-bulletin-tab{position:fixed;right:10px;bottom:74px;z-index:120;appearance:none;cursor:pointer;
  padding:6px 11px;border-radius:9px;background:rgba(11,22,34,.86);color:#ffb547;
  border:1px solid rgba(240,87,77,.5);box-shadow:0 6px 20px rgba(0,0,0,.5);backdrop-filter:blur(6px);
  font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;}
.oko-bulletin-tab:hover{color:#fff;border-color:#f0574d;}
.oko-bulletin-tab.is-open{color:#fff;background:rgba(240,87,77,.22);}
.oko-bulletin{position:fixed;right:10px;bottom:110px;z-index:120;width:300px;max-width:calc(100vw - 20px);max-height:56vh;
  display:flex;flex-direction:column;padding:9px 11px;border-radius:12px;background:rgba(11,22,34,.9);
  border:1px solid rgba(240,87,77,.34);box-shadow:0 10px 30px rgba(0,0,0,.55);backdrop-filter:blur(8px);
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;color:#dbeafe;pointer-events:auto;}
.oko-bulletin[hidden]{display:none;}
.oko-bul-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex:0 0 auto;}
.oko-bul-h-title{font-size:10px;font-weight:600;letter-spacing:.12em;color:#f0574d;text-transform:uppercase;}
.oko-bul-close{appearance:none;background:none;border:0;color:#8aa0b6;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.oko-bul-close:hover{color:#dbeafe;}
.oko-bul-list{display:flex;flex-direction:column;gap:7px;overflow-y:auto;flex:1 1 auto;}
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
