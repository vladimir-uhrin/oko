/**
 * Kontextové menu pravým tlačidlom myši (2026-09-06, používateľ: „všade,
 * kde sa dá, používať pravé tlačidlo myši").
 *
 * Tri miesta, jedno menu: glóbus (prázdne miesto), kontakt na glóbuse
 * (lietadlo, loď, satelit — podľa toho, ktorá vrstva pick vlastní,
 * pickRegistry.js) a riadok vrstvy v paneli. Položky sú ČISTÉ funkcie
 * (testovateľné bez DOM) — akcie vykonáva ui.js cez `onSelect(id)`, menu
 * samo nič nemení. DOM časť (`createContextMenu`) je jeden prvok
 * `role="menu"` s klávesnicou (šípky, Home/End, Enter, Escape), zatvára sa
 * klikom mimo, kolieskom aj stratou fokusu, a drží sa vo viewporte.
 *
 * Pravý ťah = Cesium zoom. Prehliadač strieľa `contextmenu` až pri
 * pustení tlačidla (Windows), takže po ťahu by vyskočilo menu — `installDragGuard`
 * si pamätá, kde sa pravé tlačidlo stlačilo, a menu po ťahu potlačí.
 */

/** Pravý ťah dlhší než toto (px) je zoom, nie klik. */
export const CONTEXT_MENU_DRAG_THRESHOLD_PX = 6;
/** Odstup menu od okraja viewportu (px). */
export const CONTEXT_MENU_VIEWPORT_MARGIN_PX = 8;

/**
 * Súradnice pre schránku: 5 desatinných miest (~1 m), „lat, lon" — formát,
 * ktorý zoberie Google Maps aj Cesium geocoder. Pure.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function formatCoords(lat, lon) {
  return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

/**
 * Položky pre kontakt na glóbuse.
 * @param {{layerId: string, id: string, label?: string, isTracked?: boolean, canCockpit?: boolean}} contact
 * @param {(key: string, vars?: object) => string} t
 * @returns {Array<{id: string, label: string, icon: string, disabled?: boolean}>}
 */
export function buildContactMenuItems(contact, t) {
  const kind = contact.layerId === 'ais-live-vessels' ? 'vessel'
    : contact.layerId === 'satellites' ? 'satellite' : 'aircraft';
  const items = [];
  if (kind === 'vessel') {
    items.push({ id: 'select', label: t('ctx.select-vessel'), icon: 'directions_boat' });
  } else if (contact.isTracked) {
    items.push({ id: 'untrack', label: t('ctx.untrack'), icon: 'location_off' });
  } else {
    items.push({ id: 'track', label: t(kind === 'satellite' ? 'ctx.track-satellite' : 'ctx.track-aircraft'), icon: 'my_location' });
  }
  if (kind === 'aircraft') {
    items.push({ id: 'cockpit', label: t('ctx.cockpit'), icon: 'flight', disabled: contact.canCockpit === false });
    // História letov (2026-09-07): spätné vyhľadanie a prehratie tohto draku.
    items.push({ id: 'history', label: t('ctx.history'), icon: 'history' });
  }
  items.push({
    id: 'copy-id',
    label: t(kind === 'vessel' ? 'ctx.copy-mmsi' : kind === 'satellite' ? 'ctx.copy-norad' : 'ctx.copy-icao', { id: contact.id }),
    icon: 'content_copy',
  });
  return items;
}

/**
 * Položky pre prázdne miesto na glóbuse.
 * @param {{hasPosition: boolean, lat?: number, lon?: number}} ground
 * @param {(key: string, vars?: object) => string} t
 */
export function buildGroundMenuItems(ground, t) {
  const items = [];
  if (ground.hasPosition) {
    items.push({ id: 'fly-here', label: t('ctx.fly-here'), icon: 'flight_takeoff' });
    items.push({ id: 'copy-coords', label: t('ctx.copy-coords', { coords: formatCoords(ground.lat, ground.lon) }), icon: 'content_copy' });
  }
  items.push({ id: 'bookmark', label: t('ctx.bookmark-view'), icon: 'bookmark_add' });
  items.push({ id: 'reset-globe', label: t('ctx.reset-globe'), icon: 'public' });
  return items;
}

/**
 * Položky pre riadok vrstvy v paneli.
 * @param {{layerId: string, name: string, enabled: boolean, otherEnabledCount: number}} layer
 * @param {(key: string, vars?: object) => string} t
 */
export function buildLayerMenuItems(layer, t) {
  return [
    { id: 'toggle', label: t(layer.enabled ? 'ctx.layer-off' : 'ctx.layer-on', { name: layer.name }), icon: layer.enabled ? 'toggle_off' : 'toggle_on' },
    { id: 'solo', label: t('ctx.layer-solo', { name: layer.name }), icon: 'filter_1', disabled: layer.otherEnabledCount === 0 && layer.enabled },
    { id: 'all-off', label: t('ctx.layers-all-off'), icon: 'layers_clear', disabled: layer.otherEnabledCount === 0 && !layer.enabled },
  ];
}

