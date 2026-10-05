// src/voice/freeVoice.js
/**
 * @module freeVoice
 * @description Bezplatné hlasové ovládanie (2026-10-05). Reč rozpozná prehliadač (Web Speech API —
 * Chrome/Edge po slovensky, bez kľúča a bez platby; Chrome posiela zvuk na rozpoznanie Googlu), vetu
 * rozloží freeVoiceIntents.js (bez AI) a vykonajú ju tie isté akcie ako platený hlas (gevActions)
 * a jednotné hľadanie (lietadlá, scény, vrstvy, miesta). Odpoveď je krátka veta systémovým hlasom
 * (speechSynthesis). Používa tú istú pilulku a tlačidlo mikrofónu: klik = počúva, kým ho nevypneš
 * (alebo 90 s ticha), podržaný medzerník = vysielačka.
 */
import { foldText, scoreCommand } from '../commandPalette.js';
import { looksLikeAircraftQuery } from '../data/aircraftSearch.js';
import { foldSpeech, parseVoiceIntent } from './freeVoiceIntents.js';

const IDLE_STOP_MS = 90_000;
const RESTART_GAP_MS = 250;

/** Tvary dopytu pre hľadanie: ako zaznel, potom bez slovenskej pádovej koncovky („Ruslana" → „Ruslan"). Pure. */
export function queryVariants(query) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const out = [q];
  const m = /^(.{3,}?)(ovi|om|ou|ej|ach|ami|a|u|y|e|i)$/i.exec(q);
  if (m && !/\d/.test(q)) out.push(m[1]);
  return out;
}

/** Krátky popis sledovaného lietadla na prečítanie. Pure. */
export function describeTrackedForSpeech(info, translate) {
  if (!info) return translate('voice.free.nothing-tracked');
  const parts = [info.callsign || info.registration || info.icao24 || ''];
  if (info.typeName || info.typeCode) parts.push(info.typeName || info.typeCode);
  if (info.onGround) parts.push(translate('voice.free.on-ground'));
  else if (Number.isFinite(info.altitudeM)) parts.push(translate('voice.free.altitude', { m: Math.round(info.altitudeM / 100) * 100 }));
  const origin = info.route?.origin?.city || info.route?.origin?.name || info.route?.origin?.iata;
  const destination = info.route?.destination?.city || info.route?.destination?.name || info.route?.destination?.iata;
  if (origin && destination) parts.push(translate('voice.free.route', { from: origin, to: destination }));
  return parts.filter(Boolean).join(', ');
}

/**
 * @param {object} o
 * @param {object} o.ui výstup createVoiceControl (root, status, detail, costValue, tierButton, buttonLabel, helpDetail)
 * @param {(name: string, args?: object) => Promise<object>} o.run runner akcií (gevActions)
 * @param {object} [o.dataManager]
 * @param {Function} [o.translate]
 * @param {Function} [o.SpeechRecognitionImpl]
 * @param {object} [o.synth] speechSynthesis
 * @param {() => string} [o.lang] jazyk rozpoznávania (sk-SK / en-US)
 */
