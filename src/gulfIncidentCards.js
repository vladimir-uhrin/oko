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
import { filterSanctionedNews } from './data/sanctionedMedia.js';
import { fetchSituationNews, relativeAge } from './data/situationNews.js';
import { translateText } from './translate.js';
import { currentLanguage, t } from './i18n.js';
import { CARD_OBSTACLE_SELECTOR, obstacleBoxes } from './ukraineEventsLayer.js';

const LINK_IMAGE_API = '/api/link-image';

const SEV_COLOR = Object.freeze({ critical: '#f87171', major: '#ffb547', minor: '#39d0ff' });
const ANCHOR_OFFSET_PX = 14;
const CARD_GAP_PX = 6;
const EDGE_MARGIN_PX = 8;
const REFETCH_TTL_MS = 15 * 60_000;
const MAX_CARDS = 6;
/** Ako často sa nanovo merajú panely a lišty, ktorým sa karty vyhýbajú (ms). */
const OBSTACLE_TTL_MS = 400;

/**
 * Čomu sa hot karty vyhýbajú (2026-10-03, nález zo snímky po vydaní etapy 5: karta miesta mimo
 * záberu sedela v rohu okna CEZ logo, rozbalený panel BLÍZKY VÝCHOD a riadok atribúcie): panely
 * a lišty ako pri kartách UKRAJINY, navyše riadok atribúcie (Google a Cesium musia ostať čitateľné),
 * rohy HUD so súradnicami a štýlom.
 */
export const HOTCARD_OBSTACLE_SELECTOR = `${CARD_OBSTACLE_SELECTOR}, #cesium-credits .cesium-widget-credits, .hud-top-right, .hud-bottom-left, #global-loading-status`;
/**
 * Miesto stavového riadka pod hornou lištou („OBNOVUJEM ŽIVÉ DÁTA…", #global-loading-status:
 * top 74 px, vystredený, najviac ~400 px). Riadok sa objavuje len na chvíľu pri každej obnove
 * dát; jeho miesto je preto vyhradené STÁLE, inak by karta pod lištou pri každej obnove poskočila.
 */
export const HOTCARD_STATUS_ZONE = Object.freeze({ top: 74, width: 420, height: 28 });
/** Kontajnery, ktoré svoj obsah orezávajú a rolujú — z panela v nich je prekážkou len viditeľná časť. */
export const HOTCARD_CLIP_SELECTOR = '#left-panel-stack, #right-context-rail';

/**
 * Viditeľná časť obdĺžnika v orezávajúcom kontajneri (prienik); bez kontajnera celý obdĺžnik,
 * bez prieniku null. Stĺpec panelov roluje: panel odrolovaný pod jeho okraj má stále svoj
 * obdĺžnik v okne, ale nie je ho vidieť — karta sa mu vyhýbať nemá. Pure.
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @param {{left: number, top: number, width: number, height: number}|null} clip
 */
