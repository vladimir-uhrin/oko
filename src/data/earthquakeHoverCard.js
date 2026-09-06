import { t } from '../i18n.js';
import { createAreaPhotoLookup } from './earthquakeAreaPhoto.js';

const date = value => Number.isFinite(value) ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';
export function earthquakeHoverModel(event) {
  if (!event) return null;
  return {
    title: event.place || t('quake.event'), magnitude: `M${event.mag.toFixed(1)} ${event.magType || ''}`.trim(),
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
    show(event, at) {
      if (!event) { hide(); return; }
      if (current === event) return;
      hide(); current = event; const token = generation; const model = earthquakeHoverModel(event);
      root.replaceChildren(); root.hidden = false;
      const close = el('button', '×'); close.className = 'earthquake-hover-close'; close.setAttribute('aria-label', t('quake.close')); close.addEventListener('click', hide);
      el('strong', model.magnitude).className = 'earthquake-hover-mag';
      el('h3', model.title); el('p', model.association).className = 'earthquake-hover-note';
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
