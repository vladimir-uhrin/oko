// src/followedFlights.js
/**
 * @module followedFlights
 * @description Sledované lety (2026-09-27, vlastník: „pridaj možnosť aj sledovanie letov, ale
 * len pre prihlásených na kartičku; aj pre neprihlásených, ale presmeruj ich na prihlásenie").
 *
 * - Tlačidlo SLEDOVAŤ pri sledovanom (kliknutom) lietadle, nad tlačidlom KOKPIT.
 * - Host: klik otvorí prihlásenie s vetou prečo; po prihlásení sa vybraný let pridá sám.
 * - Prihlásený: zoznam je uložený k účtu na serveri (/api/account/follows) — rovnaký na
 *   každom zariadení; v „Hľadať čokoľvek" je navrchu skupina Sledované lety s aktuálnym stavom.
 * - Upozornenie (toast), keď sledovaný let vzlietne / pristane alebo sa v tejto relácii prvý
 *   raz objaví vo vzduchu. Stav je LEN z toho, čo práve tečie v živých dátach — mimo pokrytia
 *   feedu let „teraz nie je v živých dátach", nič sa nedomýšľa ani nedopytuje navyše.
 *
 * Skladanie stavov a prechodov sú čisté funkcie (testované bez prehliadača); controller drží
 * zoznam, čaká na prihlásenie a raz za FOLLOW_POLL_MS porovná zoznam so živými kontaktmi.
 */
import { FOLLOW_MAX, followKey, followMatches, normalizeCallsign, normalizeHex, sanitizeFollow } from './auth/follows.js';

/** Ako často sa sledované lety porovnajú so živými dátami (ms). */
export const FOLLOW_POLL_MS = 15_000;
/** To isté upozornenie pre ten istý let najskôr po tomto čase (ms) — proti blikaniu na hrane pokrytia. */
export const FOLLOW_NOTIFY_COOLDOWN_MS = 10 * 60_000;
/** Let, ktorý host chcel sledovať, sa po prihlásení pridá len v tomto okne (ms) — nie o hodinu neskôr. */
export const FOLLOW_PENDING_TTL_MS = 10 * 60_000;
/**
 * Čakajúci let prežije aj presmerovanie na Google/GitHub a späť (2026-09-27): sessionStorage
 * tejto karty prehliadača — len identifikátor letu a čas, nič o používateľovi.
 */
export const FOLLOW_PENDING_STORAGE_KEY = 'oko-follow-pending';

function defaultStorage() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

/** Načíta čakajúci let zo storage (validovaný, v okne TTL), inak null. */
export function readPendingFollow(storage, nowMs) {
  let raw = null;
  try { raw = storage?.getItem(FOLLOW_PENDING_STORAGE_KEY) ?? null; } catch { return null; }
  if (!raw) return null;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const item = sanitizeFollow(parsed);
  if (!item || !Number.isFinite(parsed?.at) || nowMs - parsed.at > FOLLOW_PENDING_TTL_MS || parsed.at > nowMs + 60_000) return null;
  return { hex: item.hex, callsign: item.callsign, label: item.label, at: parsed.at };
}

/**
 * Popis letu do zoznamu: „AUA40H · BCN → VIE", inak registrácia alebo hex.
 * @param {{callsign?: string, registration?: string, icao24?: string, hex?: string, route?: object, origin?: string, destination?: string}} info
 */
export function followLabelFor(info = {}) {
  const cs = normalizeCallsign(info.callsign);
  const head = cs || String(info.registration || '').trim() || normalizeHex(info.icao24 || info.hex) || '';
  const origin = info.route?.origin?.code || info.origin || '';
  const destination = info.route?.destination?.code || info.destination || '';
  return origin && destination ? `${head} · ${origin} → ${destination}` : head;
}

/**
 * Stav sledovaného záznamu voči živým kontaktom (čistá funkcia).
 * @param {{key: string}} entry
 * @param {Array<{hex: string, callsign: string|null, onGround: boolean, altitudeM: number|null}>} contacts
 * @returns {{status: 'air'|'ground'|'offline', contact: object|null}}
 */
