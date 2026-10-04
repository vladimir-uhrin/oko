// src/mobileShell.js
// Mobilný plášť (2026-09-14). Používateľ pozeral verejnú adresu na telefóne:
// „nevedel som sa preklikať… celý web má byť responzívny". Na dotykových
// zariadeniach (pointer: coarse so šírkou ≤ 1180 px) a na každej úzkej
// obrazovke (≤ 900 px) sa bočné stĺpce panelov, HUD a horné indikátory skryjú,
// mapa dostane celú obrazovku a dole je lišta s piatimi sekciami. Ťuknutie
// vysunie výsuv (#oko-sheet): panel sekcie sa DOČASNE presunie z ľavého stĺpca
// alebo pravej lišty do výsuvu (ten istý DOM uzol — id aj poslucháče ostávajú)
// a pri zavretí sa vráti presne na pôvodné miesto. Desktopový rozvrh
// v StyleManageri (`_scheduleLeftPanelLayout`, pravá lišta) panel vo výsuve
// ignoruje, lebo nie je členom stĺpca ani lišty — preto presun, nie CSS
// prepozicovanie. Na nízkom viewporte (telefón naležato, ≤ 520 px) je výsuv
// zásuvka sprava. Nič sa neukladá: sekcia žije len kým je otvorená.
//
// Dotyk navyše: rámček výberu v Cesiu 18 px namiesto 3 px (prst nie je kurzor)
// a plátnové „ambientné" karty (variant card) sa na mobile nekreslia — ostáva
// vybraná a sledovaná karta (jedna naraz), inak si karty staníc prekrývali mapu.

export const MOBILE_MAX_WIDTH_PX = 900;
export const COARSE_MAX_WIDTH_PX = 1180;
export const SHORT_HEIGHT_PX = 520;
/** Dotyk: rámček výberu v Cesiu namiesto predvolených 3 px. */
export const COARSE_PICK_BOX_PX = 18;
/** Výška spodnej lišty bez safe-area vložky (musí sedieť s --oko-appbar-h v style.css). */
export const DEFAULT_APPBAR_HEIGHT_PX = 58;
/** Medzera medzi lištou a dokom. */
export const DOCK_LIFT_GAP_PX = 8;
/** Výška zbaleného doku (záloha, keď sa nedá zmerať). */
export const DEFAULT_DOCK_HEIGHT_PX = 62;
/**
 * Hlasová pilulka presahuje nad dok (style.css: margin-top −0.97rem ≈ 15,5 px). Atribúcia sa ráta
 * od vrchu doku, tak sa o presah dotýkala pilulky (naživo 2026-10-04, scripts/qa-mobile.mjs).
 */
export const VOICE_OVERHANG_PX = 16;

/**
 * Sekcie spodnej lišty. `panelIds` sa presunú do výsuvu v tomto poradí,
 * `expand` sa rozbalí, ostatné ostanú zbalené ako hlavičky (ťuknutie ich
 * rozbalí — hlavička panela je prepínač). `action: 'location'` neotvára výsuv,
 * otvorí lištu polohy v doku a dá jej fokus.
 */
export const MOBILE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'layers', labelKey: 'mobile.layers', panelIds: Object.freeze(['data-panel']), expand: 'data-panel' }),
  Object.freeze({ id: 'scenes', labelKey: 'mobile.scenes', panelIds: Object.freeze(['scene-panel']), expand: 'scene-panel' }),
  Object.freeze({ id: 'data', labelKey: 'mobile.data', panelIds: Object.freeze(['gas-panel', 'oil-panel', 'mideast-panel', 'ukraine-panel', 'history-panel']), expand: 'gas-panel' }),
  Object.freeze({ id: 'display', labelKey: 'mobile.display', panelIds: Object.freeze(['pp-toggles', 'cctv-panel', 'global-context-panel']), expand: 'pp-toggles' }),
  Object.freeze({ id: 'search', labelKey: 'mobile.search', panelIds: Object.freeze([]), action: 'location' }),
]);

/**
 * Režim plášťa z rozmerov a typu ukazovateľa. Pure.
 * @param {{ width?: number, height?: number, coarse?: boolean }} viewport
 * @returns {{ mobile: boolean, landscape: boolean }} landscape = nízky viewport (výsuv sprava)
 */
