// src/nowStrip.js — pás „Čo sa deje teraz": pilulka hore v strede, po ťuknutí zoznam udalostí (2026-11-11).
//
// Výber a texty sú v src/data/nowStrip.js (čisté). Tu je len DOM, načítanie troch koncových bodov, ktoré
// server už cachuje, a obnova raz za 10 minút, kým je karta prehliadača viditeľná. Žiadny nový serverový kód.
//
// Správanie (návrh a dve nezávislé kontroly 2026-11-11):
//   • pilulka sa ukáže, len keď je čo ukázať — prázdny alebo zlyhaný prvý stav nenechá na mape prázdnu škatuľku;
//   • keď zdroj neskôr zlyhá, ostáva jeho posledná dobrá odpoveď označená ZASTARANÉ (pravidlo projektu: stav dát
//     je viditeľný) — udalosti nezmiznú len preto, že server chvíľu neodpovedal;
//   • nikdy sa nerozbalí sama; rozbalí ju ťuknutie, zbalí ťuknutie na riadok, Escape alebo klik mimo;
//   • Escape pri otvorenom zozname patrí len pásu (zachytávacia fáza) — nezruší sledovanie letu za ním;
//   • riadok = <li> s tlačidlom (udalosť) a samostatným odkazom na zdroj — žiadne vnorené ovládacie prvky;
//   • obnova prekreslí zoznam len pri zmene a zachová fokus aj posun — riadok pod prstom sa nevymení;
//   • texty zo zdrojov idú cez textContent; fokus sa po zbalení vracia na pilulku;
//   • skrývanie v režimoch (kokpit, čistý pohľad, nahrávanie…) robí style.css, nie časovač.

import { buildNowItems, nowItemText } from './data/nowStrip.js';

export const NOW_REFRESH_MS = 10 * 60_000;
/** Strop na jedno načítanie vrátane čítania tela — zaseknutá požiadavka by inak držala všetky ďalšie obnovy. */
export const NOW_FETCH_TIMEOUT_MS = 15_000;
export const NOW_ENDPOINTS = Object.freeze({
  quakes: '/api/earthquakes/usgs',
  warnings: '/api/weather-warnings',
  ukraine: '/api/ukraine/report',
});

/** Prahy magnitúdy, ktoré ponúka riadok vrstvy Zemetrasenia (jeden z čipov ostane aktívny). */
const QUAKE_MIN_CHIPS = Object.freeze([4.5, 2.5, 1, -3]);

/**
 * Čo treba vo filtroch vrstvy Zemetrasenia uvoľniť, aby bolo otras z pásu vidno — a nič viac. Pure.
 * Obdobie sa mení len z „mesiaca" pri otrase pod M4,5 (mesačný katalóg slabšie nemá); prah magnitúdy len keď je
 * vyšší než otras; „len významné" sa vypne len keď je zapnuté. Bez zmeny vráti null.
 * @param {{ period?: string, minMagnitude?: number, significant?: boolean }} current
 * @param {number} mag
 * @returns {object|null}
 */
export function quakeFilterRelax(current, mag) {
  if (!Number.isFinite(mag)) return null;
  const next = {};
  if (current?.period === 'month' && mag < 4.5) next.period = mag >= 2.5 ? 'week' : 'day';
  if (Number.isFinite(current?.minMagnitude) && mag < current.minMagnitude) next.minMagnitude = QUAKE_MIN_CHIPS.find((v) => v <= mag) ?? -3;
  if (current?.significant === true) next.significant = false;
  return Object.keys(next).length ? next : null;
}

/**
 * @param {{
 *   doc?: Document, win?: Window, translate: (key: string, vars?: object) => string, lang?: () => string,
 *   fetchJson?: (url: string) => Promise<object|null>, now?: () => number,
 *   actions: Record<string, (focus: object, item: object) => void>,
 * }} deps `actions` má kľúče podľa `item.focus.type` (quake, warnings, ukraine).
 */
