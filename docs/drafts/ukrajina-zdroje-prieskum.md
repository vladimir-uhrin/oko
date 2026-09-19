# UKRAJINA — prieskum zdrojov (príloha k plánu), stav 2026-09-19

Výstup šiestich prieskumných agentov (WebSearch/WebFetch/curl, **bez registrácií, bez formulárov,
bez sťahovania dát**) a troch overovacích agentov, spustených ako workflow 2026-09-19 a zastavených
na pokyn používateľa. Citáty licencií sú doslovné zo stránok v `evidence`. **Overené dvojmo (nálezca +
skeptik) sú len 3 položky v časti G** — všetko ostatné je jedno čítanie a pred zapojením sa overuje znova
podľa checklistu `new-data-layer`. Plán, ktorý z toho vychádza: `docs/drafts/ukrajina-plan.md`.

Legenda `access`: open-download = bez kľúča a registrácie · api-keyless = API bez kľúča · api-key /
registration = kľúč alebo účet (vypĺňa používateľ, nikdy agent) · scrape-only = len HTML · paid = platené ·
unclear = nezistené.

## A. Územná kontrola a línia frontu (polygóny, front, šedá zóna)

Zdrojov: 14.

### ISW / CTP – Assessed Control of Terrain in Ukraine (ArcGIS Online web map + hosted FeatureServer vrstvy)

- URL: https://www.arcgis.com/home/item.html?id=9f04944a2fe84edab9da31750c2b15eb
- Druh / formát / prístup: control-polygons · ArcGIS FeatureServer (REST query: JSON / geoJSON / PBF), polygóny; web map JSON so zoznamom vrstiev · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): licenseInfo položky (verbatim): "This geodata is the exclusive intellectual property of the Institute for the Study of War (ISW). You may not use this geodata without the written consent of ISW." + Fair Use & Attribution Policy: "Any modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission from ISW."; zakázané "copy or reproduce shapefiles, developer notes, or datasets for any purpose without ISW's written consent" a "redistribute ISW Materials to third parties in bulk, via API, or through automated means"
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Atribúcia: copyrightText vrstvy 49: "Institute for the Study of War and American Enterprise Institute's Critical Threats Project"; policy vyžaduje "Source: Institute for the Study of War." + odkaz na understandingwar.org
- Aktualizácia: Denne (statické mapy); web map modified 2026-09-13; vrstva Assessed Russian-controlled Ukrainian Territory (layer 49) posledný EditDate 2026-09-11T05:43Z (10 polygónov); Assessed Russian Advances lastEdit 2026-08-06; Assessed Russian Gains in the Past 24 Hours lastEdit 2026-08-17; Russian Field Fortifications polylines lastEdit 2023-10-19
- Pokrytie: Celý front + Kursk/Belgorod (Russian/Ukrainian advances in Russia); vrstvy: Assessed Russian Control, Claimed Russian Territory in Ukraine (claimed vs assessed), Assessed Russian Infiltration Areas, Assessed Russian Advances, 24h gains, Claimed Ukrainian Counteroffensives, Russian-controlled before 2022-02-24, Russian Field Fortifications (3 vrstvy vrátane Nathan Ruser/ASPI), Kherson flood, Critical Raw Materials, Ukrainian settlements; od apríla 2022
- Riziká / poznámky: Služby sú verejné a bez tokenu (curl na services5.arcgis.com/SaBe5HMtmnbqSWlu/... vracia geoJSON), ALE licencia výslovne zakazuje použitie bez písomného súhlasu ISW a policy zakazuje inkorporáciu do 'mapping platforms' a automatizovanú redistribúciu — OKO proxy+cache = presne to. Bez písomného súhlasu NEPOUŽÍVAŤ vektory; požiadať ISW o písomné povolenie (nekomerčný projekt, atribúcia, link) — kontaktný e-mail je na stránke policy zamaskovaný (Cloudflare), treba ho prečítať v prehliadači. maxRecordCount 1000–2000; vlastník gbarros_understandingwar / thestudyofwar; existujú aj mesačné 'Timelapse'/'CoT' služby s rovnakým licenseInfo. Metodika ISW = 'assessed' (konzervatívna), nie 'claimed'.
- Dôkazy:
  - https://www.arcgis.com/sharing/rest/content/items/9f04944a2fe84edab9da31750c2b15eb?f=json — licenseInfo: "This geodata is the exclusive intellectual property of the Institute for the Study of War (ISW). You may not use this geodata without the written consent of ISW."; modified 2026-09-13; owner gbarros_understandingwar
  - https://www.arcgis.com/sharing/rest/content/items/9f04944a2fe84edab9da31750c2b15eb/data?f=json — operationalLayers, napr. Assessed Russian Control = https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49 ; Claimed Russian Territory = .../ClaimedRussianTerritoryinUkraine_V2_view/FeatureServer/0 ; Assessed Russian Advances = .../AssessedRussianAdvanceInUkraine_V2_view/FeatureServer/0 ; 24h gains = .../Assessed_Russian_Gains_in_the_Past_24_Hours_view/FeatureServer/0 ; Infiltration = .../View_AssessedRussianInfiltrationAreasinUkraine_V4/FeatureServer/0 ; fortifikácie = .../Russian_Field_Fortifications_Polylines/FeatureServer/591
  - https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49?f=pjson — name "Assessed Russian-controlled Ukrainian Territory", copyrightText "Institute for the Study of War and American Enterprise Institute's Critical Threats Project", esriGeometryPolygon, supportedQueryFormats JSON, geoJSON, PBF, capabilities Query,Sync,ChangeTracking
  - https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49/query?where=1%3D1&outFields=EditDate&orderByFields=EditDate%20DESC&resultRecordCount=1&returnGeometry=false&f=json — EditDate 2026-09-11T05:43:24Z; count=10
  - https://www.understandingwar.org/fair-use-and-attribution-policy/ — povolené len "viewing and sharing materials in their published form for non-commercial, informational or media purposes"; zakázané "copy or reproduce shapefiles, developer notes, or datasets for any purpose without ISW's written consent" a "redistribute ISW Materials to third parties in bulk, via API, or through automated means"
  - https://www.arcgis.com/sharing/rest/search?q=(ukraine%20AND%20(control%20OR%20frontline%20OR%20%22front%20line%22))%20AND%20type%3A%22Feature%20Service%22&f=json&num=25&sortField=modified&sortOrder=desc — všetky ISW služby (SEP2025RUCoT, May_CoT_view, COT_Merge_Jan_2026_view, Timelapse…) nesú rovnaké 'ISW exclusive IP' licenseInfo; žiadna otvorene licencovaná control vrstva na AGOL nenájdená

### ISW Map Room – denné statické mapy (PNG) 'Assessed Control of Terrain in the Russo-Ukrainian War' + smerové výrezy

- URL: https://www.understandingwar.org/analysis/map-room/
- Druh / formát / prístup: official-report · image only (PNG/JPG), denne; celoukrajinská mapa + výrezy (Kupyansk, Kostyantynivka-Druzhkivka, Dobropillya, Zaporizhzhia City…) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): Fair Use & Attribution Policy: povolené "viewing and sharing materials in their published form for non-commercial, informational or media purposes"; "Any modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission from ISW."; "©2026 INSTITUTE FOR THE STUDY OF WAR. ALL RIGHTS RESERVED."
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Atribúcia: "Source: Institute for the Study of War." (print/web), odkaz späť na understandingwar.org; nemeniť logo/credit line/disclaimer
- Aktualizácia: Denne; najnovšia mapa Ukrajiny 2026-09-18 1:30 PM ET
- Pokrytie: Celý front + denné smerové výrezy (vzor 'Lyman direction' je presne tento produkt); od 2022
- Riziká / poznámky: Jediná licenčne čistá cesta k ISW bez písomného súhlasu: zobraziť nezmenený obrázok 'v publikovanej podobe' v karte panela s odkazom a atribúciou (nie georeferencovaný overlay na glóbuse — to je 'modification'/'incorporation into mapping platform'). Nie je strojovo čitateľné; URL obrázkov sa denne menia — treba scrapovať stránku Map Room (kategória scrape).
- Dôkazy:
  - https://www.understandingwar.org/analysis/map-room/ — "ISW produces the world's premier open-source maps"; mapa 'Assessed Control of Terrain in the Russo-Ukrainian War' 2026-09-18 1:30 PM ET
  - https://www.understandingwar.org/ — footer "©2026 INSTITUTE FOR THE STUDY OF WAR. ALL RIGHTS RESERVED."; odkazy /fair-use-and-attribution-policy/ a /analysis/russia-ukraine/
  - https://www.understandingwar.org/fair-use-and-attribution-policy/ — "Source: Institute for the Study of War."

### DeepStateMap.live – oficiálne API (DEEPSTATEUATECH LLC / Deep State UA)

- URL: https://deepstatemap.live/
- Druh / formát / prístup: control-polygons · API JSON/GeoJSON (endpoint používaný mirrormi: https://deepstatemap.live/api/history/last), multipolygóny okupovaného územia (+ šedá zóna v UI); história od 24.2.2022 · **unclear**
- Strojovo čitateľné: áno
- Licencia (doslovne): License Agreement (EN, verbatim): "The right to transfer and grant permission to use the API...belongs exclusively to the Copyright Holder."; "The API is provided for free to entities engaged in: Volunteer and charitable activities" a "Activities for the defense of Ukraine, its sovereignty, and territorial integrity"; "Entities operating on a commercial basis may use the API only with prior approval from the Copyright Holder"; "Unauthorized distribution, publication, proxying, or other methods of transferring the API to third parties are prohibited"; "Visual materials containing a text reference, the DeepStateMap.live logo, or a direct link to the Objects may be freely used for both commercial and non-commercial purposes."; "The creation of identical objects that completely match the Objects is prohibited."; "The Copyright Holder does not guarantee complete accuracy, relevance, or reliability of the data."; "Disputes resolve under Ukrainian law"; platnosť do 2030-12-31
- Licencia URL: https://deepstatemap.live/license-en.html
- Atribúcia: "a text reference, the DeepStateMap.live logo, or a direct link to the Objects"
- Aktualizácia: Priebežne, zámerne oneskorené o 2–3 dni kvôli verifikácii (Wikipedia + Kyiv Independent); mirror sťahuje denne 03:00 UTC
- Pokrytie: Celý front, okupované územie, šedá zóna, história od 24.2.2022; UA-stranový OSINT so zdrojmi v jednotkách, memorandum s MO Ukrajiny (3/2024)
- Riziká / poznámky: Osobný nekomerčný projekt nie je výslovne ani 'volunteer/charitable' ani 'commercial' — sivá zóna; správne je podať žiadosť na https://api.deepstatemap.live/request (formulár = používateľ, nie agent) a opísať OKO ako nekomerčný portál. OKO server-side proxy, ktorá prehliadaču posiela DeepState dáta, sa dá čítať ako zakázané 'proxying ... of the API to third parties' — pri žiadosti to výslovne uviesť. Kópia 1:1 celej mapy = 'identical objects' zákaz — OKO štýl (vlastná symbolika, iné vrstvy) je v poriadku. Vizuálne materiály (screenshot/obrázok s logom+linkom) sú voľné aj komerčne = núdzová licenčne čistá cesta. Ukrajinská jurisdikcia. Dáta nesú UA perspektívu (v UI označiť 'podľa DeepState'). API som priamo nevolal.
- Dôkazy:
  - https://deepstatemap.live/license-en.html — plné znenie sekcií 2 (API), 3 (vizuál/text), 5 (copyright), 9 (jurisdikcia), 10 (platnosť do 2030-12-31)
  - https://deepstatemap.live/license.html — UA originál: "Забороняється створення ідентичних об'єктів, що повністю відповідають Об'єктам правовласника"; правовласник ТОВ "ДІПСТЕЙТЮАТЕХ"
  - https://api.deepstatemap.live/request — stránka žiadosti o API (SPA, obsah sa bez JS nenačíta)
  - https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/scripts/download-geojson.py — endpoint "https://deepstatemap.live/api/history/last", posiela mobilný User-Agent, výstup deepstatemap_data_YYYYMMDD.geojson
  - https://github.com/sgofferj/tak-feeder-deepstate — "This project and its use of the deepstatemap.live API has been officially authorized by the deepstatemap.live team" (dôkaz, že DS dáva individuálne súhlasy)
  - https://en.wikipedia.org/wiki/DeepStateMap.Live — "a slight delay in information of up to 2–3 days"; Deep State UA, ~100 ľudí; memorandum s MO Ukrajiny 3/2024
  - https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/ — 2025-12-02: DeepState zámerne mešká 2–3 dni; šedé zóny dnes = 'wider contact zones, dotted with overlapping positions'; tlak úradov po prieniku pri Dobropilli

### cyterat/deepstate-map-data (+ fork lazar-bit/deepstate-map-data-analytics s CSV) – denný GitHub mirror DeepState GeoJSON

- URL: https://github.com/cyterat/deepstate-map-data
- Druh / formát / prístup: control-polygons · GeoJSON MultiPolygon: data/deepstatemap_data_<YYYYMMDD>.geojson (denne) + deepstate-map-data.geojson.gz (celá história s dátumami, polia id/date/geometry); fork lazar-bit pridáva kumulatívne CSV (plocha) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Repo: GPL-3.0 (GitHub API license.spdx_id = GPL-3.0) — vzťahuje sa na kód; README neuvádza žiadnu licenciu DÁT; lazar-bit: "All original licensing terms apply and are retained." Dáta zostávajú predmetom DeepState License Agreement (viď DeepStateMap.live)
- Licencia URL: https://github.com/cyterat/deepstate-map-data/blob/main/LICENSE
- Atribúcia: DeepStateMap.live (text/logo/link) podľa DS licencie; ihorbach odporúča popis "territory under Russian control according to DeepState"
- Aktualizácia: Denne 03:00 UTC (GitHub Actions); pushed_at 2026-09-19T07:51Z (cyterat), 2026-09-19T07:34Z (lazar-bit); 1 226 commitov
- Pokrytie: Len 'Occupied' multipolygón (podľa názvu repa); história súborov od 2024-07-08 (najstarší videný súbor deepstatemap_data_20240708.geojson); celý front
- Riziká / poznámky: Derivát bez súhlasu DS (skript maskuje User-Agent) — právne nečistí sprostredkovateľ; DS zákaz 'proxying' sa obchádza technicky, nie licenčne. Mirror sa môže kedykoľvek zastaviť. Iba okupované územie — šedá zóna/frontová línia sa musí dopočítať (hranica polygónu ≈ 'línia kontroly RU'). GPL-3.0 na kód, nie na dáta. Použiteľné ako núdzový zdroj počas čakania na DS súhlas, v UI vždy 'podľa DeepState, cez mirror, dátum súboru'.
- Dôkazy:
  - https://api.github.com/repos/cyterat/deepstate-map-data — license GPL-3.0, pushed_at 2026-09-19T07:51:12Z
  - https://github.com/cyterat/deepstate-map-data — "Frequency of updates: Daily, at 03:00 UTC"; deepstatemap_data_<update_date>.geojson; deepstate-map-data.geojson.gz
  - https://api.github.com/repos/cyterat/deepstate-map-data/contents/scripts — download-geojson.py, unify-data.py
  - https://api.github.com/repos/lazar-bit/deepstate-map-data-analytics — fork of cyterat/deepstate-map-data, GPL-3.0, pushed 2026-09-19T07:34Z; README: "All original licensing terms apply and are retained."
  - https://github.com/ihorbach/ukraine-territory-trend — geometria z cyterat mirroru; "The figures are derived estimates and should be labelled 'territory under Russian control according to DeepState.'"
  - https://www.kaggle.com/datasets/zsoltlazar/automated-deepstatemap-occupied-areas — ten istý dataset na Kaggle (nepreverené podmienky)

### longlinecode/russo-ukrainian-front-daily – odvodený denný GeoJSON feed (DeepState + ISW rekonštrukcia) s CesiumJS adaptérom

- URL: https://github.com/longlinecode/russo-ukrainian-front-daily
- Druh / formát / prístup: frontline · GeoJSON data/latest.geojson (properties: russian_control area, contact_line, ukrainian_control_in_russia) na GitHub Pages: https://longlinecode.github.io/russo-ukrainian-front-daily/data/latest.geojson (odvodené z README vzoru + homepage, súbor som nesťahoval); embed/ua-situation-layer.js pre MapLibre/Leaflet/deck.gl/ArcGIS/CesiumJS · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Repo bez LICENSE (GitHub API license = null); README: "Control-area data © DeepStateMap.Live; Situation assessments © Institute for the Study of War / Critical Threats Project; Basemap: Natural Earth (public domain), geoBoundaries (CC BY 4.0), GeoNames (CC BY 4.0); Elevation: AWS Terrain Tiles…"; kód "free to use"
- Atribúcia: DeepStateMap.Live + Institute for the Study of War/CTP + Natural Earth/geoBoundaries/GeoNames
- Aktualizácia: "GitHub Actions refreshes the data and republishes the site every day at 04:10 UTC."; pushed_at 2026-09-19T08:46Z; 40 commitov
- Pokrytie: Od 2024-07-08 DeepState (cez cyterat mirror); 2022-02-24–2024-07-07 "reconstructed from Institute for the Study of War (ISW) / Critical Threats assessments" s presnosťou "roughly 5–10 km" (16 kľúčových dátumov); + UA-držané územie v Rusku
- Riziká / poznámky: Dvojitý derivát: DS mirror (bez DS súhlasu) + ISW rekonštrukcia (ISW policy zakazuje deriváty bez súhlasu). Ako zdroj do OKO nie; ako referenčná implementácia (Cesium clampToGround, výpočet contact_line z polygónu, štýl 13 vrstiev) áno. Malý projekt (40 commitov) — nestabilné.
- Dôkazy:
  - https://api.github.com/repos/longlinecode/russo-ukrainian-front-daily — license null, has_pages true, homepage https://longlinecode.github.io/russo-ukrainian-front-daily/, pushed_at 2026-09-19T08:46:43Z
  - https://raw.githubusercontent.com/longlinecode/russo-ukrainian-front-daily/main/README.md — feed `data/latest.geojson`; "DeepStateMap.Live daily occupied-area GeoJSON, obtained via the GitHub mirror cyterat/deepstate-map-data (updated 03:00 UTC daily)"; ISW rekonštrukcia "accuracy roughly 5–10 km"; "await front.addToCesium(viewer, Cesium);"

### Ukraine Control Map (Project Owl / @UAControlMap) – denné KMZ zálohy Google My Maps

- URL: https://github.com/owlmaps/UAControlMapBackups
- Druh / formát / prístup: control-polygons · KMZ (Google My Maps export): https://github.com/owlmaps/UAControlMapBackups/raw/latest/latest.kmz + denné súbory v priečinkoch 2022/…/2026/; zdroj = https://www.google.com/maps/d/kml?mid=1xPxgT8LtUjuspSOGHJc2VzA5O5jWMTE · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear — repo bez LICENSE (GitHub API license = null), README bez podmienok, uacontrolmap.com stránky /about/, /map/ vracajú 404 a root iba JS redirect; jediný nájdený atribučný vzor je v ich vlastnom vieweri: "Data source: Ukraine Control Map"
- Atribúcia: "Data source: Ukraine Control Map" (http://uacontrolmap.com) — podľa ich map-viewera; ikony "Icons generated with Milsymbol"
- Aktualizácia: Denne (cron fetch.sh); pushed_at 2026-09-19T10:01Z; 1 309 commitov; od 2026-05-01 nová štruktúra (latest branch + ročné priečinky)
- Pokrytie: Celý front: línia frontu, geolokácie, prítomnosť a pozície jednotiek ("Geolocations, Presence and Unit Positions"); história od 2022
- Riziká / poznámky: Bez licencie = implicitne all rights reserved → treba sa spýtať (Discord https://discord.com/invite/projectowl, X @UAControlMap). Obsahuje pozície jednotiek — OKO etická čiara (žiadne osoby) je OK, ale pozície jednotiek by som filtroval a nechal len kontrolné polygóny/front. Google My Maps ako zdroj (export KML je štandardná funkcia, ale Google môže zmeniť). Mastodon záloha mŕtva od 2023-09. KMZ treba parsovať (Cesium KmlDataSource zvládne).
- Dôkazy:
  - https://api.github.com/repos/owlmaps/UAControlMapBackups — license null; description "Backups of Project Owl: Ukraine Control Map"; homepage https://uacontrolmap.com; pushed_at 2026-09-19T10:01:12Z
  - https://raw.githubusercontent.com/owlmaps/UAControlMapBackups/master/fetch.sh — EXPORT_URL='https://www.google.com/maps/d/kml?mid=1xPxgT8LtUjuspSOGHJc2VzA5O5jWMTE'; cp … latest.kmz
  - https://github.com/owlmaps/UAControlMapBackups — "Daily backups of the map at uacontrolmap.com"; latest.kmz na vetve latest; priečinky 2022/…/2026/
  - https://www.uacontrolmap.com/map-viewer/ — "Data source: Ukraine Control Map" (http://uacontrolmap.com), "Icons generated with Milsymbol"
  - https://mastodon.social/api/v1/accounts/lookup?acct=uacontrolmap — bio "Map and summaries showing Geolocations, Presence and Unit Positions during the going Ukraine-Russia war"; last_status_at 2023-09-12
  - https://github.com/owlmaps — org bio "Projects we start, and probably don't finish. Some might be related to mapping."; repá map-data, map-viewer, units, timeline-data

### Black Bird Group ry (Fínsko) – interaktívna frontová mapa + metodika (grey zone), týždenný export do ACLED

- URL: https://www.blackbirdgroup.fi/map
- Druh / formát / prístup: control-polygons · HTML web map (JS 'Loading the live front line', podklad OpenFreeMap/OSM); formát dát nezverejnený; týždenný snímok v ACLED Ukraine Conflict Monitor · **unclear**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear — bez formálnej licencie; web: "We are also happy to cooperate with research institutions and media for the use of our map in non-profit or public-facing adaptations."; "© 2026 Black Bird Group ry"
- Atribúcia: Black Bird Group ry; podklad "base map © OpenFreeMap and OpenStreetMap contributors"
- Aktualizácia: "Updated as the situation changes" / "The map is updated continuously as new information becomes available."; v ACLED "updated every week, correct as of the most recent Friday"
- Pokrytie: Celý front; "The history data is available ever since the first day of the war"; explicitná šedá zóna medzi líniami UA a RU kontroly; konzervatívna metodika
- Riziká / poznámky: Žiadny verejný download — treba osloviť contact@blackbirdgroup.fi (nekomerčná adaptácia je výslovne vítaná). Dáta datované podľa času hodnotenia, nie udalosti; "does not depict real-time tactical positions". Platforma mapy neznáma (WebFetch nevidí JS) — nescrapovať bez súhlasu. Metodika je najlepšie zdokumentovaná zo všetkých → vhodná ako text 'ako čítať mapu' v UI.
- Dôkazy:
  - https://blackbirdgroup.fi/ — "A regularly updated front-line map, maintained as a public product"; "We are also happy to cooperate with research institutions and media for the use of our map in non-profit or public-facing adaptations."; Black Bird Group ry (3388403-3)
  - https://www.blackbirdgroup.fi/map — "Russian-held territory", "the position of the front line and the extent of occupied territory", "Updated as the situation changes", "© 2026 Black Bird Group ry"
  - https://acleddata.com/system/files/2026-07/Black-Bird-Group-Frontline-Mapping-Methodology-Summary.pdf — "Control is defined as the ability of a force to operate in an area without direct interference from opposing ground forces. Where control cannot be reliably assessed, areas are designated as a grey zone."; "Dates associated with changes reflect the time of assessment rather than the exact timing of events"; "Past map states are generally not revised retroactively."; "It is not suitable for tactical or real-time use."
  - https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/ — BBG: "When we paint an area as Russian or Ukrainian-controlled, it's more like here the Ukrainians or Russians generally have more control than the other side."

### ACLED Ukraine Conflict Monitor – týždenné polygóny kontroly (Black Bird Group) + udalosti

- URL: https://acleddata.com/monitor/ukraine-conflict-monitor
- Druh / formát / prístup: control-polygons · HTML dashboard; export dát ACLED cez registrovaný účet ('Restricted page'); či sú polygóny kontroly exportovateľné, nie je uvedené · **registration**
- Strojovo čitateľné: nie
- Licencia (doslovne): ACLED Terms (EULA + Content Usage Terms + Attribution Policy): "Use ACLED data, analysis, and platforms responsibly and in good faith."; zakázané "To provide services to or for any other person, entity, or organization without authorization"; zakázané "To train, test, develop, or improve any machine learning (ML) models, large language models (LLMs), artificial intelligence (AI) systems..."; "© 2026 ACLED all rights reserved."
- Licencia URL: https://acleddata.com/terms-of-use/
- Atribúcia: "Source: ACLED, accessed on [date]. www.acleddata.com" viditeľne na vizualizácii (legenda/spodok); logo ACLED len so súhlasom
- Aktualizácia: Týždenne; kontrola územia "correct as of the most recent Friday"
- Pokrytie: Celá Ukrajina od 2022-02-24 (udalosti od 2020); kontrola územia = BBG vrstva
- Riziká / poznámky: Registrácia (vyplní používateľ, nie agent). EULA som nečítal (samostatný dokument). Re-serving cez OKO proxy môže naraziť na 'provide services to ... any other person ... without authorization'. Pre UHOL 1 skôr sekundárny kanál k BBG dátam; hlavná hodnota ACLED je pre UHOL udalostí.
- Dôkazy:
  - https://acleddata.com/monitor/ukraine-conflict-monitor — "Territorial control maps from Black Bird Group, updated every week", "correct as of the most recent Friday"; dve dátové stránky 'Restricted page'; "© 2026 ACLED all rights reserved."
  - https://acleddata.com/content-usage-terms/ — "Use ACLED data, analysis, and platforms responsibly and in good faith."; zákaz "To provide services to or for any other person, entity, or organization without authorization"; AI/ML zákaz
  - https://acleddata.com/attribution-policy/ — "Source: ACLED, accessed on [date]. www.acleddata.com"
  - https://acleddata.com/terms-of-use/ — rozcestník na EULA, Content Usage Terms, Attribution Policy

### Wikipedia – Module:Russo-Ukrainian War detailed map (Lua tabuľka kontrolných bodov sídiel)

- URL: https://en.wikipedia.org/wiki/Module:Russo-Ukrainian_War_detailed_map
- Druh / formát / prístup: other · Lua tabuľka v wikitexte (lat/long/mark/label/link na každé sídlo; ikony control dot blue/red, contested, siege arcs, bases/ports); strojovo cez MediaWiki API (action=raw / action=query prop=revisions) — body, NIE polygóny · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): CC BY-SA 4.0 (+ GFDL): Wikipedia:Copyrights — "Permission is granted to copy, distribute and/or modify Wikipedia's text under the terms of the Creative Commons Attribution-ShareAlike 4.0 International License and, unless otherwise noted, the GNU Free Documentation License."
- Licencia URL: https://en.wikipedia.org/wiki/Wikipedia:Copyrights
- Atribúcia: Odkaz/URL na stránku modulu + licenčná poznámka CC BY-SA 4.0 s odkazom na text licencie; úpravy pod CC BY-SA 4.0 alebo novšou; uviesť, čo bolo zmenené
- Aktualizácia: Priebežne editormi (denne); každá zmena musí mať zdroj v článku 'Territorial control during the Russo-Ukrainian war'
- Pokrytie: Sídla v celej Ukrajine (cca 400–500+ značiek len vo viditeľnej časti; celý modul je väčší) — stav kontroly/sporné/obliehanie; nie územné polygóny
- Riziká / poznámky: Jediný plne licenčne čistý strojovo čitateľný zdroj dnes — ale ShareAlike: odvodený dataset (nie celá appka) musí ísť von pod CC BY-SA. Iba body — polygóny/front sa z toho nedajú poctivo odvodiť (leda 'kontrola sídiel' vrstva). Pravidlá modulu: "Copying from maps is strictly prohibited" (nezávislosť od ISW/DS, ale kvalita = editori). Parsovanie Lua (regex na lat/long/mark) a pravidelný diff revízií cez API.
- Dôkazy:
  - https://en.wikipedia.org/wiki/Module:Russo-Ukrainian_War_detailed_map/doc — parametre lat, long, mark, marksize, label, link; "A reliable source for the specific edit should be provided"; kopírovanie z máp zakázané; len bodové značky
  - https://en.wikipedia.org/wiki/Module:Russo-Ukrainian_War_detailed_map — Lua tabuľka, stovky bodových značiek (Location_dot_blue.svg, Map-arcNE-blue.svg…), žiadne polygóny
  - https://en.wikipedia.org/wiki/Wikipedia:Copyrights — CC BY-SA 4.0 + GFDL citát; povinnosti reusera (atribúcia hyperlinkom/URL, share-alike, označiť zmeny, licenčná poznámka)
  - https://en.wikipedia.org/wiki/Territorial_control_during_the_Russo-Ukrainian_war — zdrojový článok (cituje ISW, DeepState, War Mapper, Reuters/BBC/CNN); "dynamic list"

### Wikimedia Commons – File:2022 Russian invasion of Ukraine.svg (kontrolné polygóny ako SVG) + per-oblast mapy

- URL: https://commons.wikimedia.org/wiki/File:2022_Russian_invasion_of_Ukraine.svg
- Druh / formát / prístup: control-polygons · SVG (negeoreferencované vektorové polygóny + krúžky sídiel); kategórie s per-oblast SVG (Sumy, Chernihiv, Dnipropetrovsk, Poltava, Zhytomyr…); žiadny Data:*.map GeoJSON pre kontrolu územia na Commons nenájdený · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): "This file is licensed under the Creative Commons Attribution-Share Alike 4.0 International license."
- Licencia URL: https://creativecommons.org/licenses/by-sa/4.0/
- Atribúcia: Autor Viewsridge (na základe Rr016, Yakiv Gluck) + odkaz na súbor na Commons + CC BY-SA 4.0; deriváty share-alike
- Aktualizácia: Často editované (viac úprav v 2026; posledná verzia videná 2026-04-24 — dátum z fetchu, história je dlhšia)
- Pokrytie: Celá Ukrajina od 24.2.2022; kontrola mimo sídiel podľa popisu súboru odvodená z máp ISW
- Riziká / poznámky: SVG nie je geo — treba jednorazovo georeferencovať (afinná transformácia podľa známych bodov) a potom sledovať zmeny súboru; pracné, presnosť nízka. Popis súboru priznáva, že kontrola mimo sídiel sa preberá z ISW máp — licenčne sivé (uploader dáva CC BY-SA na ISW-odvodený obsah). Share-alike na derivát.
- Dôkazy:
  - https://commons.wikimedia.org/wiki/File:2022_Russian_invasion_of_Ukraine.svg — licenčná šablóna CC BY-SA 4.0; autor Viewsridge; "references the ISW's maps for determining land control outside settlements"; edituje sa priebežne v 2026
  - https://commons.wikimedia.org/wiki/Category:Maps_of_the_Russo-Ukrainian_War — 'Russian-occupied territories in map' (.svg/.jpg/.webp), per-oblast SVG 'Russian Occupation of … Oblast.svg'
  - https://commons.wikimedia.org/wiki/Data:Ukraine.map — na Commons je len hranica štátu (ODC PDDL), nie kontrola územia

### War Mapper (@War_Mapper, warmapper.org) – týždenné mapy kontroly (obrázok) + zoomovateľná verzia na Soar

- URL: https://www.warmapper.org/
- Druh / formát / prístup: control-polygons · image only (PNG na X/Telegram/Mastodon/Substack); zoomovateľné rastre na soar.earth → soaratlas.com (400+ máp); podkladový dataset len pre platených odberateľov Substacku (formát neuvedený) · **paid**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear — na warmapper.org ani Substack about žiadna licencia/podmienky; Soar stránka mapy vracia 403 (licenčné pole som nevidel)
- Atribúcia: War Mapper (warmapper.org) — bez formálneho znenia
- Aktualizácia: "Weekly control updates for the war in Ukraine based on verifiable geolocations."; Mastodon posledný status 2025-04-10 (hlavný kanál je X/Substack)
- Pokrytie: Celý front + mesačné bilancie km²; len potvrdené zmeny ("presenting only what can be verified")
- Riziká / poznámky: Jednočlenný projekt ("A one-person project"), bez licencie → len odkazovať; dataset za paywall Substacku (a aj tak bez reuse podmienok). Nie je vhodný ako vrstva do OKO, maximálne link v paneli zdrojov.
- Dôkazy:
  - https://www.warmapper.org/ — "War Mapper tracks and maps confirmed territorial changes in armed conflicts…presenting only what can be verified"; "Weekly control updates for the war in Ukraine based on verifiable geolocations."; "A one-person project."; žiadna licencia
  - https://warmapper.substack.com/about — platení: "Access to the underlying dataset behind the Ukraine territorial overview charts"; "Ukraine control map updates will remain free to access for as long as they continue to be produced"
  - https://mstdn.social/api/v1/accounts/lookup?acct=warmapper — bio "Map updates of the war in Ukraine. A zoomable version is available on soar earth"; last_status_at 2025-04-10
  - https://soar.earth/maps/changes-to-control-in-ukraine-05-12-24-part-1-3-106890 — 301 → https://soaratlas.com/maps/changes-to-control-in-ukraine-05-12-24-part-1-3-106890 (403 pre fetch)

### Liveuamap (Live Universal Awareness Map) – komerčná mapa udalostí + kontroly, platené API

- URL: https://liveuamap.com/about
- Druh / formát / prístup: events · API JSON (udalosti: description, region, time, image, link source, location, videos); podľa tretej strany aj GeoJSON/KML export pre predplatiteľov · **paid**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear — liveuamap.com/about, /terms aj me.liveuamap.com/welcome vracajú HTTP 403 pre automatizovaný fetch; podľa vyhľadávacieho snippetu stránky /about: Pro plán od $150/mesiac (200 req/deň), Enterprise od $1 000/mesiac (1 500 req/deň) — neoverené priamo
- Atribúcia: neznáme (ToS nedostupné)
- Aktualizácia: Priebežne (udalosti v reálnom čase)
- Pokrytie: Celá Ukrajina od 2014; udalosti + kontrola územia
- Riziká / poznámky: Komerčný produkt, ToS nečitateľné strojom (403) = web je proti automatizovanému prístupu nastavený nepriateľsky; neembedovať, nescrapovať; cena mimo rozsahu osobného projektu. Do OKO nanajvýš ako externý odkaz.
- Dôkazy:
  - https://liveuamap.com/about — HTTP 403 pri fetchi; vyhľadávací snippet: Pro $150/mesiac 200 req/deň, Enterprise $1 000/mesiac 1 500 req/deň (neoverené)
  - https://liveuamap.com/terms — HTTP 403
  - https://me.liveuamap.com/welcome — HTTP 403
  - https://github.com/simonhuwiler/russo-ukrainian-data-ressources — "Ukrainian project. GeoJSON and KML. About $85 per year." (staršia informácia)
  - https://findapis.com/es/api/liveuamap — "Precios: Desconocido"; API vracia "event description, region, time, image, link source, location, videos and more"
  - https://en.wikipedia.org/wiki/Liveuamap — Rodion Rozhkovskiy a Oleksandr Bilchenko (Dnipro), spustené 2014-02-18; bez info o cenách

### MilitaryLand.net – archív máp frontu 2022-02-25 → 2023-12-31 (CC BY-SA 4.0), ukončené

- URL: https://militaryland.net/maps/
- Druh / formát / prístup: control-polygons · image only (statické mapy frontov, mapa nasadenia jednotiek); KML/GeoJSON nenájdené · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): "All data available under the CC BY-SA 4.0 unless stated otherwise."
- Licencia URL: https://militaryland.net/maps/
- Atribúcia: MilitaryLand.net, CC BY-SA 4.0 (stránka /copyright/ vracia 404 — presné znenie atribúcie neoverené)
- Aktualizácia: Ukončené: "As of January 1, 2024, we have made the difficult decision to discontinue map creation and end support for our Deployment map, which we had maintained since 2017."
- Pokrytie: Fronty 2022–2023 (Charkov do 2022-09-23, Cherson do 2022-11-12, celá mapa do 2023-12-31)
- Riziká / poznámky: Len historický obrazový archív, žiadne aktuálne dáta; pre OKO 'live' modul bez použitia, ak niekedy pribudne časová os 2022–23, je to čistý CC BY-SA zdroj obrázkov.
- Dôkazy:
  - https://militaryland.net/maps/ — "All data available under the CC BY-SA 4.0 unless stated otherwise."; "As of January 1, 2024, we have made the difficult decision to discontinue map creation…"
  - https://militaryland.net/maps/russian-invasion/ — archív 2022-02-25 až 2023-12-31; opäť CC BY-SA 4.0 veta
  - https://militaryland.net/copyright/ — HTTP 404