export function resolveShellMode({ width, height, coarse = false } = {}) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const mobile = w > 0 && (w <= MOBILE_MAX_WIDTH_PX || (coarse === true && w <= COARSE_MAX_WIDTH_PX));
  return { mobile, landscape: mobile && h > 0 && h <= SHORT_HEIGHT_PX && w > h };
}

/**
 * Potiahnutie výsuvu nadol ho zatvorí: dlhé (≥ 80 px) alebo krátke a rýchle
 * (≥ 30 px pri ≥ 0,5 px/ms). Pure.
 */
export function swipeShouldClose({ startY, endY, elapsedMs = 0 } = {}) {
  const dy = Number(endY) - Number(startY);
  if (!Number.isFinite(dy)) return false;
  if (dy >= 80) return true;
  const velocity = elapsedMs > 0 ? dy / elapsedMs : 0;
  return dy >= 30 && velocity >= 0.5;
}

/** Rámček výberu pre scene.pick(): na dotyku aspoň COARSE_PICK_BOX_PX. Pure. */
export function pickBoxFor(width, height, coarse) {
  const w = Number.isFinite(width) ? width : 3;
  const h = Number.isFinite(height) ? height : 3;
  if (!coarse) return [w, h];
  return [Math.max(w, COARSE_PICK_BOX_PX), Math.max(h, COARSE_PICK_BOX_PX)];
}

/** `(pointer: coarse)` = primárny vstup je prst (telefón, tablet). */
export function isCoarsePointer(win = globalThis.window) {
  try { return Boolean(win?.matchMedia?.('(pointer: coarse)')?.matches); } catch { return false; }
}

/**
 * Na dotyku rozšíri každé `scene.pick()` (vlastnosť inštancie prekryje
 * prototyp Cesia; predvolený klik Vieweru aj vrstvy volajú scene.pick).
 * @returns {boolean} true, keď sa obal nainštaloval
 */
export function installCoarsePickBox(scene, { coarse = isCoarsePointer() } = {}) {
  if (!scene || typeof scene.pick !== 'function' || !coarse || scene.__okoCoarsePick) return false;
  const original = scene.pick;
  scene.pick = function pickCoarse(position, width, height) {
    const [w, h] = pickBoxFor(width, height, true);
    return original.call(this, position, w, h);
  };
  scene.__okoCoarsePick = true;
  return true;
}

function inertShell() {
  return {
    inert: true,
    isMobile: () => false,
    activeSection: () => null,
    open: () => false,
    close: () => false,
    toggle: () => false,
    sync: () => ({ mobile: false, landscape: false }),
    destroy: () => {},
    _getStateForTest: () => ({ mode: { mobile: false, landscape: false }, active: null, moved: [] }),
  };
}

/**
 * Vytvorí plášť nad statickými značkami v index.html (#oko-appbar, #oko-sheet,
 * #oko-sheet-backdrop). Bez nich vráti nečinný objekt (testy, cudzí DOM).
 * @param {object} [options]
 * @param {Document} [options.document]
 * @param {Window} [options.window]
 * @param {{ setPanelCollapsed?: Function }|null} [options.styleManager] zbaľovanie cez StyleManager (persist: false)
 * @param {((laneId: string, suppressed: boolean) => void)|null} [options.suppressLane] world overlay: skryť ambientné karty na mobile
 */
