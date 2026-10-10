// src/meteogramPanel.js
// Pás s predpoveďou pre miesto (2026-10-08, „ako Windy"): po kliknutí na mapu so zapnutým počasím
// sa nad časovou osou otvorí tabuľka po 3 hodinách na 5 dní — dni, hodiny (miestny čas miesta),
// krivka a hodnoty teploty, zrážky, oblačnosť, vietor, nárazy a šípka smeru. Bunky majú farby
// rovnakých rámp ako pole na mape. Klik na stĺpec posunie mapu na ten čas (ak ho os má).
// Model a výpočty: src/data/meteogram.js. Žiadne Cesium.

import {
  STRONG_GUST_MS, columnIndexForTime, maxTemperatureSpread, meteogramDays, meteogramHour, rampCssColor, utcOffsetLabel,
  weatherIconKind, windArrowRotation,
} from './data/meteogram.js';
import { columnWarningLevels, createPointWarningsLookup, isActiveAt } from './data/meteogramWarnings.js';
import { WARNING_LEVELS, warningTimeLabel } from './data/weatherWarnings.js';
import { createNearestStationLookup, observedSummary } from './data/shmuStations.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const METEOGRAM_COL_PX = 42;
const CURVE_H = 34;

/** Body krivky teploty v SVG (x = stred stĺpca); prázdne hodnoty preskočí. Pure. */
export function temperaturePath(values, colPx = METEOGRAM_COL_PX, height = CURVE_H, range = null) {
  const finite = values.filter((v) => v !== null && Number.isFinite(v));
  if (finite.length < 2) return '';
  // Spoločná mierka pre krivky dvoch modelov (range), inak vlastné minimum a maximum.
  const lo = range ? range.lo : Math.min(...finite);
  const hi = range ? range.hi : Math.max(...finite);
  const span = Math.max(1, hi - lo);
  let d = '';
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    const x = i * colPx + colPx / 2;
    const y = 4 + (height - 8) * (1 - (v - lo) / span);
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return d;
}

/**
 * Teploty druhého modelu zarovnané na stĺpce prvého (podľa času) — kreslia sa prerušovanou krivkou.
 * Chýbajúci čas = null. Pure.
 */
export function alignedTemps(columns, otherColumns) {
  const byT = new Map((otherColumns || []).map((c) => [c.t, c.temp]));
  return (columns || []).map((c) => (byT.has(c.t) ? byT.get(c.t) : null));
}

/** Spoločný rozsah teplôt viacerých radov; null, ak hodnôt nie je aspoň 2. Pure. */
export function sharedRange(...lists) {
  const all = lists.flat().filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (all.length < 2) return null;
  return { lo: Math.min(...all), hi: Math.max(...all) };
}

const MODEL_PREF_KEY = 'oko.meteogram.model';

