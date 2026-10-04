// Admin panel OKO (2026-10-03) — malé SVG grafy bez knižnice.
// Paleta (tmavý povrch #0c111a, overená validátorom dataviz): séria 1 modrá,
// 2 oranžová, 3 tyrkysová. Stavové farby sú vyhradené a vždy so štítkom.
// Texty majú farbu textu, nie série. Každý graf má hover tooltip a tabuľku.

export const SERIES = ['#3987e5', '#d95926', '#199e70'];
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function div(className, text) {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const fmt = new Intl.NumberFormat('sk-SK');
export const number = value => fmt.format(Math.round(value * 100) / 100);

/** Pekné maximum osi (1, 2, 5 × 10^n). */
export function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

/** Stĺpec so zaobleným vrcholom 4 px ukotvený na nule. */
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function frame(container, height) {
  const wrap = div('chart');
  // Kontajner ešte nemusí byť v DOM (clientWidth 0) — vtedy šírka hlavného stĺpca mínus padding sekcie.
  const width = Math.max(280, container.clientWidth || ((document.querySelector('main')?.clientWidth || 730) - 90));
  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  const tip = div('chart-tip');
  tip.hidden = true;
  wrap.append(svg, tip);
  return { wrap, svg, tip, width };
}

function axes(svg, { left, top, plotW, plotH, max, format }) {
  for (const fraction of [0, 0.5, 1]) {
    const y = top + plotH - fraction * plotH;
    svg.append(svgEl('line', { x1: left, x2: left + plotW, y1: y, y2: y, class: fraction ? 'chart-grid' : 'chart-base' }));
    const label = svgEl('text', { x: left - 6, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' });
    label.textContent = format(max * fraction);
    svg.append(label);
  }
}
function xLabels(svg, labels, xAt, y) {
  const every = Math.max(1, Math.ceil(labels.length / 7));
  labels.forEach((text, i) => {
    if (i % every && i !== labels.length - 1) return;
    const label = svgEl('text', { x: xAt(i), y, 'text-anchor': 'middle', class: 'chart-axis' });
    label.textContent = text;
    svg.append(label);
  });
}
function showTip(tip, wrap, x, y, lines) {
  tip.replaceChildren(...lines.map(([text, color]) => {
    const row = div('chart-tip-row');
    if (color) { const key = div('chart-key'); key.style.background = color; row.append(key); }
    row.append(document.createTextNode(text));
    return row;
  }));
  tip.hidden = false;
  const box = wrap.getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(0, x + 12), box.width - tip.offsetWidth)}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
}

function dataTable(headers, rows) {
  const details = document.createElement('details');
  details.className = 'chart-table';
  const summary = document.createElement('summary');
  summary.textContent = 'tabuľka';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const h of headers) { const th = document.createElement('th'); th.textContent = h; head.append(th); }
  table.append(head);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) { const td = document.createElement('td'); td.textContent = cell; tr.append(td); }
    table.append(tr);
  }
  details.append(summary, table);
  return details;
}

function legend(series) {
  const node = div('chart-legend');
  for (const s of series) {
    const item = div('chart-legend-item');
    const key = div('chart-key');
    key.style.background = s.color;
    item.append(key, document.createTextNode(s.name));
    node.append(item);
  }
  return node;
}

/**
 * Čiarový graf, 1–3 série na jednej osi, crosshair + tooltip.
 * @param {HTMLElement} container
 * @param {{labels: string[], series: {name: string, values: number[]}[], height?: number, format?: (n:number)=>string}} spec
 */
