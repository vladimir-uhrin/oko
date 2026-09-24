# BLÍZKY VÝCHOD — prieskum zdrojov dát a informácií (2026-09-24)

Príloha k `docs/drafts/blizky-vychod-plan.md`. Používateľ: „chcel by som súčasne pokračovať
v Blízkom východe podobne ako Ukrajina. Vytvor návrhy a plány", potom „samozrejme potrebuje
najprv zdroje dát a informácií", „aj mirrory", „pozri aj gity".

Pri každom zdroji je napísané, čo som **dnes (24. 9. 2026) sám zmeral alebo prečítal**. Kde
je napísané „neoverené", vychádzam len z vyhľadávania alebo z pamäti a pred zapojením sa to
musí overiť podľa checklistu `new-data-layer` (vzorka odpovede, frekvencia, kľúč, podmienky,
počet objektov, živé vs. modelované). Prieskum som robil sám, bez agentov (pravidlo
z Ukrajiny). Dvojité overenie (nálezca + skeptik) tu ešte neprebehlo pri žiadnom zdroji.

Verdikty: ✅ použiť · 🟡 po kroku alebo rozhodnutí používateľa · ❌ nie.
Mirrory sú od 24. 9. povolený zdroj (rozhodnutie vlastníka pri DeepState); licenčné fakty sa
pri nich vždy zapisujú poctivo, nikdy „open data", ak to tak nie je.

---

## 0. Situácia, na ktorú zdroje mierime (stav 24. 9. 2026)

Zhrnuté z Wikipédie (CC BY-SA) a spravodajstva, len na určenie dejísk, nie ako obsah mapy:

- **Vojna s Iránom** od 28. 2. 2026 (americko-izraelské údery, zabitý Chamenei; iránske odvety
  na Izrael, americké základne a štáty Zálivu). Prímerie 8. 4., Islamabadské memorandum 17. 6.,
  rozpad 8. 7. po útokoch na obchodné lode v Hormuze; august pokoj, v septembri znova boje.
  https://en.wikipedia.org/wiki/2026_Iran_war
- **Hormuz** fakticky zavretý od 28. 2. (mínovanie, prepady lodí, suverenitné nároky IRGC);
  USA obnovili námornú blokádu Iránu 14. 7. IMF PortWatch: **1 prechod 20. 9. 2026** (zmerané
  dnes cez ArcGIS, viď C1). https://en.wikipedia.org/wiki/2026_Strait_of_Hormuz_crisis ·
  https://en.wikipedia.org/wiki/2026_United_States_naval_blockade_of_Iran
- **Libanon**: vojna od 2. 3., izraelská pozemná operácia od 16. 3., nárazníkové pásmo aj za
  Litani, prímerie de iure od 16. 4., postupné sťahovanie od júla (pilotné zóny, libanonská
  armáda do Zawtar al-Gharbiyeh). https://en.wikipedia.org/wiki/2026_Lebanon_war
- **Gaza**: de facto prímerie od októbra 2025 (mierový plán), sporadické násilie, odzbrojenie
  Hamasu stojí. **Západný breh**: izraelské operácie, PA proti ozbrojeným skupinám (Džanín, Túbás).
- **Jemen / Červené more**: v septembri eskalácia Húsíov → kríza Báb al-Mandabu, postup po
  pobreží Červeného mora, útoky na Saudskú Arábiu vrátane Rijádu a ropných zariadení.
  https://arabamericannews.com/2026/09/18/middle-east-wars-converge-as-iran-yemen-lebanon-and-gaza-crises-deepen/
- **Irak**: útoky proiránskych milícií, americké údery. **Sýria**: izraelská prítomnosť na juhu,
  prechodná vláda, SDF na severovýchode.
  https://en.wikipedia.org/wiki/Middle_Eastern_crisis_(2023%E2%80%93present)

---

## A. Kontrola územia a línie

