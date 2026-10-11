# Inventár tlačidiel OKO (stav 2026-10-11)

Zmapované na okolive.sk (desktop 1440×900 a mobil 390×844) skriptom, ktorý prešiel všetky
panely, paletu, karty a hárky; doplnené z kódu. 489 unikátnych ovládacích prvkov. Slúži ako
východisko na preusporiadanie rozhrania (vlastník: „tlačidlá nie sú logicky usporiadané").

Poradie panelov v ľavom stĺpci určuje `#left-panel-stack` v `index.html` + CSS `order` v
`style.css` (riadky `#left-panel-stack > #…-panel { order: … }`). Paletu skladá `buildCommands`
v `src/main.js` (poradie skupín `groupOrder`). Mobilný spodný pruh je `src/mobileShell.js`.

## 1. Horná lišta (desktop)

| Kde | Tlačidlo | Čo robí | Kód |
|---|---|---|---|
| vľavo | logo OKO / BETA | nič (len značka) | `index.html` |
| stred, 5 kruhov | `clear-selected-layers` (layers_clear) | vypne všetky zapnuté dátové vrstvy | `ui.js` |
| | `share-btn` (link) | panel zdieľania (odkaz nesie kameru, vrstvy, vybraný objekt) | `ui.js _openSharePanel`, `sharePanel.js` |
| | `reset-globe-view` (public) | úvodný pohľad nad Bratislavou | `ui.js` |
| | `account-btn` (osoba) | účet: prihlásenie / ponuka (Prehľad, Profil, Zabezpečenie, Zariadenia, Aktivita, Administrácia, Odhlásiť) | `src/auth/` |
| | `cmd-launch` (search) | paleta „Hľadať čokoľvek" (klávesa `/`) | `commandPalette.js` |
| vpravo | AKTÍVNY ŠTÝL (NORMAL…) | ukazuje vizuálny štýl; klik otvára **Vizuálne predvoľby** (to isté ako Štýl v spodnej lište) | `ui.js` |
| | JAZYK SK · EN (`lang-btn-sk/en`) | prepne jazyk celého rozhrania | `i18n.js` |
| | TÉMY | ponuka tém (farebné schémy účtu) | `themes…` |
| | SÚKROMIE (`consent-open`) | lišta súhlasu (GA4, cookies) | `consent…` |

## 2. Ľavý stĺpec — akordeón panelov (otvorený je vždy len jeden)

Poradie zhora: **Dátové vrstvy → Počasie → Konflikty (Kartičky) → Ukrajina → Blízky východ →
Plyn → Ropa → Scény → História letov → Kamery → Kontext → Zobrazenie**. Rádio je skryté
(otvára sa z Kontextu).

### Dátové vrstvy (`data-panel`, 28 prepínačov)
Prepínače ZAP/VYP: Živé lety (+ podriadky Dopravné/Malé/Vrtuľníky/Bizjety, odhad polohy mimo
pokrytia), Vojenské lety, Satelity, Vesmírne misie, Cestná premávka, Kamery, Rádio, Zdieľané
bicykle, Živé plavidlá AIS, Satelitné AIS GFW, Radar Sentinel-1, Lode AISHub, Toky plynu,
Plynovody, Zmapované zariadenia, Letiská, Prístavy, Námorné koridory, Historická hustota lodí
a letov, Dátové centrá, Priehrady, Energetika SR, Podmorské káble. Karta **Prírodné riziká**:
Zemetrasenia, Vulkány, EONET, Požiare FIRMS (+ deň mozaiky), NASA vrstvy (SST, zrážky, sneh,
aerosól, ľad, nočné svetlá).
→ Tie isté vrstvy sú aj v **palete** (skupiny Vo vzduchu / Na mori / Zem a počasie…) a v
**mobilnom hárku Vrstvy**. Tri miesta pre jednu vec.

### Počasie (`weather-panel`, 5 prepínačov)
Meteorológia GFS, Výstrahy SHMÚ, Stanice SHMÚ, Radar SHMÚ, Radar Európa OPERA. Po zapnutí
GFS sa vpravo ukáže **dok počasia** (`weather-dock`, 19 tlačidiel: Vietor/Nárazy/Teplota/Tlak/
Zrážky/Oblačnosť, 7 výškových hladín vetra, Radar EÚ/SK, Výstrahy, Stanice, Prúdnice, Zbaliť).
→ Prepínače radaru/výstrah/staníc sú duplicitne v paneli aj v doku.

### Konflikty · KARTIČKY (`oko-conflicts-panel`)
Export kartičiek konfliktov na siete: Feed / Štvorec / Story / Kartička, Exportovať všetky,
Kopírovať prehľad, Zavrieť. (Nástroj vlastníka; v hlavnom stĺpci je medzi vrstvami.)

### Ukrajina (`ukraine-panel`, 16)
ZOBRAZIŤ PODKLAD (KARTA), VYPNÚŤ UKRAJINU, 12 smerov frontu (Celý front, Sumský, Vovčansk,
Kupiansk, Lyman, Sloviansk–Kramatorsk, Kosťantynivka, Pokrovsk, Oleksandrivka, Huliajpole,
Orichiv, Cherson). Po otvorení smeru: čip podkladu (SÍDLA/CESTY/RIEKY/OBLASTI/STRETY), vrstvy
DeepState/ETH/alarmy/udalosti s filtrami 24 h…všetky a 11 typov udalostí, časová os
(o okno späť/vpred, prehrať, rýchlosti, legenda, odkaz na okamih, zavrieť os).
→ Smery frontu sú aj v palete (skupina Ukrajina) a v Scénach (`front-select`). Tri miesta.

### Blízky východ (`mideast-panel`, 14)
Prehľad regiónu + 11 dejísk (Hormuz a blokáda, Záliv energetika, Irán údery, Južný Libanon,
Gaza, Izrael poplachy, Západný breh, Jemen a Báb al-Mandab, Jemen, Južná Sýria, Irak).
→ Aj v palete (skupina Blízky východ) a v Scénach (`mideast-select`). Úžiny (Hormuz, Malacca,
Báb al-Mandab, Suez, Bospor, Panama, Gibraltár, Dover) sú LEN v palete a v Scénach
(`chokepoint-select`) — nemajú vlastný panel.

### Plyn (`gas-panel`) a Ropa (`oil-panel`)
Plyn: karty cien/tokov s rozsahmi 1M/1R/5R/MAX/2R, OBNOVIŤ, „Preletieť k stanici" (111
tlačidiel pri rozbalených staniciach), ZAPNÚŤ AIS, „Preletieť k lodi" (LNG tankery). Ropa:
len rozbaliť/zbaliť (čip s cenami Brent/WTI je vpravo hore ako samostatný prvok).

