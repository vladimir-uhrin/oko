# MIDs — Maritime Identification Digits

Tabuľka MID → vlajkový štát pre dekódovanie MMSI (prvé 3 číslice bežného
lodného MMSI určujú štát registrácie: 267 = Slovensko, 203 = Rakúsko…).

- **Zdroj:** <https://github.com/michaeljfazio/MIDs> (`mids.json`, stiahnuté
  2026-09-01) — Apache-2.0, kópia licencie v [LICENSE](LICENSE).
- **Pôvod faktov:** ITU, tabuľka Maritime Identification Digits (ITU-R M.585 /
  MARS databáza). ITU publikácie samotné majú copyright — preto bundlujeme
  tento Apache-2.0 prepis, nie priamy výťah z ITU dokumentu.
- **Formát:** `mids.json` je verbatim upstream (`MID: [ISO2, ISO3, subdivízia,
  názov]`); `mids.js` je z neho VYGENEROVANÝ (`MID → [ISO2|null, názov]`) —
  needitovať ručne, pri obnove prepísať oba.
- **Rozsah:** 292 MID záznamov, 201–775, všetky regióny ITU.
- **Použitie:** `vesselLabels.js` → `mmsiFlag()`. Len bežné lodné MMSI
  (MID 2xx–7xx na pozíciách 1–3); pobrežné stanice (00…), SAR letectvo
  (111…), AtoN (99…) a pomocné plavidlá (98…) vlajku zámerne nedostávajú.
