---
name: sk-data-source
description: Preverenie slovenského dátového zdroja pred integráciou — dostupnosť, formát, licencia, podmienky použitia. Použi predtým, než sa čokoľvek zo slovenských zdrojov (SSC, NDS, SHMÚ, ÚGKK, data.slovensko.sk, mestské portály) dostane do kódu.
---

# Preverenie SK zdroja

Slovenské dátové zdroje sú väčšinou webové portály, nie API. Rozdiel medzi
"dá sa to stiahnuť" a "smiem to použiť" je tu zásadný — a väčšinou nie je
napísaný na prvej stránke.

## Postup

### 1. Nájdi, či existuje oficiálna forma
Skús v tomto poradí:
- `data.slovensko.sk` — centrálny register otvorených datasetov
- dokumentácia priamo u prevádzkovateľa (SSC, NDS, SHMÚ, ÚGKK)
- WMS/WMTS `GetCapabilities` endpoint, ak ide o mapovú službu

Ak existuje deklarovaný otvorený dataset alebo mapová služba, použi ju.
Scraping je až posledná možnosť.

### 2. Zisti podmienky použitia
Nájdi a **cituj mi** konkrétnu formuláciu — nie svoj dojem z nej. Zaujíma ma:
- Je dielo označené ako otvorené dáta? Akou licenciou?
- Je povolené automatizované sťahovanie?
- Je povolené ďalšie zobrazovanie a v akom kontexte?
- Vyžaduje sa uvedenie zdroja? V akom znení?

Ak podmienky nie sú nikde uvedené, **to nie je súhlas**. Povedz mi to a nechaj
rozhodnutie na mňa. Nepokračuj v implementácii.

### 3. Odober vzorku
Jeden ručný request. Ukáž mi:
- HTTP status a hlavičky (hlavne cache-control a prípadné rate limit hlavičky)
- orezanú vzorku odpovede
- ako často sa obsah reálne mení (dva requesty s odstupom)

Pri kamerách navyše: sú to JPEG snímky, alebo stream? Aké je rozlíšenie?
Majú súradnice a orientáciu, alebo len názov stanovišťa?

### 4. Zhodnoť záťaž
- Koľko requestov za hodinu by vrstva generovala pri bežnom používaní?
- Je to zdroj financovaný z verejných peňazí s malým serverom? Potom cachuj
  agresívne a pollni menej často, než by si technicky mohol.
- Navrhni konkrétny cache interval a zdôvodni ho.

### 5. Zápis
Až po mojom súhlase:
- riadok do `DATA_SOURCES.md` — zdroj, licencia, podmienky, atribúcia
- poznámka do `docs/SK-NOTES.md` — čo zdroj reálne pokrýva a čo nie

## Známe zdroje a stav

Priebežne dopĺňaj, ako sa veci preveria:

| Zdroj | Čo | Stav preverenia |
|---|---|---|
| zjazdnost.sk (SSC) | kamery na cestách I. triedy | nepreverené |
| NDS | diaľničné kamery | nepreverené |
| zjazdnostbbrsc.sk | kamery BB kraj | nepreverené |
| SHMÚ | zrážkový radar, hydrológia | nepreverené |
| ÚGKK geoportál | ortofoto SR, LiDAR DMR 5.0 | nepreverené |
| data.slovensko.sk | register datasetov | nepreverené |

## Čo nikdy

- Neobchádzať robots.txt ani rate limity.
- Nepridávať zdroj, ktorý identifikuje konkrétne osoby alebo vozidlá.
  Kamerový obraz z verejného priestoru je hraničný — zobrazujeme scénu,
  nerobíme z nej vyhľadávanie. Ak ma nejaký zdroj tlačí týmto smerom, zastav sa.
- Nepredpokladať, že "je to na verejnom webe" znamená "smiem to preposielať".
