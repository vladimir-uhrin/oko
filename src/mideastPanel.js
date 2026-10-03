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
//
// Etapa 2 (KONTROLA SÍDIEL, 2026-09-26): voliteľný správca `control`
// (src/mideastControlLayer.js) pridá pod dejiská rad čipov s čipom KONTROLA SÍDIEL
// (prepína správcu; bez modulov v aktívnom dejisku je vypnutý) a LEGENDU po moduloch
// Wikipédie: titulok modulu, vzorky strán s počtom (farby inline z konfigurácie modulu —
// tá istá ikona je v každom module iná strana, spoločná legenda by klamala), sporné a
// zmiešané, riadok zdroja „stav k … · Wikipédia · CC BY-SA 4.0 · vek" so značkou
// ZASTARANÉ nad prahom modulu a poznámka, že zóny sú odvodené, nie línia frontu.
//
// Etapa 5b (VZDUŠNÝ PRIESTOR · EASA, 2026-10-03): voliteľný správca `airspace`
// (src/airspaceAdvisoryLayer.js) pridá do radu čip a legendu bulletinov EASA pre Blízky
// východ — krajiny, výšky (všetky / pod FL), „časť FIR", výnimky, platnosť a odkaz na
// bulletin; ostatné bulletiny sveta jedným riadkom. Poctivá poznámka: odporúčanie pre
// prevádzkovateľov z EÚ, nie zákaz letov; hranice FIR približné (VATSpy).

import { currentLanguage, t } from './i18n.js';
import { theatreLabel } from './data/mideastTheatres.js';
import { ageText } from './data/ukraineFreshness.js';
import { wikiControlModuleById } from './data/wikiControl.js';

const INERT = { element: null, newsMount: null, transitsMount: null, activeTheatre: null, setActiveTheatre() {}, destroy() {} };

/** `#4fa3ff` + krytie → `rgba(79, 163, 255, a)`; inú hodnotu nechá tak (bez krytia). Pure. */
export function swatchColour(css, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(css || ''));
  if (!m) return String(css || '');
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/**
 * @param {object} o
 * @param {Element|null} o.mountTarget prázdny prvok tela panela (`#mideast-panel [data-mideast-body]`)
 * @param {ReadonlyArray<object>} [o.theatres] dejiská ({ id, name, overview? }) — main.js podá listMideastTheatres()
 * @param {(id: string) => any} [o.applyTheatre] spustí dejisko (main.js)
 * @param {(scene: object, translate: Function) => string} [o.labelFor] popisok dejiska; predvolene theatreLabel
 * @param {object|null} [o.control] správca KONTROLY SÍDIEL (createMideastControl): getState/onChange/isEnabled/setEnabled
 * @param {object|null} [o.airspace] VZDUŠNÝ PRIESTOR · EASA (createAirspaceAdvisory): getState/onChange/isEnabled/setEnabled
 * @param {Function} [o.translate]
 * @param {string} [o.lang] jazyk pre formátovanie čísel a dátumov (počty v legende, „stav k")
 * @param {Document} [o.documentRef]
 */
