// src/analytics.js — súhlas s cookies (CMP) + Google Analytics 4 (rozšírený Consent Mode v2).
//
// 2026-09-30 (vlastník: „SEO, sitemap, GSC, GA4"): GA4 ukladá cookies (_ga, _ga_*), takže v EÚ
// (ePrivacy + GDPR) smie bežať až po súhlase. 2026-10-04 (vlastník: „kvalitný podľa štandardu
// Google GDPR banner v štýle OKO, všetko čo má mať") prerobené na plnohodnotnú správu súhlasu:
//
//  - dve vrstvy: lišta (Odmietnuť všetko · Nastavenia · Prijať všetko — odmietnuť rovnako ľahko
//    a rovnako výrazne ako prijať) a nastavenia s kategóriami, prepínačmi a zoznamom cookies;
//  - Google Consent Mode v2: predvolene VŠETKO zamietnuté (vrátane ad_user_data,
//    ad_personalization), po súhlase `consent update` len pre analytics_storage; reklamné
//    signály ostávajú zamietnuté vždy (reklamy nepoužívame), ads_data_redaction zapnuté;
//  - ROZŠÍRENÝ režim (vlastník 2026-10-04: „GA4 daj implicitne zapnutú"): gtag.js sa na
//    okolive.sk načíta vždy (okrem robotov); bez súhlasu je analytics_storage denied, takže GA
//    neukladá cookies a posiela len anonymné pingy bez identifikátora (Google z nich modeluje
//    návštevnosť). Predzaškrtnutý súhlas by podľa SDEÚ (Planet49) nebol platný, preto prepínač
//    ostáva vypnutý, kým ho návštevník nezapne;
//  - odvolanie kedykoľvek (SÚKROMIE vpravo hore, /privacy.html): consent update denied,
//    zmazanie _ga cookies na mieste, bez reloadu;
//  - záznam voľby s časom a verziou zásad; po 12 mesiacoch alebo zmene zásad sa pýtame znova;
//  - Global Privacy Control = predvolene odmietnuté, lišta sa neukáže (zapnúť sa dá v nastaveniach);
//  - prístupnosť: lišta neberie fokus (región), nastavenia sú modálny dialóg s pascou fokusu a Esc.
//
// ANALYTICS_ENABLED: zapnuté 2026-10-04, keď vlastník potvrdil funkčný kontakt v zásadách ochrany
// súkromia (bez neho by to nebolo v súlade s GDPR); kontakt je vladimir_uhrin@yahoo.com.
// Na kontrolu vzhľadu: `?consent=preview` ukáže lištu na akomkoľvek hostiteľovi (GA sa nenačíta,
// tam rozhoduje analyticsDecision).
export const GA4_MEASUREMENT_ID = 'G-DH65MSBSDY';
export const ANALYTICS_ENABLED = true;
export const CONSENT_STORAGE_KEY = 'oko.consent.v2';
export const LEGACY_CONSENT_STORAGE_KEY = 'oko.consent.v1';
/** Verzia zásad ochrany súkromia, s ktorou bol súhlas daný — zmena = pýtame sa znova. */
export const CONSENT_POLICY_VERSION = '2026-10-04';
export const CONSENT_MAX_AGE_DAYS = 365;
export const CONSENT_EVENT = 'oko:consent';
const TRACKED_HOSTS = new Set(['okolive.sk']);
const DAY_MS = 86_400_000;

// ── Čisté funkcie (testy bez DOM) ────────────────────────────────────────────

/**
 * Uložená voľba → { analytics: 'granted'|'denied', at, policy } alebo null (nič, poškodené,
 * staršie ako CONSENT_MAX_AGE_DAYS, iná verzia zásad, čas z budúcnosti).
 * Záznam v1 (2026-09-30, bez verzie zásad) platí ďalej — v1 a v2 zbierajú to isté.
 */
export function parseConsentRecord(raw, { now = new Date(), legacy = false } = {}) {
  let value;
  try { value = JSON.parse(String(raw ?? '')); } catch { return null; }
  const analytics = value?.analytics;
  if (analytics !== 'granted' && analytics !== 'denied') return null;
  const at = Date.parse(value.at);
  if (!Number.isFinite(at)) return null;
  const age = now.getTime() - at;
  if (age < -DAY_MS || age > CONSENT_MAX_AGE_DAYS * DAY_MS) return null;
  const policy = legacy ? CONSENT_POLICY_VERSION : value.policy;
  if (policy !== CONSENT_POLICY_VERSION) return null;
  return { analytics, at: new Date(at).toISOString(), policy };
}

