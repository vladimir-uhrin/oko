// src/conflictBulletin.test.mjs
// Zlúčenie bulletinu do panela ZÁLIV (2026-09-18): bulletin už nesmie vyrobiť
// žiadny plávajúci prvok, musí sa načítať až pri rozbalení panela, prepínať dva
// regióny a NIKDY nesmie odhaliť zdieľanú vrstvu kariet (tú vlastní reveal gate).
// Falošný DOM podľa vzoru sharePanel.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BULLETIN_REGIONS, createConflictBulletin } from './conflictBulletin.js';

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '', textContent: '', hidden: false,
    attributes: {}, children: [], listeners: {}, parentNode: null, style: {},
    classList: {
      _set: new Set(),
      contains(c) { return node.classList._set.has(c); },
      add(...c) { c.forEach((x) => node.classList._set.add(x)); },
      remove(...c) { c.forEach((x) => node.classList._set.delete(x)); },
    },
    appendChild(child) { node.children.push(child); child.parentNode = node; return child; },
    replaceChildren(...kids) { node.children = []; kids.forEach((k) => node.appendChild(k)); },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name] ?? null; },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    click() { for (const h of node.listeners.click || []) h({}); },
    closest(sel) {
      for (let n = node; n; n = n.parentNode) {
        if (sel === '[data-panel-id]' && n.attributes['data-panel-id']) return n;
      }
      return null;
    },
  };
  return node;
}

/** Collect every node in the rendered tree, flattened. */
function walk(node, out = []) {
  for (const c of node.children) { out.push(c); walk(c, out); }
  return out;
}
const byClass = (root, cls) => walk(root).filter((n) => String(n.className).split(' ').includes(cls));

function makeEnv() {
  const body = makeNode('body');
  const head = makeNode('head');
  const panel = makeNode('div');
  panel.setAttribute('data-panel-id', 'gulf-panel');
  panel.classList.add('collapsed');
  const mount = makeNode('div');
  panel.appendChild(mount);
  body.appendChild(panel);
  const doc = {
    body, head,
    createElement: (tag) => makeNode(tag),
    getElementById: () => null, // ensureStyle always injects; harmless here
  };
  return { doc, body, panel, mount };
}

/** MutationObserver shim so expanding/collapsing the panel is observable. */
function withObserver(fn) {
  const prev = globalThis.MutationObserver;
  const observers = [];
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} };
  try { return fn(() => observers.forEach((o) => o.cb([]))); }
  finally { globalThis.MutationObserver = prev; }
}

const translate = (key) => key;
const payload = (region) => ({
  region,
  items: [{ title: `Tanker struck near Fujairah (${region})`, url: `https://x/${region}`, source: 'Reuters', publishedAt: 100, image: null }],
  source: 'test', fetchedAt: 100,
});

test('the bulletin renders into the panel body and creates no floating element of its own', async () => {
  await withObserver(async (flush) => {
    const { doc, body, panel, mount } = makeEnv();
    panel.classList.remove('collapsed');
    const b = createConflictBulletin({
      documentRef: doc, mountTarget: mount, translate,
      fetch: async (r) => payload(r), now: () => 1000,
    });
    flush();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(b.element, mount, 'it renders into the body it was handed');
    // The old floating aside + tab must be gone: nothing new may be attached to
    // <body>, and no descendant may be positioned.
    assert.deepEqual(body.children, [panel], 'nothing may be appended to <body>');
    assert.equal(byClass(mount, 'oko-bulletin').length, 0, 'no floating aside');
    assert.equal(byClass(mount, 'oko-bulletin-tab').length, 0, 'no floating tab');
    for (const n of walk(mount)) {
      assert.notEqual(n.style?.position, 'fixed', 'the panel owns placement; nothing here is fixed');
    }
  });
});

test('it does not fetch while the panel is collapsed, and loads once on first expand', async () => {
  await withObserver(async (flush) => {
    const { doc, panel, mount } = makeEnv(); // starts collapsed
    let calls = 0;
    const b = createConflictBulletin({
      documentRef: doc, mountTarget: mount, translate,
      fetch: async (r) => { calls += 1; return payload(r); }, now: () => 1000,
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, 0, 'a collapsed panel must cost no upstream request');
    assert.equal(b.isOpen, false);

    panel.classList.remove('collapsed');
    flush();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(b.isOpen, true);
    assert.equal(calls, 1, 'expanding fetches exactly once');

    // Collapsing and re-expanding inside the TTL must not refetch.
    panel.classList.add('collapsed'); flush();
    panel.classList.remove('collapsed'); flush();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, 1, 'the cached region is reused inside its TTL');
  });
});

test('two region chips switch the feed, narrow Gulf first', async () => {
  await withObserver(async (flush) => {
    const { doc, panel, mount } = makeEnv();
    panel.classList.remove('collapsed');
    const asked = [];
    const b = createConflictBulletin({
      documentRef: doc, mountTarget: mount, translate,
      fetch: async (r) => { asked.push(r); return payload(r); }, now: () => 1000,
    });
    flush();
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(BULLETIN_REGIONS.map((r) => r.id), ['gulf', 'mideast']);
    assert.equal(b.region, 'gulf', 'the narrow feed is the default');
    const chips = byClass(mount, 'oko-bul-chip');
    assert.equal(chips.length, 2);
    assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
    assert.equal(chips[1].getAttribute('aria-pressed'), 'false');

    chips[1].click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(b.region, 'mideast');
    assert.deepEqual(asked, ['gulf', 'mideast'], 'switching fetches the other feed');
    assert.equal(byClass(mount, 'oko-bul-chip')[1].getAttribute('aria-pressed'), 'true');
  });
});

test('a SHARED card layer is never revealed or retargeted by the panel', async () => {
  await withObserver(async (flush) => {
    const { doc, panel, mount } = makeEnv();
    panel.classList.remove('collapsed');
    const calls = [];
    const shared = {
      showFor: async (r) => { calls.push(`showFor:${r}`); },
      setRevealed: (v) => { calls.push(`setRevealed:${v}`); },
      clear: () => calls.push('clear'),
      destroy: () => calls.push('destroy'),
    };
    const b = createConflictBulletin({
      documentRef: doc, mountTarget: mount, translate, cards: shared,
      fetch: async (r) => payload(r), now: () => 1000,
    });
    flush();
    await new Promise((r) => setTimeout(r, 0));
    byClass(mount, 'oko-bul-chip')[1].click();
    await new Promise((r) => setTimeout(r, 0));
    b.destroy();

    // The reveal gate decides hot-card visibility by camera distance. Expanding a
    // side panel must not override that, and destroying the panel must not tear
    // down a layer it does not own.
    assert.deepEqual(calls, [], 'the shared layer is left entirely alone');
  });
});

test('every rendered list keeps the provenance disclaimer', async () => {
  await withObserver(async (flush) => {
    const { doc, panel, mount } = makeEnv();
    panel.classList.remove('collapsed');
    createConflictBulletin({
      documentRef: doc, mountTarget: mount, translate,
      fetch: async (r) => payload(r), now: () => 1000,
    });
    flush();
    await new Promise((r) => setTimeout(r, 0));
    const disc = byClass(mount, 'oko-bul-disc');
    assert.equal(disc.length, 1);
    assert.equal(disc[0].textContent, 'situation.disclaimer', 'aggregated/unverified notice is not optional');
  });
});
