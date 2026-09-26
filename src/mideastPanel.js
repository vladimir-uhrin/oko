// src/mideastPanel.js — telo panela BLÍZKY VÝCHOD v ľavej lište, zóna KONFLIKTY
// (modul BLÍZKY VÝCHOD, etapa 1, 2026-09-26; plán docs/drafts/blizky-vychod-plan.md).
//
// Rovnaká disciplína ako ukrainePanel.js: modul NIČ nepolohuje — kreslí do tela
// panela, ktoré mu podá main.js; panel vlastní umiestnenie, zbalenie, výšku aj
// mobilný výsuv. Žiadne innerHTML ani querySelector, DOM cez vložený `document`,
// aby sa dal testovať v Node s falošným dokumentom.
//
// Obsah etapy 1: stavový riadok (otvorené zdroje · hlásené, neoverené), zoznam
// dejísk (presety kamery zo src/data/mideastTheatres.js — kliknutie zavolá
// applyTheatre z main.js), miesto pre správy (bulletin bývalého panela ZÁLIV sem
// montuje main.js cez conflictBulletin.js) a poctivá poznámka: nič v tomto paneli
// nie je línia frontu ani poloha jednotiek, každá karta menuje zdroj a vek.

import { currentLanguage, t } from './i18n.js';
import { theatreLabel } from './data/mideastTheatres.js';

const INERT = { element: null, newsMount: null, activeTheatre: null, setActiveTheatre() {}, destroy() {} };

/**
 * @param {object} o
 * @param {Element|null} o.mountTarget prázdny prvok tela panela (`#mideast-panel [data-mideast-body]`)
 * @param {ReadonlyArray<object>} [o.theatres] dejiská ({ id, name, overview? }) — main.js podá listMideastTheatres()
 * @param {(id: string) => any} [o.applyTheatre] spustí dejisko (main.js)
 * @param {(scene: object, translate: Function) => string} [o.labelFor] popisok dejiska; predvolene theatreLabel
 * @param {Function} [o.translate]
 * @param {string} [o.lang] jazyk pre formátovanie čísel — etapa 1 čísla nemá, drží paritu s ukrainePanel
 * @param {Document} [o.documentRef]
 */
export function createMideastPanel({
  mountTarget = null,
  theatres = [],
  applyTheatre = null,
  labelFor = theatreLabel,
  translate = t,
  lang = currentLanguage(),
  documentRef = globalThis.document,
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement || !mountTarget) return INERT;

  const el = (tag, className = '', text = null) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className, text, onClick) => {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const label = (scene) => (typeof labelFor === 'function' ? labelFor(scene, translate) : (scene.name || scene.id));

  // ── Kostra (raz) ──────────────────────────────────────────────────────────
  // Stav je statický: panel v etape 1 nič nesťahuje sám, správy má bulletin.
  const status = el('div', 'mideast-status gas-status', translate('mideast.status'));
  status.dataset.state = 'ready';
  status.lang = lang;

  const dirsTitle = el('div', 'mideast-section-title gas-card-title', translate('mideast.theatres'));
  const dirs = el('div', 'mideast-dirs');
  dirs.setAttribute('role', 'group');
  dirs.setAttribute('aria-label', translate('mideast.theatres'));
  const dirByTheatre = new Map();
  for (const scene of theatres) {
    const b = button(`mideast-dir${scene.overview ? ' is-overview' : ''}`, '', () => {
      setActiveTheatre(scene.id);
      if (typeof applyTheatre === 'function') void applyTheatre(scene.id);
    });
    b.appendChild(el('span', 'mideast-dir-name', label(scene)));
    b.dataset.theatre = scene.id;
    b.setAttribute('aria-pressed', 'false');
    dirs.appendChild(b);
    dirByTheatre.set(scene.id, b);
  }

  // Správy z otvorených zdrojov: telo plní conflictBulletin z main.js (mount musí
  // byť VNÚTRI panela — bulletin hľadá vlastníka cez closest('[data-panel-id]')).
  const newsTitle = el('div', 'mideast-section-title gas-card-title', translate('mideast.news.title'));
  const news = el('div', 'mideast-news');
  news.dataset.mideastNews = '';
  const note = el('p', 'mideast-note', translate('mideast.note'));
  mountTarget.replaceChildren(status, dirsTitle, dirs, newsTitle, news, note);

  // ── Aktívne dejisko ───────────────────────────────────────────────────────
  // Panel sa o aktívnom dejisku dozvie aj zvonka (main.js po ?mideast=, rozbaľovačke
  // SCÉNY alebo hlase volá setActiveTheatre), preto je zvýraznenie samostatná funkcia.
  let activeTheatre = null;
  function setActiveTheatre(id) {
    activeTheatre = id || null;
    for (const [theatreId, b] of dirByTheatre) {
      const on = theatreId === activeTheatre;
      b.classList?.toggle?.('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  return {
    element: mountTarget,
    newsMount: news,
    setActiveTheatre,
    get activeTheatre() { return activeTheatre; },
    destroy() { dirByTheatre.clear(); mountTarget.replaceChildren(); },
  };
}
