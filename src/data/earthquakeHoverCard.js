import { t } from '../i18n.js';
import { createAreaPhotoLookup } from './earthquakeAreaPhoto.js';
import { formatElapsed } from './earthquakeSequence.js';
import { mmiRoman } from './quakeMedia.js';

const date = value => Number.isFinite(value) ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';

/** Slovenské množné číslo: 1 → .one, 2–4 → .few, inak .many (angličtina má .few = .many). Pure. */
export function pluralKey(base, n) {
  const k = Math.abs(Math.round(Number(n) || 0));
  return base + (k === 1 ? '.one' : k >= 2 && k <= 4 ? '.few' : '.many');
}

/** Oficiálne varovania pred tsunami (NOAA) — odkaz pri príznaku oceánskeho otrasu. */
export const TSUNAMI_INFO_URL = 'https://www.tsunami.gov/';

/**
 * Riadky dopadov podľa USGS (2026-11-06): PAGER, príznak oceánskeho otrasu (tsunami), hlásenia
 * „Did You Feel It?", najvyššia intenzita ShakeMap. Len to, čo zdroj naozaj poslal — nič sa
 * nedopočítava. `short` = kratšie znenie pre kartu na plátne. Pure.
 * @returns {Array<{key:string, text:string, level?:string, url?:string}>}
 */
export function earthquakeImpactLines(event, { short = false } = {}) {
  const lines = [];
  if (!event) return lines;
  if (event.alert) {
    lines.push({ key: 'alert', level: event.alert, text: short
      ? t('quake.pagerShort', { level: t('quake.pagerLevel.' + event.alert) })
      : t('quake.pager', { level: t('quake.pager.' + event.alert) }) });
  }
  // USGS: príznak 1 = silný otras v oceánskej oblasti; NIE je to varovanie pred tsunami.
  if (event.tsunami) lines.push({ key: 'tsunami', level: 'tsunami', url: TSUNAMI_INFO_URL, text: t(short ? 'quake.tsunamiShort' : 'quake.tsunami') });
  if (Number.isFinite(event.felt)) {
    const n = event.felt.toLocaleString('sk-SK');
    lines.push({ key: 'felt', text: t(pluralKey(short ? 'quake.dyfiShort' : 'quake.dyfi', event.felt), { n })
      + (Number.isFinite(event.cdi) ? ' · ' + t('quake.cdi', { cdi: event.cdi.toFixed(1) }) : '') });
  }
  if (Number.isFinite(event.mmi)) lines.push({ key: 'mmi', text: t(short ? 'quake.mmiShort' : 'quake.mmi', { mmi: mmiRoman(event.mmi) }) });
  return lines;
}

/** Veta o sekvencii: dotras po hlavnom otrase, alebo počet dotrasov hlavného otrasu. Pure. */
export function earthquakeSequenceLine(link, { short = false } = {}) {
  if (!link) return null;
  if (link.role === 'aftershock') {
    return t(short ? 'quake.aftershockOfShort' : 'quake.aftershockOf', { mag: link.mainshockMag.toFixed(1),
      place: link.mainshockPlace || t('quake.event'), elapsed: formatElapsed(link.deltaMs), km: Math.round(link.distanceKm) });
  }
  if (link.role === 'mainshock') {
    return t(pluralKey(short ? 'quake.aftershocksShort' : 'quake.aftershocks', link.aftershocks), { n: link.aftershocks, mag: link.strongest.mag.toFixed(1) });
  }
  return null;
}

export function earthquakeHoverModel(event, { now = Date.now(), link = null } = {}) {
  if (!event) return null;
  return {
    title: event.place || t('quake.event'), magnitude: `M${event.mag.toFixed(1)} ${event.magType || ''}`.trim(),
    ago: Number.isFinite(event.time ?? event.solutions?.[0]?.time)
      ? t('quake.ago', { elapsed: formatElapsed(now - (event.time ?? event.solutions[0].time)) }) : null,
    impact: earthquakeImpactLines(event),
    sequence: earthquakeSequenceLine(link),
    association: t(event.association === 'probable' ? 'quake.probable' : 'quake.single'),
    solutions: event.solutions.map(s => ({
      title: s.source + ' · ' + s.sourceId + (s.stale ? ' · ' + t('quake.stale') : ''), url: s.url,
      rows: [
        [t('quake.measurement'), `M${s.mag.toFixed(1)} ${s.magType || ''}`.trim()],
        [t('quake.depth'), s.depth === null ? '—' : s.depth.toFixed(1) + ' km'],
        [t('quake.coordinates'), `${s.lat.toFixed(4)}°, ${s.lon.toFixed(4)}°`],
        [t('quake.time'), date(s.time)], [t('quake.updated'), date(s.updated)],
        [t('quake.agency'), s.author || '—'], [t('quake.solution'), s.status || t('quake.unknown')],
      ],
    })),
  };
}