export function followStatus(entry, contacts) {
  const contact = (contacts || []).find((c) => followMatches(entry, c)) || null;
  if (!contact) return { status: 'offline', contact: null };
  return { status: contact.onGround ? 'ground' : 'air', contact };
}

/**
 * Udalosti na upozornenie z predošlého a nového stavu (čistá funkcia).
 * - ground → air = vzlietol; air → ground = pristál;
 * - prvý raz v relácii vo vzduchu (predtým nevidený/offline) = je vo vzduchu.
 * Prvé vyhodnotenie po načítaní zoznamu nič nehlási (baseline), inak by prihlásenie zasypalo toastami.
 * @param {Map<string, string>|null} prev kľúč → status (null = baseline)
 * @param {Map<string, string>} next
 * @param {Set<string>} seenAirborne kľúče už ohlásené ako vo vzduchu v tejto relácii (mení sa)
 * @returns {Array<{key: string, type: 'airborne'|'landed'}>}
 */
export function followTransitions(prev, next, seenAirborne = new Set()) {
  const events = [];
  for (const [key, status] of next) {
    if (status === 'air') {
      const before = prev ? prev.get(key) : 'baseline';
      if (before === 'ground' || (prev && before !== 'air' && !seenAirborne.has(key))) events.push({ key, type: 'airborne' });
      seenAirborne.add(key);
    } else if (status === 'ground' && prev?.get(key) === 'air') {
      events.push({ key, type: 'landed' });
    }
  }
  return events;
}

/**
 * Controller sledovaných letov.
 * @param {object} o
 * @param {{client: object, open: Function, close?: Function}|null} o.account výstup initAuthPanel()
 * @param {(key: string, vars?: object) => string} o.translate
 * @param {(text: string) => void} [o.notify] toast
 * @param {(identity: {hexes: Set<string>, callsigns: Set<string>}) => Array} [o.findContacts]
 * @param {(hex: string) => boolean} [o.trackContact]
 */
