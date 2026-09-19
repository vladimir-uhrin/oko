// src/data/ukraineIncidents.js
/**
 * @module ukraineIncidents
 * @description Gazetteer a klasifikácia udalostí pre región `ukraine` v pipeline
 * správ z otvorených zdrojov (modul UKRAJINA, etapa 2, 2026-09-19). Rovnaký
 * princíp ako gulfIncidents.js: udalosť sa klasifikuje podľa TITULKU a kotví
 * na prvé miesto z gazetteeru, ktoré titulok menuje; bez miesta sa v tomto
 * regióne KARTA NEKRESLÍ (predvolený bod „niekde na Ukrajine" by bol šum, nie
 * informácia — REGION_DEFAULT.ukraine = null v gulfIncidents.js).
 *
 * POCTIVOSŤ: každá karta je hlásená a neoverená udalosť z otvorenej
 * žurnalistiky, odkazuje von, modeluje udalosti a infraštruktúru — nikdy osoby.
 * Čl. 114-2 TZ Ukrajiny: nič tu neurčuje polohu ukrajinských jednotiek —
 * kotvy sú sídla a objekty menované v titulku. Modul je čistý.
 */

/**
 * Triedy udalostí v poradí priority. `re` musí sedieť; `requires` (ak je)
 * musí sedieť tiež — infraštruktúra bez činu („energy sector reform") nie je
 * udalosť; `unless` (ak je) nesmie sedieť — zostrelené drony sú PVO, kým nič
 * nezasiahli. Námorné a PVO idú PRED úderom, lebo ich titulky vždy nesú aj
 * „drone/missile". severity → farba karty.
 */
export const UKRAINE_INCIDENT_RULES = Object.freeze([
  { type: 'naval', severity: 'major', re: /\b(black sea|sea of azov|sea drone|naval drone|warship|frigate|corvette|landing ship|submarine|fleet|tanker|cargo ship|vessel)\b/i, requires: /\b(attack(?:ed|s)?|hit|struck|strike|sunk|sank|damag(?:e|ed|es)|destroy(?:ed)?|explosion|drone|missile|seiz(?:e|ed)|blockad(?:e|ed))\b/i },
  { type: 'air-defence', severity: 'minor', re: /\b(shot down|shoots down|downed|intercept(?:ed|s|ion)?|air defen[cs]e|air-defen[cs]e)\b/i, unless: /\b(hit|hits|struck|kill(?:ed|s|ing)?|dead|damag(?:e|ed|es)|casualt(?:y|ies)|injur(?:ed|ies)|wound(?:ed|s))\b/i },
  { type: 'strike', severity: 'critical', re: /\b(missile|missiles|drone|drones|shahed|geran|iskander|kinzhal|kalibr|glide bomb|guided bomb|strike|strikes|struck|shelling|shelled|shell|rocket|rockets|air ?raid|bombed|bombing|hit by)\b/i },
  { type: 'fire', severity: 'critical', re: /\b(explosion|explosions|explode[sd]?|blast|ablaze|on fire|caught fire|burning)\b/i },
  { type: 'infrastructure', severity: 'major', re: /\b(power (?:plant|station|grid|line)|substation|thermal plant|hydro|refinery|oil depot|fuel depot|gas (?:plant|facility|storage)|energy (?:facility|facilities|infrastructure)|blackout|power outage|railway|rail hub|bridge|port|terminal|pipeline|dam|nuclear plant|npp|water supply)\b/i, requires: /\b(hit|hits|damag(?:e|ed|es)|destroy(?:ed|s)?|attack(?:ed|s)?|struck|strike|explosion|blaze|fire|outage|blackout|knocked out|cut off|disrupt(?:ed|s|ion))\b/i },
  { type: 'ground', severity: 'major', re: /\b(assault|assaults|offensive|advanc(?:e|ed|es|ing)|captur(?:e|ed|es)|seiz(?:e|ed|es)|liberat(?:e|ed|es|ion)|recaptur(?:e|ed)|infiltrat(?:e|ed|ion)|push(?:es|ed)? (?:into|toward)|fighting (?:in|near|for)|battle for|storm(?:ed|ing)|breakthrough|front ?line|encircl(?:e|ed|ement)|withdr(?:aw|ew|awal)|retreat|repel(?:led|s)?)\b/i },
]);

