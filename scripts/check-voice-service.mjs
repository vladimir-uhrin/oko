// OKO — overenie hlasovej služby ai-translators pre video k udalostiam (2026-10-03). Číta .env
// (AI_TRANSLATORS_MCP_URL, AI_TRANSLATORS_MCP_KEY), zavolá health, prečíta krátku vetu hlasom
// vlastníka a nechá ju rozpoznať — vypíše len výsledky (nikdy kľúč ani podpísané odkazy).
//
//   node scripts/check-voice-service.mjs [--no-speech] [--text "veta"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiTranslatorsConfig, createAiTranslatorsClient } from '../src/data/aiTranslatorsClient.js';
import { narrationHeardMatches } from '../src/data/eventNarration.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* bez .env */ }

const cfg = aiTranslatorsConfig(env);
console.log(`[hlas] adresa: ${cfg.url}`);
console.log(`[hlas] kľúč: ${cfg.token ? 'nastavený' : 'CHÝBA (AI_TRANSLATORS_MCP_KEY v .env)'}`);
if (!cfg.token) process.exit(2);
const client = createAiTranslatorsClient(cfg);
const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
try {
  const health = await client.health();
  console.log(`[hlas] health (${since()}):`, typeof health === 'object' ? JSON.stringify(health).slice(0, 300) : String(health).slice(0, 300));
} catch (error) {
  console.log(`[hlas] health zlyhal (${since()}): ${error.code || ''} ${error.message}`);
  process.exit(1);
}
if (args.includes('--no-speech')) process.exit(0);
const text = flag('--text', 'Sledujte živú premávku na okolajv bodka es ká.');
try {
  const r = await client.readAloud(text);
  console.log(`[hlas] read_aloud (${since()}): ${r.seconds ?? '?'} s zvuku, odkaz ${r.url ? 'áno' : 'nie'}, engine ${r.engine || '?'}`);
  const heard = await client.transcribe(r.url);
  const check = narrationHeardMatches(text, heard);
  console.log(`[hlas] prepis (${since()}): „${heard}" → ${check.ok ? 'sedí' : `nesedí (chýba: ${check.missing.join(', ')})`}`);
} catch (error) {
  console.log(`[hlas] reč zlyhala (${since()}): ${error.code || ''} ${error.message}`);
  process.exit(1);
}
