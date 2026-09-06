// src/data/airportCard.js
/**
 * @module airportCard
 * @description Bohatá karta letiska po kliknutí (2026-09-05, používateľ:
 * „nepáči sa mi ten štýl … vyžmýkať všetko čo sa dá o danom letisku").
 *
 * Skladá všetko, čo o letisku vieme:
 *   • identita: vlajka štátu, názov, ICAO/IATA/GPS/miestny kód, typ, mesto,
 *     región, výška (OurAirports airports.csv, bundlované vo vrstve),
 *   • RÁDIO: frekvencie ATIS/TWR/GND/APP/DEP… s popisom (airport-frequencies.csv,
 *     sidecar `airport-details.json`, načítaný až pri prvom kliknutí),
 *   • DRÁHY: označenie, dĺžka × šírka v metroch, povrch, osvetlenie (runways.csv),
 *   • POČASIE: METAR/TAF riadky z existujúcej cache (airportWeather.js),
 *   • PREMÁVKA: živé lietadlá do 40 km z vrstvy letov (getNearby),
 *   • FOTKA: hlavný obrázok článku na Wikipédii (Wikimedia Commons) s autorom
 *     a licenciou pod ním — len slobodné licencie (viď airportPhoto.js),
 *   • ODKAZY: LiveATC (LEN odkaz na ich stránku letiska — podmienky LiveATC
 *     zakazujú použitie streamov tretími stranami, OKO zvuk nevkladá),
 *     Wikipédia a web letiska z OurAirports.
 *
 *   • VLASTNÝ STREAM (používateľ 2026-09-05: „vlož aj priamy stream"): LiveATC
 *     zvuk vložiť nemožno (ich podmienky), ale ak máš vlastný alebo povolený
 *     stream (SDR + Icecast, letisko s otvoreným streamom…), zapíšeš ho do
 *     git-ignorovaného `local_data/airports/atc-streams.local.json`
 *     (`{ "LZIB": { "url": "https://…/lzib.mp3", "label": "moje SDR" } }`)
 *     a karta ukáže prehrávač. Zdroj aj licenciu si drží používateľ; OKO nič
 *     nepredpokladá a bez súboru sekciu nekreslí.
 *
 * DOM prvok ukotvený k premietnutej polohe letiska (postRender), zavrie sa
 * krížikom alebo zrušením výberu; skrytý, keď je letisko za obzorom.
 * Model karty je čistá funkcia (`airportCardModel`) — testovaná bez DOM.
 */
import * as Cesium from 'cesium';
import { createAirportAudio } from './airportAudio.js';
import {
  CAMERA_LOOKUP_NEGATIVE_TTL_MS, CAMERA_LOOKUP_TTL_MS, airportCameraFor, cameraCreditText,
  cameraSearchQuery, pickLiveCamera, youtubeEmbedUrl, youtubeWatchUrl,
} from './airportCameras.js';
import { airportBroadcastFor, normalizeAirportStream } from './airportBroadcasts.js';
import { t } from '../i18n.js';
import { flagUrl } from './countryFlags.js';
import {
  AIRPORTS_LAYER_ID,
  AIRPORT_DETAILS_FILE,
  airportTierLabel,
  airportTitleFlag,
  formatElevation,
  frequencyRows,
  liveAtcUrl,
  runwayLabel,
} from './airportsData.js';
import { cachedMetarCardLines, cachedMetarReport, cachedMetarWind, metarStationId, requestAirportMetar } from './airportWeather.js';
import { metarSummary } from './metarSummary.js';
import { activeRunwayFromWind, activeRunwayLabel } from './runwayWind.js';
import { localTimeSummary } from './solarTime.js';
import { fetchAirportPhoto, photoCreditText } from './airportPhoto.js';
import { clearSelectedEntityContextForLayer } from './contextStore.js';

/** Odsadenie karty od premietnutého bodu letiska (px). */
export const AIRPORT_CARD_OFFSET_PX = 18;
/** Okolie letiska pre živú premávku (m). */
export const AIRPORT_TRAFFIC_RANGE_M = 40_000;
/** Koľko volacích znakov z okolia vypísať. */
export const AIRPORT_TRAFFIC_SAMPLES = 6;
/** Obnova živých sekcií (premávka, METAR) kým je karta otvorená (ms). */
export const AIRPORT_CARD_REFRESH_MS = 2_000;

