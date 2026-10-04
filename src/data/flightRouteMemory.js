// src/data/flightRouteMemory.js — trasa, dopravca a IATA číslo letu z adsbdb sa nesmú stratiť
// (2026-09-30, vlastník: „v kartičkách bolo ETA a chýba" + „už sa nesmie stávať, že by som
// niečo trikrát opravoval").
//
// Záznam stroja vo vrstve lietadiel sa vymieňa: každý poll ho skladá nanovo, stroj vie vypadnúť
// z feedu a vrátiť sa, sledovanie sa zruší. Trasu z adsbdb pritom vrstva pýta pre volací znak
// len raz za reláciu. Tieto čisté funkcie zaručujú, že sa výsledok prenesie do nového záznamu
// a vráti stroju, ktorému chýba — bez neho kartička stratí trasu, dopravcu, číslo letu aj ETA.

/** Polia z trasy adsbdb, ktoré musia prežiť výmenu záznamu stroja. */
export const ROUTE_ENRICHMENT_FIELDS = Object.freeze(['airline', 'flightIata', 'route']);

/**
 * Polia trasy z predošlého záznamu pre nový záznam pollu (pure). Chýbajúce = null.
 * @param {object|null|undefined} prevMeta
 * @returns {{airline: string|null, flightIata: string|null, route: object|null}}
 */
export function carryRouteEnrichment(prevMeta) {
  return {
    airline: prevMeta?.airline ?? null,
    flightIata: prevMeta?.flightIata ?? null,
    route: prevMeta?.route ?? null,
  };
}

function normalizeCallsign(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Pamäť výsledkov trasy podľa volacieho znaku (ohraničená, najstarší záznam vypadne prvý).
 * @param {{max?: number}} [options]
 */
export function createRouteMemory({ max = 4000 } = {}) {
  const byCallsign = new Map();
  return {
    /**
     * Ulož odpoveď adsbdb (/api/adsbdb/route/<volací znak>).
     * @param {string} callsign
     * @param {{airline?: string, callsignIata?: string, origin?: object, destination?: object}} data
     */
    remember(callsign, data) {
      const key = normalizeCallsign(callsign);
      if (!key || !data) return;
      byCallsign.delete(key);
      if (byCallsign.size >= max) byCallsign.delete(byCallsign.keys().next().value);
      byCallsign.set(key, {
        airline: data.airline || null,
        flightIata: data.callsignIata || null,
        route: data.origin && data.destination ? { origin: data.origin, destination: data.destination } : null,
      });
    },
    /**
     * Doplň do záznamu stroja, čo mu chýba (nič neprepisuje). True = pamäť volací znak pozná.
     * @param {object} meta záznam stroja s `callsign`
     * @returns {boolean}
     */
    apply(meta) {
      const hit = meta ? byCallsign.get(normalizeCallsign(meta.callsign)) : null;
      if (!hit) return false;
      if (!meta.airline && hit.airline) meta.airline = hit.airline;
      if (!meta.flightIata && hit.flightIata) meta.flightIata = hit.flightIata;
      if (!meta.route && hit.route) meta.route = hit.route;
      return true;
    },
    has(callsign) { return byCallsign.has(normalizeCallsign(callsign)); },
    get size() { return byCallsign.size; },
    clear() { byCallsign.clear(); },
  };
}
