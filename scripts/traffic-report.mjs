#!/usr/bin/env node
// Prehľad skutočnej návštevnosti okolive.sk zo záznamu návštev v admin databáze (len na čítanie).
//
// Číta `.auth-data/admin.sqlite` (tabuľky visit_log, pageviews, traffic, live_history) a roztriedi
// zobrazenia na: človek / vlastník (tento stroj) / localhost / datacentrum (roboty s JS) / Meta proxy.
// Dôvod: hrubé počty v admine (Naživo, pageviews) zahŕňajú localhost (::1 = dev server), vlastníkove
// vlastné návštevy (vrátane Browser pane agenta, UA „Claude/…") a skenery z Google Cloud / AWS / Bing,
// takže bez triedenia vychádza návštevnosť niekoľkonásobne vyššia, než je ľudská.
//
// Použitie:  node scripts/traffic-report.mjs [--db cesta] [--owner ip,ip,...] [--days 30]
//   --owner  IP tohto stroja (predvolene dynamické IP Telekomu videné 10-2026); aktuálnu zistí
//            `curl https://okolive.sk/cdn-cgi/trace`. Riadky s UA „Claude/" sa rátajú vlastníkovi vždy.
// Nezapisuje nič, databázu otvára readOnly, takže sa dá spúšťať popri bežiacej službe oko-api.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = opt('--db', path.join(root, '.auth-data', 'admin.sqlite'));
const DAYS = Number(opt('--days', 30));
const OWNER = new Set(opt('--owner', '95.102.34.239,78.99.178.219,78.99.201.178,95.102.144.239').split(',').map(s => s.trim()).filter(Boolean));

const db = new DatabaseSync(DB, { readOnly: true });
const q = (sql, ...p) => db.prepare(sql).all(...p);
const day = ms => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Bratislava' });
const since = Date.now() - DAYS * 86400_000;