/** Voľba → text do localStorage (pure). Neznáma voľba = odmietnutie. */
export function serializeConsent(choice, now = new Date()) {
  return JSON.stringify({
    v: 2,
    analytics: choice === 'granted' ? 'granted' : 'denied',
    ads: 'denied',
    at: now.toISOString(),
    policy: CONSENT_POLICY_VERSION,
  });
}

/**
 * Stav pri štarte (pure): 'off' (vypnuté, iný hostiteľ, robot — GA sa nenačíta), 'load' (súhlas,
 * GA s cookies), 'declined' (odmietnuté alebo GPC — GA bez cookies) alebo 'ask' (lišta, GA bez
 * cookies). Každý stav okrem 'off' načíta gtag.js (gtagLoads).
 */
export function analyticsDecision({ enabled = ANALYTICS_ENABLED, host = '', consent = null, crawler = false, gpc = false } = {}) {
  if (!enabled || crawler || !TRACKED_HOSTS.has(String(host).toLowerCase())) return 'off';
  if (consent === 'granted') return 'load';
  if (consent === 'denied' || gpc) return 'declined';
  return 'ask';
}

/** Načíta sa gtag.js? (pure) Áno všade okrem 'off' — bez súhlasu v režime bez cookies. */
export function gtagLoads(decision) {
  return decision !== 'off';
}

/** Consent Mode v2: všetko zamietnuté, kým návštevník nepovie inak (pure). */
export function consentDefaults() {
  return {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
  };
}

/**
 * Príkazy pre gtag (pure): default všetko denied, po súhlase update analytics_storage granted,
 * bez reklám a Google signals. Bez súhlasu ostane default → GA bez cookies.
 */
export function gtagCommands(id = GA4_MEASUREMENT_ID, { granted = false } = {}) {
  return [
    ['consent', 'default', consentDefaults()],
    ['set', 'ads_data_redaction', true],
    ['set', 'url_passthrough', false],
    ...(granted ? [['consent', 'update', { analytics_storage: 'granted' }]] : []),
    ['config', id, { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false }],
  ];
}

/** Mená cookies GA4 v reťazci document.cookie (pure): _ga, _ga_<stream>, _gid, _gat*. */
export function gaCookieNames(cookieString = '') {
  return String(cookieString)
    .split(';')
    .map((part) => part.split('=')[0].trim())
    .filter((name) => /^_ga$|^_ga_[A-Za-z0-9]+$|^_gid$|^_gat(_.*)?$/.test(name));
}

/**
 * Zápisy do document.cookie, ktoré cookie zmažú (pure). GA ich kladie na doménu o úroveň
 * vyššie (.okolive.sk), preto aj na každú nadradenú doménu okrem samotnej TLD.
 */
export function cookieDeletionStrings(name, host = '') {
  const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  const out = [expired];
  const labels = String(host).toLowerCase().split('.').filter(Boolean);
  for (let i = 0; i < labels.length - 1; i += 1) out.push(`${expired}; domain=.${labels.slice(i).join('.')}`);
  return out;
}

/**
 * Udalosti, ktoré OKO meria (2026-10-04, vlastník: „merať, čo ľudia používajú"). Len názvy funkcií
 * a ich id — nikdy poloha na glóbuse, volací znak ani nič o človeku. Iný názov sa neodošle.
 */
export const TRACKED_EVENTS = Object.freeze({
  layer_toggle: ['layer_id', 'enabled'],
  card_open: ['kind'],
  share_create: ['short_link'],
  scene_open: ['scene_type', 'scene_id'],
  mobile_section: ['section'],
});

