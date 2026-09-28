// src/data/fleetTickGate.js
// Brána tiku flotily lietadiel: ktorý stroj v tiku PRESKOČIŤ a kedy sa
// oplatí zapísať mu polohu.
//
// Meranie 2026-09-28 („procesor je strašne vyťažený"): kamera nad Bratislavou
// vo výške 1,5 km, flotila 12 380 strojov, z toho 227 viditeľných. Tik flotily
// prechádzal VŠETKÝCH každých 80 ms — 66 ms výpočtu + 24 ms prepis vertex
// buffera BillboardCollection = 6 fps; s vypnutou flotilou 28 fps. GPU pritom
// bežalo na 23 % — brzdou je hlavné vlákno, nie grafika.
//
// 1. Skrytý stroj (za obzorom, skrytá kategória, režim hustoty), ktorý bol
//    skrytý už minulý tik, sa v tiku NEPREPOČÍTAVA vôbec: žiadny dead
//    reckoning, podlaha ani zápis polohy. Test skrytia beží každý tik na
//    najnovšom fixe z feedu (bez interpolácie), takže stroj, ktorý sa vynorí
//    (pohyb kamery alebo vlastný let), ide naplno hneď v tom tiku. Viditeľný
//    stroj sa nemení: plný prepočet každý tik ako doteraz.
//    Prvá verzia prepočítavala skryté stroje v pruhoch (každý 12./24. tik):
//    tie zápisy prepli Cesium do drahšej cesty — pod 10 % špinavých
//    billboardov robí bufferSubData na každý zvlášť (700 zápisov = 23 ms),
//    nad 10 % nahrá buffer naraz (4 ms). Najlacnejšie je nezapisovať.
// 2. Zápis polohy viditeľného stroja: Cesium špiní buffer pri každom zápise,
//    tak sa zapisuje až pohyb aspoň pol pixela pri jeho vzdialenosti (najmenej
//    1 m). Stroj 50 km od kamery (≈ 80 m/px) sa posunie 20 m za tik — zápis
//    každý štvrtý tik, pri pohľade na svet takmer nikdy. Sprite zaostáva
//    o ≤ pol pixela.

/**
 * Či tik má stroj PRESKOČIŤ (bez dead reckoningu, podlahy a zápisu polohy).
 * Preskakuje sa len stroj, ktorý (a) už je skrytý (`shown` false) — čerstvo
 * zhasnutý stroj ešte prejde plnou cestou, ktorá zhasne aj jeho 3D model —
 * a (b) je skrytý aj podľa testu na najnovšom fixe.
 * Pozičné argumenty zámerne: volá sa 12 000× za tik, objekt by bol alokácia.
 * @param {boolean} shown - `bb.show` pred tikom.
 * @param {boolean} hidden - Výsledok testu skrytia na najnovšom fixe.
 * @returns {boolean}
 */
export function fleetContactSkipsTick(shown, hidden) {
  return !shown && hidden;
}

/**
 * Koľko metrov má jeden pixel na meter vzdialenosti od kamery (perspektíva):
 * 2·tan(fovy/2) / výška plátna. Bez perspektívy (ortografická kamera plátna,
 * nefinitné vstupy) 0 → prah zápisu padne na 1 m.
 * @param {number} fovyRad - Zvislý zorný uhol kamery (rad).
 * @param {number} drawingBufferHeight - Výška kresliaceho buffera (px).
 * @returns {number}
 */
export function metersPerPixelPerMeter(fovyRad, drawingBufferHeight) {
  if (!Number.isFinite(fovyRad) || fovyRad <= 0 || !Number.isFinite(drawingBufferHeight) || drawingBufferHeight <= 0) return 0;
  return (2 * Math.tan(fovyRad / 2)) / drawingBufferHeight;
}

/**
 * Prah zápisu polohy (m): pol pixela pri danej vzdialenosti, najmenej 1 m.
 * @param {number} cameraDistanceM - Vzdialenosť stroja od kamery (m).
 * @param {number} mppPerM - Výstup metersPerPixelPerMeter.
 * @returns {number}
 */
export function positionWriteThresholdM(cameraDistanceM, mppPerM) {
  const m = cameraDistanceM * mppPerM * 0.5;
  return Number.isFinite(m) && m > 1 ? m : 1;
}

/**
 * Pripne typ vertex bufferov kolekcie billboardov. Cesium (BillboardCollection
 * .computeNewBuffersUsage) každú snímku prepočíta, či sa vlastnosť menila
 * (STREAM) alebo nie (STATIC), a pri KAŽDEJ zmene typu zahodí a nanovo
 * postaví celé vertex pole — pri 12 000 strojoch 12–23 ms. Farba, scale,
 * obrázok či rotácia sa vo flotile menia len v niektorých snímkach, takže typ
 * preskakoval sem a tam takmer každú snímku (meranie 2026-09-28). Typ buffera
 * je pre ovládač len rada; pripnutý ostáva ten z prvého postavenia a ďalej
 * sa píšu len zmenené stroje (subCommit). Pridané/odobrané stroje pole
 * prestavia tak či tak (`_createVertexArray`), to je raz za poll.
 * @param {object} collection - Cesium.BillboardCollection.
 * @returns {boolean} Či sa pripnutie podarilo (metóda existuje).
 */
export function pinBillboardBufferUsage(collection) {
  if (!collection || typeof collection.computeNewBuffersUsage !== 'function') return false;
  collection.computeNewBuffersUsage = () => false;
  return true;
}
