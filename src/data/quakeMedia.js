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

/** Hľadanie súborov na Commons (menný priestor File) k zemetraseniu v krajine. Pure. */
export function commonsSearchUrl(countryEn, year) {
  const p = new URLSearchParams({ action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: `${countryEn} earthquake ${year}`, gsrlimit: '40',
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
