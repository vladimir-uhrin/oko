// src/commandPalette.js
/**
 * @module commandPalette
 * @description Jedno pole, ktoré nájde všetko: miesto, konflikt, vrstvu aj akciu
 * — aby sa v OKU dalo ľahko orientovať bez lovenia po paneloch. Ľudské názvy,
 * žiadne odborné výrazy. Otvára sa klávesou „/" alebo tlačidlom; píšeš, ono
 * skočí alebo prepne. Štýl a jednoduchosť ako zvyšok OKO. Samostatný ostrov —
 * geometria je v style.css (test overlayIslands).
 *
 * Jednotné hľadanie (2026-10-04): okrem statických príkazov aj výsledky podľa dopytu
 * (`getQueryCommands` — živé lietadlá v pamäti, už vybrané, bez ďalšieho skóre) a neskoršie
 * výsledky zo servera (`getAsyncResults` — lietadlo kdekoľvek na svete). Miesto na mape je
 * vždy posledný riadok, takže jedno pole nájde lietadlo, vrstvu, konflikt aj adresu.
 */
export const COMMAND_PALETTE_ID = 'oko-cmd';
/** Poradie skupín vo výsledkoch (ľudské názvy dodá i18n `cmd.group.<key>`). */
export const COMMAND_GROUP_ORDER = Object.freeze(['scene', 'layer', 'view']);

/** Zloží diakritiku a malé písmená, aby „hlada" našlo „hľadá", „hormuz" našlo „Hormuzský". Pure. */
export function foldText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Skóre zhody príkazu s (už zloženým) dopytom: názov od začiatku > slovo > kdekoľvek > kľúčové slová. Pure. */
export function scoreCommand(cmd, q) {
  if (!q) return 1;
  const label = foldText(cmd.label);
  if (label.startsWith(q)) return 100;
  if (label.includes(` ${q}`)) return 80;
  if (label.includes(q)) return 60;
  if (foldText((cmd.keywords || []).join(' ')).includes(q)) return 40;
  if (foldText(cmd.group).includes(q)) return 15;
  return 0;
}

