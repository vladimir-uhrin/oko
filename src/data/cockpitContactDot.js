/**
 * Lazily create the shared white contact pip used by aircraft layers while the
 * first-person cockpit is active, and — since 2026-09-04 — for the whole fleet
 * at zoomed-out map ranges (see airIconLod.js). Cesium multiplies this white
 * texture by the billboard color, so civilian and military owners retain their
 * provenance colors without maintaining separate image assets.
 *
 * @param {boolean} [pulse=false] Lit phase of the map-range pulse. The DEFAULT
 *   variant is byte-identical to what shipped before the pulse existed — the
 *   cockpit reads that one and must not change.
 * @returns {string} One stable data-URL identity shared by every billboard.
 */
export function cockpitContactDotImage(pulse = false) {
  const slot = pulse === true ? '_pulseUrl' : '_dataUrl';
  if (cockpitContactDotImage[slot]) return cockpitContactDotImage[slot];

  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 16, 16);

  // Match the visor's fine-line symbology: a restrained luminous ring with a
  // crisp center fix, rather than a solid map-marker blob. The layer tint
  // supplies civilian cyan-white or military amber provenance.
  ctx.save();
  ctx.shadowBlur = 2.5;
  ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(8, 8, 4.25, 0, Math.PI * 2);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.stroke();
  // PULZ (2026-09-04, „keby ešte blikal jednopixelový pulzar"): mení sa LEN
  // jadro, prstenec ostáva stály. Pri 7 px billboarde je rozdiel polomerov
  // 1,55 → 2,45 zhruba jeden pixel — kontakt teda nepreskakuje veľkosťou,
  // len na okamih pritvrdne, ako maják na hranici viditeľnosti. Prstenec
  // drží polohu čitateľnú aj v tmavej fáze, takže pri 2 400 kontaktoch
  // nevzniká dojem, že scéna bliká celá.
  ctx.shadowBlur = pulse ? 3 : 1.5;
  ctx.beginPath();
  ctx.arc(8, 8, pulse ? 2.45 : 1.55, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.fill();
  ctx.restore();

  // Billboard.image assigns a fresh texture-atlas id to non-string sources.
  // Returning the same canvas for hundreds of contacts therefore still made
  // Cesium upload/repack hundreds of identical textures at cockpit entry.
  // A stable URL is keyed once and shared by the entire fleet.
  cockpitContactDotImage[slot] = canvas.toDataURL('image/png');
  return cockpitContactDotImage[slot];
}

cockpitContactDotImage._dataUrl = null;
cockpitContactDotImage._pulseUrl = null;