### Scény (`scene-panel`, 18)
Tri výbery na prelet (úžina, smer frontu, dejisko Blízkeho východu), Predpis scény, NOVÁ,
ZMAZAŤ, ZACHYTIŤ ZÁBER, UPRAVIŤ ZÁBER, NAČÍTAŤ, ŠTART/STOP/ĎALŠÍ, EXPORT PREDVOLIEB, IMPORT,
LOG BEHU. Nástroj režiséra scén (video) zmiešaný s preletmi, ktoré sú aj inde.

### História letov (`history-panel`, 28)
Karty LIETADLÁ / LODE (od 10-11), UDALOSTI NA KONTROLU (vlastník), hľadanie + rozsah
(24 h…365 dní), štátne lietadlá SR (OM-BYA…), detail: ◀ ZOZNAM, posuvník, PREHRAŤ, 1×/10×/
60×/300×, SLEDOVAŤ, TERAZ ŽIVO; lode: rýchlosti 1 min/s…4 h/s, GPX/KML. Názov panelu
„História letov" už nesedí (lode, udalosti).

### Kamery (`cctv-panel`, 21)
KAMERY VYP, NAJBLIŽŠIA, PRED/ĎALŠIA, výber kamery, ZAMERAŤ, POKRYTIE, AUTO SKOK, PROJEKCIA,
ťahanie kamery, 7 kalibračných polí (kurz, sklon, FOV, dosah, výška, posuny), ULOŽIŤ/RESET
KAL. Kalibrácia je nástroj vlastníka vo verejnom paneli.

### Kontext (`global-context-panel`, 14)
Kompaktné rádio (zapnúť, prev/play/next, hlasitosť, podrobné rádio, zavrieť), „Cyklí
najbližšie kontakty", VESMÍRNE MISIE, HĽADAŤ BLÍZKE ZARIADENIA, „Preklasifikovať na TR-3B".
→ Rádio je na troch miestach: tu (mini), skrytý `radio-panel` (plné ovládanie + filter +
ladenie) a kokpit (`cockpit-radio-panel`). Zmes nesúvisiacich vecí.

