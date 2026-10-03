// src/data/aiTranslatorsClient.test.mjs — klient služby ai-translators (MCP JSON-RPC cez HTTP) pre server OKO
// (2026-10-03). Testy SPRÁVANIA proti falošnému MCP serveru: initialize + relácia, hlas vlastníka → odkaz na WAV,
// prepis = úloha → stav → história → text, chýbajúci/zlý token, 429, chyba nástroja; token nikdy v tele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAiTranslatorsClient } from './aiTranslatorsClient.js';

async function fakeServer(t, { token = 'tajny-token', sse = false } = {}) {
  const calls = [];
  const jobs = new Map();
  let sessions = 0;
  const state = { forgetSession: false, allowHosts: null };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid_token"}'); return; }
      const msg = JSON.parse(body);
      calls.push({ method: msg.method, name: msg.params?.name, args: msg.params?.arguments, session: req.headers['mcp-session-id'] || null, auth: req.headers.authorization });
      if (state.forgetSession && req.headers['mcp-session-id']) { state.forgetSession = false; res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: 'Session not found' } })); return; }
      if (msg.method === 'initialize') { sessions += 1; res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': `sess-${sessions}` }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' } } })); return; }
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
      } else if (name === 'ai_translators_subtitle_video') {
        // ako skutočná služba: úloha sa prijme vždy, odmietnutie hostiteľa odkazu príde až v stave úlohy
        const id = `job-${jobs.size + 1}`;
        jobs.set(id, { host: new URL(a.params.url).host, polls: 0 });
        reply({ job_id: id, status: 'queued', progress: 0, message: '', history_id: null, kind: 'subtitles' });
      } else if (name === 'ai_translators_job_status') {
        const job = jobs.get(a.job_id);
        job.polls += 1;
        if (state.allowHosts && !state.allowHosts.includes(job.host)) reply({ job_id: a.job_id, status: 'error', progress: 0, message: 'URL host is not allowed', history_id: null });
        else reply(job.polls < 2 ? { job_id: a.job_id, status: 'running', progress: 40 } : { job_id: a.job_id, status: 'completed', progress: 100, history_id: 'hist-1' });
      } else if (name === 'ai_translators_get_history') reply({ id: 'hist-1', cues: [{ start: 0.2, end: 2.1, source_text: 'Potom deväť minút bez údajov.', translated: 'x' }] });
      else reply({ error: 'unknown tool' }, true);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, calls, state };
}

