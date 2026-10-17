---
name: reel
description: Tvorba reelu (video 9:16 na Facebook/Instagram) k téme alebo udalosti — najprv dobrý scenár s háčikom, ktorý chytí v prvých 3 sekundách, schválenie scenára vlastníkom, až potom render cez make-front-day-video.mjs --scenario. Použi vždy, keď vlastník chce reel/video (často pošle FB príspevok alebo tému).
---

# Reel z OKO

Vlastník (2026-10-17): „vytvor reel, ale najprv dobrý scenár. Prvé 3 s musia chytiť. Napíš do skills.“
Render trvá 30–40 minút — zlý scenár sa nedá opraviť strihom. Preto **scenár je prvý výstup, nie video.**

## Poradie práce (napevno)

1. **Téma a fakty.** Prečítaj zadanie (FB príspevok otvor v prehliadači, rozbaľ text). Každé číslo a tvrdenie
   over v **aspoň dvoch nezávislých zdrojoch**; rozpory (rôzne počty, časy) nepreberaj — zober to, čo sedí v oboch,
   alebo uveď, kto to tvrdí („podľa Sobjanina“). Dátum udalosti si over (správy miešajú noci).
2. **Vlastný dôkaz OKO.** Hľadaj, čo vieme ukázať z vlastných dát — to je to, čím sa líšime (pozri nižšie).
   Vlastné čísla vždy porovnaj s bežným stavom (iná noc, iný deň), inak sú zavádzajúce. Kde OKO nemá pokrytie
   (Rusko — lietadlá), to netvrď.
3. **Zábery.** Satelit (Copernicus), fotky/videá s licenciou alebo z nesankcionovaných médií, mapa z OKO.
4. **SCENÁR → ukáž vlastníkovi** (tabuľka nižšie) a počkaj na schválenie alebo pripomienky.
   Výnimka: vlastník výslovne povie „rob“ / „sprav rovno video“.
5. **Kontrolné snímky** (`--frames`) — skontroluj háčik a 2–3 zábery, až potom celý render.
6. **Odovzdanie:** video + text príspevku (post.txt) cez SendUserFile; nič nezverejňuj (FB robí vlastník).

## Háčik 0–3 s — pravidlá

- **Prvá snímka už nesie príbeh:** najsilnejší obraz, ktorý máme — pohyb, ľudia, oheň, satelitný záber z miesta,
  kontrast (plné nebo → prázdne). Nie pomalý prelet nad prázdnou mapou, nie logo, nie úvod.
- **Prvá veta hlasu ≤ 3 s (≈ 8–10 slov):** najsilnejší overený fakt, konkrétny (číslo, čas, miesto, kto).
  Žiadne „V Rusku sa stalo…“, „Pozrime sa…“. Dobré: „Večer plné nebo. Potom deväť hodín nič.“,
  „Tanker z čiernej listiny USA sa tri dni unášal nad káblami internetu.“
- **Napätie:** kontrast, otázka „prečo“, nečakaný detail — divák musí chcieť vidieť ďalšiu vetu.
- **Karta háčika:** max 2 riadky po ~16 znakov, jedno číslo zvýraznené (`accent`), `sub` = zdroj
  („dáta OKO“, „podľa USGS“). Karta a hlas hovoria to isté naraz.
- **Test:** keby video stíchlo po 3 s — vie divák, o čom je a prečo pozerať ďalej? Ak nie, prepíš.
- Háčik nesmie byť klamlivý ani prehnaný; superlatív len s dôkazom.

Technika: najsilnejší záber je video/fotka → `lines[0].shot = 'clip:0'` a `model.hookOverClip = true` (háčik nad
záberom); inak `opening` s podkladom (`overlay`). Rýchly kontrast = krátka 1. veta na `opening` (podklad zapnutý)
a hneď 2. veta na `spot:*` bez podkladu (strih so zábleskom robí v2 sám).

## Scenár — formát pre vlastníka

| čas | záber (čo je na obraze) | hlas (presne, ako sa vysloví) | karta / titulok | zdroj |
|---|---|---|---|---|

- 7–10 viet, **45–60 s** (hlas ≈ 12–13 znakov/s, v2 ho zrýchli o 10 %). Dlhšie skráť ešte pred renderom.
- Príbeh: háčik → kde/kedy → dôkaz (vlastné dáta, satelit) → ľudia/následky → číslo rozsahu → okolive.sk.
- Čísla vo vete `spoken` slovami („stoštyridsaťštyri“), v `caption` číslicami; mená výslovne („Sentinel dva“,
  „okolajv bodka es ká“).
- Pod tabuľku: návrh prvého riadku príspevku (háčik, ~125 znakov) a zoznam zdrojov.

## Pravidlá obsahu (vždy)

- Po slovensky, bez emoji, tón agentúry; meno vlastníka v komentári nehovoriť; okolive.sk na každej snímke.
- **Sankcie:** obsah médií z `src/data/sanctionedMedia.js` (RIA, Izvestija, Lenta, EADaily, RT, Sputnik…)
  NIKDY — ani ako zdroj faktu. Telegram len nesankcionované kanály (ASTRA, Ostorožno novosti, SOTA, Mash…), vždy
  s menom kanála. Videá z Telegramu: `t.me/<kanál>/<id>?embed=1&mode=tme` → `<video src>` (token, sťahovať hneď).
