// scripts/lib/captureGuards.mjs — poistky nahrávania videa z OKO cez puppeteer (2026-10-03).
// Nahrávacie skripty (capture-event-video.mjs, capture-front-week.mjs) otvárajú OKO z Vite dev servera
// a fotia ho snímku po snímke 10–25 minút. Dve veci im vedia nahrávanie zhodiť:
//   1. Znovunačítanie stránky. Dev server po úprave zdrojáka pošle stránke „full-reload" (v tom istom strome
//      pracuje aj iný agent) alebo po vlastnom reštarte stránku obnoví — rozrobená snímka padne („Execution
//      context was destroyed") alebo sa scéna stratí. `blockPageReloads` nové načítanie dokumentu zruší:
//      stránka dobehne s modulmi, s ktorými začala. Týka sa len dokumentov, dáta a dlaždice idú ďalej.
//   2. Zaseknutá snímka (naživo: fotka `page.screenshot` sa občas nevráti). Zaseknutá stránka sa sama
//      nespamätá — `shootWithRecovery` po časovom limite hneď otvorí scénu nanovo (celý prehliadač); iná
//      chyba sa raz skúsi na tej istej stránke. ffmpeg medzitým čaká, video pokračuje tou istou snímkou.

/**
 * Zruší každé nové načítanie dokumentu na stránke (CDP `Fetch` s filtrom na dokumenty).
 * Volať až po načítaní stránky — prvé načítanie musí prejsť.
 * @param {{createCDPSession: () => Promise<{send: Function, on: Function}>}} page stránka puppeteera
 * @param {{onBlocked?: (count: number) => void}} [opts] hlásenie zrušeného načítania (poradové číslo)
 * @returns {Promise<{blocked: number}>} počítadlo zrušených načítaní (živé)
 */
export async function blockPageReloads(page, { onBlocked = () => {} } = {}) {
  const state = { blocked: 0 };
  const cdp = await page.createCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ resourceType: 'Document' }] });
  cdp.on('Fetch.requestPaused', (event) => {
    state.blocked += 1;
    try { onBlocked(state.blocked); } catch { /* hlásenie nesmie zhodiť nahrávanie */ }
    // Zrušenie môže zlyhať, keď sa stránka medzitým zavrela — nie je čo zachraňovať.
    Promise.resolve(cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' })).catch(() => {});
  });
  return state;
}

/**
 * Jedna snímka s časovým limitom a obnovou.
 * @param {object} p
 * @param {() => Promise<any>} p.shoot nakreslí a odfotí snímku
 * @param {() => Promise<void>} p.reopen otvorí scénu nanovo (nový prehliadač)
 * @param {number} p.timeoutMs po tomto čase sa snímka berie ako zaseknutá
 * @param {number} [p.attempts] najviac pokusov (predvolene 4)
 * @param {string} [p.label] meno snímky do hlásení („snímka 67")
 * @param {() => string} [p.step] krok rozrobenej snímky (kamera, vrstvy, fotka…) — pri zaseknutí ide do hlásenia
 * @param {(message: string) => void} [p.log]
 * @returns {Promise<any>} výsledok `shoot`
 */
export async function shootWithRecovery({ shoot, reopen, timeoutMs, attempts = 4, label = 'snímka', step = () => '', log = () => {} }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let timer = null;
    try {
      return await Promise.race([
        shoot(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error(`časový limit: ${label}`), { code: 'FRAME_TIMEOUT' })), timeoutMs);
        }),
      ]);
    } catch (error) {
      const hung = error?.code === 'FRAME_TIMEOUT';
      const where = hung ? String(step() || '') : '';
      log(`${label}, pokus ${attempt}: ${error?.message || error}${where ? ` (krok: ${where})` : ''}`);
      if (attempt < attempts && (hung || attempt >= 2)) {
        try { await reopen(); } catch (e) { log(`nový prehliadač: ${e?.message || e}`); }
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(new Error(`${label} sa nepodarila`), { code: 'FRAME_FAILED' });
}
