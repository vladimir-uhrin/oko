# BLÍZKY VÝCHOD — situačná mapa dejísk v štýle OKO — PLÁN + ZDROJE (2026-09-24, nič nie je implementované)

Používateľ: „chcel by som súčasne pokračovať v Blízkom východe podobne ako Ukrajina. Vytvor
návrhy a plány", „samozrejme potrebuje najprv zdroje dát a informácií", „aj mirrory",
„pozri aj gity".

Cieľ dokumentu: to isté, čo `ukrajina-plan.md` — povedať, **čo vieme spraviť poctivo
z otvorených zdrojov a mirrorov, čo len po kroku používateľa a čo vôbec nie**, a v akom
poradí. Prieskum (zdroje, merania z 24. 9., citáty licencií, GitHub) je v prílohe
`docs/drafts/blizky-vychod-zdroje-prieskum.md`. Dvojité overenie ešte neprebehlo pri žiadnom
zdroji; pred zapojením každého ide checklist `new-data-layer`.

Rozdiel oproti Ukrajine: nie je jeden front, ale **niekoľko dejísk naraz** (vojna s Iránom,
zavretý Hormuz s americkou blokádou, Libanon, Gaza, Jemen a Báb al-Mandab, Irak, Sýria).
Ukrajina má jedného „DeepState"; tu podobný zdroj polygónov kontroly **neexistuje** —
najlepšie, čo je, sú živé Lua moduly Wikipédie (body sídiel), GeoConfirmed (body udalostí)
a úradné námorné/letecké výstrahy.

## 0. Zhrnutie na jednu obrazovku

| Prvok | Dá sa? | Zdroj | Podmienka |
|---|---|---|---|
| Kontrola sídiel (kto drží ktoré mesto) | **áno, hneď** | Wikipédia Lua moduly: Izrael–Palestína (Gaza, Západný breh, **južný Libanon**, upravený 22. 9.), **Jemen (23. 9.)**, Sýria (11. 9.) — CC BY-SA | zovšeobecniť parser z `ukraineControl.js`; farby → strany podľa modulu; vek zdroja nahlas |
| Polygóny kontroly / línia (ako DeepState) | **nie** | nič otvorené: GeoConfirmed líniu verejne nedáva, ISW len so súhlasom, „žltá línia" v Gaze nikde ako GeoJSON | odvodiť raster zo sídiel, vždy „odvodené" |
| Udalosti (údery, zásahy, geolokácie) | **áno, hneď** | GeoConfirmed CSV: Irán 4 144, Izrael/Gaza/Libanon 7 087, Sýria 1 154, Jemen 245 (všetky čerstvé); UCDP candidate (CC BY 4.0, mesačne) | bez ORBAT/jednotiek; zásahy v Izraeli a Zálive s oneskorením (otázka č. 4) |
| Archív úderov na Irán feb–júl | áno, po rozhodnutí | Wikipédia `Template:2026 Iran war map` (294 bodov, 72 % z ISW textov, stojí od 2. 8.) | otázka č. 3 |
| Námorné incidenty | **áno** | UKMTO varovania cez PDF priečinok na mscio.eu (EÚ) + GitHub mirrory | faktické polia + odkaz |
| Prechody úžinami | **áno, hneď** | IMF PortWatch (Hormuz 20. 9. = **1 prechod**, pred krízou ~85/deň) | atribúcia IMF |
| Uzavretý vzdušný priestor | **áno** | EASA CZIB (JSON/CSV/RSS) na hraniciach FIR z VATSpy (CC BY-SA) | prečítať legal notice EASA |
| Rušenie GPS | **áno, vlastný výpočet** | adsb.lol `nac_p`/`nic` (ODbL, už v OKO) — princíp gpsjam.org | gpsjam súbory nie (bez licencie) |
| Poplachy v Izraeli | áno, cez mirror | polygóny oblastí HFC z `amitfin/oref_alert` (MIT); história z `oref-alerts.github.io` | oficiálne API geoblokované (403), Tzofar zakazuje scraping; otázka č. 5 |
| Škody | čiastočne | UNOSAT Gaza CDA 11. 10. 2025 (CC BY-SA), nočné svetlá GIBS (už v OKO), FIRMS (kľúč chýba) | pre Libanon/Irán otvorené hodnotenie škôd 2026 nie je |
| Humanitárne súčty | **áno** | Tech for Palestine (public domain), OCHA/UN News text | **mená obetí nikdy** |
| Internet | áno | OONI (CC BY-NC-SA, precedens TeleGeography), IODA (🟡 podmienky) | vyčlenenie v DATA_SOURCES |
| Správy + oficiálne | **áno** | ZÁLIV/`mideast` pipeline + ~15 overených RSS (ToI, Haaretz, The National, Asharq, Guardian, France 24, UN News, IAEA, NNA, Iran International, BBC Persian…) | rozšíriť blocklist: Press TV, IRIB, Tasnim, Fars, Al-Masirah, Saba (Saná), Al-Manar, Hamas |

