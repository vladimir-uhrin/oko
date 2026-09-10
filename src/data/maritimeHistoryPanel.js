import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { announceNavigationAuthority } from '../navigationPolicy.js';

export const MARITIME_HISTORY_IDS = Object.freeze([
  'local-shipping-lanes', 'local-ports', 'local-ship-density',
]);

export function focusMaritimeRegion(viewer, body = globalThis.document?.body) {
  if (!viewer?.camera || viewer.trackedEntity || body?.classList?.contains('cockpit-mode')) {
    throw new Error(t('maritime.focus-unavailable'));
  }
  announceNavigationAuthority('maritime-history-region');
  viewer.camera.cancelFlight?.();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(54, 26, 3_000_000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }, duration: 1.5,
  });
}

/** A reversible, session-only convenience action over existing layers. */
export function createMaritimeHistorySession(manager) {
  const owned = new Set();
  const token = {};
  const abort = new AbortController();
  let mapStackBefore = null;
  let mapStackOwned = false;
  let busy = false;
  const unsubscribe = manager.subscribeVisibilityRequests?.((change) => {
    // A later independent action owns its layer, even if it requests ON again.
    if (change.notificationToken !== token) owned.delete(change.layerId);
  });
  async function restore() {
    for (const id of [...owned]) {
      if (abort.signal.aborted) return;
      await manager.setEnabled(id, false, { origin: 'user', notificationToken: token, signal: abort.signal });
      if (manager.isEnabled(id)) throw new Error('Maritime context restore failed');
      owned.delete(id);
    }
    const mapStack = manager.mapStackController;
    // Restore the basemap only when this session still owns the switch. A
    // separate user choice always wins, just like the layer ownership above.
    if (mapStackOwned && mapStack && mapStack.getActiveId?.() === 'osm') {
      const target = mapStackBefore || 'photoreal';
      await mapStack.setStack(target);
    }
    mapStackBefore = null;
    mapStackOwned = false;
  }
  return {
    get busy() { return busy; },
    // Vlastníctvom je aj prepnutý podklad, nielen vrstvy: keď boli všetky tri
    // vrstvy zapnuté už predtým, show() prepne fotoreál na OSM a neprevezme
    // žiadnu vrstvu — Undo by ostalo zašednuté a ten prepnutý podklad by sa
    // cez panel nedal vrátiť (2026-09-10).
    get canRestore() { return owned.size > 0 || mapStackOwned; },
    async show() {
      if (busy || abort.signal.aborted) return;
      busy = true;
      try {
        const mapStack = manager.mapStackController;
        if (mapStack?.getActiveId?.() === 'photoreal') {
          mapStackBefore = 'photoreal';
          const state = await mapStack.setStack('osm');
          if (state?.activeId !== 'osm') throw new Error('OSM basemap unavailable');
          mapStackOwned = true;
        }
        for (const id of MARITIME_HISTORY_IDS) {
          if (abort.signal.aborted) return;
          if (manager.isEnabled(id)) continue;
          owned.add(id);
          await manager.setEnabled(id, true, { origin: 'user', notificationToken: token, signal: abort.signal });
          if (!manager.isEnabled(id)) throw new Error('Maritime context unavailable');
        }
      } finally { busy = false; }
    },
    async restore() {
      if (busy || abort.signal.aborted) return;
      busy = true;
      try { await restore(); } finally { busy = false; }
    },
    destroy() { abort.abort(); unsubscribe?.(); owned.clear(); },
  };
}

export function createMaritimeHistoryPanel(doc, manager, session) {
  const root = doc.createElement('section');
  root.className = 'maritime-history-panel';
  root.setAttribute('aria-label', t('maritime.history-title'));
  const title = doc.createElement('strong');
  title.textContent = t('maritime.history-title');
  const note = doc.createElement('p');
  note.textContent = t('maritime.history-note');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const actions = doc.createElement('div');
  actions.className = 'data-toggle-controls';
  function button(label, action, errorKey = 'maritime.history-error') {
    const node = doc.createElement('button');
    node.type = 'button'; node.className = 'data-toggle-chip'; node.textContent = t(label);
    node.addEventListener('click', async () => {
      status.textContent = '';
      try { const pending = action(); sync(); await pending; }
      catch { status.textContent = t(errorKey); }
      finally { sync(); }
    });
    actions.appendChild(node);
    return node;
  }
  const show = button('maritime.history-show', () => session.show());
  const undo = button('maritime.history-undo', () => session.restore());
  button('maritime.hormuz', () => focusMaritimeRegion(manager.viewer), 'maritime.focus-unavailable');
  function sync() {
    show.disabled = session.busy;
    undo.disabled = session.busy || !session.canRestore;
  }
  sync();
  root.appendChild(title);
  root.appendChild(note);
  root.appendChild(actions);
  root.appendChild(status);
  return root;
}
