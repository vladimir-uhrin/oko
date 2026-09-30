// src/eventsPanel.js
/**
 * @module eventsPanel
 * @description Udalosti v paneli História letov (2026-09-30, etapa 2b; vlastník: „aby som ich vedel
 * pekne graficky postnúť na FB", „potrebujem len overené, nie fake!").
 *
 * Verejná časť: odkaz z príspevku (/s/<id> → hash `event=<id>`) otvorí kartu udalosti — čo sa stalo,
 * kľúčové momenty s časom UTC (čo videla len jedna sieť, je označené), médiá, ktoré udalosť overili
 * (meno + odkaz), očíslované značky na glóbuse a PREHRAŤ LET (prehrávač Histórie letov).
 *
 * Súkromná časť (len na počítači vlastníka — /api/events odpovedá len tam): zoznam udalostí na
 * kontrolu, náhľad obrázka, text príspevku, ZVEREJNIŤ / STIAHNUŤ (dvojklik na potvrdenie) a po
 * zverejnení ZDIEĽAŤ NA FACEBOOKU (dialóg FB — príspevok odošle vlastník sám), kopírovanie textu
 * a odkazu, obrázok do príspevku. Nič sa nezverejní ani neodošle samo.
 *
 * DOM sa skladá z literálov (ako historyPanel.js); modely kariet sú čisté a testované.
 */
import { formatClockUtc } from './data/flightHistory.js';
import { flightDateUtc } from './data/stateAircraftClient.js';
import { currentLanguage } from './i18n.js';

export const EVENT_ID_RE = /^[0-9a-f]{6}-\d{8}T\d{4}$/;
/** Najviac toľko udalostí v zozname na kontrolu. */
export const EVENTS_REVIEW_LIMIT = 50;
/** Druhý klik na ZVEREJNIŤ / STIAHNUŤ platí 5 s. */
export const EVENTS_CONFIRM_MS = 5000;
/** Prehrávanie udalosti: rýchlosť 60× (pol hodiny udalosti za pol minúty). */
export const EVENTS_REPLAY_SPEED = 60;
const NET_NAMES = Object.freeze({ opensky: 'OpenSky', adsblol: 'adsb.lol' });
const OWNER_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, className, text) {
  const b = el(doc, 'button', className, text);
  b.type = 'button';
  return b;
}