### Kyiv Independent – 'Where is Ukraine's front line? The answer is getting harder, and more political' (metodické rozdiely DeepState / ISW / Black Bird Group)

- URL: https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/
- Druh / formát / prístup: methodology · HTML článok (2025-12-02) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (novinový článok, štandardné autorské právo — citovať krátko s odkazom)
- Atribúcia: Kyiv Independent, 2025-12-02
- Aktualizácia: jednorazovo
- Pokrytie: Vysvetľuje, prečo sa zdroje líšia: šedé zóny vs. infiltrácia, 2–3-dňové oneskorenie DeepState, konzervatívnosť BBG, tlak úradov na mapérov
- Riziká / poznámky: Použiť len ako podklad pre text 'ako čítať mapu' v UI a pre disclaimer 'zdroje sa líšia'; nie ako dátový zdroj.
- Dôkazy:
  - https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/ — DeepState má "inside sources from Ukrainian units all across the front line", zámerne mešká 2–3 dni; šedé zóny dnes "wider contact zones, dotted with overlapping positions"; po prieniku pri Dobropilli úrady tvrdili "only 5-10 Russians had slipped through" v rozpore s tým, čo DeepState už mal na mape

**Poznámky nálezcu (notes):** ČO SOM HĽADAL A AKO: WebSearch + WebFetch, žiadna registrácia, žiadne formuláre, žiadne vedomé sťahovanie. ArcGIS Online HTML stránky (item.html, storymaps) sú SPA a WebFetch z nich nič nevyčíta — funguje REST: https://www.arcgis.com/sharing/rest/content/items/<id>?f=json (licenseInfo, modified) a …/<id>/data?f=json (zoznam FeatureServer URL), plus <FeatureServer>/<layer>?f=pjson a …/query. Tým som získal kompletnú mapu ISW služieb (services5.arcgis.com/SaBe5HMtmnbqSWlu/…): Assessed Russian Control (layer 49, 10 polygónov, EditDate 2026-09-11), Claimed Russian Territory, Infiltration Areas, Advances, 24h gains, fortifikácie (3 vrstvy), pre-2022, Kursk vrstvy. KĽÚČOVÝ NÁLEZ: ISW geodáta sú technicky verejné bez tokenu, ale licenseInfo hovorí doslova, že sa nesmú použiť bez písomného súhlasu ISW a Fair Use policy zakazuje inkorporáciu do 'mapping platforms' a redistribúciu 'via API, or through automated means' → OKO proxy = porušenie bez súhlasu. Odporúčanie: (1) napísať ISW o písomný súhlas pre nekomerčný OKO (atribúcia + link), dovtedy ISW len ako nezmenený denný PNG v karte s odkazom; (2) podať žiadosť DeepState na api.deepstatemap.live/request (formulár vyplní používateľ) a výslovne opísať server-side proxy s cache, lebo licencia zakazuje 'proxying … of the API to third parties'; DeepState vizuály s logom/linkom sú voľné aj komerčne — núdzová cesta; (3) osloviť Black Bird Group (contact@blackbirdgroup.fi) — verejne píšu, že radi spolupracujú na nekomerčných adaptáciách, a majú najlepšie zdokumentovanú metodiku šedej zóny (PDF u ACLED); (4) Project Owl (UAControlMap) cez Discord — KMZ je voľne stiahnuteľné denne, ale bez akejkoľvek licencie; (5) jediný dnes plne licenčne čistý strojový zdroj je Wikipedia (CC BY-SA 4.0): Lua modul s bodmi sídiel (nie polygóny) + Commons SVG s polygónmi (treba georeferencovať; share-alike na derivát). GITHUB DERIVÁTY (cyterat/lazar-bit mirror DeepState, longlinecode feed s Cesium adaptérom) sú aktívne (push dnes 2026-09-19), ale licenčne sivé — mirror maskuje User-Agent, longlinecode navyše rekonštruuje ISW; použiteľné ako referenčná implementácia a núdzový zdroj s poctivým labelom 'podľa DeepState cez mirror'. DeepState API som ZÁMERNE nevolal (licencia gate) — endpoint /api/history/last je doložený zo skriptu mirroru a dnešným pushom. SLEPÉ ULIČKY: liveuamap.com (/about, /terms, me.liveuamap.com) = HTTP 403 pre fetch, ceny len zo snippetu; uacontrolmap.com root = JS redirect, /about/ a /map/ = 404; Google My Maps viewer stránka > 10 MB (limit WebFetch); militaryland.net/copyright/ = 404; soar.earth → soaratlas.com = 403 (licenčné pole War Mapper máp neoverené); api.deepstatemap.live/request = SPA bez obsahu; Mastodon profily sa dajú čítať cez /api/v1/accounts/lookup?acct=… (nie HTML); ACLED EULA (samostatný dokument) som nečítal; Commons Data: namespace nemá žiadny .map GeoJSON kontroly územia; vyhľadávanie AGOL (search REST) nenašlo ŽIADNU otvorene licencovanú vrstvu kontroly — len ISW (exclusive IP) a kópie tretích strán s nejasným pôvodom (UNICEF 'Ukraine_Front_Line_NEW' modified 2024-05, UNHCR 'Frontline_12_08_2026' pod COD/FOD terms, 'movie-ops' júl 2026 s atribúciou Al Jazeera/Wikipedia/CFR) — do zoznamu som ich nedal. Ďalšie nájdené, ale nezaradené: playframap.github.io (infiltračná heatmapa v7.10, front 'almost fully taken from @DeepStateUA', WIP, bez licencie), ukrdailyupdate.com (Google My Maps, bez podmienok), ihorbach/ukraine-territory-trend (štatistiky km² z mirroru), Kaggle kópia DeepState datasetu, Esri hub kópia ISW web mapy (gissal_admin). Vedľajší efekt: WebFetch si PDF metodiky BBG (56,7 kB) uložil do tool-results priečinka relácie — nebolo to zámerné sťahovanie, prečítal som ho na mieste. Ruské/proruské mapy (Rybar a pod.) som vedome nehľadal — propaganda, mimo etickej čiary projektu.

## B. Spravodajské a oficiálne kanály (RSS, hlásenia GŠ, RU protistrana, sankcie EÚ)

Zdrojov: 15.

### The Kyiv Independent — RSS (Ghost)

- URL: https://kyivindependent.com/news-archive/rss/
- Druh / formát / prístup: news · RSS 2.0 (generator Ghost 5.39), položky s <media:content> obrázkom, plný text v content:encoded · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear — web nemá verejné ToS; syndikácia je platená: PDF „Content Licensing and Syndication“ uvádza „Individual Article/Material $ 399 … Multiple Articles (up to 20) $ 2,799 … Video Licensing $ 3,999“ a „For monthly and recurring content syndication/licensing subscriptions, please contact us at partnerships@kyivindependent.com“. Feed sám licenčný element nemá (copyright element: none).
- Licencia URL: https://kyivindependent.com/assets/files/Syndication_and_Content_Licensing_from_The_Kyiv_Independent.pdf
- Atribúcia: „The Kyiv Independent“ + odkaz na článok (kyivindependent.com)
- Aktualizácia: viackrát denne (19. 9. 2026: položky 07:55, 09:27, 11:00 GMT; 16 položiek vo feede)
- Pokrytie: celá Ukrajina, EN, vojna + politika; najznámejší nezávislý EN zdroj (70 % príjmov z členstva/darov podľa /about/)
- Riziká / poznámky: Feed nesie PLNÝ TEXT — nikdy ho nerenderovať, iba titulok + perex + odkaz + obrázok z media:content (og:image netreba scrapovať). Plné preberanie = platená syndikácia. Feed nie je na /rss/ ani /feed/ (obe 404) — jediná fungujúca cesta je /news-archive/rss/. Bez súradníc — geokódovať z textu.
- Dôkazy:
  - https://kyivindependent.com/news-archive/rss/
  - https://feeder.co/discover/7b2eb30d1a/kyivindependent-com
  - https://kyivindependent.com/about/
  - https://kyivindependent.com/assets/files/Syndication_and_Content_Licensing_from_The_Kyiv_Independent.pdf

### Ukrinform (štátna tlačová agentúra) — RSS EN, rubrika War

