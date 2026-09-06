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