### Zobrazenie (`pp-toggles`, 25)
HUD (H) + rozloženie HUD, Detekčný overlay (hustota, pružná/vážená, tlmenie, priehľadnosť),
3D lietadlá (blízke/všetky), Deň/noc, Svetlá miest, Jednotky, Plátno 2D, Priezor (+ mäkkosť),
Nebeský prstenec, Skryť prvky rozhrania, Žiara/Bloom, Doostrenie.
→ Tri „vizuálne" miesta: Zobrazenie (tu), Vizuálne predvoľby/Štýl (spodná lišta: Normal, CRT,
NVG, FLIR, Anime, Noir, Snow + AUTO podklad), Témy (pravý horný roh). Plus **čip podkladov**
(`map-stack-chip`: Google 3D, Bing, OSM, Karta frontu, Stadia, NASA, ÚGKK Ortofoto) — mapový
podklad je v Štýle, nie v Zobrazení.

## 3. Spodná lišta (desktop)
`Poloha` (panel polohy: rýchle mestá Austin…Washington, hľadať miesto, uložiť záložku —
americké predvoľby z upstreamu), **mikrofón ZAP/VYP** + model hlasu (`gev-voice-tier`),
**VIZUÁLNE PREDVOĽBY / Štýl** (`control-panel-toggle`). Nad ňou sa zjavujú čipy premávky
úžiny a ceny ropy (pri scénach).

## 4. Karty a kontextové prvky (vpravo / v scéne)
- **Karta lode** (dokovaná vpravo): krížik, zvonček sledovať, história lode, zdieľať; fotka pod
  kartou. Hover kartička má len text.
- **Karta lietadla**: KOKPIT (vstup), SLEDOVAŤ (nad ním), ovládanie vizuálneho režimu kokpitu,
  pás štátneho lietadla (PREDCHÁDZAJÚCE LETY).
- **Kokpit**: kontakty (prev/next/zbaliť), počasie v kokpite, briefing (strany, cyklus, karty
  Signály/Správy/Miestne), rádio, zobrazenie, Opustiť kokpit, Úvodný pohľad.
- **Karta letiska**: Prehrať komunikáciu; **karta udalosti**: ▶ PREHRAŤ LET, zavrieť; **správy
  o požiari**: ×; **účet** (22 tlačidiel profilu, fotky, tém účtu, hesla, e-mailu, exportu,
  zmazania).

## 5. Paleta „Hľadať čokoľvek" (58 položiek pri prázdnom dopyte)
Skupiny v poradí: Sledované lety a lode (prihlásený) → Lietadlá/Lode (pri písaní) → Zobrazenie
(Úvodný pohľad, Celý svet, Mapa frontu, OSM, Fotoreál 3D, Čistá mapa, Kartičky konfliktov)
→ Vo vzduchu → Na mori → Zem a počasie → Energia → Mestá → Ukrajina (12 smerov) → Úžiny (8)
→ Blízky východ (12) + Radar len bez AIS + upozornenia push. Paleta je dnes jediné miesto, kde
je všetko pokope — ale je to zoznam, nie štruktúra.

## 6. Mobil (390×844)
Horná lišta: logo, 5 kruhov (vrstvy preč, odkaz, úvodný pohľad, účet, hľadať), SK·EN, TÉMY,
SÚKROMIE. Dok nad spodným pruhom: Poloha, mikrofón, Štýl. Spodný pruh (`oko-appbar`): VRSTVY,
SCÉNY, DÁTA, ZOBRAZENIE, HĽADAŤ — každý otvára hárok s príslušnými panelmi z ľavého stĺpca.

## 7. Pozorované duplicity a nelogickosti (podklad na preusporiadanie)
1. Prepínače vrstiev na 3 miestach (panel, paleta, mobilný hárok); Počasie má navyše dok.
2. Prelety (smery frontu, dejiská, úžiny) na 3 miestach (panely Ukrajina/Blízky východ, paleta,
   Scény). Úžiny nemajú vlastný panel.
3. Tri „vizuálne" ponuky: Zobrazenie (pp-toggles), Vizuálne predvoľby/Štýl (+ podklady), Témy.
   Čip podkladov mapy patrí logicky k Zobrazeniu.
4. Rádio na 3 miestach (Kontext mini, skrytý panel Rádio, kokpit).
5. Panel Kontext mieša rádio, kontakty, vesmírne misie, vojenské zariadenia a TR-3B.
6. Nástroje vlastníka vo verejných paneloch: Kartičky konfliktov, Scény (réžia videa),
   kalibrácia kamier, Udalosti na kontrolu.
7. „História letov" obsahuje aj lode a udalosti — názov nesedí.
8. Úvodný pohľad je v hornej lište, v palete aj v kokpite; zdieľanie v lište aj na karte lode.
9. Panel Poloha má americké rýchle mestá z upstreamu (Austin, San Francisco…), nie SK.
10. Plyn a Ropa: Ropa je prázdny panel (dáta sú v čipe vpravo hore), Plyn má 111 tlačidiel
    „Preletieť" v jednom zozname.

