// scripts/dev-qa-instance.mjs
// Skúšobná inštancia OKO na inom porte (2026-10-07): všetky pluginy v jednom procese (rola full —
// bez OKO_ROLE a OKO_API_UPSTREAM), ale BEZ záznamu histórie letov (FLIGHT_HISTORY=off): druhý
// zapisovač by sa bil so službou oko-api o jednu databázu a strážca by míňal kredity OpenSky.
// Na overenie serverových zmien (/api, /s) pred vydaním — služba oko-dev na 4173 ich len preposiela
// vydanej kópii. Spustenie: node scripts/dev-qa-instance.mjs [port=4181]  (alebo cez .claude/launch.json).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 4181;
// AIS_STATE_PERSIST=off: skúšobná inštancia nesmie prepísať uložený stav AIS služby oko-api.
// ESTIMATES_SEED_URL (2026-10-11): bez Histórie by QA poznala len lietadlá stratené od svojho štartu — odhady
// (aj s cieľmi) si naplní zo zoznamu verejnej služby, nech sa dá hneď skúšať napr. preukotvenie z HFDL.
// ESTIMATES_ACCURACY_WRITE=off: merania presnosti odhadov nepísať do zdieľaného .gev-cache služby.
const env = { ...process.env, FLIGHT_HISTORY: 'off', AIS_STATE_PERSIST: 'off', ESTIMATES_ACCURACY_WRITE: 'off', ESTIMATES_SEED_URL: process.env.ESTIMATES_SEED_URL ?? 'https://okolive.sk/api/flights/estimated' };
delete env.OKO_ROLE;
delete env.OKO_API_UPSTREAM;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
console.log(`[qa-instance] OKO na http://localhost:${port} (rola full, história letov vypnutá) — Node ${process.version}`);
const child = spawn(process.execPath, [viteBin, '--host', 'localhost', '--port', String(port), '--strictPort'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { try { child.kill(); } catch { /* už skončil */ } });
