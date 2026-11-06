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
//
// Etapa 5c (INCIDENTY LODÍ · UKMTO, 2026-10-03): voliteľný správca `ukmto`
// (src/ukmtoIncidentsLayer.js) pridá čip (predvolene zapnutý; bez aktívneho dejiska či úžiny
// je vypnutý ako KONTROLA SÍDIEL bez modulov) a legendu: počty podľa druhu za 30 dní,
// päť najnovších varovaní s časom a oblasťou, zdroj s licenciou OGL a odkaz na ukmto.org.
//
// Etapa 5d (RUŠENIE GPS · odvodené, 2026-10-03): voliteľný správca `gps`
// (src/gpsInterferenceLayer.js) pridá čip (predvolene vypnutý) a legendu: počty buniek podľa
// podielu lietadiel so zhoršenou presnosťou polohy (nad 10 %, 2–10 %, pod 2 %), obdobie,
// počet snímok a lietadiel, zdroj adsb.lol a poznámku, že ide o odvodený ukazovateľ.
//
// Etapa 4 (OVERENÉ UDALOSTI · GeoConfirmed + UCDP, 2026-11-05): voliteľný správca `incidents`
// (src/mideastIncidentsLayer.js) pridá čip (predvolene zapnutý; bez aktívneho dejiska vypnutý)
// a legendu: jednoduchá os = tri tlačidlá obdobia (7 d / 30 d / od 28. 2.) s počtom udalostí
// v dejisku, počty podľa druhu, päť najnovších udalostí (klik otvorí kartu), zdroje a poznámka
// o etickom filtri.
//
// Etapa 6 (2026-11-06): voliteľný správca `alerts` (src/mideastAlertsLayer.js) pridá čip
// POPLACHY · Izrael (predvolene zapnutý; mimo dejísk Izraela/Gazy/Západného brehu/južného Libanonu
// vypnutý) a legendu: obdobie (posledný deň / 7 d / 30 d / od 28. 2.) s počtom poplachov, počty
// podľa druhu, päť oblastí s najviac poplachmi (klik otvorí kartu), dátum dát mirroru a poznámka
// „nie je to varovný systém". `internet` (src/mideastIndicators.js) pridá čip INTERNET · OONI
// a legendu po krajinách dejiska (podiel blokovaných meraní 7 d proti 30 d, stupeň, krivka).
// `humanitarian` (tamže) NEMÁ čip — karta so súčtami Tech for Palestine sa ukáže sama pri Gaze,
// Západnom brehu a južnom Libanone a menuje, čie hlásenie to je; mená obetí nikdy.

