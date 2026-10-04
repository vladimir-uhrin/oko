// src/data/eventVideoJobs.js — úlohy „priprav video" (2026-10-03): jedna naraz (Chrome s GPU, dlaždice ion),
// denný strop (kvóta dlaždíc), stav pre panel (krok, snímka, chyba, vety na vypočutie). Beh samotný robí
// vložený `run(event, script, onProgress)` (scripts/lib/eventVideoPipeline.mjs) — tu je len poradie a stav,
// aby sa to dalo testovať bez prehliadača. Výsledok (súbory) odovzdá `onDone(event, result)`.

export const VIDEO_JOB_DEFAULTS = Object.freeze({ dailyMax: 3, keepDoneMs: 24 * 3600_000 });

/**
 * @param {{run: (event: object, script: object|null, onProgress: Function) => Promise<object>, onDone?: Function,
 *   now?: () => number, log?: Function, dailyMax?: number}} deps
 */
export function createEventVideoJobs({ run, onDone = async () => {}, now = () => Date.now(), log = () => {}, dailyMax = VIDEO_JOB_DEFAULTS.dailyMax }) {
  /** @type {Map<string, object>} stav podľa id udalosti */
  const jobs = new Map();
  const startedDays = [];
  let active = null;

  const dayOf = (ms) => Math.floor(ms / 86400_000);
  const todayCount = () => startedDays.filter((d) => d === dayOf(now())).length;

  function status(id) {
    const j = jobs.get(id);
    if (!j) return { state: 'idle' };
    return { state: j.state, stage: j.stage ?? null, detail: j.detail ?? null, startedT: j.startedT ?? null, finishedT: j.finishedT ?? null, error: j.error ?? null, review: j.review ?? [], durationS: j.durationS ?? null };
  }

  /** Spustí prípravu (ak nebeží iná a strop dňa nie je vyčerpaný). Vracia stav alebo chybu. */
  function start(event, script) {
    const id = event.id;
    const cur = jobs.get(id);
    if (cur && (cur.state === 'queued' || cur.state === 'running')) return { ok: false, error: 'already_running', status: status(id) };
    if (active) return { ok: false, error: 'busy', status: status(id), activeId: active };
    if (todayCount() >= dailyMax) return { ok: false, error: 'daily_limit', status: status(id), dailyMax };
    const job = { state: 'queued', stage: 'queued', detail: null, startedT: Math.floor(now() / 1000), finishedT: null, error: null, review: [], durationS: null };
    jobs.set(id, job);
    startedDays.push(dayOf(now()));
    active = id;
    const onProgress = (stage, detail) => { job.state = 'running'; job.stage = stage; job.detail = detail ?? null; };
    (async () => {
      try {
        const result = await run(event, script, onProgress);
        job.review = result?.review || [];
        job.durationS = result?.durationS ?? null;
        await onDone(event, result);
        job.state = 'done';
        job.stage = 'done';
        log(`[events] ${id} video pripravené (${job.durationS ? job.durationS.toFixed(1) : '?'} s, na vypočutie ${job.review.length})`);
      } catch (error) {
        job.state = 'error';
        job.error = error?.message || String(error);
        log(`[events] ${id} video zlyhalo: ${job.error}`);
      } finally {
        job.finishedT = Math.floor(now() / 1000);
        active = null;
      }
    })();
    return { ok: true, status: status(id) };
  }

  return { start, status, isBusy: () => active !== null, todayCount, dailyMax };
}