Etapy 0–2 idú bez čakania na kohokoľvek. Nič z jadra nezávisí od súhlasu tretej strany
(na rozdiel od DeepState/BBG pri Ukrajine).

## 1. Čo už OKO má (staviame na tom)

- **ZÁLIV / Blízky východ**: `situationNews.js` regióny `gulf` a `mideast` (GDELT + Google News
  RSS + BBC/AJ priame), `gulfIncidents.js` (klasifikácia + gazetteer ~45 miest), hot kartičky
  s bránou priblíženia (`gulfIncidentCards.js`, `sceneRevealGate.js`), bulletin
  `conflictBulletin.js`, preklad `/api/translate`, obrázky `/api/link-image`.
- **Hormuz**: `chokepointScenes.js` (8 úžin vrátane Hormuzu, Báb al-Mandabu, Suezu), počítadlo
  lodí v úžine, AIS živé + AISHub oneskorené, GFW SAR, karta ROPA (Yahoo), hranice štátov
  s plotom, ropovody/plynovody (etapy 0–6 hotové).
- **Ukrajina (vzor, ktorý sa tu zovšeobecní)**: parser Lua modulov Wikipédie + raster zón
  (`ukraineControl.js`, 193 riadkov), archivár v dev serveri (`ukraineEventsProxy.js`),
  archív na D: (`scripts/lib/ukraineArchive.mjs` — už sťahuje GeoConfirmed CSV), model
  udalostí, renderer kariet (`ukraineEventsLayer.js`), časová os (`ukraineTimeline.js` +
  `ukraineTimelineClock.js`), vek zdroja (`ukraineFreshness.js`), panel so smermi, KARTA
  štýl (reliéf, plochy, export), katalóg konfliktov a export kartičiek (`conflictsCatalog.js`
  už má región `middle-east` s jedinou položkou `gulf`), sankčný blocklist.
- **Letectvo**: adsb.lol (ODbL) so stĺpcami `nac_p`/`nic`, hustota letov (`densityDrape.js`).
- **Satelit**: GIBS nočné svetlá SNPP DNB (token `N`), FIRMS vrstva bez kľúča.
- **Tokeny vrstiev**: od 21. 9. `[a-zA-Z0-9]` (62 miest), voľné ešte sú — nová vrstva si
  vezme token až keď je stabilná; prvá verzia ako panel + scéna (vzor UKRAJINA).

## 2. Dejiská (scény ako „smery" pri Ukrajine)

Spúšťač `?mideast=<id>` + `window.__godsEyeView.mideastTheatres.apply(id)` + rozbaľovačka
v SCÉNY; rámovanie kamery POSLEDNÉ (pasca z chokepointov); každé dejisko nesie `newsRegion`,
zoznam vrstiev a zdroje kontroly. Súradnice sú návrh, doladia sa na obrazovke.

