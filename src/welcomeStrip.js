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

export const WELCOME_STORAGE_KEY = 'oko:welcome-strip:v1';

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

function readSeen(storage) {
  try { return storage?.getItem(WELCOME_STORAGE_KEY) === '1'; } catch { return false; }
}
function writeSeen(storage) {
  try { storage?.setItem(WELCOME_STORAGE_KEY, '1'); } catch { /* súkromné okno — pás sa ukáže znova */ }
}

/**
 * @param {{
 *   doc?: Document, storage?: Storage, translate: (key: string) => string,
 *   actions: Record<string, () => void>, iconNames?: ReadonlySet<string>,
 * }} deps
 */
export function createWelcomeStrip({ doc = document, storage = globalThis.localStorage, translate, actions = {} } = {}) {
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
      label.textContent = translate(choice.labelKey);
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
