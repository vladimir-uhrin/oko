// src/data/shmuRadarFade.test.mjs
// Prelínanie snímok radaru (2026-10-09, „ako Windy" — zrážky plávajú, neskáču): nová snímka sa objaví, stará
// zmizne za fadeMs; ďalšia zmena počas prelínania ho dokončí; vypnutie nenechá viditeľnú starú snímku.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShmuRadarLayer } from './shmuRadar.js';
import { _resetRadarPresenceForTest, primaryRadar } from './radarPresence.js';

function harness() {
  let now = 0;
  const timers = [];
  const schedule = { later: (fn, ms) => { const h = { fn, at: now + ms }; timers.push(h); return h; }, cancel: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); }, now: () => now };
  const advance = (ms) => { now += ms; for (let guard = 0; guard < 100; guard += 1) { const due = timers.filter((t) => t.at <= now); if (!due.length) break; for (const t of due) { timers.splice(timers.indexOf(t), 1); t.fn(); } } };
  const frames = ['2026-10-09T10:00:00.000Z', '2026-10-09T10:10:00.000Z', '2026-10-09T10:20:00.000Z'];
  const prims = new Map();
  const layer = createShmuRadarLayer({
    id: 'opera-radar', name: 'Radar EÚ', fadeMs: 400, schedule,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, iso: frames[2], png: '/p', bounds: { west: -40, south: 31, east: 58, north: 74 }, frames: frames.map((iso) => ({ iso, png: '/' + iso })) }) }),
    primitiveFactory: ({ image }) => { const p = { show: false, appearance: { material: { uniforms: { color: null } } }, image }; return p; },
  });
  return { layer, frames, prims, advance };
}
const alpha = (p) => (p.appearance.material.uniforms.color ? p.appearance.material.uniforms.color.alpha : 1);

test('prelínanie: nová snímka z 0 do 1, stará z 1 do 0 a potom skrytá', async () => {
  _resetRadarPresenceForTest();
  const h = harness();
  const added = [];
  h.layer.init({ scene: { primitives: { add: (p) => added.push(p), remove() {} } } });
  h.layer.enable();
  await h.layer.update();
  const ctl = primaryRadar();
  ctl.pause();
  ctl.showIndex(0);
  h.advance(500);
  const [a, b] = added;
  assert.equal(a.show, true);
  ctl.showIndex(1);
  assert.equal(b.show, true);
  assert.equal(alpha(b), 0, 'nová začína priehľadná');
  h.advance(200);
  assert.ok(alpha(b) > 0.3 && alpha(b) < 0.7, `v polovici (${alpha(b)})`);
  assert.ok(a.show && alpha(a) > 0.3 && alpha(a) < 0.7, 'stará ešte dobieha');
  h.advance(300);
  assert.equal(alpha(b), 1);
  assert.equal(a.show, false, 'stará po prelínaní skrytá');
  // zmena počas prelínania ho najprv dokončí; vypnutie nenechá viditeľnú žiadnu snímku
  ctl.showIndex(2);
  h.advance(100);
  h.layer.disable();
  assert.equal(added.filter((p) => p.show).length, 0);
  h.layer.destroy();
});
