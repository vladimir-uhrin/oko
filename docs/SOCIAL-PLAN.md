# OKO — Štúdio sociálnych sietí (plán, PRIORITA)

Stav: **Fázy 1–3 implementované** (2026-10-03) — admin → Štúdio a Výkon; Fáza 4 (platené doplnky) čaká. Cieľ: z admin panelu
vyrábať a zverejňovať príspevky, fotky, karusely a reels na Facebook a Instagram
z toho, čo OKO naozaj ukazuje.

**Zameranie (vlastník, 2026-10-03):** OKO je pomocný spravodajský portál —
pálčivé informácie všetkého druhu z domova a zo sveta. Sociálne siete sú preto
hlavne **rýchle správy o udalostiach**, ktoré OKO vidí v živých dátach, doplnené
pravidelnými prehľadmi. Rýchlosť je kľúčová, preto je cieľom automatika.

## Hlavné pravidlo: nulový rozpočet

Portál zatiaľ nezarába. **Všetko musí fungovať zadarmo.** Platená vec je len
voliteľný doplnok, predvolene vypnutý, s pevným stropom v admine (Náklady)
a zapína sa až po výslovnom súhlase vlastníka (CLAUDE.md pravidlo 4).

| Časť | Riešenie zadarmo | Platená možnosť (len neskôr, so stropom) |
| --- | --- | --- |
| Zverejňovanie FB/IG | Meta Graph API — bezplatné | — |
| Štatistiky príspevkov | Meta Insights API — bezplatné | — |
| Texty a hashtagy | **šablóny plnené reálnymi dátami** (počty lietadiel, lodí, magnitúda…) | AI text (OpenAI nano model), denný strop |
| Obrázky | existujúce snímky zdieľania (`/api/share`, `/s/<id>.jpg`) | — |
| Video (reels) | headless Chromium + **ffmpeg (open source)** na vlastnom PC | — |
| Mapový podklad vo videu | **bezplatné podklady** (OSM, ÚGKK ortofoto, terén) ako predvolené | Google 3D Tiles, len pre vybrané šablóny, s denným stropom renderov |
| Hudba | voľná hudba (CC0 / bez poplatkov) uložená v repozitári s jej licenciou | — |
| Hlasový komentár | **lokálne TTS so slovenským hlasom** (napr. Piper `sk_SK`, open source, beží na vlastnom PC) — licenciu hlasu overiť | OpenAI TTS (prirodzenejší hlas), denný strop |
| Beh a plánovanie | vlastný server + existujúci tunel + Plánovač úloh | — |

**Google 3D Tiles:** každý render s nimi čerpá dennú kvótu Map Tiles API (CLAUDE.md:
nikdy nič v slučke). Preto predvolene renderujeme na bezplatnom podklade a Google
podklad má v admine vlastný strop renderov za deň (predvolene 0).

## Čo už OKO má

- režim nahrávania v `ui.js` (skryje UI, bezpečný rámik **9:16**),
- režisér scén `src/scenes/` s receptami preletu kamery (`flights-radar`, `orbital-watch`, …),
- snímky zdieľania `/api/share` → `/s/<id>.jpg`,
- admin panel s auditom, stropmi nákladov a zálohami.

## Architektúra

1. **Admin → záložka Štúdio:** šablóny obsahu, náhľad, úprava textu, **Schváliť**,
   naplánovať alebo zverejniť, kalendár, história, štatistiky príspevkov.
   - **Správy (spúšťa udalosť v dátach):** zemetrasenie (prah magnitúdy, bližšie
     k SK nižší prah), požiare z FIRMS, výstraha a radar SHMÚ, hladiny Dunaja a Váhu,
     núdzový kód lietadla (7700) alebo odklon letu, zápchy na diaľniciach,
     udalosti v konflikte (Ukrajina, Blízky východ) z existujúcich vrstiev,
     úžiny a lodná doprava, štart rakety, výkyv cien plynu a ropy.
   - **Prehľady (podľa času):** ranný prehľad „čo sa deje", lietadlá nad SK teraz,
     lode na Dunaji, satelity nad Bratislavou, týždeň v číslach.
   - Formáty: fotka, karusel, reel 9:16 (15–60 s), story.
