// scripts/oko-dev-supervisor.mjs — strážca dev servera OKO pod službou Windows (2026-09-29).
//
// Vlastník: „potrebujem aj dobre nastaviť samotný server na PC, aby sa spúšťal s Windows a nepadal."
// Služba `oko-dev` (NSSM, scripts/install-oko-services.ps1) spúšťa tento skript a ten spustí Vite
// na localhost:4173 (/api a /s pre verejnú adresu). Keď Vite skončí, skončí aj strážca s jeho kódom
// a NSSM ho o pár sekúnd spustí znova. Keď Vite beží, ale neodpovedá (stojí event loop — 09-14 sa
// dev server po búrke reštartov Vite zasekol a pomohol až ručný reštart), strážca po `maxFailures`
// neúspešných kontrolách /robots.txt za sebou zabije celý strom procesov a skončí kódom 3 → NSSM
// ho spustí znova.
//
// Poistka proti slučke: najviac `hangRestartsPerHour` reštartov pre zaseknutie za hodinu (časy
// v súbore stavu, lebo strážca sa pri reštarte spúšťa nanovo). Potom už len zapisuje do logu —
// dlhá synchrónna práca pri štarte (napr. riedenie histórie letov) by inak server zabíjala dookola.
//
// Server sa viaže LEN na localhost (CLAUDE.md). Kľúče ostávajú v .env (číta ich Vite).
//
// Usage: node scripts/oko-dev-supervisor.mjs [--port 4173] [--interval 30000] [--timeout 15000]
//          [--grace 180000] [--max-failures 10] [--hang-restarts 3] [--busy-wait 60000]
//          [--state <súbor>] [-- <príkaz a argumenty namiesto Vite>]
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({
  port: 4173,
  intervalMs: 30_000,
  timeoutMs: 15_000,
  graceMs: 180_000,
  maxFailures: 10,
  hangRestartsPerHour: 3,
  busyWaitMs: 60_000,
});

/** Nový stav sledovania jedného behu Vite (pure). */
export function createHealthState(startedAt) {
  return { startedAt, everHealthy: false, failures: 0 };
}

/**
 * Zapíše výsledok jednej kontroly a vráti nový stav s verdiktom (pure):
 * 'ok' — odpovedá; 'grace' — ešte štartuje (do prvej odpovede, najdlhšie `graceMs`);
 * 'failing' — neodpovedá, ale ešte nie dosť dlho; 'hung' — `maxFailures` neúspechov za sebou.
 */
export function recordHealth(state, ok, now, { graceMs = DEFAULTS.graceMs, maxFailures = DEFAULTS.maxFailures } = {}) {
  if (ok) return { state: { ...state, everHealthy: true, failures: 0 }, verdict: 'ok' };
  if (!state.everHealthy && now - state.startedAt < graceMs) return { state, verdict: 'grace' };
  const failures = state.failures + 1;
  return { state: { ...state, failures }, verdict: failures >= maxFailures ? 'hung' : 'failing' };
}

/**
 * Smie strážca reštartovať pre zaseknutie? Najviac `max` reštartov za `windowMs` (pure).
 * Vráti aj zoznam časov, ktoré ešte patria do okna (staré a budúce sa zahodia).
 */
export function hangRestartBudget(timestamps, now, { windowMs = 3_600_000, max = DEFAULTS.hangRestartsPerHour } = {}) {
  const recent = (Array.isArray(timestamps) ? timestamps : [])
    .filter((t) => Number.isFinite(t) && t <= now && now - t < windowMs);
  return { allowed: recent.length < max, recent };
}

/** Argumenty príkazového riadka → nastavenia (pure). Za `--` ide vlastný príkaz namiesto Vite. */
export function parseArgs(argv) {
  const opts = {
    port: DEFAULTS.port,
    intervalMs: DEFAULTS.intervalMs,
    timeoutMs: DEFAULTS.timeoutMs,
    graceMs: DEFAULTS.graceMs,
    maxFailures: DEFAULTS.maxFailures,
    hangRestartsPerHour: DEFAULTS.hangRestartsPerHour,
    busyWaitMs: DEFAULTS.busyWaitMs,
    state: null,
    command: null,
  };
  const numbers = {
    '--port': 'port', '--interval': 'intervalMs', '--timeout': 'timeoutMs', '--grace': 'graceMs',
    '--max-failures': 'maxFailures', '--hang-restarts': 'hangRestartsPerHour', '--busy-wait': 'busyWaitMs',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { opts.command = argv.slice(i + 1); break; }
    if (arg === '--state') { opts.state = argv[i + 1] || null; i += 1; continue; }
    const key = numbers[arg];
    if (!key) throw new Error(`unknown argument: ${arg}`);
    const value = Number(argv[i + 1]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`bad value for ${arg}: ${argv[i + 1]}`);
    opts[key] = value;
    i += 1;
  }
  if (opts.command && opts.command.length === 0) throw new Error('empty command after --');
  return opts;
}

