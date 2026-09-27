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

  // The reported regression, pinned by name. Zone bands (2026-09-20): ROPA sits
  // in the ENERGIA decade, ZÁLIV in the KONFLIKTY one — since 2026-09-26 the
  // BLÍZKY VÝCHOD panel inherits ZÁLIV's slot (#gulf-panel is gone).
  assert.equal(ordered.get('oil-panel'), 32);
  assert.equal(ordered.get('mideast-panel'), 22);

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

test('every left-lane panel survives a shared link', () => {
  // 2026-09-18: SHARE_PANEL_STATE_REGISTRY is another hand-kept list, and
  // _encodePanelStateParam silently drops any panel missing from it. PLYN, ROPA,
  // ZÁLIV and HISTÓRIA LETOV were all absent, so a recipient never saw what the
  // sender had open. Same failure mode as the CSS id lists above.
  const sharelink = readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');
  const registry = new Map(
    [...sharelink.matchAll(/\{ id: '([a-z-]+)', token: '([a-z])'/g)].map((m) => [m[1], m[2]]),
  );
  const missing = leftLanePanelIds().filter((id) => !registry.has(id));
  assert.deepEqual(
    missing, [],
    `these lane panels cannot be shared — their open/closed state is dropped from the `
    + `link: ${missing.join(', ')}. Add them to SHARE_PANEL_STATE_REGISTRY with a free token.`,
  );

  const tokens = [...registry.values()];
  assert.equal(new Set(tokens).size, tokens.length, `duplicate share tokens: ${tokens.join(', ')}`);
});

// ── Zóny v ľavom pruhu (2026-09-20) ──────────────────────────────────────────

/** Zóny tak, ako ich číta človek. VRSTVY má jediný panel a nadpis zámerne nemá.
 *  2026-09-27: Kamery prešli do NÁSTROJOV (leftLane.js; Kontext a Zobrazenie sú v markupe pravej
 *  lišty, ich poradie stráži leftLane.test). */
const LANE_ZONES = [
  { zone: null, panels: ['data-panel'] },
  { zone: 'conflicts', panels: ['ukraine-panel', 'mideast-panel'] },
  { zone: 'energy', panels: ['gas-panel', 'oil-panel'] },
  { zone: 'tools', panels: ['scene-panel', 'history-panel', 'cctv-panel'] },
];

const laneOrders = () => new Map(
  [...css.matchAll(/#left-panel-stack > #([a-z-]+)\s*\{[^}]*order:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
);
const zoneOrders = () => new Map(
  [...css.matchAll(/#left-panel-stack > \.lane-zone(?:\[data-lane-zone="([a-z-]+)"\])?\s*\{[^}]*order:\s*(\d+)/g)]
    .map((m) => [m[1] || 'conflicts', Number(m[2])]),
);

test('každý panel pruhu patrí práve do jednej zóny', () => {
  // Zovšeobecnenie chyby oil/gulf: nový panel sa už nedá pridať bez zaradenia.
  const declared = leftLanePanelIds();
  const assigned = LANE_ZONES.flatMap((z) => z.panels);
  assert.deepEqual(
    declared.filter((id) => !assigned.includes(id)), [],
    'tieto panely nemajú zónu — doplň ich do LANE_ZONES aj do poradia v style.css',
  );
  assert.equal(new Set(assigned).size, assigned.length, 'panel nesmie byť v dvoch zónach');
});

test('nadpis zóny sa radí priamo nad svoje panely a pod predchádzajúcu zónu', () => {
  const orders = laneOrders();
  const zones = zoneOrders();
  let previousMax = -Infinity;
  for (const { zone, panels } of LANE_ZONES) {
    const values = panels.map((id) => {
      const v = orders.get(id);
      assert.ok(Number.isFinite(v), `#${id} nemá order — spadol by na 0 a vyskočil nad všetko`);
      return v;
    });
    if (zone) {
      const head = zones.get(zone);
      assert.ok(Number.isFinite(head), `nadpis zóny ${zone} nemá order`);
      assert.ok(head > previousMax, `nadpis ${zone} (${head}) musí byť pod predchádzajúcou zónou`);
      assert.ok(values.every((v) => v > head), `nadpis ${zone} musí byť nad svojimi panelmi`);
    }
    previousMax = Math.max(previousMax, ...values);
  }
});

test('nadpis zóny nie je panel — bez data-panel-id, id aj panel-collapsible', () => {
  // S data-panel-id by ho layout engine bral ako plochu s 96px podlahou a
  // panelLaneCss by od neho pýtal share token; s id by ho chytil guard vyššie.
  const start = html.indexOf('id="left-panel-stack"');
  const end = html.indexOf('id="right-context-rail"', start);
  const lane = html.slice(start, end);
  const zones = [...lane.matchAll(/<div class="lane-zone"[^>]*>/g)].map((m) => m[0]);
  assert.ok(zones.length >= 3, `očakávam nadpisy zón v pruhu, našiel som ${zones.length}`);
  for (const tag of zones) {
    assert.doesNotMatch(tag, /data-panel-id/, `nadpis nesmie mať data-panel-id: ${tag}`);
    assert.doesNotMatch(tag, /\sid=/, `nadpis nesmie mať id: ${tag}`);
    assert.doesNotMatch(tag, /panel-collapsible/, `nadpis nie je panel: ${tag}`);
  }
});

test('nepanelové deti pruhu majú order a klikateľné si pýtajú pointer-events', () => {
  // Pruh je pointer-events:none a vracia ho len [data-panel-id] — tlačidlo bez
  // vlastného pointer-events sa vykreslí a nedá sa naň kliknúť.
  const zones = zoneOrders();
  assert.ok(zones.size >= 3, 'každý nadpis zóny potrebuje order');
  const launch = css.match(/#left-panel-stack > \.oko-conflicts-launch \{([^}]*)\}/);
  assert.ok(launch, 'spúšťač Kartičiek v pruhu potrebuje vlastné pravidlo');
  assert.match(launch[1], /order:\s*\d+/, 'inak spadne na order 0 a vyskočí nad Dátové vrstvy');
  assert.match(launch[1], /pointer-events:\s*auto/, 'inak sa naň nedá kliknúť');
  assert.match(launch[1], /position:\s*relative|position:\s*static/, 'musí prestať byť position: fixed');
});

test('čistý pohľad skryje celý pruh, nielen ručný zoznam id', () => {
  // Zoznam id na to nestačil: #oil-panel, #gulf-panel a #ukraine-panel v ňom
  // chýbali a v čistom pohľade ostávali viditeľné.
  assert.match(
    css,
    /body\.ui-clean-view #left-panel-stack \{[^}]*visibility:\s*hidden/,
    'skry pruh ako celok, inak každý nový panel aj nadpis zóny ostane nad glóbusom',
  );
});
