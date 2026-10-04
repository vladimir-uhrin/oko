// scripts/lib/startupProfile.mjs — jednorazový záznam CPU profilu dev servera po štarte (2026-09-30).
//
// Merač [event-loop] ukázal, že v prvých ~40 s po štarte procesu je vlákno servera opakovane
// zablokované 2–6 s (verejné /api vtedy stojí). Ktorá úloha to je, merač nepovie. Tento plugin pri
// štarte servera, KEĎ EXISTUJE ZNAČKA `.gev-cache/profile-next-start`, značku zmaže a 60 s nahráva
// CPU profil (node:inspector) do `.gev-cache/logs/startup-<čas>.cpuprofile`. Bez značky nerobí nič.

import fs from 'node:fs';
import path from 'node:path';

export const STARTUP_PROFILE_FLAG = '.gev-cache/profile-next-start';
export const STARTUP_PROFILE_DIR = '.gev-cache/logs';
export const STARTUP_PROFILE_MS = 60_000;

/** Názov súboru profilu z času (pure). */
export function startupProfileFileName(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `startup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.cpuprofile`;
}

/** Skutočné nahrávanie cez node:inspector (v teste sa podstrčí náhrada). */
async function recordCpuProfile(durationMs) {
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: 1000 });
    await session.post('Profiler.start');
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const { profile } = await session.post('Profiler.stop');
    return profile;
  } finally {
    session.disconnect();
  }
}

/**
 * @param {object} [options]
 * @returns {import('vite').Plugin}
 */
export function startupProfilePlugin({
  root = process.cwd(),
  durationMs = STARTUP_PROFILE_MS,
  record = recordCpuProfile,
  log = (line) => console.warn(line),
  clock = () => new Date(),
  fsApi = fs,
} = {}) {
  let running = false;
  return {
    name: 'oko-startup-profile',
    configureServer() {
      if (running) return;
      const flag = path.join(root, STARTUP_PROFILE_FLAG);
      try {
        if (!fsApi.existsSync(flag)) return;
        fsApi.unlinkSync(flag); // jednorazovo — ďalší štart už nenahráva
      } catch {
        return;
      }
      running = true;
      const file = path.join(root, STARTUP_PROFILE_DIR, startupProfileFileName(clock()));
      log(`[startup-profile] nahrávam CPU profil ${Math.round(durationMs / 1000)} s`);
      Promise.resolve()
        .then(() => record(durationMs))
        .then((profile) => {
          fsApi.mkdirSync(path.dirname(file), { recursive: true });
          fsApi.writeFileSync(file, JSON.stringify(profile));
          log(`[startup-profile] zapísaný ${file}`);
        })
        .catch((error) => log(`[startup-profile] zlyhal: ${error?.message || error}`))
        .finally(() => { running = false; });
    },
  };
}
