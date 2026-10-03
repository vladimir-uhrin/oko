// src/serverGuards.test.mjs — tunel (cloudflared → localhost) a rozpočtové stráže proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isLoopbackAddress,
  isTunnelRequest,
  isGenuineLocalRequest,
  trustCloudflareProxy,
  resolveClientIp,
  positiveIntEnv,
  utcDayKey,
  createDailyBudget,
  exceedsFileCap,
} from './serverGuards.js';

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('isLoopbackAddress: IPv4 127/8, ::1, IPv4-mapped; LAN a prázdne nie', () => {
  for (const a of ['127.0.0.1', '127.0.1.1', '::1', '::ffff:127.0.0.1', ' 127.0.0.1 ']) assert.equal(isLoopbackAddress(a), true, a);
  for (const a of ['192.168.1.10', '10.0.0.1', '::ffff:192.168.1.2', '', null, undefined]) assert.equal(isLoopbackAddress(a), false, String(a));
});

test('tunel: CF-Connecting-IP alebo CF-Ray znamená internet, aj z loopback socketu', () => {
  assert.equal(isTunnelRequest(req('127.0.0.1')), false);
  assert.equal(isTunnelRequest(req('127.0.0.1', { 'cf-connecting-ip': '203.0.113.7' })), true);
  assert.equal(isTunnelRequest(req('127.0.0.1', { 'cf-ray': '8abc-VIE' })), true);
  assert.equal(isGenuineLocalRequest(req('127.0.0.1')), true, 'lokálny prehliadač');
  assert.equal(isGenuineLocalRequest(req('::1')), true);
  assert.equal(isGenuineLocalRequest(req('127.0.0.1', { 'cf-connecting-ip': '203.0.113.7' })), false, 'návštevník cez tunel');
  assert.equal(isGenuineLocalRequest(req('127.0.0.1', { 'cf-ray': 'x' })), false, 'CF-Ray bez IP — stále tunel');
  assert.equal(isGenuineLocalRequest(req('192.168.1.5')), false, 'LAN nie je lokálne');
  assert.equal(isGenuineLocalRequest({ headers: {} }), false, 'bez socketu fail-closed');
});