| id | Dejisko | Stred | Rámec [Z, J, V, S] | Kontrola | Udalosti | Ďalšie |
|---|---|---|---|---|---|---|
| `overview` | Prehľad regiónu | 29,0 / 45,0 | 30, 11, 63, 40 | — | všetko zhlukované | CZIB zóny, PortWatch 3 úžiny |
| `hormuz` | Hormuz a blokáda | 26,6 / 56,3 | 54, 24,5, 58,5, 28 | — | GC Iran (more), UKMTO | existujúca scéna + PortWatch, GPS rušenie |
| `gulf` | Záliv — infraštruktúra | 26,5 / 52,0 | 47, 23, 57, 30,5 | — | GC Iran (Neutral/Infrastructure) | ropa/plyn, CZIB „Persian Gulf" |
| `iran` | Irán — údery | 32,5 / 53,5 | 44, 25, 63,5, 39,8 | — | GC Iran, Wikipédia šablóna, UCDP | jadrové zariadenia (Wikidata), nočné svetlá, OONI |
| `south-lebanon` | Južný Libanon | 33,3 / 35,45 | 35,0, 32,95, 36,2, 33,7 | IP modul (juh) + Lebanese insurgency | GC israel (Libanon) | Litani, CZIB Libanon |
| `gaza` | Gaza | 31,42 / 34,38 | 34,15, 31,2, 34,6, 31,65 | IP modul (modrá = Izrael, lime = Hamas) | GC israel | UNOSAT škody, súčty T4P |
| `israel` | Izrael — poplachy a zásahy | 31,8 / 35,0 | 34,2, 29,4, 35,95, 33,4 | — | GC israel (oneskorené) | poplachy HFC (polygóny) |
| `west-bank` | Západný breh | 31,95 / 35,25 | 34,85, 31,3, 35,6, 32,6 | IP modul (zelená = PA) | GC israel | súčty T4P |
| `red-sea` | Jemen a Báb al-Mandab | 14,5 / 43,0 | 41, 11,5, 46, 17,5 | Jemen modul | GC Yemen, UKMTO | PortWatch Báb, CZIB Jemen |
| `yemen` | Jemen — celý | 15,5 / 47,5 | 42, 12, 54, 19 | Jemen modul | GC Yemen, UCDP | útoky na Saudskú Arábiu |
| `south-syria` | Južná Sýria | 33,0 / 36,0 | 35,6, 32,3, 36,9, 33,8 | Sýria modul | GC Syria | Golany (sporné, otázka č. 8) |
| `iraq` | Irak | 33,3 / 44,4 | 38,8, 29, 48,6, 37,4 | — (modul stojí od 2/2025) | GC Iran (Irak), UCDP | CZIB Irak |

## 3. Zdroje — verdikt (podrobnosti a merania v prílohe)

**✅ použiť:** Wikipédia moduly IP/Jemen/Sýria/Libanon (CC BY-SA, vlastný súbor) · GeoConfirmed
CSV 4 konflikty (bez ORBAT) · UCDP candidate (CC BY 4.0) · IMF PortWatch (atribúcia IMF) ·
UKMTO varovania (mscio.eu PDF / GitHub mirror, faktické polia) · EASA CZIB · VATSpy FIR
(CC BY-SA) · vlastné rušenie GPS z adsb.lol (ODbL) · polygóny HFC z `amitfin/oref_alert`
(MIT) · UNOSAT Gaza CDA (CC BY-SA) · Tech for Palestine súčty (PD) · OONI (CC BY-NC-SA,
vyčlenenie) · GIBS nočné svetlá · HDX COD-AB LBN/SYR/YEM/IRQ/IRN/PSE/ARE/QAT/BHR (CC BY-IGO,
ručný snímok) · OSM (ODbL) · Wikidata (CC0) · RSS z tabuľky H prílohy.

**🟡 po kroku/rozhodnutí:** Wikipédia šablóna úderov na Irán (otázka 3) · história poplachov
z `oref-alerts.github.io` (otázka 5) · IRNA „tvrdí Irán" (otázka 6) · IODA (e-mail) ·
Cloudflare Radar (token, overiť licenciu) · FIRMS (kľúč) · ACLED len mesačné súčty cez HDX ·
Airwars (licencia neuvedená, len odkaz) · Commons SVG Libanonu (georeferencia) · MARAD
(403, ručne) · GEM trackery (registrácia).

**❌ nie:** ISW/CTP obsah (len titulok + odkaz) · Liveuamap (aj scraper — odporúčanie,
otázka 7) · ACLED surové body aj ich mirrory · Pikud HaOref priamo (403 mimo Izraela) ·
Tzeva Adom/Tzofar (podmienky zakazujú scraping) · gpsjam.org súbory (bez licencie) · NGA MSI
(0 varovaní 2026 pre región) · Press TV, IRIB, Tasnim, Fars, Sepah News, Al-Masirah, Saba
(Saná), Al-Manar, kanály Hamasu/PIJ (sankcie / teroristické zoznamy EÚ) · COD-AB SAU/OMN/KWT
(prevzaté z GADM) · Jerusalem Post RSS (mŕtvy od 6/2025) · moduly Wikipédie Irak/Irán (stoja).

## 4. Právne a etické mantinely (záväzné pre každú etapu)

1. **Sankcie EÚ** — Press TV a IRIB (nar. 359/2011), Tasnim (vykonávacie nar. 2025/776),
   IRGC na teroristickom zozname od 19. 2. 2026 (Fars, Sepah News preventívne), Ansarallah
   v režime Jemen od 2022 (Al-Masirah, Saba zo Saná), vojenské krídlo Hizballáhu (Al-Manar),
   Hamas a PIJ. Logika ako pri Rybarovi (FAQ Q11): aj bezplatné šírenie obsahu listovaného
   subjektu je sprístupnenie hospodárskych zdrojov → nič z ich kanálov, žiadne odkazy.
   `sanctionedMedia.js` dostane sekciu „Irán / Jemen / Libanon / Palestína" s právnym
   základom po položkách a dátumom kontroly; test.
