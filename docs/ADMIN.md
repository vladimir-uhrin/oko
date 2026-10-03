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

| Sekcia | Čo ukazuje |
| --- | --- |
| Prehľad | počty účtov (overené, nové 24 h / 7 d, prihlásení, zablokovaní), sledované lety; server: beží od, commit, Node, pamäť, veľkosť DB a `.gev-cache` |
| Feedy | stav TomTom, FIRMS, GFW, Meteo, Plyn, archív letov, ACARS, SK terén, CCTV z ich existujúcich `/status` / `/health` endpointov (loopback, 30 s cache). Polia s kľúčom/tokenom sa odstraňujú, ostáva len `hasKey`. |
| Používatelia | hľadanie podľa e-mailu/mena, detail (relácie, aktivita, prihlasovacie metódy, počet sledovaných letov) a akcie |
| Audit | posledných 200 zásahov administrátora |
| Log | posledných ~48 kB z `.gev-cache/logs/oko-server.log` |

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
src/auth/server/admin.js         /api/admin/* (rola, akcie, audit)
src/auth/server/adminSources.js  stav feedov, info o serveri, log
src/auth/server/admin.test.mjs   API testy (404 brána, CSRF, blokovanie, mazanie, redakcia)
```

Testy: `node --test src/auth/server/*.test.mjs`.
