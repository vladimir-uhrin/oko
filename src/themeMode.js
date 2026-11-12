// src/themeMode.js — témy ako režimy (2026-11-12, krok 3 auditu UI).
//
// Prečo: voľba témy (uvítací pás, paleta, pás „Čo sa deje teraz") zapla vrstvy, podklad a panel, ale
// nebolo ako sa vrátiť — návštevník musel vrstvy, mapu aj kameru vracať ručne. Režim si PRED vstupom
// zapamätá vrstvy, podklad, panely a kameru, ukáže malý čip „Téma: X · Späť" a tlačidlom Späť vráti
// presne to, čo bolo.
//
// Pravidlá (overené nezávislou kontrolou návrhu):
//   • Tému tvorí akcia z deps.runs (vrstvy, panel, scéna, prelet) — režim ju obalí snímkou a návratom.
//   • Keď už beží scéna, ktorú téma nespustila (odkaz ?front=, výber v paneli), režim sa NEZAKLADÁ:
//     snímka by scénu nepoznala a návrat by ju zničil. Akcia vtedy beží holá, bez čipu.
//   • Jedna snímka: prechod z témy do témy drží stav spred PRVEJ témy.
//   • Návrat má jedného vlastníka: scény konfliktov pri ňom nič nevracajú samy (leaveScene s keepView),
//     vrstvy, podklad, panely a kameru vracia tento modul — v tomto poradí.
//   • Vrstvy navyše sa vypínajú ako používateľ (origin 'user' — zmizne aj z uloženého stavu a odkazu),
//     chýbajúce sa zapínajú bez pôvodu (mapa podľa vrstvy neprepne podklad, žiadna hláška).
//   • Podklad sa vracia len vtedy, keď ho prepla scéna a návštevník ho medzitým nezmenil sám
//     (leaveScene vráti kartaPrev); o tom nerozhoduje práve aktívny podklad — prepnutie môže ešte bežať.
//   • Keď návštevník počas témy sám zmení scénu (× v paneli, iná úžina, paleta), téma sa zahodí bez
//     vracania — scéna si žije po svojom.
//   • V kokpite, čistom pohľade, nahrávaní, prehrávaní scén, vloženom rámčeku a pri otvorených voľbách
//     sa režim nezakladá ani nevracia (canEnterTheme); akcia témy vtedy beží ako doteraz.
//
// Modul nepozná Cesium ani správcu vrstiev — všetko dostane v deps; DOM len cez vložený doc.

import { WELCOME_CHOICES } from './welcomeStrip.js';

/** Scéna konfliktov, ktorú téma spúšťa (hlásenie conflictScenes onSceneState), alebo null. */
const THEME_SCENES = Object.freeze({ ukraine: 'ukraine', mideast: 'mideast' });

/** Témy v poradí uvítacieho pásu. */
export const THEMES = Object.freeze(WELCOME_CHOICES.map((choice) => Object.freeze({
  id: choice.id,
  nameKey: `theme.name.${choice.id}`,
  scene: THEME_SCENES[choice.id] || null,
})));

/** Triedy tela, pri ktorých sa režim nezakladá ani nevracia. */
export const THEME_BLOCKING_CLASSES = Object.freeze([
  'cockpit-mode', 'embed-mode', 'scene-playback-mode', 'recording-mode', 'ui-clean-view', 'oko-karta-clean',
]);

/** Strop čakania na dobehnutie vstupu do témy (scéna, podklad, let). */
export const THEME_SETTLE_CAP_MS = 8000;

/**
 * Smie sa režim založiť alebo vrátiť? Pure.
 * @param {{bodyClasses?: Iterable<string>, volbyActive?: boolean}} [o]
 */
export function canEnterTheme({ bodyClasses = [], volbyActive = false } = {}) {
  if (volbyActive) return false;
  const have = new Set(bodyClasses);
  return !THEME_BLOCKING_CLASSES.some((name) => have.has(name));
}

/**
 * Čo vypnúť a čo zapnúť, aby zapnuté vrstvy boli ako v snímke. Pure.
 * @param {Iterable<string>} savedIds
 * @param {Iterable<string>} currentIds
 */
