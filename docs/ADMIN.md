# OKO — admin panel

Samostatná stránka `/admin.html` (bez Cesia a mapových API) pre prevádzku
verejnej inštancie. Prístup má **iba účet s rolou `owner`** — tú pridelí len
`node scripts/create-owner.mjs` na serveri. Ostatným (aj neprihláseným)
odpovedajú `/api/admin/*` kódom 404, takže admin navonok neexistuje.

## Použitie

1. Prihlás sa účtom vlastníka (`/account.html` alebo tlačidlo účtu na glóbuse).
2. Otvor `https://okolive.sk/admin.html` (lokálne `http://localhost:4173/admin.html`).

Nasadenie: `scripts/oko-publish.ps1` ako vždy — `admin.html` je vstup buildu,
`/api/admin/*` ide tunelom na dev server spolu s ostatným `/api/*`. Tunel netreba
meniť. Ak má Cloudflare pravidlá cache, `/admin.html` a `/api/admin/*` nesmú
ignorovať `Cache-Control: no-store` (rovnako ako `/account.html`).

## Sekcie

| Sekcia | Čo ukazuje / robí |
| --- | --- |
| Prehľad | práve na stránke, návštevníci dnes, požiadavky a chyby 5xx za 24 h; účty (overené, nové, prihlásení, zablokovaní); graf registrácií a prihlásení za 30 dní; server (beží od, commit, Node, pamäť, DB, `.gev-cache`) |
| Analytika | návštevníci, zobrazenia, aktívny čas, boti za 7/30/90/365 dní; vývoj po dňoch, hodina dňa; odkiaľ prišli, krajiny, stránky, zapnuté vrstvy, zariadenia, prehliadače, systémy, šírka okna, jazyk |
| Prevádzka | požiadavky na API, chyby 5xx a priemerná odozva po hodinách (24 h – 30 dní); tabuľka podľa zdroja (počet, 5xx, 4xx, blokované, odozva ø/max, prenos) |
| Chyby | zlúčené chyby: `console.error`/`console.warn` servera, HTTP 5xx, JS chyby z prehliadačov návštevníkov; filter, detail (stack), vymazanie |
| Náklady | OpenAI hlas, OpenAI súhrn, Google Places — počet volaní po dňoch, dnes, 30 dní, **denný strop** (nad ním 429) a cena za jednotku → odhad €; TomTom a GFW aj s kvótou providera z ich `/status` |
| Feedy | všetky dátové zdroje: aktuálny stav, pás dostupnosti 7 dní po hodinách (zo skutočných požiadaviek), výpadky z kontroly statusu každých 10 min, **Vypnúť / Zapnúť** |
| Používatelia | hľadanie, detail (relácie, aktivita, prihlasovacie metódy, počet sledovaných letov) a akcie nižšie |
| Štúdio | návrhy príspevkov pre Facebook a Instagram zo živých dát (zemetrasenia, štarty rakiet) a z Udalostí (tlačidlo „DO ŠTÚDIA", video 4:5 vložené do reelu 9:16), obrázok + slovenský text + reel 9:16 (ffmpeg, hlas vlastníka cez ai-translators alebo Piper), kalendár, plánovanie, úprava, schválenie, zverejnenie cez Meta API alebo ručné zdieľanie; „Týždeň na fronte" raz týždenne (sobota); automatika — pozri `docs/SOCIAL-PLAN.md` |
| Výkon | štatistiky dosahu príspevkov zo Štúdia (Meta Insights, 30 dní) |
| Oznam | text 1–280 znakov, typ info/upozornenie, platnosť; náhľad, ako ho vidia návštevníci |
| Údržba | záloha DB účtov aj admin DB (`VACUUM INTO`, ponechá 14), čistenie povolenej cache |
| Audit | posledných 200 zásahov administrátora (aj zmeny feedov, oznamu, záloh, cache) |
| Log | posledných ~48 kB z `.gev-cache/logs/oko-server.log` |

## Telemetria a súkromie

`src/admin/server/` (plugin `adminPlugin`, `enforce: 'pre'` — middleware stojí pred
všetkými proxy). Dáta sú v `.auth-data/admin.sqlite` (gitignored, blokované vo Vite).

- **Požiadavky na API:** len hodinové súčty po zdroji (`src/admin/server/feeds.js`
  mapuje URL → zdroj; neznáme cesty idú do jednej skupiny `api-other`). Uchováva sa 90 dní.
- **Návštevy:** glóbus (`src/siteTelemetry.js`) pošle pri načítaní `view` (cesta,
  referer, šírka okna, jazyk), každú minútu viditeľnej karty `ping`, ID vrstvy, ktorú
  človek zapne (nie predvolené v prvých 10 s), a najviac 5 JS chýb. Bez cookie a
  localStorage. Server ukladá len denné súčty; krajina z `CF-IPCountry`, prehliadač/
  systém/zariadenie z User-Agentu. **IP ani User-Agent sa neukladajú.** Unikátny
  návštevník = SHA-256 z dennej náhodnej soli + IP + UA; soľ sa každý deň mení a
  hashe sa po polnoci zrolujú do jedného čísla a zmažú. Do Not Track / GPC = nič sa
  neposiela (a server to odmietne aj sám). Boti sa len počítajú. 60 záznamov/min na IP.
  Denné súčty 400 dní. Žiadna poloha ani pohyb po glóbuse (CLAUDE.md pravidlo 6).
- **Chyby:** zlúčené podľa podpisu (čísla ignorované), 30 dní, max 2000. Pred uložením
  sa nahradia `***` všetky hodnoty z `.env`, ktorých názov obsahuje KEY/TOKEN/SECRET/
  PASSWORD/AUTH, parametre `key=`/`token=`/… v URL, `Bearer …` a `sk-…`.

Pred zverejnením štatistiky v spoločnosti doplň zmienku do zásad ochrany súkromia.

## Vypínače feedov, stropy a oznam

- **Vypnúť** zdroj: jeho `/api/...` vracia `503 {error:'disabled_by_admin'}` (status a
  health endpointy idú ďalej, aby admin videl stav). Glóbus to oznámi bannerom
  „Dočasne vypnuté: …" (`src/noticeBanner.js`, pravidlo 2: vrstva bez dát nesmie
  vyzerať živo). Systémové cesty (účty, zdieľanie, admin) sa vypnúť nedajú.
