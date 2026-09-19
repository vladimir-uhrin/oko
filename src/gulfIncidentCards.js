// src/gulfIncidentCards.js
//
// "Hot cards" pinned to the globe (2026-09-18, user: „také Hot kartičky … nech
// sa všetko objavuje iba pri priblížení nad Hormuzom"). Replaces the plain
// point+popup incident markers with rich news cards anchored over the reported
// place, the way the upstream "Hormuz Blockade" reveal shows them. Each card
// carries the incident badge (colour = severity), the headline, source · age,
// a source count when many outlets ran the same story, and an always-on
// "reported · unverified" foot. The card is a link to the source (rel=noopener).
//
// Cards are deduped per distinct story (src/data/gulfIncidents.js buildIncidentCards)
// so 6 outlets on one event become ONE card, not 6 stacked pins. They project to
// screen each frame (SceneTransforms) like the airport card, are culled behind
// the horizon (EllipsoidalOccluder), and are de-overlapped into a neat stack. The
// whole layer is gated by `setRevealed(false)` from the scene reveal gate, so it
// only appears when you are zoomed in over the strait — never on the full globe.
//
// Honesty (rules 2 & 6): events/vessels/infrastructure, never people; links out,
// never reproduces media; every card is labelled reported · unverified.

import * as Cesium from 'cesium';
import { buildIncidentCards } from './data/gulfIncidents.js';
import { fetchSituationNews, relativeAge } from './data/situationNews.js';
import { translateText } from './translate.js';
import { currentLanguage, t } from './i18n.js';

const LINK_IMAGE_API = '/api/link-image';

const SEV_COLOR = Object.freeze({ critical: '#f87171', major: '#ffb547', minor: '#39d0ff' });
const ANCHOR_OFFSET_PX = 14;
const CARD_GAP_PX = 6;
const REFETCH_TTL_MS = 15 * 60_000;
const MAX_CARDS = 6;