2. **Renderer (server):** Chromium otvorí glóbus v režime nahrávania 9:16, spustí
   recept režiséra, zachytáva snímku po snímke, ffmpeg spraví MP4 1080×1920 / 30 fps.
   Do videa sa vypáli logo OKO, zdroje dát, atribúcia mapového podkladu a označenie
   „živé / modelované" (pravidlo 2). Jeden render naraz, denný strop renderov.
3. **Meta Graph API:** vlastná Meta aplikácia vo vývojovom režime (len vlastná
   stránka), oprávnenia `pages_manage_posts`, `pages_read_engagement`,
   `instagram_content_publish`.
   - Facebook: `/{page}/photos`, `/{page}/feed`, reels cez `/{page}/video_reels`.
   - Instagram (Business/Creator účet prepojený so stránkou): kontajner média →
     `media_publish`. Video si stiahne z dočasnej podpísanej URL cez tunel.
   - Dlhodobý token stránky len na serveri; admin upozorní pred expiráciou.
4. **Automatika — postupne až po úplnú:**
   - krok 1: pravidlá len pripravujú návrhy, zverejní človek,
   - krok 2: pre šablóny, ktoré prešli schválením bez zmien (napr. 10×), sa dá
     zapnúť automatické zverejnenie,
   - poistky: hlavný vypínač automatiky, max. počet príspevkov za deň, tichý čas
     (napr. 22:00–7:00), **nezverejniť, ak sú dáta zastarané alebo modelované**
     (pravidlo 2), kontrola, že render a text nie sú prázdne, audit každého zverejnenia,
     okamžité stiahnutie príspevku z admina.

## Redakčné pravidlá (spravodajstvo)

