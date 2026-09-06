import { t } from '../i18n.js';
import { normalizeAirportStream } from './airportBroadcasts.js';

/** Persistent player: card telemetry refreshes never detach its media element. */
export function createAirportAudio(doc) {
  const root = doc.createElement('section'); root.className = 'airport-card-section airport-card-player'; root.hidden = true;
  const label = doc.createElement('h4'); label.className = 'airport-card-section-title'; root.appendChild(label);
  const audio = doc.createElement('audio'); audio.controls = true; audio.preload = 'none';
  audio.className = 'airport-card-audio'; root.appendChild(audio);
  const status = doc.createElement('div'); status.className = 'airport-card-muted'; status.setAttribute('aria-live', 'polite'); root.appendChild(status);
  const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'airport-card-link';
  retry.textContent = t('airport.audio-play'); retry.hidden = true; root.appendChild(retry);
  let url = null; let generation = 0; let disposed = false;
  const listeners = [];
  function message(key, actionable = false) { status.textContent = t(key); retry.hidden = !actionable; }
  function listen(name, fn) { audio.addEventListener(name, fn); listeners.push([name, fn]); }
  async function play() {
    if (!url || disposed) return;
    const token = generation;
    message('airport.audio-loading');
    try {
      if (audio.error) audio.load();
      await audio.play();
      // The native playing event, rather than the promise, confirms playback.
    } catch (error) {
      if (token !== generation || disposed) return;
      message(error?.name === 'NotAllowedError' ? 'airport.audio-blocked' : 'airport.audio-error', true);
    }
  }
  function stop() {
    generation++; url = null;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    root.hidden = true; retry.hidden = true;
  }
  listen('playing', () => { if (url) message('airport.audio-playing'); });
  listen('waiting', () => { if (url) message('airport.audio-loading'); });
  listen('pause', () => { if (url) message('airport.audio-paused', true); });
  listen('error', () => { if (url) message('airport.audio-error', true); });
  listen('ended', () => { if (url) message('airport.audio-ended', true); });
  retry.addEventListener('click', play);
  return {
    root,
    setStream(stream) {
      if (disposed) return;
      stream = normalizeAirportStream(stream, t('airport.stream'));
      const next = stream?.url || null;
      if (next === url) { if (next) label.textContent = stream.label || t('airport.stream'); return; }
      stop();
      if (!next) return;
      url = next; label.textContent = stream.label || t('airport.stream');
      root.hidden = false;
      audio.src = next;
      void play();
    },
    destroy() { if (disposed) return; stop(); disposed = true;
      for (const [name, fn] of listeners) audio.removeEventListener(name, fn);
      retry.removeEventListener('click', play); root.remove(); },
  };
}
