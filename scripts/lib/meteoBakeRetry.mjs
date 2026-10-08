// scripts/lib/meteoBakeRetry.mjs — druhý pokus pre rezy, ktoré THREDDS odmietol (2026-10-08).
// Úloha „OKO meteo bake" končila kódom 2 kvôli jednotlivým HTTP 500 zo servera THREDDS (prechodné);
// po pauze sa zlyhané rezy skúsia ešte raz, až potom sa hlási zlyhanie.

/**
 * @template T
 * @param {T[]} failed položky, ktoré zlyhali v prvom kole
 * @param {(item: T) => Promise<unknown>} attempt
 * @param {{ pauseMs?: number, sleep?: (ms: number) => Promise<void>, onResult?: (item: T, ok: boolean, error?: unknown) => void }} [opts]
 * @returns {Promise<{ recovered: T[], stillFailed: T[] }>}
 */
export async function retryFailedOnce(failed, attempt, { pauseMs = 20_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onResult = () => {} } = {}) {
  const recovered = [];
  const stillFailed = [];
  if (!failed.length) return { recovered, stillFailed };
  await sleep(pauseMs);
  for (const item of failed) {
    try {
      await attempt(item);
      recovered.push(item);
      onResult(item, true);
    } catch (error) {
      stillFailed.push(item);
      onResult(item, false, error);
    }
  }
  return { recovered, stillFailed };
}
