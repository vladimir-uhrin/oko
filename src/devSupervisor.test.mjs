// src/devSupervisor.test.mjs — strážca dev servera pod službou Windows (2026-09-29, vlastník:
// „aby sa spúšťal s Windows a nepadal"). Čisté funkcie (lehota pri štarte, zaseknutie, poistka
// proti slučke reštartov) aj skutočný beh: strážca spustí náhradný server, ten po chvíli zasekne
// event loop a strážca ho musí zabiť a skončiť kódom 3 (NSSM ho potom spustí znova).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS, createHealthState, recordHealth, hangRestartBudget, parseArgs, viteCommand,
} from '../scripts/oko-dev-supervisor.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/oko-dev-supervisor.mjs', import.meta.url));

test('lehota pri štarte: kým server raz neodpovie, neúspechy sa nerátajú (najdlhšie graceMs)', () => {
  const s0 = createHealthState(1_000);
  const a = recordHealth(s0, false, 1_000 + 60_000, { graceMs: 180_000, maxFailures: 3 });
  assert.equal(a.verdict, 'grace');
  assert.equal(a.state.failures, 0);
  const b = recordHealth(a.state, false, 1_000 + 181_000, { graceMs: 180_000, maxFailures: 3 });
  assert.equal(b.verdict, 'failing', 'po lehote sa neodpovedajúci štart ráta');
  assert.equal(b.state.failures, 1);
});

test('zaseknutie až po maxFailures neúspechoch za sebou; jedna odpoveď počítadlo nuluje', () => {
  let s = createHealthState(0);
  s = recordHealth(s, true, 10, { graceMs: 180_000, maxFailures: 3 }).state;
  assert.equal(s.everHealthy, true);
  let r = recordHealth(s, false, 20, { maxFailures: 3 });
  assert.equal(r.verdict, 'failing', 'po prvej odpovedi lehota neplatí');
  r = recordHealth(r.state, false, 30, { maxFailures: 3 });
  assert.equal(r.verdict, 'failing');
  const reset = recordHealth(r.state, true, 40, { maxFailures: 3 });
  assert.equal(reset.verdict, 'ok');
  assert.equal(reset.state.failures, 0);
  r = recordHealth(reset.state, false, 50, { maxFailures: 3 });
  r = recordHealth(r.state, false, 60, { maxFailures: 3 });
  r = recordHealth(r.state, false, 70, { maxFailures: 3 });
  assert.equal(r.verdict, 'hung');
});

test('predvolené hodnoty: kontrola každých 30 s, zaseknutie po 5 minútach bez odpovede, 3 minúty na štart', () => {
  assert.equal(DEFAULTS.intervalMs, 30_000);
  assert.equal(DEFAULTS.maxFailures * DEFAULTS.intervalMs, 300_000, 'krátke zastavenia (2–6 s, aj 42 s z 09-14) server nezabijú');
  assert.equal(DEFAULTS.graceMs, 180_000);
  assert.equal(DEFAULTS.hangRestartsPerHour, 3);
});

test('poistka proti slučke: najviac 3 reštarty pre zaseknutie za hodinu, staré časy vypadnú', () => {
  const now = 10_000_000;
  assert.equal(hangRestartBudget(undefined, now).allowed, true);
  assert.equal(hangRestartBudget([now - 1_000, now - 2_000], now).allowed, true);
  const full = hangRestartBudget([now - 1_000, now - 2_000, now - 3_000], now);
  assert.equal(full.allowed, false);
  const aged = hangRestartBudget([now - 3_700_000, now - 2_000, now - 3_000, 'x', now + 5_000], now);
  assert.equal(aged.allowed, true, 'čas starší ako hodina, nečíslo a budúci čas sa nerátajú');
  assert.deepEqual(aged.recent, [now - 2_000, now - 3_000]);
});

test('argumenty: čísla, stav, vlastný príkaz za --; neznámy alebo zlý argument je chyba', () => {
  const opts = parseArgs(['--port', '4180', '--interval', '100', '--max-failures', '2', '--state', 'x.json', '--', 'node', 'child.mjs']);
  assert.equal(opts.port, 4180);
  assert.equal(opts.intervalMs, 100);
  assert.equal(opts.maxFailures, 2);
  assert.equal(opts.state, 'x.json');
  assert.deepEqual(opts.command, ['node', 'child.mjs']);
  assert.throws(() => parseArgs(['--bogus', '1']), /unknown argument/);
  assert.throws(() => parseArgs(['--port', 'abc']), /bad value/);
  assert.throws(() => parseArgs(['--']), /empty command/);
});

