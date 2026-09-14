// src/sharePanel.js
// Zdieľacie okno (2026-09-14, A+B, „aj na soc. siete"). Za tlačidlom zdieľania:
// 1. dlhý odkaz so stavom (kamera, vrstvy, predmet) — ShareLinkManager,
// 2. snímka toho, čo vidím (shareSnapshot.js),
// 3. POST /api/share → krátky odkaz /s/<id>, z ktorého si siete berú náhľad
//    (Open Graph); keď server nie je (offline, dev server dole), ostane dlhý
//    odkaz a obrázok len v schránke / natívnom zdieľaní,
// 4. okno: náhľad, odkaz, Kopírovať odkaz, Kopírovať obrázok, Zdieľať… (Web
//    Share s obrázkom ako súborom — Instagram, príbehy), Uložiť obrázok,
//    tlačidlá sietí (Facebook, X, LinkedIn, Threads, Bluesky, WhatsApp,
//    Telegram, e-mail).
// DOM sa stavia len cez createElement/appendChild (bez innerHTML), aby sa dal
// pokryť testom s falošným dokumentom.
import { t } from './i18n.js';
import { buildShareTargets } from './shareTargets.js';

export const SHARE_API_URL = '/api/share';
const PANEL_STATE_KEY = '__okoSharePanel';

function el(doc, tag, { className = '', text = '', attrs = {} } = {}, children = []) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute?.(name, String(value));
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

/**
 * Pošli stav + snímku na server; `{ id, url, image }` alebo null (server
 * nedostupný, odmietol, sieť). Nikdy nehádže.
 */
export async function publishShareSnapshot({
  hash, title, description, image, width, height,
  fetchImpl = globalThis.fetch,
  url = SHARE_API_URL,
} = {}) {
  if (typeof fetchImpl !== 'function' || !image || !hash) return null;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, title, description, image, width, height }),
      cache: 'no-store',
    });
    if (!response?.ok) return null;
    const data = await response.json().catch(() => null);
    return data?.url ? { id: data.id || null, url: String(data.url), image: data.image ? String(data.image) : null } : null;
  } catch {
    return null;
  }
}

function ensurePanel(doc, win, nav, translate, toast) {
  const existing = doc[PANEL_STATE_KEY];
  if (existing) return existing;

  const ui = { session: null };
  const backdrop = el(doc, 'div', { attrs: { id: 'oko-share-backdrop' } });
  backdrop.hidden = true;
  const title = el(doc, 'span', { className: 'oko-share-title', text: translate('share.title') });
  const closeButton = el(doc, 'button', { className: 'oko-share-close', text: '×', attrs: { type: 'button', title: translate('share.close'), 'aria-label': translate('share.close') } });
  const preview = el(doc, 'img', { className: 'oko-share-preview', attrs: { alt: '' } });
  preview.hidden = true;
  const status = el(doc, 'div', { className: 'oko-share-status', text: translate('share.preparing') });
  const urlBox = el(doc, 'div', { className: 'oko-share-url' });
  const note = el(doc, 'p', { className: 'oko-share-note' });
  const copyLink = el(doc, 'button', { text: translate('share.copy-link'), attrs: { type: 'button' } });
  const copyImage = el(doc, 'button', { text: translate('share.copy-image'), attrs: { type: 'button' } });
  const native = el(doc, 'button', { text: translate('share.native'), attrs: { type: 'button' } });
  const download = el(doc, 'a', { text: translate('share.download'), attrs: { download: 'oko.jpg', href: '#' } });
  const retry = el(doc, 'button', { text: translate('share.retry'), attrs: { type: 'button' } });
  const actions = el(doc, 'div', { className: 'oko-share-actions' }, [copyLink, copyImage, native, download, retry]);
  const networksLabel = el(doc, 'div', { className: 'oko-share-networks-label', text: translate('share.networks') });
  const networks = el(doc, 'div', { className: 'oko-share-networks' });
  const root = el(doc, 'section', { attrs: { id: 'oko-share', role: 'dialog', 'aria-modal': 'true', 'aria-label': translate('share.title') } }, [
    el(doc, 'div', { className: 'oko-share-head' }, [title, closeButton]),
    preview, status, urlBox, note, actions, networksLabel, networks,
  ]);
  root.hidden = true;
  const host = doc.body || doc.documentElement;
  host.appendChild(backdrop);
  host.appendChild(root);

  const hide = () => { root.hidden = true; backdrop.hidden = true; };
  const show = () => { root.hidden = false; backdrop.hidden = false; };
  closeButton.addEventListener('click', hide);
  backdrop.addEventListener('click', hide);
  doc.addEventListener?.('keydown', (event) => { if (event?.key === 'Escape' && !root.hidden) hide(); });

  copyLink.addEventListener('click', async () => {
    const url = ui.session?.url;
    if (!url) return;
    try { await nav.clipboard.writeText(url); toast(translate('share.link-copied')); } catch { toast(translate('toast.copy-failed')); }
  });
  copyImage.addEventListener('click', async () => {
    const snapshot = ui.session?.snapshot;
    if (!snapshot?.pngBlob || typeof win.ClipboardItem !== 'function') return;
    try {
      const blob = await snapshot.pngBlob();
      if (!blob) throw new Error('no blob');
      await nav.clipboard.write([new win.ClipboardItem({ 'image/png': blob })]);
      toast(translate('share.image-copied'));
    } catch { toast(translate('toast.copy-failed')); }
  });
  retry.addEventListener('click', () => {
    // Bez krátkeho odkazu (snímka alebo server zlyhali) skús celý tok znova.
    if (ui.lastOptions) void openSharePanel(ui.lastOptions);
  });
  native.addEventListener('click', async () => {
    const session = ui.session;
    if (!session || typeof nav.share !== 'function') return;
    const data = { title: session.copy.title, text: session.copy.text, url: session.url };
    try {
      const blob = session.snapshot?.pngBlob ? await session.snapshot.pngBlob() : null;
      if (blob && typeof win.File === 'function') {
        const files = [new win.File([blob], 'oko.png', { type: 'image/png' })];
        if (nav.canShare?.({ files })) data.files = files;
      }
      await nav.share(data);
    } catch { /* používateľ zrušil alebo sieť odmietla */ }
  });

  Object.assign(ui, {
    root, backdrop, preview, status, urlBox, note, copyLink, copyImage, native, download, retry, networks, show, hide,
    lastOptions: null,
    reset() {
      ui.session = null;
      preview.hidden = true;
      status.hidden = false;
      status.textContent = translate('share.preparing');
      urlBox.textContent = '';
      note.textContent = '';
      note.className = 'oko-share-note';
      copyImage.hidden = true;
      native.hidden = true;
      download.hidden = true;
      retry.hidden = true;
      networks.textContent = '';
      while (networks.children?.length) networks.removeChild(networks.children[networks.children.length - 1]);
    },
    render(session) {
      ui.session = session;
      status.hidden = true;
      if (session.snapshot?.jpegDataUrl) {
        preview.setAttribute('src', session.snapshot.jpegDataUrl);
        preview.src = session.snapshot.jpegDataUrl;
        preview.hidden = false;
        download.setAttribute('href', session.snapshot.jpegDataUrl);
        download.hidden = false;
        copyImage.hidden = typeof win.ClipboardItem !== 'function';
      }
      native.hidden = typeof nav.share !== 'function';
      urlBox.textContent = session.url;
      note.textContent = translate(session.shortLink ? 'share.short-link' : 'share.long-link');
      // Dlhý odkaz nemá obrázok v náhľade sietí — zvýrazni a ponúkni nový pokus.
      note.className = session.shortLink ? 'oko-share-note' : 'oko-share-note oko-share-note-warn';
      retry.hidden = Boolean(session.shortLink);
      for (const target of buildShareTargets({ url: session.url, text: session.copy.text, title: session.copy.title })) {
        networks.appendChild(el(doc, 'a', { text: target.label, attrs: { href: target.href, target: '_blank', rel: 'noopener noreferrer', 'data-network': target.id } }));
      }
    },
  });
  doc[PANEL_STATE_KEY] = ui;
  return ui;
}