- Každý príspevok: **čas stavu** („stav k 14:32"), **zdroj dát** (USGS, SHMÚ, NASA…)
  a odkaz na OKO s miestom na glóbuse.
- Len fakty z dát, žiadne domnienky ani hodnotenia. Neoverené alebo modelované
  údaje výslovne označiť (pravidlo 2); keď údaje nesedia alebo sú staré, nezverejniť.
- Pri nešťastiach a konfliktoch vecný tón, bez senzácie a bez záberov obetí.
- OKO ukazuje objekty, javy a infraštruktúru — **nie ľudí** (pravidlo 6). Správy
  o konkrétnych osobách (kriminalita, politici, celebrity) mimo záber.
- Oprava chyby: príspevok sa upraví alebo stiahne a oprava sa zverejní.

## Na čo si dať pozor

0. **Zákon č. 265/2022 Z. z.:** vlastník prevádzkuje OKO ako súkromná osoba na
   osobnom profile; rozhodol, že to plán nemení (2026-10-03). Uzavreté.
1. **Licencie podkladu:** pred prvým videom overiť podmienky Google Maps Platform
   (EHP od 7/2025) pre záznamy na sociálne siete; s bezplatnými podkladmi overiť
   ich atribúciu (OSM ODbL, ÚGKK).
2. **Licencie dát:** každý zdroj podľa `DATA_SOURCES.md`. **SK kamery (CCTV) vylúčené.**
3. **Etika (pravidlo 6):** žiadne súkromné lietadlá ani jachty s identifikáciou
   majiteľa, žiadne sledovanie osôb. Ukazujeme premávku a javy, nie ľudí.
4. **Limity Mety:** denný limit príspevkov cez API na Instagrame, limity dĺžky
   a formátu reels — fronta ich dodržiava (presné čísla overiť vo Fáze 0).

## Fázy

| Fáza | Výsledok | Náklady |
| --- | --- | --- |
| 0 | Overiť podmienky Google/Meta, založiť Meta aplikáciu, test tokenu | 0 € |
| 1 | Posty s fotkou a karuselom zo snímok OKO, texty zo šablón, schválenie, FB + IG | 0 € |
| 2 | Reels: renderer 9:16 na bezplatnom podklade, 4–5 šablón, náhľad, FB + IG | 0 € |
| 3 | Plánovanie, kalendár, štatistiky príspevkov v admine | 0 € |
| 4 | Voliteľné platené doplnky (AI text, Google podklad, hlas) — len so stropom a súhlasom | podľa stropu |

## Rozhodnutia vlastníka (2026-10-03)

1. **Automatika:** áno, časom úplná — postupne podľa krokov v bode 4 architektúry.
2. **Jazyk:** slovenčina (texty, hashtagy, titulky aj hlas).
3. **Reels:** s hudbou alebo hlasovým komentárom — zadarmo (CC0 hudba, lokálne TTS).
4. **Prevádzka ako súkromná osoba, osobný profil;** zákon 265/2022 plán nemení.
5. **Účty:** vlastník potrebuje pomoc s nastavením FB stránky a Instagram
   profesionálneho účtu — návod v sekcii nižšie.

## Nastavenie účtov (Fáza 0, robí vlastník)

Tajomstvá (App Secret, tokeny) **nikdy do chatu ani do repozitára** — len do `.env`
na serveri.

1. Zapnúť dvojfaktorové overenie na Facebooku aj Instagrame.
2. Facebook stránka OKO (ak ešte nie je): kategória **Spravodajský a mediálny web**
   (News & media website), logo, web okolive.sk.
3. Instagram → profesionálny účet typu **Business**, kategória **Spravodajstvo a médiá**.
4. Prepojiť Instagram so stránkou (nastavenia stránky → Prepojené účty → Instagram).
5. Voliteľne Meta Business portfólio (business.facebook.com) so stránkou aj IG.
6. Meta for Developers účet a aplikácia — spolu, keď začne Fáza 0.

## Fáza 1 — čo je hotové (2026-10-03)

Admin → záložka **Štúdio** (`src/admin/server/studio/`, UI v `src/admin/adminPage.js`).

- **Šablóny** (`templates.js`, len fakty z dát, slovensky, s časom stavu a zdrojom):
  zemetrasenie (prah: do 300 km od SK M ≥ 2,5, do 800 km M ≥ 4, inak M ≥ 6, posledných 6 h),
  prehľad zemetrasení za 24 h (denne od 8:00), štart rakety (posledných 12 h).
  Poloha = najbližšie väčšie mesto (Natural Earth) so svetovou stranou.
- **Obrázok** 1080×1350 JPEG (`card.js`): SVG → sharp, vlastná mapa z Natural Earth
  (pevnina + hranice), logo, zdroj a čas. Žiadny mapový podklad tretej strany, 0 €.
- **Návrhy** v `.auth-data/admin.sqlite` (`studio_drafts`); jedna udalosť = jeden návrh.
  Úprava textu, schválenie, zahodenie, obnovenie; stiahnutie obrázka a kopírovanie
  textu; **„Zdieľal som ručne"** pre osobný profil.
- **Auto-návrhy** každých 10 min (vypínateľné). Zastarané dáta (> 30 min) alebo vypnutý
  zdroj = žiadny návrh.
- **Zverejnenie** (`meta.js`): FB stránka `/{page}/photos` (multipart), Instagram
  `/{ig}/media` → `media_publish` s podpísanou, 30-minútovou URL obrázka
  `/api/studio/media/<id>.jpg` (len schválené návrhy). Čiastočné zlyhanie sa dá
  zopakovať bez duplikátu. Zobrazuje sa denný limit Instagramu.
- **Auto-zverejnenie** pre šablónu sa dá zapnúť až po 10 automatických návrhoch
  zverejnených bez úpravy (vynútené serverom); max. N za 24 h, tichý čas 22–7.
- Všetko ide do auditu admina.

### Zapojenie Facebooku a Instagramu (.env na serveri)

```dotenv
META_PAGE_ID=…            # ID Facebook stránky
META_PAGE_TOKEN=…         # dlhodobý token stránky (pages_manage_posts, pages_read_engagement, instagram_content_publish)
META_IG_USER_ID=…         # ID Instagram profesionálneho účtu prepojeného so stránkou
# voliteľné:
# META_GRAPH_VERSION=v23.0
# STUDIO_PUBLIC_URL=https://okolive.sk   # inak AUTH_PUBLIC_URL / prvý https v AUTH_ORIGINS
```

Bez týchto hodnôt Štúdio beží v režime ručného zdieľania. Token nikdy do chatu,
klienta ani repozitára.

## Fáza 2 — reels (hotové 2026-10-03)

`src/admin/server/studio/reel.js` + fronta v `index.js`, UI v Štúdiu.

- **Video 1080×1920, 30 fps, 12 s** (s hlasom do 30 s), H.264 + AAC 48 kHz, faststart —
  spĺňa požiadavky Instagram Reels aj Facebook Reels. Renderuje sa bez prehliadača
  a bez Google: vlastná mapa z Natural Earth (sharp), animované priblíženie k
  udalosti, pulzujúci bod, odpočítanie čísla, bezpečné zóny reels; ffmpeg skladá
  snímky a zvuk. Na vlastnom PC ~35 s na reel, jedno naraz, fronta prežije reštart.
- **Zvuk:** generovaný ambient (sine + šum, bez licencie) — predvolené; hudba z
  `STUDIO_MUSIC_DIR` (vlastné CC0 skladby, striedajú sa deterministicky); bez zvuku
  (tichá stopa, Meta video bez zvukovej stopy občas odmietne).
- **Hlas (voliteľné, zadarmo):** Piper TTS — `PIPER_PATH` a `PIPER_MODEL` (slovenský
  model, napr. `sk_SK-lili-medium`; licenciu modelu overiť pred použitím). Text =
  titulok + prvá veta; video sa predĺži podľa dĺžky reči.
- **Súbory** v `.auth-data/studio/<id>.mp4` (gitignored, mimo public). Staré sa mažú
  s návrhom (30 dní) alebo 90 dní po zverejnení; osirelé súbory upratuje tick.
- **Zverejnenie:** FB reel `/{page}/video_reels` start → `rupload.facebook.com` →
  finish (`video_state=PUBLISHED`); IG `media_type=REELS` z podpísanej URL
  `/api/studio/media/<id>.mp4` (60 min, Range), čakanie na spracovanie až 5 min.
  Beží na pozadí (API odpovie 202), admin sa obnovuje každých 5 s. Fotka a reel sa
  zverejňujú nezávisle, aj postupne. Limity Mety: 30 FB reels / 24 h, 100 IG
  príspevkov / 24 h.
- **Automatika:** auto-návrh s videom čaká na render a potom sa zverejní fotka aj
  reel podľa cieľov v nastavení (rovnaké poistky ako Fáza 1).
- Požiadavka na server: **ffmpeg** (Windows: `winget install ffmpeg`, alebo
  `FFMPEG_PATH` v `.env`). Bez neho Štúdio ďalej robí fotky; reel skončí s jasnou chybou.

## Fáza 3 — plánovanie, kalendár, výkon (hotové 2026-10-03)

- **Naplánovať:** v karte návrhu dátum a čas (do 30 dní) + ciele (fotka/reel, FB/IG podľa
  pripojenia). Návrh sa označí ako schválený; plánovač (tick každých 10 min) ho zverejní
  v prvom ticku po čase. Ručné zverejnenie plán zruší; „Zrušiť plán" tiež. Chyba
  plánovaného zverejnenia sa zapíše do výsledkov návrhu (status `failed`).
- **Kalendár** v Štúdiu: 7 dní dozadu (zverejnené) a 14 dopredu (naplánované), po dňoch.
- **Výkon** (nová záložka): Meta Insights pre príspevky zverejnené cez Štúdio za 30 dní —
  zobrazenia, dosah, reakcie, komentáre, zdieľania, uloženia; súčty v dlaždiciach, odkazy
  na príspevky. Obnova automaticky každých 6 h a ručne. FB: polia objektu + `/insights`
  (`post_impressions_unique` / `post_total_media_view_unique`, pri reels `views`); IG:
  `like_count`, `comments_count` + `/insights?metric=views,reach,saved,shares`. Názvy
  metrík Meta mení — chýbajúce ostanú „—". Ručne zdieľané príspevky API nevidí.
- Tabuľka `studio_insights`, stĺpce `scheduled_at`, `scheduled_targets` (aditívne).

## Spojenie s Udalosťami a Týždňom na fronte (hotové 2026-10-03)

Po zlúčení s `main` (vetvy vlastníka: video „Týždeň na fronte", poistky nahrávania,
`qa-flight-card`) je **Štúdio jediné miesto zverejňovania** na FB/IG. Ručné zdieľanie
cez `sharer.php` v Udalostiach ostáva ako záloha bez tokenu.

- **Udalosti → Štúdio:** v paneli Udalostí má zverejniteľná udalosť tlačidlo
  „DO ŠTÚDIA" (`POST /api/events/<id>/studio`). Služba udalostí odovzdá Štúdiu kartu
  (feed card ako obrázok), text, prípadne hotové 3D video (4:5) a metadáta;
  vznikne návrh so šablónou `event` (kľúč `event:<id>`, druhý pokus vráti
  `studio-exists`). Importované návrhy nesú odznak „z Udalostí".
- **Reel z videa 4:5:** importované video sa nerenderuje odznova — `padToReel`
  (ffmpeg) ho vloží do 9:16 nad rozmazané pozadie, zvuk ostáva. Obrázok návrhu
  bez karty vznikne z prvej snímky videa (`posterFrame`). Pôvodné 4:5 sa dá
  stiahnuť z karty návrhu (`/api/admin/studio/drafts/<id>/source`).
- **Hlas vlastníka:** keď je v `.env` `AI_TRANSLATORS_MCP_KEY` (rovnaká pamäť
  nahrávok ako video z Udalostí: `<adresár DB>/event-video/voice`), renderované
  reely hovoria hlasom vlastníka; bez kľúča Piper, bez Pipera len hudba. V
  Automatike je pri hlase vidno, ktorý zdroj je k dispozícii (`caps.ownerVoice`).
- **Týždeň na fronte:** sekcia v Štúdiu s vypínačom (predvolene vypnuté) a
  tlačidlom „Spustiť teraz". Zapnuté = raz za týždeň (sobota 7:00, `frontWeek`
  v nastaveniach) Štúdio spustí `scripts/make-front-week-video.mjs` proti
  stránke z `EVENT_VIDEO_PAGE_URL` (inak `http://localhost:4173`), výstup
  `tyzden-na-fronte-<dátum>-titulky.mp4` + text importuje ako návrh šablóny
  `front-week` (kľúč `front-week:<nedeľa>`, jeden beh za deň aj pri chybe).
  Stav a posledný log: `GET /api/admin/studio/front-week`, spustenie `POST` (202,
  409 keď už beží). Automatické zverejnenie podlieha rovnakým pravidlám ako iné
  návrhy (schválenie, tiché hodiny, denný strop).
