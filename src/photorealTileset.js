import * as Cesium from 'cesium';

/**
 * Google Photorealistic 3D Tiles — dve cesty k tomu istému obsahu (2026-09-06,
 * používateľ: „inak nefunguje mi google").
 *
 * PREČO: od 2026-09-04 vracia `tile.googleapis.com/v1/3dtiles/root.json` pre
 * účty s EHP fakturáciou 403 „satellite tiles and 3D tiles are not available
 * for your account and region" (developers.google.com/maps/comms/eea/map-tiles).
 * Nie je to chyba kľúča ani kódu — je to politika Google pre EHP. Cesium ion
 * distribuuje TIE ISTÉ dlaždice ako asset 2275207 pod vlastnou zmluvou s
 * Google; kľúč aj fakturácia sú Cesiumu a EHP obmedzenie sa ho netýka
 * (overené 2026-09-05 aj 09-06: endpoint 200, typ 3DTILES).
 *
 * PORADIE: najprv Google kľúč (ak raz obmedzenie zrušia, appka sa sama vráti
 * na priamu cestu bez zmeny kódu), až pri chybe ion. Cesium samo ide cez ion
 * LEN keď kľúč chýba (`createGooglePhotorealistic3DTileset`: `key ??
 * GoogleMaps.defaultApiKey` → `requestCachedIonTileset`), a main.js kľúč
 * nastavuje pred volaním — preto ten fallback tu, explicitne.
 *
 * PODMIENKY (DATA_SOURCES.md): ion free tier je nekomerčný („Upgrade for
 * commercial use." prichádza priamo v atribúciách endpointu a Cesium ho
 * kreslí do kreditov — NEODSTRAŇOVAŤ); Google ToS sú prijaté v ion účte;
 * ion má vlastné streamovacie limity — nie je to platba, pri prekročení ion
 * prestane streamovať.
 */

/** Cesium ion asset id pre Google Photorealistic 3D Tiles (rovnaký, aký používa Cesium interne). */
export const GOOGLE_3D_ION_ASSET_ID = 2275207;

/**
 * Rovnaké defaulty, aké Cesium dáva Google tilesetu v
 * `createGooglePhotorealistic3DTileset` — ion cesta ich musí zopakovať,
 * inak by fallback bežal s menšou cache a bez kolízií kamery.
 */
export const PHOTOREAL_TILESET_OPTIONS = Object.freeze({
  cacheBytes: 1536 * 1024 * 1024,
  maximumCacheOverflowBytes: 1024 * 1024 * 1024,
  enableCollision: true,
  // `dynamicScreenSpaceError` je v Cesiu pri 3D tilesetoch zapnuté predvolene:
  // stredným a vzdialeným dlaždicám umelo zvýši prípustnú chybu, aby ušetrilo
  // výkon. Pri šikmom pohľade nízko nad zemou (napr. Bratislavský hrad, výška
  // ~450 m, sklon −28°) tým vyberie hrubé nadradené dlaždice, ktorých
  // zjednodušená sieť sa premietne ako roztrhaný „rozsypaný" pás v strede
  // obrazu (používateľ 2026-09-15: „prečo mi nevykreslí dobre google mapu?").
  // Vypnutím sa dlaždice zjemnia (naživo 76 → 133 vybraných) a mesh je ostrý;
  // platí pre Google aj ion fallback. `foveatedScreenSpaceError` ostáva
  // predvolene zapnuté — tlmí len okraje, ktoré aj tak zakrýva kruhová maska.
  dynamicScreenSpaceError: false,
});

/**
 * Telefóny a tablety (2026-10-15, vlastník: „na mobiloch sa mi niekedy nevykreslia google dlaždice"):
 * meranie na okolive.sk (Puppeteer, iPhone 375×812 @3x) — pamäť dlaždíc rástla s každým miestom
 * 153 → 255 → 344 → 391 MB a strop cache 1,5 GB + 1 GB rezervy ju nechal rásť ďalej. Mobilné
 * prehliadače (Safari na iPhone) pri takom zaťažení stratia grafický kontext → prázdny glóbus.
 * Na zariadení s malou pamäťou drží cache 256 MB + 128 MB; Cesium nepotrebné dlaždice uvoľní.
 */
export const PHOTOREAL_LOW_MEMORY_OPTIONS = Object.freeze({
  cacheBytes: 256 * 1024 * 1024,
  maximumCacheOverflowBytes: 128 * 1024 * 1024,
});

/**
 * Zariadenie s malou grafickou pamäťou (pure): primárne dotykové (telefón, tablet) alebo hlásená
 * pamäť ≤ 4 GB (`navigator.deviceMemory`, Chrome/Android).
 * @param {{ coarse?: boolean, deviceMemory?: number }} input
 */