export function createFollowedFlights({
  account,
  translate: t,
  notify = () => {},
  findContacts = () => [],
  trackContact = () => false,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
  now = Date.now,
  storage = defaultStorage(),
} = {}) {
  const client = account?.client || null;
  let follows = [];
  let loadedFor = null; // id používateľa, pre ktorého je zoznam načítaný
  // let, ktorý host chcel sledovať pred prihlásením (aj po návrate z Google/GitHub)
  let pending = readPendingFollow(storage, now());
  const savePending = (value) => {
    pending = value;
    try {
      if (value) storage?.setItem(FOLLOW_PENDING_STORAGE_KEY, JSON.stringify(value));
      else storage?.removeItem(FOLLOW_PENDING_STORAGE_KEY);
    } catch { /* bez storage platí len v pamäti */ }
  };
  let prevStatus = null;
  const lastStatus = new Map();
  const seenAirborne = new Set();
  const lastNotified = new Map();
  let poll = null;
  let busy = false;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(); } catch { /* poslucháč nezhodí zoznam */ } } };

  const user = () => client?.getState?.().user || null;

  function setFollows(list) {
    follows = Array.isArray(list) ? list.filter((f) => f && typeof f.key === 'string') : [];
    syncPoll();
    emit();
  }

  function syncPoll() {
    const want = Boolean(user()) && follows.length > 0;
    if (want && poll === null) { poll = setIntervalImpl(() => evaluate(), FOLLOW_POLL_MS); evaluate({ baseline: true }); }
    if (!want && poll !== null) { clearIntervalImpl(poll); poll = null; prevStatus = null; }
  }

  function identity() {
    const hexes = new Set();
    const callsigns = new Set();
    for (const f of follows) {
      if (f.key.startsWith('cs:')) callsigns.add(f.key.slice(3));
      else hexes.add(f.key.slice(4));
    }
    return { hexes, callsigns };
  }

  /** Porovná zoznam so živými dátami, uloží stav pre paletu a ohlási prechody. */
  function evaluate({ baseline = false } = {}) {
    if (!follows.length) return;
    let contacts = [];
    try { contacts = findContacts(identity()) || []; } catch { contacts = []; }
    const next = new Map();
    for (const f of follows) {
      const s = followStatus(f, contacts);
      next.set(f.key, s.status);
      lastStatus.set(f.key, s);
    }
    const events = followTransitions(baseline ? null : prevStatus, next, seenAirborne);
    prevStatus = next;
    const time = now();
    for (const ev of events) {
      const entry = follows.find((f) => f.key === ev.key);
      const tag = `${ev.key}:${ev.type}`;
      if (!entry || time - (lastNotified.get(tag) ?? -Infinity) < FOLLOW_NOTIFY_COOLDOWN_MS) continue;
      lastNotified.set(tag, time);
      notify(t(ev.type === 'landed' ? 'follow.landed' : 'follow.airborne', { label: entry.label || entry.key.split(':')[1] }));
    }
    emit();
  }

  async function load() {
    const u = user();
    if (!u || !client?.follows) { loadedFor = null; setFollows([]); return; }
    loadedFor = u.id;
    try {
      const data = await client.follows();
      if (user()?.id === u.id) setFollows(data?.follows);
    } catch { /* zoznam ostane, ďalší pokus pri zmene účtu alebo akcii */ }
  }

  async function add(flight) {
    const item = sanitizeFollow(flight);
    if (!item || !client?.follow) return false;
    busy = true; emit();
    try {
      const data = await client.follow({ hex: item.hex, callsign: item.callsign, label: item.label });
      setFollows(data?.follows);
      notify(t('follow.added', { label: item.label }));
      return true;
    } catch (error) {
      notify(error?.message === 'follow_limit' ? t('follow.limit', { max: FOLLOW_MAX }) : t('follow.error'));
      return false;
    } finally { busy = false; emit(); }
  }

  async function remove(key) {
    const entry = follows.find((f) => f.key === key);
    if (!entry || !client?.unfollow) return false;
    busy = true; emit();
    try {
      const data = await client.unfollow(key);
      setFollows(data?.follows);
      lastStatus.delete(key);
      notify(t('follow.removed', { label: entry.label || key.split(':')[1] }));
      return true;
    } catch {
      notify(t('follow.error'));
      return false;
    } finally { busy = false; emit(); }
  }

  /** Záznam pre daný kontakt (sledovaný let alebo stroj), alebo null. */
  function entryFor(contact) {
    if (!contact) return null;
    const probe = { hex: contact.hex ?? contact.icao24, callsign: contact.callsign };
    return follows.find((f) => followMatches(f, probe)) || null;
  }

  /**
   * Klik na SLEDOVAŤ. Host → prihlásenie s dôvodom, let počká; prihlásený → pridať/odobrať.
   * @param {{icao24?: string, hex?: string, callsign?: string, registration?: string, route?: object}} contact
   */
  async function toggle(contact) {
    if (busy || !contact) return false;
    const flight = { hex: contact.hex ?? contact.icao24, callsign: contact.callsign, label: followLabelFor(contact) };
    if (!followKey(flight)) return false;
    if (!user()) {
      savePending({ ...flight, at: now() });
      try { await account?.open?.(null, { reason: 'follow.login-reason' }); } catch { /* panel je voliteľný */ }
      return false;
    }
    const existing = entryFor(contact);
    return existing ? remove(existing.key) : add(flight);
  }

  // Zmena účtu: prihlásenie načíta zoznam (a dokončí čakajúci let), odhlásenie ho vyprázdni.
  const unsubscribe = client?.subscribe?.((state) => {
    const id = state?.user?.id || null;
    if (id === loadedFor) return;
    // odhlásenie (hosť → hosť sa odfiltruje vyššie, čakajúci let z presmerovania ostáva)
    if (!id) { loadedFor = null; savePending(null); setFollows([]); return; }
    void load().then(async () => {
      if (!pending || user()?.id !== id) return;
      const flight = pending;
      savePending(null);
      if (now() - flight.at > FOLLOW_PENDING_TTL_MS) return;
      try { account?.close?.(); } catch { /* */ }
      if (!entryFor({ hex: flight.hex, callsign: flight.callsign })) await add(flight);
    });
  }) || null;

  /** Položky do „Hľadať čokoľvek": skupina Sledované lety, klik = priletieť k lietadlu. */
  function commands() {
    if (!user()) return [];
    return follows.map((f) => {
      const s = lastStatus.get(f.key) || { status: 'offline', contact: null };
      const label = f.label || f.key.split(':')[1];
      return {
        id: `follow:${f.key}`,
        label,
        hint: t(`follow.status.${s.status}`),
        group: 'follows',
        keywords: [f.callsign || '', f.hex || '', 'sledovan', 'follow'],
        run: () => {
          const hex = s.contact?.hex;
          if (!hex || !trackContact(hex)) notify(t('follow.not-live', { label }));
        },
      };
    });
  }

  return {
    getFollows: () => follows.slice(),
    isBusy: () => busy,
    isSignedIn: () => Boolean(user()),
    entryFor,
    toggle,
    commands,
    evaluate,
    hasPending: () => Boolean(pending),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() {
      unsubscribe?.();
      if (poll !== null) clearIntervalImpl(poll);
      poll = null;
      listeners.clear();
    },
  };
}

