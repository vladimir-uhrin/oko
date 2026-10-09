#!/usr/bin/env node
// scripts/sk-terrain-cache-prune.mjs — ručné upratanie write-through cache upstream terénu (2026-10-09).
// Proxy /api/sk-terrain to isté robí sama pri štarte a raz za hodinu (vite.config.js skTerrainProxy);
// tento skript je na kontrolu a na okamžité upratanie.
//
//   node scripts/sk-terrain-cache-prune.mjs [--dry-run] [--max-mb 2048] [--max-days 30] [--dir <priečinok>]
//
// Limity: argumenty > .env (SK_TERRAIN_UPSTREAM_CACHE_MAX_MB / _MAX_DAYS, čítané ako v proxy cez loadEnv)
// > predvolené 2 GB / 30 dní. Vypíše počet a veľkosť pred, zmazané a čo ostáva.
import path from 'node:path';
import { loadEnv } from 'vite';
import { formatMb, pruneUpstreamCache, upstreamCacheLimits } from './lib/skTerrainUpstreamCache.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const dryRun = process.argv.includes('--dry-run');
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
if (arg('max-mb') !== undefined) env.SK_TERRAIN_UPSTREAM_CACHE_MAX_MB = arg('max-mb');
if (arg('max-days') !== undefined) env.SK_TERRAIN_UPSTREAM_CACHE_MAX_DAYS = arg('max-days');
const limits = upstreamCacheLimits(env);
const dir = path.resolve(arg('dir') || path.join('.gev-cache', 'sk-terrain-upstream'));

const r = await pruneUpstreamCache(dir, { limits, dryRun });
console.log(`priečinok: ${dir}`);
console.log(`strop: ${formatMb(limits.maxBytes)} / ${Math.round(limits.maxAgeMs / 86_400_000)} dní${dryRun ? ' — dry-run, nič sa nemaže' : ''}`);
console.log(`pred: ${r.scanned} dlaždíc, ${formatMb(r.totalBytes)}`);
console.log(`${dryRun ? 'na zmazanie' : 'zmazaných'}: ${r.deleted} dlaždíc, ${formatMb(r.deletedBytes)}`);
console.log(`ostáva: ${r.kept} dlaždíc, ${formatMb(r.keptBytes)}`);