export function createIncidentCards({
  viewer,
  fetch: fetchImpl = fetchSituationNews,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doc = viewer?.container?.ownerDocument;
  if (!viewer?.scene || !doc?.createElement) {
    return { showFor: async () => 0, setRevealed: () => {}, clear: () => {}, destroy: () => {}, get count() { return 0; } };
  }
  ensureStyle(doc);
  const layer = doc.createElement('div');
  layer.className = 'oko-hotcards';
  layer.hidden = true;
  viewer.container.appendChild(layer);

  let cards = []; // { model, el, dot, cartesian }
  let revealed = false;
  let inFlight = null;
  let occluder = null;
  const scratch = new Cesium.Cartesian2();
  const cache = new Map(); // region -> { items, at }
  const imgCache = new Map(); // article url -> og:image url | null

  function clear() {
    layer.replaceChildren();
    cards = [];
  }

  // Resolve an article's preview image (og:image) via the server-side unfurl proxy.
  // Used only for items the feed did not already carry an image for.
  function unfurlImage(url) {
    if (imgCache.has(url)) return Promise.resolve(imgCache.get(url));
    return Promise.resolve(fetch(`${LINK_IMAGE_API}?url=${encodeURIComponent(url)}`, { cache: 'no-store' }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => { const s = j && typeof j.image === 'string' && /^https?:\/\//.test(j.image) ? j.image : null; imgCache.set(url, s); return s; })
      .catch(() => null);
  }

  function makeCard(model) {
    const a = doc.createElement('a');
    a.className = `oko-hotcard oko-hc-${model.severity}`;
    a.href = model.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.setProperty('--hc-accent', SEV_COLOR[model.severity] || SEV_COLOR.minor);

    // Preview image (article og:image) as a link-out thumbnail — like the ZÁLIV
    // panel. Video is never embedded: a ▶ badge marks it and the card links out.
    const thumb = doc.createElement('div');
    thumb.className = 'oko-hc-thumb';
    thumb.hidden = true;
    const img = doc.createElement('img');
    img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { thumb.hidden = true; });
    img.addEventListener('load', () => { thumb.hidden = false; });
    thumb.appendChild(img);
    if (model.isVideo) { const play = doc.createElement('span'); play.className = 'oko-hc-play'; play.textContent = '▶'; thumb.appendChild(play); }
    a.appendChild(thumb);
    // Load the preview through the image proxy — reliable (bypasses slow/hotlink),
    // cached. Works for a video poster (og:image) too; the ▶ badge marks video.
    // Reveal the box the moment we have a URL: a display:none <img> is never
    // fetched (esp. with lazy-loading), which would deadlock the load handler.
    const setImg = (u) => { if (u) { thumb.hidden = false; img.src = `/api/img?url=${encodeURIComponent(u)}`; } };
    if (model.image) setImg(model.image);
    // `noImage` (UKRAJINA 2026-09-19): zdroj nedovoľuje sťahovať náhľad — bez unfurlu.
    else if (model.url && !model.noImage) void unfurlImage(model.url).then(setImg);

    const head = doc.createElement('div');
    head.className = 'oko-hc-head';
    const badge = doc.createElement('span');
    badge.className = 'oko-hc-badge';
    badge.textContent = translate(`incident.type-${model.type}`);
    head.appendChild(badge);
    const place = doc.createElement('span');
    place.className = 'oko-hc-place';
    place.textContent = model.place + (model.approx ? ` (${translate('incident.approx')})` : '');
    head.appendChild(place);
    a.appendChild(head);

    const title = doc.createElement('div');
    title.className = 'oko-hc-title';
    title.textContent = model.title;
    a.appendChild(title);

    // A machine-translated summary when the UI is not English — labelled as such.
    const mt = doc.createElement('div');
    mt.className = 'oko-hc-mt';
    mt.hidden = true;
    mt.textContent = translate('incident.mt');
    if (lang && lang !== 'en') {
      void translateText(model.title, lang).then((tr) => {
        if (tr && tr.trim() && tr !== model.title) { title.textContent = tr; title.title = model.title; mt.hidden = false; }
      });
    }

    const meta = doc.createElement('div');
    meta.className = 'oko-hc-meta';
    const age = relativeAge(model.publishedAt, now(), translate);
    const parts = [];
    if (model.source) parts.push(model.source);
    if (age) parts.push(age);
    if (model.storyCount > 1) parts.push(translate('incident.more', { n: model.storyCount - 1 }));
    meta.textContent = parts.join(' · ');
    a.appendChild(meta);
    a.appendChild(mt);

    const foot = doc.createElement('div');
    foot.className = 'oko-hc-foot';
    foot.textContent = translate('incident.unverified');
    a.appendChild(foot);
    return a;
  }

  function draw(items, region) {
    clear();
    const models = buildIncidentCards(items, { region, limit: MAX_CARDS });
    for (const model of models) {
      const el = makeCard(model);
      const accent = SEV_COLOR[model.severity] || SEV_COLOR.minor;
      const line = doc.createElement('span'); // leader line: ground dot → card
      line.className = 'oko-hc-line';
      line.style.setProperty('--hc-accent', accent);
      const dot = doc.createElement('span');
      dot.className = 'oko-hc-pin';
      dot.style.setProperty('--hc-accent', accent);
      layer.appendChild(line);
      layer.appendChild(dot);
      layer.appendChild(el);
      cards.push({ model, el, dot, line, cartesian: Cesium.Cartesian3.fromDegrees(model.lon, model.lat) });
    }
    place();
    return cards.length;
  }

  // Each card is anchored to its place: a pin dot sits exactly on the projected
  // point and the card floats beside it (flipping to the other side near an edge).
  // Cards are culled behind the horizon / off-screen, and the rare case of two
  // places overlapping on screen is de-overlapped vertically.
  function place() {
    // display:none (not visibility:hidden) — a card sets its own visibility:visible
    // for occlusion culling, which would otherwise override a hidden parent and
    // keep showing at planet zoom.
    if (layer.hidden || !revealed || !cards.length) { layer.style.display = 'none'; return; }
    const scene = viewer.scene;
    layer.style.display = 'block';
    occluder = occluder || new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.positionWC);
    try { occluder.cameraPosition = scene.camera.positionWC; } catch { /* headless */ }
    const view = doc.defaultView;
    const vw = view?.innerWidth || viewer.container.clientWidth || 0;
    const vh = view?.innerHeight || viewer.container.clientHeight || 0;

    const visible = [];
    for (const c of cards) {
      let ok = true;
      if (scene.mode === Cesium.SceneMode.SCENE3D) {
        try { if (!occluder.isPointVisible(c.cartesian)) ok = false; } catch { /* comfort only */ }
      }
      let win = null;
      if (ok) {
        win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, c.cartesian, scratch);
        if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y)) ok = false;
      }
      if (!ok) { c.el.style.visibility = 'hidden'; c.dot.style.visibility = 'hidden'; c.line.style.visibility = 'hidden'; continue; }
      visible.push({ c, x: win.x, y: win.y });
    }
    // Card floats ABOVE its ground dot with a leader line dropping to it (like the
    // upstream reveal). Process the lowest points first and stack upward so several
    // cards near one spot don't overlap.
    visible.sort((a, b) => b.y - a.y);
    let lastTop = Infinity;
    for (const p of visible) {
      p.c.dot.style.visibility = 'visible';
      p.c.dot.style.transform = `translate(${Math.round(p.x - 6)}px, ${Math.round(p.y - 6)}px)`;
      p.c.el.style.visibility = 'visible';
      const w = p.c.el.offsetWidth || 252;
      const h = p.c.el.offsetHeight || 90;
      const cx = Math.max(8, Math.min(p.x - w / 2, Math.max(8, vw - w - 8)));
      let cy = p.y - ANCHOR_OFFSET_PX - h; // above the point
      let below = false;
      if (cy < 8) { cy = p.y + ANCHOR_OFFSET_PX; below = true; } // no room above → below
      if (!below && cy + h > lastTop - CARD_GAP_PX) cy = lastTop - CARD_GAP_PX - h; // stack upward
      cy = Math.max(8, Math.min(cy, Math.max(8, vh - h - 8)));
      lastTop = cy;
      p.c.el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
      // leader line: ground dot → the card's near-edge centre
      const ax = cx + w / 2;
      const ay = cy > p.y ? cy : cy + h;
      const dxl = ax - p.x;
      const dyl = ay - p.y;
      p.c.line.style.visibility = 'visible';
      p.c.line.style.width = `${Math.round(Math.hypot(dxl, dyl))}px`;
      p.c.line.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) rotate(${(Math.atan2(dyl, dxl) * 180 / Math.PI).toFixed(1)}deg)`;
    }
  }

  function setRevealed(next) {
    const b = Boolean(next);
    if (b === revealed) return;
    revealed = b;
    place();
  }

  async function showFor(region = 'gulf') {
    layer.hidden = false;
    const hit = cache.get(region);
    if (hit && now() - hit.at < REFETCH_TTL_MS) return draw(hit.items, region);
    if (!inFlight) {
      inFlight = Promise.resolve(fetchImpl(region))
        .then((p) => { cache.set(region, { items: p?.items || [], at: now() }); return p; })
        .finally(() => { inFlight = null; });
    }
    try { const payload = await inFlight; return draw(payload?.items || [], region); }
    catch { clear(); return 0; }
  }

  const postRender = viewer.scene.postRender;
  let removePostRender = null;
  if (postRender?.addEventListener) {
    postRender.addEventListener(place);
    removePostRender = () => postRender.removeEventListener(place);
  }

  function destroy() {
    clear();
    removePostRender?.();
    removePostRender = null;
    try { layer.remove(); } catch { /* */ }
  }

  return { showFor, setRevealed, clear, destroy, get count() { return cards.length; } };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-hotcards-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-hotcards-style';
  style.textContent = `
.oko-hotcards{position:absolute;inset:0;z-index:59;pointer-events:none;overflow:hidden;}
.oko-hotcards[hidden]{display:none;}
.oko-hc-pin{position:absolute;top:0;left:0;width:12px;height:12px;border-radius:50%;
  background:var(--hc-accent,#39d0ff);box-shadow:0 0 0 2px rgba(11,22,34,.85),0 0 12px var(--hc-accent,#39d0ff);
  pointer-events:none;will-change:transform;z-index:1;}
.oko-hc-line{position:absolute;top:0;left:0;height:2px;transform-origin:0 0;pointer-events:none;will-change:transform,width;
  background:linear-gradient(90deg,var(--hc-accent,#39d0ff),transparent);opacity:.9;}
.oko-hotcard{position:absolute;top:0;left:0;width:252px;max-width:calc(100vw - 16px);
  padding:7px 9px 6px;border-radius:10px;background:rgba(11,22,34,.92);
  border:1px solid rgba(57,208,255,.26);border-left:3px solid var(--hc-accent,#39d0ff);
  box-shadow:0 6px 22px rgba(0,0,0,.5);backdrop-filter:blur(6px);pointer-events:auto;
  text-decoration:none;color:#dbeafe;
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  will-change:transform;transition:opacity .2s ease;}
.oko-hotcard:hover{border-color:var(--hc-accent,#39d0ff);}
.oko-hotcard:hover .oko-hc-title{color:#fff;}
.oko-hc-thumb{position:relative;width:100%;height:92px;border-radius:7px;overflow:hidden;margin-bottom:6px;background:#0b1622;}
.oko-hc-thumb[hidden]{display:none;}
.oko-hc-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.oko-hc-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:34px;border-radius:50%;
  background:rgba(11,22,34,.72);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;
  padding-left:2px;box-shadow:0 0 0 1px rgba(255,255,255,.35);}
.oko-hc-head{display:flex;align-items:center;gap:6px;margin-bottom:3px;}
.oko-hc-mt{font-size:8px;color:#5b6f84;margin-top:2px;letter-spacing:.03em;text-transform:uppercase;}
.oko-hc-mt[hidden]{display:none;}
.oko-hc-badge{font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--hc-accent,#39d0ff);border:1px solid currentColor;border-radius:5px;padding:0 5px;line-height:1.5;}
.oko-hc-place{font-size:9px;letter-spacing:.04em;color:#8aa0b6;text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oko-hc-title{font-size:11px;line-height:1.32;color:#eaf2ff;
  display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;}
.oko-hc-meta{font-size:9px;color:#6f8398;margin-top:3px;letter-spacing:.02em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oko-hc-foot{font-size:8px;color:#5b6f84;margin-top:2px;letter-spacing:.03em;text-transform:uppercase;}
`;
  (doc.head || doc.documentElement)?.appendChild(style);
}
