// scripts/lib/eventLoopWatch.mjs — merač zablokovania hlavného vlákna dev servera (2026-09-30).
//
// Pozadie: stránka sa pár minút po reštarte servera občas 90–120 s nenačítala (29. 9. o 19:47
// a 20:10) a príčina ostala neznáma. Merač zapíše do logu služby každé zablokovanie event loopu
// dlhšie ako prah — s časom a dobou od štartu procesu —, aby sa pri najbližšom výskyte dalo
// priradiť k úlohe, ktorá vtedy bežala (riadky logu okolo). Nič nemení, len meria; náklad je
// jeden časovač za pol sekundy.

export const EVENT_LOOP_TICK_MS = 500;
export const EVENT_LOOP_WARN_MS = 1000;

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
 * Riadok logu (pure).
 * @param {{lagMs:number, uptimeS:number, at:Date}} input
 * @returns {string}
 */
export function formatEventLoopWarning({ lagMs, uptimeS, at }) {
  const time = at instanceof Date && !Number.isNaN(at.getTime())
    ? at.toLocaleTimeString('sk-SK', { hour12: false })
    : '?';
  return `[event-loop] ${time} vlákno blokované ${Math.round(lagMs)} ms (${Math.round(uptimeS)} s od štartu procesu)`;
}

/**
 * Vite plugin: pri každom (re)štarte servera spustí merač a pri zatvorení servera ho zastaví,
 * takže reštart po zmene konfigurácie nenechá bežať dva časovače.
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
} = {}) {
  return {
    name: 'oko-event-loop-watch',
    configureServer(server) {
      let prev = now();
      const timer = setIntervalFn(() => {
        const current = now();
        const lag = eventLoopLagMs(prev, current, tickMs);
        prev = current;
        if (lag >= warnMs) log(formatEventLoopWarning({ lagMs: lag, uptimeS: uptime(), at: clock() }));
      }, tickMs);
      timer?.unref?.();
      server?.httpServer?.once?.('close', () => clearIntervalFn(timer));
    },
  };
}
