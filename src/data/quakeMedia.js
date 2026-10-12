// Obrazy k videu o zemetrasení (2026-10-10, vlastník: „automatiku aj s fotkami prípadne videami"): len
// s licenciou — mapa otrasov ShakeMap od USGS (verejná doména) a fotky či videá z Wikimedia Commons
// (CC0, CC BY, CC BY-SA, verejná doména; autor a licencia vo videu aj v príspevku). Tlačové fotky agentúr nie.
// Pure: URL a výber; sťahuje scripts/make-quake-video.mjs.

/** Licencie z Commons, ktoré dovoľujú použitie vo videu s uvedením autora. */
const FREE_LICENSE = /^(CC0|CC BY(?:-SA)? [0-9.]+|CC BY(?:-SA)?|Public domain|PD[- ].*|Attribution)$/i;
/** Mapy, grafy a schémy (ShakeMap berieme priamo od USGS) do záberu z miesta nepatria. */
const NOT_A_PHOTO = /shakemap|intensity map|\bmap\b|mapa|departments|diagram|chart|graph|seismogram|location/i;

/** Mapa otrasov USGS (intensity.jpg) z detailu udalosti, alebo null. Pure. */
export function shakemapImageUrl(detail) {
  const c = detail?.properties?.products?.shakemap?.[0]?.contents || {};
  return c['download/intensity.jpg']?.url || null;
}

/** Vrstva ShakeMap na glóbus: priehľadný PNG intenzity a jeho súradnicový súbor (world file .pngw). Pure. */
export function shakemapOverlayUrls(detail) {
  const c = detail?.properties?.products?.shakemap?.[0]?.contents || {};
  const png = c['download/intensity_overlay.png']?.url; const pngw = c['download/intensity_overlay.pngw']?.url;
  return png && pngw ? { png, pngw } : null;
}

/**
 * World file (6 riadkov: veľkosť pixla x, otočenie, otočenie, veľkosť pixla y (záporná), stred ľavého horného
 * pixla x, y) + rozmer obrázka → [západ, juh, východ, sever] v stupňoch. Pure.
 */
export function worldFileBbox(text, width, height) {
  const [a, , , e, c, f] = String(text || '').trim().split(/\s+/).map(Number);
  if (![a, e, c, f, width, height].every(Number.isFinite) || !(a > 0) || !(e < 0)) return null;
  const west = c - a / 2; const north = f - e / 2;
  return [west, north + e * height, west + a * width, north];
}

/** Stupnica intenzity MMI (farby USGS ShakeMap) — legenda pod mapou otrasov. */
export const MMI_LEGEND = Object.freeze([
  { label: 'IV', color: '#83D0DA' }, { label: 'V', color: '#7BC87F' }, { label: 'VI', color: '#F9F518' },
  { label: 'VII', color: '#FAC611' }, { label: 'VIII', color: '#FA8A11' }, { label: 'IX', color: '#F7100C' }, { label: 'X+', color: '#C80F0A' },
]);

/** Pixel vrstvy: slabé otrasy (I–III, biela a svetlomodrá) priehľadné, ostatné polopriehľadné. Pure. */
export function overlayAlpha(r, g, b, { alpha = 170 } = {}) {
  if (r > 200 && g > 200 && b > 200) return 0;
  if (r < 200 && g > 200 && b > 220) return 0;
  return alpha;
}

/** Rímska intenzita MMI z čísla (USGS `mmi` 9,14 → „IX"). Pure. */
export function mmiRoman(mmi) {
  const n = Math.max(1, Math.min(12, Math.round(Number(mmi))));
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n - 1];
}

/** Hľadanie súborov na Commons (menný priestor File) k zemetraseniu v krajine. Pure. */
export function commonsSearchUrl(countryEn, year) {
  const p = new URLSearchParams({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: `${countryEn} earthquake ${year}`, gsrlimit: '50', gsrsort: 'create_timestamp_desc',
    prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size|timestamp', iiurlwidth: '1280', format: 'json', origin: '*' });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/**
 * Fotky a videá z miesta: nahraté po otrase, s voľnou licenciou, názov s krajinou, nie mapy. Videá prednostne.
 * @returns {Array<{kind: 'photo'|'video', url: string, title: string, page: string, artist: string, license: string, credit: string}>}
 */
export function pickCommonsMedia(json, { countryEn, afterMs, max = 4 } = {}) {
  const out = [];
  for (const p of Object.values(json?.query?.pages || {})) {
    const i = p?.imageinfo?.[0]; const m = i?.extmetadata || {};
    const title = String(p?.title || '');
    if (!i || !title.toLowerCase().includes(String(countryEn || '').toLowerCase()) || NOT_A_PHOTO.test(title)) continue;
    if (!(Date.parse(i.timestamp) >= afterMs)) continue;
    const license = strip(m.LicenseShortName?.value);
    if (!FREE_LICENSE.test(license)) continue;
    const mime = String(i.mime || '');
    const kind = /^video\//.test(mime) ? 'video' : /^image\/(jpeg|png|webp)$/.test(mime) ? 'photo' : null;
    if (!kind) continue;
    const artist = strip(m.Artist?.value).slice(0, 60) || 'neznámy autor';
    out.push({ kind, url: kind === 'photo' ? (i.thumburl || i.url) : i.url, title: title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''), page: i.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      artist, license, credit: `${kind === 'video' ? 'Video' : 'Foto'}: ${artist} · ${license} · Wikimedia Commons` });
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1)).slice(0, max);
}