- URL: https://www.ukrinform.net/rss/rubric-ato
- Druh / formát / prístup: news · RSS 2.0, každá položka má <enclosure> JPEG; druhý feed „Latest news“ https://www.ukrinform.net/rss/block-lastnews · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Pätička ukrinform.net: „While citing and using any materials on the Internet, links to the website ukrinform.net not lower than the first paragraph are mandatory. In addition, citing the translated materials of foreign media outlets is possible only if there is a link to the website ukrinform.net and the website of a foreign media outlet.“ + „© 2015-2026 Ukrinform. All rights reserved.“ Osobitné podmienky pre RSS nenájdené.
- Licencia URL: https://www.ukrinform.net/
- Atribúcia: hyperlink na ukrinform.net „not lower than the first paragraph“ (t. j. odkaz priamo pri titulku karty)
- Aktualizácia: priebežne, desiatky denne (19. 9. 2026 13:45, 12:55, 12:05 +0300; 32–33 položiek)
- Pokrytie: celý front, EN; rubrika War (rubric-ato) prepisuje aj denné hlásenia Generálneho štábu (napr. „Ukraine's Defense Forces destroy over 50,000 Russian artillery systems“) — praktická EN cesta k oficiálnym hláseniam
- Riziká / poznámky: Štátna agentúra = vládna línia (označiť „oficiálna UA“). Obrázky v enclosure — pätička ich výslovne nerieši (fotoagentúry?), radšej len titulok+odkaz alebo obrázok s atribúciou. /rss (index) vracia 404 — feedy sú len na /rss/block-lastnews a /rss/rubric-<rubrika>.
- Dôkazy:
  - https://www.ukrinform.net/rss/rubric-ato
  - https://www.ukrinform.net/rss/block-lastnews
  - https://www.ukrinform.net/
  - https://www.ukrinform.net/info/services.html

### Ukrainska Pravda — RSS EN

- URL: https://www.pravda.com.ua/eng/rss/view_news/
- Druh / formát / prístup: news · RSS 2.0, <language>en</language>, <ttl>60</ttl>, položky s <enclosure> JPEG a <img> v obsahu; ďalšie feedy: /eng/rss/, /eng/rss/view_mainnews/, /eng/rss/view_pubs/ · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Stránka RSS feeds: „The use of site materials is allowed only with a reference (for online publications — a hyperlink) to 'Ukrainska Pravda' no lower than the third paragraph.“ Výnimky: „Any copying, publication, reprinting, or further distribution of information containing a reference to 'Interfax-Ukraine' is strictly prohibited.“ a „Any copying, reprinting, or reproduction of photographic works and/or audiovisual works owned by Getty Images is strictly prohibited.“
- Licencia URL: https://www.pravda.com.ua/eng/rss-info/
- Atribúcia: hyperlink „Ukrainska Pravda“ pri karte
- Aktualizácia: priebežne (19. 9. 2026 12:31, 12:43, 12:58 +0300; 20 položiek, ttl 60 min)
- Pokrytie: celý front, EN preklady; veľa lokálnych správ o útokoch (Nikopol, Charkovská obl.) — dobré na kotvenie na mape
- Riziká / poznámky: Položky s „Interfax-Ukraine“ v texte sa nesmú šíriť — filtrovať. Obrázky od Getty zakázané — enclosure nebrať slepo (bezpečnejšie bez obrázka). Uvedená angličtina má miestami hovorové názvy oblastí.
- Dôkazy:
  - https://www.pravda.com.ua/eng/rss-info/
  - https://www.pravda.com.ua/eng/rss/view_news/

### RFE/RL (Radio Free Europe/Radio Liberty) — RSS „Ukraine“ EN

- URL: https://www.rferl.org/api/zviipl-vomx-tpeugmm
- Druh / formát / prístup: news · RSS 2.0 (copyright „Copyright 2026 - RFE/RL, Inc.“), položky s <enclosure> JPEG/PNG; ďalšie feedy: „Russia Invades Ukraine“ https://www.rferl.org/api/zbgvmtl-vomx-tpeq_kmr, „Russia“ https://www.rferl.org/api/zpiirl-vomx-tpe_gmr, „Wider Europe“ https://www.rferl.org/api/zkvtmvl-vomx-tpejqgmt · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Use Our Content: „RFE/RL welcomes the reuse, republication, and redistribution of text-based content published on its digital platforms“; „The sale of RFE/RL content is prohibited.“; „The use of RFE/RL content in advertisements or endorsements is prohibited.“; „The use of RFE/RL content to train artificial intelligence (AI) systems is prohibited.“; výňatky: „When using excerpts of RFE/RL text content, we require that you note that the material is an excerpt and link to the original content“; FOTO VYLÚČENÉ: „No broadcast, rebroadcast, or other use of streamed or on-demand audio and video, graphic, or photo content...is permitted without the express, written authorization“. RFE/RL si vyhradzuje právo povolenie odvolať.
- Licencia URL: https://pressroom.rferl.org/use-our-content/
- Atribúcia: pri výňatku: označiť ako výňatok + odkaz na rferl.org; pri plnom texte: „Copyright (c)2025 RFE/RL, Inc. Used with the permission of Radio Free Europe/Radio Liberty“ + trvalý odkaz pred textom
- Aktualizácia: denne, viac položiek (18.–19. 9. 2026; 20 položiek)
- Pokrytie: Ukrajina + Rusko, EN, silná regionálna sieť; menej „mikro“ frontových udalostí, viac politika/analýza
- Riziká / poznámky: Enclosure obrázky vo feede SÚ, ale politika ich bez písomného súhlasu zakazuje → karty RFE/RL bez obrázka. Feed URL sú nečitateľné /api/ identifikátory — držať ich v konfigurácii s menom. Financované USAGM (vláda USA) — označiť.
- Dôkazy:
  - https://www.rferl.org/rssfeeds
  - https://www.rferl.org/api/zviipl-vomx-tpeugmm
  - https://pressroom.rferl.org/use-our-content/

### Радіо Свобода (RFE/RL ukrajinská redakcia) — RSS „Війна“

- URL: https://www.radiosvoboda.org/api/zijqpql-vomx-tpem_ppo
- Druh / formát / prístup: news · RSS 2.0 (copyright „Copyright Радіо Свобода 2026 - RFE/RL, Inc.“), <enclosure> JPG/PNG; ďalšie: Новини https://www.radiosvoboda.org/api/zrqitl-vomx-tpeoumq, Донбас https://www.radiosvoboda.org/api/z_rppyl-vomx-tpevt_pv, Крим https://www.radiosvoboda.org/api/zbypmil-vomx-tpeqqymi · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): tá istá politika RFE/RL ako vyššie (text áno s odkazom, predaj/reklama/AI zakázané, foto/video len s písomným súhlasom)
- Licencia URL: https://pressroom.rferl.org/use-our-content/
- Atribúcia: „Радіо Свобода / RFE/RL“ + odkaz; výňatok označiť ako výňatok
- Aktualizácia: denne (19. 9. 2026 07:30, 11:00 +0300; 20 položiek)
- Pokrytie: ukrajinsky; frontové reportáže (napr. trasa „Novorosija“, Čierne more), Donbas, Krym — bližšie k terénu než EN feedy
- Riziká / poznámky: Ukrajinčina → treba preklad (OKO má /api/translate MyMemory) a latinizáciu názvov. Bez obrázkov (fotoklauzula). Feed /rssfeeds stránka neuvádza URL v čistom texte — vyššie uvedené /api/ reťazce sú z href atribútov.
- Dôkazy:
  - https://www.radiosvoboda.org/rssfeeds
  - https://www.radiosvoboda.org/api/zijqpql-vomx-tpem_ppo
  - https://pressroom.rferl.org/use-our-content/

### Deutsche Welle — RSS EN (všetko / Európa)

- URL: https://rss.dw.com/rdf/rss-en-all
- Druh / formát / prístup: news · RDF (RSS 1.0), ~150 položiek, bez obrázkov v položkách; Európa: https://rss.dw.com/rdf/rss-en-eu, top: https://rss.dw.com/rdf/rss-en-top · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear — feed nemá copyright element; Legal notice (dw.com/en/legal-notice/a-63500643) neobsahuje žiadne podmienky použitia obsahu; stránka s podmienkami RSS sa nenašla
- Licencia URL: https://www.dw.com/en/legal-notice/a-63500643
- Atribúcia: „Deutsche Welle (DW)“ + odkaz na dw.com
- Aktualizácia: priebežne (19. 9. 2026 09:14, 09:40 UTC)
- Pokrytie: celosvetové, EN; Ukrajina len ako podmnožina → nutný filter kľúčových slov (Ukraine/Kyiv/Russia…)
- Riziká / poznámky: dw.com aj rss.dw.com blokujú crawler Anthropicu (overené len cez proxy r.jina.ai) — server OKO by mal prejsť, ale sledovať 403. Bez obrázkov vo feede → og:image treba scrapovať zo stránky (podmienky neznáme). Verejnoprávny nemecký vysielateľ — nízke riziko propagandy.
- Dôkazy:
  - https://r.jina.ai/https://rss.dw.com/rdf/rss-en-all
  - https://feeder.co/discover/19f617f03b/dw-com-english-maca-en-rss-en-all-1573-rdf
  - https://www.dw.com/en/legal-notice/a-63500643

### BBC News — RSS Europe + téma „War in Ukraine“

- URL: https://feeds.bbci.co.uk/news/topics/c1vw6q14rzqt/rss.xml
- Druh / formát / prístup: news · RSS 2.0, 25 položiek; Európa: https://feeds.bbci.co.uk/news/world/europe/rss.xml; (v pilote ZÁLIV už používané) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): BBC News RSS help (news/10628494): „The attribution text should read 'BBC News' or 'bbc.co.uk/news' as appropriate.“; „You may not use any BBC logo or other BBC trademark.“; „The BBC does not accept any liability for its feeds.“; „We reserve the right to prevent the distribution of BBC News content.“ Sharing page: „You'll need to get our permission first for any business use, and you might have to pay a fee.“; zakázané: „put ads adjacent to shareables, or create services containing only BBC content“.
- Licencia URL: https://www.bbc.co.uk/news/10628494
- Atribúcia: „BBC News“ (text, bez loga) + odkaz
- Aktualizácia: priebežne (18. 9. 2026 17:33, 22:05, 23:03 GMT)
- Pokrytie: téma c1vw6q14rzqt = stránka s nadpisom „War in Ukraine“ (overené cez proxy 19. 9. 2026); Europe feed = celá Európa
- Riziká / poznámky: bbc.co.uk / bbc.com / feeds.bbci.co.uk blokujú crawler Anthropicu (overené len cez proxy; ZÁLIV pilot ich už sťahuje zo servera OKO). ID témy nie je oficiálne dokumentované — môže sa zmeniť. Nekomerčné/osobné použitie; nevytvárať službu „len z BBC“. Obrázky: media:thumbnail v proxy výstupe nevidno — brať iba og:image, ak vôbec.
- Dôkazy:
  - https://r.jina.ai/https://feeds.bbci.co.uk/news/topics/c1vw6q14rzqt/rss.xml
  - https://r.jina.ai/https://www.bbc.co.uk/news/topics/c1vw6q14rzqt
  - https://r.jina.ai/https://www.bbc.co.uk/news/10628494
  - https://r.jina.ai/https://www.bbc.co.uk/usingthebbc/terms/can-i-share-things-from-the-bbc

### Al Jazeera English — RSS (všetko)

- URL: https://www.aljazeera.com/xml/rss/all.xml
- Druh / formát / prístup: news · RSS 2.0, 26 položiek, copyright „© 2026 Al Jazeera Media Network“, bez obrázkov v položkách (v pilote ZÁLIV už používané) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Terms and Conditions: „In accessing the Service you agree that you do so only for your own personal, non-commercial use.“; „You shall not authorise, encourage, permit or assist any unauthorised copying, text or data mining, or web scraping, in relation to the Service.“; „If you create links to this Service, such links must be direct to any complete content page or screen (and not any part of a page or any individual element of content).“
- Licencia URL: https://www.aljazeera.com/terms-and-conditions/
- Atribúcia: „Al Jazeera“ + priamy odkaz na celý článok
- Aktualizácia: priebežne (19. 9. 2026: „Russia kills eight people in Ukraine, attacks two vessels in Black Sea“)
- Pokrytie: celosvetové; Ukrajina ~3 z 26 položiek → filter kľúčových slov; žiadny samostatný Ukraine feed
- Riziká / poznámky: Sťahovanie og:image zo stránky článku je v napätí s klauzulou o „web scraping“ — pre AJ radšej karta bez obrázka alebo len z feedu (ktorý obrázky nemá). Odkaz musí ísť na celú stránku (nie na obrázok).
- Dôkazy:
  - https://www.aljazeera.com/xml/rss/all.xml
  - https://www.aljazeera.com/terms-and-conditions/

### Generálny štáb ZSU — oficiálne správy (web + Telegram)

- URL: https://www.zsu.gov.ua/en/news
- Druh / formát / prístup: official-report · HTML (bez RSS); Telegram verejný náhľad https://t.me/s/GeneralStaffZSU (ukrajinsky, denné operatívne hlásenie so smermi Lyman/Pokrovsk, straty); X @GeneralStaffUA; Facebook GeneralStaff.ua · **scrape-only**
- Strojovo čitateľné: nie
- Licencia (doslovne): zsu.gov.ua/en/news (pätička, cez proxy): „All content is available under the Creative Commons Attribution 4.0 International license unless otherwise noted“
- Licencia URL: https://www.zsu.gov.ua/en/news
- Atribúcia: „Генеральний штаб ЗСУ / General Staff of the Armed Forces of Ukraine“ + odkaz (CC BY 4.0)
- Aktualizácia: denne 1–3 správy na webe EN (19. 9. 2026 13:00; 18. 9. 12:30; 17. 9. 3×); Telegram: denné hlásenie ~06:00 + priebežne (19. 9. 2026 05:59, 09:01, 10:01)
- Pokrytie: celý front, oficiálne UA hlásenia — smery útokov (Lymanský, Pokrovský…), počty stretov, údery hlboko v RU; web EN nesie skôr úderové správy, denné „situácia k 06:00“ je na Telegrame/Facebooku a v EN prepise Ukrinformu (rubric-ato)
- Riziká / poznámky: Priamy fetch zsu.gov.ua vrátil HTTP 403 (bot-ochrana) — prešlo len cez proxy; server OKO môže byť blokovaný (skúsiť UA hlavičku, inak brať cez Ukrinform). Telegram nemá RSS/JSON bez bot tokenu; t.me/s/ je HTML náhľad (nestabilná štruktúra), oficiálne existuje embed widget: „You can embed messages from public groups and channels anywhere.“ (core.telegram.org/widgets/post). Facebook sa scrapovať nesmie. Počty strát sú jednostranné tvrdenia — označiť „tvrdí UA“. Smery = pevné kotvy na mape (Lyman, Pokrovsk…), nie súradnice.
- Dôkazy:
  - https://r.jina.ai/https://www.zsu.gov.ua/en/news
  - https://t.me/s/GeneralStaffZSU
  - https://core.telegram.org/widgets/post
  - https://www.ukrinform.net/rss/rubric-ato

### Ministerstvo obrany Ukrajiny + ArmyInform (agentúra MO) — RSS

- URL: https://armyinform.com.ua/en/feed/
- Druh / formát / prístup: official-report · WordPress RSS 2.0 (en-GB, 10 položiek; UA verzia https://armyinform.com.ua/feed/ 10 položiek, generator WordPress 6.7.7), bez obrázkov (len video enclosure); mod.gov.ua/en/news = HTML bez RSS; Telegram https://t.me/s/ministry_of_defense_ua; X @DefenceU · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): mod.gov.ua: „Content is available under the Creative Commons Attribution 4.0 International license, unless otherwise stated.“ ArmyInform Terms of Use: „The use of works published on the Website is permitted provided that a mandatory reference is included (for Internet resources — a direct hyperlink not closed for indexing by search engines) to the News Agency (ArmyInform).“ + „All exclusive economic and moral copyrights to works belong to the News Agency or the Ministry of Defense of Ukraine, unless otherwise stated.“ (pätička: Creative Commons Attribution 4.0)
- Licencia URL: https://armyinform.com.ua/en/terms-of-use/
- Atribúcia: „ArmyInform“ resp. „Ministry of Defence of Ukraine“ + priamy indexovateľný hyperlink (bez rel=nofollow!)
- Aktualizácia: UA feed viackrát denne (19. 9. 2026 10:33–10:56 UTC); EN feed zaostáva (posledné 16. 9. 2026)
- Pokrytie: oficiálne MO: údery na RU infraštruktúru (rafinérie), brigády, dodávky; menej „front po smeroch“ než Generálny štáb
- Riziká / poznámky: EN feed meškavý o dni — pre kartičky brať UA feed + preklad. Odkaz musí byť „not closed for indexing“ — nepoužívať nofollow. Fotky „unless otherwise stated“ — bez obrázkov. Oficiálny zdroj = jednostranný, označiť.
- Dôkazy:
  - https://armyinform.com.ua/en/feed/
  - https://armyinform.com.ua/feed/
  - https://armyinform.com.ua/en/terms-of-use/
  - https://mod.gov.ua/en/news
  - https://t.me/s/ministry_of_defense_ua

### ISW — Russian Offensive Campaign Assessment (denné hodnotenie)

- URL: https://understandingwar.org/research/russia-ukraine/
- Druh / formát / prístup: other · HTML only — žiadne RSS (/feed/ 404, /?feed=rss2 a //feeds/posts/default vracajú HTML, starý Blogger feed iswresearch.org presmeruje na HTML). Predvídateľný vzor URL: https://understandingwar.org/research/russia-ukraine/russian-offensive-campaign-assessment-september-18-2026/ · **scrape-only**
- Strojovo čitateľné: nie
- Licencia (doslovne): „©2026 INSTITUTE FOR THE STUDY OF WAR. ALL RIGHTS RESERVED.“ Fair Use and Attribution Policy povoľuje „viewing and sharing materials in their published form for non-commercial, informational or media purposes“ a „quoting or excerpting text with appropriate attribution“; zakazuje „alter or remove ISW's logos, credit lines, or disclaimers“ a „redistribute ISW Materials to third parties in bulk, via API, or through automated means“; mapy a snímky sú „the exclusive property of ISW“; shapefiles/datasets len s písomným súhlasom.
- Licencia URL: https://understandingwar.org/fair-use-and-attribution-policy/
- Atribúcia: „Source: Institute for the Study of War“ + odkaz na www.understandingwar.org
- Aktualizácia: denne (16., 17., 18. 9. 2026 overené), typicky večer US času
- Pokrytie: celý front, EN, syntéza po smeroch (Lyman, Pokrovsk…) — presne štýl vzorovej mapy; mapy ISW však NESMIEME preberať
- Riziká / poznámky: Klauzula „automated means“ → iba 1 karta denne: titulok + odkaz + krátky výňatok, žiadne mapy/obrázky, žiadne hromadné preberanie. URL možno skladať z dátumu bez scrapovania indexu (over existenciu HEAD-om). Tento zdroj je vhodnejší pre UHOL 1/2 (front, metodika) než pre spravodajské karty.
- Dôkazy:
  - https://understandingwar.org/
  - https://understandingwar.org/research/russia-ukraine/
  - https://understandingwar.org/fair-use-and-attribution-policy/
  - https://understandingwar.org/feed/

### TASS (EN) — RSS ako „tvrdí Rusko“

- URL: https://tass.com/rss/v2.xml
- Druh / formát / prístup: news · RSS 2.0, 100 položiek, copyright element „TASS“, bez obrázkov v položkách · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear — podmienky použitia tass.com neoverené (nefetchované). EÚ: TASS NIE JE v prílohe XV nar. 833/2014 (zoznam ANCOM z 21. 3. 2025: „Russia Today and Sputnik, with all their subsidiaries, RTR Planeta, Russia 24, TV Centre International, NTV Mir, Rossiya 1, REN TV, Pervyi Kanal, Oriental Review, Tsargrad, New Eastern Outlook, Katehon, Voice of Europe, RIA Novosti, Izvestija, Rossiiskaja Gazeta, EADaily/ Eurasia Daily, Fondsk, Lenta, NewsFront, RuBaltic, SouthFront, Strategic Culture Foundation and Krasnaya Zvezda/ Tvzvezda“); v 16. balíku (Covington) pribudli len „EADaily / Eurasia Daily, Fondsk, Lenta, NewsFront, RuBaltic, SouthFront, Strategic Culture Foundation, and Krasnaya Zvezda / Tvzvezda“ — TASS bol v návrhu (euobserver) a vypadol; 18. a 19. balík bez mediálnych položiek (Mayer Brown), 20. balík (apríl 2026) len „list-based broadcasting bans have been extended to cover any online content of mirror entities“.
- Licencia URL: https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/
- Atribúcia: „TASS (ruská štátna agentúra) — tvrdenie ruskej strany“ + odkaz
- Aktualizácia: priebežne, 100 položiek vo feede (napr. „Kiev loses over 1,340 troops along engagement line in past day — Russia's top brass“)
- Pokrytie: prepis hlásení ruského MO (straty, „oslobodené“ obce), EN; použiteľné len ako protistrana k UA hláseniam
- Riziká / poznámky: Štátna propaganda — vždy štítok „tvrdí RU“, nikdy LIVE/„fakt“. Právne dnes citovateľné v EÚ, ale Komisia (FAQ Q5) povoľuje výňatky len „in an objective way, to inform readers/viewers objectively“; status sa môže zmeniť ďalším balíkom (21. balík v príprave) → pred spustením a potom pravidelne kontrolovať konsolidovanú prílohu XV a prílohu I nar. 269/2014 (asset freeze TASS neoverený). Feed bez obrázkov — og:image z tass.com nescrapovať.
- Dôkazy:
  - https://tass.com/rss/v2.xml
  - https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/
  - https://www.cov.com/en/news-and-insights/insights/2025/02/new-eu-and-uk-sanctions-targeting-russia-and-belarus
  - https://euobserver.com/36232/new-eu-sanctions-to-strike-at-russias-tass-news-agency/
  - https://www.mayerbrown.com/en/insights/publications/2026/04/eu-adopts-20th-package-against-russia-and-parallel-sanctions-on-belarus
  - https://www.mayerbrown.com/en/insights/publications/2025/10/eu-adopts-19th-package-against-russia-and-parallel-sanctions-on-belarus
  - https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf

### RIA Novosti / RT / Sputnik / Zvezda / Lenta … — NEPOUŽÍVAŤ (príloha XV, zákaz vysielania v EÚ)

- URL: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350
- Druh / formát / prístup: news · n/a (weby/RSS existujú, ale v EÚ ich obsah nemožno šíriť) · **unclear**
- Strojovo čitateľné: nie
- Licencia (doslovne): Čl. 2f nar. 833/2014: „It shall be prohibited for operators to broadcast or to enable, facilitate or otherwise contribute to broadcast, any content by the legal persons, entities or bodies listed in Annex XV, including through transmission or distribution by any means such as cable, satellite, IP-TV, internet service providers, internet video-sharing platforms or applications, whether new or pre-installed.“ FAQ Komisie (stav 17. 7. 2026), Q2: „It should be understood as transmitting, disseminating or distributing any type of content in the broadest possible meaning (long videos, short video extracts, news items, radio etc.) to an audience regardless of the means of transmission, dissemination or distribution (including online).“ Q4: „it also applies to, for instance, caching services, search engines, social media or hosting service providers“. Q6 (rozsudok C‑67/25 Traugott Ickeroth): operátor je „any natural or legal person directly or indirectly responsible for making available or transmitting that content to the public“ … „irrespective of whether or not the activity (of such an operator) is economic in nature“ … „including in the context of a non-remunerated activity or in the operation of a website, enabling such broadcasting, which is financed by voluntary contributions from third parties“. Jediná výnimka Q5: „extracts from targeted entities may be used by other operators in an objective way, to inform readers/viewers objectively and completely by illustrating the type of information given by the targeted outlets.“ Recitál 11 nar. 2022/350: opatrenia „do not prevent those media outlets and their staff from carrying out other activities in the Union than broadcasting, such as research and interviews.“ RIA Novosti, Izvestia, Rossiyskaya Gazeta, Voice of Europe: rozhodnutie Rady 17. 5. 2024 („suspend the broadcasting activities“).
- Licencia URL: https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf
- Atribúcia: —
- Aktualizácia: —
- Pokrytie: —
- Riziká / poznámky: KĽÚČOVÉ: nekomerčný status OKO NIE JE obrana — Súdny dvor (C‑67/25) a FAQ Q6 výslovne zahŕňajú bezodplatné weby. Preberanie titulkov/textov/obrázkov z RIA, RT, Sputnik, Zvezda, Lenta, NewsFront, SouthFront atď. na oko.uhrin.digital (EÚ hosting, SK prevádzkovateľ) = porušenie čl. 2f; aj samotný link-out je sivá zóna („enable, facilitate“). Odporúčanie: úplne vylúčiť z ingestu aj z allowlistu odkazov; ruskú stranu pokryť iba TASS (text) a/alebo Telegramom MO RF po overení prílohy I 269/2014.
- Dôkazy:
  - https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350
  - https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf
  - https://www.eeas.europa.eu/delegations/ukraine/russia%E2%80%99s-war-aggression-against-ukraine-council-bans-broadcasting-activities-european-union-four_en
  - https://euromaidanpress.com/2024/05/17/eu-council-bans-russias-ria-novosti-izvestia-rossiyskaya-gazeta-and-medvedchuks-voice-of-europe/
  - https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/

### Rybar (Рыбарь) — Telegram; kto to je a prečo NIE

- URL: https://t.me/s/rybar
- Druh / formát / prístup: news · Telegram verejný náhľad (HTML), 1,55 M odberateľov, ruština, príspevky s mapami/infografikou; žiadne RSS/API bez bot tokenu · **scrape-only**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (obsah Rybar LLC, žiadne podmienky nenájdené). Opis kanála: „Военно-аналитический центр. Вылавливаем интересную нам тему в море сырой информации и пишем о сложном просто.“ Sankčné postavenie zakladateľa: EÚ 23. 6. 2023 (nar. 269/2014, asset freeze) — odôvodnenie: „he is known as the creator of the pro-Russian military Telegram channel 'Rybar' reporting on Russian war efforts and Ukrainian military positions, as well as distributing disinformation and pro-Kremlin propaganda about the war.“; Ukrajina 15. 1. 2023; UK 10. 12. 2025 („Zvinchuk is the director general of Rybar LLC, which runs the influential pro-war 'Rybar' Telegram channel that provides battlefield updates and narratives aligned with the Kremlin.“ — OCCRP).
- Licencia URL: https://sanctions-finder.com/sanction/mikhail-sergeevich-zvinchuk-1/Mikhail%20Sergeevich%20ZVINCHUK
- Atribúcia: — (neodporúčané)
- Aktualizácia: viackrát denne (18. 9. 2026 3 príspevky)
- Pokrytie: celý front z ruskej strany, mapy smerov, ruština; podľa Wikipédie/The Bell: Zvinčuk „worked in the press service of the Russian Ministry of Defense“ (Sýria), „Prigozhin allocated funding to the Telegram channel“
- Riziká / poznámky: Sankcionovaná osoba v EÚ → FAQ Komisie Q11: „making available or broadcasting music, video or other content produced by listed persons, even if this is done for free, creates visibility for these persons … Therefore, this can amount to making economic resources available to the listed persons.“ Embedovanie/preberanie príspevkov Rybar na EÚ webe = riziko porušenia nar. 269/2014, nezávisle od nekomerčnosti. Navyše mapy Rybar sú vlastníctvom Rybar LLC a propagandistický „claimed“ zdroj s väzbou na MO RF. Odporúčanie: nevkladať do OKO vôbec; ak treba „RU tvrdí“, použiť TASS/MO RF text.
- Dôkazy:
  - https://t.me/s/rybar
  - https://en.wikipedia.org/wiki/Mikhail_Zvinchuk
  - https://sanctions-finder.com/sanction/mikhail-sergeevich-zvinchuk-1/Mikhail%20Sergeevich%20ZVINCHUK
  - https://www.occrp.org/en/news/uk-sanctions-pro-kremlin-dugin-rybar-and-pravfond-network
  - https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf

### Ministerstvo obrany RF — Telegram (protistrana „tvrdí RU“)

- URL: https://t.me/s/mod_russia
- Druh / formát / prístup: official-report · Telegram verejný náhľad (HTML), 651 000 odberateľov, ruština; denné súhrny s tvrdenými obsadenými obcami (napr. „Zelena Dibrova“, „220+ settlements“); žiadne RSS; oficiálny web mil.ru · **scrape-only**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear — podmienky nenájdené; opis kanála: „Официальный канал Минобороны России“
- Atribúcia: „Minoborony RF — tvrdenie ruskej strany“ + odkaz
- Aktualizácia: denne, viac príspevkov (september 2026)
- Pokrytie: celý front z ruskej strany, mená obcí (cyrilika → latinize.js), tvrdené kilometre štvorcové
- Riziká / poznámky: Pred použitím OVERIŤ, či MO RF (ako subjekt) nie je v prílohe I nar. 269/2014 — ak áno, platí FAQ Q10/Q11 (šírenie obsahu = sprístupnenie hospodárskych zdrojov) rovnako ako pri Rybarovi; jeho TV kanál Zvezda/Krasnaya Zvezda JE v prílohe XV (zákaz). Ak čisté: iba text „obsadenie X tvrdí RU“ ako bod na mape, bez obrázkov/videí. Scraping t.me/s/ je krehký; oficiálny embed widget existuje.
- Dôkazy:
  - https://t.me/s/mod_russia
  - https://core.telegram.org/widgets/post
  - https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf

**Poznámky nálezcu (notes):** ČO SOM HĽADAL A OVERIL (19. 9. 2026, všetko cez WebSearch/WebFetch, bez registrácie/sťahovania): 10 spravodajských/oficiálnych feedov fetchnutých a validovaných ako RSS s dátumami z 18.–19. 9. 2026 (Kyiv Independent, Ukrinform ×2, Ukrainska Pravda EN, RFE/RL Ukraine, Radio Svoboda Війна, DW cez proxy, BBC cez proxy, Al Jazeera, ArmyInform uk+en, TASS). Podmienky použitia s doslovnými citátmi: UP, Ukrinform (pätička), RFE/RL, BBC (help page + sharing), Al Jazeera, ISW fair-use, ArmyInform/MO UA (CC BY 4.0), zsu.gov.ua (CC BY 4.0), KI (platená syndikácia z PDF), EÚ sankcie (nar. 2022/350 čl. 2f + FAQ Komisie stav 17. 7. 2026 extrahované z PDF cez pdftotext).  KĽÚČOVÝ PRÁVNY NÁLEZ: FAQ Komisie Q6 (aktualizácia 17. 7. 2026, rozsudok SD EÚ C‑67/25 Ickeroth) — „operátor“ podľa čl. 2f zahŕňa aj bezodplatný web financovaný dobrovoľnými príspevkami → nekomerčnosť OKO nechráni pred zákazom šíriť obsah RIA/RT/Sputnik/Zvezda/Lenta atď. Q11 rozširuje riziko na obsah OSÔB na sankčnom zozname (Zvinčuk/Rybar) — aj bezplatné sprístupnenie „can amount to making economic resources available“. TASS v prílohe XV NIE JE (ANCOM 21. 3. 2025, Covington k 16. balíku; 18./19. balík bez médií, 20. balík len „mirror entities“), ale bol v návrhu 2025 — treba periodicky kontrolovať konsolidované znenie 833/2014 (eur-lex.europa.eu/eli/reg/2014/833/2026-04-24/eng) a prílohu I 269/2014; 21. balík je v príprave.  ODPORÚČANÝ MIX PRE KARTY: UA oficiálne = Ukrinform rubric-ato (EN prepis hlásení GŠ, obrázky) + ArmyInform uk feed (CC BY 4.0) + GŠ Telegram len ak treba smery z prvej ruky; nezávislé = Kyiv Independent (media:content obrázky), Ukrainska Pravda EN (filter „Interfax-Ukraine“, bez Getty), Radio Svoboda/RFE-RL (bez obrázkov — fotoklauzula); svetové = BBC téma „War in Ukraine“, DW (filter), AJ (filter, bez og:image scrapingu); RU protistrana = iba TASS text so štítkom „tvrdí RU“ (+ MO RF Telegram po overení prílohy I). ISW = 1 karta denne titulok+odkaz, bez máp (patrí skôr do UHLA 1/2). Existujúce GDELT DOC + Google News RSS z pilota ZÁLIV sa dajú znovu použiť s dopytom „Ukraine“ (tu nepreverované znova).  ČO SOM NENAŠIEL / SLEPÉ ULIČKY: Reuters — RSS zrušené („Reuters officially stopped producing RSS feeds in June 2020“, fivefilters.org), reuters.com pre fetcher blokovaný → vynechať. ISW — žiadne RSS (4 pokusy: /feed/, /?feed=rss2, //feeds/posts/default, starý Blogger feed → všetko HTML); URL denného hodnotenia je však predvídateľné z dátumu. Kyiv Independent /rss/ a /feed/ = 404 (správne /news-archive/rss/). Ukrinform /rss = 404 (správne /rss/block-lastnews, /rss/rubric-ato). zsu.gov.ua = 403 pri priamom fetchi (bot-ochrana), prešlo cez r.jina.ai. consilium.europa.eu = 403/CAPTCHA aj cez proxy → citácie rozhodnutia z 17. 5. 2024 z EEAS a Euromaidan Press. EUR-Lex: 2025/395 bez príloh v HTML, 2023/1216 a 2026/506 vrátili prázdny obsah, Skadden PDF > 10 MB → zloženie prílohy XV z ANCOM + Covington + Mayer Brown. sanctions.nazk.gov.ua = DNS chyba, war-sanctions.gur.gov.ua = 403 → Zvinčuk z sanctions-finder.com (EÚ 23. 6. 2023 s odôvodnením) + Wikipédia (UA 15. 1. 2023) + OCCRP (UK 10. 12. 2025). DW: podmienky použitia obsahu nenájdené (legal notice ich nemá) → unclear; dw.com/rss.dw.com/bbc.co.uk/bbc.com/feeds.bbci.co.uk/reuters.com blokujú crawler Anthropicu (pre server OKO nepodstatné, ZÁLIV už BBC sťahuje). Suspilne: /rss/ 404, /rss/all.rss platné cez proxy (300+ položiek, len ukrajinsky, bez obrázkov, „© АТ «НСТУ» 2026“), priamy fetch 403, EN sekcia bez samostatného feedu, podmienky neoverené → zatiaľ nezaradené. Telegram: bez RSS/API bez bot tokenu, t.me/s/ je HTML náhľad; oficiálny embed widget existuje („You can embed messages from public groups and channels anywhere.“). X (@DefenceU, @GeneralStaffUA) = platené API → neriešené. Súradnice nenesie žiadny feed — kotvenie cez gazetteer/„smery“ ako v hot kartičkách ZÁLIV. Podmienky tass.com nefetchované (unclear).

## C. Udalosti (údery, strety, OSINT geolokácie, poplachy)

Zdrojov: 14.

### ACLED – Ukraine Conflict Monitor / ACLED event data (Ukraine)

- URL: https://acleddata.com/ukraine-conflict-monitor
- Druh / formát / prístup: events · Interaktívna mapa (HTML, verejná); 'curated data file' CSV/XLSX za prihlásením; API JSON (OAuth token 24 h, refresh 14 d) len pre úroveň Research a vyššie · **registration**
- Strojovo čitateľné: áno
- Licencia (doslovne): EULA (nekomerčná, neexkluzívna licencia): "a royalty-free, non-exclusive, non-transferable, non-sublicensable license to use the Licensed Content, and Platforms, and to develop, publish, and distribute materials incorporating the Licensed Content for non-commercial purposes"; externé výstupy musia byť transformatívne: "any materials that Licensor intends to disclose, publish or distribute externally must be transformative, such that they cannot be reverse engineered to recreate the Licensed Content" a "It is not sufficient for Licensed Content to simply be supplemented, appended, excerpted, reorganized, or made available through Licensee's own dashboard."
- Licencia URL: https://acleddata.com/eula
- Atribúcia: "ACLED as the source of the data must be clearly and prominently acknowledged." a "All data visualizations or similar created using ACLED data should include a clear citation on the visualization itself." (Attribution Policy) – citácia priamo vo vizualizácii, odkaz na acleddata.com, dátum prístupu, použité filtre
- Aktualizácia: Týždenne; monitor: "near real-time information on the ongoing war, including an interactive map, a curated data file, and weekly situation updates"; "By default, the map displays data for the most recent week" (posledný update 5–11 September 2026)
- Pokrytie: Celá Ukrajina + Čierne more; udalosti od 24. 2. 2022 (jeden súbor od 2020): boje, údery, ostreľovanie, útoky na infraštruktúru (energetika, zdravotníctvo, školstvo, bývanie), odhady civilných obetí; geokódované na úroveň sídla/mesta s vlastnou stupnicou presnosti geo_precision 1–3
- Riziká / poznámky: Kľúčová prekážka pre OKO: účet s gmail dostane len 'Open myACLED' = "Aggregated Data" ("if a member uses a public, generic email, such as a gmail.com address, they are automatically granted public access"); surové udalosti + API až od úrovne Research ("Aggregated Data + Event Data (lagged)"), ktorú prideľujú organizáciám s inštitucionálnou doménou. Aj s prístupom EULA zakazuje vystaviť surové body na verejnej mape/dashboarde (klauzula o transformatívnosti) a zakazuje scraping/crawling stránky. Analýzy/texty ACLED sa nesmú republikovať. HDX kópia (data.humdata.org/dataset/ukraine-acled-conflict-data) vracia fetcheru 403 – neoverená.
- Dôkazy:
  - https://acleddata.com/eula
  - https://acleddata.com/attributionpolicy
  - https://acleddata.com/ukraine-conflict-monitor
  - https://acleddata.com/myacled-faqs
  - https://acleddata.com/conflict-monitors
  - https://acleddata.com/contentusage

### UCDP Georeferenced Event Dataset (GED 26.1) + UCDP Candidate Events (26.0.x)

- URL: https://ucdp.uu.se/downloads/
- Druh / formát / prístup: events · CSV / XLSX (open download bez registrácie); REST API JSON https://ucdpapi.pcr.uu.se/api/gedevents/<verzia> (stránkované; filter Country=369 pre Ukrajinu, StartDate/EndDate, bbox) – API vyžaduje token · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): "All datasets are free of charge and licensed under CC BY 4.0 — you are free to use and redistribute them provided you cite the relevant publications listed with each dataset."
- Licencia URL: https://ucdp.uu.se/downloads/
- Atribúcia: CC BY 4.0 – citovať publikácie uvedené pri datasete (Sundberg & Melander 2013 pre GED; Hegre et al. 2020 pre Candidate) + „UCDP, Uppsala University“ v UI
- Aktualizácia: GED: ročne (26.1 pokrýva 1989–2025). Candidate: mesačne, „not more than a month's lag globally“ – posledné 26.0.7 (júl 2026) a štvrťročné 26.01.26.06 (január–jún 2026)
- Pokrytie: Globálne vrátane Ukrajiny; len udalosti s aspoň 1 mŕtvym (organizované násilie: state-based, non-state, one-sided). Presnosť polohy where_prec 1–7 z codebooku: "1: exact location of the event known and coded. 2: event occurred within at maximum a ca. 25 km radius around a known point. The coded point is the known point. 3: only the second order administrative division where an event happened is known ... 4: only the first order administrative division ... 6: only the country where the event took place in is known. 7: event in international waters or airspace."
- Riziká / poznámky: API dnes už NIE JE bez kľúča: "To use the API, please contact the API maintainer to request an access token." (hlavička x-ucdp-access-token, "5,000 requests per day. Errors count towards the limit."); živý test https://ucdpapi.pcr.uu.se/api/gedevents/25.1?pagesize=1&Country=369 vrátil HTTP 401 (19. 9. 2026). Riešenie pre OKO: mesačný CSV Candidate stiahnuť skriptom a servírovať ako statický snímok s dátumom. Oneskorenie ~1 mesiac, žiadne nefatálne údery. Staršie stránky tretích strán (DANTE, discuss-data) ešte uvádzajú „non-commercial, no redistribution“ a Zenodo zrkadlo uvádza ODbL – platí aktuálna oficiálna stránka (CC BY 4.0), do DATA_SOURCES.md zapísať s dátumom overenia.
- Dôkazy:
  - https://ucdp.uu.se/downloads/
  - https://ucdp.uu.se/apidocs/
  - https://ucdp.uu.se/downloads/ged/ged251.pdf
  - https://ucdpapi.pcr.uu.se/api/gedevents/25.1?pagesize=1&Country=369
  - https://zenodo.org/records/17397479

### GDELT 2.0 Events + GKG (surové 15-minútové súbory)

- URL: http://data.gdeltproject.org/gdeltv2/lastupdate.txt
- Druh / formát / prístup: events · CSV.zip každých 15 min (export = udalosti CAMEO, mentions, gkg); lastupdate.txt uvádza posledné tri súbory; filtrovanie Ukrajiny cez ActionGeo_CountryCode = 'UP' (FIPS 10-4) a súradnice ActionGeo_Lat/ActionGeo_Long; GKG cez pole Locations. Alternatíva BigQuery (gdelt-bq) – vyžaduje GCP účet · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): "You may redistribute, rehost, republish, and mirror any of the GDELT datasets in any form. However, any use or redistribution of the data must include a citation to the GDELT Project and a link to this website (https://www.gdeltproject.org/)."
- Licencia URL: https://www.gdeltproject.org/about.html
- Atribúcia: „GDELT Project“ + odkaz https://www.gdeltproject.org/
- Aktualizácia: Každých 15 minút (overené: lastupdate.txt 19. 9. 2026 11:15 UTC uvádza 20260919111500.export.CSV.zip, .mentions.CSV.zip, .gkg.csv.zip)
- Pokrytie: Globálne od februára 2015; Ukrajina cez FIPS 'UP'. Geokódovanie je automatické z textu správ (mesto/ADM1/krajina podľa ActionGeo_Type), nie miesto udalosti overené z terénu
- Riziká / poznámky: Hlučné: duplicity, chybné geokódovanie (napr. „Donetsk“ = mesto vs. oblasť), CAMEO kódy z automatického spracovania, obsahuje aj ruskú propagandu ako „udalosti“. Objem veľký (GKG ~3 MB/15 min) – na serveri filtrovať len UP a ukladať agregát. Vhodné na „čo sa píše“ (kartičky správ), nie ako spoľahlivá vrstva úderov.
- Dôkazy:
  - https://www.gdeltproject.org/about.html
  - http://data.gdeltproject.org/gdeltv2/lastupdate.txt
  - http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf

### GDELT GEO 2.0 API / DOC 2.0 API

- URL: https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/
- Druh / formát / prístup: news · GEO: https://api.gdeltproject.org/api/v2/geo/geo?query=...&mode=PointData&format=GeoJSON&timespan=24h (GeoJSON/CSV/RSS/JSONFeed, operátory locationcc:UP, sourcelang:, theme:); DOC: /api/v2/doc/doc (artlist JSON, sourcecountry:UP) · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): Rovnaké podmienky ako GDELT datasety: "any use or redistribution of the data must include a citation to the GDELT Project and a link to this website"
- Licencia URL: https://www.gdeltproject.org/about.html
- Atribúcia: „GDELT Project“ + odkaz na gdeltproject.org
- Aktualizácia: Deklarované každých 15 minút, posuvné okno max. 7 dní
- Pokrytie: Zmienky miest v správach za posledných 7 dní; body = miesta spomenuté v článkoch, nie miesta udalostí
- Riziká / poznámky: GEO endpoint 19. 9. 2026 vracia HTTP 404 (test: /api/v2/geo/geo?query=Ukraine%20strike&mode=PointData&format=GeoJSON&timespan=24h) – zhoduje sa so skúsenosťou zo ZÁLIV pilotu; DOC endpoint vracia 429 pri zaťažení (test artlist sourcecountry:UP) → nutná server-side cache 15 min a záložný RSS, ako už OKO má. Autor sám: "you will almost always see at least some level of error in the results". Nepoužiť ako vrstvu udalostí, len ako doplnok správ.
- Dôkazy:
  - https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/
  - https://api.gdeltproject.org/api/v2/geo/geo?query=Ukraine%20strike&mode=PointData&format=GeoJSON&timespan=24h
  - https://api.gdeltproject.org/api/v2/doc/doc?query=Ukraine%20strike%20sourcecountry:UP&mode=artlist&format=json&maxrecords=3&timespan=1d
  - https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

### Centre for Information Resilience – Eyes on Russia Map (Russia-Ukraine Monitor Map)

- URL: https://www.info-res.org/eyes-on-russia/maps/eyes-on-russia-map/
- Druh / formát / prístup: events · Interaktívna webová mapa (eyesonrussia.org presmerúva na info-res.org); filtre podľa kľúčových slov, dátumu, kategórie (bombing, civilian casualties, infrastructure damage, ground battles, military losses…), sektora a oblasti; žiadny oficiálny export/API – komunitný scraper (GitHub aoc81/eyesonrussia) číta interný endpoint mapy · **scrape-only**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear – na info-res.org sa nenašli podmienky použitia dát ani licencia (len Privacy Policy); stránka mapy neobsahuje 'terms', 'licence' ani 'how to cite'
- Licencia URL: https://www.info-res.org/eyes-on-russia/maps/eyes-on-russia-map/
- Atribúcia: Neuvedená; projekt je „CIR-led effort assisted by the wider open source community“ (Bellingcat, GeoConfirmed, C4ADS) – ak by sa použil, uviesť „Centre for Information Resilience – Eyes on Russia“ a link
- Aktualizácia: Priebežne (bez deklarovanej kadencie); Red Zone Map (drony v Chersonskej oblasti) od januára 2024
- Pokrytie: Overené videá/fotky z celej Ukrajiny od januára 2022; každý záznam má geolokáciu, dátum, kategóriu, sektor a stupeň grafickosti 1–5; podľa metodiky "Any data that enters the CIR database is archived upon entry by an auto-archiver"
- Riziká / poznámky: Bez licencie a bez exportu = pre OKO len odkaz von (link na mapu z kartičky), nie vrstva. Scrapovanie interného endpointu bez súhlasu je riziko ToS a nestability (scraper na GitHube je GPL-3, ale práva k dátam nerieši). Záznamy odkazujú na grafický materiál (stupeň 5) – nikdy neembedovať médiá.
- Dôkazy:
  - https://www.info-res.org/eyes-on-russia/maps/eyes-on-russia-map/
  - https://www.info-res.org/eyes-on-russia/articles/launch-of-the-new-eyes-on-russia-map/
  - https://c4ads.org/news/eyes-on-russia-press-release/
  - https://www.info-res.org/methodology/
  - https://github.com/aoc81/eyesonrussia
  - https://www.info-res.org/privacy-policy/

### Bellingcat – Civilian Harm in Ukraine TimeMap (archív)

- URL: https://ukraine.bellingcat.com/
- Druh / formát / prístup: events · JSON pole záznamov: https://bellingcat-embeds.ams3.cdn.digitaloceanspaces.com/production/ukr/timemap/api.json (1,1 MB); polia id, date, latitude, longitude, location, description, sources[], impact[], weapon_system[], graphic · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear – README repa: "Download/integrate the complete data from here" a "`API_DATA` - S3 file address that can be downloaded or integrated into external apps/visualizations", ale k DÁTAM nie je uvedená licencia; LICENSE.md repa je "Do No Harm License" (platí pre kód TimeMap). Články Bellingcat sú podľa GIJN CC BY-ND 4.0 (sekundárny zdroj, na bellingcat.com sa text 'Creative Commons' nenašiel)
- Licencia URL: https://github.com/bellingcat/ukraine-timemap
- Atribúcia: „Bellingcat – Civilian Harm in Ukraine“ + link na ukraine.bellingcat.com (odporúčané, nie formálne vyžadované)
- Aktualizácia: UKONČENÉ: "The map is no longer being updated, but it remains online as an archive" (Bellingcat, 24. 2. 2026)
- Pokrytie: Deklarovane február 2022 – december 2025, „over 2,500 cases of civilian harm“; v stiahnutom api.json (19. 9. 2026) je 2 517 záznamov s dátumami 2022-02-24 až 2025-07-09 (2022: 1 162, 2023: 487, 2024: 628, 2025: 240). Presnosť: "The resolution of these geolocations is within 150 metres of where the incident occurred but the public coordinates viewable on the map have been slightly obscured in order to protect the identity of the creators."
- Riziká / poznámky: Statický historický snímok (v UI hlásiť „archív do 07/2025“); bez explicitnej dátovej licencie → pred verejným zobrazením napísať Bellingcatu alebo zobrazovať len ako body s odkazom na zdroj. Záznamy s graphic=true nesmú ťahať médiá. Súbor je na CDN bez garancie trvania – uložiť kópiu do .gev-cache.
- Dôkazy:
  - https://github.com/bellingcat/ukraine-timemap
  - https://raw.githubusercontent.com/bellingcat/ukraine-timemap/main/README.md
  - https://raw.githubusercontent.com/bellingcat/ukraine-timemap/main/LICENSE.md
  - https://bellingcat-embeds.ams3.cdn.digitaloceanspaces.com/production/ukr/timemap/api.json
  - https://www.bellingcat.com/news/2026/02/24/how-russias-war-has-devastated-civilian-life-in-ukraine/
  - https://www.bellingcat.com/news/2022/03/17/hospitals-bombed-and-apartments-destroyed-mapping-incidents-of-civilian-harm-in-ukraine/

### GeoConfirmed – verejné REST API (overené OSINT geolokácie, Ukrajina)

- URL: https://geoconfirmed.org/scalar/v1
- Druh / formát / prístup: events · OpenAPI 3.1.1 (Scalar dokumentácia, JSON); server https://geoconfirmed.org; read-only endpointy pre placemarks, ORBAT, gear, conflicts, map metadata (videný napr. GET https://geoconfirmed.org/api/Conflict); QGIS plugin 'geoconfirmed_qgis' s exportom do GeoPackage; mapa Ukrajiny https://geoconfirmed.org/map/ukraine · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): Formálna licencia neuvedená (unclear), ale dokumentácia API: "The dataset is updated continuously and is freely available for research, journalism, and analytical use through this API." a "Public read endpoints — most of what's documented on this page — do not require authentication. You can call them directly from any HTTP client without credentials."
- Licencia URL: https://geoconfirmed.org/scalar/v1
- Atribúcia: Neformalizovaná; uviesť „GeoConfirmed“ + link na placemark; API žiada vlastný User-Agent: "please send a descriptive User-Agent header identifying your tool and — ideally — a way to reach you"
- Aktualizácia: "the data refreshes on the order of minutes, not milliseconds"; "Please respect Cache-Control headers and avoid hammering endpoints"; "If you need near-real-time updates or bulk exports, get in touch"
- Pokrytie: Ukrajina od 2022 (plus Izrael/Gaza, Sudán…): každý placemark = incident overený proti fotke/videu, s dátumom, súradnicami a zdrojom; ORBAT strom (jednotky – pozor na etickú čiaru: zobrazovať len typ udalosti, nie jednotky/osoby)
- Riziká / poznámky: robots.txt má "Disallow: /api/" a "Disallow: /scalar/" (pre crawlery; ľudským klientom API výslovne otvorené) – WebFetch aj MCP fetch dostali 403, stránka sa dala prečítať len v reálnom prehliadači; proxy OKO musí posielať User-Agent „OKO/… (+kontakt)“ a rešpektovať Cache-Control. Tvrdé limity len na /api/token (10/min); starší formát dát sa už zmenil (media-search-engine: "Currently not working due to data format change") → počítať so zmenami schémy. Placemarky odkazujú na sociálne siete s grafickým obsahom.
- Dôkazy:
  - https://geoconfirmed.org/scalar/v1
  - https://geoconfirmed.org/changelog
  - https://plugins.qgis.org/plugins/geoconfirmed_qgis/
  - https://geoconfirmed.org/map/ukraine
  - https://github.com/conflict-investigations/media-search-engine

### VIINA 2.0 – Violent Incident Information from News Articles (Zhukov & Ayers)

- URL: https://github.com/zhukovyuri/VIINA
- Druh / formát / prístup: events · ZIP/CSV v GitHub repe (Data/event_1pd_latest_2026.zip = deduplikované udalosti „one-per-day“, event_info_latest_2026.zip = surové správy s URL, event_labels_latest_2026.zip = klasifikácia; control_latest_2026.zip = kontrola sídiel); GeoJSON mriežky sídiel (gn_UA_tess.geojson, katotth_UA_tess.geojson) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): "VIINA data are made available under the Open Database License (ODbL)."
- Licencia URL: https://raw.githubusercontent.com/zhukovyuri/VIINA/main/README.md
- Atribúcia: "Zhukov, Yuri and Natalie Ayers (2023). VIINA 2.0: Violent Incident Information from News Articles on the 2022 Russian Invasion of Ukraine. Cambridge, MA: Harvard University." + ODbL (share-alike pre odvodené databázy)
- Aktualizácia: "updated daily" – overené commity „Data update“ 18. 9., 15. 9., 13. 9., 11. 9., 9. 9. 2026
- Pokrytie: Celá Ukrajina od 24. 2. 2022; udalosti z ukrajinských a ruských médií geokódované na sídlo s poľom GEO_PRECISION (STREET → CITY → ADM2 → ADM1), časová presnosť na minútu; binárne typy t_airstrike, t_artillery, t_mil… a aktéri a_rus/a_ukr s pravdepodobnosťami
- Riziká / poznámky: Klasifikácia strojovým učením (chyby typu udalosti), zdroje zahŕňajú ruské médiá (propaganda, prekryté tvrdenia) – zobrazovať zdroj a pravdepodobnosť; ODbL share-alike: ak OKO spojí VIINA s inými dátami do vlastnej databázy, tá odvodená DB musí byť pod ODbL (rovnaká pasca ako pri OSM potrubiach – držať ako samostatný súbor). Sťahovanie z GitHubu (raw) denne skriptom na server, nie z prehliadača.
- Dôkazy:
  - https://github.com/zhukovyuri/VIINA
  - https://raw.githubusercontent.com/zhukovyuri/VIINA/main/README.md
  - https://github.com/zhukovyuri/VIINA/tree/main/Data
  - https://github.com/zhukovyuri/VIINA/commits/main

### Ukraine War Archive (ukrainewararchive.org)

- URL: https://ukrainewararchive.org/eng/faq/
- Druh / formát / prístup: other · Uzavretý archív médií a záznamov udalostí; len prezeranie v ich rozhraní po overení; žiadny API ani export · **registration**
- Strojovo čitateľné: nie
- Licencia (doslovne): "Only authorised users have access to the Ukraine War Archive, each and every one of whom is subject to a thorough preliminary verification."; "All materials in the Ukraine War Archive are available for viewing only."; "the content of the Archive may not be copied, reproduced, or publicly displayed without obtaining a separate permission (licence)."
- Licencia URL: https://ukrainewararchive.org/eng/faq/
- Atribúcia: Nepoužiteľné bez individuálnej licencie; "Copyright remains with the copyright holder (partner)."
- Aktualizácia: Priebežne (interné)
- Pokrytie: Denné záznamy potenciálnych vojnových zločinov, médiá z otvorených zdrojov, polohy ruských jednotiek, propaganda – celá Ukrajina od 2022
- Riziká / poznámky: ZAMIETNUŤ pre OKO: prístup cez Google formulár + User Agreement + posudzovanie reputačných rizík, zákaz verejného zobrazenia. Zapísať do DATA_SOURCES.md ako preverený a nepoužitý.
- Dôkazy:
  - https://ukrainewararchive.org/eng/faq/
  - https://ukrainewararchive.org/eng/

### ISW – Russian Offensive Campaign Assessment (denné hlásenia)

- URL: https://www.understandingwar.org/research/russia-ukraine/russian-offensive-campaign-assessment-september-18-2026/
- Druh / formát / prístup: official-report · HTML článok s predvídateľnou URL understandingwar.org/research/russia-ukraine/russian-offensive-campaign-assessment-<month>-<day>-<year>/; sekcie Key Takeaways + osi/smery (Northern Axis, Kharkiv, Oskil River, Fortress Belt, Subordinate Main Effort #1–4, Dnipropetrovsk, Southern Axis, Air/Missile/Drone Campaign) s vetami typu "Geolocated footage published on September 17 showing…"; interaktívne mapy ArcGIS vložené v texte · **scrape-only**
- Strojovo čitateľné: nie
- Licencia (doslovne): Fair Use & Attribution Policy: dovolené "viewing and sharing materials in their published form for non-commercial, informational or media purposes" a "quoting or excerpting text with appropriate attribution"; bez písomného súhlasu zakázané modifikovať, komerčne využívať, redistribuovať, začleniť do iných datasetov/platforiem a "copy or reproduce shapefiles, developer notes, or datasets for any purpose without ISW's written consent"
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Atribúcia: "Source: Institute for the Study of War" (web/tlač), pri videu meno na obrazovke; sociálne siete tag @theStudyofWar
- Aktualizácia: Denne; "Assessment as of: 9:00 PM ET. Data Cutoff: 2:00 PM ET." (report z 18. 9. 2026 existuje; Research Library uvádza posledné položky 18. 9. 2026)
- Pokrytie: Celý front po smeroch, hodnotenie postupov RU/UA z geolokovaných záberov; text nie je geokódovaný ako dáta
- Riziká / poznámky: RSS sa NENAŠIEL: /feed/ a ?feed=rss2 vracajú HTML, /rss.xml 403, /research/russia-ukraine/feed/ 404, starý Blogger feed iswresearch.org/feeds/posts/default presmeruje na HTML knižnicu → len HTML scrape podľa dátumu v URL (server-side, cache 1×/deň). Podľa politiky ISW možno v OKO zobraziť len citát/výňatok s atribúciou a link von; NIE ich mapové vrstvy ani vlastné geokódovanie ich textu ako „ISW dataset“. Pri prekročení citácie hrozí porušenie politiky (kontakt na povolenia je v politike).
- Dôkazy:
  - https://www.understandingwar.org/fair-use-and-attribution-policy/
  - https://www.understandingwar.org/research/russia-ukraine/russian-offensive-campaign-assessment-september-18-2026/
  - https://www.understandingwar.org/
  - https://www.understandingwar.org/feed/
  - https://understandingwar.org//feeds/posts/default

### Generálny štáb ZSU – denná operačná informácia (Telegram + oficiálne zrkadlá ArmyInform / mod.gov.ua)

- URL: https://t.me/s/GeneralStaffZSU
- Druh / formát / prístup: official-report · Telegram verejný web-preview (HTML, scrape); RSS zrkadlo ArmyInform (agentúra MO Ukrajiny) https://armyinform.com.ua/tag/operatyvna-informacziya/feed/ – kanál "Оперативна інформація ЗСУ | АрміяInform", položky napr. "213 боєзіткнень за добу: Генштаб ЗСУ розповів про ситуацію на ключових напрямках" (19. 9. 2026 06:28 UTC); text obsahuje počet bojových stretov za deň a rozpis po smeroch · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): ArmyInform (zriaďovateľ Ministerstvo obrany Ukrajiny): obsah pod Creative Commons Attribution 4.0 International, pri použití povinný odkaz na armyinform.com.ua (pre online médiá priamy hyperlink v prvom odseku). mod.gov.ua pätička: "© 2001–2026 МОУ. Контент доступний за ліцензією Creative Commons Attribution 4.0 International license, якщо не зазначено інше." Telegram kanál sám licenciu neuvádza
- Licencia URL: https://armyinform.com.ua/
- Atribúcia: „Генеральний штаб ЗСУ“ + „АрміяInform (CC BY 4.0)“ s hyperlinkom na konkrétnu správu
- Aktualizácia: Denne 08:00 (a priebežne 16:00/22:00); Telegram 19. 9. 2026 08:00: "Розпочалася 1669-та доба широкомасштабної збройної агресії російської федерації проти України. Загалом протягом минулої доби зафіксовано 213 бойових зіткнень."
- Pokrytie: Celý front po smeroch (19. 9. 2026: Північно-Слобожанський, Курський, Південно-Слобожанський, Куп'янський, Лиманський, Слов'янський, Краматорський, Костянтинівський, Покровський, Олександрівський, Гуляйпільський, Оріхівський, Придніпровський) + počty úderov, KAB, dronov, straty RU. Nie je geokódované – smery treba mapovať na ručný gazetteer (centroid/os smeru), presnosť ~desiatky km
- Riziká / poznámky: Jednostranný oficiálny zdroj (straty protivníka neoveriteľné) – v UI označiť „oficiálne hlásenie UA“; názvy smerov sa menia (napr. Олександрівський/Костянтинівський pribudli) → gazetteer treba udržiavať. Telegram preview môže Telegram kedykoľvek zablokovať pre boty; preferovať RSS ArmyInform (WordPress, overené platné RSS 2.0). Oficiálny web zsu.gov.ua vracia fetcheru 403, mod.gov.ua nemá viditeľný RSS.
- Dôkazy:
  - https://t.me/s/GeneralStaffZSU
  - https://armyinform.com.ua/tag/operatyvna-informacziya/feed/
  - https://armyinform.com.ua/
  - https://mod.gov.ua/news
  - https://armyinform.com.ua/2026/09/19/213-boyezitknen-za-dobu-genshtab-zsu-rozpoviv-pro-sytuacziyu-na-klyuchovyh-napryamkah/

### alerts.in.ua – API leteckých poplachov (oblasti/hromady)

- URL: https://devs.alerts.in.ua/
- Druh / formát / prístup: events · JSON: /v1/alerts/active.json (aktívne poplachy), /v1/iot/active_air_raid_alerts_by_oblast.json, /v1/regions/{uid}/alerts/month_ago.json (história); token v hlavičke · **api-key**
- Strojovo čitateľné: áno
- Licencia (doslovne): Token na žiadosť: "Заповніть форму і ми надішлемо Вам токен"; podmienky: "Не використовуйте API для критичної інфраструктури", vylúčenie zodpovednosti; formálna licencia dát neuvedená (unclear)
- Licencia URL: https://devs.alerts.in.ua/
- Atribúcia: Neformalizovaná – uviesť „alerts.in.ua“ a odkaz (dobrovoľnícky projekt)
- Aktualizácia: Živé (sekundy); limity: mäkký 8–10 req/min/IP, tvrdý 12 req/min/IP (429), história 2 req/min
- Pokrytie: Celá Ukrajina po oblastiach a hromadách; typy poplachov (air_raid, artillery_shelling, urban_fights…) s časom začiatku/konca; polohy = administratívne polygóny (nie body)
- Riziká / poznámky: Vyžaduje registráciu formulárom (nerobil som); token držať na serveri s cache 30 s; blokovanie IP pri systematickom prekročení. Vhodné ako „pásmo poplachu“ (polygón oblasti) – doplnok k udalostiam, nie zdroj úderov.
- Dôkazy:
  - https://devs.alerts.in.ua/
  - https://alerts.in.ua/api-request

### Texty.org.ua – „Under attack. What and when Russia shelled in Ukraine“

- URL: https://texty.org.ua/projects/107577/under-attack-what-and-when-russia-shelled-ukraine/
- Druh / formát / prístup: events · Interaktívna mapa + tabuľka v článku (HTML/JS), bez verejného odkazu na stiahnutie; tretie strany dostali dáta „with kind permission from the authors“ (media-search-engine) · **scrape-only**
- Strojovo čitateľné: nie
- Licencia (doslovne): Materiály Texty: "Creative Commons із зазначенням авторства, CC BY" s uvedením zdroja "в першому чи другому абзаці"
- Licencia URL: https://texty.org.ua/projects/107577/under-attack-what-and-when-russia-shelled-ukraine/
- Atribúcia: „Texty.org.ua“ s odkazom v prvom/druhom odseku (CC BY)
- Aktualizácia: Tabuľka "is still being regularly updated" (kadencia neuvedená)
- Pokrytie: Údery od 24. 2. 2022 z pravda.com.ua a lokálnych Telegram kanálov, tri triedy (rakety/letectvo+drony/delostrelectvo), zoskupené po mesiacoch a regiónoch; presnosť na sídlo; autori: mapa "does not reflect the real situation 100%"
- Riziká / poznámky: CC BY je priaznivé, ale dataset nie je verejne stiahnuteľný – treba požiadať redakciu (texty.org.ua@gmail.com) o CSV; scrapovanie JS bundle nestabilné. Redakčný výber správ (nie systematický zber).
- Dôkazy:
  - https://texty.org.ua/projects/107577/under-attack-what-and-when-russia-shelled-ukraine/
  - https://github.com/conflict-investigations/media-search-engine

### WarSpotting – API geolokovaných strát techniky (RU)

- URL: https://ukr.warspotting.net/api/docs/
- Druh / formát / prístup: other · REST JSON bez kľúča: https://warspotting.org/api/stats/russia/, /api/losses/russia/, /api/losses/russia/recent/, /api/losses/russia/<date>/<page>/; záznam = ID, typ techniky, stav, dátum, poloha, zdroj (jednotka „if known“) · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear – "© 2022-2026 WarSpotting — All rights reserved" s odkazom na Terms of use (/about/#terms), ktoré sú za Cloudflare bot-kontrolou (neobišiel som ju, text neprečítaný)
- Licencia URL: https://ukr.warspotting.net/about/
- Atribúcia: Vyžadovaná podľa copyright notice (presné znenie v Terms nedostupné)
- Aktualizácia: Priebežne (neuvedené); limit "We cap request frequency at 10 per 10 seconds."; nutný vlastný User-Agent (inak 520)
- Pokrytie: Vizuálne potvrdené straty ruskej techniky s dátumom a geolokáciou (časť záznamov bez presnej polohy) od 2022
- Riziká / poznámky: Kým nie sú prečítané Terms, nepoužiť verejne; „military losses“ je etickou čiarou OK (technika, nie osoby), ale pole 'unit' nezobrazovať. Web blokuje automatické fetchery (403/JS challenge) – prečítať podmienky ručne v prehliadači používateľa.
- Dôkazy:
  - https://ukr.warspotting.net/api/docs/
  - https://ukr.warspotting.net/about/

**Poznámky nálezcu (notes):** ČO SOM HĽADAL A OVERIL (19. 9. 2026): všetkých 8 položiek zadania + 5 doplnkov (VIINA, GeoConfirmed API, alerts.in.ua, Texty, WarSpotting). Každý citát licencie je zo stránky v evidence; kde som ho nevedel prečítať, je 'unclear'.  ODPORÚČANÉ PORADIE PRE VRSTVU UDALOSTÍ V OKO: (1) VIINA 2.0 – ODbL, denne, geokódované na sídlo, čistý CSV na server (pozor share-alike: držať ako vlastný súbor ako pri OSM ropovodoch); (2) GeoConfirmed API – bez kľúča, overené OSINT body, „freely available for research, journalism, and analytical use“, treba User-Agent s kontaktom a rešpektovať Cache-Control (v proxy), robots.txt Disallow /api/ platí pre crawlery; (3) UCDP Candidate – CC BY 4.0, mesačný CSV snímok, len fatálne udalosti (kvalitná „studená“ vrstva pre históriu); (4) Bellingcat TimeMap – statický archív do 07/2025, dátová licencia neuvedená → skôr napísať Bellingcatu než vystaviť; (5) UA Generálny štáb cez ArmyInform RSS (CC BY 4.0) = počty stretov po smeroch → potrebný ručný gazetteer smerov (centroidy/osi) pre „smery útokov“ ako na mape Lyman; (6) ISW = len citát + link von (politika zakazuje datasety/shapefily); (7) GDELT = len kartičky správ (hluk, GEO 404, DOC 429).  ZAMIETNUTÉ/NEPOUŽITEĽNÉ: ACLED (gmail účet = len agregáty; surové udalosti od úrovne Research pre inštitúcie; EULA zakazuje raw dáta na vlastnom dashboarde → ani s prístupom nie pre verejnú mapu); Ukraine War Archive (overovanie, view-only, zákaz verejného zobrazenia); CIR Eyes on Russia (bez licencie, bez exportu – len link von); Liveuamap (platené API, stránka blokuje fetcher 403 – neoverené podmienky).  SLEPÉ ULIČKY: ISW RSS neexistuje (/feed/ HTML, rss.xml 403, Blogger feed presmeruje na HTML); HDX kópia ACLED 403; GDELT GEO endpoint 404 (rovnako ako v ZÁLIV pilote); GDELT DOC 429 bez cache; cdn.geoconfirmed.org KML (z vyhľadávača) – DNS neexistuje, dnes platí REST API; geoconfirmed.org/about 404; WebFetch aj MCP fetch dostávajú 403 od geoconfirmed.org, zsu.gov.ua, warspotting – čítal som v reálnom prehliadači (WarSpotting má Cloudflare bot-check, neobišiel som ho); russianwarship.rip API docs sú SPA bez obsahu (nepoužité; GitHub parser andriilive číta Ukrajinsku Pravdu, MIT, denne 8:30 UTC – ako záloha pre počty strát); Python ani pdftoppm nie sú v systéme – codebook UCDP som rozbalil PowerShellom (DeflateStream) a where_prec citujem doslovne. UCDP: staršie zrkadlá (DANTE, discuss-data/Zenodo) uvádzajú non-commercial/ODbL, oficiálna stránka dnes CC BY 4.0 – zapísať s dátumom overenia; UCDP API už vyžaduje token (živý test 401).  ETIKA: žiadny z odporúčaných zdrojov nevyžaduje osoby; GeoConfirmed ORBAT a WarSpotting 'unit' nezobrazovať; graphic=true (Bellingcat) a stupeň 5 (CIR) – nikdy neembedovať médiá, len odkaz.

## D. Satelitné signály (požiare, nočné svetlá, SAR, škody)

Zdrojov: 14.

### NASA FIRMS — Area/Country API + WMS/WFS (VIIRS 375 m, MODIS 1 km aktívne požiare)

- URL: https://firms.modaps.eosdis.nasa.gov/api/area/
- Druh / formát / prístup: events · CSV (area/country API, 1–5 dní na dopyt), WMS raster s TIME (do 31 dní), WFS (CSV, COUNT=1000, regióny napr. Europe), KML; atribúty lat/lon, acq_date/acq_time, confidence, FRP, daynight · **api-key**
- Strojovo čitateľné: áno
- Licencia (doslovne): NASA dátová politika: „All data produced by NASA, including the code and algorithms used to produce these data, are available fully and openly to data users.“ (earthdata feature article); „EOSDIS data are openly available to all and free of charge except where governed by international agreements.“ (Earthdata Login guidance); stránka data-use-policy uvádza dáta misií vedených NASA ako Creative Commons Zero (CC0) a „NASA material may be reproduced and distributed without further permission from NASA“; disclaimer: „The information presented through LANCE, GIBS, Worldview, and FIRMS are provided 'as is' and users bear all responsibility and liability for their use of data.“
- Licencia URL: https://www.earthdata.nasa.gov/earth-observation-data/data-use-policy
- Atribúcia: „We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS).“ (https://www.earthdata.nasa.gov/data/tools/firms)
- Aktualizácia: NRT: „Global data are available within 3 hours of satellite observation“; WMS/WFS „updated once every 15 mins“; VIIRS S-NPP/NOAA-20/NOAA-21 ≈ 2 prelety denne na družicu (deň ~13:30, noc ~01:30 miestneho času) + MODIS Terra/Aqua
- Pokrytie: Globálne, celá Ukrajina; archív MODIS od 2000, VIIRS od 2012 (SP + NRT). Pre vojnovú vrstvu: hotspoty = ostreľovanie/údery/požiare po zásahoch; bodová mapa + denné súčty na rajón/10 km bunku; nočné detekcie (daynight=N) pozdĺž frontu sú najčistejší signál. OKO už má /api/firms (kľúč v .env) — stačí rozšíriť bbox na Ukrajinu a pridať filter (poľnohospodárske požiare, priemysel).
- Riziká / poznámky: „MAP_KEY limit is 5000 transactions / 10-minute interval.“ (area API) — proxy s cache nutná. Falošné pozitíva: Bellingcat cituje FIRMS: „Not all fires and thermal anomalies shown in war zones represent military activity“ (cementárne, vypaľovanie strnísk, lesné požiare; ~70 % Ukrajiny je poľnohospodárska pôda). Oblačnosť = diery (najmä zima). Nie každý boj vytvorí požiar. Pre vojnovú interpretáciu treba baseline model (pozri The Economist) alebo land-cover filter (ESA WorldCover). Etika: len súradnice požiarov, žiadne osoby — v poriadku.
- Dôkazy:
  - https://firms.modaps.eosdis.nasa.gov/api/area/
  - https://www.earthdata.nasa.gov/data/tools/firms
  - https://firms.modaps.eosdis.nasa.gov/mapserver/wms-info/
  - https://firms.modaps.eosdis.nasa.gov/mapserver/wfs-info/
  - https://www.earthdata.nasa.gov/earth-observation-data/data-use-policy
  - https://www.earthdata.nasa.gov/news/feature-articles/nasa-earth-science-data-yours-use-fully-without-restrictions
  - https://www.bellingcat.com/resources/2022/10/04/scorched-earth-using-nasa-fire-data-to-monitor-war-zones/

### NASA GIBS WMTS — vrstvy Thermal Anomalies (MVT), Day/Night Band At-Sensor Radiance a Black Marble VNP46A2 NRT (Gap-Filled BRDF Corrected)

- URL: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
- Druh / formát / prístup: satellite · WMTS: požiare ako application/vnd.mapbox-vector-tile (VIIRS_SNPP_Thermal_Anomalies_375m_All, VIIRS_NOAA20_…, VIIRS_NOAA21_…, MODIS_Combined_Thermal_Anomalies_All, varianty Day/Night), nočné svetlá ako image/png (VIIRS_SNPP_DayNightBand_At_Sensor_Radiance, VIIRS_NOAA20/NOAA21_DayNightBand_At_Sensor_Radiance, VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance = VNP46A2 NRT, VIIRS_SNPP_DayNightBand_ENCC); TileMatrixSet GoogleMapsCompatible_Level8 (max zoom 8 ≈ 600 m/px), Level7 pre MODIS · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): Rovnaká NASA politika ako FIRMS (plne otvorené, CC0 podľa data-use-policy); disclaimer „The information presented through LANCE, GIBS, Worldview, and FIRMS are provided 'as is'…“ (https://www.earthdata.nasa.gov/data/tools/firms)
- Licencia URL: https://www.earthdata.nasa.gov/earth-observation-data/data-use-policy
- Atribúcia: NASA GIBS / Worldview (EOSDIS); pre nočné svetlá NASA Black Marble (VNP46A2), pre požiare FIRMS/LANCE (text vyššie)
- Aktualizácia: Denné (P1D). Overené v Capabilities 19. 9. 2026: Thermal Anomalies default 2026-09-19 (D0), At_Sensor_Radiance default 2026-09-19, GapFilled_BRDF (VNP46A2 NRT) default 2026-09-18 (D−1). Worldview oznámil VNP46A2 NRT vrstvu 24. 7. 2025: „It is a daily, moonlight- and atmosphere-corrected nighttime lights near real-time (NRT) layer from the VNP46A2 product that has been newly released into NASA Worldview.“
- Pokrytie: Globálne. Časové rady z Capabilities: VNP46A2 GapFilled od 2012-01-19 (s dierami, napr. 2022-07-26→2022-08-11, 2024-05-29→06-04); At_Sensor_Radiance od 2020-11-18; ENCC od 2016-11-30 ale default 2023-07-07 (vrstva vyzerá zastavená); NOAA-21 fires od 2024-01-17. Pre vojnovú vrstvu: (a) požiare priamo ako vektorové dlaždice bez kľúča (bod = detekcia, atribúty FRP/confidence), (b) nočné svetlá VNP46A2 ako prekryv „výpadky prúdu“ — vizuálne porovnanie dní; OKO už má GIBS mechaniku (imageryOrder, MAP_STACK_FAMILIES) — najlacnejšia cesta.
- Riziká / poznámky: Zoom strop Level8 → hrubé pri priblížení; At-Sensor Radiance obsahuje mesačný svit a oblaky (na výpadky použiť GapFilled BRDF variant); VNP46A2 NRT má D−1 a diery; NOAA-21 GapFilled vrstva má v Capabilities prázdne časové hodnoty (nenaplnená); VIIRS_Black_Marble je statická (2012, 2016). MVT dlaždice požiarov: Cesium ich natívne nečíta — treba dekódovať (pbf) alebo brať CSV z FIRMS. Bez kľúča, ale NASA GIBS je zdieľaná infra → cache na serveri.
- Dôkazy:
  - https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
  - https://www.earthdata.nasa.gov/news/worldview-image-archive/nighttime-lights-north-central-america
  - https://www.earthdata.nasa.gov/news/blog/announcing-viirs-nighttime-imagery-day-night-band
  - https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/VIIRS_SNPP_DayNightBand_At_Sensor_Radiance.json

### NASA Black Marble VNP46A2 / VJ146A2 (LAADS DAAC) — denné nočné svetlá pre výpočet výpadkov prúdu

- URL: https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A2/
- Druh / formát / prístup: satellite · HDF5 (HDF-EOS5) dlaždice 15 arc-sec (~500 m), ~40 MB/súbor; SDS: DNB_BRDF-Corrected_NTL, Gap_Filled_DNB_BRDF-Corrected_NTL, Mandatory_Quality_Flag, cloud mask, snow flag; DOI 10.5067/VIIRS/VNP46A2.002 · **registration**
- Strojovo čitateľné: áno
- Licencia (doslovne): NASA plne otvorené dáta (pozri data-use-policy: CC0, „NASA material may be reproduced and distributed without further permission from NASA“); sťahovanie vyžaduje Earthdata Login: „Direct downloads of data via http/https, ftp, EOSDIS Core Systems (ECS) datapools“ — „EOSDIS data are openly available to all and free of charge except where governed by international agreements.“
- Licencia URL: https://www.earthdata.nasa.gov/data/earthdata-login/guidance
- Atribúcia: Román, M.O., et al. (2018). NASA's Black Marble nighttime lights product suite. Remote Sensing of Environment 210, 113-143, doi:10.1016/j.rse.2018.03.017; produkt DOI 10.5067/VIIRS/VNP46A2.002
- Aktualizácia: Denne od 2012-01-19; NRT varianty (LANCE) „in near real-time (NRT), within a three-hour window“; „as of Aug. 25, 2025, VNP and VJ1 are Collection 2“ (Collection 1 ukončená)
- Pokrytie: Globálne, celá Ukrajina, S-NPP (VNP46) + NOAA-20 (VJ146) + NOAA-21 (VJ246). Pre vojnovú vrstvu: server-side výpočet „výpadok“ = radiance sídla vs. baseline (medián posledných 30–90 nocí, len Mandatory_Quality_Flag=0), výstup GeoJSON bodov/polygónov s % poklesu — presne tá metodika, akou sa merajú výpadky po hurikánoch (IOP 2025).
- Riziká / poznámky: Earthdata Login token musí ostať na serveri; HDF5 spracovanie (Node nemá natívny HDF5 → Python/GDAL alebo použiť GIBS vrstvu len vizuálne); oblačnosť a sneh v zime (kvalitné retrievaly zriedkavé); 500 m rozlíšenie = mesto/obec, nie budova; mesačný svit korigovaný, ale polárna žiara/glint majú vlastné flagy. Etika: agregát za sídlo, žiadne osoby.
- Dôkazy:
  - https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A2/
  - https://www.earthdata.nasa.gov/data/projects/black-marble
  - https://www.earthdata.nasa.gov/data/earthdata-login/guidance
  - https://www.earthdata.nasa.gov/earth-observation-data/data-use-policy
  - https://iopscience.iop.org/article/10.1088/2634-4505/ade474

### EOG (Colorado School of Mines / Payne Institute) — VIIRS Nightly DNB Mosaics (VNL) a VIIRS Nightfire (VNF)

- URL: https://eogdata.mines.edu/products/vnl/
- Druh / formát / prístup: satellite · Nočné mozaiky: GeoTIFF (DEFLATE), 15 arc-sec, radiance (rade9d) + cloud mask; mesačné/ročné kompozity; VNF: CSV/ezCSV (gzip) + KMZ s teplotou zdroja (400 K–>2500 K) · **registration**
- Strojovo čitateľné: áno
- Licencia (doslovne): VNL: „Many of the VIIRS Nighttime Lights data are available under Creative Commons Attribution 4.0 International license.“ (stránka VNL). VNF: „Effective January 10, 2025, all VIIRS Nightfire data is available through a VIIRS Nightfire Data Use License.“ — štúdia Sci Rep 2026 uvádza: „VIIRS Nightfire data was used under an academic license from the Colorado School of mines, which does not permit redistribution in any form.“
- Licencia URL: https://eogdata.mines.edu/products/vnl/
- Atribúcia: „Please cite EOG as the data source and papers relevant to the EOG product you are using.“ (Elvidge et al., Int. J. Remote Sensing 38, 5860–5879, 2017; VNF: Elvidge et al. 2013 Remote Sensing)
- Aktualizácia: Nočné mozaiky NRT (ako prichádzajú prelety), mesačné a ročné kompozity; VNF nočne
- Pokrytie: Globálne 75N–65S, od 2012. VNL nočné = alternatíva k Black Marble (rovnaký DNB senzor, iné spracovanie). VNF = kombustné zdroje s odhadom teploty (600–6000 K) — Sci Rep 2026 „Conflict monitoring with VIIRS Nightfire: the war in Ukraine“ ukázal koreláciu VNF s poškodením sídiel (86 % z 90 sídiel) a odstavenie ťažkého priemyslu; letné mesiace kreslia front, zima nie.
- Riziká / poznámky: Overené curl 19. 9. 2026: adresár /nighttime_light/nightly/ presmeruje (302) na eogauth.mines.edu OpenID login → registrácia nutná, token server-side. „Many“ ≠ všetky produkty pod CC BY — overiť pri konkrétnom súbore. VNF NIE JE použiteľný pre verejnú vrstvu (akademická licencia bez redistribúcie) — len ako metodická inšpirácia. VNF 750 m pixel, 10–30 % variácia radiance oblačnosťou.
- Dôkazy:
  - https://eogdata.mines.edu/products/vnl/
  - https://eogdata.mines.edu/products/vnf/
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC12957493/
  - https://www.nature.com/articles/s41598-026-42172-0

### Copernicus Data Space Ecosystem (CDSE) — Sentinel-1 GRD/SLC a Sentinel-2 L1C/L2A (STAC, OData, S3, Sentinel Hub, openEO)

- URL: https://dataspace.copernicus.eu/
- Druh / formát / prístup: satellite · STAC API JSON (https://stac.dataspace.copernicus.eu/v1/), OData, S3; produkty SAFE/JP2/COG; Sentinel Hub OGC WMS/WMTS + Process API (PNG/GeoTIFF z evalscriptov); openEO batch · **registration**
- Strojovo čitateľné: áno
- Licencia (doslovne): Legal notice on the use of Copernicus Sentinel Data and Service Information (PDF, text extrahovaný lokálne): „users shall have a free, full and open access to Copernicus Sentinel Data and Service Information without any express or implied warranty“; povolené „(a) reproduction; (b) distribution; (c) communication to the public; (d) adaptation, modification and combination with other data and information; (e) any combination of points (a) to (d)“; CDSE T&C: „The access and use of Copernicus Sentinel data is available on a free, full and open basis through the Copernicus Data Space Ecosystem“
- Licencia URL: https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice
- Atribúcia: „'Copernicus Sentinel data [Year]'“; po úprave „'Contains modified Copernicus Sentinel data [Year]'“ (Legal notice, čl. 8 Reg. 1159/2013)
- Aktualizácia: Sentinel-1: S-1C plne operačný od mája 2025, S-1D „declared fully operational on May 1, 2026“, finálna konfigurácia S-1C+S-1D s 6-dňovým opakovaním od 2. polovice júna 2026, S-1A dobieha do júla 2026; Sentinel-2: 5 dní na rovníku s 2 družicami (2–3 dni v stredných šírkach), S-2A plánovane vyradená ~13. 3. 2026 (S-2B+S-2C)
- Pokrytie: Globálne. Kvóty bezplatného „Copernicus General“ (Quotas.html): Sentinel Hub 10 000 PU/mesiac, 300 PU/min, 10 000 requestov/mesiac; openEO 10 000 kreditov/mesiac; S3/OData/STAC 50 000 requestov/mesiac, 20 MB/s, 4 súbežné spojenia, 12 TB/30 dní. STAC vyhľadávanie bez prihlásenia, sťahovanie s tokenom. Pre vojnovú vrstvu: S-2 true-color/NBR (vypálené plochy, krátery hrubo, zaplavenie Kachovka), S-1 amplitúdová zmena (poškodené budovy, metodika Dietrich), koherencia zo SLC (ťažké).
- Riziká / poznámky: Registrácia + OAuth client secret (server-side). Vlastné SAR spracovanie je výpočtovo náročné — reálne je Sentinel Hub Process API nad bboxom frontu (1 PU ≈ 512×512 px 3 pásma) s cache; 10 000 PU/mesiac stačí na denné výrezy niekoľkých úsekov, nie na celý front v plnom rozlíšení. Akvizičný plán S-1 nad Ukrajinou som neoveroval. Atribúcia „Contains modified Copernicus Sentinel data 2026“ povinná v UI.
- Dôkazy:
  - https://documentation.dataspace.copernicus.eu/Quotas.html
  - https://dataspace.copernicus.eu/terms-and-conditions
  - https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice
  - https://documentation.dataspace.copernicus.eu/APIs/STAC.html
  - https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-1/Sentinel-1D_goes_live_a_milestone_for_Europe_s_radar_mission
  - https://dataspace.copernicus.eu/news/2026-4-2-sentinel-1d-user-data-opening-and-future-plans
  - https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html

### Earth Search (Element 84) — Sentinel-2 L2A COG na AWS bez účtu (+ Sentinel-1 GRD requester-pays)

- URL: https://earth-search.aws.element84.com/v1
- Druh / formát / prístup: satellite · STAC API JSON (kolekcie sentinel-2-l2a, sentinel-2-c1-l2a, sentinel-1-grd, cop-dem…), COG GeoTIFF v bucketoch sentinel-cogs / e84-earth-search-sentinel-data (us-west-2) · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): AWS Open Data registry: „Access to Sentinel data is free, full and open for the broad Regional, National, European and International user community.“ (+ Sentinel Legal Notice ako vyššie). Pozor: pole license v STAC kolekciách je „proprietary“ (STAC placeholder, providers ESA producer/licensor).
- Licencia URL: https://registry.opendata.aws/sentinel-2-l2a-cogs/
- Atribúcia: „Contains modified Copernicus Sentinel data [Year]“ (Sentinel Legal Notice); hosting Element 84 / AWS
- Aktualizácia: „New Sentinel data are added regularly, usually within few hours after they are available on Copernicus OpenHub.“
- Pokrytie: Globálne od 2015-06-27 (S-2 L2A); S-1 GRD od 2014-10-10. „No AWS account required“ pre S-2 COG. Pre OKO: server-side titiler/range-reads → PNG dlaždice do Cesia (true color, NBR/NDVI, pred/po) bez registrácie.
- Riziká / poznámky: sentinel-1-grd v Earth Search je requester-pays (eu-central-1, „Requester pays: True“) → náklady, pre SAR použiť CDSE alebo Planetary Computer. Bucket us-west-2 = latencia z EÚ; treba vlastný tile server + cache. Bez zmluvy o dostupnosti (komunitná služba).
- Dôkazy:
  - https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a
  - https://earth-search.aws.element84.com/v1/collections/sentinel-1-grd
  - https://registry.opendata.aws/sentinel-2-l2a-cogs/

### Microsoft Planetary Computer — Sentinel-1 RTC (terénne korigovaný SAR, 10 m, VV/VH), Sentinel-1 GRD, Sentinel-2 L2A

- URL: https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc
- Druh / formát / prístup: satellite · STAC API (https://planetarycomputer.microsoft.com/api/stac/v1), COG v Azure Blob (región westeurope), SAS token z https://planetarycomputer.microsoft.com/api/sas/v1/token/{collection} · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): STAC kolekcia sentinel-1-rtc: license „CC-BY-4.0“ (providers: Catalyst processor, Microsoft host + licensor) nad podkladovými Sentinel dátami (Legal Notice); sentinel-1-grd: license „proprietary“ (ESA licensor). Popis RTC kolekcie: „A Planetary Computer account is required to retrieve SAS tokens to read the RTC data.“ — ale anonymný GET na SAS endpoint 19. 9. 2026 vrátil platný token pre sentinel-1-rtc, sentinel-1-grd aj sentinel-2-l2a (overené curl).
- Licencia URL: https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-rtc
- Atribúcia: „Contains modified Copernicus Sentinel data [Year]“ + Microsoft Planetary Computer / Catalyst (RTC processing, CC BY 4.0)
- Aktualizácia: Priebežne od 2014-10-10 (kadencia v metadátach neuvedená); anonymný prístup je podľa dokumentácie throttlovaný
- Pokrytie: Globálne; RTC odstraňuje terénne skreslenie → najlepší vstup na porovnanie spätného rozptylu v čase (poškodené budovy, zaplavené plochy) bez vlastného SAR predspracovania. Región westeurope = nízka latencia z EÚ.
- Riziká / poznámky: Rozpor medzi textom kolekcie (účet nutný) a skutočným anonymným tokenom → môže sa zmeniť; platforma prechádza zmenami (Planetary Computer Pro, API verzia 2026-04-15) — stabilita nejasná. Anonymné čítanie throttlované → cache. SAR interpretácia laikovi nič nepovie bez odvodenej vrstvy (zmena dB pred/po).
- Dôkazy:
  - https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-rtc
  - https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-grd
  - https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-rtc
  - https://planetarycomputer.microsoft.com/docs/quickstarts/reading-stac/

### Copernicus EMS Rapid Mapping — verejné API aktivácií a produktov (EMSR)

- URL: https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/
- Druh / formát / prístup: official-report · JSON API (stránkované limit/offset; polia code, countries, eventTime, name, centroid, activationTime, category, lastUpdate, closed, gdacsId, n_aois, n_products); detail ?code=EMSRxxx s AOI, produktmi (Cloud Optimized GeoTIFF + Vector Tiles), ZIP balíky (downloadPath/productsPath); klasicky aj shapefile/PDF/JPEG · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): Terms and conditions: „free, full and open access to Copernicus Service Information without any express or implied warranty“; povolené reproduction, distribution, public communication, adaptation, combination; obmedzené dáta podľa Reg. (EU) 2021/696 čl. 53: „Access to this restricted data will be granted only to specific users and upon registration.“; About: „All data and results are freely available for public viewing and download (except for sensitive activations).“
- Licencia URL: https://mapping.emergency.copernicus.eu/terms-and-conditions/
- Atribúcia: „Copernicus Emergency Management Service (© [year] European Union), [Activation ID]“ (citation guidelines; napr. „Copernicus Emergency Management Service (© 2025 European Union), EMSR780“)
- Aktualizácia: Podľa aktivácie (hodiny–dni po aktivácii, 24/7); API 19. 9. 2026: 265 aktivácií EMSR656–EMSR932, najnovšia 2026-09-15
- Pokrytie: Prešiel som všetkých 265 verejných záznamov (27 strán): NULA aktivácií pre Ukrajinu. Kategórie: Wildfire 131, Flood 88, Storm 25, Earthquake 8, Other 7… Staršie ukrajinské aktivácie (povodne 2020 EMSR444/445, Kachovka 2023) sú mimo tohto API a legacy stránky emergency.copernicus.eu/mapping/… vracajú 404. Pre vojnu ako takú CEMS produkty verejne nie sú (citlivé aktivácie).
- Riziká / poznámky: Pre modul UKRAJINA dnes bez obsahu — ponechať len ako „hák“ na budúce povodne/priehrady/priemyselné havárie na Ukrajine (kategórie Flood/Industrial accident). Ak sa objaví, produkty sú COG + vector tiles = priamo použiteľné. Atribúcia s EMSR kódom povinná. Sensitive aktivácie sa v API nezobrazia vôbec.
- Dôkazy:
  - https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/
  - https://mapping.emergency.copernicus.eu/about/how-to-harvest-cems-mapping-data/emergency-response-data/
  - https://mapping.emergency.copernicus.eu/about/citation-guidelines/
  - https://mapping.emergency.copernicus.eu/terms-and-conditions/
  - https://mapping.emergency.copernicus.eu/about/
  - https://emergency.copernicus.eu/help-support/

### UNOSAT (UNITAR) — hodnotenia škôd na budovách pre Ukrajinu na HDX (Mariupol, Charkiv, Sumy, Cherson 2022–2023)

- URL: https://data.humdata.org/organization/unosat
- Druh / formát / prístup: official-report · SHP a File Geodatabase (zip) s bodmi budov a triedou poškodenia, PDF prehľadové mapy; zrkadlo na https://unosat-maps.web.cern.ch/UA/…; metadáta cez CKAN API (package_search?fq=organization:unosat groups:ukr) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): HDX license_id „cc-by-sa“ = „Creative Commons Attribution Share-Alike (CC BY-SA)“ pri 25 z 26 datasetov; jeden dataset „cc-by-igo“ = „Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)“ (overené v CKAN API 19. 9. 2026)
- Licencia URL: https://data.humdata.org/api/3/action/package_show?id=north-kharkiv-rapid-damage-assessment-overview-map
- Atribúcia: United Nations Satellite Centre (UNOSAT) / UNITAR; pri odvodených dátach share-alike (BY-SA)
- Aktualizácia: Žiadna priebežná aktualizácia: 26 ukrajinských datasetov, najnovšie vytvorené 2023-07-07 (Cherson – povodeň a škody po Kachovke jún 2023), predtým Mariupol/Charkiv/Sumy marec–jún 2022; last_modified 2025-08-26 je len metadátový presun
- Pokrytie: Vybrané AOI (mestá), nie celý front; statické snímky stavu. Pre OKO: bodová vrstva „potvrdené poškodené budovy (UNOSAT, k dátumu)“ ako referencia/validácia SAR vrstiev; hlásiť dátum snímky.
- Riziká / poznámky: Stránky HDX blokujú WebFetch (403), CKAN API s bežným User-Agent funguje. Upozornenie UNOSAT: „This is a preliminary assessment and has not yet been validated in the field.“; vidno len ťažké štrukturálne poškodenie. BY-SA: zobrazenie v OKO OK, ale spojený derivát musí ostať BY-SA. Zdrojové VHR snímky (komerčné) nie sú súčasťou. Etika: budovy, nie osoby — OK.
- Dôkazy:
  - https://data.humdata.org/api/3/action/package_show?id=north-kharkiv-rapid-damage-assessment-overview-map
  - https://data.humdata.org/api/3/action/package_search?fq=organization:unosat%20groups:ukr&sort=metadata_created%20desc&rows=8
  - https://data.humdata.org/api/3/action/license_list
  - https://data.humdata.org/dataset/damage-assessment-over-oleshky-city-khersonskyi-region-khersonska-oblast-ukraine-as-of-07-

### ETH Zürich (Dietrich et al. 2025) — celoštátna mapa vojnových škôd Ukrajiny zo Sentinel-1 (Zenodo)

- URL: https://zenodo.org/records/15088349
- Druh / formát / prístup: other · GeoTIFF heatmapa ukraine_final_preds_22_23_masked.tif (17,9 GB), buildings_preds.parquet (4,8 GB, odhad na budovu), n_buildings_damaged_adm3_t0_655.geojson (60,7 MB, súčty na ADM3), unosat_aois.geojson, unosat_labels.geojson · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Zenodo: „Creative Commons Attribution 4.0 International“; kód: „This project is licensed under the MIT License - see the LICENSE file for details.“ (GitHub); článok Commun. Earth Environ. 2025
- Licencia URL: https://zenodo.org/records/15088349
- Atribúcia: Dietrich, O. et al. (2025), An open-source tool for mapping war destruction at scale in Ukraine using Sentinel-1 time series, Communications Earth & Environment; Zenodo v2 (2025-03-19); Contains modified Copernicus Sentinel data
- Aktualizácia: Statické: február 2022 – február 2024 v 3-mesačných oknách (v2 zverejnená 19. 3. 2025); repo bez ďalších aktualizácií výsledkov
- Pokrytie: Celá Ukrajina, 10 m Sentinel-1 GRD amplitúda, Random Forest trénovaný na 10 934 UNOSAT anotáciách; ~400 000 budov (~2,7 %) s pravdepodobným poškodením; recall 84,6 % / precision 67,1 % pri prahu 0,5. Pre OKO: hotová vrstva „pravdepodobné poškodenie sídiel“ — najlepšie ADM3 GeoJSON (choropleth/kruhy) alebo prevzorkovaná heatmapa na dlaždice; UI hlási „snímok do 02/2024“.
- Riziká / poznámky: Veľké súbory (GeoTIFF 18 GB) → spracovať jednorazovo na D:, do klienta len dlaždice/ADM3. Pravdepodobnostné, nie potvrdené; falošné pozitíva (precision 67 %). Metodika je MIT — možno spustiť vlastné okná 2024–2026 nad CDSE/Planetary Computer, ale je to výpočtovo ťažké. Earth Engine aplikácie vyžadujú Google login (nie pre OKO).
- Dôkazy:
  - https://zenodo.org/records/15088349
  - https://arxiv.org/html/2406.02506v2
  - https://github.com/olidietrich/ukraine-damage-mapping-tool/
  - https://www.nature.com/articles/s43247-025-02183-7

### The Economist — Ukraine war-fire model (FIRMS + ML, denne aktualizované CSV na GitHube)

- URL: https://github.com/TheEconomist/the-economist-war-fire-model
- Druh / formát / prístup: events · CSV cez raw.githubusercontent.com: output-data/ukraine_war_fires.csv (~70 MB; LATITUDE, LONGITUDE, date, ACQ_TIME, war_fire, in_urban_area, pop_density, excess_fire, war_fire_restrictive…), strikes_by_location_and_day.csv (291 kB), oblast_activity_by_day.csv, areas_of_control_daily_summary.csv, cloud_cover_in_ukraine_by_day.csv, firms_update.csv/firms_update_RU.csv · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): README: kód „MIT licence“; dáta „Creative Commons Attribution 4.0 International License“; „The data and files that we have generated from open sources are freely available for public use, as long as _The Economist_ is cited as a source.“
- Licencia URL: https://github.com/TheEconomist/the-economist-war-fire-model/blob/master/README.md
- Atribúcia: „The Economist and Solstad, Sondre (corresponding author), 2023. The Economist's war-fire model.“ + NASA FIRMS
- Aktualizácia: Automatické commity: posledný 2026-09-19 06:29 UTC „Update FIRMS data 2026-09-19 06:29 UTC“ (GitHub API); README: niekoľkokrát denne
- Pokrytie: Ukrajina (+ ruské pohraničie v _RU súboroch) od 24. 2. 2022; metodika: gradient-boosted modely (100 modelov) z 10 nevojnových rokov predpovedajú „normálne“ požiare, war_fire = detekcia nad predikovaným kvantilom; obsahuje aj cloud cover po dňoch (vysvetľuje diery). Pre OKO: hotová „vojnová“ filtrácia FIRMS bez vlastného modelu — bodová vrstva + denná aktivita na oblasť.
- Riziká / poznámky: 70 MB CSV nie je zoradený podľa dátumu → proxy stiahne raz denne, uloží na D:, klient dostane len posledných N dní; GitHub raw bez kľúča, ale nie SLA. Štatistický proxy, nie potvrdenie úderu (README: nie každý boj vytvorí požiar). areas_of_control súbor vychádza z tretích strán (ISW) — licenciu tejto časti som neoveroval. Pri citácii uvádzať aj NASA FIRMS.
- Dôkazy:
  - https://github.com/TheEconomist/the-economist-war-fire-model
  - https://raw.githubusercontent.com/TheEconomist/the-economist-war-fire-model/master/output-data/ukraine_war_fires.csv
  - https://api.github.com/repos/TheEconomist/the-economist-war-fire-model/commits?per_page=1
  - https://smallwarsjournal.com/2026/03/25/fire-detection-as-a-proxy-for-combat-the-economist/

### Conflict Ecology (Oregon State) / Decentralized Damage Mapping Group — Scher & Van Den Hoek InSAR koherenčná mapa škôd Ukrajiny

- URL: https://rccd-damage-portal.netlify.app/
- Druh / formát / prístup: other · Portál: počty poškodených budov na ADM3, klastre škôd, pravdepodobnosti; stiahnutie len cez autorizovaný prístup (staging s heslom) · **unclear**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear — portál licenciu neuvádza, odkazuje na data@conflict-ecology.org; článok Science of Remote Sensing 11 (2025) 100217
- Licencia URL: https://rccd-damage-portal.netlify.app/
- Atribúcia: Scher, C. & Van Den Hoek, J. (2025), Nationwide conflict damage mapping with interferometric synthetic aperture radar: A study of the 2022 Russia–Ukraine conflict, Science of Remote Sensing 11, 100217
- Aktualizácia: Ukrajina: marec 2022 – október 2023 (statické); portál plánuje týždenné kumulatívne súčty pre aktívne konflikty (2026: Irán, Libanon), nie pre Ukrajinu
- Pokrytie: 17 532 Sentinel-1 koherenčných snímok, 264 km² pravdepodobných škôd v 5,35 % sídiel — metodicky najsilnejší celoštátny SAR prístup, ale bez otvoreného downloadu
- Riziká / poznámky: Dnes nepoužiteľné pre OKO (heslo, bez licencie). Ostáva ako metodická referencia (koherencia = citlivejšia než amplitúda, vyžaduje SLC + InSAR spracovanie).
- Dôkazy:
  - https://rccd-damage-portal.netlify.app/
  - https://www.sciencedirect.com/science/article/pii/S2666017225000239
  - https://conflict-damage.org/publication/ukr_damage/

### Vantor (bývalý Maxar) Open Data Program a Planet — komerčné VHR snímky (len konštatovanie)

- URL: https://vantor.com/company/open-data-program
- Druh / formát / prístup: satellite · Open Data: ARD COG dlaždice + STAC (s3://maxar-opendata, us-west-2, katalóg https://maxar-opendata.s3.amazonaws.com/events/catalog.json); Planet: PlanetScope 3 m denne cez Planet Insights Platform (platené) · **paid**
- Strojovo čitateľné: áno
- Licencia (doslovne): Open Data: „Creative Commons BY-NC 4.0 license, which allows for its rapid use and easy integration with existing humanitarian response technologies.“ (Vantor); AWS registry: „Creative Commons Attribution Non Commercial 4.0“. Ukrajinská vojna: nie je v Open Data (katalóg 19. 9. 2026 má 55 udalostí, žiadna Ukrajina/Rusko) — ukrajinské snímky Maxar/Vantor a Planet sú len komerčné. Planet cenník: stránka je JS-rendrovaná, verejnú cenu som nezískal → unclear.
- Licencia URL: https://registry.opendata.aws/maxar-open-data/
- Atribúcia: „© Vantor“ / „Satellite image © 2026 Vantor“ pri Open Data; Planet podľa zmluvy
- Aktualizácia: „New data is released in response to activations.“ — kritérium „The event is a sudden onset disaster“ (nie konflikt)
- Pokrytie: Bez ukrajinského obsahu; NC licencia by pre nekomerčné OKO vyhovovala, ale niet čo zobraziť. Planet: samoobslužný nákup podľa plochy (AUM), programy pre univerzity — nie pre osobný projekt.
- Riziká / poznámky: Maxar v 2025 dočasne obmedzil ukrajinský vládny prístup (Kyiv Independent) — politicky citlivý zdroj. Pre OKO: VHR len cez novinárske články (og:image odkaz von, ako v ZÁLIV pilote), nikdy hostovať.
- Dôkazy:
  - https://vantor.com/company/open-data-program
  - https://maxar-opendata.s3.amazonaws.com/events/catalog.json
  - https://registry.opendata.aws/maxar-open-data/
  - https://www.planet.com/pricing/
  - https://kyivindependent.com/maxar-technologies-restores-ukraines-access-to-high-resolution-satellite-imagery/

### ESA WorldCover 10 m (2020/2021) — pomocná vrstva na filtrovanie poľnohospodárskych požiarov vo FIRMS

- URL: https://esa-worldcover.org/en/data-access
- Druh / formát / prístup: methodology · COG GeoTIFF (2 651 dlaždíc, EPSG:4326), WMS/WMTS, S3 bucket esa-worldcover (bez prihlásenia), Zenodo makro-dlaždice, GEE ESA/WorldCover/v200 · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): „Creative Commons Attribution 4.0 International License“
- Licencia URL: https://esa-worldcover.org/en/data-access
- Atribúcia: „© ESA WorldCover project [year] / Contains modified Copernicus Sentinel data ([year]) processed by ESA WorldCover consortium“
- Aktualizácia: Statické: 2020 (v100), 2021 (v200)
- Pokrytie: Globálne 10 m. Použitie: klasifikovať každú FIRMS detekciu podľa podložia (cropland vs. built-up/grassland) — Bellingcat aj štúdie ukazujú posun detekcií z ornej pôdy na zástavbu v bojových oblastiach ako indikátor ostreľovania.
- Riziká / poznámky: Land cover 2021 = predvojnový stav; 10 m dlaždice sú veľké → predpočítať lookup na serveri (bodový dopyt cez WMS GetFeatureInfo alebo lokálny COG na D:). WorldCover viewer vyžaduje Terrascope registráciu, AWS/Zenodo nie.
- Dôkazy:
  - https://esa-worldcover.org/en/data-access
  - https://www.bellingcat.com/resources/2022/10/04/scorched-earth-using-nasa-fire-data-to-monitor-war-zones/

**Poznámky nálezcu (notes):** ČO SOM HĽADAL A OVERIL (19. 9. 2026, len WebSearch/WebFetch + curl na verejné JSON/XML, nikde registrácia, nič nesťahované okrem hlavičiek CSV a Capabilities XML do scratchpadu): - FIRMS: limity a formáty z api/area, wms-info, wfs-info; atribúcia a disclaimer z earthdata FIRMS stránky; NASA politika (CC0 na data-use-policy, „fully and openly“ v feature článku, Earthdata Login len na sťahovanie). - GIBS: stiahol som WMTS Capabilities (EPSG:3857, 5,8 MB) a vypísal reálne identifikátory + časové rozsahy a default dátumy → požiare a At-Sensor Radiance sú D0, VNP46A2 NRT (GapFilled BRDF) D−1, ENCC vrstva stojí od 2023-07-07, NOAA-21 GapFilled prázdna. - Black Marble: LAADS VNP46A2 + earthdata Black Marble (Collection 2 od 25. 8. 2025, NRT do 3 h). - EOG: VNL „Many … CC BY 4.0“, nočný adresár presmeruje na login (302 na eogauth); VNF od 10. 1. 2025 pod vlastnou licenciou bez redistribúcie (citované v Sci Rep 2026 článku o Ukrajine). - CDSE: kvóty, T&C, Sentinel Legal Notice (PDF som extrahoval lokálne Node skriptom — WebFetch ho nevedel prečítať; pypdf/pip na stroji nie sú), STAC bez loginu na vyhľadávanie; stav konštelácií S-1C/S-1D a S-2. - Earth Search: S-2 COG bez účtu (license pole „proprietary“ je STAC placeholder), S-1 GRD requester-pays. - Planetary Computer: anonymný SAS token reálne funguje pre S-1 RTC/GRD a S-2 (curl), hoci popis kolekcie tvrdí, že treba účet → riziko zmeny. - CEMS: prešiel som všetkých 265 verejných aktivácií (EMSR656–EMSR932) — ŽIADNA Ukrajina; terms/citation guidelines citované; legacy stránky (list-of-activations-rapid, EMSR444) sú 404. - UNOSAT: HDX HTML aj CKAN API cez WebFetch = 403, curl s bežným User-Agent funguje; 26 UA datasetov, licencie cc-by-sa (25) a cc-by-igo (1), najnovšie z júla 2023 → zastarané. - Odvodené SAR mapy: ETH Dietrich (Zenodo CC BY 4.0, MIT kód, statické do 02/2024) použiteľné; Scher & Van Den Hoek portál je staging s heslom, licencia unclear. - The Economist war-fire model: repo sa automaticky aktualizuje (commit dnes 06:29 UTC), dáta CC BY 4.0 — najlacnejšia hotová „vojnová“ filtrácia FIRMS. - Maxar/Vantor Open Data: CC BY-NC 4.0, katalóg 55 udalostí bez Ukrajiny; Planet: cenník JS-only, cena neoverená → paid/unclear.  NENAŠIEL / SLEPÉ ULIČKY: - Sentinel Online FAQ (404) a Terms & Conditions stránka neobsahujú znenie licencie — jediný zdroj znenia je PDF Legal Notice. - Copernicus GFM (globálne denné povodne zo S-1): portál aj EODC wiki sú JS-only, licenciu/prístup som neoveril — vynechané. - Planet support/pricing stránky (403/JS) — žiadna verejná cena. - Nature článok (Dietrich) presmeruje na idp.nature.com — použil som arXiv HTML + Zenodo + GitHub. - Akvizičný plán Sentinel-1 nad Ukrajinou (či sú IW snímky nad frontom v plnej kadencii) som neoveroval. - Umbra a Capella open SAR (CC BY 4.0, AWS registry) overené, ale bez systematického ukrajinského pokrytia → do zoznamu nezaradené. - Licencia „areas of control“ súboru v Economist repe (pochádza z ISW) neoverená — patrí do iného uhla (kontrola územia).  ODPORÚČANIE PORADIA PRE OKO (uhol 4): 1) FIRMS cez existujúci /api/firms + Economist war_fire CSV ako filter (obe hotové, denné); 2) GIBS VNP46A2 NRT + Thermal Anomalies vrstvy bez kľúča do existujúcej GIBS rodiny; 3) ETH Zenodo ADM3 GeoJSON ako statický snímok škôd „do 02/2024“; 4) UNOSAT body 2022–2023 ako referencia; 5) Sentinel-2 pred/po cez Earth Search alebo CDSE Process API len pre vybrané smery (Lyman…) — až po zvládnutí 1–4; CEMS len ako hák na budúce nevojnové udalosti.