export function lineChart(container, { labels, series, height = 200, format = number }) {
  const colored = series.map((s, i) => ({ ...s, color: SERIES[i] }));
  const { wrap, svg, tip, width } = frame(container, height);
  const left = 44; const right = 12; const top = 10; const bottom = 24;
  const plotW = width - left - right; const plotH = height - top - bottom;
  const max = niceMax(Math.max(0, ...colored.flatMap(s => s.values)));
  const xAt = i => left + (labels.length > 1 ? (i / (labels.length - 1)) * plotW : plotW / 2);
  const yAt = v => top + plotH - (v / max) * plotH;
  axes(svg, { left, top, plotW, plotH, max, format });
  xLabels(svg, labels, xAt, height - 6);
  for (const s of colored) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join('');
    svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  const cross = svgEl('line', { y1: top, y2: top + plotH, class: 'chart-cross', visibility: 'hidden' });
  const dots = colored.map(s => svgEl('circle', { r: 4, fill: s.color, stroke: '#0c111a', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const hit = svgEl('rect', { x: left, y: top, width: plotW, height: plotH, fill: 'transparent' });
  svg.append(hit);
  hit.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect();
    const i = Math.round(((event.clientX - box.left - left) / plotW) * (labels.length - 1));
    const index = Math.max(0, Math.min(labels.length - 1, i));
    const x = xAt(index);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    colored.forEach((s, k) => { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', yAt(s.values[index])); dots[k].setAttribute('visibility', 'visible'); });
    showTip(tip, wrap, x, top + 10, [[labels[index]], ...colored.map(s => [`${s.name}: ${format(s.values[index])}`, s.color])]);
  });
  hit.addEventListener('pointerleave', () => {
    tip.hidden = true; cross.setAttribute('visibility', 'hidden'); for (const d of dots) d.setAttribute('visibility', 'hidden');
  });
  const out = div('chart-block');
  if (colored.length > 1) out.append(legend(colored));
  out.append(wrap, dataTable(['', ...colored.map(s => s.name)], labels.map((label, i) => [label, ...colored.map(s => format(s.values[i]))])));
  container.append(out);
  return out;
}

/**
 * Stĺpcový graf jednej série; `colors` môže prefarbiť stĺpce stavovou farbou (so štítkom v tooltipe).
 * @param {HTMLElement} container
 */
export function barChart(container, { labels, values, height = 160, format = number, color = SERIES[0], name = 'Hodnota',
  marker = null, notes = [] }) {
  const { wrap, svg, tip, width } = frame(container, height);
  const left = 44; const right = 12; const top = 10; const bottom = 24;
  const plotW = width - left - right; const plotH = height - top - bottom;
  const max = niceMax(Math.max(0, marker ?? 0, ...values));
  const slot = plotW / Math.max(1, values.length);
  const barW = Math.max(2, Math.min(28, slot - 2));
  const xAt = i => left + slot * i + slot / 2;
  axes(svg, { left, top, plotW, plotH, max, format });
  xLabels(svg, labels, xAt, height - 6);
  values.forEach((value, i) => {
    const h = (value / max) * plotH;
    const fill = typeof color === 'function' ? color(value, i) : color;
    const bar = svgEl('path', { d: barPath(xAt(i) - barW / 2, top + plotH - h, barW, h), fill });
    svg.append(bar);
    const hit = svgEl('rect', { x: left + slot * i, y: top, width: slot, height: plotH, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => showTip(tip, wrap, xAt(i), top + plotH - h,
      [[labels[i]], [`${name}: ${format(value)}`, fill], ...(notes[i] ? [[notes[i]]] : [])]));
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.append(hit);
  });
  if (marker !== null && marker > 0) {
    const y = top + plotH - (marker / max) * plotH;
    svg.append(svgEl('line', { x1: left, x2: left + plotW, y1: y, y2: y, class: 'chart-marker' }));
    const label = svgEl('text', { x: left + plotW, y: y - 4, 'text-anchor': 'end', class: 'chart-axis' });
    label.textContent = `strop ${format(marker)}`;
    svg.append(label);
  }
  const out = div('chart-block');
  out.append(wrap, dataTable(['', name], labels.map((label, i) => [label, format(values[i])])));
  container.append(out);
  return out;
}

/** Vodorovné pruhy „top N" (jedna séria) — riadky s hodnotou a podielom. */
export function barList(container, rows, { total = null, limit = 12, format = number, labelOf = row => row.val } = {}) {
  const list = div('barlist');
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map(row => row.n));
  const sum = total ?? rows.reduce((s, row) => s + row.n, 0);
  for (const row of shown) {
    const item = div('barlist-row');
    const label = div('barlist-label', labelOf(row));
    const track = div('barlist-track');
    const fill = div('barlist-fill');
    fill.style.width = `${(row.n / max) * 100}%`;
    track.append(fill);
    const value = div('barlist-value', `${format(row.n)}${sum ? ` · ${Math.round((row.n / sum) * 100)} %` : ''}`);
    item.title = `${labelOf(row)}: ${format(row.n)}`;
    item.append(label, track, value);
    list.append(item);
  }
  if (!shown.length) list.append(div('barlist-empty', 'Zatiaľ bez údajov.'));
  if (rows.length > limit) list.append(div('barlist-empty', `+ ďalších ${rows.length - limit}`));
  container.append(list);
  return list;
}

/** Pás dostupnosti: bunka = hodina, farba = stav (vždy aj s textom v tooltipe). */
export function statusStrip(container, cells) {
  const strip = div('strip');
  for (const cell of cells) {
    const node = div(`strip-cell strip-${cell.state}`);
    node.title = cell.title;
    strip.append(node);
  }
  container.append(strip);
  return strip;
}
