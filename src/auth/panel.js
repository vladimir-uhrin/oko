import { t, currentLanguage } from '../i18n.js';
import { createAuthClient } from './client.js';
import { validateCredentials, validName } from './validation.js';
import { PHOTO_TYPES, validatePhotoFile } from './photoPolicy.js';
import { capsLockOn, passwordStrength } from './ux.js';
// Styles are loaded by the host entry: external links on the CSP-strict account
// page, and a normal Vite stylesheet import in the globe entry.
//
// 2026-09-26 (owner: „daj to na lepšie miesto, kde to nezavadzá, a vylepši celé
// prihlásenie na úroveň tohto portálu"): the launcher is a 36 px circle next to
// the globe actions (identity stays readable for screen readers and the QA gate
// through visually hidden text), a signed-in click opens a small account menu
// instead of the whole modal, the guest dialog has a „why an account" column,
// inline field errors, a Caps Lock hint and a password-strength meter.

const SYMBOLS = { orbit: '◎', radar: '◉', globe: '◍', satellite: '✦', map: '▧', compass: '◇' };
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Neutral user silhouette for the guest launcher (inline SVG, no icon font on the CSP page). */
function guestIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const head = document.createElementNS(SVG_NS, 'circle');
  head.setAttribute('cx', '12'); head.setAttribute('cy', '8.5'); head.setAttribute('r', '3.6');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M4.8 19.4c0-3.6 3.2-5.9 7.2-5.9s7.2 2.3 7.2 5.9');
  for (const n of [head, body]) { n.setAttribute('fill', 'none'); n.setAttribute('stroke', 'currentColor'); n.setAttribute('stroke-width', '1.7'); n.setAttribute('stroke-linecap', 'round'); svg.append(n); }
  return svg;
}
/** Poskytovatelia prihlásenia (2026-09-27) v poradí tlačidiel; zobrazia sa len nastavené. */
const OAUTH_PROVIDERS = Object.freeze([['google', 'Google'], ['github', 'GitHub']]);
/**
 * Znak poskytovateľa ako inline SVG (CSP stránka účtu nemá ikonový font). Google „G" ostáva
 * vo svojich farbách (pravidlá značky Google), GitHub mark je jednofarebný (currentColor).
 */
