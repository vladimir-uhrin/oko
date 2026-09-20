# UKRAJINA — situačná mapa frontu v štýle OKO — PLÁN + ZDROJE (2026-09-19, nič nie je implementované)

Používateľ: „keďže portál spravodajský, niečo som už spravil na Blízkom východe (Irán/Hormuz), ale
chcel by som sa zamerať na Ukrajinu. Začni najprv s plánom a vyhľadávaním zdrojov. Chcel by som to
mať približne ako na obrázku." Obrázok = mapa Rybar „Lymanský smer": červená výplň = kontrola RU,
modrá = kontrola UA, šrafovaná = zóna bojov, značky opevnení, skrížené meče = strety, šípky útokov,
sídla, cesty, pečiatka „Обстановка к исходу 17 сентября 2026".

Cieľ tohto dokumentu: povedať, **čo z toho vzoru vieme spraviť poctivo z otvorených zdrojov, čo len po
kroku používateľa (žiadosť, e-mail, kľúč) a čo vôbec nie** — a v akom poradí. Prieskum zdrojov
(83 položiek, doslovné citáty licencií) je v prílohe `docs/drafts/ukrajina-zdroje-prieskum.md`;
overených dvojmo (nálezca + skeptik) sú z nich len 3, zvyšok je jedno čítanie a pred zapojením sa
overuje znova podľa `new-data-layer`.

## Stav (2026-09-19 noc): ETAPY 1, 2, 3 a 4C HOTOVÉ; 4A/4B, 5, 6 čakajú na kroky používateľa

### Etapa 4C (provizórium kontroly, používateľ: „pokračuj") — hotové
- Body kontroly sídiel z Wikipédie (`Module:Russo-Ukrainian war overview map` + `detailed map`,
  CC BY-SA 4.0): parser `src/data/ukraineControl.js`, snímky po týždňoch od 24. 2. 2022 v archíve
  (`control/<deň>.json` s revíziami), dnešná každých 6 h; vrstva `src/ukraineControlLayer.js`
  = body (modrá/červená/jantár) + ODVODENÝ raster zón (RU výplň, šrafovaná zóna bojov) primknutý
  k terénu aj 3D dlaždiciam; časová os prepína snímku podľa dňa kurzora; čip KONTROLA.
- Vojnové požiare The Economist (CC BY 4.0, 454 333 bodov od 2022) ako typ `hotspot` — body bez karty.
- DeepState: API a mirrory NIE (licencia §2); ich Telegram kanál `DeepStateUA` v páse médií
  (licencia §3: vizuály s logom/odkazom voľné) — odpoveď na otázku používateľa.
- **4A predbežne (používateľ 09-19: „OKO nie je biznis, ale hobby pre mňa a môj FB profil —
  pridaj zatiaľ všetko, čo vieš, a požiadame DeepState o súhlas")**: `/api/history/last` sa
  archivuje raz denne (história API je za autorizáciou → naša od 19. 9. 2026), čistý model
  `src/data/ukraineDeepState.js` (bez jednotiek, bez cudzích území), vrstva
  `src/ukraineDeepStateLayer.js` (polygóny okupované/šedá/oslobodené/od 2014 + smery útokov +
  letiská), os prepína snímku podľa dňa, legenda „stav k … · nekomerčné hobby použitie, súhlas sa
  žiada", zóny Wikipédie sa pri DeepState skryjú. Žiadosť: formulár (Tally) ODOSLANÝ 19. 9. 2026
  (meno, e-mail, typ „nekomerčný", popis EN + UA s poznámkou o AI asistentovi; CAPTCHA a odoslanie =
  používateľ). Odpoveď do ~3 dní, mlčanie = zamietnuté → potom vrstvu, úlohu a archív zmazať
  (`UKRAINE_DEEPSTATE=off` vypne hneď).
- **Etapa 5 bez súhlasov (09-19, „pokračuj v pláne")**: vrstva ŠKODY — hromady zo Sentinel-1
  modelu ETH Zürich (Zenodo 15088349, CC BY 4.0, 1 759 hromád / 403 990 pravdepodobne poškodených
  budov, feb 2022 – feb 2024) ako kruhy + 18 209 bodov UNOSAT 2022 (CC BY-SA, 26 miest) odkrývaných
  kurzorom; `scripts/build-ukraine-damage.mjs`, `src/data/ukraineDamage.js`,
  `src/ukraineDamageLayer.js`, čip ŠKODY v osi aj v paneli. Nočné svetlá GIBS a hlasové aliasy
  odložené (fotoreál nedrapuje imagery; hlas nemá aliasy scén). Opevnenia: nikdy bez súhlasu.
- Otvorené: 4B Black Bird Group (e-mail), 5 opevnenia/S-1 (súhlasy), 6 alerts.in.ua (token).
  Nepublikované.

### Etapa 3 (používateľ: „ako na obrázku, určite časovú os … 1 až 5", potom „fotky z čo najviac zdrojov, aj videá, všetko ukladať") — hotové a overené v pane

- **3a chrbtica**: archív na disku `.gev-cache/ukraine/events/` (VIINA 2022–2026 po rokoch = 318 947
  udalostí, GeoConfirmed rolujúcich 90 dní po dňoch, správy a médiá po dňoch, hlásenia GŠ po dňoch),
  archivár v dev serveri (`src/data/ukraineEventsProxy.js`: správy/médiá 15 min, GŠ 60 min,
  GeoConfirmed/VIINA 6 h), `/api/ukraine/events?from&to` (≤ 31 d), `/summary`, `/status`, spätné
  naplnenie `scripts/build-ukraine-events.mjs --all`; čistý model `src/data/ukraineEvents.js`
  (VIINA príznaky → typ/závažnosť, GeoConfirmed s etickým filtrom, správy a médiá pripojené k bodu
  toho istého dňa a miesta), `src/data/ukraineMedia.js` (YouTube feedy 9 kanálov, oficiálne
  Telegram kanály GŠ/MO/DSNS/PS, ArmyInform mp4; ukrajinská klasifikácia a kotvenie azbukou).
  Fotky navyše z Ukrinform, Guardian a Meduza (náhľad z feedu), Kyiv Post a Euromaidan Press len
  titulok (zákaz fotiek v podmienkach). Ukladajú sa odkazy a náhľadové URL, nie bajty médií.
- **3b karty**: `src/ukraineEventsLayer.js` — body (PointPrimitive), zhluky > 600 km, mini čipy
  150–600 km (jeden na miesto, „+n"), karty < 150 km (max 8, 8 kandidátov rozmiestnenia, vodiace
  čiary), lightbox (YouTube nocookie, Telegram embed, mp4, galéria fotiek). Nie kópia ZÁLIV kariet.
- **3c os**: `src/ukraineTimeline.js` + `src/data/ukraineTimelineClock.js` — LIVE/PREHRÁVANIE,
  okná 24 h/7 d/30 d/od 2022, rýchlosti 1 h/s…2 d/s, histogram s ťahaním, legenda = filter,
  počítadlá, pás fotiek a videí, GŠ značky pre deň kurzora, odkaz `?front=&t=&win=`.
- Nepublikované (strom nesie meteo agenta). Otvorené: rozhodnutia č. 4–5 nižšie sú prekonané
  pokynom používateľa (fotky zo všetkých dovolených zdrojov), ostatné platia.

### Etapa 2 (používateľ: „Fáza 2") — hotové a overené naživo

- **Hlásenie GŠ ZSU** cez ArmyInform (CC BY 4.0): proxy `/api/ukraine/report` (tag feed → článok →
  čistý parser `src/data/ukraineReport.js`), 19. 9. 2026: 213 stretov, 15 smerov (13 s presetom +
  Volyň/Polissia), údery (1 raketový, 89 leteckých, 312 KAB, 10 588 dronov, 2 952 ostreľovaní).
  Prekryv `ukraineReportLayer.js` = skrížené meče + počet pri strede každého smeru (farba podľa
  intenzity), karta s odsekom v origináli + strojový preklad uk→sk na požiadanie, klik = hlásenie.
  Panel: karta hlásenia (súhrn, údery, poctivá veta, odkaz) + počet na každom tlačidle smeru, čip STRETY.
- **Správy** región `ukraine` v `situationNews.js`: GDELT (EN) + Google News + 8 priamych RSS
  s pravidlami po zdrojoch (`unfurl` len BBC/KI, `drop` Interfax-Ukraine v UP, `badge` oficiálne UA,
  `limit` na zdroj — Ukrinform a UP inak vytlačili všetkých), ISW ako jediná pripnutá položka
  (titulok + odkaz, HEAD raz za 6 h). Hot kartičky nad smerom (región `ukraine`, brána priblíženia),
  bulletin v paneli UKRAJINA (jediný región = bez čipov). Klasifikácia UA (`ukraineIncidents.js`:
  námorné/PVO pred úderom, infraštruktúra len s činom), gazetteer ~90 miest, bez miesta = bez karty.
- **Sankčný blocklist** `sanctionedMedia.js` (príloha XV do 16. balíka + Rybar podľa prílohy I),
  server aj klient. TASS nie je v zozname a ani sa neťahá (otázka č. 4 stále otvorená).
- Pasce: `\b` pred cyrilikou v JS nikdy nesedí (parser stratil všetky smery, kým sa hranica
  neprepísala na lookbehind); stop-riadok extraktora bez cyriliky prešiel filtrom; úprava závislosti
  vite.config.js reštartuje server a preloaduje stránku uprostred overovania.
- Nedorobené z etapy 2: BBC/RFE/DW sa v prvej šestnástke ukážu až po prestavbe cache (stropy
  platia od ďalšieho buildu); ArmyInform EN feed mešká dni. **Miesta z odsekov hlásenia — DOROBENÉ
  2026-09-19:** `src/data/ukraineReportPlaces.js` (mená za „у районі / в напрямках / поблизу" v genitíve
  → kandidáti nominatívu pravidlami koncoviek + výnimky ako Часів Яр → index mien sídel z OSM snímku
  cez `ukraineBaseLayer.getPlaceIndex()`, pri rovnakých menách najbližšie k stredu smeru do 120 km),
  vrstva hlásenia ich kreslí ako malé body + popisky vo farbe intenzity smeru (bod do 700 km, popisok
  do 260 km), karta „sídlo menované v hlásení" s poznámkou, že nejde o líniu frontu ani polohu jednotky;
  panel ukazuje „N menovaných sídiel". Podklad pre tieto sídla skryje vlastný bod aj popisok
  (`setReservedPlaces`; bod podkladu na tom istom pixeli vyhrával výber myšou aj nad vyšším zdrojom).
  Geokódovanie beží v prehliadači, nič odvodené sa neukladá (ODbL). Naživo 19. 9.: 41 mien, 40 nájdených
  (42 bodov — tri rôzne Novoselivky), Юрківка neurčená (najbližšia rovnomenná 195 km).

### Etapa 1 (používateľ: „pokračuj etapou 1") — hotové a overené v pane (podklad OSM stack, lebo Google 3D
dlaždice sú v pane 403):

- **Snímok** `scripts/build-ukraine-base.mjs` + knižnica `scripts/lib/ukraineBase.mjs`: 4 poludníkové
  dlaždice, výber polygónom Ukrajiny (Natural Earth 1:50m, rozšírený o 0,2°) + rámec Krymu + pás
  Kursk/Belgorod; výsledok v `.gev-cache/ukraine/base/`: 1 442 miest a mestečiek, 27 973 obcí,
  11 353 pospájaných ciest (74 982 km), 2 257 riek (57 845 km, ≥ 30 km v okne), 27 oblastí
  (4 370 hraničných čiar); 589 s, 13 dopytov, 30 s pauzy. Meta nesie dátum, počty, dopyty.
- **Proxy** `ukraineBaseProxy()` vo `vite.config.js`: `/api/ukraine/base/{meta,places,villages,roads,rivers,oblasts}`,
  ETag + gzip (2,6 MB gz pre 4 súbory načítané hneď, obce 1,1 MB gz lenivo), 404 `no_snapshot`.
- **Prekryv** `src/data/ukraineBaseLayer.js` (+ čisté `src/data/ukraineBase.js`): 4 CustomDataSource
  (čip = jedno show), body a popisky primknuté k zemi (`CLAMP_TO_GROUND` + bez hĺbkového testu),
  čiary `clampToGround` BOTH ako rúry, mená `name:en` inak prepis BGN/PCGN (mestá verzálkami),
  obce až pod 260 km ako kohorta ≤ 1 800 okolo stredu pohľadu, riedenie popisov mriežkou
  118×26 px po ustálení kamery (nad Lymanom zo 159 km ostalo 444 z 3 242), karta pri prechode
  myšou (latinka, originál, obyvatelia, dátum snímku), klik na sídlo = prelet (45/22/9 km).
- **Panel UKRAJINA** (`#ukraine-panel`, poradie 9, `src/ukrainePanel.js`, token zdieľania `u`,
  mobilná záložka DÁTA): stav snímku, počty, tlačidlo podkladu, čipy, 12 smerov, poctivá
  poznámka „nič tu nie je línia frontu". Smery `src/ukraineFrontScenes.js` (prehľad + 11 podľa
  hlásenia GŠ z 19. 9. 2026, Oleksandrivský = kotva približná), spúšťače `?front=<id>`,
  `#front-select` v SCÉNY, `window.__godsEyeView.frontScenes.apply(id)`; podklad si drží hranice
  štátov ako držiteľ `ukraine-base`.