// Ikony počasia (2026-10-10): monochromatické čiary 24 × 24 vo farbe textu (OKO: ikony nie emoji).
const SUN = 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4';
const MOON = 'M15.5 3.5a8.5 8.5 0 1 0 5 14.5a7 7 0 0 1-5-14.5z';
const CLOUD = 'M7 19h10.5a4.5 4.5 0 0 0 .3-9a6 6 0 0 0-11.5 1.8A3.6 3.6 0 0 0 7 19z';
const CLOUD_HIGH = 'M7 14h10.5a4 4 0 0 0 .3-8a5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 7 14z';
const CLOUD_LOW = 'M9.5 20.5h8.5a3.8 3.8 0 0 0 .3-7.6a4.8 4.8 0 0 0-9.2 1.4a3.1 3.1 0 0 0 .4 6.2z';
const SMALL_SUN = 'M8 5a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM8 1.3v1.4M1.3 8h1.4M3.3 3.3l1 1M12.7 3.3l-1 1';
const SMALL_MOON = 'M9.5 2.5a5.5 5.5 0 1 0 4 9a4.5 4.5 0 0 1-4-9z';
/** Ťahy ikony podľa druhu z weatherIconKind. */
export const WEATHER_ICON_PATHS = Object.freeze({
  'clear-day': [SUN],
  'clear-night': [MOON],
  'partly-day': [SMALL_SUN, CLOUD_LOW],
  'partly-night': [SMALL_MOON, CLOUD_LOW],
  cloudy: [CLOUD],
  fog: ['M4 8.5h16M3 12.5h18M5 16.5h14'],
  drizzle: [CLOUD_HIGH, 'M9 17.5v.4M13 18.5v.4M17 17.5v.4M11 21v.4M15 21v.4'],
  rain: [CLOUD_HIGH, 'M9 16.5l-1 4M13 16.5l-1 4M17 16.5l-1 4'],
  sleet: [CLOUD_HIGH, 'M9 16.5l-1 4M14 17.8v.4M16 20.6v.4'],
  snow: [CLOUD_HIGH, 'M9 16.5v3.4M7.5 17.4l3 1.6M7.5 19l3-1.6M15 16.5v3.4M13.5 17.4l3 1.6M13.5 19l3-1.6'],
  showers: [CLOUD_HIGH, 'M8.5 16.5l-1 3M12.5 16.5l-1.6 5.5M16.5 16.5l-1 3'],
  thunder: [CLOUD_HIGH, 'M13.5 14.5l-3 4h3.2l-2.2 4.5'],
});

/** SVG ikona počasia (dekorácia — význam nesie title bunky). */
export function weatherIcon(doc, kind) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `meteogram-wx meteogram-wx-${kind}`);
  for (const d of WEATHER_ICON_PATHS[kind] || []) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Text hodnoty v bunke; prázdna bunka „–", po slovensky desatinná čiarka. Pure. */
export function cellText(value, digits = 0, lang = 'sk') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  let r = digits ? value.toFixed(digits) : String(Math.round(value));
  if (r === '-0') r = '0';
  return lang === 'en' ? r : r.replace('.', ',');
}

/**
 * Spodok pásu nad časovou osou (px od spodku okna): os má na mobile dva riadky a inú výšku,
 * pevné CSS ju prekrývalo. Null, keď os nie je vidieť. Pure.
 */
export function bottomAboveAnchor(anchorRect, viewportHeight, gap = 8) {
  if (!anchorRect || !(anchorRect.height > 0) || !Number.isFinite(viewportHeight)) return null;
  return Math.max(gap, Math.round(viewportHeight - anchorRect.top + gap));
}

/**
 * Nad čím pás stojí: na mobile nad vodorovným pásom vrstiev počasia (weatherDock.js), inak nad časovou osou.
 * Zvislý dock vpravo (počítač) sa neberie.
 */
export function meteogramAnchor(doc) {
  const dock = doc.getElementById?.('weather-dock');
  let anchor = null;
  if (dock && !dock.hidden) {
    const r = dock.getBoundingClientRect();
    if (r.width > r.height * 2) anchor = dock;
  }
  anchor ||= doc.getElementById?.('meteo-timeline');
  // Na mobile plášť dvíha kredity nad os a výber vrstiev (mobileShell.creditsBottomClear) — pás predpovede
  // sa postaví nad ne, inak by odkaz „Data attribution" ostal pod ním (2026-10-10).
  const credits = doc.getElementById?.('cesium-credits');
  if (anchor && credits && credits !== anchor && !credits.hidden && typeof credits.getBoundingClientRect === 'function' && typeof anchor.getBoundingClientRect === 'function') {
    const c = credits.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    if (c.height > 0 && c.top < a.top && c.bottom <= a.top + 1 && a.top - c.bottom < 24) return credits;
  }
  return anchor;
}

