// src/volbyPanel.js
/**
 * @module volbyPanel
 * @description Panel „VOĽBY 2026" v ľavom pruhu (2026-10-24, vlastník: „potreboval by som dnes narýchlo
 * spraviť sekciu voľby aj s aktuálnymi výsledkami … zatiaľ priebežne kandidátov a do večera by pribudli
 * výsledky, aby som to vedel už propagovať"). Spojené voľby do orgánov samosprávy obcí a samosprávnych
 * krajov, sobota 24. 10. 2026.
 *
 * Obsah: stavový riadok (fáza dňa — do 20:00 moratórium, potom sčítavanie — a čerstvosť), ŽUPNÉ VOĽBY
 * (8 krajov → kandidáti na predsedu a poslanci po volebných obvodoch), KOMUNÁLNE VOĽBY (hľadanie obce,
 * najväčšie mestá → kandidáti na starostu/primátora a poslanci po volebných obvodoch), poctivý riadok
 * zdroja. Klik na kraj alebo obec preletí kamerou nad miesto (polohy obcí z GeoNames, pri presnosti
 * „okres" to panel povie). Dáta: /api/volby (src/data/volbyService.js); modely sú čisté
 * (src/data/volbyCandidates.js). Výsledky ŠÚ SR po 20:00: panel ukáže, že tabuľky pribudli; ich
 * zobrazenie dopĺňa volbyResults.js, keď je známa štruktúra.
 *
 * DOM sa skladá tu z literálov (ako gasPanel.js); žiadne innerHTML, aby sa panel dal testovať na
 * falošnom dokumente v Node.
 */
import { currentLanguage } from './i18n.js';

export const VOLBY_PANEL_ID = 'volby-panel';
export const VOLBY_API = '/api/volby';
/** Prehľad (fáza, výsledky) sa obnovuje každé 2 min — ŠÚ SR podáva tabuľky po 3 min. */
export const VOLBY_REFRESH_MS = 2 * 60 * 1000;
export const VOLBY_SEARCH_DEBOUNCE_MS = 220;
export const VOLBY_SEARCH_MIN_CHARS = 2;
/** Prvých N kandidátov v dlhom zozname; ostatní za tlačidlom „Zobraziť všetkých". */
export const VOLBY_LIST_PREVIEW = 12;
export const KRAJ_VIEW_HEIGHT_M = 260_000;

