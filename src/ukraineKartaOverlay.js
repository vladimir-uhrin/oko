// src/ukraineKartaOverlay.js
/**
 * @module ukraineKartaOverlay
 * @description Rám „hotovej mapy" pre kartografický režim KARTA (K5): titulok
 * so smerom a stavom, legenda podľa zapnutých vrstiev a prehľadová mapka
 * Ukrajiny s obdĺžnikom pohľadu. Tri ostrovy sa ukazujú len na podklade KARTA
 * (kind hillshade) a schovajú sa pri pohľade na planétu (brána priblíženia).
 * Tlačidlo „čistá karta" schová chróm appky (telo dostane triedu
 * `oko-karta-clean`), aby sa dala mapa odfotiť; snímku bakuje `shareSnapshot`.
 *
 * Geometria ostrovov je v `style.css` (test overlayIslands zakazuje `position:
 * fixed` vo vstreknutom `<style>`); tento modul plní len obsah a prepína triedy.
 */
import { frontSceneLabel } from './ukraineFrontScenes.js';
import { UKRAINE_OUTLINE_BBOX, UKRAINE_OUTLINE_RINGS } from './data/ukraineOutline.js';
import { STALE_DIM } from './data/ukraineFreshness.js';

export const KARTA_OVERLAY_ID = 'oko-karta-overlay';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Farby legendy (zhodné s vrstvami KARTA). */
export const KARTA_LEGEND_COLORS = Object.freeze({
  occupied: '#8e2330', uaArea: '#2f6aa3', grey: '#8a8f98', liberated: '#4fa3ff', ru: '#e0553f', contact: '#b3261e',
  pinUa: '#5b8fd0', pinRu: '#d0554a', pinContested: '#f0a53a',
  combat: '#f87171', road: '#2f5ea8', glow: '#ff5a4a', band: '#f0922e',
  // Zmena za týždeň (DEEPSTATE_STYLES.karta.change): obsadené karmínová šrafa, oslobodené modrá.
  // Zmena za 7 dní na KARTE = svetlé plochy s jasnou hranou (DEEPSTATE_STYLES.karta.change).
  gained: '#ff6b78', lost: '#8fd3ff',
  attack: '#ff3b30',
});

/**
 * Projekcia [lon, lat] → { x, y } do rámu mapky (ekvirektangulárna, x stlačené
 * o cos(stredná šírka), zachovaný pomer strán, okraj `pad`). Pure.
 * @param {number[]} bbox [W, S, E, N]
 */
export function makeInsetProjection(bbox, width, height, pad = 6) {
  const [W, S, E, N] = bbox;
  const kx = Math.cos(((S + N) / 2) * Math.PI / 180);
  const geoW = Math.max(1e-6, (E - W) * kx);
  const geoH = Math.max(1e-6, (N - S));
  const availW = Math.max(1, width - pad * 2);
  const availH = Math.max(1, height - pad * 2);
  const s = Math.min(availW / geoW, availH / geoH);
  const ox = pad + (availW - geoW * s) / 2;
  const oy = pad + (availH - geoH * s) / 2;
  const project = (lon, lat) => ({ x: ox + (lon - W) * kx * s, y: oy + (N - lat) * s });
  const rect = (rectDeg) => {
    const a = project(rectDeg[0], rectDeg[3]);
    const b = project(rectDeg[2], rectDeg[1]);
    return { x: a.x, y: a.y, w: Math.max(3, b.x - a.x), h: Math.max(3, b.y - a.y) };
  };
  return { project, rect, scale: s };
}

/** SVG `d` pre prstenec cez danú projekciu. Pure. */
export function insetRingPath(project, ring) {
  if (!Array.isArray(ring) || !ring.length) return '';
  let d = '';
  for (let i = 0; i < ring.length; i += 1) {
    const p = project(ring[i][0], ring[i][1]);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
  }
  return `${d}Z`;
}

