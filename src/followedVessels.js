// src/followedVessels.js
/**
 * @module followedVessels
 * @description Sledované lode (2026-10-11, bod 6 zo zoznamu vylepšení: „sledované lode ako
 * sledované lety — upozornenie, keď vypláva alebo pripláva").
 *
 * - Zvonček vedľa krížika na karte lode (živé AIS, AISHub, GFW). Host: klik otvorí prihlásenie
 *   s vetou prečo; po prihlásení sa loď pridá sama (rovnako ako let).
 * - Prihlásený: loď je v tom istom zozname k účtu ako lety (`/api/account/follows`, kľúč
 *   `mmsi:<MMSI>`); v „Hľadať čokoľvek" je navrchu so stavom („na ceste do Wilmington").
 * - Stav: živé AIS (rýchlosť, navigačný stav), keď je loď v dosahu; inak plavba z registra
 *   (/api/vessel-info — odchod z prístavu / príchod do prístavu, server ju drží 10 min).
 * - Lode sú od 2026-10-16 predvolene vypnuté (d421beb), takže vrstva v prehliadači loď zvyčajne
 *   nemá. Živý stav vtedy dá server (/api/ais-live/contact, ten istý zdroj ako Web Push),
 *   najviac raz za 5 min na loď; vrstva lodí sa kvôli tomu nezapína.
 * - Upozornenie (toast) pri prechode „v prístave → na ceste" (vyplávala) a „na ceste →
 *   v prístave" (priplávala). Prvé vyhodnotenie po načítaní je len základ, nič nehlási.
 *
 * Stavy a prechody sú čisté funkcie (testované bez prehliadača).
 */
import { FOLLOW_MAX, isVesselFollowKey, normalizeMmsi, sanitizeFollow } from './auth/follows.js';
import { closeButtonPlacement, closeButtonVisibility, CARD_CLOSE_INSET_PX, CARD_CLOSE_SIZE_PX } from './cardCloseButtons.js';
import { prettyAisDestination, vesselFollowStatus, vesselFollowTransitions } from './data/vesselFollowStatus.js';

export { VESSEL_UNDERWAY_MIN_KN, prettyAisDestination, vesselFollowStatus, vesselFollowTransitions } from './data/vesselFollowStatus.js';

/** Živé AIS sa porovná takto často (ms) — lacné, len pamäť prehliadača. */
export const VESSEL_FOLLOW_POLL_MS = 30_000;
/** Plavba z registra pre jednu loď najskôr po tomto čase (ms) — server ju aj tak drží 10 min. */
export const VESSEL_FOLLOW_REMOTE_MS = 15 * 60_000;
/** Najviac lodí, pre ktoré sa pýtame registra (zvyšok len zo živých dát). */
export const VESSEL_FOLLOW_REMOTE_MAX = 20;
/**
 * Živý kontakt zo servera pre jednu loď najskôr po tomto čase (ms) — 2026-10-16: rovnaký takt ako
 * serverový strážca Web Push (FOLLOW_WATCH_INTERVAL_MS v auth/server/pushWatch.js), nech okno
 * s 20 sledovanými loďami nepýta server každých 30 s.
 */
export const VESSEL_FOLLOW_LIVE_REMOTE_MS = 5 * 60_000;
/** Dopyt na živý kontakt najdlhšie takto (ms) — visiaci server nesmie zastaviť vyhodnotenie (2026-10-16). */
export const VESSEL_FOLLOW_LIVE_TIMEOUT_MS = 10_000;
/** To isté upozornenie pre tú istú loď najskôr po tomto čase (ms). */
export const VESSEL_FOLLOW_NOTIFY_COOLDOWN_MS = 30 * 60_000;
export const VESSEL_FOLLOW_PENDING_KEY = 'oko-follow-vessel-pending';
const PENDING_TTL_MS = 10 * 60_000;

/** Popis do zoznamu: meno lode, inak MMSI. Pure. */
export function vesselFollowLabel(info = {}) {
  const name = String(info.name || '').replace(/\s+/g, ' ').trim();
  return name || normalizeMmsi(info.mmsi) || '';
}

