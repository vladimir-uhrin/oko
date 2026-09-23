// src/ukraineDirectionCard.js — karta smeru v paneli UKRAJINA (B5, 2026-09-23).
//
// Po výbere smeru ukáže pod jeho tlačidlom, ako sa smer vyvíja v archíve
// hlásení GŠ ZSU: počet útokov v hlásení, 30 dní stĺpcov, priemer posledných
// 7 dní proti zvyšku okna a sídla, ktoré hlásenia za 14 dní menovali najčastejšie
// (klik = kamera nad sídlo). Celý front ukazuje súčet bojových stretov.
//
// Poctivosť (pravidlo 2 CLAUDE.md): počty sú tvrdenia jednej strany — karta to
// hovorí v poznámke; deň bez hlásenia je prázdny stĺpec, nespomenutý smer bodka,
// popoludňajšie priebežné hlásenie šrafovaný stĺpec mimo priemerov. Výpočty sú
// v čistom module data/ukraineDirectionTrend.js; tu je len DOM (bez innerHTML).

import { currentLanguage, t } from './i18n.js';
import { placeLabel } from './data/ukraineBase.js';
import {
  PLACES_DAYS, TREND_DAYS, TREND_RECENT_DAYS, directionSeries, directionTopPlaces, trendRange, trendStats,
} from './data/ukraineDirectionTrend.js';
import { frontSceneByGsDirection, frontSceneById, frontSceneLabel } from './ukraineFrontScenes.js';

const INERT = { element: null, setScene() {}, setRefDay() {}, refresh: async () => null, getState: () => ({ sceneId: null }), destroy() {} };

/**
 * @param {object} o
 * @param {(from: string, to: string) => Promise<any>} o.loadDirections odseky smerov po dňoch (store.directions)
 * @param {() => Promise<Map>} [o.placeIndex] index sídel podkladu (ukraineBase.getPlaceIndex)
 * @param {(place: {lat:number, lon:number, name:string, cls:string|null}) => void} [o.onPlace]
 */
