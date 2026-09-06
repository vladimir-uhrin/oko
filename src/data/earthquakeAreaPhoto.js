import { imageInfoApiUrl, parseImageInfo, WIKIMEDIA_API_USER_AGENT } from './airportPhoto.js';

export function areaPhotoSearchUrl(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*',
    generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: '10000', ggslimit: '10',
    ggsnamespace: '0', prop: 'pageimages|coordinates', piprop: 'thumbnail|name',
    pithumbsize: '640', colimit: 'max' });
  return 'https://en.wikipedia.org/w/api.php?' + params;
}

export function nearestAreaImage(json, lat, lon) {
  const rad = Math.PI / 180;
  return Object.values(json?.query?.pages || {}).flatMap(page => {
    const c = page.coordinates?.[0]; const image = page.thumbnail;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !page.pageimage
      || !/^https:\/\/upload\.wikimedia\.org\//.test(image?.source || '')
      || !/\.(jpe?g|png|webp)$/i.test(page.pageimage)) return [];
    const h = Math.sin((lat - c.lat) * rad / 2) ** 2
      + Math.cos(lat * rad) * Math.cos(c.lat * rad) * Math.sin((lon - c.lon) * rad / 2) ** 2;
    const distanceKm = 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
    if (distanceKm > 10) return [];
    return [{ thumb: image.source, file: page.pageimage, title: page.title,
      articleUrl: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.title), distanceKm }];
  }).sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
}

/** On-demand, two public requests at most; bounded cache includes empty results. */
export function createAreaPhotoLookup({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map();
  return async (event, { signal } = {}) => {
    const url = areaPhotoSearchUrl(event.lat, event.lon);
    if (!url || signal?.aborted) return null;
    const cached = cache.get(url);
    if (cached && cached.until > now()) return cached.photo;
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8000);
    let photo = null; let ttl = 86400000;
    const read = async endpoint => {
      const response = await fetchImpl(endpoint, { signal: controller.signal,
        headers: { 'Api-User-Agent': WIKIMEDIA_API_USER_AGENT } });
      if (!response.ok) throw new Error('Photo unavailable');
      const json = await response.json(); if (json.error) throw new Error('Photo API error');
      return json;
    };
    try {
      const candidate = nearestAreaImage(await read(url), event.lat, event.lon);
      if (candidate) {
        const info = parseImageInfo(await read(imageInfoApiUrl({ lang: 'en', file: candidate.file })));
        // Only the explicit licenses for which this card supplies attribution.
        if (info?.free && /^(CC BY(?:-SA)?(?: |$)|CC0|Public domain)/i.test(info.license)
          && info.filePage && (/^(CC0|Public domain)/i.test(info.license) || (info.artist && info.licenseUrl))) {
          photo = { ...candidate, ...info };
        }
      }
    } catch { ttl = 60000; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    if (signal?.aborted) return null;
    cache.set(url, { photo, until: now() + ttl });
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return photo;
  };
}
