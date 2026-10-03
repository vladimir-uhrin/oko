// src/data/aiTranslatorsClient.js — hlas vlastníka a rozpoznávanie reči zo služby ai-translators.com
// (vlastníkova služba) pre server OKO (2026-10-03, vlastník: „sprav" k automatizácii bez môjho konektora).
// Služba nemá verejné REST API, ale jej MCP rozhranie (Streamable HTTP, JSON-RPC 2.0) má známe nástroje:
//   ai_translators_read_aloud(text, lang, voice 'own') → podpísaný odkaz na WAV (24 h),
//   ai_translators_subtitle_video(url) → úloha → ai_translators_job_status → history_id →
//   ai_translators_get_history → cues[].source_text (čo rozpoznávač počul).
// Kľúč `AI_TRANSLATORS_MCP_KEY` (.env, nikdy do prehliadača; rovnaké meno ako v Codexe vlastníka) ide v hlavičke
// Authorization; adresa `AI_TRANSLATORS_MCP_URL` (domáca sieť http://192.168.2.43:9140/mcp alebo verejná). Odpoveď
// môže byť JSON alebo SSE (text/event-stream) — oboje sa parsuje. Volania sú po jednom (služba pri
// viac než ~5 súbežných úlohách vracia 429). Časový limit volania 300 s ako `tool_timeout_sec` v Codexe
// vlastníka; keď služba reláciu zabudne (404 na Mcp-Session-Id, napr. po reštarte), klient sa raz
// znova predstaví a volanie zopakuje.

export const AI_TRANSLATORS_URL = 'https://www.ai-translators.com/mcp';

/** Verejná doména služby — cez ňu ide podpísaný odkaz na nahrávku do prepisu, keď ukazuje do domácej siete. */
export const AI_TRANSLATORS_MEDIA_ORIGIN = 'https://www.ai-translators.com';
const HOST_REFUSED = /host is not allowed/i;

/** Nastavenie z prostredia: adresa, kľúč (aj staršie meno AI_TRANSLATORS_TOKEN), verejná doména pre odkazy. Pure. */
export function aiTranslatorsConfig(env = {}) {
  const token = String(env.AI_TRANSLATORS_MCP_KEY || env.AI_TRANSLATORS_TOKEN || '').trim();
  const url = String(env.AI_TRANSLATORS_MCP_URL || '').trim() || AI_TRANSLATORS_URL;
  const mediaOrigin = String(env.AI_TRANSLATORS_MEDIA_ORIGIN || '').trim() || AI_TRANSLATORS_MEDIA_ORIGIN;
  return { url, token, mediaOrigin };
}

/** Adresa v domácej sieti alebo na tomto počítači (localhost, 10/8, 172.16/12, 192.168/16, ::1). Pure. */
export function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** Podpísaný odkaz z domácej siete prepísaný na verejnú doménu (cesta aj podpis ostávajú); iný odkaz nemenený. Pure. */
export function publicMediaUrl(url, mediaOrigin = AI_TRANSLATORS_MEDIA_ORIGIN) {
  if (!mediaOrigin) return url;
  try {
    const u = new URL(url);
    if (!isPrivateHost(u.hostname)) return url;
    return new URL(u.pathname + u.search, mediaOrigin).href;
  } catch {
    return url;
  }
}

const PROTOCOL = '2025-06-18';

