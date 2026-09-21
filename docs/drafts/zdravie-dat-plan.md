# Zdravie dát — „čo je práve pokazené" (TODO, 2026-09-21, nič nie je implementované)

Používateľ: „zdravie dát napíš ako TODO."

## Prečo

**Konkrétny podnet, nie teória.** 21. 9. som pri overovaní mete náhodou uvidel na časovej osi
odznak „ZASTARANÝ beh" — posledný beh bol z 20. 9. 12Z, teda úloha Plánovača `OKO meteo bake`
medzitým prestala pracovať. Nikde to nebolo hlásené. Keby som sa nepozrel na tú os, nevie o tom
nikto, a portál by ticho servíroval starnúcu predpoveď ako čerstvú.

**Koreňová príčina, overená hneď na mieste:** úloha `OKO meteo bake` v Plánovači
**vôbec neexistuje**. `Get-ScheduledTask` pozná len štyri úlohy — `OKO Cloudflare Tunnel`,
`OKO dev server`, `OKO public static`, `oko-terrain-build`. Skript
`scripts/install-meteo-bake-task.ps1` je napísaný správne (Priority 4, poučenie z hladovania
na BelowNormal), len ho nikto nikdy nespustil. Tých 203 MB v cache teda napečila proxy na
požiadanie, nie plánovač — a nič to nehlásilo.

Presne toto je dôvod tejto úlohy: **chyba nebola v kóde, ale v tom, že o nej nikto nevedel.**

OKO má **36 vrstiev**, desiatky proxy s kvótami a niekoľko úloh Plánovača. Každý z tých kusov
vie zlyhať potichu — a jeden človek, ktorý to prevádzkuje popri práci, to nemá ako zbadať inak
než náhodou. To je prevádzkové riziko, nie kozmetika: portál, ktorý poctivo rozlišuje živé
a modelované dáta, nesmie tíško ukazovať mŕtve.

## Čo už existuje (staviame na tom, nie vedľa toho)

- **Stav feedu na vrstvu.** `FEED_STATE_LABELS` v `src/data/manager.js`:
  `nominal · loading · degraded · stale · fallback · unavailable`.
- **Štatistiky na vrstvu.** `layer.stats`: `count, error, loading, refreshing, stale,
  lastUpdate, managerRefreshError`.
- **Zdroj a vek na vrstvu.** `layer.source` (model, beh, vek) — vrstvy ho už skladajú pre UI.
- **Katalóg mete** hlási `stale`, `baked`, `bakedTotal` (`normalizeCatalog`).
- Kategorizácia vrstiev do tém: `src/layerCategories.js`.

Inými slovami: **dáta na to sú, len nie sú nikde pokope.** To je celá podstata úlohy —
agregácia a zviditeľnenie, nie nový zber.

## Čo postaviť

Jedna obrazovka (alebo karta v palete pod `Zobrazenie`), ktorá odpovie na jedinú otázku:
**čo práve nefunguje a odkedy.** Zoradené podľa závažnosti, nie abecedne.

1. **Vrstvy** — tie, ktoré nie sú `nominal`: stav, vek posledných dát, chyba. Zdravé sa zbalia
   do jedného riadku („28 vrstiev v poriadku"), nech je vidieť len to, čo bolí.
2. **Pečené dáta** — meteo (a čokoľvek ďalšie s cache): beh, vek behu, `baked/bakedTotal`,
   kedy naposledy pribudol súbor. Toto by bolo chytilo dnešný výpadok.
3. **Úlohy Plánovača** — `oko-server`, `oko-tunnel`, `OKO meteo bake`, `oko-ehp-watchdog`:
   kedy naposledy bežali a s akým výsledkom. Windows to vie cez `schtasks /query /v /fo csv`
   → drobný endpoint v dev serveri (LEN lokálne, nikdy nie cez tunel).
4. **Proxy a kvóty** — kde sa naráža na strop alebo 429 (GFW to už rieši frontou a retry;
   TomTom/FIRMS/GIE majú kvóty). Stačí počítadlo na endpoint + posledný chybový kód.

## Dva nálezy z 21. 9. (pri prvom ručnom pečení)

Obe sú presne ten druh tichého zlyhania, o ktorom je táto úloha:

1. **`scripts/meteo-bake.ps1` loguje až na konci behu.** Zbiera výstup do premennej
   (`$out = & node …`) a zapíše ho jedným cyklom po skončení. Úloha Plánovača má strop
   30 minút — **keď ju Windows pri strope zabije, v logu neostane ani riadok.** Log by mal
   tiecť priebežne, inak je pri tom jedinom scenári, kvôli ktorému ho čítame, prázdny.
2. **Rezy stiahnuté proxy sa nikdy neoznačia `baked`.** `bakeOne()` preskakuje podľa toho,
   či PNG aj meta *existujú*, nepozerá na `meta.baked`. Súbory, ktoré natiahla proxy na
   požiadanie, teda bake preskočí a katalóg ďalej hlási nízke `baked/bakedTotal`, hoci dáta
   na disku sú. Ukazovateľ zdravia klame smerom „horšie, než je" — lepšie než opak, ale
   spoľahnúť sa naň nedá. Overené 21. 9.: 278 rezov v cache, katalóg hlásil `baked: 0/25`.

## Zásady

- **Nie nová dátová vrstva.** Žiadny nový zdroj, žiadna licencia, nič do `DATA_SOURCES.md`.
- **Žiadne nové sieťové dopyty kvôli meraniu.** Číta sa to, čo vrstvy aj proxy už vedia.
- **Lokálne.** Stav úloh Plánovača a interné kvóty sa cez verejný tunel nesmú vystaviť.
- **Ticho, kým je ticho.** Keď je všetko v poriadku, nech to nezaberá miesto — jeden riadok.

## Otvorené rozhodnutia

1. Kam to patrí: samostatná karta v palete, alebo zóna v pravom stĺpci? (Ľavý pruh je po
   upratovaní z 21. 9. rozdelený na zóny — toto je skôr „nástroj" než „vrstva".)
2. Má to len ukazovať, alebo aj **upozorniť**? (Nadväzuje na TODO „nech portál zavolá teba" —
   Telegram/notifikácia pri prechode vrstvy do `unavailable` alebo pri zastaranom behu.)
3. Prah pre „zastarané" na vrstvu: fixný, alebo odvodený od kadencie zdroja (GFS 6 h vs
   AIS sekundy)? Odvodený je správnejší, ale treba ho doplniť do registra vrstiev.

## Odhad

Malé. Body 1 a 2 sú čítanie existujúcich polí + jedna obrazovka. Bod 3 potrebuje drobný
lokálny endpoint. Bod 4 počítadlá v proxy. Najväčšia hodnota je v bode 2 — to je presne to,
čo dnes zlyhalo.