- Konkurenciu (Flightradar24 a pod.) nemenovať, ani keď je v zadaní.
- Ukrajina: kritický k agresorovi („ruský agresor“), odkaz `https://okolive.sk/?front=front`.
- Zábery s ľuďmi áno, drastické nie. Licencie uvádzať: Commons (autor + licencia), „upravené údaje Copernicus
  Sentinel (rok)“, TeleGeography (CC BY-NC-SA), USGS/NASA (verejná doména).
- Odhad/model označiť ako odhad. Príčinu udalosti len podľa zdroja („ruská pohotovosť hovorí o…“).

## Vlastné dáta OKO — kde hľadať

- Požiare: `/api/firms/history?lat&lon&km&days` (deduplikovať), denné súbory `D:\oko-history\fires`;
  nové priemyselné požiare: `output/terminaly/scan.mjs` + `identify.mjs`.
- Satelit: Copernicus CDSE (kľúče v `.env`), `src/data/quakeSatellite.js` (`processBody`, `satelliteBbox`) —
  Sentinel-2 pravé farby + SWIR (oheň žiari), Sentinel-1 radar cez oblaky; kontrola preletu
  `output/reel-borisoglebsk/check-s2.mjs` (pokrytie a oblaky nad miestom).
- Lietadlá: `D:\oko-history\flight-history.sqlite` (node:sqlite readOnly, Node 24; dopyt podľa času ~100 s/noc);
  typ/registrácia `api.adsbdb.com`. Nad Ruskom riedke pokrytie — porovnávať s inými nocami.
- Lode: `/api/vessel-info?mmsi=`, `/api/ais-live/history?mmsi=&days=`; káble `src/data/local_data/telegeography_submarine_cables`.

## Štýl v3 (návrh 17. 10. — vlastník k v2: „slabá grafika, obsah aj hudba")

- Obraz kreslí `scripts/lib/reelV3` (plátno 1080×1920 v Chrome cez Puppeteer, bez servera, bez Cesia): nočná mapa
  z OSM (Overpass → zjednodušený podklad), animované trasy lietadiel z histórie OKO (timelapse s hodinami), kruh
  okolia, piny s pečiatkou, veľké čísla s odpočtom, stĺpcový graf z vlastných dát, fotky Ken Burns, video ako snímky,
  záverečná karta. Titulky po skupinách (`src/data/reelCaptions.js`). Vzor: `output/reel-moskva-2noc/v3/build.mjs`
  (`--until 14` ukážka, `--stills 1,5,9`, `--skip id`).
- Hudba: napätý dokumentárny pulz — vlastník 17. 10. vybral JayStacksBeats „Tension / Crime Documentary /
  Investigative 001" (Pixabay, `.gev-cache/event-video-capture/music/jaystacksbeats-…-448748.mp3`). Nie Kevin MacLeod
  ani Scott Buckley „Eyes In The Void" (oboje odmietnuté). Len Pixabay bez „Content ID Registered" (na stránke skladby)
  alebo CC BY s autorom na záverečnej karte. Keď si nie som istý, 2–3 verzie toho istého videa (`build.mjs --music X`,
  mení sa len zvuk) a vyberie vlastník. Začiatok výrezu tak, aby silný nástup padol na zlom vo videu; hudba v pauzách
  hlasnejšia, pod hlasom stlmená; efekty tik-tak / šum / úder.
- Obsah: každé číslo z vlastných dát porovnať s bežným stavom (graf), výpadky príjmu dát vylúčiť (konzervatívne);
  údaj z jedného zdroja, ktorý iné zdroje nepotvrdzujú, vypustiť.

## Render (technika)

- Vzory: `output/reel-*/build-scenario.mjs` (Rostov, HALO 6, Borisoglebsk, Moskva, Penza) → `scenar.json`.
- `node scripts/make-front-day-video.mjs --scenario <scenar.json> --out-dir D:/oko-history/front-day/<meno> --style v2 --frames 20,250,…`
  (Node 24: `C:/Users/vladi/AppData/Roaming/fnm/node-versions/v24.20.0/installation/node.exe`), potom bez `--frames`.
- **Len zdieľaný dev server 4173** — vlastný nahrávací server ani kópiu repa nezakladať; keď sa Zem nevykreslí,
  povedať vlastníkovi.
- Hlas vlastníka (OmniVoice cez ai-translators): keď `read_aloud own` neodpovedá, `ai_translators_health` +
  povedať vlastníkovi (reštart služby); `output/reel-moskva-2noc/voicewait.mjs` čaká na obnovu.
- Pasce: piny len v páse obrazovky (`spots.X.pinsMinY`, spodok 1330 px); nadpis spotu ≤ ~22 znakov; štítky na
  fotkách v strede hore a nie pri svetlom pozadí (rozmazané pozadie klipu ich zopakuje ako šmuhu — radšej `kicker`);
  hrúbka čiary podkladu = stroke × (px/° obrazovky ÷ px/° podkladu); kruhy v rovnobežkovej projekcii `rx/cos(šírky)`;
  satelitný podklad z blízka namiesto reliéfu (reliéf je pri 10–40 km len zelená plocha).
