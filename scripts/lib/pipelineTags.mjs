// scripts/lib/pipelineTags.mjs
//
// Čítanie OSM tagov potrubí, zdieľané medzi plynovým a ropným buildom
// (2026-09-19, etapa 2). Dôvod na vyčlenenie nie je elegancia: `diameterMm`
// mala chybu v čítaní palcov a ropovody sa v OSM tagujú v palcoch oveľa
// častejšie než plynovody, takže skopírovať ju do druhého skriptu by znamenalo
// dva domovy pre ten istý defekt a dva snímky na prebudovanie pri oprave.
//
// Modul je čistý a nemá vedľajšie účinky, takže sa dá importovať v teste —
// na rozdiel od samotných build skriptov, ktoré majú vykonateľný kód na
// najvyššej úrovni a import by spustil sťahovanie z Overpassu.

/**
 * Priemer v mm z tagu `diameter`.
 *
 * Zvláda: „1400" (mm), „1.4" (m), „DN 800", „700 mm", `24"`, „36 inch",
 * „48 in", „80 cm", „1.8 m", „600x900" (dvojica rúr → väčšia).
 *
 * Pôvodná verzia stripovala všetky nečíselné znaky a jednotku hádala podľa
 * veľkosti čísla, takže palce čítala úplne zle: `24"` → 24 mm, `42"` → 42 mm,
 * `48 in` → 48 mm. Všetko to padlo pod podlahu 150 mm v klasifikátore, čiže
 * 48-palcová magistrála sa ticho zahodila ako prípojka. Naopak `8"` → 8000 mm
 * prešlo cez pravidlo DN ≥ 300 s nezmyselnou hodnotou a najhrubšou čiarou.
 * Priemer pritom neriadi len text karty, ale aj hrúbku čiary, takže rozbitý
 * parser znamená, že trieda „magistrála vs. odbočka" nehovorí nič.
 *
 * @param {Record<string, string>} tags
 * @returns {number|null} priemer v mm, alebo null keď tag chýba či nedáva zmysel
 */
export function diameterMm(tags) {
  const raw = String(tags.diameter ?? '').trim().replace(',', '.');
  if (!raw || raw.startsWith('-')) return null;
  const m = raw.match(/[0-9]+(?:\.[0-9]+)?/);
  if (!m) return null;
  let num = Number(m[0]);
  let unit = raw.slice(m.index + m[0].length).trim().toLowerCase();
  // „600x900" / „600×900" = dvojica rúr vedľa seba; ber tú väčšiu, teda druhé číslo.
  const twin = unit.match(/^[x×]\s*([0-9]+(?:\.[0-9]+)?)/);
  if (twin) { num = Number(twin[1]); unit = unit.slice(twin[0].length).trim(); }
  if (!Number.isFinite(num) || num <= 0) return null;
  if (/^(?:"|”|″|''|in\b|inch)/.test(unit)) return Math.round(num * 25.4);
  if (/^cm\b/.test(unit)) return Math.round(num * 10);
  if (/^mm\b/.test(unit)) return Math.round(num);
  if (/^m\b/.test(unit)) return Math.round(num * 1000);
  // Bez jednotky: pod 10 je to takmer isto v metroch („1.4"), inak milimetre.
  return num < 10 ? Math.round(num * 1000) : Math.round(num);
}

/**
 * Továreň na klasifikátor „patrí úsek do prepravnej siete?".
 *
 * Logika je pre plyn aj ropu rovnaká; líšia sa len dve konštanty, preto sa
 * vstrekujú namiesto toho, aby sa celá funkcia duplikovala.
 *
 * @param {object} o
 * @param {RegExp} o.excludedUsage hodnoty `usage`, ktoré idú von (distribúcia, areály, zber…)
 * @param {RegExp} o.operatorRe prepravcovia — posledná záchrana pre úsek bez usage, priemeru aj mena
 * @param {number} [o.minDiameterMm] pod týmto priemerom je to prípojka, nie preprava
 * @param {number} [o.bigDiameterMm] nad týmto priemerom je to preprava aj bez ďalších tagov
 * @returns {(tags: Record<string,string>, inRelation: boolean) => 'transmission'|'relation'|'diameter'|'name'|'operator'|null}
 */
export function makeClassifier({ excludedUsage, operatorRe, minDiameterMm = 150, bigDiameterMm = 300 }) {
  return function classify(tags, inRelation) {
    const usage = String(tags.usage || '').toLowerCase();
    if (usage === 'transmission') return 'transmission';
    if (usage && excludedUsage.test(usage)) return null;
    if (inRelation) return 'relation';
    const d = diameterMm(tags);
    if (d !== null && d < minDiameterMm) return null;
    if (d !== null && d >= bigDiameterMm) return 'diameter';
    if (tags.name || tags['name:en'] || tags.ref) return 'name';
    if (tags.operator && operatorRe.test(tags.operator)) return 'operator';
    return null;
  };
}