- **Denný strop** (len platené: OpenAI, Google): počíta sa po miestnom dni (Bratislava),
  prežije reštart (dopočíta sa zo štatistiky). Nad strop `429 {error:'budget',
  scope:'admin_daily_cap'}`. Strop z panelu je navyše k limitom v `.env`, nenahrádza ich.
- **Oznam:** `/api/notice` (verejné, cache 30 s); glóbus ho načíta pri štarte a každých
  5 min. Zavretie platí pre daný text do zatvorenia karty.

## Akcie nad účtom

- **Odhlásiť všetky relácie** — zmaže relácie účtu.
- **Zablokovať / Odblokovať** — zablokovaný účet stratí relácie a čakajúce
  e-mailové tokeny a neprihlási sa (heslom ani cez Google/GitHub). Chybu
  `account_disabled` dostane až po správnom hesle, takže zablokovanie
  neprezradí nikomu, kto heslo nepozná.
- **Zmazať účet** — vyžaduje opísať e-mail účtu; `ON DELETE CASCADE` zmaže
  relácie, fotku, tokeny, aktivitu, sledované lety a prepojené identity. Audit
  si ponechá len ID a iniciálu mena, nie e-mail.

Vlastník nemôže meniť sám seba ani iný `owner` účet (409 `owner_protected`).
Každý zásah ide do tabuľky `admin_audit` a do aktivity dotknutého účtu, takže
ho používateľ vidí vo svojom Centre účtu.

## Bezpečnosť

- Rovnaká session, Origin a CSRF kontrola ako centrum účtu; zápisy len s
  `X-CSRF-Token`. Limity: 600 požiadaviek/min, 60 zápisov/min na vlastníka.
- O prístupe rozhoduje výhradne session a rola — nikdy loopback adresa (za
  cloudflared je každý návštevník `127.0.0.1`).
- Admin nevidí heslá, hashe, tokeny ani hodnoty kľúčov. Nevidí ani pohyb ľudí
  po glóbuse — sledované lety len ako počet (CLAUDE.md pravidlo 6).
- Schéma: stĺpec `users.disabled_at` a tabuľka `admin_audit` sú aditívne,
  `user_version` ostáva 5 — staršia verzia servera DB stále otvorí.

## Súbory

```text
admin.html                       stránka (CSP bez inline skriptov)
src/admin/adminPage.js/.css      UI, len textContent
src/admin/charts.js              SVG grafy (paleta overená pre tmavý povrch, tooltip, tabuľka)
src/admin/server/plugin.js       Vite plugin telemetrie (enforce: 'pre')
src/admin/server/runtime.js      middleware, vypínače, stropy, návštevy, chyby, oznam
src/admin/server/store.js        admin.sqlite (agregáty, chyby, vzorky, nastavenia)
src/admin/server/feeds.js        register zdrojov (URL → zdroj, platené, status)
src/admin/server/api.js          výpočty pre analytiku, prevádzku, náklady, históriu
src/admin/server/runtime.test.mjs testy telemetrie, stropov, súkromia, redakcie
src/siteTelemetry.js             anonymná štatistika z glóbusu
src/noticeBanner.js/.css         banner oznamu na glóbuse
src/auth/server/admin.js         /api/admin/* (rola, akcie, audit)
src/admin/server/studio/         Štúdio: návrhy, reel.js (ffmpeg), meta.js (Graph API), adminApi.js
src/auth/server/adminSources.js  stav feedov, info o serveri, log
src/auth/server/admin.test.mjs   API testy (404 brána, CSRF, blokovanie, mazanie, redakcia)
```

Testy: `node --test src/auth/server/*.test.mjs`.
