/**
 * Slnko a Mesiac na nebeskom prstenci ako TELESÁ, nie ikony (2026-09-07,
 * používateľ: „to slnko a mesiac sprav ako má mesiac vyzerať").
 *
 * Do 09-06 boli značky Material Symbols glyfy (`light_mode`/`dark_mode`).
 * Teraz sú to malé plátna: Slnko je žiariaci disk s korónou, Mesiac je disk
 * so SKUTOČNOU FÁZOU — osvetlená časť sa počíta z geocentrických smerov
 * Slnka a Mesiaca (Simon 1994, tie isté vektory, ktorými prstenec meria
 * uhly) a jasný okraj mieri po prstenci k Slnku. Novolunie je tmavý kotúč
 * s tenkým obrysom, spln plný kotúč, medzi tým kosák/gibbous podľa
 * osvetlenej frakcie (1 − cos elongácie) / 2.
 *
 * Kreslenie je čisté Canvas 2D; funkcie berú ctx, nech sa testujú bez DOM
 * na stube a v prstenci sa volajú len keď sa zmení kľúč (fáza/uhol/DPR).
 */

/**
 * Priemer značky v CSS px (glyf mal 20 px; prvá verzia 22 px bola pre
 * používateľa „slabučká" — 2026-09-07 zväčšené na 36 px, telesá zaberajú
 * väčšinu plátna a farby sú sýtejšie).
 */
export const CELESTIAL_MARKER_PX = 36;
/** Polomer Slnka a Mesiaca ako podiel polovice plátna. */
export const SUN_RADIUS_RATIO = 0.58;
export const MOON_RADIUS_RATIO = 0.8;

/**
 * Osvetlená frakcia Mesiaca z geocentrických jednotkových smerov. Pure.
 * elongácia 0 (Mesiac pri Slnku) = nov, π = spln.
 * @param {{x:number,y:number,z:number}} sunDir
 * @param {{x:number,y:number,z:number}} moonDir
 * @returns {{fraction: number, elongationRad: number}}
 */
export function moonIllumination(sunDir, moonDir) {
  const dot = sunDir.x * moonDir.x + sunDir.y * moonDir.y + sunDir.z * moonDir.z;
  const cos = Math.max(-1, Math.min(1, dot));
  const elongationRad = Math.acos(cos);
  return { fraction: (1 - cos) / 2, elongationRad };
}

/**
 * Smer jasného okraja Mesiaca na obrazovke: od značky Mesiaca k značke
 * Slnka po prstenci (obe ležia na kružnici, stačia ich uhly). Pure.
 * @param {number} sunAngle
 * @param {number} moonAngle
 * @returns {number} uhol v radiánoch (canvas: 0 = vpravo, kladný = v smere hodín)
 */
export function brightLimbAngle(sunAngle, moonAngle) {
  return Math.atan2(Math.sin(sunAngle) - Math.sin(moonAngle), Math.cos(sunAngle) - Math.cos(moonAngle));
}

/**
 * Nakresli Mesiac s fázou. Technika: tmavý kotúč, potom osvetlená polovica
 * (polkruh smerom k Slnku) a terminátor ako elipsa s polosou r·|1−2f|
 * — pod polovicu elipsa osvetlenú časť uberá, nad polovicu pridáva.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} r polomer v px
 * @param {number} fraction 0..1
 * @param {number} limbAngle smer jasného okraja (rad)
 */
export function drawMoonDisc(ctx, cx, cy, r, fraction, limbAngle) {
  const f = Math.max(0, Math.min(1, fraction));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(limbAngle);
  // Tmavá (nočná) strana: takmer neviditeľná, len náznak kotúča.
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(38, 44, 58, 0.96)';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(190, 206, 228, 0.6)';
  ctx.stroke();
  // Osvetlená časť: polkruh (+x = k Slnku) ± elipsa terminátora.
  const lit = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
  lit.addColorStop(0, 'rgb(255, 255, 252)');
  lit.addColorStop(0.7, 'rgb(236, 238, 236)');
  lit.addColorStop(1, 'rgb(198, 204, 208)');
  ctx.fillStyle = lit;
  if (f > 0.02) {
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); // pravá polovica
    ctx.closePath();
    if (f >= 0.5) {
      // Gibbous: pridaj elipsu na tmavej strane.
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (2 * f - 1), r, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Kosák: z polkruhu odober elipsu (evenodd s elipsou na svetlej strane).
      ctx.ellipse(0, 0, r * (1 - 2 * f), r, 0, 0, Math.PI * 2);
      ctx.fill('evenodd');
    }
  }
  // Pár „morí" ako jemné škvrny, len na svetlej strane (clip na disk).
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(110, 118, 128, 0.4)';
  for (const [mx, my, mr] of [[0.28, -0.22, 0.22], [0.1, 0.25, 0.16], [-0.3, 0.05, 0.12]]) {
    ctx.beginPath();
    ctx.arc(mx * r, my * r, mr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

/**
 * Nakresli Slnko: biele jadro, teplý okraj, mäkká koróna.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} r polomer disku v px (koróna ide do ~1,7 r)
 */
export function drawSunDisc(ctx, cx, cy, r) {
  ctx.save();
  const corona = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.72);
  corona.addColorStop(0, 'rgba(255, 224, 140, 0.95)');
  corona.addColorStop(0.35, 'rgba(255, 200, 100, 0.5)');
  corona.addColorStop(1, 'rgba(255, 176, 70, 0)');
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.72, 0, Math.PI * 2);
  ctx.fill();
  const disc = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
  disc.addColorStop(0, 'rgb(255, 255, 250)');
  disc.addColorStop(0.5, 'rgb(255, 238, 170)');
  disc.addColorStop(1, 'rgb(255, 184, 70)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Kľúč prekreslenia značiek — kreslí sa len pri zmene (fáza sa mení o 1 %
 * za ~7 hodín, uhol okraja s kamerou).
 * @param {number} fraction
 * @param {number} limbAngle
 * @param {number} dpr
 * @returns {string}
 */
export function markerRenderKey(fraction, limbAngle, dpr) {
  return `${fraction.toFixed(2)}:${limbAngle.toFixed(2)}:${dpr}`;
}

/**
 * Priprav plátno značky pre DPR a vráť ctx (alebo null bez 2D kontextu).
 * @param {HTMLCanvasElement} canvas
 * @param {number} dpr
 * @param {number} [px]
 */
export function prepareMarkerCanvas(canvas, dpr, px = CELESTIAL_MARKER_PX) {
  const size = Math.max(1, Math.round(px * dpr));
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, px, px);
  return ctx;
}