### A1. Wikipédia — Lua moduly „detailed map" (rovnaký formát ako pri Ukrajine)
- Formát: `{ lat = "…", long = "…", mark = "<ikona>.svg", marksize, label = "[[…]]", … }` —
  presne to, čo už číta `src/data/ukraineControl.js` (`parseLuaMarks`). Stiahnutie
  `index.php?title=<modul>&action=raw`, revízie cez MediaWiki API.
- Licencia: CC BY-SA 4.0 (text Wikipédie) — odvodený dataset musí ísť ako samostatný súbor
  s licenciou a odkazom (rovnako ako `control/<deň>.json` pri Ukrajine).
- **Zmerané 24. 9. (počet úprav v roku 2026 a posledná úprava):**

| Modul | Úpravy 2026 | Posledná | Bodov (`lat =`) | Legenda (z /doc) |
|---|---|---|---|---|
| `Module:Israeli-Palestinian conflict detailed map` (Gaza, Západný breh, **južný Libanon** — /doc Libanonu hovorí „južne od Sidonu upravujte tento modul") | 117 (apr 59, jún 11, sep 8) | 22. 9. 2026 | 1 335 | modrá = Izrael, zelená 0d0 = PA (Ramalláh), lime = Gaza (správa Hamasu), ďalšie farby (tmavočervená, teal, purple) overiť |
| `Module:Yemeni Civil War detailed map` | 18 (jan 8, **sep 10**) | **23. 9. 2026** | 1 284 | červená 447 / zelená 418 / lime (vrchy, základne) — význam farieb v /doc nie je, overiť na stránke mapy (predpoklad: červená = Húsíovia) |
| `Module:Syrian Civil War detailed map` (obsahuje aj zlúčený prehľadový modul) | 135 (jan 124, potom 1–5 mesačne) | 11. 9. 2026 | 7 752 | sivá 68a (5 651 bodov = prevažne vláda po páde Asada?), žltá, lime, modrá — overiť |
| `Module:Lebanese insurgency detailed map` | 12 (jún 4, júl 2, sep 6) | 21. 9. 2026 | 95 | sivá / červená; juh preberá z IP modulu |
| `Module:South Lebanon detailed map` | 15 (všetky v máji) | **30. 5. 2026 — stojí** | 99 | červená / modrá / animované sporné |
| `Module:Iraqi insurgency detailed map` | 0 | 18. 2. 2025 — stojí | — | ❌ nepoužiť |
| `Module:Iranian insurgency detailed map` | — | 1. 9. 2023 — stojí | — | ❌ |

- Verdikt: ✅ ako „KONTROLA SÍDIEL podľa Wikipédie" pre Jemen, Gazu + juh Libanonu + Západný
  breh a Sýriu. Pozor na lekciu z Ukrajiny: modul môže stáť týždne → vek zdroja nahlas
  (`ukraineFreshness.js`), prah podľa zdroja. Farby → strany sa musia mapovať **na modul**
  (nie binárne UA/RU ako dnes).

### A2. `Template:2026 Iran war map` (Wikipédia, GeoJSON v `<mapframe>`)
- 294 bodov „miesto zasiahnuté", `marker-symbol` cross = USA/Izrael a spojenci, circle = Irán,
  Hizballáh, Húsíovia, PMF. **Súradnice sú prehodené** (poznámka v šablóne: najprv dĺžka).
- Zmerané: úpravy 2026 = 154 (marec 113), **posledná 2. 8. 2026**, dátumy bodov 28. 2. → 14. 7.
  Pole `name` = zdroj: **212 z 294 = „ISW update"**, 26 Al Jazeera, 11 Reuters, NYT, UNIFIL, ToI.
- Licencia: CC BY-SA 4.0; fakty „miesto X zasiahnuté dňa Y" nie sú chránené, ale zoznam je
  z 72 % poskladaný z ISW textov.
- Verdikt: 🟡 archív február–júl, každý bod so zdrojom v karte; odporúčam použiť (ide o fakty
  z textu, nie o ISW geodáta), rozhodnutie používateľa (otázka v pláne).

### A3. Wikimedia Commons — `2026_Lebanon_War_Map.svg` (okupované pásmo, Litani, „Yellow Line")
- CC BY-SA, negeoreferencované (jednorazová afinná georeferencia, nízka presnosť). Neoverené
  čítaním súboru. Verdikt: 🟡 až keď body z A1 nestačia.

### A4. GeoConfirmed — frontová línia
- `/api/Conflict` označuje „Israel/Gaza/Lebanon" `hasFrontline: true`, ale verejné OpenAPI
  (`/openapi/v1.json`, 34 ciest) **nemá žiadny endpoint línie** a KMZ export Izraela obsahuje
  len 7 087 bodov (`<Point>`), žiadny polygón ani čiaru. Verdikt: ❌ (línia nie je verejná).

### A5. ISW / Critical Threats „Iran Update" (denné, s mapami)
- Rovnaká politika ISW ako pri Ukrajine (overené ×2 v ukrajinskom prieskume): bez písomného
  súhlasu žiadne geodáta ani obrázky. Verdikt: ❌ obsah, ✅ len titulok + dátum + odkaz von.

### A6. Liveuamap
- Platené API; na GitHube scraper `MxpleSticks/liveuamap-scraper-api` (FastAPI, sťahuje ich
  verejné stránky, sám odkazuje na platené API, bez licencie). Verdikt: 🟡 len ako mirror na
  rozhodnutie vlastníka; odporúčam ❌ (nejde o zrkadlo otvorených dát, ale o scraping
  komerčného produktu s aktívnou ochranou).

---

## B. Udalosti (údery, zásahy, geolokácie)

### B1. GeoConfirmed — CSV export po konfliktoch ✅
- Endpoint `https://geoconfirmed.org/api/Map/export/<Conflict>/csv` (ten istý, čo používa
  `scripts/lib/ukraineArchive.mjs` pre Ukrajinu). Stĺpce: Date, Name, Faction, Origin,
  Latitude, Longitude, PlusCode, Description, Source, Geolocation, Equipment, EquipmentItems,
  Units, OrbatUnits, Id. OpenAPI: „freely available for research, journalism, and analytical use".
- **Zmerané 24. 9.:**

| Konflikt (`url`) | Riadkov | Posledný dátum | 2026 po mesiacoch | Najčastejšie frakcie |
|---|---|---|---|---|
| Iran (`iran`, od 11. 1. 2025) | 4 144 | 21. 9. 2026 | jan 299, feb 151, **mar 2 038**, apr 626, máj 30, jún 19, júl 122, aug 8, sep 11 | Iranian Armed Forces 2 495, Neutral/Infrastructure 511, IDF 489, US 288, Iranian Civilian 236, Hezbollah 43 |
| Israel/Gaza/Lebanon (`israel`) | 7 087 | 24. 9. 2026 | 35–102 mesačne | IDF 3 638, Neutral 1 600, Hamas 558, Palestinian Civilian 424, Hezbollah 366 |
| Syria | 1 154 | 20. 9. 2026 | 1–28 mesačne | Neutral 286, SAA (staré) 154, SNA 133, SDF 111 |
| Yemen | 245 | 24. 9. 2026 | **aug 17, sep 28** | Houthi 148, Regular army 39, Neutral 28, Saudi-led 9, IDF 8 |

- Etika (rovnako ako UA): stĺpce `Units`/`OrbatUnits` a ORBAT endpointy nikdy; frakcia len ako
  „kto zasiahol / čo bolo zasiahnuté", nie poloha síl. Vlastný User-Agent s kontaktom.
- Verdikt: ✅ (4 konflikty, archív denne ako pri Ukrajine).

### B2. UCDP Candidate Events ✅ (studená vrstva)
- `ucdp.uu.se/downloads/`: zmerané súbory `candidateged/GEDEvent_v26_0_8.csv` (posledný mesiac)
  + `GEDEvent_v26_01_26_06.csv` (jan–jún 2026). Len udalosti s obeťami, `where_prec` 1–7.
- Licencia CC BY 4.0 (z ukrajinského prieskumu, stránka 19. 9.; staršie zrkadlá tvrdia NC →
  zapísať s dátumom). API vyžaduje token (401) → CSV snímok. Verdikt: ✅ mesačne.

### B3. ACLED ❌ priamo · 🟡 agregáty cez HDX
- Surové dáta: EULA zakazuje verejné zobrazenie bodov (ukrajinský prieskum).
- HDX `lebanon-acled-conflict-data` (organizácia acled, license `hdx-other`: „By using ACLED
  data you agree to abide by the Terms of Use and Attribution Policy"), zmerané: 3 XLSX
  mesačné súčty po krajine, aktualizované 17. 9. 2026. HDX HAPI má z nich odvodené „conflict
  events" po admin2 (license `hdx-other`). Verdikt: 🟡 len súčty po mesiacoch v karte krajiny,
  s atribúciou ACLED; mirrory surových ACLED dát (Kaggle a pod.) ❌ — porušujú EULA výslovne.

### B4. Airwars (civilné škody: Gaza, Libanon, Jemen, Sýria, Irak)
- Stránka podmienok vrátila 404, licencia dát neuvedená. Verdikt: 🟡 len odkaz von, kým
  nepríde odpoveď na e-mail (voliteľné).

### B5. Staré GeoJSON repozitáre (GitHub) — ❌ ako živý zdroj
- `bothness/gaza-geojson` (bez licencie, posledný push 5. 12. 2023): evakuačné bloky IDF,
  nárazníkové pásma 100/300/1 000 m, rozsah ničenia 11/2023. Historické.
- `btselem/map-data` (bez licencie, 2. 3. 2023): zelená línia, hranice Gazy, zastavané plochy
  2015. Len statický kontext; B'Tselem sa pri použití slušne opýtať.
- Pre „žltú líniu" v Gaze (po prímerí 10/2025) som **nenašiel žiadne verejné GeoJSON**
  (GitHub code search „yellow line" geojson — len nesúvisiace výsledky). Nepriamo ju kreslí
  modul A1 (modré body = izraelská kontrola v Gaze).

---

## C. Námorné

### C1. IMF PortWatch — denné prechody úžinami ✅
- ArcGIS: `https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query`
  (polia `date, portname, n_total, n_tanker, capacity, …`), bez kľúča. **Zmerané: Hormuz
  2026-09-20 `n_total` = 1.** Stránka datasetu 42132aa4e2fc4d41bdaf9a445f688931 (28 úžin).
- Podmienky IMF (https://www.imf.org/en/about/copyright-and-terms, z vyhľadávania): dáta
  možno sťahovať, kopírovať, odvodzovať a publikovať s atribúciou „Source: International
  Monetary Fund, <databáza>, <odkaz>"; nesmú sa meniť tak, aby sa zmenil ich význam.
- Verdikt: ✅ karta „prechody za deň vs. pred krízou" pre Hormuz, Báb al-Mandab, Suez
  (GitHub `marijachek/rerouted-barrels` použil baseline 1. 1.–15. 11. 2023).

### C2. UKMTO — varovania a incidenty ✅ (cez mirror)
- ukmto.org: stránka „Recent Incidents" je Next.js aplikácia bez verejného API; päta
  „© Crown copyright" (či platí Open Government Licence, som neoveril). Priečinok
  **`https://mscio.eu/folder/documents/UKMTO%20Warnings/`** (EÚ, MSCIO/ATALANTA) drží PDF
  varovaní — z neho číta GitHub scraper `Wyvern-2021/ukmto-signage` (`update_ukmto.py` →
  `incidents.json`: číslo, dátum, čas, typ, miesto, text; posledné „UKMTO WARNING 134-26,
  12 SEP 2026, ATTACK, STRAIT OF HORMUZ"). Ďalší scraper `Danjones-DJ/UKMTO-Incidents` (R,
  Selenium, geokódovanie miest).
- Verdikt: ✅ faktické polia (číslo, čas, typ, miesto/súradnice z textu, krátky výťah) + odkaz;
  vlastný parser PDF z mscio.eu alebo mirror `incidents.json` ako záloha.

### C3. NGA MSI — navigačné varovania ❌ (nerelevantné)
- `https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A`: zmerané 386
  aktívnych varovaní, **0 z roku 2026 pre Záliv / Hormuz / Červené more** (NAVAREA IX
  koordinuje Pakistan, NGA ich nenesie). Voľné dielo USA, ale prázdne.

### C4. MARAD MSCI advisories 🟡
- maritime.dot.gov vrátil 403 fetcheru; voľné dielo USA. Čítať v prehliadači, prípadne ručne.

### C5. Hugging Face `yasumorishima/hormuz-ais` + GitHub `yasumorishima/hormuz-ship-tracker` 🟡
- Vzorky AIS z aisstream.io (Parquet), `license: other`, „check aisstream.io for their terms
  before redistributing". Nič nové oproti nášmu AIS; užitočná metodika (17 % anomálnych
  správ, 102,3 kn = sentinel). Verdikt: len ako referencia.

### C6. Čo už OKO má (bez zmeny)
- AIS (aisstream + AISHub oneskorené), GFW SAR (lode bez AIS), námorné koridory, prístavy,
  úžiny, ropovody/plynovody, karta ROPA (Yahoo), počítadlo lodí v úžine.

---

## D. Vzdušný priestor

### D1. EASA Conflict Zone Information Bulletins ✅ (overiť podmienky)
- Stránka CZIB ponúka **CSV, JSON aj RSS**. Aktívne (stav z webu): Irán CZIB-2026-04-R1,
  Irak 2026-05-R1, Libanon 2026-06-R1, Perzský záliv a Ománsky záliv 2026-07R2, Jordánsko
  2026-08-R1 (všetky platné do 30. 9. 2026), trvalé Sýria 2017-03R19 a Jemen 2017-07R19.
- Päta „© European Union Aviation Safety Agency 2026"; znenie legal notice (reprodukcia so
  zdrojom) som neprečítal. Verdikt: ✅ po prečítaní legal notice.

### D2. Hranice FIR — `vatsimnetwork/vatspy-data-project` ✅
- `Boundaries.geojson`, licencia **CC BY-SA 4.0**, push 21. 9. 2026. Hranice FIR podľa
  simulačnej komunity (realistické, nie úradné) → share-alike vlastný súbor, štítok
  „približné hranice FIR". Slúži na nakreslenie zón z D1.

### D3. Rušenie GPS — vlastný výpočet z adsb.lol ✅
- `api.adsb.lol/v2/lat/<lat>/lon/<lon>/dist/<nm>` vracia `nic`, `nac_p`, `sil`, `rc`
  (zmerané: Hormuz 79 lietadiel / 77 s `nac_p`; Izrael 38 / 1 so zníženou presnosťou).
  adsb.lol = ODbL (už v DATA_SOURCES). Podiel lietadiel s `nac_p < 8` alebo `nic < 7` po
  bunkách a dňoch = rovnaký princíp ako gpsjam.org, ale z našich dát.
- gpsjam.org: dáta z airplanes.live + ADS-B Exchange, **licencia neuvedená** → ❌ ich súbory,
  ✅ ich metodika (odčítať 1 zlé lietadlo proti falošným poplachom, prahy 2 % a 10 %).

---

## E. Poplachy v Izraeli (rakety, drony)

### E1. Pikud HaOref (oficiálne) ❌ priamo
- `oref.org.il/…/AlertsHistory.json` aj `alerts-history.oref.org.il` → **403 Access Denied**
  zo Slovenska (geoblokácia Akamai). Z nášho servera nedostupné.

### E2. Tzeva Adom / Tzofar ❌
- `api.tzevaadom.co.il/alerts-history` odpovedá (47 kB), `static/cities.json` 422 kB, ale
  podmienky výslovne zakazujú „scraping, collection, monitoring, copying … storage" bez
  povolenia. Bez písomného súhlasu nie.

### E3. Mirrory na GitHube ✅/🟡
- `amitfin/oref_alert` (MIT, ★208, push dnes): `custom_components/oref_alert/metadata/
  area_to_polygon.json` = **polygóny oblastí poplachov** stiahnuté z aplikácie HFC
  (`services.meser-hadash.org.il/…/polygon`) generátorom `scripts/generate_metadata.py`. Kód MIT;
  polygóny sú úradné vymedzenie oblastí. Verdikt: ✅ (mirror).
- `oref-alerts/oref-alerts.github.io` (README MIT, hodinová aktualizácia, `events.js` 21 MB
  = história poplachov 1 700+ oblastí, `areas-catalog.json`). Verdikt: 🟡 mirror (licencia
  dát neuvedená, dáta sú úradné verejné výstrahy) — rozhodnutie vlastníka „mirrory používame".
- Iné (`eladnava/pikud-haoref-api` Apache-2.0, `yosef-770/oref-alerts-webhook`) volajú E1
  priamo → z EÚ nefunguje.

---

## F. Internet (výpadky, cenzúra)

- **IODA** (Georgia Tech): API `api.ioda.inetintel.cc.gatech.edu/v2/outages/summary?entityType=country`
  odpovedá bez kľúča (zmerané). Licencia softvéru akademická (UCSD/GT), podmienky dát
  neuvedené. Verdikt: 🟡 slušný e-mail; dovtedy len odkaz.
- **OONI**: API `api.ooni.io/api/v1/aggregation` odpovedá (Irán 17. 9.: 1 261 meraní, 221
  anomálií, 364 potvrdených blokovaní). Licencia dát **CC BY-NC-SA 4.0** (repozitár
  `ooni/license`, `data/LICENSE.md`). Precedens OKO: TeleGeography CC BY-NC-SA s vyčlenením
  v DATA_SOURCES → ✅ s vyčlenením.
- **Cloudflare Radar**: stránka 403 fetcheru; licencia CC BY-NC 4.0 len z pamäti → 🟡 overiť
  v prehliadači; API žiada token (neoverené).

---

## G. Satelit, škody, infraštruktúra, humanitárne súčty

- **NASA GIBS nočné svetlá** (`gibs-night-lights`, SNPP DNB Level 8) — už v OKO; výpadky
  prúdu v Iráne/Gaze/Libanone = preset pohľadu, nie nová vrstva. ✅
- **NASA FIRMS** — vrstva existuje, **`FIRMS_MAP_KEY` v `.env` stále chýba** (overené dnes).
  🟡 používateľ.
- **UNOSAT Gaza Strip Comprehensive Damage Assessment 11. 10. 2025** — HDX
  `unosat-gaza-strip-comprehensive-damage-assessment-11-october-2025`, **CC BY-SA**, upravené
  22. 5. 2026. ✅ statická vrstva „škody (UNOSAT, stav k 11. 10. 2025)". Pre Libanon HDX UNOSAT
  2026 nič (len požiare 2019). Staršie Gaza 2014 = `hdx-other`, nepoužiť.
- **Tech for Palestine** `TechForPalestine/palestine-datasets` — **public domain (Unlicense)**,
  push dnes; `casualties_daily.json` (Gaza súhrny), `west_bank_daily.json`,
  `infrastructure-damaged.json`. **`killed-in-gaza.json` a `press_killed_in_gaza.json` (mená)
  NIKDY** — etická čiara, len súčty. ✅ karta s číslami a zdrojom „MZ Gazy cez Tech for
  Palestine".
- **Copernicus EMS Rapid Mapping** — verejné API som nevedel prečítať (tvar odpovede); nechať
  ako hák. 🟡
- **Energetická a jadrová infraštruktúra**: OSM (rafinérie, terminály — ODbL, už v potrubiach),
  Wikidata CC0 (jadrové zariadenia Iránu: Natanz, Fordo, Isfahan, Búšehr), GEM trackery
  CC BY 4.0 s registráciou (už evidované v `oko-plyn`). ✅ ako infraštruktúra; vojenské
  základne ❌ ako vrstva (len ako miesto udalosti).

---

## H. Správy a oficiálne kanály (RSS zmerané 24. 9.)

| Zdroj | Feed | Stav | Poznámka |
|---|---|---|---|
| BBC Middle East, Al Jazeera | už v `mideast` | 200 | existuje |
| Times of Israel | `/feed/` | 200, 15 položiek, dnes | bez obrázka vo feede |
| Haaretz EN | `/srv/haaretz-latest-headlines` | 200, 100, dnes | enclosure obrázok; paywall |
| Ynetnews | `StoryRss3089.xml` | 200, 4 položky, bez dátumu | slabé |
| Jerusalem Post | `rssfeedsheadlines.aspx` | 200, ale **posledná 8. 6. 2025** | ❌ mŕtvy feed |
| The National (SAE) | Arc outboundfeeds | 200, 100, dnes | `media:content` |
| Asharq Al-Awsat EN | `/feed` | 200, 300, dnes | enclosure |
| Al-Monitor | `/rss` | 200, 20, dnes | |
| Middle East Eye | `/rss` | 200, 0 položiek | ❌ formát |
| Guardian Middle East | `/world/middleeast/rss` | 200, 20, dnes | `media:content` (vzor Ukrajiny) |
| France 24 Middle East | `/en/middle-east/rss` | 200, 30, dnes | `media:thumbnail` |
| DW | `rss-en-world` | 200, 11 | filter kľúčových slov |
| UN News Middle East | region feed | 200, 30, 23. 9. | oficiálne OSN |
| Crisis Group | `/rss.xml` | 200, 10, 18. 9. | analýzy, CrisisWatch |
| IAEA top news | `/feeds/topnews` | 200, 15 | jadrové vyhlásenia |
| NNA Lebanon (štátna agentúra) | `/en/rss` | 200, 20, 21. 9. | štítok „oficiálne LB" |
| Iran International EN (Londýn, exil) | `/en/feed` | 200, 50, dnes | `media:content`; štítok financovania |
| BBC Persian | `/persian/rss.xml` | 200, 28, dnes | perzština + preklad |
| IranWire EN | `/en/feed/` | 200, ale posledná 26. 8. | 🟡 stojí |
| IRNA EN (štátna) | `/rss` | 200, 30, dnes | 🟡 „tvrdí Irán"; na zozname EÚ som ju nenašiel — overiť |
| CENTCOM | ArticleCS RSS | 200, ale posledná 5. 2. 2026 | 🟡 mŕtvy feed, web |
| IDF | `/en/rss` | 200, 212 B, 0 položiek | ❌ feed; web/Telegram overiť |
| L'Orient Today | `/rss` | 404 | nájsť inú cestu |
| Arab News, Al Arabiya EN, UNRWA | | 403 | fetcher blokovaný, skúsiť zo servera |
| OCHA oPt | `/rss.xml` | 404 | skúsiť ReliefWeb v2 (appname) |
| Saba (vláda, saba.ye) | `/en/rss` | 500 | |

Pred zapojením každého feedu: podmienky obrázkov (vzor Ukrajiny — `unfurl`, `feedImage`,
`drop`, `limit`, `badge` po zdrojoch).

---

## I. Sankcie a teroristické zoznamy EÚ (právny mantinel)

Zdroj: OpenSanctions (agreguje EU FSF a Úradný vestník), Consilium. Overené 24. 9.:

- **Press TV** — EU FSF od 20. 4. 2023 (nariadenie 359/2011, ľudské práva, „Iranian State
  Television Broadcaster"), Úradný vestník aktualizovaný 15. 9. 2026. ❌
- **IRIB** (materská spoločnosť Press TV) — zoznam EÚ od 2013 (359/2011). ❌
- **Tasnim** — vykonávacie nariadenie (EÚ) 2025/776 zo 14. 4. 2025. ❌
- **IRGC** — teroristický zoznam EÚ (spoločná pozícia 2001/931/SZBP), formálne prijaté
  **19. 2. 2026** → zmrazenie, zákaz sprístupňovať prostriedky. **Fars** (úzko prepojená s IRGC)
  a **Sepah News** preventívne ❌.
- **Ansarallah (Húsíovia)** — EU FSF, režim Jemen (EU-YEM) od 24. 2. 2022; OSN (rezolúcie
  2216/2624) od 2023. Obsah ich médií = sprístupnenie hospodárskych zdrojov listovanej
  osobe (rovnaká logika ako Rybar, FAQ Q11) → **Al-Masirah TV a Saba zo Saná ❌**.
- **Hizballáh** — vojenské krídlo na teroristickom zozname EÚ; **Al-Manar** je v USA SDGT,
  v EÚ zakázané satelitné vysielanie (2005) a zákazy vo FR/DE/ES/NL. ❌
- **Hamas, Palestínsky islamský džihád** — teroristický zoznam EÚ → kanály al-Kassám a pod. ❌
- Implementácia: rozšíriť `src/data/sanctionedMedia.js` o sekciu „Irán / Jemen / Libanon"
  s právnym základom po položkách (dnes pokrýva len prílohu XV nar. 833/2014 + Rybar).
- Tvrdenia týchto strán len cez sekundárne spravodajstvo so štítkom „tvrdí Irán / Húsíovia /
  Hizballáh", nikdy z ich kanálov.

---

## J. Podkladové geodáta

- **OSM** (Geofabrik: israel-and-palestine, lebanon, syria, yemen, iran, iraq, gcc-states…;
  alebo Overpass dlaždice ako pri Ukrajine) — ODbL, vlastný súbor. ✅
- **HDX COD-AB** (zmerané `package_show`): LBN, SYR, YEM, IRQ, IRN, PSE, ARE, QAT, BHR =
  **CC BY-IGO** ✅; **SAU, OMN, KWT sú prevzaté z GADM** (zdroj „www.gadm.org") → ❌ (GADM
  zakazuje redistribúciu); **ISR, JOR na HDX chýbajú** → OSM `admin_level`. robots.txt HDX
  zakazuje /api/ a *.geojson → jednorazový ručný snímok (lekcia z Ukrajiny).
- **GeoNames** CC BY 4.0, **Wikidata** CC0 (mená ar/fa/he/en), **Natural Earth** PD (sporné
  územia: Golany, Západný breh — predvolený pohľad vs. POV súbory, otázka v pláne).

---

## K. GitHub — čo som prehľadal (dotazy a užitočné nálezy)

Dotazy (`gh search repos`, zoradené podľa aktualizácie): hormuz, houthi attacks, red sea
shipping attacks, iran war 2026, oref alerts, pikud haoref, tzeva adom, gaza damage, gaza
geojson, lebanon strikes, yemen conflict data, syria control map, gps jamming, gpsjam,
portwatch, liveuamap, acled middle east, ukmto, iran war map + code search „ukmto.org",
„yellow line" geojson.

Užitočné: `amitfin/oref_alert` (polygóny HFC, MIT), `oref-alerts/oref-alerts.github.io`
(história poplachov), `Wyvern-2021/ukmto-signage` a `Danjones-DJ/UKMTO-Incidents` (UKMTO
mirror), `TechForPalestine/palestine-datasets` (PD súčty), `marijachek/rerouted-barrels`
(PortWatch metodika), `yasumorishima/hormuz-ship-tracker` (AIS metodika),
`vatsimnetwork/vatspy-data-project` (FIR, CC BY-SA), `NegativeBounce/api-library`
(katalóg API, potvrdzuje „UKMTO nemá API").

Nepoužiteľné: desiatky „Hormuz monitor/dashboard" repozitárov bez dát (len UI nad cudzími
API), `bothness/gaza-geojson` a `btselem/map-data` (2023), `FedeCaprari/LebanonStrikesMap`
(CC0, ale 2006 a 2023–24), iránske „war map" Next.js šablóny bez dát.
