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
 * Súkromná časť (počítač vlastníka alebo vlastník prihlásený účtom, 2026-10-03 „táto funkcia je len
 * pre mňa … mala by byť pod mojím účtom" — /api/events odpovedá len im): zoznam udalostí na
 * kontrolu, náhľad obrázka, text príspevku, ZVEREJNIŤ / STIAHNUŤ (dvojklik na potvrdenie) a po
 * zverejnení ZDIEĽAŤ NA FACEBOOKU (dialóg FB — príspevok odošle vlastník sám), kopírovanie textu
 * a odkazu, obrázok do príspevku. Nič sa nezverejní ani neodošle samo.
 *
 * DOM sa skladá z literálov (ako historyPanel.js); modely kariet sú čisté a testované.
 */
import { spokenDigits } from './data/eventSpeech.js';
import { formatClockUtc } from './data/flightHistory.js';
import { flightDateUtc } from './data/stateAircraftClient.js';
import { currentLanguage } from './i18n.js';

export const EVENT_ID_RE = /^[0-9a-f]{6}-\d{8}T\d{4}$/;
/** Najviac toľko udalostí v zozname na kontrolu. */
export const EVENTS_REVIEW_LIMIT = 50;
/** Druhý klik na ZVEREJNIŤ / STIAHNUŤ platí 5 s. */
export const EVENTS_CONFIRM_MS = 5000;
/** Stav prípravy videa sa pýta každých 5 s. */
export const EVENTS_VIDEO_POLL_MS = 5000;
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

/**
 * API udalostí (rovnaký pôvod). Zapisovacie akcie posielajú JSON — server iné neprijme; pod účtom idú
 * cez klienta účtu (CSRF), inak priamo (lokálne, len tento počítač).
 * @param {{account?: {getState: Function, send: Function}|null}} [opts]
 */
export function defaultEventsApi(fetchImpl = (...args) => globalThis.fetch(...args), { account = null } = {}) {
  const getJson = async (url) => {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const postJson = async (url, payload = {}) => {
    if (account?.getState?.().user && typeof account.send === 'function') return account.send(url, 'POST', payload);
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    let body = {};
    try { body = await res.json(); } catch { body = {}; }
    if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { why: body?.why, checks: body?.checks });
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
    // Video automaticky (2026-10-03): scenár, príprava na pozadí, stav, výstupy.
    saveScript: (id, script) => postJson(`/api/events/${enc(id)}/video-script`, { script }),
    prepareVideo: (id) => postJson(`/api/events/${enc(id)}/video/prepare`),
    videoStatus: (id) => getJson(`/api/events/${enc(id)}/video/status`),
    videoUrl: (id, variant = null) => `/api/events/${enc(id)}/video.mp4${variant === 'clean' ? '?variant=clean' : ''}`,
    srtUrl: (id) => `/api/events/${enc(id)}/video.srt`,
    /** Video do príspevku (MP4) — prvý raz ho server kreslí ~30 s. */
    video: async (id) => {
      const res = await fetchImpl(`/api/events/${enc(id)}/video.mp4`, { cache: 'no-store' });
      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch { body = {}; }
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.blob();
    },
  };
}

/** Riadok „odkaz | citát" → časti. Pure. */
const splitBar = (line) => String(line).split('|').map((x) => x.trim());
/** Slovo vo formulári → miesto doplnku v komentári (eventVideoScript.EXTRA_AFTER). */
const EXTRA_AFTER = ['intro', 'dive', 'gap', 'squawk', 'uturn', 'last-contact', 'landing', 'end'];
const EXTRA_PLACE = { úvod: 'intro', pád: 'dive', ticho: 'gap', kód: 'squawk', obrat: 'uturn', koniec: 'last-contact', pristátie: 'landing' };
const EXTRA_PLACE_BACK = Object.fromEntries(Object.entries(EXTRA_PLACE).map(([k, v]) => [v, k]));
/**
 * Formulár scenára → vstup pre POST video-script (server overí dôveryhodné médium a citát v článku).
 * Prázdny formulár = null (bez scenára). Pure.
 * @param {{tag?: string, lines?: string, sub?: string, attributed?: string, spoken?: string, sources?: string, extras?: string, overrides?: Record<string, string>}} form
 */
export function scriptFormToInput(form) {
  const linesOf = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const hookLines = linesOf(form.lines);
  const spoken = linesOf(form.spoken);
  const sources = linesOf(form.sources).map((l) => { const [url, ...rest] = splitBar(l); return { url, quote: rest.join(' | ') }; });
  const hook = hookLines.length || spoken.length || sources.length ? {
    tag: String(form.tag || '').trim(), lines: hookLines, sub: String(form.sub || '').trim() || null, attributed: String(form.attributed || '').trim() || null, spoken, sources,
  } : null;
  // Doplnok: „[miesto:] veta | odkaz | citát [|| odkaz | citát]" — miesto (pád, ticho, kód, obrat, koniec,
  // pristátie, úvod) ho pripne k momentu, bez miesta ide na koniec; „||" pridá ďalší zdroj.
  const extras = linesOf(form.extras).map((l) => {
    const groups = String(l).split('||');
    const [first, url, ...rest] = splitBar(groups[0]);
    const m = /^([\p{L}-]+):\s*(.+)$/u.exec(first);
    const word = m ? m[1].toLowerCase() : '';
    const after = m ? (EXTRA_PLACE[word] || (EXTRA_AFTER.includes(word) ? word : null)) : null;
    const sources = [{ url, quote: rest.join(' | ') }, ...groups.slice(1).map((g) => { const [u, ...q] = splitBar(g); return { url: u, quote: q.join(' | ') }; })];
    return { spoken: after ? m[2].trim() : first, sources, ...(after ? { after } : {}) };
  });
  const lines = {};
  // Náhrada vety; samotná pomlčka „-" vetu vynechá.
  for (const [id, text] of Object.entries(form.overrides || {})) {
    const v = String(text || '').trim();
    if (v) lines[id] = /^[-–—]$/.test(v) ? { skip: true } : { spoken: v };
  }
  if (!hook && !extras.length && !Object.keys(lines).length) return null;
  return { hook, extras, lines };
}
/**
 * Veta do formulára: titulok (s číslicami), ak je len číslicovou podobou vety hlasu — inak by sa pri ďalšom
 * uložení číslice z titulku stratili; inak veta hlasu. Pure.
 */
const formSentence = (spoken, caption) => (caption && caption !== spoken && spokenDigits(caption).text === spoken ? caption : spoken);

/** Uložený scenár → polia formulára (predvyplnenie). Pure. */
export function scriptToForm(script) {
  const h = script?.hook || null;
  return {
    tag: h?.tag ? h.tag.toLowerCase() : '',
    lines: (h?.lines || []).join('\n'),
    sub: h?.sub || '',
    attributed: h?.attributed || '',
    spoken: (h?.spoken || []).map((x, i) => formSentence(x, h?.captions?.[i])).join('\n'),
    sources: (h?.sources || []).map((x) => `${x.url} | ${x.quote}`).join('\n'),
    extras: (script?.extras || []).map((x) => {
      const place = x.after && x.after !== 'end' ? `${EXTRA_PLACE_BACK[x.after] || x.after}: ` : '';
      const sources = (x.sources?.length ? x.sources : [{ url: '', quote: '' }]).map((s) => `${s.url || ''} | ${s.quote || ''}`).join(' || ');
      return `${place}${formSentence(x.spoken, x.caption)} | ${sources}`;
    }).join('\n'),
  };
}
/** Stav prípravy videa → text pre vlastníka. Pure. */
export function videoJobMessage(job, t) {
  if (!job || job.state === 'idle') return '';
  if (job.state === 'error') return t('events.video-job-error', { error: job.error || '?' });
  if (job.state === 'done') return t('events.video-job-done', { s: job.durationS ? job.durationS.toFixed(0) : '?' });
  if (job.stage === 'capture' && job.detail?.frames) return t('events.video-stage-capture', { frame: job.detail.frame ?? 0, frames: job.detail.frames });
  return t('events.video-stage', { stage: job.stage || job.state });
}

/** Uloženie stiahnutého súboru (video do príspevku) cez dočasný odkaz. */
function saveBlobFile(doc, blob, name) {
  const url = globalThis.URL.createObjectURL(blob);
  const a = el(doc, 'a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  globalThis.setTimeout?.(() => globalThis.URL.revokeObjectURL(url), 60_000);
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
 * @param {boolean} [options.ownerHost] zoznam na kontrolu sa pýta na localhoste (a po prihlásení účtom)
 * @param {{getState: Function, subscribe: Function, send: Function}|null} [options.account] klient účtu
 * @param {(blob: Blob, name: string) => void} [options.saveFile] uloženie stiahnutého videa (test seam)
 */
export function installEventsPanel({
  host,
  t,
  doc = globalThis.document,
  lang = currentLanguage,
  history = null,
  reveal = null,
  markers = null,
  account = null,
  api = defaultEventsApi(undefined, { account }),
  ownerHost = OWNER_HOST.test(String(globalThis.location?.hostname || '')),
  clipboard = (text) => globalThis.navigator?.clipboard?.writeText?.(text),
  openWindow = (url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer'),
  now = () => Date.now(),
  setTimer = (fn, ms) => globalThis.setTimeout?.(fn, ms),
  saveFile = (blob, name) => saveBlobFile(doc, blob, name),
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
      // Dialóg FB text príspevku neprevezme (pravidlá FB) — text ide do schránky, vlastník ho vloží.
      // Zápis do schránky sa spustí ešte pred otvorením okna (nové okno berie fokus a zápis by zlyhal).
      fb.addEventListener('click', () => {
        if (!post.facebook) return;
        let copying;
        try { copying = Promise.resolve(clipboard(text.value)); } catch (error) { copying = Promise.reject(error); }
        openWindow(post.facebook);
        copying.then(
          () => ownerMessage(t('events.fb-copied'), 'ok'),
          () => ownerMessage(t('events.copy-failed'), 'error'),
        );
      });
      const copyLink = button(doc, 'scene-btn events-copy-link', t('events.copy-link'));
      copyLink.addEventListener('click', () => { void copy(published); });
      const image = el(doc, 'a', 'scene-btn events-download', t('events.download-image'));
      image.href = api.cardUrl(id, 'feed');
      image.download = `oko-udalost-${id}.jpg`;
      actions.append(fb, copyLink, image);
      const withdraw = button(doc, 'scene-btn events-unpublish', t('events.unpublish'));
      withdraw.addEventListener('click', () => { void confirmThen('unpublish', withdraw, 'events.unpublish', () => api.unpublish(id)); });
      actions.appendChild(withdraw);
    } else if (post?.publishable) {
      status.textContent = t('events.ready-note');
      const pub = button(doc, 'scene-btn events-publish', t('events.publish'));
      pub.addEventListener('click', () => { void confirmThen('publish', pub, 'events.publish', () => api.publish(id)); });
      actions.appendChild(pub);
    } else {
      status.textContent = t('events.not-publishable');
    }
    ownerMsg = el(doc, 'div', 'events-owner-msg', post ? '' : t('events.unavailable'));
    owner.append(imgLink, status, text, actions, renderVideo(id, post), ownerMsg);
  }

  /**
   * Video automaticky (2026-10-03, vlastník: „sprav" k automatizácii): scenár (háčik, zdroje, doplnky) →
   * ULOŽIŤ SCENÁR → PRIPRAVIŤ VIDEO (linka na serveri, stav sa obnovuje každých 5 s) → stiahnuť video
   * s titulkami / bez titulkov / SRT. Video sa ponúka aj pred zverejnením — vlastník si ho vypočuje skôr,
   * než klikne ZVEREJNIŤ.
   */
  let videoPollToken = 0;
  function renderVideo(id, post) {
    const box = el(doc, 'div', 'events-video');
    if (!post || !post.video) { box.hidden = true; return box; }
    if (post.videoPrepare) {
      const form = scriptToForm(post.videoScript);
      box.appendChild(el(doc, 'div', 'events-label events-script-title', t('events.script-title')));
      box.appendChild(el(doc, 'div', 'events-note', t('events.script-hint')));
      const fields = {};
      const field = (key, labelKey, multiline = false, rows = 2) => {
        const label = el(doc, 'label', 'events-field');
        label.appendChild(el(doc, 'span', 'events-field-label', t(labelKey)));
        const input = el(doc, multiline ? 'textarea' : 'input', `events-script-${key}`);
        if (multiline) input.rows = rows; else input.type = 'text';
        input.value = form[key] || '';
        label.appendChild(input);
        fields[key] = input;
        box.appendChild(label);
      };
      field('tag', 'events.script-hook-tag');
      field('lines', 'events.script-hook-lines', true, 2);
      field('sub', 'events.script-hook-sub');
      field('attributed', 'events.script-attributed');
      field('spoken', 'events.script-spoken', true, 2);
      field('sources', 'events.script-sources', true, 2);
      field('extras', 'events.script-extras', true, 2);
      const row = el(doc, 'div', 'events-owner-actions');
      const save = button(doc, 'scene-btn events-script-save', t('events.script-save'));
      save.addEventListener('click', () => { void saveScript(id, fields, save); });
      const prepare = button(doc, 'scene-btn events-video-prepare', t('events.video-prepare'));
      prepare.disabled = ['queued', 'running'].includes(post.videoJob?.state);
      prepare.addEventListener('click', () => { void prepareVideo(id, prepare); });
      row.append(save, prepare);
      box.appendChild(row);
      box.appendChild(el(doc, 'div', 'events-note', t('events.video-prepare-hint')));
      if (!post.voiceReady) box.appendChild(el(doc, 'div', 'events-note events-video-no-voice', t('events.video-no-voice')));
      const jobLine = el(doc, 'div', 'events-video-job', videoJobMessage(post.videoJob, t));
      jobLine.dataset.state = post.videoJob?.state || 'idle';
      box.appendChild(jobLine);
      if (post.videoJob?.review?.length) {
        const rev = el(doc, 'div', 'events-video-review', t('events.video-review'));
        const ul = el(doc, 'ul', 'events-video-review-list');
        for (const r of post.videoJob.review) ul.appendChild(el(doc, 'li', '', `„${r.spoken}" — ${r.heard || '?'}`));
        rev.appendChild(ul);
        box.appendChild(rev);
      }
      if (['queued', 'running'].includes(post.videoJob?.state)) pollVideo(id, jobLine);
    }
    if (post.videoReady) {
      const dl = el(doc, 'div', 'events-owner-actions');
      const video = button(doc, 'scene-btn events-download-video', t('events.download-video'));
      video.addEventListener('click', () => { void downloadVideo(id, video); });
      const clean = el(doc, 'a', 'scene-btn events-download-video-clean', t('events.download-video-clean'));
      clean.href = api.videoUrl?.(id, 'clean') || '#';
      clean.download = `oko-udalost-${id}-bez-titulkov.mp4`;
      const srtLink = el(doc, 'a', 'scene-btn events-download-srt', t('events.download-srt'));
      srtLink.href = api.srtUrl?.(id) || '#';
      srtLink.download = `${id}.sk_SK.srt`;
      dl.append(video, clean, srtLink);
      box.appendChild(dl);
    } else if (!post.videoPrepare) {
      box.appendChild(el(doc, 'span', 'events-video-note', t('events.video-not-captured')));
    }
    return box;
  }

  async function saveScript(id, fields, btn) {
    const form = Object.fromEntries(Object.entries(fields).map(([k, input]) => [k, input.value]));
    btn.disabled = true;
    try {
      const res = await api.saveScript(id, scriptFormToInput(form));
      const checks = (res?.videoScript?.quoteChecks || []).map((c) => `${c.domain}: ${c.state}`).join(', ');
      ownerMessage(res?.videoScript ? t('events.script-saved', { checks: checks || '—' }) : t('events.script-removed'), 'ok');
      await refresh(id);
    } catch (error) {
      const msg = String(error?.message || error);
      const missing = (error?.checks || []).filter((c) => c.state === 'not_found').map((c) => c.domain).join(', ');
      ownerMessage(msg === 'quote_not_found' ? t('events.script-quote-missing', { domains: missing }) : t('events.script-bad', { why: error?.why || msg }), 'error');
      btn.disabled = false;
    }
  }

  async function prepareVideo(id, btn) {
    btn.disabled = true;
    try {
      await api.prepareVideo(id);
      ownerMessage(t('events.video-stage', { stage: 'queued' }), 'info');
      await refresh(id);
    } catch (error) {
      const msg = String(error?.message || error);
      ownerMessage(msg === 'busy' || msg === 'already_running' ? t('events.video-job-busy') : (msg === 'daily_limit' ? t('events.video-job-limit') : t('events.video-job-error', { error: msg })), 'error');
      btn.disabled = false;
    }
  }

  /** Stav prípravy každých 5 s; po skončení sa blok vlastníka prekreslí (tlačidlá na stiahnutie). */
  function pollVideo(id, jobLine) {
    const my = ++videoPollToken;
    setTimer(async () => {
      if (my !== videoPollToken || current?.id !== id) return;
      let job = null;
      try { job = await api.videoStatus(id); } catch { job = null; }
      if (my !== videoPollToken || current?.id !== id) return;
      if (job) { jobLine.textContent = videoJobMessage(job, t); jobLine.dataset.state = job.state; }
      if (job && ['queued', 'running'].includes(job.state)) pollVideo(id, jobLine);
      else await renderOwner(id);
    }, EVENTS_VIDEO_POLL_MS);
  }

  async function copy(text) {
    try {
      await clipboard(text);
      ownerMessage(t('events.copied'), 'ok');
    } catch {
      ownerMessage(t('events.copy-failed'), 'error');
    }
  }

  /** Video do príspevku: server ho prvý raz kreslí (~30 s) — tlačidlo dovtedy nereaguje, stav v správe. */
  async function downloadVideo(id, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    ownerMessage(t('events.video-preparing'), 'info');
    try {
      const blob = await api.video(id);
      saveFile(blob, `oko-udalost-${id}.mp4`);
      ownerMessage(t('events.video-ready'), 'ok');
    } catch (error) {
      ownerMessage(t('events.error', { error: error?.message || String(error) }), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /** Zverejniť / stiahnuť: prvý klik len pýta potvrdenie (5 s), druhý koná. */
  async function confirmThen(kind, btn, labelKey, action) {
    if (now() > confirmUntil[kind]) {
      const until = now() + EVENTS_CONFIRM_MS;
      confirmUntil[kind] = until;
      btn.textContent = t(`${labelKey}-confirm`);
      btn.dataset.confirm = '1';
      // Po 5 s bez druhého kliku tlačidlo znova hovorí, čo urobí prvý klik.
      setTimer(() => {
        if (confirmUntil[kind] !== until) return;
        confirmUntil[kind] = 0;
        btn.textContent = t(labelKey);
        btn.dataset.confirm = '0';
      }, EVENTS_CONFIRM_MS);
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

  /** Kontrola vlastníka: tento počítač alebo prihlásený účet (server rozhodne, či je to vlastník). */
  const ownerPossible = () => ownerHost || Boolean(account?.getState?.().user);
  async function loadReview() {
    if (!ownerPossible()) { ownerAvailable = false; review.hidden = true; syncSection(); return; }
    try {
      const res = await api.list();
      if (!res) { ownerAvailable = false; review.hidden = true; syncSection(); return; }
      const wasOwner = ownerAvailable;
      ownerAvailable = true;
      summaries = Array.isArray(res.events) ? res.events : [];
      review.hidden = false;
      syncSection();
      renderReview();
      // Karta z odkazu sa otvorila skôr, než prišiel zoznam — doplniť kontrolu vlastníka.
      if (!wasOwner && current?.view) await renderOwner(current.id);
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
  // Prihlásenie / odhlásenie: zoznam na kontrolu sa objaví alebo zmizne (len zmena používateľa).
  let lastUser = account?.getState?.().user?.id ?? null;
  account?.subscribe?.((state) => {
    const user = state?.user?.id ?? null;
    if (user === lastUser) return;
    lastUser = user;
    void loadReview().then(() => { if (current?.view) return renderOwner(current.id); return undefined; });
  });

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
