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

## Stav (2026-09-19 večer): ETAPA 1 HOTOVÁ, etapy 2–6 nezačaté

Používateľ: „pokračuj etapou 1". Hotové a overené v pane (podklad OSM stack, lebo Google 3D
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
