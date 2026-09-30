// src/analytics.js — Google Analytics 4 len so súhlasom návštevníka (2026-09-30, vlastník:
// „SEO, sitemap, GSC, GA4").
//
// GA4 ukladá cookies (_ga, _ga_*), takže v EÚ (ePrivacy + GDPR) smie bežať až po súhlase. Pred
// súhlasom sa nenačíta nič — žiadny gtag.js, žiadne „cookieless" pingy. Voľba sa pamätá
// v localStorage (technicky nevyhnutné, neopúšťa prehliadač); zmeniť ju možno na /privacy.html.
// Reklamné signály sú vypnuté (ad_storage, ad_user_data, ad_personalization = denied, bez Google
// signals). Pohľad v appke sa mení len v hashi — GA4 počíta jedno zobrazenie stránky pri načítaní;
// v streame okolive.sk je „zmeny stránky na základe histórie prehliadača" vypnuté, inak by každý
// pohyb kamery bol nové zobrazenie.
//
// ANALYTICS_ENABLED ostáva false, kým nebude funkčná schránka info@okolive.sk, ktorá je kontaktom
// v zásadách ochrany súkromia (vlastník 2026-09-30: „Založím info@okolive.sk") — bez funkčného
// kontaktu na prevádzkovateľa to nie je v súlade s GDPR. Zapnutie = zmena tejto konštanty.
export const GA4_MEASUREMENT_ID = 'G-DH65MSBSDY';
export const ANALYTICS_ENABLED = false;
export const CONSENT_STORAGE_KEY = 'oko.consent.v1';
const TRACKED_HOSTS = new Set(['okolive.sk']);

/** Uložená voľba → 'granted' | 'denied' | null (pure). */
export function parseConsent(raw) {
  try {
    const value = JSON.parse(String(raw ?? ''));
    return value?.analytics === 'granted' || value?.analytics === 'denied' ? value.analytics : null;
  } catch {
    return null;
  }
}

/** Voľba → text do localStorage (pure). */
export function serializeConsent(choice, now = new Date()) {
  return JSON.stringify({ analytics: choice === 'granted' ? 'granted' : 'denied', at: now.toISOString() });
}

/**
 * Čo spraviť pri štarte (pure): 'off' (vypnuté, iný hostiteľ, robot), 'load' (súhlas je),
 * 'declined' (odmietnuté) alebo 'ask' (ukázať lištu).
 */
export function analyticsDecision({ enabled = ANALYTICS_ENABLED, host = '', consent = null, crawler = false } = {}) {
  if (!enabled || crawler || !TRACKED_HOSTS.has(String(host).toLowerCase())) return 'off';
  if (consent === 'granted') return 'load';
  if (consent === 'denied') return 'declined';
  return 'ask';
}

/** Príkazy pre gtag po súhlase (pure): bez reklám a Google signals. */
export function gtagCommands(id = GA4_MEASUREMENT_ID) {
  return [
    ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' }],
    ['config', id, { send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false }],
  ];
}

function loadGtag(win, doc, id) {
  if (win.__okoGtagLoaded) return;
  win.__okoGtagLoaded = true;
  win.dataLayer = win.dataLayer || [];
  // gtag musí do dataLayer vkladať `arguments`, nie pole (tak to čaká gtag.js).
  win.gtag = function gtag() { win.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
  const [consent, config] = gtagCommands(id);
  win.gtag(...consent);
  win.gtag('js', new Date());
  win.gtag(...config);
  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  doc.head.appendChild(script);
}

function readConsent(win) {
  try { return parseConsent(win.localStorage?.getItem(CONSENT_STORAGE_KEY)); } catch { return null; }
}

function writeConsent(win, choice) {
  try { win.localStorage?.setItem(CONSENT_STORAGE_KEY, serializeConsent(choice)); } catch { /* súkromné okno: voľba platí do zatvorenia */ }
}

/** Lišta so súhlasom (DOM). Tlačidlá sú rovnocenné — odmietnuť je rovnako ľahké ako súhlasiť. */
export function showConsentBanner({ win = window, doc = document, t, onChoice }) {
  if (doc.getElementById('oko-consent')) return null;
  const box = doc.createElement('section');
  box.id = 'oko-consent';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-label', t('consent.title'));
  const text = doc.createElement('p');
  text.textContent = t('consent.text');
  const more = doc.createElement('a');
  more.href = '/privacy.html';
  more.textContent = t('consent.more');
  text.append(' ', more);
  const actions = doc.createElement('div');
  actions.className = 'oko-consent-actions';
  const decline = doc.createElement('button');
  decline.type = 'button';
  decline.textContent = t('consent.decline');
  const accept = doc.createElement('button');
  accept.type = 'button';
  accept.textContent = t('consent.accept');
  const choose = (choice) => {
    writeConsent(win, choice);
    box.remove();
    onChoice?.(choice);
  };
  decline.addEventListener('click', () => choose('denied'));
  accept.addEventListener('click', () => choose('granted'));
  actions.append(decline, accept);
  box.append(text, actions);
  doc.body.appendChild(box);
  return box;
}

/** Štart: podľa rozhodnutia načíta GA4, ukáže lištu alebo nerobí nič. */
export function initAnalytics({ win = window, doc = document, t, crawler = false } = {}) {
  const decision = analyticsDecision({ host: win.location?.hostname, consent: readConsent(win), crawler });
  if (decision === 'load') loadGtag(win, doc, GA4_MEASUREMENT_ID);
  else if (decision === 'ask' && typeof t === 'function') {
    showConsentBanner({ win, doc, t, onChoice: (choice) => { if (choice === 'granted') loadGtag(win, doc, GA4_MEASUREMENT_ID); } });
  }
  return decision;
}
