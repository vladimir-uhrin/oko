# Lokálne písma (2026-10-04, ikony 2026-10-31)

Admin (`admin.html`) má CSP `default-src 'self'`, preto písma webu (Google Fonts) nesmie načítať zvonka — sú tu lokálne.
Ikony Material Symbols používa hlavná stránka (`index.html`, `style.css`) výhradne odtiaľto: celé písmo z Google Fonts
malo 324 KB, výrez len s použitými ikonami má jednotky KB.

| Súbor | Písmo | Zdroj | Licencia |
|---|---|---|---|
| `jetbrains-mono-latin.woff2`, `jetbrains-mono-latin-ext.woff2` | JetBrains Mono, variabilná váha 100–800 | fonts.gstatic.com (Google Fonts, v24) | SIL Open Font License 1.1 |
| `inter-latin.woff2`, `inter-latin-ext.woff2` | Inter, variabilná váha 100–900 | fonts.gstatic.com (Google Fonts, v20) | SIL Open Font License 1.1 |
| `material-symbols-subset.woff2` (+ `.json` so zoznamom ikon, sha256 a osami) | Material Symbols Outlined, statická inštancia opsz 20 / wght 400 / FILL 0 / GRAD 0, len ikony použité v kóde | fonts.gstatic.com (Google Fonts css2 `icon_names=`, v382) | Apache License 2.0 (Google, github.com/google/material-design-icons) |

Výrez ikon sa neupravuje ručne: po pridaní novej ikony do HTML/JS spusti `node scripts/build-icon-font.mjs`
(zber názvov z kódu, kontrola proti zoznamu Material Symbols, stiahnutie). Test `scripts/lib/iconFont.test.mjs`
padne, kým zoznam v `.json` nesedí s kódom. Odtlačok `?v=` do odkazov dopĺňa Vite (`scripts/lib/iconFont.mjs`).