- Testy: 5 nových súborov (knižnica, pomocné funkcie, prekryv, smery, panel) + lane testy panelov
  prešli automaticky; suite 3 528/3 530 (2 padajúce = meteo agent).

Neoverené / na neskôr: prelet smeru cez `camera.flyTo` (v pane zamŕza pri 403 dlaždiciach — overené
len `setView` + testy), vzhľad na fotoreáli používateľa (šírky ciest, čitateľnosť popisov na 3D
meshi), tertiary cesty zblízka, spájanie hraničných čiar oblastí (4 370 úsekov, mohlo by byť ~200),
GeoNames/HDX zámerne nepoužité (OSM `name:*` a `admin_level=4` stačili), hlasové aliasy.
Pasce zapísané v `docs/CURRENT-STATE.md` (kumi mirror bez areas, 429 pri rýchlom slede,
`force-cache` na /api vráti HTML navždy, Natural Earth bez Krymu).

## Návrh (2026-09-19): „jemná" karta frontu ako Rybar — kartografický režim KARTA

Používateľ ukázal Rybarovu mapu „Лиманское направление — обстановка к исходу 17 сентября 2026"
a chce OKO „takéto jemnučké". Toto je rozklad vzoru na prvky, čo z toho už máme, čo je poctivo
dostupné, ako to v Cesiu spraviť a v akých etapách. Nič z Rybarovho OBSAHU (zóny, šípky, opevnenia)
sa nepreberá — preberá sa len kartografický jazyk; obsah ostáva z našich zdrojov (GŠ, Wikipedia,
DeepState po súhlase, VIINA/GeoConfirmed, OSM).

### Čo robí tú mapu jemnou (rozklad vzoru)

1. **Reliéf**: tmavý modro-sivý hillshade (svetlo zo severozápadu), hrebene a údolia jemne
   vidno aj v rovinatom Donbase; lesy ako tmavšie plochy s bielym bodkovaním (NP Sviati Hory,
   Serebrianske lesníctvo); **zástavba každej obce ako svetlosivý polygón**; vodné plochy
   svetlomodré (Oskilská nádrž), rieky tenké modré s kurzívou pozdĺž toku.
2. **Zóny**: červená (RU) a modrá (UA) polopriehľadné plochy s mäkkým okrajom, oranžové
   šrafovanie 45° = „územie bojov", jemná textúra vo výplni.
3. **Čiary**: cesty biele 1 px, hlavné žlté s odznakom (T-05-13, O0526), železnica čierno-biela
   čiarkovaná, hranica oblasti biela čiarkovaná, opevnenia tenká červená.
4. **Body**: sídla ako malé okrúhle špendlíky vo farbe strany, mestá s červeným „žiarením"
   (Izium, Lyman, Sviatohirsk), boje = blesk v šesťuholníku, šípky útokov (modré RU, červené UA).