/** Titulok: názov smeru (alebo všeobecný) + „stav k …" + zdroje. Pure. */
export function kartaTitleModel({ scene = null, dateText = '', sources = [], changeText = '', translate = (k) => k } = {}) {
  const title = scene ? frontSceneLabel(scene, translate) : translate('ukraine.karta.title');
  // „stav k …“ + zmena za týždeň (odvodená z dvoch snímok mirroru), keď je spočítaná.
  const subtitle = [dateText ? translate('ukraine.karta.state', { date: dateText }) : '', changeText].filter(Boolean).join(' · ');
  return { title, subtitle, sources: sources.filter(Boolean).join(' · ') };
}

/** „Stav k" dátum: hlásenie GŠ, inak DeepState, inak revízia Wikipédie. Pure. */
export function kartaDateText({ report = null, deepstate = null, control = null } = {}) {
  if (report?.reportedAtText) return report.reportedAtText;
  if (deepstate?.stampText) return deepstate.stampText;
  if (control?.revisionAt) return String(control.revisionAt).slice(0, 10);
  return '';
}

/** DeepState je zdroj zón len vtedy, keď naozaj kreslí (načítava sa / 404 / 502 = nie). Pure. */
function deepstateDraws(deepstate) {
  return Boolean(deepstate?.shown) && (deepstate.features === undefined || deepstate.features > 0);
}

/** Zdroje aktívnych vrstiev (na titulok/legendu). Pure. */
/** Text zmeny za týždeň pre titulok: „za 7 dní: RU +12 km² · UA +3 km²"; prázdny bez rozdielu. Pure. */
export function kartaChangeText(deepstate, translate = (k) => k, lang = 'sk') {
  const ch = deepstateDraws(deepstate) ? deepstate.change : null;
  if (!ch || !Number.isFinite(ch.days)) return '';
  const fmt = (v) => Math.round(v || 0).toLocaleString(lang === 'sk' ? 'sk-SK' : 'en-GB');
  return translate('ukraine.karta.change', { days: ch.days, gained: fmt(ch.gainedKm2), lost: fmt(ch.lostKm2) });
}
export function kartaSources({ report = null, deepstate = null, control = null, translate = (k) => k } = {}) {
  const out = [];
  if (report?.shown) out.push(translate('ukraine.karta.src.gs'));
  const dsDraws = deepstateDraws(deepstate);
  const mirror = dsDraws && deepstate.source === 'mirror';
  if (dsDraws) out.push(translate(mirror ? 'ukraine.karta.src.deepstate-mirror' : 'ukraine.karta.src.deepstate'));
  // Pri mirrore ostáva na mape pás bojov z Wikipédie — jej CC BY-SA kredit patrí sem tiež.
  if (control?.shown && (!dsDraws || mirror)) out.push(translate('ukraine.karta.src.wiki'));
  out.push(translate('ukraine.karta.src.osm'));
  return out;
}

