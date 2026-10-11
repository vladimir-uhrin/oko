// src/data/vesselCommonsPhoto.js
/**
 * @module vesselCommonsPhoto
 * @description Druhý zdroj fotiek lodí: Wikimedia Commons podľa IMO (2026-10-11, vlastník:
 * „veľa je bez fotiek"). Commons triedi lode do kategórií „IMO <číslo>" → podkategória lode
 * („Finnwave (ship, 2012)") → súbory. Licencie sú slobodné (väčšinou CC BY-SA), preto sa pri
 * fotke VŽDY uvádza autor a licencia. Použije sa len vtedy, keď register lodí fotku nemá.
 */

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/** Členovia kategórie → {files, subcats} (názvy so „File:"/„Category:"). Pure. */
export function parseCommonsMembers(json) {
  const members = Array.isArray(json?.query?.categorymembers) ? json.query.categorymembers : [];
  return {
    files: members.map((m) => String(m?.title || '')).filter((t) => t.startsWith('File:') && IMAGE_RE.test(t)),
    subcats: members.map((m) => String(m?.title || '')).filter((t) => t.startsWith('Category:')),
  };
}

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * imageinfo → fotka s kreditom, alebo null. Pure.
 * @returns {?{full: string, thumb: string, page: string, credit: string}}
 */
export function parseCommonsImageInfo(json) {
  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  for (const p of pages) {
    const ii = Array.isArray(p?.imageinfo) ? p.imageinfo[0] : null;
    if (!ii?.thumburl && !ii?.url) continue;
    const meta = ii.extmetadata || {};
    const artist = stripHtml(meta.Artist?.value).slice(0, 80);
    const license = stripHtml(meta.LicenseShortName?.value).slice(0, 40);
    return {
      full: ii.thumburl || ii.url,
      thumb: ii.thumburl ? ii.thumburl.replace(/\/\d+px-/, '/320px-') : ii.url,
      page: ii.descriptionurl || '',
      credit: ['Wikimedia Commons', artist, license].filter(Boolean).join(' · '),
    };
  }
  return null;
}

/**
 * Nájdi fotku lode na Commons podľa IMO (najviac 3 dopyty). Nikdy nevyhodí — chyba = null.
 * @param {string} imo
 * @param {typeof fetch} fetchImpl
 */
export async function findCommonsShipPhoto(imo, fetchImpl, { userAgent = 'OKO/1.0 (https://okolive.sk)' } = {}) {
  const code = String(imo || '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(code)) return null;
  const get = async (params) => {
    const url = `${COMMONS_API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`commons ${res.status}`);
    return res.json();
  };
  try {
    const top = parseCommonsMembers(await get({ action: 'query', list: 'categorymembers', cmtitle: `Category:IMO ${code}`, cmlimit: '20' }));
    let files = top.files;
    if (!files.length && top.subcats.length) {
      files = parseCommonsMembers(await get({ action: 'query', list: 'categorymembers', cmtitle: top.subcats[0], cmtype: 'file', cmlimit: '20' })).files;
    }
    if (!files.length) return null;
    return parseCommonsImageInfo(await get({ action: 'query', prop: 'imageinfo', titles: files[0], iiprop: 'url|extmetadata', iiurlwidth: '1024' }));
  } catch {
    return null;
  }
}
