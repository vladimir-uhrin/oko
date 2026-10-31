#!/usr/bin/env node
// scripts/aircraft-watch.mjs — strážca lietadiel verejných činiteľov z otvorených dát adsb.fi (2026-11-01).
//
//   node scripts/aircraft-watch.mjs --name fico-split --hex 440100 --area Split:43.5389:16.298:120 --until 2026-11-09
//
// Raz za minútu: poloha sledovaných hexov (adsb.fi /v2/hex) a biznis/štátne stroje stúpajúce
// v okruhu oblasti (/v2/lat/lon/dist). Udalosti → <out>/events.ndjson + riadok na stdout, body letu
// sledovaných strojov → <out>/track-<hex>.ndjson, stav (aj znak života) → <out>/state.json.
// Kľúč netreba. Logika a jej testy: scripts/lib/aircraftWatch.mjs. Výnimka CLAUDE.md: len verejní
// činitelia a stroje, ktorými letia — nie súkromné osoby.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatWatchEvent, observationFromAdsb, stepArea, stepTracked } from './lib/aircraftWatch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://opendata.adsb.fi/api/v2';
const UA = 'OKO/1.0 (+https://okolive.sk)';

function args(argv) {
  const out = { hex: [], interval: 60, name: 'watch', area: null, until: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--hex') { out.hex.push(...v.toLowerCase().split(',').filter(Boolean)); i += 1; }
    else if (k === '--area') {
      const [name, lat, lon, km] = v.split(':');
      out.area = { name, center: [Number(lat), Number(lon)], radiusKm: Number(km) || 100 };
      i += 1;
    } else if (k === '--until') { out.until = new Date(v).getTime(); i += 1; }
    else if (k === '--interval') { out.interval = Math.max(30, Number(v) || 60); i += 1; }
    else if (k === '--name') { out.name = v; i += 1; }
    else if (k === '--out') { out.out = path.resolve(v); i += 1; }
  }
  out.out ||= path.join(ROOT, '.gev-cache', 'aircraft-watch', out.name);
  return out;
}

const opt = args(process.argv.slice(2));
if (!opt.hex.length && !opt.area) {
  console.error('Použitie: --hex <hex[,hex]> a/alebo --area Názov:lat:lon:km [--until YYYY-MM-DD] [--name meno]');
  process.exit(2);
}
fs.mkdirSync(opt.out, { recursive: true });
const files = { events: path.join(opt.out, 'events.ndjson'), state: path.join(opt.out, 'state.json') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });

let saved = {};
try { saved = JSON.parse(fs.readFileSync(files.state, 'utf8')); } catch { saved = {}; }
const state = { tracked: saved.tracked || {}, areaSeen: saved.areaSeen || {}, polls: saved.polls || 0, errors: saved.errors || 0, lastError: null };

async function getAircraft(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body?.ac) ? body.ac : Array.isArray(body?.aircraft) ? body.aircraft : [];
}

async function emit(events) {
  for (const e of events) {
    console.log(`[strážca ${opt.name}] ${formatWatchEvent(e)}`);
    await fsp.appendFile(files.events, `${JSON.stringify(e)}\n`);
  }
}

async function tick() {
  const now = Date.now();
  state.polls += 1;
  for (const hex of opt.hex) {
    try {
      const list = await getAircraft(`${API}/hex/${hex}`);
      const obs = list.map((ac) => observationFromAdsb(ac, now)).find((o) => o && o.hex === hex) || null;
      const step = stepTracked(state.tracked[hex], obs, now);
      state.tracked[hex] = step.state;
      await emit(step.events);
      if (obs && (step.state.phase === 'air' || step.events.length)) {
        await fsp.appendFile(path.join(opt.out, `track-${hex}.ndjson`), `${JSON.stringify(obs)}\n`);
      }
    } catch (error) {
      // Chyba siete ≠ stroj zmizol: stav sa nekrokuje, aby nevzniklo falošné pristátie.
      state.errors += 1;
      state.lastError = `${stamp()} hex ${hex}: ${error?.message || error}`;
    }
    await sleep(1500);
  }
  if (opt.area) {
    try {
      const nm = Math.min(250, Math.ceil(opt.area.radiusKm / 1.852));
      const list = await getAircraft(`${API}/lat/${opt.area.center[0]}/lon/${opt.area.center[1]}/dist/${nm}`);
      const step = stepArea(state.areaSeen, list.map((ac) => observationFromAdsb(ac, now)), opt.area, now, opt.hex);
      state.areaSeen = step.seen;
      await emit(step.events);
    } catch (error) {
      state.errors += 1;
      state.lastError = `${stamp()} oblasť: ${error?.message || error}`;
    }
  }
  await fsp.writeFile(files.state, JSON.stringify({ ...state, updatedAt: new Date().toISOString(), pid: process.pid, until: opt.until ? new Date(opt.until).toISOString() : null }));
}

console.log(`[strážca ${opt.name}] štart ${stamp()} — hex ${opt.hex.join(',') || '—'}, oblasť ${opt.area ? `${opt.area.name} ${opt.area.radiusKm} km` : '—'}, do ${opt.until ? new Date(opt.until).toLocaleString('sk-SK') : 'zastavenia'}, výstup ${opt.out}`);
while (!opt.until || Date.now() < opt.until) {
  const started = Date.now();
  await tick();
  await sleep(Math.max(5_000, opt.interval * 1000 - (Date.now() - started)));
}
console.log(`[strážca ${opt.name}] koniec ${stamp()} (dosiahnutý --until)`);