test('Vite sa spúšťa len na localhost so --strictPort (CLAUDE.md: nikdy 0.0.0.0)', () => {
  const cmd = viteCommand('C:\\AI\\OKO\\oko', 4173, 'node');
  assert.deepEqual(cmd.slice(2), ['--host', 'localhost', '--port', '4173', '--strictPort']);
  assert.match(cmd[1], /node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/);
  assert.ok(!cmd.includes('0.0.0.0'));
});

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

function fakeServer(dir) {
  const file = path.join(dir, 'fake-server.mjs');
  writeFileSync(file, [
    "import http from 'node:http';",
    "import fs from 'node:fs';",
    'const [port, pidFile, blockAfterMs] = process.argv.slice(2);',
    'fs.writeFileSync(pidFile, String(process.pid));',
    "http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); }).listen(Number(port), 'localhost');",
    'setTimeout(() => { const end = Date.now() + 60_000; while (Date.now() < end) { /* zaseknutý event loop */ } }, Number(blockAfterMs));',
  ].join('\n'));
  return file;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killQuietly(pid) {
  if (!pid || !alive(pid)) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* už nebeží */ } }
}

function runSupervisor(args) {
  const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited, output: () => out };
}

test('zaseknutý server: strážca zabije strom procesov, zapíše čas reštartu a skončí kódom 3', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-sup-'));
  const port = await freePort();
  const pidFile = path.join(dir, 'child.pid');
  const state = path.join(dir, 'state.json');
  const run = runSupervisor(['--port', String(port), '--interval', '150', '--timeout', '150', '--grace', '3000', '--max-failures', '3', '--state', state,
    '--', process.execPath, fakeServer(dir), String(port), pidFile, '800']);
  let childPid = 0;
  try {
    const code = await run.exited;
    childPid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(code, 3, run.output());
    assert.match(run.output(), /odpovedá po/);
    assert.match(run.output(), /zaseknutý \(3 kontrol bez odpovede\)/);
    const saved = JSON.parse(readFileSync(state, 'utf8'));
    assert.equal(saved.hangRestarts.length, 1);
    for (let i = 0; i < 40 && alive(childPid); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(childPid), false, 'zaseknutý proces musí byť zabitý, inak drží port');
  } finally {
    killQuietly(childPid || Number(existsSync(pidFile) ? readFileSync(pidFile, 'utf8') : 0));
  }
});

test('vyčerpaná poistka: zaseknutý server sa nezabíja, strážca len zapíše do logu', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-sup-'));
  const port = await freePort();
  const pidFile = path.join(dir, 'child.pid');
  const state = path.join(dir, 'state.json');
  const now = Date.now();
  writeFileSync(state, JSON.stringify({ hangRestarts: [now - 60_000, now - 120_000, now - 180_000] }));
  const run = runSupervisor(['--port', String(port), '--interval', '150', '--timeout', '150', '--grace', '3000', '--max-failures', '3', '--state', state,
    '--', process.execPath, fakeServer(dir), String(port), pidFile, '800']);
  try {
    for (let i = 0; i < 100 && !/limit 3 reštartov za hodinu je vyčerpaný/.test(run.output()); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.match(run.output(), /limit 3 reštartov za hodinu je vyčerpaný/);
    assert.equal(run.child.exitCode, null, 'strážca beží ďalej');
    assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), true, 'server sa nezabil');
    assert.equal(JSON.parse(readFileSync(state, 'utf8')).hangRestarts.length, 3, 'nový reštart sa nezapísal');
  } finally {
    run.child.kill();
    killQuietly(Number(existsSync(pidFile) ? readFileSync(pidFile, 'utf8') : 0));
  }
});

test('pád servera: strážca skončí s jeho kódom (služba ho spustí znova)', { timeout: 30_000 }, async () => {
  const port = await freePort();
  const run = runSupervisor(['--port', String(port), '--interval', '1000', '--', process.execPath, '-e', 'process.exit(7)']);
  assert.equal(await run.exited, 7, run.output());
  assert.match(run.output(), /Vite skončil \(kód 7/);
});

test('spustenie cez odkaz (služba oko-api volá <Base>/current/scripts/…, current = junction na vydanie): strážca naozaj beží', { timeout: 30_000 }, async () => {
  // 2026-10-01 naživo: Node cestu hlavného modulu rozbalí cez junction, import.meta.url ≠ argv[1] → main()
  // sa nespustil, proces hneď skončil kódom 0 a NSSM ho dookola spúšťal (služba „Paused").
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-sup-link-'));
  const link = path.join(dir, 'current');
  symlinkSync(path.dirname(SCRIPT), link, process.platform === 'win32' ? 'junction' : 'dir');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(link, path.basename(SCRIPT)), '--port', String(port), '--interval', '1000', '--', process.execPath, '-e', 'process.exit(7)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 7, `strážca musí spustiť server a skončiť s jeho kódom: ${out}`);
  assert.match(out, /spúšťam/);
});
