// src/data/airportCameras.js
/**
 * @module airportCameras
 * @description Živé kamery letísk (2026-09-06, „k letiskám karty by si vedel
 * pridať live stream? … sprav všetko čo spraviť vieš").
 *
 * Dva zdroje, jedna karta:
 *   1. KURÁTOROVANÝ KATALÓG — ručne overené YouTube živé prenosy (kamera +
 *      často aj ATC zvuk). Overuje ich `scripts/check-airport-cameras.mjs`
 *      (oEmbed + isLiveNow/playableInEmbed), lebo ID časom umierajú.
 *   2. AUTOMATICKÉ VYHĽADANIE — YouTube Data API v3 `search.list` s
 *      `eventType=live` cez server proxy `/api/youtube-live` (kľúč ostáva na
 *      serveri, kvóta 10 000 jednotiek/deň, search stojí 100 → proxy drží
 *      denný strop). Bez kľúča proxy vráti 503 {error:'no_key'} a karta mlčí.
 *
 * Prehráva sa VÝHRADNE oficiálny vložený prehrávač YouTube (privacy-enhanced
 * doména youtube-nocookie.com): žiadne sťahovanie, proxy ani extrakcia zvuku;
 * branding, ovládanie a stav vysielania patria poskytovateľovi (DATA_SOURCES).
 * Čistý modul — žiadny fetch, žiadny DOM.
 */

/** Ručne overené živé kamery. Kľúč = ICAO. `verified` = dátum poslednej kontroly skriptom. */
export const AIRPORT_CAMERAS = Object.freeze({
  LKPR: Object.freeze({
    videoId: 'kuOmmVkOGN8', provider: 'SlowTV', title: 'Praha (LKPR) · kamera + ATC · dráha 06/24',
    channelUrl: 'https://www.youtube.com/@SlowTVLive', verified: '2026-09-06',
  }),
  KLAX: Object.freeze({
    videoId: 'KzsNnyN8D_Q', provider: 'AirlineVideosLive+', title: 'Los Angeles (KLAX) · kamera + ATC · dráhy 25L/25R',
    channelUrl: 'https://www.youtube.com/@AirlineVideosLivePlus', verified: '2026-09-06',
  }),
});

/** Klientská pamäť výsledkov vyhľadania: 6 h (proxy má rovnaký TTL). */
export const CAMERA_LOOKUP_TTL_MS = 6 * 3600 * 1000;
/** Neúspech (nič živé / bez kľúča) sa nepýta znova skôr než po 30 min. */
export const CAMERA_LOOKUP_NEGATIVE_TTL_MS = 30 * 60 * 1000;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Platné YouTube video ID (11 znakov base64url). Pure. */
export function isYoutubeVideoId(id) {
  return VIDEO_ID_RE.test(String(id || ''));
}

/** Kurátorovaná kamera pre ICAO alebo null. Pure. */
export function airportCameraFor(icao) {
  const code = String(icao || '').trim().toUpperCase();
  return Object.hasOwn(AIRPORT_CAMERAS, code) ? { ...AIRPORT_CAMERAS[code], icao: code, source: 'curated' } : null;
}

/**
 * URL oficiálneho vloženého prehrávača (privacy-enhanced). Autoplay so zvukom
 * je požiadavka — prehliadač ju po kliknutí na letisko zvyčajne povolí; keď
 * nie, prehrávač ukáže Play (text `airport.audio-video-note`). Pure.
 */
export function youtubeEmbedUrl(videoId) {
  if (!isYoutubeVideoId(videoId)) return null;
  const params = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', modestbranding: '1', iv_load_policy: '3' });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

/** Verejná stránka videa (odkaz „otvoriť na YouTube"). Pure. */
export function youtubeWatchUrl(videoId) {
  return isYoutubeVideoId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

/** oEmbed URL — bezkľúčové overenie existencie/embedovateľnosti (server-side skript). Pure. */
export function youtubeOembedUrl(videoId) {
  return isYoutubeVideoId(videoId)
    ? `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    : null;
}

/**
 * Vyhľadávací dopyt pre Data API: názov letiska bez slova „Airport" + mesto +
 * kľúčové slová. Krátky a stabilný, aby proxy cache trafila ten istý reťazec. Pure.
 * @param {{name?: string, municipality?: string, icao?: string, iata?: string}} props
 */
export function cameraSearchQuery(props) {
  const name = String(props?.name || '').replace(/\b(international|intl\.?|airport|letisko|flughafen|aeropuerto|aéroport)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const city = String(props?.municipality || '').trim();
  const code = String(props?.iata || props?.icao || '').trim().toUpperCase();
  const head = name || city;
  // Mesto len keď ho hlava dopytu ešte nenesie (bez názvu je hlavou samo mesto).
  const parts = [head, city && city.toLowerCase() !== head.toLowerCase() ? city : '', 'airport', code, 'live'].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const POSITIVE = /\b(live|cam|camera|webcam|runway|planespotting|plane spotting|atc|tower|airport|flughafen|letisko|lotnisko|aeropuerto|aéroport)\b/i;
const NEGATIVE = /\b(gameplay|simulator|msfs|x-plane|fs2020|fs2024|flight sim|reaction|music|lofi|asmr|radio 24\/7 music|news)\b/i;

/**
 * Vyber najlepší živý výsledok z odpovede `search.list`. Berie len skutočne
 * živé (`liveBroadcastContent === 'live'`), vyhodí simulátory/hudbu, preferuje
 * názvy s kamerou/letiskom a zhodu s kódom/mestom. Nikdy nehádže — bez
 * vhodného výsledku null. Pure.
 * @param {object} payload odpoveď Data API (items[].id.videoId, snippet)
 * @param {{icao?: string, iata?: string, municipality?: string, name?: string}} [props]
 */
export function pickLiveCamera(payload, props = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const hints = [props.iata, props.icao, props.municipality, String(props.name || '').split(/\s+/)[0]]
    .map((v) => String(v || '').trim().toLowerCase()).filter((v) => v.length >= 3);
  let best = null; let bestScore = -Infinity;
  for (const item of items) {
    const id = item?.id?.videoId; const s = item?.snippet || {};
    if (!isYoutubeVideoId(id) || s.liveBroadcastContent !== 'live') continue;
    const text = `${s.title || ''} ${s.description || ''} ${s.channelTitle || ''}`;
    if (NEGATIVE.test(text)) continue;
    let score = 0;
    if (POSITIVE.test(s.title || '')) score += 3;
    if (/\b(live|cam|camera|webcam)\b/i.test(s.title || '')) score += 2;
    for (const h of hints) if (text.toLowerCase().includes(h)) score += 2;
    if (/\b24\/7\b/.test(text)) score += 1;
    if (score > bestScore) { bestScore = score; best = { videoId: id, title: String(s.title || ''), provider: String(s.channelTitle || ''), channelId: String(s.channelId || '') }; }
  }
  return best && bestScore >= 2 ? { ...best, source: 'search' } : null;
}

/** Text kreditu pod prehrávačom: „Kamera + ATC · SlowTV · YouTube". Pure. */
export function cameraCreditText(camera, translate) {
  const provider = String(camera?.provider || '').trim();
  return translate('airport.camera-credit', { provider: provider || 'YouTube' });
}
