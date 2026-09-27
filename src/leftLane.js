// src/leftLane.js
/**
 * @module leftLane
 * @description Logický poriadok ľavého stĺpca panelov (2026-09-27, vlastník: „toto nefunguje.
 * Neviem dobre otvoriť karty, celý posuvník mi otáča mapu. Treba v tom spraviť logický poriadok").
 *
 * Predtým (09-26/27) sa celá pravá lišta (Zobrazenie, Kamery, Kontext) vkladala nad stĺpec ako
 * cudzí blok s vlastnou výškou a stĺpec sa posúval — lenže stĺpec má `pointer-events: none`
 * (medzi panelmi sa chytá mapa), takže jeho posuvník aj koliesko išli na mapu a otáčali ju,
 * a v sebe boli tri posuvníky. Teraz:
 *  - Zobrazenie, Kamery a Kontext sú RIADNE panely ľavého pruhu (priame deti s data-panel-id):
 *    výšku im delí engine pruhu ako ostatným, poradie dáva CSS `order` v zónach —
 *    Vrstvy · Konflikty · Energia · Nástroje (Scény, História letov, Kamery, Kontext) ·
 *    Nastavenia (Zobrazenie);
 *  - naraz je otvorený jeden panel (akordeón — pravidlo v ui.js setPanelCollapsed; tu len
 *    upratanie po štarte, keď uložený stav otvoril viac panelov);
 *  - celá hlavička panela ho otvára aj zatvára, nielen malé tlačidlo;
 *  - otvorený panel sa v posúvanom stĺpci doroluje do záberu (nízke okno: panel dole v zóne
 *    Nastavenia by sa inak otvoril pod okrajom) a vyplní ho — CSS mu dá výšku koridoru, najviac
 *    však jeho prirodzenú výšku (--lane-open-natural), aby malý panel nemal prázdne miesto.
 * Na mobile sa nič nepresúva — obe strany sú skryté a panely nosí výsuv mobilného plášťa.
 */

/** Panely pravej lišty, ktoré patria do ľavého pruhu (ui.js ich pri štarte vloží do lišty). */
export const LANE_RAIL_PANEL_IDS = Object.freeze(['cctv-panel', 'global-context-panel', 'pp-toggles']);

/** Hlavičky panelov v pruhu; klik mimo ovládačov panel prepne. */
const HEADER_SELECTOR = '.panel-header, .pp-header-row';
/** Ovládače v hlavičke majú vlastnú akciu — klik na ne panel neprepína. */
const CONTROL_SELECTOR = 'button, input, select, option, textarea, a, label';

/**
 * @param {object} [o]
 * @param {Document} [o.doc]
 * @param {(id: string, collapsed: boolean, opts?: object) => void} [o.setPanelCollapsed] ui.js StyleManager
 * @param {(panel: HTMLElement) => void} [o.syncPanel] prekreslí tlačidlo panela po presune (◀ lišty → +/− pruhu)
 * @param {(panel: HTMLElement) => number} [o.measurePanel] prirodzená výška panela (ui.js _measureLeftPanelNaturalHeight)
 */
