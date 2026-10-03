// src/mapHoverTip.js
//
// Bublina nad mapou pre vrstvy modulu BLÍZKY VÝCHOD (VZDUŠNÝ PRIESTOR · EASA, INCIDENTY LODÍ ·
// UKMTO, RUŠENIE GPS) — 2026-10-03.
//
// Vznikla z nálezu po vydaní: tri vrstvy mali vlastnú kópiu toho istého kódu a všetky tri tú
// istú trojicu chýb, ktorú bolo vidno až na snímke obrazovky (test čítal len text bubliny):
//  1. text (číslo varovania · druh · čas · miesto · plavidlo · citát · zdroj) sa orezal na JEDEN
//     riadok šírky 320 px — trieda .oko-ukr-ctl-tip je stavaná na pár slov — a z varovania
//     ostalo „UKMTO 107-26 · upozornenie · 5. 8. 2026 23:45 UTC · H…";
//  2. bublina ostala visieť, keď kurzor odišiel z mapy na panel alebo sa pohla kamera (schovávala
//     sa len pri ďalšom pohybe myši NAD mapou);
//  3. hľadalo sa pod PRVOU polohou kurzora v dávke pohybov, nie pod poslednou — po rýchlom pohybe
//     a zastavení na bode ukázala bublina to, cez čo myš prešla pred 90 ms.
// Tu je to raz: bublina sa zalamuje (.oko-map-tip v style.css), drží sa v okne mapy, schová sa
// pri odchode kurzora, pri pohybe kamery aj pri ťahaní mapy a pýta sa na POSLEDNÚ polohu kurzora.
// Čo je pod kurzorom a čo o tom napísať, vie vrstva (`resolve`); bublina je len obal.

import * as Cesium from 'cesium';

/** Oneskorenie hľadania pod kurzorom (ms) — `scene.pick` je drahý, pohyb myši chodí po dávkach. */
export const HOVER_TIP_DELAY_MS = 90;
/** Odstup bubliny od kurzora (px). */
export const HOVER_TIP_GAP_PX = 14;
/** Najmenší odstup bubliny od okraja okna mapy (px). */
export const HOVER_TIP_MARGIN_PX = 8;

/**
 * Kam položiť bublinu: vpravo dole od kurzora; keď by pretiekla cez pravý alebo dolný okraj okna
 * mapy, preklopí sa na druhú stranu kurzora; nakoniec sa pritiahne dovnútra okna (bublina širšia
 * než miesto vedľa kurzora ho smie prekryť, okno nie). Bez rozmerov okna (0) sa nepreklápa. Pure.
 * @param {{x: number, y: number, width?: number, height?: number, viewWidth?: number, viewHeight?: number, gap?: number, margin?: number}} o
 * @returns {{x: number, y: number}} ľavý horný roh bubliny v súradniciach okna mapy
 */
export function hoverTipPlacement({ x, y, width = 0, height = 0, viewWidth = 0, viewHeight = 0, gap = HOVER_TIP_GAP_PX, margin = HOVER_TIP_MARGIN_PX }) {
  let left = x + gap;
  let top = y + gap;
  if (viewWidth > 0) {
    if (left + width > viewWidth - margin) left = x - gap - width;
    left = Math.min(left, viewWidth - margin - width);
  }
  if (viewHeight > 0) {
    if (top + height > viewHeight - margin) top = y - gap - height;
    top = Math.min(top, viewHeight - margin - height);
  }
  return { x: Math.round(Math.max(margin, left)), y: Math.round(Math.max(margin, top)) };
}

/**
 * @param {object} o
 * @param {{container: HTMLElement, scene: any, camera?: any}} o.viewer
 * @param {Document} o.doc
 * @param {string} [o.className] trieda vrstvy popri spoločných (.oko-ukr-ctl-tip.oko-map-tip)
 * @param {(pos: {x: number, y: number}) => ({text: string, accent?: string}|null)} o.resolve čo je pod kurzorom
 * @param {() => boolean} [o.isActive] vrstva je zapnutá a viditeľná
 * @returns {{el: HTMLElement, install: () => void, hide: () => void, destroy: () => void}}
 */