const detailsUrlDefault = new URL(`./local_data/airports/${AIRPORT_DETAILS_FILE}`, import.meta.url).href;
/** Používateľova konfigurácia vlastných streamov (git-ignorovaná; bez súboru = bez sekcie). */
export const ATC_STREAMS_FILE = 'atc-streams.local.json';
const streamsUrlDefault = `${import.meta.url.replace(/[^/]*$/, '')}local_data/airports/${ATC_STREAMS_FILE}`;

/**
 * Vlastný stream pre letisko z konfigurácie: len http(s) URL, voliteľný popis. Pure.
 * @param {object|null} streams obsah atc-streams.local.json
 * @param {string|null} icao
 * @returns {?{url: string, label: string}}
 */
export function ownStreamFor(streams, icao) {
  const code = String(icao || '').trim().toUpperCase();
  if (!streams || !code) return null;
  const entry = streams[code] ?? streams[code.toLowerCase()];
  if (entry?.kind && entry.kind !== 'audio') return null;
  const url = typeof entry === 'string' ? entry : entry?.url;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return null;
  return { url: url.trim(), label: String(entry?.label || '').trim() };
}

/**
 * Model karty. Pure.
 * @param {object} props vlastnosti feature (name, ident, icao, iata, type, municipality, country, elevFt)
 * @param {object|null} details záznam zo sidecaru (region, web, wiki, gps, local, freq, rwy) alebo null (ešte nenačítané)
 * @param {object} [options]
 * @param {string[]} [options.metarLines] riadky METAR/TAF z cache
 * @param {Array<{callsign?: string, icao24?: string, id?: string}>|null} [options.nearby] živé lietadlá v okolí (null = vrstva letov vypnutá)
 * @param {boolean} [options.detailsLoading] sidecar sa ešte ťahá
 * @param {?{url: string, label: string}} [options.stream] vlastný/povolený stream z konfigurácie
 * @param {(key: string, vars?: object) => string} [options.translate]
 */
export function airportCardModel(props, details, {
  metarLines = [], nearby = null, detailsLoading = false, stream = null,
  wind = null, position = null, nowMs = Date.now(), translate = t,
  // Surový záznam METAR pre zhrnutie v ľudskej reči (metarSummary.js).
  metarReport = null,
} = {}) {
  if (!props) return null;
  const name = String(props.name || props.ident || '').trim();
  if (!name) return null;
  const codes = [props.icao, props.iata, details?.gps && details.gps !== props.icao ? details.gps : null, details?.local && details.local !== props.iata ? details.local : null]
    .map((v) => String(v ?? '').trim()).filter((v, i, a) => v && a.indexOf(v) === i);
  const tier = airportTierLabel(props.type, translate);
  const place = [props.municipality, details?.region, props.country]
    .map((v) => String(v ?? '').trim()).filter((v, i, a) => v && a.indexOf(v) === i).join(' · ');
  const { rows, more } = frequencyRows(details?.freq);
  const runways = (details?.rwy || []).map((r) => runwayLabel(r, translate)).filter(Boolean);
  // Aktívna dráha je ODHAD z vetra v METAR, nie hlásenie riadenia (pravidlo 2).
  const activeRunway = wind ? activeRunwayLabel(activeRunwayFromWind(details?.rwy, wind), translate) : '';
  const sun = position ? localTimeSummary(position.lat, position.lon, nowMs) : null;
  const icao = String(props.icao || props.ident || '').trim();
  const links = [];
  const atc = liveAtcUrl(icao);
  if (atc) links.push({ key: 'liveatc', label: translate('airport.link.liveatc'), href: atc });
  if (details?.wiki) links.push({ key: 'wiki', label: translate('airport.link.wikipedia'), href: details.wiki });
  if (details?.web) links.push({ key: 'web', label: translate('airport.link.web'), href: details.web });
  const traffic = Array.isArray(nearby)
    ? {
      count: nearby.length,
      samples: nearby
        .map((a) => String(a?.callsign || a?.icao24 || a?.id || '').trim().toUpperCase())
        .filter(Boolean)
        .slice(0, AIRPORT_TRAFFIC_SAMPLES),
    }
    : null;
  return {
    title: name,
    flag: airportTitleFlag(props),
    codesLine: [codes.join(' · '), tier].filter(Boolean).join(' · '),
    placeLine: [place, formatElevation(props.elevFt)].filter(Boolean).join(' · '),
    frequencies: rows,
    frequenciesMore: more,
    runways,
    weather: Array.isArray(metarLines) ? metarLines.filter(Boolean) : [],
    // Titulok + glyf + letová kategória z tých istých polí ako surové riadky.
    weatherSummary: metarReport ? metarSummary(metarReport, nowMs, translate) : null,
    traffic,
    links,
    activeRunway,
    time: sun ? {
      local: sun.localClock,
      utc: sun.utcClock,
      offsetLabel: sun.offsetLabel,
      isDay: sun.isDay,
      sun: sun.polar === 'day' ? translate('airport.polar-day')
        : sun.polar === 'night' ? translate('airport.polar-night')
          : translate(sun.isDay ? 'airport.sun-sets' : 'airport.sun-rises', {
            time: sun.isDay ? sun.sunsetClock : sun.sunriseClock,
          }),
    } : null,
    detailsLoading: Boolean(detailsLoading) && !details,
    liveAtcNote: atc ? translate('airport.liveatc-note') : '',
    stream: normalizeAirportStream(stream, translate('airport.stream')),
  };
}

