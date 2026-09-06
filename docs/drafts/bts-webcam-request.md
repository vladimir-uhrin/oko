# Návrh žiadosti o súhlas — web kamera Letiska M. R. Štefánika

Stav (preverené 2026-09-06, viď `.claude/skills/sk-data-source/SKILL.md`): stránka
https://www.bts.aero/web-kamera/ zverejňuje snímku 1920×1080 každých 5 minút
a hodinový archív za 24 h, ale web nemá žiadne podmienky použitia obsahu ani
copyright k snímkam. Podľa pravidiel projektu to nie je súhlas, preto kameru
BTS bez odpovede letiska nezapojíme. Tento text je návrh e-mailu — odosielaš
ho ty, nie OKO.

---

**Komu:** Letisko M. R. Štefánika – Airport Bratislava, a. s. (BTS), tlačové /
marketingové oddelenie (kontakt zo stránky bts.aero)

**Predmet:** Žiadosť o súhlas so zobrazením snímok z web kamery letiska v nekomerčnom projekte

Dobrý deň,

vyvíjam nekomerčný projekt OKO – interaktívny 3D glóbus so živými dátovými
vrstvami (lety, plavidlá, počasie, letiská), s dôrazom na slovenské zdroje.
Pri karte letiska Bratislava by som rád zobrazil aktuálnu snímku z Vašej
verejnej web kamery (https://www.bts.aero/web-kamera/), tak ako ju vidí
návštevník Vašej stránky.

Chcel by som sa preto opýtať, či súhlasíte s tým, aby projekt:

1. zobrazoval aktuálnu snímku kamery (nie archív) priamo z Vašej stránky,
   obnovovanú najviac raz za 5 minút, bez ukladania a bez ďalšieho šírenia;
2. uvádzal pri snímke viditeľný zdroj v znení, ktoré určíte (napr.
   „© Letisko M. R. Štefánika – Airport Bratislava, a. s."), s odkazom na
   Vašu stránku.

Ak preferujete iný spôsob (napr. oficiálny odkaz namiesto vloženej snímky,
iný interval alebo iné znenie zdroja), rád sa prispôsobím. Rovnako rešpektujem,
ak zobrazenie mimo Vašej stránky nie je možné.

Ďakujem za odpoveď.

S pozdravom,
[meno, kontakt]

---

Po kladnej odpovedi: zapísať znenie súhlasu a atribúcie do `DATA_SOURCES.md`
a `docs/SK-NOTES.md` (krok 5 skillu), interval nastaviť podľa odpovede,
cache-ovať aspoň 5 min (Cloudflare posiela snímku s ETag).