/** Text stavu do palety. Pure. */
export function vesselFollowHint(s, t) {
  if (!s) return t('follow.vessel.status.unknown');
  if (s.status === 'underway') return s.to ? t('follow.vessel.status.underway-to', { port: s.to }) : t('follow.vessel.status.underway');
  if (s.status === 'port') return s.port ? t('follow.vessel.status.port-at', { port: s.port }) : t('follow.vessel.status.port');
  return t(`follow.vessel.status.${s.status}`);
}

function defaultStorage() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

/**
 * Živý kontakt lode z pamäte servera (2026-10-16): GET /api/ais-live/contact?mmsi= → {mmsi, contact|null}
 * (data/shipServer/index.js; bez kľúča, server drží kontakt do zastarania). Lode sú predvolene
 * vypnuté, takže vrstva v prehliadači sledovanú loď zvyčajne nepozná — toto je jej náhrada bez
 * zapnutia vrstvy. null = server loď v dosahu nemá; výpadok, chyba alebo prekročený čas = výnimka
 * (volajúci si nechá posledný známy kontakt, aby stav neskočil na register a neohlásil falošný príchod).
 * @param {string} mmsi
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [o]
 * @returns {Promise<{sog?: number|null, navStatus?: number|null}|null>}
 */
export async function fetchVesselLiveContact(mmsi, { fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = VESSEL_FOLLOW_LIVE_TIMEOUT_MS } = {}) {
  const m = normalizeMmsi(mmsi);
  if (!m || typeof fetchImpl !== 'function') return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { try { ctrl?.abort(); } catch { /* */ } reject(new Error('ais_contact_timeout')); }, timeoutMs);
  });
  try {
    return await Promise.race([expired, (async () => {
      const res = await fetchImpl(`/api/ais-live/contact?mmsi=${m}`, { headers: { Accept: 'application/json' }, signal: ctrl?.signal });
      if (!res?.ok) throw new Error(`ais_contact_${res?.status ?? 'error'}`);
      const data = await res.json();
      return data?.contact && typeof data.contact === 'object' ? data.contact : null;
    })()]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Controller sledovaných lodí.
 * @param {object} o
 * @param {{client: object, open: Function, close?: Function}|null} o.account výstup initAuthPanel()
 * @param {(key: string, vars?: object) => string} o.translate
 * @param {(text: string) => void} [o.notify]
 * @param {(mmsi: string) => ({sog?: number, navStatus?: number}|null)} [o.findLive] loď v dosahu živého AIS
 * @param {((mmsi: string) => Promise<{sog?: number, navStatus?: number}|null>)|null} [o.fetchLive] živý kontakt
 * @param {() => boolean} [o.liveAllowed] smie sa teraz pýtať servera (viditeľná stránka)
 *   zo servera, keď findLive loď nemá (2026-10-16, fetchVesselLiveContact); null = bez servera
 * @param {(mmsi: string) => Promise<object|null>} [o.fetchInfo] /api/vessel-info (plavba z registra)
 * @param {(mmsi: string, label: string) => void} [o.openVessel] klik v palete
 */
export function createFollowedVessels({
  account,
  translate: t,
  notify = () => {},
  findLive = () => null,
  fetchLive = null,
  liveAllowed = () => true,
  fetchInfo = async () => null,
  openVessel = () => {},
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
  now = Date.now,
  storage = defaultStorage(),
} = {}) {
  const client = account?.client || null;
  let follows = [];
  let loadedFor = null;
  let pending = null;
  try {
    const raw = JSON.parse(storage?.getItem(VESSEL_FOLLOW_PENDING_KEY) || 'null');
    const item = sanitizeFollow(raw);
    if (item && isVesselFollowKey(item.key) && Number.isFinite(raw.at) && now() - raw.at <= PENDING_TTL_MS) pending = { mmsi: item.mmsi, label: item.label, at: raw.at };
  } catch { pending = null; }
  const savePending = (value) => {
    pending = value;
    try {
      if (value) storage?.setItem(VESSEL_FOLLOW_PENDING_KEY, JSON.stringify(value));
      else storage?.removeItem(VESSEL_FOLLOW_PENDING_KEY);
    } catch { /* */ }
  };
  const infos = new Map(); // mmsi → {info, at}
  const inflight = new Map(); // mmsi → prebiehajúci dopyt do registra
  const liveRemote = new Map(); // mmsi → {contact, at} živý kontakt zo servera (2026-10-16)
  const liveInflight = new Map(); // mmsi → prebiehajúci dopyt na /api/ais-live/contact
  // Vyhodnotenia sa uplatnia v poradí volania (2026-10-16): dopyty bežia hneď a súbežne, ale
  // porovnanie so stavom a toasty idú za sebou — pomalší server pri skoršom vyhodnotení nesmie
  // prehodiť poradie upozornení ani prepísať novší stav starším.
  let applyTurn = Promise.resolve();
  const lastStatus = new Map(); // key → status
  let prevStatus = null;
  const lastNotified = new Map();
  let poll = null;
  let busy = false;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(); } catch { /* */ } } };
  const user = () => client?.getState?.().user || null;

  function setFollows(list) {
    follows = Array.isArray(list) ? list.filter((f) => f && isVesselFollowKey(f.key)) : [];
    syncPoll();
    emit();
  }

  function syncPoll() {
    const want = Boolean(user()) && follows.length > 0;
    if (want && poll === null) { poll = setIntervalImpl(() => { void evaluate(); }, VESSEL_FOLLOW_POLL_MS); void evaluate({ baseline: true }); }
    if (!want && poll !== null) { clearIntervalImpl(poll); poll = null; prevStatus = null; }
  }

  async function refreshRemote() {
    const time = now();
    const due = follows.slice(0, VESSEL_FOLLOW_REMOTE_MAX)
      .map((f) => f.key.slice(5))
      .filter((mmsi) => !inflight.has(mmsi) && time - (infos.get(mmsi)?.at ?? -Infinity) >= VESSEL_FOLLOW_REMOTE_MS);
    // Dve vyhodnotenia naraz (pridanie + základ) sa nepýtajú registra dvakrát — druhé počká na prvé.
    const waiting = follows.slice(0, VESSEL_FOLLOW_REMOTE_MAX).map((f) => inflight.get(f.key.slice(5))).filter(Boolean);
    const jobs = due.map((mmsi) => {
      const job = (async () => {
        try {
          const info = await fetchInfo(mmsi);
          if (info) infos.set(mmsi, { info, at: time });
          else if (!infos.has(mmsi)) infos.set(mmsi, { info: null, at: time });
        } catch { /* ďalší pokus o 15 min */ } finally { inflight.delete(mmsi); }
      })();
      inflight.set(mmsi, job);
      return job;
    });
    await Promise.all([...waiting, ...jobs]);
  }

  const readLive = (mmsi) => { try { return findLive(mmsi) || null; } catch { return null; } };

  /**
   * Živý kontakt zo servera pre lode, ktoré vrstva v prehliadači nemá (2026-10-16, lode predvolene
   * vypnuté). Na loď najviac raz za VESSEL_FOLLOW_LIVE_REMOTE_MS a len pre prvých
   * VESSEL_FOLLOW_REMOTE_MAX sledovaných — rovnaký strop ako register.
   */
  async function refreshLive(missing, capped) {
    // Len pri viditeľnej stránke (2026-10-16): každý dopyt z prehliadača server berie ako návštevníka
    // (supplements.markVisitor) — skrytá záložka by inak držala zdroje lodí navyše na plný takt
    // nonstop; skrytá stránka toasty aj tak neukáže a sledovanie vtedy rieši Web Push.
    if (typeof fetchLive !== 'function' || !liveAllowed()) return;
    // Loď mimo stropu (alebo už nesledovaná) si starý kontakt nenechá — inak by ho používala navždy.
    for (const mmsi of liveRemote.keys()) if (!capped.has(mmsi)) liveRemote.delete(mmsi);
    const time = now();
    const due = missing.filter((mmsi) => !liveInflight.has(mmsi) && time - (liveRemote.get(mmsi)?.at ?? -Infinity) >= VESSEL_FOLLOW_LIVE_REMOTE_MS);
    const waiting = missing.map((mmsi) => liveInflight.get(mmsi)).filter(Boolean);
    const jobs = due.map((mmsi) => {
      const job = (async () => {
        try {
          const contact = await fetchLive(mmsi);
          liveRemote.set(mmsi, { contact: contact || null, at: time });
        } catch {
          // Výpadok servera: posledný kontakt ostáva (stav neskočí na starý register → falošný toast),
          // ďalší pokus až o 5 min — aj chyba sa ráta do taktu, nech nepadajú dopyty každých 30 s.
          liveRemote.set(mmsi, { contact: liveRemote.get(mmsi)?.contact || null, at: time });
        } finally { liveInflight.delete(mmsi); }
      })();
      liveInflight.set(mmsi, job);
      return job;
    });
    await Promise.all([...waiting, ...jobs]);
  }

  /** Porovná zoznam so živými dátami a registrom, ohlási vyplávanie/priplávanie. */
  async function evaluate({ baseline = false } = {}) {
    if (!follows.length) return;
    // 2026-10-16: lode sú predvolene vypnuté → findLive býva null. Ktoré lode treba doplniť zo
    // servera, sa rozhodne pred dopytmi; loď, ktorú vrstva má, sa servera nepýta vôbec.
    const capped = new Set(follows.slice(0, VESSEL_FOLLOW_REMOTE_MAX).map((f) => f.key.slice(5)));
    const localBefore = new Map(follows.map((f) => [f.key.slice(5), readLive(f.key.slice(5))]));
    const missing = [...capped].filter((mmsi) => !localBefore.get(mmsi));
    // Register a server súbežne (nie loď po lodi); uplatnenie počká na predošlé vyhodnotenie.
    const ready = Promise.all([refreshRemote(), refreshLive(missing, capped)]);
    const turn = applyTurn.then(() => ready).then(() => apply(baseline, localBefore, capped));
    applyTurn = turn.catch(() => {});
    await turn;
  }

  function apply(baseline, localBefore, capped) {
    const next = new Map();
    for (const f of follows) {
      const mmsi = f.key.slice(5);
      // Vrstva má prednosť (čerstvejšia), potom to, čo mala pred dopytmi (vypnutá medzitým), potom server.
      const remote = capped.has(mmsi) ? liveRemote.get(mmsi)?.contact || null : null;
      const live = readLive(mmsi) || localBefore.get(mmsi) || remote;
      const s = vesselFollowStatus(live, infos.get(mmsi)?.info || null);
      next.set(f.key, s);
      lastStatus.set(f.key, s);
    }
    const before = baseline ? null : prevStatus;
    const events = vesselFollowTransitions(before, next);
    prevStatus = next;
    const time = now();
    for (const ev of events) {
      const entry = follows.find((f) => f.key === ev.key);
      const tag = `${ev.key}:${ev.type}`;
      if (!entry || time - (lastNotified.get(tag) ?? -Infinity) < VESSEL_FOLLOW_NOTIFY_COOLDOWN_MS) continue;
      lastNotified.set(tag, time);
      const s = next.get(ev.key);
      const label = entry.label || ev.key.slice(5);
      // Vyplávala odkiaľ: prístav z predošlého stavu (register ešte môže hlásiť „v prístave").
      const from = before?.get(ev.key)?.port || s.port;
      if (ev.type === 'departed') notify(from ? t('follow.vessel.departed-from', { label, port: from }) : t('follow.vessel.departed', { label }));
      else notify(s.port ? t('follow.vessel.arrived-at', { label, port: s.port }) : t('follow.vessel.arrived', { label }));
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
    } catch { /* */ }
  }

  async function add(vessel) {
    const item = sanitizeFollow({ mmsi: vessel.mmsi, label: vessel.label });
    if (!item || !client?.follow) return false;
    busy = true; emit();
    try {
      const data = await client.follow({ mmsi: item.mmsi, label: item.label });
      setFollows(data?.follows);
      // Stav novej lode hneď (nie až o 30 s „poloha neznáma"); nová loď nemá predošlý stav → bez toastu.
      void evaluate();
      notify(t('follow.vessel.added', { label: item.label }));
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
      notify(t('follow.removed', { label: entry.label || key.slice(5) }));
      return true;
    } catch {
      notify(t('follow.error'));
      return false;
    } finally { busy = false; emit(); }
  }

  const entryFor = (mmsi) => {
    const m = normalizeMmsi(mmsi);
    return m ? follows.find((f) => f.key === `mmsi:${m}`) || null : null;
  };

  /** Klik na zvonček. Host → prihlásenie, loď počká; prihlásený → pridať/odobrať. */
  async function toggle({ mmsi, name } = {}) {
    const m = normalizeMmsi(mmsi);
    if (busy || !m) return false;
    const vessel = { mmsi: m, label: vesselFollowLabel({ mmsi: m, name }) };
    if (!user()) {
      savePending({ ...vessel, at: now() });
      try { await account?.open?.(null, { reason: 'follow.vessel.login-reason' }); } catch { /* */ }
      return false;
    }
    const existing = entryFor(m);
    return existing ? remove(existing.key) : add(vessel);
  }

  const unsubscribe = client?.subscribe?.((state) => {
    const id = state?.user?.id || null;
    if (id === loadedFor) return;
    if (!id) { loadedFor = null; savePending(null); setFollows([]); return; }
    void load().then(async () => {
      if (!pending || user()?.id !== id) return;
      const vessel = pending;
      savePending(null);
      if (now() - vessel.at > PENDING_TTL_MS) return;
      try { account?.close?.(); } catch { /* */ }
      if (!entryFor(vessel.mmsi)) await add(vessel);
    });
  }) || null;

  /** Položky do „Hľadať čokoľvek": navrchu v skupine sledovaných, klik = ukáž loď. */
  function commands() {
    if (!user()) return [];
    return follows.map((f) => {
      const mmsi = f.key.slice(5);
      const label = f.label || mmsi;
      return {
        id: `follow:${f.key}`,
        label,
        hint: vesselFollowHint(lastStatus.get(f.key), t),
        group: 'follows',
        keywords: [mmsi, 'sledovan', 'follow', 'loď', 'lod', 'ship'],
        run: () => { try { openVessel(mmsi, label); } catch { /* */ } },
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
    statusFor: (mmsi) => lastStatus.get(`mmsi:${normalizeMmsi(mmsi)}`) || null,
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

/** Zvonček sedí vľavo od krížika, v tej istej výške. Pure. */
export function followBellPlacement(rect, viewport = null) {
  const close = closeButtonPlacement(rect, CARD_CLOSE_SIZE_PX, CARD_CLOSE_INSET_PX, viewport);
  return { x: Math.max(CARD_CLOSE_INSET_PX, close.x - CARD_CLOSE_SIZE_PX - 6), y: close.y };
}

/**
 * Zvonček SLEDOVAŤ na kartách lodí (rovnaký kruh ako krížik, vedľa neho).
 * @param {object} viewer Cesium viewer (postRender)
 * @param {object} o
 * @param {HTMLElement} o.container
 * @param {ReturnType<typeof createFollowedVessels>} o.followed
 * @param {Array<{id: string, active: () => ({sourceId: string, entryId: string, mmsi: string, name?: string}|null)}>} o.providers
 * @param {(key: string, vars?: object) => string} o.translate
 * @param {Function} o.paintRect getOverlayPaintRect
 * @param {(card: {mmsi: string, name?: string}) => void} [o.onHistory] tlačidlo História lode (bod 7)
 */
export function installVesselFollowButtons(viewer, { container, followed, providers, translate: t, paintRect, onHistory = null, onShare = null }) {
  const doc = container.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'card-close card-follow';
  button.hidden = true;
  const icon = doc.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  container.appendChild(button);
  // História lode vľavo od zvončeka (2026-10-11, bod 7).
  // Zdieľanie lode (2026-10-11, bod 6): odkaz nesie vybranú loď (subj=ais-live-vessels.s.<MMSI>).
  const share = onShare ? doc.createElement('button') : null;
  if (share) {
    share.type = 'button';
    share.className = 'card-close card-share';
    share.hidden = true;
    share.title = t('vessel.share');
    share.setAttribute('aria-label', t('vessel.share'));
    const sIcon = doc.createElement('span');
    sIcon.className = 'material-symbols-outlined';
    sIcon.setAttribute('aria-hidden', 'true');
    sIcon.textContent = 'share';
    share.appendChild(sIcon);
    container.appendChild(share);
  }
  const history = onHistory ? doc.createElement('button') : null;
  if (history) {
    history.type = 'button';
    history.className = 'card-close card-history';
    history.hidden = true;
    history.title = t('shiphistory.open');
    history.setAttribute('aria-label', t('shiphistory.open'));
    const hIcon = doc.createElement('span');
    hIcon.className = 'material-symbols-outlined';
    hIcon.setAttribute('aria-hidden', 'true');
    hIcon.textContent = 'history';
    history.appendChild(hIcon);
    container.appendChild(history);
  }
  let current = null;
  let signature = '';

  function activeCard() {
    for (const p of providers) {
      let card = null;
      try { card = p.active(); } catch { card = null; }
      if (card?.mmsi && normalizeMmsi(card.mmsi)) return card;
    }
    return null;
  }

  function sync() {
    const card = activeCard();
    const visible = card ? closeButtonVisibility(paintRect(card.sourceId, card.entryId)) : null;
    current = visible ? card : null;
    if (!visible) {
      if (!button.hidden) button.hidden = true;
      if (history && !history.hidden) history.hidden = true;
      if (share && !share.hidden) share.hidden = true;
      return;
    }
    const view = doc.defaultView;
    const { x, y } = followBellPlacement(visible, { w: view?.innerWidth || 0, h: view?.innerHeight || 0 });
    if (button.hidden) button.hidden = false;
    button.style.opacity = String(visible.opacity);
    button.style.transform = `translate(${x}px, ${y}px)`;
    if (history) {
      if (history.hidden) history.hidden = false;
      history.style.opacity = String(visible.opacity);
      history.style.transform = `translate(${Math.max(CARD_CLOSE_INSET_PX, x - CARD_CLOSE_SIZE_PX - 6)}px, ${y}px)`;
    }
    if (share) {
      if (share.hidden) share.hidden = false;
      share.style.opacity = String(visible.opacity);
      share.style.transform = `translate(${Math.max(CARD_CLOSE_INSET_PX, x - 2 * (CARD_CLOSE_SIZE_PX + 6))}px, ${y}px)`;
    }
    const on = Boolean(followed.entryFor(card.mmsi));
    const signedIn = followed.isSignedIn();
    const label = vesselFollowLabel(card);
    const sig = `${card.mmsi}|${on}|${signedIn}|${followed.isBusy()}|${label}`;
    if (sig === signature) return;
    signature = sig;
    icon.textContent = on ? 'notifications_active' : signedIn ? 'notification_add' : 'lock';
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.dataset.guest = String(!signedIn);
    button.setAttribute('aria-busy', followed.isBusy() ? 'true' : 'false');
    const title = !signedIn ? t('follow.vessel.title-guest') : on ? t('follow.title-remove', { label }) : t('follow.vessel.title-add', { label });
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  const onClick = (event) => {
    event?.stopPropagation?.();
    if (current) void followed.toggle({ mmsi: current.mmsi, name: current.name });
  };
  button.addEventListener('click', onClick);
  const onHistoryClick = (event) => {
    event?.stopPropagation?.();
    if (current) { const card = { mmsi: current.mmsi, name: current.name }; history.hidden = true; onHistory(card); }
  };
  history?.addEventListener('click', onHistoryClick);
  const onShareClick = (event) => { event?.stopPropagation?.(); if (current) { try { onShare({ mmsi: current.mmsi, name: current.name }); } catch { /* */ } } };
  share?.addEventListener('click', onShareClick);
  const unsubscribe = followed.subscribe(() => { signature = ''; sync(); });
  const postRender = viewer?.scene?.postRender;
  postRender?.addEventListener?.(sync);
  sync();
  return {
    element: button,
    sync,
    destroy() {
      unsubscribe();
      postRender?.removeEventListener?.(sync);
      button.removeEventListener('click', onClick);
      button.remove();
      history?.remove();
      share?.remove();
    },
  };
}
