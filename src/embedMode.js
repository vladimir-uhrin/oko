// src/embedMode.js
/**
 * @module embedMode
 * @description Živý rámček OKO (2026-10-06, vlastník: „ako by sa dalo spraviť, aby to nebol obrázok, ale live").
 * Adresa `/?embed=1#<stav>` otvorí appku bez ovládania: len mapa so živými vrstvami, karty objektov, kredity
 * podkladu a úzka lišta so značkou OKO, odznakom NAŽIVO, názvom zdieľania (`t=`) a tlačidlom „Otvoriť v OKO".
 * Stav (kamera, štýl, vrstvy, predmet) nesie hash ako pri každom odkaze. Stránka krátkeho odkazu /s/<id> ho
 * vkladá ako rámček (shareStore.renderSharePage) a rovnako ho môže vložiť cudzí web — kód na vloženie dáva
 * zdieľacie okno (sharePanel.js). Štýly: style.css „Živý rámček".
 */

export const EMBED_PARAM = 'embed';
export const EMBED_TITLE_PARAM = 't';
/** Najdlhší názov v adrese rámčeka (zvyšok sa odstrihne). */
export const EMBED_TITLE_MAX = 120;
export const EMBED_SNIPPET_SIZE = Object.freeze({ width: 640, height: 400 });

const escapeAttr = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `?embed=1` v adrese = živý rámček. Pure. */
export function isEmbedMode(search) {
  return new URLSearchParams(String(search || '')).get(EMBED_PARAM) === '1';
}

/** Názov zdieľania z adresy rámčeka (`t=`), orezaný a bez zbytočných medzier. Pure. */
export function embedTitleFromSearch(search) {
  const raw = new URLSearchParams(String(search || '')).get(EMBED_TITLE_PARAM) || '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, EMBED_TITLE_MAX);
}

/**
 * Adresa živého rámčeka z adresy appky (origin + hash so stavom); voliteľný názov do lišty. Pure.
 * @param {string} appUrl napr. https://okolive.sk/#v=2&lat=48.1&lon=17.1
 */
export function embedUrlFromAppUrl(appUrl, { title = '' } = {}) {
  const url = new URL(String(appUrl));
  const params = new URLSearchParams();
  params.set(EMBED_PARAM, '1');
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, EMBED_TITLE_MAX);
  if (clean) params.set(EMBED_TITLE_PARAM, clean);
  return `${url.origin}/?${params.toString()}${url.hash}`;
}

/** Plná appka z adresy rámčeka: origin + hash, bez `embed` a `t`. Pure. */
export function fullAppUrl(locationLike) {
  const origin = String(locationLike?.origin || '');
  const hash = String(locationLike?.hash || '');
  return `${origin}/${hash}`;
}

/** Kód na vloženie do cudzieho webu (rámček s povoleným celoobrazovkovým režimom). Pure. */
export function embedSnippet(embedUrl, { width = EMBED_SNIPPET_SIZE.width, height = EMBED_SNIPPET_SIZE.height, title = 'OKO naživo' } = {}) {
  return `<iframe src="${escapeAttr(embedUrl)}" width="${Math.round(width)}" height="${Math.round(height)}" style="border:0;max-width:100%" loading="lazy" allow="fullscreen" allowfullscreen title="${escapeAttr(title)}"></iframe>`;
}

function el(doc, tag, { className = '', text = '', attrs = {} } = {}, children = []) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute?.(name, String(value));
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

/**
 * Zapne živý rámček: trieda `embed-mode` na <body> (style.css schová všetko okrem mapy, kariet, kreditov
 * a lišty), HUD vypnutý cez režim nahrávania, lišta so značkou, NAŽIVO, názvom a odkazom do plnej appky
 * (otvára sa v hlavnom okne, nie v rámčeku). DOM len cez createElement (test s falošným dokumentom).
 * @param {{ document: Document, window: Window, styleManager?: object|null, translate?: (key: string) => string }} input
 * @returns {{ bar: Element, fullUrl: string, title: string }}
 */
export function installEmbedMode({ document: doc, window: win, styleManager = null, translate = (key) => key }) {
  const fullUrl = fullAppUrl(win?.location);
  const title = embedTitleFromSearch(win?.location?.search);
  doc.body.classList?.add?.('embed-mode');
  try { styleManager?.setRecordingMode?.(true, { hidePanels: true, hudMode: 'off', safeFrame: '16:9' }); } catch { /* HUD je len vzhľad */ }
  // Kredity podkladu (podmienky Google/ion) ostávajú viditeľné, len tesne v rohu — inline, lebo model
  // v creditAttribution.test.mjs pozná len svoje selektory a mobilný plášť ich v rámčeku nedvíha.
  const credits = doc.getElementById?.('cesium-credits');
  if (credits?.style) Object.assign(credits.style, { left: '10px', right: 'auto', bottom: '8px' });
  const wordmark = el(doc, 'span', { className: 'oko-embed-wordmark', text: 'OK' }, [el(doc, 'span', { className: 'oko-embed-o', text: 'O' })]);
  const live = el(doc, 'span', { className: 'oko-embed-live', text: '' }, [el(doc, 'span', { className: 'oko-embed-dot', attrs: { 'aria-hidden': 'true' } })]);
  live.appendChild(doc.createTextNode(translate('embed.live')));
  const brand = el(doc, 'a', { className: 'oko-embed-brand', attrs: { href: fullUrl, target: '_top', rel: 'noopener', 'aria-label': 'OKO' } }, [wordmark, live]);
  const titleNode = el(doc, 'span', { className: 'oko-embed-title', text: title, attrs: { title } });
  const open = el(doc, 'a', { className: 'oko-embed-open', text: translate('embed.open'), attrs: { href: fullUrl, target: '_top', rel: 'noopener' } });
  const bar = el(doc, 'div', { attrs: { id: 'oko-embed-bar', role: 'banner' } }, [brand, titleNode, open]);
  doc.body.appendChild(bar);
  return { bar, fullUrl, title };
}