## E. Metodika, právo a etika (legendy, oneskorenia, sankcie, čl. 114-2 TZ UA)

Zdrojov: 14.

### ISW — Mapping Methodology (Ukraine product line) + denná metodická poznámka v Russian Offensive Campaign Assessment

- URL: https://understandingwar.org/analysis/russia-ukraine/mapping-methodology-ukraine-product-line/
- Druh / formát / prístup: methodology · HTML (metodická stránka) + HTML denné hodnotenia (understandingwar.org / criticalthreats.org) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): „©2026 INSTITUTE FOR THE STUDY OF WAR. ALL RIGHTS RESERVED." (pätička understandingwar.org); reuse riadi Fair Use & Attribution Policy (samostatný zdroj nižšie)
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Atribúcia: „Source: Institute for the Study of War" (predpísané znenie pre print/web podľa Fair Use & Attribution Policy)
- Aktualizácia: Interaktívna mapa denne („This map is updated daily alongside the static maps present in this report"), time-lapse archív mesačne („ISW will update this time-lapse map archive monthly"); metodika zmenená 6. 11. 2025 (zavedenie polygónov infiltrácie)
- Pokrytie: Celý front RU–UA; definuje „control" (FM 3-90-1), FLOT, „Assessed Russian Infiltration Areas"; ISW ZÁMERNE nezobrazuje pozície ukrajinských (spriatelených) síl; v denných textoch používa kategórie „assessed advances" (geolokované zábery) vs. „infiltration" (bez zmeny kontroly terénu) vs. „claimed" (tvrdenia milbloggerov/MO RF bez vizuálneho dôkazu)
- Riziká / poznámky: Systémová zotrvačnosť: ISW kreslí „najďalej posúdený rozsah" ruského postupu a necháva ho, kým sa neobjaví prevaha protidôkazov → ruská prítomnosť sa z mapy odstraňuje pomaly, ISW sám priznáva možné podhodnotenie ukrajinských postupov. Žiadne polohy UA jednotiek (policy). Kategórie „Claimed Russian control" / „Reported Ukrainian counteroffensives" existujú v mapovej legende ArcGIS storymapy, ale samostatný definičný text som na webe ISW nenašiel (storymapa je JS, nefetchovateľná) — brať ako neoverené. Reuse dát/shapefile bez písomného súhlasu zakázaný (viď Fair Use policy).
- Dôkazy:
  - https://understandingwar.org/analysis/russia-ukraine/mapping-methodology-ukraine-product-line/ — „Control": „a tactical mission task that requires the commander to maintain physical influence over a specified area to prevent its use by an enemy" (FM 3-90-1); „Forward Line of Own Troops (FLOT)": „a line which indicates the most forward positions of friendly forces in any kind of military operation at a specific time"
  - https://understandingwar.org/analysis/russia-ukraine/mapping-methodology-ukraine-product-line/ — Infiltration: „a form of maneuver in which an attacking force conducts undetected movement through or into an area occupied by enemy forces" (FM 3-90); „Assessed Russian Infiltration Areas" = polygóny území, cez ktoré ruská pechota viedla infiltračné misie; ISW ich nehodnotí ako kontrolu územia, kým nie sú dôkazy o konsolidovaných ruských pozíciách; zmena metodiky 6. 11. 2025
  - https://understandingwar.org/analysis/russia-ukraine/mapping-methodology-ukraine-product-line/ — „ISW does not track or report on the activities or locations of friendly forces other than by friendly governments' own announcements by policy."; ruské územia na mape „do not in any way suggest Russian governance of those areas or the loss of the legitimacy of the internationally-recognized Ukrainian government"
  - https://www.criticalthreats.org/analysis/russian-offensive-campaign-assessment-february-23-2026 — „ISW's mapping methodology depicts the furthest assessed extent of Russian advances until open-source evidence emerges that allows ISW to confidently assess that Russian forces no longer hold those positions."
  - https://www.criticalthreats.org/analysis/russian-offensive-campaign-assessment-february-23-2026 — „Available footage and reports that meet ISW's threshold for changing its maps are often limited, and ISW's maps can continue to depict areas where an earlier Russian presence has significantly decreased or even disappeared as still within the 'Assessed Russian advances' until a preponderance of reporting and footage indicates otherwise."; „ISW's mapping methodology may underestimate Ukrainian advances"; zdroje: „only publicly available information", „Russian, Ukrainian, and Western reporting and social media as well as commercially available satellite imagery and other geospatial data"
  - https://www.criticalthreats.org/analysis/russian-offensive-campaign-assessment-january-16-2026 — vzor kategórií v praxi: „Geolocated footage published on January 16 indicates that Russian forces recently advanced north of Riznykivka (east of Slovyansk)." (= assessed advance) vs. „...in what ISW assesses was a Russian infiltration mission that did not change control of terrain or the forward edge of the battle area (FEBA)." (= infiltration)
  - https://www.criticalthreats.org/analysis/russian-offensive-campaign-assessment-august-15-2026 — „This map is updated daily alongside the static maps present in this report."; „ISW will update this time-lapse map archive monthly."

