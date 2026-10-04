// src/cardActionBar.test.mjs — SLEDOVAŤ a KOKPIT pod kartou lietadla na mobile (2026-10-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_ACTION_BOTTOM_SAFE_PX, CARD_ACTION_GAP_PX, CARD_ACTION_HEIGHT_PX, cardActionBarPlacement, installCardActionBar,
} from './cardActionBar.js';

const PHONE = { w: 390, h: 844 };

test('lišta: pod kartou a pod pásom s fotkou, šírka karty', () => {
  const card = { x: 24, y: 180, w: 342, h: 130 };
  const photo = { top: 305, bottom: 375 };
  assert.deepEqual(cardActionBarPlacement(card, [photo], PHONE), { x: 24, y: 375 + CARD_ACTION_GAP_PX, w: 342, above: false });
  assert.deepEqual(cardActionBarPlacement(card, [], PHONE), { x: 24, y: 310 + CARD_ACTION_GAP_PX, w: 342, above: false }, 'bez fotky hneď pod kartou');
});

test('lišta: keď by pod kartou siahla do doku, ide nad kartu; bez miesta nikde → null (pôvodné miesto)', () => {
  const low = { x: 24, y: 520, w: 342, h: 160 };
  const placed = cardActionBarPlacement(low, [], PHONE);
  assert.equal(placed.above, true);
  assert.equal(placed.y, 520 - CARD_ACTION_GAP_PX - CARD_ACTION_HEIGHT_PX);
  assert.ok(680 + CARD_ACTION_GAP_PX + CARD_ACTION_HEIGHT_PX > PHONE.h - CARD_ACTION_BOTTOM_SAFE_PX, 'pod kartou by zasahovala do doku');
  assert.equal(cardActionBarPlacement({ x: 24, y: 70, w: 342, h: 600 }, [], PHONE), null, 'vysoká karta — ani pod, ani nad');
  assert.equal(cardActionBarPlacement(null, [], PHONE), null);
});

function fakeDoc({ mobile = true } = {}) {
  const make = (id) => ({
    id, hidden: false, style: {},
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
  });
  const els = { 'follow-flight': make('follow-flight'), 'cockpit-entry': make('cockpit-entry') };
  return {
    els,
    body: { classList: { contains: (c) => c === 'oko-mobile' && mobile } },
    defaultView: { innerWidth: PHONE.w, innerHeight: PHONE.h },
    getElementById: (id) => els[id] ?? null,
    querySelectorAll: () => [],
  };
}

test('inštalácia: na mobile s kartou dve polovice pod kartou; po zatvorení karty späť na pôvodné miesto', () => {
  const doc = fakeDoc();
  const listeners = [];
  const viewer = { scene: { postRender: { addEventListener: (fn) => listeners.push(fn), removeEventListener() {} } } };
  let card = { x: 24, y: 180, w: 342, h: 130 };
  const bar = installCardActionBar(viewer, { doc, cardRect: () => card });
  listeners[0]();
  const { 'follow-flight': follow, 'cockpit-entry': cockpit } = doc.els;
  const half = (342 - CARD_ACTION_GAP_PX) / 2;
  assert.equal(follow.style.top, `${310 + CARD_ACTION_GAP_PX}px`);
  assert.equal(follow.style.left, '24px');
  assert.equal(follow.style.width, `${Math.round(half)}px`);
  assert.equal(cockpit.style.left, `${Math.round(24 + half + CARD_ACTION_GAP_PX)}px`);
  assert.equal(cockpit.style.bottom, 'auto', 'zruší spodné ukotvenie zo style.css');
  assert.ok(follow.classList.contains('oko-card-action'));

  follow.hidden = true; // hosť bez sledovania alebo let bez tlačidla
  listeners[0]();
  assert.equal(cockpit.style.left, '24px', 'jediné tlačidlo zaberie celú šírku');
  assert.equal(cockpit.style.width, '342px');
  assert.equal(follow.style.top, '', 'skryté tlačidlo bez inline polohy');

  card = null;
  listeners[0]();
  assert.equal(cockpit.style.top, '');
  assert.equal(cockpit.classList.contains('oko-card-action'), false, 'bez karty späť na miesto zo style.css');
  bar.destroy();
});

test('inštalácia: pás s fotkou (position: fixed, offsetParent null) posunie lištu pod seba', () => {
  const doc = fakeDoc();
  const photo = { hidden: false, offsetParent: null, getBoundingClientRect: () => ({ top: 305, bottom: 375, width: 342, height: 70 }) };
  doc.querySelectorAll = () => [photo];
  doc.defaultView.getComputedStyle = () => ({ display: 'block' });
  installCardActionBar({}, { doc, cardRect: () => ({ x: 24, y: 180, w: 342, h: 130 }) }).sync();
  assert.equal(doc.els['follow-flight'].style.top, `${375 + CARD_ACTION_GAP_PX}px`, 'pod fotkou, nie cez ňu');
});

test('inštalácia: na počítači sa tlačidiel nedotkne', () => {
  const doc = fakeDoc({ mobile: false });
  const bar = installCardActionBar({}, { doc, cardRect: () => ({ x: 24, y: 180, w: 342, h: 130 }) });
  bar.sync();
  assert.equal(doc.els['follow-flight'].style.top, undefined);
  assert.equal(doc.els['cockpit-entry'].classList.contains('oko-card-action'), false);
});