5. **Typografia a rám**: biely sans s tmavým lemom, mestá verzálkami, popisky s vodiacimi čiarami
   („Kemping Varadero"), titulok s dátumom, legenda, prehľadová mapka vpravo hore, výrez vľavo dole.
6. **Nič nie je hrubé**: alfa 0,3–0,5, hrúbky 1–1,5 px, tlmené farby, žiadne emoji, žiadne tiene UI.

### Čo už OKO má a čo chýba

- Máme: OSM snímok (sídla, cesty s ref, rieky, hranice oblastí), hover karty, smery frontu,
  hlásenie GŠ (počty + menované sídla), udalosti a os, DeepState polygóny (súhlas čaká), zóny
  z Wikipédie (raster 0,05°, ostré bunky), škody, požiare, podklady OSM/Bing/ASTER, 2D PLÁTNO,
  zdieľanie snímky s atribúciou.
- Chýba: reliéf tohto druhu, **plošné vrstvy** (zástavba, lesy, voda), železnice, mäkké zóny
  a šrafovanie, farba sídla podľa strany, žiarenie miest, rieky kurzívou pozdĺž toku, odznaky
  ciest, titulok + legenda + mapka pre export, celkovo tichší štýl čiar a popisov.

### Zdroje — čo je overené (19. 9. večer)

| Prvok | Zdroj | Licencia / podmienky | Stav |
|---|---|---|---|
| Reliéf | Mapzen/Nextzen terrain tiles na AWS Open Data: `normal/{z}/{x}/{y}.png` (normály v RGB + výška v alfa) a `terrarium/…` | verejné DEM (SRTM, EU-DEM, GMTED, ETOPO1) s povinnou atribúciou; bez kľúča, bez kvóty | **overené**: z12 nad Lymanom 200, 56 kB / 0,6 s (normal), 21 kB (terrarium) |
| Tmavý podklad bez popisov (záloha) | CARTO Dark Matter `dark_nolabels` | CARTO free basemaps: nekomerčné použitie, atribúcia CARTO + OSM | overené: 200, 6 kB/dlaždica — hotový cudzí štýl, menšia kontrola |
| Zástavba, lesy, voda, železnice, odznaky | OSM cez Overpass do snímku (rovnaká pipeline ako sídla; `landuse=residential/industrial`, `natural=wood`/`landuse=forest`, `natural=water`, `railway=rail`) | ODbL, vlastný súbor ako doteraz | Overpass (hlavný aj kumi) dnes večer vracia HTML namiesto JSON → počty pre okno Lyman zmeria sonda K0 |
| Land cover (lesy) | ESA WorldCover 10 m | CC BY 4.0 | WMTS terrascope dnes neodpovedal → náhrada OSM lesy stačí |
| Zóny a strana sídla | Wikipedia body (status per sídlo) + DeepState (po súhlase) | CC BY-SA / súhlas | máme; strana sídla = prepojiť Wikipedia body s OSM sídlami podľa mena a vzdialenosti |
| Opevnenia | OSM `military=trench`, `barrier=tank_trap` (mapované z verejných snímok) | ODbL | **etická otázka** — nekresliť bez rozhodnutia používateľa (viď otázky) |
| Šípky útokov | DeepState `attack_direction` body; smer = normála frontu v tom bode (odvodené) | súhlas | bez DeepState žiadne šípky — nikdy vymyslené (platí rozhodnutie z prieskumu) |

### Technika v Cesiu (ako sa to dá poctivo dosiahnuť)

- **Reliéf**: vlastný `ImageryProvider`, ktorého `requestImage` vráti canvas: stiahne normal
  dlaždicu, per pixel `hillshade = dot(normála, svetlo 315°/45°)`, mapuje do tmavej rampy
  (#0d1b2a → #3b5068), výška z alfa dá jemný odtieň nížin/vrchov. Normály sú v dlaždici → žiadne
  švy, žiadni susedia. Nový map stack **KARTA** (`kind: custom`, `requiresIon: false`), Google 3D
  vypnuté; reliéf je v obraze, nie v geometrii → funguje v 3D zhora aj v 2D PLÁTNE a v pane.
- **Štýl režimu**: sharpen 0 (pod 4 px prepaľuje na bielo — merané pri rúrach), bloom 0, msaa 4
  (už je), popisky s halo, `scaleByDistance` pri čiarach, tlmená paleta v jednom tokene štýlu,
  z ktorého čítajú všetky vrstvy UKRAJINA (dnes majú farby napevno).
- **Plochy**: GroundPrimitive dávky po triede (zástavba svetlosivá α 0,35; voda; lesy s
  bodkovaným Fabric materiálom `fract(st·rep)`), šrafovanie zón 45° vlastným materiálom
  `fract((s+t)·rep) < 0,5` (StripeMaterial vie len 0°/90°). Overené v repe: 18 378 entít rúr =
  4 draw commandy, takže tisíce polygónov v dávkach nie sú prekážka.
- **Mäkké zóny**: raster z Wikipedia bodov 0,01° + Gaussovo rozmazanie 2–3 buniek na plátne
  → ImageMaterial (dnes 0,05° ostré); DeepState polygóny buď rasterizovať do toho istého plátna
  (jednotný mäkký vzhľad), alebo GroundPrimitive so šrafovaným materiálom pre sivú zónu.
- **Sídla**: špendlík SVG vo farbe strany (Wikipedia status; s DeepState point-in-polygon),
  mestá + žiarenie (radiálny gradient billboard 40–80 px, α 0,25); rieky kurzívou po úsekoch
  (billboard textu otočený podľa azimutu úseku, 1 popis na ~40 km toku); cesty 1 px biele,
  primárne žlté s odznakom ref (SVG billboard v strede úseku); železnice PolylineDash.
- **Boje**: sídla z hlásenia (dnes body) → blesk v šesťuholníku vo farbe intenzity smeru; skrížené
  meče s počtom ostávajú na strede smeru.
- **Rám a export**: titulok („LYMANSKÝ SMER · stav k 08:00 19. 9. 2026 · hlásenie GŠ ZSU · zdroje"),
  legenda, prehľadová mapka (SVG z hraníc oblastí snímku + obdĺžnik pohľadu) ako HTML ostrovy
  režimu KARTA; snímka cez `/api/share` ich zapečie; voliteľne „čistá karta" (skrytý HUD).

### Etapy (každá končí testami, riadkom v DATA_SOURCES a zápisom do CURRENT-STATE)

**Stav 2026-09-20: vzorka schválená („je to dobré"), K0 a K1 HOTOVÉ** — podklad KARTA je v prepínači
máp (čip hneď za OSM), reliéf z normal dlaždíc cez `/api/relief` (S3 nemá CORS) tieňovaný
v prehliadači (`src/hillshadeImagery.js`, zelený kanál Mapzenu = juh → flipY, vyhladenie 1,4 px
s lemom proti švom), sharpen/bloom sa v KARTE vypnú a po odchode vrátia, farba glóbusu #0b1622.
Overpass počty pre okno Lyman (po zjednodušení): zástavba 4 833, lesy 4 437, voda 696, železnice 169.
Zápis: `docs/CURRENT-STATE.md` („KARTA — cartographic mode, stages K0 + K1"). Ďalej K2.

- **K0 sonda (½ dňa)** — HOTOVÉ 09-20: provider reliéfu z normal dlaždíc + meranie (ms/dlaždica, pamäť, vzhľad
  v 3D zhora aj v 2D), porovnanie s CARTO Dark; Overpass počty (okno Lyman, celý front) →
  rozhodnutie o objeme a dlaždicovaní snímku.
- **K1 podklad KARTA (1 deň)** — HOTOVÉ 09-20 (stack, post-procesing, čip; štýlový token čiar a popisov
  ostáva na K2, kde pribudnú plochy): stack + štýlový token (post-procesing, čiary, popisky), čip KARTA
  v paneli UKRAJINA, voliteľne zapnúť smerom frontu; všetko existujúce (hover, os, karty) beží ďalej.
- **K2 snímok v3 (1–1,5 dňa)**: build pridá zástavbu, lesy, vodu, železnice, odznaky; zjednodušenie
  (Douglas–Peucker + prah plochy), po oknách smerov, nie celý front naraz; GroundPrimitive dávky.
- **K3 zóny jemne (1 deň)**: raster 0,01° + rozmazanie, šrafovanie, farba sídiel podľa strany,
  žiarenie miest; legenda hovorí „odvodené z Wikipédie / DeepState".
- **K4 boje a smery (½–1 deň)**: blesky, odznaky ciest, DeepState šípky s normálou frontu —
  len po súhlase.
- **K5 export (½ dňa)**: titulok, legenda, mapka, snímka, „čistá karta".

Spolu ~5 dní práce; K0–K1 dajú prvý dojem hneď (reliéf + tichší štýl je 70 % „jemnosti").

### Otázky pre používateľa (K0–K1 idú aj bez odpovede)

1. **Opevnenia** z OSM (`military=trench`): kresliť? Rybar ich kreslí; my sme si dali čiaru
   „žiadne polohy jednotiek" a čl. 114-2 TZ UA. Zákopy sú statická infraštruktúra viditeľná na
   verejných snímkach, no sú to aj polohy — rozhodnutie je tvoje; bez rozhodnutia nekreslím.
2. **Písmo popisov na mape**: sans ako Rybar (Inter/Roboto — kartografickejšie) alebo Plex Mono
   (štýl OKO)? Odporúčam sans na mape, Plex Mono ostáva v UI.
3. **Šípky**: potvrdiť, že len z DeepState `attack_direction` (po súhlase), inak žiadne.
4. **Reliéf**: vlastný z normal dlaždíc (odporúčam: bez kľúča, plná kontrola farby, bez švov)
   alebo CARTO Dark (hotové, cudzí štýl, limity pre nekomerčné použitie).
5. **Pohľad**: 3D zhora s možnosťou naklonenia (odporúčam) alebo 2D PLÁTNO — reliéf je v obraze,
   funguje v oboch.
6. **Jazyk popisov**: nechať SK/EN latinku + originál (Rybar je v ruštine; my nie).

## Návrh (2026-09-19 noc): karty udalostí a časová os podľa upstream vzoru — nahrádza etapu 3

Používateľ ukázal snímku z upstream videa (scéna „Hormuz Blockade"): karty ukotvené na mape
vodiacou čiarou k malému štvorčeku, s farebným pásom závažnosti (CRITICAL / MINOR), typom
(MISSILE / PROJECTILE), časom UTC, predmetom (Safesea Vishnu), jedným stavovým riadkom („ABLAZE.
1 killed.", „Unverified.") a fotkou; dole časová os s prehrávaním (1h/s … 2d/s, LIVE / PLAYBACK),
legenda kategórií, vľavo počítadlá (VESSELS IN VIEW, STRAIT TRANSITS s vlajkami). Pokyn: **nekopírovať
karty ZÁLIV-u ani ich rozmiestnenie** — chce to „nejako takto". Upstream to má ako ručne
zostavený dataset udalostí prehrávaný scénou; my to spravíme z otvorených zdrojov, živo aj s históriou.

### Čo je inak než dnešné karty (prečo nový renderer)
- ZÁLIV karty = titulky správ zoskupené po miestach, jedna karta na miesto, vertikálny stĺpec.
  Vzor = **udalosti** (čas + miesto + typ + závažnosť + stav), každá zvlášť, rozložené okolo kotvy.
- Preto: nový čistý model `src/data/ukraineEvents.js` (udalosť = `{id, t, lat, lon, place, type,
  severity, subject, status, level, sources[], image?}`) a nový renderer
  `src/ukraineEventCards.js` (nie gulfIncidentCards). Hot kartičky ZÁLIV-u ostanú, ako sú; Ukrajina
  na ne prestane siahať (`incidentCards.showFor('ukraine')` zmizne).

### Karta (štýl OKO, tvar podľa vzoru)
```
┌──────────────────────────────────┐
│ KRITICKÉ · RAKETA · 14:00 UTC    │ ← pás farby závažnosti (červená / jantár / modrá), mono
│ Kramatorsk                       │ ← predmet: sídlo alebo objekt (nikdy osoba)
│ zasiahnutá bytovka · 2 zranení   │ ← stavový riadok (z titulku / typu; počty len „hlásené")
│ ▣ fotka (len kde to smieme)      │ ← og:image BBC / Kyiv Independent; inak monochromatický glyf typu
│ Ukrinform · oficiálne UA · ↗     │ ← zdroj · úroveň overenia · odkaz von
└──────────────────────────────────┘
        ╲ vodiaca čiara k štvorčeku (veľkosť = závažnosť)
```
- Úrovne overenia (poctivosť): **oficiálne UA** (GŠ, Ukrinform), **OSINT overené** (GeoConfirmed —
  overené proti záberom; médiá sú odkazy, nikdy embed), **hlásené · neoverené** (správy, VIINA).
- Rozmiestnenie: 8 kandidátskych polôh okolo kotvy, prvá bez prekryvu (mriežka v pixeloch),
  preferencia vpravo hore; žiadny stĺpec. LOD podľa vzdialenosti kamery: > 600 km len štvorčeky
  (zhluk 0,05° s počtom), 150–600 km štvorček + mini čip (glyf typu + čas), < 150 km plná karta
  (max 8, priorita závažnosť → čerstvosť). Brána priblíženia ostáva.
- Fotky: iba z feedov, ktoré to dovoľujú (BBC, KI `media:content`/og:image); GeoConfirmed a
  sociálne siete = len odkaz. Bez fotky karta dostane glyf typu, nie prázdny rám.

### Dáta za tým (namiesto pôvodnej etapy 3, všetko už preverené v prieskume)
| Zdroj | Dáva | Úroveň | Poznámka |
|---|---|---|---|
| **VIINA 2.0** (ODbL, denne) | udalosti od 24. 2. 2022: čas na minútu, sídlo (GEO_PRECISION), typ (`t_airstrike`, `t_artillery`, `t_mil`…), aktér s pravdepodobnosťou, URL správy | hlásené | chrbtica časovej osi; vlastný ODbL súbor/DB na D: |
| **GeoConfirmed API** (bez kľúča) | overené OSINT body s dátumom, súradnicami, popisom, odkazom | OSINT overené | User-Agent s kontaktom, Cache-Control; ORBAT/jednotky NIKDY |
| **Správy** (etapa 2) | titulok + zdroj + obrázok | hlásené | zlúčiť s VIINA udalosťou (to isté sídlo ± 6 h) → fotka a titulok na karte, inak samostatná karta |
| **GŠ hlásenie** (etapa 2) | počty po smeroch za deň | oficiálne UA | počítadlá + história hlásení po dňoch (ukladať každé, dopĺňať spätne z dátumových URL) |
| Economist war-fire / FIRMS | tepelné anomálie `war_fire` | odvodené | voliteľná vrstva malých štvorčekov, nie karty (zaplavilo by to) |

Server: denný pull VIINA (zip → JSON po dňoch), GeoConfirmed po hodinách, `/api/ukraine/events?from&to`
(cache po dňoch), `/api/ukraine/reports?days=30` (uložené hlásenia GŠ).

### Časová os (spodný pás ako vo vzore)
- Engine: existujúci `ReplayClock` (rýchlosti, rAF) z histórie letov; UI nové `src/ukraineTimeline.js`
  v štýle OKO: čip **LIVE / PREHRÁVANIE** hore, dole jazdec s oknom (24 h · 7 d · 30 d · od 2022),
  rýchlosti 1h/s · 6h/s · 12h/s · 1d/s · 2d/s, play/pause.
- LIVE = posledných 24 h (voliteľne 6 h / 72 h), staršie karty blednú na štvorčeky. PREHRÁVANIE =
  udalosti sa objavia v čase `t`, žijú ~12 h modelového času ako karta, potom ostane štvorček;
  počty GŠ a značky stretov prepínajú na deň pod jazdcom; podklad stojí.
- Je to pevný spodný pás len počas aktívnej scény Ukrajiny (`.oko-scene-overlay`, brána
  priblíženia) → prekážky rozloženia panelov, mobilný plášť, test overlayIslands.

### Legenda a počítadlá
- Legenda dole (ako vzor, naše kategórie): údery (rakety/drony/KAB) · delostrelectvo · pozemné boje ·
  PVO · infraštruktúra · námorné · civilný dopad (len počty, nikdy osoby).
- Vľavo pás počítadiel v štýle „VESSELS IN VIEW": **UDALOSTI V ZÁBERE 37 / 1 204** s čipmi typov
  a oblastí; **GŠ 213 stretov · 08:00**; pod jazdcom deň.

### Etapy (nahrádzajú pôvodnú etapu 3; odhad)
3a. Chrbtica udalostí — 3 d: VIINA pull + DB po dňoch, GeoConfirmed proxy, zlúčenie so správami
    a GŠ históriou, `/api/ukraine/events`, čistý model + testy.
3b. Nový renderer kariet — 2 d: karta podľa vzoru, štvorčeky, vodiace čiary, rozmiestnenie okolo
    kotvy, LOD, fotky len z dovolených zdrojov; Ukrajina prestane používať ZÁLIV karty.
3c. Časová os + legenda + počítadlá — 2–3 d: ReplayClock, spodný pás, LIVE/PREHRÁVANIE, prepínanie
    dňa pre GŠ značky, zdieľanie času v odkaze (`t=`).

### Rozhodnutia pre používateľa
1. LIVE okno predvolene 24 h? 2. História VIINA celá od 2022 (~200 MB, DB na D:) alebo len 90 dní?
3. Počty obetí v stavovom riadku (len „hlásené", bez mien) áno/nie? 4. Fotky len BBC/KI, alebo
radšej všade glyf? 5. Neskôr preniesť aj ZÁLIV na nový renderer?

## 0. Zhrnutie na jednu obrazovku

| Prvok vzoru | Dá sa? | Zdroj | Podmienka |
|---|---|---|---|
| Sídla, cesty, rieky, hranice oblastí/rajónov, mená v latinke | **áno, hneď** | OSM (Geofabrik/Overpass, ODbL), GeoNames (CC BY 4.0), HDX COD-AB (CC BY-IGO), Natural Earth POV „ukr" (PD) | build skript ako pri potrubiach; OSM = vlastný súbor (share-alike) |
| Správy + oficiálne hlásenia po smeroch (počty stretov) | **áno, hneď** | GŠ ZSU cez ArmyInform RSS (CC BY 4.0), Ukrinform, Kyiv Independent, UP, RFE/RL, BBC téma „War in Ukraine", DW, AJ; GDELT | rozšíriť existujúci ZÁLIV pipeline o región `ukraine`; sankčný blocklist v proxy |
| Udalosti ako body (údery, strety, geolokácie) | **áno** | VIINA 2.0 (ODbL, denne), GeoConfirmed API (bez kľúča, „freely available for research, journalism, analytical use"), Economist war-fire (CC BY 4.0, denne), FIRMS (kľúč chýba) | GeoConfirmed: e-mail o formálnu licenciu je slušnosť, nie blokátor; FIRMS kľúč = používateľ |
| **Územná kontrola (červená/modrá výplň)** — jadro vzoru | **len po kroku používateľa** | DeepState (žiadosť o API kľúč), Black Bird Group (e-mail, „happy to cooperate … non-profit adaptations"), ISW (písomný súhlas; bez neho NIE) | dovtedy provizórium: Wikipedia modul (CC BY-SA 4.0, body kontroly sídiel, denne) + Commons SVG |
| Šrafovaná zóna bojov | čiastočne | DeepState šedá zóna (ak API); inak **odvodená** zóna aktivity z udalostí + požiarov za 7 dní | vždy označené „odvodené", nikdy ako „šedá zóna DeepState" |
| Opevnenia | **nie** bez súhlasu | ISW FeatureServer (12 169 línií, verejné, ale politika zakazuje), Brady Africk KML (bez licencie); OSM ich prakticky nemá (18 tankových zátarás v celej UA) | e-mail ISW alebo Africkovi; UA opevnenia sa nezobrazujú nikdy (čl. 114-2 TZ UA) |
| Šípky útokov | **nekreslíme vymyslené** | smery z hlásení GŠ ako popisky/kotvy; šípky len ak ich vydá DeepState API | otvorená otázka č. 6 |
| Pečiatka „Situácia k …" | **áno** | každá vrstva nesie dátum snímku a zdroj | hlavička panela + karta vrstvy |
| Ruská strana „tvrdí RU" | len text | TASS (nie je v prílohe XV k 12/2025), MO RF Telegram po overení prílohy I | Rybar, RIA, RT, Sputnik, Zvezda, Lenta… **NIE** — sankcie platia aj pre bezplatný web (SDEÚ C-67/25) |

Etapy 1–3 (podklad, správy, udalosti) idú bez čakania na kohokoľvek. Etapa 4 (kontrola územia)
závisí od odpovedí DeepState / Black Bird Group; kým neprídu, beží provizórium z Wikipédie.

## 1. Čo už OKO má (staviame na tom, nie vedľa toho)

- **ZÁLIV pipeline**: `situationNews.js` (`SITUATION_REGIONS` → GDELT DOC + Google News RSS
  fallback + `directRss` publisherov, keyword `match`), `gulfIncidents.js` (klasifikácia + gazetteer →
  incidenty „reported · unverified"), hot kartičky ukotvené na mape s reveal-on-approach gate,
  `/api/translate` (MyMemory), `/api/link-image` (og:image), `/api/img`. Ukrajina = ďalší región +
  vlastný gazetteer + vlastné pravidlá obrázkov po zdrojoch.
- **Scény**: `chokepointScenes.js` (preset id/name/center/rectDegrees/newsRegion, trigger
  `?chokepoint=<id>` + window API, rámovanie posledné) — rovnaký tvar pre „smery" frontu.
- **FIRMS**: vrstva + proxy `/api/firms` existujú (`firmsAdapt.js`, `fireAnchors.js`), **kľúč
  `FIRMS_MAP_KEY` v `.env` chýba** (overené 09-19: 0 riadkov) → vrstva je prázdna, kým ho používateľ
  nezaregistruje.
- **GIBS** klient (WMTS REST, denné vrstvy) — Thermal Anomalies sú MVT (Cesium nečíta), nočné svetlá
  PNG áno.
- **Hustoty**: `densityDrape.js` továreň (heatmapa lietadiel/lodí) → „zóna aktivity" z bodov.
- **Hranice**: `countryBoundaries.js` s retain/release; potrubia ukázali, ako držať hranice vrstvou.
- **Mená**: `latinize.js` (uk/ru → latinka, `nameLang`), `countryFlags.js`, `regionDisplayName`.
- **Lokálne vrstvy**: `createLocalGeoJsonLayer` + hover karta (`localHoverCard.js`) — sídla a cesty
  ako lokálny GeoJSON so stupňami popisu.
- **Build vzor**: `scripts/build-gas-pipelines.mjs` (Overpass dlaždice, snímok s dátumom do
  `.gev-cache/` = junction na D:, Natural Earth index krajín, meta endpoint) — kópia pre Ukrajinu.
- **Zdieľanie**: hash `subj=`, snímka plátna, `/s/<id>` s Open Graph.
- **Tokeny vrstiev sú PLNÉ** (36/36, `0–9a–z` v `layerState.js`) → modul UKRAJINA v prvej verzii ako
  **panel + scéna bez `lo=` tokenu** (presne ako ZÁLIV), zapínanie z panela a z `?front=<smer>`;
  schéma v3 s dvojznakovými tokenmi je samostatná úloha, nie podmienka.

## 2. Zdroje — verdikt a poradie (✅ použiť · 🟡 po kroku používateľa · ❌ nie)

Licencie sú citované doslovne v prílohe; tu len verdikt a dôvod. „Overené ×2" = prešlo skeptikom.

### 2.1 Územná kontrola a línia frontu

| Zdroj | Verdikt | Prečo | Krok |
|---|---|---|---|
| **DeepStateMap.live API** (`/api/history/last`, multipolygóny okupovaného územia, história od 2022, zámerné oneskorenie 2–3 dni) | 🟡 | Licenčná zmluva (3. 9. 2025): API zadarmo len pre dobrovoľnícke/charitatívne/obranné subjekty, komerční so súhlasom, **proxying tretím stranám zakázaný**; OKO (nekomerčný, nie charita) je v medzere → treba súhlas | používateľ vyplní https://api.deepstatemap.live/request, výslovne opíše server-side proxy s cache pre verejný nekomerčný portál |
| cyterat/deepstate-map-data mirror, longlinecode feed (+ Cesium adaptér) | ❌ | Overené ×2: mirror ťahá DS API a republikuje = expresne zakázané proxying; longlinecode je navyše ISW derivát aj v dennom feede. **Ani ako núdzový zdroj.** Ako referencia implementácie (clampToGround, contact_line z polygónu) áno | — |
| **Black Bird Group ry** (Fínsko; konzervatívna metodika, explicitná šedá zóna, história od 1. dňa; týždenný export do ACLED) | 🟡 | Bez verejného downloadu, ale web: „happy to cooperate with research institutions and media … non-profit or public-facing adaptations" | používateľ napíše contact@blackbirdgroup.fi |
| **ISW ArcGIS FeatureServer** (Assessed Russian Control, claimed, infiltration, advances, 24 h gains, fortifikácie; verejné bez tokenu) | ❌ (🟡 len s písomným súhlasom) | Overené ×2: licenseInfo „You may not use this geodata without the written consent of ISW"; policy zakazuje „incorporation … into mapping platforms" a redistribúciu „via API, or through automated means" | e-mail ISW (kontakt na policy stránke, maskovaný Cloudflare) — rozhodnutie používateľa |
| ISW Map Room (denné PNG, RSS `feed/?post_type=map`) | ❌ ako obsah; ✅ len **titulok + dátum + odkaz von** | Overené ×2: aj hotlink obrázka v karte je hraničný („mapping platform"); nálezca sa tu mýlil, skeptik opravil | — |
| **Wikipedia Module:Russo-Ukrainian War detailed map** (Lua tabuľka: lat/long/mark/label sídiel, stav kontroly/kontestované/obliehanie; MediaWiki API) | ✅ provizórium | CC BY-SA 4.0 — jediný dnes plne čistý strojový zdroj; **len body sídiel, nie polygóny**; odvodený dataset musí ísť von pod CC BY-SA (samostatný súbor s licenciou) | otázka č. 5 |
| Wikimedia Commons `2022 Russian invasion of Ukraine.svg` (+ per-oblast SVG) | 🟡 technicky | CC BY-SA 4.0, ale negeoreferencované; jednorazová afinná georeferencia, presnosť nízka; popis priznáva ISW ako zdroj mimo sídiel (sivé) | až keď Wikipedia body nestačia |
| Project Owl / UAControlMap (denné KMZ z Google My Maps) | ❌ | bez licencie = all rights reserved; obsahuje pozície jednotiek | prípadne Discord/X — používateľ |
| ACLED Ukraine Conflict Monitor (BBG polygóny + udalosti) | ❌ | gmail účet = len agregáty; surové dáta od úrovne Research (inštitúcie); EULA zakazuje surové body na verejnom dashboarde a AI/ML použitie | — |
| War Mapper, Liveuamap, MilitaryLand (ukončené 2023) | ❌ | bez licencie / platené (Pro od 150 USD/mes., 403 pre fetcher) / archív | len odkaz von |

### 2.2 Udalosti (údery, strety, geolokácie, poplachy)

| Zdroj | Verdikt | Prečo | Krok |
|---|---|---|---|
| **VIINA 2.0** (Zhukov & Ayers; denné ZIP/CSV: udalosti geokódované na sídlo, `GEO_PRECISION`, typy `t_airstrike/t_artillery/…`, aktéri s pravdepodobnosťou; aj `control_latest` = kontrola sídiel) | ✅ | ODbL; commity 9.–18. 9. 2026; zdroje = UA aj RU médiá (zobrazovať zdroj + pravdepodobnosť) | vlastný súbor (share-alike), denný pull na server |
| **GeoConfirmed REST API** (OpenAPI; placemarks = incident overený proti fotke/videu, dátum, súradnice, zdroj) | ✅ (s ohľadmi) | „freely available for research, journalism, and analytical use", verejné read endpointy bez kľúča; robots.txt Disallow /api/ je pre crawlery; rešpektovať Cache-Control, User-Agent s kontaktom; **ORBAT/jednotky nezobrazovať** (etika + čl. 114-2) | slušný e-mail o formálnu licenciu (používateľ), nie blokátor |
| **The Economist war-fire model** (`ukraine_war_fires.csv` denne, `war_fire`, `in_urban_area`, `excess_fire`, oblačnosť po dňoch) | ✅ | dáta CC BY 4.0 s citáciou; commit dnes 06:29 UTC; 70 MB nezoradené → denne na D:, klient dostane posledných N dní | citovať Economist + NASA FIRMS |
| **NASA FIRMS** (živé VIIRS/MODIS, modul existuje) | 🟡 | CC0/US PD; **chýba `FIRMS_MAP_KEY`**; 5 000 transakcií/10 min | používateľ zaregistruje kľúč (bezplatné) |
| **UCDP Candidate Events** (mesačný CSV, len fatálne udalosti, `where_prec` 1–7) | ✅ „studená" vrstva | CC BY 4.0 (stránka 09-19; staršie zrkadlá tvrdia NC → zapísať s dátumom); API dnes vyžaduje token (401) → CSV snímok | neskôr, história |
| GDELT 2.0 raw / GEO / DOC | ✅ len správy | GEO 404, DOC 429 (známe zo ZÁLIV-u); hlučné; ruská propaganda ako „udalosti" → filter domén | už existuje |
| **alerts.in.ua** (letecké poplachy po oblastiach/hromadách, typy air_raid/artillery_shelling/urban_fights, živé) | 🟡 | token na žiadosť formulárom; limity 12 req/min/IP; formálna licencia dát neuvedená; „nie pre kritickú infraštruktúru" | používateľ vyplní žiadosť; cache 30 s na serveri |
| Bellingcat Civilian Harm TimeMap (`api.json`, 2 517 záznamov 2022-02 → 2025-07, **ukončené**) | 🟡 archív | dátová licencia neuvedená (kód Do No Harm); `graphic=true` nikdy neťahať médiá | e-mail Bellingcatu alebo len body s odkazom; kópiu do `.gev-cache` |
| Texty.org.ua „Under attack" (CC BY) | 🟡 | dataset nie je stiahnuteľný, len na požiadanie | e-mail redakcii — voliteľné |
| WarSpotting API (straty techniky RU, geolokované) | 🟡 | Terms za Cloudflare bot-checkom (neprečítané); pole `unit` nezobrazovať | používateľ prečíta Terms v prehliadači |
| CIR Eyes on Russia, Ukraine War Archive | ❌ | bez licencie/exportu; archív view-only s overovaním | len odkaz von |

### 2.3 Správy a oficiálne kanály

| Zdroj | Verdikt | Pravidlá pre karty |
|---|---|---|
| **ArmyInform** (agentúra MO UA; RSS uk aj en; tag „Оперативна інформація ЗСУ" = denné hlásenie GŠ so smermi a počtami stretov) | ✅ | CC BY 4.0 + povinný priamy hyperlink (nie nofollow); EN feed mešká dni → brať UA + `/api/translate`; bez obrázkov |
| Generálny štáb ZSU (web 403 pre fetcher, Telegram `t.me/s/`) | ✅ cez ArmyInform/Ukrinform | web CC BY 4.0; Telegram náhľad krehký — nepoužívať ako primárny |
| **Ukrinform** RSS `rubric-ato` + `block-lastnews` | ✅ | „links … not lower than the first paragraph are mandatory"; štátna = štítok „oficiálna UA"; obrázky radšej nie |
| **Kyiv Independent** RSS (`/news-archive/rss/`, jediná funkčná cesta; `media:content` obrázok) | ✅ | feed nesie PLNÝ TEXT — nikdy nerenderovať, len titulok + perex + odkaz + obrázok z feedu; syndikácia je platená |
| **Ukrainska Pravda EN** RSS | ✅ | odkaz do 3. odseku; **filtrovať položky s „Interfax-Ukraine"** (zákaz šírenia) a nebrať Getty obrázky (bezpečnejšie bez obrázkov) |
| **RFE/RL** „Ukraine" + Radio Svoboda „Війна" | ✅ | text s odkazom áno; **bez obrázkov** (fotoklauzula); financované USAGM → označiť |
| **BBC** téma „War in Ukraine" (`topics/c1vw6q14rzqt`) | ✅ | ako v ZÁLIV-e; ID témy nedokumentované |
| **DW** RSS EN (filter kľúčových slov), **Al Jazeera** (filter; bez og:image scrapingu — T&C zakazuje scraping) | ✅ | |
| **ISW Russian Offensive Campaign Assessment** (denné, URL z dátumu, bez RSS) | ✅ len 1 karta/deň: titulok + odkaz + krátky výňatok | politika „automated means" → žiadne hromadné preberanie, žiadne mapy |
| **TASS** RSS EN | 🟡 (otázka č. 4) | nie je v prílohe XV (ANCOM 3/2025, NLconnect 12/2025), ale bol v návrhu → kontrolovať pri každom balíku; vždy štítok „tvrdí RU", nikdy LIVE; FAQ Q5: výňatky len objektívne |
| MO RF Telegram (`mod_russia`) | 🟡 | najprv overiť prílohu I nar. 269/2014; ak čisté, len text „obsadenie X tvrdí RU"; Zvezda (ich TV) je v prílohe XV |
| **Rybar** (Zvinčuk) | ❌ | príloha I 269/2014 (asset freeze) → FAQ Q11: aj bezplatné sprístupnenie obsahu listovanej osoby „can amount to making economic resources available"; predplatné map.rybar.ru z EÚ = riziko; **žiadne embedy, preberanie, ani odkaz** |
| RIA, RT, Sputnik, Zvezda, Lenta, Izvestija, NewsFront, SouthFront… | ❌ | príloha XV nar. 833/2014 čl. 2f; C-67/25: aj dary-financovaný web je „operátor"; 20. balík (2026/506) „mirror" klauzula → blocklist domén (NLconnect 796) v proxy |
| Reuters | ❌ | RSS zrušené 2020, fetcher blokovaný |

### 2.4 Satelitné signály

| Zdroj | Verdikt | Poznámka |
|---|---|---|
| Economist war-fire + FIRMS (viď 2.2) | ✅ / 🟡 | najlacnejšia „vojnová" filtrácia požiarov; ESA WorldCover 10 m (CC BY 4.0) na filter ornej pôdy neskôr |
| NASA GIBS Thermal Anomalies (MVT), DNB At-Sensor Radiance / VNP46A2 NRT (PNG, D0/D−1, Level8) | ✅ vizuálne | nočné svetlá ako prekryv „výpadky svetla" bez výpočtu; MVT požiare Cesium nečíta → CSV z FIRMS |
| NASA Black Marble VNP46A2 (HDF5, výpočet výpadkov vs. baseline) | 🟡 neskôr | Earthdata Login (používateľ); Node nemá HDF5 → sidecar (Python/GDAL) — mimo, kým netreba |
| **ETH Zürich Dietrich 2025** (celoštátna mapa škôd zo S-1, Zenodo CC BY 4.0, statické 02/2022–02/2024; ADM3 GeoJSON 60 MB, GeoTIFF 18 GB) | ✅ statické | jednorazovo na D:, klient dostane ADM3 súčty/dlaždice; „pravdepodobné, precision 67 %" |
| UNOSAT HDX (Mariupol, Charkiv, Sumy, Cherson 2022–23; CC BY-SA / 1× CC BY-IGO) | ✅ statické | „preliminary, not validated"; dátum snímky v UI |
| Copernicus CDSE (S-1/S-2; Sentinel Hub 10 000 PU/mes.), Planetary Computer S-1 RTC (CC BY 4.0, anonymný SAS token dnes funguje napriek docs), Earth Search S-2 COG bez účtu | 🟡 fáza II | vlastné SAR spracovanie = ťažké; reálne len pred/po výrezy niekoľkých úsekov; atribúcia „Contains modified Copernicus Sentinel data 2026" |
| Copernicus EMS Rapid Mapping | ✅ hák | 265 aktivácií, **0 pre Ukrajinu** — nechať len ako budúci hák (povodne/havárie) |
| EOG VNF (Nightfire) | ❌ | od 1/2025 vlastná licencia bez redistribúcie |
| Maxar/Vantor Open Data, Planet | ❌ | Ukrajina v Open Data nie je; komerčné |

### 2.5 Podkladové geodáta

| Zdroj | Verdikt | Poznámka |
|---|---|---|
| **OSM Ukrajina** (Geofabrik `ukraine-latest.osm.pbf` 836 MB alebo Overpass výrez): place=*, highway=motorway…secondary(+tertiary zblízka), waterway, natural=water; name:uk/ru/en prakticky kompletné (3 403/4 154 miest má name:ru) | ✅ | ODbL → vlastný súbor ako potrubia; OSM UA komunita maže vojenské objekty, cesty/mosty na okupovanom území môžu byť zastarané |
| **GeoNames** (UA.zip, alternateNamesV2 filtrované na uk/ru/en) | ✅ | CC BY 4.0; Krym vedený pod UA |
| **HDX COD-AB Ukraine** (27 oblastí / 139 rajónov po reforme / 1 769 hromád / 29 706 sídiel, viacjazyčné polia) | ✅ | CC BY-IGO; **robots.txt zakazuje /api/ a *.geojson → jednorazový ručný snímok**, nie runtime proxy; Krym/Sevastopoľ P-kódy nekonformné |
| Natural Earth 1:10m (POV `ne_10m_admin_0_countries_ukr`, admin-1, rieky) | ✅ prehľad | PD; **predvolene kreslí Krym pod Ruskom** → POV súbor |
| Wikidata SPARQL (labely uk/ru/en) | ✅ obohatenie | CC0; 429 → stránkovať v builde |
| Copernicus DEM GLO-30 (COG na AWS) | 🟡 | licencia výslovne dovoľuje redistribúciu; má zmysel len pre hillshade v 2D PLÁTNE |
| geoBoundaries UKR | ❌ | licencie po úrovniach (ODbL/PD/CC BY-SA 2.0), ADM2 z 2006 (495 rajónov) — **nikdy nepísať „CC BY 4.0"** |
| GADM | ❌ | „Redistribution … not allowed without prior permission" |
| Overture | ❌ | nič navyše oproti OSM, Parquet nástroje |
| OSM opevnenia (military=trench, barrier=tank_trap) | ❌ | Surovikinova línia v OSM nie je; komunita to maže (čl. 114-2) |

### 2.6 Metodika (texty pre „ako čítať mapu" a legendu)

ISW Mapping Methodology (control = FM 3-90-1, FLOT, infiltračné polygóny od 11/2025, žiadne UA
pozície „by policy"); DeepState legenda + výklad šedej zóny (Pohorilyj, Glavcom 11/2025: „rozmazaná
línia dotyku", zámerné 2–3-dňové zdržanie); Meduza 8/2026 (len geolokované video, bez šedej zóny);
Kyiv Independent 12/2025 (mapovanie sa stalo politickým); Wikipedia modul (trojstupňové pravidlo
zdrojov, „contested" = nepriateľ VNÚTRI sídla); Bellingcat etika OSINT; Berkeley Protocol §31
(minimalizácia dát). Záver pre legendu OKO: **kategórie assessed / claimed / grey sa uvádzajú vždy
so zdrojom a dátumom a DeepState a ISW sa nikdy nezlievajú do jednej vrstvy.**

## 3. Právne a etické mantinely (záväzné pre každú etapu)

1. **Sankcie EÚ** — čl. 2f nar. 833/2014 (2022/350): zákaz šíriť alebo uľahčovať šírenie obsahu
   subjektov prílohy XV vrátane internetu; SDEÚ C-67/25 (2. 7. 2026): aj súkromný web financovaný
   darmi je „operátor" → **nekomerčnosť OKO nie je obrana**; 20. balík (2026/506) „mirror" klauzula.
   FAQ EK (17. 7. 2026) Q5 dovoľuje objektívne výňatky médiám, Q11 rozširuje riziko na obsah
   listovaných OSÔB (Rybar). Implementácia: modul `sanctionedMedia.js` (domény z NLconnect zoznamu +
   mirror domény) ako filter GDELT výsledkov a allowlistu odkazov, s testom; kontrola konsolidovanej
   prílohy XV pri každom balíku (21. v príprave) — TASS sledovať osobitne.
2. **Čl. 114-2 TZ Ukrajiny** (zákon 7189/2022, 5–8 rokov): žiadne pozície, presuny ani
   rozmiestnenie OS Ukrajiny — ani z OSINT, ani z geolokovaných videí. OKO modeluje UA stranu len
   ako územie. RU jednotky/udalosti podľa etablovaných zdrojov áno, ale nikdy osoby.
3. **Etická čiara OKO** (CLAUDE.md 6): udalosti a infraštruktúra, nie ľudia — žiadne tváre, mená,
   zoznamy vojakov, poloha autora záberu; záznamy s `graphic=true` (GeoConfirmed, Bellingcat) bez
   médií; Berkeley §31: ukladať len typ, čas, miesto, zdroj.
4. **ISW**: nič okrem titulku + dátumu + odkazu von. Žiadne vektory, obrázky, ani hotlink.
5. **DeepState**: žiadne mirrory (cyterat, longlinecode). Iba vlastný API kľúč po schválení, alebo
   §3 zmluvy (vizuál s logom/odkazom = ich screenshot/iframe, nie naše vrstvy).
6. **Share-alike**: OSM podklad a VIINA = ODbL, každý vlastný súbor; Wikipedia derivát = CC BY-SA
   samostatný dataset s licenciou a odkazom; nemiešať s CC BY dátami do jednej DB.
7. **Poctivosť v UI**: každá vrstva nesie zdroj, dátum snímku, oneskorenie a kategóriu
   (oficiálne UA / tvrdí RU / OSINT overené / odvodené / archív). Disclaimer ako DeepState: mapa
   nie je na plánovanie evakuácie ani trás.
8. **Registrácie a formuláre vypĺňa používateľ** (GEM precedens), kľúče len v `.env` a na serveri.

## 4. Architektúra

```
BUILD (jednorazovo / cron)                                   PROXY (vite.config.js, cache + limity)
 scripts/build-ukraine-base.mjs                               /api/situation-news?region=ukraine  (existuje, + directRss UA)
   OSM Geofabrik/Overpass → sídla, cesty, rieky (ODbL súbor)  /api/ukraine/report   GŠ hlásenie → smery + počty (ArmyInform RSS, 1×/h)
   GeoNames + Wikidata → mená uk/ru/en                        /api/ukraine/events   VIINA (denný pull, ODbL súbor) + GeoConfirmed (UA hlavička,
   HDX COD-AB (ručný snímok) → oblasti/rajóny                                       Cache-Control) + Economist war-fire (denne, posledných N dní)
   NE POV ukr → prehľadové hranice                            /api/ukraine/control  DeepState (kľúč server-side, po schválení) | Wikipedia modul
 → .gev-cache/ukraine/<dataset>/<date>.json (+meta)                                 (MediaWiki API, parse Lua, diff revízií) — podľa dostupnosti
                                                              /api/ukraine/alerts   alerts.in.ua (token, cache 30 s)
                                                              /api/firms            existuje (kľúč)
                                                              sanctionedMedia filter na všetkých spravodajských výstupoch

KLIENT src/data/
 ├─ ukraineScenes.js       presety smerov (id, name sk/en, center, rectDegrees, newsRegion 'ukraine',
 │                          direction key GŠ) + `?front=<id>` + window API, rámovanie posledné (vzor chokepointScenes)
 ├─ ukraineBaseLayer.js    sídla (3 stupne popisu, latinka + originál), cesty, rieky, hranice oblastí — lokálny GeoJSON + hover karta
 ├─ ukraineControlLayer.js polygóny RU kontroly (výplň) + línia frontu (obrys) + šedá/odvodená zóna (šrafovanie) + dátum snímku
 ├─ ukraineEventsLayer.js  body udalostí (typ → monochromatická ikona: úder, strety, požiar), karta s zdrojom/pravdepodobnosťou;
 │                          hustota za 7 dní cez densityDrape = „zóna aktivity (odvodené)"
 ├─ ukraineReport.js       parser hlásenia GŠ → {smer, strety, čas} → kotvy smerov (skrížené meče + číslo), karta „oficiálne UA"
 ├─ ukraineIncidents.js    gazetteer UA (sídla + smery) + klasifikácia pre hot kartičky (vzor gulfIncidents)
 └─ panel UKRAJINA v DÁTA  (vzor ZÁLIV): hlavička „Situácia k <dátum> · <zdroj> · oneskorenie", čipy vrstiev,
                            legenda (assessed/claimed/grey/odvodené), zoznam smerov, karty správ, „ako čítať mapu"
```

- **Štýl OKO**: monochromatické ikony (SVG, nie emoji), sklo + mono písmo v kartách ako
  `pipeline-hover-card`; výplň RU kontroly tlmená tehlová s nízkou alfou, línia frontu s obrysom
  (šírky ako potrubia: pod 4 px sharpen prepáli), šedá zóna = 45° šrafovanie (Cesium
  `StripeMaterial` na ground polygóne — overiť, že na `GroundPrimitive` kreslí; inak textúra),
  smery = kotva + číslo stretov, hot kartičky na sídlach. Hranice cez `countryBoundaries` retain.
- **Bez `lo=` tokenu** v prvej verzii (tokeny plné); stav vrstiev modulu v paneli + `?front=` +
  `subj=` pre zdieľanie. Schéma v3 tokenov = samostatná úloha, ak modul má byť aj v `lo=`.
- **Časová pečiatka**: každý dataset má `meta.date` a `meta.lag`; hlavička panela ju skladá do
  „Situácia k večeru 17. 9. 2026 podľa DeepState (2–3 dni oneskorenie)" — presne ako pečiatka vzoru,
  ale s priznaným zdrojom.
- **Rozpočet**: všetko cez proxy s cache; GeoConfirmed a alerts.in.ua majú limity → server-side
  fronta ako pri GFW; Economist/VIINA/ETH sú súbory na D:, nikdy z prehliadača.

## 5. Etapy (odhad práce; každá končí testami, riadkami v `DATA_SOURCES.md`, zápisom do
`docs/CURRENT-STATE.md` a commitom do tematickej vetvy — nikdy push; zdieľané súbory cez HEAD-copy)

0. **Mantinely a žiadosti** — 0,5 d + čakanie. `sanctionedMedia.js` s testom; zoznam krokov pre
   používateľa (kap. 6); rozhodnutie otázok 1–7. Nič z toho neblokuje etapy 1–3.
1. **Podklad + scény smerov** — 2–3 d. Build skript (OSM/GeoNames/HDX/NE), lokálne vrstvy sídiel
   (3 stupne popisu ako pri svete, latinka + originál v hover karte), cesty, rieky, hranice oblastí;
   presety smerov s rámovaním; panel UKRAJINA skeleton s hlavičkou dátumu. Test: build validátor,
   scény, latinizácia mien z `name:uk`.
2. **Správy + hlásenia GŠ + sankčný filter** — 2 d. Región `ukraine` v `SITUATION_REGIONS`
   (GDELT dopyt + directRss UA/EN feedov s pravidlami obrázkov po zdrojoch), gazetteer UA pre hot
   kartičky, parser denného hlásenia GŠ (počty stretov po smeroch) → kotvy „strety" s číslom
   a kartou „oficiálne hlásenie UA · <čas>"; ISW 1 karta/deň (titulok + odkaz); TASS podľa
   otázky č. 4. Test: parser na fixtúre z 19. 9. 2026 (213 stretov, 13 smerov), filter Interfax,
   blocklist.
3. **Udalosti + požiare + odvodená zóna** — 3 d. VIINA denný pull (ODbL súbor), GeoConfirmed
   proxy (UA hlavička, Cache-Control, bez ORBAT), Economist war-fire (posledných 14 dní) + FIRMS
   ak je kľúč; ikony po typoch; hustota za 7 dní ako „zóna aktivity (odvodené)". Test: adaptéry,
   filtrovanie `graphic`, dedup VIINA/GeoConfirmed podľa času a sídla.
4. **Územná kontrola** — 2–4 d podľa odpovedí. Cesta A: DeepState API (polygóny + šedá zóna +
   história; pečiatka „oneskorenie 2–3 dni"). Cesta B: Black Bird Group (týždenné polygóny, dátum
   hodnotenia). Cesta C (provizórium, ide hneď): Wikipedia modul → body kontroly sídiel
   (modrá/červená/kontestované) + voliteľne georeferencovaný Commons SVG; derivát zverejnený pod
   CC BY-SA. Nikdy nespájať A a ISW. Test: parser Lua, zmena revízie → diff.
5. **Satelit II + opevnenia** — 3–5 d, len po súhlasoch. ETH škody (ADM3 súčty, statické),
   UNOSAT body (statické, dátum), nočné svetlá z GIBS ako prekryv; ruské opevnenia len s písomným
   súhlasom ISW/Africka; S-1 pred/po výrezy cez CDSE až vo fáze II.
6. **Poplachy + časová os + zdieľanie** — 2–3 d. alerts.in.ua polygóny oblastí (živé, token),
   časová os kontroly (DeepState/VIINA história), `subj=` + `?front=` v share linku, hlas: aliasy
   „ukrajina", „front", „lymanský smer".

## 6. Kroky, ktoré musí spraviť používateľ (registrácie a e-maily — nikdy agent)

| Krok | Kde | Odomkne | Nutné? |
|---|---|---|---|
| Žiadosť o API kľúč DeepState (opísať: nekomerčný verejný portál, server-side proxy s cache, vlastná symbolika, atribúcia + logo/odkaz) | https://api.deepstatemap.live/request | etapa 4A | pre jadro vzoru áno |
| E-mail Black Bird Group (nekomerčná adaptácia, atribúcia; opýtať sa na formát a kadenciu) | contact@blackbirdgroup.fi | etapa 4B | alternatíva k A |
| E-mail ISW o písomný súhlas (kontrola územia + opevnenia) — alebo rozhodnúť, že ISW ostáva len odkaz | kontakt na policy stránke (maskovaný, prečítať v prehliadači) | ISW vektory, opevnenia | voliteľné |
| FIRMS MAP_KEY (bezplatné) → `.env` | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | živé požiare | odporúčané |
| alerts.in.ua token (formulár) | https://alerts.in.ua/api-request | poplachy | etapa 6 |
| E-mail GeoConfirmed (formálna licencia pre verejný nekomerčný glóbus) | cez ich web | pokoj v duši, nie blokátor | slušnosť |
| Bellingcat (dátová licencia TimeMap), Texty (CSV), Brady Africk (KML), Project Owl (Discord) | e-mail / Discord | archívy, opevnenia | voliteľné |
| Earthdata Login, CDSE účet (OAuth secret server-side) | NASA / Copernicus | Black Marble, S-1 | fáza II |
| Prečítať Terms WarSpotting (Cloudflare bot-check) | v prehliadači | straty techniky | voliteľné |

## 7. Otázky pre používateľa (etapy 1–3 idú aj bez odpovede)

1. **Rozsah**: celý front + scény smerov (návrh), alebo len vybrané smery? Návrh presetov podľa
   hlásenia GŠ z 19. 9. 2026: Severoslobožanský/Kurský (Sumy), Južnoslobožanský (Vovčansk),
   Kupianský, **Lymanský**, Slovianský, Kramatorský, Kosťantynivský, Pokrovský, Oleksandrivský
   (overiť kotvu), Huliajpiľský, Orichivský, Prydniprovský (ľavý breh Dnipra). Kotvy = sídla,
   nie jednotky.
2. **Kadencia**: denný snímok (DeepState/VIINA/GŠ) + živé poplachy a požiare (návrh), alebo len denne?
3. **Registrácie**: ktoré z kap. 6 spravíš? (DeepState + FIRMS + alerts.in.ua sú najcennejšie.)
4. **Ruská strana**: TASS ako text „tvrdí RU" áno/nie? MO RF Telegram po overení prílohy I? Rybar nie.
5. **CC BY-SA derivát**: súhlasíš so zverejnením odvodeného datasetu „kontrola sídiel podľa
   Wikipédie" pod CC BY-SA (samostatný súbor s licenciou), kým nie je DeepState?
6. **Šípky útokov**: len ak ich dá zdroj (DeepState), inak žiadne — súhlas? (Nevymýšľať.)
7. **Ruské opevnenia** po súhlase ISW/Africka zobrazovať? (Infraštruktúra RU strany = eticky OK;
   UA opevnenia nikdy.)

## 8. Pasce zistené v prieskume (technické, aby sme nepadli dvakrát)

- HDX: WebFetch 403, curl s bežným User-Agent OK; robots.txt zakazuje /api/ a *.geojson → snímok ručne.
- GeoConfirmed: 403 pre fetchery, číta sa v reálnom prehliadači; robots Disallow /api/ je pre
  crawlery; schéma dát sa už raz zmenila → adaptér s testom fixtúry.
- zsu.gov.ua 403 (bot-ochrana) → ArmyInform RSS; EN feed mešká → UA + preklad + latinizácia.
- Kyiv Independent: `/rss/` a `/feed/` = 404, funguje len `/news-archive/rss/`; plný text vo feede.
- RFE/RL feed URL sú nečitateľné `/api/<id>` reťazce → držať v konfigurácii s menom.
- bbc.co.uk, dw.com blokujú crawler Anthropicu; server OKO ich sťahuje (ZÁLIV) — sledovať 403.
- GDELT GEO 404, DOC 429 → cache 15 min + RSS fallback (existuje).
- Wikidata 429 (Retry-After 120) → stránkovať po oblastiach v builde; Overpass timeouty na širokom dopyte.
- Natural Earth predvolene Krym pod RU → POV `_ukr`; geoBoundaries UKR ADM2 z 2006.
- ISW: RSS existuje len ako `feed/?post_type=map` (na zoznam odkazov), `wp-json` je v robots Disallow.
- Economist CSV 70 MB nezoradený podľa dátumu; ETH GeoTIFF 18 GB → D:, nikdy do klienta.
- Planetary Computer anonymný SAS token funguje napriek dokumentácii → počítať so zmenou.
- Telegram `t.me/s/` HTML náhľad je krehký; oficiálny embed widget existuje, ale je to ich UI.
- alerts.in.ua tvrdý limit 12 req/min/IP; história 2 req/min.
- Node nemá natívny HDF5 (Black Marble) a v systéme nie je Python → sidecar alebo GIBS PNG.
- Cesium: MVT dlaždice GIBS nečíta; `StripeMaterial` na ground polygóne overiť; hranice držať retain-om.

## 9. Stav prieskumu a čo ešte overiť pred zapojením

- Overené dvojmo: ISW web mapa (❌), ISW Map Room (❌ ako obsah), longlinecode feed (❌). Všetko
  ostatné = jedno čítanie s doslovným citátom; pred každým zapojením: checklist `new-data-layer`
  (vzorka odpovede, frekvencia, kľúč, ToS, počet objektov, živé vs. modelované) a riadok do
  `DATA_SOURCES.md` aj pre zamietnuté („preverené a nepoužité": ACLED, Liveuamap, GADM, EOG VNF,
  Ukraine War Archive, CIR, mirror DeepState, Rybar, príloha XV).
- Neznáme: čo presne vracia DeepState API (šedá zóna? šípky? história?) — zistí sa až s kľúčom;
  formát Black Bird Group; formálna licencia GeoConfirmed a Bellingcat dát; Terms WarSpotting;
  UCDP licencia (stránka CC BY 4.0 vs. staršie zrkadlá NC); akvizičný plán S-1 nad Ukrajinou.
- Workflow prieskumu: run `wf_0ec1e240-fb2`, skript
  `C:\Users\vladi\.claude\projects\C--AI-OKO-oko\c5464412-b3c4-4249-8bf4-4021d6854300\workflows\scripts\ukrajina-zdroje-wf_0ec1e240-fb2.js`
  (overovacia fáza sa dá dokončiť len na výslovný pokyn používateľa — agentov zastavil).

## 10. Súvisiace

Príloha s citátmi: `docs/drafts/ukrajina-zdroje-prieskum.md`. Vzory v kóde: `situationNews.js`,
`gulfIncidents.js`, `chokepointScenes.js`, `gasPipelinesLayer.js` (build + snímok + hover karta),
`localGeojson.js`, `densityDrape.js`, `firmsAdapt.js`. Pamäť: `oko-ukrajina-plan`, súvisí
`oko-zaliv-situacia`, `oko-chokepoint-sceny`, `oko-potrubia-plan`.
