// OKO — dolovanie chýbajúcich údajov udalosti pred videom (2026-10-01, vlastník: „ešte by si mohol
// vydolovať chýbajúce dáta… a bol by workflow pre video super"). Rovnaký krok pre každú udalosť:
//   1. kde údaje chýbajú (diery počas udalosti, koniec údajov vo vzduchu) — src/data/eventDig.js,
//   2. pokrytie: koľko iných lietadiel siete v tom čase videli v okolí diery (vlastná história OKO),
//   3. ďalší let toho istého stroja (vlastná história): odkiaľ nabudúce vzlietol = kde stál,
//   4. voliteľne `--opensky`: archív letov OpenSky (/flights/aircraft, 4 kredity) — odhad letiska príletu,
//   5. čo doplniť zo správ: overené články udalosti a už uložené fakty; fakty s presnými citátmi sa
//      zapíšu cez POST /api/events/<id>/reported (src/data/eventReported.js) — nikdy dopočítaná trasa.
// Kľúče OpenSky sa čítajú z .env len v tomto procese a nevypisujú sa. Nič sa nezapisuje.
//
// Spustenie (beží služba oko-dev na localhoste):
//   node scripts/dig-event-data.mjs --event <id> [--url http://localhost:4173] [--db <flight-history.sqlite>] [--opensky]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DIG_DEFAULTS, eventHoles, gapCoverage, holeLine, nextDeparture } from '../src/data/eventDig.js';
import { airportsFromIndex } from '../src/data/airportNearest.js';
import { parseAirportIndex } from '../src/data/airportLookup.js';
import { landingPhrase, reportedFacts } from '../src/data/eventReported.js';
import { outletName } from '../src/data/eventPost.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const id = flag('--event');
if (!id || !/^[0-9a-f]{6}-\d{8}T\d{4}$/.test(id)) {
  console.error('[dig] chýba --event <hex>-RRRRMMDDTHHMM');
  process.exit(2);
}
const baseUrl = flag('--url', 'http://localhost:4173').replace(/\/+$/, '');
const env = (() => {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
      .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
  } catch { return {}; }
})();
const dbPath = flag('--db', env.FLIGHT_HISTORY_DB || path.join(root, '.gev-cache', 'flight-history.sqlite'));
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');

const res = await fetch(`${baseUrl}/api/events/${id}`);
if (!res.ok) { console.error(`[dig] udalosť ${id}: HTTP ${res.status}`); process.exit(1); }
const event = await res.json();
const holes = eventHoles(event);
console.log(`[dig] ${id} ${event.callsign || ''} ${event.reg || ''}: ${holes.length} miest bez údajov v okne udalosti`);

const db = fs.existsSync(dbPath) ? new DatabaseSync(dbPath, { readOnly: true }) : null;
if (!db) console.log(`[dig] história OKO ${dbPath} nie je — pokrytie a ďalší let sa preskočia`);
for (const hole of holes) {
  let cov = null;
  if (db && hole.kind === 'gap') {
    const pad = DIG_DEFAULTS.radiusKm / 111;
    const [s, n] = [Math.min(hole.a.lat, hole.b.lat) - pad, Math.max(hole.a.lat, hole.b.lat) + pad];
    const padLon = pad / Math.max(0.2, Math.cos((((s + n) / 2) * Math.PI) / 180));
    const [w, e] = [Math.min(hole.a.lon, hole.b.lon) - padLon, Math.max(hole.a.lon, hole.b.lon) + padLon];
    const rows = db.prepare('SELECT icao24, t, lat, lon, alt FROM fixes WHERE t BETWEEN ? AND ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?')
      .all(hole.fromT, hole.toT, Math.round(s * 1e5), Math.round(n * 1e5), Math.round(w * 1e5), Math.round(e * 1e5))
      .map((r) => [r.icao24, r.t, r.lat / 1e5, r.lon / 1e5, r.alt]);
    cov = gapCoverage(hole, rows, event.icao24);
  }
  console.log(`  • ${holeLine(hole, cov)}`);
  if (hole.kind === 'end' && db) {
    const fixes = db.prepare('SELECT t, lat, lon, alt, gnd FROM fixes WHERE icao24 = ? AND t > ? AND t <= ? ORDER BY t LIMIT 200')
      .all(event.icao24, hole.fromT, hole.fromT + DIG_DEFAULTS.nextLegDays * 86400)
      .map((r) => ({ t: r.t, lat: r.lat / 1e5, lon: r.lon / 1e5, altM: r.alt, gnd: r.gnd === 1 }));
    const airports = airportsFromIndex(parseAirportIndex(fs.readFileSync(path.join(root, 'src', 'data', 'local_data', 'airports', 'airports.geojsonl'), 'utf8')));
    const next = nextDeparture(fixes, hole.fromT, airports);
    if (!next) console.log(`    ďalší let: stroj sa v histórii OKO do ${DIG_DEFAULTS.nextLegDays} dní neobjavil (stojí, alebo mimo pokrytia)`);
    else if (next.airport) console.log(`    ďalší let: ${iso(next.t)} UTC z letiska ${next.airport.city || next.airport.name} (${next.airport.iata || next.airport.icao}) — odvodené: tam stál`);
    else console.log(`    ďalší let: prvý bod ${iso(next.t)} UTC vo výške ${Math.round((next.altM ?? 0) / 0.3048)} ft (${next.lat.toFixed(2)}, ${next.lon.toFixed(2)}) — letisko sa nedá odvodiť`);
  }
}

if (args.includes('--opensky')) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) {
    console.log('[dig] OpenSky: kľúče v .env nie sú — preskočené');
  } else {
    const tok = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(env.OPENSKY_CLIENT_ID)}&client_secret=${encodeURIComponent(env.OPENSKY_CLIENT_SECRET)}`,
    }).then((r) => r.json()).catch(() => ({}));
    if (!tok.access_token) {
      console.log('[dig] OpenSky: prihlásenie zlyhalo');
    } else {
      const day = Math.floor(event.firstT / 86400) * 86400;
      const r = await fetch(`https://opensky-network.org/api/flights/aircraft?icao24=${event.icao24}&begin=${day}&end=${day + 86399}`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const flights = r.ok ? await r.json() : [];
      const f = flights.find((x) => x.firstSeen <= event.lastT && x.lastSeen >= event.firstT) || null;
      console.log(`[dig] OpenSky /flights/aircraft: HTTP ${r.status}${f ? ` — ${f.estDepartureAirport || '?'} → ${f.estArrivalAirport || 'prílet neurčený'}, naposledy ${iso(f.lastSeen)} UTC` : ' — let v archíve nie je'}`);
    }
  }
}

const facts = reportedFacts(event);
console.log(`[dig] zo správ doplnené: ${facts.length ? facts.map((f) => (f.kind === 'landing' ? `${landingPhrase(f, 'sk')} ${iso(f.t)} UTC` : `pokles ${iso(f.fromT)}–${iso(f.t).slice(11)} UTC`) + ` (${f.domains.map(outletName).join(', ')})`).join('; ') : 'nič'}`);
const articles = (event.news?.trusted || []).filter((s) => /^https:\/\//.test(s?.url || ''));
if (articles.length) {
  console.log('[dig] overené články na prečítanie (presné citáty → POST /api/events/<id>/reported):');
  for (const s of articles) console.log(`  - ${outletName(s.domain)}: ${s.url}`);
}
db?.close();
