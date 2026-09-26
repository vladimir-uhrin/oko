// src/kartaRailDock.js
/**
 * @module kartaRailDock
 * @description Pravá lišta panelov (#right-context-rail: Zobrazenie, Kamery,
 * Kontext) v ráme KARTA do ľavého stĺpca panelov (2026-09-26, vlastník ju
 * zakrúžkoval a šípkou ukázal na ľavý stĺpec hore: „toto musí zmiznúť a dať do
 * tam, kde som dal šípku"; dočasne do upratania panelov).
 *
 * Presúva sa CELÁ lišta (jej panely si nechajú štýly `#right-context-rail > …`)
 * ako prvý prvok #left-panel-stack (poradie cez `.oko-rail-docked` v style.css).
 * Poloha sa mení INLINE — creditAttribution.test stráži geometriu lišty v CSS
 * (top/position/max-height smie mať len vymenované selektory), rovnaký vzor ako
 * inline zdvih doku a kreditov. Pri odchode z KARTY sa lišta vráti na pôvodné
 * miesto a inline štýly sa zmažú. Na mobile (body.oko-mobile) sa nič nepresúva —
 * lišta je tam skrytá a panely nosí výsuv mobilného plášťa.
 *
 * Rozbalené panely lišty sa pri zakotvení zbalia (cez `setPanelCollapsed` z ui.js,
 * bez uloženia preferencie) — rozbalené Zobrazenie má ~790 px a ľavý pruh by
 * DÁTOVÝM VRSTVÁM nenechal miesto; pri odchode z KARTY sa znova rozbalia.
 */

/** Panely pravej lišty (ui.js _initRightPanelAdaptiveLayout ich do nej vkladá). */
export const RAIL_PANEL_IDS = Object.freeze(['pp-toggles', 'cctv-panel', 'global-context-panel']);

/** Inline vlastnosti, ktoré zakotvenie nastaví (a pri návrate zmaže). */
export const DOCKED_INLINE = Object.freeze({
  position: 'relative', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
  'max-height': 'none', width: 'auto', 'align-items': 'flex-start',
});

/**
 * Vytvorí ovládač zakotvenia. `setDocked(true)` presunie lištu do ľavého stĺpca,
 * `setDocked(false)` ju vráti. Idempotentné; bez prvkov nerobí nič.
 * @param {Document} doc
 * @param {object} [o]
 * @param {(id: string, collapsed: boolean) => void} [o.setPanelCollapsed] zbalenie bez uloženia preferencie
 */
export function createKartaRailDock(doc = globalThis.document, { setPanelCollapsed = null } = {}) {
  let home = null; // { parent, next } pôvodné miesto lišty
  let folded = []; // panely, ktoré zakotvenie zbalilo (po návrate sa rozbalia)
  const rail = () => doc?.getElementById?.('right-context-rail') || null;
  const lane = () => doc?.getElementById?.('left-panel-stack') || null;

  function dock() {
    const r = rail(); const l = lane();
    if (!r || !l || home) return false;
    if (doc.body?.classList?.contains?.('oko-mobile')) return false;
    home = { parent: r.parentNode || null, next: r.nextSibling || null };
    folded = [];
    if (typeof setPanelCollapsed === 'function') {
      for (const id of RAIL_PANEL_IDS) {
        const panel = doc.getElementById(id);
        if (!panel || panel.parentNode !== r || panel.classList.contains('collapsed')) continue;
        try { setPanelCollapsed(id, true); folded.push(id); } catch { /* */ }
      }
    }
    for (const [prop, value] of Object.entries(DOCKED_INLINE)) r.style.setProperty(prop, value);
    r.classList.add('oko-rail-docked');
    l.insertBefore(r, l.firstChild);
    return true;
  }

  function undock() {
    const r = rail();
    if (!r || !home) return false;
    const { parent, next } = home;
    home = null;
    if (parent) {
      if (next && next.parentNode === parent) parent.insertBefore(r, next);
      else parent.appendChild(r);
    }
    for (const prop of Object.keys(DOCKED_INLINE)) r.style.removeProperty(prop);
    r.classList.remove('oko-rail-docked');
    for (const id of folded) {
      const panel = doc.getElementById(id);
      if (panel?.classList.contains('collapsed')) { try { setPanelCollapsed(id, false); } catch { /* */ } }
    }
    folded = [];
    return true;
  }

  return {
    setDocked(on) { return on ? dock() : undock(); },
    isDocked: () => Boolean(home),
  };
}