2. **Žiadne pozície, presuny ani rozmiestnenie ozbrojených síl žiadnej strany** (IDF, IRGC,
   Hizballáh, Húsíovia, USA, milície) — obdoba čl. 114-2 pri Ukrajine, tu ako vlastné
   pravidlo. Modelujeme udalosti a infraštruktúru. Vojenské základne nie sú vrstva, len
   miesto udalosti. GeoConfirmed `Units`/`OrbatUnits` a ORBAT endpointy nikdy.
3. **Zásahy v Izraeli a štátoch Zálivu**: izraelská vojenská cenzúra obmedzuje zverejňovanie
   miest dopadov v reálnom čase (aby nepomáhali hodnoteniu zásahov). Návrh: body zásahov na
   území Izraela a štátov Zálivu až s oneskorením ≥ 24 h a s presnosťou na sídlo (otázka 4).
4. **Etická čiara OKO**: žiadne tváre, mená, zoznamy obetí ani novinárov (`killed-in-gaza.json`,
   `press_killed_in_gaza.json` sa nikdy nesťahujú), žiadna poloha autora záberu, grafické
   médiá bez náhľadu. Len typ, čas, miesto, zdroj (Berkeley §31).
5. **Share-alike**: Wikipédia derivát (CC BY-SA), VATSpy (CC BY-SA), UNOSAT (CC BY-SA), OSM a
   adsb.lol (ODbL) — každý vlastný súbor s licenciou; nemiešať s CC BY dátami.
6. **Nekomerčné licencie** (OONI, prípadne Cloudflare Radar): vyčlenenie v DATA_SOURCES ako
   TeleGeography.
7. **Mirrory**: povolené (rozhodnutie vlastníka 24. 9.), licenčné fakty sa zapisujú presne;
   scraping komerčných produktov s ochranou (Liveuamap, Tzofar) nie je mirror.
8. **Poctivosť v UI**: každá vrstva nesie zdroj, dátum snímky, oneskorenie a kategóriu
   (oficiálne / tvrdí strana X / OSINT overené / odvodené / archív); **vek zdroja nahlas**
   (lekcia: Wikipédia pri Ukrajine stála 39 dní). Poplachy: „nie je to varovný systém —
   riaďte sa pokynmi Velenia domáceho frontu".
9. **Registrácie, e-maily a formuláre** robí používateľ; kľúče len v `.env` a na serveri.

## 5. Architektúra

Hlavná myšlienka: **nerobiť druhú kópiu Ukrajiny**, ale vytiahnuť spoločné jadro tam, kde
teraz vzniká druhý konzument, a Ukrajinu prepnúť na konfiguráciu (testy Ukrajiny musia
ostať zelené bez úprav).

```
BUILD / ARCHIVÁR (dev server, .gev-cache = junction na D:)        PROXY (vite.config.js)
 scripts/build-mideast-events.mjs --all|--control|--ucdp|--ukmto   /api/mideast/events?from&to (≤ 31 d)
   GeoConfirmed CSV × 4 (iran, israel, Syria, Yemen) → po dňoch     /api/mideast/control?module&at
   UCDP candidate CSV → mesačne                                     /api/mideast/portwatch   (cache 6 h)
   Wikipédia moduly × 4 → control/<modul>/<deň>.json (+ revízie)   /api/mideast/czib        (cache 6 h)
   UKMTO PDF (mscio.eu) → ukmto/<číslo>.json                        /api/mideast/alerts      (mirror, cache 1 h)
   PortWatch 3 úžiny → portwatch/<deň>.json                         /api/mideast/gpsjam?day  (vlastný zberač)
   EASA CZIB JSON → czib/<deň>.json                                 /api/situation-news?region=<dejisko> (existuje)
   adsb.lol vzorky 6 kruhov / 10 min → gpsjam/<deň>.json            sanctionedMedia filter na všetkom
 → .gev-cache/mideast/<dataset>/…

KLIENT
 src/data/wikiControl.js        ← zovšeobecnený ukraineControl.js: config modulu {title, bbox, ikona→strana,
                                  farby strán, atribúcia}; Ukrajina = jeden config
 src/data/mideastTheatres.js    dejiská (tabuľka kap. 2), ?mideast=<id>, window API
 src/data/mideastEvents.js      GeoConfirmed/UCDP/UKMTO → spoločný tvar udalosti (typ, závažnosť, strana
                                  útočníka, cieľ, presnosť, zdroj, oneskorenie)
 src/mideastPanel.js            panel BLÍZKY VÝCHOD (zóna Konflikty) — pohltí ZÁLIV bulletin
 src/mideastControlLayer.js     body kontroly + odvodený raster (ak to na dejisku dáva zmysel)
 src/…EventsLayer / Timeline    renderer kariet a os: parametrizovať ukraineEventsLayer/ukraineTimeline
                                  regiónom (archív, typy, legenda), nie kopírovať 1 700 riadkov
 src/portwatchCard.js           prechody za deň vs. baseline (graf ako ROPA/plyn)
 src/airspaceZonesLayer.js      CZIB na FIR polygónoch (ground polyline + jemná výplň)
 src/gpsJamLayer.js             bunky 0,5° cez densityDrape (odvodené, ODbL)
 src/israelAlertsLayer.js       polygóny oblastí HFC podfarbené počtom poplachov za deň/týždeň
```

