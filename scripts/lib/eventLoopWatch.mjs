// scripts/lib/eventLoopWatch.mjs — merač zablokovania hlavného vlákna dev servera (2026-09-30).
//
// Pozadie: stránka sa pár minút po reštarte servera občas 90–120 s nenačítala (29. 9. o 19:47
// a 20:10) a príčina ostala neznáma. Merač zapíše do logu služby každé zablokovanie event loopu
// dlhšie ako prah — s časom a dobou od štartu procesu —, aby sa pri najbližšom výskyte dalo
// priradiť k úlohe, ktorá vtedy bežala (riadky logu okolo). Nič nemení, len meria; náklad je
// jeden časovač za pol sekundy.
//
// 2026-10-30: bloky služby oko-api mali opakovane takmer rovnakú dĺžku (2 355, 2 204, 2 202 ms) pri
// rôznych úlohách (štart, obnova FIRMS) a halde ~1,3 GB — podozrenie na veľký zber pamäte (GC), nie
// na kód úlohy. Riadok preto nesie aj čas GC v okne bloku a veľkosť haldy, aby sa to dalo rozlíšiť.

import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';

export const EVENT_LOOP_TICK_MS = 500;
export const EVENT_LOOP_WARN_MS = 1000;
/** Ako dlho sa držia záznamy GC na priradenie k bloku. */
export const GC_KEEP_MS = 15_000;

/**
 * Koľko ms navyše oproti plánu trval tick (pure). Záporné alebo neplatné = 0.
 * @param {number} prevMs čas predošlého ticku
 * @param {number} nowMs čas tohto ticku
 * @param {number} [intervalMs]
 * @returns {number}
 */
export function eventLoopLagMs(prevMs, nowMs, intervalMs = EVENT_LOOP_TICK_MS) {
  const lag = Number(nowMs) - Number(prevMs) - Number(intervalMs);
  return Number.isFinite(lag) && lag > 0 ? lag : 0;
}

/**
 * Súčet GC v okne [fromMs, toMs] (pure). Záznam = { startTime, duration, major }; počíta sa len
 * časť záznamu, ktorá do okna padne.
 * @param {Array<{startTime:number, duration:number, major?:boolean}>} entries
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {{ms:number, majorMs:number, count:number}}
 */
export function gcInWindow(entries, fromMs, toMs) {
  let ms = 0;
  let majorMs = 0;
  let count = 0;
  for (const e of entries || []) {
    const start = Number(e?.startTime);
    const end = start + Number(e?.duration);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const overlap = Math.min(end, toMs) - Math.max(start, fromMs);
    if (overlap <= 0) continue;
    ms += overlap;
    if (e.major) majorMs += overlap;
    count += 1;
  }
  return { ms, majorMs, count };
}

/**
 * Riadok logu (pure).
 * @param {{lagMs:number, uptimeS:number, at:Date, gcMs?:number|null, gcMajorMs?:number, heapMb?:number|null}} input
 * @returns {string}
 */
export function formatEventLoopWarning({ lagMs, uptimeS, at, gcMs = null, gcMajorMs = 0, heapMb = null }) {
  const time = at instanceof Date && !Number.isNaN(at.getTime())
    ? at.toLocaleTimeString('sk-SK', { hour12: false })
    : '?';
  const extra = [];
  if (Number.isFinite(gcMs)) extra.push(`GC ${Math.round(gcMs)} ms${gcMajorMs >= 1 ? ` (veľký ${Math.round(gcMajorMs)} ms)` : ''}`);
  if (Number.isFinite(heapMb) && heapMb > 0) extra.push(`halda ${Math.round(heapMb)} MB`);
  return `[event-loop] ${time} vlákno blokované ${Math.round(lagMs)} ms (${Math.round(uptimeS)} s od štartu procesu)${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
}

/**
 * Skutočný odber GC z perf_hooks: drží záznamy posledných GC_KEEP_MS. Bez podpory = null.
 * @returns {{entries:() => Array<{startTime:number, duration:number, major:boolean}>, stop:() => void}|null}
 */
export function observeGc() {
  try {
    let list = [];
    const majorKind = perfConstants?.NODE_PERFORMANCE_GC_MAJOR;
    const obs = new PerformanceObserver((items) => {
      for (const e of items.getEntries()) {
        list.push({ startTime: e.startTime, duration: e.duration, major: e.detail?.kind === majorKind });
      }
      const cutoff = performance.now() - GC_KEEP_MS;
      if (list.length > 200 || (list[0] && list[0].startTime < cutoff)) list = list.filter((e) => e.startTime >= cutoff);
    });
    obs.observe({ entryTypes: ['gc'] });
    return { entries: () => list, stop: () => obs.disconnect() };
  } catch {
    return null;
  }
}

/**
 * Vite plugin: pri každom (re)štarte servera spustí merač a pri zatvorení servera ho zastaví,
 * takže reštart po zmene konfigurácie nenechá bežať dva časovače.
 * Hlásenie bloku sa odloží o jeden setImmediate: záznamy GC z perf_hooks prídu až po bloku
 * a časovač by ich inak predbehol.
 * @param {object} [options]
 * @returns {import('vite').Plugin}
 */
export function eventLoopWatchPlugin({
  log = (line) => console.warn(line),
  now = () => performance.now(),
  uptime = () => process.uptime(),
  clock = () => new Date(),
  tickMs = EVENT_LOOP_TICK_MS,
  warnMs = EVENT_LOOP_WARN_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  gc = observeGc,
  heapMb = () => process.memoryUsage().heapUsed / 1048576,
  defer = (fn) => setImmediate(fn),
} = {}) {
  return {
    name: 'oko-event-loop-watch',
    configureServer(server) {
      const gcWatch = typeof gc === 'function' ? gc() : null;
      let prev = now();
      const timer = setIntervalFn(() => {
        const current = now();
        const from = prev;
        const lag = eventLoopLagMs(prev, current, tickMs);
        prev = current;
        if (lag < warnMs) return;
        const at = clock();
        const uptimeS = uptime();
        defer(() => {
          const g = gcWatch ? gcInWindow(gcWatch.entries(), from, current) : null;
          let heap = null;
          try { heap = heapMb(); } catch { /* len doplnok */ }
          log(formatEventLoopWarning({ lagMs: lag, uptimeS, at, gcMs: g ? g.ms : null, gcMajorMs: g ? g.majorMs : 0, heapMb: heap }));
        });
      }, tickMs);
      timer?.unref?.();
      server?.httpServer?.once?.('close', () => { clearIntervalFn(timer); gcWatch?.stop?.(); });
    },
  };
}
