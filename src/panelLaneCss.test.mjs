import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/**
 * The panels index.html places inside #left-panel-stack. Some are moved into
 * the right rail at runtime (ui.js relocates #pp-toggles and #cctv-panel), but
 * the lane CSS still has to be correct for whatever markup declares.
 */
function leftLanePanelIds() {
  const start = html.indexOf('id="left-panel-stack"');
  assert.ok(start > 0, '#left-panel-stack must exist in index.html');
  const end = html.indexOf('id="right-context-rail"', start);
  assert.ok(end > start, '#right-context-rail must follow #left-panel-stack in index.html');
  return [...html.slice(start, end).matchAll(/data-panel-id="([a-z-]+)"/g)].map((m) => m[1]);
}

test('left-lane membership is attribute-driven, never a hand-kept id list', () => {
  // 2026-09-18: membership used to be six ids written out by hand. #oil-panel
  // and #gulf-panel were simply missing, so both inherited `pointer-events:
  // none` from the lane and were unclickable on desktop, and with no `order`
  // they sorted to 0 and jumped above DATA LAYERS. Verified live before the
  // fix: oil/gulf had pointer-events "none", order "0", position "static".
  const membership = css.match(/#left-panel-stack > \[data-panel-id\] \{([^}]*)\}/);
  assert.ok(membership, 'the lane membership rule must select by [data-panel-id]');
  assert.match(membership[1], /pointer-events:\s*auto/, 'lane members must be clickable');
  assert.match(membership[1], /position:\s*relative/, 'lane members must be taken out of their own fixed position');

  // Specificity guard. (1,1,0) has to keep outranking the six single-id
  // `position: fixed` blocks at (1,0,0); weaken this and all six panels spring
  // back to hand-picked coordinates floating over the globe.
  for (const id of ['data-panel', 'global-context-panel', 'cctv-panel', 'scene-panel', 'history-panel', 'gas-panel']) {
    const own = css.match(new RegExp(`\n#${id} \{([^}]*)\}`));
    if (own && /position:\s*fixed/.test(own[1])) {
      assert.match(
        membership[1], /position:\s*relative/,
        `#${id} still declares position:fixed, so the lane rule must neutralize it`,
      );
    }
  }

  // No id-keyed rule may take over membership again.
  const idKeyed = [...css.matchAll(/#left-panel-stack > #([a-z-]+) \{([^}]*)\}/g)]
    .filter(([, , body]) => /pointer-events|position:\s*relative/.test(body))
    .map(([, id]) => id);
  assert.deepEqual(idKeyed, [], 'membership must not be re-introduced per id');
});

test('every left-lane panel has an explicit order, so none silently falls to 0', () => {
  const ids = leftLanePanelIds();
  assert.ok(ids.length >= 6, `expected the left lane to declare panels, got ${ids.join(', ')}`);
  const ordered = new Map(
    [...css.matchAll(/#left-panel-stack > #([a-z-]+)\s*\{[^}]*order:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
  );
  const missing = ids.filter((id) => !ordered.has(id));
  assert.deepEqual(missing, [], `these left-lane panels have no order and would sort above the rest: ${missing.join(', ')}`);

  // The reported regression, pinned by name.
  assert.equal(ordered.get('oil-panel'), 7);
  assert.equal(ordered.get('gulf-panel'), 8);

  // Orders must stay distinct, or the flex sort falls back to DOM order.
  const values = ids.map((id) => ordered.get(id));
  assert.equal(new Set(values).size, values.length, `duplicate order values: ${values.join(', ')}`);
});

test('every left-lane panel hides its body when collapsed', () => {
  // 2026-09-18: #oil-panel and #gulf-panel had no such rule, because until the
  // membership fix above they were unclickable — a panel that cannot be
  // expanded cannot fail to collapse. The moment they became expandable, ROPA
  // kept its whole price chart painted while "collapsed" (measured 423px
  // instead of ~50px) and pushed ZÁLIV off the bottom of the lane.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const missing = [];
  for (const id of leftLanePanelIds()) {
    const hides = rules.some(([, selectors, body]) => (
      /display:\s*none/.test(body)
      && selectors.split(',').some((s) => s.trim().startsWith(`#${id}.collapsed`))
    ));
    if (!hides) missing.push(id);
  }
  assert.deepEqual(
    missing, [],
    `these lane panels stay fully painted while collapsed and will shove their siblings `
    + `out of the lane: ${missing.join(', ')}. Add "#<id>.collapsed .<id>-body { display: none }".`,
  );
});
