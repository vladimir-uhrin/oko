# OKO — plán SEO pre okolive.sk

Vlastník 2026-09-29: „naplánuj si aj perfektné SEO". **Toto je plán, nič z neho ešte nebeží.**
`noindex` ostáva na celej stránke, kým vlastník výslovne nepovie „spusti indexovanie"
(pokyn z 2026-09-13: „daj mi to … ale SEO noindex").

## 1. Kde sme dnes (zmerané 2026-09-29 na https://okolive.sk)

- Každá odpoveď má `noindex, nofollow, noarchive`, aj ako `<meta name="robots">`, aj ako hlavičku
  `X-Robots-Tag`. Statický server ju dáva natvrdo a dev server všade okrem `/s/<id>`.
- `robots.txt`: `Allow: /`, `Disallow: /api/`. Crawlery smú čítať stránky kvôli náhľadom na
  sieťach, `/api` nie.
- Koreň má `<html lang="en">`, `<title>OKO</title>`, **žiadny `meta description`**, len `og:*`
  a `twitter:*` (náhľad odkazu s obrázkom `share-default.jpg`).
- Appka má jednu trasu. Stav pohľadu je v hashi (`#v=2&lat=…`), ktorý vyhľadávače nevidia.
  Hlboké odkazy idú cez query: `?front=lyman`, `?chokepoint=hormuz`, `?mideast=gaza`. Krátke
  odkazy `/s/<id>` sú snímky s Open Graph.
- Obsah je 3D glóbus (Cesium/WebGL). **Indexovateľného textu takmer niet**, sú to len popisky UI.
  Prvé načítanie má 8,7 MB, preloader na verejnej adrese sa skryje asi za 6,7 s.
- Jazyk sa určuje v poradí localStorage → `navigator.language` sk* → inak `en`. Googlebot
  (en-US) teda vidí anglické UI.
- `.sk` je doména s geografickým zacielením na Slovensko: pre slovenské publikum výhoda,
  pre anglické publikum slabší signál. Pomôže `hreflang` a kvalitný anglický obsah.

## 2. Cieľ a publikum

- **SK (realistické prvé pozície):** mapa frontu Ukrajiny podľa smerov, lietadlá nad Slovenskom
  naživo v 3D, lode na Dunaji, ceny a toky plynu, zemetrasenia a počasie, úžiny (Hormuz,
  Červené more).
- **EN (dlhý chvost):** „Strait of Hormuz live ship map 3D", „Ukraine front attacks by
  direction today", „gas flows Europe live map" a podobne. Na krátke heslá („flight tracker")
  konkurovať Flightradar24, MarineTraffic, DeepState ani LiveUAMap nemá zmysel.

## 3. Zásady

1. **Bez maskovania.** Robot dostane ten istý obsah ako človek, žiadny skrytý text a žiadne
   „stránky pre roboty". Rozdielne môže byť len to, či sa načítajú ťažké 3D dlaždice.
2. **Etická čiara a zdroje ostávajú.** Opisujeme objekty, infraštruktúru a udalosti, nie ľudí.
   Na každej obsahovej stránke sú zdroje a licencie (ArmyInform CC BY 4.0, OpenSky, AIS, ENTSOG,
   SHMÚ…), dátum a označenie „odvodené" tam, kde niečo počítame. DeepState ostáva len lokálne.
3. **Žiadny framework.** Obsahové stránky generuje build skript z Markdown/JSON v repe (vanilla,
   ako zvyšok OKO).
4. **Crawlery nesmú míňať kvóty.** `/api/` ostáva zakázané v `robots.txt` a appka pre robotov
   nenačítava fotorealistické dlaždice (riziko R1).
5. **Každý krok má test.** Tripwires podľa vzoru `src/noIndex.test.mjs`: meta, kanonická adresa,
   `hreflang`, JSON-LD a sitemap.

## 4. Etapy

### Etapa 0 — rozhodnutia vlastníka (pred prácou)

Zoznam je v časti 6. Bez odpovedí sa dá robiť etapa 1, zvyšok od nich závisí.

### Etapa 1 — technický základ (`noindex` ostáva)

- `<html lang>` podľa jazyka stránky a pre koreň zatiaľ `sk`. Titulok a `meta description`
  pre SK aj EN. Titulok koreňa napríklad „OKO — živý 3D glóbus: lietadlá, lode, front, plyn",
  do 60 znakov. Popis do 155 znakov.
- `<link rel="canonical">`: koreň → `https://okolive.sk/`. Varianty s hashom alebo query
  (`?front=…`) sa kanonizujú na koreň, alebo na zodpovedajúcu obsahovú stránku, keď existuje.
- Jazyky: obsahové stránky pod `/sk/<slug>/` a `/en/<slug>/` s párovým `hreflang` (sk, en,
  x-default). Appka dostane `?lang=sk|en`, ktorý prepne jazyk (a zapíše localStorage), aby
  `hreflang` mohol mieriť aj na appku v danom jazyku.
- JSON-LD: `WebApplication` (koreň: názov, popis, autor Uhrin Vladimír, jazyky, bezplatná),
  `WebSite`, na obsahových stránkach `WebPage`/`Article` + `BreadcrumbList`.
- `manifest.webmanifest`, `theme-color`, favicony 48×48 a viac (Google ich chce vo výsledkoch)
  a vlastná stránka 404.
- Statický server: index priečinka (`/sk/slug/` → `index.html`), 301 bez lomky → s lomkou.
  **`X-Robots-Tag` podľa cesty z konfigurácie namiesto natvrdo.** Prepínač indexovania je jeden
  (`SEO_INDEXING=on|off` alebo súbor v `dist/`) a platí pre statický aj dev server.
- `sitemap.xml` generuje build (koreň + obsahové stránky + `lastmod`). `robots.txt` dostane
  riadok `Sitemap: https://okolive.sk/sitemap.xml`.
- **Prijatie:** tripwire test pre každú stránku (title, description, canonical, hreflang
  páry, JSON-LD sa dá načítať) a sitemap obsahuje všetky stránky. Pri `SEO_INDEXING=off`
  ostáva `noindex` všade.

### Etapa 2 — obsahové stránky (vstupné brány do appky)

- Prvá vlna, 8 tém × SK + EN. Zdroj tém je katalóg konfliktov (`src/data/conflictsCatalog.js`,
  21 scén) a vrstvy:
  1. Mapa frontu Ukrajiny podľa smerov (hlásenie GŠ, KARTA)
  2. Lietadlá naživo v 3D (nad SR aj svetom)
  3. Lode naživo (Dunaj, svet)
  4. Hormuzský prieliv (úžina, premávka, ropa)
  5. Červené more a Báb al-Mandab
  6. Plyn: ceny (TTF odvodený z ACER) a toky (ENTSOG)
  7. Zemetrasenia a počasie (SHMÚ radar)
  8. O projekte + zdroje dát a licencie + etická čiara (E-E-A-T: kto to robí, odkiaľ sú dáta)
- Každá stránka má:
  - H1 a 400–900 slov vlastného textu (nie preklad naslepo, EN píšeme pre EN publikum);
  - statickú snímku (WebP, `alt`, rozmery, `loading=lazy` mimo prvého záberu);
  - tabuľku faktov a zdroje s licenciou;
  - 3–5 častých otázok;
  - tlačidlo „Otvoriť živú mapu", ktoré vedie na hlboký odkaz do appky (`?front=`, `?chokepoint=`…);
  - drobčekovú navigáciu a vnútorné odkazy medzi témami.
- Snímky vyrobí existujúci export kartičiek (`src/conflictExport.js`) na stroji vlastníka.
  V náhľadovom paneli sú fotoreálne dlaždice 403.
- Texty napíšem ja, **schvaľuje ich vlastník** (citlivé témy).
- **Prijatie:** stránka bez JavaScriptu zobrazí celý text, má menej ako 150 kB bez obrázka
  a v Lighthouse SEO dosiahne 100 bodov.

### Etapa 3 — výkon (Core Web Vitals)

- Obsahové stránky nenačítavajú Cesium. Cieľ: LCP < 2,5 s na 4G, CLS < 0,1, INP < 200 ms.
- Koreň: LCP je preloader, takže jeho text a oko musia byť v HTML. Súčasne treba
  `font-display: swap` a `preconnect` iba na skutočne použité pôvody.
- Meranie: Lighthouse/PageSpeed pred spustením, po spustení terénne dáta z CrUX
  (Search Console). Nadväzuje na existujúce merania štartu (`oko-start-nacitanie`).

### Etapa 4 — appka a roboty (riziko R1)

- Googlebot vykresľuje JavaScript. Jedno vykreslenie appky znamená asi 200 dlaždíc Google 3D
  cez Cesium ion, pokus o priame Google dlaždice (v EHP 403) a živé feedy. Pri desiatkach
  návštev robotov denne to míňa kvóty ion a Google.
- Návrh: pri rozpoznanom robotovi (`navigator.webdriver` alebo user-agent overených crawlerov)
  appka **nespustí fotorealistické dlaždice ani živé feedy**. Ukáže glóbus s ľahkým podkladom
  a úvodný text, ten istý, ktorý vidí človek v preloaderi. Obsah je rovnaký, líši sa len
  ťažké vykresľovanie, takže nejde o maskovanie.
- Rozpočtová poistka: denný strop dlaždíc podľa `docs/CURRENT-STATE.md` (kvóty Map Tiles
  500/10k/1k) ostáva a upozornenie na billing má vlastník.

### Etapa 5 — spustenie indexovania (len na výslovné „áno")

- `SEO_INDEXING=on`: koreň a obsahové stránky bez `noindex`. `noindex` ostáva na `/s/<id>`
  (tenké snímky od používateľov), `/account.html` a všetkom pod `/api/`.
- Overenie vlastníctva v Google Search Console: meta značka (spravím ja) alebo DNS TXT
  v Cloudflare (DNS zmeny robí vlastník). Bing Webmaster Tools sa dá importovať z GSC.
  Odoslanie sitemap.
- Cloudflare → Crawler Hints (IndexNow pre Bing/Yandex) zapína vlastník. Bot Fight Mode
  nechať vypnutý, overené roboty musia prejsť.
- Kontrola URL v GSC pre koreň a 3 hlavné stránky. **Prijatie:** o 7–14 dní indexované
  aspoň hlavné stránky, bez chýb pokrytia.

### Etapa 6 — čerstvý obsah (po spustení, podľa rozhodnutia vlastníka)

- Denná stránka „Ukrajina — hlásenie GŠ k DD. MM." z `buildUkraineDigest`: len smery, počty
  a zdroj ArmyInform CC BY 4.0. Týždenná „zmena frontu za týždeň" (označená ako odvodená),
  týždenná premávka v Hormuze (PortWatch).
- Archív, RSS/Atom pre agregátory a kartičky na siete z existujúceho exportu. Pri každom novom
  type obsahu najprv kontrola etickej čiary a licencie.

### Etapa 7 — meranie a údržba

- Search Console (dopyty, pokrytie, CWV) a Cloudflare Web Analytics (bez cookies; zapína
  vlastník). Raz mesačne kontrolný zoznam: nové chyby pokrytia, klesajúce stránky, rozbité
  hlboké odkazy.
- Testy strážia, aby indexovateľné stránky po spustení nemali `noindex` a `/s/` s účtom ho
  mali.

## 5. Riziká a pasce

- **R1 kvóty:** vykreslenie appky robotom sťahuje dlaždice (etapa 4). Kým to nie je vyriešené,
  koreň sa neindexuje.
- **Duplicity:** hash, query a dva jazyky. Riešia to `canonical` a `hreflang`. Snímky `/s/` sú
  `noindex`, ale crawlovateľné pre náhľady na sieťach.
- **Tenký obsah:** stránka bez vlastného textu (len glóbus) neuspeje. Preto etapa 2.
- **Citlivé témy (vojna, Blízky východ):** zdroje, dátumy, autor a jasné označenie odvodených
  údajov. Žiadne tvrdenia nad rámec zdrojov a žiadne osoby.
- **Cache Cloudflare:** HTML je `no-cache`, prepnutie `noindex` sa teda prejaví hneď.
  `robots.txt` ide z cache (HIT), po zmene ho treba vyčistiť z cache.
- **Pasca overená 2026-09-29:** živosť verejnej adresy neoverovať cez `/robots.txt` (cache),
  ale cez `/api/…`.

## 6. Rozhodnutia vlastníka

1. **Jazyky a adresy:** `/sk/…` + `/en/…` s `hreflang` (odporúčam), alebo len slovenčina?
2. **Témy prvej vlny:** 8 tém podľa etapy 2 (odporúčam), alebo iný výber?
3. **Indexovať aj samotnú appku `/`?** Odporúčam áno, ale až po etape 4 (roboty bez dlaždíc).
4. **Denné stránky z hlásení (etapa 6):** áno, nie, alebo neskôr?
5. **Overenie v Search Console:** meta značka (spravím ja) alebo DNS TXT (ty v Cloudflare)?
6. **Kedy spustiť indexovanie:** odporúčam po etapách 1–4, čo je odhadom 4–6 pracovných
   sedení vrátane schválenia textov.
