// src/ukraineEventsLayer.js
//
// UDALOSTI modulu UKRAJINA na glóbuse (etapa 3b, 2026-09-19; plán
// docs/drafts/ukrajina-plan.md „Návrh: karty udalostí a časová os"). Používateľ
// chce rozloženie ako v upstream scéne „Hormuz Blockade", ale NIE kópiu kariet
// ZÁLIV-u (gulfIncidentCards.js ostáva nedotknutý, ZÁLIV sa premigruje neskôr):
//
//  - každá udalosť je BOD na zemi (PointPrimitiveCollection — tisíce bodov za
//    30 dní bez DOM), farba = závažnosť, veľkosť = závažnosť; bez
//    CLAMP_TO_GROUND (pasca CPU pri Google 3D dlaždiciach), výška RAZ z resolvera
//    terénu v dávkach, dovtedy bod nad elipsoidom s vypnutým testom hĺbky;
//  - tri úrovne priblíženia: nad 600 km ZHLUKY (štvorec s počtom), 150–600 km
//    MINI ČIPY (glyf + miesto) k najzávažnejším udalostiam v zábere, pod 150 km
//    KARTY (najviac 8, výber pickCards) + čipy k ďalším; vybraná udalosť (klik
//    na bod alebo čip) má kartu vždy;
//  - karta (2026-09-24 zmenšená, používateľ: „nemusia byť také veľké“): predvolene
//    MALÁ — glyf typu, miesto, čas, dva riadky textu; PLNÁ až po výbere (klik na
//    bod/kartu): čipy typ + čas, úroveň overenia, text, MT označenie, fotka/video
//    (náhľad cez /api/img, lightbox — YouTube nocookie, Telegram embed, ArmyInform
//    mp4), pätička zdroj · odkaz von. Bez náhľadu nikdy prázdny rámček: video či
//    fotky bez obrázka = odkaz v pätičke, čisto textový príspevok nemá médium;
//  - rozmiestnenie: 8 kandidátov okolo kotvy (hore, dole, vpravo, vľavo, 4 rohy)
//    bez prekrytia kariet ANI panelov (os, dok, ľavý a pravý pruh — sú nad
//    vrstvou kariet); karta bez voľného miesta sa neukáže (bod ostane, klik ju
//    otvorí), vybraná vždy; značky kotiev pod kartami; vodiaca čiara, orez za obzorom.
//
// Etická čiara: udalosti a infraštruktúra, nikdy osoby — žiadne mená, jednotky
// ani polohy ukrajinských síl; počty obetí len ako „hlásené". Vrstva NIE JE
// v registri správcu vrstiev (tokeny plné) — riadi ju panel UKRAJINA a časová os.

import * as Cesium from 'cesium';
import { EVENT_TYPES, SEVERITY_RANK, clusterEvents, eventCardModel, pickCards } from './data/ukraineEvents.js';
import { defaultTerrainSampler } from './data/ukraineBaseLayer.js';
import { currentLanguage, t } from './i18n.js';
import { translateText } from './translate.js';

export const UKRAINE_EVENTS_ID = 'ukraine-events';
export const SEV_COLOR = Object.freeze({ critical: '#f87171', major: '#ffb547', minor: '#39d0ff' });
export const SEV_SIZE = Object.freeze({ critical: 9, major: 7, minor: 5 });
/** Monochromatické glyfy typov (VS15 vynúti textovú, nie emoji podobu). */
export const TYPE_GLYPH = Object.freeze({
  strike: '✸', artillery: '◆', ground: '⚔︎', 'air-defence': '◎', infrastructure: '⌂', naval: '≋', fire: '▲', civil: '●', alert: '△', other: '·', hotspot: '▪',
});
/** Vojnové požiare (odvodený satelitný signál) majú vlastnú farbu, nie farbu závažnosti. */
export const HOTSPOT_COLOR = '#ff8a3d';
export const LOD_CLUSTER_ABOVE_M = 600_000;
export const LOD_CHIPS_ABOVE_M = 150_000;
export const MAX_CARDS = 6;
export const MAX_CHIPS = 24;
const ANCHOR_GAP_PX = 16;
const LIFT_BATCH = 200;
const HOVER_PICK_MS = 90;
const IMG_API = '/api/img';

const INERT = {
  id: UKRAINE_EVENTS_ID, show() {}, hide() {}, isShown: () => false, setRevealed() {}, setEvents() {}, setFilter() {}, select() {},
  openMedia() {}, closeMedia() {}, getState: () => ({ shown: false, revealed: false, total: 0, inView: 0, lod: 'cluster', selectedId: null, types: null }),
  onChange() { return () => {}; }, destroy() {},
};

/** Kandidáti umiestnenia karty okolo kotvy (poradie = preferencia). Pure. */
export function placementCandidates(x, y, w, h, gap = ANCHOR_GAP_PX) {
  return [
    { x: x - w / 2, y: y - gap - h }, // hore
    { x: x + gap, y: y - h / 2 }, // vpravo
    { x: x - w - gap, y: y - h / 2 }, // vľavo
    { x: x - w / 2, y: y + gap }, // dole
    { x: x + gap, y: y - gap - h }, // pravý horný roh
    { x: x - w - gap, y: y - gap - h }, // ľavý horný roh
    { x: x + gap, y: y + gap }, // pravý dolný roh
    { x: x - w - gap, y: y + gap }, // ľavý dolný roh
  ];
}
const overlaps = (a, b, pad = 4) => !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
/** Prvý kandidát bez prekrytia a v okne; inak najbližší k okraju. Pure. */
export function placeBox(anchor, size, placed, viewport, gap = ANCHOR_GAP_PX) {
  const { w, h } = size;
  const inside = (c) => c.x >= 6 && c.y >= 6 && c.x + w <= viewport.w - 6 && c.y + h <= viewport.h - 6;
  const candidates = placementCandidates(anchor.x, anchor.y, w, h, gap);
  for (const c of candidates) {
    if (!inside(c)) continue;
    if (placed.some((p) => overlaps({ ...c, w, h }, p))) continue;
    return { x: c.x, y: c.y, w, h, free: true };
  }
  for (const c of candidates) {
    if (placed.some((p) => overlaps({ ...c, w, h }, p))) continue;
    return { x: Math.max(6, Math.min(c.x, viewport.w - w - 6)), y: Math.max(6, Math.min(c.y, viewport.h - h - 6)), w, h, free: false };
  }
  const c = candidates[0];
  return { x: Math.max(6, Math.min(c.x, viewport.w - w - 6)), y: Math.max(6, Math.min(c.y, viewport.h - h - 6)), w, h, free: false };
}