/**
 * Otvor zdieľacie okno a prejdi celý tok (odkaz → snímka → server → okno).
 * @param {object} options
 * @param {() => ({ href: string, hash: string }|null)} options.buildLink
 * @param {(() => Promise<object|null>)|null} [options.captureSnapshot]
 * @param {typeof publishShareSnapshot} [options.publish]
 * @param {{ title: string, description: string, text: string }} [options.copy]
 * @param {(message: string) => void} [options.toast]
 * @returns {Promise<{ url: string, longUrl: string, shortLink: object|null, snapshot: object|null, copy: object }|null>}
 */
export async function openSharePanel({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  navigator: nav = globalThis.navigator,
  buildLink,
  captureSnapshot = null,
  publish = publishShareSnapshot,
  copy = { title: 'OKO', description: '', text: 'OKO' },
  toast = () => {},
  translate = t,
} = {}) {
  const built = typeof buildLink === 'function' ? buildLink() : null;
  if (!built?.href) {
    toast(translate('toast.copy-failed'));
    return null;
  }
  const ui = ensurePanel(doc, win, nav, translate, toast);
  ui.lastOptions = { document: doc, window: win, navigator: nav, buildLink, captureSnapshot, publish, copy, toast, translate };
  ui.reset();
  ui.show();
  let snapshot = null;
  try { snapshot = captureSnapshot ? await captureSnapshot() : null; } catch (error) {
    console.warn('[share] snapshot failed:', error?.message || error);
    snapshot = null;
  }
  let shortLink = null;
  if (snapshot?.jpegDataUrl) {
    shortLink = await publish({
      hash: built.hash,
      title: copy.title,
      description: copy.description,
      image: snapshot.jpegDataUrl,
      width: snapshot.width,
      height: snapshot.height,
    });
    if (!shortLink) console.warn('[share] short link unavailable — /api/share failed, falling back to the long link');
  }
  const session = { url: shortLink?.url || built.href, longUrl: built.href, shortLink, snapshot, copy };
  ui.render(session);
  if (!snapshot) toast(translate('share.image-failed'));
  else if (!shortLink) toast(translate('share.upload-failed'));
  return session;
}

/** Test seam: aktuálne okno (alebo null). */
export function _getSharePanelForTest(doc = globalThis.document) {
  return doc?.[PANEL_STATE_KEY] || null;
}
