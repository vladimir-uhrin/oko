// scripts/lib/volbyHead.mjs — náhľad odkazu okolive.sk/?volby na sociálnych sieťach (2026-10-25, vlastník poslal
// odkaz z Facebooku „https://okolive.sk/?volby&fbclid=…#v=2…", ktorý nemal náhľad volieb). Statický server podáva
// pre každú adresu ten istý index.html so všeobecnými značkami OKO (lietadlá, lode) a og:url = koreň, takže
// Facebook odkaz zlúčil s domovskou stránkou. Pre adresy s parametrom `volby` sa značky v hlave prepíšu na voľby:
// ?volby → karta Slovenska (/s/volby2026.jpg), ?volby=<kód obce> → karta obce (/s/v<kód>.jpg), ?volby=k<n> → kraj.
// Čisté funkcie; volá ich scripts/oko-static-server.mjs. Časť za # sa na server neposiela (len do aplikácie).

const SITE = 'https://okolive.sk';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KRAJE = { 1: 'Bratislavský', 2: 'Trnavský', 3: 'Trenčiansky', 4: 'Nitriansky', 5: 'Žilinský', 6: 'Banskobystrický', 7: 'Prešovský', 8: 'Košický' };

/**
 * Značky pre adresu s parametrom `volby`, alebo null (iná adresa). Pure.
 * @param {string} search query (`?volby&fbclid=…`)
 */
export function volbyHead(search) {
  let params;
  try { params = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch { return null; }
  if (!params.has('volby')) return null;
  const value = String(params.get('volby') || '').trim();
  const description = 'Starostovia a primátori všetkých obcí na mape: víťaz, percentá, účasť a strana víťaza. Komunálne a župné voľby 2026, výsledky ŠÚ SR.';
  if (/^\d{6}$/.test(value)) {
    return {
      title: 'Výsledky volieb 2026 v obci – mapa | okolive.sk',
      description: 'Zvolený starosta, percentá, účasť a všetci kandidáti obce podľa ŠÚ SR. Komunálne voľby 2026 na mape okolive.sk.',
      url: `${SITE}/?volby=${value}`, image: `${SITE}/s/v${value}.jpg`, imageAlt: 'Karta výsledku voľby starostu obce, okolive.sk',
    };
  }
  const kraj = /^k([1-8])$/i.exec(value);
  if (kraj) {
    return {
      title: `Výsledky volieb 2026 – ${KRAJE[kraj[1]]} kraj na mape | okolive.sk`,
      description, url: `${SITE}/?volby=k${kraj[1]}`, image: `${SITE}/s/volby2026.jpg`, imageAlt: 'Mapa výsledkov volieb 2026 na Slovensku, okolive.sk',
    };
  }
  return {
    title: 'Voľby 2026: výsledky každej obce na mape | okolive.sk',
    description, url: `${SITE}/?volby`, image: `${SITE}/s/volby2026.jpg`, imageAlt: 'Mapa výsledkov volieb 2026 na Slovensku, okolive.sk',
  };
}

/** Prepíše titulok, popis, og:* a twitter:* v hlave index.html. Kanonická adresa → prehľad výsledkov. Pure. */
export function applyVolbyHead(html, head) {
  if (!head) return html;
  const rep = (re, value) => { html = html.replace(re, (m, a, b) => `${a}${esc(value)}${b}`); };
  rep(/(<title>)[^<]*(<\/title>)/, head.title);
  rep(/(<meta name="description" content=")[^"]*(")/, head.description);
  rep(/(<link rel="canonical" href=")[^"]*(")/, `${SITE}/volby-2026/`);
  rep(/(<meta property="og:title" content=")[^"]*(")/, head.title);
  rep(/(<meta property="og:description" content=")[^"]*(")/, head.description);
  rep(/(<meta property="og:url" content=")[^"]*(")/, head.url);
  rep(/(<meta property="og:image" content=")[^"]*(")/, head.image);
  rep(/(<meta property="og:image:alt" content=")[^"]*(")/, head.imageAlt);
  rep(/(<meta name="twitter:title" content=")[^"]*(")/, head.title);
  rep(/(<meta name="twitter:description" content=")[^"]*(")/, head.description);
  rep(/(<meta name="twitter:image" content=")[^"]*(")/, head.image);
  rep(/(<meta name="twitter:image:alt" content=")[^"]*(")/, head.imageAlt);
  return html;
}
