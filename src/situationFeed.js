// src/situationFeed.js
//
// "Situation from open sources" — pilot. Renders the GDELT-backed open-source
// news feed (src/data/situationNews.js) in two places:
//   - createSituationPanel: the "GULF / ZÁLIV" panel in the DATA tab (full list).
//   - createSituationCard: a compact floating card shown with the Hormuz
//     chokepoint scene (top few headlines as context).
//
// Honesty (CLAUDE.md rules 2 & 6): every item LINKS OUT to the publisher (we do
// not reproduce article text), carries its source + time, and the footer marks
// the feed as aggregated open sources — not verified real-time intelligence. No
// person tracking, no face recognition. External links open in a new tab with
// rel="noopener noreferrer".

import { buildSituationModel, fetchSituationNews } from './data/situationNews.js';
import { classifyIncident } from './data/gulfIncidents.js';
import { currentLanguage, t } from './i18n.js';

const REFETCH_TTL_MS = 15 * 60_000;

const makeDiv = (doc, cls, text) => { const d = doc.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };

function fmtTime(ms, lang) {
  try { return new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); }
  catch { return ''; }
}

/**
 * Feed nodes: a list of headline links + an honest footer. Shared by the panel
 * and the floating card.
 * @returns {Node[]}
 */
export function buildSituationNodes(model, { doc, translate, lang, limit = 30 } = {}) {
  if (!model?.ok) return [makeDiv(doc, 'oko-sit-note', translate('situation.unavailable'))];
  if (model.empty) return [makeDiv(doc, 'oko-sit-note', translate('situation.empty'))];
  const list = makeDiv(doc, 'oko-sit-list');
  for (const it of model.items.slice(0, limit)) {
    const a = doc.createElement('a');
    a.className = 'oko-sit-item';
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (it.image) {
      const img = doc.createElement('img');
      img.className = 'oko-sit-thumb';
      img.src = it.image; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      a.appendChild(img);
    }
    const txt = makeDiv(doc, 'oko-sit-txt');
    txt.appendChild(makeDiv(doc, 'oko-sit-title', it.title));
    const meta = makeDiv(doc, 'oko-sit-meta');
    const cls = classifyIncident(it.title);
    if (cls) meta.appendChild(makeDiv(doc, `oko-sit-badge oko-inc-${cls.severity}`, translate(`incident.type-${cls.type}`)));
    meta.appendChild(doc.createTextNode(`${it.source}${it.ageLabel ? ` · ${it.ageLabel}` : ''}`));
    txt.appendChild(meta);
    a.appendChild(txt);
    list.appendChild(a);
  }
  const foot = makeDiv(doc, 'oko-sit-foot');
  foot.appendChild(makeDiv(doc, 'oko-sit-disc', translate('situation.disclaimer')));
  if (model.fetchedAt) foot.appendChild(makeDiv(doc, 'oko-sit-src', translate('situation.source', { time: fmtTime(model.fetchedAt, lang) })));
  return [list, foot];
}