/** Id udalosti z hashu odkazu (`event=<id>`), inak null. Pure. */
export function eventIdFromHash(hash) {
  try {
    const id = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('event');
    return id && EVENT_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Úsek na prehratie v Histórii letov: celá zjednodušená stopa udalosti (inak okno). Pure. */
export function eventLeg(view) {
  const track = Array.isArray(view?.track) ? view.track : [];
  const firstT = track.length ? track[0][0] : view?.window?.fromT;
  const lastT = track.length ? track[track.length - 1][0] : view?.window?.toT;
  if (!view?.icao24 || !Number.isFinite(firstT) || !Number.isFinite(lastT) || lastT <= firstT) return null;
  return { icao24: view.icao24, callsign: view.callsign || null, firstT, lastT };
}

/**
 * Model karty udalosti z verejného pohľadu (/api/events/public/<id>). Pure.
 * @param {object} view
 * @param {(k: string, v?: object) => string} t
 * @param {string} [lang]
 */
export function eventCardModel(view, t, lang = 'sk') {
  const L = lang === 'en' ? 'en' : 'sk';
  const sources = (view?.news?.sources || []).filter((s) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url));
  let badgeState = 'warn';
  let badge = t('events.badge-changed');
  if (view?.preview) {
    badgeState = 'preview';
    badge = t(view.publishable ? 'events.badge-preview-ready' : 'events.badge-preview');
  } else if (view?.publishable) {
    badgeState = 'ok';
    badge = t('events.badge-verified', { n: sources.length });
  }
  return {
    headline: view?.headline?.[L] || view?.headline?.sk || view?.id || '',
    flightLine: view?.flightLine?.[L] || view?.flightLine?.sk || '',
    meta: [flightDateUtc(view?.firstT, L), view?.reg, view?.typeName || view?.typeCode].filter(Boolean).join(' · '),
    badge,
    badgeState,
    times: t('events.times', { nets: (view?.networks || []).join(' + ') || '—' }),
    moments: (view?.moments || []).map((m, i) => ({
      n: i + 1,
      time: formatClockUtc(m.t),
      text: m.text?.[L] || m.text?.sk || m.kind,
      only: (m.seenBy || []).length === 1 ? t('events.only', { net: NET_NAMES[m.seenBy[0]] || m.seenBy[0] }) : '',
    })),
    sources: sources.map((s) => ({ name: s.name || s.domain || s.url, url: s.url })),
  };
}

/** Riadok zoznamu na kontrolu (súhrn z /api/events). Pure. */
export function reviewRowModel(summary, t, lang = 'sk') {
  const state = summary.published ? 'published' : (summary.publishable ? 'ready' : 'pending');
  return {
    title: summary.callsign || String(summary.icao24 || '').toUpperCase(),
    sub: [
      `${flightDateUtc(summary.firstT, lang)} ${formatClockUtc(summary.firstT)} UTC`,
      (summary.kinds || []).join(', '),
    ].filter(Boolean).join(' · '),
    chips: [
      t(summary.status === 'confirmed' ? 'events.data-confirmed' : 'events.data-unverified'),
      t(`events.news-${['verified', 'reported', 'none'].includes(summary.news) ? summary.news : 'pending'}`),
    ],
    state,
    stateLabel: state === 'published' ? t('events.published') : (state === 'ready' ? t('events.ready') : ''),
  };
}

/** API udalostí (rovnaký pôvod). Zapisovacie akcie posielajú JSON — server iné neprijme. */
export function defaultEventsApi(fetchImpl = (...args) => globalThis.fetch(...args)) {
  const getJson = async (url) => {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const postJson = async (url) => {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
    let body = {};
    try { body = await res.json(); } catch { body = {}; }
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body;
  };
  const enc = encodeURIComponent;
  return {
    publicEvent: (id) => getJson(`/api/events/public/${enc(id)}`),
    list: () => getJson(`/api/events?limit=${EVENTS_REVIEW_LIMIT}`),
    post: (id) => getJson(`/api/events/${enc(id)}/post`),
    publish: (id) => postJson(`/api/events/${enc(id)}/publish`),
    unpublish: (id) => postJson(`/api/events/${enc(id)}/unpublish`),
    cardUrl: (id, format = 'og') => `/api/events/${enc(id)}/card.jpg?format=${format === 'feed' ? 'feed' : 'og'}`,
  };
}

/**
 * @param {object} options
 * @param {HTMLElement} options.host telo panela História letov ([data-history-body]) — karta ide navrch
 * @param {(k: string, v?: object) => string} options.t
 * @param {Document} [options.doc]
 * @param {() => string} [options.lang]
 * @param {{showLeg?: (leg: object) => Promise<void>|void, replay?: object}|null} [options.history]
 * @param {(() => void)|null} [options.reveal] otvor panel História letov (na mobile hárok DÁTA)
 * @param {{show: Function, clear: Function, flyTo?: Function}|null} [options.markers]
 * @param {object} [options.api] defaultEventsApi() (test seam)
 * @param {boolean} [options.ownerHost] zoznam na kontrolu sa pýta len na localhoste
 */
export function installEventsPanel({
  host,
  t,
  doc = globalThis.document,
  lang = currentLanguage,
  history = null,
  reveal = null,
  markers = null,
  api = defaultEventsApi(),
  ownerHost = OWNER_HOST.test(String(globalThis.location?.hostname || '')),
  clipboard = (text) => globalThis.navigator?.clipboard?.writeText?.(text),
  openWindow = (url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer'),
  now = () => Date.now(),
} = {}) {
  if (!host || !doc) return null;
  const section = el(doc, 'section', 'events-section');

  // ── karta udalosti ─────────────────────────────────────────────
  const card = el(doc, 'div', 'events-card');
  card.hidden = true;
  const head = el(doc, 'div', 'events-card-head');
  const label = el(doc, 'span', 'events-label', t('events.title'));
  const closeBtn = button(doc, 'events-close', '✕');
  closeBtn.setAttribute('aria-label', t('events.close'));
  closeBtn.title = t('events.close');
  head.append(label, closeBtn);
  const headline = el(doc, 'strong', 'events-headline', '');
  const flightRow = el(doc, 'div', 'events-flight', '');
  const metaRow = el(doc, 'div', 'events-meta', '');
  const badge = el(doc, 'div', 'events-badge', '');
  const times = el(doc, 'div', 'events-times', '');
  const momentList = el(doc, 'ol', 'events-moments');
  const sourcesRow = el(doc, 'div', 'events-sources');
  const playBtn = button(doc, 'scene-btn events-play', t('events.play'));
  const note = el(doc, 'div', 'events-note', t('events.note'));
  // Podmienky GDELT: citácia s odkazom — správy k udalosti vyhľadal GDELT.
  const via = el(doc, 'div', 'events-note events-via', `${t('events.news-via')} `);
  const gdelt = el(doc, 'a', 'events-source', 'GDELT Project');
  gdelt.href = 'https://www.gdeltproject.org/';
  gdelt.target = '_blank';
  gdelt.rel = 'noopener noreferrer';
  via.appendChild(gdelt);
  via.hidden = true;
  const owner = el(doc, 'div', 'events-owner');
  owner.hidden = true;
  card.append(head, headline, flightRow, metaRow, badge, times, momentList, sourcesRow, playBtn, owner, note, via);

  // ── zoznam na kontrolu (len vlastník) ──────────────────────────
  const review = el(doc, 'div', 'events-review');
  review.hidden = true;
  const reviewToggle = button(doc, 'events-review-toggle', t('events.review-title', { n: 0 }));
  reviewToggle.setAttribute('aria-expanded', 'false');
  const reviewList = el(doc, 'ol', 'events-review-list');
  reviewList.hidden = true;
  review.append(reviewToggle, reviewList);

  section.append(card, review);
  section.hidden = true;
  host.insertBefore(section, host.firstChild || null);
  // Prázdna sekcia by v paneli pridala medzeru navrchu — skrytá, kým nie je čo ukázať.
  const syncSection = () => { section.hidden = card.hidden && review.hidden; };

  /** @type {{id: string, view: object|null, token: number}|null} */
  let current = null;
  let token = 0;
  let ownerAvailable = false;
  let summaries = [];
  const confirmUntil = { publish: 0, unpublish: 0 };

  // ── render ──────────────────────────────────────────────────────
  function renderCard(view) {
    const model = eventCardModel(view, t, lang());
    headline.textContent = model.headline;
    flightRow.textContent = model.flightLine;
    metaRow.textContent = model.meta;
    badge.textContent = model.badge;
    badge.dataset.state = model.badgeState;
    times.textContent = model.times;
    momentList.textContent = '';
    for (const m of model.moments) {
      const li = el(doc, 'li', 'events-moment');
      li.append(
        el(doc, 'span', 'events-moment-n', String(m.n)),
        el(doc, 'span', 'events-moment-time', m.time),
        el(doc, 'span', 'events-moment-text', m.only ? `${m.text} (${m.only})` : m.text),
      );
      momentList.appendChild(li);
    }
    sourcesRow.textContent = '';
    sourcesRow.hidden = !model.sources.length;
    if (model.sources.length) {
      sourcesRow.appendChild(el(doc, 'span', 'events-sources-label', `${t('events.media')}: `));
      model.sources.forEach((s, i) => {
        const a = el(doc, 'a', 'events-source', s.name);
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        if (i) sourcesRow.appendChild(doc.createTextNode ? doc.createTextNode(', ') : el(doc, 'span', '', ', '));
        sourcesRow.appendChild(a);
      });
    }
    playBtn.hidden = !eventLeg(view) || typeof history?.showLeg !== 'function';
    via.hidden = !model.sources.length;
  }

  let ownerMsg = null;
  function ownerMessage(text, state = 'info') {
    if (!ownerMsg) return;
    ownerMsg.textContent = text;
    ownerMsg.dataset.state = state;
  }

  async function renderOwner(id) {
    owner.textContent = '';
    owner.hidden = !ownerAvailable;
    if (!ownerAvailable) return;
    const my = current;
    let post = null;
    try {
      post = await api.post(id);
    } catch {
      post = null;
    }
    if (current !== my) return;
    owner.textContent = '';
    const imgLink = el(doc, 'a', 'events-preview-link');
    imgLink.href = api.cardUrl(id, 'og');
    imgLink.target = '_blank';
    imgLink.rel = 'noopener';
    const img = el(doc, 'img', 'events-preview');
    img.alt = t('events.preview-alt');
    img.loading = 'lazy';
    img.src = `${api.cardUrl(id, 'og')}&v=${now()}`;
    imgLink.appendChild(img);
    const status = el(doc, 'div', 'events-owner-status', '');
    const text = el(doc, 'textarea', 'events-post');
    text.readOnly = true;
    text.rows = 7;
    text.value = post?.text || '';
    text.setAttribute('aria-label', t('events.post-title'));
    const actions = el(doc, 'div', 'events-owner-actions');
    const copyText = button(doc, 'scene-btn events-copy-text', t('events.copy-text'));
    copyText.addEventListener('click', () => { void copy(text.value); });
    actions.appendChild(copyText);
    const published = post?.published?.url || null;
    if (published) {
      status.textContent = t('events.published-at', { url: published });
      const fb = button(doc, 'scene-btn events-share-fb', t('events.share-fb'));
      fb.addEventListener('click', () => { if (post.facebook) openWindow(post.facebook); });
      const copyLink = button(doc, 'scene-btn events-copy-link', t('events.copy-link'));
      copyLink.addEventListener('click', () => { void copy(published); });
      const image = el(doc, 'a', 'scene-btn events-download', t('events.download-image'));
      image.href = api.cardUrl(id, 'feed');
      image.download = `oko-udalost-${id}.jpg`;
      const withdraw = button(doc, 'scene-btn events-unpublish', t('events.unpublish'));
      withdraw.addEventListener('click', () => { void confirmThen('unpublish', withdraw, 'events.unpublish', () => api.unpublish(id)); });
      actions.append(fb, copyLink, image, withdraw);
    } else if (post?.publishable) {
      status.textContent = t('events.ready-note');
      const pub = button(doc, 'scene-btn events-publish', t('events.publish'));
      pub.addEventListener('click', () => { void confirmThen('publish', pub, 'events.publish', () => api.publish(id)); });
      actions.appendChild(pub);
    } else {
      status.textContent = t('events.not-publishable');
    }
    ownerMsg = el(doc, 'div', 'events-owner-msg', post ? '' : t('events.unavailable'));
    owner.append(imgLink, status, text, actions, ownerMsg);
  }

  async function copy(text) {
    try {
      await clipboard(text);
      ownerMessage(t('events.copied'), 'ok');
    } catch {
      ownerMessage(t('events.copy-failed'), 'error');
    }
  }

  /** Zverejniť / stiahnuť: prvý klik len pýta potvrdenie (5 s), druhý koná. */
  async function confirmThen(kind, btn, labelKey, action) {
    if (now() > confirmUntil[kind]) {
      confirmUntil[kind] = now() + EVENTS_CONFIRM_MS;
      btn.textContent = t(`${labelKey}-confirm`);
      btn.dataset.confirm = '1';
      return;
    }
    confirmUntil[kind] = 0;
    const id = current?.id;
    if (!id) return;
    btn.disabled = true;
    try {
      await action();
      await refresh(id);
    } catch (error) {
      btn.disabled = false;
      ownerMessage(t('events.error', { error: error?.message || String(error) }), 'error');
    }
  }

  async function refresh(id) {
    await loadReview();
    if (current?.id === id) await open(id, { fly: false, reveal: false, leg: false });
  }

  function renderReview() {
    const ready = summaries.filter((s) => s.publishable && !s.published).length;
    reviewToggle.textContent = t('events.review-title', { n: summaries.length }) + (ready ? ` · ${t('events.review-ready', { n: ready })}` : '');
    reviewToggle.dataset.ready = ready ? '1' : '0';
    reviewList.textContent = '';
    if (!summaries.length) {
      reviewList.appendChild(el(doc, 'li', 'events-review-empty', t('events.review-empty')));
      return;
    }
    for (const s of summaries) {
      const row = reviewRowModel(s, t, lang());
      const li = el(doc, 'li', `events-review-row events-review-row--${row.state}`);
      const b = button(doc, 'events-review-btn');
      b.append(el(doc, 'span', 'events-review-title', row.title), el(doc, 'span', 'events-review-sub', row.sub));
      const chips = el(doc, 'span', 'events-review-chips');
      for (const c of row.chips) chips.appendChild(el(doc, 'span', 'events-chip', c));
      if (row.stateLabel) chips.appendChild(el(doc, 'span', `events-chip events-chip--${row.state}`, row.stateLabel));
      b.appendChild(chips);
      b.addEventListener('click', () => { void open(s.id, { fly: true }); });
      li.appendChild(b);
      reviewList.appendChild(li);
    }
  }

  async function loadReview() {
    if (!ownerHost) return;
    try {
      const res = await api.list();
      if (!res) { ownerAvailable = false; review.hidden = true; syncSection(); return; }
      ownerAvailable = true;
      summaries = Array.isArray(res.events) ? res.events : [];
      review.hidden = false;
      syncSection();
      renderReview();
    } catch {
      review.hidden = true;
      syncSection();
    }
  }

  // ── otvorenie / zatvorenie ──────────────────────────────────────
  async function open(id, { fly = false, reveal: doReveal = true, leg: loadLeg = true } = {}) {
    if (!EVENT_ID_RE.test(String(id || ''))) return false;
    const my = { id, view: null, token: ++token };
    current = my;
    if (doReveal) reveal?.();
    card.hidden = false;
    syncSection();
    headline.textContent = t('events.loading');
    for (const node of [flightRow, metaRow, badge, times]) node.textContent = '';
    momentList.textContent = '';
    sourcesRow.hidden = true;
    playBtn.hidden = true;
    owner.hidden = true;
    let view = null;
    try {
      view = await api.publicEvent(id);
    } catch {
      view = undefined;
    }
    if (current !== my) return false;
    if (!view) {
      headline.textContent = t(view === null ? 'events.not-found' : 'events.unavailable');
      markers?.clear?.();
      return false;
    }
    my.view = view;
    renderCard(view);
    markers?.show?.(view.moments || []);
    // Trasa v prehrávači Histórie letov hneď (bez spustenia) — značky momentov sedia na nej.
    const leg = loadLeg && typeof history?.showLeg === 'function' ? eventLeg(view) : null;
    if (leg) {
      try { await history.showLeg(leg); } catch { /* História nedostupná — karta ostáva */ }
    }
    if (current !== my) return true;
    // Prehrávač zarámuje celý let od odletu (naživo FZ1073: záber 2 200 km nad Arábiou) — kamera
    // sa vráti nad udalosť, rovnaký záber ako odkaz z príspevku.
    if (fly || leg) markers?.flyTo?.(view);
    await renderOwner(id);
    return true;
  }

  function close() {
    token += 1;
    current = null;
    card.hidden = true;
    owner.textContent = '';
    syncSection();
    markers?.clear?.();
  }

  async function play() {
    const view = current?.view;
    const leg = eventLeg(view);
    if (!leg || typeof history?.showLeg !== 'function') return;
    reveal?.();
    // Trasa je už v prehrávači (otvorenie udalosti) → nenačítavať znova; inak ju nahrať.
    if (!history.isShowing?.(leg)) await history.showLeg(leg);
    const replay = history.replay;
    if (!replay || current?.view !== view) return;
    // Záber nad udalosť (prehrávač pri nahratí zarámuje celý let od odletu); úsek od 20 min pred
    // udalosťou je v zábere celý, lietadlo ním preletí.
    markers?.flyTo?.(view);
    replay.setSpeed?.(EVENTS_REPLAY_SPEED);
    // Od 20 min pred prvým spúšťačom (ako obrázok), nie od štartu dve hodiny predtým.
    const from = Array.isArray(view.focus) ? view.focus[0] : null;
    if (Number.isFinite(from) && from > leg.firstT) replay.seek?.(from);
    replay.play?.();
  }

  closeBtn.addEventListener('click', close);
  playBtn.addEventListener('click', () => { void play(); });
  reviewToggle.addEventListener('click', () => {
    const expanded = reviewList.hidden;
    reviewList.hidden = !expanded;
    reviewToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (expanded) void loadReview();
  });
  void loadReview();

  return {
    open,
    close,
    play,
    loadReview,
    _getStateForTest() {
      return { open: !card.hidden, id: current?.id ?? null, owner: ownerAvailable && !owner.hidden, review: !review.hidden, summaries: summaries.length };
    },
  };
}