const state = {
  viewer: null,
  root: null,
  content: null,
  player: null,
  container: null,
  record: null,
  props: null,
  details: null,
  detailsMap: null,
  detailsPromise: null,
  detailsUrl: detailsUrlDefault,
  streamsUrl: streamsUrlDefault,
  streams: null,
  streamsPromise: null,
  photo: null,
  photoEl: null,
  photoFetch: null,
  fetchImpl: null,
  nearbyFlights: null,
  removePostRender: null,
  onSelected: null,
  onCleared: null,
  refreshTimer: null,
  lastRenderKey: '',
  // Surový METAR/TAF je pod rozbaľovacím riadkom (2026-09-05, bod 7) — bežný
  // človek číta titulok, pilot si rozbalí. Stav prežije 2-s refresh karty.
  rawWeatherOpen: false,
  occluder: null,
  scratch: null,
  // Živá kamera (airportCameras.js): jeden trvalý <iframe> oficiálneho YouTube
  // prehrávača prežíva 2-s prekreslenia; mení sa len s letiskom, pri zavretí
  // sa vyprázdni (prehrávanie sa zastaví). cameraLookups: ICAO → {at, camera|null}.
  camera: null,        // { root, frame, credit, note, icao, videoId }
  cameraLookups: new Map(),
  cameraUrl: '/api/youtube-live',
};

function loadDetails() {
  if (state.detailsMap) return Promise.resolve(state.detailsMap);
  if (!state.detailsPromise) {
    const fetchImpl = state.fetchImpl || ((url) => fetch(url));
    state.detailsPromise = Promise.resolve(fetchImpl(state.detailsUrl))
      .then((res) => (res?.ok ? res.json() : null))
      .then((json) => { state.detailsMap = json?.airports || {}; return state.detailsMap; })
      .catch(() => { state.detailsPromise = null; return null; });
  }
  return state.detailsPromise;
}

function loadStreams() {
  if (state.streams) return Promise.resolve(state.streams);
  if (!state.streamsPromise) {
    const fetchImpl = state.fetchImpl || ((url) => fetch(url));
    state.streamsPromise = Promise.resolve(fetchImpl(state.streamsUrl))
      .then((res) => (res?.ok ? res.json() : {}))
      .then((json) => { state.streams = json && typeof json === 'object' ? json : {}; return state.streams; })
      .catch(() => { state.streams = {}; return state.streams; }); // bez súboru = bez streamov, žiadne opakovanie
  }
  return state.streamsPromise;
}

function propsOf(record) {
  const raw = record?.properties;
  if (!raw) return null;
  if (typeof raw.getValue === 'function') { try { return raw.getValue(Cesium.JulianDate.now()) || null; } catch { return null; } }
  return raw;
}

