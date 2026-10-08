// src/data/weatherSection.js
/**
 * @module weatherSection
 * @description Sekcia POČASIE v ľavom stĺpci (2026-10-07, vlastník: „mám tam aj celý glóbus a SHMÚ,
 * chcel by som tieto dve spojiť a potom pokračovať"). Meteo bolo roztrúsené: glóbus GFS bol riadok
 * v Dátových vrstvách, radar SHMÚ v skupine Prírodné hrozby. Teraz oba riadky žijú v paneli
 * #weather-panel — správca vrstiev ich tam vyrába tým istým kódom (prepínač, počet, stav, čipy
 * polí a hladín, legenda), takže ovládanie aj životný cyklus ostávajú jedny. Panel nesie navrchu
 * živý súhrn a jednu vetu o tom, čo je model a čo meranie (pravidlo 2: odlišovať modelované
 * od nameraného). Bez panela (testy, cudzí dokument) ostanú riadky v Dátových vrstvách.
 */
import { t } from '../i18n.js';

/** Vrstvy sekcie v poradí riadkov: predpoveď pre celý svet, potom meranie nad Slovenskom. */
export const WEATHER_LAYER_IDS = Object.freeze(['meteo-gfs', 'shmu-warnings', 'shmu-stations', 'shmu-radar', 'opera-radar']);

export function isWeatherLayer(id) { return WEATHER_LAYER_IDS.includes(id); }

/**
 * Živý súhrn sekcie: „Glóbus GFS zapnutý · radar SHMÚ vypnutý". Pure.
 * @param {Array<{id: string, enabled?: boolean}>} layers projekcia `manager.getAll()`
 * @param {(key: string, vars?: object) => string} [translate]
 */
export function weatherSummary(layers, translate = t) {
  const byId = new Map((Array.isArray(layers) ? layers : []).map((l) => [l?.id, l]));
  const state = (id) => translate(byId.get(id)?.enabled ? 'weather.on' : 'weather.off');
  return [
    translate('weather.summary-globe', { state: state('meteo-gfs') }),
    translate('weather.summary-warnings', { state: translate(byId.get('shmu-warnings')?.enabled ? 'weather.on-pl' : 'weather.off-pl') }),
    translate('weather.summary-stations', { state: translate(byId.get('shmu-stations')?.enabled ? 'weather.on-pl' : 'weather.off-pl') }),
    translate('weather.summary-radar', { state: state('shmu-radar') }),
    translate('weather.summary-opera', { state: state('opera-radar') }),
  ].join(' · ');
}

/**
 * Hlavička tela panela: súhrn + veta o zdrojoch. Riadky vrstiev do tela pridáva správca.
 * @param {Document} doc
 * @param {Array<object>} [layers]
 * @param {(key: string, vars?: object) => string} [translate]
 */
export function createWeatherIntro(doc, layers = [], translate = t) {
  const root = doc.createElement('section');
  root.className = 'weather-intro';
  const summary = doc.createElement('p');
  summary.className = 'weather-summary';
  summary.textContent = weatherSummary(layers, translate);
  const note = doc.createElement('p');
  note.className = 'weather-note';
  note.textContent = translate('weather.note');
  root.appendChild(summary);
  root.appendChild(note);
  return root;
}
