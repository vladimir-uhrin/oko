// Hlas len pre prihlásených (2026-10-05, vlastník: „sprav najprv pre prihlásených").
// Server: bez prihlásenia sa token OpenAI Realtime nevydá (401) — nič sa neúčtuje, ani keď niekto obíde
// tlačidlo. Klient: neprihlásenému mikrofón ani medzerník reláciu nezačnú, ponúkne sa prihlásenie.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { _setVoiceUserCheckForTest, openAiRealtimeProxy } from '../../vite.config.js';
import { classifyTokenFailure, setVoiceAccessGate, voiceAccessAllowed, voiceErrorHintKey } from './gevRealtime.js';

/** Minimálny connect: middlewares.use(prefix, fn) ako vo Vite. */
async function serveProxy(t) {
  const routes = [];
  const plugin = openAiRealtimeProxy();
  plugin.configureServer({ middlewares: { use: (prefix, fn) => routes.push([prefix, fn]) } });
  const server = http.createServer((req, res) => {
    const route = routes.find(([prefix]) => req.url === prefix || req.url.startsWith(prefix + '?') || req.url.startsWith(prefix + '/'));
    if (!route) { res.statusCode = 404; res.end(); return; }
    route[1](req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('token hlasu: neprihlásený 401 login_required, prihlásený prejde ďalej; bez služby účtov nikto', async t => {
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // prihlásený skončí na 503 bez kľúča → upstream ani rozpočet sa nedotknú
  t.after(() => { if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey; _setVoiceUserCheckForTest(null); });
  const base = await serveProxy(t);
  _setVoiceUserCheckForTest(null);
  let r = await fetch(`${base}/api/realtime/token`);
  assert.equal(r.status, 401, 'bez služby účtov sa token nevydá');
  assert.deepEqual(await r.json(), { error: 'login_required' });
  _setVoiceUserCheckForTest(req => req.headers.cookie === 'session=ok');
  r = await fetch(`${base}/api/realtime/token`);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  r = await fetch(`${base}/api/realtime/token`, { headers: { Cookie: 'session=ok' } });
  assert.equal(r.status, 503, 'prihlásený prešiel bránou (ďalej chýba kľúč)');
  assert.equal((await r.json()).error, 'OPENAI_API_KEY is not set');
});

test('klient: 401 = rada „prihláste sa"; brána ponúkne prihlásenie a nezačne reláciu', () => {
  assert.equal(classifyTokenFailure(401, 'login_required'), 'voice-login');
  assert.equal(voiceErrorHintKey({ code: 'voice-login' }), 'voice.error-hint-login');
  const asked = [];
  setVoiceAccessGate(info => { asked.push(info ?? null); return false; });
  assert.equal(voiceAccessAllowed(), false);
  assert.equal(voiceAccessAllowed({ denied: true }), false);
  assert.deepEqual(asked, [null, { denied: true }]);
  setVoiceAccessGate(() => { throw new Error('panel spadol'); });
  assert.equal(voiceAccessAllowed(), true, 'chyba brány hlas nezablokuje — posledná kontrola je server');
  setVoiceAccessGate(null);
  assert.equal(voiceAccessAllowed(), true);
});
