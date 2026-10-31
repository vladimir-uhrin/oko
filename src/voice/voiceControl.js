// src/voice/voiceControl.js — pilulka hlasu v doku (DOM), klávesová skratka a voľba motora.
//
// Vyčlenené z gevRealtime.js (2026-10-31, lenivý štart): hlasový modul (OpenAI Realtime + akcie,
// ~200 KB) sa sťahuje až pri prvom stlačení mikrofónu (voiceLazy.js). Pilulka však musí stáť
// v doku hneď od štartu a vyzerať rovnako — preto DOM a čisté pomocníky žijú tu, bez závislosti
// na zvyšku hlasu. gevRealtime.js ich odtiaľto importuje a pre staršie importy znova exportuje.
import { t } from '../i18n.js';

/**
 * Hlasový motor (2026-10-05, vlastník: „nechce sa mi platiť … sprav zatiaľ zadarmo"): predvolene
 * bezplatný hlas prehliadača (freeVoice.js). Platený OpenAI Realtime len po ručnom prepnutí
 * `localStorage['oko.voice.engine'] = 'openai'` (a s kľúčom na serveri).
 * @returns {'free'|'openai'}
 */
export function voiceEngine() {
  try { return globalThis.localStorage?.getItem('oko.voice.engine') === 'openai' ? 'openai' : 'free'; } catch { return 'free'; }
}

/**
 * Returns whether a keyboard event represents the hold-Space voice shortcut.
 * @param {KeyboardEvent|object|null} event
 * @returns {boolean}
 */
export function isPushToTalkKey(event) {
  return event?.code === 'Space' || event?.key === ' ';
}

/**
 * Protects text entry and modified shortcuts from the global push-to-talk key.
 * @param {KeyboardEvent|object|null} event
 * @returns {boolean}
 */
export function shouldHandlePushToTalkKeyDown(event) {
  if (!isPushToTalkKey(event) || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (target?.isContentEditable) return false;
  const editingControl = target?.closest?.('input, textarea, select, [contenteditable], [role="textbox"]');
  return !editingControl;
}

/**
 * Vzhľad pilulky pre bezplatný hlas (freeVoice.applyUi): cena „zadarmo", bez prepínača úrovne,
 * nápoveda bezplatného hlasu. Volá ju aj lenivý zástupca pred stiahnutím modulu, aby pilulka
 * vyzerala od štartu rovnako ako po ňom.
 * @param {{costValue?: HTMLElement, tierButton?: HTMLElement, helpDetail?: HTMLElement, root?: HTMLElement}|null} ui
 * @param {(key: string) => string} translate
 */
export function applyFreeVoiceUi(ui, translate = t) {
  if (ui?.costValue) { ui.costValue.textContent = translate('voice.free.cost'); ui.costValue.dataset.level = 'ok'; ui.costValue.title = translate('voice.free.cost-title'); }
  if (ui?.tierButton) ui.tierButton.hidden = true;
  if (ui?.helpDetail) ui.helpDetail.textContent = translate('voice.free.hint');
  if (ui?.root) ui.root.dataset.engine = 'free';
}

/**
 * Restores the CSS-owned standby baseline for every visualizer bar.
 * @param {Iterable<HTMLElement>|null|undefined} bars
 * @returns {void}
 */
export function resetVoiceVisualizerBars(bars) {
  if (!bars) return;
  for (const bar of bars) {
    bar.style.removeProperty('--audio-level');
    bar.style.removeProperty('--audio-opacity');
  }
}

export function createVoiceControl({ reset = false } = {}) {
  let root = document.getElementById('gev-voice-control');
  if (root && reset) {
    root.remove();
    root = null;
  }
  if (!root) {
    root = document.createElement('div');
    root.id = 'gev-voice-control';
    root.dataset.status = 'idle';
    root.dataset.speaker = 'idle';
    root.innerHTML = `
      <div class="gev-voice-heading">
        <div class="gev-voice-kicker">${t('voice.kicker')}</div>
        <div id="gev-voice-status">${t('voice.status.off')}</div>
        <div class="gev-voice-cost">
          <button id="gev-voice-tier" class="gev-voice-tier-btn" type="button" aria-pressed="false" title="${t('voice.tier-title')}">STD</button>
          <span id="gev-voice-cost-value" class="gev-voice-cost-value" data-level="ok" title="${t('voice.cost-title')}">~$0.00</span>
        </div>
      </div>
      <button id="gev-voice-button" type="button" aria-label="${t('voice.button-aria')}" aria-describedby="gev-voice-help">
        <span class="gev-mic-orbit"><img src="/mic.svg" alt="" /></span>
        <span class="gev-mic-label">${t('voice.on-off').toUpperCase()}</span>
      </button>
      <div class="gev-voice-visualizer" aria-hidden="true">
        ${Array.from({ length: 15 }, (_, index) => `<span style="--bar:${index}"></span>`).join('')}
      </div>
      <div class="gev-voice-readout">
        <div id="gev-voice-detail">${t('voice.standby').toUpperCase()}</div>
      </div>
      <div id="gev-voice-help" class="gev-voice-help-tray" role="tooltip">
        <span class="gev-voice-help-kicker">${t('voice.help-kicker')}</span>
        <span class="gev-voice-help-detail">${t('voice.hint.hold')}</span>
      </div>
      <div class="gev-voice-error-tray" role="alert" aria-live="assertive">
        <div class="gev-voice-error-header">
          <span>${t('voice.error-header')}</span>
          <button class="gev-voice-error-dismiss" type="button">${t('voice.error-dismiss')}</button>
        </div>
        <div id="gev-voice-error-detail"></div>
        <div class="gev-voice-error-hint">${t('voice.error-hint')}</div>
      </div>
    `;
    const commandDock = document.getElementById('command-dock');
    if (commandDock) {
      const locationBar = document.getElementById('location-bar');
      const controlPanel = document.getElementById('control-panel');
      commandDock.appendChild(root);
      if (locationBar) commandDock.insertBefore(locationBar, root);
      if (controlPanel) commandDock.appendChild(controlPanel);
    } else {
      document.body.appendChild(root);
    }
    root.querySelector('.gev-voice-error-dismiss')?.addEventListener('click', () => {
      root.classList.add('error-dismissed');
    });
  }
  return {
    root,
    button: root.querySelector('#gev-voice-button'),
    buttonLabel: root.querySelector('.gev-mic-label'),
    status: root.querySelector('#gev-voice-status'),
    detail: root.querySelector('#gev-voice-detail'),
    helpDetail: root.querySelector('.gev-voice-help-detail'),
    errorDetail: root.querySelector('#gev-voice-error-detail'),
    errorHint: root.querySelector('.gev-voice-error-hint'),
    tierButton: root.querySelector('#gev-voice-tier'),
    costValue: root.querySelector('#gev-voice-cost-value'),
  };
}