/** Načítanie JSON z /api/volby (chyba = Error so status). */
export async function fetchVolbyJson(path, { fetcher = (...a) => fetch(...a) } = {}) {
  const response = await fetcher(`${VOLBY_API}${path}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return json;
}

export const volbyApi = Object.freeze({
  overview: (o) => fetchVolbyJson('/prehlad', o),
  kraj: (code, o) => fetchVolbyJson(`/kraj/${encodeURIComponent(code)}`, o),
  search: (q, o) => fetchVolbyJson(`/obce?q=${encodeURIComponent(q)}`, o),
  obec: (code, o) => fetchVolbyJson(`/obec/${encodeURIComponent(code)}`, o),
});

/**
 * Odkaz na zdieľanie: `?volby` otvorí panel, `?volby=<kód obce>` obec, `?volby=k<kraj>` kraj. Pure.
 * @returns {{ obec: string|null, kraj: string|null }|null} null = parameter chýba
 */
export function parseVolbyParam(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (!params.has('volby')) return null;
  const value = String(params.get('volby') || '').trim();
  if (/^k[1-8]$/i.test(value)) return { obec: null, kraj: value.slice(1) };
  if (/^[a-z0-9][a-z0-9-]{0,79}$/i.test(value)) return { obec: value, kraj: null };
  return { obec: null, kraj: null };
}

/** Odkaz na panel, obec alebo kraj. Pure. */
export function volbyLink(origin, { obec = null, kraj = null } = {}) {
  const base = `${String(origin || '').replace(/\/+$/, '')}/?volby`;
  if (obec) return `${base}=${encodeURIComponent(obec)}`;
  if (kraj) return `${base}=k${encodeURIComponent(kraj)}`;
  return base;
}

/** Výška kamery nad obcou podľa veľkosti (mandáty): mesto 20 km, väčšia obec 10 km, dedina 5 km. Pure. */
export function obecViewHeightM(obec) {
  const seats = Number(obec?.seats) || 0;
  if (obec?.city || seats >= 25) return 20_000;
  if (seats >= 13) return 10_000;
  return 5_000;
}

/** Celé meno s titulmi (rovnako ako na serveri; tu bez importu Node modulu). Pure. */
export function candidateLabel(c) {
  const head = [c?.titulPred, c?.meno, c?.priezvisko].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ');
  return c?.titulZa ? `${head}, ${String(c.titulZa).trim()}` : head;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/**
 * @param {object} options
 * @param {Document} [options.doc]
 * @param {(k: string, v?: object) => string} options.t
 * @param {object} [options.api] { overview, kraj, search, obec } (test seam)
 * @param {string|null} [options.lang] pevný jazyk (testy); inak currentLanguage()
 * @param {() => number} [options.nowMs]
 * @param {number} [options.refreshMs] 0 = bez periodickej obnovy
 * @param {number} [options.debounceMs]
 * @param {(target: {lat:number, lon:number, heightM:number, label:string}) => void} [options.onFlyTo]
 * @param {(collapsed: boolean) => void} [options.setCollapsed]
 * @param {string} [options.origin] pre odkazy na zdieľanie
 * @param {(text: string) => (Promise<void>|void)} [options.copyText] schránka
 */
export function installVolbyPanel({
  doc = globalThis.document,
  t,
  api = volbyApi,
  lang = null,
  nowMs = () => Date.now(),
  refreshMs = VOLBY_REFRESH_MS,
  debounceMs = VOLBY_SEARCH_DEBOUNCE_MS,
  onFlyTo = null,
  setCollapsed = null,
  origin = '',
  copyText = null,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  const root = doc?.getElementById?.(VOLBY_PANEL_ID);
  const body = root?.querySelector?.('[data-volby-body]');
  if (!root || !body) return null;
  const language = () => lang || currentLanguage();
  const locale = () => (language() === 'sk' ? 'sk-SK' : 'en-GB');
  const number = (n) => new Intl.NumberFormat(locale()).format(Number(n) || 0);
  const clock = (iso) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bratislava' }).format(ms) : '';
  };

  const state = {
    overview: null, overviewError: null, kraj: null, krajCode: null, obec: null, obecCode: null,
    results: [], query: '', loading: false, searchError: null,
  };
  const krajCache = new Map();
  const obecCache = new Map();
  let overviewToken = 0;
  let searchToken = 0;
  let searchTimer = null;
  let interval = null;

  // ── Kostra ────────────────────────────────────────────────────────────────
  const status = el(doc, 'div', 'volby-status gas-status', t('volby.loading'));
  status.dataset.state = 'loading';
  const phase = el(doc, 'div', 'volby-phase');
  const counts = el(doc, 'div', 'volby-counts');
  const results = el(doc, 'div', 'volby-results');
  results.hidden = true;

  const krajeTitle = el(doc, 'h3', 'volby-section-title gas-card-title', t('volby.regions'));
  const krajeChips = el(doc, 'div', 'volby-chips volby-kraje');
  krajeChips.setAttribute('role', 'group');
  krajeChips.setAttribute('aria-label', t('volby.regions'));
  const krajBox = el(doc, 'div', 'volby-detail volby-kraj');
  krajBox.hidden = true;

  const obceTitle = el(doc, 'h3', 'volby-section-title gas-card-title', t('volby.municipal'));
  const searchWrap = el(doc, 'div', 'volby-search');
  const input = el(doc, 'input', 'volby-search-input');
  input.type = 'search';
  input.placeholder = t('volby.search-placeholder');
  input.setAttribute('aria-label', t('volby.search-placeholder'));
  input.autocomplete = 'off';
  searchWrap.appendChild(input);
  const hint = el(doc, 'div', 'volby-hint', t('volby.search-hint'));
  const mestaChips = el(doc, 'div', 'volby-chips volby-mesta');
  mestaChips.setAttribute('role', 'group');
  mestaChips.setAttribute('aria-label', t('volby.cities'));
  const list = el(doc, 'div', 'volby-list');
  list.hidden = true;
  const obecBox = el(doc, 'div', 'volby-detail volby-obec');
  obecBox.hidden = true;

  const source = el(doc, 'div', 'volby-source gas-source');
  // Najväčšie mestá nad hľadaním: jeden ťuk bez písania (desktop má panel v koridore s posuvníkom).
  body.append(status, phase, counts, results, krajeTitle, krajeChips, krajBox, obceTitle, mestaChips, searchWrap, hint, list, obecBox, source);

  const button = (className, text, onClick) => {
    const b = el(doc, 'button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const link = (href, text) => {
    const a = el(doc, 'a', 'volby-link', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  const clear = (node) => { node.textContent = ''; };

  function renderSource() {
    clear(source);
    source.append(
      t('volby.source-prefix'), ' ',
      link('https://www.minv.sk/?samosprava26-info10', t('volby.source-minv')), ' · ',
      link('https://volbysr.sk/', t('volby.source-susr')), ' · ',
      link('https://www.geonames.org/', t('volby.source-geonames')), '. ',
      t('volby.source-note'),
    );
  }

  // ── Stav a prehľad ────────────────────────────────────────────────────────
  function renderOverview() {
    const ov = state.overview;
    if (!ov) {
      status.textContent = state.overviewError ? t('volby.error', { error: state.overviewError }) : t('volby.loading');
      status.dataset.state = state.overviewError ? 'error' : 'loading';
      return;
    }
    const resultTables = ov.results?.tables?.length || 0;
    status.dataset.state = ov.sources?.minv?.stale ? 'stale' : 'ok';
    status.textContent = `${t(ov.phase === 'before' ? 'volby.status-before' : 'volby.status-counting')} · ${t('volby.as-of', { time: clock(ov.generatedAt) })}`;
    phase.textContent = t(ov.phase === 'before' ? 'volby.phase-before' : 'volby.phase-counting');
    const c = ov.counts || {};
    counts.textContent = t('volby.counts', {
      starosta: number(c.starosta), poslanci: number(c.poslanci), predseda: number(c.predseda), zupni: number(c.zupni), obce: number(c.obce),
    });
    results.hidden = ov.phase === 'before' && !resultTables;
    results.textContent = resultTables ? t('volby.results-tables', { n: number(resultTables) }) : t('volby.results-none');
    clear(krajeChips);
    for (const k of ov.kraje || []) {
      const chip = button('data-toggle-chip volby-chip volby-chip-kraj', k.short || k.code, () => { void selectKraj(k.code); });
      chip.dataset.kraj = k.code;
      chip.title = `${k.name} · ${t('volby.chip-kraj-title', { predseda: number(k.counts?.predseda), poslanci: number(k.counts?.poslanci) })}`;
      chip.setAttribute('aria-pressed', state.krajCode === k.code ? 'true' : 'false');
      krajeChips.appendChild(chip);
    }
    clear(mestaChips);
    for (const m of (ov.mesta || []).slice(0, 10)) {
      const chip = button('data-toggle-chip volby-chip volby-chip-mesto', m.name, () => { void selectObec(m.code); });
      chip.dataset.obec = m.code;
      chip.title = `${m.okres} · ${t('volby.chip-obec-title', { starosta: number(m.starosta), poslanci: number(m.poslanci) })}`;
      chip.setAttribute('aria-pressed', state.obecCode === m.code ? 'true' : 'false');
      mestaChips.appendChild(chip);
    }
  }

  async function loadOverview() {
    const token = ++overviewToken;
    try {
      const ov = await api.overview();
      if (token !== overviewToken) return;
      state.overview = ov;
      state.overviewError = null;
    } catch (error) {
      if (token !== overviewToken) return;
      state.overviewError = error?.message || String(error);
    }
    renderOverview();
  }

  // ── Kandidáti ─────────────────────────────────────────────────────────────
  function candidateRow(c) {
    const row = el(doc, 'div', 'volby-cand');
    row.appendChild(el(doc, 'span', 'volby-cand-n', c.n != null ? `${c.n}.` : ''));
    const main = el(doc, 'div', 'volby-cand-main');
    main.appendChild(el(doc, 'span', 'volby-cand-name', candidateLabel(c)));
    const meta = [c.vek != null ? t('volby.age', { age: c.vek }) : '', c.zamestnanie, c.bydlisko].filter(Boolean).join(' · ');
    if (meta) main.appendChild(el(doc, 'span', 'volby-cand-meta', meta));
    main.appendChild(el(doc, 'span', `volby-cand-party${c.nezavisly ? ' is-independent' : ''}`, c.nezavisly ? t('volby.independent') : (c.strany || '')));
    row.appendChild(main);
    return row;
  }

  /** Zoznam kandidátov; dlhý zoznam s tlačidlom „Zobraziť všetkých N". */
  function candidateList(cands, { preview = VOLBY_LIST_PREVIEW } = {}) {
    const wrap = el(doc, 'div', 'volby-cands');
    const render = (all) => {
      clear(wrap);
      const shown = all ? cands : cands.slice(0, preview);
      for (const c of shown) wrap.appendChild(candidateRow(c));
      if (!all && cands.length > preview) {
        wrap.appendChild(button('volby-more', t('volby.show-more', { n: number(cands.length) }), () => render(true)));
      }
    };
    render(false);
    return wrap;
  }

  /** Skupina (obvod) s prepínačom; `open` = rozbalená hneď. */
  function group(title, cands, { open = false } = {}) {
    const wrap = el(doc, 'div', 'volby-group');
    const body2 = candidateList(cands);
    body2.hidden = !open;
    const toggle = button('volby-group-toggle', title, () => {
      body2.hidden = !body2.hidden;
      toggle.setAttribute('aria-expanded', body2.hidden ? 'false' : 'true');
    });
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    wrap.append(toggle, body2);
    return wrap;
  }

  function detailHead(title, subtitle, { onFly = null, share = null } = {}) {
    const head = el(doc, 'div', 'volby-detail-head');
    const text = el(doc, 'div', 'volby-detail-text');
    text.appendChild(el(doc, 'div', 'volby-detail-title', title));
    if (subtitle) text.appendChild(el(doc, 'div', 'volby-detail-sub', subtitle));
    head.appendChild(text);
    const actions = el(doc, 'div', 'volby-detail-actions');
    if (onFly) actions.appendChild(button('volby-action', t('volby.fly'), onFly));
    if (share) {
      const copy = button('volby-action', t('volby.copy-link'), async () => {
        try { await copyText?.(share); copy.textContent = t('volby.copied'); } catch { copy.textContent = share; }
      });
      copy.title = share;
      actions.appendChild(copy);
    }
    head.appendChild(actions);
    return head;
  }

  function flyToKraj(k) {
    if (!onFlyTo || !k?.center) return;
    onFlyTo({ lat: k.center.lat, lon: k.center.lon, heightM: KRAJ_VIEW_HEIGHT_M, label: k.name });
  }
  function flyToObec(o) {
    if (!onFlyTo || !Number.isFinite(o?.lat) || !Number.isFinite(o?.lon)) return;
    onFlyTo({ lat: o.lat, lon: o.lon, heightM: obecViewHeightM(o), label: o.name });
  }

  function renderKraj() {
    const k = state.kraj;
    clear(krajBox);
    krajBox.hidden = !k;
    for (const chip of krajeChips.children || []) chip.setAttribute?.('aria-pressed', chip.dataset?.kraj === state.krajCode ? 'true' : 'false');
    if (!k) return;
    krajBox.appendChild(detailHead(k.zupa || k.name, t('volby.kraj-sub', { obvody: number(k.counts?.obvody), seats: number(k.counts?.seats) }), {
      onFly: k.center ? () => flyToKraj(k) : null,
      share: volbyLink(origin, { kraj: k.code }),
    }));
    krajBox.appendChild(el(doc, 'div', 'volby-subhead', t('volby.region-heads', { n: number(k.predseda?.length || 0) })));
    krajBox.appendChild(candidateList(k.predseda || [], { preview: 20 }));
    krajBox.appendChild(el(doc, 'div', 'volby-subhead', t('volby.region-council', { n: number(k.counts?.poslanci), seats: number(k.counts?.seats), obvody: number(k.counts?.obvody) })));
    for (const o of k.obvody || []) {
      krajBox.appendChild(group(t('volby.obvod', { n: o.n ?? o.code, seats: number(o.seats), count: number(o.kandidati?.length || 0) }), o.kandidati || []));
    }
  }

  async function selectKraj(code) {
    state.krajCode = String(code);
    state.obec = null; state.obecCode = null; renderObec();
    if (!krajCache.has(state.krajCode)) {
      status.dataset.state = 'loading';
      try { krajCache.set(state.krajCode, await api.kraj(state.krajCode)); } catch (error) { state.overviewError = error?.message || String(error); krajCache.delete(state.krajCode); }
      status.dataset.state = state.overview ? 'ok' : 'error';
    }
    state.kraj = krajCache.get(state.krajCode) || null;
    renderKraj();
    if (state.kraj) flyToKraj(state.kraj);
    setCollapsed?.(false);
  }

  function renderObec() {
    const o = state.obec;
    clear(obecBox);
    obecBox.hidden = !o;
    for (const chip of mestaChips.children || []) chip.setAttribute?.('aria-pressed', chip.dataset?.obec === state.obecCode ? 'true' : 'false');
    if (!o) return;
    const sub = [o.okres && o.okres !== o.name ? t('volby.okres', { okres: o.okres }) : '', o.kraj].filter(Boolean).join(' · ');
    obecBox.appendChild(detailHead(o.name, sub, {
      onFly: Number.isFinite(o.lat) ? () => flyToObec(o) : null,
      share: volbyLink(origin, { obec: o.code }),
    }));
    if (o.precision && o.precision !== 'obec') obecBox.appendChild(el(doc, 'div', 'volby-note', t('volby.approx')));
    if (o.unmatched) obecBox.appendChild(el(doc, 'div', 'volby-note', t('volby.unmatched')));
    // ŠÚ SR: 3 obce volia len zastupiteľstvo a v 3 sa voľby nekonajú — povedať, nie mlčať.
    if (o.typ && !/starosta/i.test(o.typ)) obecBox.appendChild(el(doc, 'div', 'volby-note volby-note-typ', t('volby.typ', { typ: o.typ })));
    const starosta = o.kandidati?.starosta || [];
    obecBox.appendChild(el(doc, 'div', 'volby-subhead', t(o.city ? 'volby.mayor-city' : 'volby.mayor', { n: number(starosta.length) })));
    obecBox.appendChild(starosta.length ? candidateList(starosta, { preview: 20 }) : el(doc, 'div', 'volby-note', t('volby.none-registered')));
    const wards = o.kandidati?.poslanci || [];
    const total = wards.reduce((s, w) => s + (w.kandidati?.length || 0), 0);
    obecBox.appendChild(el(doc, 'div', 'volby-subhead', t('volby.council', { n: number(total), seats: number(o.seats), obvody: number(wards.length) })));
    if (wards.length === 1) obecBox.appendChild(candidateList(wards[0].kandidati || []));
    else for (const w of wards) obecBox.appendChild(group(t('volby.ward', { n: w.obvod, count: number(w.kandidati?.length || 0) }), w.kandidati || [], { open: false }));
    if (o.krajObvod) {
      obecBox.appendChild(el(doc, 'div', 'volby-note', t('volby.region-ward', { name: o.krajObvod.name, seats: number(o.krajObvod.seats), count: number(o.krajObvod.kandidati) })));
    }
  }

  async function selectObec(code) {
    state.obecCode = String(code);
    state.kraj = null; state.krajCode = null; renderKraj();
    list.hidden = true;
    if (!obecCache.has(state.obecCode)) {
      status.dataset.state = 'loading';
      try { obecCache.set(state.obecCode, await api.obec(state.obecCode)); } catch (error) { state.searchError = error?.message || String(error); obecCache.delete(state.obecCode); }
      status.dataset.state = state.overview ? 'ok' : 'error';
    }
    state.obec = obecCache.get(state.obecCode) || null;
    renderObec();
    if (state.obec) flyToObec(state.obec);
    setCollapsed?.(false);
  }

  // ── Hľadanie ──────────────────────────────────────────────────────────────
  function renderList() {
    clear(list);
    const rows = state.results || [];
    list.hidden = !state.query || (state.query.length < VOLBY_SEARCH_MIN_CHARS);
    if (list.hidden) return;
    if (state.searchError) { list.appendChild(el(doc, 'div', 'volby-note', t('volby.error', { error: state.searchError }))); return; }
    if (!rows.length) { list.appendChild(el(doc, 'div', 'volby-note', t('volby.no-match'))); return; }
    for (const o of rows) {
      const row = button('volby-row', '', () => { void selectObec(o.code); });
      row.dataset.obec = o.code;
      row.appendChild(el(doc, 'span', 'volby-row-name', o.name));
      row.appendChild(el(doc, 'span', 'volby-row-meta', [o.okres && o.okres !== o.name ? o.okres : '', t('volby.row-counts', { starosta: number(o.starosta), poslanci: number(o.poslanci) })].filter(Boolean).join(' · ')));
      list.appendChild(row);
    }
  }

  async function runSearch(query) {
    const token = ++searchToken;
    state.query = query;
    if (query.length < VOLBY_SEARCH_MIN_CHARS) { state.results = []; state.searchError = null; renderList(); return; }
    try {
      const res = await api.search(query);
      if (token !== searchToken) return;
      state.results = res?.results || [];
      state.searchError = null;
    } catch (error) {
      if (token !== searchToken) return;
      state.results = [];
      state.searchError = error?.message || String(error);
    }
    renderList();
  }

  input.addEventListener('input', () => {
    const query = String(input.value || '').trim();
    if (searchTimer != null) clearTimeoutImpl(searchTimer);
    searchTimer = setTimeoutImpl(() => { searchTimer = null; void runSearch(query); }, debounceMs);
  });

  /** Otvorenie z odkazu (`?volby=…`). */
  async function open({ obec = null, kraj = null } = {}) {
    setCollapsed?.(false);
    if (obec) return selectObec(obec);
    if (kraj) return selectKraj(kraj);
    return null;
  }

  function destroy() {
    overviewToken += 1;
    searchToken += 1;
    if (interval != null) { clearIntervalImpl(interval); interval = null; }
    if (searchTimer != null) { clearTimeoutImpl(searchTimer); searchTimer = null; }
  }

  renderSource();
  renderOverview();
  void loadOverview();
  if (refreshMs > 0) interval = setIntervalImpl(() => { void loadOverview(); }, refreshMs);

  return {
    open, destroy, selectKraj, selectObec, refresh: loadOverview,
    _getStateForTest: () => ({
      loaded: Boolean(state.overview), error: state.overviewError, phase: state.overview?.phase || null, status: status.dataset.state,
      krajCode: state.krajCode, obecCode: state.obecCode, results: state.results.length, query: state.query, searchError: state.searchError,
      kraje: krajeChips.children?.length || 0, mesta: mestaChips.children?.length || 0, nowMs: nowMs(),
    }),
  };
}
