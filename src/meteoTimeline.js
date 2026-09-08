// src/meteoTimeline.js
// Spodná časová os meteorológie (2026-09-08, prototyp „ako Windy"): ◀ ▶ play,
// posuvník cez kroky predpovede, popis kroku a behu modelu. Štýl OKO (mono,
// azúrová). Čistý DOM bez Cesia; vrstva meteoLayer.js ju vlastní.

export const METEO_PLAY_INTERVAL_MS = 900;

/**
 * @param {Document} doc
 * @param {object} options
 * @param {(index: number) => void} options.onIndex používateľ zmenil krok
 * @param {(playing: boolean) => void} [options.onPlay]
 * @param {(key: string, vars?: object) => string} options.t
 * @param {HTMLElement} [options.parent] default doc.body
 */
export function createMeteoTimeline(doc, { onIndex, onPlay = () => {}, t, parent = doc.body } = {}) {
  const root = doc.createElement('div');
  root.id = 'meteo-timeline';
  root.className = 'meteo-timeline';
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', t('meteo.timeline'));

  const prev = button('◀', t('meteo.prev'));
  const play = button('▶', t('meteo.play'));
  const next = button('▶', t('meteo.next'));
  const slider = doc.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '0';
  slider.value = '0';
  slider.step = '1';
  slider.className = 'meteo-timeline-slider';
  slider.setAttribute('aria-label', t('meteo.step'));
  const label = doc.createElement('span');
  label.className = 'meteo-timeline-label';
  label.textContent = '—';
  const run = doc.createElement('span');
  run.className = 'meteo-timeline-run';
  const status = doc.createElement('span');
  status.className = 'meteo-timeline-status';
  const ticks = doc.createElement('div');
  ticks.className = 'meteo-timeline-ticks';

  const controls = doc.createElement('div');
  controls.className = 'meteo-timeline-controls';
  controls.append(prev, play, next);
  const track = doc.createElement('div');
  track.className = 'meteo-timeline-track';
  track.append(slider, ticks);
  const text = doc.createElement('div');
  text.className = 'meteo-timeline-text';
  text.append(label, run, status);
  root.append(controls, track, text);
  parent.appendChild(root);

  let steps = [];
  let index = 0;
  let playing = false;

  function button(glyph, title) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'meteo-timeline-btn';
    b.textContent = glyph;
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  }

  function setIndex(i, { emit = true } = {}) {
    const clamped = Math.max(0, Math.min(steps.length - 1, Number(i) || 0));
    index = clamped;
    slider.value = String(clamped);
    label.textContent = steps[clamped]?.label || '—';
    for (const tick of ticks.children) tick.classList.toggle('active', Number(tick.dataset.index) === clamped);
    if (emit) onIndex(clamped);
  }

  function setPlaying(next) {
    playing = Boolean(next);
    play.textContent = playing ? '❚❚' : '▶';
    play.title = t(playing ? 'meteo.pause' : 'meteo.play');
    play.setAttribute('aria-pressed', playing ? 'true' : 'false');
    onPlay(playing);
  }

  prev.addEventListener('click', () => setIndex(index - 1));
  next.addEventListener('click', () => setIndex(index + 1));
  play.addEventListener('click', () => setPlaying(!playing));
  slider.addEventListener('input', () => setIndex(slider.value));

  return {
    root,
    /** @param {Array<{label: string, day?: string}>} list @param {string} runText */
    setSteps(list, runText = '') {
      steps = Array.isArray(list) ? list : [];
      slider.max = String(Math.max(0, steps.length - 1));
      ticks.replaceChildren(...steps.map((s, i) => {
        const tick = doc.createElement('span');
        tick.className = 'meteo-timeline-tick';
        tick.dataset.index = String(i);
        tick.textContent = s.day || '';
        return tick;
      }));
      run.textContent = runText;
      setIndex(Math.min(index, Math.max(0, steps.length - 1)), { emit: false });
    },
    setIndex: (i) => setIndex(i, { emit: false }),
    getIndex: () => index,
    setPlaying,
    isPlaying: () => playing,
    setStatus(textValue) { status.textContent = textValue || ''; },
    show() { root.hidden = false; },
    hide() { root.hidden = true; if (playing) setPlaying(false); },
    destroy() { root.remove(); },
  };
}
