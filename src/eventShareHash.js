// src/eventShareHash.js — id udalosti v hashi odkazu (`event=<id>`).
//
// Vyčlenené z eventsPanel.js (2026-10-31, lenivý štart): ui.js potrebuje pri štarte vedieť, či odkaz
// nesie udalosť (vtedy panel Histórie dotiahne hneď), no samotný panel udalostí (~20 KB) sa sťahuje
// až pri prvom otvorení. eventsPanel.js obe veci znova exportuje.

/** Tvar id udalosti (hex-prefix a minúta UTC) — chráni cestu /api/events/public/<id>. */
export const EVENT_ID_RE = /^[0-9a-f]{6}-\d{8}T\d{4}$/;

/** Id udalosti z hashu odkazu (`event=<id>`), inak null. Pure. */
export function eventIdFromHash(hash) {
  try {
    const id = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('event');
    return id && EVENT_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}
