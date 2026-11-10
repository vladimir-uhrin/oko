// src/welcomeStrip.js — uvítací pás „Čo chceš vidieť?" (2026-11-09).
//
// Prečo (audit UI 2026-11-09): nový návštevník po úvodnom prelete nedostal nič — žiadny titulok, tip ani
// ponuku; videl mapu, lietadlá a zbalené panely. Stará karta misií (firstRunExperience.js) je od
// 2026-09-14 vypnutá, lebo zakrývala stred obrazovky a nebolo jasné, načo je.
//
// Tento pás je iný: úzky, nemodálny, hore pod lištou, päť volieb jedným ťuknutím a krížik. Ukáže sa RAZ
// (kľúč v localStorage sa zapíše pri prvom zobrazení), a to len pri čistom štarte — nie pri odkaze so
// stavom, hlbokom odkaze (?front=, ?volby=, ?chokepoint=…), vloženom rámčeku ani robotovi. Znova ho
// otvorí ponuka „Viac" alebo paleta (udalosť `oko:welcome-open`).
//
// 2026-11-10 (vlastník: „ak klikne Slovensko, prelet nad Slovenskom; ak príde z inej adresy ako SK, ponúkni
// štát, z ktorého prišiel, a EN verziu"): prvá voľba sa riadi krajinou pripojenia (welcomeFlightsChoice) a
// návštevníkovi zo zahraničia so slovenským rozhraním pás ponúkne anglickú verziu (welcomeLanguageOffer).

export const WELCOME_STORAGE_KEY = 'oko:welcome-strip:v1';
/** Domovská krajina: prvá voľba je „Lietadlá nad Slovenskom" a jazyk sa neponúka. */
export const WELCOME_HOME_COUNTRY = 'SK';
/**
 * Pohľad na celé Slovensko po voľbe „Lietadlá nad Slovenskom": kamera južne od stredu krajiny, pohľad na sever.
 * Všeobecný pohľad „krajina" (camera.js START_AREA_VIEW.country, 1 100 km) ukázal pol Európy — Slovensko
 * (~430 km na šírku) má vyplniť obrazovku.
 */
export const WELCOME_HOME_VIEW = Object.freeze({ heightM: 430_000, pitchDeg: -52, backKm: 320 });

/** Voľby pásu v poradí zobrazenia; `id` = kľúč akcie, ktorú dodá main.js. */
export const WELCOME_CHOICES = Object.freeze([
  Object.freeze({ id: 'flights', labelKey: 'welcome.flights', icon: 'flight' }),
  Object.freeze({ id: 'ukraine', labelKey: 'welcome.ukraine', icon: 'crisis_alert' }),
  Object.freeze({ id: 'mideast', labelKey: 'welcome.mideast', icon: 'public' }),
  Object.freeze({ id: 'weather', labelKey: 'welcome.weather', icon: 'rainy' }),
  Object.freeze({ id: 'energy', labelKey: 'welcome.energy', icon: 'monitoring' }),
]);

/**
 * Má sa pás pri štarte ukázať sám? Pure.
 * @param {{ hasShareState?: boolean, search?: string, crawler?: boolean, embed?: boolean, seen?: boolean }} ctx
 */
export function shouldAutoShowWelcome({ hasShareState = false, search = '', crawler = false, embed = false, seen = false } = {}) {
  if (seen || hasShareState || crawler || embed) return false;
  // Akýkoľvek parameter v adrese = návštevník prišiel za niečím konkrétnym (alebo je to QA beh).
  const query = String(search || '').replace(/^\?/, '').trim();
  return query.length === 0;
}

/**
 * Má pás počkať na lištu súhlasu? Len na telefóne, kde by sa obe prekryli cez väčšinu obrazovky. Pure.
 * @param {{ onPhone?: boolean, consentOpen?: boolean }} ctx
 */
export function welcomeConsentWait({ onPhone = false, consentOpen = false } = {}) {
  return Boolean(onPhone && consentOpen);
}

/**
 * Prvá voľba pásu podľa krajiny pripojenia. Pure.
 * Slovensko alebo neznáma krajina → „Lietadlá nad Slovenskom" (prelet nad celé Slovensko, nie nad Bratislavu).
 * Iná krajina s polohou → „Lietadlá: <štát>" a prelet nad ňu.
 * @param {{ country?: string, lat?: number, lon?: number }|null} geo odpoveď /api/whereami
 * @param {{ countryName?: (code: string) => string, home?: { lat: number, lon: number } }} [o]
 * @returns {{ home: boolean, labelKey: string, place: string, lat: number|null, lon: number|null }}
 */
export function welcomeFlightsChoice(geo, { countryName = () => '', home = null } = {}) {
  const code = String(geo?.country || '').toUpperCase();
  const located = Number.isFinite(geo?.lat) && Number.isFinite(geo?.lon);
  const name = code && code !== WELCOME_HOME_COUNTRY ? String(countryName(code) || '').trim() : '';
  if (!code || code === WELCOME_HOME_COUNTRY || !located || !name) {
    return { home: true, labelKey: 'welcome.flights', place: '', lat: home?.lat ?? null, lon: home?.lon ?? null };
  }
  return { home: false, labelKey: 'welcome.flights-country', place: name, lat: geo.lat, lon: geo.lon };
}