export function createLeftLane({ doc = globalThis.document, setPanelCollapsed = null, syncPanel = null, measurePanel = null } = {}) {
  const lane = () => doc?.getElementById?.('left-panel-stack') || null;
  const homes = new Map(); // id → { parent, next } pôvodné miesto panela

  /** Presunie Zobrazenie, Kamery a Kontext do ľavého pruhu. @returns {boolean} či sa niečo presunulo */
  function dock() {
    const l = lane();
    if (!l || doc.body?.classList?.contains?.('oko-mobile')) return false;
    let moved = false;
    for (const id of LANE_RAIL_PANEL_IDS) {
      const panel = doc.getElementById(id);
      if (!panel || panel.parentNode === l) continue;
      homes.set(id, { parent: panel.parentNode || null, next: panel.nextSibling || null });
      l.appendChild(panel);
      syncPanel?.(panel);
      moved = true;
    }
    l.classList.add('oko-lane-with-rail');
    return moved;
  }

  /** Vráti panely na pôvodné miesto (mobil). @returns {boolean} */
  function undock() {
    let moved = false;
    for (const id of [...LANE_RAIL_PANEL_IDS].reverse()) {
      const home = homes.get(id);
      const panel = doc.getElementById(id);
      if (!home || !panel) continue;
      homes.delete(id);
      if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(panel, home.next);
      else home.parent?.appendChild(panel);
      syncPanel?.(panel);
      moved = true;
    }
    lane()?.classList.remove('oko-lane-with-rail');
    return moved;
  }

  /** Otvorené panely pruhu v poradí stĺpca (CSS order). */
  function openPanels() {
    const l = lane();
    if (!l) return [];
    const order = (el) => Number(doc.defaultView?.getComputedStyle?.(el)?.order) || 0;
    return [...l.children]
      .filter((el) => el.matches?.('[data-panel-id]') && !el.classList.contains('collapsed'))
      .sort((a, b) => order(a) - order(b));
  }

  /**
   * Uložený stav alebo odkaz môže pri štarte otvoriť viac panelov — nechá prvý v poradí stĺpca,
   * ostatné zbalí. Pri štarte z uloženého stavu s uložením (persist), inak by pri každom štarte
   * vyhral ten istý starý panel (z čias pred akordeónom) nad naposledy otvoreným; po obnove
   * zdieľaného odkazu bez uloženia — cudzí odkaz nemá prepísať vlastný stav.
   * @param {{ persist?: boolean }} [opts]
   * @returns {number} koľko panelov zbalil
   */
  function enforceSingleOpen({ persist = false } = {}) {
    const open = openPanels();
    if (open.length <= 1 || typeof setPanelCollapsed !== 'function') return 0;
    for (const el of open.slice(1)) setPanelCollapsed(el.id, true, { persist, syncShare: false });
    return open.length - 1;
  }

  /** Klik na hlavičku panela (mimo jej ovládačov) panel otvorí alebo zatvorí. */
  function installHeaderToggle() {
    const l = lane();
    if (!l || l.dataset?.okoHeaderToggle === '1') return false;
    if (l.dataset) l.dataset.okoHeaderToggle = '1';
    l.addEventListener('click', (event) => {
      const target = event.target;
      const header = target?.closest?.(HEADER_SELECTOR);
      if (!header || target.closest(CONTROL_SELECTOR)) return;
      const panel = header.closest('[data-panel-id]');
      if (!panel || panel.parentNode !== l || typeof setPanelCollapsed !== 'function') return;
      setPanelCollapsed(panel.id, !panel.classList.contains('collapsed'), { explicit: true });
    });
    return true;
  }

  /**
   * Posunie stĺpec tak, aby bol panel celý v zábere (alebo aspoň jeho hlavička navrchu).
   * @returns {number} o koľko px sa stĺpec posunul
   */
  function reveal(panel) {
    const l = lane();
    if (!l || !panel || panel.parentNode !== l || l.scrollHeight <= l.clientHeight) return 0;
    const lr = l.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    let delta = 0;
    if (pr.top < lr.top) delta = pr.top - lr.top;
    else if (pr.bottom > lr.bottom) delta = Math.min(pr.bottom - lr.bottom, pr.top - lr.top);
    if (delta) l.scrollTop += delta;
    return delta;
  }

  /**
   * Zapíše otvorenému panelu jeho prirodzenú výšku. Meria sa s --lane-open-natural: 0px, inak by
   * natiahnutý panel (min-height z predošlého otvorenia) nameral sám seba.
   * @returns {number} px (0 = nemerané)
   */
  function fit(panel) {
    if (typeof measurePanel !== 'function' || !panel?.style) return 0;
    panel.style.setProperty('--lane-open-natural', '0px');
    const natural = Math.ceil(Number(measurePanel(panel)) || 0);
    if (natural > 0) panel.style.setProperty('--lane-open-natural', `${natural}px`);
    else panel.style.removeProperty('--lane-open-natural');
    return natural;
  }

  /** fit() pre všetky otvorené panely — po štarte a obnove odkazu (panel otvorený bez kliknutia). */
  function fitOpen() {
    return openPanels().map((panel) => fit(panel));
  }

  /** Keď sa panel pruhu otvorí (akýmkoľvek spôsobom), po rozložení enginom ho vyplní a doroluje do záberu. */
  function installRevealOnOpen() {
    const l = lane();
    const view = doc.defaultView;
    if (!l || !view?.MutationObserver || l.dataset?.okoRevealOnOpen === '1') return false;
    if (l.dataset) l.dataset.okoRevealOnOpen = '1';
    const raf = view.requestAnimationFrame?.bind(view) || ((fn) => view.setTimeout(fn, 16));
    new view.MutationObserver((records) => {
      for (const r of records) {
        const panel = r.target;
        if (panel.parentNode !== l || !panel.matches?.('[data-panel-id]')) continue;
        const wasCollapsed = /(^|\s)collapsed(\s|$)/.test(r.oldValue || '');
        if (!wasCollapsed || panel.classList.contains('collapsed')) continue;
        // dva snímky: engine pruhu (ui.js _scheduleLeftPanelLayout) prideľuje výšky v rAF
        raf(() => raf(() => { fit(panel); reveal(panel); }));
      }
    }).observe(l, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    return true;
  }

  return { dock, undock, enforceSingleOpen, installHeaderToggle, installRevealOnOpen, reveal, fit, fitOpen, openPanels, isDocked: () => homes.size > 0 };
}