/**
 * Gazetteer Ukrajiny + pohraničia: `aliases` sú malé písmená hľadané ako
 * podreťazce v titulku, poradie špecifické → široké (mesto pred oblasťou pred
 * štátom). `[lat, lon]`. Kotvy sú SÍDLA a OBJEKTY, nie jednotky.
 */
export const UKRAINE_GAZETTEER = Object.freeze([
  // Frontové mestá a smery (východ)
  Object.freeze({ name: 'Pokrovsk', lat: 48.28, lon: 37.18, aliases: ['pokrovsk'] }),
  Object.freeze({ name: 'Myrnohrad', lat: 48.29, lon: 37.27, aliases: ['myrnohrad', 'myrnograd'] }),
  Object.freeze({ name: 'Dobropillia', lat: 48.47, lon: 37.08, aliases: ['dobropillia', 'dobropillya'] }),
  Object.freeze({ name: 'Kostiantynivka', lat: 48.53, lon: 37.71, aliases: ['kostiantynivka', 'kostyantynivka', 'konstantinovka'] }),
  Object.freeze({ name: 'Chasiv Yar', lat: 48.59, lon: 37.83, aliases: ['chasiv yar', 'chasov yar'] }),
  Object.freeze({ name: 'Toretsk', lat: 48.39, lon: 37.85, aliases: ['toretsk'] }),
  Object.freeze({ name: 'Bakhmut', lat: 48.59, lon: 38.0, aliases: ['bakhmut'] }),
  Object.freeze({ name: 'Siversk', lat: 48.87, lon: 38.11, aliases: ['siversk'] }),
  Object.freeze({ name: 'Lyman', lat: 48.99, lon: 37.8, aliases: ['lyman', 'liman'] }),
  Object.freeze({ name: 'Sloviansk', lat: 48.85, lon: 37.61, aliases: ['sloviansk', 'slovyansk', 'slavyansk'] }),
  Object.freeze({ name: 'Kramatorsk', lat: 48.72, lon: 37.55, aliases: ['kramatorsk'] }),
  Object.freeze({ name: 'Druzhkivka', lat: 48.62, lon: 37.53, aliases: ['druzhkivka'] }),
  Object.freeze({ name: 'Kupiansk', lat: 49.71, lon: 37.62, aliases: ['kupiansk', 'kupyansk'] }),
  Object.freeze({ name: 'Izium', lat: 49.21, lon: 37.25, aliases: ['izium', 'izyum'] }),
  Object.freeze({ name: 'Borova', lat: 49.38, lon: 37.62, aliases: ['borova'] }),
  Object.freeze({ name: 'Vovchansk', lat: 50.29, lon: 36.94, aliases: ['vovchansk'] }),
  Object.freeze({ name: 'Huliaipole', lat: 47.66, lon: 36.26, aliases: ['huliaipole', 'hulyaipole', 'gulyaipole'] }),
  Object.freeze({ name: 'Orikhiv', lat: 47.57, lon: 35.79, aliases: ['orikhiv'] }),
  Object.freeze({ name: 'Velyka Novosilka', lat: 47.84, lon: 36.83, aliases: ['velyka novosilka'] }),
  Object.freeze({ name: 'Vuhledar', lat: 47.78, lon: 37.25, aliases: ['vuhledar', 'ugledar'] }),
  Object.freeze({ name: 'Kurakhove', lat: 47.98, lon: 37.28, aliases: ['kurakhove'] }),
  Object.freeze({ name: 'Avdiivka', lat: 48.14, lon: 37.75, aliases: ['avdiivka'] }),
  Object.freeze({ name: 'Donetsk', lat: 48.0, lon: 37.8, aliases: ['donetsk city', 'donetsk'] }),
  Object.freeze({ name: 'Horlivka', lat: 48.33, lon: 38.04, aliases: ['horlivka', 'gorlovka'] }),
  Object.freeze({ name: 'Mariupol', lat: 47.1, lon: 37.55, aliases: ['mariupol'] }),
  Object.freeze({ name: 'Berdiansk', lat: 46.76, lon: 36.79, aliases: ['berdiansk', 'berdyansk'] }),
  Object.freeze({ name: 'Melitopol', lat: 46.85, lon: 35.37, aliases: ['melitopol'] }),
  Object.freeze({ name: 'Enerhodar (Zaporizhzhia NPP)', lat: 47.5, lon: 34.58, aliases: ['enerhodar', 'zaporizhzhia nuclear', 'zaporizhzhia npp', 'znpp'] }),
  Object.freeze({ name: 'Luhansk', lat: 48.57, lon: 39.31, aliases: ['luhansk city', 'luhansk', 'lugansk'] }),
  Object.freeze({ name: 'Sievierodonetsk', lat: 48.95, lon: 38.49, aliases: ['sievierodonetsk', 'severodonetsk'] }),
  // Juh a Dnipro
  Object.freeze({ name: 'Kherson', lat: 46.64, lon: 32.61, aliases: ['kherson'] }),
  Object.freeze({ name: 'Nova Kakhovka', lat: 46.75, lon: 33.37, aliases: ['nova kakhovka', 'kakhovka'] }),
  Object.freeze({ name: 'Oleshky', lat: 46.62, lon: 32.72, aliases: ['oleshky'] }),
  Object.freeze({ name: 'Zaporizhzhia', lat: 47.84, lon: 35.14, aliases: ['zaporizhzhia', 'zaporizhia', 'zaporozhye'] }),
  Object.freeze({ name: 'Nikopol', lat: 47.57, lon: 34.4, aliases: ['nikopol'] }),
  Object.freeze({ name: 'Dnipro', lat: 48.46, lon: 35.05, aliases: ['dnipro city', 'dnipro'] }),
  Object.freeze({ name: 'Kryvyi Rih', lat: 47.91, lon: 33.39, aliases: ['kryvyi rih', 'krivoy rog'] }),
  Object.freeze({ name: 'Pavlohrad', lat: 48.53, lon: 35.87, aliases: ['pavlohrad'] }),
  Object.freeze({ name: 'Kremenchuk', lat: 49.07, lon: 33.42, aliases: ['kremenchuk', 'kremenchug'] }),
  Object.freeze({ name: 'Mykolaiv', lat: 46.97, lon: 32.0, aliases: ['mykolaiv', 'nikolaev'] }),
  Object.freeze({ name: 'Odesa', lat: 46.48, lon: 30.73, aliases: ['odesa', 'odessa'] }),
  Object.freeze({ name: 'Chornomorsk', lat: 46.3, lon: 30.65, aliases: ['chornomorsk'] }),
  Object.freeze({ name: 'Izmail', lat: 45.35, lon: 28.84, aliases: ['izmail', 'ismail'] }),
  Object.freeze({ name: 'Reni', lat: 45.45, lon: 28.28, aliases: ['reni'] }),
  // Sever a stred
  Object.freeze({ name: 'Kharkiv', lat: 49.99, lon: 36.23, aliases: ['kharkiv', 'kharkov'] }),
  Object.freeze({ name: 'Chuhuiv', lat: 49.84, lon: 36.68, aliases: ['chuhuiv', 'chuguev'] }),
  Object.freeze({ name: 'Sumy', lat: 50.91, lon: 34.8, aliases: ['sumy'] }),
  Object.freeze({ name: 'Konotop', lat: 51.24, lon: 33.2, aliases: ['konotop'] }),
  Object.freeze({ name: 'Shostka', lat: 51.87, lon: 33.48, aliases: ['shostka'] }),
  Object.freeze({ name: 'Poltava', lat: 49.59, lon: 34.55, aliases: ['poltava'] }),
  Object.freeze({ name: 'Chernihiv', lat: 51.5, lon: 31.29, aliases: ['chernihiv', 'chernigov'] }),
  Object.freeze({ name: 'Kyiv', lat: 50.45, lon: 30.52, aliases: ['kyiv', 'kiev'] }),
  Object.freeze({ name: 'Bila Tserkva', lat: 49.8, lon: 30.11, aliases: ['bila tserkva'] }),
  Object.freeze({ name: 'Zhytomyr', lat: 50.25, lon: 28.66, aliases: ['zhytomyr'] }),
  Object.freeze({ name: 'Vinnytsia', lat: 49.23, lon: 28.47, aliases: ['vinnytsia', 'vinnytsya'] }),
  Object.freeze({ name: 'Cherkasy', lat: 49.44, lon: 32.06, aliases: ['cherkasy'] }),
  Object.freeze({ name: 'Kropyvnytskyi', lat: 48.51, lon: 32.26, aliases: ['kropyvnytskyi'] }),
  Object.freeze({ name: 'Khmelnytskyi', lat: 49.42, lon: 27.0, aliases: ['khmelnytskyi', 'khmelnytsky', 'starokostiantyniv'] }),
  Object.freeze({ name: 'Ternopil', lat: 49.55, lon: 25.6, aliases: ['ternopil'] }),
  Object.freeze({ name: 'Rivne', lat: 50.62, lon: 26.25, aliases: ['rivne'] }),
  Object.freeze({ name: 'Lutsk', lat: 50.75, lon: 25.33, aliases: ['lutsk'] }),
  Object.freeze({ name: 'Lviv', lat: 49.84, lon: 24.03, aliases: ['lviv'] }),
  Object.freeze({ name: 'Ivano-Frankivsk', lat: 48.92, lon: 24.71, aliases: ['ivano-frankivsk', 'burshtyn'] }),
  Object.freeze({ name: 'Uzhhorod', lat: 48.62, lon: 22.3, aliases: ['uzhhorod', 'uzhgorod'] }),
  Object.freeze({ name: 'Chernivtsi', lat: 48.29, lon: 25.94, aliases: ['chernivtsi'] }),
  // Krym
  Object.freeze({ name: 'Sevastopol', lat: 44.62, lon: 33.52, aliases: ['sevastopol'] }),
  Object.freeze({ name: 'Simferopol', lat: 44.95, lon: 34.1, aliases: ['simferopol'] }),
  Object.freeze({ name: 'Feodosia', lat: 45.03, lon: 35.38, aliases: ['feodosia', 'feodosiya'] }),
  Object.freeze({ name: 'Kerch', lat: 45.36, lon: 36.47, aliases: ['kerch', 'crimean bridge', 'kerch bridge'] }),
  Object.freeze({ name: 'Dzhankoi', lat: 45.71, lon: 34.39, aliases: ['dzhankoi', 'dzhankoy'] }),
  Object.freeze({ name: 'Saky', lat: 45.13, lon: 33.6, aliases: ['saky', 'novofedorivka'] }),
  Object.freeze({ name: 'Yevpatoria', lat: 45.19, lon: 33.37, aliases: ['yevpatoria', 'evpatoria'] }),
  // Ruské pohraničie a zázemie (údery, Kurský smer)
  Object.freeze({ name: 'Belgorod', lat: 50.6, lon: 36.59, aliases: ['belgorod'] }),
  Object.freeze({ name: 'Shebekino', lat: 50.41, lon: 36.9, aliases: ['shebekino'] }),
  Object.freeze({ name: 'Kursk', lat: 51.73, lon: 36.19, aliases: ['kursk'] }),
  Object.freeze({ name: 'Sudzha', lat: 51.19, lon: 35.27, aliases: ['sudzha'] }),
  Object.freeze({ name: 'Bryansk', lat: 53.24, lon: 34.36, aliases: ['bryansk'] }),
  Object.freeze({ name: 'Voronezh', lat: 51.66, lon: 39.2, aliases: ['voronezh'] }),
  Object.freeze({ name: 'Rostov-on-Don', lat: 47.22, lon: 39.72, aliases: ['rostov'] }),
  Object.freeze({ name: 'Taganrog', lat: 47.24, lon: 38.9, aliases: ['taganrog'] }),
  Object.freeze({ name: 'Novorossiysk', lat: 44.72, lon: 37.77, aliases: ['novorossiysk'] }),
  Object.freeze({ name: 'Tuapse', lat: 44.1, lon: 39.07, aliases: ['tuapse'] }),
  Object.freeze({ name: 'Engels', lat: 51.48, lon: 46.12, aliases: ['engels'] }),
  Object.freeze({ name: 'Ryazan', lat: 54.63, lon: 39.74, aliases: ['ryazan'] }),
  Object.freeze({ name: 'Moscow', lat: 55.75, lon: 37.62, aliases: ['moscow'] }),
  // Široké názvy naposledy — konkrétne mesto vyššie vždy vyhrá.
  Object.freeze({ name: 'Donbas', lat: 48.4, lon: 37.9, aliases: ['donbas', 'donbass'] }),
  Object.freeze({ name: 'Crimea', lat: 45.3, lon: 34.4, aliases: ['crimea', 'crimean'] }),
  Object.freeze({ name: 'Black Sea', lat: 44.5, lon: 32.0, aliases: ['black sea'] }),
  Object.freeze({ name: 'Sea of Azov', lat: 46.2, lon: 36.5, aliases: ['sea of azov', 'azov sea'] }),
  Object.freeze({ name: 'Kharkiv Oblast', lat: 49.6, lon: 36.9, aliases: ['kharkiv region', 'kharkiv oblast'] }),
  Object.freeze({ name: 'Sumy Oblast', lat: 51.0, lon: 34.5, aliases: ['sumy region', 'sumy oblast'] }),
  Object.freeze({ name: 'Donetsk Oblast', lat: 48.3, lon: 37.5, aliases: ['donetsk region', 'donetsk oblast', 'donetsk direction'] }),
  Object.freeze({ name: 'Zaporizhzhia Oblast', lat: 47.4, lon: 35.6, aliases: ['zaporizhzhia region', 'zaporizhzhia oblast', 'zaporizhia region'] }),
  Object.freeze({ name: 'Kherson Oblast', lat: 46.7, lon: 33.3, aliases: ['kherson region', 'kherson oblast'] }),
  Object.freeze({ name: 'Dnipropetrovsk Oblast', lat: 48.4, lon: 35.5, aliases: ['dnipropetrovsk region', 'dnipropetrovsk oblast'] }),
  Object.freeze({ name: 'Odesa Oblast', lat: 46.5, lon: 30.3, aliases: ['odesa region', 'odesa oblast', 'odessa region'] }),
  Object.freeze({ name: 'Belgorod Oblast', lat: 50.7, lon: 37.5, aliases: ['belgorod region', 'belgorod oblast'] }),
  Object.freeze({ name: 'Kursk Oblast', lat: 51.6, lon: 35.6, aliases: ['kursk region', 'kursk oblast'] }),
]);

/**
 * Trieda udalosti pre titulok z ukrajinského regiónu, inak null. Pure.
 * @param {string} text
 * @returns {{type:string, severity:'critical'|'major'|'minor'}|null}
 */
export function classifyUkraineIncident(text) {
  const s = String(text ?? '');
  for (const rule of UKRAINE_INCIDENT_RULES) {
    if (!rule.re.test(s)) continue;
    if (rule.requires && !rule.requires.test(s)) continue;
    if (rule.unless && rule.unless.test(s)) continue;
    return { type: rule.type, severity: rule.severity };
  }
  return null;
}
