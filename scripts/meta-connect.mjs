#!/usr/bin/env node
// Napojenie Štúdia na Facebook stránku (2026-11-03). Vlastník vloží do .env tri dočasné hodnoty z Meta for Developers:
//   META_APP_ID=…               ID aplikácie (Nastavenia aplikácie → Základné)
//   META_APP_SECRET=…           tajný kľúč aplikácie (tamže)
//   META_SETUP_USER_TOKEN=…     krátkodobý token používateľa z Graph API Explorera (oprávnenia nižšie)
// Skript ho vymení za dlhodobý token, z neho vezme token stránky (pri dlhodobom tokene používateľa nevyprší),
// zapíše META_PAGE_ID, META_PAGE_TOKEN, META_IG_USER_ID do .env a dočasné hodnoty (tajný kľúč, token) z .env zmaže.
// Tokeny nikdy nevypíše.
//
//   node scripts/meta-connect.mjs              → zoznam stránok (nič nezapíše, ak ich je viac)
//   node scripts/meta-connect.mjs --page <ID>  → zapíše vybranú stránku
//   node scripts/meta-connect.mjs --check      → overí uložené META_PAGE_* (meno stránky, oprávnenia)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const VERSION = 'v23.0';
const NEEDED = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'];
const OPTIONAL = ['instagram_basic', 'instagram_content_publish', 'business_management'];

const raw = fs.readFileSync(envFile, 'utf8');
const bom = raw.startsWith('﻿') ? '﻿' : '';
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.slice(bom.length).split(/\r?\n/);
const env = {};
for (const line of lines) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }

async function graph(pathPart, params) {
  const url = new URL(`https://graph.facebook.com/${VERSION}/${pathPart}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    const msg = String(json?.error?.message || `HTTP ${res.status}`).replace(/access_token=[^&\s]+/g, 'access_token=***');
    throw new Error(`${pathPart.split('?')[0]}: ${msg}`);
  }
  return json;
}

function writeEnv(set, remove) {
  const out = []; const done = new Set();
  for (const line of lines) {
    const key = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    if (key && remove.includes(key)) continue;
    if (key && key in set) { if (!done.has(key)) out.push(`${key}=${set[key]}`); done.add(key); continue; }
    out.push(line);
  }
  while (out.length && out.at(-1) === '') out.pop();
  for (const [k, v] of Object.entries(set)) if (!done.has(k)) out.push(`${k}=${v}`);
  const tmp = `${envFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bom + out.join(eol) + eol);
  fs.renameSync(tmp, envFile);
}

if (args.includes('--check')) {
  if (!env.META_PAGE_ID || !env.META_PAGE_TOKEN) { console.log('META_PAGE_ID / META_PAGE_TOKEN v .env nie sú.'); process.exit(1); }
  const page = await graph(env.META_PAGE_ID, { fields: 'name,link,instagram_business_account', access_token: env.META_PAGE_TOKEN });
  const dbg = await graph('debug_token', { input_token: env.META_PAGE_TOKEN, access_token: env.META_PAGE_TOKEN }).catch(() => null);
  const d = dbg?.data || {};
  console.log(`stránka: ${page.name} (${env.META_PAGE_ID}) ${page.link || ''}`);
  console.log(`Instagram: ${env.META_IG_USER_ID ? env.META_IG_USER_ID : 'neprepojený'}`);
  if (d.scopes) console.log(`oprávnenia: ${d.scopes.join(', ')}`);
  console.log(`token platí: ${d.is_valid === false ? 'NIE' : 'áno'}, vyprší: ${d.expires_at ? new Date(d.expires_at * 1000).toISOString() : 'nikdy'}`);
  process.exit(0);
}

const missing = ['META_APP_ID', 'META_APP_SECRET', 'META_SETUP_USER_TOKEN'].filter((k) => !env[k]);
if (missing.length) { console.error(`V .env chýba: ${missing.join(', ')}`); process.exit(2); }

const long = await graph('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: env.META_SETUP_USER_TOKEN });
const perms = await graph('me/permissions', { access_token: long.access_token });
const granted = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
const lack = NEEDED.filter((p) => !granted.includes(p));
console.log(`oprávnenia: ${granted.join(', ')}`);
if (lack.length) { console.error(`Token nemá: ${lack.join(', ')} — v Exploreri ich pridaj a vygeneruj token znova.`); process.exit(3); }
const optLack = OPTIONAL.filter((p) => !granted.includes(p));
if (optLack.length) console.log(`(pre Instagram chýba: ${optLack.join(', ')})`);

const accounts = await graph('me/accounts', { fields: 'id,name,access_token,instagram_business_account', limit: '100', access_token: long.access_token });
const pages = accounts.data || [];
if (!pages.length) { console.error('Účet nespravuje žiadnu stránku (alebo ju v dialógu povolení nevybral).'); process.exit(4); }
for (const p of pages) console.log(`  ${p.id}  ${p.name}${p.instagram_business_account ? `  · Instagram ${p.instagram_business_account.id}` : ''}`);
const wanted = flag('--page');
const page = wanted ? pages.find((p) => p.id === wanted) : pages.length === 1 ? pages[0] : null;
if (!page) { console.log(wanted ? `Stránka ${wanted} v zozname nie je.` : 'Viac stránok — spusti znova s --page <ID>.'); process.exit(wanted ? 5 : 0); }

const set = { META_PAGE_ID: page.id, META_PAGE_TOKEN: page.access_token };
if (page.instagram_business_account?.id) set.META_IG_USER_ID = page.instagram_business_account.id;
writeEnv(set, ['META_APP_SECRET', 'META_SETUP_USER_TOKEN']);
console.log(`Zapísané do .env: stránka ${page.name} (${page.id})${set.META_IG_USER_ID ? ` + Instagram ${set.META_IG_USER_ID}` : ''}. META_APP_SECRET a META_SETUP_USER_TOKEN zmazané.`);
console.log('Ďalej: Restart-Service oko-api (zmena .env).');
