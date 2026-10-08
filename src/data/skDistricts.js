// src/data/skDistricts.js
// 79 okresov Slovenska s oficiálnymi kódmi ŠÚ SR (2026-10-08, výstrahy SHMÚ na mape). Kód EMMA_ID
// v MeteoAlarme je „SK" + tento kód (SK106 = Malacky, SK405 = Šaľa); mestá Bratislava (101–105)
// a Košice (802–805) vydáva SHMÚ ako jeden celok (SK100 „Bratislava", Košice podľa mena).
// Čisté dáta a pomôcky, bez DOM a Cesia.

/** [kód, meno, sídlo pre priradenie polygónu (bod v polygóne); null = mestský okres podľa čísla]. */
export const SK_DISTRICTS = Object.freeze([
  ['101', 'Bratislava I', null], ['102', 'Bratislava II', null], ['103', 'Bratislava III', null],
  ['104', 'Bratislava IV', null], ['105', 'Bratislava V', null], ['106', 'Malacky', 'Malacky'],
  ['107', 'Pezinok', 'Pezinok'], ['108', 'Senec', 'Senec'],
  ['201', 'Dunajská Streda', 'Dunajská Streda'], ['202', 'Galanta', 'Galanta'], ['203', 'Hlohovec', 'Hlohovec'],
  ['204', 'Piešťany', 'Piešťany'], ['205', 'Senica', 'Senica'], ['206', 'Skalica', 'Skalica'], ['207', 'Trnava', 'Trnava'],
  ['301', 'Bánovce nad Bebravou', 'Bánovce nad Bebravou'], ['302', 'Ilava', 'Ilava'], ['303', 'Myjava', 'Myjava'],
  ['304', 'Nové Mesto nad Váhom', 'Nové Mesto nad Váhom'], ['305', 'Partizánske', 'Partizánske'],
  ['306', 'Považská Bystrica', 'Považská Bystrica'], ['307', 'Prievidza', 'Prievidza'], ['308', 'Púchov', 'Púchov'],
  ['309', 'Trenčín', 'Trenčín'],
  ['401', 'Komárno', 'Komárno'], ['402', 'Levice', 'Levice'], ['403', 'Nitra', 'Nitra'], ['404', 'Nové Zámky', 'Nové Zámky'],
  ['405', 'Šaľa', 'Šaľa'], ['406', 'Topoľčany', 'Topoľčany'], ['407', 'Zlaté Moravce', 'Zlaté Moravce'],
  ['501', 'Bytča', 'Bytča'], ['502', 'Čadca', 'Čadca'], ['503', 'Dolný Kubín', 'Dolný Kubín'],
  ['504', 'Kysucké Nové Mesto', 'Kysucké Nové Mesto'], ['505', 'Liptovský Mikuláš', 'Liptovský Mikuláš'],
  ['506', 'Martin', 'Martin'], ['507', 'Námestovo', 'Námestovo'], ['508', 'Ružomberok', 'Ružomberok'],
  ['509', 'Turčianske Teplice', 'Turčianske Teplice'], ['510', 'Tvrdošín', 'Tvrdošín'], ['511', 'Žilina', 'Žilina'],
  ['601', 'Banská Bystrica', 'Banská Bystrica'], ['602', 'Banská Štiavnica', 'Banská Štiavnica'], ['603', 'Brezno', 'Brezno'],
  ['604', 'Detva', 'Detva'], ['605', 'Krupina', 'Krupina'], ['606', 'Lučenec', 'Lučenec'], ['607', 'Poltár', 'Poltár'],
  ['608', 'Revúca', 'Revúca'], ['609', 'Rimavská Sobota', 'Rimavská Sobota'], ['610', 'Veľký Krtíš', 'Veľký Krtíš'],
  ['611', 'Zvolen', 'Zvolen'], ['612', 'Žarnovica', 'Žarnovica'], ['613', 'Žiar nad Hronom', 'Žiar nad Hronom'],
  ['701', 'Bardejov', 'Bardejov'], ['702', 'Humenné', 'Humenné'], ['703', 'Kežmarok', 'Kežmarok'], ['704', 'Levoča', 'Levoča'],
  ['705', 'Medzilaborce', 'Medzilaborce'], ['706', 'Poprad', 'Poprad'], ['707', 'Prešov', 'Prešov'], ['708', 'Sabinov', 'Sabinov'],
  ['709', 'Snina', 'Snina'], ['710', 'Stará Ľubovňa', 'Stará Ľubovňa'], ['711', 'Stropkov', 'Stropkov'],
  ['712', 'Svidník', 'Svidník'], ['713', 'Vranov nad Topľou', 'Vranov nad Topľou'],
  ['801', 'Gelnica', 'Gelnica'], ['802', 'Košice I', null], ['803', 'Košice II', null], ['804', 'Košice III', null],
  ['805', 'Košice IV', null], ['806', 'Košice-okolie', null], ['807', 'Michalovce', 'Michalovce'], ['808', 'Rožňava', 'Rožňava'],
  ['809', 'Sobrance', 'Sobrance'], ['810', 'Spišská Nová Ves', 'Spišská Nová Ves'], ['811', 'Trebišov', 'Trebišov'],
]);

const CITY_PARTS = Object.freeze({ bratislava: ['101', '102', '103', '104', '105'], kosice: ['802', '803', '804', '805'] });

/** Meno bez diakritiky, malými písmenami. Pure. */
export function foldName(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Kódy okresov pre oblasť výstrahy (EMMA_ID + meno). SK100 / „Bratislava" = Bratislava I–V,
 * „Košice" = Košice I–IV; inak kód z EMMA_ID, ak okres existuje, alebo zhoda mena. [] ak nič. Pure.
 */
export function districtCodesForArea(emmaId, areaDesc) {
  const known = new Set(SK_DISTRICTS.map(([code]) => code));
  const folded = foldName(areaDesc);
  if (emmaId === 'SK100' || folded === 'bratislava') return [...CITY_PARTS.bratislava];
  if (folded === 'kosice' || emmaId === 'SK800') return [...CITY_PARTS.kosice];
  const m = /^SK(\d{3})$/.exec(String(emmaId || ''));
  if (m && known.has(m[1])) return [m[1]];
  const byName = SK_DISTRICTS.find(([, name]) => foldName(name) === folded);
  return byName ? [byName[0]] : [];
}
