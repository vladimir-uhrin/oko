// src/pushNotifications.js
/**
 * @module pushNotifications
 * @description Upozornenia na sledované lode aj so zatvorenou stránkou (2026-10-11, bod 2 zo
 * zoznamu vylepšení). Prehliadač sa prihlási na Web Push (service worker public/sw-push.js,
 * verejný VAPID kľúč z /api/account/push), predplatné sa uloží k účtu; server (pushWatch.js)
 * posiela „vyplávala / priplávala". Len pre prihlásených; bez kľúčov na serveri sa ponuka neukáže.
 */

export const PUSH_SW_URL = '/sw-push.js';

/** Podporuje prehliadač Web Push? Pure nad oknom. */
export function pushSupported(win = globalThis) {
  return Boolean(win?.navigator?.serviceWorker && win?.PushManager && win?.Notification);
}

/** base64url (VAPID verejný kľúč) → Uint8Array pre pushManager.subscribe. Pure. */
export function urlBase64ToUint8Array(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = globalThis.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * @param {object} o
 * @param {object} o.client auth klient (push, pushSubscribe, pushUnsubscribe, getState, subscribe)
 * @param {(k: string, v?: object) => string} o.translate
 * @param {(text: string) => void} [o.notify]
 * @param {object} [o.win]
 */
export function createPushNotifications({ client, translate: t, notify = () => {}, win = globalThis, swUrl = PUSH_SW_URL } = {}) {
  let server = null; // {enabled, publicKey, subscriptions}
  let endpoint = null; // predplatné tohto prehliadača
  let busy = false;
  const user = () => client?.getState?.().user || null;

  async function localSubscription() {
    try {
      const reg = await win.navigator.serviceWorker.getRegistration(swUrl);
      return (await reg?.pushManager?.getSubscription()) || null;
    } catch { return null; }
  }

  async function refresh() {
    if (!pushSupported(win) || !user() || !client?.push) { server = null; endpoint = null; return; }
    try { server = await client.push(); } catch { server = null; }
    endpoint = (await localSubscription())?.endpoint || null;
  }

  /** 'unsupported' | 'guest' | 'unavailable' | 'denied' | 'on' | 'off' */
  function status() {
    if (!pushSupported(win)) return 'unsupported';
    if (!user()) return 'guest';
    if (!server?.enabled || !server.publicKey) return 'unavailable';
    if (win.Notification.permission === 'denied') return 'denied';
    return endpoint ? 'on' : 'off';
  }

  async function enable() {
    if (busy || status() !== 'off') return false;
    busy = true;
    try {
      const permission = await win.Notification.requestPermission();
      if (permission !== 'granted') { notify(t('push.denied')); return false; }
      const reg = await win.navigator.serviceWorker.register(swUrl);
      const sub = (await reg.pushManager.getSubscription())
        || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(server.publicKey) }));
      await client.pushSubscribe(sub.toJSON());
      endpoint = sub.endpoint;
      notify(t('push.enabled'));
      return true;
    } catch {
      notify(t('push.failed'));
      return false;
    } finally { busy = false; }
  }

  async function disable() {
    if (busy || status() !== 'on') return false;
    busy = true;
    try {
      const sub = await localSubscription();
      if (sub) {
        try { await client.pushUnsubscribe(sub.endpoint); } catch { /* server už nemusí mať */ }
        try { await sub.unsubscribe(); } catch { /* */ }
      }
      endpoint = null;
      notify(t('push.disabled'));
      return true;
    } finally { busy = false; }
  }

  /** Položka do „Hľadať čokoľvek" (skupina sledovaných), alebo null, keď nemá zmysel. */
  function command() {
    const s = status();
    if (s === 'unsupported' || s === 'guest' || s === 'unavailable') return null;
    return {
      id: 'push:toggle',
      label: t('cmd.push'),
      hint: t(s === 'on' ? 'cmd.push.off' : s === 'denied' ? 'cmd.push.denied' : 'cmd.push.on'),
      group: 'follows',
      keywords: ['push', 'upozorn', 'notif', 'sledovan', 'lode'],
      run: () => { void (s === 'on' ? disable() : enable()); },
    };
  }

  client?.subscribe?.(() => { void refresh(); });
  void refresh();

  return { status, enable, disable, command, refresh, isBusy: () => busy };
}
