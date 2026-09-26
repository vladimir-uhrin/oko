// src/auth/ux.js — čisté pomôcky prihlásenia (2026-09-26, vlastník: „vylepši celé
// prihlásenie na úroveň tohto portálu, t. j. profi"): sila hesla pre merač pri
// registrácii/obnove, iniciály do avatara bez fotky, Caps Lock z udalosti.
// Bez DOM — zdieľa ich panel.js aj testy.

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;
export const STRENGTH_KEYS = Object.freeze(['short', 'fair', 'good', 'strong', 'excellent']);

/**
 * Sila hesla 0–4: 0 = pod minimom (15 znakov, pravidlo servera), 1 = minimum,
 * vyššie podľa dĺžky, pestrosti znakov a počtu slov (heslové frázy sú vítané).
 * Jednotvárne heslo („aaaaaaaaaaaaaaa") neprejde nad 1. Pure.
 * @returns {{score:number, key:string, length:number}}
 */
export function passwordStrength(password) {
  const s = String(password ?? '');
  const chars = [...s];
  const length = chars.length;
  if (length < PASSWORD_MIN) return { score: 0, key: length ? 'short' : 'empty', length };
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((re) => re.test(s)).length;
  const words = s.trim().split(/\s+/).filter(Boolean).length;
  const unique = new Set(chars).size;
  let score = 1;
  if (length >= 20 || classes >= 3 || words >= 3) score = 2;
  if (length >= 32 || (length >= 24 && (classes >= 3 || words >= 4))) score = 3;
  if (length >= 40 || (length >= 32 && classes >= 3) || (words >= 5 && length >= 28)) score = 4;
  if (unique <= 4) score = 1;
  return { score, key: STRENGTH_KEYS[score], length };
}

/** Iniciály z mena: prvé písmená prvého a posledného slova, veľké (1–2 znaky). Pure. */
export function initialsFor(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = [...parts[0]][0];
  const last = parts.length > 1 ? [...parts.at(-1)][0] : '';
  return `${first}${last}`.toLocaleUpperCase();
}

/** Je zapnutý Caps Lock (z udalosti klávesnice)? Bez udalosti/podpory false. Pure. */
export function capsLockOn(event) {
  try { return Boolean(event?.getModifierState?.('CapsLock')); } catch { return false; }
}

/**
 * Chyba formulára → pole, ku ktorému patrí (inline hláška pod poľom); ostatné
 * chyby ostávajú v stavovom riadku. Pure.
 */
export const FIELD_FOR_ERROR = Object.freeze({
  invalid_email: 'email', invalid_name: 'name', invalid_password: 'password', password_mismatch: 'confirm',
  invalid_current_password: 'current', password_unchanged: 'password', invalid_bio: 'bio',
});