- **Jedno vlastníctvo:** rola `owner` v DB (`scripts/create-owner.mjs`) a
  `OKO_OWNER_EMAILS` platia rovnako pre admin aj pre Udalosti
  (`isOwnerRequest`).
- Nič z toho nestojí peniaze: ffmpeg, vlastná služba hlasu vlastníka, bezplatný
  podklad videa. Google 3D podklad vo videu ostáva vypnutý podľa pravidla rozpočtu.

## Vylepšenia Štúdia (hotové 2026-10-04)

Všetko zadarmo, nič nové neplatené.

- **Karusel z Udalostí.** DO ŠTÚDIA pošle hlavnú kartu a k nej až 4 snímky kľúčových
  momentov (stopa po moment, moment zvýraznený; `renderCard(event, 'feed', { frame })`).
  Facebook: každá snímka ako nezverejnená fotka, potom jeden príspevok na `/feed`
  s `attached_media`. Instagram: kontajnery `is_carousel_item` → kontajner `CAROUSEL`
  → `media_publish`. Najviac 10 snímok. Snímky sú v tabuľke `studio_images` (aditívne),
  podpísané URL `…/media/<id>-<n>.jpg`. V karte návrhu miniatúry, klik zobrazí snímku.
- **Titulky v reeloch.** Generované reely (zemetrasenia, štarty) majú vpálené vety
  narácie v bezpečnej zóne dole. S hlasom kopírujú nahrávku, bez hlasu vyplnia čas
  medzi úvodom a výzvou. Importované videá titulky už majú zo svojej linky.
