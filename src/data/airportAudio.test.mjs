import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirportAudio } from './airportAudio.js';
import { airportBroadcastFor, normalizeAirportStream } from './airportBroadcasts.js';

function fixture() {
  const elements = [];
  const doc = { createElement(tagName) {
    const el = { tagName, children: [], listeners: new Map(), hidden: false, plays: 0, pauses: 0, loads: 0,
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); },
      setAttribute(k, v) { this[k] = v; }, removeAttribute(k) { delete this[k]; },
      addEventListener(k, fn) { this.listeners.set(k, fn); }, removeEventListener(k) { this.listeners.delete(k); },
      pause() { this.pauses++; }, load() { this.loads++; },
      play() { this.plays++; return this.playResult?.() || Promise.resolve(); },
    }; elements.push(el); return el;
  } };
  const player = createAirportAudio(doc);
  return { player, elements, audio: elements.find(e => e.tagName === 'audio'), retry: elements.find(e => e.tagName === 'button') };
}

test('audio starts once, survives card refresh, and releases the source on close', () => {
  const { player, audio } = fixture();
  player.setStream({ url: 'https://radio.example.test/tower' });
  assert.equal(audio.plays, 1);
  player.setStream({ url: audio.src, label: 'Updated label' });
  assert.equal(audio.plays, 1);
  player.setStream(null);
  assert.equal(audio.src, undefined);
  assert.equal(player.root.hidden, true);
  assert.equal(audio.pauses, 2);
  player.destroy();
  assert.equal(audio.listeners.size, 0);
});

test('autoplay rejection offers retry; a late rejection cannot affect the next airport', async () => {
  const { player, audio, retry } = fixture();
  audio.playResult = () => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }));
  player.setStream({ url: 'https://radio.example.test/one' });
  await Promise.resolve();
  assert.equal(retry.hidden, false);
  audio.playResult = () => Promise.resolve();
  await retry.listeners.get('click')();
  assert.equal(audio.plays, 2);
  let reject;
  audio.playResult = () => new Promise((_, fail) => { reject = fail; });
  player.setStream({ url: 'https://radio.example.test/two' });
  player.setStream(airportBroadcastFor('KLAX'));
  reject(new Error('old stream'));
  await Promise.resolve();
  assert.equal(retry.hidden, true);
  player.destroy();
});

test('camera feeds are rejected and release previously playing audio', () => {
  const { player, audio, elements } = fixture();
  player.setStream({ url: 'https://radio.example.test/one' });
  player.setStream({ kind: 'youtube', videoId: 'KzsNnyN8D_Q' });
  assert.equal(audio.src, undefined);
  assert.equal(player.root.hidden, true);
  assert.equal(elements.filter(e => e.tagName === 'iframe').length, 0);
  player.setStream({ url: 'https://radio.example.test/two' });
  assert.equal(audio.plays, 2);
  assert.equal(player.root.hidden, false);
  player.destroy();
  assert.equal(audio.src, undefined);
});

test('unknown airports have no fabricated broadcast; invalid embed IDs and protocols are rejected', () => {
  assert.equal(airportBroadcastFor('LZIB'), null);
  assert.equal(airportBroadcastFor('LKPR'), null);
  assert.equal(airportBroadcastFor('KLAX'), null);
  assert.equal(airportBroadcastFor('__proto__'), null);
  assert.equal(normalizeAirportStream({ kind: 'youtube', videoId: '../arbitrary' }), null);
  assert.equal(normalizeAirportStream({ url: 'javascript:alert(1)' }), null);
});