### ISW — Fair Use & Attribution Policy (podmienky embedovania a derivátov)

- URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Druh / formát / prístup: other · HTML (právny text) · **unclear**
- Strojovo čitateľné: nie
- Licencia (doslovne): „any modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission" — teda pre OKO ako mapovú platformu: len s písomným súhlasom
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Atribúcia: Print/web: „Source: Institute for the Study of War"; video: „Institute for the Study of War" ako on-screen text počas celého trvania; sociálne siete: @theStudyofWar; online republikácia má odkazovať na www.understandingwar.org
- Aktualizácia: Statický právny text (stav k 19. 9. 2026)
- Pokrytie: Všetky „ISW Materials" (texty, mapy, grafiky, shapefile, datasety)
- Riziká / poznámky: Kľúčové pre OKO: (1) zdieľanie nezmenenej statickej mapy nekomerčne s atribúciou = OK; (2) vektorizácia/prekreslenie/vloženie do vlastnej mapovej vrstvy = „incorporation into mapping platforms" → vyžaduje písomný súhlas; (3) shapefile/datasety sa nesmú kopírovať vôbec bez súhlasu; (4) zákaz použitia na „transactional activities (including, but not limited to, markets and speculative markets)" (reakcia na Polymarket). Storymapa ArcGIS je JS — nefetchovateľná; embed cez iframe by tiež bol „incorporation" → pýtať sa písomne. Stránka /terms-use neexistuje (404).
- Dôkazy:
  - https://www.understandingwar.org/fair-use-and-attribution-policy/ — „any modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission"
  - https://www.understandingwar.org/fair-use-and-attribution-policy/ — používatelia „may not copy or reproduce shapefiles, developer notes, or datasets for any purpose without ISW's written consent"; zákaz „alter or remove ISW's logos, credit lines, or disclaimers"
  - https://www.understandingwar.org/fair-use-and-attribution-policy/ — povolené použitie len na „non-commercial, informational or media purposes"; zakázané použitie „for any purpose that relies on, or purports to rely on, ISW Materials for transactional activities (including, but not limited to, markets and speculative markets)"
  - https://www.understandingwar.org/ — pätička: „©2026 INSTITUTE FOR THE STUDY OF WAR. ALL RIGHTS RESERVED."; jediné právne odkazy v pätičke: /fair-use-and-attribution-policy/ a /privacy-policy/

