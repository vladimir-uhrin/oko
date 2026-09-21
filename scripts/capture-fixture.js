// scripts/capture-fixture.js — zachytí fixture a checkpointy pre meteo gauntlet.
//
// PREČO EXISTUJE: zadanie hovorí, že referencie z Windy sú „captured manually at
// the same instant as the fixture". Fixture sa teda NESMIE vyrobiť dopredu —
// musí vzniknúť v tej istej minúte ako snímky Windy. Tento skript spustí
// POUŽÍVATEĽ tesne pred fotením alebo po ňom.
//
// Windy sa NEDOTÝKA. Ťahá len Open-Meteo (verejné API, ktoré OKO už používa)
// a kópiu rastrových rezov, ktoré appka práve servíruje.
//
//   node scripts/capture-fixture.js --name jesen-2026-09-21
//
// Zapíše:
//   fixtures/checkpoints.json        hodnoty z Open-Meteo icon_d2 (pre M1)
//   fixtures/<name>/manifest.json    okamih, model, kamery, zoznam rezov
//   fixtures/<name>/slices/          kópia PNG + meta rezov appky (pre ?fixture=)

import fs from 'node:fs/promises';
import path from 'node:path';

/** Doména DWD ICON-D2, zmeraná z GRIB Section 3 (2026-09-21). Pure. */
export const ICON_D2_DOMAIN = Object.freeze({ west: -3.94, east: 20.34, south: 43.18, north: 58.08 });

/** Leží bod v doméne icon_d2? Mimo nej model nemá dáta a tolerancia sa nedá splniť. Pure. */
export function insideIconD2(lat, lon) {
  return lat >= ICON_D2_DOMAIN.south && lat <= ICON_D2_DOMAIN.north
    && lon >= ICON_D2_DOMAIN.west && lon <= ICON_D2_DOMAIN.east;
}

/** Body sú zámerne všetky vnútri domény d2 — Košice (21,26° E) by boli MIMO. */
export const DEFAULT_POINTS = Object.freeze([
  { id: 'bratislava', name: 'Bratislava', lat: 48.15, lon: 17.11 },
  { id: 'zilina', name: 'Žilina', lat: 49.22, lon: 18.74 },
  { id: 'vieden', name: 'Viedeň', lat: 48.21, lon: 16.37 },
  { id: 'brno', name: 'Brno', lat: 49.20, lon: 16.61 },
  { id: 'mnichov', name: 'Mníchov', lat: 48.14, lon: 11.58 },
  { id: 'zahreb', name: 'Záhreb', lat: 45.81, lon: 15.98 },
]);

const VARS = ['temperature_2m', 'wind_speed_10m', 'wind_direction_10m', 'precipitation', 'cloud_cover', 'pressure_msl'];

/** URL Open-Meteo pre jeden bod, model icon_d2, vietor v m/s (nie km/h!). Pure. */
export function openMeteoUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: VARS.join(','),
    models: 'icon_d2',
    wind_speed_unit: 'ms',
    timezone: 'UTC',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

async function main() {
  const name = arg('--name', null);
  if (!name) { console.error('chýba --name <meno-fixture>'); process.exit(2); }

  const bad = DEFAULT_POINTS.filter((p) => !insideIconD2(p.lat, p.lon));
  if (bad.length) { console.error('body mimo domény icon_d2:', bad.map((b) => b.id).join(', ')); process.exit(2); }

  const capturedAt = new Date().toISOString();
  console.log(`zachytávam fixture "${name}" @ ${capturedAt}`);
  console.log('→ ODFOŤ WINDY TERAZ (ten istý okamih), ak si tak neurobil pred spustením\n');

  const points = [];
  for (const p of DEFAULT_POINTS) {
    const url = openMeteoUrl(p.lat, p.lon);
    const res = await fetch(url, { headers: { 'User-Agent': 'OKO/meteo-gauntlet (hobby; kontakt v repo)' } });
    if (!res.ok) { console.error(`Open-Meteo ${res.status} pre ${p.id}`); process.exit(1); }
    const j = await res.json();
    const c = j.current || {};
    points.push({
      id: p.id, name: p.name, lat: p.lat, lon: p.lon,
      time: c.time || null,
      temperature_2m: c.temperature_2m ?? null,
      wind_speed_10m: c.wind_speed_10m ?? null,
      wind_direction_10m: c.wind_direction_10m ?? null,
      precipitation: c.precipitation ?? null,
      cloud_cover: c.cloud_cover ?? null,
      pressure_msl: c.pressure_msl ?? null,
      sourceUrl: url,
    });
    console.log(`  ${p.name.padEnd(12)} ${String(c.temperature_2m).padStart(6)} °C  ${String(c.wind_speed_10m).padStart(5)} m/s  ${String(c.wind_direction_10m).padStart(4)}°`);
    await new Promise((r) => setTimeout(r, 400)); // ohľad voči verejnému API
  }

  const dir = path.resolve('fixtures', name);
  await fs.mkdir(path.join(dir, 'slices'), { recursive: true });

  // Kópia rastrových rezov, ktoré appka práve servíruje (pre offline ?fixture=).
  const cache = path.resolve('.gev-cache/meteo');
  const copied = [];
  try {
    for (const field of await fs.readdir(cache)) {
      const fdir = path.join(cache, field);
      if (!(await fs.stat(fdir)).isDirectory()) continue;
      const files = (await fs.readdir(fdir)).filter((f) => f.endsWith('.png')).sort();
      const pick = files[0];
      if (!pick) continue;
      const stem = pick.replace(/\.png$/, '');
      for (const ext of ['.png', '.json']) {
        try {
          await fs.copyFile(path.join(fdir, stem + ext), path.join(dir, 'slices', `${field}__${stem}${ext}`));
        } catch { /* meta nemusí byť */ }
      }
      copied.push(`${field}/${stem}`);
    }
  } catch { console.warn('  (cache rezov sa nedá čítať — fixture bude len s checkpointmi)'); }

  await fs.writeFile(path.resolve('fixtures', 'checkpoints.json'),
    JSON.stringify({ capturedAt, model: 'icon_d2', api: 'open-meteo', domain: ICON_D2_DOMAIN, points }, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'manifest.json'),
    JSON.stringify({ name, capturedAt, model: 'icon_d2', slices: copied.sort() }, null, 2) + '\n');

  console.log(`\nzapísané: fixtures/checkpoints.json (${points.length} bodov), fixtures/${name}/ (${copied.length} rezov)`);
}

if (process.argv[1]?.endsWith('capture-fixture.js')) {
  main().catch((e) => { console.error('capture-fixture zlyhal:', e?.message || e); process.exit(1); });
}
