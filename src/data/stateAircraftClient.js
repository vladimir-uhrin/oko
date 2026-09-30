// src/data/stateAircraftClient.js — štátne lietadlá v prehliadači (2026-09-30): zoznam strojov
// a ich lety z /api/state-aircraft (stateAircraftService.js). Pure okrem fetchu; texty cez `t`.

import { formatDuration } from './flightHistory.js';

/** Zoznam sa mení zriedka — v pamäti na 30 min. */
export const STATE_LIST_TTL_MS = 30 * 60_000;
export const STATE_FLIGHTS_PAGE = 20;

let _list = null;
let _listAt = 0;
let _listPromise = null;

/**
 * Zoznam štátnych strojov `{aircraft, byHex}`; pri chybe prázdny (odznak sa len neukáže).
 * @param {{fetcher?: Function, now?: () => number}} [options]
 */
export async function loadStateAircraftList({ fetcher = globalThis.fetch, now = Date.now } = {}) {
  if (_list && now() - _listAt < STATE_LIST_TTL_MS) return _list;
  if (!_listPromise) {
    _listPromise = (async () => {
      try {
        const res = await fetcher('/api/state-aircraft');
        if (!res?.ok) throw new Error(`HTTP ${res?.status}`);
        const json = await res.json();
        const aircraft = Array.isArray(json?.aircraft) ? json.aircraft : [];
        _list = { aircraft, byHex: new Map(aircraft.map((a) => [String(a.hex).toLowerCase(), a])) };
        _listAt = now();
      } catch {
        _list = _list || { aircraft: [], byHex: new Map() };
      }
      return _list;
    })().finally(() => { _listPromise = null; });
  }
  return _listPromise;
}

/** Posledný načítaný zoznam (synchronne, pre kreslenie po snímkach); null pred prvým načítaním. */
export function stateAircraftListNow() {
  return _list;
}

/** Test seam. */
export function _resetStateAircraftClientForTest() {
  _list = null;
  _listAt = 0;
  _listPromise = null;
}

/**
 * Lety štátneho stroja, najnovšie prvé (`before` = lastT posledného pre staršie).
 * @returns {Promise<Array<object>>}
 */
export async function fetchStateFlights(hex, { before = null, limit = STATE_FLIGHTS_PAGE, fetcher = globalThis.fetch } = {}) {
  const params = new URLSearchParams({ hex: String(hex || '').toLowerCase(), limit: String(limit) });
  if (Number.isFinite(before)) params.set('before', String(Math.floor(before)));
  const res = await fetcher(`/api/state-aircraft/flights?${params}`);
  if (!res?.ok) throw new Error(`state flights HTTP ${res?.status ?? 'n/a'}`);
  const json = await res.json();
  return (Array.isArray(json?.flights) ? json.flights : []).map((f) => ({ ...f, icao24: json.hex }));
}

/** Kód letiska na zobrazenie: IATA, inak ICAO, inak ident; neznáme = '?'. Pure. */
export function airportCode(airport) {
  return airport?.iata || airport?.icao || airport?.ident || '?';
}

/** Dátum letu v UTC: „25. 9. 2026" (sk) / „2026-09-25" (en). Pure. */
export function flightDateUtc(epochS, lang = 'sk') {
  const d = new Date(epochS * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return lang === 'en' ? `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` : `${day}. ${m}. ${y}`;
}

const clock = (epochS) => {
  const d = new Date(epochS * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/**
 * Riadok letu: trasa „BTS → BRU" (odvodená; neznáme letisko = „?") a podriadok s dátumom,
 * časom UTC, trvaním a volacím znakom. Pure.
 */
export function stateFlightRowModel(flight, lang = 'sk') {
  const route = `${airportCode(flight.origin)} → ${airportCode(flight.destination)}`;
  const sub = [
    flightDateUtc(flight.firstT, lang),
    `${clock(flight.firstT)}–${clock(flight.lastT)} UTC`,
    Number.isFinite(flight.durationS) && flight.durationS > 0 ? formatDuration(flight.durationS) : '',
    String(flight.callsign || '').trim(),
  ].filter(Boolean).join(' · ');
  const alert = (flight.squawks || []).find((s) => ['7500', '7600', '7700'].includes(s)) || null;
  return { route, sub, alert };
}
