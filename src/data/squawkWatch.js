// src/data/squawkWatch.js
/**
 * @module squawkWatch
 * @description Núdzový squawk sa ohlási aj bez kliknutia na stroj.
 *
 * Doteraz sa 7500/7600/7700 zobrazil len ako riadok karty VYBRATÉHO kontaktu
 * (`squawkAlert` vo flightProgress.js) — stroj v núdzi, na ktorý nikto neklikol,
 * sa nikde neprejavil. Tento modul sleduje squawky, ktoré už aj tak tečú v
 * každom polle, a rozhodne, čo z nich je NOVÁ udalosť hodná hlásenia.
 *
 * Modul je čistý: žiadny Cesium, žiadny DOM, žiadny časovač. Vrstvy mu podajú
 * ploché riadky, on vráti zoznam udalostí — takže sa dá odtestovať bez
 * prehliadača a rovnaká logika platí pre civilnú aj vojenskú vrstvu.
 *
 * Tri pravidlá, ktoré rozhodujú o tom, či hlásenie otravuje alebo pomáha:
 *  1. PRVÉ NAČÍTANIE MLČÍ. Po zapnutí vrstvy je v scéne bežne niekoľko strojov
 *     s núdzovým kódom (často zabudnutým). Vysypať pri štarte dvadsať hlásení
 *     naraz je najrýchlejšia cesta k tomu, aby ich operátor začal ignorovať.
 *  2. TEN ISTÝ KÓD NA TOM ISTOM STROJI SA NEOPAKUJE — poll beží každých 30 s,
 *     bez tlmenia by jeden núdzový stav hlásil dvakrát za minútu, hodiny.
 *  3. ESKALÁCIA JE NOVÁ UDALOSŤ. Prechod 7600 → 7700 nie je duplikát; hlási sa
 *     okamžite bez ohľadu na tlmenie.
 */

import { squawkAlert } from './flightProgress.js';

/** Ako dlho sa ten istý kód na tom istom stroji znovu nehlási. */
export const SQUAWK_ALERT_COOLDOWN_MS = 15 * 60_000;

/** Strop pamäte sledovaných kontaktov (ochrana proti rastu pri dlhom behu). */
export const SQUAWK_ALERT_MAX_ENTRIES = 500;

/**
 * Poradie závažnosti pri viacerých súčasných udalostiach.
 *
 * 7700 (všeobecná núdza) je akútnejšia než únos aj než porucha rádia v tom
 * zmysle, že hovorí „práve teraz sa deje niečo zlé". 7500 je pred 7600, lebo
 * porucha rádia je bežná a často nezáživná.
 */
export const SQUAWK_SEVERITY_ORDER = Object.freeze(['7700', '7500', '7600']);

function severityRank(code) {
  const index = SQUAWK_SEVERITY_ORDER.indexOf(String(code));
  return index === -1 ? SQUAWK_SEVERITY_ORDER.length : index;
}

/**
 * Vytvorí sledovač so súkromnou pamäťou.
 *
 * @param {object} [options]
 * @param {number} [options.cooldownMs] Tlmenie opakovaného hlásenia.
 * @param {number} [options.maxEntries] Strop pamäte.
 * @returns {{observe: Function, reset: Function, size: Function}}
 */
export function createSquawkWatch({
  cooldownMs = SQUAWK_ALERT_COOLDOWN_MS,
  maxEntries = SQUAWK_ALERT_MAX_ENTRIES,
} = {}) {
  /** @type {Map<string, {code: string, atMs: number}>} */
  let seen = new Map();
  let primed = false;

  return {
    /** Zabudni všetko — vrstva sa vypla a znovu zapla. Ďalší beh opäť mlčí. */
    reset() {
      seen = new Map();
      primed = false;
    },

    /** Počet sledovaných kontaktov (diagnostika a testy). */
    size() {
      return seen.size;
    },

    /**
     * Spracuj jeden poll a vráť udalosti hodné hlásenia.
     * @param {Array<{id: string, squawk: *, label?: string, filtered?: boolean}>} rows
     * @param {{nowMs: number}} context
     * @returns {Array<{id: string, code: string, meaning: string, label: string, filtered: boolean}>}
     */
    observe(rows, { nowMs } = {}) {
      const at = Number.isFinite(nowMs) ? nowMs : 0;
      const list = Array.isArray(rows) ? rows : [];
      const out = [];

      for (const row of list) {
        const id = String(row?.id ?? '').trim();
        if (!id) continue;
        const alert = squawkAlert(row?.squawk);
        // Kontakt, ktorý núdzu odvolal, si pamäť PONECHÁVA — preblikávajúci
        // squawk by inak hlásil pri každom návrate.
        if (!alert) continue;

        const previous = seen.get(id);
        const escalated = previous && previous.code !== alert.code;
        const cooled = previous && (at - previous.atMs) >= cooldownMs;
        const isNew = !previous || escalated || cooled;

        // `atMs` je čas posledného HLÁSENIA, nie posledného videnia. Keby sa
        // prepisoval každý poll, tlmiace okno by sa donekonečna posúvalo
        // dopredu a trvajúca núdza by sa nikdy nepripomenula.
        seen.set(id, { code: alert.code, atMs: isNew ? at : previous.atMs });
        // Prvý beh len naplní pamäť: scéna po zapnutí vrstvy nie je udalosť.
        if (!primed || !isNew) continue;

        out.push({
          id,
          code: alert.code,
          meaning: alert.label,
          label: String(row?.label ?? '').trim() || id.toUpperCase(),
          filtered: row?.filtered === true,
        });
      }
      primed = true;

      // Prune až po spracovaní, nech tlmenie nezávisí od poradia riadkov.
      for (const [id, entry] of seen) {
        if (at - entry.atMs > cooldownMs) seen.delete(id);
      }
      if (seen.size > maxEntries) {
        const oldest = [...seen.entries()].sort((a, b) => a[1].atMs - b[1].atMs);
        for (const [id] of oldest.slice(0, seen.size - maxEntries)) seen.delete(id);
      }

      out.sort((a, b) => severityRank(a.code) - severityRank(b.code) || a.id.localeCompare(b.id));
      return out;
    },
  };
}

/**
 * Prevedie udalosti na JEDNO hlásenie.
 *
 * Toast je jediný element s jediným časovačom — druhé hlásenie okamžite
 * prepíše prvé. Preto sa viac súčasných udalostí skladá do jednej vety o
 * najzávažnejšej z nich plus počte ostatných, namiesto toho, aby sa
 * preblikli a zostalo viditeľné len posledné (a spravidla najmenej dôležité).
 *
 * @param {Array<object>} alerts Výstup `observe`.
 * @returns {{key: string, vars: object, target: object}|null}
 */
export function presentSquawkAlerts(alerts) {
  const list = Array.isArray(alerts) ? alerts.filter(Boolean) : [];
  if (!list.length) return null;
  const target = list[0];
  const vars = { code: target.code, meaning: target.meaning, label: target.label };
  if (list.length === 1) return { key: 'alert.squawk.one', vars, target };
  return { key: 'alert.squawk.many', vars: { ...vars, n: list.length - 1 }, target };
}
