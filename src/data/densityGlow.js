// src/data/densityGlow.js
/**
 * @module densityGlow
 * @description Mäkký žiar pre bunky hustoty (lietadlá aj lode).
 *
 * Bunky sa pôvodne kreslili ako PointPrimitive — tvrdé disky 4–20 px, ktoré
 * na mape čítali ako „bubliny" (spätná väzba 2026-09-04). Hustota nie je
 * objekt, je to pole; má sa čítať ako teplo, nie ako korálky. Preto jeden
 * BIELY radiálny sprite s priehľadným okrajom, tónovaný cez `billboard.color`
 * (multiplikatívne — biela × farba = farba, alfa × alfa). Rovnaký princíp,
 * akým vrstva požiarov kreslí `glowSprite`, len bez farby zapečenej v
 * textúre, aby jedna textúra slúžila obom vrstvám.
 *
 * Bez DOM-u (Node testy) vracia prázdny reťazec — vrstva vtedy `image`
 * jednoducho nenastaví.
 */

/** Rozmer textúry v px; billboard si ju škáluje cez width/height. */
export const DENSITY_GLOW_TEXTURE_PX = 64;

/**
 * Priemer žiaru k „jadru" bunky: mäkký okraj opticky zmenší sprite, takže
 * žiar musí byť širší než disk, ktorý nahrádza, aby si bunka udržala váhu.
 */
export const DENSITY_GLOW_DIAMETER_RATIO = 2.4;

let _cachedSprite = null;

/**
 * Data URL mäkkého bieleho žiaru (cachované).
 * @returns {string} PNG data URL alebo '' bez DOM-u / bez 2D kontextu.
 */
export function densityGlowSprite() {
  if (_cachedSprite !== null) return _cachedSprite;
  if (typeof document === 'undefined' || !document.createElement) {
    _cachedSprite = '';
    return _cachedSprite;
  }
  const size = DENSITY_GLOW_TEXTURE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    _cachedSprite = '';
    return _cachedSprite;
  }
  const radius = size / 2;
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  // Jadro plné, potom rýchly pád — okraj nesmie mať hranu, inak je to zas disk.
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.65, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  _cachedSprite = canvas.toDataURL('image/png');
  return _cachedSprite;
}

/**
 * Priemer žiaru v px pre dané „jadro" (densityMarkerPx).
 * @param {number} corePx
 * @returns {number}
 */
export function densityGlowDiameterPx(corePx) {
  const core = Number.isFinite(corePx) ? Math.max(1, corePx) : 1;
  return core * DENSITY_GLOW_DIAMETER_RATIO;
}

/** Test-only: zahoď cache. */
export function _resetDensityGlowForTest() {
  _cachedSprite = null;
}
