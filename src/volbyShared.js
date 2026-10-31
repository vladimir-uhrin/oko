// src/volbyShared.js — čisté pomocníky VOLIEB 2026, ktoré main.js a ui.js potrebujú už pri štarte.
//
// Vyčlenené z volbyPanel.js (2026-10-31, lenivý štart): samotný panel (~24 KB) sa sťahuje až pri prvom
// rozbalení (lazyPanel.js v ui.js), no odkaz ?volby=, archívny stav lišty a výber obce z mapy sa
// rozhodujú hneď. volbyPanel.js tieto pomocníky znova exportuje pre doterajšie importy.

/** Po tomto čase (3 dni po voľbách) panel ukazuje archív „Výsledky volieb 2026" bez stavu sčítania. */
export const VOLBY_ARCHIVE_MS = Date.UTC(2026, 9, 27, 23, 0, 0);
/**
 * Voľby v archíve (2026-10-27, vlastník: „presuň tlačidlo VOĽBY z dolnej lišty do archívu"): tlačidlo
 * v mobilnej lište a nadpis zóny v ľavom stĺpci zmiznú (body.oko-volby-archived); panel ostáva dostupný
 * z palety (príkaz „Voľby 2026 — výsledky"), z odkazov ?volby a zo stránok /volby-2026/. Pure.
 */
export function isVolbyArchived(nowMs = Date.now()) {
  return Number(nowMs) >= VOLBY_ARCHIVE_MS;
}

/**
 * Odkaz na zdieľanie: `?volby` otvorí panel, `?volby=<kód obce>` obec, `?volby=k<kraj>` kraj. Pure.
 * @returns {{ obec: string|null, kraj: string|null }|null} null = parameter chýba
 */
export function parseVolbyParam(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (!params.has('volby')) return null;
  const value = String(params.get('volby') || '').trim();
  if (/^k[1-8]$/i.test(value)) return { obec: null, kraj: value.slice(1) };
  if (/^[a-z0-9][a-z0-9-]{0,79}$/i.test(value)) return { obec: value, kraj: null };
  return { obec: null, kraj: null };
}