export function createFreeVoice({ ui, run, dataManager = null, translate = (k) => k,
  SpeechRecognitionImpl = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null,
  synth = globalThis.speechSynthesis || null, Utterance = globalThis.SpeechSynthesisUtterance || null,
  lang = () => (String(globalThis.document?.documentElement?.lang || 'sk').startsWith('en') ? 'en-US' : 'sk-SK'),
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  let resolvers = {};
  let rec = null;
  let active = false; // počúva (klik) alebo drží medzerník
  let push = false; // režim vysielačky
  let speaking = false;
  let lastSpeechAt = 0;
  let idleTimer = null;
  let restartTimer = null;
  let busy = Promise.resolve();

  function setStatus(status, detail = '') {
    if (!ui?.root) return;
    ui.root.dataset.status = status;
    if (status === 'error') ui.root.classList?.remove('error-dismissed');
    if (ui.status) ui.status.textContent = translate(`voice.status.${status === 'idle' ? 'off' : status}`);
    if (ui.detail) { ui.detail.textContent = detail; ui.detail.title = detail; }
    if (ui.errorDetail) ui.errorDetail.textContent = status === 'error' ? detail : '';
  }
  /** Pilulka v bezplatnom režime: namiesto ceny „ZADARMO", bez voľby modelu. */
  function applyUi() {
    if (ui?.costValue) { ui.costValue.textContent = translate('voice.free.cost'); ui.costValue.dataset.level = 'ok'; ui.costValue.title = translate('voice.free.cost-title'); }
    if (ui?.tierButton) ui.tierButton.hidden = true;
    if (ui?.helpDetail) ui.helpDetail.textContent = translate('voice.free.hint');
    if (ui?.root) ui.root.dataset.engine = 'free';
  }
  function speak(text) {
    if (!text || !synth || !Utterance) return;
    try {
      synth.cancel();
      const u = new Utterance(text);
      const want = lang();
      u.lang = want;
      const voice = synth.getVoices?.().find(v => String(v.lang || '').toLowerCase().startsWith(want.slice(0, 2)));
      if (voice) u.voice = voice;
      u.rate = 1.05;
      speaking = true;
      // Kým hovorí, nepočúvame — inak by mikrofón zachytil vlastnú odpoveď.
      try { rec?.abort(); } catch { /* */ }
      u.onend = u.onerror = () => { speaking = false; if (active && !push) scheduleRestart(); };
      synth.speak(u);
    } catch { speaking = false; }
  }

  // ── rozpoznávanie ──────────────────────────────────────────────────────
  function newRecognition(continuous) {
    const r = new SpeechRecognitionImpl();
    r.lang = lang();
    r.continuous = continuous;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      lastSpeechAt = now();
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) { if (!speaking) busy = busy.then(() => handleText(text)).catch(() => {}); }
        else interim += text;
      }
      if (interim && ui?.detail) { ui.detail.textContent = `„${interim.trim()}…"`; }
    };
    r.onerror = (event) => {
      const code = event?.error;
      if (code === 'no-speech' || code === 'aborted') return;
      active = false; push = false;
      setStatus('error', translate(code === 'not-allowed' || code === 'service-not-allowed' ? 'voice.free.mic-denied'
        : code === 'network' ? 'voice.free.network' : 'voice.free.failed'));
    };
    r.onend = () => { if (active && !push && !speaking) scheduleRestart(); };
    return r;
  }
  function scheduleRestart() {
    clearTimer(restartTimer);
    restartTimer = setTimer(() => {
      if (!active || push || speaking) return;
      try { rec = newRecognition(true); rec.start(); } catch { /* ďalší pokus pri ďalšom onend */ }
    }, RESTART_GAP_MS);
  }
  function armIdle() {
    clearTimer(idleTimer);
    idleTimer = setTimer(function check() {
      if (!active || push) return;
      if (now() - lastSpeechAt >= IDLE_STOP_MS) { stop(translate('voice.free.idle-off')); return; }
      idleTimer = setTimer(check, 5000);
    }, 5000);
  }
  const supported = () => typeof SpeechRecognitionImpl === 'function';

  function start() {
    if (active) return;
    if (!supported()) { setStatus('error', translate('voice.free.unsupported')); return; }
    active = true; push = false; lastSpeechAt = now();
    try { rec = newRecognition(true); rec.start(); } catch { active = false; setStatus('error', translate('voice.free.failed')); return; }
    setStatus('listening', translate('voice.free.listening'));
    armIdle();
  }
  function stop(detail = '') {
    active = false; push = false;
    clearTimer(idleTimer); clearTimer(restartTimer);
    try { rec?.abort(); } catch { /* */ }
    rec = null;
    setStatus('idle', detail || translate('voice.standby').toUpperCase());
  }
  function toggle() { if (active) stop(); else start(); }
  /** Medzerník dole: počúvaj, kým ho držíš. */
  function pushStart() {
    if (!supported()) { setStatus('error', translate('voice.free.unsupported')); return; }
    if (active && !push) return; // klikom zapnutý otvorený mikrofón medzerník neprerušuje
    if (push) return;
    active = true; push = true;
    try { rec = newRecognition(false); rec.start(); } catch { active = false; push = false; return; }
    setStatus('listening', translate('voice.hint.release'));
  }
  /** Medzerník hore: dopočúvať vetu (výsledok príde v onresult), potom pokoj. */
  function pushEnd() {
    if (!push) return;
    try { rec?.stop(); } catch { /* */ }
    active = false; push = false;
    setStatus('idle', translate('voice.standby').toUpperCase());
  }

  // ── vykonanie ──────────────────────────────────────────────────────────
  async function runTool(name, args = {}) {
    try { return (await run(name, args)) || { ok: false }; } catch (error) { return { ok: false, error: error?.message }; }
  }
  function findCommand(query, groups = null) {
    let commands = [];
    try { commands = resolvers.commands?.() || []; } catch { commands = []; }
    let best = null; let bestScore = 0;
    for (const variant of queryVariants(query)) {
      const q = foldText(variant);
      for (const cmd of commands) {
        if (groups && !groups(cmd)) continue;
        const score = scoreCommand(cmd, q);
        if (score > bestScore) { best = cmd; bestScore = score; }
      }
    }
    return bestScore >= 80 ? best : null;
  }
  /** Lietadlo: najprv živé v pamäti, potom celý svet (adsb.lol). Vráti príkaz palety alebo null. */
  async function findAircraft(query) {
    for (const variant of queryVariants(query)) {
      const live = resolvers.aircraft?.(variant) || [];
      if (live.length) return live[0];
    }
    for (const variant of queryVariants(query)) {
      if (!looksLikeAircraftQuery(variant)) continue;
      try {
        const world = (await resolvers.aircraftWorld?.(variant)) || [];
        const hit = world.find(cmd => cmd.kind !== 'note');
        if (hit) return hit;
      } catch { /* svet je voliteľný */ }
    }
    return null;
  }
  async function track(query) {
    const aircraft = await findAircraft(query);
    if (aircraft) { aircraft.run(); return translate('voice.free.tracking', { name: aircraft.label }); }
    // Loď alebo satelit podľa mena — rovnaká akcia ako platený hlas.
    const result = await runTool('track_entity', { query });
    if (result.ok !== false && !result.error) return translate('voice.free.tracking', { name: query });
    return translate('voice.free.not-found', { q: query });
  }

  /**
   * Vykoná jednu rozpoznanú vetu. Vráti text odpovede (aj ho povie a ukáže).
   * @param {string} text
   */
  async function handleText(text) {
    const heard = String(text ?? '').trim();
    if (!heard) return '';
    const intent = parseVoiceIntent(heard);
    if (!intent) return '';
    setStatus('executing', `„${heard}"`);
    let reply = '';
    switch (intent.type) {
      case 'stop-voice': stop(translate('voice.free.bye')); speak(translate('voice.free.bye')); return translate('voice.free.bye');
      case 'help': reply = translate('voice.free.help'); break;
      case 'zoom':
        await runTool('adjust_camera_zoom', { direction: intent.direction, amount: intent.amount });
        reply = translate(intent.direction === 'in' ? 'voice.free.zoom-in' : 'voice.free.zoom-out'); break;
      case 'globe': await runTool('zoom_to_globe'); reply = translate('voice.free.globe'); break;
      case 'home': { (resolvers.commands?.() || []).find(c => c.id === 'view:home')?.run(); reply = translate('voice.free.home'); break; }
      case 'camera':
        await runTool('move_camera', intent.motion === 'stop' ? { motion: 'stop' } : { motion: 'orbit', mode: 'continuous' });
        reply = translate(intent.motion === 'stop' ? 'voice.free.camera-stop' : 'voice.free.orbit'); break;
      case 'stop-tracking': await runTool('stop_tracking'); reply = translate('voice.free.tracking-stopped'); break;
      case 'describe': reply = describeTrackedForSpeech(resolvers.trackedInfo?.() || null, translate); break;
      case 'track': reply = await track(intent.query); break;
      case 'cockpit': {
        const result = await runTool('control_cockpit', { action: intent.action });
        reply = result.ok === false ? translate('voice.free.cockpit-failed') : translate(`voice.free.cockpit-${intent.action}`); break;
      }
      case 'radio': {
        const args = { action: intent.action, ...(intent.volumePct != null ? { volumePct: intent.volumePct } : {}) };
        const result = await runTool('control_radio', args);
        reply = result.ok === false ? translate('voice.free.radio-failed') : translate(`voice.free.radio-${intent.action}`, { n: intent.volumePct }); break;
      }
      case 'command': {
        const cmd = (resolvers.commands?.() || []).find(c => c.id === intent.id);
        cmd?.run();
        reply = cmd ? translate('voice.free.done', { name: cmd.label }) : translate('voice.free.not-understood'); break;
      }
      case 'front': {
        const result = await runTool('show_front', { action: 'show', frontId: intent.name });
        reply = result.ok === false ? translate('voice.free.not-found', { q: intent.name }) : translate('voice.free.front'); break;
      }
      case 'layer': {
        let layerId = intent.layerId;
        let label = intent.name;
        if (!layerId) {
          const cmd = findCommand(intent.name, c => String(c.id).startsWith('layer:'));
          if (cmd) { layerId = cmd.id.slice(6); label = cmd.label; }
        } else {
          const cmd = (resolvers.commands?.() || []).find(c => c.id === `layer:${layerId}`);
          if (cmd) label = cmd.label;
        }
        if (!layerId || !dataManager) { reply = translate('voice.free.not-found', { q: intent.name }); break; }
        try { dataManager.setEnabled(layerId, intent.on, { origin: 'user' }); } catch { /* */ }
        reply = translate(intent.on ? 'voice.free.layer-on' : 'voice.free.layer-off', { name: label }); break;
      }
      case 'go':
      default: {
        const query = intent.query;
        // 1) lietadlo, 2) scéna / vrstva / pohľad z palety, 3) miesto na mape.
        if (queryVariants(query).some(v => looksLikeAircraftQuery(v))) { reply = await track(query); break; }
        const cmd = findCommand(query);
        if (cmd) { cmd.run(); reply = translate('voice.free.done', { name: cmd.label }); break; }
        const aircraft = (resolvers.aircraft?.(query) || [])[0];
        if (aircraft && foldSpeech(aircraft.label).startsWith(foldSpeech(query))) { aircraft.run(); reply = translate('voice.free.tracking', { name: aircraft.label }); break; }
        if (resolvers.geocode) {
          const found = await resolvers.geocode(query).catch(() => null);
          const name = typeof found === 'string' ? found.split(',')[0].trim() : query;
          reply = found === false || found === null ? translate('voice.free.not-found', { q: query }) : translate('voice.free.flying', { q: name || query });
        } else reply = translate('voice.free.not-understood');
      }
    }
    if (active || push) setStatus('listening', reply);
    else setStatus('idle', reply);
    speak(reply);
    return reply;
  }

  return {
    toggle, start, stop, pushStart, pushEnd, handleText, applyUi,
    isActive: () => active,
    isSupported: supported,
    setResolvers(next) { resolvers = { ...resolvers, ...(next || {}) }; },
  };
}