export function createUkraineDirectionCard({
  loadDirections = null,
  placeIndex = null,
  onPlace = null,
  sceneById = frontSceneById,
  sceneFor = frontSceneByGsDirection,
  translate = t,
  lang = currentLanguage(),
  now = Date.now,
  documentRef = globalThis.document,
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement || typeof loadDirections !== 'function') return INERT;
  const locale = lang === 'en' ? 'en-GB' : 'sk-SK';
  const avgFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const intFormat = new Intl.NumberFormat(locale);
  const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const fmtDay = (day) => { const t0 = Date.parse(`${day}T00:00:00Z`); return Number.isFinite(t0) ? dayFormat.format(t0) : String(day || ''); };

  const el = (tag, className = '', text = null) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const root = el('section', 'ukraine-dircard');
  root.hidden = true;
  root.dataset.ukraineDircard = '';
  const head = el('div', 'ukraine-dircard-head');
  const name = el('span', 'ukraine-dircard-name');
  const gs = el('span', 'ukraine-dircard-gs');
  head.appendChild(name);
  head.appendChild(gs);
  const today = el('div', 'ukraine-dircard-today');
  const num = el('strong', 'ukraine-dircard-num');
  const unit = el('span', 'ukraine-dircard-unit');
  const trend = el('span', 'ukraine-dircard-trend');
  today.appendChild(num);
  today.appendChild(unit);
  today.appendChild(trend);
  const bars = el('div', 'ukraine-dircard-bars');
  bars.setAttribute('role', 'img');
  const axis = el('div', 'ukraine-dircard-axis');
  const axisFrom = el('span', '');
  const axisTo = el('span', '');
  axis.appendChild(axisFrom);
  axis.appendChild(axisTo);
  const stats = el('div', 'ukraine-dircard-stats');
  const placesTitle = el('div', 'ukraine-dircard-places-title', translate('ukraine.dircard.places', { n: PLACES_DAYS }));
  const places = el('div', 'ukraine-dircard-places');
  const status = el('p', 'ukraine-dircard-status');
  status.hidden = true;
  const note = el('p', 'ukraine-dircard-note', translate('ukraine.dircard.note'));
  root.replaceChildren(head, today, bars, axis, stats, placesTitle, places, status, note);

  let _sceneId = null;
  let _refDay = null;
  let _payload = null;
  let _payloadKey = '';
  let _error = null;
  let _loading = false;
  let _token = 0;
  let _last = null; // posledný výpočet (pre getState / testy)
  let _destroyed = false;

  function currentRange() {
    return trendRange(_refDay || new Date(now()).toISOString().slice(0, 10), TREND_DAYS);
  }

  function setStatus(text, kind) {
    status.textContent = text || '';
    status.dataset.state = kind || '';
    status.hidden = !text;
  }

  function barTitle(p, overview) {
    const day = fmtDay(p.day);
    if (p.missing) return translate('ukraine.dircard.bar-missing', { day });
    if (p.unmentioned) return translate('ukraine.dircard.bar-unmentioned', { day });
    if (!Number.isFinite(p.attacks)) return translate('ukraine.dircard.bar-unknown', { day });
    const n = intFormat.format(p.attacks);
    if (p.partial) return translate('ukraine.dircard.bar-partial', { day, n });
    return translate(overview ? 'ukraine.dircard.bar-total' : 'ukraine.dircard.bar', { day, n });
  }

  function renderBars(series, overview) {
    const values = series.filter((p) => Number.isFinite(p.attacks)).map((p) => p.attacks);
    const max = values.length ? Math.max(...values, 1) : 1;
    const nodes = series.map((p, i) => {
      const bar = el('span', 'ukraine-dircard-bar');
      const cls = [];
      if (p.missing) cls.push('is-missing');
      else if (p.unmentioned) cls.push('is-unmentioned');
      else if (!Number.isFinite(p.attacks)) cls.push('is-unknown');
      else if (p.attacks === 0) cls.push('is-zero');
      if (p.partial) cls.push('is-partial');
      if (i === series.length - 1) cls.push('is-ref');
      if (cls.length) bar.className = `ukraine-dircard-bar ${cls.join(' ')}`;
      if (Number.isFinite(p.attacks) && p.attacks > 0) bar.style.height = `${Math.max(6, Math.round((p.attacks / max) * 100))}%`;
      bar.title = barTitle(p, overview);
      bar.dataset.day = p.day;
      return bar;
    });
    bars.replaceChildren(...nodes);
    bars.setAttribute('aria-label', translate(overview ? 'ukraine.dircard.bars-total' : 'ukraine.dircard.bars', { n: series.length }));
    axisFrom.textContent = series.length ? fmtDay(series[0].day) : '';
    axisTo.textContent = series.length ? fmtDay(series.at(-1).day) : '';
  }

  function renderToday(st, overview) {
    const day = fmtDay(st.refDay);
    trend.hidden = true;
    trend.textContent = '';
    delete trend.dataset.trend;
    if (st.todayMissing) { num.textContent = '—'; unit.textContent = translate('ukraine.dircard.today-missing', { day }); }
    else if (st.todayUnmentioned) { num.textContent = '—'; unit.textContent = translate('ukraine.dircard.today-unmentioned', { day }); }
    else if (st.today === null) { num.textContent = '?'; unit.textContent = translate('ukraine.dircard.today-unknown', { day }); }
    else {
      num.textContent = intFormat.format(st.today);
      unit.textContent = translate(overview ? 'ukraine.dircard.today-total' : 'ukraine.dircard.today', { day })
        + (st.todayPartial ? ` · ${translate('ukraine.dircard.today-partial')}` : '');
    }
    if (st.trend) {
      trend.hidden = false;
      trend.dataset.trend = st.trend;
      trend.textContent = translate(`ukraine.dircard.trend.${st.trend}`);
      trend.title = translate('ukraine.dircard.trend-title', { n: TREND_RECENT_DAYS });
    }
    if (st.avgRecent === null) stats.textContent = translate('ukraine.dircard.stats-none');
    else if (st.avgEarlier === null) stats.textContent = translate('ukraine.dircard.stats-short', { recent: avgFormat.format(st.avgRecent), n: TREND_RECENT_DAYS });
    else stats.textContent = translate('ukraine.dircard.stats', { recent: avgFormat.format(st.avgRecent), earlier: avgFormat.format(st.avgEarlier), max: intFormat.format(st.max ?? 0), n: TREND_RECENT_DAYS });
  }

  function renderPlaces(list, { pending = false } = {}) {
    if (pending) { places.replaceChildren(el('span', 'ukraine-dircard-dim', translate('ukraine.dircard.places-loading'))); return; }
    if (!list.length) { places.replaceChildren(el('span', 'ukraine-dircard-dim', translate('ukraine.dircard.places-empty'))); return; }
    places.replaceChildren(...list.map((p) => {
      const label = placeLabel({ name: p.name, en: p.en, lang: 'uk', cls: p.cls }).text || p.name;
      const b = el('button', 'ukraine-dircard-place', translate('ukraine.dircard.place', { name: label, days: p.days }));
      b.type = 'button';
      b.title = translate('ukraine.dircard.place-title', { name: label, original: p.name, days: p.days, span: PLACES_DAYS, last: fmtDay(p.lastDay) });
      b.dataset.lat = String(p.lat);
      b.dataset.lon = String(p.lon);
      b.addEventListener('click', () => { if (typeof onPlace === 'function') onPlace({ lat: p.lat, lon: p.lon, name: label, cls: p.cls || null }); });
      return b;
    }));
  }

  async function render() {
    const scene = _sceneId ? sceneById(_sceneId) : null;
    if (!scene) { root.hidden = true; return; }
    root.hidden = false;
    root.classList?.toggle?.('is-overview', Boolean(scene.overview));
    name.textContent = frontSceneLabel(scene, translate);
    gs.textContent = scene.gs?.length ? scene.gs.join(' · ') : '';
    gs.hidden = !scene.gs?.length;
    placesTitle.hidden = Boolean(scene.overview);
    places.hidden = Boolean(scene.overview);
    const range = currentRange();
    if (!_payload) {
      num.textContent = '';
      unit.textContent = '';
      trend.hidden = true;
      stats.textContent = '';
      bars.replaceChildren();
      places.replaceChildren();
      setStatus(_error ? translate('ukraine.dircard.error', { detail: _error }) : translate('ukraine.dircard.loading'), _error ? 'error' : 'loading');
      return;
    }
    setStatus(_error ? translate('ukraine.dircard.error', { detail: _error }) : '', _error ? 'error' : '');
    const series = directionSeries(_payload.days, scene, sceneFor, range);
    const st = trendStats(series);
    renderBars(series, Boolean(scene.overview));
    renderToday(st, Boolean(scene.overview));
    _last = { sceneId: scene.id, range, series, stats: st, places: [] };
    if (scene.overview || typeof placeIndex !== 'function') return;
    const token = _token;
    renderPlaces([], { pending: true });
    let index = null;
    try { index = await placeIndex(); } catch { index = null; }
    if (_destroyed || token !== _token) return;
    const top = directionTopPlaces(_payload.days, scene, sceneFor, index, range);
    _last.places = top;
    renderPlaces(top);
  }

  async function refresh() {
    if (_destroyed || !_sceneId) return null;
    const range = currentRange();
    const key = range ? `${range.from}:${range.to}` : '';
    const token = ++_token;
    if (key !== _payloadKey) { _payload = null; _error = null; }
    void render();
    if (!range || (_payload && key === _payloadKey)) return _payload;
    _loading = true;
    try {
      const payload = await loadDirections(range.from, range.to);
      if (_destroyed || token !== _token) return null;
      _payload = payload && typeof payload === 'object' ? payload : { days: {} };
      _payloadKey = key;
      _error = null;
    } catch (error) {
      if (_destroyed || token !== _token) return null;
      _error = error?.message || String(error);
    } finally {
      if (token === _token) _loading = false;
    }
    await render();
    return _payload;
  }

  return {
    element: root,
    /** Aktívny smer (id presetu) alebo null = karta sa skryje. */
    setScene(id) {
      const next = id && sceneById(id) ? id : null;
      if (next === _sceneId) return;
      _sceneId = next;
      if (!next) { _token += 1; root.hidden = true; return; }
      void refresh();
    },
    /** Deň hlásenia, ku ktorému karta počíta (LIVE = dnešné hlásenie, os = deň kurzora). */
    setRefDay(day) {
      const next = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : null;
      if (next === _refDay) return;
      _refDay = next;
      if (_sceneId) void refresh();
    },
    refresh,
    getState: () => ({ sceneId: _sceneId, refDay: _refDay, loading: _loading, error: _error, hidden: root.hidden, last: _last }),
    destroy() { _destroyed = true; _token += 1; root.remove?.(); },
  };
}