export function isLowMemoryDevice({ coarse = false, deviceMemory } = {}) {
  if (coarse === true) return true;
  const gb = Number(deviceMemory);
  return Number.isFinite(gb) && gb > 0 && gb <= 4;
}

/** Nastavenie fotoreálneho tilesetu pre zariadenie (pure). */
export function photorealTilesetOptions({ lowMemory = false } = {}) {
  return lowMemory ? { ...PHOTOREAL_TILESET_OPTIONS, ...PHOTOREAL_LOW_MEMORY_OPTIONS } : { ...PHOTOREAL_TILESET_OPTIONS };
}

/**
 * Je to EHP/regionálne odmietnutie Google (403 PERMISSION_DENIED s textom
 * o regióne)? Rozlišuje sa kvôli hláške pre používateľa — pri inej chybe
 * (sieť, 429 kvóta, zlý kľúč) sa NEmá tvrdiť, že ide o EHP.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isGoogleRegionBlocked(error) {
  const text = describe(error);
  return /not available for your account and region|maps\/comms\/eea/i.test(text);
}

/**
 * EHP odmietnutie si pamätať deň (2026-10-17, vlastník: „1"): priama cesta Google pre účet s EHP fakturáciou
 * vracia vždy 403, takže každé načítanie zbytočne minulo jednu požiadavku na koreň z dennej kvóty a kus štartu.
 * Príznak = čas zistenia v localStorage; 24 h ide boot rovno cez ion, potom skúsi Google znova (ak Google
 * obmedzenie zruší, appka sa do dňa vráti sama). Zapisuje ho LEN skutočne zistené EHP 403 — nie 429, sieť,
 * ani zapamätaná chyba (tá by príznak predlžovala donekonečna).
 */
export const EEA_BLOCK_STORAGE_KEY = 'oko-google3d-eea-block-v1';
export const EEA_BLOCK_TTL_MS = 24 * 60 * 60 * 1000;
/** Text zapamätaného odmietnutia — isGoogleRegionBlocked ho rozpozná, hláška ostáva pravdivá. */
export const EEA_BLOCK_REMEMBERED_MESSAGE = 'Google 3D Tiles: satellite tiles and 3D tiles are not available for your account and region (developers.google.com/maps/comms/eea/map-tiles; remembered for 24 h)';

/** Platí zapamätané EHP odmietnutie? (pure; úložisko môže hádzať — súkromné okno) */
export function readEeaBlock(storage, nowMs = Date.now()) {
  try {
    const at = Number(storage?.getItem?.(EEA_BLOCK_STORAGE_KEY));
    return Number.isFinite(at) && at > 0 && nowMs >= at && nowMs - at < EEA_BLOCK_TTL_MS;
  } catch {
    return false;
  }
}

/** Zapamätaj EHP odmietnutie (čas zistenia). Chyba úložiska = nič. */
export function writeEeaBlock(storage, nowMs = Date.now()) {
  try { storage?.setItem?.(EEA_BLOCK_STORAGE_KEY, String(Math.round(nowMs))); return true; } catch { return false; }
}

/** Chyba, ktorá pri platnom príznaku stojí za priamu cestu Google (priorGoogleError). */
export function rememberedEeaError() {
  return Object.assign(new Error(EEA_BLOCK_REMEMBERED_MESSAGE), { rememberedEea: true });
}

/**
 * Zapísať príznak po načítaní? Len keď Google naozaj skúšal a odmietol pre EHP (nie zapamätaná chyba).
 * @param {{ regionBlocked?: boolean, googleError?: unknown }|null} outcome výsledok alebo chyba createPhotorealTileset
 */
export function shouldRememberEea(outcome) {
  if (!outcome?.regionBlocked) return false;
  return outcome.googleError?.rememberedEea !== true && isGoogleRegionBlocked(outcome.googleError);
}