function nearby() {
  if (typeof state.nearbyFlights !== 'function' || !state.record) return null;
  const entity = state.record.entity;
  const position = entity?.__localBaseCartesian || entity?.position?.getValue?.(Cesium.JulianDate.now()) || null;
  if (!position) return null;
  try {
    const list = state.nearbyFlights(position, AIRPORT_TRAFFIC_RANGE_M);
    return Array.isArray(list) ? list : null;
  } catch { return null; }
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function section(doc, titleKey) {
  const sec = el(doc, 'section', 'airport-card-section');
  sec.appendChild(el(doc, 'h4', 'airport-card-section-title', t(titleKey)));
  return sec;
}

function render() {
  if (!state.root || !state.props) return;
  const doc = state.root.ownerDocument;
  const station = metarStationId(state.props);
  const entity = state.record?.entity;
  const position = Number.isFinite(entity?.__localLat) && Number.isFinite(entity?.__localLon)
    ? { lat: entity.__localLat, lon: entity.__localLon }
    : (Number.isFinite(state.record?.latitude) && Number.isFinite(state.record?.longitude)
      ? { lat: state.record.latitude, lon: state.record.longitude }
      : null);
  const model = airportCardModel(state.props, state.details, {
    metarLines: cachedMetarCardLines(station),
    metarReport: cachedMetarReport(station),
    wind: cachedMetarWind(station),
    position,
    nearby: nearby(),
    detailsLoading: !state.details && Boolean(state.detailsPromise),
    stream: ownStreamFor(state.streams, state.props.icao || state.props.ident) || airportBroadcastFor(state.props.icao || state.props.ident),
    translate: t,
  });
  if (!model) { hide(); return; }
  state.content.textContent = '';
  state.player?.setStream(model.stream);

  const close = el(doc, 'button', 'airport-card-close', '×');
  close.type = 'button';
  close.title = t('airport.close');
  close.setAttribute('aria-label', t('airport.close'));
  close.addEventListener('click', () => {
    if (state.viewer) { try { state.viewer.selectedEntity = undefined; } catch { /* viewer gone */ } }
    clearSelectedEntityContextForLayer(AIRPORTS_LAYER_ID);
    hide();
  });
  state.content.appendChild(close);

  // Fotka nad hlavičkou — ten istý <img> prvok prežíva 2-s prekreslenia
  // (žiadne blikanie), kredit s autorom a licenciou vedie na stránku súboru.
  if (state.photo) {
    if (!state.photoEl || state.photoEl.dataset?.src !== state.photo.thumb) {
      const img = el(doc, 'img', 'airport-card-photo');
      img.src = state.photo.thumb; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      if (img.dataset) img.dataset.src = state.photo.thumb;
      state.photoEl = img;
    }
    const figure = el(doc, 'figure', 'airport-card-figure');
    figure.appendChild(state.photoEl);
    const credit = el(doc, 'a', 'airport-card-photo-credit', photoCreditText(state.photo, t));
    credit.href = state.photo.filePage || state.photo.articleUrl; credit.target = '_blank'; credit.rel = 'noopener';
    if (state.photo.licenseUrl) credit.title = state.photo.licenseUrl;
    figure.appendChild(credit);
    state.content.appendChild(figure);
  }
  const header = el(doc, 'div', 'airport-card-header');
  const flagSrc = flagUrl(model.flag);
  if (flagSrc) {
    const flag = el(doc, 'img', 'airport-card-flag');
    flag.src = flagSrc; flag.alt = ''; flag.width = 20; flag.height = 15;
    header.appendChild(flag);
  }
  const headText = el(doc, 'div', 'airport-card-headtext');
  headText.appendChild(el(doc, 'div', 'airport-card-title', model.title));
  if (model.codesLine) headText.appendChild(el(doc, 'div', 'airport-card-sub', model.codesLine));
  if (model.placeLine) headText.appendChild(el(doc, 'div', 'airport-card-sub', model.placeLine));
  if (model.time) {
    // Miestny čas je ODHAD z poludníka (bez tabuľky časových pásiem) — preto
    // znak približnej rovnosti a slovo „odhad". UTC vedľa neho je presné a
    // aviácia stojí práve na ňom.
    const line = el(doc, 'div', 'airport-card-sub airport-card-time');
    line.textContent = [
      `≈${model.time.local} ${t('airport.local-approx')}`,
      `${model.time.utc}Z`,
      model.time.sun,
    ].join(' · ');
    line.classList?.toggle?.('is-night', !model.time.isDay);
    headText.appendChild(line);
  }
  header.appendChild(headText);
  state.content.appendChild(header);

  // Rádio
  const radio = section(doc, 'airport.section.radio');
  if (model.frequencies.length) {
    const grid = el(doc, 'div', 'airport-card-freq');
    for (const row of model.frequencies) {
      grid.appendChild(el(doc, 'span', 'airport-card-freq-type', row.type));
      grid.appendChild(el(doc, 'span', 'airport-card-freq-desc', row.description));
      grid.appendChild(el(doc, 'span', 'airport-card-freq-mhz', row.mhz));
    }
    radio.appendChild(grid);
    if (model.frequenciesMore > 0) radio.appendChild(el(doc, 'div', 'airport-card-muted', `+${model.frequenciesMore}`));
  } else {
    radio.appendChild(el(doc, 'div', 'airport-card-muted', t(model.detailsLoading ? 'airport.loading' : 'airport.no-frequencies')));
  }
  if (!model.stream) radio.appendChild(el(doc, 'div', 'airport-card-muted', t('airport.audio-missing')));
  const atc = model.links.find((l) => l.key === 'liveatc');
  if (atc && !model.stream) {
    const link = el(doc, 'a', 'airport-card-link airport-card-liveatc', `${atc.label} ↗`);
    link.href = atc.href; link.target = '_blank'; link.rel = 'noopener';
    link.title = model.liveAtcNote;
    radio.appendChild(link);
  }
  state.content.appendChild(radio);

  // Dráhy
  if (model.runways.length || model.activeRunway || model.detailsLoading) {
    const rw = section(doc, 'airport.section.runways');
    if (model.activeRunway) {
      const active = el(doc, 'div', 'airport-card-line airport-card-active-runway', model.activeRunway);
      active.title = t('airport.runway-estimate');
      rw.appendChild(active);
    }
    if (model.runways.length) for (const line of model.runways) rw.appendChild(el(doc, 'div', 'airport-card-line', line));
    else rw.appendChild(el(doc, 'div', 'airport-card-muted', t('airport.loading')));
    state.content.appendChild(rw);
  }

  // Počasie
  const wx = section(doc, 'airport.section.weather');
  const summary = model.weatherSummary;
  if (summary) {
    // Titulok v ľudskej reči + monochromatický glyf + odznak letovej kategórie.
    const head = el(doc, 'div', 'airport-card-wx-head');
    // Bez známeho druhu (správa bez oblačnosti aj javu) radšej žiadny glyf než
    // oblak, ktorý by tvrdil niečo, čo správa nehovorí.
    if (summary.kind) {
      const glyph = el(doc, 'img', 'airport-card-wx-glyph');
      glyph.setAttribute('src', summary.glyph);
      glyph.setAttribute('alt', '');
      glyph.setAttribute('aria-hidden', 'true');
      head.appendChild(glyph);
    }
    head.appendChild(el(doc, 'div', 'airport-card-wx-headline', summary.headline || t('airport.no-weather')));
    if (summary.category) {
      const badge = el(doc, 'span', `airport-card-wx-badge is-${summary.category.toLowerCase()}`, summary.category);
      badge.setAttribute('title', t(`wx.cat-${summary.category.toLowerCase()}`));
      head.appendChild(badge);
    }
    wx.appendChild(head);
    // METAR je pozorovanie, nie predpoveď, a býva až hodinu staré (pravidlo 2).
    if (summary.stale) wx.appendChild(el(doc, 'div', 'airport-card-muted airport-card-wx-stale', t('wx.stale')));
    if (model.weather.length) {
      // Surové riadky pod rozbaľovacím riadkom — pre pilotov ostane všetko.
      const toggle = el(doc, 'button', 'airport-card-wx-toggle', t(state.rawWeatherOpen ? 'wx.raw-hide' : 'wx.raw-show'));
      toggle.setAttribute('type', 'button');
      toggle.setAttribute('aria-expanded', String(state.rawWeatherOpen));
      toggle.addEventListener('click', () => {
        state.rawWeatherOpen = !state.rawWeatherOpen;
        state.lastRenderKey = '';
        render();
      });
      wx.appendChild(toggle);
      if (state.rawWeatherOpen) {
        for (const line of model.weather) wx.appendChild(el(doc, 'div', 'airport-card-line airport-card-wx-raw', line));
      }
    }
  } else if (model.weather.length) {
    // Bez surového záznamu (načítava sa / zlyhalo) ostáva pôvodné správanie.
    for (const line of model.weather) wx.appendChild(el(doc, 'div', 'airport-card-line', line));
  } else {
    wx.appendChild(el(doc, 'div', 'airport-card-muted', t('airport.no-weather')));
  }
  state.content.appendChild(wx);

  // Premávka
  if (model.traffic) {
    const tr = section(doc, 'airport.section.traffic');
    tr.appendChild(el(doc, 'div', 'airport-card-line', t('airport.traffic-count', { n: model.traffic.count, km: Math.round(AIRPORT_TRAFFIC_RANGE_M / 1000) })));
    if (model.traffic.samples.length) tr.appendChild(el(doc, 'div', 'airport-card-muted', model.traffic.samples.join(' · ')));
    state.content.appendChild(tr);
  }

  // Odkazy (okrem LiveATC, ten je pri rádiu)
  const others = model.links.filter((l) => l.key !== 'liveatc');
  if (others.length) {
    const links = el(doc, 'div', 'airport-card-links');
    for (const l of others) {
      const a = el(doc, 'a', 'airport-card-link', `${l.label} ↗`);
      a.href = l.href; a.target = '_blank'; a.rel = 'noopener';
      links.appendChild(a);
    }
    state.content.appendChild(links);
  }
  state.root.hidden = false;
  place();
}

function place() {
  if (!state.root || state.root.hidden || !state.viewer || !state.record) return;
  const scene = state.viewer.scene;
  const entity = state.record.entity;
  const position = entity?.__localBaseCartesian || entity?.position?.getValue?.(Cesium.JulianDate.now()) || null;
  if (!position) return;
  // Za obzorom = skryť (rovnaký test ako karty hostiteľa).
  try {
    state.occluder = state.occluder || new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.positionWC);
    state.occluder.cameraPosition = scene.camera.positionWC;
    if (scene.mode === Cesium.SceneMode.SCENE3D && !state.occluder.isPointVisible(position)) { state.root.style.visibility = 'hidden'; return; }
  } catch { /* occluder je len komfort */ }
  state.scratch = state.scratch || new Cesium.Cartesian2();
  const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position, state.scratch);
  if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y)) { state.root.style.visibility = 'hidden'; return; }
  state.root.style.visibility = 'visible';
  const view = state.root.ownerDocument.defaultView;
  const w = state.root.offsetWidth || 320, h = state.root.offsetHeight || 200;
  const vw = view?.innerWidth || 0, vh = view?.innerHeight || 0;
  let x = win.x + AIRPORT_CARD_OFFSET_PX;
  if (x + w > vw - 8) x = win.x - AIRPORT_CARD_OFFSET_PX - w; // vpravo niet miesta → vľavo od bodu
  let y = win.y - h / 2;
  x = Math.max(8, Math.min(x, Math.max(8, vw - w - 8)));
  y = Math.max(8, Math.min(y, Math.max(8, vh - h - 8)));
  state.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/**
 * Kamera pre práve zobrazené letisko: kurátorovaná hneď, inak jedno vyhľadanie
 * cez proxy (6 h pamäť, 30 min pre neúspech). Bez kľúča proxy vráti 503 a sekcia
 * ostane skrytá — žiadny šum. Nikdy nevolá pre iné než VYBRANÉ letisko.
 */