### DeepStateMap.live — License Agreement (licenčná zmluva, EN/UA) + prípad Polymarket (klientske kľúče API)

- URL: https://deepstatemap.live/license-en.html
- Druh / formát / prístup: other · HTML (právny text); API = JSON (prístup len s klientskym kľúčom); vizuály = obrázky/screenshoty · **registration**
- Strojovo čitateľné: nie
- Licencia (doslovne): Vlastnícka licenčná zmluva DEEPSTATEUATECH LLC (verzia 3. 9. 2025): vizuálne a textové materiály s odkazom/logom „may be freely used for both commercial and non-commercial purposes"; API zadarmo len pre dobrovoľnícke/charitatívne aktivity a obranu Ukrajiny, komerčné subjekty len so súhlasom; zákaz distribúcie/proxyovania API tretím stranám; zákaz vytvárania identických objektov
- Licencia URL: https://deepstatemap.live/license-en.html
- Atribúcia: „a text reference, the DeepStateMap.live logo, or a direct link to the Objects" (sekcia 3)
- Aktualizácia: Zmluva: „Last Updated: September 3rd, 2025"; platnosť „until December 31, 2030, and automatically renews annually"
- Pokrytie: Web deepstatemap.live, jeho obsah, kód, dizajn, štruktúra, API, textové a vizuálne materiály
- Riziká / poznámky: OKO nie je ani „volunteer/charitable", ani „defense of Ukraine", ani komerčný subjekt → kategória nepokrytá zmluvou = treba požiadať cez https://api.deepstatemap.live/request (stránka je čisto JS, formulár som nevypĺňal). Server-side proxy OKO, ktorá by API republikovala prehliadaču, môže naraziť na zákaz „proxying ... transferring the API to third parties" — riešiť v žiadosti. Po incidente Polymarket (11/2025) DeepState zaviedol individuálne klientske kľúče a vyhlásil, že nestíha vydávať nové. GitHub scraper cyterat/deepstate-map-data (GPL-3.0, denne 03:00 UTC) NEMÁ deklarované povolenie DeepState → nepoužívať ako dátovú cestu. Spor sa rieši podľa ukrajinského práva.
- Dôkazy:
  - https://deepstatemap.live/license-en.html — sekcia 3: „Visual materials containing a text reference, the DeepStateMap.live logo, or a direct link to the Objects may be freely used for both commercial and non-commercial purposes."; „Textual materials containing a text reference, the DeepStateMap.live logo, or a direct link to the Objects may also be freely used for both commercial and non-commercial purposes."
  - https://deepstatemap.live/license-en.html — sekcia 2: „The API is provided for free to entities engaged in: Volunteer and charitable activities (upon the Copyright Holder's request, they are obliged to provide confirmation of such activity). Activities for the defense of Ukraine, its sovereignty, and territorial integrity."; „Entities operating on a commercial basis may use the API only with prior approval from the Copyright Holder by sending a request at https://api.deepstatemap.live/request."; „Unauthorized distribution, publication, proxying, or other methods of transferring the API to third parties are prohibited."
  - https://deepstatemap.live/license-en.html — sekcia 5: „The creation of identical objects that completely match the Objects is prohibited."; držiteľ práv „DEEPSTATEUATECH LLC"; „Disputes are to be resolved through negotiations or, if necessary, in court under Ukrainian law."; „Last Updated: September 3rd, 2025"
  - https://dev.ua/en/news/deepstatemap-ne-davala-dozvolu-na-intehratsiiu-z-bukmekeramy-1764227535 — (27. 11. 2025) „DeepStateMap did NOT give permission for integration with bookmakers."; „This forced us to introduce stricter API control and create individual client keys."; „Because of such individuals, we do not have time to process the issuance of new keys."
  - https://github.com/cyterat/deepstate-map-data — README: aktualizácia „Daily, at 03:00 UTC", licencia GPL-3.0, žiadna zmienka o povolení DeepState ani o atribúcii (neoficiálny scraper)

### DeepState — legenda a metodika „sivej zóny" (Pohorilyj pre Glavcom 11/2025) + OPSEC pravidlá + disclaimer o evakuácii

- URL: https://glavcom.ua/publications/usi-vidtinki-tumanu-vijni-chomu-na-mapakh-deepstate-velika-sira-zona-1090313.html
- Druh / formát / prístup: methodology · HTML (rozhovory/vysvetlenia v UA médiách, Wikipedia, popis aplikácie v App Store) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (novinárske texty; citovať s odkazom). Samotná mapa: licenčná zmluva DeepState (samostatný zdroj)
- Licencia URL: https://deepstatemap.live/license-en.html
- Atribúcia: DeepStateMap.live / DeepStateUA; citáty: Roman Pohorilyj (spoluzakladateľ) pre Glavcom, Kyiv Post, Kyiv Independent
- Aktualizácia: Minimálne denne; podľa ukrajinských veliteľov sa zmeny objavia 2–3 dni po udalosti (zámerné zdržanie z OPSEC dôvodov)
- Pokrytie: Celý front; legenda: oslobodené za posledné 2 týždne / oslobodené / „territory that needs to be clarified" (sivá) / okupované RF / Krym+ORDLO / Podnestersko / jednotky RF, veliteľstvá, letiská, flotila, smery útokov. Sivá zóna = „rozmazaná línia dotyku", od 2025/26 fakticky = zóna infiltrácie
- Riziká / poznámky: Sivá zóna DeepState je široká a inak definovaná než u ISW (ISW ju kreslí ako „assessed Russian advances"/infiltration polygóny) → NIKDY nespájať vrstvy DeepState a ISW do jedného polygónu bez vysvetlenia. DeepState nepoužíva ruské zdroje a nezobrazuje pozície UA jednotiek (OPSEC). Kritika z UA armády: niekedy „príliš rýchli", inde 2–3 dni pozadu. UI OKO musí niesť rovnaké varovanie: mapa nie je na plánovanie evakuácie/trás.
- Dôkazy:
  - https://glavcom.ua/publications/usi-vidtinki-tumanu-vijni-chomu-na-mapakh-deepstate-velika-sira-zona-1090313.html — (28. 11. 2025) Pohorilyj: „Коли лінія боєзіткнення розмита, ми позначаємо цю місцевість як сіру зону"; „Там є наші позиції, але русня через них просочується"; „ми не женемося за швидкістю, бо розуміємо, що від наших мап залежить життя"; porovnanie: ISW označuje sporné oblasti ako „assessed Russian gains in Ukraine"
  - https://glavcom.ua/country/incidents/sira-zona-na-kartakh-liniji-frontu-deepstate-shcho-tse-oznachaje-pojasnennja-osinteriv--1090825.html — (30. 11. 2025) „Our positions can be kilometers apart, and orc groups seep through them into our rear (even a term emerged—infiltration), so enemy groups or even positions can be in our rear."; sivá zóna nie je ani červená (naše pozície tam sú), ani modrá (nepriateľ sa tam „rojí")
  - https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/ — (2. 12. 2025) „DeepState Map updates tend to come 2-3 days after developments on the ground."; „From the viewpoint of informational hygiene, it's good that we can say that our map assessment is based on open sources."
  - https://www.kyivpost.com/post/57024 — (27. 7. 2025) „For operational security reasons, DeepState does not pinpoint Ukrainian units – only the territory they have taken."; „We would rather close down the project altogether, than be a source of lies"; „On occasions, including when land was seized during Ukraine's invasion of Russia's Kursk region last year, the co-founders agreed with the Ukraine military to withhold sensitive information."
  - https://en.wikipedia.org/wiki/DeepStateMap.Live — „Russian sources are not taken into account when compiling the map, according to map admin Pohorilyi."; memorandum s MO Ukrajiny 13. 3. 2024; zdroje: geolokované fotky/videá, sledovatelia pri fronte, stovky vojakov potvrdzujúcich/vyvracajúcich; varovanie pred „using the map to plan evacuation routes, combat areas, or undertaking in other sensitive and highly specific activities"
  - https://apps.apple.com/hn/app/deepstatemap/id6443851995?l=en-GB — legenda: „territory of Ukraine liberated from occupation in the last two weeks; liberated territory; territory that needs to be clarified; territory occupied by Russian troops; territory of the occupied Crimea and ORDLO; territory of Transnistria; unit; headquarters; airfields; fleet; directions of attacks."
  - https://gwaramedia.com/karti-bojovih-dij-v-ukraini-oglyad-najpopulyarnishih-resursiv/ — (akt. 6. 10. 2025) „Не використовуйте карти для планування дій: перевезення гуманітарної допомоги, евакуації тощо."

### Meduza — „Why Meduza's map of the front line doesn't look like DeepState's or ISW's" (porovnanie metodík a oneskorení)

- URL: https://meduza.io/en/feature/2026/08/18/why-meduza-s-map-of-the-front-line-in-ukraine-doesn-t-look-like-deepstate-s-or-isw-s-plus-answers-to-dozens-more-questions-from-readers
- Druh / formát / prístup: methodology · HTML (článok) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (redakčný obsah Meduzy; citovať s odkazom)
- Licencia URL: https://meduza.io/en/feature/2026/08/18/why-meduza-s-map-of-the-front-line-in-ukraine-doesn-t-look-like-deepstate-s-or-isw-s-plus-answers-to-dozens-more-questions-from-readers
- Atribúcia: Meduza (18. 8. 2026)
- Aktualizácia: Jednorazový článok; mapa Meduzy sa aktualizuje priebežne z ~100 geolokovaných klipov týždenne
- Pokrytie: Celý front; porovnanie 3 prístupov: Meduza = len geolokované video, bez sivej zóny; DeepState = anonymné zdroje v UA armáde + veľká sivá zóna; proruské (LostArmour) = info z ruskej armády
- Riziká / poznámky: Meduza je ruskojazyčné exilové médium (Lotyšsko), NIE je v prílohe XV EÚ (sankcie sa netýkajú). Kritika DeepState („sivá zóna skrýva reálne ruské zisky") je stanovisko Meduzy — v UI uvádzať ako rozdiel metodík, nie ako fakt. Oneskorenia: neskoro publikované klipy a nespoľahlivé zdroje.
- Dôkazy:
  - https://meduza.io/en/feature/2026/08/18/why-meduza-s-map-of-the-front-line-in-ukraine-doesn-t-look-like-deepstate-s-or-isw-s-plus-answers-to-dozens-more-questions-from-readers — „We draw them solely from geolocated video; roughly 100 new clips surface each week."; „We use geolocations produced by numerous research projects, checking each one ourselves, along with geolocations of our own."
  - https://meduza.io/en/feature/2026/08/18/why-meduza-s-map-of-the-front-line-in-ukraine-doesn-t-look-like-deepstate-s-or-isw-s-plus-answers-to-dozens-more-questions-from-readers — „The Ukrainian project DeepState prefers data from anonymous sources inside Ukraine's military."; „DeepState's use of a huge 'gray zone,' behind which actual Russian territorial gains are often hidden."; „We don't count the 'gray zone'—though it certainly exists, and its depth varies considerably from one part of the front to another."
  - https://meduza.io/en/feature/2026/08/18/why-meduza-s-map-of-the-front-line-in-ukraine-doesn-t-look-like-deepstate-s-or-isw-s-plus-answers-to-dozens-more-questions-from-readers — „Sometimes that's because clips are posted late—a lag occasionally detectable from the weather, the damage, and other details—but more often the cause is unreliable information from sources."; „Pro-Russian counterparts such as LostArmour draw on information from the Russian military"

### Kyiv Independent — „Where is Ukraine's front line? The answer is getting harder, and more political" (definícia sivej zóny, Black Bird Group, oneskorenia)

- URL: https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/
- Druh / formát / prístup: methodology · HTML (článok) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (redakčný obsah; citovať s odkazom)
- Licencia URL: https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/
- Atribúcia: Kyiv Independent (2. 12. 2025)
- Aktualizácia: Jednorazový článok
- Pokrytie: Celý front; ako DeepState, ISW a Black Bird Group chápu „kontrolu" a „sivú zónu" v dronovej vojne
- Riziká / poznámky: Článok upozorňuje, že mapovanie sa stalo „politickým" — farba obce ovplyvňuje naratív; OKO má v karte vždy uviesť zdroj + dátum snímku + typ kategórie (assessed/claimed/grey).
- Dôkazy:
  - https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/ — „Most maps, including DeepState's, show a so-called 'gray zone,' a contested area in between territory assessed as firmly Ukrainian or Russian controlled."
  - https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/ — Black Bird Group: „When we paint an area as Russian or Ukrainian-controlled, it's more like here the Ukrainians or Russians generally have more control than the other side."
  - https://kyivindependent.com/the-blurred-front-line-of-ukraines-drone-dominated-battlefield-is-making-mapping-harder-and-more-political/ — „DeepState Map updates tend to come 2-3 days after developments on the ground."; DeepState o Torecku ako o „šaláte" bez reálnej línie dotyku počas mestských bojov

### Rybar (Michail Zvinčuk / Rybar LLC) — sankčný status EÚ/UK/USA, väzby na MO RF a Rostec, platená mapa map.rybar.ru

- URL: https://map.rybar.ru/en/
- Druh / formát / prístup: other · Telegram kanál (text + obrázky máp), platená webová mapa (JS, za registráciou a predplatným); legenda nedostupná bez predplatného · **paid**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear — podmienky map.rybar.ru sú za prihlásením („Спасибо за регистрацию! Для доступа к карте необходимо оформить подписку"); Telegram posty bez uvedenej licencie
- Licencia URL: https://map.rybar.ru/en/
- Atribúcia: Rybar (@rybar); pri akomkoľvek citovaní uviesť, že ide o subjekt sankcionovaný EÚ (Zvinčuk, 23. 6. 2023) a UK (Rybar LLC, 10. 12. 2025)
- Aktualizácia: Telegram: 5–6 podrobných správ denne (The Bell); mapa: nezistené
- Pokrytie: Celý front z ruskej perspektívy; podľa EÚ hlási aj „Ukrainian military positions"
- Riziká / poznámky: (1) Zvinčuk je na zozname prílohy I nariadenia 269/2014 → čl. 2(2) zakazuje sprístupňovať mu priamo či nepriamo finančné prostriedky; EK FAQ: služby/platby subjektu, ktorý listovaná osoba vlastní/ovláda, sa prezumujú ako jej → PREDPLATNÉ map.rybar.ru z EÚ = riziko porušenia sankcií, NEKUPOVAŤ. (2) Rybar NIE je v prílohe XV (zákaz vysielania) — podľa zoznamov ANCOM 3/2025 a NLconnect 12/2025; citovanie/odkaz nespadá pod čl. 2f, ale 20. balík (2026/506) zavádza „mirror" klauzulu. (3) Obsah = proruská propaganda s väzbou na MO RF/FSB a financovaním Rostec (US RfJ). (4) Eticky: Rybar zverejňuje polohy UA jednotiek → do OKO NIKDY nepreberať body jednotiek. (5) Legendu mapy som nenašiel (unclear); tvrdenie „systematicky nadhodnocuje ruské zisky" pochádza z menej autoritatívneho webu ukraine-war-analytics.com.
- Dôkazy:
  - https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1216 — položka 1571, 23. 6. 2023: „Mikhail Zvinchuk is a member of the working group established by President Putin in December 2022 to coordinate the mobilization efforts of the Russian Federation to support its war of aggression against Ukraine. Beyond his role in the working group, he is known as the creator of the pro-Russian military Telegram channel 'Rybar' reporting on Russian war efforts and Ukrainian military positions, as well as distributing disinformation and pro-Kremlin propaganda about the war."
  - https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32014R0269 — čl. 2(2): „No funds or economic resources shall be made available, directly or indirectly, to or for the benefit of natural persons or natural or legal persons, entities or bodies associated with them listed in Annex I."; čl. 1: „economic resources" = „assets of every kind, whether tangible or intangible, movable or immovable, which are not funds but may be used to obtain funds, goods or services"
  - https://finance.ec.europa.eu/system/files/2023-07/faqs-sanctions-russia-assets-freezes_en.pdf — (verzia 6. 5. 2026) „if the listed person is deemed to own or control a non-listed entity, it can be presumed that the control also extends to the assets of that entity"; „Labour and services can be considered as economic resources if they enable the listed person to obtain funds, goods or services"
  - https://www.occrp.org/en/news/uk-sanctions-pro-kremlin-dugin-rybar-and-pravfond-network — (10. 12. 2025) Zvinčuk je generálny riaditeľ Rybar LLC, ktorá prevádzkuje „the influential pro-war 'Rybar' Telegram channel that provides battlefield updates and narratives aligned with the Kremlin"; UK: asset freeze + trust services sanctions
  - https://rewardsforjustice.net/rewards/rybar/ — „Rybar LLC (also known as Rybar, Rybar OOO, and Project Rybar) is a Russian media organization previously funded by the deceased Russian mogul Yevgeniy Viktorovich Prigozhin."; „Rybar receives funding for contracted work from Russian defense industrial organization Rostec, which was sanctioned by the U.S. Department of the Treasury in June 2022."
  - https://en.thebell.io/unmasking-russia-s-influential-pro-war-rybar-telegram-channel/ — (22. 11. 2022) Rybar publikuje „highly detailed and swiftly updated maps"; „openly pro-Russian" ale „more or less objective in its assessments of the military situation"; Zvinčuk „a former employee of the Defense Ministry's press service"; ISW vraj cituje „20 links to Rybar in a single report when a major battle is underway"
  - https://map.rybar.ru/en/ — stránka po registrácii: „Спасибо за регистрацию! Для доступа к карте необходимо оформить подписку" (mapa je za predplatným; legenda/podmienky neviditeľné bez neho — neregistroval som sa)
  - https://ukraine-war-analytics.com/people/mapping-communities.html — Rybar „pro-Russian Telegram channel" whose „maps systematically overstated Russian territorial gains and understated losses" (menej autoritatívny zdroj, len ako indícia)

### EÚ sankcie na ruské médiá — nariadenie Rady (EÚ) 2022/350 (čl. 2f nariadenia 833/2014), FAQ Európskej komisie k médiám (17. 7. 2026), rozsudok SDEÚ C-67/25 (2. 7. 2026), „mirror" klauzula 20. balíka (2026/506)

- URL: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350
- Druh / formát / prístup: other · HTML/PDF (EUR-Lex), PDF (FAQ EK), PDF (rozsudok) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): Právne texty EÚ — voľne citovateľné (EUR-Lex reuse policy); FAQ EK = usmernenie, nie záväzný výklad
- Licencia URL: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350
- Atribúcia: Úradný vestník EÚ / Európska komisia (DG FISMA) / Súdny dvor EÚ
- Aktualizácia: FAQ EK naposledy aktualizované 17. 7. 2026; nariadenie priebežne novelizované balíkmi (posledná zmena čl. 2f: 2026/506, 23. 4. 2026)
- Pokrytie: Celá EÚ; zakázané je „vysielať alebo umožňovať, uľahčovať či inak prispievať k vysielaniu" akéhokoľvek obsahu subjektov z prílohy XV, vrátane internetu, ISP, video platforiem a aplikácií; výklad SDEÚ: aj súkromná osoba s webom financovaným darmi je „operátor"
- Riziká / poznámky: Čo SMIE OKO: recitál 11 — sankcie nebránia výskumu a rozhovorom; FAQ Q5 — iné médiá môžu použiť „extracts" sankcionovaných médií objektívne na informovanie, ale nie na obchádzanie zákazu. Čo NESMIE: republikovať/embedovať/proxyovať obsah (vrátane RSS, videí, máp) subjektov z prílohy XV alebo ich „mirror" domén — a to ani nekomerčne (C-67/25: dary-financovaný web = operátor, trestné stíhanie v DE). Prosté hypertextové odkazovanie FAQ výslovne nerieši → „unclear", v OKO radšej neodkazovať na domény z prílohy XV. Konzolidovaný zoznam prílohy XV = samostatný zdroj nižšie.
- Dôkazy:
  - https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350 — čl. 2f(1): „It shall be prohibited for operators to broadcast or to enable, facilitate or otherwise contribute to broadcast, any content by the legal persons, entities or bodies listed in Annex XV, including through transmission or distribution by any means such as cable, satellite, IP-TV, internet service providers, internet video-sharing platforms or applications."
  - https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R0350 — recitál 11: opatrenia „do not prevent those media outlets and their staff from carrying out other activities in the Union than broadcasting, such as research and interviews."; príloha XV (pôvodne): RT English/UK/Germany/France/Spanish, Sputnik
  - https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf — (akt. 17. 7. 2026) Q2: „broadcast" = „transmitting, disseminating or distributing any type of content in the broadest possible meaning (long videos, short video extracts, news items, radio etc.) to an audience regardless of the means of transmission"; Q4: povinnosti sa vzťahujú aj na „caching services, search engines, social media or hosting service providers"
  - https://finance.ec.europa.eu/document/download/99b8682b-4f41-4d78-9756-7087d0a93965_en?filename=faqs-sanctions-russia-media_en.pdf — Q5: „Media have the freedom to report and inform objectively on current events. In this regard, the Commission considers that extracts from targeted entities may be used by other operators in an objective way, to inform readers/viewers objectively and completely by illustrating the type of information given by the targeted outlets."; „the use of these extracts must not be used for circumvention of sanctions, which is also prohibited."
  - https://courthousenews.com/wp-content/uploads/2026/07/r-v-staatsanwaltschaft-saarbrcken-cjeu-judgment.pdf — C-67/25, 2. 7. 2026, výrok: „Article 2f(1) of Council Regulation (EU) No 833/2014...must be interpreted as meaning that a natural person who operates a website by broadcasting on it content originating from legal persons, entities or bodies listed in Annex XV to Regulation No 833/2014...comes within the concept of 'operator' within the meaning of that provision."
  - https://www.courthousenews.com/eus-top-court-says-russia-media-ban-reaches-donation-funded-bloggers/ — „operator" = „any natural or legal person directly or indirectly responsible for making available or transmitting that content to the public"; ziskový motív irelevantný; web financovaný darmi (60 000 € 4/2022–8/2023) reposťoval videá RT DE
  - https://www.skadden.com/insights/publications/2026/05/eu-20th-sanctions-package — nariadenie (EÚ) 2026/506 z 23. 4. 2026 rozširuje zákaz na „entities that mirror the content of entities already subject to the broadcasting ban"; kritériá: „Substantially identical content or feeds", „Continuity of branding or user interface", „Overlapping ownership or management", „Redirection of users", „Continuity of technical infrastructure"
  - https://www.consilium.europa.eu/en/press/press-releases/2022/03/02/eu-imposes-sanctions-on-state-owned-outlets-rtrussia-today-and-sputnik-s-broadcasting-in-the-eu/ — tlačová správa Rady 2. 3. 2022 (pôvodné opatrenie; stránka je za 403 pre automatizované načítanie, overené cez vyhľadávanie)

### Konsolidovaný zoznam médií v prílohe XV nariadenia 833/2014 (ANCOM 21. 3. 2025) + referenčný zoznam domén NLconnect (15. 12. 2025, 796 domén)

- URL: https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/
- Druh / formát / prístup: other · HTML (ANCOM) + PDF (NLconnect, zoznam domén vhodný na blocklist v proxy) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): ANCOM: verejná tlačová správa regulátora; NLconnect: unclear (odvetvový referenčný dokument, zostavený zo zoznamov regulátorov DE/AT/EE/FI/LT a DK)
- Licencia URL: https://www.nlconnect.org/files/pages/2025/12/NLconnect-Reference-List-EU-Media-Sanctions-v-15-12-25.pdf
- Atribúcia: ANCOM (rumunský regulátor) / NLconnect; primárny zdroj = príloha XV nariadenia (EÚ) 833/2014 v konsolidovanom znení
- Aktualizácia: Po každom balíku; podľa NLconnect 7 vĺn 2022–2025 (posledné doplnenie 2025/395, 16. balík, 24. 2. 2025); 17.–19. balík bez nových médií v prílohe XV (stav 15. 12. 2025); 20. balík = mirror klauzula bez menovite nových médií (Skadden); 21. balík (23. 7. 2026) som pre CAPTCHA/403 neoveril
- Pokrytie: Zoznam subjektov, ktorých obsah sa v EÚ nesmie šíriť: RT a Sputnik so všetkými dcérami, RTR Planeta, Russia 24, TV Centre International, NTV Mir, Rossiya 1, REN TV, Pervyi Kanal, RT Arabic, Sputnik Arabic, RT Balkan, Oriental Review, Tsargrad, New Eastern Outlook, Katehon, Voice of Europe, RIA Novosti, Izvestija, Rossiiskaja Gazeta, EADaily/Eurasia Daily, Fondsk, Lenta, NewsFront, RuBaltic, SouthFront, Strategic Culture Foundation, Krasnaya Zvezda/Tvzvezda
- Riziká / poznámky: Pre OKO: RIA Novosti, Izvestija, TASS? — POZOR: TASS v zozname NIE JE (stav 12/2025), ale RIA Novosti, Izvestija, Lenta, Rossijskaja gazeta, Zvezda ÁNO → GDELT/RSS filter v proxy musí tieto domény (a mirror domény) vyhadzovať. Rybar, LostArmour, Readovka a milbloggeri v prílohe XV nie sú (stav 12/2025). Zoznam NLconnect obsahuje aj zrkadlové domény — vhodný ako blocklist.
- Dôkazy:
  - https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/ — (21. 3. 2025) „Russia Today and Sputnik, with all their subsidiaries, RTR Planeta, Russia 24, TV Centre International, NTV Mir, Rossiya 1, REN TV, Pervyi Kanal, Oriental Review, Tsargrad, New Eastern Outlook, Katehon, Voice of Europe, RIA Novosti, Izvestija, Rossiiskaja Gazeta, EADaily/ Eurasia Daily, Fondsk, Lenta, NewsFront, RuBaltic, SouthFront, Strategic Culture Foundation and Krasnaya Zvezda/ Tvzvezda"
  - https://www.ancom.ro/en/about-us/media-en/press-releases/the-broadcasting-of-content-produced-by-certain-media-channels-is-prohibited-in-the-european-union/ — „Operators are prohibited from broadcasting or allowing, facilitating or otherwise contributing to the dissemination of any content" ... „by transmission or distribution by any means, such as cable, satellite, IP-TV, internet service providers, platforms or applications for sharing video materials on the internet, irrespective of whether they are new or pre-installed."
  - https://www.nlconnect.org/files/pages/2025/12/NLconnect-Reference-List-EU-Media-Sanctions-v-15-12-25.pdf — vlny: 2022/350 (RT, Sputnik); 2022/879 (Rossiya, RTR/RTR Planeta, Rossiya 24, TV Centre International); 2022/2474 (NTV/NTV Mir, Rossiya 1, REN TV, Pervyi Kanal); 2023/427 (RT Arabic, Sputnik Arabic); 2023/1214 (RT Balkan, Oriental Review, Tsargrad, New Eastern Outlook, Katehon); 2024/1428 (Voice of Europe, RIA Novosti, Izvestija, Rossiiskaja Gazeta); 2025/395 (EADaily, Fondsk, Lenta, NewsFront, RuBaltic, SouthFront, Strategic Culture Foundation, Krasnaya Zvezda); 796 domén vrátane subdomén a mirror stránok; verzia 15. 12. 2025
  - https://merlin.obs.coe.int/article/9822 — nariadenie Rady (EÚ) 2023/1214 z 23. 6. 2023: „The broadcasting licenses of RT Balkan, Oriental Review, Tsargrad, New Eastern Outlook and Katehon have been suspended and are now no longer authorised to broadcast in the EU."
  - https://merlin.obs.coe.int/article/9772 — nariadenie 2023/427 (25. 2. 2023), účinnosť 10. 4. 2023: RT Arabic a Sputnik Arabic; zákaz „broadcasting, transmitting or distributing their services in the EU by any means"

### Wikimedia Commons — File:2022 Russian invasion of Ukraine.svg (CC BY-SA 4.0) + text licencie CC BY-SA 4.0 + výklad ShareAlike (CC wiki)

- URL: https://commons.wikimedia.org/wiki/File:2022_Russian_invasion_of_Ukraine.svg
- Druh / formát / prístup: other · SVG (2 199 × 1 478 px, 4,15 MB) — obrázok, nie georeferencovaný GeoJSON; konverzia na vrstvu = adaptácia · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): „This file is licensed under the Creative Commons Attribution-Share Alike 4.0 International license. You are free: to share – to copy, distribute and transmit the work; to remix – to adapt the work. Under the following conditions: attribution – You must give appropriate credit, provide a link to the license, and indicate if changes were made. You may do so in any reasonable manner, but not in any way that suggests the licensor endorses you or your use; share alike – If you remix, transform, or build upon the material, you must distribute your contributions under the same or compatible license as the original."
- Licencia URL: https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
- Atribúcia: Viewsridge (hlavný autor) et al., odvodené z Russo-Ukrainian conflict (2014-2022).svg (Rr016) a Ukraine adm location map improved.svg (Yakiv Gluck); zdroje kontroly: Wikipedia Template:Russo-Ukrainian War detailed map + ISW; uviesť odkaz na stránku súboru, licenciu a poznámku o zmenách
- Aktualizácia: Komunitne, nepravidelne (posledná úprava 24. 4. 2026 01:38 UTC — „update some villages"); na živý front nevhodné, ale OK ako historický/záložný snímok s dátumom
- Pokrytie: Celý front od 24. 2. 2022; kontrola RF/UA vrátane Krymu a ORDLO; legenda podľa Wikipedia modulu (červená = RF, žltá/okrová = UA, kontestované)
- Riziká / poznámky: Význam CC BY-SA pre webovú vrstvu: (1) samotný SVG zobrazený nezmenený vedľa iného obsahu = „mere aggregation" → ShareAlike sa NEspúšťa, OKO ako celok nemusí byť BY-SA; (2) vektorizácia/georeferencia do GeoJSON alebo prekreslenie = „Adapted Material" → odvodený dataset (GeoJSON) musí byť pod CC BY-SA 4.0 (alebo kompatibilnou), s atribúciou, odkazom na licenciu, vyznačením zmien a bez DRM/technických obmedzení; kód OKO tým dotknutý nie je. (3) Wikipedia mapa je sama kompilovaná z textových správ (pravidlo „Copying from maps is strictly prohibited"), takže nie je odvodená z ISW/DeepState polygónov — právne čistá, ale metodicky laickejšia (dobrovoľníci). (4) Nekonzistentné aktualizácie — v UI vždy dátum verzie súboru.
- Dôkazy:
  - https://commons.wikimedia.org/wiki/File:2022_Russian_invasion_of_Ukraine.svg — licenčný blok CC BY-SA 4.0 (citované vyššie); zdroje územnej kontroly: „Template: Russo-Ukrainian War detailed map / detailed relief map", „Institute for the Study of War (ISW)"; autori Viewsridge, Rr016, Yakiv Gluck; posledná zmena „April 24, 2026 (01:38 UTC) - 'update some villages'"
  - https://creativecommons.org/licenses/by-sa/4.0/legalcode.en — §1(a) „Adapted Material": „Material subject to Copyright and Similar Rights that is derived from or based upon the Licensed Material and in which the Licensed Material is translated, altered, arranged, transformed, or otherwise modified in a manner requiring permission under the Copyright and Similar Rights held by the Licensor."; §3(a) atribúcia: identifikácia tvorcu, copyright notice, odkaz na licenciu, disclaimer, URI, vyznačenie zmien; §3(b) ShareAlike: rovnaká alebo kompatibilná licencia, text/odkaz licencie, zákaz technických obmedzení
  - https://wiki.creativecommons.org/wiki/ShareAlike_interpretation — „The ShareAlike condition applies only for works considered adaptations under copyright law, not simply in collections with other works (also referred to as mere aggregations)."; „Simply including an SA work unmodified alongside unrelated materials does not produce an adaptation."; „Using a ShareAlike photo as a separate element within [a larger work] does not require original materials in the larger work to be ShareAlike or compatible. The larger work may be licensed under any terms."

### Wikipedia — Module:Russo-Ukrainian War detailed map/doc (pravidlá zdrojov, definícia „contested", legenda ikon)

- URL: https://en.wikipedia.org/wiki/Module:Russo-Ukrainian_War_detailed_map/doc
- Druh / formát / prístup: methodology · HTML (dokumentácia modulu; samotné dáta modulu = Lua tabuľka bodov na Wikipédii) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Text Wikipédie: CC BY-SA 4.0 (štandardná licencia Wikipédie)
- Licencia URL: https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License
- Atribúcia: Wikipedia contributors, Module:Russo-Ukrainian War detailed map
- Aktualizácia: Priebežne komunitou (denne až týždenne), bez garancie
- Pokrytie: Celý front; bodová (nie polygónová) legenda: modrá = UA, červená = RF+DNR/LNR, sivá = nekontrolované, zmiešaná = stabilná zmiešaná kontrola, animovaná = kontestované; polkruhy/oblúky = obliehanie/tlak z 8 smerov; infraštruktúra (základne, letiská, priehrady, priemysel)
- Riziká / poznámky: Dobrý vzor pre definíciu „strety/kontestované" v legende OKO (dôkaz, že nepriateľ je VNÚTRI sídla so značným počtom vojakov; prepady a nájazdy bez držania územia nestačia). Pravidlo trojstupňových zdrojov (neutrálne / stranícke len proti vlastnej strane / nespoľahlivé nikdy) je použiteľné ako editorská politika OKO pri ručných opravách. Nekopírovať z máp — Wikipedia sama zakazuje obkresľovanie máp.
- Dôkazy:
  - https://en.wikipedia.org/wiki/Module:Russo-Ukrainian_War_detailed_map/doc — trojstupňový systém zdrojov: neutrálne zdroje prípustné pre všetko; stranícke zdroje „only acceptable when reporting unfavorable information about their preferred side"; nespoľahlivé (neznáme weby, nepresné mapy) nikdy; „Copying from maps is strictly prohibited"
  - https://en.wikipedia.org/wiki/Module:Russo-Ukrainian_War_detailed_map/doc — kontestovaný status vyžaduje „evidence that the enemy is *inside* the town" so „significant number of troops actively holding territory"; menšie strety, prepady bez zabratia územia alebo nepriateľ na okraji mesta nestačia; väčšie mestá vyžadujú silnejší dôkaz
  - https://en.wikipedia.org/wiki/Module:Russo-Ukrainian_War_detailed_map/doc — legenda: modrá bodka Ukrajina, červená Rusko a spojenci (DNR/LNR), sivá nekontrolované, zmiešaná červeno-modrá = stabilná zmiešaná kontrola, animovaná = kontestované; kruhy/polkruhy = obliehanie alebo tlak z jednej strany

### Bellingcat — „Notes from the Digital Field: Ethical Dilemmas in Open Source Research" (etika geolokácie a identifikácie osôb)

- URL: https://www.bellingcat.com/resources/2023/09/18/notes-from-the-digital-field-ethical-dilemmas-in-open-source-research/
- Druh / formát / prístup: methodology · HTML (článok) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (redakčný obsah Bellingcat; citovať s odkazom)
- Licencia URL: https://www.bellingcat.com/resources/2023/09/18/notes-from-the-digital-field-ethical-dilemmas-in-open-source-research/
- Atribúcia: Bellingcat (18. 9. 2023)
- Aktualizácia: Jednorazový text
- Pokrytie: Etické dilemy OSINT: zverejnenie plnej geolokácie vs. bezpečnosť natáčajúceho civilistu; publikovanie zoznamov vojakov; práva príbuzných; proporcionalita zverejnenia
- Riziká / poznámky: Pre OKO odvodené mantinely: (1) neukladať ani nezobrazovať presnú polohu autora záberu; (2) žiadne mená/tváre vojakov ani civilistov, ani z verejne dostupných videí; (3) fakt, že obsah koluje na sociálnych sieťach, nezbavuje zodpovednosti — každá udalosť má prejsť testom verejného záujmu vs. škody.
- Dôkazy:
  - https://www.bellingcat.com/resources/2023/09/18/notes-from-the-digital-field-ethical-dilemmas-in-open-source-research/ — „Sharing the full geolocation demonstrates transparency, building trust at a time when disinformation about footage from Ukraine is rampant. But it could also endanger the civilian who recorded it"
  - https://www.bellingcat.com/resources/2023/09/18/notes-from-the-digital-field-ethical-dilemmas-in-open-source-research/ — Jennefer Harper o zozname vojakov: „I struggled with the thought that quite likely many [of the soldiers on the list] had little choice in joining the war and many were forced by the Russian government to serve"
  - https://www.bellingcat.com/resources/2023/09/18/notes-from-the-digital-field-ethical-dilemmas-in-open-source-research/ — „Simply reporting every finding of an investigation comes with significant risks; the fact that content has circulated on social media does not absolve open source researchers of the need to think critically"; Aiganysh Aidarbekova: „Either you tell the audience how you did the open source research or respect [relatives'] rights and not publish much."

### Berkeley Protocol on Digital Open Source Investigations (OHCHR + Human Rights Center UC Berkeley) — profesijné a etické zásady

- URL: https://humanrights.berkeley.edu/wp-content/uploads/archive/2024/02/Berkeley-Protocol.pdf
- Druh / formát / prístup: methodology · PDF (EN; aj v ďalších jazykoch OSN) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (publikácia OSN/OHCHR; voľne stiahnuteľná, licencia v PDF neuvedená v čitateľnej časti)
- Licencia URL: https://www.ohchr.org/en/publications/policy-and-methodological-publications/berkeley-protocol-digital-open-source
- Atribúcia: Office of the UN High Commissioner for Human Rights & Human Rights Center, UC Berkeley School of Law (2020, PDF vydanie 2022)
- Aktualizácia: Statický štandard (2020)
- Pokrytie: Medzinárodný štandard OSINT vyšetrovania: legalita vrátane ochrany dát (§28), bezpečnostné povedomie (§29), minimalizácia dát (§31), security by design (§33), dôstojnosť (§34), vizuálne reportovanie bez zbytočného utrpenia (§72)
- Riziká / poznámky: Pre OKO: uplatniť §31 (zbierať len to, čo je odôvodnené, nevyhnutné a proporcionálne) → z OSINT správ ukladať len typ udalosti, čas, miesto, zdroj; nikdy osobné údaje, tváre, mená; §72 → v kartách nezobrazovať zábery utrpenia. OHCHR stránka a EN PDF na ohchr.org vracali 403/FR verziu — použité PDF z HRC Berkeley.
- Dôkazy:
  - https://humanrights.berkeley.edu/wp-content/uploads/archive/2024/02/Berkeley-Protocol.pdf — §31 (data minimization): „online content should only be collected if it is: (a) justified for an articulable purpose; (b) necessary for achieving that purpose; and (c) proportional."
  - https://humanrights.berkeley.edu/wp-content/uploads/archive/2024/02/Berkeley-Protocol.pdf — §28: „investigators should be aware of data protection laws and the right to privacy, which is protected under international human rights law."; §29: „All individuals conducting investigations online should have basic operational security awareness to ensure that they minimize their digital trail."
  - https://humanrights.berkeley.edu/wp-content/uploads/archive/2024/02/Berkeley-Protocol.pdf — §34 (dignity): „Investigations should be conducted with an awareness of and sensitivity to any underlying dignity-related issues" vrátane „safeguards concerning the digital, physical and psychosocial security of witnesses, survivors, other investigators"; §72: vyhnúť sa „showing the full extent of suffering or violence if it is not necessary"
  - https://humanrights.berkeley.edu/publications/berkeley-protocol-on-digital-open-source-investigations/ — rok vydania 2020; Protokol „provides guidance on methodologies and procedures for gathering, analysing, and preserving digital information in a professional, legal, and ethical manner"

### Trestný zákon Ukrajiny čl. 114-2 — zákaz nepovoleného šírenia informácií o presunoch/rozmiestnení Ozbrojených síl Ukrajiny (zákon č. 7189, 24. 3. 2022)

- URL: https://www.pravda.com.ua/eng/news/2022/03/24/7334211/
- Druh / formát / prístup: other · HTML (Ukrajinska Pravda EN + výklad advokátskej kancelárie) · **open-download**
- Strojovo čitateľné: nie
- Licencia (doslovne): unclear (redakčný/právny výklad; samotný text zákona je verejný právny akt Ukrajiny)
- Licencia URL: https://www.pravda.com.ua/eng/news/2022/03/24/7334211/
- Atribúcia: Ukrainska Pravda (24. 3. 2022); Prikhodko & Partners (výklad čl. 114-2)
- Aktualizácia: Statická norma (platí počas vojnového stavu)
- Pokrytie: Ukrajina: trestné je neoprávnené šírenie informácií o smerovaní a presune medzinárodnej vojenskej pomoci a o pohybe, presune alebo rozmiestnení OS Ukrajiny počas vojnového/výnimočného stavu; výnimka = informácie zverejnené Generálnym štábom/MO Ukrajiny alebo s ich písomným súhlasom
- Riziká / poznámky: Priamy právny dôvod, prečo DeepState (a ISW policy) nezobrazujú pozície UA jednotiek — a prečo OKO nesmie z OSINT (Rybar, milbloggeri, geolokované videá) preberať body/polohy ukrajinských jednotiek, veliteľstiev či presunov techniky. Modelovať len RU jednotky/udalosti/územie podľa oficiálnych alebo etablovaných OSINT zdrojov; UA strana = len územie, nikdy jednotky. Prípady SBU (2026) ukazujú aktívne vymáhanie.
- Dôkazy:
  - https://www.pravda.com.ua/eng/news/2022/03/24/7334211/ — zákon kriminalizuje „Unauthorised dissemination of information on the direction, movement of international military assistance to Ukraine, movement, displacement or deployment of the Armed Forces of Ukraine or other military formations of Ukraine, conducted under martial law or emergency."
  - https://www.pravda.com.ua/eng/news/2022/03/24/7334211/ — sadzby: presuny/rozmiestnenie vojsk „imprisonment for five to eight years"; smerovanie vojenskej pomoci „imprisonment for a term of three to five years"; kvalifikované (skupina, zisk, pomoc agresorovi) „imprisonment for a term of eight to twelve years"; výnimka: informácie „made public by the General Staff of the Armed Forces, or without obtaining written permission of the General Staff for its dissemination"
  - https://prikhodko.com.ua/en/media/media/article/what-is-the-risk-of-filming-and-publishing-the-positions-of-the-armed-forces-article-114-2-of-the-criminal-code-of-ukraine-2/ — 24. 3. 2022 Verchovna rada prijala návrh zákona č. 7189, ktorý doplnil čl. 114-2; časť 1 (natáčanie/fotenie pozícií) 3–5 rokov, časť 2 (zverejnenie) 5–8 rokov, časť 3 (skupina/odovzdanie agresorovi) 8–12 rokov; dôvod stíhania: MO, GŠ, SBU ani HUR informáciu nezverejnili

**Poznámky nálezcu (notes):** ČO SOM HĽADAL A NAŠIEL (stav 19. 9. 2026): 1) Legenda/definície: ISW má formálnu metodickú stránku (control = FM 3-90-1, FLOT, infiltračné polygóny od 6. 11. 2025, žiadne UA pozície „by policy\") a v denných hodnoteniach konzistentne rozlišuje geolokované „assessed advances\" vs. „infiltration\" (bez zmeny kontroly terénu) vs. „claimed\" (tvrdenia bez dôkazu). DeepState nemá formálny metodický dokument — legenda je len v popise aplikácie (App Store) a výklad sivej zóny pochádza z rozhovorov Pohorilého (Glavcom 28./30. 11. 2025): sivá = rozmazaná línia dotyku, dnes fakticky zóna infiltrácie; ISW to isté kreslí ako „assessed Russian advances\"/infiltration → obe vrstvy sa NESMÚ zlievať. Wikipedia modul dáva použiteľnú definíciu „contested\" (nepriateľ vnútri sídla so značným počtom vojakov) a trojstupňové pravidlo zdrojov. 2) Rozdiely a oneskorenia: DeepState 2–3 dni za realitou (zámerne, OPSEC; Kyiv Independent 12/2025), nepoužíva ruské zdroje, UA armáda ho niekedy kritizuje za rýchlosť; ISW drží „najďalej posúdený rozsah\" ruského postupu, kým neprevládnu protidôkazy → podhodnocuje UA postupy; Meduza (8/2026) kreslí len z geolokovaného videa (~100 klipov/týždeň) bez sivej zóny a tvrdí, že sivá zóna DeepState skrýva ruské zisky; proruské mapy (Rybar, LostArmour) čerpajú z ruskej armády. 3) Právo: ISW Fair Use policy — statický obrázok nekomerčne s „Source: Institute for the Study of War\" OK, ale „incorporation ... into mapping platforms\" a akékoľvek shapefile/datasety = len s písomným súhlasom (/terms-use neexistuje). DeepState licenčná zmluva (3. 9. 2025): screenshoty/text s odkazom voľne aj komerčne; API zadarmo len pre dobrovoľnícke/charitatívne/obranné subjekty, komerční len so súhlasom, proxying zakázaný; OKO (nekomerčný, ale nie charita) spadá do medzery → poslať žiadosť cez api.deepstatemap.live/request (formulár som NEVYPĹŇAL). Wikimedia SVG: CC BY-SA 4.0 — nezmenený obrázok vedľa iného obsahu = agregácia (bez SA nákazy), vektorizácia do GeoJSON = adaptácia → odvodený dataset BY-SA, appka nie. EÚ médiá: čl. 2f (2022/350) zakazuje šíriť/uľahčovať šírenie obsahu subjektov prílohy XV vrátane internetu; recitál 11 dovoľuje výskum a rozhovory; FAQ EK (17. 7. 2026) dovoľuje objektívne „extracts\" médiám, ale nie obchádzanie; SDEÚ C-67/25 (2. 7. 2026): aj súkromný web financovaný darmi je „operátor\"; 20. balík (2026/506) pridal „mirror\" klauzulu. Konsolidovaný zoznam (ANCOM 3/2025, NLconnect 12/2025 = 796 domén): RT, Sputnik, RIA Novosti, Izvestija, Lenta, Rossijskaja gazeta, Zvezda… — TASS ani Rybar v prílohe XV NIE SÚ. Rybar: Zvinčuk EÚ-listovaný (269/2014, 23. 6. 2023, „reporting on ... Ukrainian military positions\"), Rybar LLC UK-listovaná (12/2025), financovanie Rostec (US RfJ) → predplatné map.rybar.ru = riziko čl. 2(2) (sprístupnenie prostriedkov), NEKUPOVAŤ; citovanie/odkaz nie je zakázané, ale je to propaganda. 4) Etika (čo NESMIE do OKO): polohy/mená/tváre UA jednotiek a vojakov (Trestný zákon UA čl. 114-2, DeepState OPSEC, ISW policy), presná geolokácia autora záberu (Bellingcat), zoznamy osôb, zábery utrpenia (Berkeley §72), osobné údaje nad rámec typ/čas/miesto/zdroj (Berkeley §31); ruské jednotky/veliteľstvá zobrazuje aj DeepState — prípustné len z etablovaných zdrojov, nikdy z vlastnej geolokácie osôb. Do UI: dátum snímku, typ kategórie (assessed/claimed/grey) a varovanie „nie na plánovanie evakuácie\" (DeepState/gwaramedia).  ČO SOM NENAŠIEL / SLEPÉ ULIČKY: Rybar legenda mapy (map.rybar.ru je za registráciou+predplatným, neregistroval som sa) → unclear. Samostatná ISW definícia „Claimed Russian control\"/„Reported Ukrainian counteroffensives\" — storymapa ArcGIS je čisto JS; trojstupňová definícia z výsledku vyhľadávača nie je overená stránkou → neuvádzam ako fakt. Critical Threats a Consilium blokujú automatický fetch (403/CAPTCHA) — Critical Threats prečítané cez reader proxy, tlačové správy Rady k 20./21. balíku a k „propaganda\" listingom z 15. 6. 2026 neprečítané (CAPTCHA som neobchádzal); 21. balík (23. 7. 2026) preto nie je overený pre prípadné nové médiá v prílohe XV („27 outlets\" v súhrne Rady zodpovedá existujúcemu zoznamu, ale neitemizoval som). EC FAQ k médiám a Berkeley Protocol sú PDF — lokálne bez pdftoppm/Pythonu, čítané cez proxy; OHCHR EN PDF vracia 403/FR verziu. api.deepstatemap.live/request je JS bez viditeľných podmienok. Liveuamap a Militarnyi podmienky som v tomto uhle neskúmal. DeepState formálny text disclaimeru o evakuácii existuje len sprostredkovane (Wikipedia, gwaramedia), nie na deepstatemap.live (SPA).

## F. Podkladové geodáta (sídla uk/ru/en, hranice, cesty, opevnenia v OSM, DEM)

Zdrojov: 12.

### GeoNames gazetteer – sídla s alternatívnymi menami uk/ru/en (UA.zip, RU.zip, alternateNamesV2.zip, cities500.zip)

- URL: https://download.geonames.org/export/dump/
- Druh / formát / prístup: basemap · TSV (tab-delimited text v ZIP); UA.zip 2,3 MB, RU.zip 15 MB, alternateNamesV2.zip 195 MB (všetky jazyky, filtrovať podľa geonameid + isolanguage uk/ru/en), cities500.zip 13 MB, admin1CodesASCII.txt 148 K · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): readme.txt: "This work is licensed under a Creative Commons Attribution 4.0 License, see https://creativecommons.org/licenses/by/4.0/"; export stránka: "You should give credit to GeoNames when using data or web services with a link or another reference to GeoNames."
- Licencia URL: https://download.geonames.org/export/dump/readme.txt
- Atribúcia: „Sídla: GeoNames.org (CC BY 4.0)“ s odkazom na geonames.org
- Aktualizácia: denné dumpy (súbory datované 2026-09-19 03:5x CET)
- Pokrytie: Celá Ukrajina vrátane Krymu – GeoNames vedie Krym (UA.14) a Sevastopoľ (UA.13) pod UA; feature class P = "city, village,..."; alternateNamesV2 nesie isolanguage "iso 639 language code 2- or 3-characters" → uk/ru/en mená k jednému geonameid. Čerstvé (denne).
- Riziká / poznámky: Bundlovať snímok: ÁNO (CC BY, atribúcia v UI). alternateNamesV2 má 195 MB – filtrovať v build skripte, do klienta len UA (+ pohraničné RU) záznamy. Kvalita mien dedín kolíše (transliterácie), ru meno nie je vždy vyplnené. API kredity (10 000/deň) sa dumpov netýkajú.
- Dôkazy:
  - https://download.geonames.org/export/dump/readme.txt
  - https://download.geonames.org/export/dump/
  - https://www.geonames.org/export/
  - https://www.geonames.org/UA/administrative-division-ukraine.html

### OpenStreetMap – výrez Ukrajina (Geofabrik) pre sídla, cesty, rieky, admin hranice a mená name:uk/ru/en

- URL: https://download.geofabrik.de/europe/ukraine.html
- Druh / formát / prístup: basemap · ukraine-latest.osm.pbf 836 MB; ukraine-latest-free.shp.zip 1,7 GB; ukraine-latest-free.gpkg.zip 1,7 GB (alebo Overpass výrez ako pri plynovodoch) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): ODbL 1.0. openstreetmap.org/copyright: "You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors." a "If you alter or build upon our data, you may distribute the result only under the same license."
- Licencia URL: https://www.openstreetmap.org/copyright
- Atribúcia: „© OpenStreetMap contributors“ (ODbL)
- Aktualizácia: denne (Geofabrik: dáta k 2026-09-18T20:21:10Z); Overpass minútovo
- Pokrytie: Celá Ukrajina, stránka výslovne „Ukraine (with Crimea)“. Empiricky (Overpass 19. 9. 2026, place=city|town v bbox 44–52,5 N / 22–40,5 E): 4 154 objektov, name:uk 3 391, name:ru 3 403, name:en 3 037 → trojjazyčné mená sú v OSM prakticky kompletné pre mestá; dediny treba doplniť GeoNames. Admin schéma (Uk wiki): admin_level 4 = "межі Автономної Республіки Крим (АРК), областей, міст Києва та Севастополя", 6 = rajóny, 8/9 = rady a sídla; reforma 2020 zapracovaná, ale "(Реформу в Автономній Республіці Крим було відкладено до деокупації півострова.)"
- Riziká / poznámky: Bundlovať snímok: ÁNO, ale odvodená DB ostáva ODbL (share-alike) – rovnaké pravidlo ako plynovody (vlastný súbor, nemiešať s CC BY dátami). Vojna: OSM Ukrajina wiki žiada "We urge everyone to refrain from any mapping of the territory of Ukraine at the moment!" → cesty/mosty na okupovaných územiach môžu byť zastarané (zničené mosty nemusia byť zmazané). Filtrovať v builde: place=*, highway=motorway|trunk|primary|secondary(+tertiary pri zoome), waterway=river|canal, natural=water, boundary=administrative admin_level 4/6, railway=rail.
- Dôkazy:
  - https://download.geofabrik.de/europe/ukraine.html
  - https://www.openstreetmap.org/copyright
  - https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A50%5D%3Bnwr%5B%22place%22~%22%5E(city%7Ctown)%24%22%5D(44%2C22%2C52.5%2C40.5)-%3E.p%3B.p%20out%20count%3Bnwr.p%5B%22name%3Aru%22%5D-%3E.r%3B.r%20out%20count%3Bnwr.p%5B%22name%3Aen%22%5D-%3E.e%3B.e%20out%20count%3Bnwr.p%5B%22name%3Auk%22%5D-%3E.u%3B.u%20out%20count%3B
  - https://wiki.openstreetmap.org/wiki/Uk:%D0%92%D1%96%D0%BA%D1%96%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82_%D0%A3%D0%BA%D1%80%D0%B0%D1%97%D0%BD%D0%B0/%D0%90%D0%B4%D0%BC%D1%96%D0%BD%D1%96%D1%81%D1%82%D1%80%D0%B0%D1%82%D0%B8%D0%B2%D0%BD%D0%BE-%D1%82%D0%B5%D1%80%D0%B8%D1%82%D0%BE%D1%80%D1%96%D0%B0%D0%BB%D1%8C%D0%BD%D0%B8%D0%B9_%D1%83%D1%81%D1%82%D1%80%D1%96%D0%B9
  - https://wiki.openstreetmap.org/wiki/Russian%E2%80%93Ukrainian_war

