// OKO Štúdio (2026-10-03) — šablóny spravodajských príspevkov.
//
// Text sa skladá LEN z faktov v dátach (žiadna AI, nulové náklady): čas stavu,
// zdroj, miesto, hodnoty. Každá šablóna vracia { key, title, text, card } alebo
// null, keď nie je čo zverejniť. `key` je stabilný kľúč udalosti — rovnaká
// udalosť nikdy nevytvorí druhý návrh. Redakčné pravidlá: docs/SOCIAL-PLAN.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TZ = 'Europe/Bratislava';
const timeFmt = new Intl.DateTimeFormat('sk-SK', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('sk-SK', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' });
const dayKeyFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const countryNames = new Intl.DisplayNames(['sk'], { type: 'region' });
const num1 = value => value.toFixed(1).replace('.', ',');
/** Slovenský tvar podľa čísla: plural(3, 'zemetrasenie', 'zemetrasenia', 'zemetrasení'). */
export function plural(n, one, few, many) {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}
const ORBITS = { LEO: 'nízku obežnú dráhu', SSO: 'slnečno-synchrónnu dráhu', GTO: 'geostacionárnu prechodovú dráhu',
  GEO: 'geostacionárnu dráhu', MEO: 'strednú obežnú dráhu', PO: 'polárnu dráhu', HEO: 'vysoko eliptickú dráhu',
  TLI: 'dráhu k Mesiacu', 'Sub': 'suborbitálnu dráhu' };

export const time = at => timeFmt.format(new Date(at));
export const date = at => dateFmt.format(new Date(at));
export const dayKey = at => dayKeyFmt.format(new Date(at));
export function country(iso2) {
  try { return iso2 ? countryNames.of(String(iso2).toUpperCase()) : null; } catch { return null; }
}
/** „dnes o 14:32", „včera o 23:10", inak „3. 10. 2026 o 14:32". */
export function when(at, now) {
  const today = dayKey(now);
  const that = dayKey(at);
  if (that === today) return `dnes o ${time(at)}`;
  if (that === dayKey(now - 86400_000)) return `včera o ${time(at)}`;
  return `${date(at)} o ${time(at)}`;
}

// ── poloha: najbližšie väčšie mesto z Natural Earth (public domain) ─────────
let places = null;
function loadPlaces() {
  if (places) return places;
  const file = fileURLToPath(new URL('../../../data/local_data/natural_earth/places.json', import.meta.url));
  places = JSON.parse(readFileSync(file, 'utf8')).places.map(([name, lat, lon, pop, , iso2, capital]) => ({ name, lat, lon, pop, iso2, capital }));
  return places;
}
const rad = Math.PI / 180;
export function distanceKm(a, b) {
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
const DIRECTIONS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
/** Svetová strana bodu `to` vzhľadom na `from`. */
export function direction(from, to) {
  const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad);
  const bearing = (Math.atan2(y, x) / rad + 360) % 360;
  return DIRECTIONS[Math.round(bearing / 45) % 8];
}
/** Opis polohy po slovensky; null, ak nie je väčšie mesto do `maxKm`. */
export function describeLocation(point, maxKm = 600) {
  let best = null;
  for (const place of loadPlaces()) {
    const km = distanceKm(point, place);
    // Pri podobnej vzdialenosti uprednostni väčšie / hlavné mesto (známejší orientačný bod).
    const score = km - Math.min(80, Math.log10(Math.max(100, place.pop)) * 12) - (place.capital ? 25 : 0);
    if (km <= maxKm && (!best || score < best.score)) best = { place, km, score };
  }
  if (!best) return null;
  const countryName = country(best.place.iso2);
  const km = Math.round(best.km / 5) * 5;
  return {
    text: km < 15 ? `pri meste ${best.place.name}${countryName ? ` (${countryName})` : ''}`
      : `${km} km ${direction(best.place, point)} od mesta ${best.place.name}${countryName ? ` (${countryName})` : ''}`,
    country: countryName,
    iso2: best.place.iso2,
    km: best.km,
  };
}

const SK = { lat: 48.7, lon: 19.5 };
const hashtag = value => `#${String(value || '').replace(/[^\p{L}\p{N}]+/gu, '')}`;
function footer({ source, at, now, url, tags }) {
  return [`📡 Zdroj: ${source} · stav k ${when(at ?? now, now).replace(/^dnes o /, '')}`,
    `🌍 Naživo na glóbuse OKO: ${url}`, '', tags.filter(tag => tag.length > 1).join(' ')].join('\n');
}

// ── Zemetrasenie (udalosť) ────────────────────────────────────────────────
/** Prah: vo svete M ≥ 6, do 800 km od SK M ≥ 4, na Slovensku a okolí (300 km) M ≥ 2,5. */
export function quakeThreshold(quake) {
  const km = distanceKm(SK, quake);
  return km <= 300 ? 2.5 : km <= 800 ? 4 : 6;
}

export function earthquakeEvent({ records = [], fetchedAt }, { now, url }) {
  const fresh = records.filter(q => Number.isFinite(q.mag) && now - q.time <= 6 * 3600_000 && q.time <= now + 60_000);
  const qualifying = fresh.filter(q => q.mag >= quakeThreshold(q)).sort((a, b) => b.mag - a.mag);
  const quake = qualifying[0];
  if (!quake) return null;
  const where = describeLocation(quake);
  const mag = num1(quake.mag);
  const place = where?.text || (quake.place ? `oblasť: ${quake.place}` : 'odľahlá oblasť');
  const near = distanceKm(SK, quake) <= 800;
  const depth = Number.isFinite(quake.depth) ? ` Ohnisko v hĺbke ${Math.round(quake.depth)} km.` : '';
  const strength = quake.mag >= 7 ? 'Silné zemetrasenie' : quake.mag >= 6 ? 'Zemetrasenie' : 'Otrasy';
  const title = `${strength} M ${mag}${where?.country ? ` – ${where.country}` : ''}`;
  const text = [`🌋 ${title}`, '',
    `${when(quake.time, now).replace(/^./, c => c.toUpperCase())} zaznamenali seizmografy zemetrasenie s magnitúdou ${mag} — ${place}.${depth}`,
    ...(near ? ['', 'Udalosť je v blízkosti Slovenska; slabšie otrasy mohli byť cítiť aj u nás.'] : []),
    '', footer({ source: 'USGS', at: fetchedAt, now, url, tags: ['#zemetrasenie', hashtag(where?.country), '#OKO'] })].join('\n');
  return {
    key: `quake:${quake.sourceId || quake.id}`,
    title,
    text,
    card: { kind: 'quake', kicker: 'ZEMETRASENIE', big: `M ${mag}`, headline: where?.country || 'Zemetrasenie',
      hook: { text: `${strength.toUpperCase()} M ${mag}${where?.country ? ` – ${where.country.toUpperCase()}` : ''}`, accent: `M ${mag}` },
      lines: [place, `${when(quake.time, now)}${Number.isFinite(quake.depth) ? ` · hĺbka ${Math.round(quake.depth)} km` : ''}`],
      point: { lat: quake.lat, lon: quake.lon }, source: 'USGS', at: fetchedAt ?? now },
  };
}

// ── Prehľad zemetrasení za 24 h (raz denne) ───────────────────────────────
export function earthquakeDigest({ records = [], fetchedAt }, { now, url }) {
  const day = records.filter(q => Number.isFinite(q.mag) && now - q.time <= 86400_000);
  if (!day.length) return null;
  const strong = day.filter(q => q.mag >= 4.5).sort((a, b) => b.mag - a.mag);
  const top = strong.slice(0, 3).map(q => {
    const where = describeLocation(q);
    return `• M ${num1(q.mag)} — ${where?.country || q.place || 'odľahlá oblasť'} (${time(q.time)})`;
  });
  const nearSk = day.filter(q => distanceKm(SK, q) <= 300).length;
  const title = `Zemetrasenia za 24 hodín: ${day.length}`;
  const text = [`📊 ${title}`, '',
    `Za posledných 24 hodín zaznamenali seizmografy ${day.length} ${plural(day.length, 'zemetrasenie', 'zemetrasenia', 'zemetrasení')}, z toho ${strong.length} s magnitúdou 4,5 a viac.`,
    ...(top.length ? ['', 'Najsilnejšie:', ...top] : []),
    '', nearSk ? `Do 300 km od Slovenska: ${nearSk}.` : 'Do 300 km od Slovenska žiadne.',
    '', footer({ source: 'USGS', at: fetchedAt, now, url, tags: ['#zemetrasenie', '#prehľad', '#OKO'] })].join('\n');
  return {
    key: `quake-digest:${dayKey(now)}`,
    title,
    text,
    card: { kind: 'digest', kicker: 'PREHĽAD 24 H', big: String(day.length), headline: `${plural(day.length, 'zemetrasenie', 'zemetrasenia', 'zemetrasení')} za 24 hodín`,
      hook: { text: `${day.length} ${plural(day.length, 'ZEMETRASENIE', 'ZEMETRASENIA', 'ZEMETRASENÍ')} ZA 24 HODÍN`, accent: String(day.length) },
      lines: [`${strong.length} s magnitúdou ≥ 4,5`, ...(strong[0] ? [`najsilnejšie M ${num1(strong[0].mag)}`] : [])],
      points: strong.slice(0, 30).map(q => ({ lat: q.lat, lon: q.lon, size: q.mag })), source: 'USGS', at: fetchedAt ?? now },
  };
}

// ── Štart rakety (posledných 12 h) ────────────────────────────────────────
const STATUS = { Success: 'úspešný', Failure: 'neúspešný', 'Partial Failure': 'čiastočne neúspešný' };
export function launchEvent({ results = [] }, { now, url }) {
  const done = results.filter(launch => {
    const at = Date.parse(launch?.net);
    return Number.isFinite(at) && at <= now && now - at <= 12 * 3600_000 && STATUS[launch?.status?.abbrev];
  }).sort((a, b) => Date.parse(b.net) - Date.parse(a.net));
  const launch = done[0];
  if (!launch) return null;
  const at = Date.parse(launch.net);
  const rocket = launch.rocket?.configuration?.full_name || launch.rocket?.configuration?.name || 'raketa';
  const provider = launch.launch_service_provider?.name || '';
  const mission = launch.mission?.name || launch.name || '';
  const orbitSk = ORBITS[launch.mission?.orbit?.abbrev];
  const orbit = orbitSk ? ` na ${orbitSk}` : '';
  const pad = launch.pad?.location?.name || launch.pad?.name || '';
  const iso2 = launch.pad?.country?.alpha_2_code || launch.pad?.location?.country?.alpha_2_code || null;
  const status = STATUS[launch.status.abbrev];
  const lat = Number(launch.pad?.latitude); const lon = Number(launch.pad?.longitude);
  const title = `Štart ${rocket}: ${status}`;
  const text = [`🚀 ${title}`, '',
    `${when(at, now).replace(/^./, c => c.toUpperCase())} odštartovala raketa ${rocket}${provider ? ` (${provider})` : ''} s misiou ${mission}${orbit}. Štart bol ${status}.`,
    ...(pad ? [`Miesto štartu: ${pad}${country(iso2) ? ` (${country(iso2)})` : ''}.`] : []),
    '', footer({ source: 'Launch Library 2 — The Space Devs', at: now, now, url, tags: ['#vesmír', '#raketa', hashtag(provider.split(' ')[0]), '#OKO'] })].join('\n');
  return {
    key: `launch:${launch.id || launch.name}`,
    title,
    text,
    card: { kind: 'launch', kicker: 'ŠTART RAKETY', big: status.toUpperCase(), headline: rocket,
      hook: { text: `${rocket.toUpperCase()}: ŠTART ${status.toUpperCase()}`, accent: status.toUpperCase() },
      lines: [mission, `${when(at, now)}${pad ? ` · ${pad}` : ''}`],
      ...(Number.isFinite(lat) && Number.isFinite(lon) ? { point: { lat, lon } } : {}), source: 'The Space Devs', at: now },
  };
}

/** Register šablón: id → zdroj dát (loopback cesta) a funkcia. */
export const TEMPLATES = Object.freeze([
  { id: 'quake', label: 'Zemetrasenie (udalosť)', path: '/api/earthquakes/usgs', build: earthquakeEvent, auto: true },
  { id: 'quake-digest', label: 'Prehľad zemetrasení za 24 h', path: '/api/earthquakes/usgs', build: earthquakeDigest, auto: 'daily' },
  { id: 'launch', label: 'Štart rakety', path: '/api/launches', build: launchEvent, auto: true },
]);
export const templateById = id => TEMPLATES.find(template => template.id === id) || null;