/**
 * Ponuka druhého jazyka. Pure. Zo zahraničia so slovenským rozhraním → angličtina; zo Slovenska
 * s anglickým rozhraním → slovenčina. Inak nič (jazyk už sedí alebo krajinu nepoznáme).
 * @param {{ country?: string }|null} geo
 * @param {string} language aktuálny jazyk rozhrania ('sk' | 'en')
 * @returns {{ lang: 'en'|'sk', labelKey: string }|null}
 */
export function welcomeLanguageOffer(geo, language) {
  const code = String(geo?.country || '').toUpperCase();
  if (!code) return null;
  if (code !== WELCOME_HOME_COUNTRY && language === 'sk') return { lang: 'en', labelKey: 'welcome.lang-en' };
  if (code === WELCOME_HOME_COUNTRY && language !== 'sk') return { lang: 'sk', labelKey: 'welcome.lang-sk' };
  return null;
}

function readSeen(storage) {
  try { return storage?.getItem(WELCOME_STORAGE_KEY) === '1'; } catch { return false; }
}
function writeSeen(storage) {
  try { storage?.setItem(WELCOME_STORAGE_KEY, '1'); } catch { /* súkromné okno — pás sa ukáže znova */ }
}

/**
 * @param {{
 *   doc?: Document, storage?: Storage, translate: (key: string, params?: object) => string,
 *   actions: Record<string, () => void>,
 *   flightsChoice?: () => { labelKey: string, place: string },
 *   languageOffer?: () => ({ lang: string, labelKey: string }|null),
 *   onLanguage?: (lang: string) => void,
 * }} deps `flightsChoice` a `languageOffer` sa čítajú pri každom otvorení (poloha príde až po štarte).
 */
export function createWelcomeStrip({
  doc = document, storage = globalThis.localStorage, translate, actions = {},
  flightsChoice = null, languageOffer = null, onLanguage = null,
} = {}) {
  let root = null;

  const close = () => {
    if (!root) return;
    root.remove();
    root = null;
  };

  const open = () => {
    if (root) return root;
    writeSeen(storage);
    root = doc.createElement('section');
    root.id = 'oko-welcome';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', translate('welcome.title'));

    const head = doc.createElement('div');
    head.className = 'oko-welcome-head';
    const title = doc.createElement('h2');
    title.className = 'oko-welcome-title';
    title.textContent = translate('welcome.title');
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'oko-welcome-close';
    closeBtn.setAttribute('aria-label', translate('welcome.close'));
    closeBtn.title = translate('welcome.close');
    closeBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
    closeBtn.addEventListener('click', close);
    head.append(title, closeBtn);

    let flights = null;
    try { flights = typeof flightsChoice === 'function' ? flightsChoice() : null; } catch { flights = null; }

    const list = doc.createElement('div');
    list.className = 'oko-welcome-choices';
    for (const choice of WELCOME_CHOICES) {
      if (typeof actions[choice.id] !== 'function') continue;
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'oko-welcome-choice';
      b.dataset.welcomeChoice = choice.id;
      const icon = doc.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = choice.icon;
      const label = doc.createElement('span');
      label.textContent = choice.id === 'flights' && flights?.labelKey
        ? translate(flights.labelKey, { place: flights.place })
        : translate(choice.labelKey);
      b.append(icon, label);
      b.addEventListener('click', () => {
        close();
        try { actions[choice.id](); } catch { /* voľba nikdy nezhodí stránku */ }
      });
      list.append(b);
    }

    const hint = doc.createElement('p');
    hint.className = 'oko-welcome-hint';
    hint.textContent = translate('welcome.hint');
    root.append(head, list, hint);

    let offer = null;
    try { offer = typeof languageOffer === 'function' ? languageOffer() : null; } catch { offer = null; }
    if (offer && typeof onLanguage === 'function') {
      const lang = doc.createElement('button');
      lang.type = 'button';
      lang.className = 'oko-welcome-lang';
      lang.dataset.welcomeLang = offer.lang;
      lang.setAttribute('lang', offer.lang);
      lang.textContent = translate(offer.labelKey);
      lang.addEventListener('click', () => { close(); try { onLanguage(offer.lang); } catch { /* */ } });
      root.append(lang);
    }

    doc.body.append(root);
    return root;
  };

  doc.addEventListener('oko:welcome-open', open);
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root && root.contains(doc.activeElement)) close();
  });

  return {
    open,
    close,
    isOpen: () => Boolean(root),
    /** Ukáže pás, ak to pravidlá štartu dovolia. Vracia true, keď sa ukázal. */
    autoShow: (ctx = {}) => {
      if (!shouldAutoShowWelcome({ ...ctx, seen: readSeen(storage) })) return false;
      open();
      return true;
    },
  };
}