/** DATA-tab panel (#gulf-panel), lazy-loaded on first expand. */
export function createSituationPanel({
  documentRef = globalThis.document,
  region = 'gulf',
  panelId = 'gulf-panel',
  fetch: fetchImpl = fetchSituationNews,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doc = documentRef;
  const panel = doc?.getElementById?.(panelId);
  const body = panel?.querySelector?.('[data-gulf-body]');
  if (!panel || !body) return { refresh: async () => {}, element: null };

  ensureStyle(doc);
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;
  let loadedOnce = false;

  const paint = () => { if (cached) body.replaceChildren(...buildSituationNodes(buildSituationModel(cached, { translate, nowMs: now() }), { doc, translate, lang })); };
  async function refresh() {
    if (cached && now() - cachedAt < REFETCH_TTL_MS) { paint(); return; }
    if (!cached) body.replaceChildren(makeDiv(doc, 'oko-sit-note', translate('situation.loading')));
    if (!inFlight) inFlight = Promise.resolve(fetchImpl(region)).then((p) => { cached = p; cachedAt = now(); return p; }).finally(() => { inFlight = null; });
    try { await inFlight; paint(); }
    catch { body.replaceChildren(makeDiv(doc, 'oko-sit-note', translate('situation.unavailable'))); }
  }
  const maybeLoad = () => { if (loadedOnce || panel.classList.contains('collapsed')) return; loadedOnce = true; void refresh(); };
  try { new MutationObserver(maybeLoad).observe(panel, { attributes: true, attributeFilter: ['class'] }); } catch { /* tests */ }
  maybeLoad();
  return { refresh, element: panel };
}

/** Floating card shown with a chokepoint scene (top few headlines). */
export function createSituationCard({
  documentRef = globalThis.document,
  fetch: fetchImpl = fetchSituationNews,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
  limit = 4,
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement) return { showFor: async () => {}, hide: () => {}, element: null };
  ensureStyle(doc);
  const el = doc.createElement('aside');
  el.className = 'oko-sit-card';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  (doc.body || doc.documentElement).appendChild(el);

  const cache = new Map(); // region -> { payload, at }
  let inFlight = null;

  const header = () => {
    const head = makeDiv(doc, 'oko-sit-head');
    head.appendChild(makeDiv(doc, 'oko-sit-h-title', translate('situation.title')));
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'oko-sit-close'; b.textContent = '×';
    b.setAttribute('aria-label', translate('situation.close'));
    b.addEventListener('click', hide);
    head.appendChild(b);
    return head;
  };
  const render = (model) => el.replaceChildren(header(), ...buildSituationNodes(model, { doc, translate, lang, limit }));

  async function showFor(region = 'gulf') {
    el.hidden = false;
    const hit = cache.get(region);
    if (hit && now() - hit.at < REFETCH_TTL_MS) { render(buildSituationModel(hit.payload, { translate, nowMs: now(), limit })); return; }
    el.replaceChildren(header(), makeDiv(doc, 'oko-sit-note', translate('situation.loading')));
    if (!inFlight) inFlight = Promise.resolve(fetchImpl(region)).then((p) => { cache.set(region, { payload: p, at: now() }); return p; }).finally(() => { inFlight = null; });
    try { render(buildSituationModel(await inFlight, { translate, nowMs: now(), limit })); }
    catch { render({ ok: false }); }
  }
  function hide() { el.hidden = true; }

  return { showFor, hide, element: el };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-sit-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-sit-style';
  style.textContent = `
.oko-sit-card{position:fixed;bottom:64px;left:10px;z-index:60;width:290px;max-width:calc(100vw - 20px);
  padding:9px 11px;border-radius:11px;background:rgba(11,22,34,.86);border:1px solid rgba(57,208,255,.28);
  box-shadow:0 8px 26px rgba(0,0,0,.5);backdrop-filter:blur(7px);
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;color:#dbeafe;pointer-events:auto;}
.oko-sit-card[hidden]{display:none;}
.oko-sit-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;}
.oko-sit-h-title{font-size:10px;font-weight:600;letter-spacing:.12em;color:#39d0ff;text-transform:uppercase;}
.oko-sit-close{appearance:none;background:none;border:0;color:#8aa0b6;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.oko-sit-close:hover{color:#dbeafe;}
.oko-sit-list{display:flex;flex-direction:column;gap:7px;}
.oko-sit-item{display:flex;gap:8px;text-decoration:none;color:inherit;padding:3px 0;border-bottom:1px solid rgba(120,150,180,.12);}
.oko-sit-item:last-child{border-bottom:0;}
.oko-sit-item:hover .oko-sit-title{color:#8fd9ff;}
.oko-sit-thumb{width:52px;height:38px;object-fit:cover;border-radius:5px;flex:0 0 auto;background:#12202f;}
.oko-sit-txt{min-width:0;}
.oko-sit-title{font-size:11px;line-height:1.3;color:#eaf2ff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.oko-sit-meta{font-size:9px;color:#6f8398;margin-top:2px;letter-spacing:.02em;}
.oko-sit-note{font-size:11px;color:#8aa0b6;padding:3px 0;}
.oko-sit-foot{margin-top:6px;}
.oko-sit-disc{font-size:8.5px;line-height:1.3;color:#6f8398;letter-spacing:.02em;}
.oko-sit-src{font-size:8.5px;color:#5b6f84;margin-top:1px;}
.oko-sit-badge{display:inline-block;font-size:8px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:0 5px;border-radius:5px;margin-right:5px;border:1px solid currentColor;}
.oko-sit-badge.oko-inc-critical{color:#f87171;}
.oko-sit-badge.oko-inc-major{color:#ffb547;}
.oko-sit-badge.oko-inc-minor{color:#39d0ff;}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
