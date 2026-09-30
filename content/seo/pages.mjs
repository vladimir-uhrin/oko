// content/seo/pages.mjs — texty obsahových stránok okolive.sk (2026-09-30, SEO etapa 2).
// Z tohto súboru generuje scripts/build-content-pages.mjs statické stránky do public/.
// Pravidlá: len to, čo verejná stránka naozaj ukazuje (fakty overené v kóde 2026-09-30 — pri zmene
// funkcie treba zmeniť aj text), zdroje s licenciou, odvodené údaje označené ako odvodené, etická
// čiara (objekty a udalosti, nie ľudia). Odkazy v texte: [text](/relatívna/adresa) alebo [text](https://...).
// Názov alebo licencia zdroja môže byť reťazec (oba jazyky) alebo { sk, en }.

export const SITE = Object.freeze({
  origin: 'https://okolive.sk',
  name: 'OKO',
  author: 'Vladimír Uhrin',
  defaultImage: '/share-default.jpg',
  defaultImageAlt: {
    sk: 'OKO: Európa z obežnej dráhy so živými lietadlami a loďami',
    en: 'OKO: Europe seen from orbit with live aircraft and ships',
  },
  updated: '2026-09-30',
});

export const HUB = Object.freeze({
  sk: {
    title: 'Témy OKO — lietadlá, lode, Ukrajina, Blízky východ, plyn',
    description: 'Čo všetko ukazuje OKO na živom 3D glóbuse: lietadlá a lode naživo, front na Ukrajine, Blízky východ, úžiny, plyn, satelity, počasie a kamery.',
    h1: 'Čo ukazuje OKO',
    lead: 'OKO je živý 3D glóbus, ktorý na jednom mieste spája otvorené dáta o doprave, energetike a konfliktoch. Každá téma nižšie vysvetľuje, čo presne uvidíte, odkiaľ dáta pochádzajú a ako často sa obnovujú — a vedie priamo do živej mapy.',
    cta: 'Otvoriť živý 3D glóbus',
  },
  en: {
    title: 'OKO topics — aircraft, ships, Ukraine, Middle East, gas',
    description: 'Everything OKO shows on a live 3D globe: aircraft and ships in real time, the war in Ukraine, the Middle East, chokepoints, gas, satellites, weather.',
    h1: 'What OKO shows',
    lead: 'OKO is a live 3D globe that brings open data on transport, energy and conflicts together in one place. Each topic below explains exactly what you will see, where the data come from and how often they refresh — and takes you straight into the live map.',
    cta: 'Open the live 3D globe',
  },
});

export const SITEMAP_EXTRA = Object.freeze([
  { loc: '/privacy.html', lastmod: '2026-09-30', changefreq: 'yearly', priority: '0.2' },
]);

// Hlboké odkazy do appky (tokeny vrstiev: src/data/layerState.js — f lietadlá, a + z lode AIS + AISHub,
// s satelity, 9 + 0 plyn, c kamery, h radar SHMÚ, e + v + l zemetrasenia, sopky, prírodné udalosti).
const LINKS = Object.freeze({
  flights: '/#v=2&lat=48.5&lon=18.5&alt=600000&heading=0&pitch=-90&l=f',
  danube: '/#v=2&lat=48.10&lon=17.15&alt=5000&heading=0&pitch=-35&l=a.z',
  iss: '/#v=2&lat=48.15&lon=17.11&alt=20000000&heading=0&pitch=-90&l=s&lo=s.t.25544',
  gas: '/#v=2&lat=48.7&lon=19.6&alt=900000&heading=0&pitch=-90&l=9.0&ui=a.c.0',
  london: '/#v=2&lat=51.507&lon=-0.128&alt=3000&heading=0&pitch=-50&l=c',
  radar: '/#v=2&lat=48.7&lon=19.6&alt=700000&heading=0&pitch=-90&l=h',
  hazards: '/#v=2&lat=20&lon=10&alt=18000000&heading=0&pitch=-90&l=e.v.l',
});

const NONCOMMERCIAL = Object.freeze({ sk: 'nekomerčné použitie', en: 'non-commercial use' });
const PUBLIC_DOMAIN = Object.freeze({ sk: 'voľné dielo', en: 'public domain' });