/**
 * Umiestni menu tak, aby bolo celé vo viewporte: pri okraji sa preklopí
 * doľava/hore. Pure.
 * @param {{x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number}} box
 * @returns {{left: number, top: number}}
 */
export function placeMenu({ x, y, width, height, viewportWidth, viewportHeight }) {
  const m = CONTEXT_MENU_VIEWPORT_MARGIN_PX;
  let left = x;
  let top = y;
  if (left + width + m > viewportWidth) left = Math.max(m, x - width);
  if (top + height + m > viewportHeight) top = Math.max(m, y - height);
  return { left, top };
}

/**
 * Strážca pravého ťahu: `shouldSuppress(event)` je true, keď sa od
 * `pointerdown` pravým tlačidlom kurzor posunul viac než prah (zoom, nie klik).
 * @param {EventTarget} target
 * @returns {{shouldSuppress: (event: {clientX: number, clientY: number}) => boolean, remove: () => void}}
 */
export function installDragGuard(target) {
  let start = null;
  const onDown = (event) => { start = event.button === 2 ? { x: event.clientX, y: event.clientY } : null; };
  target?.addEventListener?.('pointerdown', onDown, true);
  return {
    shouldSuppress(event) {
      if (!start) return false;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      return moved > CONTEXT_MENU_DRAG_THRESHOLD_PX;
    },
    remove() { target?.removeEventListener?.('pointerdown', onDown, true); },
  };
}

/**
 * DOM menu. Jedna inštancia na appku; `open()` prepíše položky.
 * @param {Document} doc
 * @returns {{open: Function, close: Function, isOpen: () => boolean, element: HTMLElement}}
 */
export function createContextMenu(doc) {
  const element = doc.createElement('div');
  element.className = 'context-menu';
  element.setAttribute('role', 'menu');
  element.hidden = true;
  let _onSelect = null;
  let _buttons = [];
  let _cleanup = [];

  const close = () => {
    if (element.hidden) return;
    element.hidden = true;
    element.innerHTML = '';
    _buttons = [];
    _onSelect = null;
    for (const fn of _cleanup) fn();
    _cleanup = [];
  };

  const focusIndex = (index) => {
    if (!_buttons.length) return;
    const i = ((index % _buttons.length) + _buttons.length) % _buttons.length;
    _buttons[i].focus?.();
  };

  const onKey = (event) => {
    const current = _buttons.indexOf(doc.activeElement);
    switch (event.key) {
      case 'Escape': event.preventDefault(); close(); break;
      case 'ArrowDown': event.preventDefault(); focusIndex(current + 1); break;
      case 'ArrowUp': event.preventDefault(); focusIndex(current - 1); break;
      case 'Home': event.preventDefault(); focusIndex(0); break;
      case 'End': event.preventDefault(); focusIndex(_buttons.length - 1); break;
      default: break;
    }
  };

  const open = ({ x, y, items, onSelect, title = null }) => {
    close();
    _onSelect = typeof onSelect === 'function' ? onSelect : null;
    if (title) {
      const head = doc.createElement('div');
      head.className = 'context-menu-title';
      head.textContent = title;
      element.appendChild(head);
    }
    for (const item of items || []) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = `context-menu-item${item.danger ? ' danger' : ''}`;
      button.setAttribute('role', 'menuitem');
      button.dataset.itemId = item.id;
      button.disabled = item.disabled === true;
      if (item.icon) {
        const icon = doc.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = item.icon;
        button.appendChild(icon);
      }
      const label = doc.createElement('span');
      label.textContent = item.label;
      button.appendChild(label);
      button.addEventListener('click', () => {
        const handler = _onSelect;
        close();
        handler?.(item.id, item);
      });
      element.appendChild(button);
      _buttons.push(button);
    }
    element.hidden = false;
    // Najprv zobraziť, až potom merať — skryté nemá rozmery.
    const width = element.offsetWidth || 220;
    const height = element.offsetHeight || 40 * (items?.length || 1);
    const view = doc.defaultView || globalThis;
    const { left, top } = placeMenu({
      x, y, width, height,
      viewportWidth: view.innerWidth || 1e9,
      viewportHeight: view.innerHeight || 1e9,
    });
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    // Zatvorenie: klik/dotyk mimo (capture, aby ho panel nezožral), koliesko,
    // Escape a klávesy vnútri menu.
    const onPointerDown = (event) => { if (!element.contains(event.target)) close(); };
    const onWheel = () => close();
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('wheel', onWheel, { capture: true, passive: true });
    element.addEventListener('keydown', onKey);
    _cleanup.push(
      () => doc.removeEventListener('pointerdown', onPointerDown, true),
      () => doc.removeEventListener('wheel', onWheel, true),
      () => element.removeEventListener('keydown', onKey),
    );
    focusIndex(0);
  };

  return { open, close, isOpen: () => !element.hidden, element };
}