export function clipObstacleRect(rect, clip) {
  if (!rect) return null;
  if (!clip) return rect;
  const left = Math.max(rect.left, clip.left);
  const top = Math.max(rect.top, clip.top);
  const right = Math.min(rect.left + rect.width, clip.left + clip.width);
  const bottom = Math.min(rect.top + rect.height, clip.top + clip.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
/** Posun karty NADOL od jej miesta sa počíta trojnásobne — karta pod svojím miestom zakrýva bodky. */
const DOWN_COST = 3;

/** Leží obdĺžnik na prekážke rozhrania alebo (s medzerou) na niektorej z prvých `count` položených kariet? */
function hotCardBlocked(points, count, obstacles, x, y, w, h) {
  for (let k = 0; k < obstacles.length; k += 1) {
    const o = obstacles[k];
    if (!(x + w <= o.x || o.x + o.w <= x || y + h <= o.y || o.y + o.h <= y)) return true;
  }
  for (let j = 0; j < count; j += 1) {
    const q = points[j];
    if (!(x + w + CARD_GAP_PX <= q.cx || q.cx + q.w + CARD_GAP_PX <= x || y + h + CARD_GAP_PX <= q.cy || q.cy + q.h + CARD_GAP_PX <= y)) return true;
  }
  return false;
}
/** Súradnica kandidáta tesne pri k-tom obdĺžniku (prekážky, potom položené karty): `side` 0 = za ním, 1 = pred ním. */
function besideX(points, obstacles, k, side, w) {
  const n = obstacles.length;
  const bx = k < n ? obstacles[k].x : points[k - n].cx;
  const bw = k < n ? obstacles[k].w : points[k - n].w;
  return side === 0 ? bx + bw + CARD_GAP_PX : bx - CARD_GAP_PX - w;
}
function besideY(points, obstacles, k, side, h) {
  const n = obstacles.length;
  const by = k < n ? obstacles[k].y : points[k - n].cy;
  const bh = k < n ? obstacles[k].h : points[k - n].h;
  return side === 0 ? by - CARD_GAP_PX - h : by + bh + CARD_GAP_PX;
}

/**
 * Rozmiestnenie hot kariet v okne mapy mimo rozhrania (2026-10-03). Karta sedí vystredená nad
 * svojím bodom (keď nad ním v okne nie je miesto, pod ním) a pritiahne sa dovnútra okna — karta
 * miesta mimo záberu tak ostane pri okraji mapy. Keď by ležala na paneli, lište, logu, atribúcii
 * alebo na už položenej karte, vezme NAJBLIŽŠIE voľné miesto: kandidáti sú všetky dvojice
 * „x tesne pri niektorom obdĺžniku alebo vlastné" × „y tesne pri niektorom obdĺžniku alebo
 * vlastné" (voľný roh medzi panelom a lištou potrebuje obe naraz). Posun nadol je trikrát
 * drahší než nahor a do strán, takže karty jedného miesta sa skladajú nahor ako doteraz
 * a nezakrývajú bodky. Bez voľného miesta ostane na svojom (prekrytie je menšie zlo než
 * skrytá správa). Ide sa od najnižšieho bodu.
 *
 * Zapisuje `cx`, `cy` (ľavý horný roh) priamo do položiek a nič nealokuje (beží každú snímku);
 * poradie položiek zmení (zoradí podľa `y` zostupne). Pure okrem zápisu do vstupu.
 * @param {Array<{x: number, y: number, w: number, h: number, cx?: number, cy?: number}>} points body v okne s rozmermi ich kariet
 * @param {{w: number, h: number}} viewport
 * @param {ReadonlyArray<{x: number, y: number, w: number, h: number}>} [obstacles] viditeľné časti rozhrania
 */
export function placeHotCards(points, viewport, obstacles = []) {
  const left = EDGE_MARGIN_PX;
  const top = EDGE_MARGIN_PX;
  const right = Math.max(left, (viewport?.w || 0) - EDGE_MARGIN_PX);
  const bottom = Math.max(top, (viewport?.h || 0) - EDGE_MARGIN_PX);
  points.sort((a, b) => b.y - a.y);
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const maxX = Math.max(left, right - p.w);
    const maxY = Math.max(top, bottom - p.h);
    const x0 = clamp(p.x - p.w / 2, left, maxX);
    let y0 = p.y - ANCHOR_OFFSET_PX - p.h; // nad bodom
    if (y0 < top) y0 = p.y + ANCHOR_OFFSET_PX; // nad bodom nie je miesto → pod ním
    y0 = clamp(y0, top, maxY);
    let bestX = x0;
    let bestY = y0;
    if (hotCardBlocked(points, i, obstacles, x0, y0, p.w, p.h)) {
      const boxes = obstacles.length + i;
      let best = Infinity;
      for (let a = -1; a < 2 * boxes; a += 1) { // −1 = vlastné x; inak tesne pri obdĺžniku (a >> 1), strana (a & 1)
        const nx = a < 0 ? x0 : clamp(besideX(points, obstacles, a >> 1, a & 1, p.w), left, maxX);
        const costX = Math.abs(nx - x0);
        if (costX >= best) continue;
        for (let b = -1; b < 2 * boxes; b += 1) {
          if (a < 0 && b < 0) continue; // vlastné miesto je obsadené
          const ny = b < 0 ? y0 : clamp(besideY(points, obstacles, b >> 1, b & 1, p.h), top, maxY);
          const cost = costX + (ny > y0 ? (ny - y0) * DOWN_COST : y0 - ny);
          if (cost < best && !hotCardBlocked(points, i, obstacles, nx, ny, p.w, p.h)) { best = cost; bestX = nx; bestY = ny; }
        }
      }
    }
    p.cx = bestX;
    p.cy = bestY;
  }
  return points;
}

/** Bod leží v okne mapy a nie je pod panelom — len vtedy má zmysel jeho bodka a vodiaca čiara. Pure. */
export function hotCardAnchorShown(x, y, viewport, obstacles) {
  if (!(x >= 0 && y >= 0 && x <= (viewport?.w || 0) && y <= (viewport?.h || 0))) return false;
  for (const o of obstacles || []) {
    if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return false;
  }
  return true;
}

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
  // Dopyt na región zvlášť a „lístok" poslednej požiadavky (BLÍZKY VÝCHOD etapa 3,
  // 2026-09-26): pri deviatich regiónoch prepnutie dejiska počas načítania už
  // nesmie nakresliť karty predošlého regiónu (dovtedy jeden spoločný inFlight
  // vrátil druhému volaniu údaje prvého a neskorá odpoveď prekreslila aktuálne karty).
  const inFlight = new Map(); // region -> promise
  let ticket = 0;
  let occluder = null;
  const scratch = new Cesium.Cartesian2();
  const cache = new Map(); // region -> { items, at }
  const imgCache = new Map(); // article url -> og:image url | null

  function clearCards() {
    layer.replaceChildren();
    cards = [];
  }
  /** Zmaže karty a zruší platnosť ešte bežiaceho načítania (neskorá odpoveď už nekreslí). */
  function clear() {
    ticket += 1;
    clearCards();
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
    clearCards();
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
  // point and the card floats above it (below it when there is no room above).
  // Cards behind the horizon are culled; a place outside the window keeps its card
  // at the edge of the free map area, without the dot and the leader line; cards
  // stack upward from the lowest point so they do not cover each other.
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
      c.el.style.visibility = 'visible';
      visible.push({ c, x: win.x, y: win.y, w: c.el.offsetWidth || 252, h: c.el.offsetHeight || 90, cx: 0, cy: 0 });
    }
    // Card floats ABOVE its ground dot with a leader line dropping to it (like the
    // upstream reveal). Lowest points first, stacked upward, and every card is kept
    // inside the free map area — clear of the logo, the panel columns, the top bar,
    // the dock and the attribution line (placeHotCards).
    const viewport = { w: vw, h: vh };
    const obstacles = currentObstacles(viewport);
    placeHotCards(visible, viewport, obstacles);
    for (const p of visible) {
      p.c.el.style.transform = `translate(${Math.round(p.cx)}px, ${Math.round(p.cy)}px)`;
      // Bodka a vodiaca čiara len keď je miesto naozaj vidieť: bod mimo okna alebo pod panelom
      // by ťahal čiaru cez rozhranie (karta pri okraji mapy ostáva — „aj tam sa niečo deje").
      if (!hotCardAnchorShown(p.x, p.y, viewport, obstacles)) {
        p.c.dot.style.visibility = 'hidden';
        p.c.line.style.visibility = 'hidden';
        continue;
      }
      p.c.dot.style.visibility = 'visible';
      p.c.dot.style.transform = `translate(${Math.round(p.x - 6)}px, ${Math.round(p.y - 6)}px)`;
      // leader line: ground dot → the card's near-edge centre
      const ax = p.cx + p.w / 2;
      const ay = p.cy > p.y ? p.cy : p.cy + p.h;
      const dxl = ax - p.x;
      const dyl = ay - p.y;
      p.c.line.style.visibility = 'visible';
      p.c.line.style.width = `${Math.round(Math.hypot(dxl, dyl))}px`;
      p.c.line.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) rotate(${(Math.atan2(dyl, dxl) * 180 / Math.PI).toFixed(1)}deg)`;
    }
  }

  // Panely a lišty, ktorým sa karty vyhýbajú, v súradniciach okna mapy. Meria sa najviac raz za
  // OBSTACLE_TTL_MS (place() beží každú snímku; getBoundingClientRect núti prepočet rozloženia).
  let obstacleCache = { at: -Infinity, key: '', boxes: [] };
  function currentObstacles(viewport) {
    const at = now();
    const key = `${viewport.w}x${viewport.h}`;
    if (at - obstacleCache.at < OBSTACLE_TTL_MS && obstacleCache.key === key) return obstacleCache.boxes;
    let rects = [];
    try {
      const clips = new Map(); // orezávajúci kontajner → jeho obdĺžnik (null, keď neorezáva)
      const clipOf = (n) => {
        const box = n.closest?.(HOTCARD_CLIP_SELECTOR);
        if (!box || box === n) return null;
        if (!clips.has(box)) {
          const cs = doc.defaultView?.getComputedStyle?.(box);
          clips.set(box, cs && (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') ? box.getBoundingClientRect() : null);
        }
        return clips.get(box);
      };
      for (const n of doc.querySelectorAll?.(HOTCARD_OBSTACLE_SELECTOR) || []) {
        if (n === layer || layer.contains?.(n)) continue;
        if (n.checkVisibility && !n.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const rect = clipObstacleRect(n.getBoundingClientRect(), clipOf(n));
        if (rect) rects.push(rect);
      }
      if (doc.getElementById?.('global-loading-status')) {
        rects.push({ left: viewport.w / 2 - HOTCARD_STATUS_ZONE.width / 2, top: HOTCARD_STATUS_ZONE.top, width: HOTCARD_STATUS_ZONE.width, height: HOTCARD_STATUS_ZONE.height });
      }
    } catch { rects = []; }
    let origin = { left: 0, top: 0 };
    try { const r = viewer.container.getBoundingClientRect(); origin = { left: r.left, top: r.top }; } catch { /* falošný DOM */ }
    obstacleCache = { at, key, boxes: obstacleBoxes(rects, origin, viewport) };
    return obstacleCache.boxes;
  }

  function setRevealed(next) {
    const b = Boolean(next);
    if (b === revealed) return;
    revealed = b;
    place();
  }

  async function showFor(region = 'gulf') {
    const mine = ++ticket;
    layer.hidden = false;
    const hit = cache.get(region);
    if (hit && now() - hit.at < REFETCH_TTL_MS) return draw(hit.items, region);
    let request = inFlight.get(region);
    if (!request) {
      request = Promise.resolve(fetchImpl(region))
        // Blocklist médií aj na klientovi: server filtruje pred zlúčením, ale
        // disková cache /api/situation-news prežije rozšírenie zoznamu až 6 h
        // (bulletin a UKRAJINA filtrujú znova, karty doteraz nie — 2026-09-26).
        .then((p) => { const items = filterSanctionedNews(p?.items || []).items; cache.set(region, { items, at: now() }); return { ...(p || {}), items }; })
        .finally(() => { inFlight.delete(region); });
      inFlight.set(region, request);
    }
    try {
      const payload = await request;
      return mine === ticket ? draw(payload?.items || [], region) : 0;
    } catch {
      if (mine === ticket) clearCards();
      return 0;
    }
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
