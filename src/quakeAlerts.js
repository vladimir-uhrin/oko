// src/quakeAlerts.js
/**
 * @module quakeAlerts
 * @description Odber upozornení na zemetrasenia citeľné na Slovensku (2026-11-06, vlastník: „sprav").
 * Čip „Upozorniť (SK)" vo vrstve Zemetrasenia: prihlásený používateľ si pridá sledovanie `quake:sk`
 * (ten istý zoznam ako lety a lode) a na tomto zariadení sa zapne Web Push (pushNotifications.js),
 * ak ešte nie je. Hosťa pošle na prihlásenie. Posiela strážca na serveri (quakeWatch.js).
 */
import { FOLLOW_MAX, QUAKE_FOLLOW_KEY } from './auth/follows.js';

/**
 * @param {object} o
 * @param {object} o.account centrum účtu (client, open)
 * @param {object|null} [o.push] pushNotifications (status, enable)
 * @param {(k: string, v?: object) => string} o.translate
 * @param {(text: string) => void} [o.notify]
 */
export function createQuakeAlerts({ account, push = null, translate: t, notify = () => {} } = {}) {
  const client = account?.client;
  let on = false; let busy = false; let loadedFor = null;
  const listeners = new Set();
  const user = () => client?.getState?.().user || null;
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* */ } } };

  async function load() {
    const u = user();
    if (!u || !client?.follows) { loadedFor = null; on = false; emit(); return; }
    loadedFor = u.id;
    try {
      const data = await client.follows();
      if (user()?.id === u.id) on = Array.isArray(data?.follows) && data.follows.some((f) => f?.key === QUAKE_FOLLOW_KEY);
    } catch { /* ostane posledný známy stav */ }
    emit();
  }

  /** 'guest' | 'on' | 'off' — pre čip vo vrstve. */
  function status() {
    if (!user()) return 'guest';
    return on ? 'on' : 'off';
  }

  async function toggle() {
    if (busy) return false;
    if (!user()) {
      try { await account?.open?.(null, { reason: 'quake.alerts.login-reason' }); } catch { /* panel je voliteľný */ }
      return false;
    }
    busy = true; emit();
    try {
      if (on) {
        await client.unfollow(QUAKE_FOLLOW_KEY);
        on = false;
        notify(t('quake.alerts.removed'));
      } else {
        await client.follow({ topic: 'quake-sk' });
        on = true;
        // Upozornenia aj so zatvorenou stránkou: zapni push na tomto zariadení, ak ešte nie je.
        const s = push?.status?.();
        if (s === 'off') await push.enable();
        notify(t(s === 'unavailable' || s === 'unsupported' ? 'quake.alerts.added-nopush' : s === 'denied' ? 'quake.alerts.added-denied' : 'quake.alerts.added'));
      }
      return true;
    } catch (error) {
      notify(error?.message === 'follow_limit' ? t('follow.limit', { max: FOLLOW_MAX }) : t('follow.error'));
      return false;
    } finally { busy = false; emit(); }
  }

  client?.subscribe?.((state) => {
    const id = state?.user?.id || null;
    if (id === loadedFor) return;
    void load();
  });
  void load();

  return {
    status,
    toggle,
    isBusy: () => busy,
    /** Poslucháč zmeny stavu (čip prekreslí riadok vrstvy). */
    subscribe(fn) { if (typeof fn !== 'function') return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    reload: load,
  };
}
