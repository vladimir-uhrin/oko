# OKO — Štúdio sociálnych sietí (plán, PRIORITA)

Stav: **schválený smer, neimplementované** (2026-10-03). Cieľ: z admin panelu
vyrábať a zverejňovať príspevky, fotky, karusely a reels na Facebook a Instagram
z toho, čo OKO naozaj ukazuje.

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
| Hudba / hlas | bez hudby alebo voľná hudba (CC0) uložená v repozitári | hlasový komentár (OpenAI TTS) |
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
   - Šablóny: lietadlá nad SK teraz, lode na Dunaji, zemetrasenie dňa,
     satelity nad Bratislavou, radar SHMÚ, týždeň v číslach.
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
4. **Automatika (neskôr):** pravidlá typu „zemetrasenie M6+ → priprav návrh".
   Bez schválenia človekom sa nič nezverejní.

## Na čo si dať pozor

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

## Otvorené otázky pre vlastníka

1. Existuje FB stránka a prepojený Instagram Business/Creator účet?
2. Schvaľovať každý príspevok, alebo časom aj automatika?
3. Jazyk: SK, EN, alebo oboje?
4. Reels bez hudby, alebo s voľnou hudbou (CC0)?