Návrh smeru (na diskusiu): 4 hlavné skupiny — **Vrstvy** (vzduch / more / zem / počasie /
energia), **Miesta a dejiská** (Ukrajina, Blízky východ, úžiny — jeden panel „Konflikty a
úžiny"), **Prehľadávať** (história letov/lodí, udalosti, kamery, rádio), **Zobrazenie** (štýl,
podklad, HUD, detekcia, témy, jazyk) + **Nástroje vlastníka** skryté za prihlásením.

## 9. Preusporiadanie — krok 1 (2026-10-11 večer, v pracovnom strome, NEKOMITNUTÉ)
Cieľ vlastníka: „logické, prehľadné, mobile friendly". Jedna logika pre počítač aj mobil:
- **Stĺpec (desktop):** VRSTVY (Dátové vrstvy, Počasie) · KONFLIKTY (Ukrajina, Blízky východ,
  **Prelety** — bývalé Scény, poradie 23) · ENERGIA (Plyn, Ropa) · **PREHLIADAŤ** (bývalé Nástroje:
  **História** — už nie „História letov", Kamery, Kontext) · NASTAVENIA (Zobrazenie).
- **Mobil:** VRSTVY · **KONFLIKTY** (Ukrajina, Blízky východ, Prelety; nová sekcia namiesto SCÉN)
  · DÁTA (Plyn, Ropa, História, Kamery, Kontext) · ZOBRAZENIE (len Zobrazenie) · HĽADAŤ.
- **Nástroje vlastníka** (`.oko-owner-only`, `body.oko-owner` z roly účtu alebo na localhoste —
  `main.js` za `initAuthPanel`): réžia scén (recept, zábery, ŠTART/STOP, export, log), kalibrácia
  kamier, spúšťač Kartičiek konfliktov. Návštevník ich nevidí; Udalosti ostávajú verejné (ich
  kontrola vlastníka bola skrytá už predtým).
- Testy: `ownerTools.test.mjs` (nový), upravené `panelLaneCss`, `leftLane`, `mobileShell`,
  `cockpitMarkup`, `mideastPanel`. Overené na localhost:4181 (počítač ako hosť, mobil 375 px).
- **Krok 2 (ten istý večer):** Plyn + Ropa → jeden panel **„Ropa a plyn"** (`#gas-panel`; ceny ropy
  ako krátka prvá časť `[data-oil-body]`, plyn pod nimi; `#oil-panel` zanikol, token odkazu `o`
  sa ignoruje, zóna ENERGIA má jediný panel a v kokpite sa skrýva aj jej nadpis). Toast po
  exporte kartičky („Kartička uložená: …"). Príkaz „Kartičky konfliktov" v palete len pre vlastníka.
  Test `ukraineFrontZone.test.mjs` dorovnaný na náhľad KARTY 224 px (súvisí s opravou b3e2518).
- **Krok 3 (vlastník: „áno, sprav vzhľad aj a názvy daj zmysluplné"):** zóna NASTAVENIA →
  **VZHĽAD** s dvoma panelmi: **„Štýl a podklad mapy"** (nový `#look-panel`, order 51 — main.js doň
  po štarte presunie `#style-buttons` a `.map-source-section` z dolnej lišty; `#control-panel`
  ostáva v DOM pre StyleManager, ale skrytý: `body.oko-look-in-lane`) a **„Zobrazenie a efekty"**
  (`#pp-toggles`, order 52). Dolná lišta = Poloha + mikrofón. Mobil: sekcia VZHĽAD = oba panely.
  Token odkazu `n` (`k` je vyradený slovník). Klávesy 1–7 a podklady fungujú ako predtým.
- **Názvy panelov (aby to každý pochopil):** Vrstvy na mape · POČASIE A RADAR · UKRAJINA — FRONT ·
  BLÍZKY VÝCHOD — DEJISKÁ · Prelety kamerou · Ropa a plyn — ceny a toky · História letov a lodí ·
  Dopravné kamery · Rádio a kontakty · Štýl a podklad mapy · Zobrazenie a efekty; zóny Počasie ·
  Konflikty · Energia · Prehliadať · Vzhľad (EN ekvivalenty v i18nStrings, test ownerTools).
- **Zbalené pilulky (vlastník zo snímky: „pretečené, nie rovnako veľké, slabo viditeľné, hover"):**
  jedna šírka 240 px (`--left-collapsed-width`, predtým 176 + štyri panely pevné, ostatné podľa
  názvu), jedno písmo 9 px / 1,3 px veľkými písmenami, deliaca čiara v pilulke skrytá (brala
  názvu ~70 px), opacity 0,9 a text 0,78 (bolo 0,72 / 0,3), hover = 1,0 + jas 1,25 + biely text;
  „Réžia scén" sa v zbalených Preletoch neukazuje. Pravidlo `#left-panel-stack > [data-panel-id].collapsed`.
  PASCA: prehliadač drží `style.css` v cache aj po reload — overovať s `?v=`.
- Ďalšie kroky (drobné): prelety úžin aj do panela Blízky východ; STOP viditeľné počas scény
  (dnes len Esc); zrušenie načítania klikom počas „ZAPÍNAM"; TÉMY vpravo hore premenovať na
  „Články" (sú to obsahové stránky, nie témy vzhľadu).

## 8. Ručný funkčný test (2026-10-11, okolive.sk v paneli prehliadača, 935×860)
Každé tlačidlo klikané naozaj (myšou cez odkaz prvku), účinok overený v DOM, v hashi adresy
alebo na snímke. **Prešlo:** horná lišta (vrstvy preč, odkaz, úvodný pohľad, účet, paleta, SK/EN,
Témy, Súkromie); DÁTA (aj riadky pod orezom — Prístavy `l=o`, Káble `l=u`); POČASIE (GFS prepne
podklad na Stadia dark + os, výstrahy `W`, stanice `S`, radar SHMÚ `h`, OPERA `E`); UKRAJINA
(podklad, SÍDLA/CESTY/RIEKY/OBLASTI/STRETY, DeepState, smery frontu, prelet cez výber, KARTA: Čistá
karta, Snímka, os 24 h/7 d/30 d/od 2022, prehrať/pauza, legenda, odkaz na okamih, zavrieť os,
VYPNÚŤ UKRAJINU vráti Bratislavu); BLÍZKY VÝCHOD (dejiská, KONTROLA SÍDIEL, EASA, UKMTO, GPS,
záložky správ, PortWatch); PLYN (1M/1R/MAX, 1R/5R, OBNOVIŤ → `/api/gas/lng-fleet`); ROPA (čipy
Brent/WTI… porovnanie, rozsahy); SCÉNY (prelety, NAČÍTAŤ, ŠTART, LOG BEHU je vypnutý bez behu);
HISTÓRIA (štátne lietadlo OM-BYA, LODE: hľadanie „TWIN CITY LINER" → 3 kandidáti); KAMERY
(ZAP `l=c`, najbližšia, ďalšia, zameraj, pokrytie/auto skok/projekcia); KONTEXT (kontakty sleduje
lietadlo, vesmírne misie, rádio); ZOBRAZENIE (HUD, detekcia `dm`, 3D, deň/noc, svetlá miest, jednotky,
priezor `sc`, žiara `bloom`, ostrosť `sharpen`); ŠTÝL (CRT/Normal, Bing Aerial/Google 3D,
pripnutie); POLOHA (mestá, hľadanie „Košice"); KARTIČKY KONFLIKTOV (formát, export); KARTA LODE
(zdieľať → panel zdieľania, história → panel LODE s trasou, sledovať → prihlásenie, krížik).

**Chyba (opravená, commit b3e2518):** v KARTE ležalo SÚKROMIE (`#lang-switch` končí pri ~167 px
od pridania riadkov TÉMY a SÚKROMIE) cez tlačidlo Snímka (nástroje na 130 px) → klik otváral dialóg
súkromia. Nástroje 176 px, prehľadová mapka 224 px, test `ukraineKartaLayout.test.mjs`.

**UX nálezy bez opravy (do preusporiadania):**
- klik na prepínač počas „ZAPÍNAM" sa ignoruje (nedá sa zrušiť načítanie);
- × na časovej osi Ukrajiny = odchod z KARTY (zámer v main.js), ale front ostane nakreslený na
  fotorealistickom podklade — používateľ nevie, prečo sa zmenil podklad;
- ŠTART scény skryje celý panel vrátane STOP; zastaví len Escape (nikde nenapísané);
- Snímka (KARTA) a Kartička (export) stiahnu PNG bez akejkoľvek spätnej väzby v rozhraní;
- „Najbližšia kamera" z Bratislavy skočí do Londýna — v dátach nie sú SK/AT kamery;
- prehrávanie osi Ukrajiny pri 30 d zaťaží hlavné vlákno na ~80 % (dlhé úlohy 50–270 ms);
- LOG BEHU v Scénach je vypnutý bez vysvetlenia, kým scéna nebežala.