/** Nájde príkazy podľa dopytu, zoradené podľa skóre; prázdny dopyt vráti všetko. Pure. */
export function searchCommands(commands, query, { limit = 40 } = {}) {
  const q = foldText(query);
  const scored = [];
  for (const c of commands || []) {
    const s = scoreCommand(c, q);
    if (s > 0) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.c);
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
 * @param {() => ReadonlyArray<object>} o.getCommands vracia príkazy { id, label, hint?, group, keywords?, run() }
 * @param {(query: string) => any} [o.onGeocode] núdzové „hľadať na mape", keď nič nesadne
 * @param {ReadonlyArray<string>} [o.groupOrder] poradie skupín vo výsledkoch (ľudské názvy dodá i18n)
 * @param {number} [o.limit] koľko výsledkov naraz (prázdny dopyt = listovanie katalógu, treba vyšší strop)
 * @param {(query: string) => ReadonlyArray<object>} [o.getQueryCommands] príkazy pre konkrétny dopyt (už vybrané)
 * @param {(query: string) => Promise<ReadonlyArray<object>>} [o.getAsyncResults] neskoršie výsledky (server); `kind: 'note'` = len text
 * @param {string} [o.asyncGroup] skupina, v ktorej sa ukáže „hľadám…"
 * @param {number} [o.asyncDelayMs] odstup od posledného písmena pred dopytom na server
 */
export function createCommandPalette({
  documentRef = globalThis.document,
  translate = (k) => k,
  getCommands = () => [],
  onGeocode = null,
  groupOrder = COMMAND_GROUP_ORDER,
  limit = 80,
  getQueryCommands = null,
  getAsyncResults = null,
  asyncGroup = 'async',
  asyncDelayMs = 450,
  minAsyncLength = 2,
} = {}) {
  const doc = documentRef;
  const inert = { id: COMMAND_PALETTE_ID, open() {}, close() {}, toggle() {}, isOpen: () => false, destroy() {}, _getStateForTest: () => ({}) };
  if (!doc?.createElement || !doc.body) return inert;

  let _open = false;
  let _rows = []; // [{ node, run }]
  let _sel = -1;
  let _destroyed = false;
  const _asyncCache = new Map(); // dopyt → príkazy (alebo null = práve beží)
  let _asyncTimer = null;

  const root = el(doc, 'div', 'oko-cmd');
  root.id = COMMAND_PALETTE_ID;
  root.hidden = true;
  const box = el(doc, 'div', 'oko-cmd-box');
  const input = el(doc, 'input', 'oko-cmd-input');
  input.type = 'text';
  input.setAttribute('placeholder', translate('cmd.placeholder'));
  input.setAttribute('aria-label', translate('cmd.placeholder'));
  const results = el(doc, 'div', 'oko-cmd-results');
  box.append(input, results);
  root.append(box);
  doc.body.appendChild(root);

  function runCommand(cmd) {
    close();
    try { cmd.run?.(); } catch (error) { console.warn('[cmd] run failed:', error?.message || error); }
  }
  function select(i) {
    if (!_rows.length) { _sel = -1; return; }
    _sel = (i + _rows.length) % _rows.length;
    _rows.forEach((r, idx) => r.node.classList.toggle('is-sel', idx === _sel));
    try { _rows[_sel].node.scrollIntoView({ block: 'nearest' }); } catch { /* */ }
  }
  function scheduleAsync(q) {
    clearTimeout(_asyncTimer);
    if (typeof getAsyncResults !== 'function' || q.length < minAsyncLength || _asyncCache.has(q)) return;
    _asyncTimer = setTimeout(() => {
      _asyncCache.set(q, null);
      Promise.resolve().then(() => getAsyncResults(q)).then(
        (cmds) => { _asyncCache.set(q, Array.isArray(cmds) ? cmds : []); },
        () => { _asyncCache.delete(q); },
      ).finally(() => {
        if (_asyncCache.size > 50) _asyncCache.delete(_asyncCache.keys().next().value);
        if (_open && input.value.trim() === q) render();
      });
    }, asyncDelayMs);
  }
  function render() {
    const q = input.value;
    const qt = q.trim();
    const keep = _rows[_sel]?.id ?? null;
    const found = searchCommands(getCommands(), q, { limit });
    let dynamic = [];
    if (qt.length >= minAsyncLength && typeof getQueryCommands === 'function') {
      try { dynamic = [...(getQueryCommands(qt) || [])]; } catch { dynamic = []; }
    }
    const seen = new Set(dynamic.map((c) => c.id));
    const later = _asyncCache.get(qt);
    // Beží (null) alebo sa práve naplánuje (undefined pri dostatočne dlhom dopyte).
    const pending = later === null || (later === undefined && qt.length >= minAsyncLength && typeof getAsyncResults === 'function');
    const asyncCmds = (later || []).filter((c) => c.kind === 'note' || !seen.has(c.id));
    scheduleAsync(qt);
    results.replaceChildren();
    _rows = [];
    const groups = new Map();
    for (const c of [...dynamic, ...asyncCmds, ...found]) { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
    if (pending && !groups.has(asyncGroup)) groups.set(asyncGroup, []);
    const order = [...groupOrder, ...[...groups.keys()].filter((g) => !groupOrder.includes(g))];
    for (const g of order) {
      const items = groups.get(g);
      if (!items || (!items.length && !(pending && g === asyncGroup))) continue;
      results.append(el(doc, 'div', 'oko-cmd-group', translate(`cmd.group.${g}`)));
      if (pending && g === asyncGroup) results.append(el(doc, 'div', 'oko-cmd-note oko-cmd-pending', translate('cmd.searching')));
      for (const c of items) {
        if (c.kind === 'note') { results.append(el(doc, 'div', 'oko-cmd-note', c.label)); continue; }
        const row = el(doc, 'button', 'oko-cmd-row');
        row.type = 'button';
        row.append(el(doc, 'span', 'oko-cmd-label', c.label));
        if (c.hint) row.append(el(doc, 'span', 'oko-cmd-hint', c.hint));
        row.addEventListener('click', () => runCommand(c));
        row.addEventListener('mousemove', () => select(_rows.findIndex((r) => r.node === row)));
        results.append(row);
        _rows.push({ id: c.id, node: row, run: () => runCommand(c) });
      }
    }
    // Miesto na mape: vždy posledný riadok (jednotné hľadanie), skupina „Miesto".
    if (qt && typeof onGeocode === 'function') {
      if (found.length || dynamic.length || asyncCmds.length || pending) results.append(el(doc, 'div', 'oko-cmd-group', translate('cmd.group.place')));
      const row = el(doc, 'button', 'oko-cmd-row');
      row.type = 'button';
      row.append(el(doc, 'span', 'oko-cmd-label', translate('cmd.geocode', { q: q.trim() })));
      const q2 = q.trim();
      row.addEventListener('click', () => { close(); try { onGeocode(q2); } catch { /* */ } });
      results.append(row);
      _rows.push({ id: 'geocode', node: row, run: () => { close(); try { onGeocode(q2); } catch { /* */ } } });
    }
    if (!_rows.length && !pending) results.append(el(doc, 'div', 'oko-cmd-empty', translate('cmd.empty')));
    // Neskorší výsledok nesmie preskočiť výber, na ktorom už používateľ stojí.
    const kept = keep ? _rows.findIndex((r) => r.id === keep) : -1;
    select(kept >= 0 ? kept : _rows.length ? 0 : -1);
  }

  function open(initial = '') {
    if (_open) return;
    _open = true; root.hidden = false;
    input.value = typeof initial === 'string' ? initial : '';
    render();
    try { input.focus(); } catch { /* */ }
  }
  function close() {
    if (!_open) return;
    _open = false; root.hidden = true;
    _rows = []; _sel = -1;
    clearTimeout(_asyncTimer);
  }
  function toggle() { if (_open) close(); else open(); }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(_sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(_sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (_sel >= 0 && _rows[_sel]) _rows[_sel].run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  // Klávesa „/" otvorí paletu, keď používateľ práve nepíše do iného poľa.
  const onDocKey = (e) => {
    if (_destroyed) return;
    if (e.key === '/' && !_open) {
      const a = doc.activeElement;
      const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
      if (!typing) { e.preventDefault(); open(); }
    }
  };
  try { doc.addEventListener('keydown', onDocKey); } catch { /* */ }

  function destroy() {
    _destroyed = true;
    clearTimeout(_asyncTimer);
    try { doc.removeEventListener('keydown', onDocKey); } catch { /* */ }
    try { root.remove(); } catch { /* */ }
  }

  return {
    id: COMMAND_PALETTE_ID,
    open, close, toggle, isOpen: () => _open,
    destroy,
    _getStateForTest: () => ({ root, box, input, results, rows: () => _rows, sel: () => _sel, render }),
  };
}
