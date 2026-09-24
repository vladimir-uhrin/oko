// src/shareTargets.js
// Zdieľanie (2026-09-14, „aj na soc. siete"): čisté pomôcky bez DOM —
// odkazy na zdieľanie do sietí, text a názov príspevku, orezanie snímky
// na 1200×630, krátky odkaz. Sieťové intenty sú verejné URL schémy sietí;
// náhľad s obrázkom si každá sieť dotiahne z Open Graph značiek krátkeho
// odkazu (`/s/<id>`), Instagram a príbehy dostanú obrázok ako súbor.

/** Rozmer snímky pre Open Graph (Facebook, X, LinkedIn odporúčajú 1200×630). */
export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
/** Strop veľkosti JPEG snímky posielanej na server (B). */
export const SHARE_IMAGE_MAX_BYTES = 400 * 1024;

/**
 * Výrez „cover": zdroj sa zmenší tak, aby vyplnil cieľ, prebytok sa oreže
 * symetricky (stred ostáva v strede). Pure.
 * @returns {{ sx: number, sy: number, sw: number, sh: number }} výrez zdroja
 */
export function fitCover(srcWidth, srcHeight, dstWidth, dstHeight) {
  const sw = Number(srcWidth) || 0;
  const sh = Number(srcHeight) || 0;
  const dw = Number(dstWidth) || 0;
  const dh = Number(dstHeight) || 0;
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return { sx: 0, sy: 0, sw: Math.max(0, sw), sh: Math.max(0, sh) };
  const scale = Math.max(dw / sw, dh / sh);
  const cropW = Math.min(sw, Math.round(dw / scale));
  const cropH = Math.min(sh, Math.round(dh / scale));
  return { sx: Math.round((sw - cropW) / 2), sy: Math.round((sh - cropH) / 2), sw: cropW, sh: cropH };
}

/**
 * Názov a popis príspevku z toho, čo sa zdieľa. Pure.
 * @param {object} input
 * @param {string|null} [input.subjectLabel] sledovaný / vybraný objekt (SWR11H, Kapušany…)
 * @param {string|null} [input.placeLabel] miesto (názov mesta / oblasti)
 * @param {string[]} [input.layerNames] zapnuté vrstvy (názvy)
 * @param {number} [input.whenMs]
 * @param {'sk'|'en'} [input.lang]
 * @returns {{ title: string, description: string, text: string }} text = pre sieťové intenty
 */
export function buildShareCopy({ subjectLabel = null, placeLabel = null, layerNames = [], whenMs = Date.now(), lang = 'sk' } = {}) {
  const parts = ['OKO'];
  if (subjectLabel) parts.push(String(subjectLabel).trim());
  if (placeLabel) parts.push(String(placeLabel).trim());
  const title = parts.filter(Boolean).join(' · ').slice(0, 110);
  const locale = lang === 'en' ? 'en-GB' : 'sk-SK';
  let when = '';
  try {
    when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(whenMs));
  } catch { when = new Date(whenMs).toISOString().slice(0, 16).replace('T', ' '); }
  const layers = layerNames.filter(Boolean).map((name) => String(name).trim()).filter(Boolean);
  const layerLine = layers.length
    ? layers.slice(0, 5).join(', ') + (layers.length > 5 ? (lang === 'en' ? ` +${layers.length - 5} more` : ` +${layers.length - 5} ďalších`) : '')
    : (lang === 'en' ? 'Live globe' : 'Živý glóbus');
  const description = `${layerLine} · ${when}`.slice(0, 280);
  return { title, description, text: `${title} — ${description}` };
}

/**
 * Odkazy na zdieľanie do sietí (verejné intenty). Poradie = poradie tlačidiel.
 * Mastodon nemá univerzálny intent (inštancia), Instagram a TikTok berú len
 * obrázok (natívne zdieľanie). Pure.
 * @param {{ url: string, text?: string, title?: string }} input
 * @returns {Array<{ id: string, label: string, href: string }>}
 */
export function buildShareTargets({ url, text = '', title = '' } = {}) {
  const link = String(url || '');
  if (!link) return [];
  const u = encodeURIComponent(link);
  const withLink = encodeURIComponent(text ? `${text} ${link}` : link);
  const message = encodeURIComponent(text || title || '');
  return [
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: 'x', label: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${message}` },
    { id: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { id: 'threads', label: 'Threads', href: `https://www.threads.net/intent/post?text=${withLink}` },
    { id: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${withLink}` },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${withLink}` },
    { id: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${u}&text=${message}` },
    { id: 'email', label: 'E-mail', href: `mailto:?subject=${encodeURIComponent(title || 'OKO')}&body=${withLink}` },
  ];
}

/**
 * Riadok atribúcie do snímky z textu kreditov Cesia (`#cesium-credits`):
 * odkazy „Upgrade for commercial use" a „Data attribution" preč, duplicity
 * preč, Google a Cesium ion vždy prítomné (podmienky Google Maps Platform
 * vyžadujú atribúciu aj na zdieľanom obrázku). Pure.
 * @param {string|null|undefined} creditsText
 * @returns {string}
 */
export function buildAttributionLine(creditsText) {
  const parts = String(creditsText || '')
    .split(/[·•|\n\r]+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part && !/upgrade|attribution|^data$/i.test(part));
  const out = [];
  const seen = new Set();
  // DeepState ide dopredu: výrez má 6 miest a jeho licencia (§3) chce textový odkaz.
  const ranked = [...parts.filter((p) => /deepstate/i.test(p)), ...parts.filter((p) => !/deepstate/i.test(p))];
  for (const part of ['Google', 'Cesium ion', ...ranked]) {
    const key = part.toLowerCase().replace(/^google maps$/, 'google').replace(/^cesium$/, 'cesium ion');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key === 'google' ? 'Google' : key === 'cesium ion' ? 'Cesium ion' : part);
  }
  return `© ${out.slice(0, 6).join(' · ')}`;
}

/** Veľkosť dát v data: URL (base64) v bajtoch. Pure. */
export function dataUrlByteLength(dataUrl) {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  if (comma < 0) return 0;
  const payload = text.slice(comma + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
}

/**
 * Krátky odkaz pre id zdieľania na danom pôvode. Pure.
 * @param {string} origin napr. https://oko.uhrin.digital
 * @param {string} id
 */
export function shortShareUrl(origin, id) {
  const base = String(origin || '').replace(/\/+$/, '');
  const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!base || !safe) return null;
  return `${base}/s/${safe}`;
}
