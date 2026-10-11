// src/data/vesselCommonsPhoto.js
/**
 * @module vesselCommonsPhoto
 * @description Druhý zdroj fotiek lodí: Wikimedia Commons podľa IMO (2026-10-11, vlastník:
 * „veľa je bez fotiek"). Commons triedi lode do kategórií „IMO <číslo>" → podkategória lode
 * („Finnwave (ship, 2012)") → súbory. Licencie sú slobodné (väčšinou CC BY-SA), preto sa pri
 * fotke VŽDY uvádza autor a licencia. Použije sa len vtedy, keď register lodí fotku nemá.
 *
 * Výber fotky (2026-10-11 večer, bod 7): nie prvý súbor v kategórii (mohol to byť detail
 * komína alebo loď pod starým menom), ale najlepšie bodovaný — meno lode v názve súboru,
 * novší súbor, bez detailov (komín, mostík, interiér…). Keď je podkategória lode pod iným
 * menom než dnes (premenovaná), kredit to povie.
 */

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
/** Časti lode a veci, ktoré nie sú „fotka lode". */
const DETAIL_RE = /\b(logo|flag|funnel|plan|map|deck|crew|bridge|engine|cabin|interior|lifeboat|detail|name ?plate|bell|anchor|propeller|model|diagram|drawing|chart|plaque|poster|stamp)\b/i;

/** Porovnávací tvar mena: bez diakritiky (Mærsk → MAERSK), len A–Z0–9. Pure. */
export const normalizeShipName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/æ/gi, 'ae').replace(/ø/gi, 'o').replace(/ß/g, 'ss').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const norm = normalizeShipName;

/** Členovia kategórie → {files: [{title, timestamp}], subcats: [title]}. Len obrázky. Pure. */
export function parseCommonsMembers(json) {
  const members = Array.isArray(json?.query?.categorymembers) ? json.query.categorymembers : [];
  return {
    files: members.filter((m) => String(m?.title || '').startsWith('File:') && IMAGE_RE.test(m.title)).map((m) => ({ title: String(m.title), timestamp: String(m.timestamp || '') })),
    subcats: members.map((m) => String(m?.title || '')).filter((t) => t.startsWith('Category:')),
  };
}

/** Meno lode z názvu podkategórie „Finnwave (ship, 2012)" → „Finnwave". Pure. */
export function shipNameFromCategory(title) {
  return String(title || '').replace(/^Category:/, '').replace(/\s*\((ship|vessel|boat)[^)]*\)\s*$/i, '').trim();
}

/**
 * Body súboru: meno lode v názve +4, „IMO" +1, novší súbor malý bonus, detaily a plány −10. Pure.
 * @param {{title: string, timestamp?: string}} file
 * @param {{name?: string, rank?: number}} [o] rank = poradie od najnovšieho (0 = najnovší)
 */
export function scoreCommonsFile(file, { name = '', rank = 0 } = {}) {
  const title = String(file?.title || '');
  let score = 0;
  const n = norm(name);
  if (n && n.length >= 3 && norm(title).includes(n)) score += 4;
  if (/\bIMO ?\d{7}\b/i.test(title)) score += 1;
  if (DETAIL_RE.test(title.replace(/^File:/, ''))) score -= 10; // detail nikdy nevyhrá nad celou loďou
  score += Math.max(0, 1 - rank * 0.1);
  return score;
}

/** Najlepší súbor (zoradené od najnovšieho), alebo null, keď sú všetky len detaily. Pure. */
export function pickCommonsFile(files, { name = '' } = {}) {
  const sorted = [...(files || [])].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  let best = null;
  let bestScore = -Infinity;
  sorted.forEach((f, rank) => {
    const s = scoreCommonsFile(f, { name, rank });
    if (s > bestScore) { best = f; bestScore = s; }
  });
  return best && bestScore > -3 ? best : null;
}

/** Podkategória lode: tá s dnešným menom, inak prvá. Pure. */
export function pickCommonsSubcategory(subcats, { name = '' } = {}) {
  const list = Array.isArray(subcats) ? subcats : [];
  if (!list.length) return null;
  const n = norm(name);
  return (n && list.find((c) => norm(shipNameFromCategory(c)).includes(n))) || list[0];
}

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * imageinfo → fotka s kreditom, alebo null. Pure.
 * @returns {?{full: string, thumb: string, page: string, credit: string}}
 */
export function parseCommonsImageInfo(json, { formerName = null } = {}) {
  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  for (const p of pages) {
    const ii = Array.isArray(p?.imageinfo) ? p.imageinfo[0] : null;
    if (!ii?.thumburl && !ii?.url) continue;
    const meta = ii.extmetadata || {};
    const artist = stripHtml(meta.Artist?.value).slice(0, 80);
    const license = stripHtml(meta.LicenseShortName?.value).slice(0, 40);
    return {
      full: ii.thumburl || ii.url,
      // Wikimedia berie len štandardné šírky náhľadov (320 = chyba 400, 330 áno).
      thumb: ii.thumburl ? ii.thumburl.replace(/\/\d+px-/, '/330px-') : ii.url,
      page: ii.descriptionurl || '',
      credit: [formerName ? `ako ${formerName}` : '', 'Wikimedia Commons', artist, license].filter(Boolean).join(' · '),
    };
  }
  return null;
}

/**
 * Nájdi fotku lode na Commons podľa IMO (najviac 3 dopyty). Nikdy nevyhodí — chyba = null.
 * @param {string} imo
 * @param {typeof fetch} fetchImpl
 * @param {{userAgent?: string, name?: string}} [o] name = dnešné meno lode (výber súboru a podkategórie)
 */
export async function findCommonsShipPhoto(imo, fetchImpl, { userAgent = 'OKO/1.0 (https://okolive.sk)', name = '' } = {}) {
  const code = String(imo || '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(code)) return null;
  const get = async (params) => {
    const url = `${COMMONS_API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`commons ${res.status}`);
    return res.json();
  };
  const members = (title, extra = {}) => get({ action: 'query', list: 'categorymembers', cmtitle: title, cmlimit: '50', cmprop: 'title|timestamp', cmsort: 'timestamp', cmdir: 'desc', ...extra });
  try {
    const top = parseCommonsMembers(await members(`Category:IMO ${code}`));
    let files = top.files;
    let formerName = null;
    if (top.subcats.length) {
      const sub = pickCommonsSubcategory(top.subcats, { name });
      const subName = shipNameFromCategory(sub);
      if (name && subName && norm(subName) !== norm(name) && !norm(subName).includes(norm(name))) formerName = subName;
      const subFiles = parseCommonsMembers(await members(sub, { cmtype: 'file' })).files;
      if (subFiles.length) files = [...subFiles, ...files];
    }
    const chosen = pickCommonsFile(files, { name });
    if (!chosen) return null;
    return parseCommonsImageInfo(await get({ action: 'query', prop: 'imageinfo', titles: chosen.title, iiprop: 'url|extmetadata', iiurlwidth: '1024' }), { formerName });
  } catch {
    return null;
  }
}