export function createMeteogramPanel(doc, {
  t, lang = () => 'sk', onClose = () => {}, onPickTime = () => {}, parent = doc.body,
  anchor = () => meteogramAnchor(doc),
  warningsFor = createPointWarningsLookup(),
  stationFor = createNearestStationLookup(),
  now = () => Date.now(),
} = {}) {
  const root = doc.createElement('section');
  root.id = 'meteogram';
  root.className = 'meteogram';
  root.hidden = true;
  root.setAttribute('aria-label', t('meteo.gram.title'));

  const head = doc.createElement('header');
  head.className = 'meteogram-head';
  const title = doc.createElement('h3');
  title.className = 'meteogram-title';
  const sub = doc.createElement('p');
  sub.className = 'meteogram-sub';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'meteogram-close';
  close.textContent = '×';
  close.title = t('meteo.gram.close');
  close.setAttribute('aria-label', t('meteo.gram.close'));
  close.addEventListener('click', () => { hide(); onClose(); });
  // Prepínač modelu (2026-10-09): GFS (ako mapa) / ECMWF; voľba ostane aj pre ďalšie miesta.
  const switcher = doc.createElement('div');
  switcher.className = 'meteogram-models';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', t('meteo.gram.model'));
  switcher.hidden = true;
  head.append(title, sub, switcher, close);

  const body = doc.createElement('div');
  body.className = 'meteogram-body';
  const labels = doc.createElement('div');
  labels.className = 'meteogram-labels';
  const scroller = doc.createElement('div');
  scroller.className = 'meteogram-scroll';
  const grid = doc.createElement('div');
  grid.className = 'meteogram-grid';
  scroller.append(grid);
  body.append(labels, scroller);

  // Výstraha SHMÚ pre okres miesta (meteogramWarnings.js) — pásik nad tabuľkou, len keď nejaká je.
  const warn = doc.createElement('div');
  warn.className = 'meteogram-warn';
  warn.hidden = true;

  // Namerané teraz na najbližšej stanici SHMÚ (do 20 km) — porovnanie s predpoveďou.
  const observed = doc.createElement('p');
  observed.className = 'meteogram-observed';
  observed.hidden = true;

  const status = doc.createElement('p');
  status.className = 'meteogram-status';
  root.append(head, warn, observed, body, status);
  let warnToken = 0;
  parent.append(root);

  let columns = [];
  let activeIso = null;
  let current = null; // posledný model z vrstvy (miesto + všetky modely)
  let lastWarnings = null;
  let modelId = null;
  try { modelId = doc.defaultView?.localStorage?.getItem(MODEL_PREF_KEY) || null; } catch { modelId = null; }

  function onKey(e) {
    if (e.key !== 'Escape' || root.hidden || e.defaultPrevented) return;
    hide(); onClose();
  }
  doc.addEventListener('keydown', onKey);

  function el(tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function row(cls) {
    const r = el('div', `meteogram-row ${cls}`);
    r.style.gridTemplateColumns = `repeat(${Math.max(1, columns.length)}, ${METEOGRAM_COL_PX}px)`;
    return r;
  }

  function markActive() {
    const i = columnIndexForTime(columns, activeIso);
    for (const cell of grid.querySelectorAll('[data-col]')) cell.classList.toggle('active', Number(cell.dataset.col) === i);
  }

  /** Pásik výstrah + farebný okraj hodín, keď výstraha platí. Prázdny zoznam pásik skryje. */
  function renderWarnings(result) {
    lastWarnings = result;
    const list = result?.warnings || [];
    warn.hidden = !list.length;
    if (!list.length) { warn.replaceChildren(); return; }
    const lang0 = lang();
    warn.replaceChildren(...list.map((w) => {
      const item = el('p', 'meteogram-warn-item');
      const color = WARNING_LEVELS[w.level]?.color || '#ffd200';
      item.style.setProperty('--warn', color);
      const chip = el('span', 'meteogram-warn-chip', `${t('warn.degree', { n: WARNING_LEVELS[w.level]?.degree ?? '?' })} · ${t(`warn.type.${w.type}`)}`);
      const text = el('span', 'meteogram-warn-text', `${(lang0 === 'en' && w.eventEn) || w.event} · ${warningTimeLabel(w.onset, lang0)} – ${warningTimeLabel(w.expires, lang0)} · ${t(isActiveAt(w, now()) ? 'warn.active' : 'warn.upcoming')}`);
      text.title = (lang0 === 'en' && w.headlineEn) || w.headline || '';
      item.append(chip, text);
      return item;
    }), el('p', 'meteogram-warn-source', t('meteo.gram.warn-source', { name: result.district.name })));
    const levels = columnWarningLevels(columns, list);
    for (const cell of grid.querySelectorAll('.meteogram-cell.hour')) {
      const lv = levels[Number(cell.dataset.col)];
      cell.classList.toggle('warned', Boolean(lv?.level));
      if (lv?.color) cell.style.setProperty('--warn', lv.color); else cell.style.removeProperty('--warn');
    }
    doc.defaultView && place();
  }

  function renderObserved(hit) {
    const s = hit?.station;
    const values = s ? observedSummary(s, lang(), t('st.wind').toLowerCase(), t('meteo.gram.row-gust').split(' ')[0].toLowerCase()) : '';
    observed.hidden = !values;
    if (!values) { observed.textContent = ''; return; }
    const dist = hit.km >= 1 ? ` (${Math.round(hit.km)} km)` : '';
    observed.textContent = t('meteo.gram.observed', { name: s.name, dist, values, at: warningTimeLabel(new Date(s.at).toISOString(), lang()) });
    observed.title = t('st.source');
    if (doc.defaultView) place();
  }

  /** Vybraný model a ten druhý na porovnanie z model.models; bez nich (starý tvar) len rady z modelu. */
  function pickViews(model) {
    const list = Array.isArray(model.models) && model.models.length ? model.models : [{ id: 'gfs', label: 'GFS', series: model.series, columns: model.columns }];
    const view = list.find((m) => m.id === modelId) || list[0];
    return { list, view, other: list.find((m) => m !== view) || null };
  }

  function renderSwitcher(list, view) {
    switcher.hidden = list.length < 2;
    switcher.replaceChildren(...(list.length < 2 ? [] : list.map((m) => {
      const b = el('button', `meteogram-model${m === view ? ' active' : ''}`, m.label);
      b.type = 'button';
      b.dataset.model = m.id;
      b.title = m.name || m.label;
      b.setAttribute('aria-pressed', String(m === view));
      return b;
    })));
  }

  switcher.addEventListener('click', (e) => {
    const id = e.target?.closest?.('[data-model]')?.dataset?.model;
    if (!id || id === modelId || !current) return;
    modelId = id;
    try { doc.defaultView?.localStorage?.setItem(MODEL_PREF_KEY, id); } catch { /* súkromné okno */ }
    const left = scroller.scrollLeft;
    draw(current);
    scroller.scrollLeft = left;
  });

  function render(model) {
    current = model;
    const token = ++warnToken;
    renderWarnings(null);
    renderObserved(null);
    if (Number.isFinite(model.lat) && Number.isFinite(model.lon)) {
      Promise.resolve(warningsFor(model.lat, model.lon)).then((r) => { if (token === warnToken && !root.hidden) renderWarnings(r); }).catch(() => {});
      Promise.resolve(stationFor(model.lat, model.lon)).then((r) => { if (token === warnToken && !root.hidden) renderObserved(r); }).catch(() => {});
    }
    draw(model);
    const i = columnIndexForTime(columns, activeIso);
    scroller.scrollLeft = i > 2 ? (i - 2) * METEOGRAM_COL_PX : 0;
  }

  function draw(model) {
    const { name, coords } = model;
    const { list, view, other } = pickViews(model);
    const { series, columns: cols } = view;
    renderSwitcher(list, view);
    columns = cols;
    const offset = series.utcOffsetSec || 0;
    title.textContent = name || coords;
    const elev = Number.isFinite(series.elevation) ? ` · ${t('meteo.gram.elevation').replace('{m}', String(Math.round(series.elevation)))}` : '';
    sub.textContent = `${name ? coords : ''}${name ? elev : elev.replace(/^ · /, '')}`;
    const spread = other ? maxTemperatureSpread(cols, other.columns) : null;
    const spreadText = spread !== null && spread >= 1
      ? ` · ${t('meteo.gram.spread', { a: view.label, b: other.label, d: cellText(spread, spread % 1 ? 1 : 0, lang()) })}`
      : '';
    // Nápoveda „klikni na stĺpec…" je samostatný úsek — na úzkom displeji ju CSS skryje (popis sa lámal na 4 riadky).
    status.replaceChildren(
      `${t('meteo.gram.source').replace('{model}', view.name || view.label).replace('{tz}', utcOffsetLabel(offset))} · ${t('meteo.forecast')}${series.stale ? ` · ${t('meteo.stale')}` : ''}${spreadText}`,
      el('span', 'meteogram-hint', ` · ${t('meteo.gram.hint')}`),
    );
    status.classList.remove('error');

    // Sneh len keď v zobrazených 5 dňoch nejaký padá; vlhkosť a tlak sú „doplnkové" — nízke okno ich skryje.
    const hasSnow = cols.some((c) => c.snow > 0);
    labels.replaceChildren(
      el('span', 'meteogram-label day', ''),
      el('span', 'meteogram-label hour', ''),
      el('span', 'meteogram-label curve', ''),
      el('span', 'meteogram-label', t('meteo.gram.row-wx')),
      el('span', 'meteogram-label', t('meteo.gram.row-temp')),
      el('span', 'meteogram-label', t('meteo.gram.row-precip')),
      ...(hasSnow ? [el('span', 'meteogram-label', t('meteo.gram.row-snow'))] : []),
      el('span', 'meteogram-label', t('meteo.gram.row-clouds')),
      el('span', 'meteogram-label extra', t('meteo.gram.row-humidity')),
      el('span', 'meteogram-label', t('meteo.gram.row-wind')),
      el('span', 'meteogram-label', t('meteo.gram.row-gust')),
      el('span', 'meteogram-label', t('meteo.gram.row-dir')),
      el('span', 'meteogram-label extra', t('meteo.gram.row-pressure')),
    );

    const days = row('days');
    let start = 1;
    for (const d of meteogramDays(cols, offset, lang())) {
      const c = el('span', 'meteogram-day', d.label);
      c.style.gridColumn = `${start} / span ${d.span}`;
      start += d.span;
      days.append(c);
    }
    const hours = row('hours');
    const curve = el('div', 'meteogram-row curve');
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(cols.length * METEOGRAM_COL_PX));
    svg.setAttribute('height', String(CURVE_H));
    svg.setAttribute('aria-hidden', 'true');
    // Krivka vybraného modelu plná, druhého prerušovaná na spoločnej mierke — kde sa rozchádzajú, je predpoveď neistá.
    const temps = cols.map((c) => c.temp);
    const otherTemps = other ? alignedTemps(cols, other.columns) : [];
    const range = sharedRange(temps, otherTemps);
    if (other) {
      const alt = doc.createElementNS(SVG_NS, 'path');
      alt.setAttribute('d', temperaturePath(otherTemps, METEOGRAM_COL_PX, CURVE_H, range));
      alt.setAttribute('class', 'meteogram-curve alt');
      svg.append(alt);
    }
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', temperaturePath(temps, METEOGRAM_COL_PX, CURVE_H, range));
    path.setAttribute('class', 'meteogram-curve');
    svg.append(path);
    curve.append(svg);
    const wx = row('wx');
    const temp = row('temp');
    const precip = row('precip');
    const snow = row('snow');
    const clouds = row('clouds');
    const humidity = row('humidity extra');
    const wind = row('wind');
    const gust = row('gust');
    const dir = row('dir');
    const pressure = row('pressure extra');

    cols.forEach((c, i) => {
      const cell = (r, text, cls = '') => {
        const n = el('button', `meteogram-cell ${cls}`.trim(), text);
        n.type = 'button';
        n.dataset.col = String(i);
        n.tabIndex = -1;
        r.append(n);
        return n;
      };
      cell(hours, meteogramHour(c.t, offset), 'hour');
      const kind = weatherIconKind(c.code, c.isDay);
      const wc0 = cell(wx, '', 'wx');
      if (kind) {
        wc0.append(weatherIcon(doc, kind));
        wc0.title = t(`meteo.wx.${kind}`);
      }
      const tc = cell(temp, cellText(c.temp), 'value');
      const tColor = rampCssColor('temp', c.temp);
      if (tColor) tc.style.background = tColor;
      const pc = cell(precip, c.precip ? cellText(c.precip, c.precip < 10 ? 1 : 0, lang()) : '', 'precip');
      if (c.precip) pc.style.setProperty('--bar', `${Math.min(100, Math.round(Math.sqrt(c.precip / 10) * 100))}%`);
      if (hasSnow) cell(snow, c.snow ? cellText(c.snow, c.snow < 10 ? 1 : 0, lang()) : '', c.snow ? 'snow has' : 'snow');
      const cc = cell(clouds, cellText(c.clouds), 'clouds');
      if (c.clouds !== null) cc.style.setProperty('--cover', String(Math.min(1, Math.max(0, c.clouds / 100))));
      cell(humidity, cellText(c.humidity), 'plain');
      const wc = cell(wind, cellText(c.wind), 'value');
      const wColor = rampCssColor('wind', c.wind);
      if (wColor) wc.style.background = wColor;
      const gc = cell(gust, cellText(c.gust), `value${c.gust >= STRONG_GUST_MS ? ' strong' : ''}`);
      const gColor = rampCssColor('wind', c.gust);
      if (gColor) gc.style.background = gColor;
      if (c.gust >= STRONG_GUST_MS) gc.title = t('meteo.gram.strong-gust', { kmh: Math.round(c.gust * 3.6) });
      const dc = cell(dir, '', 'dir');
      const rot = windArrowRotation(c.windDir);
      if (rot !== null) {
        const arrow = el('span', 'meteogram-arrow', '↑');
        arrow.style.transform = `rotate(${Math.round(rot)}deg)`;
        dc.append(arrow);
        dc.title = `${Math.round(c.windDir)}°`;
      }
      cell(pressure, cellText(c.pressure), 'plain');
    });
    grid.replaceChildren(days, hours, curve, wx, temp, precip, ...(hasSnow ? [snow] : []), clouds, humidity, wind, gust, dir, pressure);
    markActive();
    if (lastWarnings) renderWarnings(lastWarnings); // prepnutie modelu prekreslí hodiny — farba výstrahy ostane
  }

  grid.addEventListener('click', (e) => {
    const cell = e.target?.closest?.('[data-col]');
    if (!cell) return;
    const c = columns[Number(cell.dataset.col)];
    if (c) onPickTime(c.t);
  });

  function place() {
    const a = anchor?.();
    const view = doc.defaultView;
    if (!a || a.hidden || !view) return;
    const bottom = bottomAboveAnchor(a.getBoundingClientRect(), view.innerHeight);
    if (bottom !== null) root.style.bottom = `${bottom}px`;
  }
  const onResize = () => { if (!root.hidden) place(); };
  doc.defaultView?.addEventListener?.('resize', onResize);

  function show() { root.hidden = false; place(); }
  function hide() { root.hidden = true; }

  return {
    element: root,
    showLoading(name) {
      warnToken += 1;
      renderWarnings(null);
      renderObserved(null);
      title.textContent = name;
      sub.textContent = '';
      current = null;
      switcher.hidden = true;
      labels.replaceChildren();
      grid.replaceChildren();
      columns = [];
      status.textContent = t('meteo.gram.loading');
      status.classList.remove('error');
      show();
    },
    showError(name) {
      title.textContent = name;
      status.textContent = t('meteo.gram.failed');
      status.classList.add('error');
      show();
    },
    showModel(model) { render(model); show(); },
    setActiveTime(iso) { activeIso = iso; markActive(); },
    hide,
    isOpen: () => !root.hidden,
    destroy() {
      doc.removeEventListener('keydown', onKey);
      doc.defaultView?.removeEventListener?.('resize', onResize);
      root.remove();
    },
  };
}