export function createMideastPanel({
  mountTarget = null,
  theatres = [],
  applyTheatre = null,
  labelFor = theatreLabel,
  control = null,
  airspace = null,
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

  // ── KONTROLA SÍDIEL (etapa 2): čip + legenda po moduloch Wikipédie ──────────
  // Čip prepína správcu; stav (zapnuté, moduly dejiska, snímky) sa vracia cez
  // onChange, panel si nič nedomýšľa. Legenda sa skladá celá pri každej zmene.
  let chips = null; let legend = null; let controlChip = null;
  let airChip = null; let airLegend = null;
  const dateFormat = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const numberFormat = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');
  if (control || airspace) {
    chips = el('div', 'mideast-chips');
    chips.setAttribute('role', 'group');
    // Skupina nesie viac čipov (KONTROLA SÍDIEL, VZDUŠNÝ PRIESTOR) — neutrálny názov, nie meno jedného z nich.
    chips.setAttribute('aria-label', translate('mideast.part.layers'));
  }
  if (control) {
    controlChip = button('data-toggle-chip mideast-chip mideast-chip-control', translate('mideast.part.control'), () => {
      void control.setEnabled?.(!control.isEnabled?.());
    });
    controlChip.dataset.part = 'control';
    controlChip.setAttribute('aria-pressed', String(Boolean(control.isEnabled?.())));
    controlChip.title = translate('mideast.ctl.derived');
    chips.appendChild(controlChip);
    legend = el('div', 'mideast-legend');
    legend.hidden = true;
  }
  if (airspace) {
    airChip = button('data-toggle-chip mideast-chip mideast-chip-airspace', translate('mideast.part.airspace'), () => {
      void airspace.setEnabled?.(!airspace.isEnabled?.());
    });
    airChip.dataset.part = 'airspace';
    airChip.setAttribute('aria-pressed', String(Boolean(airspace.isEnabled?.())));
    airChip.title = translate('mideast.air.note');
    chips.appendChild(airChip);
    airLegend = el('div', 'mideast-legend mideast-air-legend');
    airLegend.hidden = true;
  }

  // PRECHODY ÚŽINAMI (etapa 5a): telo plní karta PortWatch z main.js (portwatchCard.js);
  // mount je VNÚTRI panela, karta si vlastníka nájde cez closest('[data-panel-id]').
  const transitsTitle = el('div', 'mideast-section-title gas-card-title', translate('mideast.pw.title'));
  const transits = el('div', 'mideast-transits');
  transits.dataset.mideastTransits = '';

  // Správy z otvorených zdrojov: telo plní conflictBulletin z main.js (mount musí
  // byť VNÚTRI panela — bulletin hľadá vlastníka cez closest('[data-panel-id]')).
  const newsTitle = el('div', 'mideast-section-title gas-card-title', translate('mideast.news.title'));
  const news = el('div', 'mideast-news');
  news.dataset.mideastNews = '';
  const note = el('p', 'mideast-note', translate('mideast.note'));
  mountTarget.replaceChildren(status, dirsTitle, dirs, ...[chips, legend, airLegend].filter(Boolean), transitsTitle, transits, newsTitle, news, note);

  // ── Legenda kontroly ──────────────────────────────────────────────────────
  // t() vracia pri chýbajúcom kľúči samotný kľúč → padá sa na anglický popis z konfigurácie
  // modulu (legenda Wikipédie), nikdy na holý kľúč.
  const textOr = (key, fallback) => { const s = translate(key); return s === key ? fallback : s; };
  const moduleTitle = (id, config) => textOr(`mideast.ctl.${id}.title`, config?.titles?.[0]?.title || id);
  const sideLabel = (id, side) => textOr(`mideast.ctl.${id}.${side.id}`, textOr(`mideast.ctl.${side.id}`, side.label || side.id));
  const fmtDate = (iso) => { const ms = Date.parse(String(iso || '')); return Number.isFinite(ms) ? dateFormat.format(new Date(ms)) : String(iso || '').slice(0, 10); };
  const legendItem = (css, text, count, cls, solid = false) => {
    const item = el('span', `mideast-legend-item ${cls}`);
    const sw = el('i', 'mideast-legend-swatch');
    // Farba strany inline z konfigurácie modulu; výplň zón je na mape priesvitná, bod sporného sídla plný.
    sw.setAttribute('style', solid ? `background: ${css}; border-color: ${css}` : `background: ${swatchColour(css, 0.35)}; border-color: ${swatchColour(css, 0.7)}`);
    item.appendChild(sw);
    item.appendChild(el('span', 'mideast-legend-label', text));
    item.appendChild(el('span', 'mideast-legend-count', numberFormat.format(count)));
    return item;
  };
  function renderModule(m) {
    const config = wikiControlModuleById(m.id);
    const box = el('div', 'mideast-legend-module');
    box.dataset.module = m.id;
    box.classList.toggle('is-stale', Boolean(m.stale));
    box.appendChild(el('div', 'mideast-legend-title', moduleTitle(m.id, config)));
    if (!m.revisionAt) {
      // Bez snímky: načítava sa (aj kým sa vrstva ešte neukázala), 404 = pre deň ešte nie je,
      // iná chyba = porucha; ZOBRAZENÁ vrstva bez snímky, chyby aj načítavania = „ešte nie je"
      // (nie večné „načítava sa" — napr. po prázdnej odpovedi).
      const kind = m.loading ? 'loading' : (m.error ? (m.error === 'no_control_snapshot' ? 'missing' : 'error') : (m.shown ? 'missing' : 'loading'));
      const state = el('div', 'mideast-legend-state', translate(`mideast.ctl.${kind}`));
      state.dataset.state = kind;
      box.appendChild(state);
      return box;
    }
    const items = el('div', 'mideast-legend-items');
    const settlements = m.summary?.settlements || {};
    const infrastructure = m.summary?.infrastructure || {};
    for (const side of config?.sides || []) {
      const n = (Number(settlements[side.id]) || 0) + (Number(infrastructure[side.id]) || 0);
      if (n > 0) items.appendChild(legendItem(side.css, sideLabel(m.id, side), n, `is-side is-${side.id}`));
    }
    if ((Number(settlements.contested) || 0) > 0) items.appendChild(legendItem(config?.contestedCss || '#ffb547', translate('mideast.ctl.contested'), Number(settlements.contested), 'is-contested', true));
    if ((Number(settlements.mixed) || 0) > 0) items.appendChild(legendItem(config?.mixedCss || '#c68cff', translate('mideast.ctl.mixed'), Number(settlements.mixed), 'is-mixed', true));
    box.appendChild(items);
    // Zdroj: „stav k <revízia> · Wikipédia · CC BY-SA 4.0 · vek", plný názov modulu v titulku; vek
    // sa ráta vo vrstve voči PREZERANÉMU dňu (requestedAt), prah je vlastnosťou modulu.
    const src = el('div', 'mideast-legend-source');
    src.title = config?.attribution || '';
    src.appendChild(el('span', 'mideast-legend-since', `${translate('mideast.ctl.since', { date: fmtDate(m.revisionAt) })} · ${translate('mideast.ctl.source')}`));
    const age = ageText(m.ageDays, translate);
    if (age) src.appendChild(el('span', 'mideast-legend-age', `· ${age}`));
    if (m.stale) {
      const badge = el('span', 'mideast-legend-age is-stale', translate('ukraine.src.stale'));
      badge.title = translate('ukraine.src.stale-note');
      src.appendChild(badge);
    }
    box.appendChild(src);
    return box;
  }
  function renderControl() {
    if (!control || !controlChip) return;
    const st = control.getState?.() || {};
    const modules = Array.isArray(st.modules) ? st.modules : [];
    const enabled = Boolean(st.enabled);
    controlChip.classList?.toggle?.('active', enabled);
    controlChip.setAttribute('aria-pressed', String(enabled));
    controlChip.disabled = modules.length === 0; // dejisko bez modulov Wikipédie (Hormuz, Irán, Irak…)
    controlChip.classList?.toggle?.('is-loading', modules.some((m) => m.loading));
    const visible = enabled && modules.length > 0;
    legend.hidden = !visible;
    if (!visible) { legend.replaceChildren(); return; }
    legend.replaceChildren(...modules.map(renderModule), el('p', 'mideast-legend-note', translate('mideast.ctl.derived')));
  }
  const unsubscribeControl = control?.onChange?.(() => renderControl()) || null;
  renderControl();

  // ── Legenda VZDUŠNÉHO PRIESTORU (etapa 5b) ────────────────────────────────
  // Bulletiny Blízkeho východu po jednom riadku; ostatné vo svete jedným riadkom (vrstva
  // ich kreslí tiež). Názvy krajín z i18n, inak anglický názov EASA.
  const countryName = (c) => textOr(`mideast.air.c.${String(c).toLowerCase().replace(/\s+/g, '-')}`, c);
  const fmtDay = (iso) => { const ms = Date.parse(`${iso}T00:00:00Z`); return Number.isFinite(ms) ? dateFormat.format(new Date(ms)) : String(iso || ''); };
  function airRow(b) {
    const row = el('div', 'mideast-air-row');
    row.dataset.czib = b.czib || b.nid;
    row.classList.toggle('is-partial', Boolean(b.scope?.partial));
    row.classList.toggle('is-below', b.scope?.altitude === 'below');
    const sw = el('i', 'mideast-legend-swatch mideast-air-swatch');
    row.appendChild(sw);
    const name = el('span', 'mideast-air-name', b.countries.map(countryName).join(', ') || b.title);
    name.title = b.title;
    row.appendChild(name);
    row.appendChild(el('span', 'mideast-air-badge', b.scope?.altitude === 'below' ? translate('mideast.air.below', { fl: b.scope.fl }) : translate('mideast.air.all')));
    if (b.scope?.partial) {
      const p = el('span', 'mideast-air-badge is-partial', translate('mideast.air.partial'));
      p.title = translate('mideast.air.partial-tip');
      row.appendChild(p);
    }
    if (b.scope?.exceptions) row.appendChild(el('span', 'mideast-air-badge', translate('mideast.air.exceptions')));
    if (b.validUntil) {
      const until = el('span', `mideast-air-until${b.lapsed ? ' is-stale' : ''}`, translate(b.lapsed ? 'mideast.air.lapsed' : 'mideast.air.until', { date: fmtDay(b.validUntil) }));
      row.appendChild(until);
    }
    if (b.url) {
      const a = el('a', 'mideast-air-link', translate('mideast.air.link'));
      a.href = b.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      if (b.czib) a.title = b.czib;
      row.appendChild(a);
    }
    return row;
  }
  function renderAirspace() {
    if (!airspace || !airChip) return;
    const st = airspace.getState?.() || {};
    const enabled = Boolean(st.enabled);
    airChip.classList?.toggle?.('active', enabled);
    airChip.setAttribute('aria-pressed', String(enabled));
    airChip.classList?.toggle?.('is-loading', Boolean(st.loading));
    airLegend.hidden = !enabled;
    if (!enabled) { airLegend.replaceChildren(); return; }
    const bulletins = Array.isArray(st.bulletins) ? st.bulletins : [];
    const parts = [el('div', 'mideast-legend-title', translate('mideast.air.title'))];
    if (!bulletins.length) {
      const kind = st.loading ? 'loading' : (st.error ? (st.error === 'no_airspace_snapshot' ? 'missing' : 'error') : 'loading');
      const state = el('div', 'mideast-legend-state', translate(`mideast.air.${kind}`));
      state.dataset.state = kind;
      parts.push(state);
    } else {
      const mine = bulletins.filter((b) => b.mideast);
      const rest = bulletins.filter((b) => !b.mideast);
      const rows = el('div', 'mideast-air-rows');
      for (const b of mine) rows.appendChild(airRow(b));
      parts.push(rows);
      if (rest.length) {
        const names = [...new Set(rest.flatMap((b) => b.countries).map(countryName))];
        parts.push(el('div', 'mideast-air-more', translate('mideast.air.more', { n: numberFormat.format(rest.length), list: names.join(', ') })));
      }
      const src = el('div', 'mideast-legend-source');
      src.title = [st.attribution, st.firAttribution].filter(Boolean).join(' · ');
      const since = st.fetchedAt ? `${translate('mideast.air.since', { date: dateFormat.format(new Date(st.fetchedAt)) })} · ` : '';
      src.appendChild(el('span', 'mideast-legend-since', `${since}${translate('mideast.air.source')}`));
      if (st.error) src.appendChild(el('span', 'mideast-legend-age is-stale', translate('mideast.air.error')));
      parts.push(src);
    }
    parts.push(el('p', 'mideast-legend-note', translate('mideast.air.note')));
    airLegend.replaceChildren(...parts);
  }
  const unsubscribeAirspace = airspace?.onChange?.(() => renderAirspace()) || null;
  renderAirspace();

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
    transitsMount: transits,
    setActiveTheatre,
    get activeTheatre() { return activeTheatre; },
    destroy() { unsubscribeControl?.(); unsubscribeAirspace?.(); dirByTheatre.clear(); mountTarget.replaceChildren(); },
  };
}