test('zabudnutá relácia (404 na Mcp-Session-Id, napr. po reštarte služby): klient sa raz znova predstaví a volanie zopakuje', async (t) => {
  const { url, calls, state } = await fakeServer(t);
  const client = createAiTranslatorsClient({ url, token: 'tajny-token' });
  await client.readAloud('prvá');
  state.forgetSession = true;
  const r = await client.readAloud('druhá');
  assert.equal(r.url, 'https://fake/tts/druh%C3%A1.wav');
  assert.deepEqual(calls.map((c) => c.method), ['initialize', 'notifications/initialized', 'tools/call', 'tools/call', 'initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(calls.at(-1).session, 'sess-2', 'po novom predstavení ide nová relácia');
  assert.equal(calls.at(-1).args.params.text, 'druhá');
});

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

test('nastavenie z prostredia: kľúč AI_TRANSLATORS_MCP_KEY (ako v Codexe vlastníka) alebo staršie AI_TRANSLATORS_TOKEN, adresa domácej siete alebo verejná', async () => {
  const { aiTranslatorsConfig, AI_TRANSLATORS_URL, AI_TRANSLATORS_MEDIA_ORIGIN } = await import('./aiTranslatorsClient.js');
  assert.deepEqual(aiTranslatorsConfig({}), { url: AI_TRANSLATORS_URL, token: '', mediaOrigin: AI_TRANSLATORS_MEDIA_ORIGIN });
  assert.deepEqual(aiTranslatorsConfig({ AI_TRANSLATORS_MCP_URL: 'http://192.168.2.43:9140/mcp', AI_TRANSLATORS_MCP_KEY: ' k1 ', AI_TRANSLATORS_MEDIA_ORIGIN: 'https://public.example' }), { url: 'http://192.168.2.43:9140/mcp', token: 'k1', mediaOrigin: 'https://public.example' });
  assert.equal(aiTranslatorsConfig({ AI_TRANSLATORS_TOKEN: 't', AI_TRANSLATORS_MCP_KEY: 'k' }).token, 'k', 'kľúč má prednosť');
  assert.equal(aiTranslatorsConfig({ AI_TRANSLATORS_TOKEN: 't' }).token, 't');
});

test('odkaz z domácej siete: do prepisu ide cez verejnú doménu (cesta a podpis ostávajú); verejný odkaz sa nemení', async () => {
  const { publicMediaUrl, isPrivateHost } = await import('./aiTranslatorsClient.js');
  assert.equal(publicMediaUrl('http://192.168.2.43:9110/api/tts/download/tts_1.wav?t=abc', 'https://public.example'), 'https://public.example/api/tts/download/tts_1.wav?t=abc');
  assert.equal(publicMediaUrl('https://www.ai-translators.com/api/tts/download/tts_1.wav?t=abc', 'https://public.example'), 'https://www.ai-translators.com/api/tts/download/tts_1.wav?t=abc');
  assert.equal(publicMediaUrl('nie-odkaz', 'https://public.example'), 'nie-odkaz');
  assert.equal(publicMediaUrl('http://10.0.0.5/x.wav', ''), 'http://10.0.0.5/x.wav', 'bez verejnej domény sa nemení');
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.2.43', '169.254.1.1', 'nas.local', '::1']) assert.ok(isPrivateHost(h), h);
  for (const h of ['www.ai-translators.com', '172.32.0.1', '8.8.8.8', '192.169.0.1', '']) assert.ok(!isPrivateHost(h), h);
});

test('prepis: služba odmieta domáce adresy („URL host is not allowed") → odkaz ide hneď cez verejnú doménu, jediná úloha', async (t) => {
  const { url, calls, state } = await fakeServer(t);
  state.allowHosts = ['public.example'];
  const client = createAiTranslatorsClient({ url, token: 'tajny-token', mediaOrigin: 'https://public.example', sleep: async () => {}, pollMs: 1 });
  const heard = await client.transcribe('http://192.168.2.43:9110/api/tts/download/tts_1.wav?t=abc');
  assert.equal(heard, 'Potom deväť minút bez údajov.');
  const submitted = calls.filter((c) => c.name === 'ai_translators_subtitle_video').map((c) => c.args.params.url);
  assert.deepEqual(submitted, ['https://public.example/api/tts/download/tts_1.wav?t=abc']);
});

test('prepis: keď verejnú doménu odmietne, skúsi sa pôvodný odkaz; iná chyba úlohy sa neopakuje', async (t) => {
  const { url, calls, state } = await fakeServer(t);
  state.allowHosts = ['192.168.2.43:9110'];
  const client = createAiTranslatorsClient({ url, token: 'tajny-token', mediaOrigin: 'https://public.example', sleep: async () => {}, pollMs: 1 });
  const heard = await client.transcribe('http://192.168.2.43:9110/api/tts/download/tts_1.wav?t=abc');
  assert.equal(heard, 'Potom deväť minút bez údajov.');
  const submitted = calls.filter((c) => c.name === 'ai_translators_subtitle_video').map((c) => c.args.params.url);
  assert.deepEqual(submitted, ['https://public.example/api/tts/download/tts_1.wav?t=abc', 'http://192.168.2.43:9110/api/tts/download/tts_1.wav?t=abc']);
  state.allowHosts = [];
  await assert.rejects(client.transcribe('http://192.168.2.43:9110/api/tts/download/tts_2.wav?t=x'), (e) => e.code === 'ASR_FAILED' && /host is not allowed/.test(e.message));
  assert.equal(calls.filter((c) => c.name === 'ai_translators_subtitle_video').length, 4, 'obe cesty odmietnuté = koniec, bez ďalších pokusov');
});
