// scripts/lib/powerTags.mjs
//
// Čítanie OSM tagov vedení vysokého napätia (ELEKTRINA, 2026-11-06) pre
// `scripts/build-power-lines.mjs`. Modul je čistý — bez vedľajších účinkov,
// testuje sa v Node (scripts/lib/powerTags.test.mjs).
//
// Prečo vlastný modul a nie pipelineTags: vedenie nemá priemer ani látku.
// Rozhoduje napätie (`voltage`, jedno alebo viac čísel cez bodkočiarku),
// druh (`power=line` = vzdušné, `power=cable` = kábel v zemi alebo v mori)
// a frekvencia (`frequency=0` = jednosmerné HVDC prepojenie).

/** Prah prepravnej siete: 220 kV a viac (225 kV FR, 330 kV ex-ZSSR, 380 DE/CH…). */
export const MIN_TRANSMISSION_VOLTS = 220_000;

/**
 * Napätia z tagu `voltage` vo voltoch: „400000;110000" → [400000, 110000].
 * Nečíselné kusy („400 kV"?) sa skúsia ako kilovolty, inak sa zahodia.
 * @param {string|number|null|undefined} raw
 * @returns {number[]} zostupne, bez duplikátov
 */
export function voltagesOf(raw) {
  const out = new Set();
  for (const piece of String(raw ?? '').split(/[;,/]/)) {
    const s = piece.trim().toLowerCase();
    if (!s) continue;
    const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(kv|v)?$/);
    if (!m) continue;
    let v = Number(m[1]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (m[2] === 'kv' || (!m[2] && v < 2000)) v *= 1000;
    out.add(Math.round(v));
  }
  return [...out].sort((a, b) => b - a);
}

/** Celé číslo z tagu (`circuits=2`, `cables=6`); inak null. */
function intTag(raw) {
  const m = String(raw ?? '').trim().match(/^[0-9]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Frekvencia v Hz (`50`, `0` = jednosmerné, `16.7` železnica); inak null. */
export function frequencyOf(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Patrí cesta do prepravnej siete? Tagy sú zlúčené s tagmi relácie
 * (`{...relTags, ...wayTags}`), takže členská cesta bez vlastného `voltage`
 * dedí napätie relácie — a cesta s vlastným 110 kV v 400 kV relácii ide von.
 * Rozvodne, stožiare a `minor_line`, ktoré relácie tiež vymenúvajú, sa
 * nekreslia nikdy.
 * @param {Record<string, string>} tags
 * @returns {'line'|'cable'|null}
 */
export function classifyPowerLine(tags) {
  const power = String(tags.power || '').trim().toLowerCase();
  if (power !== 'line' && power !== 'cable') return null;
  const volts = voltagesOf(tags.voltage);
  if (!volts.length || volts[0] < MIN_TRANSMISSION_VOLTS) return null;
  return power;
}

/**
 * Vlastnosti prvku v snímku — nad spoločným základom engine (mená, jazyk,
 * prevádzkovateľ, trasa `from`/`to`, stav, OSM id, relácia) bez priemeru
 * a látky, s napätím, obvodmi, káblami a frekvenciou.
 * @param {Record<string, string>} tags zlúčené tagy relácie a cesty
 * @param {object} base vlastnosti z engine (pipelineSnapshot.mjs)
 * @returns {object}
 */
export function powerLineProperties(tags, base) {
  const volts = voltagesOf(tags.voltage);
  const frequency = frequencyOf(tags.frequency);
  return {
    // Meno je len skutočné meno; `ref` (V499, 402) ostáva zvlášť — karta ho
    // použije ako titulok, keď meno chýba, ale skupiny trás sa ním neriadia.
    name: tags.name || tags['name:en'] || null,
    nameEn: base.nameEn,
    nameSk: base.nameSk,
    intName: base.intName,
    nameLang: base.nameLang,
    operator: base.operator,
    ref: base.ref,
    power: classifyPowerLine(tags) || 'line',
    voltageV: volts[0] ?? null,
    voltages: volts,
    circuits: intTag(tags.circuits),
    cables: intTag(tags.cables),
    wires: tags.wires || null,
    frequency,
    // `location` len podľa OSM; kábel bez tagu môže byť v zemi aj v mori.
    location: base.location,
    from: base.from,
    to: base.to,
    status: base.status,
    osm: base.osm,
    relation: base.relation,
  };
}