// Heuristika tried — IP rozsahy dátových centier, z ktorých chodia skenery s plným prehliadačom.
const isGcp = ip => /^(34|35)\.\d+/.test(ip) || ip.startsWith('104.197.');
const isAws = ip => /^(3|13|52|54)\.\d+/.test(ip) || ip.startsWith('142.147.');
const isBingRender = ip => ip.startsWith('205.169.39.');
const isHosting = ip => ip.startsWith('91.98.') || ip.startsWith('2a12:bec4') || ip.startsWith('2602:fb54');
export function classify(r) {
  if (r.ip === '::1' || r.ip === '127.0.0.1') return 'localhost';
  if (OWNER.has(r.ip) || /Claude\//.test(r.ua)) return 'vlastník/stroj';
  if (r.ip.startsWith('2a03:2880:')) return 'Meta proxy';
  if (['CN', 'TW'].includes(r.country) || isGcp(r.ip) || isAws(r.ip) || isBingRender(r.ip) || isHosting(r.ip)) return 'datacentrum/sken';
  return 'človek';
}

const rows = q('SELECT at, last_at, ip, country, city, ref, device, browser, os, lang, ua FROM visit_log WHERE at >= ? ORDER BY at', since)
  .map(r => ({ ...r, cls: classify(r), d: day(r.at), min: Math.max(0, r.last_at - r.at) / 60000 }));
const pad = (v, n) => String(v).padStart(n);

console.log(`Záznam návštev ${DB} — posledných ${DAYS} dní (čas Bratislava)\n`);
console.log('=== TRIEDY: trieda | zobrazení | unikátne IP | minút na webe ===');
const tot = {};
for (const r of rows) { const t = tot[r.cls] ??= { views: 0, ips: new Set(), min: 0 }; t.views++; t.ips.add(r.ip); t.min += r.min; }
for (const [k, t] of Object.entries(tot).sort((a, b) => b[1].views - a[1].views)) console.log(`${k.padEnd(18)} ${pad(t.views, 5)} ${pad(t.ips.size, 5)} ${pad(Math.round(t.min), 6)}`);

const H = rows.filter(r => r.cls === 'človek');
console.log('\n=== ĽUDIA PO DŇOCH: deň | zobrazení | unikátne IP | SK | cez Facebook | cez Google/Bing | minút ===');
const byDay = {};
for (const r of H) {
  const d = byDay[r.d] ??= { views: 0, ips: new Set(), sk: new Set(), fb: new Set(), g: new Set(), min: 0 };
  d.views++; d.ips.add(r.ip); d.min += r.min;
  if (r.country === 'SK') d.sk.add(r.ip);
  if (/facebook|instagram/.test(r.ref)) d.fb.add(r.ip);
  if (/google|bing|seznam|duckduckgo/.test(r.ref)) d.g.add(r.ip);
}
for (const d of Object.keys(byDay).sort()) { const x = byDay[d]; console.log(`${d} ${pad(x.views, 5)} ${pad(x.ips.size, 5)} ${pad(x.sk.size, 4)} ${pad(x.fb.size, 4)} ${pad(x.g.size, 4)} ${pad(Math.round(x.min), 6)}`); }
const uniq = new Set(H.map(r => r.ip)); const days = Object.keys(byDay).length || 1;
const last7 = H.filter(r => r.at >= Date.now() - 7 * 86400_000);
console.log(`\nĽudia spolu: ${H.length} zobrazení, ${uniq.size} unikátnych IP za ${days} dní (${(uniq.size / days).toFixed(1)} IP/deň); posledných 7 dní: ${new Set(last7.map(r => r.ip)).size} IP, ${last7.length} zobrazení`);
const cnt = (f) => { const m = {}; for (const r of H) { (m[f(r)] ??= new Set()).add(r.ip); } return Object.entries(m).map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k || '(priamo)'}=${n}`).join(', '); };
console.log('krajiny (IP):', cnt(r => r.country));
console.log('zdroj (IP):', cnt(r => r.ref.replace(/^(lm|l|m|www)\.facebook\.com$/, 'facebook.com').replace('com.google.android.googlequicksearchbox', 'google.com')));
console.log('zariadenie (IP):', cnt(r => r.device));
console.log('OS (IP):', cnt(r => r.os));
console.log('jazyk (IP):', cnt(r => r.lang));
const perIp = {};
for (const r of H) { const p = perIp[r.ip] ??= { min: 0, days: new Set(), views: 0 }; p.min += r.min; p.days.add(r.d); p.views++; }
const mins = Object.values(perIp).map(p => p.min).sort((a, b) => a - b);
if (mins.length) console.log(`čas na webe na IP (min): medián ${mins[Math.floor(mins.length / 2)].toFixed(1)}, priemer ${(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)}; ≥ 5 min: ${mins.filter(m => m >= 5).length}; odišli do 30 s: ${mins.filter(m => m < 0.5).length}; vrátili sa iný deň: ${Object.values(perIp).filter(p => p.days.size >= 2).length}`);

console.log('\n=== SERVER (pageviews): deň | zobrazení (všetky triedy) | návštevníci (hash) | roboty bez JS ===');
const pv = {};
for (const r of q("SELECT day, dim, val, n FROM pageviews WHERE dim IN ('views','visitors','bots') AND day >= ? ORDER BY day", day(since))) { (pv[r.day] ??= {})[r.dim] = (pv[r.day][r.dim] || 0) + r.n; }
for (const d of Object.keys(pv).sort()) console.log(`${d} ${pad(pv[d].views || 0, 5)} ${pad(pv[d].visitors ?? '-', 5)} ${pad(pv[d].bots || 0, 6)}`);

console.log('\n=== NAŽIVO (live_history): deň | max súbežne | minút s aspoň 1 návštevníkom ===');
const lh = {};
for (const r of q('SELECT at, n FROM live_history WHERE at >= ?', since)) { const d = lh[day(r.at)] ??= { max: 0, nz: 0 }; d.max = Math.max(d.max, r.n); if (r.n > 0) d.nz++; }
for (const d of Object.keys(lh).sort()) console.log(`${d} ${pad(lh[d].max, 4)} ${pad(lh[d].nz, 6)}`);
