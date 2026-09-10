// src/data/imageDecode.js
// Bezpečné čakanie na dekódovanie <img>.
//
// PASCA (2026-09-10, živý nález): v SKRYTEJ karte sa `img.decode()` nikdy
// nevyrieši ANI neodmietne — ani pre obrázok pripojený do dokumentu. Zmerané
// v prehliadači: obrázok sa načítal (`complete: true`, `naturalWidth: 1440`),
// `fetch` toho istého súboru trval 7 ms, ale `decode()` visel aj po 6 s pri
// `document.visibilityState === 'hidden'`. Tri vrstvy na tom čakali cez
// `await`, takže uviazli navždy v stave „zapínam": historická hustota lodí a
// letov (densityDrape.js), meteorologické pole (meteoLayer.js) a zrážkový
// radar SHMÚ (shmuRadar.js). Používateľ, ktorý si počas načítania prepne
// kartu, mal vrstvu zamrznutú aj po návrate. `.catch()` ani `.then(a, b)`
// nepomôžu — nezachytávajú prísľub, ktorý sa NIKDY neusadí.
//
// `onload` už garantuje použiteľný obrázok (Cesium si textúru nahrá samo);
// `decode()` je len optimalizácia, ktorá presúva dekódovanie mimo prvého
// snímku. Preto smie zdržať, ale nikdy nesmie rozhodovať o výsledku.

/** Koľko najviac čakať na dekódovanie, kým sa obrázok použije tak či tak (ms). */
export const DECODE_BUDGET_MS = 1_500;

/**
 * Počká na `img.decode()`, ale nikdy neblokuje donekonečna. Vždy sa vyrieši,
 * nikdy neodmietne — volajúci si o výsledku rozhoduje sám podľa `naturalWidth`.
 *
 * V skrytej karte sa nečaká vôbec: dekódovanie tam preukázateľne neprebehne a
 * čakať celý rozpočet na každý obrázok by zbytočne brzdilo (meteo os načíta
 * obrázok pri každom kroku predpovede).
 *
 * @param {{decode?: Function}|null} img
 * @param {{timeoutMs?: number, doc?: {hidden?: boolean}|null, setTimer?: Function}} [options]
 *   `doc` a `setTimer` sú injektovateľné pre testy.
 * @returns {Promise<void>}
 */
export function awaitImageDecode(img, {
  timeoutMs = DECODE_BUDGET_MS,
  doc = globalThis.document,
  setTimer = globalThis.setTimeout,
} = {}) {
  if (!img || typeof img.decode !== 'function') return Promise.resolve();
  if (doc?.hidden) return Promise.resolve();
  let started;
  try {
    started = img.decode();
  } catch {
    return Promise.resolve(); // synchrónny throw = rovnaký záver ako odmietnutie
  }
  if (!started || typeof started.then !== 'function') return Promise.resolve();
  return Promise.race([
    Promise.resolve(started).then(() => undefined, () => undefined),
    new Promise((resolve) => { setTimer(() => resolve(undefined), timeoutMs); }),
  ]);
}
