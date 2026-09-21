// src/conflictsPanel.js
/**
 * @module conflictsPanel
 * @description Panel „Kartičky konfliktov" (propagácia, B): zoznam zdieľateľných
 * scén po regiónoch, výber pomeru (feed/štvorec/story), export po jednom aj
 * dávkou. Samostatný plávajúci ostrov (ako KARTA rám) — geometria je v style.css
 * (test overlayIslands zakazuje position:fixed vo vstreknutom <style>); tento
 * modul plní obsah a rieši interakciu. Rámovanie + zachytenie robí volajúci
 * cez `onExport(conflict, ratio)` (vráti Promise).
 */
export const CONFLICTS_PANEL_ID = 'oko-conflicts-panel';
const REGION_ORDER = Object.freeze(['ukraine', 'maritime', 'middle-east']);

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
 * @param {ReadonlyArray<object>} o.conflicts položky s { id, region, kind, label }
 * @param {ReadonlyArray<string>} [o.ratios]
 * @param {string} [o.initialRatio]
 * @param {(conflict: object, ratio: string) => Promise<any>} o.onExport
 * @param {Element} [o.launchTarget] kam pripnúť spúšťač (predvolene `<body>`, teda
 *   voľne plávajúce tlačidlo); zóna KONFLIKTY v ľavom pruhu mu dáva domov
 * @param {Element} [o.launchBefore] voliteľná kotva pre `insertBefore`, aby DOM
 *   poradie sedelo s vizuálnym; bez nej sa pripne na koniec cieľa
 */