export function createNowStrip({
  doc = document, win = globalThis.window, translate, lang = () => 'sk', now = () => Date.now(),
  fetchJson = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(NOW_FETCH_TIMEOUT_MS) });
    return res.ok ? res.json() : null;
  },
  actions = {},
} = {}) {
  const root = doc.createElement('section');
  root.id = 'oko-now';
  root.setAttribute('aria-label', translate('now.title'));
  root.hidden = true;

  const pill = doc.createElement('button');
  pill.type = 'button';
  pill.className = 'oko-now-pill';
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute('aria-controls', 'oko-now-list');
  const dot = doc.createElement('span');
  dot.className = 'oko-now-dot';
  dot.setAttribute('aria-hidden', 'true');
  const pillLabel = doc.createElement('span');
  pillLabel.className = 'oko-now-label';
  pillLabel.textContent = translate('now.title');
  const pillCount = doc.createElement('span');
  pillCount.className = 'oko-now-count';
  pill.append(dot, pillLabel, pillCount);

  const list = doc.createElement('ul');
  list.id = 'oko-now-list';
  list.className = 'oko-now-list';
  list.hidden = true;

  root.append(pill, list);
  doc.body.append(root);

  let items = [];
  let lastSig = '';
  /** Posledná dobrá odpoveď každého zdroja — pri výpadku sa ukáže ako zastaraná. */
  const lastGood = {};
  let timer = null;
  let destroyed = false;
  let inFlight = null;

  const isOpen = () => !list.hidden;
  const collapse = ({ refocus = false } = {}) => {
    if (list.hidden) return;
    // Najprv fokus, potom skrytie: prvok skrytý s fokusom by ho pustil na <body>.
    if (refocus) pill.focus?.();
    list.hidden = true;
    pill.setAttribute('aria-expanded', 'false');
  };
  const expand = () => {
    if (!items.length) return;
    list.hidden = false;
    pill.setAttribute('aria-expanded', 'true');
  };

  const render = () => {
    const nowMs = now();
    const texts = items.map((item) => nowItemText(item, translate, { lang: lang(), nowMs }));
    // Podpis z toho, čo sa naozaj kreslí (aj „pred 12 min") — bez zmeny sa riadky nevymieňajú.
    const sig = JSON.stringify(items.map((item, i) => [item.id, item.state, item.sourceUrl, item.sourceLabel, texts[i]]));
    if (sig === lastSig) return;
    lastSig = sig;

    const active = doc.activeElement;
    const hadFocus = Boolean(active && list.contains?.(active));
    const focusId = hadFocus ? (active.parent ?? active.parentElement)?.dataset?.nowId ?? null : null;
    const focusWasSrc = hadFocus && String(active.className || '').includes('oko-now-src');
    const scroll = list.scrollTop;
    let refocusTarget = null;

    list.textContent = '';
    items.forEach((item, index) => {
      const text = texts[index];
      const li = doc.createElement('li');
      li.className = 'oko-now-item';
      li.dataset.nowId = item.id;
      li.dataset.nowKind = item.kind;
      li.dataset.nowState = item.state;

      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'oko-now-row';
      const title = doc.createElement('span');
      title.className = 'oko-now-row-title';
      title.textContent = text.title;
      const meta = doc.createElement('span');
      meta.className = 'oko-now-row-meta';
      meta.textContent = text.meta;
      row.append(title, meta);
      text.chips.forEach((chipText, chipIndex) => {
        const chip = doc.createElement('span');
        // Čip ZASTARANÉ je vždy prvý (nowItemText) — vlastná trieda, nie poradie v DOM.
        chip.className = item.state === 'stale' && chipIndex === 0 ? 'oko-now-chip is-stale' : 'oko-now-chip';
        chip.textContent = chipText;
        row.append(chip);
      });
      row.addEventListener('click', () => {
        collapse({ refocus: true });
        const run = actions[item.focus?.type];
        if (typeof run === 'function') { try { run(item.focus, item); } catch { /* akcia nikdy nezhodí stránku */ } }
      });
      li.append(row);

      let src = null;
      if (item.sourceUrl) {
        src = doc.createElement('a');
        src.className = 'oko-now-src';
        src.href = item.sourceUrl;
        src.target = '_blank';
        src.rel = 'noopener noreferrer';
        src.textContent = translate('now.source', { name: item.sourceLabel });
        li.append(src);
      }
      if (hadFocus && focusId === item.id) refocusTarget = focusWasSrc && src ? src : row;
      list.append(li);
    });
    pillCount.textContent = String(items.length);
    root.hidden = items.length === 0;
    if (!items.length) { collapse(); return; }
    if (Number.isFinite(scroll)) list.scrollTop = scroll;
    if (hadFocus) (refocusTarget || pill).focus?.();
  };

  const load = async () => {
    if (destroyed) return items;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const entries = await Promise.all(Object.entries(NOW_ENDPOINTS).map(async ([key, url]) => {
        try { return [key, await fetchJson(url)]; } catch { return [key, null]; }
      }));
      if (destroyed) return items;
      const feeds = {};
      for (const [key, payload] of entries) {
        if (payload && typeof payload === 'object') { lastGood[key] = payload; feeds[key] = payload; }
        // Zdroj neodpovedal: posledná dobrá odpoveď ostáva, ale ako zastaraná. Časové okná výberu ju aj tak
        // časom vyradia (otras po 24 h, výstraha po skončení, hlásenie po 30 h).
        else if (lastGood[key]) feeds[key] = { ...lastGood[key], stale: true };
      }
      items = buildNowItems(feeds, now());
      render();
      return items;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };

  pill.addEventListener('click', () => { if (isOpen()) collapse(); else expand(); });
  /** Je pás práve vykreslený? V režimoch, kde ho style.css skrýva, Escape neberie. */
  const rendered = () => root.offsetParent !== null || root.offsetParent === undefined;
  const onKey = (event) => {
    if (event?.key !== 'Escape' || !isOpen()) return;
    if (!rendered()) { collapse(); return; }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    collapse({ refocus: true });
  };
  const onPointer = (event) => { if (isOpen() && !root.contains?.(event?.target)) collapse(); };
  const onVisible = () => { if (doc.hidden === false) void load(); };
  // Zachytávacia fáza: beží pred poslucháčmi Escape na dokumente (sledovanie letu, karty, výsuv).
  doc.addEventListener?.('keydown', onKey, true);
  doc.addEventListener?.('pointerdown', onPointer, true);
  doc.addEventListener?.('visibilitychange', onVisible);

  const start = () => {
    void load();
    // Na pozadí sa nič nesťahuje; po návrate na kartu sa zoznam obnoví hneď (onVisible).
    timer = (win?.setInterval ?? setInterval)(() => { if (doc.hidden !== true) void load(); }, NOW_REFRESH_MS);
  };

  return {
    start,
    load,
    items: () => items.slice(),
    isOpen,
    expand,
    collapse,
    destroy() {
      destroyed = true;
      if (timer != null) (win?.clearInterval ?? clearInterval)(timer);
      doc.removeEventListener?.('keydown', onKey, true);
      doc.removeEventListener?.('pointerdown', onPointer, true);
      doc.removeEventListener?.('visibilitychange', onVisible);
      root.remove?.();
    },
  };
}
