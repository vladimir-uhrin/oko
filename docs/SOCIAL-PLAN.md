# OKO — Štúdio sociálnych sietí (plán, PRIORITA)

Stav: **Fáza 1 implementovaná** (2026-10-03) — admin → Štúdio; Fázy 2–4 čakajú. Cieľ: z admin panelu
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