- **Štýl OKO**: monochromatické ikony (úder, zásah, loď, poplach), strany v tlmených farbách
  s legendou podľa modulu (nie univerzálna modrá/červená — Jemen má inú dvojicu než Gaza),
  karta s odznakom kategórie a vekom zdroja, KARTA štýl (reliéf, plochy) pre Libanon, Gazu
  a Jemen v etape 7.
- **Mená**: moduly Wikipédie nesú anglické popisy sídiel (`label = "[[Bint Jbeil]]"`), takže
  prepis arabčiny/perzštiny/hebrejčiny netreba na štart; `latinize.js` vie len uk/ru.
  Texty v arabčine/perzštine/hebrejčine v kartách s `dir="auto"` + strojový preklad.
- **Brána priblíženia**: rovnaká ako Hormuz (`sceneRevealGate`) — na glóbuse nič, pri dejisku
  karty.

## 6. Etapy (odhad; každá končí testami, riadkami v `DATA_SOURCES.md`, zápisom do
`docs/CURRENT-STATE.md` a commitom `git commit -- <moje cesty>` — strom nesie cudzie zmeny)

0. **Mantinely** — **HOTOVÉ 2026-09-26.** `sanctionedMedia.js` sekcia Blízky východ (17 záznamov,
   základy `eu-iran-hr` / `eu-terror-list` / `eu-yemen`, `note` s právnym aktom; Fars a
   Al-Manar/Al-Nour výslovne „precautionary", Saba z Adenu neblokovaná) + test; medzera Google
   News zaplátaná (`sourceHost` z `<source url>`); hot karty filtrujú aj na klientovi; riadky
   „preverené a nepoužité" v DATA_SOURCES (Liveuamap, Tzofar, gpsjam, NGA, COD-AB z GADM).
   Oprava prieskumu: Tasnim je listovaná vyk. nar. 2023/1779 (15. 9. 2023), nie 2025/776.
   Otázky kap. 8 stále čakajú na používateľa.
1. **Kostra + dejiská + panel** — **HOTOVÉ 2026-09-26** (3 agenti + 3 oponentúry, 19 nálezov
   zapracovaných; panel BLÍZKY VÝCHOD pohltil ZÁLIV — otázka 2 rozhodnutá odporúčaním, token `f`;
   situácia `gulf` v katalógu nahradená dejiskami; `local-energy` odstránené = SK sieť; prehľad
   drží kameru < 1,5 M m od stredu kvôli bráne = široký šikmý pohľad, nie celý rámec; hlas
   `show_theatre` až v etape 7). Pôvodný rozsah: `mideastTheatres.js` (12 dejísk), `?mideast=`, SCÉNY
   rozbaľovačka, panel BLÍZKY VÝCHOD v zóne Konflikty (ZÁLIV bulletin sa presunie dnu, čipy
   podľa dejiska), `conflictsCatalog` dostane dejiská (kartičky a export fungujú hneď), hranice
   štátov cez retain. Test: presety, resolver, panel, lane testy.
2. **KONTROLA SÍDIEL z Wikipédie** — **HOTOVÉ 2026-09-26** (`src/data/wikiControl.js` = jeden
   parser riadený konfiguráciou modulu, Ukrajina prepnutá na `UKRAINE_CONTROL_CONFIG` bez zmeny
   jej testov; 4 moduly IP/Jemen/Sýria/Libanon s legendami overenými 24. 9. proti caption a /doc,
   archív `.gev-cache/mideast/events/control/<modul>/<deň>.json` + `/api/mideast/events/control`,
   správca vrstiev po dejiskách s rastrom len v rámci dejiska + 0,2°, čip a legenda po moduloch
   v paneli, vek zdroja s prahom modulu 14/30/45/30 d, ZASTARANÉ jantárovo). Otvorené: hĺbka
   spätnej histórie (dnes týždenne od 28. 2. 2026, IP ideálne od 7. 10. 2023 — jeden dopyt
   naraz, 1,2 s pauzy), voľba výplne po stranách (dnes každá strana vlastnou farbou s rovnakým
   krytím 0,30 — 0,26 na KARTE, Ukrajina plní len RU — rozhodnutie vlastníka, ktoré strany nechať
   bez výplne), spoločný pohľad na Libanon (dnes dve vrstvy a dve legendy, IP + Lebanese
   insurgency, zámerne nezlúčené; raster zón kreslí len prvý modul dejiska = IP, libanonská vrstva
   pridáva len body, aby sa dva priesvitné rastre nad tými istými dedinami nezlievali). Oponentúra
   klienta 26. 9. zapracovaná (rez bodov podľa kódov modulu a mimo rastra dejiska = tyl, brána
   priblíženia schová vrstvy, 200 bez snímky = porucha, deň snímky pamätaný po vrstvách, atribúcia
   konfigurácie = riadok archívu, SK popisy strán). Pôvodný rozsah: 2–3 d.
   `wikiControl.js` (Ukrajina prepnutá na config,
   jej testy bez zmeny) + 4 konfigurácie (IP vrátane juhu Libanonu, Jemen, Sýria, Lebanese
   insurgency), overenie legiend farieb na stránkach máp, archív snímok po týždňoch spätne
   podľa histórie revízií (IP aspoň od 28. 2. 2026, ideálne od 10/2023), vek zdroja s prahom
   podľa modulu, vrstva bodov + odvodený
   raster len tam, kde je hustota (Gaza, juh Libanonu, jemenské fronty). Test: parser na
   fixtúrach z 24. 9., mapovanie ikon, raster viacerých strán.
3. **Správy po dejiskách** — **HOTOVÉ 2026-09-26** (regióny `iran`, `lebanon`, `palestine` = Gaza +
   Západný breh, `israel`, `redsea` = Jemen + Červené more, `syria`, `iraq`; 12 priamych RSS
   v `MIDEAST_FEEDS`, len titulok + odkaz, štítky NNA „oficiálne LB", UN News „OSN", Iran
   International „exilové médium"; deväť čipov spravodaja v paneli, dejisko prepne čip; aktér →
   cieľ vyriešené bodovaním zmienok — „Israeli strike on Yemen" → Jemen, demonymum pred zbraňou nie
   je miesto, štáty a široké moria „približne"; triedenie pozná množné čísla a „blocked/closed"
   len pri trase; závod hot kariet pri prepnutí dejiska opravený). Ostáva: pripnuté oficiálne
   položky (dnes UN News a NNA len ako bežné riadky so štítkom; IAEA feed nedal nič, Crisis Group
   nezaradený) a zdroje v ar/fa/he s prekladom (dnes len anglické feedy). Pôvodný rozsah: 2 d. Regióny `lebanon`, `gaza`, `israel`, `iran`, `red-sea`
   (+ existujúce `gulf`, `mideast`) s dopytmi GDELT/Google News a priamymi RSS s pravidlami
   (unfurl/feedImage/drop/limit/badge); pripnuté oficiálne (UN News, IAEA, Crisis Group, NNA);
   gazetteer rozšíriť a **opraviť aktér → cieľ** (otvorené zo ZÁLIV-u: „Israeli strike on
   Yemen" dnes geolokuje na Izrael); preklad ar/fa/he → sk. Test: klasifikácia, gazetteer,
   blocklist, filtre.
4. **Udalosti + archív + časová os** — 3–4 d. Archivár (vzor `ukraineEventsProxy`),
   GeoConfirmed × 4 po dňoch (bez ORBAT, s oneskorením podľa otázky 4), UCDP mesačne,
   Wikipédia šablóna feb–júl (po otázke 3), UKMTO varovania (parser PDF z mscio.eu, súradnice
   z textu, inak pomenované more); renderer kariet a os parametrizované regiónom. Test: adaptéry
   (CSV so `;` a BOM, prehodené súradnice šablóny), etický filter, oneskorenie, dedup GC/UCDP.
5. **More a vzduch** — 3 d. **5a PortWatch HOTOVÉ 2026-09-26** (karta PRECHODY ÚŽINAMI v paneli:
   Hormuz, Báb al-Mandab, Suez + Mys dobrej nádeje ako obchádzka; okno pred krízou po úžine —
   Hormuz rok pred vojnou s Iránom Ø 84,8, Červené more 1. 1.–15. 11. 2023; archív celej série
   od 2019 na D:, prírastok 45 dní; 20. 9.: −96 % / −67 % / −43 % / +81 %). **5b VZDUŠNÝ PRIESTOR
   · EASA HOTOVÉ 2026-10-03** (bulletiny CZIB z exportu + RSS + stránky bulletinu, kódy FIR len zo
   zátvoriek „Affected Airspace", hranice VATSpy CC BY-SA raz za 7 dní; celý FIR výplň, „časť FIR"
   len prerušovaný obrys; čip + legenda v paneli, 16 aktívnych bulletinov / 30 FIR naživo 3. 10.;
   naživo až vydaním služby oko-api). Popri tom: spoločná brána GDELT (179233e — 165 z 188 dopytov
   padalo na 429). **5c INCIDENTY LODÍ · UKMTO HOTOVÉ 2026-10-03** (oficiálne rozhranie webu UKMTO
   `sccd.royalnavy.mod.uk/api/ukmto/all` so súradnicami, licencia OGL v3.0 — nie PDF z mscio.eu;
   archív rastie zlučovaním, tik 1 h; body vo všetkých dejiskách a v úžinách Hormuz/Báb
   al-Mandab/Suez za bránou priblíženia, farba = druh, veľkosť = vek; čip + legenda v paneli;
   naživo 69 varovaní, Hormuz 7 za týždeň). **Rozhodnutie vlastníka 3. 10. („ser na zákazy"):
   zákazy v podmienkach zdrojov nie sú prekážka — zdroj sa použije a licencia sa poctivo zapíše.**
   Preto je povolené doplniť históriu varovaní pred júlom 2026 z PDF na mscio.eu (poloha odvodená
   z textu „30NM southwest of …") — spraviť s časovou osou (etapa 4). Ostáva zo stage 5: zberač
   rušenia GPS z adsb.lol (6 kruhov po 10 min → bunky 0,5° za deň → densityDrape, prahy
   2 %/10 %). Test: výpočet podielu.
6. **Poplachy, škody, súčty, internet** — 2–3 d. Poplachy HFC (polygóny z MIT mirroru +
   história z mirroru po otázke 5) ako denná/týždenná mapa, nikdy „živý alarm"; UNOSAT Gaza
   CDA statická; Tech for Palestine súčty v karte Gazy a Západného brehu; OONI (a IODA po
   odpovedi) ako čip „internet" pri Iráne, Iraku, Jemene; preset nočných svetiel; FIRMS po
   kľúči. Test: agregácie, vylúčenie mien, disclaimer.
7. **KARTA, export, hlas** — 1–2 d. KARTA štýl pre Libanon/Gazu/Jemen (reliéf, plochy — ak
   treba OSM podklad, tak len pre tieto tri dejiská), kartičky dejísk pre FB (export z K5),
   denný sumár Blízkeho východu (rozšírenie `buildUkraineDigest`-vzoru), hlas `show_theatre`
   (resolver ako `show_front`, nejednoznačné = nikam).

**Odporúčané poradie:** 0 → 1 → 2 → 5a (PortWatch, rýchla výhra) → 4 → 3 → 5 → 6 → 7.
Kontrola z Wikipédie ide skoro, lebo parser už existuje a moduly Jemenu a Gazy/Libanonu sú
čerstvé (upravené 22.–23. 9.).

## 7. Kroky, ktoré musí spraviť používateľ (nikdy agent)

| Krok | Kde | Odomkne | Nutné? |
|---|---|---|---|
| FIRMS MAP_KEY (bezplatný) → `.env` | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | požiare (Irán, Záliv, Libanon, Ukrajina) | odporúčané — chýba od 09-19 |
| Slušný e-mail GeoConfirmed (verejný nekomerčný glóbus, atribúcia) | cez ich web | pokoj v duši | slušnosť |
| E-mail IODA (podmienky dát pre nekomerčné zobrazenie) | ioda.inetintel.cc.gatech.edu | výpadky internetu | voliteľné |
| Cloudflare Radar API token (ak NC licencia sedí) | dash.cloudflare.com | druhý zdroj výpadkov | voliteľné |
| E-mail Airwars (licencia dát) | airwars.org | civilné škody | voliteľné |
| GEM registrácia (trackery ropy a plynu) | globalenergymonitor.org | atribúty infraštruktúry | voliteľné |
| ISW/CTP písomný súhlas | kontakt na policy stránke | mapy Iran Update | voliteľné, skôr nie |

## 8. Otázky pre používateľa (etapy 0–2 idú aj bez odpovede)

1. **Poradie dejísk**: návrh Libanon + Gaza (čerstvá Wikipédia) → Hormuz/Záliv (PortWatch,
   UKMTO) → Jemen a Báb al-Mandab → Irán údery → poplachy Izraela → Sýria, Irak. Iné priority?
2. **Panel**: nový „BLÍZKY VÝCHOD", ktorý pohltí dnešný ZÁLIV (odporúčam), alebo nechať vedľa?
3. **Šablóna úderov na Irán** (Wikipédia, 294 bodov feb–júl, 72 % z textov ISW): použiť ako
   archív s pôvodom v každej karte? Odporúčam áno (fakty z textu, nie ISW geodáta).
4. **Zásahy v Izraeli a Zálive**: oneskorenie ≥ 24 h a presnosť na sídlo? Odporúčam áno.
5. **Poplachy Izraela**: históriu z GitHub mirroru (dáta bez licencie, sú to úradné verejné
   výstrahy) áno/nie? Polygóny oblastí (MIT) áno.
6. **IRNA** ako „tvrdí Irán" (štátna, na zozname EÚ som ju nenašiel)? Press TV/Tasnim/Fars nie.
7. **Liveuamap scraper**: odporúčam nie (komerčný produkt s ochranou, nie mirror dát).
8. **Sporné územia v podklade** (Golany, Západný breh, Gaza): de facto Natural Earth
   s poznámkou, alebo POV súbory?

## 9. Pasce (z Ukrajiny + nové z prieskumu)

- `Template:2026 Iran war map` má **prehodené súradnice** (najprv dĺžka) — test na to.
- GeoConfirmed CSV: oddeľovač `;`, BOM na začiatku, prvé riadky bez dátumu (statické body,
  napr. Fordo) — nezahodiť ticho, zaradiť ako „bez dátumu".
- Pikud HaOref 403 mimo Izraela; Tzofar funguje, ale zakazuje zber → nenechať sa zlákať.
- `\b` pred arabským/perzským/hebrejským písmom v JS regexe nesedí (rovnako ako pri azbuke) →
  lookbehind; RTL texty v kartách `dir="auto"`.
- HDX: COD-AB SAU/OMN/KWT sú z GADM; ISR/JOR chýbajú; robots zakazuje /api/ a *.geojson →
  ručný snímok. HDX search vracia šum — používať `package_show?id=cod-ab-<iso3>`.
- PortWatch pole `date` je `esriFieldTypeDateOnly` (reťazec, nie epoch); `resultRecordCount`
  + `exceededTransferLimit` → stránkovať.
- Mŕtve feedy vracajú 200: Jerusalem Post (6/2025), CENTCOM (2/2026), IDF (0 položiek) —
  zdravie zdroja podľa veku poslednej položky, nie podľa HTTP kódu.
- Vrstva „zapnutá, ale prázdna" nesmie skrývať iné (pasca z DeepState 451, 09-23).
- Z Ukrajiny: Bash heredoc mení `\b` na 0x08 (patchovať cez Edit/Write), skrytý pane = app
  stojí a rAF 1/s, 3D dlaždice 403 v pane zamrznú `camera.flyTo` (overovať `setView`),
  `[hidden]` na flex prvku, async handler + `new URL` bez try zhodí dev server, `touch
  vite.config.js`, Windows názvy bez `:`, sk-SK tisíce = U+202F.

## 10. Súvisiace

Príloha: `docs/drafts/blizky-vychod-zdroje-prieskum.md`. Vzory v kóde: `ukraineControl.js`,
`ukraineEventsProxy.js`, `scripts/lib/ukraineArchive.mjs`, `ukraineEventsLayer.js`,
`ukraineTimeline.js`, `ukraineFreshness.js`, `situationNews.js`, `gulfIncidents.js`,
`chokepointScenes.js`, `conflictsCatalog.js`, `sanctionedMedia.js`, `densityDrape.js`.
Plány: `ukrajina-plan.md`, `potrubia-stav-a-plan.md`. Pamäť: `oko-ukrajina-plan`,
`oko-zaliv-situacia`, `oko-chokepoint-sceny`, `oko-propagacia`.