/**
 * Tlačidlo SLEDOVAŤ pri sledovanom lietadle (nad KOKPIT, viditeľné spolu s ním).
 * @param {object} o
 * @param {Document} o.doc
 * @param {ReturnType<typeof createFollowedFlights>} o.followed
 * @param {() => object|null} o.getTracked opis sledovaného civilného lietadla (flights.getTrackedInfo)
 * @param {(key: string, vars?: object) => string} o.translate
 * @returns {{sync: () => void, element: HTMLButtonElement, destroy: () => void}}
 */
export function installFollowButton({ doc, followed, getTracked, translate: t }) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'follow-flight';
  button.hidden = true;
  const icon = doc.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  const text = doc.createElement('span');
  button.append(icon, text);
  const entry = doc.getElementById('cockpit-entry');
  if (entry?.parentNode) entry.parentNode.insertBefore(button, entry.nextSibling);
  else doc.body.append(button);

  let signature = '';
  function sync() {
    let info = null;
    try { info = getTracked() || null; } catch { info = null; }
    // Viditeľné presne vtedy, keď KOKPIT (sledované lietadlo, mimo kokpitu) a stroj má identitu.
    const visible = Boolean(info && entry && !entry.hidden && followKey({ hex: info.icao24, callsign: info.callsign }));
    const current = visible ? followed.entryFor(info) : null;
    const signedIn = followed.isSignedIn();
    const label = visible ? followLabelFor(info) : '';
    const sig = `${visible}|${Boolean(current)}|${signedIn}|${followed.isBusy()}|${label}`;
    if (sig === signature) return;
    signature = sig;
    button.hidden = !visible;
    if (!visible) return;
    button.setAttribute('aria-pressed', current ? 'true' : 'false');
    button.dataset.guest = String(!signedIn);
    button.setAttribute('aria-busy', followed.isBusy() ? 'true' : 'false');
    icon.textContent = current ? 'notifications_active' : signedIn ? 'notification_add' : 'lock';
    text.textContent = t(current ? 'follow.button-on' : 'follow.button');
    button.title = !signedIn ? t('follow.title-guest') : current ? t('follow.title-remove', { label }) : t('follow.title-add', { label });
  }
  const onClick = () => {
    let info = null;
    try { info = getTracked() || null; } catch { info = null; }
    if (info) void followed.toggle(info);
  };
  button.addEventListener('click', onClick);
  const unsubscribe = followed.subscribe(() => { signature = ''; sync(); });
  // KOKPIT sa ukazuje/skrýva v CockpitViewController.syncEntry — zrkadlíme jeho `hidden`.
  const observer = entry && typeof MutationObserver === 'function'
    ? new MutationObserver(() => sync())
    : null;
  observer?.observe(entry, { attributes: true, attributeFilter: ['hidden'] });
  sync();
  return {
    element: button,
    sync,
    destroy() { unsubscribe(); observer?.disconnect(); button.removeEventListener('click', onClick); button.remove(); },
  };
}