/** Položky legendy podľa toho, ktoré vrstvy sú zapnuté. Pure. */
export function kartaLegendItems({ report = null, deepstate = null, control = null, translate = (k) => k } = {}) {
  const c = KARTA_LEGEND_COLORS;
  const items = [];
  if (deepstateDraws(deepstate)) {
    items.push({ key: 'occupied', colorCss: c.occupied, label: translate('ukraine.karta.legend.occupied') });
    // Tón ukrajinskej strany kreslí len štýl karta (DEEPSTATE_STYLES.karta.uaTint).
    if (deepstate.style === 'karta') items.push({ key: 'ua-area', colorCss: c.uaArea, label: translate('ukraine.karta.legend.ua-area') });
    // KARTA (2026-09-26) odvodenú líniu nekreslí — hranu robí obrys polygónu; vzorka len mimo štýlu karta.
    if (deepstate.contact > 0 && deepstate.style !== 'karta') items.push({ key: 'contact', colorCss: c.contact, line: true, label: translate('ukraine.karta.legend.contact') });
    // Mirror šedú zónu nemá — namiesto nej je oranžovo šrafovaný pás cez líniu, odvodený
    // z dnešnej línie (DEEPSTATE_STYLES.karta.combatBand; 2026-09-26, vzorka Rybar).
    // Sivá zóna: archív z API aj mirror celej mapy ju majú (na KARTE oranžová šrafa ako
    // „územie bojov" u Rybara); neúplný mirror nie — vtedy odvodený pás pri línii.
    const hasGrey = deepstate.source !== 'mirror' || (deepstate.counts?.grey || 0) > 0;
    if (hasGrey) items.push({ key: 'grey', colorCss: deepstate.style === 'karta' ? c.band : c.grey, pattern: 'hatch', label: translate('ukraine.karta.legend.grey') });
    else items.push({ key: 'contested', colorCss: c.band, pattern: 'hatch', label: translate('ukraine.karta.legend.contested') });
    if ((deepstate.counts?.liberated || 0) + (deepstate.counts?.['liberated-recent'] || 0) > 0) items.push({ key: 'liberated', colorCss: c.liberated, label: translate('ukraine.karta.legend.liberated') });
    // Zmena za týždeň: vzorky len keď je rozdiel spočítaný a naozaj niečo zmenil.
    const ch = deepstate.change;
    if (ch && Number.isFinite(ch.days)) {
      if (ch.gainedCells > 0) items.push({ key: 'gained', colorCss: c.gained, label: translate('ukraine.karta.legend.gained', { days: ch.days }) });
      if (ch.lostCells > 0) items.push({ key: 'lost', colorCss: c.lost, label: translate('ukraine.karta.legend.lost', { days: ch.days }) });
    }
  } else if (control?.shown) {
    // Zastaraná snímka sa na mape kreslí stlmene — vzorka musí ustúpiť rovnako.
    items.push({ key: 'ru', colorCss: c.ru, label: translate('ukraine.karta.legend.ru'), ...(control.stale ? { dim: STALE_DIM } : {}) });
  }
  // Sídla sú na KARTE šesťuholníky vo farbe strany (ukraineBaseLayer HEX_PIN_PX, vzorka Rybar).
  items.push({ key: 'pin-ua', colorCss: c.pinUa, glyph: 'hex', label: translate('ukraine.karta.legend.pin-ua') });
  items.push({ key: 'pin-ru', colorCss: c.pinRu, glyph: 'hex', label: translate('ukraine.karta.legend.pin-ru') });
  if (report?.shown) items.push({ key: 'combat', colorCss: c.combat, glyph: 'bolt', label: translate('ukraine.karta.legend.combat') });
  if (report?.shown && report.arrows > 0) items.push({ key: 'attack', colorCss: c.attack, glyph: 'arrow', label: translate('ukraine.karta.legend.attack') });
  items.push({ key: 'road', colorCss: c.road, glyph: 'shield', label: translate('ukraine.karta.legend.road') });
  return items;
}