function resolveCamera(record, props) {
  const icao = String(props?.icao || props?.ident || '').trim().toUpperCase();
  if (!icao) return;
  const curated = airportCameraFor(icao);
  if (curated) { applyCamera(curated); return; }
  const cached = state.cameraLookups.get(icao);
  const now = Date.now();
  if (cached && now - cached.at < (cached.camera ? CAMERA_LOOKUP_TTL_MS : CAMERA_LOOKUP_NEGATIVE_TTL_MS)) {
    applyCamera(cached.camera); return;
  }
  const fetchImpl = state.fetchImpl || ((url) => fetch(url));
  const q = cameraSearchQuery(props);
  Promise.resolve(fetchImpl(`${state.cameraUrl}?q=${encodeURIComponent(q)}`))
    .then((res) => (res?.ok ? res.json() : null))
    .then((json) => {
      const camera = json ? pickLiveCamera(json, props) : null;
      state.cameraLookups.set(icao, { at: Date.now(), camera });
      if (state.record === record) applyCamera(camera);
    })
    .catch(() => { state.cameraLookups.set(icao, { at: Date.now(), camera: null }); });
}

/** Zapne/vypne trvalý prehrávač. `null` = vyprázdniť iframe (prehrávanie sa zastaví). */
function applyCamera(camera) {
  const cam = state.camera;
  if (!cam) return;
  const embed = camera ? youtubeEmbedUrl(camera.videoId) : null;
  if (!embed) {
    if (cam.videoId) { cam.frame.setAttribute('src', 'about:blank'); cam.videoId = null; }
    cam.root.hidden = true; return;
  }
  if (cam.videoId !== camera.videoId) {
    cam.frame.setAttribute('src', embed);
    cam.frame.setAttribute('title', camera.title || t('airport.section.camera'));
    cam.videoId = camera.videoId;
  }
  cam.credit.textContent = '';
  const creditLink = el(cam.root.ownerDocument, 'a', null, cameraCreditText(camera, t));
  creditLink.href = camera.channelUrl || youtubeWatchUrl(camera.videoId); creditLink.target = '_blank'; creditLink.rel = 'noopener';
  cam.credit.appendChild(creditLink);
  // Oddeľovač ako prvok, nie textový uzol — testové dvojníky DOM-u nemusia mať createTextNode.
  cam.credit.appendChild(el(cam.root.ownerDocument, 'span', null, ' · '));
  const open = el(cam.root.ownerDocument, 'a', null, `${t('airport.camera-open')} ↗`);
  open.href = youtubeWatchUrl(camera.videoId); open.target = '_blank'; open.rel = 'noopener';
  cam.credit.appendChild(open);
  cam.note.textContent = camera.source === 'search' ? t('airport.camera-found') : t('airport.audio-video-note');
  cam.root.hidden = false;
}