test('resolveClientIp: CF-Connecting-IP len so zapnutou dôverou A z loopback socketu A ak je to IP', () => {
  const tunnel = req('127.0.0.1', { 'cf-connecting-ip': '203.0.113.7' });
  assert.equal(resolveClientIp(tunnel, { trustCloudflare: true }), '203.0.113.7');
  assert.equal(resolveClientIp(req('::1', { 'cf-connecting-ip': '2001:db8::1' }), { trustCloudflare: true }), '2001:db8::1');
  assert.equal(resolveClientIp(tunnel, { trustCloudflare: false }), '127.0.0.1', 'bez dôvery socket (spoločný bucket)');
  assert.equal(resolveClientIp(req('192.168.1.5', { 'cf-connecting-ip': '203.0.113.7' }), { trustCloudflare: true }), '192.168.1.5', 'z ne-loopback socketu hlavička nič neznamená');
  assert.equal(resolveClientIp(req('127.0.0.1', { 'cf-connecting-ip': 'evil, 1.2.3.4' }), { trustCloudflare: true }), '127.0.0.1', 'nie-IP sa ignoruje');
  assert.equal(resolveClientIp(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' }), { trustCloudflare: true }), '127.0.0.1', 'XFF sa nikdy neberie');
  assert.equal(resolveClientIp({ headers: {} }, { trustCloudflare: true }), 'local');
  assert.equal(trustCloudflareProxy({ AUTH_TRUST_CLOUDFLARE_PROXY: 'true' }), true);
  assert.equal(trustCloudflareProxy({ AUTH_TRUST_CLOUDFLARE_PROXY: '1' }), false, 'len doslovné "true", ako auth backend');
  assert.equal(trustCloudflareProxy({}), false);
});

test('positiveIntEnv a utcDayKey', () => {
  assert.equal(positiveIntEnv('25', 10), 25);
  assert.equal(positiveIntEnv(undefined, 10), 10);
  assert.equal(positiveIntEnv('0', 10), 10);
  assert.equal(positiveIntEnv('-3', 10), 10);
  assert.equal(positiveIntEnv('abc', 0), 0);
  assert.equal(utcDayKey(Date.UTC(2026, 9, 3, 23, 59)), '2026-10-03');
});

test('createDailyBudget: strop, perzistencia, reset o polnoci UTC, odmietnutie nič nepočíta', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-budget-'));
  try {
    const filePath = path.join(dir, 'nested', 'b.json');
    let now = Date.UTC(2026, 9, 3, 12);
    const budget = createDailyBudget({ filePath, limit: () => 2, now: () => now });
    assert.deepEqual(await budget.tryConsume(), { ok: true, count: 1, limit: 2, date: '2026-10-03' });
    assert.equal((await budget.tryConsume()).ok, true);
    assert.deepEqual(await budget.tryConsume(), { ok: false, count: 2, limit: 2, date: '2026-10-03' });
    await budget.flush();
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), { date: '2026-10-03', count: 2 });

    // Reštart servera: nová inštancia číta súbor, strop drží.
    const again = createDailyBudget({ filePath, limit: () => 2, now: () => now });
    assert.equal((await again.tryConsume()).ok, false);
    assert.deepEqual(await again.snapshot(), { count: 2, limit: 2, date: '2026-10-03' });

    now = Date.UTC(2026, 9, 4, 0, 1);
    assert.deepEqual(await again.tryConsume(), { ok: true, count: 1, limit: 2, date: '2026-10-04' });
    await again.flush();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('createDailyBudget: poškodený súbor = nula; súbežné žiadosti neprekročia strop', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-budget-'));
  try {
    const filePath = path.join(dir, 'b.json');
    writeFileSync(filePath, '{nope');
    const budget = createDailyBudget({ filePath, limit: () => 3, now: () => Date.UTC(2026, 9, 3) });
    const results = await Promise.all(Array.from({ length: 10 }, () => budget.tryConsume()));
    assert.equal(results.filter((r) => r.ok).length, 3);
    await budget.flush();
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).count, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exceedsFileCap', () => {
  assert.equal(exceedsFileCap(0, 100, 100), false);
  assert.equal(exceedsFileCap(1, 100, 100), true);
  assert.equal(exceedsFileCap(undefined, 10, 100), false);
});

test('tripwire: vite.config.js zapája stráže do OpenAI a debug-log endpointov', () => {
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function clientKey\(req\) \{\s*return resolveClientIp\(req\);/);
  assert.match(vite, /const OPENAI_RATELIMIT_PER_MIN_DEFAULT = 10;/);
  assert.match(vite, /const OPENAI_REALTIME_DAILY_SESSION_BUDGET_DEFAULT = 50;/);
  assert.match(vite, /const OPENAI_HUD_SUMMARY_DAILY_BUDGET_DEFAULT = 5000;/);
  assert.match(vite, /makeOptInRateLimiter\(process\.env\.GEV_RATELIMIT_OPENAI_PER_MIN, OPENAI_RATELIMIT_PER_MIN_DEFAULT\)/);
  assert.match(vite, /makeOptInRateLimiter\(process\.env\.GEV_RATELIMIT_GOOGLE_PER_MIN\)/, 'Google ostáva opt-in');
  const proxy = vite.slice(vite.indexOf('function openAiRealtimeProxy()'));
  const hud = proxy.slice(proxy.indexOf("middlewares.use('/api/openai/hud-summary'"), proxy.indexOf("middlewares.use('/api/realtime/debug-log'"));
  assert.ok(hud.indexOf('enforceDailyBudget(hudSummaryBudget') > hud.indexOf('OPENAI_API_KEY is not set'), 'bez kľúča sa nepočíta');
  assert.ok(hud.indexOf('enforceDailyBudget(hudSummaryBudget') < hud.indexOf('api.openai.com'), 'strop pred upstreamom');
  const token = proxy.slice(proxy.indexOf("middlewares.use('/api/realtime/token'"));
  assert.ok(token.indexOf('enforceDailyBudget(realtimeBudget') > 0 && token.indexOf('enforceDailyBudget(realtimeBudget') < token.indexOf('api.openai.com'));
  assert.match(proxy, /JSON\.stringify\(\{ error: 'budget'/);
  const log = proxy.slice(proxy.indexOf("middlewares.use('/api/realtime/debug-log'"), proxy.indexOf("middlewares.use('/api/realtime/token'"));
  assert.ok(log.indexOf('isGenuineLocalRequest(req)') > 0 && log.indexOf('isGenuineLocalRequest(req)') < log.indexOf('readRequestBody'), 'tunel nezapisuje na disk');
  assert.ok(log.indexOf('exceedsFileCap(') < log.indexOf('appendFileSync'), 'celkový strop súboru pred zápisom');
});