### OpenStreetMap – opevnenia v tagoch (military=trench, barrier=tank_trap + tank_trap=dragons_teeth, military=bunker) cez Overpass

- URL: https://wiki.openstreetmap.org/wiki/Tag:military%3Dtrench
- Druh / formát / prístup: fortifications · Overpass API JSON (alebo ten istý PBF výrez) · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): ODbL 1.0 (viď OSM copyright: "You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors.")
- Licencia URL: https://www.openstreetmap.org/copyright
- Atribúcia: „© OpenStreetMap contributors“
- Aktualizácia: živé (Overpass), taginfo denne
- Pokrytie: Wiki: military=trench = "A military trench is an excavation in the ground that is generally deeper than it is wide, dug into the ground as a barrier for military purposes" (status In use); barrier=tank_trap = "A static anti-tank obstacle." s podtagom tank_trap=* ("Czech hedgehog", "Dragon's Teeth", "Toblerone line"). Taginfo 19. 9. 2026 globálne: military=trench 28 448 (26 145 ways), barrier=tank_trap 1 947, tank_trap hodnoty: toblerone 469, dragons_teeth 145, czech_hedgehog 92. VNÚTRI UKRAJINY (area relácie 60199): military=trench 1 762 (1 709 ways), barrier=tank_trap len 18, military=bunker 8 675 (prevažne historické objekty). Bbox s ruským pohraničím (44–53 N / 22–42 E): trench 3 299, tank_trap+bunker 13 591. Tag pre „hesco“ NEEXISTUJE – taginfo nájde len operator/name firiem „Hesco“.
- Riziká / poznámky: Surovikinova línia v OSM prakticky NIE JE (18 tankových zátarás v celej UA) – OSM nie je zdroj opevnení. OSM Ukrajina wiki: "We shall take action to amend (delete, modify, revert to the previous state etc.) any found cases of mapping related to military or critical social infrastructure facilities." s odkazom na čl. 114-2 TZ Ukrajiny (5–8 rokov). DWG (fórum #36, 27. 12. 2022): "'follow the local community' is the DWG view on mapping in Ukraine at this time." Eticky: ukrajinské opevnenia OKO nezobrazuje vôbec; ruské z OSM sú neúplné. Bundlovanie technicky OK (ODbL), vecne bezcenné.
- Dôkazy:
  - https://wiki.openstreetmap.org/wiki/Tag:military%3Dtrench
  - https://wiki.openstreetmap.org/wiki/Tag:barrier%3Dtank_trap
  - https://taginfo.openstreetmap.org/api/4/tag/stats?key=military&value=trench
  - https://taginfo.openstreetmap.org/api/4/tag/stats?key=barrier&value=tank_trap
  - https://taginfo.openstreetmap.org/api/4/key/values?key=tank_trap&sortname=count&sortorder=desc
  - https://taginfo.openstreetmap.org/api/4/search/by_value?query=hesco&sortname=count_all&sortorder=desc
  - https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A180%5D%3Barea(3600060199)-%3E.a%3Bnwr%5B%22military%22%3D%22trench%22%5D(area.a)-%3E.t%3B.t%20out%20count%3Bnwr%5B%22barrier%22%3D%22tank_trap%22%5D(area.a)-%3E.k%3B.k%20out%20count%3Bnwr%5B%22military%22%3D%22bunker%22%5D(area.a)-%3E.b%3B.b%20out%20count%3B
  - https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A90%5D%3B%28nwr%5B%22military%22%3D%22trench%22%5D%2844%2C22%2C53%2C42%29%3B%29%3Bout%20count%3B
  - https://wiki.openstreetmap.org/wiki/Russian%E2%80%93Ukrainian_war
  - https://community.openstreetmap.org/t/mapping-activities-in-active-war-zones-in-ukraine/7221/36

### HDX / OCHA COD-AB Ukraine – oficiálne hranice oblastí, rajónov, hromád a sídiel (zdroj SSPE „Kartographia“)

- URL: https://data.humdata.org/dataset/cod-ab-ukr
- Druh / formát / prístup: basemap · ukr_admin_boundaries.geojson.zip 80,1 MB; .shp.zip 77,8 MB; .gdb.zip 39,5 MB; .xlsx 6,0 MB (P-kódy) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Pole License na stránke datasetu: "Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)"
- Licencia URL: https://data.humdata.org/dataset/cod-ab-ukr
- Atribúcia: „Hranice: OCHA/HDX COD-AB Ukraine (CC BY-IGO), zdroj State Scientific Production Enterprise „Kartographia““
- Aktualizácia: "Expected update frequency Every year"; Modified 26 January 2026; posledná editácia dát 1. 9. 2025, revízia 18. 12. 2025 (verzia 05)
- Pokrytie: "Admin 1: 27 Oblast (Region) - Admin 2: 139 Raion (District) - Admin 3: 1769 Hromada (Community) - Admin 4: 29706 Settlement, partial coverage" – t. j. rajóny PO reforme 2020. Polia name/name1/name2/name3 + lang/lang1/lang2/lang3 (viacjazyčné mená; ktoré jazyky sú v ktorom slote, overiť po stiahnutí), pcode na každej úrovni, valid_on/valid_to. Bbox 22,14–40,23 E / 44,39–52,38 N (Krym vnútri).
- Riziká / poznámky: Bundlovať snímok: ÁNO (atribúcia). Caveat zo stránky: "The Ukrainian government has not fully implemented its new administrative structure reforms in the Autonomous Republic of Crimea [UA01] and Sevastopol [UA85] ... 31 ADM4 features within the Sevastopol ADM3 polygon retain P-codes that do not correctly conform to [UA85]." a "ADM4 layer does not cover the entire country." robots.txt HDX zakazuje autonómne sťahovanie /api/ a *.geojson → jednorazový ručný snímok, nie runtime proxy. Živé služby ITOS (codgis/gistmaps.itos.uga.edu) z tohto prostredia nedostupné (DNS) – overiť ručne.
- Dôkazy:
  - https://data.humdata.org/dataset/cod-ab-ukr
  - https://data.humdata.org/robots.txt
  - https://data.apps.fao.org/catalog/dataset/hdx-ocha-administrative-boundaries-cods-admin-2
  - https://www.geoboundaries.org/api/current/gbHumanitarian/UKR/ALL/

### geoBoundaries UKR (gbOpen + gbHumanitarian) – POZOR, licencie po úrovniach, ADM2 zastarané

- URL: https://www.geoboundaries.org/api/current/gbOpen/UKR/ALL/
- Druh / formát / prístup: basemap · GeoJSON / TopoJSON (GitHub raw, wmgeolab/geoBoundaries, commit 9469f09) · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): NIE jednotne CC BY 4.0. API gbOpen/UKR: ADM0 a ADM1 licenseDetail "Open Data Commons Open Database License 1.0", zdroj "OpenStreetMap, Wambacher", rok 2017; ADM2 "Public Domain", zdroj "geoBoundaries, Wikimedia Commons", rok 2006, 495 jednotiek; ADM3 "Creative Commons Attribution-ShareAlike 2.0", zdroj "Open Street Map", rok 2021, 10 375 jednotiek. gbHumanitarian/UKR ADM0–3: licenseDetail "Not available", licenseSource data.humdata.org/dataset/cod-ab-ukr (139 rajónov, 1 770 hromád, rok 2022). Titulná stránka: "CC BY 4.0" ... "most commercial, noncommercial, and academic uses" – platí len pre vlastnú prácu geoBoundaries, nie pre prevzaté zdroje.
- Licencia URL: https://www.geoboundaries.org/api/current/gbOpen/UKR/ALL/
- Atribúcia: "Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries. PLoS ONE 15(4): e0231866." + atribúcia pôvodného zdroja úrovne (OSM / HDX)
- Aktualizácia: statické, buildDate 12. 12. 2023
- Pokrytie: ADM2 = 495 rajónov z roku 2006 (PRED reformou 2020, dnes 136/139) → nepoužiteľné pre aktuálnu mapu; ADM1 27 oblastí (OSM 2017).
- Riziká / poznámky: Bundlovať: ADM1 áno (ODbL, share-alike), ADM2 PD ale zastarané, ADM3 CC BY-SA 2.0. Odporúčanie: brať HDX COD-AB priamo (čerstvejšie, jedna licencia). Nikdy nepísať do DATA_SOURCES „geoBoundaries CC BY 4.0“ pre UKR.
- Dôkazy:
  - https://www.geoboundaries.org/api/current/gbOpen/UKR/ALL/
  - https://www.geoboundaries.org/api/current/gbHumanitarian/UKR/ALL/
  - https://www.geoboundaries.org/

### GADM – NEPOUŽIŤ (zákaz redistribúcie)

- URL: https://gadm.org/license.html
- Druh / formát / prístup: other · GPKG / SHP / GeoJSON (admin 0–5) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): "The data are freely available for academic use and other non-commercial use." a "Redistribution or commercial use is not allowed without prior permission."
- Licencia URL: https://gadm.org/license.html
- Atribúcia: n/a
- Aktualizácia: n/a
- Pokrytie: globálne; pre OKO irelevantné
- Riziká / poznámky: OKO je nekomerčné, ale publikovanie snímku na oko.uhrin.digital = redistribúcia → bez povolenia zakázané. Nebundlovať, neproxovať. HDX COD-AB pokrýva to isté s CC BY-IGO.
- Dôkazy:
  - https://gadm.org/license.html

### Natural Earth 1:10m – populated places, admin-0 (POV Ukrajina), admin-1, rieky a jazerá

