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

// Obdĺžnik mriežky icon_d2 z GRIB Section 3 je -3,94…20,34° E / 43,18…58,08° N,
// ALE natívna doména je ROTOVANÁ a rohy obdĺžnika sú maskované (v GRIB-e bitmapa:
// platných len 754 862 z 906 390 bodov). Obdĺžnik preto NIE JE test pokrytia —
// overené 2026-09-21: Žilina, Banská Bystrica, Košice aj Budapešť ležia vnútri
// obdĺžnika, no Open-Meteo pre ne vracia {"reason":"No data is available for this
// location"}. Doménu preto nehádame, pýtame sa zdroja (probePoint nižšie).

/** Overí, či model pre bod naozaj má dáta. Vracia dôvod zdroja, nie náš odhad. */
export async function probePoint(lat, lon) {
  const url = openMeteoUrl(lat, lon);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) return { ok: false, reason: body.reason || `HTTP ${res.status}` };
  return { ok: true, current: body.current || {} };
}

/** Body OVERENÉ 2026-09-21, že icon_d2 pre ne dáta má (mimo: Žilina, BB, Košice, Budapešť). */
export const DEFAULT_POINTS = Object.freeze([
  { id: 'bratislava', name: 'Bratislava', lat: 48.15, lon: 17.11 },
  { id: 'nitra', name: 'Nitra', lat: 48.31, lon: 18.09 },
  { id: 'vieden', name: 'Viedeň', lat: 48.21, lon: 16.37 },
  { id: 'brno', name: 'Brno', lat: 49.20, lon: 16.61 },
  { id: 'mnichov', name: 'Mníchov', lat: 48.14, lon: 11.58 },
  { id: 'zahreb', name: 'Záhreb', lat: 45.81, lon: 15.98 },
]);

const UA = 'OKO/meteo-gauntlet (hobby; kontakt v repo)';

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

/** Meno súboru rezu (2026-09-08T210000Z.png) → ms. NaN, keď sa nedá čítať. Pure. */
export function sliceStamp(file) {
  const m = String(file).match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Rez najbližší k okamihu zachytenia. Pure. */
export function nearestSlice(files, capturedAtIso) {
  const target = Date.parse(capturedAtIso);
  let best = null;
  let bestDiff = Infinity;
  for (const f of files) {
    const t = sliceStamp(f);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - target);
    if (d < bestDiff) { bestDiff = d; best = f; }
  }
  return best;
}

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

async function main() {
  const name = arg('--name', null);
  if (!name) { console.error('chýba --name <meno-fixture>'); process.exit(2); }



  const capturedAt = new Date().toISOString();
  console.log(`zachytávam fixture "${name}" @ ${capturedAt}`);
  console.log('→ ODFOŤ WINDY TERAZ (ten istý okamih), ak si tak neurobil pred spustením\n');

  const points = [];
  for (const p of DEFAULT_POINTS) {
    const url = openMeteoUrl(p.lat, p.lon);
    const probe = await probePoint(p.lat, p.lon);
    if (!probe.ok) {
      console.error(`
${p.name}: model pre tento bod nemá dáta — ${probe.reason}`);
      console.error('Doména icon_d2 je rotovaná; obdĺžnik mriežky nestačí. Vyber iný bod.');
      process.exit(1);
    }
    const c = probe.current;
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
      const files = (await fs.readdir(fdir)).filter((f) => f.endsWith('.png'));
      // NAJBLIŽŠÍ rez k okamihu zachytenia, nie prvý po zoradení. files[0] bral
      // najstarší rez v cache — fixture by miešal dnešné checkpointy s rastrom
      // spred týždňov, čo je presne to, čo má „same instant" vylúčiť.
      const pick = nearestSlice(files, capturedAt);
      if (!pick) continue;
      const stem = pick.replace(/\.png$/, '');
      for (const ext of ['.png', '.json']) {
        try {
          await fs.copyFile(path.join(fdir, stem + ext), path.join(dir, 'slices', `${field}__${stem}${ext}`));
        } catch { /* meta nemusí byť */ }
      }
      const drift = Math.round(Math.abs(sliceStamp(pick) - Date.parse(capturedAt)) / 3600000);
      copied.push({ slice: `${field}/${stem}`, driftHours: drift });
    }
  } catch { console.warn('  (cache rezov sa nedá čítať — fixture bude len s checkpointmi)'); }

  await fs.writeFile(path.resolve('fixtures', 'checkpoints.json'),
    JSON.stringify({ capturedAt, model: 'icon_d2', api: 'open-meteo', points }, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'manifest.json'),
    JSON.stringify({ name, capturedAt, model: 'icon_d2', slices: copied.sort() }, null, 2) + '\n');

  console.log(`\nzapísané: fixtures/checkpoints.json (${points.length} bodov), fixtures/${name}/ (${copied.length} rezov)`);
}

if (process.argv[1]?.endsWith('capture-fixture.js')) {
  main().catch((e) => { console.error('capture-fixture zlyhal:', e?.message || e); process.exit(1); });
}