export function createConflictsPanel({
  documentRef = globalThis.document,
  translate = (k) => k,
  conflicts = [],
  ratios = ['feed', 'square', 'story'],
  initialRatio = 'feed',
  onExport = async () => {},
  onDigest = null,
  clipboard = (globalThis.navigator && globalThis.navigator.clipboard) || null,
  launchTarget = null,
  launchBefore = null,
} = {}) {
  const doc = documentRef;
  const inert = { id: CONFLICTS_PANEL_ID, open() {}, close() {}, toggle() {}, isOpen: () => false, destroy() {}, _getStateForTest: () => ({}) };
  if (!doc?.createElement || !doc.body) return inert;

  let _ratio = ratios.includes(initialRatio) ? initialRatio : ratios[0];
  let _busy = false;
  let _destroyed = false;

  const launch = el(doc, 'button', 'oko-conflicts-launch', translate('conflicts.launch'));
  launch.type = 'button';
  launch.setAttribute('aria-expanded', 'false');

  const panel = el(doc, 'section', 'oko-conflicts-panel');
  panel.id = CONFLICTS_PANEL_ID;
  panel.hidden = true;
  panel.setAttribute('aria-label', translate('conflicts.title'));

  const head = el(doc, 'div', 'oko-conflicts-head');
  head.append(el(doc, 'div', 'oko-conflicts-title', translate('conflicts.title')));
  const closeBtn = el(doc, 'button', 'oko-conflicts-close', '✕');
  closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', translate('conflicts.close'));
  head.append(closeBtn);
  panel.append(head);
  panel.append(el(doc, 'div', 'oko-conflicts-sub', translate('conflicts.subtitle')));

  // Výber pomeru.
  const ratioRow = el(doc, 'div', 'oko-conflicts-ratios');
  ratioRow.append(el(doc, 'span', 'oko-conflicts-ratios-label', translate('conflicts.ratio')));
  const ratioBtns = new Map();
  for (const r of ratios) {
    const b = el(doc, 'button', 'oko-conflicts-ratio', translate(`conflicts.ratio.${r}`));
    b.type = 'button';
    b.dataset.ratio = r;
    b.setAttribute('aria-pressed', String(r === _ratio));
    b.addEventListener('click', () => setRatio(r));
    ratioBtns.set(r, b);
    ratioRow.append(b);
  }
  panel.append(ratioRow);

  // Zoznam konfliktov po regiónoch.
  const listWrap = el(doc, 'div', 'oko-conflicts-list');
  const rowButtons = [];
  const regions = REGION_ORDER.filter((rg) => conflicts.some((c) => c.region === rg));
  for (const region of regions) {
    listWrap.append(el(doc, 'div', 'oko-conflicts-region', translate(`conflicts.region.${region}`)));
    for (const c of conflicts.filter((x) => x.region === region)) {
      const row = el(doc, 'div', 'oko-conflicts-row');
      row.append(el(doc, 'span', 'oko-conflicts-name', c.label || c.name || c.id));
      const btn = el(doc, 'button', 'oko-conflicts-export', translate('conflicts.export'));
      btn.type = 'button';
      btn.addEventListener('click', () => { void runExport([c]); });
      rowButtons.push(btn);
      row.append(btn);
      listWrap.append(row);
    }
  }
  panel.append(listWrap);

  // Päta: export všetkých + stav.
  const foot = el(doc, 'div', 'oko-conflicts-foot');
  const allBtn = el(doc, 'button', 'oko-conflicts-all', translate('conflicts.exportAll'));
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => { void runExport(conflicts.slice()); });
  foot.append(allBtn);
  let digestBtn = null;
  if (typeof onDigest === 'function') {
    digestBtn = el(doc, 'button', 'oko-conflicts-digest', translate('summary.copy'));
    digestBtn.type = 'button';
    digestBtn.addEventListener('click', () => { void runDigest(); });
    foot.append(digestBtn);
  }
  const status = el(doc, 'div', 'oko-conflicts-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  foot.append(status);
  panel.append(foot);

  // Spúšťač smie bývať v pruhu (zóna KONFLIKTY); samotný panel ostáva na <body>,
  // lebo je `position: fixed` — ako flex dieťa pruhu by ho pod 720 px orezal
  // `overflow-y: auto` a odscrolloval by sa preč.
  const host = launchTarget || doc.body;
  if (launchBefore && typeof host.insertBefore === 'function' && launchBefore.parentNode === host) {
    host.insertBefore(launch, launchBefore);
  } else {
    host.append(launch);
  }
  doc.body.append(panel);

  function setRatio(r) {
    if (!ratios.includes(r)) return;
    _ratio = r;
    for (const [key, b] of ratioBtns) b.setAttribute('aria-pressed', String(key === r));
  }
  function setBusy(on, text = '') {
    _busy = on;
    launch.disabled = on; allBtn.disabled = on;
    if (digestBtn) digestBtn.disabled = on;
    for (const b of rowButtons) b.disabled = on;
    status.textContent = text;
  }
  async function runDigest() {
    if (_busy || typeof onDigest !== 'function') return;
    setBusy(true, '');
    let text = null;
    try { text = await onDigest(); } catch { text = null; }
    if (text && clipboard?.writeText) {
      try { await clipboard.writeText(text); setBusy(false, translate('summary.copied')); return; }
      catch { /* schránka odmietla — spadne na prázdny stav nižšie */ }
    }
    setBusy(false, text ? translate('summary.copied') : translate('summary.empty'));
  }
  async function runExport(items) {
    if (_busy || !items.length) return;
    setBusy(true, translate('conflicts.busy', { n: 0, total: items.length }));
    let done = 0;
    for (const c of items) {
      if (_destroyed) return;
      status.textContent = translate('conflicts.busy', { n: done + 1, total: items.length });
      try { await onExport(c, _ratio); done += 1; } catch { /* jedna chyba nezastaví dávku */ }
    }
    setBusy(false, translate('conflicts.done', { n: done }));
  }
  function open() { panel.hidden = false; launch.setAttribute('aria-expanded', 'true'); }
  function close() { panel.hidden = true; launch.setAttribute('aria-expanded', 'false'); }
  function toggle() { if (panel.hidden) open(); else close(); }

  launch.addEventListener('click', toggle);
  closeBtn.addEventListener('click', close);

  function destroy() {
    _destroyed = true;
    try { launch.remove(); } catch { /* */ }
    try { panel.remove(); } catch { /* */ }
  }

  return {
    id: CONFLICTS_PANEL_ID,
    open, close, toggle, isOpen: () => !panel.hidden,
    getRatio: () => _ratio, setRatio,
    destroy,
    _getStateForTest: () => ({ launch, panel, closeBtn, allBtn, digestBtn, status, ratioBtns, rowButtons, regions, isBusy: () => _busy }),
  };
}