function roundRectPath(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

/**
 * Zapečie rám KARTA (titulok, legenda, prehľadová mapka) do plátna snímky
 * (K5 export). `area` je výška kresliacej plochy nad pásom atribúcie. Kreslí
 * priamo cez ctx 2D — používa sa ako `decorate` v shareSnapshot.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} model getModel() z overlay
 */
export function drawKartaExport(ctx, model, width, height, { font = 'system-ui, "Segoe UI", sans-serif' } = {}) {
  if (!ctx || !model) return;
  // Mierka podľa menšej strany (feed 1200×630 → 1; štvorec/story 1080 → ~1,8),
  // aby text nebol na väčších pomeroch drobný. Feed ostáva 1:1 (KARTA nezmenená).
  const s = Math.max(1, Math.min(2, Math.min(width, height) / 600));
  const pad = Math.round(22 * s);
  const inset = model.inset && Array.isArray(model.inset.rings) ? model.inset : { rings: UKRAINE_OUTLINE_RINGS, bbox: UKRAINE_OUTLINE_BBOX };
  const px = (v) => Math.round(v * s);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  // Titulok vľavo hore.
  const t = model.title || {};
  if (t.title) {
    ctx.font = `700 ${px(26)}px ${font}`;
    const tw = ctx.measureText(t.title.toUpperCase()).width;
    ctx.font = `${px(12)}px ${font}`;
    const sw = Math.max(t.subtitle ? ctx.measureText(t.subtitle).width : 0, t.sources ? ctx.measureText(t.sources).width : 0);
    const boxW = Math.min(width * 0.62, Math.max(tw, sw) + px(28));
    const boxH = px(34) + (t.subtitle ? px(20) : 0) + (t.sources ? px(18) : 0);
    ctx.fillStyle = 'rgba(8, 14, 22, 0.74)';
    roundRectPath(ctx, pad, pad, boxW, boxH, px(8)); ctx.fill();
    ctx.fillStyle = '#f2f8fd'; ctx.font = `700 ${px(26)}px ${font}`;
    ctx.fillText(t.title.toUpperCase(), pad + px(14), pad + px(28));
    let ty = pad + px(28);
    if (t.subtitle) { ty += px(20); ctx.fillStyle = '#9fb2c4'; ctx.font = `${px(12)}px ${font}`; ctx.fillText(t.subtitle, pad + px(14), ty); }
    if (t.sources) { ty += px(18); ctx.fillStyle = '#6d8296'; ctx.font = `${px(11)}px ${font}`; ctx.fillText(t.sources, pad + px(14), ty); }
  }
  // Legenda vľavo dole.
  const items = Array.isArray(model.legend) ? model.legend : [];
  if (items.length) {
    ctx.font = `${px(12)}px ${font}`;
    const rowH = px(20), headH = px(18);
    const boxW = Math.min(width * 0.36, px(40) + Math.max(...items.map((i) => ctx.measureText(i.label).width)));
    const boxH = headH + items.length * rowH + px(12);
    const bx = pad, by = height - boxH - pad;
    ctx.fillStyle = 'rgba(8, 14, 22, 0.74)';
    roundRectPath(ctx, bx, by, boxW, boxH, px(8)); ctx.fill();
    ctx.fillStyle = '#7f93a6'; ctx.font = `${px(10)}px ${font}`;
    ctx.fillText((model.legendHead || 'LEGENDA'), bx + px(12), by + px(14));
    items.forEach((item, i) => {
      const ry = by + headH + px(8) + i * rowH;
      ctx.fillStyle = item.colorCss || '#888';
      ctx.globalAlpha = Number.isFinite(item.dim) ? item.dim : 1;
      if (item.dot) { ctx.beginPath(); ctx.arc(bx + px(16), ry + px(4), px(5), 0, Math.PI * 2); ctx.fill(); }
      else if (item.glyph === 'hex') { ctx.beginPath(); for (let k = 0; k < 6; k += 1) { const a = (Math.PI / 3) * k - Math.PI / 2; const x = bx + px(18) + px(6) * Math.cos(a); const y = ry + px(4) + px(6) * Math.sin(a); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath(); ctx.fill(); }
      else if (item.line) { ctx.fillRect(bx + px(10), ry + px(2.5), px(16), px(3)); }
      else { roundRectPath(ctx, bx + px(10), ry - px(2), px(16), px(11), px(2)); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#cdd9e4'; ctx.font = `${px(12)}px ${font}`;
      ctx.fillText(item.label, bx + px(34), ry + px(8));
    });
  }
  // Prehľadová mapka vpravo hore (ako náhľad na mapách Rybar; obrys z modelu: KARTA = Ukrajina, inak svet).
  const insetW = px(200), insetH = px(144);
  const ix = width - insetW - pad, iy = pad;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.74)';
  roundRectPath(ctx, ix, iy, insetW, insetH, px(8)); ctx.fill();
  const proj = makeInsetProjection(inset.bbox || UKRAINE_OUTLINE_BBOX, insetW, insetH, px(12));
  ctx.save();
  ctx.translate(ix, iy);
  ctx.strokeStyle = 'rgba(150, 180, 205, 0.6)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(43, 92, 138, 0.55)';
  for (const ring of inset.rings) {
    if (!ring.length) continue;
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => { const p = proj.project(lon, lat); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (Array.isArray(model.occupied) && model.occupied.length) {
    ctx.fillStyle = 'rgba(158, 44, 52, 0.85)'; ctx.strokeStyle = 'rgba(210, 80, 80, 0.7)'; ctx.lineWidth = 0.8;
    for (const ring of model.occupied) {
      ctx.beginPath();
      ring.forEach(([lon, lat], i) => { const p = proj.project(lon, lat); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  if (Array.isArray(model.viewRect) && model.viewRect.length === 4) {
    const r = proj.rect(model.viewRect);
    ctx.strokeStyle = '#00d4ff'; ctx.fillStyle = 'rgba(0, 212, 255, 0.16)'; ctx.lineWidth = 1.4;
    ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  if (model.scene?.center) {
    const p = proj.project(model.scene.center.lon, model.scene.center.lat);
    ctx.fillStyle = '#f87171'; ctx.strokeStyle = 'rgba(6,12,20,0.85)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(p.x, p.y, px(3.2), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function el(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {object} o
 * @param {Document} [o.documentRef]
 * @param {Function} [o.translate]
 * @param {() => string} [o.lang]
 * @param {object} [o.control] vrstva KONTROLA (getState/onChange/isShown)
 * @param {object} [o.deepstate]
 * @param {object} [o.report]
 * @param {() => number[]|null} [o.getViewRect] aktuálny obdĺžnik pohľadu [W,S,E,N]
 * @param {(clean: boolean) => void} [o.onCleanChange]
 * @param {() => any} [o.onExport] klik na „Snímka"
 */
export function createUkraineKartaOverlay({
  documentRef = globalThis.document,
  translate = (k) => k,
  lang = () => 'sk',
  control = null,
  deepstate = null,
  report = null,
  getViewRect = () => null,
  onCleanChange = () => {},
  onExport = () => {},
} = {}) {
  const doc = documentRef;
  const inert = {
    id: KARTA_OVERLAY_ID, setStack() {}, setScene() {}, setRevealed() {}, update() {},
    setClean() {}, isClean: () => false, isVisible: () => false, destroy() {}, elements: {},
    _getStateForTest: () => ({ visible: false }),
  };
  if (!doc?.createElement || !doc.body) return inert;

  let _scene = null;
  let _isKarta = false;
  let _revealed = true;
  let _clean = false;
  let _destroyed = false;

  const root = el(doc, 'div', 'oko-karta-overlay');
  root.id = KARTA_OVERLAY_ID;
  root.setAttribute('aria-hidden', 'true');

  // Titulok.
  const titleIsland = el(doc, 'div', 'oko-karta-island oko-karta-title');
  const titleH = el(doc, 'div', 'oko-karta-title-name');
  const titleSub = el(doc, 'div', 'oko-karta-title-state');
  const titleSrc = el(doc, 'div', 'oko-karta-title-src');
  // Stav a zdroje v jednom riadku (lámu sa, keď sa nezmestia): ľavý stĺpec je
  // pilier zbalených panelov a každý px výšky titulku mu chýba (2026-09-26).
  const titleMeta = el(doc, 'div', 'oko-karta-title-meta');
  titleMeta.append(titleSub, titleSrc);
  titleIsland.append(titleH, titleMeta);

  // Legenda.
  const legendIsland = el(doc, 'div', 'oko-karta-island oko-karta-legend');
  // Spodná hranica pravej lišty panelov (ui.js → resolveHudRailLayout bottomBound): lišta končí nad legendou.
  legendIsland.setAttribute('data-rail-bound', 'bottom');
  const legendList = el(doc, 'ul', 'oko-karta-legend-list');
  // Päta legendy: slot, na ktorý sa kotví mierka (mapScaleBar.js) — legenda + mierka ako na tlačenej mape.
  const legendScale = el(doc, 'div', 'oko-karta-legend-scale');
  legendScale.setAttribute('aria-hidden', 'true');
  legendIsland.append(el(doc, 'div', 'oko-karta-legend-head', translate('ukraine.karta.legend.head')), legendList, legendScale);

  // Prehľadová mapka.
  const insetIsland = el(doc, 'div', 'oko-karta-island oko-karta-inset');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 150 108');
  svg.setAttribute('class', 'oko-karta-inset-svg');
  const outlinePath = doc.createElementNS(SVG_NS, 'path');
  outlinePath.setAttribute('class', 'oko-karta-inset-outline');
  // Ruská kontrola v mapke (ako náhľad na mapách Rybar), z hrubého obrysu DeepState.
  const occupiedPath = doc.createElementNS(SVG_NS, 'path');
  occupiedPath.setAttribute('class', 'oko-karta-inset-occupied');
  const viewRectEl = doc.createElementNS(SVG_NS, 'rect');
  viewRectEl.setAttribute('class', 'oko-karta-inset-view');
  const dot = doc.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('class', 'oko-karta-inset-dot');
  dot.setAttribute('r', '2.4');
  svg.append(outlinePath, occupiedPath, viewRectEl, dot);
  insetIsland.append(svg);

  // Nástroje (čistá karta + snímka) — ostávajú aj v čistom režime.
  const tools = el(doc, 'div', 'oko-karta-island oko-karta-tools');
  const cleanBtn = el(doc, 'button', 'oko-karta-tool', translate('ukraine.karta.clean'));
  cleanBtn.type = 'button';
  cleanBtn.setAttribute('aria-pressed', 'false');
  const shotBtn = el(doc, 'button', 'oko-karta-tool', translate('ukraine.karta.shot'));
  shotBtn.type = 'button';
  tools.append(cleanBtn, shotBtn);

  root.append(titleIsland, legendIsland, insetIsland, tools);
  doc.body.appendChild(root);

  const insetProj = makeInsetProjection(UKRAINE_OUTLINE_BBOX, 150, 108, 6);
  outlinePath.setAttribute('d', UKRAINE_OUTLINE_RINGS.map((ring) => insetRingPath(insetProj.project, ring)).join(' '));

  function drawInset() {
    const occ = deepstateDraws(deepstate?.getState?.()) ? (deepstate?.occupiedOutline?.() || []) : [];
    occupiedPath.setAttribute('d', occ.map((ring) => insetRingPath(insetProj.project, ring)).join(' '));
    const rect = typeof getViewRect === 'function' ? getViewRect() : null;
    if (Array.isArray(rect) && rect.length === 4) {
      const r = insetProj.rect(rect);
      viewRectEl.setAttribute('x', r.x.toFixed(1)); viewRectEl.setAttribute('y', r.y.toFixed(1));
      viewRectEl.setAttribute('width', r.w.toFixed(1)); viewRectEl.setAttribute('height', r.h.toFixed(1));
      viewRectEl.style.display = '';
    } else {
      viewRectEl.style.display = 'none';
    }
    if (_scene?.center) {
      const p = insetProj.project(_scene.center.lon, _scene.center.lat);
      dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1));
      dot.style.display = '';
    } else {
      dot.style.display = 'none';
    }
  }

  function legendRow(item) {
    const li = el(doc, 'li', 'oko-karta-legend-row');
    const sw = el(doc, 'span', `oko-karta-swatch oko-karta-swatch-${item.dot ? 'dot' : item.line ? 'line' : item.glyph ? `glyph glyph-${item.glyph}` : item.pattern === 'hatch' ? 'hatch' : 'fill'}`);
    sw.style.setProperty('--sw', item.colorCss);
    if (Number.isFinite(item.dim)) sw.style.opacity = String(item.dim);
    li.append(sw, el(doc, 'span', 'oko-karta-legend-label', item.label));
    return li;
  }

  function update() {
    if (_destroyed) return;
    const cs = control?.getState?.() || null;
    const ds = deepstate?.getState?.() || null;
    const rs = report?.getState?.() || null;
    const dateText = kartaDateText({ report: rs, deepstate: ds, control: cs });
    const sources = kartaSources({ report: rs, deepstate: ds, control: cs, translate });
    const title = kartaTitleModel({ scene: _scene, dateText, sources, changeText: kartaChangeText(ds, translate, lang()), translate });
    titleH.textContent = title.title;
    titleSub.textContent = title.subtitle;
    titleSub.style.display = title.subtitle ? '' : 'none';
    titleSrc.textContent = title.sources;
    const items = kartaLegendItems({ report: rs, deepstate: ds, control: cs, translate });
    legendList.replaceChildren(...items.map(legendRow));
    drawInset();
  }

  function applyVisibility() {
    const visible = _isKarta && _revealed;
    root.classList.toggle('is-visible', visible);
    // Rám karty na <body>: style.css podľa neho schová súradnicový roh HUD-u
    // (jeho miesto vľavo dole má legenda) — 2026-09-26, upratanie prekryvov.
    try { doc.body.classList.toggle('oko-karta-frame', visible); } catch { /* */ }
    if (visible) update();
  }

  function setStack(stack) { _isKarta = stack?.kind === 'hillshade'; if (!_isKarta && _clean) setClean(false); applyVisibility(); }
  function setScene(scene) { _scene = scene || null; applyVisibility(); }
  function setRevealed(on) { _revealed = Boolean(on); applyVisibility(); }
  function setClean(on) {
    _clean = Boolean(on);
    try { doc.body.classList.toggle('oko-karta-clean', _clean); } catch { /* */ }
    cleanBtn.setAttribute('aria-pressed', String(_clean));
    cleanBtn.textContent = translate(_clean ? 'ukraine.karta.clean-off' : 'ukraine.karta.clean');
    try { onCleanChange(_clean); } catch { /* */ }
  }

  cleanBtn.addEventListener('click', () => setClean(!_clean));
  shotBtn.addEventListener('click', () => { try { onExport(); } catch { /* */ } });

  const unsubs = [];
  for (const layer of [control, deepstate, report]) {
    if (layer?.onChange) unsubs.push(layer.onChange(() => { if (root.classList.contains('is-visible')) update(); }));
  }

  function destroy() {
    _destroyed = true;
    for (const u of unsubs) { try { u(); } catch { /* */ } }
    if (_clean) { try { doc.body.classList.remove('oko-karta-clean'); } catch { /* */ } }
    try { doc.body.classList.remove('oko-karta-frame'); } catch { /* */ }
    try { root.remove(); } catch { /* */ }
  }

  return {
    id: KARTA_OVERLAY_ID,
    setStack, setScene, setRevealed, update,
    setClean, isClean: () => _clean, isVisible: () => root.classList.contains('is-visible'),
    /** Ostrovy rámu — main.js ich hlási pruhom panelov ako prekážky (ui.js observe*StackObstacle). */
    elements: { title: titleIsland, legend: legendIsland, inset: insetIsland, tools },
    getModel: () => ({
      title: kartaTitleModel({ scene: _scene, dateText: kartaDateText({ report: report?.getState?.(), deepstate: deepstate?.getState?.(), control: control?.getState?.() }), sources: kartaSources({ report: report?.getState?.(), deepstate: deepstate?.getState?.(), control: control?.getState?.(), translate }), changeText: kartaChangeText(deepstate?.getState?.(), translate, lang()), translate }),
      legend: kartaLegendItems({ report: report?.getState?.(), deepstate: deepstate?.getState?.(), control: control?.getState?.(), translate }),
      legendHead: translate('ukraine.karta.legend.head'),
      scene: _scene, viewRect: typeof getViewRect === 'function' ? getViewRect() : null,
      occupied: deepstateDraws(deepstate?.getState?.()) ? (deepstate?.occupiedOutline?.() || []) : [],
    }),
    destroy,
    _getStateForTest: () => ({ root, titleH, titleSub, legendList, viewRectEl, dot, cleanBtn, shotBtn, isKarta: _isKarta, revealed: _revealed, clean: _clean }),
  };
}