- **Opakovanie zverejnenia.** Dočasná chyba Mety (sieť, timeout, HTTP 5xx/429, kódy
  1/2/4/17/32/613) → ďalší pokus o 10, 30 a 90 min (`retry_at`, `retry_n`). Trvalá chyba
  (token 190, parameter 100, oprávnenia) alebo 4. zlyhanie → `failed` a upozornenie.
- **Kontroly pred odoslaním.** Instagram: text ≤ 2 200 znakov, ≤ 30 hashtagov, reel
  3–90 s (dĺžka sa zistí ffprobe pri renderi, stĺpec `video_seconds`). Chyba zablokuje
  len Instagram (409 `limits_exceeded` s dôvodom), Facebook ide. Upozornenia a tipy
  (dlhý prvý riadok nad ~125 znakov, bez hashtagov, bez odkazu) nič neblokujú.
- **Náhľad príspevku.** V karte rozbaľovací náhľad v tvare FB/IG: hlavička, prvých
  ~125 znakov pred „viac", obrázok 4:5, počet snímok, počítadlo znakov a hashtagov
  (živé pri písaní).
- **Najlepší čas.** Po aspoň 5 príspevkoch so štatistikami Štúdio spočíta priemerný
  dosah podľa dňa v týždni a hodiny (Bratislava). V plánovaní je tlačidlo „Dobrý čas:
  pi 18:00", ktoré doplní najbližší taký termín mimo tichých hodín.
  API `GET /api/admin/studio/best-times`.