import { currentLanguage, t } from './i18n.js';
import { GPS_COLORS } from './data/gpsInterference.js';
import { ALERT_KINDS, MIDEAST_ALERT_PERIODS, alertKindOf } from './data/mideastAlerts.js';
import { OONI_EXPLORER } from './data/mideastInternet.js';
import { MIDEAST_INCIDENT_PERIODS, mideastIncidentTypeOf } from './data/mideastIncidents.js';
import { theatreLabel } from './data/mideastTheatres.js';
import { UKMTO_SITE_URL, UKMTO_TYPES, UKMTO_TYPE_OTHER } from './data/ukmto.js';
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
 * @param {object|null} [o.ukmto] INCIDENTY LODÍ · UKMTO (createUkmtoIncidents): getState/onChange/isEnabled/setEnabled/labels
 * @param {object|null} [o.gps] RUŠENIE GPS · odvodené (createGpsInterference): getState/onChange/isEnabled/setEnabled
 * @param {object|null} [o.incidents] OVERENÉ UDALOSTI (createMideastIncidents): getState/onChange/isEnabled/setEnabled/setPeriod/openCard/labels
 * @param {object|null} [o.alerts] POPLACHY · Izrael (createMideastAlerts): getState/onChange/isEnabled/setEnabled/setPeriod/openCard/labels
 * @param {object|null} [o.humanitarian] HUMANITÁRNE SÚČTY (createMideastHumanitarian): getState/onChange — bez čipu
 * @param {object|null} [o.internet] INTERNET · OONI (createMideastInternet): getState/onChange/isEnabled/setEnabled
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
  ukmto = null,
  gps = null,
  incidents = null,
  alerts = null,
  humanitarian = null,
  internet = null,
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
  let shipChip = null; let shipLegend = null;
  let gpsChip = null; let gpsLegend = null;
  let incChip = null; let incLegend = null;
  let alertsChip = null; let alertsLegend = null;
  let netChip = null; let netLegend = null;
  let humCard = null;
  const dateFormat = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const numberFormat = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');
  if (control || airspace || ukmto || gps || incidents || alerts || internet) {
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
  if (incidents) {
    incChip = button('data-toggle-chip mideast-chip mideast-chip-incidents', translate('mideast.part.incidents'), () => {
      void incidents.setEnabled?.(!incidents.isEnabled?.());
    });
    incChip.dataset.part = 'incidents';
    incChip.setAttribute('aria-pressed', String(Boolean(incidents.isEnabled?.())));
    incChip.title = translate('mideast.inc.note');
    chips.appendChild(incChip);
    incLegend = el('div', 'mideast-legend mideast-inc-legend');
    incLegend.hidden = true;
  }
  if (alerts) {
    alertsChip = button('data-toggle-chip mideast-chip mideast-chip-alerts', translate('mideast.part.alerts'), () => {
      void alerts.setEnabled?.(!alerts.isEnabled?.());
    });
    alertsChip.dataset.part = 'alerts';
    alertsChip.setAttribute('aria-pressed', String(Boolean(alerts.isEnabled?.())));
    alertsChip.title = translate('mideast.alerts.note');
    chips.appendChild(alertsChip);
    alertsLegend = el('div', 'mideast-legend mideast-alerts-legend');
    alertsLegend.hidden = true;
  }
  if (ukmto) {
    shipChip = button('data-toggle-chip mideast-chip mideast-chip-ukmto', translate('mideast.part.ukmto'), () => {
      void ukmto.setEnabled?.(!ukmto.isEnabled?.());
    });
    shipChip.dataset.part = 'ukmto';
    shipChip.setAttribute('aria-pressed', String(Boolean(ukmto.isEnabled?.())));
    shipChip.title = translate('mideast.ukmto.note');
    chips.appendChild(shipChip);
    shipLegend = el('div', 'mideast-legend mideast-ukmto-legend');
    shipLegend.hidden = true;
  }
  if (gps) {
    gpsChip = button('data-toggle-chip mideast-chip mideast-chip-gps', translate('mideast.part.gps'), () => {
      void gps.setEnabled?.(!gps.isEnabled?.());
    });
    gpsChip.dataset.part = 'gps';
    gpsChip.setAttribute('aria-pressed', String(Boolean(gps.isEnabled?.())));
    gpsChip.title = translate('mideast.gps.note');
    chips.appendChild(gpsChip);
    gpsLegend = el('div', 'mideast-legend mideast-gps-legend');
    gpsLegend.hidden = true;
  }
  if (internet) {
    netChip = button('data-toggle-chip mideast-chip mideast-chip-internet', translate('mideast.part.internet'), () => {
      void internet.setEnabled?.(!internet.isEnabled?.());
    });
    netChip.dataset.part = 'internet';
    netChip.setAttribute('aria-pressed', String(Boolean(internet.isEnabled?.())));
    netChip.title = translate('mideast.net.note');
    chips.appendChild(netChip);
    netLegend = el('div', 'mideast-legend mideast-net-legend');
    netLegend.hidden = true;
  }
  if (humanitarian) {
    humCard = el('div', 'mideast-legend mideast-hum-card');
    humCard.hidden = true;
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
  mountTarget.replaceChildren(status, dirsTitle, dirs, ...[chips, legend, incLegend, alertsLegend, airLegend, shipLegend, gpsLegend, netLegend, humCard].filter(Boolean), transitsTitle, transits, newsTitle, news, note);

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

  // ── Legenda INCIDENTOV LODÍ (etapa 5c) ────────────────────────────────────
  // Bez aktívneho dejiska či úžiny vrstva nič nekreslí ani nesťahuje → čip je vypnutý
  // (ako KONTROLA SÍDIEL bez modulov) a titulok hovorí, kedy sa body ukážu.
  const dateTimeFormat = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  function renderUkmto() {
    if (!ukmto || !shipChip) return;
    const st = ukmto.getState?.() || {};
    const enabled = Boolean(st.enabled);
    const active = Boolean(st.active);
    shipChip.classList?.toggle?.('active', enabled);
    shipChip.setAttribute('aria-pressed', String(enabled));
    shipChip.disabled = !active;
    shipChip.title = translate(active ? 'mideast.ukmto.note' : 'mideast.ukmto.inactive');
    shipChip.classList?.toggle?.('is-loading', Boolean(st.loading));
    const visible = enabled && active;
    shipLegend.hidden = !visible;
    if (!visible) { shipLegend.replaceChildren(); return; }
    const summary = st.summary || { days: 30, total: 0, byType: [], latest: [] };
    const typeText = (id, fallback) => textOr(`mideast.ukmto.type.${id}`, fallback || id);
    const parts = [el('div', 'mideast-legend-title', translate('mideast.ukmto.title', { days: numberFormat.format(summary.days) }))];
    if (!st.loaded) {
      const kind = st.loading ? 'loading' : (st.error ? (st.error === 'no_ukmto_snapshot' ? 'missing' : 'error') : 'loading');
      const state = el('div', 'mideast-legend-state', translate(`mideast.ukmto.${kind}`));
      state.dataset.state = kind;
      parts.push(state);
    } else {
      if (!summary.total) {
        parts.push(el('div', 'mideast-legend-state', translate('mideast.ukmto.none', { days: numberFormat.format(summary.days) })));
      } else {
        const items = el('div', 'mideast-legend-items');
        for (const row of summary.byType) {
          const item = el('span', `mideast-legend-item is-ukmto is-${row.type}`);
          const sw = el('i', 'mideast-legend-swatch mideast-ukmto-swatch');
          sw.setAttribute('style', `background: ${row.css}; border-color: ${row.css}`);
          item.appendChild(sw);
          item.appendChild(el('span', 'mideast-legend-label', typeText(row.type)));
          item.appendChild(el('span', 'mideast-legend-count', numberFormat.format(row.count)));
          items.appendChild(item);
        }
        parts.push(items);
      }
      if (summary.latest.length) {
        const rows = el('div', 'mideast-ukmto-rows');
        rows.setAttribute('aria-label', translate('mideast.ukmto.latest'));
        for (const it of summary.latest) {
          const row = el('div', 'mideast-ukmto-row');
          row.dataset.ref = it.ref || it.id;
          row.title = it.text || '';
          const dot = el('i', 'mideast-legend-swatch mideast-ukmto-swatch');
          dot.setAttribute('style', `background: ${(UKMTO_TYPES.find((x) => x.id === it.type) || UKMTO_TYPE_OTHER).css}`);
          row.appendChild(dot);
          row.appendChild(el('span', 'mideast-ukmto-when', `${dateTimeFormat.format(new Date(it.t))} UTC`));
          row.appendChild(el('span', 'mideast-ukmto-type', ukmto.labels?.type?.(it) ?? typeText(it.type, it.typeName)));
          row.appendChild(el('span', 'mideast-ukmto-place', ukmto.labels?.place?.(it) ?? it.place ?? ''));
          rows.appendChild(row);
        }
        parts.push(rows);
      }
      const src = el('div', 'mideast-legend-source');
      src.title = st.attribution || '';
      const since = st.fetchedAt ? `${translate('mideast.ukmto.since', { date: dateFormat.format(new Date(st.fetchedAt)) })} · ` : '';
      src.appendChild(el('span', 'mideast-legend-since', `${since}${translate('mideast.ukmto.source')}`));
      const link = el('a', 'mideast-air-link', translate('mideast.ukmto.link'));
      link.href = UKMTO_SITE_URL; link.target = '_blank'; link.rel = 'noopener noreferrer';
      src.appendChild(link);
      if (st.error) src.appendChild(el('span', 'mideast-legend-age is-stale', translate('mideast.ukmto.error')));
      parts.push(src);
    }
    parts.push(el('p', 'mideast-legend-note', translate('mideast.ukmto.note')));
    shipLegend.replaceChildren(...parts);
  }
  const unsubscribeUkmto = ukmto?.onChange?.(() => renderUkmto()) || null;
  renderUkmto();

  // ── Legenda RUŠENIA GPS (etapa 5d) ────────────────────────────────────────
  // Farby ako bunky na mape (GPS_COLORS z src/data/gpsInterference.js); počet = počet buniek 0,5°.
  const GPS_SWATCH = GPS_COLORS;
  function renderGps() {
    if (!gps || !gpsChip) return;
    const st = gps.getState?.() || {};
    const enabled = Boolean(st.enabled);
    gpsChip.classList?.toggle?.('active', enabled);
    gpsChip.setAttribute('aria-pressed', String(enabled));
    gpsChip.classList?.toggle?.('is-loading', Boolean(st.loading));
    gpsLegend.hidden = !enabled;
    if (!enabled) { gpsLegend.replaceChildren(); return; }
    const parts = [el('div', 'mideast-legend-title', translate('mideast.gps.title'))];
    if (!st.loaded) {
      const kind = st.loading ? 'loading' : (st.error ? (st.error === 'no_gps_snapshot' ? 'missing' : 'error') : 'loading');
      const state = el('div', 'mideast-legend-state', translate(`mideast.gps.${kind}`));
      state.dataset.state = kind;
      parts.push(state);
    } else {
      const counts = st.counts || {};
      const items = el('div', 'mideast-legend-items');
      items.setAttribute('aria-label', translate('mideast.gps.cells'));
      for (const level of ['high', 'medium', 'none']) {
        const item = el('span', `mideast-legend-item is-gps is-${level}`);
        const sw = el('i', 'mideast-legend-swatch');
        sw.setAttribute('style', `background: ${swatchColour(GPS_SWATCH[level], level === 'none' ? 0.25 : 0.6)}; border-color: ${GPS_SWATCH[level]}`);
        item.appendChild(sw);
        item.appendChild(el('span', 'mideast-legend-label', translate(`mideast.gps.${level}`)));
        item.appendChild(el('span', 'mideast-legend-count', numberFormat.format(Number(counts[level]) || 0)));
        items.appendChild(item);
      }
      parts.push(items);
      if (!((Number(counts.high) || 0) + (Number(counts.medium) || 0) + (Number(counts.none) || 0))) {
        parts.push(el('div', 'mideast-legend-state', translate('mideast.gps.empty')));
      }
      const src = el('div', 'mideast-legend-source');
      src.title = st.attribution || '';
      const stats = translate('mideast.gps.stats', { snapshots: numberFormat.format(st.snapshots || 0), aircraft: numberFormat.format(st.aircraft || 0) });
      src.appendChild(el('span', 'mideast-legend-since', [st.period, stats].filter(Boolean).join(' · ')));
      if (st.todayPartial) src.appendChild(el('span', 'mideast-legend-age', `· ${translate('mideast.gps.partial')}`));
      src.appendChild(el('span', 'mideast-legend-age', `· ${translate('mideast.gps.source')}`));
      if (st.error) src.appendChild(el('span', 'mideast-legend-age is-stale', translate('mideast.gps.error')));
      parts.push(src);
    }
    parts.push(el('p', 'mideast-legend-note', translate('mideast.gps.note')));
    gpsLegend.replaceChildren(...parts);
  }
  const unsubscribeGps = gps?.onChange?.(() => renderGps()) || null;
  renderGps();

  // ── Legenda OVERENÝCH UDALOSTÍ (etapa 4) ──────────────────────────────────
  // Os = tri tlačidlá obdobia s počtom (súhrn po dňoch zo servera, v rámci dejiska); pod nimi
  // druhy obdobia a päť najnovších udalostí — klik na riadok otvorí kartu na mape.
  function renderIncidents() {
    if (!incidents || !incChip) return;
    const st = incidents.getState?.() || {};
    const enabled = Boolean(st.enabled);
    const active = Boolean(st.active);
    incChip.classList?.toggle?.('active', enabled);
    incChip.setAttribute('aria-pressed', String(enabled));
    incChip.disabled = !active;
    incChip.title = translate(active ? 'mideast.inc.note' : 'mideast.inc.inactive');
    incChip.classList?.toggle?.('is-loading', Boolean(st.loading));
    const visible = enabled && active;
    incLegend.hidden = !visible;
    if (!visible) { incLegend.replaceChildren(); return; }
    const parts = [el('div', 'mideast-legend-title', translate('mideast.inc.title'))];
    // Jednoduchá os: obdobie + počet udalostí (v dejisku; prehľad = celý región).
    const periods = el('div', 'mideast-inc-periods');
    periods.setAttribute('role', 'group');
    periods.setAttribute('aria-label', translate('mideast.inc.period'));
    const counts = st.periodCounts || {};
    for (const p of MIDEAST_INCIDENT_PERIODS) {
      const n = counts[p];
      const label = translate(`mideast.inc.period.${p}`);
      const b = button(`mideast-inc-period${st.period === p ? ' is-active' : ''}`, Number.isFinite(n) ? `${label} · ${numberFormat.format(n)}` : label, () => { void incidents.setPeriod?.(p); });
      b.dataset.period = p;
      b.setAttribute('aria-pressed', String(st.period === p));
      periods.appendChild(b);
    }
    parts.push(periods);
    const summary = st.summary || { total: 0, byType: [], latest: [] };
    if (!st.loaded) {
      const kind = st.loading ? 'loading' : (st.error ? (st.error === 'no_incidents_snapshot' ? 'missing' : 'error') : 'loading');
      const state = el('div', 'mideast-legend-state', translate(`mideast.inc.${kind}`));
      state.dataset.state = kind;
      parts.push(state);
    } else {
      if (!summary.total) {
        parts.push(el('div', 'mideast-legend-state', translate('mideast.inc.none')));
      } else {
        const items = el('div', 'mideast-legend-items');
        for (const row of summary.byType) {
          const item = el('span', `mideast-legend-item is-inc is-${row.type}`);
          const sw = el('i', 'mideast-legend-swatch mideast-ukmto-swatch');
          sw.setAttribute('style', `background: ${row.css}; border-color: ${row.css}`);
          item.appendChild(sw);
          item.appendChild(el('span', 'mideast-legend-label', textOr(`mideast.inc.type.${row.type}`, row.type)));
          item.appendChild(el('span', 'mideast-legend-count', numberFormat.format(row.count)));
          items.appendChild(item);
        }
        parts.push(items);
      }
      if (summary.latest.length) {
        const rows = el('div', 'mideast-ukmto-rows mideast-inc-rows');
        rows.setAttribute('aria-label', translate('mideast.inc.latest'));
        for (const it of summary.latest) {
          const row = button('mideast-ukmto-row mideast-inc-row', '', () => { incidents.openCard?.(it.id); });
          row.dataset.id = it.id;
          row.title = it.text || '';
          const dot = el('i', 'mideast-legend-swatch mideast-ukmto-swatch');
          dot.setAttribute('style', `background: ${mideastIncidentTypeOf(it.type).css}`);
          row.appendChild(dot);
          row.appendChild(el('span', 'mideast-ukmto-when', incidents.labels?.when?.(it) ?? dateFormat.format(new Date(it.t))));
          row.appendChild(el('span', 'mideast-ukmto-type', incidents.labels?.type?.(it) ?? textOr(`mideast.inc.type.${it.type}`, it.type)));
          row.appendChild(el('span', 'mideast-ukmto-place', incidents.labels?.place?.(it) ?? it.place ?? ''));
          rows.appendChild(row);
        }
        parts.push(rows);
      }
      const src = el('div', 'mideast-legend-source');
      src.title = [st.sources?.geoconfirmed?.attribution, st.sources?.ucdp?.attribution].filter(Boolean).join(' · ');
      const since = st.fetchedAt ? `${translate('mideast.inc.since', { date: dateFormat.format(new Date(st.fetchedAt)) })} · ` : '';
      src.appendChild(el('span', 'mideast-legend-since', `${since}${translate('mideast.inc.source')}`));
      if (st.error) src.appendChild(el('span', 'mideast-legend-age is-stale', translate('mideast.inc.error')));
      parts.push(src);
    }
    parts.push(el('p', 'mideast-legend-note', translate('mideast.inc.note')));
    incLegend.replaceChildren(...parts);
  }
  const unsubscribeIncidents = incidents?.onChange?.(() => renderIncidents()) || null;
  renderIncidents();

  // ── Legenda POPLACHOV · Izrael (etapa 6) ──────────────────────────────────
  // Obdobie = štyri tlačidlá s počtom poplachov (rakety + drony; predbežné upozornenia zvlášť);
  // päť oblastí s najviac poplachmi (klik otvorí kartu na mape); dátum dát mirroru NAHLAS.
  function renderAlerts() {
    if (!alerts || !alertsChip) return;
    const st = alerts.getState?.() || {};
    const enabled = Boolean(st.enabled);
    const active = Boolean(st.active);
    alertsChip.classList?.toggle?.('active', enabled);
    alertsChip.setAttribute('aria-pressed', String(enabled));
    alertsChip.disabled = !active;
    alertsChip.title = translate(active ? 'mideast.alerts.note' : 'mideast.alerts.inactive');
    alertsChip.classList?.toggle?.('is-loading', Boolean(st.loading));
    const visible = enabled && active;
    alertsLegend.hidden = !visible;
    if (!visible) { alertsLegend.replaceChildren(); return; }
    const parts = [el('div', 'mideast-legend-title', translate('mideast.alerts.title'))];
    const periods = el('div', 'mideast-inc-periods mideast-alerts-periods');
    periods.setAttribute('role', 'group');
    periods.setAttribute('aria-label', translate('mideast.alerts.period'));
    const counts = st.periodCounts || {};
    for (const p of MIDEAST_ALERT_PERIODS) {
      const n = counts[p];
      const label = translate(`mideast.alerts.period.${p}`);
      const b = button(`mideast-inc-period${st.period === p ? ' is-active' : ''}`, Number.isFinite(n) ? `${label} · ${numberFormat.format(n)}` : label, () => { void alerts.setPeriod?.(p); });
      b.dataset.period = p;
      b.setAttribute('aria-pressed', String(st.period === p));
      periods.appendChild(b);
    }
    parts.push(periods);
    if (!st.loaded) {
      const kind = st.loading ? 'loading' : (st.error ? (String(st.error).startsWith('no_alert') ? 'missing' : 'error') : 'loading');
      const state = el('div', 'mideast-legend-state', translate(`mideast.alerts.${kind}`));
      state.dataset.state = kind;
      parts.push(state);
    } else {
      const summary = st.summary || { totals: {}, alarms: 0, areas: 0, top: [] };
      const items = el('div', 'mideast-legend-items');
      for (const k of ALERT_KINDS) {
        const item = el('span', `mideast-legend-item is-alert is-${k.id}`);
        const sw = el('i', 'mideast-legend-swatch');
        sw.setAttribute('style', `background: ${swatchColour(k.css, k.alarm ? 0.6 : 0.3)}; border-color: ${k.css}`);
        item.appendChild(sw);
        item.appendChild(el('span', 'mideast-legend-label', translate(`mideast.alerts.kind.${k.id}`)));
        item.appendChild(el('span', 'mideast-legend-count', numberFormat.format(Number(summary.totals?.[k.id]) || 0)));
        items.appendChild(item);
      }
      parts.push(items);
      if (!summary.alarms) {
        parts.push(el('div', 'mideast-legend-state', translate('mideast.alerts.none')));
      } else {
        parts.push(el('div', 'mideast-legend-state', translate('mideast.alerts.areas', { n: numberFormat.format(summary.areas) })));
        const rows = el('div', 'mideast-ukmto-rows mideast-inc-rows mideast-alerts-rows');
        rows.setAttribute('aria-label', translate('mideast.alerts.top'));
        for (const row of summary.top) {
          const b = button('mideast-ukmto-row mideast-inc-row mideast-alerts-row', '', () => { alerts.openCard?.(row.slug); });
          b.dataset.slug = row.slug;
          const dot = el('i', 'mideast-legend-swatch mideast-ukmto-swatch');
          dot.setAttribute('style', `background: ${alertKindOf(row.d > row.r ? 'd' : 'r').css}`);
          b.appendChild(dot);
          const name = el('span', 'mideast-ukmto-type mideast-alerts-name', row.name);
          name.lang = 'he'; name.dir = 'rtl';
          b.appendChild(name);
          if (row.district) { const d = el('span', 'mideast-ukmto-place', row.district); d.lang = 'he'; d.dir = 'rtl'; b.appendChild(d); }
          b.appendChild(el('span', 'mideast-legend-count', numberFormat.format(row.alarms)));
          rows.appendChild(b);
        }
        parts.push(rows);
      }
      const src = el('div', 'mideast-legend-source');
      src.title = st.source?.attribution || '';
      const bits = [];
      if (st.dataUpdated) bits.push(translate('mideast.alerts.data', { date: dateFormat.format(new Date(st.dataUpdated)) }));
      if (st.lastDay) bits.push(translate('mideast.alerts.lastDay', { date: dateFormat.format(new Date(`${st.lastDay}T00:00:00Z`)) }));
      src.appendChild(el('span', 'mideast-legend-since', bits.join(' · ')));
      src.appendChild(el('span', 'mideast-legend-age', `· ${translate('mideast.alerts.source')}`));
      if (st.error) src.appendChild(el('span', 'mideast-legend-age is-stale', translate('mideast.alerts.error')));
      parts.push(src);
    }
    parts.push(el('p', 'mideast-legend-note', translate('mideast.alerts.note')));
    alertsLegend.replaceChildren(...parts);
  }
  const unsubscribeAlerts = alerts?.onChange?.(() => renderAlerts()) || null;
  renderAlerts();

  // ── Legenda INTERNET · OONI (etapa 6) ─────────────────────────────────────
  // Riadok na krajinu: meno, stupeň (zhoršenie / zlepšenie / bez zmeny / ticho), podiel 7 d proti
  // 30 d, počet meraní; „ticho" = málo meraní za 7 dní — práve to môže byť výpadok, OONI ho nemeria.
  function renderInternet() {
    if (!internet || !netChip) return;
    const st = internet.getState?.() || {};
    const enabled = Boolean(st.enabled);
    const active = Boolean(st.active);
    netChip.classList?.toggle?.('active', enabled);
    netChip.setAttribute('aria-pressed', String(enabled));
    netChip.disabled = !active;
    netChip.title = translate(active ? 'mideast.net.note' : 'mideast.net.inactive');
    netChip.classList?.toggle?.('is-loading', Boolean(st.loading));
    const visible = enabled && active;
    netLegend.hidden = !visible;
    if (!visible) { netLegend.replaceChildren(); return; }
    const parts = [el('div', 'mideast-legend-title', translate('mideast.net.title'))];
    if (!st.loaded) {
      const kind = st.loading ? 'loading' : (st.error ? (st.error === 'missing' ? 'missing' : 'error') : 'loading');
      const state = el('div', 'mideast-legend-state', translate(`mideast.net.${kind}`));
      state.dataset.state = kind;
      parts.push(state);
    } else {
      const rows = st.countries || [];
      if (!rows.length) parts.push(el('div', 'mideast-legend-state', translate('mideast.net.none')));
      const list = el('div', 'mideast-net-rows');
      for (const c of rows) {
        const row = el('div', `mideast-net-row is-${c.level}`);
        row.dataset.cc = c.cc;
        row.appendChild(el('span', 'mideast-net-country', textOr(`mideast.net.country.${c.cc}`, c.cc)));
        const level = el('span', `mideast-net-level is-${c.level}`, translate(`mideast.net.level.${c.level}`));
        row.appendChild(level);
        const nums = [];
        if (Number.isFinite(c.recent)) nums.push(translate('mideast.net.recent', { pct: numberFormat.format(c.recent) }));
        if (Number.isFinite(c.baseline)) nums.push(translate('mideast.net.baseline', { pct: numberFormat.format(c.baseline) }));
        nums.push(translate('mideast.net.measurements', { n: numberFormat.format(Number(c.measurements) || 0) }));
        row.appendChild(el('span', 'mideast-net-nums', nums.join(' · ')));
        row.title = Array.isArray(c.sparkline) ? c.sparkline.filter((d) => d.share !== null).map((d) => `${d.day.slice(5)} ${d.share} %`).join(' · ') : '';
        list.appendChild(row);
      }
      parts.push(list);
      const src = el('div', 'mideast-legend-source');
      src.title = st.source?.attribution || '';
      const since = st.fetchedAt ? `${translate('mideast.inc.since', { date: dateFormat.format(new Date(st.fetchedAt)) })} · ` : '';
      src.appendChild(el('span', 'mideast-legend-since', `${since}${translate('mideast.net.source')}`));
      const a = el('a', 'mideast-legend-age mideast-net-link', translate('mideast.net.link'));
      a.href = st.explorer || OONI_EXPLORER; a.target = '_blank'; a.rel = 'noopener noreferrer';
      src.appendChild(a);
      if (st.error) src.appendChild(el('span', 'mideast-legend-age is-stale', translate('mideast.net.error')));
      parts.push(src);
    }
    parts.push(el('p', 'mideast-legend-note', translate('mideast.net.note')));
    netLegend.replaceChildren(...parts);
  }
  const unsubscribeInternet = internet?.onChange?.(() => renderInternet()) || null;
  renderInternet();

  // ── Karta HUMANITÁRNYCH SÚČTOV (etapa 6, bez čipu) ────────────────────────
  // Len čísla. Titulok menuje dejisko, riadok zdroja menuje, čie hlásenie to je, a dátum hlásenia.
  function renderHumanitarian() {
    if (!humanitarian || !humCard) return;
    const st = humanitarian.getState?.() || {};
    const visible = Boolean(st.active) && Boolean(st.key);
    humCard.hidden = !visible;
    if (!visible) { humCard.replaceChildren(); return; }
    const parts = [el('div', 'mideast-legend-title', translate(`mideast.hum.title.${st.key}`))];
    if (!st.loaded) {
      const kind = st.loading ? 'loading' : (st.error ? (st.error === 'missing' ? 'missing' : 'error') : 'loading');
      const state = el('div', 'mideast-legend-state', translate(`mideast.hum.${kind}`));
      state.dataset.state = kind;
      parts.push(state);
    } else {
      const rows = st.rows || [];
      if (!rows.length) parts.push(el('div', 'mideast-legend-state', translate('mideast.hum.none')));
      const list = el('div', 'mideast-hum-rows');
      for (const r of rows) {
        const row = el('div', `mideast-hum-row is-${r.id}`);
        row.dataset.id = r.id;
        row.appendChild(el('span', 'mideast-hum-label', translate(`mideast.hum.row.${r.id}`)));
        row.appendChild(el('span', 'mideast-hum-value', numberFormat.format(r.value)));
        list.appendChild(row);
      }
      parts.push(list);
      const src = el('div', 'mideast-legend-source');
      src.title = st.source?.attribution || '';
      const report = st.block?.lastUpdate ? `${translate('mideast.hum.report', { date: dateFormat.format(new Date(`${st.block.lastUpdate}T00:00:00Z`)) })} · ` : '';
      src.appendChild(el('span', 'mideast-legend-since', `${report}${translate(`mideast.hum.source.${st.key}`)}`));
      if (st.error) src.appendChild(el('span', 'mideast-legend-age is-stale', translate('mideast.hum.error')));
      parts.push(src);
    }
    parts.push(el('p', 'mideast-legend-note', translate('mideast.hum.note')));
    humCard.replaceChildren(...parts);
  }
  const unsubscribeHumanitarian = humanitarian?.onChange?.(() => renderHumanitarian()) || null;
  renderHumanitarian();

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
    destroy() { unsubscribeControl?.(); unsubscribeAirspace?.(); unsubscribeUkmto?.(); unsubscribeGps?.(); unsubscribeIncidents?.(); unsubscribeAlerts?.(); unsubscribeInternet?.(); unsubscribeHumanitarian?.(); dirByTheatre.clear(); mountTarget.replaceChildren(); },
  };
}
