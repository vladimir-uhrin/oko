// src/topBarExtras.js — horná lišta: popisy pod ikonami a ponuka „Viac" na telefóne (2026-11-09).
//
// Prečo (audit UI 2026-11-09): päť okrúhlych ikon hore nemalo žiadny popis — význam sa dal zistiť len
// podržaním myši, na telefóne vôbec. Na telefóne navyše lišta zaberala 190 z 844 px (dva rady: ikony,
// jazyk, Články, Súkromie). Teraz:
//   • počítač: pod každou ikonou krátke slovo (atribút data-caption, kreslí ho style.css cez ::after);
//   • telefón: v lište ostáva Hľadať, Účet a „Viac"; zvyšok (odkaz, úvodný pohľad, vypnúť vrstvy,
//     Články, Súkromie, jazyk, uvítanie) je v ponuke. Položky ponuky len klikajú na pôvodné prvky,
//     takže správanie ostáva na jednom mieste.

/** Popisy pod ikonami: id tlačidla → kľúč prekladu. */
export const TOP_BAR_CAPTIONS = Object.freeze({
  'clear-selected-layers': 'actions.caption.clear',
  'share-btn': 'actions.caption.share',
  'reset-globe-view': 'actions.caption.home',
  'account-btn': 'actions.caption.account',
  'cmd-launch': 'actions.caption.search',
});

/**
 * Položky ponuky „Viac" v poradí zobrazenia. `target` = id prvku, na ktorý položka klikne;
 * `labelFrom: 'text'` berie popis z textu cieľa (Články, Súkromie sú už preložené v DOM).
 */
export const TOP_MENU_ITEMS = Object.freeze([
  Object.freeze({ id: 'welcome', labelKey: 'topmenu.welcome', event: 'oko:welcome-open' }),
  Object.freeze({ id: 'share', labelKey: 'topmenu.share', target: 'share-btn' }),
  Object.freeze({ id: 'home', labelKey: 'topmenu.home', target: 'reset-globe-view' }),
  Object.freeze({ id: 'clear', labelKey: 'topmenu.clear', target: 'clear-selected-layers' }),
  Object.freeze({ id: 'topics', labelFrom: 'text', target: 'topics-link' }),
  Object.freeze({ id: 'privacy', labelFrom: 'text', target: 'consent-open' }),
]);

/** Nastaví data-caption na tlačidlách, ktoré už v DOM sú. Vracia počet nastavených. */
export function applyTopBarCaptions(doc, translate) {
  let count = 0;
  for (const [id, key] of Object.entries(TOP_BAR_CAPTIONS)) {
    const el = doc.getElementById(id);
    if (!el) continue;
    const text = translate(key);
    if (el.getAttribute('data-caption') !== text) el.setAttribute('data-caption', text);
    count += 1;
  }
  return count;
}

/** Ktoré položky ponuky sa majú ukázať: cieľ musí existovať a nesmie byť `hidden`. Pure nad DOM. */
export function visibleMenuItems(doc, items = TOP_MENU_ITEMS) {
  return items.filter((item) => {
    if (!item.target) return true;
    const el = doc.getElementById(item.target);
    return Boolean(el) && !el.hidden;
  });
}

const DOTS_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="19" r="1.9" fill="currentColor"/></svg>';

/**
 * Pripojí popisy a ponuku. Tlačidlá účtu a hľadania vznikajú až za behu, preto sa lišta sleduje.
 * @param {{ doc?: Document, translate: (key: string) => string, currentLanguage?: () => string }} deps
 */
export function initTopBarExtras({ doc = document, translate, currentLanguage = () => 'sk' } = {}) {
  const bar = doc.getElementById('top-center-actions');
  if (!bar || typeof translate !== 'function') return null;

  const more = doc.createElement('button');
  more.type = 'button';
  more.id = 'oko-more-btn';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'oko-more-menu');
  more.setAttribute('aria-label', translate('topmenu.open'));
  more.title = translate('topmenu.open');
  more.innerHTML = DOTS_SVG;

  const menu = doc.createElement('div');
  menu.id = 'oko-more-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', translate('topmenu.open'));
  menu.hidden = true;

  const close = ({ refocus = false } = {}) => {
    if (menu.hidden) return;
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    if (refocus) more.focus();
  };

  const render = () => {
    menu.textContent = '';
    for (const item of visibleMenuItems(doc)) {
      const target = item.target ? doc.getElementById(item.target) : null;
      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'oko-more-item';
      row.setAttribute('role', 'menuitem');
      row.textContent = item.labelFrom === 'text' ? (target?.textContent || '').trim() : translate(item.labelKey);
      row.addEventListener('click', () => {
        close();
        if (item.event) doc.dispatchEvent(new CustomEvent(item.event));
        else target?.click();
      });
      menu.append(row);
    }
    // Jazyk: dve tlačidlá vedľa seba, klik ide na pôvodný prepínač (uloží voľbu a načíta stránku nanovo).
    const langRow = doc.createElement('div');
    langRow.className = 'oko-more-lang';
    const label = doc.createElement('span');
    label.textContent = translate('topmenu.language');
    langRow.append(label);
    for (const code of ['sk', 'en']) {
      const original = doc.getElementById(`lang-btn-${code}`);
      if (!original) continue;
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'oko-more-lang-btn';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(currentLanguage() === code));
      b.textContent = code.toUpperCase();
      b.addEventListener('click', () => { close(); original.click(); });
      langRow.append(b);
    }
    menu.append(langRow);
  };

  more.addEventListener('click', () => {
    if (!menu.hidden) { close(); return; }
    render();
    menu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) { event.stopPropagation(); close({ refocus: true }); }
  }, true);
  doc.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    const node = event.target;
    if (node instanceof Node && (menu.contains(node) || more.contains(node))) return;
    close();
  }, true);

  bar.append(more);
  doc.body.append(menu);

  applyTopBarCaptions(doc, translate);
  // Účet (auth/panel.js) a hľadanie (main.js) pribudnú do lišty neskôr.
  let observer = null;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => applyTopBarCaptions(doc, translate));
    observer.observe(bar, { childList: true, subtree: true });
  }
  return { close, destroy: () => { observer?.disconnect(); more.remove(); menu.remove(); } };
}