/** Príkaz Vite na localhost (pure). Bind nikdy nie 0.0.0.0 — CLAUDE.md. */
export function viteCommand(root, port, nodePath = process.execPath) {
  return [nodePath, path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', 'localhost', '--port', String(port), '--strictPort'];
}

/** Odpovedá URL do `timeoutMs` stavom 2xx? Nikdy nevyhodí. */
export function probe(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = http.get(url, { agent: false, timeout: timeoutMs }, (res) => {
      res.resume();
      done(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => { req.destroy(); done(false); });
    req.on('error', () => done(false));
  });
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch { /* stav je len poistka — bez neho strážca beží ďalej */ }
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** Zabije proces aj s potomkami (Vite → esbuild). Na Windows cez taskkill /T. */
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) { resolve(); return; }
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    } else {
      try { process.kill(pid, 'SIGKILL'); } catch { /* už nebeží */ }
      resolve();
    }
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const stateFile = opts.state || path.join(root, '.gev-cache', 'logs', 'oko-dev-supervisor.json');
  const healthUrl = `http://localhost:${opts.port}/robots.txt`;
  const log = (message) => console.log(`[oko-dev] ${stamp()} ${message}`);

  // Na porte už niečo odpovedá (iný dev server, Claude preview) — druhý Vite by padol na
  // --strictPort a NSSM by ho spúšťal dookola. Počkaj a skonči; NSSM to skúsi znova neskôr.
  if (await probe(healthUrl, Math.min(opts.timeoutMs, 3_000))) {
    log(`port ${opts.port} už odpovedá (iná inštancia) — čakám ${Math.round(opts.busyWaitMs / 1000)} s a končím`);
    await new Promise((r) => setTimeout(r, opts.busyWaitMs));
    process.exit(0);
  }

  const command = opts.command || viteCommand(root, opts.port);
  const startedAt = Date.now();
  log(`spúšťam ${command.map((part) => path.basename(part)).join(' ')} (node ${process.version}, koreň ${root})`);
  const child = spawn(command[0], command.slice(1), { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  let stopping = false;
  let health = createHealthState(startedAt);
  let probing = false;

  const timer = setInterval(async () => {
    if (probing || stopping) return;
    probing = true;
    const ok = await probe(healthUrl, opts.timeoutMs);
    probing = false;
    if (stopping) return;
    const next = recordHealth(health, ok, Date.now(), { graceMs: opts.graceMs, maxFailures: opts.maxFailures });
    if (next.verdict === 'ok' && !health.everHealthy) log(`odpovedá po ${Math.round((Date.now() - startedAt) / 1000)} s`);
    if (next.verdict === 'failing' && next.state.failures === 1) log('neodpovedá — sledujem');
    health = next.state;
    if (next.verdict !== 'hung') return;
    const saved = readState(stateFile);
    const budget = hangRestartBudget(saved.hangRestarts, Date.now(), { max: opts.hangRestartsPerHour });
    if (!budget.allowed) {
      log(`zaseknutý ${health.failures} kontrol za sebou, ale limit ${opts.hangRestartsPerHour} reštartov za hodinu je vyčerpaný — nechávam bežať`);
      health = { ...health, failures: 0 };
      return;
    }
    writeState(stateFile, { ...saved, hangRestarts: [...budget.recent, Date.now()] });
    log(`zaseknutý (${health.failures} kontrol bez odpovede) — zabíjam strom procesov a končím, služba ho spustí znova`);
    stopping = true;
    clearInterval(timer);
    await killTree(child.pid);
    process.exit(3);
  }, opts.intervalMs);

  child.on('exit', (code, signal) => {
    clearInterval(timer);
    if (stopping) return;
    log(`Vite skončil (kód ${code ?? '-'}, signál ${signal ?? '-'}) po ${Math.round((Date.now() - startedAt) / 1000)} s`);
    process.exit(code == null ? 1 : code);
  });
  child.on('error', (error) => {
    clearInterval(timer);
    log(`Vite sa nepodarilo spustiť: ${error.message}`);
    process.exit(1);
  });

  const stop = async (reason) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    log(`zastavujem (${reason})`);
    await killTree(child.pid);
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => { void stop(signal); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[oko-dev] ${stamp()} ${error?.stack || error}`);
    process.exit(1);
  });
}