function hide() {
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  state.player?.setStream(null);
  applyCamera(null);
  state.photo = null; state.photoEl = null;
  state.record = null; state.props = null; state.details = null;
  if (state.root && !state.root.hidden) state.root.hidden = true;
}

function show(record) {
  if (state.record !== record) { state.player?.setStream(null); applyCamera(null); }
  state.record = record;
  state.props = propsOf(record);
  state.details = null;
  if (!state.props) { hide(); return; }
  resolveCamera(record, state.props);
  const ident = String(state.props.ident || record.entity?.id || '').trim();
  loadDetails().then((map) => {
    if (state.record !== record) return;
    state.details = map?.[ident] || map?.[String(state.props.icao || '')] || null;
    render();
    // Fotka až keď poznáme odkaz na článok (sidecar) — jeden dopyt na letisko.
    if (state.details?.wiki) {
      fetchAirportPhoto(state.details.wiki, state.fetchImpl ? { fetchImpl: state.fetchImpl, storage: null } : {}).then((photo) => {
        if (state.record !== record) return;
        state.photo = photo;
        if (photo) render();
      });
    }
  });
  loadStreams().then(() => { if (state.record === record) render(); });
  const station = metarStationId(state.props);
  if (station) requestAirportMetar(station, { onDone: () => { if (state.record === record) render(); } });
  render();
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => { if (state.record === record) render(); }, AIRPORT_CARD_REFRESH_MS);
}