export function createMobileShell({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  styleManager = null,
  suppressLane = null,
} = {}) {
  const body = doc?.body;
  const appbar = doc?.getElementById?.('oko-appbar');
  const sheet = doc?.getElementById?.('oko-sheet');
  const sheetBody = sheet?.querySelector?.('.oko-sheet-body');
  const sheetTitle = doc?.getElementById?.('oko-sheet-title');
  const backdrop = doc?.getElementById?.('oko-sheet-backdrop');
  const closeButton = doc?.getElementById?.('oko-sheet-close');
  if (!body || !appbar || !sheet || !sheetBody) return inertShell();

  const sectionById = new Map(MOBILE_SECTIONS.map((section) => [section.id, section]));
  const buttons = Array.from(appbar.querySelectorAll?.('[data-oko-section]') || []);
  const raf = typeof win?.requestAnimationFrame === 'function'
    ? win.requestAnimationFrame.bind(win)
    : (callback) => { callback(); return null; };
  const now = () => (typeof win?.performance?.now === 'function' ? win.performance.now() : Date.now());

  let mode = { mobile: false, landscape: false };
  let active = null;
  /** @type {Array<{ el: any, parent: any, next: any, wasCollapsed: boolean }>} */
  let moved = [];
  let touchStart = null;
  let frame = null;
  let destroyed = false;

  function setCollapsed(panelId, collapsed) {
    if (typeof styleManager?.setPanelCollapsed === 'function') {
      styleManager.setPanelCollapsed(panelId, collapsed, { persist: false, syncShare: false });
      return;
    }
    doc.getElementById?.(panelId)?.classList?.toggle?.('collapsed', collapsed);
  }

  function buttonLabel(sectionId) {
    const button = buttons.find((item) => item?.dataset?.okoSection === sectionId);
    const label = button?.querySelector?.('.oko-appbar-label');
    return String(label?.textContent || button?.textContent || '').trim();
  }

  function syncButtons() {
    for (const button of buttons) {
      const pressed = Boolean(active) && button?.dataset?.okoSection === active;
      button.setAttribute?.('aria-pressed', pressed ? 'true' : 'false');
      button.classList?.toggle?.('active', pressed);
    }
  }

  function restorePanels() {
    const records = moved;
    moved = [];
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const { el, parent, next, wasCollapsed } = records[index];
      if (parent) {
        if (next && next.parentNode === parent) parent.insertBefore(el, next);
        else parent.appendChild(el);
      }
      el.classList?.remove?.('oko-in-sheet');
      setCollapsed(el.id, wasCollapsed);
    }
  }

  function close() {
    if (!active) return false;
    restorePanels();
    active = null;
    sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    body.classList?.remove?.('oko-sheet-open');
    if (body.dataset) delete body.dataset.okoSection;
    syncButtons();
    return true;
  }

  /**
   * @param {string} sectionId
   * @param {{expand?: string}} [options] panel, ktorý sa má rozbaliť namiesto predvoleného
   *   (napr. História letov z pásu štátneho lietadla, 2026-09-30)
   */
  function open(sectionId, { expand = null } = {}) {
    const section = sectionById.get(sectionId);
    if (!section || !mode.mobile || destroyed) return false;
    if (active) close();
    if (section.action === 'location') {
      // Lišta polohy žije v doku (nie vo výsuve): otvor ju a daj fokus poľu.
      if (typeof styleManager?.setPanelCollapsed === 'function') {
        styleManager.setPanelCollapsed('location-bar', false, { explicit: true });
      } else {
        doc.getElementById?.('location-bar')?.classList?.remove?.('collapsed');
      }
      // StyleManager po rozbalení lišty presúva fokus na jej prepínač — pole
      // dostane fokus až po ňom (ďalší tik), aby sa hneď dalo písať.
      const input = doc.getElementById?.('location-search');
      const later = typeof win?.setTimeout === 'function' ? win.setTimeout.bind(win) : (callback) => callback();
      later(() => input?.focus?.(), 60);
      return true;
    }
    for (const panelId of section.panelIds) {
      const el = doc.getElementById?.(panelId);
      if (!el) continue;
      moved.push({
        el,
        parent: el.parentNode || null,
        next: el.nextSibling || null,
        wasCollapsed: Boolean(el.classList?.contains?.('collapsed')),
      });
      sheetBody.appendChild(el);
      el.classList?.add?.('oko-in-sheet');
    }
    if (!moved.length) return false;
    const expandId = expand && section.panelIds.includes(expand) ? expand : section.expand;
    for (const { el } of moved) setCollapsed(el.id, el.id !== expandId);
    active = sectionId;
    if (sheetTitle) sheetTitle.textContent = buttonLabel(sectionId) || sectionId;
    sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    body.classList?.add?.('oko-sheet-open');
    if (body.dataset) body.dataset.okoSection = sectionId;
    syncButtons();
    return true;
  }

  function toggle(sectionId) {
    return active === sectionId ? close() : open(sectionId);
  }

  function sync() {
    if (destroyed) return mode;
    mode = resolveShellMode({ width: win?.innerWidth, height: win?.innerHeight, coarse: isCoarsePointer(win) });
    body.classList?.toggle?.('oko-mobile', mode.mobile);
    body.classList?.toggle?.('oko-mobile-landscape', mode.landscape);
    appbar.hidden = !mode.mobile;
    // Zdvih nad lištu = zmeraná výška lišty (so safe-area vložkou na výrezoch)
    // + 8 px; CSS má predvolených 66 px pre prvé vykreslenie. Dok sa dvíha
    // inline (style.bottom): je to prvok modelovaný v creditAttribution.test.mjs,
    // ktorý pozná len desktopové selektory — výsuv, toast a kokpit idú cez
    // premennú --oko-dock-lift v style.css.
    const lift = mode.mobile ? Math.round((Number(appbar.offsetHeight) || DEFAULT_APPBAR_HEIGHT_PX) + DOCK_LIFT_GAP_PX) : 0;
    const rootStyle = doc.documentElement?.style;
    if (rootStyle?.setProperty) {
      if (lift > 0) rootStyle.setProperty('--oko-dock-lift', `${lift}px`);
      else rootStyle.removeProperty?.('--oko-dock-lift');
    }
    const dock = doc.getElementById?.('command-dock');
    if (dock?.style) dock.style.bottom = lift > 0 ? `${lift}px` : '';
    // Kredity Cesium/Google (vľavo dole) nad dok, nie cez neho: na 827 px
    // ležali v jednom páse s dokom a text „Upgrade for commercial…" mizol
    // pod lištou Poloha (používateľ: „toto sa prekrýva").
    const credits = doc.getElementById?.('cesium-credits');
    if (credits?.style) {
      const dockHeight = Number(dock?.offsetHeight) || DEFAULT_DOCK_HEIGHT_PX;
      credits.style.bottom = lift > 0 ? `${lift + dockHeight + VOICE_OVERHANG_PX + DOCK_LIFT_GAP_PX}px` : '';
    }
    if (!mode.mobile && active) close();
    try { suppressLane?.('ambient-card', mode.mobile); } catch { /* overlay host nie je pripravený */ }
    return mode;
  }

  const onResize = () => {
    if (frame !== null) return;
    frame = raf(() => { frame = null; sync(); });
  };
  const onKeydown = (event) => { if (event?.key === 'Escape' && active) close(); };
  const onTouchStart = (event) => {
    const touch = event?.touches?.[0];
    touchStart = touch ? { y: touch.clientY, t: now() } : null;
  };
  const onTouchEnd = (event) => {
    const touch = event?.changedTouches?.[0];
    if (touchStart && touch && swipeShouldClose({ startY: touchStart.y, endY: touch.clientY, elapsedMs: now() - touchStart.t })) close();
    touchStart = null;
  };

  for (const button of buttons) {
    button.addEventListener?.('click', () => toggle(button.dataset?.okoSection));
  }
  closeButton?.addEventListener?.('click', () => close());
  backdrop?.addEventListener?.('click', () => close());
  doc.addEventListener?.('keydown', onKeydown);
  const grip = sheet.querySelector?.('.oko-sheet-head') || sheet;
  grip.addEventListener?.('touchstart', onTouchStart, { passive: true });
  grip.addEventListener?.('touchend', onTouchEnd, { passive: true });
  win?.addEventListener?.('resize', onResize);
  win?.addEventListener?.('orientationchange', onResize);
  const coarseQuery = (() => { try { return win?.matchMedia?.('(pointer: coarse)') || null; } catch { return null; } })();
  coarseQuery?.addEventListener?.('change', onResize);

  return {
    inert: false,
    isMobile: () => mode.mobile,
    activeSection: () => active,
    open,
    close,
    toggle,
    sync,
    destroy() {
      close();
      destroyed = true;
      doc.removeEventListener?.('keydown', onKeydown);
      win?.removeEventListener?.('resize', onResize);
      win?.removeEventListener?.('orientationchange', onResize);
      coarseQuery?.removeEventListener?.('change', onResize);
      body.classList?.remove?.('oko-mobile', 'oko-mobile-landscape');
      appbar.hidden = true;
    },
    _getStateForTest: () => ({ mode: { ...mode }, active, moved: moved.map((record) => record.el.id) }),
  };
}

/**
 * Štart z main.js: plášť + širší výber na dotyku. Vracia plášť (na diagnostiku).
 */
export function initMobileShell({ styleManager = null, scene = null, suppressLane = null, document: doc, window: win } = {}) {
  const shell = createMobileShell({ document: doc, window: win, styleManager, suppressLane });
  installCoarsePickBox(scene, { coarse: isCoarsePointer(win) });
  shell.sync();
  return shell;
}