/**
 * Panely nad vrstvou kariet (z-index > 58), ktoré karta nesmie zakryť — inak
 * by bola pod nimi schovaná: časová os, dok, ľavý a pravý pruh, horná lišta a
 * ostrovy rámu KARTY (titulok, legenda, prehľadová mapka, nástroje).
 */
export const CARD_OBSTACLE_SELECTOR = [
  '.oko-ukr-timeline', '#command-dock', '#title-bar', '#top-center-actions',
  '#left-panel-stack > .panel-collapsible', '#left-panel-stack > .oko-conflicts-launch',
  '#right-context-rail .panel-collapsible', '.oko-karta-island',
  '#oko-appbar', '#oko-sheet', // mobilný plášť
  '.oko-scale', // mierka v km (režim mapy)
].join(', ');
/** Obdĺžniky prekážok (okno) → súradnice kontajnera, orezané na výrez; mimo výrezu vypadnú. Pure. */
export function obstacleBoxes(rects, origin = { left: 0, top: 0 }, viewport = { w: Infinity, h: Infinity }) {
  const out = [];
  for (const r of rects || []) {
    if (!r || !(r.width > 0) || !(r.height > 0)) continue;
    const x0 = Math.max(0, r.left - origin.left); const y0 = Math.max(0, r.top - origin.top);
    const x1 = Math.min(viewport.w, r.left - origin.left + r.width); const y1 = Math.min(viewport.h, r.top - origin.top + r.height);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, obstacle: true });
  }
  return out;
}
const insideBox = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
/**
 * Posunie obdĺžnik na najbližšie miesto mimo všetkých prekážok (v okne); inak ho
 * nechá. Kandidáti sú krížový súčin okrajov prekážok v OBOCH osiach — pri paneli
 * vľavo a osi dole je voľné miesto „vpravo od panela A nad osou". Pure.
 */
export function clearOfObstacles(box, obstacles, viewport, pad = 6) {
  const hits = obstacles.filter((o) => overlaps(box, o, 0));
  if (!hits.length) return box;
  const xs = [box.x]; const ys = [box.y];
  for (const o of obstacles) { xs.push(o.x + o.w + pad, o.x - box.w - pad); ys.push(o.y + o.h + pad, o.y - box.h - pad); }
  const cands = [];
  for (const x of xs) for (const y of ys) cands.push({ ...box, x, y });
  const inside = (c) => c.x >= 6 && c.y >= 6 && c.x + c.w <= viewport.w - 6 && c.y + c.h <= viewport.h - 6;
  cands.sort((a, b) => (Math.abs(a.x - box.x) + Math.abs(a.y - box.y)) - (Math.abs(b.x - box.x) + Math.abs(b.y - box.y)));
  return cands.find((c) => inside(c) && !obstacles.some((o) => overlaps(c, o, 0))) || box;
}
/**
 * Rozmiestnenie kariet a čipov (poradie = priorita): prekážky sú od začiatku
 * „položené", takže ich karta obíde; kotva pod panelom alebo karta bez voľného
 * miesta = skryť (okrem vybranej, tá sa ukáže vždy). Pure.
 * @param {Array<{id:string, x:number, y:number, w:number, h:number, gap?:number, selected?:boolean}>} items
 * @returns {Map<string, {x:number,y:number,w:number,h:number,free:boolean}|null>}
 */
export function layoutCards(items, { viewport, obstacles = [] } = {}) {
  const placed = obstacles.map((o) => ({ ...o }));
  const out = new Map();
  for (const it of items || []) {
    if (!it.selected && obstacles.some((o) => insideBox(it, o))) { out.set(it.id, null); continue; }
    const gap = it.gap ?? ANCHOR_GAP_PX;
    let box = placeBox({ x: it.x, y: it.y }, { w: it.w, h: it.h }, placed, viewport, gap);
    if (!box.free && !it.selected) { out.set(it.id, null); continue; }
    // Vybraná (ide prvá, `placed` = len prekážky): radšej kdekoľvek mimo panelov než pod nimi.
    if (!box.free) box = clearOfObstacles(box, obstacles, viewport);
    placed.push(box);
    out.set(it.id, box);
  }
  return out;
}
/** Tvar slova pre počet (sk: 1 / 2–4 / 5+; en: 1 / viac). Pure. */
export function pluralForm(n, lang = 'sk') {
  const k = Math.abs(Math.trunc(Number(n) || 0));
  if (k === 1) return 'one';
  if (lang === 'sk' && k >= 2 && k <= 4) return 'few';
  return 'many';
}
/** Krátky čas do malej karty: dnešok (UTC) = „HH:MM UTC", inak „D.M." — pásmo nahlas, nie miestny čas. Pure. */
export function compactTimeText(ev, nowMs) {
  const d = new Date(ev?.t);
  if (Number.isNaN(d.getTime())) return '';
  const date = `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
  if (ev.dayOnly) return date;
  const today = new Date(nowMs);
  const same = d.getUTCFullYear() === today.getUTCFullYear() && d.getUTCMonth() === today.getUTCMonth() && d.getUTCDate() === today.getUTCDate();
  return same ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC` : date;
}
/** Médiá, ktoré sa dajú ukázať (video/fotky); čisto textový príspevok nie je médium. Pure. */
export function showableMedia(media) {
  return (Array.isArray(media) ? media : []).filter((m) => m && m.kind !== 'text' && (m.kind === 'video' || m.kind === 'photo' || m.thumb || m.embed || m.videoUrl || m.photos?.length));
}