/**
 * Nainštaluje kartu letiska. Idempotentné.
 * @param {object} viewer Cesium viewer (scene.postRender, selectedEntity)
 * @param {object} options
 * @param {HTMLElement} options.container rodič (typicky document.body)
 * @param {(center: object, rangeM: number) => Array} [options.nearbyFlights] živé lietadlá v okolí (vrstva letov)
 * @param {Function} [options.fetchImpl] test seam
 * @param {string} [options.detailsUrl] test seam
 * @param {string} [options.streamsUrl] test seam
 * @param {EventTarget} [options.eventTarget] test seam (default window)
 */
export function installAirportCard(viewer, { container, nearbyFlights, fetchImpl, detailsUrl, streamsUrl, eventTarget } = {}) {
  if (state.root || !container) return;
  const doc = container.ownerDocument;
  state.viewer = viewer;
  state.container = container;
  state.nearbyFlights = typeof nearbyFlights === 'function' ? nearbyFlights : null;
  state.fetchImpl = fetchImpl || null;
  if (detailsUrl) state.detailsUrl = detailsUrl;
  if (streamsUrl) state.streamsUrl = streamsUrl;
  const root = el(doc, 'aside', 'airport-card');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  container.appendChild(root);
  state.root = root;
  state.player = createAirportAudio(doc); root.appendChild(state.player.root);
  // Trvalá sekcia živej kamery (za prehrávačom zvuku, pred obsahom karty).
  const camRoot = el(doc, 'section', 'airport-card-section airport-card-camera'); camRoot.hidden = true;
  camRoot.appendChild(el(doc, 'h4', 'airport-card-section-title', t('airport.section.camera')));
  const frame = el(doc, 'iframe', 'airport-card-camera-frame');
  frame.setAttribute('src', 'about:blank');
  frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.setAttribute('loading', 'lazy');
  camRoot.appendChild(frame);
  const credit = el(doc, 'div', 'airport-card-camera-credit'); camRoot.appendChild(credit);
  const note = el(doc, 'div', 'airport-card-muted'); camRoot.appendChild(note);
  root.appendChild(camRoot);
  state.camera = { root: camRoot, frame, credit, note, videoId: null };
  state.content = el(doc, 'div', 'airport-card-content'); root.appendChild(state.content);
  const target = eventTarget || (typeof window !== 'undefined' ? window : null);
  if (target?.addEventListener) {
    state.onSelected = (event) => {
      const record = event?.detail;
      if (record?.layerId === AIRPORTS_LAYER_ID) show(record);
      else if (state.record) hide(); // iný výber (iná vrstva) kartu letiska zavrie
    };
    state.onCleared = (event) => {
      if (!event?.detail?.layerId || event.detail.layerId === AIRPORTS_LAYER_ID) hide();
    };
    target.addEventListener('gev:entity-selected', state.onSelected);
    target.addEventListener('gev:entity-selection-cleared', state.onCleared);
    state.eventTarget = target;
  }
  const postRender = viewer?.scene?.postRender;
  if (postRender?.addEventListener) {
    postRender.addEventListener(place);
    state.removePostRender = () => postRender.removeEventListener(place);
  }
}