function providerIcon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'auth-oauth-icon');
  const paths = id === 'google'
    ? [['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
      ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
      ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
      ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z']]
    : [['currentColor', 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z']];
  svg.setAttribute('viewBox', id === 'google' ? '0 0 48 48' : '0 0 16 16');
  for (const [fill, d] of paths) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('fill', fill); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
const providerLabel = id => (OAUTH_PROVIDERS.find(([key]) => key === id)?.[1] || id);
/** Aktuálne miesto (bez našich značiek) — kam sa po prihlásení vrátiť; glóbus nesie stav v #hash. */
function currentReturnPath(standalone) {
  if (standalone) return '/account.html';
  try {
    const params = new URLSearchParams(location.search); params.delete('auth'); params.delete('auth_error');
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  } catch { return '/'; }
}
const COLORS = ['cyan', 'green', 'amber', 'violet'];
const date = value => value ? new Intl.DateTimeFormat(currentLanguage() === 'sk' ? 'sk-SK' : 'en-GB',
  { dateStyle: 'medium', timeStyle: 'short' }).format(value) : t('auth.not-recorded');

/** Optional account center: no dependency on Cesium or paid map services. */
export function initAuthPanel({ client = createAuthClient(), mount, linkAction = null } = {}) {
  let ownedMount = false;
  if (!mount) {
    mount = document.getElementById('account-actions');
    // On the globe the launcher joins the centred globe-actions group as its last circle
    // (never a pill over the map); without the group it falls back to a fixed position.
    if (!mount) { mount = document.createElement('nav'); mount.id = 'account-actions'; mount.setAttribute('aria-label', t('auth.account')); (document.getElementById('top-center-actions') || document.body).append(mount); ownedMount = true; }
  }
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const btn = (cls, text, handler) => { const n = el('button', cls, text); n.type = 'button'; if (handler) n.addEventListener('click', handler); return n; };
  const note = key => el('p', 'auth-hint', t(key));
  const standalone = Boolean(document.body?.classList.contains('account-standalone'));
  const oauthStartUrl = (id, { link = false } = {}) => `/api/auth/oauth/${id}/start?return=${encodeURIComponent(currentReturnPath(standalone))}${link ? '&link=1' : ''}`;
  /** Chyba z návratu od poskytovateľa (…?auth_error=kód) — drží sa, kým sa dialóg nezavrie. */
  let oauthError = null;
  const opener = btn('auth-launcher'); opener.id = 'account-btn'; opener.setAttribute('aria-haspopup', 'dialog');
  const launcherAvatar = el('span', 'auth-launcher-avatar'); launcherAvatar.setAttribute('aria-hidden', 'true');
  launcherAvatar.append(guestIcon());
  // Name + state stay in the DOM for assistive tech (and the QA gate); on the globe they
  // are visually hidden — the circle shows the avatar and a green „signed in" dot.
  const launcherCopy = el('span', 'auth-launcher-copy');
  const launcherName = el('strong'); const launcherState = el('small'); launcherCopy.append(launcherName, launcherState);
  const launcherDot = el('span', 'auth-launcher-dot'); launcherDot.setAttribute('aria-hidden', 'true');
  opener.append(launcherAvatar, launcherCopy, launcherDot); mount.append(opener);
  const toast = el('div', 'auth-toast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.hidden = true;
  const dialog = el('dialog', 'auth-dialog'); dialog.id = 'account-dialog'; dialog.setAttribute('aria-labelledby', 'auth-title');
  const shell = el('div', 'auth-shell'); const header = el('header', 'auth-header'); const brand = el('div', 'auth-brand');
  const logo = el('img'); logo.src = '/logo.svg'; logo.alt = ''; logo.width = 32; logo.height = 32;
  brand.append(logo, el('span', '', 'OKO'), el('small', '', t('auth.center')));
  const close = btn('auth-close', '×', () => dialog.close()); close.setAttribute('aria-label', t('auth.close'));
  header.append(brand, close);
  const title = el('h2'); title.id = 'auth-title';
  const intro = el('p', 'auth-intro', t('auth.intro'));
  const status = el('p', 'auth-status'); status.id = 'auth-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const tabs = el('div', 'auth-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', t('auth.mode'));
  const loginTab = btn('', t('auth.login'), () => setMode('login'));
  const registerTab = btn('', t('auth.register'), () => setMode('register')); tabs.append(loginTab, registerTab);
  const fields = [];
  function field(id, key, type = 'text', autocomplete = 'off', limit = 128, { meter = false } = {}) {
    const wrapper = el('div', 'auth-field'); const label = el('label', '', t(key)); label.htmlFor = id;
    const input = el(type === 'textarea' ? 'textarea' : 'input'); input.id = id; input.name = id;
    if (type !== 'textarea') input.type = type;
    input.autocomplete = autocomplete; input.required = true; input.maxLength = limit;
    const error = el('p', 'auth-field-error'); error.id = `${id}-error`; error.hidden = true;
    input.setAttribute('aria-describedby', `${error.id} auth-status`); wrapper.append(label, input);
    const result = { wrapper, input, error, meter: null, updateMeter: null };
    if (type === 'password') {
      const reveal = btn('auth-reveal', t('auth.show-password'), () => {
        const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
        reveal.textContent = t(visible ? 'auth.hide-password' : 'auth.show-password'); reveal.setAttribute('aria-pressed', String(visible));
      }); reveal.setAttribute('aria-pressed', 'false'); wrapper.append(reveal); input.dataset.secret = 'true';
      // Caps Lock hint: the most common reason for a „wrong password" that is not wrong.
      const caps = el('p', 'auth-caps', t('auth.caps-lock')); caps.hidden = true; wrapper.append(caps);
      for (const type of ['keydown', 'keyup']) input.addEventListener(type, (event) => { caps.hidden = !capsLockOn(event); });
      input.addEventListener('blur', () => { caps.hidden = true; });
      if (meter) {
        const box = el('div', 'auth-strength'); box.setAttribute('role', 'status'); box.setAttribute('aria-label', t('auth.strength.label'));
        const bars = el('div', 'auth-strength-bars'); for (let i = 0; i < 4; i += 1) bars.append(el('span'));
        const text = el('span', 'auth-strength-text'); box.append(bars, text); box.hidden = true; wrapper.append(box);
        result.meter = box;
        result.updateMeter = () => { const s = passwordStrength(input.value); box.dataset.score = s.key === 'empty' ? '' : String(s.score); text.textContent = t(`auth.strength.${s.key}`); };
        input.addEventListener('input', result.updateMeter); result.updateMeter();
      }
    }
    if (type === 'email') { input.inputMode = 'email'; input.autocapitalize = 'none'; input.spellcheck = false; }
    wrapper.append(error);
    input.addEventListener('input', () => setFieldError(result, ''));
    fields.push(result);
    return result;
  }
  /** Inline error under the field (+ aria-invalid); empty text clears it. */
  function setFieldError(f, text) {
    if (!f) return;
    f.error.textContent = text || ''; f.error.hidden = !text;
    if (text) f.input.setAttribute('aria-invalid', 'true'); else f.input.removeAttribute('aria-invalid');
  }
  const clearFieldErrors = () => { for (const f of fields) setFieldError(f, ''); };
  function form(cls, key) {
    const node = el('form', `auth-form ${cls}`); node.noValidate = true;
    const fields = el('fieldset'); const submit = el('button', 'auth-primary', t(key)); submit.type = 'submit';
    node.append(fields); return { node, fields, submit };
  }
  function card(key, hint) { const node = el('section', 'auth-card'); node.append(el('h3', '', t(key))); if (hint) node.append(note(hint)); return node; }
  const credentials = form('auth-credentials', 'auth.login');
  const name = field('auth-name', 'auth.name', 'text', 'nickname', 80);
  const email = field('auth-email', 'auth.email', 'email', 'email', 254);
  const password = field('auth-password', 'auth.password', 'password', 'current-password', 256, { meter: true });
  const confirmation = field('auth-confirm', 'auth.confirm', 'password', 'new-password', 256);
  const passwordHint = note('auth.password-hint');
  const forgot = btn('auth-link', t('auth.forgot'), () => setMode('forgot'));
  const back = btn('auth-link', t('auth.back-login'), () => { linkAction = null; setMode('login'); });
  const mailNotice = el('p', 'auth-notice', t('auth.mail-unavailable'));
  const linkNotice = note('auth.link-note');
  credentials.fields.append(name.wrapper, email.wrapper, password.wrapper, passwordHint, confirmation.wrapper, linkNotice, mailNotice, credentials.submit, forgot, back);
  // Guest view: „why an account" column (desktop) + the form; honest — only what exists.
  const continueGuest = btn('auth-link auth-continue', t('auth.continue-guest'), () => dialog.close());
  const guest = el('div', 'auth-guest');
  const hero = el('aside', 'auth-hero');
  const heroList = el('ul');
  for (const key of ['auth.hero-1', 'auth.hero-4', 'auth.hero-2', 'auth.hero-3']) heroList.append(el('li', '', t(key)));
  hero.append(el('p', 'auth-kicker', t('auth.kicker')), el('h3', '', t('auth.hero-title')), heroList, note('auth.hero-note'));
  const guestForm = el('div', 'auth-guest-form');
  guest.append(hero, guestForm);

  const center = el('div', 'auth-center'); const sidebar = el('aside', 'auth-sidebar');
  const miniIdentity = el('div', 'auth-mini-identity');
  const avatar = el('span', 'auth-avatar', '◎'); avatar.setAttribute('aria-hidden', 'true');
  const displayName = el('strong'); const profileEmail = el('p'); const ownerBadge = el('span', 'auth-owner-badge', t('auth.owner'));
  miniIdentity.append(avatar, displayName, profileEmail, ownerBadge, el('span', 'auth-online', t('auth.signed-in')));
  const nav = el('nav', 'auth-nav'); nav.setAttribute('aria-label', t('auth.center'));
  const content = el('div', 'auth-content'); const pages = {}; const navButtons = {};
  const pageKeys = { overview: 'auth.overview', profile: 'auth.edit-profile', security: 'auth.security', devices: 'auth.devices', activity: 'auth.activity' };
  const navIcons = { overview: '▦', profile: '◉', security: '◇', devices: '▣', activity: '↗' };
  for (const [key, label] of Object.entries(pageKeys)) {
    const page = el('section', `auth-page auth-page-${key}`); page.id = `auth-page-${key}`;
    page.setAttribute('aria-labelledby', `auth-nav-${key}`); pages[key] = page; content.append(page);
    const button = btn('', '', () => selectPage(key)); button.id = `auth-nav-${key}`; button.dataset.page = key;
    button.setAttribute('aria-controls', page.id); button.append(el('span', '', navIcons[key]), el('span', '', t(label)));
    navButtons[key] = button; nav.append(button);
  }
  // Signed-in click → compact account menu under the launcher (pro-portal pattern);
  // every item opens the centre on that page. Escape / outside click / Tab close it.
  const menu = el('div', 'auth-menu'); menu.id = 'account-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('auth.menu')); menu.hidden = true;
  const menuHead = el('div', 'auth-menu-head');
  const menuAvatar = el('span', 'auth-avatar auth-menu-avatar'); menuAvatar.setAttribute('aria-hidden', 'true');
  const menuName = el('strong'); const menuEmail = el('small'); const menuBadge = el('span', 'auth-owner-badge', t('auth.owner'));
  const menuCopy = el('div'); menuCopy.append(menuName, menuEmail, menuBadge); menuHead.append(menuAvatar, menuCopy); menu.append(menuHead);
  const menuItems = [];
  for (const [key, label] of Object.entries(pageKeys)) {
    const item = btn('auth-menu-item', '', () => { closeMenu(); void open(key); });
    item.setAttribute('role', 'menuitem'); item.dataset.page = key; item.append(el('span', '', navIcons[key]), el('span', '', t(label)));
    menu.append(item); menuItems.push(item);
  }
  // Len vlastníkovi (rola owner): admin je samostatná stránka v novej karte; server ho aj tak púšťa len vlastníkovi.
  const menuAdmin = btn('auth-menu-item', '', () => { closeMenu(); window.open('/admin.html', '_blank', 'noopener'); });
  menuAdmin.setAttribute('role', 'menuitem'); menuAdmin.hidden = true; menuAdmin.append(el('span', '', '⚙︎'), el('span', '', t('auth.admin')));
  menu.append(menuAdmin); menuItems.push(menuAdmin);
  menu.append(el('hr', 'auth-menu-sep'));
  const menuLogout = btn('auth-menu-item auth-menu-logout', '', () => { closeMenu(); if (!client.getState().busy) void action(() => client.logout(), 'auth.logged-out'); });
  menuLogout.setAttribute('role', 'menuitem'); menuLogout.append(el('span', '', '⏻'), el('span', '', t('auth.logout'))); menu.append(menuLogout); menuItems.push(menuLogout);
  mount.append(menu);
  let menuOpen = false;
  const onOutside = (event) => { if (!mount.contains(event.target)) closeMenu(); };
  function openMenu() {
    if (menuOpen) return;
    menuOpen = true; menu.hidden = false; opener.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    menuItems[0]?.focus();
  }
  function closeMenu(focusOpener = false) {
    if (!menuOpen) return;
    menuOpen = false; menu.hidden = true; opener.setAttribute('aria-expanded', String(dialog.open));
    document.removeEventListener('pointerdown', onOutside, true);
    if (focusOpener) opener.focus();
  }
  const toggleMenu = () => { if (menuOpen) closeMenu(true); else openMenu(); };
  menu.addEventListener('keydown', (event) => {
    const items = menuItems.filter((b) => !b.hidden && !b.disabled); const i = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(i + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
    else if (event.key === 'Tab') closeMenu();
  });
  const logout = btn('auth-secondary auth-logout', t('auth.logout'), () => { if (!client.getState().busy) void action(() => client.logout(), 'auth.logged-out'); });
  sidebar.append(miniIdentity, nav, logout); center.append(sidebar, content);
  const overviewHero = el('div', 'auth-overview-hero'); const greeting = el('h3');
  overviewHero.append(el('p', 'auth-kicker', t('auth.signed-in')), greeting, note('auth.account-ready'));
  const overviewGrid = el('div', 'auth-grid');
  const summary = card('auth.profile'); const summaryData = el('dl', 'auth-facts'); summary.append(summaryData);
  summary.append(btn('auth-secondary', t('auth.edit-profile'), () => selectPage('profile')));
  const checklist = card('auth.profile-progress'); const checks = el('ul', 'auth-checks'); checklist.append(checks);
  const plan = card('auth.plan', 'auth.plan-note'); plan.append(el('strong', 'auth-plan-name', t('auth.free')));
  // Prepojené prihlásenia (Google/GitHub): stav z /api/account/security (identities), pripojenie
  // cez /start?link=1 — server prepojí len do účtu, ktorý je práve prihlásený.
  const linkedCard = card('auth.linked-title', 'auth.linked-note'); linkedCard.hidden = true;
  const linkedList = el('ul', 'auth-linked'); linkedCard.append(linkedList);
  overviewGrid.append(summary, checklist, plan, linkedCard); pages.overview.append(overviewHero, overviewGrid);

  const profileForm = form('auth-profile-form', 'auth.save');
  const editName = field('auth-profile-name', 'auth.name', 'text', 'nickname', 80);
  const bio = field('auth-bio', 'auth.bio', 'textarea', 'off', 560); bio.input.required = false; bio.input.rows = 3;
  bio.wrapper.append(note('auth.bio-hint'));
  const choices = el('div', 'auth-field'); choices.append(el('p', 'auth-field-label', t('auth.avatar')));
  const avatarChoices = el('div', 'auth-avatar-choices'); avatarChoices.setAttribute('role', 'group'); avatarChoices.setAttribute('aria-label', t('auth.avatar'));
  const colorChoices = el('div', 'auth-color-choices'); colorChoices.setAttribute('role', 'group'); colorChoices.setAttribute('aria-label', t('auth.avatar-color'));
  let chosenAvatar = 'orbit'; let chosenColor = 'cyan';
  function drawChoices() {
    for (const n of avatarChoices.children) n.setAttribute('aria-pressed', String(n.dataset.avatar === chosenAvatar));
    for (const n of colorChoices.children) n.setAttribute('aria-pressed', String(n.dataset.color === chosenColor));
    avatarChoices.dataset.color = chosenColor;
  }
  for (const [key, symbol] of Object.entries(SYMBOLS)) {
    const b = btn('', symbol, () => { chosenAvatar = key; drawChoices(); }); b.dataset.avatar = key;
    b.title = t(`auth.avatar.${key}`); b.setAttribute('aria-label', b.title); avatarChoices.append(b);
  }
  for (const key of COLORS) { const b = btn('', '', () => { chosenColor = key; drawChoices(); }); b.dataset.color = key; b.title = t(`auth.color.${key}`); b.setAttribute('aria-label', b.title); colorChoices.append(b); }
  choices.append(avatarChoices, el('p', 'auth-field-label', t('auth.avatar-color')), colorChoices);
  profileForm.fields.append(choices, editName.wrapper, bio.wrapper, profileForm.submit);
  const profileCard = card('auth.edit-profile', 'auth.saved-note'); profileCard.append(profileForm.node); pages.profile.append(profileCard);

  const photoCard = card('auth.photo', 'auth.photo-hint');
  const photoRow = el('div', 'auth-photo-row');
  const photoPreview = el('span', 'auth-avatar auth-photo-preview'); photoPreview.setAttribute('aria-hidden', 'true');
  const photoControls = el('div', 'auth-photo-controls');
  const photoInput = el('input'); photoInput.type = 'file'; photoInput.id = 'auth-photo-file'; photoInput.accept = PHOTO_TYPES.join(',');
  photoInput.className = 'auth-photo-input'; photoInput.setAttribute('aria-label', t('auth.choose-photo'));
  const photoChoose = btn('auth-secondary', t('auth.choose-photo'), () => photoInput.click());
  const photoSave = btn('auth-primary', t('auth.save-photo'), () => {
    if (!selectedPhoto || !previewReady || client.getState().busy) return;
    void action(async () => { await client.uploadPhoto(selectedPhoto); clearPhoto(); renderPhoto(client.getState()); }, 'auth.photo-saved');
  }); photoSave.id = 'auth-photo-save';
  const photoCancel = btn('auth-secondary', t('auth.cancel'), () => { clearPhoto(); renderPhoto(client.getState()); message(''); });
  const photoRemove = btn('auth-link auth-danger', t('auth.remove-photo'), () => {
    void action(async () => { await client.removePhoto(); clearPhoto(); renderPhoto(client.getState()); }, 'auth.photo-removed');
  }); photoRemove.id = 'auth-photo-remove';
  const photoName = el('p', 'auth-hint'); const photoPending = el('p', 'auth-hint'); photoPending.setAttribute('role', 'status');
  photoControls.append(photoInput, photoChoose, photoSave, photoCancel, photoRemove, photoName, photoPending);
  photoRow.append(photoPreview, photoControls); photoCard.append(photoRow, note('auth.photo-fallback'));
  pages.profile.prepend(photoCard);
  let selectedPhoto = null; let previewUrl = null; let previewReady = false;
  function clearPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; selectedPhoto = null; previewReady = false; photoInput.value = '';
  }
  function drawAvatar(target, user, preview = null) {
    // Only server-issued opaque versions and locally-created Blob URLs are used.
    const src = preview || (/^[a-f0-9-]{36}$/.test(user?.photoVersion || '')
      ? `/api/account/photo?v=${encodeURIComponent(user.photoVersion)}` : null);
    const key = `${src || ''}:${user?.avatar || 'orbit'}:${user?.avatarColor || 'cyan'}`;
    target.dataset.color = user?.avatarColor || 'cyan';
    if (target.dataset.imageKey === key) return;
    target.dataset.imageKey = key;
    if (!user && target === launcherAvatar) { target.replaceChildren(guestIcon()); return; }
    target.textContent = SYMBOLS[user?.avatar] || '◎';
    if (!src) return;
    const img = el('img'); img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      if (target.dataset.imageKey !== key) return;
      target.textContent = SYMBOLS[user?.avatar] || '◎';
      if (preview && preview === previewUrl) { clearPhoto(); renderPhoto(client.getState()); message(errorText('photo_invalid'), 'error'); }
    }, { once: true });
    if (preview) img.addEventListener('load', () => {
      if (preview !== previewUrl) return;
      if (img.naturalWidth * img.naturalHeight > 16_000_000) {
        clearPhoto(); renderPhoto(client.getState()); message(errorText('photo_invalid'), 'error'); return;
      }
      previewReady = true; renderPhoto(client.getState());
    }, { once: true });
    img.src = src; target.replaceChildren(img);
  }
  function renderPhoto(state) {
    drawAvatar(photoPreview, state.user, previewUrl);
    photoInput.disabled = state.busy; photoChoose.disabled = state.busy;
    photoSave.hidden = photoCancel.hidden = !selectedPhoto;
    photoSave.disabled = state.busy || !previewReady; photoCancel.disabled = state.busy;
    photoRemove.hidden = !state.user?.photoVersion; photoRemove.disabled = state.busy;
    photoName.textContent = selectedPhoto?.name || '';
    photoPending.textContent = selectedPhoto ? t(state.busy ? 'auth.photo-uploading' : 'auth.photo-preview-note') : '';
  }
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0]; if (!file || client.getState().busy) return;
    clearPhoto();
    const error = validatePhotoFile(file);
    if (error) { renderPhoto(client.getState()); message(errorText(error), 'error'); return; }
    selectedPhoto = file; previewUrl = URL.createObjectURL(file); message(''); renderPhoto(client.getState());
  });

  const passwordCard = card('auth.change-password', 'auth.password-note'); const passwordForm = form('auth-password-form', 'auth.change-password');
  const currentPassword = field('auth-current-password', 'auth.current-password', 'password', 'current-password', 256);
  const newPassword = field('auth-new-password', 'auth.new-password', 'password', 'new-password', 256, { meter: true });
  newPassword.meter.hidden = false;
  const newConfirm = field('auth-new-confirm', 'auth.confirm', 'password', 'new-password', 256);
  passwordForm.fields.append(currentPassword.wrapper, newPassword.wrapper, note('auth.password-hint'), newConfirm.wrapper, passwordForm.submit);
  passwordCard.append(passwordForm.node);
  const emailCard = card('auth.email'); const verified = el('strong', 'auth-email-status'); const localEmail = note('auth.local-email');
  const verify = btn('auth-secondary', t('auth.verify-email'), () => void action(() => client.requestVerification(), 'auth.verification-sent'));
  const emailUnavailable = el('p', 'auth-notice', t('auth.mail-unavailable'));
  const emailForm = form('auth-email-form', 'auth.change-email');
  const newEmail = field('auth-new-email', 'auth.new-email', 'email', 'email', 254);
  const emailPassword = field('auth-email-password', 'auth.current-password', 'password', 'current-password', 256);
  emailForm.fields.append(newEmail.wrapper, emailPassword.wrapper, emailForm.submit);
  emailCard.append(verified, localEmail, verify, emailUnavailable, note('auth.email-change-note'), emailForm.node);
  const exportCard = card('auth.export', 'auth.export-note'); const exportButton = btn('auth-secondary', t('auth.export'), async () => {
    if (client.getState().busy) return;
    exportButton.disabled = true;
    try {
      const data = await client.exportAccount();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = el('a'); a.href = url; a.download = 'oko-account.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      message(t('auth.exported'), 'success');
    } catch (error) { message(errorText(error.message), 'error'); }
    finally { exportButton.disabled = false; }
  }); exportCard.append(exportButton);
  // Zmazanie účtu (2026-10-05): samoobslužne, potvrdenie e-mailom účtu + heslom; nevratné.
  const deleteCard = card('auth.delete', 'auth.delete-note'); deleteCard.classList.add('auth-delete-card');
  const deleteForm = form('auth-delete-form', 'auth.delete-submit'); deleteForm.submit.classList.add('auth-danger');
  const deleteEmail = field('auth-delete-email', 'auth.delete-confirm', 'email', 'off', 254);
  const deletePassword = field('auth-delete-password', 'auth.current-password', 'password', 'current-password', 256);
  deleteForm.fields.append(deleteEmail.wrapper, deletePassword.wrapper, note('auth.delete-oauth-hint'), deleteForm.submit);
  deleteCard.append(deleteForm.node);
  pages.security.append(passwordCard, emailCard, exportCard, deleteCard);

  const securityLoading = el('p', 'auth-hint'); const securityRetry = btn('auth-secondary', t('auth.refresh'), () => void client.loadSecurity());
  const activityLoading = el('p', 'auth-hint');
  const activityRefresh = btn('auth-secondary', t('auth.refresh'), () => void client.loadSecurity());
  const sessions = el('div', 'auth-session-list'); const events = el('ol', 'auth-event-list');
  const revokeOthers = btn('auth-secondary auth-danger', t('auth.revoke-others'), () => confirmRevoke(null));
  const confirmationBox = el('div', 'auth-confirm-box'); confirmationBox.hidden = true;
  const confirmationText = el('p'); let pendingRevoke = undefined;
  const confirmAction = btn('auth-primary', t('auth.confirm-action'), () => {
    if (client.getState().busy || pendingRevoke === undefined) return;
    const id = pendingRevoke; pendingRevoke = undefined; confirmationBox.hidden = true;
    void action(() => id === null ? client.revokeOthers() : client.revokeSession(id), 'auth.revoked');
  });
  const cancelAction = btn('auth-secondary', t('auth.cancel'), () => { pendingRevoke = undefined; confirmationBox.hidden = true; });
  confirmationBox.append(confirmationText, confirmAction, cancelAction);
  pages.devices.append(el('h3', '', t('auth.devices')), note('auth.sessions-note'), securityLoading, securityRetry, sessions, revokeOthers, confirmationBox);
  pages.activity.append(el('h3', '', t('auth.activity')), note('auth.activity-note'), activityLoading, activityRefresh, events);
  const retry = btn('auth-secondary', t('auth.retry'), () => void client.refresh());
  // Dôvod otvorenia z glóbusu (2026-09-27, sledovanie letov: „pre neprihlásených ich presmeruj na
  // prihlásenie") — jedna veta nad formulárom, len pre hosťa, po zatvorení zmizne.
  const reasonNote = el('p', 'auth-reason'); reasonNote.setAttribute('role', 'note'); reasonNote.hidden = true;
  let reasonKey = null;
  // Prihlásenie cez Google/GitHub (2026-09-27, „v štýle OKO"): tlačidlá len pre poskytovateľov,
  // ktoré server naozaj má (capabilities.oauth). Odkaz vedie na náš /start — tok beží na serveri.
  const oauthBox = el('div', 'auth-oauth'); oauthBox.hidden = true;
  const oauthButtons = {};
  for (const [id, label] of OAUTH_PROVIDERS) {
    const link = el('a', `auth-oauth-btn auth-oauth-${id}`); link.dataset.provider = id;
    link.append(providerIcon(id), el('span', '', t('auth.oauth-continue', { provider: label })));
    link.addEventListener('click', () => { link.href = oauthStartUrl(id); });
    link.href = oauthStartUrl(id);
    oauthButtons[id] = link; oauthBox.append(link);
  }
  oauthBox.append(el('p', 'auth-oauth-divider', t('auth.oauth-or')));
  guestForm.append(reasonNote, intro, oauthBox, tabs, credentials.node, retry, continueGuest);
  shell.append(header, title, status, guest, center, el('p', 'auth-footer', t('auth.public-note')));
  dialog.append(shell); document.body.append(dialog, toast);
  let mode = linkAction?.action === 'reset' ? 'reset' : linkAction ? 'verify' : 'login';
  let page = 'overview'; let lastUser = null; let profileSnapshot = ''; let lastSecurity = null; let lastSecurityStatus = null; let timer; let destroyed = false;
  let broadcast; try { broadcast = new BroadcastChannel('oko-account'); } catch { /* focus/visibility fallback */ }
  const errorText = code => { const value = t(`auth.error.${code}`); return value.startsWith('auth.error.') ? t('auth.error.server_error') : value; };
  const message = (text, kind = '') => { status.textContent = text; status.dataset.kind = kind; };
  const notify = text => { clearTimeout(timer); toast.textContent = text; toast.hidden = false; timer = setTimeout(() => { toast.hidden = true; }, 6500); };
  function clearPasswords() {
    for (const input of dialog.querySelectorAll('[data-secret]')) { input.value = ''; input.type = 'password'; }
    for (const reveal of dialog.querySelectorAll('.auth-reveal')) { reveal.textContent = t('auth.show-password'); reveal.setAttribute('aria-pressed', 'false'); }
  }
  function setMode(next, preserveMessage = false) { mode = next; if (!preserveMessage) { message(''); oauthError = null; } clearPasswords(); clearFieldErrors(); render(client.getState()); (next === 'register' ? name.input : email.input).focus(); }
  function selectPage(next) {
    page = next; message(''); pendingRevoke = undefined; confirmationBox.hidden = true; clearPasswords(); clearFieldErrors(); clearPhoto(); render(client.getState());
    if (['overview', 'devices', 'activity'].includes(next)) void client.loadSecurity();
  }
  function confirmRevoke(id) {
    pendingRevoke = id; confirmationText.textContent = t(id === null ? 'auth.revoke-others-confirm' : 'auth.revoke-confirm');
    confirmationBox.hidden = false; confirmAction.focus();
  }
  function fact(label, value) { summaryData.append(el('dt', '', t(label)), el('dd', '', value)); }
  function renderSecurity(state) {
    const pending = state.securityStatus === 'loading'; const failed = state.securityStatus === 'error';
    securityLoading.textContent = pending ? t('auth.loading-security') : failed ? t('auth.security-error') : '';
    activityLoading.textContent = securityLoading.textContent; activityRefresh.disabled = pending || state.busy;
    securityRetry.hidden = !failed; securityRetry.disabled = pending;
    revokeOthers.disabled = state.busy || !state.security?.sessions?.some(s => !s.current);
    if (state.security === lastSecurity && state.securityStatus === lastSecurityStatus) return;
    lastSecurity = state.security; lastSecurityStatus = state.securityStatus; sessions.replaceChildren(); events.replaceChildren();
    for (const session of state.security?.sessions || []) {
      const row = el('article', 'auth-session'); const details = el('div');
      details.append(el('strong', '', session.label), el('p', '', `${t('auth.seen')}: ${date(session.lastSeen)}`), el('small', '', `${t('auth.expires')}: ${date(session.expiresAt)}`));
      row.append(el('span', 'auth-device-icon', '▣'), details);
      if (session.current) row.append(el('span', 'auth-tag', t('auth.this-device')));
      else { const revoke = btn('auth-session-revoke', t('auth.revoke'), () => confirmRevoke(session.id)); revoke.dataset.sessionId = session.id; row.append(revoke); }
      sessions.append(row);
    }
    if (state.security && !state.security.sessions?.some(s => !s.current)) sessions.append(note('auth.no-other-devices'));
    for (const event of state.security?.events || []) {
      const translated = t(`auth.event.${event.type}`); const row = el('li');
      const time = el('time', '', date(event.createdAt)); time.dateTime = new Date(event.createdAt).toISOString();
      row.append(el('span', 'auth-event-dot', '•'), el('strong', '', translated.startsWith('auth.event.') ? t('auth.event.unknown') : translated), time); events.append(row);
    }
    if (!state.security?.events?.length) events.append(el('li', 'auth-hint', pending ? t('auth.loading-security') : failed ? t('auth.security-error') : t('auth.no-events')));
  }
  /** Karta Prepojené prihlásenia: nastavení poskytovatelia, pripojený alebo tlačidlo Pripojiť. */
  function renderLinked(state, oauth) {
    const providers = OAUTH_PROVIDERS.filter(([id]) => oauth[id]);
    linkedCard.hidden = !state.user || !providers.length;
    if (linkedCard.hidden) return;
    const identities = Array.isArray(state.security?.identities) ? state.security.identities : [];
    const signature = JSON.stringify([providers.map(([id]) => id), identities.map((i) => [i.provider, i.email]), currentLanguage()]);
    if (linkedList.dataset.signature === signature) return;
    linkedList.dataset.signature = signature;
    linkedList.replaceChildren();
    for (const [id, label] of providers) {
      const linked = identities.find((i) => i.provider === id);
      const row = el('li', `auth-linked-row${linked ? ' is-linked' : ''}`);
      const name = el('span', 'auth-linked-name'); name.append(providerIcon(id), el('strong', '', label));
      row.append(name);
      if (linked) row.append(el('span', 'auth-linked-state', linked.email ? `${t('auth.linked-connected')} · ${linked.email}` : t('auth.linked-connected')));
      else {
        const connect = el('a', 'auth-secondary auth-linked-connect', t('auth.linked-connect'));
        connect.href = oauthStartUrl(id, { link: true });
        connect.addEventListener('click', () => { connect.href = oauthStartUrl(id, { link: true }); });
        row.append(connect);
      }
      linkedList.append(row);
    }
  }
  function render(state) {
    const user = state.user; const loggedIn = Boolean(user); const unavailable = state.status === 'unavailable'; const checking = state.status === 'checking';
    const linkMode = mode === 'reset' || mode === 'verify'; const showAccount = loggedIn && !linkMode;
    const identityChanged = lastUser?.id !== user?.id;
    if (identityChanged) clearPhoto();
    opener.dataset.authenticated = String(loggedIn); opener.dataset.status = state.status;
    launcherName.textContent = user?.displayName || t(checking ? 'auth.checking' : unavailable ? 'auth.unknown' : 'auth.login');
    launcherState.textContent = t(checking ? 'auth.checking' : unavailable ? 'auth.unknown' : loggedIn ? 'auth.signed-in' : 'auth.guest');
    drawAvatar(launcherAvatar, user); drawAvatar(avatar, user); drawAvatar(menuAvatar, user); renderPhoto(state);
    opener.title = loggedIn ? `${user.displayName} · ${t('auth.signed-in')} · ${t('auth.menu')}` : launcherName.textContent;
    opener.setAttribute('aria-label', opener.title); opener.setAttribute('aria-expanded', String(dialog.open || menuOpen));
    opener.setAttribute('aria-haspopup', loggedIn ? 'menu' : 'dialog'); opener.setAttribute('aria-controls', loggedIn ? menu.id : dialog.id);
    if (!loggedIn) closeMenu();
    menuName.textContent = user?.displayName || ''; menuEmail.textContent = user?.email || ''; menuBadge.hidden = user?.role !== 'owner'; menuAdmin.hidden = user?.role !== 'owner'; menuLogout.disabled = state.busy;
    dialog.dataset.authenticated = String(showAccount);
    // Guest layout: hero column only for the plain sign-in/registration view.
    const plainGuest = !showAccount && !linkMode && !unavailable && !checking;
    dialog.dataset.guest = String(plainGuest);
    guest.hidden = showAccount; hero.hidden = !plainGuest;
    continueGuest.hidden = standalone || !plainGuest || mode === 'forgot';
    const oauth = state.capabilities?.oauth || {};
    oauthBox.hidden = !(plainGuest && (oauth.google || oauth.github) && (mode === 'login' || mode === 'register'));
    for (const [id] of OAUTH_PROVIDERS) oauthButtons[id].hidden = !oauth[id];
    renderLinked(state, oauth);
    password.meter.hidden = !['register', 'reset'].includes(mode);
    for (const b of dialog.querySelectorAll('.auth-primary')) b.classList.toggle('is-busy', state.busy);
    title.textContent = t(showAccount ? 'auth.center' : mode === 'register' ? 'auth.create-title' : mode === 'forgot' ? 'auth.recovery-title' : mode === 'reset' ? 'auth.reset-title' : mode === 'verify' ? 'auth.confirm-email-title' : 'auth.welcome');
    reasonNote.hidden = showAccount || linkMode || !reasonKey; reasonNote.textContent = reasonKey && !showAccount ? t(reasonKey) : '';
    intro.hidden = showAccount || linkMode; tabs.hidden = showAccount || unavailable || checking || linkMode || mode === 'forgot';
    center.hidden = !showAccount; credentials.node.hidden = showAccount || unavailable || checking; retry.hidden = !unavailable;
    name.wrapper.hidden = mode !== 'register'; name.input.required = mode === 'register';
    email.wrapper.hidden = linkMode; password.wrapper.hidden = mode === 'forgot' || mode === 'verify';
    confirmation.wrapper.hidden = !['register', 'reset'].includes(mode); passwordHint.hidden = confirmation.wrapper.hidden;
    password.input.autocomplete = ['register', 'reset'].includes(mode) ? 'new-password' : 'current-password';
    forgot.hidden = mode !== 'login'; back.hidden = ['login', 'register'].includes(mode); linkNotice.hidden = !linkMode;
    mailNotice.hidden = mode !== 'forgot' || Boolean(state.capabilities.passwordReset);
    credentials.submit.textContent = t(state.busy ? 'auth.working' : mode === 'register' ? 'auth.create' : mode === 'forgot' ? 'auth.send-reset' : mode === 'reset' ? 'auth.reset-password' : mode === 'verify' ? 'auth.confirm-link' : 'auth.login');
    loginTab.setAttribute('aria-pressed', String(mode === 'login')); registerTab.setAttribute('aria-pressed', String(mode === 'register'));
    for (const fields of dialog.querySelectorAll('fieldset')) fields.disabled = state.busy;
    credentials.submit.disabled = mode === 'forgot' && !state.capabilities.passwordReset;
    for (const b of [logout, loginTab, registerTab, confirmAction, ...dialog.querySelectorAll('.auth-session-revoke')]) b.disabled = state.busy;
    verify.hidden = Boolean(user?.emailVerified); verify.disabled = state.busy || !state.capabilities.emailVerification;
    emailUnavailable.hidden = Boolean(state.capabilities.emailVerification && state.capabilities.emailChange);
    emailForm.fields.disabled = state.busy || !state.capabilities.emailChange;
    deleteForm.fields.disabled = state.busy; deleteCard.hidden = state.user?.role === 'owner';
    for (const [key, section] of Object.entries(pages)) { section.hidden = page !== key; navButtons[key].setAttribute('aria-current', page === key ? 'page' : 'false'); }
    if (user) {
      displayName.textContent = user.displayName; profileEmail.textContent = user.email; ownerBadge.hidden = user.role !== 'owner';
      greeting.textContent = t('auth.greeting', { name: user.displayName });
      verified.textContent = t(user.emailVerified ? 'auth.email-verified' : 'auth.email-pending'); verified.dataset.verified = String(Boolean(user.emailVerified));
      localEmail.hidden = !user.email.endsWith('.test');
      summaryData.replaceChildren(); fact('auth.email', user.email); fact('auth.account', t(user.role === 'owner' ? 'auth.owner' : 'auth.member'));
      fact('auth.created-date', date(user.createdAt));
      fact('auth.last-login', date(user.lastLoginAt)); fact('auth.password-updated', date(user.passwordChangedAt));
      checks.replaceChildren();
      for (const [key, done] of [['auth.profile-name-ready', Boolean(user.displayName)], ['auth.profile-bio-ready', Boolean(user.bio)], ['auth.profile-email-ready', user.emailVerified]]) {
        const li = el('li', done ? 'is-complete' : '', `${done ? '✓' : '○'} ${t(key)}`); checks.append(li);
      }
      const snapshot = JSON.stringify([user.id, user.displayName, user.bio, user.avatar, user.avatarColor]);
      if (snapshot !== profileSnapshot) {
        editName.input.value = user.displayName; bio.input.value = user.bio || ''; chosenAvatar = user.avatar || 'orbit'; chosenColor = user.avatarColor || 'cyan';
        drawChoices(); profileSnapshot = snapshot;
      }
    }
    if (identityChanged) {
      clearPasswords(); profileSnapshot = user ? profileSnapshot : ''; pendingRevoke = undefined; confirmationBox.hidden = true;
      if (!user) {
        bio.input.value = ''; editName.input.value = ''; newEmail.input.value = '';
        displayName.textContent = ''; profileEmail.textContent = ''; greeting.textContent = '';
        summaryData.replaceChildren(); checks.replaceChildren();
      }
      if (lastUser && !user && state.status === 'guest') notify(t(state.error === 'authentication_required' ? 'auth.session-expired' : 'auth.logged-out'));
    }
    lastUser = user; renderSecurity(state);
    if (oauthError && !state.user) message(errorText(oauthError), 'error');
    else if (state.error) message(errorText(state.error), 'error');
    else if (checking) message(t('auth.checking'));
    else if (state.busy) message(t('auth.working'));
    else if (status.dataset.kind !== 'success') message('');
  }
  async function action(operation, successKey) {
    if (client.getState().busy) return false;
    try {
      await operation(); message(t(successKey), 'success'); notify(t(successKey)); broadcast?.postMessage('changed');
      if (client.getState().user && dialog.open) await client.loadSecurity();
      if (dialog.open) { title.tabIndex = -1; title.focus(); }
      return true;
    } catch { return false; }
  }
  const invalid = (code, input) => {
    const text = errorText(code); message(text, 'error');
    const f = fields.find((x) => x.input === input);
    if (f) setFieldError(f, text);
    input?.focus();
  };
  credentials.node.addEventListener('submit', event => {
    event.preventDefault(); if (client.getState().busy) return;
    oauthError = null;
    if (mode === 'verify') {
      void action(async () => {
        if (linkAction?.action === 'email') await client.confirmEmailChange(linkAction.token);
        else { await client.verifyEmail(linkAction?.token); await client.refresh(); }
      }, 'auth.email-confirmed')
        .then(ok => { if (ok) { linkAction = null; setMode('login', true); } }); return;
    }
    if (mode === 'forgot') { if (!email.input.validity.valid || !email.input.value) return invalid('invalid_email', email.input); void action(() => client.forgotPassword(email.input.value), 'auth.reset-requested'); return; }
    const data = { email: mode === 'reset' ? 'reset@oko.test' : email.input.value, password: password.input.value, ...(mode === 'register' ? { displayName: name.input.value } : {}) };
    const error = validateCredentials(data, mode === 'register') || (mode === 'reset' && [...data.password].length < 15 ? 'invalid_password' : null)
      || (['register', 'reset'].includes(mode) && data.password !== confirmation.input.value ? 'password_mismatch' : null);
    if (error) return invalid(error, error === 'invalid_email' ? email.input : error === 'invalid_name' ? name.input : password.input);
    const operation = mode === 'reset' ? () => client.resetPassword({ token: linkAction?.token, password: data.password }) : mode === 'register' ? () => client.register(data) : () => client.login(data);
    const submittedMode = mode;
    void action(operation, mode === 'reset' ? 'auth.reset-done' : mode === 'register' ? 'auth.created' : 'auth.logged-in').then(ok => {
      if (ok && submittedMode === 'reset') { linkAction = null; setMode('login', true); }
    }).finally(clearPasswords);
  });
  profileForm.node.addEventListener('submit', event => {
    event.preventDefault(); if (client.getState().busy) return;
    if (!validName(editName.input.value)) return invalid('invalid_name', editName.input);
    if ([...bio.input.value].length > 280) return invalid('invalid_bio', bio.input);
    void action(() => client.updateProfile({ displayName: editName.input.value, bio: bio.input.value, avatar: chosenAvatar, avatarColor: chosenColor }), 'auth.saved');
  });
  passwordForm.node.addEventListener('submit', event => {
    event.preventDefault(); if (client.getState().busy) return;
    if (!currentPassword.input.value) return invalid('invalid_current_password', currentPassword.input);
    if ([...newPassword.input.value].length < 15 || [...newPassword.input.value].length > 128) return invalid('invalid_password', newPassword.input);
    if (newPassword.input.value !== newConfirm.input.value) return invalid('password_mismatch', newConfirm.input);
    void action(() => client.changePassword({ currentPassword: currentPassword.input.value, newPassword: newPassword.input.value }), 'auth.password-changed').finally(clearPasswords);
  });
  emailForm.node.addEventListener('submit', event => {
    event.preventDefault(); if (client.getState().busy || !client.getState().capabilities.emailChange) return;
    if (!newEmail.input.validity.valid || !newEmail.input.value) return invalid('invalid_email', newEmail.input);
    void action(() => client.requestEmailChange({ email: newEmail.input.value, currentPassword: emailPassword.input.value }), 'auth.email-change-sent').finally(clearPasswords);
  });
  deleteForm.node.addEventListener('submit', event => {
    event.preventDefault(); const user = client.getState().user; if (client.getState().busy || !user) return;
    if (deleteEmail.input.value.trim().toLowerCase() !== String(user.email).toLowerCase()) return invalid('confirm_mismatch', deleteEmail.input);
    const data = { confirm: deleteEmail.input.value.trim() };
    if (deletePassword.input.value) data.currentPassword = deletePassword.input.value;
    void action(() => client.deleteAccount(data), 'auth.deleted').finally(() => { clearPasswords(); deleteEmail.input.value = ''; });
  });
  const unsubscribe = client.subscribe(render);
  async function open(target = null, { reason = null } = {}) {
    closeMenu();
    reasonKey = typeof reason === 'string' && reason ? reason : null;
    if (target && pages[target]) selectPage(target);
    if (!dialog.open) {
      dialog.showModal();
      if (!client.getState().user && !linkAction) (mode === 'register' ? name.input : email.input).focus();
    }
    opener.setAttribute('aria-expanded', 'true');
    await client.refresh(); if (client.getState().user) await client.loadSecurity();
  }
  opener.addEventListener('click', () => { if (client.getState().user && !dialog.open) toggleMenu(); else void open(); });
  dialog.addEventListener('close', () => {
    reasonKey = null; oauthError = null;
    clearPasswords(); clearPhoto(); renderPhoto(client.getState()); opener.setAttribute('aria-expanded', 'false'); pendingRevoke = undefined; confirmationBox.hidden = true;
    // Focus goes back to the launcher (dialog pattern) — the browser would otherwise try the
    // menu item that opened the centre, which is hidden again by now, and land on <body>.
    const returnFocus = () => { if (!standalone && !dialog.open && !menuOpen && document.activeElement !== opener) opener.focus(); };
    returnFocus(); setTimeout(returnFocus, 0); // once more after the browser's own (late) focus restoration
  });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  // Escape belongs to the open dialog or menu before any global shortcut sees it.
  const claimEscape = event => {
    if (event.key !== 'Escape' || !(dialog.open || menuOpen)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (dialog.open) dialog.close(); else closeMenu(true);
  };
  document.addEventListener('keydown', claimEscape, true);
  const onFocus = () => { if (!destroyed && document.visibilityState !== 'hidden') void client.refresh(); };
  window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
  if (broadcast) broadcast.onmessage = event => { if (event.data === 'changed') onFocus(); };
  const interval = setInterval(() => { if (client.getState().user) onFocus(); }, 30000);
  void client.refresh();
  // Návrat od Google/GitHub: …?auth=google | auth=google-linked | auth_error=kód. Značku zmažeme
  // z adresy (glóbus si stav drží v #hash, ten ostáva) a povieme, čo sa stalo.
  (function consumeOAuthMarker() {
    let params;
    try { params = new URLSearchParams(location.search); } catch { return; }
    const done = params.get('auth'); const failed = params.get('auth_error');
    if (!done && !failed) return;
    params.delete('auth'); params.delete('auth_error');
    const query = params.toString();
    try { history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`); } catch { /* adresa ostane */ }
    if (failed && /^[a-z_]{2,40}$/.test(failed)) { oauthError = failed; setMode('login', true); void open(); return; }
    const match = /^(google|github)(-linked)?$/.exec(done || '');
    if (match) notify(t(match[2] ? 'auth.oauth-linked' : 'auth.oauth-signed-in', { provider: providerLabel(match[1]) }));
  })();
  return { client, open, close: () => { if (dialog.open) dialog.close(); }, isOpen: () => dialog.open, destroy() { destroyed = true; clearPhoto(); clearInterval(interval); clearTimeout(timer); unsubscribe(); broadcast?.close(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); document.removeEventListener('keydown', claimEscape, true); document.removeEventListener('pointerdown', onOutside, true); dialog.remove(); menu.remove(); opener.remove(); toast.remove(); if (ownedMount) mount.remove(); } };
}
