# Pravidlá pre Antigravity (Autonómny režim)

## Autonómia a rozhodovanie
1. **Maximálna autonómia:** Postupuj samostatne a proaktívne od analýzy cez implementáciu až po overenie a testovanie bez zbytočného pýtania sa na bežné medzikroky.
2. **Minimálny počet potvrdení:** Nepýtaj sa na potvrdenie triviálnych krokov, spúšťanie testov, čítanie súborov ani štandardné úpravy kódu.
3. **Kedy sa pýtať používateľa:**
   - Pred akoukoľvek akciou, ktorá môže stáť peniaze (volania platených API mimo bezpečných limitov, zmeny kvót v Google Cloud / OpenAI atď.).
   - Pred deštruktívnymi a nevratnými operáciami (mazanie repozitára, git push --force na upstream/origin, prepisovanie dát bez zálohy).
   - Pri kritických nejednoznačnostiach v požiadavkách, kde nie je možné zvoliť rozumnú predvolenú možnosť.

## Zásady projektu OKO
- Dodržiavať pravidlá z `CLAUDE.md` a `docs/CURRENT-STATE.md`.
- Žiadny framework (Vanilla JS + CesiumJS + Vite).
- Kľúče a tajomstvá nikdy do klientskeho prehliadača (okrem obmedzených Google Maps a Cesium ion).
- Každá nová vrstva vyžaduje testy (`npm test`).
- Zmeny držať v tematických vetvách s ohľadom na rebase na upstream.

## Vlastník a priority (2026-10-03)
- OKO je pomocný spravodajský portál (pálčivé informácie z domova aj zo sveta), ktorý vlastník prevádzkuje **ako súkromná osoba na svojom osobnom profile**. Zákon č. 265/2022 Z. z. plán nemení — rozhodnuté, neotvárať znova.
- **Nulový rozpočet:** portál zatiaľ nezarába. Všetko musí fungovať zadarmo; platené doplnky len predvolene vypnuté, so stropom v admine a po výslovnom súhlase vlastníka.
- **Priorita:** Štúdio sociálnych sietí v admine (posty, karusely, reels na FB/IG, časom úplná automatika, jazyk SK, hudba/hlas zadarmo). Plán: `docs/SOCIAL-PLAN.md`.
- Technické obmedzenie Meta: cez API sa nedá publikovať na osobný Facebook profil (len na Facebook stránku); Instagram musí byť profesionálny účet (Creator alebo Business). Pre osobný profil OKO len pripraví obsah na ručné zdieľanie.