/** Odstráni kartu a listenery (teardown viewera). */
export function destroyAirportCard() {
  hide();
  state.player?.destroy(); state.player = null; state.content = null;
  state.camera = null; state.cameraLookups = new Map();
  state.removePostRender?.();
  state.removePostRender = null;
  if (state.eventTarget) {
    state.eventTarget.removeEventListener('gev:entity-selected', state.onSelected);
    state.eventTarget.removeEventListener('gev:entity-selection-cleared', state.onCleared);
  }
  state.eventTarget = null; state.onSelected = null; state.onCleared = null;
  state.root?.remove();
  state.root = null; state.viewer = null; state.container = null; state.nearbyFlights = null;
}

/** Je karta letiska otvorená? (localGeojson ňou na chvíľu skryje ambientnú kartu vybraného letiska.) */
export function isAirportCardOpen() {
  return Boolean(state.root && !state.root.hidden && state.record);
}

/** Test seams. */
export function _getAirportCardStateForTest() {
  return {
    installed: Boolean(state.root),
    hidden: state.root ? state.root.hidden : null,
    ident: state.props?.ident || null,
    hasDetails: Boolean(state.details),
    sections: state.content ? [...state.content.children].map((c) => c.className) : [],
    text: state.root?.textContent || '',
  };
}
export function _resetAirportCardForTest() {
  destroyAirportCard();
  state.detailsMap = null; state.detailsPromise = null; state.detailsUrl = detailsUrlDefault; state.fetchImpl = null;
  state.streams = null; state.streamsPromise = null; state.streamsUrl = streamsUrlDefault;
  state.rawWeatherOpen = false;
}