- **Týždeň na fronte s nižšou prioritou.** Detský proces nahrávania beží s
  `os.setPriority(10)`, aby portál počas 20–60 min behu neodpovedal pomaly.

## Upozornenia vlastníkovi (hotové 2026-10-04)

Admin → Údržba → Upozornenia (`src/admin/server/alerts.js`). Predvolene vypnuté.

- Feed nedostupný dlhšie ako N minút (predvolene 60, zo vzoriek `/status` každých 10 min).
- Nové chyby servera a HTTP 5xx (nový podpis chyby od poslednej kontroly).
- Zlyhané zverejnenie zo Štúdia po vyčerpaní opakovaní.
- Kanál: existujúci webhook mailer účtov (`AUTH_MAIL_ENDPOINT`, `AUTH_MAIL_TOKEN`,
  `AUTH_MAIL_FROM`, `AUTH_PUBLIC_URL`). Bez neho sa upozornenia len zapíšu do zoznamu.
- Príjemca: e-mail z nastavenia, inak prvý z `OKO_OWNER_EMAILS`.
- Ten istý problém najviac raz za 6 h, najviac 12 e-mailov za 24 h. Skúšobný e-mail
  ignoruje strop.

## TODO (čo sa nedá spraviť z kódu)

- **Týždeň na fronte na inom stroji.** Dnes beží na tom istom počítači ako portál, len
  s nižšou prioritou. Úplné oddelenie = plánovaná úloha Windows mimo oko-api, ktorá
  zavolá `POST /api/admin/studio/front-week` alebo importuje výstup. Potrebuje
  rozhodnutie vlastníka o stroji.
- **Overenie s ostrým Meta účtom.** Karusel, reels aj insights sú overené testami so
  simulovanými odpoveďami Graph API. Prvé skutočné zverejnenie ukáže, či Meta nemení
  názvy polí (`attached_media`, `is_carousel_item`).
- **E-mail upozornení.** Treba nastaviť webhook mailer v `.env` (`AUTH_MAIL_*`) — bez
  neho sa upozornenia len zapisujú do admina.
- **Hlas vlastníka v reeloch.** Čaká na `AI_TRANSLATORS_MCP_URL` a `AI_TRANSLATORS_MCP_KEY`
  v `.env` servera.
- **Najlepší čas** začne radiť až po 5 príspevkoch zverejnených cez Meta API.
