// src/fireNewsCard.js — správy a história k vybranému ohnisku FIRMS (2026-10-06).
//
// Vlastník: „karty prepojené na externý zdroj, ktorý potvrdí udalosť fotkou a textom z médií, ako
// na Ukrajine a Blízkom východe; vždy prepojené s médiami, aby sa to dalo ďalej spracovať“.
// Klik na ohnisko (vrstva local-firms vyberie záznam v kontextovom sklade → `gev:entity-selected`)
// otvorí DOM kartu vpravo dole: miesto (Nominatim), správy z GDELT s obrázkom, dôveryhodné médiá
// zvýraznené a verdikt „potvrdené správami“ (≥ 2 dôveryhodné domény — rovnaké pravidlo ako Udalosti),
// pod tým história z disku („v tomto mieste horí od …“). JSON pre ďalšie spracovanie:
// /api/firms/news?lat&lon a /api/firms/history?lat&lon&km&days.
import { t } from './i18n.js';
import { relativeAge } from './data/situationNews.js';

export const FIRE_LAYER_ID = 'local-firms';
export const FIRE_NEWS_API = '/api/firms/news';
export const FIRE_HISTORY_API = '/api/firms/history';
export const LINK_IMAGE_API = '/api/link-image';
const MAX_ITEMS = 4;

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

/** Text histórie z odpovede /api/firms/history (pure, pre testy). */
export function historyLine(stats, nowMs, translate = t) {
  if (!stats || !(stats.count > 0) || !Number.isFinite(stats.firstMs)) return translate('firms.history.none');
  const days = Math.floor((nowMs - stats.firstMs) / 86_400_000);
  const since = days >= 1 ? translate('firms.history.days', { n: days }) : translate('firms.history.today');
  return translate('firms.history.line', { since, n: stats.count, passes: stats.passes, frp: Math.round(stats.maxFrp) });
}

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {Window} deps.win
 * @param {(url: string) => Promise<any>} [deps.fetchJson]
 */
export function createFireNewsCard({ doc, win, fetchJson = async (url) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); } }) {
  const root = doc.createElement('aside');
  root.id = 'fire-news';
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = '<header class="fire-news-head"><span class="fire-news-title"></span><button type="button" class="fire-news-close" aria-label="×">×</button></header>'
    + '<p class="fire-news-place"></p><p class="fire-news-verdict"></p><ol class="fire-news-list"></ol><p class="fire-news-history"></p><p class="fire-news-foot"></p>';
  doc.body.appendChild(root);
  const el = (cls) => root.querySelector('.' + cls);
  let ticket = 0;
  let current = null;

  function hide() { ticket += 1; current = null; root.hidden = true; }
  el('fire-news-close').addEventListener('click', hide);
  doc.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !root.hidden) hide(); });

  function render(news, history, nowMs) {
    el('fire-news-title').textContent = t('firms.news.title');
    const place = news?.place;
    const label = place ? (place.label || [place.locality, place.region, place.country].filter(Boolean).join(', ')) : '';
    el('fire-news-place').textContent = place ? (place.nearby ? t('firms.news.near', { place: label }) : label) : t('firms.news.no-place');
    const verdict = el('fire-news-verdict');
    const status = news?.status;
    if (status === 'ready') {
      verdict.textContent = news.confirmed ? t('firms.news.confirmed', { n: news.trustedDomains.length }) : t('firms.news.unconfirmed');
      verdict.dataset.state = news.confirmed ? 'confirmed' : 'open';
    } else {
      verdict.textContent = t(status === 'unavailable' ? 'firms.news.unavailable' : 'firms.news.empty');
      verdict.dataset.state = 'none';
    }
    const list = el('fire-news-list');
    list.textContent = '';
    for (const item of (news?.items || []).slice(0, MAX_ITEMS)) {
      const li = doc.createElement('li');
      const a = doc.createElement('a');
      a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'fire-news-item' + (item.trusted ? ' trusted' : '');
      const img = doc.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      if (item.image) { img.src = item.image; a.appendChild(img); }
      else if (!/(?:^|\.)news\.google\.com$/i.test(hostOf(item.url))) {
        // Fotka z článku (og:image cez serverový unfurl, ako karty Blízkeho východu).
        fetchJson(`${LINK_IMAGE_API}?url=${encodeURIComponent(item.url)}`).then((j) => {
          if (typeof j?.image === 'string' && /^https?:\/\//.test(j.image) && a.isConnected) { img.src = j.image; a.insertBefore(img, a.firstChild); }
        }).catch(() => {});
      }
      const body = doc.createElement('span'); body.className = 'fire-news-body';
      const title = doc.createElement('span'); title.className = 'fire-news-item-title'; title.textContent = item.title;
      const meta = doc.createElement('span'); meta.className = 'fire-news-meta';
      meta.textContent = [item.source, relativeAge(item.publishedAt, nowMs, t), item.trusted ? t('firms.news.trusted') : ''].filter(Boolean).join(' · ');
      body.append(title, meta); a.appendChild(body); li.appendChild(a); list.appendChild(li);
    }
    el('fire-news-history').textContent = historyLine(history?.stats, nowMs);
    el('fire-news-foot').textContent = t('firms.news.foot', { source: news?.source || 'GDELT' });
    root.hidden = false;
  }

  async function show(lat, lon) {
    const my = ++ticket;
    current = { lat, lon };
    el('fire-news-title').textContent = t('firms.news.title');
    el('fire-news-place').textContent = t('firms.news.loading');
    el('fire-news-verdict').textContent = ''; el('fire-news-list').textContent = ''; el('fire-news-history').textContent = ''; el('fire-news-foot').textContent = '';
    root.hidden = false;
    const q = `lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const [news, history] = await Promise.all([
      fetchJson(`${FIRE_NEWS_API}?${q}`).catch(() => ({ status: 'unavailable', items: [] })),
      fetchJson(`${FIRE_HISTORY_API}?${q}&km=5&days=30`).catch(() => null),
    ]);
    if (my !== ticket) return;
    render(news, history, Date.now());
  }

  win.addEventListener('gev:entity-selected', (event) => {
    const d = event?.detail;
    if (d?.layerId !== FIRE_LAYER_ID || !Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return;
    void show(d.latitude, d.longitude);
  });
  win.addEventListener('gev:entity-selection-cleared', (event) => {
    if (event?.detail?.layerId === FIRE_LAYER_ID) hide();
  });

  return { show, hide, element: root, get current() { return current; } };
}