/** Udalosť → bezpečné parametre (pure): len povolené kľúče, krátke reťazce/čísla/bool, inak null. */
export function eventPayload(name, params = {}) {
  const allowed = TRACKED_EVENTS[name];
  if (!allowed) return null;
  const out = {};
  for (const key of allowed) {
    const value = params?.[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    else if (typeof value === 'string' && value) out[key] = value.slice(0, 64);
  }
  return out;
}

/**
 * Pošli udalosť do GA4. Nič nerobí, kým gtag.js nie je načítaný (pred štartom, mimo okolive.sk,
 * roboty) — preto sa nepočíta ani obnova stavu z odkazu pri štarte. Bez súhlasu ide v Consent Mode
 * bez cookies, ako zobrazenie stránky.
 */
export function trackEvent(name, params, win = globalThis.window) {
  try {
    if (!win?.__okoGtagLoaded || typeof win.gtag !== 'function') return false;
    const payload = eventPayload(name, params);
    if (!payload) return false;
    win.gtag('event', name, payload);
    return true;
  } catch {
    return false;
  }
}

/** Je v adrese `consent=preview`? (pure) */
export function isConsentPreview(search = '') {
  return /(?:^|[?&])consent=preview(?:&|$)/.test(String(search));
}

// ── Úložisko a gtag ──────────────────────────────────────────────────────────

export function readConsent(win = globalThis.window, now = new Date()) {
  try {
    const current = parseConsentRecord(win.localStorage?.getItem(CONSENT_STORAGE_KEY), { now });
    if (current) return current;
    return parseConsentRecord(win.localStorage?.getItem(LEGACY_CONSENT_STORAGE_KEY), { now, legacy: true });
  } catch {
    return null;
  }
}

function writeConsent(win, choice) {
  try {
    win.localStorage?.setItem(CONSENT_STORAGE_KEY, serializeConsent(choice));
    win.localStorage?.removeItem(LEGACY_CONSENT_STORAGE_KEY);
  } catch { /* súkromné okno: voľba platí do zatvorenia */ }
}

function ensureGtagStub(win) {
  win.dataLayer = win.dataLayer || [];
  // gtag musí do dataLayer vkladať `arguments`, nie pole (tak to čaká gtag.js).
  if (typeof win.gtag !== 'function') win.gtag = function gtag() { win.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
}

function loadGtag(win, doc, id, { granted = false } = {}) {
  if (win.__okoGtagLoaded) {
    if (granted) win.gtag('consent', 'update', { analytics_storage: 'granted' });
    return;
  }
  win.__okoGtagLoaded = true;
  ensureGtagStub(win);
  const commands = gtagCommands(id, { granted });
  const config = commands.pop();
  for (const command of commands) win.gtag(...command);
  win.gtag('js', new Date());
  win.gtag(...config);
  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  doc.head.appendChild(script);
}

/** Odvolanie počas návštevy: Consent Mode denied (GA ďalej bez cookies), cookies preč. */
function revokeAnalytics(win, doc) {
  if (typeof win.gtag === 'function') win.gtag('consent', 'update', { analytics_storage: 'denied' });
  try {
    const host = win.location?.hostname || '';
    for (const name of gaCookieNames(doc.cookie)) {
      for (const line of cookieDeletionStrings(name, host)) doc.cookie = line;
    }
  } catch { /* cookies zablokované — nie je čo mazať */ }
}

// ── Rozhranie (DOM) ──────────────────────────────────────────────────────────

function el(doc, tag, props = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
}

function icon(doc, name) {
  return el(doc, 'span', { className: 'material-symbols-outlined oko-consent-icon', 'aria-hidden': 'true', text: name });
}

/** Pás hlavičky ako HUD OKO: logo, „OKO", sekcia, vpravo stav. */
function headStrip(doc, t, { section, status, statusTone, closeButton } = {}) {
  return el(doc, 'header', { className: 'oko-consent-strip' }, [
    el(doc, 'div', { className: 'oko-consent-brand' }, [
      el(doc, 'img', { src: '/logo.svg', alt: '', className: 'oko-consent-logo', width: '26', height: '18' }),
      el(doc, 'span', { className: 'oko-consent-mark', 'aria-hidden': 'true' }, ['OK', el(doc, 'b', { text: 'O' })]),
      el(doc, 'span', { className: 'oko-consent-section', text: section }),
    ]),
    status ? el(doc, 'span', { className: `oko-consent-status is-${statusTone}` }, [el(doc, 'i', { 'aria-hidden': 'true' }), status]) : null,
    closeButton || null,
  ]);
}

function cookieTable(doc, t, rows) {
  const head = el(doc, 'tr', {}, ['name', 'provider', 'purpose', 'expiry'].map((k) => el(doc, 'th', { scope: 'col', text: t(`consent.col.${k}`) })));
  const body = rows.map((row) => el(doc, 'tr', {}, [
    el(doc, 'td', {}, el(doc, 'code', { text: row[0] })),
    el(doc, 'td', { text: row[1] }),
    el(doc, 'td', { text: t(row[2]) }),
    el(doc, 'td', { text: t(row[3]) }),
  ]));
  return el(doc, 'div', { className: 'oko-consent-table-wrap' }, el(doc, 'table', { className: 'oko-consent-table' }, [el(doc, 'thead', {}, head), el(doc, 'tbody', {}, body)]));
}

/** Zoznam cookies a úložiska podľa kategórií — to, čo OKO naozaj používa (src/auth/server/http.js). */
export const CONSENT_CATEGORIES = Object.freeze([
  {
    id: 'necessary',
    state: 'always',
    icon: 'verified_user',
    rows: [
      ['__Host-oko_session', 'okolive.sk', 'consent.row.session', 'consent.exp.session'],
      ['__Host-oko_oauth', 'okolive.sk', 'consent.row.oauth', 'consent.exp.oauth'],
      ['oko-lang, oko.*', 'okolive.sk', 'consent.row.settings', 'consent.exp.local'],
      [CONSENT_STORAGE_KEY, 'okolive.sk', 'consent.row.choice', 'consent.exp.choice'],
    ],
  },
  {
    id: 'analytics',
    state: 'toggle',
    icon: 'monitoring',
    rows: [
      ['_ga', 'Google', 'consent.row.ga', 'consent.exp.ga'],
      [`_ga_${GA4_MEASUREMENT_ID.slice(2)}`, 'Google', 'consent.row.ga4', 'consent.exp.ga'],
    ],
  },
  { id: 'ads', state: 'unused', icon: 'block', rows: [] },
  { id: 'media', state: 'click', icon: 'smart_display', rows: [] },
]);

/** Dlaždice v lište: čo platí vždy, čo je na tebe, čo nikdy. */
const BANNER_TILES = Object.freeze([
  { id: 'necessary', icon: 'verified_user', tone: 'ok', value: 'consent.tile.always' },
  { id: 'analytics', icon: 'monitoring', tone: 'ask', value: 'consent.tile.yours' },
  { id: 'ads', icon: 'block', tone: 'no', value: 'consent.tile.never' },
]);

/**
 * Správca súhlasu: lišta + nastavenia. Vráti { showBanner, openSettings, close, choice }.
 * `onChange(choice)` dostane 'granted' | 'denied' po každom uložení.
 */
export function createConsentManager({ win = window, doc = document, t, gpc = false, onChange } = {}) {
  let banner = null;
  let dialog = null;
  let lastFocus = null;
  let current = readConsent(win)?.analytics ?? null;

  const save = (choice) => {
    writeConsent(win, choice);
    current = choice;
    closeAll();
    onChange?.(choice);
    try { win.dispatchEvent(new win.CustomEvent(CONSENT_EVENT, { detail: { analytics: choice } })); } catch { /* starý prehliadač */ }
  };

  const button = (kind, label, onclick, extra = '') => el(doc, 'button', {
    type: 'button', className: `oko-consent-btn ${extra}`.trim(), 'data-consent': kind, onclick,
  }, el(doc, 'span', { text: label }));

  // Odmietnuť a prijať majú rovnakú triedu, veľkosť aj váhu — stred je tretia, neutrálna voľba.
  const actionRow = (middle) => el(doc, 'div', { className: 'oko-consent-actions' }, [
    button('reject', t('consent.reject-all'), () => save('denied')),
    middle,
    button('accept', t('consent.accept-all'), () => save('granted')),
  ]);

  function closeBanner() {
    banner?.remove();
    banner = null;
  }

  function closeDialog({ restoreFocus = true } = {}) {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    doc.removeEventListener('keydown', onDialogKey, true);
    if (restoreFocus && lastFocus?.isConnected) lastFocus.focus?.();
    if (banner) banner.hidden = false;
  }

  function closeAll() {
    closeDialog();
    closeBanner();
  }

  function showBanner() {
    if (banner || !doc.body) return banner;
    const titleId = 'oko-consent-title';
    banner = el(doc, 'section', { id: 'oko-consent', role: 'region', 'aria-labelledby': titleId, 'data-layer': 'banner' }, [
      el(doc, 'div', { className: 'oko-consent-scan', 'aria-hidden': 'true' }),
      headStrip(doc, t, { section: t('consent.kicker'), status: t('consent.status.pending'), statusTone: 'pending' }),
      el(doc, 'div', { className: 'oko-consent-body' }, [
        el(doc, 'div', { className: 'oko-consent-copy' }, [
          el(doc, 'h2', { id: titleId, className: 'oko-consent-title', text: t('consent.title') }),
          el(doc, 'p', { className: 'oko-consent-text', text: t('consent.text') }),
        ]),
        el(doc, 'ul', { className: 'oko-consent-tiles', 'aria-label': t('consent.tiles-label') }, BANNER_TILES.map((tile) => el(doc, 'li', { className: `oko-consent-tile is-${tile.tone}` }, [
          icon(doc, tile.icon),
          el(doc, 'span', { className: 'oko-consent-tile-name', text: t(`consent.tile.${tile.id}`) }),
          el(doc, 'span', { className: 'oko-consent-tile-value', text: t(tile.value) }),
        ]))),
      ]),
      el(doc, 'footer', { className: 'oko-consent-foot' }, [
        el(doc, 'a', { className: 'oko-consent-policy', href: '/privacy.html' }, [t('consent.more'), el(doc, 'span', { 'aria-hidden': 'true', text: ' →' })]),
        actionRow(button('settings', t('consent.settings'), () => openSettings(), 'is-ghost')),
      ]),
    ]);
    doc.body.appendChild(banner);
    return banner;
  }

  function category(cat, index, analyticsInput) {
    const titleId = `oko-consent-cat-${cat.id}`;
    let control;
    if (cat.state === 'toggle') {
      control = el(doc, 'label', { className: 'oko-consent-switch' }, [
        analyticsInput,
        el(doc, 'span', { className: 'oko-consent-switch-track', 'aria-hidden': 'true' }),
      ]);
    } else {
      control = el(doc, 'span', { className: `oko-consent-badge is-${cat.state}`, text: t(`consent.state.${cat.state}`) });
    }
    let details = null;
    if (cat.rows.length) {
      const tableId = `oko-consent-table-${cat.id}`;
      const table = cookieTable(doc, t, cat.rows);
      table.id = tableId;
      table.hidden = true;
      const toggle = el(doc, 'button', {
        type: 'button', className: 'oko-consent-more', 'aria-expanded': 'false', 'aria-controls': tableId,
        onclick: () => {
          const open = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(open));
          table.hidden = !open;
        },
      }, [el(doc, 'span', { className: 'oko-consent-caret', 'aria-hidden': 'true', text: '▸' }), t('consent.cookies-list', { n: cat.rows.length })]);
      details = [toggle, table];
    }
    return el(doc, 'section', { className: `oko-consent-cat is-${cat.id} is-${cat.state}`, 'aria-labelledby': titleId }, [
      el(doc, 'span', { className: 'oko-consent-cat-index', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
      el(doc, 'div', { className: 'oko-consent-cat-main' }, [
        el(doc, 'div', { className: 'oko-consent-cat-head' }, [
          icon(doc, cat.icon),
          el(doc, 'h3', { id: titleId, text: t(`consent.cat.${cat.id}`) }),
          control,
        ]),
        el(doc, 'p', { text: t(`consent.cat.${cat.id}.text`) }),
        ...(details || []),
      ]),
    ]);
  }

  function openSettings() {
    if (dialog) return dialog;
    lastFocus = doc.activeElement;
    if (banner) banner.hidden = true;
    const analyticsInput = el(doc, 'input', {
      type: 'checkbox', role: 'switch', id: 'oko-consent-analytics', 'aria-labelledby': 'oko-consent-cat-analytics',
    });
    analyticsInput.checked = current === 'granted';
    const stamp = readConsent(win);
    const meta = [t('consent.validity'), 'CONSENT MODE V2'];
    if (stamp) meta.push(t('consent.saved-at', { date: new Date(stamp.at).toLocaleDateString(doc.documentElement.lang || undefined) }));
    if (gpc) meta.push(t('consent.gpc'));
    const status = current === 'granted' ? ['consent.status.granted', 'ok'] : current === 'denied' ? ['consent.status.denied', 'no'] : ['consent.status.pending', 'pending'];
    const titleId = 'oko-consent-dialog-title';
    const close = el(doc, 'button', { type: 'button', className: 'oko-consent-close', 'aria-label': t('consent.close'), onclick: () => closeDialog() }, icon(doc, 'close'));
    const panel = el(doc, 'div', { className: 'oko-consent-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, [
      el(doc, 'div', { className: 'oko-consent-scan', 'aria-hidden': 'true' }),
      headStrip(doc, t, { section: t('consent.settings-kicker'), status: t(status[0]), statusTone: status[1], closeButton: close }),
      el(doc, 'div', { className: 'oko-consent-panel-scroll' }, [
        el(doc, 'div', { className: 'oko-consent-copy' }, [
          el(doc, 'h2', { id: titleId, className: 'oko-consent-title', text: t('consent.settings-title') }),
          el(doc, 'p', { className: 'oko-consent-text' }, [t('consent.settings-text'), ' ', el(doc, 'a', { href: '/privacy.html', text: t('consent.more') })]),
        ]),
        el(doc, 'div', { className: 'oko-consent-cats' }, CONSENT_CATEGORIES.map((cat, i) => category(cat, i, analyticsInput))),
      ]),
      el(doc, 'footer', { className: 'oko-consent-foot is-dialog' }, [
        el(doc, 'p', { className: 'oko-consent-meta', text: meta.join(' · ') }),
        actionRow(button('save', t('consent.save'), () => save(analyticsInput.checked ? 'granted' : 'denied'), 'is-ghost')),
      ]),
    ]);
    dialog = el(doc, 'div', { id: 'oko-consent-dialog', 'data-layer': 'settings' }, [
      el(doc, 'div', { className: 'oko-consent-backdrop', onclick: () => closeDialog() }),
      panel,
    ]);
    doc.body.appendChild(dialog);
    doc.addEventListener('keydown', onDialogKey, true);
    panel.focus();
    return dialog;
  }

  function onDialogKey(event) {
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button, a[href], input')].filter((node) => !node.disabled && node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return {
    showBanner,
    openSettings,
    close: closeAll,
    get choice() { return current; },
  };
}

/** Odkaz SÚKROMIE v HUD (index.html #consent-open) → nastavenia, inak stránka zásad. */
function bindReopen(doc, manager) {
  const button = doc.getElementById('consent-open');
  if (!button) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    if (manager) manager.openSettings();
    else doc.defaultView?.location.assign('/privacy.html');
  });
}

/** Štart: podľa rozhodnutia načíta GA4, ukáže lištu alebo nerobí nič. */
export function initAnalytics({ win = window, doc = document, t, crawler = false } = {}) {
  const gpc = win.navigator?.globalPrivacyControl === true;
  const host = win.location?.hostname;
  const decision = analyticsDecision({ host, consent: readConsent(win)?.analytics ?? null, crawler, gpc });
  const preview = isConsentPreview(win.location?.search);
  if (gtagLoads(decision)) loadGtag(win, doc, GA4_MEASUREMENT_ID, { granted: decision === 'load' });
  if (crawler || typeof t !== 'function' || (decision === 'off' && !preview)) {
    bindReopen(doc, null);
    return decision;
  }
  const manager = createConsentManager({
    win, doc, t, gpc,
    onChange: (choice) => {
      // GA beží len na okolive.sk — náhľad na localhoste nič neodošle.
      if (!gtagLoads(analyticsDecision({ host, consent: choice, crawler }))) return;
      if (choice === 'granted') loadGtag(win, doc, GA4_MEASUREMENT_ID, { granted: true });
      else revokeAnalytics(win, doc);
    },
  });
  win.okoConsent = { open: () => manager.openSettings(), get choice() { return manager.choice; } };
  bindReopen(doc, manager);
  if (decision === 'ask' || preview) manager.showBanner();
  return decision;
}