/**
 * Je to minútový limit koreňa Google 3D (2026-10-16)? Google vracia 429 RESOURCE_EXHAUSTED „Quota exceeded
 * for quota metric '3D Tiles root requests' and limit '3D Tiles root requests per minute'". Kľúč, ktorý
 * vydáva Cesium ion, je zdieľaný, takže limit sa minie aj bez nás a o minútu je preč — oplatí sa skúsiť
 * znova (photorealRetry.js). Denný limit („per day") nie: ten sa do polnoci neuvoľní.
 * Cesium chybu koreňa hlási ako RequestErrorEvent { statusCode, response } (fetchJson); Google pri chybách
 * posiela Access-Control-Allow-Origin, takže prehliadač stav aj telo prečíta (overené 2026-10-17 na 403).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isMinuteRateLimited(error) {
  if (!error) return false;
  const text = describe(error);
  if (/per\s+day/i.test(text)) return false;
  return Number(error?.statusCode) === 429 || /RESOURCE_EXHAUSTED|per\s+minute/i.test(text);
}

/**
 * Ktoré cesty má zmysel skúsiť znova po zlyhaní oboch (pure): len tie, ktoré padli na minútový limit.
 * EHP 403, zlý kľúč či token, sieť ani denný limit sa neopakujú — žiadne ďalšie požiadavky na koreň.
 * @param {unknown} failure chyba z createPhotorealTileset (nesie googleError a ionError)
 * @returns {{ google: boolean, ion: boolean }|null} null = neopakovať
 */
export function photorealRetryPaths(failure) {
  const google = isMinuteRateLimited(failure?.googleError);
  const ion = isMinuteRateLimited(failure?.ionError);
  return google || ion ? { google, ion } : null;
}

/**
 * Text chyby pre hlášky; nikdy nevracia kľúč (Cesium do RequestErrorEvent
 * dáva URL s `key=` — orezať).
 * @param {unknown} error
 * @returns {string}
 */
export function describe(error) {
  if (!error) return '';
  let text = '';
  if (typeof error === 'string') text = error;
  else if (error && typeof error === 'object') {
    text = String(error.message || error.response || error.error || '');
    if (!text && Number.isFinite(error.statusCode)) text = `HTTP ${error.statusCode}`;
  }
  return text.replace(/([?&])key=[^&\s"']+/g, '$1key=…').trim();
}

/**
 * Načítaj fotoreálny tileset: Google priamo, pri chybe cez Cesium ion.
 *
 * Závislosti sú injektovateľné (testy nemajú sieť ani WebGL).
 * @param {object} options
 * @param {boolean} options.hasGoogleKey je nastavený Google kľúč
 * @param {boolean} options.hasIonToken je nastavený ion token (bez neho ion cesta nie je)
 * @param {(apiOptions: object, tilesetOptions: object) => Promise<object>} [options.createGoogle]
 * @param {(assetId: number, tilesetOptions: object) => Promise<object>} [options.fromIonAssetId]
 * @param {object} [options.tilesetOptions]
 * @param {unknown} [options.priorGoogleError] opakovanie po minútovom limite (photorealRetry.js): Google
 *   padol natrvalo (EHP 403) — neskúšať ho znova, jeho pôvodná chyba stojí za neho (hláška nepovie „kľúč chýba")
 * @returns {Promise<{tileset: object, source: 'google'|'ion', googleError: unknown|null, regionBlocked: boolean}>}
 *   Pri zlyhaní OBOCH ciest hádže chybu s `googleError`, `ionError` a `regionBlocked`.
 */
export async function createPhotorealTileset({
  hasGoogleKey,
  hasIonToken,
  createGoogle = (apiOptions, tilesetOptions) => Cesium.createGooglePhotorealistic3DTileset(apiOptions, tilesetOptions),
  fromIonAssetId = (assetId, tilesetOptions) => Cesium.Cesium3DTileset.fromIonAssetId(assetId, tilesetOptions),
  tilesetOptions = {},
  priorGoogleError = null,
} = {}) {
  const opts = { ...PHOTOREAL_TILESET_OPTIONS, ...tilesetOptions };
  let googleError = null;
  if (priorGoogleError) {
    googleError = priorGoogleError;
  } else if (hasGoogleKey) {
    try {
      const tileset = await createGoogle({ onlyUsingWithGoogleGeocoder: true }, { ...opts });
      return { tileset, source: 'google', googleError: null, regionBlocked: false };
    } catch (error) {
      googleError = error;
    }
  } else {
    googleError = new Error('GOOGLE_MAPS_API_KEY not set');
  }
  const regionBlocked = isGoogleRegionBlocked(googleError);
  if (!hasIonToken) {
    const failure = new Error(describe(googleError) || 'Google 3D Tiles unavailable');
    failure.googleError = googleError;
    failure.ionError = null;
    failure.regionBlocked = regionBlocked;
    throw failure;
  }
  try {
    const tileset = await fromIonAssetId(GOOGLE_3D_ION_ASSET_ID, { ...opts });
    return { tileset, source: 'ion', googleError, regionBlocked };
  } catch (ionError) {
    const failure = new Error(`Google: ${describe(googleError) || 'unavailable'} · Cesium ion: ${describe(ionError) || 'unavailable'}`);
    failure.googleError = googleError;
    failure.ionError = ionError;
    failure.regionBlocked = regionBlocked;
    throw failure;
  }
}