export function createMapHoverTip({
  viewer,
  doc,
  className = '',
  resolve,
  isActive = () => true,
  delayMs = HOVER_TIP_DELAY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  createHandler = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
} = {}) {
  const scene = viewer.scene;
  const tip = doc.createElement('div');
  tip.className = `oko-ukr-ctl-tip oko-map-tip ${className}`.trim();
  tip.hidden = true;
  viewer.container.appendChild(tip);

  let handler = null;
  let timer = null;
  let last = null; // posledná poloha kurzora nad mapou, ktorá ešte čaká na hľadanie
  let pressed = 0; // stlačené tlačidlá myši — pri ťahaní mapy sa nehľadá
  let destroyed = false;
  let canvas = null;
  let removeMoveStart = null;

  /** Schová bublinu a zahodí čakajúce hľadanie. */
  function hide() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    last = null;
    tip.hidden = true;
  }

  function fire() {
    timer = null;
    const pos = last;
    last = null;
    if (destroyed || !pos || pressed > 0 || !isActive()) { tip.hidden = true; return; }
    let hit = null;
    try { hit = resolve(pos) || null; } catch { hit = null; }
    if (!hit?.text) { tip.hidden = true; return; }
    tip.textContent = hit.text;
    if (hit.accent) tip.style.setProperty('--ukr-accent', hit.accent);
    tip.hidden = false; // najprv ukázať — skrytý prvok nemá rozmery
    const at = hoverTipPlacement({
      x: pos.x, y: pos.y,
      width: tip.offsetWidth || 0, height: tip.offsetHeight || 0,
      viewWidth: scene.canvas?.clientWidth || 0, viewHeight: scene.canvas?.clientHeight || 0,
    });
    tip.style.transform = `translate(${at.x}px, ${at.y}px)`;
  }

  /** Začne počúvať myš nad mapou (raz; bez plátna — testy, headless — nerobí nič). */
  function install() {
    if (handler || destroyed || !scene?.canvas) return;
    canvas = scene.canvas;
    handler = createHandler(canvas);
    handler.setInputAction((e) => {
      if (pressed > 0 || !isActive()) return;
      // Poloha sa prepisuje pri KAŽDOM pohybe; časovač beží najviac jeden a pýta sa na poslednú.
      last = { x: e.endPosition.x, y: e.endPosition.y };
      if (timer === null) timer = setTimer(fire, delayMs);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    const down = () => { pressed += 1; hide(); };
    const up = () => { pressed = Math.max(0, pressed - 1); };
    handler.setInputAction(down, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(up, Cesium.ScreenSpaceEventType.LEFT_UP);
    handler.setInputAction(down, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
    handler.setInputAction(up, Cesium.ScreenSpaceEventType.RIGHT_UP);
    handler.setInputAction(down, Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
    handler.setInputAction(up, Cesium.ScreenSpaceEventType.MIDDLE_UP);
    // Kurzor odišiel z mapy (panel, karta, okraj okna): tlačidlo sa mohlo pustiť mimo plátna.
    canvas.addEventListener?.('pointerleave', onLeave);
    try { removeMoveStart = viewer.camera?.moveStart?.addEventListener?.(hide) || null; } catch { removeMoveStart = null; }
  }
  function onLeave() { pressed = 0; hide(); }

  function destroy() {
    destroyed = true;
    hide();
    if (handler) { try { handler.destroy(); } catch { /* */ } handler = null; }
    try { canvas?.removeEventListener?.('pointerleave', onLeave); } catch { /* */ }
    try { removeMoveStart?.(); } catch { /* */ }
    removeMoveStart = null;
    try { tip.remove(); } catch { /* */ }
  }

  return { el: tip, install, hide, destroy };
}