const SRC = Object.freeze({
  armyinform: {
    name: { sk: 'ArmyInform (Ministerstvo obrany Ukrajiny) — denné hlásenie Generálneho štábu', en: 'ArmyInform (Ministry of Defence of Ukraine) — General Staff daily report' },
    license: 'CC BY 4.0',
    url: 'https://armyinform.com.ua/tag/operatyvna-informacziya/',
  },
  osm: { name: 'OpenStreetMap', license: 'ODbL', url: 'https://www.openstreetmap.org/copyright' },
  terrain: { name: { sk: 'Terrain Tiles (Mapzen, AWS Open Data) — reliéf', en: 'Terrain Tiles (Mapzen, AWS Open Data) — relief' }, url: 'https://registry.opendata.aws/terrain-tiles/' },
  opensky: { name: 'OpenSky Network', license: NONCOMMERCIAL, url: 'https://opensky-network.org/' },
  adsblol: { name: 'adsb.lol', license: 'ODbL', url: 'https://adsb.lol/' },
  adsbfi: { name: 'adsb.fi', license: NONCOMMERCIAL, url: 'https://adsb.fi/' },
  adsbdb: { name: 'adsbdb', url: 'https://www.adsbdb.com/' },
  planespotters: { name: 'Planespotters.net', license: { sk: '© fotografi', en: '© photographers' }, url: 'https://www.planespotters.net/' },
  aisstream: { name: 'AISStream.io', url: 'https://aisstream.io/' },
  aishub: { name: { sk: 'AISHub (cez Open Waters aiscast)', en: 'AISHub (via Open Waters aiscast)' }, url: 'https://www.aishub.net/' },
  gfw: { name: 'Global Fishing Watch — Powered by Global Fishing Watch. Contains modified Copernicus Sentinel data 2026', license: 'CC BY-NC 4.0', url: 'https://globalfishingwatch.org/' },
  shipDensity: {
    name: { sk: 'Svetová banka / MMF — hustota lodnej dopravy (2015–2021)', en: 'World Bank / IMF — Global Shipping Traffic Density (2015–2021)' },
    license: 'CC BY 4.0',
    url: 'https://datacatalog.worldbank.org/search/dataset/0037580/Global-Shipping-Traffic-Density',
  },
  portwatch: { name: 'IMF PortWatch', url: 'https://portwatch.imf.org/' },
  yahoo: { name: { sk: 'Yahoo Finance (Brent, WTI — najbližší kontrakt, orientačne)', en: 'Yahoo Finance (Brent, WTI — front month, indicative)' }, url: 'https://finance.yahoo.com/' },
  gdelt: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' },
  rss: { name: { sk: 'RSS kanály 12 médií (BBC, Al Jazeera, The Guardian, France 24, UN News, The Times of Israel, Haaretz a ďalšie)', en: 'RSS feeds of 12 publishers (BBC, Al Jazeera, The Guardian, France 24, UN News, The Times of Israel, Haaretz and others)' } },
  googleNews: { name: { sk: 'Google News (doplnok, keď je správ málo)', en: 'Google News (fallback when there is little news)' }, url: 'https://news.google.com/' },
  wikipedia: { name: { sk: 'Wikipédia — podrobné mapy konfliktov', en: 'Wikipedia — detailed conflict maps' }, license: 'CC BY-SA 4.0', url: 'https://www.wikipedia.org/' },
  entsog: { name: 'ENTSOG Transparency Platform', url: 'https://transparency.entsog.eu/' },
  acer: { name: { sk: 'ACER — hodnotenie ceny LNG', en: 'ACER — LNG price assessment' }, url: 'https://www.acer.europa.eu/' },
  gie: { name: 'GIE AGSI+ / ALSI', url: 'https://agsi.gie.eu/' },
  eurostat: { name: 'Eurostat (nrg_ti_gasm)', url: 'https://ec.europa.eu/eurostat' },
  fred: { name: { sk: 'FRED / MMF', en: 'FRED / IMF' }, url: 'https://fred.stlouisfed.org/' },
  wikidata: { name: 'Wikidata', license: 'CC0', url: 'https://www.wikidata.org/' },
  celestrak: { name: 'CelesTrak (Dr. T. S. Kelso)', url: 'https://celestrak.org/' },
  spacedevs: { name: 'The Space Devs — Launch Library 2', url: 'https://thespacedevs.com/' },
  tfl: { name: 'Transport for London — JamCams. Powered by TfL Open Data. Contains OS data © Crown copyright and database rights', url: 'https://tfl.gov.uk/info-for/open-data-users/' },
  austin: { name: 'City of Austin, TX — data.austintexas.gov (Austin Transportation & Public Works)', url: 'https://data.austintexas.gov/' },
  shmu: { name: 'SHMÚ — opendata.shmu.sk', license: 'CC BY 4.0', url: 'https://opendata.shmu.sk/' },
  gfs: { name: { sk: 'NOAA / NCEP GFS (cez NSF Unidata THREDDS)', en: 'NOAA / NCEP GFS (via NSF Unidata THREDDS)' }, license: PUBLIC_DOMAIN, url: 'https://www.nco.ncep.noaa.gov/' },
  usgs: { name: 'USGS Earthquake Hazards Program', license: PUBLIC_DOMAIN, url: 'https://earthquake.usgs.gov/' },
  emsc: { name: 'EMSC-CSEM', license: 'CC BY 4.0', url: 'https://www.emsc-csem.org/' },
  eonet: { name: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/' },
  gibs: { name: 'NASA EOSDIS GIBS / Worldview', url: 'https://worldview.earthdata.nasa.gov/' },
  godsEye: { name: { sk: 'gods-eye-view (pôvodný projekt, Bilawal Sidhu)', en: 'gods-eye-view (upstream project, Bilawal Sidhu)' }, license: 'MIT', url: 'https://github.com/bilawalsidhu/gods-eye-view' },
  cesium: { name: 'CesiumJS', license: 'Apache 2.0', url: 'https://cesium.com/platform/cesiumjs/' },
  google3d: { name: { sk: 'Google Photorealistic 3D Tiles (priamo alebo cez Cesium ion)', en: 'Google Photorealistic 3D Tiles (direct or via Cesium ion)' }, url: 'https://developers.google.com/maps/documentation/tile/3d-tiles' },
  ortofoto: { name: 'Ortofotomozaika SR © GKÚ Bratislava, NLC', license: 'CC BY 4.0', url: 'https://www.gku.sk/' },
});

export const PAGES = [
  {
    id: 'ukrajina',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'mapa-frontu-ukrajina',
      nav: 'Ukrajina — mapa frontu',
      teaser: 'Denné hlásenie Generálneho štábu po smeroch, obce z hlásenia a prehľadná mapa frontu.',
      title: 'Mapa frontu na Ukrajine — denné hlásenie po smeroch | OKO',
      description: 'Front na Ukrajine na 3D glóbuse a prehľadnej mape: útoky po smeroch z denného hlásenia Generálneho štábu, obce z hlásenia a vývoj za 7 a 30 dní.',
      h1: 'Mapa frontu na Ukrajine: čo hlási Generálny štáb, smer po smere',
      lead: 'OKO berie denné hlásenie Generálneho štábu Ozbrojených síl Ukrajiny, rozloží ho po smeroch frontu a ukáže na mape: koľko útokov hlásili pri Pokrovsku, Kupiansku či Lymane, ktoré obce sa v hlásení spomínajú a ako sa situácia menila za posledné dni. Pri hlásení je vždy uvedený zdroj a upozornenie, že ide o jednostranné oficiálne hlásenie; čo OKO počíta samo, je označené ako odvodené.',
      cta: { label: 'Otvoriť mapu frontu', href: '/?front=front' },
      sections: [
        {
          h2: 'Čo na mape uvidíte',
          p: [
            'Pri každom smere frontu je na mape značka s počtom útokov, ktoré Generálny štáb v hlásení uviedol. Pri prechode myšou ukáže čas hlásenia a jeho odsek v origináli, na požiadanie aj so strojovým prekladom. V paneli UKRAJINA sa po výbere smeru otvorí karta smeru: stĺpce za posledných 30 dní, priemer posledného týždňa proti zvyšku obdobia a obce, ktoré hlásenia za 14 dní menovali najčastejšie. Deň bez hlásenia ostane prázdny, nie nulový. Archív hlásení v OKO siaha do 25. júla 2026.',
            'Obce, ktoré hlásenie menuje, sa ukážu priamo na mape — sú to miesta z hlásenia, nie línia frontu ani polohy jednotiek. Odkaz na front otvorí mapu v režime KARTA — prehľadnú mapu s tieňovaným reliéfom, titulkom, legendou s mierkou a malou mapkou polohy, ktorú si môžete stiahnuť aj ako obrázok.',
          ],
          list: [
            'Smery: [Sumy](/?front=sumy), [Vovčansk](/?front=vovchansk), [Kupiansk](/?front=kupiansk), [Lyman](/?front=lyman), [Sloviansk – Kramatorsk](/?front=sloviansk-kramatorsk), [Kosťantynivka](/?front=kostiantynivka), [Pokrovsk](/?front=pokrovsk), [Oleksandrivka](/?front=oleksandrivka), [Huliajpole](/?front=huliaipole), [Orichiv – Záporožie](/?front=orikhiv) a [Cherson](/?front=kherson).',
            'Časová os: posledných 24 hodín, 7 dní, 30 dní alebo celé obdobie od 24. februára 2022 — s prehrávaním udalostí z otvorených zdrojov.',
            'Okno sa dá nastaviť aj v odkaze, napríklad [Pokrovsk za 7 dní](/?front=pokrovsk&win=7d).',
          ],
        },
        {
          h2: 'Odkiaľ sú údaje a ako ich čítať',
          p: [
            'Hlavným zdrojom je denné hlásenie Generálneho štábu, ktoré zverejňuje ArmyInform (Ministerstvo obrany Ukrajiny) pod licenciou CC BY 4.0. Nové hlásenie OKO načíta spravidla do pol hodiny od zverejnenia. Je to hlásenie jednej strany konfliktu: počty útokov nie sú nezávisle overené a OKO ich tak aj uvádza. Časť hlásenia o stratách ruskej armády OKO nepreberá.',
            'Podklad mapy pochádza z OpenStreetMap, reliéf v režime KARTA z otvorených výškových dát.',
          ],
        },
        {
          h2: 'Čo je odvodené a kde je hranica',
          p: [
            'Niektoré prvky mapy počíta OKO samo z otvorených zdrojov. Na mape sú označené ako odvodené — nejde o merania ani o oficiálne údaje.',
            'Značky z hlásenia sú ukotvené na obciach, nikdy na polohách jednotiek. OKO zobrazuje miesta a udalosti, nie ľudí.',
          ],
        },
      ],
      facts: [
        ['Zdroj hlásenia', 'Generálny štáb OS Ukrajiny cez ArmyInform (CC BY 4.0)'],
        ['Obnovovanie', 'nové hlásenie spravidla do 30 minút od zverejnenia'],
        ['Archív', 'hlásenia od 25. 7. 2026, časová os od 24. 2. 2022'],
        ['Cena', 'zadarmo, bez registrácie'],
      ],
      faq: [
        { q: 'Sú počty útokov overené?', a: 'Nie. Ide o denné hlásenie Generálneho štábu Ukrajiny, teda jednej strany konfliktu. OKO ho zobrazuje so zdrojom a bez úprav, nezávisle ho neoveruje.' },
        { q: 'Ako často sa mapa obnovuje?', a: 'Generálny štáb vydáva hlásenie denne a OKO ho načíta spravidla do pol hodiny od zverejnenia. Pri údajoch je uvedený dátum, ku ktorému platia.' },
        { q: 'Dá sa zdieľať konkrétny smer?', a: 'Áno. Odkaz v tvare okolive.sk/?front=lyman otvorí priamo daný smer a doplnenie &win=7d nastaví okno na 7 dní.' },
        { q: 'Je mapa zadarmo?', a: 'Áno, OKO je bezplatné a mapu frontu si môžete pozrieť bez registrácie.' },
      ],
      sources: [SRC.armyinform, SRC.osm, SRC.terrain],
    },
    en: {
      slug: 'ukraine-front-map',
      nav: 'Ukraine — front map',
      teaser: 'The General Staff daily report by direction, places it names and a clean front map.',
      title: 'Ukraine front map — daily General Staff report | OKO',
      description: 'The war in Ukraine on a 3D globe and a clean map: attacks per front direction from the General Staff daily report, the places it names, 7- and 30-day trends.',
      h1: 'Ukraine front map: what the General Staff reports, direction by direction',
      lead: 'OKO takes the daily report of the General Staff of the Armed Forces of Ukraine, splits it by front direction and puts it on the map: how many attacks were reported near Pokrovsk, Kupiansk or Lyman, which settlements the report names and how the picture changed over recent days. The report always shows its source and a note that it is a one-sided official report; whatever OKO computes itself is labelled as derived.',
      cta: { label: 'Open the front map', href: '/?front=front' },
      sections: [
        {
          h2: 'What you will see on the map',
          p: [
            'Each front direction carries a marker with the number of attacks the General Staff listed in its report. Hover over it to see the report time and the paragraph in the original, with a machine translation on request. In the UKRAINE panel, choosing a direction opens its card: bars for the last 30 days, the average of the last week against the rest of the period, and the settlements the reports named most often over 14 days. A day without a report stays empty, not zero. The report archive in OKO starts on 25 July 2026.',
            'Settlements named in the report appear right on the map — they are places from the report, not a front line or unit positions. A front link opens the map in KARTA mode — a clean map with shaded relief, a title, a legend with a scale bar and a small locator map, which you can also download as an image.',
          ],
          list: [
            'Directions: [Sumy](/?front=sumy), [Vovchansk](/?front=vovchansk), [Kupiansk](/?front=kupiansk), [Lyman](/?front=lyman), [Sloviansk–Kramatorsk](/?front=sloviansk-kramatorsk), [Kostiantynivka](/?front=kostiantynivka), [Pokrovsk](/?front=pokrovsk), [Oleksandrivka](/?front=oleksandrivka), [Huliaipole](/?front=huliaipole), [Orikhiv–Zaporizhzhia](/?front=orikhiv) and [Kherson](/?front=kherson).',
            'Timeline: the last 24 hours, 7 days, 30 days or the whole period since 24 February 2022 — replaying events from open sources.',
            'The window can be set in the link too, for example [Pokrovsk over 7 days](/?front=pokrovsk&win=7d).',
          ],
        },
        {
          h2: 'Where the data come from and how to read them',
          p: [
            'The main source is the General Staff daily report published by ArmyInform (Ministry of Defence of Ukraine) under CC BY 4.0. OKO usually picks up a new report within half an hour of publication. It is the report of one party to the conflict: attack counts are not independently verified, and OKO presents them as such. The part of the report on Russian losses is not used.',
            'The base map comes from OpenStreetMap and the relief in KARTA mode from open elevation data.',
          ],
        },
        {
          h2: 'What is derived, and where the line is',
          p: [
            'Some elements of the map are computed by OKO itself from open sources. They are labelled as derived on the map — they are neither measurements nor official figures.',
            'Report markers are anchored on settlements, never on unit positions. OKO shows places and events, not people.',
          ],
        },
      ],
      facts: [
        ['Report source', 'General Staff of the Armed Forces of Ukraine via ArmyInform (CC BY 4.0)'],
        ['Refresh', 'a new report usually within 30 minutes of publication'],
        ['Archive', 'reports since 25 Jul 2026; timeline since 24 Feb 2022'],
        ['Price', 'free, no sign-up'],
      ],
      faq: [
        { q: 'Are the attack counts verified?', a: 'No. They come from the daily report of the General Staff of Ukraine, one party to the conflict. OKO shows them with their source and unchanged, and does not verify them independently.' },
        { q: 'How often is the map updated?', a: 'The General Staff publishes its report daily, and OKO usually picks it up within half an hour. Each figure shows the date it refers to.' },
        { q: 'Can I share a single direction?', a: 'Yes. A link such as okolive.sk/?front=lyman opens that direction directly, and adding &win=7d sets a 7-day window.' },
        { q: 'Is the map free?', a: 'Yes. OKO is free, and you can view the front map without signing up.' },
      ],
      sources: [SRC.armyinform, SRC.osm, SRC.terrain],
    },
  },
  {
    id: 'lietadla',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'lietadla-nazivo',
      nav: 'Lietadlá naživo',
      teaser: 'Tisíce lietadiel na 3D glóbuse, sledovanie letu so stopou, 3D modely a pohľad z kokpitu.',
      title: 'Lietadlá naživo na 3D glóbuse — sledovanie letov | OKO',
      description: 'Sledujte lietadlá naživo na 3D glóbuse: približne 12 000 strojov nad celým svetom, sledovanie letu so stopou, 3D modely, pohľad z kokpitu a vojenské lety.',
      h1: 'Lietadlá naživo na 3D glóbuse: celý svet aj let nad vaším domom',
      lead: 'OKO ukazuje polohy lietadiel z otvorených sietí prijímačov ADS-B — zvyčajne 11 až 13 tisíc strojov naraz. Kliknutím na lietadlo ho začnete sledovať: kamera ho drží v zábere, za ním sa kreslí stopa a karta ukáže typ, výšku, rýchlosť a pri linkových letoch aj trasu.',
      cta: { label: 'Otvoriť lietadlá naživo', href: LINKS.flights },
      sections: [
        {
          h2: 'Čo s lietadlom môžete robiť',
          p: [
            'Zblízka sa lietadlá menia na 3D modely podľa kategórie — dopravné, turbovrtuľové, biznis jety, malé lietadlá, vrtuľníky či bezpilotné stroje. Sledované lietadlo dostane 3D model, keď je kamera nižšie ako 150 km, a pod 800 km aj lietadlá v okolí kamery.',
            'Pohľad z kokpitu ukáže let očami pilota s údajmi o výške, rýchlosti a smere. Grafy výšky a rýchlosti zachytia priebeh letu, filter ôsmich kategórií skryje, čo vás nezaujíma, a OKO upozorní na núdzové kódy transpondéra 7500, 7600 a 7700.',
          ],
          list: [
            'Vojenské lety ako samostatná vrstva z otvorených dát ADS-B.',
            'Prihlásení používatelia si môžu uložiť až 50 sledovaných letov a kým majú OKO otvorené, dostanú upozornenie pri vzlete a pristátí.',
            'Priamy odkaz: [lietadlá nad Slovenskom](' + LINKS.flights + ').',
          ],
        },
        {
          h2: 'Odkiaľ sú polohy a ako sú čerstvé',
          p: [
            'Hlavným zdrojom je OpenSky Network; keď nie je dostupný, OKO načíta lietadlá zo sietí adsb.lol a adsb.fi v okruhu asi 460 km okolo kamery. Vojenské lety pochádzajú z adsb.lol, typ a trasa z adsbdb a fotografie lietadiel z Planespotters.net.',
            'Prehliadač sa pýta na nové polohy každých 30 sekúnd, pri vojenských letoch každých 15 sekúnd. Lietadlá sa kreslia s oneskorením asi 30 sekúnd a medzi známymi polohami sa plynulo posúvajú, takže nepreskakujú. Pokrytie závisí od dobrovoľníkov s prijímačmi — nad oceánmi a v niektorých krajinách je riedke.',
          ],
        },
        {
          h2: 'Čo OKO neukazuje',
          p: [
            'Nie sú tu farby leteckých spoločností ani všetky lety na svete — len tie, ktoré zachytia otvorené siete prijímačov. Údaje o trase sú orientačné. OKO sleduje lietadlá ako objekty, nie cestujúcich ani posádky.',
          ],
        },
      ],
      facts: [
        ['Lietadiel naraz', 'približne 11–13 tisíc'],
        ['Obnovovanie', 'každých 30 s, vojenské lety každých 15 s'],
        ['Zdroje', 'OpenSky Network, adsb.lol, adsb.fi'],
        ['3D modely', 'podľa kategórie lietadla, zblízka'],
      ],
      faq: [
        { q: 'Je to to isté ako Flightradar24?', a: 'Princíp je podobný — polohy z vysielania ADS-B —, no OKO ich ukazuje na fotorealistickom 3D glóbuse spolu s loďami, satelitmi a ďalšími vrstvami a používa výhradne otvorené a komunitné zdroje.' },
        { q: 'Prečo niektoré lietadlo nevidím?', a: 'Pokrytie závisí od prijímačov dobrovoľníkov a od toho, či lietadlo vysiela ADS-B. Nad oceánmi a v niektorých oblastiach sú medzery.' },
        { q: 'Ako často sa polohy obnovujú?', a: 'Prehliadač sa pýta na nové polohy každých 30 sekúnd. Lietadlá kreslí s oneskorením asi 30 sekúnd a medzi známymi polohami ich plynulo posúva.' },
        { q: 'Potrebujem účet?', a: 'Nie. Účet je voliteľný a slúži len na ukladanie sledovaných letov.' },
      ],
      sources: [SRC.opensky, SRC.adsblol, SRC.adsbfi, SRC.adsbdb, SRC.planespotters],
    },
    en: {
      slug: 'live-flight-tracker-3d',
      nav: 'Live flights',
      teaser: 'Thousands of aircraft on a 3D globe, flight following with a trail, 3D models and a cockpit view.',
      title: 'Live flight tracker on a 3D globe | OKO',
      description: 'Track aircraft live on a 3D globe: about 12,000 aircraft worldwide, follow a flight with its trail, 3D models by type, a cockpit view and military flights.',
      h1: 'Live flights on a 3D globe: the whole world, or the plane above your house',
      lead: 'OKO shows aircraft positions from open ADS-B receiver networks — usually 11 to 13 thousand aircraft at a time. Click an aircraft to follow it: the camera keeps it in view, a trail is drawn behind it and a card shows its type, altitude, speed and, for airline flights, the route.',
      cta: { label: 'Open live flights', href: LINKS.flights },
      sections: [
        {
          h2: 'What you can do with a flight',
          p: [
            'Up close, aircraft turn into 3D models by category — airliners, turboprops, business jets, light aircraft, helicopters or drones. A followed aircraft gets a 3D model once the camera is below 150 km, and below 800 km so do the aircraft around the camera.',
            'The cockpit view shows the flight through the pilot’s eyes with altitude, speed and heading. Altitude and speed charts trace the flight, a filter with eight categories hides what you do not need, and OKO flags the emergency transponder codes 7500, 7600 and 7700.',
          ],
          list: [
            'Military flights as a separate layer, from open ADS-B data.',
            'Signed-in users can save up to 50 followed flights and, while OKO is open, get a notice on take-off and landing.',
            'Direct link: [flights over Slovakia](' + LINKS.flights + ').',
          ],
        },
        {
          h2: 'Where positions come from and how fresh they are',
          p: [
            'The main source is the OpenSky Network; when it is unavailable, OKO loads aircraft from the adsb.lol and adsb.fi networks within about 460 km (250 nautical miles) of the camera. Military flights come from adsb.lol, type and route from adsbdb, and aircraft photos from Planespotters.net.',
            'The browser asks for new positions every 30 seconds, every 15 seconds for military flights. Aircraft are drawn about 30 seconds behind real time and moved smoothly between known positions, so they do not jump. Coverage depends on volunteers running receivers — it is thin over the oceans and in some countries.',
          ],
        },
        {
          h2: 'What OKO does not show',
          p: [
            'There are no airline liveries and not every flight in the world — only those the open receiver networks pick up. Route data are indicative. OKO tracks aircraft as objects, not passengers or crews.',
          ],
        },
      ],
      facts: [
        ['Aircraft at once', 'about 11–13 thousand'],
        ['Refresh', 'every 30 s, military flights every 15 s'],
        ['Sources', 'OpenSky Network, adsb.lol, adsb.fi'],
        ['3D models', 'by aircraft category, up close'],
      ],
      faq: [
        { q: 'Is this the same as Flightradar24?', a: 'The principle is similar — positions from ADS-B broadcasts — but OKO shows them on a photorealistic 3D globe together with ships, satellites and other layers, and uses only open and community sources.' },
        { q: 'Why can I not see a particular aircraft?', a: 'Coverage depends on volunteer receivers and on whether the aircraft broadcasts ADS-B. There are gaps over the oceans and in some regions.' },
        { q: 'How often are positions updated?', a: 'The browser asks for new positions every 30 seconds. Aircraft are drawn about 30 seconds behind real time and moved smoothly between known positions.' },
        { q: 'Do I need an account?', a: 'No. An account is optional and only used to save followed flights.' },
      ],
      sources: [SRC.opensky, SRC.adsblol, SRC.adsbfi, SRC.adsbdb, SRC.planespotters],
    },
  },
  {
    id: 'lode',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'lode-nazivo',
      nav: 'Lode naživo',
      teaser: 'Desaťtisíce lodí z AIS, siluety podľa typu, cieľ plavby a radarové detekcie.',
      title: 'Lode naživo na mape — AIS sledovanie lodí v 3D | OKO',
      description: 'Lode naživo na 3D glóbuse: desaťtisíce plavidiel z AIS, typ, vlajka, cieľ plavby a odhad príchodu, radarové detekcie zo satelitov a lode na Dunaji.',
      h1: 'Lode naživo: AIS na 3D glóbuse od Dunaja po Hormuz',
      lead: 'OKO zobrazuje polohy lodí z Automatického identifikačného systému (AIS) — pri pohľade na celý svet zvyčajne 27 až 33 tisíc plavidiel. Farba a silueta prezradí typ lode, karta jej vlajku, stav plavby a cieľ plavby.',
      cta: { label: 'Otvoriť lode na Dunaji', href: LINKS.danube },
      sections: [
        {
          h2: 'Čo uvidíte',
          p: [
            'Farba ikony prezradí typ lode — tanker, nákladná, osobná, rybárska či remorkér. Keď je kamera nižšie ako 40 km, lode sa zmenia na siluety, ktoré sa menia podľa uhla pohľadu: zhora, šikmo alebo z boku. Po kliknutí sa ukáže karta s vlajkou, navigačným stavom a cieľom plavby, ktorý zadáva posádka; ak cieľ zodpovedá známemu prístavu, OKO k nemu nakreslí priamu čiaru s odhadom príchodu podľa rýchlosti. Za loďou sa kreslí stopa, ktorou prišla.',
            'Lode, ktoré sa desať minút neozvali, zosivejú a ostanú na mape ako posledná známa poloha ešte šesť hodín. Na Dunaji pri Bratislave je pokrytie AIS overené, takže tam uvidíte aj riečnu dopravu.',
          ],
          list: [
            'Scény úžin: [Hormuz](/?chokepoint=hormuz), [Dover](/?chokepoint=dover) a ďalších šesť — jedným klikom lode, radar a potrubia.',
            'Radarové detekcie lodí zo satelitov Sentinel-1 cez Global Fishing Watch, staré približne tri dni.',
            'Historická hustota lodnej dopravy podľa Svetovej banky a MMF (2015–2021).',
          ],
        },
        {
          h2: 'Odkiaľ sú údaje',
          p: [
            'Živé polohy prichádzajú zo služby AISStream.io; pri priblížení ich dopĺňa sieť AISHub s oneskorením 1 až 6 minút. Prehliadač sa pýta na nové polohy každých 60 sekúnd a po zastavení kamery doplní aktuálny výrez.',
            'Pokrytie z pobrežných prijímačov AIS je nerovnomerné: najlepšie v Európe, slabšie v Ázii a na otvorenom mori. Radarové detekcie Global Fishing Watch sú pod licenciou CC BY-NC 4.0 a obsahujú upravené dáta Copernicus Sentinel.',
          ],
        },
        {
          h2: 'Čo OKO nerobí',
          p: [
            'Počet lodí v zábere nie je celková doprava a loď v radare bez záznamu AIS ešte neznamená „temnú“ loď. OKO sleduje lode ako objekty, nie ľudí na palube.',
          ],
        },
      ],
      facts: [
        ['Lodí na glóbuse', 'zvyčajne 27–33 tisíc vrátane posledných známych polôh'],
        ['Obnovovanie', 'každých 60 s'],
        ['Zdroje', 'AISStream.io, AISHub, Global Fishing Watch'],
        ['Dunaj', 'pokrytie AIS overené pri Bratislave'],
      ],
      faq: [
        { q: 'Uvidím lode na Dunaji?', a: 'Pri Bratislave áno — pokrytie AIS je tam overené. Ďalej po prúde závisí od toho, či sú v okolí prijímače AIS.' },
        { q: 'Prečo je niekde lodí málo?', a: 'Polohy prichádzajú z pobrežných prijímačov AIS. Kde ich je málo — na otvorenom mori či v časti Ázie —, je aj menej lodí.' },
        { q: 'Čo znamená sivá loď?', a: 'Loď sa neozvala viac ako desať minút. OKO ju ukazuje na poslednej známej polohe ešte šesť hodín.' },
        { q: 'Sú radarové detekcie naživo?', a: 'Nie. Detekcie zo satelitov Sentinel-1 sú staré približne tri dni a pokrývajú desaťdňové okno.' },
      ],
      sources: [SRC.aisstream, SRC.aishub, SRC.gfw, SRC.shipDensity],
    },
    en: {
      slug: 'live-ship-tracker',
      nav: 'Live ships',
      teaser: 'Tens of thousands of AIS ships, silhouettes by type, destination and radar detections.',
      title: 'Live ship tracker — AIS vessels on a 3D map | OKO',
      description: 'Live ships on a 3D globe: tens of thousands of AIS vessels with type, flag, destination and ETA, satellite radar detections and river traffic on the Danube.',
      h1: 'Live ships: AIS on a 3D globe from the Danube to Hormuz',
      lead: 'OKO shows vessel positions from the Automatic Identification System (AIS) — usually 27 to 33 thousand vessels across the globe. Colour and silhouette reveal the type of ship, and a card shows its flag, navigation status and destination.',
      cta: { label: 'Open ships in the Dover Strait', href: '/?chokepoint=dover' },
      sections: [
        {
          h2: 'What you will see',
          p: [
            'The icon colour shows the type of ship — tanker, cargo, passenger, fishing or tug. Once the camera is below 40 km, ships turn into silhouettes that change with your viewing angle: from above, oblique or side-on. Click a ship to see a card with its flag, navigation status and the destination typed in by the crew; if the destination matches a known port, OKO draws a straight line to it with an arrival estimate based on speed. A trail shows where the ship came from.',
            'Ships that have not reported for ten minutes turn grey and stay on the map as a last known position for six more hours. On the Danube at Bratislava AIS coverage is confirmed, so you see river traffic there too.',
          ],
          list: [
            'Chokepoint scenes: [Hormuz](/?chokepoint=hormuz), [Dover](/?chokepoint=dover) and six more — ships, radar and pipelines in one click.',
            'Ship detections from Sentinel-1 satellite radar via Global Fishing Watch, about three days old.',
            'Historical shipping density from the World Bank and IMF (2015–2021).',
          ],
        },
        {
          h2: 'Where the data come from',
          p: [
            'Live positions come from AISStream.io; when you zoom in, the AISHub network adds more with a delay of 1 to 6 minutes. The browser asks for new positions every 60 seconds and refreshes the current view when the camera stops.',
            'Coverage from coastal AIS receivers is uneven: best in Europe, weaker in Asia and on the open sea. Global Fishing Watch radar detections are licensed CC BY-NC 4.0 and contain modified Copernicus Sentinel data.',
          ],
        },
        {
          h2: 'What OKO does not do',
          p: [
            'The number of ships in view is not total traffic, and a radar detection without an AIS match does not prove a “dark” ship. OKO tracks ships as objects, not the people on board.',
          ],
        },
      ],
      facts: [
        ['Ships on the globe', 'usually 27–33 thousand, including last known positions'],
        ['Refresh', 'every 60 s'],
        ['Sources', 'AISStream.io, AISHub, Global Fishing Watch'],
        ['Danube', 'AIS coverage confirmed at Bratislava'],
      ],
      faq: [
        { q: 'Can I see ships on the Danube?', a: 'At Bratislava, yes — AIS coverage is confirmed there. Further downstream it depends on whether there are AIS receivers nearby.' },
        { q: 'Why are there few ships in some areas?', a: 'Positions come from coastal AIS receivers. Where they are scarce — on the open sea or in parts of Asia — fewer ships appear.' },
        { q: 'What does a grey ship mean?', a: 'The ship has not reported for more than ten minutes. OKO keeps it at its last known position for six more hours.' },
        { q: 'Are radar detections live?', a: 'No. Sentinel-1 detections are about three days old and cover a ten-day window.' },
      ],
      sources: [SRC.aisstream, SRC.aishub, SRC.gfw, SRC.shipDensity],
    },
  },
  {
    id: 'uziny',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'hormuzsky-prieliv-a-uziny',
      nav: 'Hormuz a námorné úžiny',
      teaser: 'Lode naživo v 8 úžinách, radarové detekcie, potrubia a cena ropy.',
      title: 'Hormuzský prieliv a námorné úžiny naživo — lode | OKO',
      description: 'Hormuz, Báb al-Mandab, Suez, Bospor a ďalšie úžiny na 3D glóbuse: lode naživo z AIS, radarové detekcie Sentinel-1, potrubia a cena ropy.',
      h1: 'Hormuzský prieliv a ďalšie námorné úžiny: lode naživo na 3D glóbuse',
      lead: 'Cez niekoľko úzkych prielivov prechádza veľká časť svetového obchodu a ropy. OKO ich ukazuje jedným klikom: Hormuz, Malacca, Báb al-Mandab, Suez, Bospor, Panamský prieplav, Gibraltár a Dover — s loďami naživo, radarovými detekciami a potrubiami.',
      cta: { label: 'Otvoriť Hormuzský prieliv', href: '/?chokepoint=hormuz' },
      sections: [
        {
          h2: 'Čo scéna úžiny ukáže',
          p: [
            'Otvorenie scény zapne naraz všetko, čo k úžine patrí: lode naživo z AIS aj oneskorené z AISHub, radarové detekcie lodí zo satelitov Sentinel-1, plynovody a ropovody z OpenStreetMap, lodné trasy a prístavy. Kamera zaletí nad úžinu.',
            'Karta faktov uvádza, čo úžinou prúdi, a počítadlo ukazuje, koľko lodí s AIS je práve v oblasti úžiny — je to počet sledovaných lodí, nie celková doprava. Ku každej scéne sa pridá karta s cenou ropy Brent a WTI; pri Hormuze aj správy z Perzského zálivu na mieste udalostí.',
          ],
          list: [
            '[Hormuz](/?chokepoint=hormuz), [Báb al-Mandab](/?chokepoint=bab-el-mandeb), [Suez](/?chokepoint=suez), [Bospor](/?chokepoint=bosphorus)',
            '[Malacca](/?chokepoint=malacca), [Panamský prieplav](/?chokepoint=panama), [Gibraltár](/?chokepoint=gibraltar), [Dover](/?chokepoint=dover)',
          ],
        },
        {
          h2: 'Odkiaľ sú údaje a ako sú čerstvé',
          p: [
            'Polohy lodí prichádzajú z AIS cez AISStream.io naživo a cez AISHub s oneskorením 1 až 6 minút. Radarové detekcie Global Fishing Watch zo satelitov Sentinel-1 sú staré približne tri dni a pokrývajú desaťdňové okno; loď v radare bez AIS ešte neznamená „temnú“ loď. Potrubia sú zo snímky OpenStreetMap.',
            'Cena ropy je orientačná — najbližší futures kontrakt z Yahoo Finance, približne spotová cena. Odhady prejazdov z IMF PortWatch pre Hormuz, Báb al-Mandab, Suez a Mys dobrej nádeje nájdete v paneli Blízky východ; sú predbežné a aktualizujú sa približne raz týždenne.',
          ],
        },
        {
          h2: 'Čo úžinami prúdi',
          p: [
            'Karta faktov v scéne uvádza pri každej úžine to podstatné: Hormuzom asi 21 miliónov barelov ropy denne a LNG z Kataru, Malackým prielivom asi štvrtina svetového obchodu s tovarom a ropa do východnej Ázie, Báb al-Mandabom ropa a tovar na suezskú trasu, Suezom asi 12 % svetového obchodu a 10 % námornej ropy, Bosporom ruská a kaspická ropa a obilie z Čierneho mora a Panamským prieplavom asi 5 % svetového námorného obchodu. Gibraltár je jedinou oceánskou bránou Stredomoria a Doverská úžina najrušnejšou trasou s asi 400 loďmi denne.',
          ],
        },
      ],
      facts: [
        ['Úžiny', 'Hormuz, Malacca, Báb al-Mandab, Suez, Bospor, Panama, Gibraltár, Dover'],
        ['Lode', 'AIS naživo (AISStream.io), AISHub s oneskorením'],
        ['Radar', 'Global Fishing Watch, Sentinel-1, asi 3 dni staré'],
        ['Počítadlo', 'lode s AIS v oblasti úžiny, nie celková doprava'],
      ],
      faq: [
        { q: 'Je počet lodí celková doprava?', a: 'Nie. Počítadlo ukazuje lode s AIS, ktoré sú práve v oblasti úžiny. Odhady celkových prejazdov ukazuje karta IMF PortWatch v paneli Blízky východ.' },
        { q: 'Sú radarové detekcie naživo?', a: 'Nie, sú staré približne tri dni. Slúžia na doplnenie obrazu, nie na sledovanie v reálnom čase.' },
        { q: 'Ktoré úžiny OKO pozná?', a: 'Hormuz, Malacca, Báb al-Mandab, Suez, Bospor, Panamský prieplav, Gibraltár a Dover.' },
        { q: 'Dá sa poslať odkaz priamo na úžinu?', a: 'Áno, napríklad okolive.sk/?chokepoint=hormuz otvorí scénu Hormuzského prielivu.' },
      ],
      sources: [SRC.aisstream, SRC.aishub, SRC.gfw, SRC.osm, SRC.portwatch, SRC.yahoo],
    },
    en: {
      slug: 'strait-of-hormuz-chokepoints',
      nav: 'Hormuz and chokepoints',
      teaser: 'Live ships in 8 chokepoints, satellite radar detections, pipelines and the oil price.',
      title: 'Strait of Hormuz and shipping chokepoints live | OKO',
      description: 'Hormuz, Bab el-Mandeb, Suez, the Bosphorus and more on a 3D globe: live AIS ships, Sentinel-1 radar detections, pipelines and the oil price.',
      h1: 'The Strait of Hormuz and other chokepoints: live ships on a 3D globe',
      lead: 'A large share of world trade and oil passes through a handful of narrow straits. OKO shows them in one click: Hormuz, Malacca, Bab el-Mandeb, Suez, the Bosphorus, the Panama Canal, Gibraltar and Dover — with live ships, radar detections and pipelines.',
      cta: { label: 'Open the Strait of Hormuz', href: '/?chokepoint=hormuz' },
      sections: [
        {
          h2: 'What a chokepoint scene shows',
          p: [
            'Opening a scene switches on everything that belongs to the strait at once: live AIS ships and delayed ones from AISHub, ship detections from Sentinel-1 satellite radar, gas and oil pipelines from OpenStreetMap, shipping lanes and ports. The camera flies over the strait.',
            'A fact card states what flows through the strait, and a counter shows how many AIS ships are in the strait area right now — tracked ships, not total traffic. Every scene adds a card with the Brent and WTI oil price; at Hormuz, news from the Persian Gulf also appears where events were reported.',
          ],
          list: [
            '[Hormuz](/?chokepoint=hormuz), [Bab el-Mandeb](/?chokepoint=bab-el-mandeb), [Suez](/?chokepoint=suez), [Bosphorus](/?chokepoint=bosphorus)',
            '[Malacca](/?chokepoint=malacca), [Panama Canal](/?chokepoint=panama), [Gibraltar](/?chokepoint=gibraltar), [Dover](/?chokepoint=dover)',
          ],
        },
        {
          h2: 'Where the data come from and how fresh they are',
          p: [
            'Ship positions come from AIS, live via AISStream.io and via AISHub with a delay of 1 to 6 minutes. Global Fishing Watch detections from Sentinel-1 radar are about three days old and cover a ten-day window; a radar detection without AIS does not prove a “dark” ship. Pipelines come from an OpenStreetMap snapshot.',
            'The oil price is indicative — the front-month futures contract from Yahoo Finance, roughly the spot price. IMF PortWatch transit estimates for Hormuz, Bab el-Mandeb, Suez and the Cape of Good Hope are in the Middle East panel; they are preliminary and updated roughly once a week.',
          ],
        },
        {
          h2: 'What flows through the straits',
          p: [
            'The fact card in each scene sums up the essentials: through Hormuz about 21 million barrels of oil a day and LNG from Qatar, through the Strait of Malacca about a quarter of the world’s traded goods and Gulf oil to East Asia, through Bab el-Mandeb oil and goods on the way to Suez, through Suez about 12% of global trade and 10% of seaborne oil, through the Bosphorus Russian and Caspian oil and Black Sea grain, and through the Panama Canal about 5% of world maritime trade. Gibraltar is the Mediterranean’s only ocean gate, and the Dover Strait is the world’s busiest lane with about 400 ships a day.',
          ],
        },
      ],
      facts: [
        ['Chokepoints', 'Hormuz, Malacca, Bab el-Mandeb, Suez, Bosphorus, Panama, Gibraltar, Dover'],
        ['Ships', 'live AIS (AISStream.io), AISHub delayed'],
        ['Radar', 'Global Fishing Watch, Sentinel-1, about 3 days old'],
        ['Counter', 'AIS ships in the strait area, not total traffic'],
      ],
      faq: [
        { q: 'Is the ship count total traffic?', a: 'No. The counter shows AIS ships currently in the strait area. Estimates of total transits are in the IMF PortWatch card in the Middle East panel.' },
        { q: 'Are the radar detections live?', a: 'No, they are about three days old. They complement the picture rather than track ships in real time.' },
        { q: 'Which chokepoints does OKO know?', a: 'Hormuz, Malacca, Bab el-Mandeb, Suez, the Bosphorus, the Panama Canal, Gibraltar and Dover.' },
        { q: 'Can I link straight to a strait?', a: 'Yes, for example okolive.sk/?chokepoint=hormuz opens the Strait of Hormuz scene.' },
      ],
      sources: [SRC.aisstream, SRC.aishub, SRC.gfw, SRC.osm, SRC.portwatch, SRC.yahoo],
    },
  },
  {
    id: 'blizky-vychod',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'blizky-vychod',
      nav: 'Blízky východ',
      teaser: 'Správy po dejiskách, hlásené údery na mape a kontrola územia podľa Wikipédie.',
      title: 'Blízky východ naživo — správy a mapa dejísk | OKO',
      description: 'Blízky východ na 3D glóbuse: 11 dejísk od Gazy po Hormuz, správy z otvorených zdrojov, hlásené údery na mape a kontrola územia podľa Wikipédie.',
      h1: 'Blízky východ: správy a dianie na mape, dejisko po dejisku',
      lead: 'OKO sleduje dianie na Blízkom východe v 11 dejiskách — Gaza, Západný breh, južný Libanon, Izrael, Červené more, Jemen, južná Sýria, Irak, Irán, Perzský záliv a Hormuz. Ku každému ukáže aktuálne správy z otvorených zdrojov s odkazom na pôvodný článok a hlásené udalosti priamo na mape.',
      cta: { label: 'Otvoriť Blízky východ', href: '/?mideast=overview' },
      sections: [
        {
          h2: 'Čo na mape uvidíte',
          p: [
            'Panel Blízky východ zoraďuje správy podľa dejísk: titulok, médium, čas a odkaz na celý článok. Správy o úderoch OKO rozpozná podľa kľúčových slov a ukáže ich na mieste zásahu — pri širokom zázname, ako je krajina alebo otvorené more, s označením „približne“. Každá takáto karta nesie štítok „hlásené · neoverené“.',
            'V dejiskách Gaza, Západný breh, južný Libanon, Červené more, Jemen a južná Sýria sa ukáže aj to, kto ktorú obec kontroluje — podľa podrobných máp na Wikipédii pod licenciou CC BY-SA 4.0 a s dátumom poslednej úpravy.',
          ],
          list: [
            'Dejiská: [Gaza](/?mideast=gaza), [Západný breh](/?mideast=west-bank), [južný Libanon](/?mideast=south-lebanon), [Izrael](/?mideast=israel), [Červené more](/?mideast=red-sea), [Jemen](/?mideast=yemen), [južná Sýria](/?mideast=south-syria), [Irak](/?mideast=iraq), [Irán](/?mideast=iran), [Perzský záliv](/?mideast=gulf) a [Hormuz](/?mideast=hormuz).',
            'Karta IMF PortWatch s odhadom lodnej dopravy cez Hormuz, Báb al-Mandab, Suez a Mys dobrej nádeje.',
          ],
        },
        {
          h2: 'Odkiaľ sú správy',
          p: [
            'Správy prichádzajú z GDELT a z RSS kanálov dvanástich médií, napríklad BBC, Al Jazeera, The Guardian, France 24 či UN News; keď je správ málo, doplní ich Google News. OKO ukazuje titulok, médium a pri niektorých zdrojoch náhľadový obrázok — celý článok čítate u pôvodného vydavateľa. Médiá pod sankciami EÚ sú vyradené.',
            'Server obnovuje správy každých 15 minút; panel si pri ďalšom otvorení načíta novšie. Mapy kontroly územia z Wikipédie server sťahuje každých 6 hodín a keď sú na Wikipédii dlhšie neaktualizované, OKO ich označí ako staré.',
          ],
        },
        {
          h2: 'Čo OKO zatiaľ nerobí',
          p: [
            'Pre Blízky východ OKO zatiaľ neukazuje frontové línie ani časovú os udalostí a nezobrazuje poplachy ani uzávery vzdušného priestoru. Údaje o úderoch sú hlásenia médií, nie overené fakty. Sledujeme miesta a udalosti, nie ľudí.',
          ],
        },
      ],
      facts: [
        ['Dejiská', '11 a prehľad celého regiónu'],
        ['Správy', 'GDELT a RSS dvanástich médií, doplnok Google News; obnova 15 min'],
        ['Kontrola územia', 'mapy Wikipédie (CC BY-SA 4.0) v 6 dejiskách'],
        ['Lodná doprava', 'IMF PortWatch — odhady, zhruba týždenne'],
      ],
      faq: [
        { q: 'Sú správy overené?', a: 'Nie. OKO zobrazuje titulky a odkazy z otvorených zdrojov a hlásené údery označuje ako neoverené. Pre podrobnosti čítajte pôvodný článok.' },
        { q: 'Ako často sa správy menia?', a: 'Server ich obnovuje každých 15 minút; otvorený panel si novšie správy načíta pri ďalšom otvorení.' },
        { q: 'Odkiaľ je kontrola územia?', a: 'Z podrobných máp na Wikipédii (Izrael a Palestína, Libanon, Jemen, Sýria) pod licenciou CC BY-SA 4.0. Pri každej je dátum a upozornenie, keď je stará.' },
        { q: 'Dá sa otvoriť konkrétne dejisko?', a: 'Áno, napríklad okolive.sk/?mideast=red-sea otvorí Červené more.' },
      ],
      sources: [SRC.gdelt, SRC.rss, SRC.googleNews, SRC.wikipedia, SRC.portwatch],
    },
    en: {
      slug: 'middle-east-live-map',
      nav: 'Middle East',
      teaser: 'News by theatre, reported strikes on the map and territorial control from Wikipedia.',
      title: 'Middle East live map — news and theatres | OKO',
      description: 'The Middle East on a 3D globe: 11 theatres from Gaza to Hormuz, news from open sources, reported strikes on the map and territorial control from Wikipedia.',
      h1: 'The Middle East: news and events on the map, theatre by theatre',
      lead: 'OKO follows events in the Middle East across 11 theatres — Gaza, the West Bank, southern Lebanon, Israel, the Red Sea, Yemen, southern Syria, Iraq, Iran, the Persian Gulf and Hormuz. For each it shows current news from open sources with a link to the original article, and reported events right on the map.',
      cta: { label: 'Open the Middle East', href: '/?mideast=overview' },
      sections: [
        {
          h2: 'What you will see on the map',
          p: [
            'The Middle East panel groups news by theatre: headline, outlet, time and a link to the full article. OKO recognises reports of strikes by keywords and places them where the strike hit — for broad matches such as a country or the open sea, marked “approximately”. Every such card carries the label “reported · unverified”.',
            'In Gaza, the West Bank, southern Lebanon, the Red Sea, Yemen and southern Syria, OKO also shows who controls which settlement — from the detailed maps on Wikipedia under CC BY-SA 4.0, with the date of the last edit.',
          ],
          list: [
            'Theatres: [Gaza](/?mideast=gaza), [West Bank](/?mideast=west-bank), [southern Lebanon](/?mideast=south-lebanon), [Israel](/?mideast=israel), [Red Sea](/?mideast=red-sea), [Yemen](/?mideast=yemen), [southern Syria](/?mideast=south-syria), [Iraq](/?mideast=iraq), [Iran](/?mideast=iran), [Persian Gulf](/?mideast=gulf) and [Hormuz](/?mideast=hormuz).',
            'An IMF PortWatch card with estimated shipping through Hormuz, Bab el-Mandeb, Suez and the Cape of Good Hope.',
          ],
        },
        {
          h2: 'Where the news comes from',
          p: [
            'News comes from GDELT and the RSS feeds of twelve publishers such as the BBC, Al Jazeera, The Guardian, France 24 and UN News; when there is little news, Google News fills in. OKO shows the headline, the outlet and, for some sources, a preview image — you read the full article at the original publisher. Outlets under EU sanctions are excluded.',
            'The server refreshes news every 15 minutes; the panel loads newer items the next time you open it. The server fetches the Wikipedia control maps every 6 hours, and when a map has not been updated on Wikipedia for a long time, OKO marks it as stale.',
          ],
        },
        {
          h2: 'What OKO does not do yet',
          p: [
            'For the Middle East, OKO does not yet show front lines or an event timeline, and it does not show alerts or airspace closures. Strike data are media reports, not verified facts. We track places and events, not people.',
          ],
        },
      ],
      facts: [
        ['Theatres', '11 plus an overview of the region'],
        ['News', 'GDELT and RSS of twelve publishers, Google News fallback; refreshed every 15 min'],
        ['Territorial control', 'Wikipedia maps (CC BY-SA 4.0) in 6 theatres'],
        ['Shipping', 'IMF PortWatch — estimates, roughly weekly'],
      ],
      faq: [
        { q: 'Is the news verified?', a: 'No. OKO shows headlines and links from open sources and labels reported strikes as unverified. Read the original article for details.' },
        { q: 'How often does the news change?', a: 'The server refreshes it every 15 minutes; an open panel loads newer items the next time you open it.' },
        { q: 'Where does territorial control come from?', a: 'From the detailed maps on Wikipedia (Israel and Palestine, Lebanon, Yemen, Syria) under CC BY-SA 4.0. Each shows its date and a warning when it is stale.' },
        { q: 'Can I open a single theatre?', a: 'Yes, for example okolive.sk/?mideast=red-sea opens the Red Sea.' },
      ],
      sources: [SRC.gdelt, SRC.rss, SRC.googleNews, SRC.wikipedia, SRC.portwatch],
    },
  },
  {
    id: 'plyn',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'ceny-a-toky-plynu',
      nav: 'Plyn — ceny a toky',
      teaser: 'Toky plynu cez Slovensko a Európu, zásobníky, LNG a odvodená cena TTF.',
      title: 'Ceny a toky plynu v Európe — mapa tokov a zásobníkov | OKO',
      description: 'Toky plynu cez Slovensko a Európu na 3D mape: body ENTSOG, zásobníky a LNG z GIE, odvodená cena TTF z údajov ACER a dlhodobá história cien.',
      h1: 'Plyn v Európe: toky, zásobníky a cena na jednej mape',
      lead: 'OKO ukazuje, kade prúdi plyn do Európy a cez Slovensko: denné toky na hraničných bodoch, naplnenie zásobníkov, dodávky LNG a cenu plynu odvodenú z údajov európskeho regulátora ACER. Pri každom údaji je dátum, ku ktorému platí, a zreteľné označenie, čo je predbežné alebo odvodené.',
      cta: { label: 'Otvoriť toky plynu', href: LINKS.gas },
      sections: [
        {
          h2: 'Toky na hraničných bodoch',
          p: [
            'Na glóbuse je vyše 30 bodov, cez ktoré tečie plyn. Na hraniciach Slovenska sú to Veľké Kapušany a Budince (Ukrajina), Výrava (Poľsko), Veľké Zlievce (Maďarsko), Lanžhot (Česko), Baumgarten (Rakúsko) a zásobník Láb; ďalej vstupy z Nórska, Spojeného kráľovstva, Alžírska a Líbye a trasy z východu, napríklad TurkStream. Každý bod má kartu s tokom za predchádzajúci deň, 7-dňovým priemerom a grafom za 31 dní.',
            'Údaje z platformy ENTSOG sú predbežné (za predchádzajúci deň) a poloha bodu je približná. Na mape sú aj plynovody z OpenStreetMap — tok sa pri nich ukáže len tam, kde je potrubie podľa názvu spojené so sledovaným bodom.',
          ],
        },
        {
          h2: 'Ceny, zásobníky a LNG',
          p: [
            'Cena TTF na najbližší mesiac je odvodená z denného hodnotenia ceny LNG, ktoré zverejňuje ACER — nie je to burzová kotácia a OKO ju tak aj označuje. Dlhodobú históriu dopĺňajú mesačné údaje MMF z databázy FRED: od roku 1992, v eurách od roku 1999.',
            'Naplnenie zásobníkov a dodávky LNG pochádzajú z platforiem GIE AGSI+ a ALSI. Mesačný dovoz podľa partnerskej krajiny — často je to posledná tranzitná krajina, nie pôvod plynu — prichádza z Eurostatu s oneskorením dva až tri mesiace. Tankery LNG sú lode zo živého AIS: potvrdené podľa zoznamu z Wikidata, ostatné označené ako pravdepodobné podľa názvu, typu a rozmerov.',
          ],
        },
        {
          h2: 'Ako často sa údaje menia',
          p: [
            'Panel aj vrstva na glóbuse sa obnovujú každých 30 minút. Samotné zdroje vychádzajú denne — toky za predchádzajúci deň, ceny v pracovné dni večer, zásobníky denne — a Eurostat raz mesačne.',
          ],
        },
      ],
      facts: [
        ['Body', 'vyše 30, z toho 7 na hraniciach Slovenska'],
        ['Toky', 'ENTSOG, predbežné, za predchádzajúci deň'],
        ['Cena', 'TTF odvodená z ACER (nie burza)'],
        ['Zásobníky a LNG', 'GIE AGSI+ / ALSI'],
      ],
      faq: [
        { q: 'Je cena TTF burzová?', a: 'Nie. OKO ju odvodzuje z denného hodnotenia ACER (cena LNG mínus referenčná hodnota). Je označená ako odvodená a vychádza v pracovné dni večer.' },
        { q: 'Vidím tok v každom plynovode?', a: 'Nie. Tok sa ukáže len pri sledovaných bodoch a pri potrubiach, ktoré k nim podľa názvu patria.' },
        { q: 'Ako aktuálne sú toky?', a: 'Toky sú za predchádzajúci deň a sú predbežné. OKO ich kontroluje každých 30 minút.' },
        { q: 'Ukazuje OKO aj ceny pre domácnosti?', a: 'Nie. OKO ukazuje veľkoobchodné ceny — odvodenú cenu TTF z údajov ACER a dlhodobú históriu podľa MMF.' },
      ],
      sources: [SRC.entsog, SRC.acer, SRC.gie, SRC.eurostat, SRC.fred, SRC.osm, SRC.wikidata],
    },
    en: {
      slug: 'european-gas-prices-and-flows',
      nav: 'Gas — prices and flows',
      teaser: 'Gas flows through Slovakia and Europe, storage, LNG and a derived TTF price.',
      title: 'European gas prices and flows — flow and storage map | OKO',
      description: 'Gas flows through Slovakia and Europe on a 3D map: ENTSOG points, storage and LNG from GIE, a TTF price derived from ACER data and long-term price history.',
      h1: 'Gas in Europe: flows, storage and price on one map',
      lead: 'OKO shows where gas flows into Europe and through Slovakia: daily flows at border points, storage levels, LNG send-out and a gas price derived from data of the EU regulator ACER. Every figure shows the date it refers to and clearly marks what is provisional or derived.',
      cta: { label: 'Open gas flows', href: LINKS.gas },
      sections: [
        {
          h2: 'Flows at interconnection points',
          p: [
            'The globe shows more than 30 points where gas flows. On Slovakia’s borders they are Veľké Kapušany and Budince (Ukraine), Výrava (Poland), Veľké Zlievce (Hungary), Lanžhot (Czechia), Baumgarten (Austria) and the Láb storage site; further entries come from Norway, the United Kingdom, Algeria and Libya, plus routes from the east such as TurkStream. Each point has a card with the previous day’s flow, a 7-day average and a 31-day chart.',
            'ENTSOG data are provisional (for the previous day) and point locations are approximate. The map also shows pipelines from OpenStreetMap — a flow appears on a pipe only where it is linked by name to a tracked point.',
          ],
        },
        {
          h2: 'Prices, storage and LNG',
          p: [
            'The front-month TTF price is derived from the daily LNG price assessment published by ACER — it is not an exchange quote, and OKO labels it as derived. Monthly IMF data from FRED extend the history: from 1992, in euros from 1999.',
            'Storage levels and LNG send-out come from the GIE AGSI+ and ALSI platforms. Monthly imports by partner country — often the last transit country rather than the origin of the gas — come from Eurostat with a delay of two to three months. LNG carriers are ships from live AIS: confirmed against a list from Wikidata, the rest marked as likely by name, type and size.',
          ],
        },
        {
          h2: 'How often the data change',
          p: [
            'The panel and the globe layer refresh every 30 minutes. The sources themselves publish daily — flows for the previous day, prices on weekday evenings, storage daily — and Eurostat monthly.',
          ],
        },
      ],
      facts: [
        ['Points', 'more than 30, of which 7 on Slovakia’s borders'],
        ['Flows', 'ENTSOG, provisional, previous day'],
        ['Price', 'TTF derived from ACER (not an exchange)'],
        ['Storage and LNG', 'GIE AGSI+ / ALSI'],
      ],
      faq: [
        { q: 'Is the TTF price an exchange quote?', a: 'No. OKO derives it from the ACER daily assessment (LNG price minus benchmark). It is labelled as derived and published on weekday evenings.' },
        { q: 'Can I see the flow in every pipeline?', a: 'No. A flow appears only at tracked points and on pipelines linked to them by name.' },
        { q: 'How current are the flows?', a: 'Flows are for the previous day and provisional. OKO checks them every 30 minutes.' },
        { q: 'Does OKO show household gas prices?', a: 'No. OKO shows wholesale prices — the TTF price derived from ACER data and the long-term IMF history.' },
      ],
      sources: [SRC.entsog, SRC.acer, SRC.gie, SRC.eurostat, SRC.fred, SRC.osm, SRC.wikidata],
    },
  },
  {
    id: 'satelity',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'satelity-nazivo',
      nav: 'Satelity naživo',
      teaser: 'ISS, GPS, Galileo, geostacionárne satelity a Starlink na 3D glóbuse.',
      title: 'Satelity naživo na 3D glóbuse — ISS, GPS, Starlink | OKO',
      description: 'Satelity naživo na 3D glóbuse: ISS, navigačné GPS, GLONASS a Galileo, geostacionárne a komunikačné satelity aj Starlink, zoradené podľa služby.',
      h1: 'Satelity naživo: čo nad nami práve letí',
      lead: 'OKO počíta polohy satelitov z verejných dráhových údajov a ukazuje ich na 3D glóbuse — približne 840 vybraných objektov a v hustom režime navyše vyše 10 000 satelitov Starlink. Sú zoradené podľa služby: vesmírne stanice, navigácia, geostacionárne a komunikačné satelity a najjasnejšie objekty viditeľné voľným okom.',
      cta: { label: 'Sledovať ISS', href: LINKS.iss },
      sections: [
        {
          h2: 'Čo uvidíte',
          p: [
            'Každý satelit má značku podľa triedy. Kliknutím ho začnete sledovať: kamera sa k nemu presunie a jeho dráha sa vykreslí ako žltý prstenec. Medzinárodná vesmírna stanica ISS má červenú značku so stálym popiskom a jej dráha je na mape stále. Navigačné systémy GPS, GLONASS a Galileo ukazujú, prečo váš telefón vie, kde je, a geostacionárny prstenec nad rovníkom zas satelity pre televíziu a komunikáciu.',
            'Hustý režim pridá satelity Starlink — spolu približne 11 500 objektov. Vrstva vesmírnych misií z Launch Library 2 ukazuje štarty rakiet za posledných 30 dní.',
          ],
          list: [
            'Priamy odkaz: [sledovať ISS](' + LINKS.iss + ').',
          ],
        },
        {
          h2: 'Ako OKO počíta polohy',
          p: [
            'Dráhové prvky (TLE) poskytuje CelesTrak (Dr. T. S. Kelso) a server ich obnovuje každých 6 hodín. OKO z nich modelom SGP4 počíta polohy každú sekundu; počas sledovania päťkrát za sekundu a sledovaný satelit v každom snímku.',
            'Polohy sú vypočítané, nie priamo namerané — pre bežné satelity sú dosť presné na to, aby ste vedeli, kde sa nad Zemou práve nachádzajú, no nejde o telemetriu.',
          ],
        },
        {
          h2: 'Čo v OKO nenájdete',
          p: [
            'OKO neukazuje úplný katalóg všetkých objektov na obežnej dráhe — len vybrané skupiny z CelesTrak. Chýba napríklad čínsky navigačný systém BeiDou.',
          ],
        },
      ],
      facts: [
        ['Objektov', 'približne 840, so Starlinkom asi 11 500'],
        ['Triedy', 'stanice, navigácia, geostacionárne, komunikačné, viditeľné'],
        ['Zdroj dráh', 'CelesTrak (TLE), výpočet SGP4'],
        ['Obnovovanie', 'poloha každú sekundu, dráhové prvky každých 6 hodín'],
      ],
      faq: [
        { q: 'Kde je práve ISS?', a: 'Otvorte odkaz „Sledovať ISS“ — kamera sa zameria na Medzinárodnú vesmírnu stanicu a ukáže jej dráhu.' },
        { q: 'Sú polohy presné?', a: 'Sú vypočítané z verejných dráhových prvkov modelom SGP4. Na orientáciu to stačí, no nejde o priame merania.' },
        { q: 'Prečo nevidím všetky satelity?', a: 'Bežný režim ukazuje približne 840 vybraných objektov zo skupín CelesTrak a hustý režim pridá Starlink. Úplný katalóg všetkých objektov na obežnej dráhe OKO nezobrazuje.' },
        { q: 'Čo znamená trieda satelitu?', a: 'Služba, ktorú satelit poskytuje: vesmírna stanica, navigácia, geostacionárna dráha, komunikácia — alebo ide o jeden z najjasnejších objektov viditeľných voľným okom, medzi ktorými sú aj vyhorené stupne rakiet.' },
      ],
      sources: [SRC.celestrak, SRC.spacedevs],
    },
    en: {
      slug: 'live-satellite-tracker',
      nav: 'Live satellites',
      teaser: 'The ISS, GPS, Galileo, geostationary satellites and Starlink on a 3D globe.',
      title: 'Live satellite tracker on a 3D globe — ISS, GPS, Starlink | OKO',
      description: 'Live satellites on a 3D globe: the ISS, GPS, GLONASS and Galileo navigation, geostationary and communication satellites and Starlink, sorted by service.',
      h1: 'Live satellites: what is flying overhead right now',
      lead: 'OKO computes satellite positions from public orbital data and shows them on a 3D globe — about 840 selected objects, plus more than 10,000 Starlink satellites in dense mode. They are sorted by service: space stations, navigation, geostationary and communication satellites, and the brightest objects visible to the naked eye.',
      cta: { label: 'Track the ISS', href: LINKS.iss },
      sections: [
        {
          h2: 'What you will see',
          p: [
            'Each satellite has a marker by class. Click it to follow it: the camera moves to it and its orbit is drawn as a yellow ring. The International Space Station has a red marker with a permanent label, and its orbit is always shown. The GPS, GLONASS and Galileo navigation systems show why your phone knows where it is, and the geostationary ring above the equator holds television and communication satellites.',
            'Dense mode adds Starlink — about 11,500 objects in total. A space missions layer from Launch Library 2 shows rocket launches from the past 30 days.',
          ],
          list: [
            'Direct link: [track the ISS](' + LINKS.iss + ').',
          ],
        },
        {
          h2: 'How OKO computes positions',
          p: [
            'Orbital elements (TLE) come from CelesTrak (Dr T. S. Kelso), and the server refreshes them every 6 hours. OKO propagates them with the SGP4 model every second; while you follow a satellite, five times a second, and the followed satellite itself on every frame.',
            'Positions are computed, not directly measured — accurate enough to know where an ordinary satellite is above the Earth, but they are not telemetry.',
          ],
        },
        {
          h2: 'What you will not find in OKO',
          p: [
            'OKO does not show the complete catalogue of everything in orbit — only selected groups from CelesTrak. The Chinese BeiDou navigation system, for example, is missing.',
          ],
        },
      ],
      facts: [
        ['Objects', 'about 840; about 11,500 with Starlink'],
        ['Classes', 'stations, navigation, geostationary, communications, visual'],
        ['Orbit source', 'CelesTrak (TLE), SGP4 propagation'],
        ['Refresh', 'position every second, orbital elements every 6 hours'],
      ],
      faq: [
        { q: 'Where is the ISS right now?', a: 'Open the “Track the ISS” link — the camera locks onto the International Space Station and shows its orbit.' },
        { q: 'Are the positions accurate?', a: 'They are computed from public orbital elements with the SGP4 model. That is enough for orientation, but they are not direct measurements.' },
        { q: 'Why can I not see every satellite?', a: 'The normal mode shows about 840 selected objects from CelesTrak groups, and dense mode adds Starlink. OKO does not show the complete catalogue of everything in orbit.' },
        { q: 'What does a satellite class mean?', a: 'The service the satellite provides: space station, navigation, geostationary orbit, communications — or one of the brightest objects visible to the naked eye, which include spent rocket stages.' },
      ],
      sources: [SRC.celestrak, SRC.spacedevs],
    },
  },
  {
    id: 'kamery',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'dopravne-kamery',
      nav: 'Dopravné kamery',
      teaser: 'Snímky z verejných dopravných kamier v Londýne a Austine priamo na 3D mape.',
      title: 'Dopravné kamery na 3D mape — Londýn a Austin | OKO',
      description: 'Dopravné kamery na 3D glóbuse: snímky z verejných kamier v Londýne (TfL) a v texaskom Austine, obnovované každé 3 až 5 minút, priamo v 3D meste.',
      h1: 'Dopravné kamery na 3D mape: čo práve vidí mesto',
      lead: 'OKO umiestni verejné dopravné kamery priamo do 3D mesta, takže posledný záber kamery vidíte na mieste, kde stojí. Dnes sú to najmä dve siete: 250 kamier londýnskeho dopravného podniku Transport for London (JamCams) a 250 kamier mesta Austin v Texase.',
      cta: { label: 'Otvoriť kamery v Londýne', href: LINKS.london },
      sections: [
        {
          h2: 'Ako kamery fungujú',
          p: [
            'Kamery sú statické snímky, nie video: náhľady sa obnovujú každé 3 minúty v Londýne a každých 5 minút v Austine, vybraná kamera každých 10 sekúnd. Keď kameru vyberiete, pri nej a pri najbližších kamerách sa na mape ukáže kužeľ pohľadu. V Austine vychádza jeho smer z údajov mesta; londýnske kamery smer neuvádzajú, takže tam kužeľ skutočný smer nevyjadruje.',
            'Na letiskových kartách sú aj dva vybrané živé prenosy z YouTube: Praha (LKPR) a Los Angeles (KLAX).',
          ],
          list: [
            'Priamy odkaz: [kamery v Londýne](' + LINKS.london + ').',
          ],
        },
        {
          h2: 'Prečo zatiaľ nie sú slovenské kamery',
          p: [
            'Otvorené dopravné kamery zverejňuje na Slovensku Slovenská správa ciest na portáli zjazdnost.sk. Ich snímky možno s uvedením zdroja zobrazovať, no vychádzajú len počas zimnej údržby ciest, približne od novembra do marca — OKO je na ne pripravené. Iné verejné dopravné kamery s otvorenými dátami sme na Slovensku zatiaľ nenašli.',
          ],
        },
        {
          h2: 'Etická čiara',
          p: [
            'OKO pracuje s objektmi a infraštruktúrou, nie s ľuďmi: kamery slúžia na pohľad na dopravu a počasie. Nerozpoznávame tváre ani evidenčné čísla a nesledujeme jednotlivcov.',
          ],
        },
      ],
      facts: [
        ['Kamery', 'Londýn (TfL) 250, Austin 250'],
        ['Typ', 'statické snímky, nie video'],
        ['Obnovovanie', 'každé 3–5 minút, vybraná kamera 10 s'],
        ['Slovensko', 'zimné kamery zjazdnost.sk, keď ich SSC zverejňuje'],
      ],
      faq: [
        { q: 'Sú to živé videá?', a: 'Nie. Ide o snímky obnovované každé 3 až 5 minút; vybraná kamera sa obnovuje každých 10 sekúnd. Živé video je len na dvoch letiskových kartách z YouTube.' },
        { q: 'Prečo nie sú v OKO slovenské kamery?', a: 'Otvorené dopravné kamery na Slovensku zverejňuje len Slovenská správa ciest (zjazdnost.sk), a to iba počas zimnej údržby ciest. OKO je na ne pripravené.' },
        { q: 'Rozpoznáva OKO ľudí alebo evidenčné čísla?', a: 'Nie. OKO nerozpoznáva tváre ani evidenčné čísla a nesleduje jednotlivcov.' },
        { q: 'Ukazuje kužeľ presný smer kamery?', a: 'Pri kamerách v Austine približne — smer pochádza z údajov mesta. Londýnske kamery smer neuvádzajú, takže pri nich kužeľ skutočný smer nevyjadruje.' },
        { q: 'Ako sa ku kamerám dostanem?', a: 'Najrýchlejšie cez odkaz na tejto stránke — otvorí Londýn so zapnutými kamerami. Kliknutím na kameru sa zobrazí jej posledný záber.' },
      ],
      sources: [SRC.tfl, SRC.austin],
    },
    en: {
      slug: 'traffic-cameras-3d-map',
      nav: 'Traffic cameras',
      teaser: 'Images from public traffic cameras in London and Austin, right on the 3D map.',
      title: 'Traffic cameras on a 3D map — London and Austin | OKO',
      description: 'Traffic cameras on a 3D globe: images from public cameras in London (TfL) and Austin, Texas, refreshed every 3 to 5 minutes, placed right in the 3D city.',
      h1: 'Traffic cameras on a 3D map: what the city sees right now',
      lead: 'OKO places public traffic cameras right into the 3D city, so you see each camera’s latest image where it stands. Today there are mainly two networks: 250 cameras from Transport for London (JamCams) and 250 from the City of Austin, Texas.',
      cta: { label: 'Open London cameras', href: LINKS.london },
      sections: [
        {
          h2: 'How the cameras work',
          p: [
            'Cameras are still images, not video: thumbnails refresh every 3 minutes in London and every 5 minutes in Austin, and the selected camera every 10 seconds. When you select a camera, a view cone appears for it and the nearest cameras. In Austin its direction comes from the city’s data; London cameras do not publish a direction, so there the cone does not show the real one.',
            'Airport cards also carry two selected live streams from YouTube: Prague (LKPR) and Los Angeles (KLAX).',
          ],
          list: [
            'Direct link: [London cameras](' + LINKS.london + ').',
          ],
        },
        {
          h2: 'Why there are no Slovak cameras yet',
          p: [
            'In Slovakia, open traffic cameras are published by the Slovak Road Administration on zjazdnost.sk. Their images may be shown with attribution, but only during winter road maintenance, roughly November to March — OKO is ready for them. We have not found other public traffic cameras with open data in Slovakia yet.',
          ],
        },
        {
          h2: 'The ethical line',
          p: [
            'OKO works with objects and infrastructure, not people: cameras are there to show traffic and weather. We do not recognise faces or number plates and do not track individuals.',
          ],
        },
      ],
      facts: [
        ['Cameras', 'London (TfL) 250, Austin 250'],
        ['Type', 'still images, not video'],
        ['Refresh', 'every 3–5 minutes, selected camera every 10 s'],
        ['Slovakia', 'zjazdnost.sk winter cameras while the SSC publishes them'],
      ],
      faq: [
        { q: 'Is this live video?', a: 'No. These are images refreshed every 3 to 5 minutes; the selected camera refreshes every 10 seconds. Live video appears only in two airport cards from YouTube.' },
        { q: 'Why are there no Slovak cameras?', a: 'In Slovakia only the Slovak Road Administration (zjazdnost.sk) publishes open traffic cameras, and only during winter road maintenance. OKO is ready for them.' },
        { q: 'Does OKO recognise people or number plates?', a: 'No. OKO does not recognise faces or number plates and does not track individuals.' },
        { q: 'Does the cone show the camera’s exact direction?', a: 'For Austin cameras, approximately — the direction comes from the city’s data. London cameras do not publish a direction, so their cone does not show the real one.' },
        { q: 'How do I get to the cameras?', a: 'The quickest way is the link on this page — it opens London with the cameras switched on. Click a camera to see its latest image.' },
      ],
      sources: [SRC.tfl, SRC.austin],
    },
  },
  {
    id: 'pocasie',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'pocasie-radar-zemetrasenia',
      nav: 'Počasie a prírodné javy',
      teaser: 'Zrážkový radar SHMÚ, predpoveď vetra a teploty, zemetrasenia a sopky.',
      title: 'Zrážkový radar, zemetrasenia a sopky na 3D mape | OKO',
      description: 'Počasie a prírodné javy na 3D glóbuse: zrážkový radar SHMÚ každých 5 minút, predpoveď GFS na 72 hodín, zemetrasenia za 24 hodín, sopky a búrky.',
      h1: 'Počasie a prírodné javy: radar, predpoveď, zemetrasenia a sopky',
      lead: 'OKO spája pozorovania a predpovede z verejných zdrojov: zrážkový radar Slovenského hydrometeorologického ústavu, predpoveď modelu GFS na tri dni, zemetrasenia z posledných 24 hodín a aktívne sopky, búrky či povodne zo systému NASA EONET.',
      cta: { label: 'Otvoriť radar nad Slovenskom', href: LINKS.radar },
      sections: [
        {
          h2: 'Zrážkový radar SHMÚ',
          p: [
            'Kompozit radarovej siete SHMÚ pokrýva Slovensko a okolie a obnovuje sa každých 5 minút. OKO prehrá posledných sedem snímok, teda asi pol hodiny, takže vidíte, kam sa zrážky posúvajú; snímku staršiu ako 20 minút označí ako neaktuálnu.',
          ],
          list: [
            'Priamy odkaz: [radar nad Slovenskom](' + LINKS.radar + ').',
          ],
        },
        {
          h2: 'Predpoveď počasia',
          p: [
            'Vrstva meteo ukazuje predpoveď globálneho modelu GFS (NOAA): vietor pri zemi aj vo výškach, teplotu, tlak a izobary, zrážky, oblačnosť a nárazy vetra v trojhodinových krokoch až na 72 hodín dopredu. Je to predpoveď, nie pozorovanie, a tak je aj označená.',
          ],
        },
        {
          h2: 'Denné satelitné mapy NASA',
          p: [
            'Z NASA GIBS pridáva OKO denné satelitné mozaiky: teplotu morskej hladiny, zrážky, snehovú pokrývku, aerosóly v ovzduší, morský ľad a nočné svetlá Zeme. Sú to denné snímky, nie živé dáta — pri každej je deň, ku ktorému platí, a ak najnovší deň ešte nie je hotový, OKO ukáže predchádzajúci a označí ho. Kreslia sa nad dvojrozmerným podkladom mapy, nie nad fotorealistickým 3D.',
          ],
        },
        {
          h2: 'Zemetrasenia, sopky a ďalšie javy',
          p: [
            'Zemetrasenia z posledných 24 hodín spája OKO z USGS a EMSC a obnovuje ich každú minútu. Aktívne sopky, búrky s dráhou a rýchlosťou vetra, povodne, zosuvy pôdy či prachové búrky prichádzajú zo systému NASA EONET každých 10 minút.',
            'OKO nevydáva výstrahy ani varovania — na to slúžia oficiálne služby SHMÚ a civilnej ochrany. Radar neukazuje predpoveď zrážok a stav hladín riek zatiaľ nesledujeme.',
          ],
          list: [
            'Priamy odkaz: [zemetrasenia, sopky a javy vo svete](' + LINKS.hazards + ').',
          ],
        },
      ],
      facts: [
        ['Radar', 'SHMÚ, každých 5 minút (CC BY 4.0)'],
        ['Predpoveď', 'GFS, kroky po 3 h, do +72 h'],
        ['Zemetrasenia', 'USGS a EMSC, posledných 24 h'],
        ['Prírodné javy', 'NASA EONET, každých 10 minút'],
        ['Satelitné mapy', 'NASA GIBS, denné mozaiky'],
      ],
      faq: [
        { q: 'Nahrádza OKO výstrahy SHMÚ?', a: 'Nie. OKO ukazuje radar, predpoveď a udalosti, ale výstrahy nevydáva. Pri nebezpečnom počasí sa riaďte oficiálnymi výstrahami SHMÚ.' },
        { q: 'Ako často sa radar obnovuje?', a: 'Každých 5 minút. OKO prehráva posledných sedem snímok, teda asi pol hodiny.' },
        { q: 'Odkiaľ je predpoveď počasia?', a: 'Z globálneho modelu GFS amerického úradu NOAA, v krokoch po tri hodiny na 72 hodín dopredu.' },
        { q: 'Ktoré zemetrasenia OKO ukazuje?', a: 'Všetky, ktoré za posledných 24 hodín zaznamenali USGS a EMSC; zoznam sa obnovuje každú minútu.' },
      ],
      sources: [SRC.shmu, SRC.gfs, SRC.usgs, SRC.emsc, SRC.eonet, SRC.gibs],
    },
    en: {
      slug: 'weather-radar-earthquakes',
      nav: 'Weather and natural events',
      teaser: 'SHMÚ precipitation radar, wind and temperature forecast, earthquakes and volcanoes.',
      title: 'Weather radar, earthquakes and volcanoes on a 3D map | OKO',
      description: 'Weather and natural events on a 3D globe: SHMÚ rain radar every 5 minutes, a 72-hour GFS forecast, earthquakes from the last 24 hours, volcanoes and storms.',
      h1: 'Weather and natural events: radar, forecast, earthquakes and volcanoes',
      lead: 'OKO combines observations and forecasts from public sources: the precipitation radar of the Slovak Hydrometeorological Institute, a three-day forecast from the GFS model, earthquakes from the last 24 hours, and active volcanoes, storms and floods from NASA EONET.',
      cta: { label: 'Open the radar over Slovakia', href: LINKS.radar },
      sections: [
        {
          h2: 'SHMÚ precipitation radar',
          p: [
            'The composite of the SHMÚ radar network covers Slovakia and its surroundings and refreshes every 5 minutes. OKO replays the last seven images, about half an hour, so you can see where the rain is moving; an image older than 20 minutes is marked as stale.',
          ],
          list: [
            'Direct link: [radar over Slovakia](' + LINKS.radar + ').',
          ],
        },
        {
          h2: 'Weather forecast',
          p: [
            'The meteo layer shows the forecast of the global GFS model (NOAA): wind near the ground and aloft, temperature, pressure and isobars, precipitation, cloud cover and gusts in three-hour steps up to 72 hours ahead. It is a forecast, not an observation, and it is labelled as such.',
          ],
        },
        {
          h2: 'Daily NASA satellite maps',
          p: [
            'From NASA GIBS, OKO adds daily satellite mosaics: sea surface temperature, precipitation, snow cover, aerosols, sea ice and the Earth’s night lights. They are daily images, not live data — each shows the day it refers to, and if the latest day is not ready yet, OKO falls back to the previous one and marks it. They are drawn over a flat base map, not over the photorealistic 3D view.',
          ],
        },
        {
          h2: 'Earthquakes, volcanoes and other events',
          p: [
            'OKO merges earthquakes from the last 24 hours from USGS and EMSC and refreshes them every minute. Active volcanoes, storms with track and wind speed, floods, landslides and dust storms come from NASA EONET every 10 minutes.',
            'OKO does not issue warnings or alerts — official SHMÚ and civil protection services do that. The radar does not show a precipitation forecast, and river levels are not tracked yet.',
          ],
          list: [
            'Direct link: [earthquakes, volcanoes and events worldwide](' + LINKS.hazards + ').',
          ],
        },
      ],
      facts: [
        ['Radar', 'SHMÚ, every 5 minutes (CC BY 4.0)'],
        ['Forecast', 'GFS, 3-hour steps, up to +72 h'],
        ['Earthquakes', 'USGS and EMSC, last 24 h'],
        ['Natural events', 'NASA EONET, every 10 minutes'],
        ['Satellite maps', 'NASA GIBS, daily mosaics'],
      ],
      faq: [
        { q: 'Does OKO replace SHMÚ warnings?', a: 'No. OKO shows radar, forecast and events, but it does not issue warnings. In dangerous weather, follow the official SHMÚ warnings.' },
        { q: 'How often does the radar refresh?', a: 'Every 5 minutes. OKO replays the last seven images, about half an hour.' },
        { q: 'Where does the forecast come from?', a: 'From the global GFS model of the US agency NOAA, in three-hour steps up to 72 hours ahead.' },
        { q: 'Which earthquakes does OKO show?', a: 'All those recorded by USGS and EMSC in the last 24 hours; the list refreshes every minute.' },
      ],
      sources: [SRC.shmu, SRC.gfs, SRC.usgs, SRC.emsc, SRC.eonet, SRC.gibs],
    },
  },
  {
    id: 'o-projekte',
    updated: '2026-09-30',
    image: null,
    sk: {
      slug: 'o-projekte',
      nav: 'O projekte',
      teaser: 'Kto OKO robí, z akých otvorených dát a podľa akých pravidiel.',
      title: 'O projekte OKO — živý 3D glóbus z otvorených dát',
      description: 'OKO je bezplatný živý 3D glóbus z otvorených dát: lietadlá, lode, konflikty, plyn a satelity. Kto ho robí, z akých zdrojov a podľa akých pravidiel.',
      h1: 'O projekte OKO',
      lead: 'OKO je bezplatný živý 3D glóbus, ktorý na jednom mieste spája otvorené dáta o doprave, energetike, počasí a konfliktoch. Vytvára ho Vladimír Uhrin na Slovensku s dôrazom na stredoeurópske zdroje — pritom celý svet zostáva plne živý.',
      cta: { label: 'Otvoriť živý 3D glóbus', href: '/' },
      sections: [
        {
          h2: 'Ako OKO vzniklo',
          p: [
            'OKO vychádza z otvoreného projektu gods-eye-view od Bilawala Sidhua (licencia MIT) a rozširuje ho o slovenské a stredoeurópske zdroje, prehľadnú mapu frontu na Ukrajine a moduly plynu, námorných úžin a Blízkeho východu. Je postavené na knižnici CesiumJS a fotorealistických 3D dlaždiciach Google, ktoré načítava priamo alebo cez službu Cesium ion. Fotorealistické 3D budovy má na Slovensku napríklad Bratislava; kde chýbajú, pomáha slovenská ortofotomapa a OpenStreetMap.',
            'Projekt je v stave BETA — pribúdajú vrstvy a niektoré veci sa ešte menia.',
          ],
        },
        {
          h2: 'Pravidlá, ktorých sa držíme',
          list: [
            'Zdroje a licencie vrstiev uvádzame priamo v mape; oneskorené, odhadované a odvodené údaje označujeme.',
            'Sledujeme objekty, infraštruktúru a udalosti — nie ľudí. Žiadne rozpoznávanie tvárí ani sledovanie jednotlivcov.',
            'Tajné kľúče k dátovým službám zostávajú na serveri; do prehliadača idú len kľúče pre mapové dlaždice Google a Cesium ion.',
            'Z médií nepreberáme celé články — ukazujeme titulok a odkaz na pôvodného vydavateľa.',
          ],
        },
        {
          h2: 'Ako OKO funguje',
          p: [
            'Väčšinu dát sťahuje server OKO na Slovensku z otvorených zdrojov, krátko si ich uchová a posiela ich prehliadaču — šetrí tak kvóty poskytovateľov a tajné kľúče nie sú na webovej stránke. Samotný glóbus a všetky vrstvy sa vykresľujú priamo vo vašom prehliadači. Krátke zdieľané odkazy sa uchovávajú 90 dní.',
          ],
        },
        {
          h2: 'Čo potrebujete',
          p: [
            'Stačí moderný prehliadač s podporou WebGL — na počítači aj v mobile. Účet je voliteľný a bezplatný a umožní uložiť si sledované lety. Pohľad, ktorý práve vidíte, môžete zdieľať krátkym odkazom s náhľadom pre sociálne siete; scény frontu, úžin a Blízkeho východu aj ako kartičku na šírku, na výšku alebo štvorec.',
          ],
        },
      ],
      facts: [
        ['Cena', 'zadarmo'],
        ['Jazyky', 'slovenčina a angličtina'],
        ['Technológia', 'CesiumJS, fotorealistické 3D dlaždice Google, OpenStreetMap'],
        ['Stav', 'BETA'],
      ],
      faq: [
        { q: 'Je OKO zadarmo?', a: 'Áno. Glóbus aj všetky vrstvy sú bezplatné a nepotrebujú registráciu.' },
        { q: 'Potrebujem účet?', a: 'Nie. Účet je voliteľný a slúži na ukladanie sledovaných letov.' },
        { q: 'Funguje OKO v mobile?', a: 'Áno, v prehliadači s podporou WebGL. Na slabších telefónoch môže byť 3D pomalšie.' },
        { q: 'Odkiaľ sú mapy?', a: 'Fotorealistické 3D dlaždice Google (priamo alebo cez Cesium ion), OpenStreetMap a na Slovensku aj Ortofotomozaika SR (© GKÚ Bratislava, NLC, CC BY 4.0).' },
      ],
      sources: [SRC.godsEye, SRC.cesium, SRC.google3d, SRC.osm, SRC.ortofoto],
    },
    en: {
      slug: 'about',
      nav: 'About',
      teaser: 'Who makes OKO, from which open data, and by which rules.',
      title: 'About OKO — a live 3D globe built on open data',
      description: 'OKO is a free live 3D globe built on open data: aircraft, ships, conflicts, gas and satellites. Who makes it, which sources it uses and the rules it follows.',
      h1: 'About OKO',
      lead: 'OKO is a free live 3D globe that brings open data on transport, energy, weather and conflicts together in one place. It is made by Vladimír Uhrin in Slovakia with a focus on Central European sources — while the whole world stays fully live.',
      cta: { label: 'Open the live 3D globe', href: '/' },
      sections: [
        {
          h2: 'How OKO came about',
          p: [
            'OKO builds on the open gods-eye-view project by Bilawal Sidhu (MIT licence) and extends it with Slovak and Central European sources, a clean front map for Ukraine, and modules for gas, shipping chokepoints and the Middle East. It is built on CesiumJS and Google’s photorealistic 3D tiles, loaded directly or through Cesium ion. In Slovakia, Bratislava for example has photorealistic 3D buildings; where they are missing, the Slovak orthophoto map and OpenStreetMap help.',
            'The project is in BETA — layers keep arriving and some things are still changing.',
          ],
        },
        {
          h2: 'The rules we follow',
          list: [
            'Layer sources and licences are shown right in the map; delayed, estimated and derived data are labelled.',
            'We track objects, infrastructure and events — not people. No face recognition and no tracking of individuals.',
            'Secret keys to data services stay on the server; only the Google and Cesium ion map tile keys reach the browser.',
            'We do not republish articles — we show the headline and a link to the original publisher.',
          ],
        },
        {
          h2: 'How OKO works',
          p: [
            'Most data are fetched by the OKO server in Slovakia from open sources, kept briefly and passed to your browser — this saves providers’ quotas and keeps secret keys off the web page. The globe and all layers are rendered right in your browser. Short share links are kept for 90 days.',
          ],
        },
        {
          h2: 'What you need',
          p: [
            'A modern browser with WebGL is enough — on a computer or a phone. An account is optional and free and lets you save followed flights. You can share the view you are looking at with a short link that has a preview for social networks; front, chokepoint and Middle East scenes also as a card in landscape, portrait or square format.',
          ],
        },
      ],
      facts: [
        ['Price', 'free'],
        ['Languages', 'Slovak and English'],
        ['Technology', 'CesiumJS, Google photorealistic 3D tiles, OpenStreetMap'],
        ['Status', 'BETA'],
      ],
      faq: [
        { q: 'Is OKO free?', a: 'Yes. The globe and all layers are free and need no sign-up.' },
        { q: 'Do I need an account?', a: 'No. An account is optional and is used to save followed flights.' },
        { q: 'Does OKO work on a phone?', a: 'Yes, in a browser with WebGL. On slower phones 3D can be sluggish.' },
        { q: 'Where do the maps come from?', a: 'Google photorealistic 3D tiles (directly or via Cesium ion), OpenStreetMap and, in Slovakia, the national orthophoto mosaic (© GKÚ Bratislava, NLC, CC BY 4.0).' },
      ],
      sources: [SRC.godsEye, SRC.cesium, SRC.google3d, SRC.osm, SRC.ortofoto],
    },
  },
];