/** Úroveň priblíženia podľa výšky kamery (m). Pure. */
export function lodForHeight(heightM) {
  if (!Number.isFinite(heightM) || heightM > LOD_CLUSTER_ABOVE_M) return 'cluster';
  if (heightM > LOD_CHIPS_ABOVE_M) return 'chips';
  return 'cards';
}
/** Veľkosť bunky zhluku (°) podľa výšky kamery. Pure. */
export function clusterCellDeg(heightM) {
  if (heightM > 3_000_000) return 1.0;
  if (heightM > 1_500_000) return 0.5;
  return 0.25;
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createUkraineEventsLayer({
  viewer,
  translate = t,
  lang = currentLanguage(),
  terrainSampler = defaultTerrainSampler,
  translateTextImpl = translateText,
  now = () => Date.now(),
  documentRef = null,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  // ── DOM ──────────────────────────────────────────────────────────────────
  const layer = doc.createElement('div');
  layer.className = 'oko-ukr-cards';
  layer.hidden = true;
  viewer.container.appendChild(layer);
  const lightbox = doc.createElement('div');
  lightbox.className = 'oko-ukr-lightbox';
  lightbox.hidden = true;
  viewer.container.appendChild(lightbox);

  // ── Cesium ───────────────────────────────────────────────────────────────
  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const clusterPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const clusterLabels = scene.primitives.add(new Cesium.LabelCollection());
  points.show = false; clusterPoints.show = false; clusterLabels.show = false;
  const heightCache = new Map(); // "lat,lon" -> výška (m) nad elipsoidom
  const scratch2 = new Cesium.Cartesian2();
  let occluder = null;

  // ── stav ─────────────────────────────────────────────────────────────────
  let _shown = false;
  let _revealed = true;
  let _events = [];
  let _filtered = [];
  let _types = null; // Set | null = všetko
  let _selectedId = null;
  let _hoverId = null;
  let _lod = 'cluster';
  let _inView = [];
  let _cards = new Map(); // id -> { model, ev, el, pin, line, cartesian, kind: 'card'|'chip' }
  let _chipExtra = new Map(); // id čipu -> počet ďalších udalostí toho istého miesta
  const _chipOwner = new Map(); // miesto -> id udalosti s čipom
  let _clusterCells = [];
  let _destroyed = false;
  let _liftChain = Promise.resolve();
  let _dirty = true;
  let _lastCamKey = '';
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };
  const hKey = (ev) => `${ev.lat.toFixed(4)},${ev.lon.toFixed(4)}`;
  const posFor = (ev) => Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat, heightCache.get(hKey(ev)) ?? 0);
  const cameraHeight = () => { try { return scene.camera.positionCartographic.height; } catch { return Infinity; } };

  // ── body ─────────────────────────────────────────────────────────────────
  function rebuildPoints() {
    points.removeAll();
    for (const ev of _filtered) {
      if (!Number.isFinite(ev.lat) || !Number.isFinite(ev.lon)) continue;
      const hotspot = ev.type === 'hotspot';
      points.add({
        position: posFor(ev),
        color: hotspot ? Cesium.Color.fromCssColorString(HOTSPOT_COLOR).withAlpha(ev.severity === 'major' ? 0.85 : 0.55) : Cesium.Color.fromCssColorString(SEV_COLOR[ev.severity] || SEV_COLOR.minor).withAlpha(ev.approx ? 0.55 : 0.92),
        pixelSize: hotspot ? 3.5 : (SEV_SIZE[ev.severity] || 5),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { ukraineEvent: ev.id, hotspotMinor: hotspot && ev.severity !== 'major' },
      });
    }
    requestRender();
    void lift();
  }
  /** Jednorazový zdvih na terén: dávky 200 bodov, single-flight, cache podľa súradníc. */
  function lift() {
    if (typeof terrainSampler !== 'function') return Promise.resolve();
    _liftChain = _liftChain.then(async () => {
      if (_destroyed || !_shown) return;
      const pending = [];
      const seen = new Set();
      for (const ev of _filtered) {
        if (!Number.isFinite(ev.lat) || !Number.isFinite(ev.lon)) continue;
        const k = hKey(ev);
        if (heightCache.has(k) || seen.has(k)) continue;
        seen.add(k); pending.push({ k, lon: ev.lon, lat: ev.lat });
      }
      for (let i = 0; i < pending.length && !_destroyed; i += LIFT_BATCH) {
        const batch = pending.slice(i, i + LIFT_BATCH);
        let heights = null;
        try { heights = await terrainSampler(batch.map((p) => [p.lon, p.lat])); } catch { heights = null; }
        if (!Array.isArray(heights)) break;
        batch.forEach((p, j) => { if (Number.isFinite(heights[j])) heightCache.set(p.k, heights[j]); });
      }
      if (_destroyed) return;
      // Prepíš polohy bodov aj kotiev kariet (bez rebuildu).
      const byId = new Map(_filtered.map((ev) => [ev.id, ev]));
      for (let i = 0; i < points.length; i += 1) {
        const p = points.get(i);
        const ev = byId.get(p.id?.ukraineEvent);
        if (ev && heightCache.has(hKey(ev))) p.position = posFor(ev);
      }
      for (const c of _cards.values()) c.cartesian = posFor(c.ev);
      requestRender();
    }).catch(() => {});
    return _liftChain;
  }

  function rebuildClusters() {
    clusterPoints.removeAll(); clusterLabels.removeAll();
    const cell = clusterCellDeg(cameraHeight());
    _clusterCells = clusterEvents(_filtered, cell);
    for (const c of _clusterCells) {
      const pos = Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 0);
      const size = Math.min(26, 8 + Math.round(4 * Math.log2(1 + c.count)));
      clusterPoints.add({ position: pos, color: Cesium.Color.fromCssColorString(SEV_COLOR[c.severity] || SEV_COLOR.minor).withAlpha(0.35), pixelSize: size + 8, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      clusterPoints.add({ position: pos, color: Cesium.Color.fromCssColorString(SEV_COLOR[c.severity] || SEV_COLOR.minor).withAlpha(0.9), pixelSize: size, outlineColor: Cesium.Color.BLACK.withAlpha(0.7), outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      clusterLabels.add({
        position: pos, text: String(c.count), font: '700 11px "IBM Plex Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString('#0b1622'), showBackground: false,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, scale: c.count >= 100 ? 0.85 : 1,
      });
    }
  }

  // ── výber a karty ────────────────────────────────────────────────────────
  function viewRect() {
    try { return scene.camera.computeViewRectangle(Cesium.Ellipsoid.WGS84) || null; } catch { return null; }
  }
  function eventsInView() {
    const rect = viewRect();
    if (!rect) return [];
    const w = Cesium.Math.toDegrees(rect.west); const e = Cesium.Math.toDegrees(rect.east);
    const s = Cesium.Math.toDegrees(rect.south); const n = Cesium.Math.toDegrees(rect.north);
    return _filtered.filter((ev) => Number.isFinite(ev.lat) && ev.lat >= s && ev.lat <= n && ev.lon >= w && ev.lon <= e);
  }
  const rank = (a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.t - a.t) || ((b.reports || 0) - (a.reports || 0));

  /** Prepočet výberu kariet/čipov podľa priblíženia a záberu (po pohybe kamery, zmene dát, výbere). */
  function recompute() {
    if (_destroyed) return;
    _lod = lodForHeight(cameraHeight());
    _inView = eventsInView();
    const wanted = new Map(); // id -> 'card'|'chip'
    if (_lod !== 'cluster') {
      const cards = _lod === 'cards' ? pickCards(_inView, { max: MAX_CARDS }) : [];
      for (const ev of cards) wanted.set(ev.id, 'card');
      const rest = [..._inView].sort(rank).filter((ev) => !wanted.has(ev.id) && Number.isFinite(ev.lat) && !ev.noCard);
      const chipMax = _lod === 'cards' ? Math.max(0, MAX_CHIPS - cards.length) : MAX_CHIPS;
      // Jeden čip na miesto (Izium ×3 → jeden čip „Izium +2"); ostatné udalosti
      // miesta ostávajú bodmi a vojdú do karty po kliknutí.
      const seenPlace = new Set(cards.map((ev) => (ev.place || '').toLowerCase()).filter(Boolean));
      _chipExtra = new Map();
      for (const ev of rest) {
        const key = (ev.place || `${ev.lat.toFixed(2)},${ev.lon.toFixed(2)}`).toLowerCase();
        if (seenPlace.has(key)) { const owner = _chipOwner.get(key); if (owner && wanted.get(owner) === 'chip') _chipExtra.set(owner, (_chipExtra.get(owner) || 0) + 1); continue; }
        if (wanted.size - cards.length >= chipMax) break;
        seenPlace.add(key); _chipOwner.set(key, ev.id);
        wanted.set(ev.id, 'chip');
      }
    }
    if (_selectedId) {
      const sel = _filtered.find((ev) => ev.id === _selectedId);
      if (sel && Number.isFinite(sel.lat) && !sel.noCard) wanted.set(sel.id, 'card');
    }
    // Zruš, čo už netreba; vytvor nové; zmeň druh kde treba.
    for (const [id, c] of _cards) {
      const kind = wanted.get(id);
      if (!kind || kind !== c.kind) { removeCard(c); _cards.delete(id); }
    }
    for (const [id, kind] of wanted) {
      if (_cards.has(id)) { const c = _cards.get(id); if (c.kind === 'chip') updateChipExtra(c); continue; }
      const ev = _filtered.find((x) => x.id === id);
      if (ev) _cards.set(id, makeCardRecord(ev, kind));
    }
    points.show = _shown && _revealed && _lod !== 'cluster';
    // Vojnové požiare: zďaleka (čipy) len tie s prísnym filtrom modelu (major),
    // všetky až pri kartách — 2 000 oranžových bodov za týždeň inak prekryje front.
    for (let i = 0; i < points.length; i += 1) {
      const p = points.get(i);
      if (p.id?.hotspotMinor) p.show = _lod === 'cards';
    }
    const clusters = _shown && _revealed && _lod === 'cluster';
    if (clusters) rebuildClusters();
    clusterPoints.show = clusters; clusterLabels.show = clusters;
    // Výber kariet sa zmenil (nové, výber, iná veľkosť) → rozmiestniť pri
    // najbližšom snímku aj bez pohybu kamery. Predtým sa tu príznak nuloval a
    // vybraná (väčšia) karta aj nové karty ostali na starom mieste / v rohu.
    _dirty = true;
    requestRender();
    emit();
  }

  function removeCard(c) {
    try { c.el.remove(); c.pin.remove(); c.line?.remove(); } catch { /* */ }
  }
  /** Karta zmenila veľkosť alebo okolie (obrázok, preklad, panel) → rozmiestniť pri ďalšom snímku. */
  function markLayoutDirty() {
    _dirty = true;
    requestRender();
  }
  function el(tag, className, text) { const n = doc.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }

  /** Otvorí médiá udalosti (lightbox) alebo zdroj, keď médium nie je. */
  function openEventMedia(ev, model, media) {
    const first = media[0] || null;
    if (first) openMedia(first, { title: model.title, list: media, ev });
    else if (model.url) { try { globalThis.open?.(model.url, '_blank', 'noopener'); } catch { /* */ } }
  }
  /** „N fotiek" v správnom tvare (1 fotka, 2–4 fotky, 5+ fotiek). */
  function photosText(n) {
    const k = Math.max(1, n);
    return translate(`ukraine.card.photos.${pluralForm(k, lang)}`, { n: k });
  }
  /** Text odkazu na médiá bez náhľadu: „▶ video" / „▣ N fotiek". */
  function mediaLinkText(media) {
    const first = media[0];
    if (first?.kind === 'video') return `▶ ${translate('ukraine.card.video')}`;
    const n = media.reduce((a, m) => a + (m.photos?.length || 1), 0);
    return `▣ ${photosText(n)}`;
  }
  /**
   * Náhľad len so skutočným obrázkom; bez neho (alebo keď sa nenačíta) nikdy
   * prázdny rámček — `onNoImage` pridá odkaz do pätičky.
   */
  function mediaThumb(ev, model, media, onNoImage) {
    const first = media[0] || null;
    const src = model.image || first?.thumb || null;
    if (!src) { if (first) onNoImage({ failed: false }); return null; }
    const box = el('button', 'oko-ukr-card-media is-loading');
    box.type = 'button';
    const isVideo = first?.kind === 'video';
    // Kým obrázok nepríde, znak typu média — nie prázdny tmavý rámček.
    if (!isVideo) box.appendChild(el('span', 'oko-ukr-card-media-wait', '▣'));
    const img = doc.createElement('img');
    // eager: načíta sa už pri malej karte (rámček je skrytý), po rozbalení je hotový.
    img.alt = ''; img.decoding = 'async'; img.loading = 'eager'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => { box.classList.remove('is-loading'); });
    img.addEventListener('error', () => { box.remove(); onNoImage({ failed: true }); markLayoutDirty(); });
    img.src = `${IMG_API}?url=${encodeURIComponent(src)}`;
    box.appendChild(img);
    if (isVideo) box.appendChild(el('span', 'oko-ukr-play', '▶'));
    const n = media.length + (model.image && !first ? 1 : 0);
    if (n > 1) box.appendChild(el('span', 'oko-ukr-media-count', `+${n - 1}`));
    box.title = isVideo ? translate('ukraine.card.video') : photosText(n);
    box.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openEventMedia(ev, model, media); });
    return box;
  }

  function makeCardRecord(ev, kind) {
    const model = eventCardModel(ev, { translate, lang });
    const accent = SEV_COLOR[ev.severity] || SEV_COLOR.minor;
    const pin = el('span', `oko-ukr-pin sev-${ev.severity}`);
    pin.style.setProperty('--ukr-accent', accent);
    // Skryté až do prvého rozmiestnenia — inak nová karta blikne v ľavom hornom rohu.
    pin.style.visibility = 'hidden';
    layer.appendChild(pin);
    let node; let line = null;
    if (kind === 'chip') {
      node = el('button', `oko-ukr-minichip sev-${ev.severity}`);
      node.type = 'button';
      node.style.setProperty('--ukr-accent', accent);
      node.appendChild(el('span', 'oko-ukr-glyph', TYPE_GLYPH[ev.type] || TYPE_GLYPH.other));
      node.appendChild(el('span', 'oko-ukr-minichip-text', model.title));
      const chipMedia = showableMedia(ev.media);
      if (chipMedia.length) node.appendChild(el('span', 'oko-ukr-minichip-media', chipMedia[0].kind === 'video' ? '▶' : '▣'));
      const extra = el('span', 'oko-ukr-minichip-extra', '');
      extra.hidden = true;
      node.appendChild(extra);
      node.title = `${model.typeText} · ${model.timeText}`;
      node.addEventListener('click', (e) => { e.stopPropagation(); select(ev.id); });
    } else {
      line = el('span', 'oko-ukr-line');
      line.style.setProperty('--ukr-accent', accent);
      line.style.visibility = 'hidden';
      layer.appendChild(line);
      node = el('article', `oko-ukr-card sev-${ev.severity}${ev.id === _selectedId ? ' is-selected' : ''}`);
      node.style.setProperty('--ukr-accent', accent);
      const head = el('header', 'oko-ukr-card-head');
      head.appendChild(el('span', 'oko-ukr-chip oko-ukr-chip-type', `${TYPE_GLYPH[ev.type] || ''} ${model.typeText}`.trim()));
      head.appendChild(el('span', 'oko-ukr-chip oko-ukr-chip-time', model.timeText));
      head.appendChild(el('span', `oko-ukr-level is-${ev.level}`, model.levelText));
      const close = el('button', 'oko-ukr-card-close', '×');
      close.type = 'button'; close.title = translate('ukraine.card.close');
      close.addEventListener('click', (e) => { e.stopPropagation(); if (_selectedId === ev.id) select(null); else { removeCard(_cards.get(ev.id)); _cards.delete(ev.id); } });
      head.appendChild(close);
      node.appendChild(head);
      // Predmet: v malej karte glyf + „≈" + miesto + čas + ikona média; v plnej miesto a „približná poloha".
      const media = showableMedia(model.media);
      const subject = el('div', 'oko-ukr-card-subject');
      subject.appendChild(el('span', 'oko-ukr-card-glyph', TYPE_GLYPH[ev.type] || TYPE_GLYPH.other));
      if (model.approx) { const m = el('span', 'oko-ukr-card-approxmark', '≈'); m.title = translate('ukraine.card.approx'); subject.appendChild(m); }
      const titleEl = el('span', 'oko-ukr-card-title', model.title);
      titleEl.title = model.approx ? `${model.title} · ${translate('ukraine.card.approx')}` : model.title;
      subject.appendChild(titleEl);
      if (model.approx) subject.appendChild(el('span', 'oko-ukr-card-approx', ` · ${translate('ukraine.card.approx')}`));
      const flag = (media.length || model.image) ? el('span', 'oko-ukr-card-mediaflag', media[0]?.kind === 'video' ? '▶' : '▣') : null;
      if (flag) subject.appendChild(flag);
      const when = el('span', 'oko-ukr-card-when', compactTimeText(ev, now()));
      when.title = model.timeText;
      subject.appendChild(when);
      node.appendChild(subject);
      node.title = `${model.typeText} · ${model.timeText}`;
      const status = el('div', 'oko-ukr-card-status', model.status || '');
      node.appendChild(status);
      // Malá karta: úroveň overenia (a strojový preklad) vždy viditeľne — poctivé označenie.
      // „Strojový preklad" ide PRED úroveň a neskracuje sa (skracuje sa len úroveň).
      const meta = el('div', `oko-ukr-card-meta is-${ev.level}`);
      const metaMt = el('span', 'oko-ukr-card-meta-mt', `${translate('ukraine.card.mt')} ·`);
      metaMt.hidden = true;
      const metaLevel = el('span', 'oko-ukr-card-meta-level', model.levelText);
      meta.appendChild(metaMt);
      meta.appendChild(metaLevel);
      meta.title = model.levelText;
      node.appendChild(meta);
      const mt = el('div', 'oko-ukr-card-mt', translate('ukraine.card.mt'));
      mt.hidden = true;
      node.appendChild(mt);
      // Strojový preklad stavového riadku (EN správy / UK médiá) do jazyka UI, označený.
      const srcLang = ev.src === 'media' && ev.media?.[0]?.provider !== 'youtube' ? 'uk' : (ev.src === 'news' || ev.src === 'media' ? 'en' : null);
      if (model.status && srcLang && lang && lang !== srcLang && typeof translateTextImpl === 'function') {
        void Promise.resolve(translateTextImpl(model.status, lang, srcLang === 'uk' ? { from: 'uk' } : undefined))
          .then((tr) => {
            if (!tr || !tr.trim() || tr === model.status || _destroyed) return;
            status.textContent = tr; status.title = model.status; mt.hidden = false;
            metaMt.hidden = false;
            meta.title = `${translate('ukraine.card.mt')} · ${model.levelText}`;
            markLayoutDirty();
          })
          .catch(() => {});
      }
      const foot = el('footer', 'oko-ukr-card-foot');
      const srcText = [model.sourceText, ev.sources?.length > 1 ? `+${ev.sources.length - 1}` : null].filter(Boolean).join(' ');
      foot.appendChild(el('span', 'oko-ukr-card-src', srcText));
      let mediaLink = null;
      const addMediaLink = ({ failed = false } = {}) => {
        if (failed && !media.length) { flag?.remove(); return; } // len og:image, ktorý nie je → nič neponúkať
        if (mediaLink || !media.length) return;
        const first = media[0];
        // Fotka, ktorej náhľad zlyhal, by v lightboxe zlyhala znova → otvor príspevok.
        const openPost = failed && first.kind !== 'video' && (first.url || model.url);
        mediaLink = el('button', 'oko-ukr-card-medialink', `${mediaLinkText(media)}${openPost ? ' ↗' : ''}`);
        mediaLink.type = 'button';
        mediaLink.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (openPost) { try { globalThis.open?.(openPost, '_blank', 'noopener'); } catch { /* */ } } else openEventMedia(ev, model, media);
        });
        foot.insertBefore(mediaLink, foot.children[1] || null);
      };
      const thumb = mediaThumb(ev, model, media, addMediaLink);
      if (thumb) node.appendChild(thumb);
      if (model.url) {
        const a = el('a', 'oko-ukr-card-link', `${translate('ukraine.card.source')} ↗`);
        a.href = model.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        foot.appendChild(a);
      }
      node.appendChild(foot);
      node.addEventListener('click', () => { if (_selectedId !== ev.id) select(ev.id); });
    }
    node.style.visibility = 'hidden';
    layer.appendChild(node);
    _dirty = true;
    const record = { model, ev, el: node, pin, line, kind, cartesian: posFor(ev) };
    if (kind === 'chip') updateChipExtra(record);
    return record;
  }
  function updateChipExtra(record) {
    const extra = record.el.querySelector?.('.oko-ukr-minichip-extra');
    if (!extra) return;
    const n = _chipExtra.get(record.ev.id) || 0;
    extra.hidden = !n;
    extra.textContent = n ? `+${n}` : '';
  }

  /** Každý snímok: premietnutie kotiev, orez za obzorom, rozloženie bez prekrytia. */
  function place() {
    if (_destroyed) return;
    // Zmena úrovne priblíženia bez udalosti kamery (skok setView, koliesko bez
    // moveEnd) → prepočet výberu; lacné porovnanie každý snímok.
    if (_shown && lodForHeight(cameraHeight()) !== _lod) onMoveEnd();
    if (!_shown || !_revealed || _lod === 'cluster' || !_cards.size) { layer.style.display = 'none'; return; }
    layer.style.display = 'block';
    const cam = scene.camera;
    const camKey = `${Math.round(cam.positionWC.x / 50)}:${Math.round(cam.positionWC.y / 50)}:${Math.round(cam.positionWC.z / 50)}:${cam.heading.toFixed(3)}:${cam.pitch.toFixed(3)}`;
    if (camKey === _lastCamKey && !_dirty) return; // kamera stojí = nič neprepočítavať
    _lastCamKey = camKey; _dirty = false;
    occluder = occluder || new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, cam.positionWC);
    try { occluder.cameraPosition = cam.positionWC; } catch { /* */ }
    const view = doc.defaultView;
    const vw = viewer.container.clientWidth || view?.innerWidth || 0;
    const vh = viewer.container.clientHeight || view?.innerHeight || 0;
    const viewport = { w: vw, h: vh };
    const obstacles = currentObstacles(viewport);
    const visible = [];
    for (const c of _cards.values()) {
      let ok = true;
      if (scene.mode === Cesium.SceneMode.SCENE3D) { try { if (!occluder.isPointVisible(c.cartesian)) ok = false; } catch { /* */ } }
      let win = null;
      if (ok) {
        win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, c.cartesian, scratch2);
        if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y) || win.x < -40 || win.y < -40 || win.x > vw + 40 || win.y > vh + 40) ok = false;
      }
      if (!ok) { c.el.style.visibility = 'hidden'; c.pin.style.visibility = 'hidden'; if (c.line) c.line.style.visibility = 'hidden'; continue; }
      visible.push({ c, x: win.x, y: win.y });
    }
    // Karty najprv (väčšie, dôležitejšie), potom čipy; vybraná karta úplne prvá.
    visible.sort((a, b) => (Number(b.c.ev.id === _selectedId) - Number(a.c.ev.id === _selectedId)) || (Number(b.c.kind === 'card') - Number(a.c.kind === 'card')) || rank(a.c.ev, b.c.ev));
    const boxes = layoutCards(visible.map((p) => ({
      id: p.c.ev.id, x: p.x, y: p.y,
      w: p.c.el.offsetWidth || (p.c.kind === 'card' ? 204 : 120), h: p.c.el.offsetHeight || (p.c.kind === 'card' ? 52 : 22),
      gap: p.c.kind === 'card' ? ANCHOR_GAP_PX : 8, selected: p.c.ev.id === _selectedId,
    })), { viewport, obstacles });
    for (const p of visible) {
      const box = boxes.get(p.c.ev.id);
      // Bez voľného miesta (alebo kotva pod panelom) radšej nič; bod ostane a klik kartu otvorí.
      if (!box) { p.c.el.style.visibility = 'hidden'; if (p.c.line) p.c.line.style.visibility = 'hidden'; p.c.pin.style.visibility = p.c.kind === 'card' ? 'visible' : 'hidden'; if (p.c.kind === 'card') { const half = 6; p.c.pin.style.transform = `translate(${Math.round(p.x - half)}px, ${Math.round(p.y - half)}px)`; } continue; }
      const half = (p.c.kind === 'card' ? 6 : 4);
      p.c.pin.style.visibility = 'visible';
      p.c.pin.style.transform = `translate(${Math.round(p.x - half)}px, ${Math.round(p.y - half)}px)`;
      p.c.el.style.visibility = 'visible';
      p.c.el.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      if (p.c.line) {
        // vodiaca čiara: kotva → najbližší bod obrysu karty
        const ax = Math.max(box.x, Math.min(p.x, box.x + box.w));
        const ay = Math.max(box.y, Math.min(p.y, box.y + box.h));
        const dx = ax - p.x; const dy = ay - p.y;
        p.c.line.style.visibility = 'visible';
        p.c.line.style.width = `${Math.round(Math.hypot(dx, dy))}px`;
        p.c.line.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) rotate(${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}deg)`;
      }
    }
  }

  /**
   * Je prvok naozaj na obrazovke? Čistý pohľad (V) a skryté panely majú
   * `visibility: hidden` / `opacity: 0`, ale obdĺžnik si nechajú (vzor isVisible
   * v splitFlap.js).
   */
  function elementShown(n) {
    try {
      if (typeof n.checkVisibility === 'function') return n.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      const view = doc.defaultView;
      for (let e = n; e && e.nodeType === 1; e = e.parentElement) {
        const cs = view?.getComputedStyle?.(e);
        if (!cs) break;
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      }
    } catch { /* */ }
    return true;
  }
  /** Prekážky (panely nad kartami) v súradniciach kontajnera; merané najviac raz za 400 ms. */
  let _obstacleCache = { at: -Infinity, key: '', boxes: [] };
  function currentObstacles(viewport) {
    const t = now();
    const key = `${viewport.w}x${viewport.h}`;
    if (t - _obstacleCache.at < 400 && _obstacleCache.key === key) return _obstacleCache.boxes;
    let rects = [];
    try {
      rects = [...doc.querySelectorAll(CARD_OBSTACLE_SELECTOR)]
        .filter((n) => !n.closest?.('[hidden]') && !viewer.container.contains?.(n) && elementShown(n))
        .map((n) => n.getBoundingClientRect());
    } catch { rects = []; }
    let origin = { left: 0, top: 0 };
    try { const r = viewer.container.getBoundingClientRect(); origin = { left: r.left, top: r.top }; } catch { /* */ }
    _obstacleCache = { at: t, key, boxes: obstacleBoxes(rects, origin, viewport) };
    return _obstacleCache.boxes;
  }

  // ── lightbox ─────────────────────────────────────────────────────────────
  function closeMedia() {
    lightbox.hidden = true;
    lightbox.replaceChildren();
  }
  /**
   * Fotka/video: YouTube = nocookie prehrávač (iframe až po kliknutí), Telegram =
   * oficiálny embed príspevku, ArmyInform = mp4 priamo (CC BY 4.0), fotky z
   * Telegram náhľadu cez /api/img. Nikdy sa nesťahuje video na server.
   */
  function openMedia(media, { title = '', list = [], ev = null } = {}) {
    if (!media) return;
    closeMedia();
    const box = el('div', 'oko-ukr-lb-box');
    const head = el('header', 'oko-ukr-lb-head');
    head.appendChild(el('span', 'oko-ukr-lb-title', media.title || title || ''));
    const providerText = media.provider === 'youtube' ? translate('ukraine.media.youtube') : (media.provider === 'telegram' ? translate('ukraine.media.telegram') : (media.provider === 'file' ? translate('ukraine.media.file') : ''));
    const meta = el('span', 'oko-ukr-lb-meta', [media.channel, providerText].filter(Boolean).join(' · '));
    head.appendChild(meta);
    const close = el('button', 'oko-ukr-lb-close', '×'); close.type = 'button'; close.title = translate('ukraine.card.close');
    close.addEventListener('click', closeMedia);
    head.appendChild(close);
    box.appendChild(head);
    const body = el('div', 'oko-ukr-lb-body');
    if (media.provider === 'youtube' && media.embed) {
      const f = doc.createElement('iframe');
      f.src = `${media.embed}?autoplay=1&rel=0`; f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin'; f.title = media.title || 'video';
      body.appendChild(f);
    } else if (media.provider === 'file' && media.videoUrl) {
      const v = doc.createElement('video'); v.controls = true; v.autoplay = true; v.playsInline = true; v.src = media.videoUrl; v.preload = 'metadata';
      body.appendChild(v);
    } else if (media.provider === 'telegram' && media.kind === 'photo' && Array.isArray(media.photos) && media.photos.length) {
      let idx = 0;
      const img = doc.createElement('img'); img.alt = ''; img.decoding = 'async';
      img.addEventListener('error', () => {
        // Galéria bez fotky nemá čo listovať — šípky a počítadlo preč.
        for (const n of [...(body.children || [])]) if (n !== img) n.remove?.();
        if (media.embed) { const f = doc.createElement('iframe'); f.src = media.embed; f.title = media.title || 'Telegram'; f.referrerPolicy = 'strict-origin-when-cross-origin'; img.replaceWith?.(f); }
        else if (media.url) { const a = el('a', 'oko-ukr-lb-link', `${translate('ukraine.media.open')} ↗`); a.href = media.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; img.replaceWith?.(a); }
      });
      const showPhoto = () => { img.src = `${IMG_API}?url=${encodeURIComponent(media.photos[idx])}`; counter.textContent = `${idx + 1} / ${media.photos.length}`; };
      const counter = el('span', 'oko-ukr-lb-counter');
      body.appendChild(img);
      if (media.photos.length > 1) {
        const prev = el('button', 'oko-ukr-lb-nav is-prev', '‹'); prev.type = 'button';
        const next = el('button', 'oko-ukr-lb-nav is-next', '›'); next.type = 'button';
        prev.addEventListener('click', () => { idx = (idx - 1 + media.photos.length) % media.photos.length; showPhoto(); });
        next.addEventListener('click', () => { idx = (idx + 1) % media.photos.length; showPhoto(); });
        body.appendChild(prev); body.appendChild(next); body.appendChild(counter);
      }
      showPhoto();
    } else if (media.provider === 'telegram' && media.embed) {
      const f = doc.createElement('iframe');
      f.src = media.embed; f.title = media.title || 'Telegram'; f.referrerPolicy = 'strict-origin-when-cross-origin';
      body.appendChild(f);
    } else if (media.thumb) {
      const img = doc.createElement('img'); img.alt = ''; img.src = `${IMG_API}?url=${encodeURIComponent(media.thumb)}`;
      body.appendChild(img);
    }
    box.appendChild(body);
    const foot = el('footer', 'oko-ukr-lb-foot');
    if (media.url) { const a = el('a', 'oko-ukr-lb-link', `${translate('ukraine.media.open')} ↗`); a.href = media.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; foot.appendChild(a); }
    if (list.length > 1) {
      const strip = el('div', 'oko-ukr-lb-strip');
      for (const m of list.slice(0, 12)) {
        const b = el('button', `oko-ukr-lb-thumb${m === media ? ' is-active' : ''}`); b.type = 'button';
        if (m.thumb) { const i = doc.createElement('img'); i.alt = ''; i.src = `${IMG_API}?url=${encodeURIComponent(m.thumb)}`; b.appendChild(i); } else b.textContent = m.kind === 'video' ? '▶' : '▣';
        b.addEventListener('click', () => openMedia(m, { title, list, ev }));
        strip.appendChild(b);
      }
      foot.appendChild(strip);
    }
    box.appendChild(foot);
    lightbox.appendChild(box);
    lightbox.hidden = false;
  }
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeMedia(); });
  const onKey = (e) => { if (e.key === 'Escape' && !lightbox.hidden) closeMedia(); };
  doc.addEventListener('keydown', onKey);

  // ── interakcia s bodmi ───────────────────────────────────────────────────
  let handler = null;
  let hoverTimer = null;
  function pickEventId(position) {
    try {
      const picked = scene.pick(position, 7, 7);
      const id = picked?.id?.ukraineEvent || picked?.primitive?.id?.ukraineEvent;
      return typeof id === 'string' ? id : null;
    } catch { return null; }
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_shown || !_revealed || _lod === 'cluster') return;
      const id = pickEventId(e.position);
      if (id) select(id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((e) => {
      if (!_shown || !_revealed || _lod === 'cluster') return;
      if (hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        const id = pickEventId(pos);
        if (id !== _hoverId) {
          _hoverId = id;
          try { scene.canvas.style.cursor = id ? 'pointer' : ''; } catch { /* */ }
          for (const c of _cards.values()) c.el.classList.toggle('is-hover', c.ev.id === id);
        }
      }, HOVER_PICK_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // ── verejné API ──────────────────────────────────────────────────────────
  function applyFilter() {
    _filtered = _types ? _events.filter((ev) => _types.has(ev.type)) : _events.slice();
    if (_selectedId && !_filtered.some((ev) => ev.id === _selectedId)) _selectedId = null;
    for (const c of _cards.values()) removeCard(c);
    _cards = new Map();
    rebuildPoints();
    _dirty = true;
    recompute();
  }
  function setEvents(events) {
    _events = Array.isArray(events) ? events : [];
    applyFilter();
  }
  function setFilter({ types = null } = {}) {
    _types = types instanceof Set ? new Set(types) : (Array.isArray(types) ? new Set(types) : null);
    if (_types && _types.size === EVENT_TYPES.length) _types = null;
    applyFilter();
  }
  function select(id) {
    _selectedId = id || null;
    for (const c of _cards.values()) c.el.classList.toggle('is-selected', c.ev.id === _selectedId);
    _dirty = true;
    recompute();
  }
  function show() {
    if (_destroyed || _shown) return;
    _shown = true;
    layer.hidden = false;
    installHandler();
    _dirty = true;
    recompute();
    void lift();
  }
  function hide() {
    if (!_shown) return;
    _shown = false;
    layer.hidden = true;
    layer.style.display = 'none';
    points.show = false; clusterPoints.show = false; clusterLabels.show = false;
    closeMedia();
    requestRender();
    emit();
  }
  function setRevealed(next) {
    const b = Boolean(next);
    if (b === _revealed) return;
    _revealed = b;
    _dirty = true;
    recompute();
    place();
  }
  function getState() {
    return { shown: _shown, revealed: _revealed, total: _filtered.length, all: _events.length, inView: _inView.length, lod: _lod, selectedId: _selectedId, types: _types ? new Set(_types) : null, clusters: _clusterCells.length };
  }

  // moveEnd nepríde po `setView` (skok bez animácie: obnova odkazu, overenie v
  // pane) — `camera.changed` áno; prepočet je lacný, ale tlmí sa na 120 ms.
  let recomputeTimer = null;
  const onMoveEnd = () => {
    if (!_shown) return;
    if (recomputeTimer) return;
    recomputeTimer = setTimeout(() => { recomputeTimer = null; if (!_destroyed && _shown) { _dirty = true; recompute(); } }, 120);
  };
  try { viewer.camera.moveEnd.addEventListener(onMoveEnd); } catch { /* */ }
  try { viewer.camera.changed.addEventListener(onMoveEnd); } catch { /* */ }
  // Panely sa rozbaľujú/zbaľujú klikom a klávesmi (čistý pohľad V), okno mení
  // veľkosť — kamera pritom stojí, takže bez tohto by karty ostali pod panelom
  // alebo skryté. Po doznení prechodu (350 ms) nové meranie prekážok.
  let uiTimer = null;
  const onUiChange = () => {
    if (!_shown) return;
    if (uiTimer) clearTimeout(uiTimer);
    uiTimer = setTimeout(() => { uiTimer = null; if (_destroyed) return; _obstacleCache.at = -Infinity; markLayoutDirty(); }, 350);
  };
  const UI_EVENTS = ['click', 'keyup', 'pointerup', 'touchend'];
  try { for (const t of UI_EVENTS) doc.addEventListener(t, onUiChange, { capture: true, passive: true }); doc.defaultView?.addEventListener?.('resize', onUiChange); } catch { /* */ }
  const postRender = scene.postRender;
  let removePostRender = null;
  if (postRender?.addEventListener) { postRender.addEventListener(place); removePostRender = () => postRender.removeEventListener(place); }

  function destroy() {
    _destroyed = true;
    hide();
    removePostRender?.();
    try { viewer.camera.moveEnd.removeEventListener(onMoveEnd); } catch { /* */ }
    try { viewer.camera.changed.removeEventListener(onMoveEnd); } catch { /* */ }
    if (recomputeTimer) clearTimeout(recomputeTimer);
    if (handler) { try { handler.destroy(); } catch { /* */ } handler = null; }
    if (hoverTimer) clearTimeout(hoverTimer);
    doc.removeEventListener('keydown', onKey);
    try { for (const t of UI_EVENTS) doc.removeEventListener(t, onUiChange, { capture: true }); doc.defaultView?.removeEventListener?.('resize', onUiChange); } catch { /* */ }
    if (uiTimer) clearTimeout(uiTimer);
    for (const c of _cards.values()) removeCard(c);
    _cards.clear();
    try { scene.primitives.remove(points); scene.primitives.remove(clusterPoints); scene.primitives.remove(clusterLabels); } catch { /* */ }
    try { layer.remove(); lightbox.remove(); } catch { /* */ }
    listeners.clear();
  }

  return {
    id: UKRAINE_EVENTS_ID,
    show, hide, isShown: () => _shown, setRevealed, setEvents, setFilter, select, openMedia, closeMedia, getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ layer, lightbox, points, cards: _cards, filtered: _filtered, heightCache }),
  };
}