/** JSON-RPC správa z tela odpovede (JSON alebo SSE `data:` riadky). Pure. */
export function parseMcpBody(contentType, text) {
  const ct = String(contentType || '');
  if (ct.includes('text/event-stream')) {
    const messages = [];
    for (const block of String(text || '').split(/\n\n+/)) {
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data) continue;
      try { messages.push(JSON.parse(data)); } catch { /* iný rámec */ }
    }
    return messages.find((m) => m && Object.hasOwn(m, 'result')) || messages.find((m) => m && m.error) || messages[0] || null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

/** Obsah výsledku nástroja: `structuredContent`, inak prvý textový obsah ako JSON/text. Pure. */
export function toolResultValue(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = (result.content || []).find((c) => c?.type === 'text')?.text;
  if (text === undefined) return result;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * @param {{url?: string, token: string, mediaOrigin?: string, fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void>, now?: () => number,
 *   timeoutMs?: number, pollMs?: number, jobTimeoutMs?: number}} opts
 */
export function createAiTranslatorsClient({ url = AI_TRANSLATORS_URL, token, mediaOrigin = AI_TRANSLATORS_MEDIA_ORIGIN, fetchImpl = (...a) => globalThis.fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), timeoutMs = 300_000, pollMs = 3_000, jobTimeoutMs = 10 * 60_000 } = {}) {
  if (!token) throw Object.assign(new Error('AI_TRANSLATORS_MCP_KEY chýba'), { code: 'NO_TOKEN' });
  let session = null;
  let nextId = 1;
  let initialized = false;

  async function rpc(method, params, { notify = false } = {}) {
    const id = notify ? undefined : nextId++;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session = sid;
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('ai-translators: token neplatí'), { code: 'AUTH', status: res.status });
    if (res.status === 429) throw Object.assign(new Error('ai-translators: priveľa požiadaviek (429)'), { code: 'RATE', status: 429 });
    if (notify) return null;
    const text = await res.text();
    const msg = parseMcpBody(res.headers.get('content-type'), text);
    if (!res.ok) throw Object.assign(new Error(`ai-translators: HTTP ${res.status}`), { code: 'HTTP', status: res.status, body: text.slice(0, 300) });
    if (!msg) throw Object.assign(new Error('ai-translators: nečitateľná odpoveď'), { code: 'BAD_BODY' });
    if (msg.error) throw Object.assign(new Error(`ai-translators: ${msg.error.message || 'chyba'}`), { code: 'RPC', rpc: msg.error });
    return msg.result;
  }
  async function ensureInit() {
    if (initialized) return;
    await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'oko-event-video', version: '1' } });
    await rpc('notifications/initialized', {}, { notify: true }).catch(() => {});
    initialized = true;
  }
  async function call(name, args, { retried = false } = {}) {
    await ensureInit();
    let result;
    try {
      result = await rpc('tools/call', { name, arguments: args });
    } catch (error) {
      if (!retried && error?.code === 'HTTP' && error.status === 404 && session) { session = null; initialized = false; return call(name, args, { retried: true }); }
      throw error;
    }
    if (result?.isError) throw Object.assign(new Error(`ai-translators ${name}: ${toolResultValue(result)}`), { code: 'TOOL' });
    return toolResultValue(result);
  }

  return {
    call,
    /** Veta hlasom vlastníka → `{url, seconds}` (podpísaný odkaz na WAV, 24 h). */
    async readAloud(text, { voice = 'own', lang = 'sk' } = {}) {
      const r = await call('ai_translators_read_aloud', { params: { text, lang, voice } });
      if (!r?.url) throw Object.assign(new Error('ai-translators: bez odkazu na zvuk'), { code: 'NO_URL' });
      return { url: r.url, seconds: Number(r.seconds) || null, engine: r.engine || null };
    },
    /**
     * Prepis nahrávky (odkaz na WAV) → text, ktorý rozpoznávač počul (čaká na úlohu). Odkaz z domácej
     * inštancie ukazuje na adresu v domácej sieti, ktorú služba pri sťahovaní odmieta („URL host is not
     * allowed") — ten istý podpísaný odkaz ide preto cez verejnú doménu (`mediaOrigin`); keby odmietla
     * aj tú, skúsi sa pôvodný odkaz.
     */
    async transcribe(wavUrl, { lang = 'sk' } = {}) {
      const run = async (url) => {
        const job = await call('ai_translators_subtitle_video', { params: { url, source: lang, target: lang } });
        const started = now();
        let status = job;
        while (status && !['completed', 'error', 'cancelled', 'failed'].includes(status.status)) {
          if (now() - started > jobTimeoutMs) throw Object.assign(new Error('ai-translators: prepis trvá pridlho'), { code: 'TIMEOUT' });
          await sleep(pollMs);
          status = await call('ai_translators_job_status', { job_id: job.job_id });
        }
        if (!status || status.status !== 'completed' || !status.history_id) throw Object.assign(new Error(`ai-translators: prepis zlyhal (${status?.message || status?.status || '?'})`), { code: 'ASR_FAILED', detail: status?.message || '' });
        const item = await call('ai_translators_get_history', { history_id: status.history_id });
        return (item?.cues || []).map((c) => String(c.source_text || '').trim()).filter(Boolean).join(' ');
      };
      const first = publicMediaUrl(wavUrl, mediaOrigin);
      try {
        return await run(first);
      } catch (error) {
        if (error?.code === 'ASR_FAILED' && HOST_REFUSED.test(error.detail) && first !== wavUrl) return run(wavUrl);
        throw error;
      }
    },
    async health() { return call('ai_translators_health', {}); },
  };
}