export function planLayerRestore(savedIds, currentIds) {
  const saved = new Set(savedIds || []);
  const current = new Set(currentIds || []);
  return {
    turnOff: [...current].filter((id) => !saved.has(id)).sort(),
    turnOn: [...saved].filter((id) => !current.has(id)).sort(),
  };
}

/**
 * Panely, ktorých zbalenie sa líši od snímky — zbalenia pred rozbaleniami (akordeón ľavého stĺpca
 * pri rozbalení zbalí susedov; opačné poradie by snímku pokazilo). Pure.
 * @param {Record<string, boolean>|null} saved id → zbalený
 * @param {Record<string, boolean>|null} current
 */
export function planPanelRestore(saved, current) {
  if (!saved || !current) return [];
  const out = [];
  for (const [id, collapsed] of Object.entries(saved)) {
    if (!(id in current) || Boolean(current[id]) === Boolean(collapsed)) continue;
    out.push({ id, collapsed: Boolean(collapsed) });
  }
  return out.sort((a, b) => Number(b.collapsed) - Number(a.collapsed) || a.id.localeCompare(b.id));
}

/**
 * Líši sa pohľad kamery natoľko, že sa oplatí letieť späť? Pure.
 * @param {{lon:number,lat:number,height:number,heading:number,pitch:number}|null} a
 * @param {{lon:number,lat:number,height:number,heading:number,pitch:number}|null} b
 */
