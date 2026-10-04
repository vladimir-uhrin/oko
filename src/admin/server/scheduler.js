// Kto smie spúšťať automatiku adminu (2026-10-04). Na serveri bežia dva procesy nad tou istou
// `.auth-data/admin.sqlite`: služba oko-api (vydaný commit, verejné /api) a oko-dev (pracovný strom,
// localhost:4173). Keby časovače Štúdia a upozornení bežali v oboch, plánované zverejnenie, opakovania,
// auto-zverejnenie či Týždeň na fronte by sa pri súbehu spustili dvakrát a oko-dev by ich robil
// s necommitnutým kódom. Automatiku preto vlastní len vydanie (súbor RELEASE z scripts/oko-api-release.ps1);
// ručné akcie v admine fungujú v oboch. Prepínač STUDIO_SCHEDULER=on|off rozhodnutie prebije
// (lokálne skúšanie automatiky, alebo vypnutie vo vydaní).
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Smie tento proces spúšťať časovače Štúdia a upozornení? Pure okrem jedného `existsSync`.
 * @param {{ root: string, env?: Record<string, string|undefined>, exists?: (file: string) => boolean }} options
 * @returns {{ enabled: boolean, reason: 'env-on'|'env-off'|'release'|'working-tree' }}
 */
export function adminScheduler({ root, env = process.env, exists = existsSync }) {
  const flag = String(env.STUDIO_SCHEDULER || '').trim().toLowerCase();
  if (flag === 'on') return { enabled: true, reason: 'env-on' };
  if (flag === 'off') return { enabled: false, reason: 'env-off' };
  return exists(path.join(root, 'RELEASE')) ? { enabled: true, reason: 'release' } : { enabled: false, reason: 'working-tree' };
}