/** One scrollable, pointer-accessible card. Async photos never change event identity. */
export function createEarthquakeHoverCard({ document: doc = globalThis.document,
  lookupPhoto = createAreaPhotoLookup(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  if (!doc?.body) return { show() {}, hide() {}, destroy() {}, isHovered: () => false };
  const root = doc.createElement('section'); root.className = 'earthquake-hover-card';
  root.hidden = true; root.setAttribute('aria-label', t('quake.event')); doc.body.appendChild(root);
  let current = null; let timer; let request; let generation = 0; let hovered = false;
  const el = (tag, text, parent = root) => { const node = doc.createElement(tag); if (text) node.textContent = text; parent.appendChild(node); return node; };
  const link = (text, url, parent) => {
    if (!/^https:\/\//.test(url || '')) return el('span', text, parent);
    const node = el('a', text, parent); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
  };
  function hide() { clearTimer(timer); request?.abort(); generation++; current = null; hovered = false; root.hidden = true; }
  function place(at) {
    const w = doc.documentElement.clientWidth; const h = doc.documentElement.clientHeight;
    const width = root.offsetWidth; const height = root.offsetHeight;
    root.style.left = Math.max(8, Math.min(at.x + 18, w - width - 8)) + 'px';
    root.style.top = Math.max(8, Math.min(at.y + 16, h - height - 8)) + 'px';
  }
  root.addEventListener('pointerenter', () => { hovered = true; });
  root.addEventListener('pointerleave', hide);
  function keydown(e) { if (e.key === 'Escape') hide(); }
  doc.addEventListener('keydown', keydown);
  return {
    isHovered: () => hovered || root.contains(doc.activeElement), hide,
    show(event, at, context = {}) {
      if (!event) { hide(); return; }
      if (current === event) return;
      hide(); current = event; const token = generation; const model = earthquakeHoverModel(event, context);
      root.replaceChildren(); root.hidden = false;
      const close = el('button', '×'); close.className = 'earthquake-hover-close'; close.setAttribute('aria-label', t('quake.close')); close.addEventListener('click', hide);
      el('strong', model.magnitude).className = 'earthquake-hover-mag';
      if (model.ago) el('span', model.ago).className = 'earthquake-hover-ago';
      el('h3', model.title);
      if (model.impact.length) {
        const impact = el('ul'); impact.className = 'earthquake-hover-impact';
        for (const line of model.impact) {
          const li = el('li', line.text, impact); if (line.level) li.dataset.level = line.level;
          if (line.url) { el('span', ' · ', li); link(t('quake.tsunamiLink'), line.url, li); }
        }
      }
      if (model.sequence) el('p', model.sequence).className = 'earthquake-hover-sequence';
      el('p', model.association).className = 'earthquake-hover-note';
      for (const solution of model.solutions) {
        const section = el('div'); section.className = 'earthquake-hover-solution';
        link(solution.title, solution.url, section);
        const list = el('dl', '', section);
        for (const [label, value] of solution.rows) { el('dt', label, list); el('dd', value, list); }
      }
      const photoRoot = el('div'); photoRoot.className = 'earthquake-hover-photo';
      el('p', t('quake.photoLoading'), photoRoot).className = 'earthquake-hover-note';
      el('p', t('quake.symbol')).className = 'earthquake-hover-note';
      place(at);
      timer = setTimer(async () => {
        request = new AbortController();
        let photo;
        try { photo = await lookupPhoto(event, { signal: request.signal }); } catch { photo = null; }
        if (token !== generation || current !== event) return;
        photoRoot.replaceChildren();
        if (!photo) { el('p', t('quake.photoMissing'), photoRoot).className = 'earthquake-hover-note'; return; }
        const anchor = link('', photo.filePage, photoRoot);
        const img = el('img', '', anchor); img.alt = photo.title; img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => { if (token === generation) { photoRoot.replaceChildren(); el('p', t('quake.photoMissing'), photoRoot); } });
        img.src = photo.thumb;
        el('p', t('quake.photoContext', { place: photo.title, km: photo.distanceKm.toFixed(1) }), photoRoot);
        link(photo.artist || 'Wikimedia Commons', photo.filePage, photoRoot);
        el('span', ' · ', photoRoot); link(photo.license, photo.licenseUrl || photo.filePage, photoRoot);
        place(at);
      }, 500);
    },
    destroy() { hide(); root.remove(); doc.removeEventListener('keydown', keydown); },
  };
}