export function poseDiffers(a, b) {
  if (!a || !b) return false;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  if (Math.abs(num(a.lat) - num(b.lat)) > 0.01) return true;
  let dLon = Math.abs(num(a.lon) - num(b.lon)) % 360;
  if (dLon > 180) dLon = 360 - dLon;
  if (dLon > 0.01) return true;
  const h = Math.max(1, Math.abs(num(a.height)));
  if (Math.abs(num(a.height) - num(b.height)) > Math.max(500, h * 0.02)) return true;
  const turn = (x, y) => { const d = Math.abs(num(x) - num(y)) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  return turn(a.heading, b.heading) > 0.02 || turn(a.pitch, b.pitch) > 0.02;
}

/**
 * @param {{
 *   doc?: Document, translate: (key: string, params?: object) => string,
 *   runs: Record<string, (ctx?: {isCurrent: () => boolean}) => (Promise<unknown>|unknown)>,
 *   sceneKind?: () => string,
 *   getLayerIds: () => Iterable<string>,
 *   setLayer: (id: string, on: boolean, origin?: string) => (Promise<unknown>|unknown),
 *   isLayerOn?: (id: string) => boolean,
 *   getStack: () => string, setStack: (id: string) => (Promise<unknown>|unknown),
 *   readPanels?: () => (Record<string, boolean>|null), setPanel?: (id: string, collapsed: boolean) => void,
 *   getPose: () => object|null, flyToPose: (pose: object) => void,
 *   sheet?: { active: () => (string|null), close: () => unknown },
 *   leaveScene?: () => ({kartaPrev?: string|null}|null|undefined),
 *   waitReady?: () => Promise<unknown>, canEnter?: () => boolean,
 *   notify?: (text: string) => void, onPhone?: () => boolean,
 *   focusFallback?: () => (HTMLElement|null),
 *   setTimeoutImpl?: typeof setTimeout, clearTimeoutImpl?: typeof clearTimeout,
 * }} deps
 */
export function createThemeMode({
  doc = document, translate, runs = {}, sceneKind = () => '',
  getLayerIds, setLayer, isLayerOn = null, getStack, setStack,
  readPanels = () => null, setPanel = () => {}, getPose, flyToPose,
  sheet = null, leaveScene = () => null, waitReady = () => Promise.resolve(), canEnter = () => true,
  notify = () => {}, onPhone = () => false, focusFallback = () => null,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
} = {}) {
  let active = null; // téma z THEMES
  let saved = null; // snímka spred prvej témy
  let busy = false; // beží vstup alebo návrat
  let exiting = false; // návrat práve skladá scénu — jej hlásenia sa ignorujú
  let sceneSeen = false; // scéna témy sa už ohlásila (až potom jej koniec tému zahodí)
  let entrySeq = 0; // poradie vstupu — akcia, ktorá dobehne po Späť, sa podľa neho dozvie, že už neplatí
  const currentScene = () => { try { return String(sceneKind() || ''); } catch { return ''; } };

  const root = doc.createElement('div');
  root.id = 'oko-theme';
  root.setAttribute('role', 'group');
  root.hidden = true;
  const label = doc.createElement('span');
  label.className = 'oko-theme-label';
  const backBtn = doc.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'oko-theme-back';
  root.append(label, backBtn);
  const live = doc.createElement('div');
  live.id = 'oko-theme-live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  doc.body.append(root, live);

  const themeName = (theme) => translate(theme.nameKey);
  const announce = (text) => { live.textContent = text; };
  const syncChip = () => {
    if (!active) {
      // Fokus nesmie ostať v prvku, ktorý sa skryje — najprv ho presunúť.
      try { if (root.contains(doc.activeElement)) focusFallback()?.focus?.({ preventScroll: true }); } catch { /* fokus je doplnok */ }
      root.hidden = true;
      try { doc.body.classList.remove('oko-theme-active'); delete doc.body.dataset.okoTheme; } catch { /* */ }
      return;
    }
    const name = themeName(active);
    label.textContent = translate('theme.chip', { name });
    root.setAttribute('aria-label', translate('theme.chip', { name }));
    backBtn.textContent = translate('theme.back');
    backBtn.setAttribute('aria-label', translate('theme.back.aria', { name }));
    backBtn.setAttribute('aria-disabled', busy ? 'true' : 'false');
    root.hidden = false;
    try { doc.body.classList.add('oko-theme-active'); doc.body.dataset.okoTheme = active.id; } catch { /* */ }
  };

  const capped = (promise) => new Promise((resolve) => {
    const timer = setTimeoutImpl(resolve, THEME_SETTLE_CAP_MS);
    Promise.resolve(promise).catch(() => {}).then(() => { clearTimeoutImpl(timer); resolve(); });
  });
  const allowed = () => { try { return canEnter() !== false; } catch { return true; } };
  const phone = () => { try { return Boolean(onPhone()); } catch { return false; } };

  const snapshot = () => {
    return {
      layers: [...(getLayerIds() || [])],
      stack: getStack(),
      panels: phone() ? null : (() => { try { return readPanels(); } catch { return null; } })(),
      pose: (() => { try { return getPose(); } catch { return null; } })(),
    };
  };

  /** Vráti mapu do stavu snímky; pri prechode medzi témami bez kamery. Nikdy nevyhodí výnimku. */
  const restore = async ({ camera }) => {
    exiting = true;
    try {
      if (phone()) { try { sheet?.close?.(); } catch { /* výsuv je doplnok */ } }
      let kartaPrev = null;
      try { kartaPrev = leaveScene()?.kartaPrev || null; } catch { /* scény sú voliteľné */ }
      const plan = planLayerRestore(saved.layers, getLayerIds());
      const steps = [
        ...plan.turnOff.map((id) => ({ id, on: false, origin: 'user' })),
        ...plan.turnOn.map((id) => ({ id, on: true, origin: undefined })),
      ];
      const results = await Promise.all(steps.map(async (step) => {
        try { return (await setLayer(step.id, step.on, step.origin)) !== false; } catch { return false; }
      }));
      // „false" je aj nahradený zámer (medzitým to prepol niekto iný) — hláška len keď stav naozaj nesedí.
      const failed = steps.some((step, i) => !results[i] && (typeof isLayerOn !== 'function' || Boolean(isLayerOn(step.id)) !== step.on));
      if (failed) { try { notify(translate('theme.restore-partial')); } catch { /* */ } }
      if (kartaPrev && saved.stack && saved.stack !== 'karta') {
        try { await setStack(saved.stack); } catch { /* podklad sa nepodarilo vrátiť — zvyšok dobehne */ }
      }
      if (!phone()) {
        let now = null;
        try { now = readPanels(); } catch { now = null; }
        for (const step of planPanelRestore(saved.panels, now)) { try { setPanel(step.id, step.collapsed); } catch { /* */ } }
      }
      if (camera && saved.pose) {
        let nowPose = null;
        try { nowPose = getPose(); } catch { nowPose = null; }
        if (!nowPose || poseDiffers(saved.pose, nowPose)) { try { flyToPose(saved.pose); } catch { /* */ } }
      }
    } finally {
      exiting = false;
    }
  };

  /**
   * Vstúpi do témy. Vracia true, keď režim vznikol (čip je vidno).
   * @param {string} id
   * @param {{keyboard?: boolean}} [o] vstup z klávesnice presunie fokus na Späť
   */
  const enter = async (id, { keyboard = false } = {}) => {
    const theme = THEMES.find((entry) => entry.id === id);
    const run = runs[id];
    if (!theme || typeof run !== 'function' || busy) return false;
    if (active === theme) { announce(translate('theme.entered', { name: themeName(theme) })); return true; } // tá istá téma: nič neskladať a nestavať znova
    // Kokpit, voľby… alebo scéna, ktorú téma nespustila: akcia beží ako doteraz, bez snímky a čipu.
    if (!allowed() || (!active && currentScene())) {
      try { run(); } catch { /* akcia nikdy nezhodí stránku */ }
      return false;
    }
    busy = true;
    const seq = ++entrySeq;
    try {
      await capped(waitReady()); // zaseknutá obnova stavu nesmie režim zablokovať navždy
      if (active) await restore({ camera: false });
      else {
        saved = snapshot();
        if (phone()) { try { sheet?.close?.(); } catch { /* */ } }
      }
      active = theme;
      sceneSeen = false;
      syncChip();
      // Fokus hneď (tlačidlo je počas vstupu len aria-disabled) — po čakaní by ho vzal z miesta, kde návštevník už píše.
      if (keyboard) { try { backBtn.focus?.({ preventScroll: true }); } catch { /* */ } }
      let settled;
      try { settled = run({ isCurrent: () => seq === entrySeq }); } catch { settled = undefined; }
      await capped(settled);
    } finally {
      busy = false;
      syncChip();
    }
    // Hlásenia scén počas vstupu sa ignorovali (dobiehala predošlá scéna) — teraz sa stav dorovná.
    if (active === theme) {
      const kind = currentScene();
      if (theme.scene && kind === theme.scene) sceneSeen = true;
      else if (kind) dismiss(); // medzitým si návštevník otvoril inú scénu
    }
    if (active === theme) announce(translate('theme.entered', { name: themeName(theme) }));
    return active === theme;
  };

  /** Návrat: vráti mapu, ako bola pred prvou témou. Vracia true, keď sa vrátila. */
  const back = async () => {
    if (!active || busy) return false;
    if (!allowed()) { try { notify(translate('theme.back-blocked')); } catch { /* */ } return false; } // tlačidlo nesmie mlčať
    busy = true;
    entrySeq += 1;
    syncChip();
    try {
      await restore({ camera: true });
    } finally {
      active = null;
      saved = null;
      busy = false;
      syncChip();
    }
    announce(translate('theme.restored'));
    return true;
  };

  /** Zahodí tému bez vracania (návštevník si scénu zmenil sám). */
  const dismiss = () => {
    if (!active || busy) return;
    entrySeq += 1;
    active = null;
    saved = null;
    syncChip();
  };

  /**
   * Hlásenie scén konfliktov pri každej zmene: 'ukraine' | 'mideast' | 'chokepoint' | ''.
   * Vlastná scéna tému drží; iná scéna alebo koniec vlastnej ju zahodí.
   */
  const onSceneState = (kind) => {
    if (!active || exiting) return;
    const state = String(kind || '');
    if (active.scene && state === active.scene) { sceneSeen = true; return; }
    if (!state && !(active.scene && sceneSeen)) return; // prázdne hlásenie pred vlastnou scénou nič neznamená
    if (busy) return; // počas vstupu ešte dobieha predošlá scéna — jej hlásenia tému nezahodia
    dismiss();
  };

  backBtn.addEventListener('click', () => { void back(); });

  return {
    enter, back, dismiss, onSceneState,
    /** Dá sa práve teraz vrátiť? (paleta príkaz Späť inak neponúka) */
    canBack: () => Boolean(active) && !busy && allowed(),
    get active() { return active ? active.id : null; },
    get saved() { return saved; },
    get busy() { return busy; },
    element: root,
    destroy: () => { try { root.remove(); live.remove(); } catch { /* */ } },
  };
}
