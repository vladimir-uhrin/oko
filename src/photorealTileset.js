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
});

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
 * @returns {Promise<{tileset: object, source: 'google'|'ion', googleError: unknown|null, regionBlocked: boolean}>}
 *   Pri zlyhaní OBOCH ciest hádže chybu s `googleError`, `ionError` a `regionBlocked`.
 */
export async function createPhotorealTileset({
  hasGoogleKey,
  hasIonToken,
  createGoogle = (apiOptions, tilesetOptions) => Cesium.createGooglePhotorealistic3DTileset(apiOptions, tilesetOptions),
  fromIonAssetId = (assetId, tilesetOptions) => Cesium.Cesium3DTileset.fromIonAssetId(assetId, tilesetOptions),
  tilesetOptions = {},
} = {}) {
  const opts = { ...PHOTOREAL_TILESET_OPTIONS, ...tilesetOptions };
  let googleError = null;
  if (hasGoogleKey) {
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
