// src/data/aiTranslatorsClient.test.mjs — klient služby ai-translators (MCP JSON-RPC cez HTTP) pre server OKO
// (2026-10-03). Testy SPRÁVANIA proti falošnému MCP serveru: initialize + relácia, hlas vlastníka → odkaz na WAV,
// prepis = úloha → stav → história → text, chýbajúci/zlý token, 429, chyba nástroja; token nikdy v tele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAiTranslatorsClient } from './aiTranslatorsClient.js';

async function fakeServer(t, { token = 'tajny-token', sse = false } = {}) {
  const calls = [];
  let polls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid_token"}'); return; }
      const msg = JSON.parse(body);
      calls.push({ method: msg.method, name: msg.params?.name, args: msg.params?.arguments, session: req.headers['mcp-session-id'] || null, auth: req.headers.authorization });
      if (msg.method === 'initialize') { res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' } } })); return; }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      const reply = (value, isError = false) => {
        const result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError };
        if (sse) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      const { name, arguments: a } = msg.params;
      if (name === 'ai_translators_read_aloud') {
        if (a.params.text.includes('429')) { res.writeHead(429); res.end(''); return; }
        if (a.params.text.includes('zlyhaj')) { reply('voice service down', true); return; }
        reply({ path: null, bytes: 100, seconds: 2.5, url: `https://fake/tts/${encodeURIComponent(a.params.text)}.wav`, engine: 'omnivoice-clone' });
      } else if (name === 'ai_translators_subtitle_video') reply({ job_id: 'job-1', status: 'queued', progress: 0 });
      else if (name === 'ai_translators_job_status') { polls += 1; reply(polls < 2 ? { job_id: 'job-1', status: 'running', progress: 40 } : { job_id: 'job-1', status: 'completed', progress: 100, history_id: 'hist-1' }); }
      else if (name === 'ai_translators_get_history') reply({ id: 'hist-1', cues: [{ start: 0.2, end: 2.1, source_text: 'Potom deväť minút bez údajov.', translated: 'x' }] });
      else reply({ error: 'unknown tool' }, true);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, calls };
}

test('hlas vlastníka: initialize s reláciou, read_aloud s voice own a lang sk → odkaz na WAV; token len v hlavičke', async (t) => {
  const { url, calls } = await fakeServer(t);
  const client = createAiTranslatorsClient({ url, token: 'tajny-token' });
  const r = await client.readAloud('Potom deväť minút bez údajov.');
  assert.equal(r.url, 'https://fake/tts/Potom%20dev%C3%A4%C5%A5%20min%C3%BAt%20bez%20%C3%BAdajov..wav');
  assert.equal(r.seconds, 2.5);
  assert.deepEqual(calls.map((c) => c.method), ['initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(calls[2].session, 'sess-1', 'relácia z initialize sa posiela ďalej');
  assert.deepEqual(calls[2].args, { params: { text: 'Potom deväť minút bez údajov.', lang: 'sk', voice: 'own' } });
  assert.ok(calls.every((c) => c.auth === 'Bearer tajny-token'));
  await client.readAloud('druhá');
  assert.equal(calls.filter((c) => c.method === 'initialize').length, 1, 'initialize len raz');
});

test('prepis: subtitle_video z odkazu → čakanie na stav → history → text rozpoznávača (aj cez SSE odpovede)', async (t) => {
  const { url, calls } = await fakeServer(t, { sse: true });
  const client = createAiTranslatorsClient({ url, token: 'tajny-token', sleep: async () => {}, pollMs: 1 });
  const heard = await client.transcribe('https://fake/tts/x.wav');
  assert.equal(heard, 'Potom deväť minút bez údajov.');
  const names = calls.filter((c) => c.name).map((c) => c.name);
  assert.deepEqual(names, ['ai_translators_subtitle_video', 'ai_translators_job_status', 'ai_translators_job_status', 'ai_translators_get_history']);
  assert.deepEqual(calls.find((c) => c.name === 'ai_translators_subtitle_video').args, { params: { url: 'https://fake/tts/x.wav', source: 'sk', target: 'sk' } });
});

test('chyby: bez tokenu sa klient nevytvorí, zlý token = AUTH, 429 = RATE, chyba nástroja = TOOL', async (t) => {
  const { url } = await fakeServer(t);
  assert.throws(() => createAiTranslatorsClient({ url, token: '' }), (e) => e.code === 'NO_TOKEN');
  await assert.rejects(createAiTranslatorsClient({ url, token: 'zly' }).readAloud('x'), (e) => e.code === 'AUTH');
  const client = createAiTranslatorsClient({ url, token: 'tajny-token' });
  await assert.rejects(client.readAloud('text 429'), (e) => e.code === 'RATE');
  await assert.rejects(client.readAloud('zlyhaj'), (e) => e.code === 'TOOL' && /voice service down/.test(e.message));
});