- URL: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/
- Druh / formát / prístup: basemap · SHP v ZIP (na GitHube nvkelso/natural-earth-vector aj GeoJSON/GPKG): ne_10m_populated_places 2,68 MB (v5.1.2); ne_10m_admin_1_states_provinces 14,22 MB (v5.1.1); ne_10m_admin_0_countries 4,7 MB + POV varianty Ukraine 4,68 MB / Russia 4,71 MB; ne_10m_rivers_lake_centerlines 1,98 MB + ne_10m_rivers_europe 585 KB; ne_10m_lakes 2,24 MB + ne_10m_lakes_europe 181 KB (v5.0.0) · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): "All versions of Natural Earth raster + vector map data found on this website are in the public domain." Odporúčaný (dobrovoľný) kredit: "Made with Natural Earth."
- Licencia URL: https://www.naturalearthdata.com/about/terms-of-use/
- Atribúcia: „Made with Natural Earth.“ (dobrovoľné, OKO ho aj tak uvedie)
- Aktualizácia: nepravidelne (v5.1.x)
- Pokrytie: Globálne, hrubé: rieky len hlavné toky (Dnipro, Siverskyj Donec…), sídla len väčšie mestá – pre mierku Lyman treba OSM waterway/place. Vhodné na prehľadové zoomy a vlajky (OKO už NE 1:50m používa).
- Riziká / poznámky: PREDVOLENE KRYM POD RUSKOM: "Natural Earth shows de facto boundaries by default according to who controls the territory, versus de jure." (stránka admin-0 aj admin-1). Pre OKO použiť POV súbor ne_10m_admin_0_countries_ukr a v admin-1 vlastnosti fclass_*; kontroverzia zdokumentovaná v issue #810. Bundlovať: ÁNO (public domain).
- Dôkazy:
  - https://www.naturalearthdata.com/about/terms-of-use/
  - https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/
  - https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/
  - https://www.naturalearthdata.com/downloads/10m-cultural-vectors/
  - https://www.naturalearthdata.com/downloads/10m-physical-vectors/
  - https://github.com/nvkelso/natural-earth-vector/issues/810

### Wikidata SPARQL – sídla Ukrajiny s labelmi uk/ru/en a súradnicami (obohatenie, nie primárny gazetteer)

- URL: https://query.wikidata.org/
- Druh / formát / prístup: basemap · SPARQL → JSON/CSV (format=json) · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): "All structured data in the main, property and lexeme namespaces is made available under the Creative Commons CC0 License (Public domain)"
- Licencia URL: https://www.wikidata.org/wiki/Wikidata:Licensing
- Atribúcia: nevyžaduje sa (CC0); OKO konvencia „Wikidata (CC0)“ ako pri LNG termináloch
- Aktualizácia: živé
- Pokrytie: Testovaný dotaz (P31=Q532 village, P17=Q212, P625) vrátil riadky s trojjazyčnými labelmi, napr. Q100114 Іванівка / Ивановка / Ivanivka (35,047 E 49,401 N). Počet pre P31 ∈ {village, city, town, urban-type settlement, city/town} so súradnicami = 2 578 – hlboko pod 29 706 sídlami v COD-AB; širší dotaz P31/P279* na Q486972 dvakrát vypršal (60 s) → modelovanie tried UA dedín je nejednotné. Použiť na doplnenie (odkazy, en/ru labely, populácia), nie ako hlavný zoznam sídiel.
- Riziká / poznámky: Bundlovať: ÁNO (CC0). Query Service vyžaduje User-Agent, dnes vrátil aj 429 (Retry-After 120) – dotazy stránkovať po oblastiach v builde, nikdy z klienta.
- Dôkazy:
  - https://www.wikidata.org/wiki/Wikidata:Licensing
  - https://query.wikidata.org/sparql?format=json&query=SELECT%20%3Fitem%20%3Fuk%20%3Fru%20%3Fen%20%3Fcoord%20WHERE%20%7B%20%3Fitem%20wdt%3AP31%20wd%3AQ532%20%3B%20wdt%3AP17%20wd%3AQ212%20%3B%20wdt%3AP625%20%3Fcoord%20.%20OPTIONAL%7B%3Fitem%20rdfs%3Alabel%20%3Fuk%20FILTER(lang(%3Fuk)%3D%22uk%22)%7D%20OPTIONAL%7B%3Fitem%20rdfs%3Alabel%20%3Fru%20FILTER(lang(%3Fru)%3D%22ru%22)%7D%20OPTIONAL%7B%3Fitem%20rdfs%3Alabel%20%3Fen%20FILTER(lang(%3Fen)%3D%22en%22)%7D%20%7D%20LIMIT%205
  - https://query.wikidata.org/sparql?format=json&query=SELECT%20(COUNT(DISTINCT%20%3Fitem)%20AS%20%3Fc)%20WHERE%20%7B%20%3Fitem%20wdt%3AP17%20wd%3AQ212%20%3B%20wdt%3AP625%20%3Fcoord%20%3B%20wdt%3AP31%20%3Ft%20.%20VALUES%20%3Ft%20%7B%20wd%3AQ532%20wd%3AQ515%20wd%3AQ3957%20wd%3AQ2514025%20wd%3AQ7930989%20%7D%20%7D

### Overture Maps – divisions (hranice), transportation (cesty), base (vodstvo) – voliteľná alternatíva k surovému OSM

- URL: https://docs.overturemaps.org/attribution/
- Druh / formát / prístup: basemap · GeoParquet (S3/Azure, mesačné vydania) → cez overturemaps CLI / DuckDB do GeoJSON · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Attribution stránka: Divisions "ODbL", Transportation "ODbL", Base "ODbL", Buildings "ODbL"; Places "CDLA Permissive 2.0" a "Apache 2.0". Divisions guide: "Because it includes OpenStreetMap data, the divisions theme is published under the ODbL license." a "The divisions theme is derived from a conflation of two community sources: OpenStreetMap, its primary source, and geoBoundaries."
- Licencia URL: https://docs.overturemaps.org/attribution/
- Atribúcia: "© OpenStreetMap contributors, Overture Maps Foundation"
- Aktualizácia: mesačne
- Pokrytie: Globálne; subtypy divisions "country, dependency, macroregion, region, macrocounty, county, localadmin, locality, borough, macrohood, neighborhood, microhood"; hranice "as seen from a given political perspective" (mechanizmus pre Krym guide nevysvetľuje).
- Riziká / poznámky: Pre Ukrajinu neprináša nič navyše oproti Geofabrik výrezu, len pred-konflatovanú schému; vyžaduje Parquet nástroje. Rovnaké ODbL share-alike. Bundlovať: áno (ODbL), ale zbytočné – držať sa OSM.
- Dôkazy:
  - https://docs.overturemaps.org/attribution/
  - https://docs.overturemaps.org/guides/divisions/

### Copernicus DEM GLO-30 (WorldDEM-30) – DEM 30 m, COG dlaždice na AWS bez kľúča

- URL: https://registry.opendata.aws/copernicus-dem/
- Druh / formát / prístup: basemap · Cloud Optimized GeoTIFF, dlaždice 1°×1°, názov "Copernicus_DSM_COG_10_N48_00_E037_00_DEM" (10 = arcsec), bucket s3://copernicus-dem-30m (eu-central-1), zoznam tileList.txt, prístup --no-sign-request; alternatívne DGED/DTED z Copernicus Data Space · **open-download**
- Strojovo čitateľné: áno
- Licencia (doslovne): Licence for Copernicus DEM instance COP-DEM-GLO-30-F Global 30m Full, Free & Open. Čl. 4: "The Licensor grants to the User the following non-exclusive rights of use regarding the Copernicus WorldDEM-30: (a) reproduction; (b) distribution; (c) communication to the General Public; (d) adaptation, modification and combination with other data and information." Čl. 5: "The use rights granted under this licence are free of charge to the User." Čl. 6(b): "Where the Copernicus WorldDEM-30 data have been adapted or modified, the User shall provide the following notice: \"produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved\"". Čl. 6(c) vyžaduje pri distribúcii doplniť: "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30".
- Licencia URL: https://docs.sentinel-hub.com/api/latest/static/files/data/dem/resources/license/License-COPDEM-30.pdf
- Atribúcia: „produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved“ + veta o nezodpovednosti (čl. 6c)
- Aktualizácia: ročné vydania (2024_1, júl 2024 – "Perfective Maintenance")
- Pokrytie: Globálne vrátane celej Ukrajiny (výnimky len Arménsko a Azerbajdžan); EPSG 4326; Ukrajina ≈ 22×9 = ~200 dlaždíc (veľkosť súborov readme neuvádza).
- Riziká / poznámky: Bundlovať/redistribuovať: ÁNO, licencia to výslovne dovoľuje (čl. 4b) s dvoma povinnými vetami. Ale OKO už má globálny terén (Cesium World Terrain / ion + SK DMR) – DEM má zmysel len pre hillshade raster v 2D PLÁTNE alebo offline sklon; rátať s objemom na D:. Neplietť s WorldDEM-10 ("distribution to the general public of these higher resolution DEMs is expressly excluded from this Licence").
- Dôkazy:
  - https://docs.sentinel-hub.com/api/latest/static/files/data/dem/resources/license/License-COPDEM-30.pdf
  - https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
  - https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30
  - https://registry.opendata.aws/copernicus-dem/
  - https://copernicus-dem-30m.s3.amazonaws.com/readme.html

### ISW – Russian Field Fortifications (body) a RUAF_Field_Fortifications_Polylines (línie), ArcGIS FeatureServer – LEN S PÍSOMNÝM SÚHLASOM

- URL: https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/RUAF_Field_Fortifications_Polylines/FeatureServer
- Druh / formát / prístup: fortifications · ArcGIS FeatureServer, supportedQueryFormats "JSON" (bez geojson), maxRecordCount 2000; vrstva 0 esriGeometryPolyline (12 169 prvkov) resp. esriGeometryPoint (5 963 prvkov) · **api-keyless**
- Strojovo čitateľné: áno
- Licencia (doslovne): ISW Fair Use & Attribution Policy: povolené je "viewing and sharing materials in their published form for non-commercial, informational or media purposes"; ale "modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission from ISW." Atribúcia: "Source: Institute for the Study of War". Na samotných ArcGIS položkách licenseInfo aj copyrightText prázdne.
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Atribúcia: „Source: Institute for the Study of War“ (len ak ISW písomne povolí)
- Aktualizácia: body: snippet "Observed Russian field fortifications as of September 12, 2023", modified 2. 1. 2025; línie: modified 1. 7. 2025 (epoch 1751378841); editor tracking vypnutý → bez lastEditDate
- Pokrytie: "Russian field fortifications in Russia and Ukraine" – body 2023, línie do polovice 2025; nie je to živý stav.
- Riziká / poznámky: Služba je verejná a bez kľúča, ale politika ISW výslovne zakazuje začlenenie do mapových platforiem bez písomného súhlasu → OKO ju NESMIE proxovať ani bundlovať, kým nepríde súhlas (možnosť: napísať ISW, OKO je nekomerčné). Do UI len odkaz von na ISW mapu. ISW webmapa 7360c66e… vracia "Subscription is disabled, the item is not accessible". Dáta sú statická infraštruktúra (v súlade s etickou čiarou), žiadne osoby.
- Dôkazy:
  - https://www.understandingwar.org/fair-use-and-attribution-policy/
  - https://www.arcgis.com/sharing/rest/search?q=owner%3Athestudyofwar%20fortification&f=json&num=20
  - https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/Russian_Field_Fortifications/FeatureServer?f=json
  - https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/Russian_Field_Fortifications/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json
  - https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/RUAF_Field_Fortifications_Polylines/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json
  - https://www.arcgis.com/sharing/rest/content/items/0b38dd1bd3104910bbddc04cf9272f0d?f=json
  - https://www.arcgis.com/sharing/rest/content/items/7360c66e2b1b4b9e994fbd1edf5ae417/data?f=json

### Brady Africk – Russian field fortifications in Ukraine (Google My Maps, KML export) – bez licencie

- URL: https://read.bradyafrick.com/p/russian-field-fortifications-in-ukraine
- Druh / formát / prístup: fortifications · Google My Maps (mid=1rRKs40IEbGRsV0Fhky25l5OkPJ_vUvQ); KML/KMZ export cez https://www.google.com/maps/d/kml?mid=1rRKs40IEbGRsV0Fhky25l5OkPJ_vUvQ (odkaz uvedený v zozname simonhuwiler/russo-ukrainian-data-ressources) · **unclear**
- Strojovo čitateľné: áno
- Licencia (doslovne): unclear – stránka neuvádza žiadnu licenciu ani podmienky opätovného použitia (overené 19. 9. 2026); obsah Google My Maps patrí autorovi
- Licencia URL: https://read.bradyafrick.com/p/russian-field-fortifications-in-ukraine
- Atribúcia: „Brady Africk (@bradyafr)“ – len po dohode s autorom
- Aktualizácia: "Updated June 12 2025"
- Pokrytie: Ruské poľné opevnenia v okupovanej UA a pohraničí RU zo Sentinel-2, Planet, Airbus, Maxar; autor: "This map should not be seen as a complete list of Russia's fortifications", zahrnuté len objekty nové/rozšírené od februára 2022, typy (zákopy vs. zátarasy) sa nerozlišujú, "Not all of these fortifications are currently manned by Russian personnel".
- Riziká / poznámky: Bez licencie → nebundlovať, neproxovať; KML export je nedokumentovaný koncový bod Google. Jediná cesta: napísať autorovi (nekomerčný projekt, atribúcia). Inak len odkaz von. Toto je de facto jediný verejný „Surovikin line“ dataset okrem ISW.
- Dôkazy:
  - https://read.bradyafrick.com/p/russian-field-fortifications-in-ukraine
  - https://github.com/simonhuwiler/russo-ukrainian-data-ressources
  - https://substack.com/@bradyafr/note/c-14454099

**Poznámky nálezcu (notes):** ČO SOM HĽADAL A ČO PLATÍ (19. 9. 2026): (1) Sídla s menami uk/ru/en: GeoNames (CC BY 4.0, denné dumpy, Krym pod UA) + OSM name:* (empiricky 3 403/4 154 miest má name:ru, 3 037 name:en) sú dostatočné; Wikidata (CC0) len na obohatenie – trieda „village“ pokrýva len 2 578 sídiel so súradnicami, širší dotaz dvakrát vypršal. (2) Hranice: HDX COD-AB Ukraine je najlepší zdroj – CC BY-IGO, 139 rajónov po reforme, 1 769 hromád, 29 706 polygónov sídiel, viacjazyčné polia; geoBoundaries UKR má licencie po úrovniach (ODbL/PD/CC BY-SA 2.0) a ADM2 z roku 2006 (495 rajónov) – zastarané; GADM zakazuje redistribúciu → vylúčené. (3) Cesty/rieky: Geofabrik ukraine-latest.osm.pbf 836 MB, ODbL, denne; Natural Earth (PD) len na prehľad a POZOR predvolene kreslí Krym pod Ruskom (použiť POV _ukr). (4) Opevnenia: v OSM Surovikinova línia NIE JE (18× barrier=tank_trap v celej UA, 1 762 zákopov prevažne historických), tag „hesco“ neexistuje; ukrajinská OSM komunita žiada nemapovať a maže vojenské objekty (čl. 114-2 TZ), DWG „follow the local community“. Jediné verejné datasety: ISW FeatureServer (12 169 línií, 5 963 bodov, bez kľúča) – ale ISW politika výslovne zakazuje začlenenie do mapových platforiem bez písomného súhlasu; Brady Africk Google My Maps (KML export) – bez akejkoľvek licencie. Otvorený GeoJSON „Surovikin line“ s licenciou NEEXISTUJE → vrstva opevnení v OKO buď s písomným súhlasom ISW/Africka, alebo len odkaz von. (5) DEM: Copernicus GLO-30 licencia výslovne dovoľuje reprodukciu, distribúciu aj adaptáciu (čl. 4) s dvoma povinnými vetami; COG na AWS bez kľúča; ale OKO už má terén – potrebné len pre 2D hillshade. SLEPÉ ULIČKY: HDX vracia WebFetch 403 a robots.txt zakazuje /api/ a *.geojson (stránka datasetu sa dala prečítať alternatívnym fetchom; BTAA geoportál za bot-verifikáciou); ITOS live služby codgis/gistmaps.itos.uga.edu – DNS z tohto prostredia zlyháva; oficiálny ukrajinský portál atu.decentralization.ua (podľa článku decentralization.ua z 6. 11. 2020 CC BY 4.0, voľné sťahovanie polygónov oblastí/rajónov/hromád) – doména dnes nerezolvuje, atu.decentralization.gov.ua odmieta spojenie; NSDI (nsdi.gov.ua) má 4 vrstvy ATU (27/136/1 469/29 742), ale vektorové stiahnutie len pre registrovaných a licencia neuvedená → vynechané (zákaz registrácie); data.gov.ua KATOTTG kodifikátor je CC BY, ale len kódy v XLSX bez geometrie (hodí sa na krížové mapovanie kódov, nie ako geodáta); owlmaps/UAControlMapBackups (denné KMZ kontrolnej mapy, latest.kmz) – bez licencie, patrí do uhla kontrola územia; Overture prináša oproti OSM len Parquet schému; ISW webmapa 7360c66e… „Subscription is disabled“; OSM wiki Multilingual names sekcia Ukrajina sa cez fetch orezala – nahradené empirickým Overpass meraním; Copernicus licencia PDF sa dala prečítať až lokálne cez pdftotext. ODPORÚČANÝ STACK PRE UHOL 5: HDX COD-AB (hranice + polygóny sídiel) + GeoNames (mená) + OSM výrez z Geofabrik cez build skript ako pri plynovodoch (cesty, rieky, železnice, place body; vlastný ODbL súbor) + Natural Earth POV _ukr na prehľad; opevnenia zatiaľ bez vrstvy, kým nepríde súhlas ISW/Africka.

## G. Overenia skeptikom (dokončené pred zastavením: 3)

### ISW / CTP – Assessed Control of Terrain in Ukraine (ArcGIS Online web map + hosted FeatureServer vrstvy)

- Verdikt použiteľnosti pre OKO: **no**
- Licencia (doslovne): ArcGIS item licenseInfo (https://www.arcgis.com/sharing/rest/content/items/9f04944a2fe84edab9da31750c2b15eb?f=json): "This geodata is the exclusive intellectual property of the Institute for the Study of War (ISW). You may not use this geodata without the written consent of ISW." — ISW Fair Use and Attribution Policy: permitted only "viewing and sharing materials in their published form for non-commercial, informational or media purposes"; prohibited to "copy or reproduce shapefiles, developer notes, or datasets for any purpose without ISW's written consent" and to "redistribute ISW Materials to third parties in bulk, via API, or through automated means"; "Any modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission". Attribution when permitted: "Source: Institute for the Study of War". Layer copyrightText: "Institute for the Study of War and American Enterprise Institute's Critical Threats Project".
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Prístup overený: Endpoint odpovedá bez kľúča: GET https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49?f=pjson vrátil metadáta vrstvy (name "Assessed Russian-controlled Ukrainian Territory", esriGeometryPolygon, supportedQueryFormats JSON/geoJSON/PBF, capabilities Query,Sync,ChangeTracking, maxRecordCount 2000, bez objektu error). Dotaz .../49/query?where=1=1&outFields=EditDate&orderByFields=EditDate DESC&resultRecordCount=1&returnGeometry=false&f=json vrátil features[0].attributes.EditDate = 1789417404735 (= 2026-09-14T20:23Z). Položka web mapy: access "public", owner gbarros_understandingwar, modified 1789674481000 (= 2026-09-17T19:48Z). Stránka https://www.understandingwar.org/terms-of-use/ = 404, teda žiadne iné (miernejšie) podmienky okrem Fair Use policy neexistujú; e-mail na policy stránke je v načítanom HTML naozaj maskovaný ([email protected]).
- Oprava nálezcu: Nálezca sa v podstate nemýli — licenčné citáty, URL policy, vlastník, formáty aj bezkľúčový prístup sedia doslovne. Jediný rozdiel: dáta sú čerstvejšie, než uviedol — web mapa modified je 2026-09-17 (nie 09-13) a posledný EditDate vrstvy 49 je 2026-09-14T20:23Z (nie 09-11T05:43Z); ide o bežné denné aktualizácie od času jeho prieskumu, nie o vecnú chybu. Neexistujúca stránka Terms of Use (404) potvrdzuje, že Fair Use policy je jediný primárny dokument podmienok.
- Zdôvodnenie: Technicky verejné a bez tokenu, ale právne uzavreté: licenseInfo položky výslovne zakazuje akékoľvek použitie geodát bez písomného súhlasu ISW a Fair Use policy menovite zakazuje presne to, čo by OKO robilo — inkorporáciu do „mapping platforms", kopírovanie datasetov a redistribúciu „via API, or through automated means". Nekomerčný status OKO nepomáha: nekomerčná výnimka pokrýva iba prezeranie/zdieľanie „in their published form" (t. j. hotové statické mapy ISW), nie proxy+cache vektorov na vlastnom glóbuse. Bez písomného povolenia od ISW (kontakt cez policy stránku, e-mail treba prečítať v prehliadači) vektory NEPOUŽÍVAŤ; ako náhradu možno len linkovať na publikované mapy ISW s atribúciou „Source: Institute for the Study of War".

### ISW Map Room – denné statické mapy (PNG/WebP) 'Assessed Control of Terrain in the Russo-Ukrainian War' + smerové výrezy

- Verdikt použiteľnosti pre OKO: **no**
- Licencia (doslovne): "Last revised: January 8, 2026" … "Unless otherwise agreed in writing, use of ISW Materials is limited to: viewing and sharing materials in their published form for non-commercial, informational or media purposes; and quoting or excerpting text with appropriate attribution. Any modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission from ISW." … "Required Attribution: Users must credit ISW whenever any ISW Materials are reproduced, displayed, or shared, as follows: Print/Web: “Source: Institute for the Study of War”." … "Where practicable, we kindly request that any online republication of ISW Materials include a link back to ISW’s website (www.understandingwar.org)." … "Restrictions: Users may not: alter or remove ISW’s logos, credit lines, or disclaimers; … copy or reproduce shapefiles, developer notes, or datasets for any purpose without ISW’s written consent; or redistribute ISW Materials to third parties in bulk, via API, or through automated means." … "© 2026 Institute for the Study of War. All rights reserved."
- Licencia URL: https://www.understandingwar.org/fair-use-and-attribution-policy/
- Prístup overený: Endpoint odpovedá, bez registrácie a bez kľúča: Map Room HTML (https://www.understandingwar.org/analysis/map-room/) 200, detailové stránky /map/<slug>/ 200 bez loginu; obrázky HEAD 200 bez auth (len Cloudflare cookie __cf_bm): náhľad …/2026/09/Russo-Ukrainian-War-September-18-2026-240x300.webp (15 252 B), plná …-September-18-2026.webp (386 488 B) a …-September-18-2026.png (444 708 B, image/png), Cache-Control public max-age=31536000; URL vzor je predvídateľný. Existuje RSS feed pre post type map: https://understandingwar.org/feed/?post_type=map → 200 application/rss+xml, položky s title/link/pubDate pre každú dennú mapu (Russo-Ukrainian War, Kupyansk, Kostyantynivka-Druzhkivka, Dobropillya, Zaporizhzhia City, Fortress Belt…); /map/feed/ = 404. WP REST /wp-json/wp/v2/map odpovedá 200 JSON, ALE robots.txt má Disallow: /wp-json/ pre všetkých botov (ClaudeBot/GPTBot navyše Crawl-delay 600). Na stránke žiadny KML/GeoJSON/shapefile/download dát, len obrázky. Sťahoval som len hlavičky (HEAD) a jednu stránku/feed, nič vo veľkom.
- Oprava nálezcu: Citáty licencie sú doslovne správne a stránka podmienok je primárna (revízia 8. 1. 2026). Nálezca sa však mýli v záveroch: (1) PREHLIADOL kľúčové obmedzenie „Users may not … redistribute ISW Materials to third parties in bulk, via API, or through automated means" — to priamo zakazuje štandardný vzor OKO (server-side proxy + cache, denný automatický zber a servírovanie návštevníkom verejnej domény oko.uhrin.digital). Jeho „jediná licenčne čistá cesta" (scrapovať Map Room a zobraziť obrázok v karte panela) teda čistá NIE JE. (2) „Nie je strojovo čitateľné, treba scrapovať" je nepresné: existuje RSS feed feed/?post_type=map so štruktúrovanými položkami a predvídateľný URL vzor obrázkov; WP REST API tiež odpovedá, ale robots.txt ho zakazuje. Ten feed však smie slúžiť len na zoznam odkazov von, nie na automatickú redistribúciu. (3) OKO je „mapping platform" — politika vyžaduje písomný súhlas na „incorporation of ISW Materials into … mapping platforms" bez ohľadu na to, či ide o glóbus alebo kartu; toto nálezca odbil. (4) Neuviedol dátum revízie politiky ani kontakt na povolenie (sekcia 5 „Requests and Enquiries", e-mail je na stránke Cloudflare-obfuskovaný).
- Zdôvodnenie: Primárna politika je jednoznačná: dovolené je len prezeranie/zdieľanie „v publikovanej podobe" na nekomerčné účely s atribúciou; akékoľvek začlenenie do mapových platforiem/systémov, redistribúcia cez API alebo automatizovane a kopírovanie shapefile/datasetov vyžaduje písomný súhlas ISW. OKO je nekomerčné (to vyhovuje), ale je to mapová platforma so serverovou proxy a cache — presne to, čo podmienky zakazujú. Preto pre zamýšľanú integráciu (proxy/cache/overlay/karta so servírovaným obrázkom) = 'no'. Jediná cesta bez písomného súhlasu, ktorá sa ešte dá obhájiť ako „sharing in published form": v paneli UKRAJINA uviesť názov + dátum mapy a ODKAZ VON na stránku /map/<slug>/ (zoznam z RSS feedu), s textom „Source: Institute for the Study of War" a linkom na understandingwar.org; ak vôbec obrázok, tak nezmenený, načítaný prehliadkačom priamo z understandingwar.org (hotlink, nie cez /api), s logom/credit line neorezaným — a aj to je hraničné, lebo ide o „mapping platform". Georeferencovaný overlay na glóbuse, vlastný snímok/cache, extrakcia línie frontu z obrázka alebo použitie ISW shapefile sú bez písomného súhlasu vylúčené. Odporúčanie: buď požiadať ISW o písomné povolenie (nekomerčný, informačný portál, atribúcia), alebo pre územnú kontrolu použiť iný zdroj s otvorenou licenciou a ISW nechať len ako link-out.

### longlinecode/russo-ukrainian-front-daily – odvodený denný GeoJSON feed (DeepState + ISW rekonštrukcia) s CesiumJS adaptérom

- Verdikt použiteľnosti pre OKO: **no**
- Licencia (doslovne): Repo (README §6 „Licence and attribution", https://raw.githubusercontent.com/longlinecode/russo-ukrainian-front-daily/main/README.md): „The code is free to use. Please attribute the data to its sources: – Control-area data © DeepStateMap.Live – Situation assessments © Institute for the Study of War / Critical Threats Project – Basemap: Natural Earth (public domain), geoBoundaries (CC BY 4.0), GeoNames (CC BY 4.0)". GitHub API: license = null, žiadny súbor LICENSE. || Upstream 1 – DeepStateMap License Agreement (https://deepstatemap.live/license-en.html, „Last updated: September 3rd, 2025"), §2 Use of the API: „The API is provided for free to entities engaged in: Volunteer and charitable activities … Activities for the defense of Ukraine … Entities operating on a commercial basis may use the API only with prior approval from the Copyright Holder … Unauthorized distribution, publication, proxying, or other methods of transferring the API to third parties are prohibited." §3: „Visual materials containing a text reference, the DeepStateMap.live logo, or a direct link to the Objects may be freely used for both commercial and non-commercial purposes." §5: „The creation of identical objects that completely match the Objects is prohibited." Zrkadlo cyterat/deepstate-map-data (scripts/download-geojson.py): API_URL = "https://deepstatemap.live/api/history/last" – jeho GPL-3.0 sa týka len kódu. || Upstream 2 – ISW Fair Use and Attribution Policy (https://understandingwar.org/fair-use-and-attribution-policy/, „Last revised: January 8, 2026"): „Any modification, commercial exploitation, redistribution, or incorporation of ISW Materials into other datasets, mapping platforms, analytic products or systems requires prior written permission from ISW." a zákaz „copy or reproduce shapefiles, developer notes, or datasets for any purpose without ISW's written consent"; povolené len „viewing and sharing materials in their published form for non-commercial, informational or media purposes".
- Licencia URL: https://raw.githubusercontent.com/longlinecode/russo-ukrainian-front-daily/main/README.md
- Prístup overený: Endpoint odpovedá bez kľúča: HEAD https://longlinecode.github.io/russo-ukrainian-front-daily/data/latest.geojson → HTTP 200, Content-Type application/geo+json, 63 959 B, Access-Control-Allow-Origin: *, Last-Modified Sat 19 Sep 2026 08:46:56 GMT, Cache-Control max-age=600. Range request (prvých 2,5 kB) potvrdil štruktúru: FeatureCollection.properties {generated: "2026-09-19T08:46:41…", data_date: "2026-09-19"}, feature properties {kind: "russian_control", date, area_km2: 117128, pct_of_ukraine: 19.41, source: "DeepStateMap"}. embed/ua-situation-layer.js → 200, application/javascript, 10 976 B (ESM+UMD, bez závislostí, adaptéry MapLibre/Leaflet/deck.gl/ArcGIS/Cesium). Homepage 200. Repo: created 2026-09-01, pushed 2026-09-19T08:46:43Z, 0 hviezdičiek, 40 commitov, nie je archivované.
- Oprava nálezcu: Nálezcove fakty o repe (license null, README citáty, cron 04:10 UTC, pushed_at, cyterat mirror, presnosť 5–10 km, addToCesium) sedia. Tri doplnenia/opravy: (1) Nálezca písal „bez DS súhlasu" ako domnienku – DeepStateMap má skutočnú licenčnú zmluvu (license-en.html, 3. 9. 2025), ktorá v §2 VÝSLOVNE zakazuje „distribution, publication, proxying … of the API to third parties"; zrkadlo cyterat ťahá priamo z deepstatemap.live/api/history/last a denne ho republikuje, takže ide o expresne zakázané, nie len neschválené použitie. Cesta pre OKO by bola vlastná žiadosť o API (https://api.deepstatemap.live/request – OKO ako súkromný nekomerčný projekt nespadá do bezplatných kategórií dobrovoľníci/obrana Ukrajiny, takže potrebuje schválenie) alebo §3 „visual materials" s odkazom/logom (screenshot/iframe), nie tento feed. (2) Nálezca staval ISW problém len na rekonštrukcii 2022–2024 (history.json). V skutočnosti aj denný data/latest.geojson obsahuje feature kind "ukrainian_control_in_russia" so source "ISW-assessed, schematic geometry" a README hovorí „Area readouts always use ISW's sourced figures" – čiže ISW derivát je aj v živom feede, nie len v histórii; ISW policy (8. 1. 2026) vyžaduje písomné povolenie na „incorporation … into other datasets, mapping platforms"; repo žiadne povolenie neuvádza. (3) Aj contact_line je „derived from DeepStateMap" – vo feede niet nič, čo by nebolo DS alebo ISW derivátom. Drobnosti: feed je malý (64 kB), repo má 18 dní a 0 hviezdičiek (krehkejšie než „40 commitov" naznačuje); nálezcov odhad štruktúry feedu sedí presne.
- Zdôvodnenie: Feed je dvojitý derivát, a oba upstreamy to zakazujú primárnym textom: DeepStateMap §2 zakazuje proxying/publikovanie API tretím stranám (cyterat mirror je presne to, longlinecode je jeho ďalší stupeň, OKO by bol tretí), ISW policy vyžaduje písomné povolenie na začlenenie do „mapping platforms" a zakazuje kopírovanie „shapefiles … or datasets" – a ISW-odvodená geometria je aj v dennom latest.geojson. „The code is free to use" v README je neformálny grant bez OSI licencie (GitHub bez LICENSE = all rights reserved okrem forku/prezerania), takže aj kód je právne len na vágnom prísľube; čítať ho ako referenčnú implementáciu (Cesium clampToGround, odvodenie contact_line z polygónu, poradie vrstiev, farby) je bezpečné, verbatim prevzatie kódu je nízke, ale nie nulové riziko. Do DATA_SOURCES.md zapísať ako ZAMIETNUTÉ s odkazom na obe primárne stránky; legitímna cesta k DS kontrolnému územiu = vlastná žiadosť o DeepState API (schválenie, OKO nie je dobrovoľnícky/obranný subjekt) alebo vizuálne materiály s atribúciou podľa DS §3; ISW polygóny nikdy bez písomného súhlasu.

Overenia, ktoré sa už nespustili (ostávajú jedno čítanie): cyterat mirror, Project Owl KMZ, Black Bird
Group, ACLED, Wikipedia modul, Commons SVG, DeepState API, a všetky zdroje uhlov B–F.
