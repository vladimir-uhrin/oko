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
import { currentLanguage, t } from './i18n.js';

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

  let cards = []; // { model, el, cartesian }
  let revealed = false;
  let inFlight = null;
  let occluder = null;
  const scratch = new Cesium.Cartesian2();
  const cache = new Map(); // region -> { items, at }

  function clear() {
    layer.replaceChildren();
    cards = [];
  }

  function makeCard(model) {
    const a = doc.createElement('a');
    a.className = `oko-hotcard oko-hc-${model.severity}`;
    a.href = model.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.setProperty('--hc-accent', SEV_COLOR[model.severity] || SEV_COLOR.minor);

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

    const meta = doc.createElement('div');
    meta.className = 'oko-hc-meta';
    const age = relativeAge(model.publishedAt, now(), translate);
    const parts = [];
    if (model.source) parts.push(model.source);
    if (age) parts.push(age);
    if (model.sourceCount > 1) parts.push(translate('incident.more', { n: model.sourceCount - 1 }));
    meta.textContent = parts.join(' · ');
    a.appendChild(meta);

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
      layer.appendChild(el);
      cards.push({ model, el, cartesian: Cesium.Cartesian3.fromDegrees(model.lon, model.lat) });
    }
    place();
    return cards.length;
  }

  // Project every card, cull behind the horizon / off-screen, and de-overlap the
  // survivors into a downward stack anchored at the first (most-severe) card.
  function place() {
    if (layer.hidden || !revealed || !cards.length) { layer.style.visibility = 'hidden'; return; }
    const scene = viewer.scene;
    layer.style.visibility = 'visible';
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
      if (!ok) { c.el.style.visibility = 'hidden'; continue; }
      visible.push({ c, x: win.x, y: win.y });
    }
    visible.sort((a, b) => a.y - b.y);
    let lastBottom = -Infinity;
    for (const p of visible) {
      p.c.el.style.visibility = 'visible';
      const w = p.c.el.offsetWidth || 214;
      const h = p.c.el.offsetHeight || 70;
      let x = p.x + ANCHOR_OFFSET_PX;
      if (x + w > vw - 8) x = p.x - ANCHOR_OFFSET_PX - w; // no room right → left of the point
      let y = p.y - h / 2;
      if (y < lastBottom + CARD_GAP_PX) y = lastBottom + CARD_GAP_PX; // stack, don't overlap
      x = Math.max(8, Math.min(x, Math.max(8, vw - w - 8)));
      y = Math.max(8, Math.min(y, Math.max(8, vh - h - 8)));
      lastBottom = y + h;
      p.c.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
.oko-hotcard{position:absolute;top:0;left:0;width:214px;max-width:calc(100vw - 16px);
  padding:7px 9px 6px;border-radius:10px;background:rgba(11,22,34,.92);
  border:1px solid rgba(57,208,255,.26);border-left:3px solid var(--hc-accent,#39d0ff);
  box-shadow:0 6px 22px rgba(0,0,0,.5);backdrop-filter:blur(6px);pointer-events:auto;
  text-decoration:none;color:#dbeafe;
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  will-change:transform;transition:opacity .2s ease;}
.oko-hotcard:hover{border-color:var(--hc-accent,#39d0ff);}
.oko-hotcard:hover .oko-hc-title{color:#fff;}
.oko-hc-head{display:flex;align-items:center;gap:6px;margin-bottom:3px;}
.oko-hc-badge{font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--hc-accent,#39d0ff);border:1px solid currentColor;border-radius:5px;padding:0 5px;line-height:1.5;}
.oko-hc-place{font-size:9px;letter-spacing:.04em;color:#8aa0b6;text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oko-hc-title{font-size:11px;line-height:1.28;color:#eaf2ff;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.oko-hc-meta{font-size:9px;color:#6f8398;margin-top:3px;letter-spacing:.02em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oko-hc-foot{font-size:8px;color:#5b6f84;margin-top:2px;letter-spacing:.03em;text-transform:uppercase;}
`;
  (doc.head || doc.documentElement)?.appendChild(style);
}
