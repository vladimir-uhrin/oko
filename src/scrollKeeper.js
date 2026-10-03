// src/scrollKeeper.js
//
// Strážca polohy rolovania cez prechod rozloženia, ktorý rolovacie prvky na chvíľu natiahne
// (2026-10-03).
//
// Engine ľavého stĺpca (ui.js _syncLeftPanelAdaptiveLayout) pred meraním prirodzenej výšky
// otvoreného panela zruší jeho pridelenú výšku — inak by zmeral sám seba. Panel sa tým na jeden
// prepočet rozloženia roztiahne na celý obsah, jeho vnútorný posuvník nemá čo rolovať a prehliadač
// mu polohu vráti na 0. Po pridelení výšky ostane rolovanie hore. Prechod beží pri KAŽDEJ zmene
// v ktoromkoľvek paneli (obnova legendy, vek správy, HUD), takže dlhý panel — BLÍZKY VÝCHOD po
// etape 5 — sa nedal dorolovať nadol: do pol sekundy skočil späť (nález zo snímok po vydaní).
//
// Strážca si pamätá prvky, ktoré niekedy rolovali (`track`, z udalosti scroll v zachytávacej
// fáze), pred meraním si prečíta ich polohu (`capture`) a po pridelení výšok ju vráti (`restore`).
// Keď prechod skončí skôr, než výšky vráti (auto-zbalenie → ďalší prechod v nasledujúcej snímke),
// polohy si podrží (`defer`) a ďalší `capture` ich prevezme — prvok má medzitým polohu 0.
// Bez DOM závislostí; prvok je čokoľvek s číselným `scrollTop`.

/**
 * @returns {{
 *   track: (el: any) => void,
 *   capture: () => Array<[any, number]>,
 *   restore: (memo: Array<[any, number]>|null|undefined) => number,
 *   defer: (memo: Array<[any, number]>|null|undefined) => void,
 *   size: () => number,
 * }}
 */
export function createScrollKeeper() {
  /** Prvky, ktoré niekedy rolovali. */
  const scrollers = new Set();
  /** Polohy z prechodu, ktorý skončil skôr, než vrátil výšky. */
  let pending = null;

  return {
    /** Zapamätá si rolovací prvok (volá sa z udalosti scroll; opakované volanie nič nestojí). */
    track(el) {
      if (el && typeof el.scrollTop === 'number') scrollers.add(el);
    },
    /** Polohy pred meraním: odložené z predošlého prechodu + aktuálne nenulové. Odpojené prvky zabudne. */
    capture() {
      const memo = [];
      const seen = new Set();
      if (pending) {
        for (const [el, top] of pending) {
          if (el?.isConnected === false) continue;
          memo.push([el, top]);
          seen.add(el);
        }
        pending = null;
      }
      for (const el of scrollers) {
        if (el.isConnected === false) { scrollers.delete(el); continue; }
        if (seen.has(el)) continue;
        const top = el.scrollTop;
        if (top > 0) memo.push([el, top]);
      }
      return memo;
    },
    /** Vráti polohy po pridelení výšok; prvok, ktorý ju nestratil, sa nedotkne. @returns počet vrátených */
    restore(memo) {
      let restored = 0;
      for (const [el, top] of memo || []) {
        if (el?.isConnected === false) continue;
        if (el.scrollTop !== top) { el.scrollTop = top; restored += 1; }
      }
      return restored;
    },
    /** Prechod skončil bez vrátenia výšok — polohy počkajú na ďalší. */
    defer(memo) {
      if (memo?.length) pending = memo;
    },
    size: () => scrollers.size,
  };
}
