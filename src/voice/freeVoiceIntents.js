// src/voice/freeVoiceIntents.js
/**
 * @module freeVoiceIntents
 * @description Bezplatný hlas (2026-10-05, vlastník: „nechce sa mi platiť … sprav zatiaľ zadarmo"):
 * z rozpoznanej vety (Web Speech API prehliadača) urobí jeden zámer — bez AI, bez kľúča. Zámery
 * spúšťajú tie isté akcie ako platený hlas (gevActions) a jednotné hľadanie (lietadlá, vrstvy,
 * scény, miesta). Slovensky aj základná angličtina; diakritika a veľké písmená sú jedno. Čisté funkcie.
 *
 * Zámer: { type, ... } — type ∈ stop-voice | help | zoom | globe | home | stop-tracking | track |
 * layer | command | front | radio | cockpit | camera | describe | go
 */

/** Zloží diakritiku, malé písmená, bez interpunkcie — „Priblíž, prosím!" → „pribliz prosim". */
export function foldSpeech(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\-\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Zdvorilostné a výplňové slová, ktoré nemenia príkaz. */
const FILLER_WORDS = new Set(['prosim', 'prosimte', 'hej', 'oko', 'okej', 'ok', 'teraz', 'hned', 'mi', 'nam', 'tu', 'tam', 'please', 'now', 'the']);
const FILLER = /\b(prosim|prosimte|hej|oko|okej|ok|teraz|hned|mi|nam|tu|tam|please|now|the)\b/g;
const clean = text => text.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

/** Slová pôvodnej vety (s diakritikou) bez interpunkcie. */
function originalWords(text) {
  return String(text ?? '').replace(/[^\p{L}\p{N}\-\s]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}
/**
 * Koniec vety za slovesom v pôvodnom tvare („choď do Košíc" → „Košíc"), bez výplňových slov.
 * @param {string} heard pôvodná veta
 * @param {RegExp} verb regex začiatku (nad zloženým textom bez výplne)
 */
function tailAfter(heard, verb) {
  const kept = originalWords(heard).filter(word => { const f = foldSpeech(word); return f && !FILLER_WORDS.has(f); });
  const m = verb.exec(kept.map(word => foldSpeech(word)).join(' '));
  if (!m || m.index !== 0) return kept.join(' ');
  const used = m[0].trim() ? m[0].trim().split(/\s+/).length : 0;
  return kept.slice(used).join(' ').trim();
}

/** Bežné mená vrstiev, ako ich človek povie (zložené) → ID vrstvy. Dlhšie výrazy prvé. */
export const LAYER_WORDS = Object.freeze([
  [/\bvojensk\w* (lietadl|let|stroj)\w*|\bmilitary (flights|aircraft)\b/, 'military'],
  [/\bvojensk\w* (zariaden|zakladn|objekt)\w*|\bzakladne\b/, 'military-installations'],
  [/\b(lietadl|lety\b|letadl|let\b|flights?\b|aircraft\b|planes?\b)\w*/, 'flights'],
  [/\b(lod|lode|lodi|plavidl|ships?\b|vessels?\b|boats?\b)\w*/, 'ais-live-vessels'],
  [/\b(satelit|satellites?)\w*/, 'satellites'],
  [/\b(zemetrasen|earthquakes?)\w*/, 'earthquakes'],
  [/\b(sopk|vulkan|volcano)\w*/, 'volcanoes'],
  [/\b(radar|dazd|zrazk|rain)\w*/, 'shmu-radar'],
  [/\b(vietor|vetr|teplot|meteo|pocasi|weather|wind)\w*/, 'meteo-gfs'],
  [/\b(poziar|ohen|fires?\b|wildfires?)\w*/, 'local-firms'],
  [/\b(kamer|cameras?|cctv)\w*/, 'cctv'],
  [/\b(doprav|premavk|zapch|traffic)\w*/, 'traffic'],
  [/\b(bicykl|bikes?)\w*/, 'bikeshare'],
  [/\b(letisk|airports?)\w*/, 'local-airports'],
  [/\b(pristav|ports?\b)\w*/, 'local-ports'],
  [/\b(plynovod|pipelines?)\w*/, 'gas-pipelines'],
  [/\b(tok\w* plynu|plyn)\w*/, 'gas-flows'],
  [/\b(kabl|cables?)\w*/, 'telegeography-submarine-cables'],
  [/\b(priehrad|dams?\b)\w*/, 'local-dams'],
  [/\b(datov\w* centr|datacent)\w*/, 'local-datacenters'],
  [/\b(energetik|elektrar|energy)\w*/, 'local-energy'],
  [/\b(misi|raket|launch)\w*/, 'rocket-launches'],
]);

/** ID vrstvy z výrazu (null = treba hľadať inak, napr. v palete). */
export function layerFromWords(text) {
  const t = foldSpeech(text);
  for (const [re, id] of LAYER_WORDS) if (re.test(t)) return id;
  return null;
}

const ON = /^(zapni|zapnut|zobraz|ukaz|pridaj|aktivuj|daj|show|enable|turn on)\b\s*(vrstvu|vrstvy|layer)?\s*/;
const OFF = /^(vypni|vypnut|skry|schovaj|odstran|zrus|deaktivuj|hide|disable|turn off)\b\s*(vrstvu|vrstvy|layer)?\s*/;
const GO = /^(chod|chodme|let|letme|presun sa|prejdi|zamier|najdi|vyhladaj|hladaj|kde je|kde su|ukaz|zobraz|go|fly|find|where is|show)\b\s*(mi\s*)?(na|do|k|ku|nad|to)?\s*/;
const TRACK = /^(sleduj|sledovat|nasleduj|zacni sledovat|follow|track)\b\s*/;
const AMOUNT = text => (/\b(trochu|kusok|mierne|bit|little)\b/.test(text) ? 'little'
  : /\b(vela|poriadne|riadne|maximalne|uplne|lot|way)\b/.test(text) ? 'lot' : 'medium');

/**
 * Zámer z jednej vety. null = prázdna veta.
 * @param {string} heard rozpoznaný text
 * @returns {object|null}
 */
export function parseVoiceIntent(heard) {
  const raw = foldSpeech(heard);
  if (!raw) return null;
  const t = clean(raw) || raw;

  if (/^(stop|koniec|dost|stacilo|staci|vypni (hlas|mikrofon)|prestan pocuvat|dakujem( staci)?|thanks|that s all)$/.test(t)) return { type: 'stop-voice' };
  if (/^(pomoc|help|co vies|co mozem povedat|co dokazes|prikazy)$/.test(t)) return { type: 'help' };

  // Kamera
  if (/^(pribliz|priblizit|blizsie|zoom in|zoomin|zvacsi)\b/.test(t)) return { type: 'zoom', direction: 'in', amount: AMOUNT(t) };
  if (/^(oddial|oddialit|vzdial|dalej|zoom out|zoomout|zmensi)\b/.test(t)) return { type: 'zoom', direction: 'out', amount: AMOUNT(t) };
  if (/\b(cely svet|celu zem|celej zeme|zemegul\w*|globus|cela planeta|celu planetu|whole (world|earth)|globe)\b/.test(t)) return { type: 'globe' };
  if (/^(domov|uvod|uvodny pohlad|na zaciatok|home)$/.test(t)) return { type: 'home' };
  if (/^(krouz|kruz|krouzi|obiehaj|otacaj|tocit|toc sa|orbit|rotate)\w*/.test(t)) return { type: 'camera', motion: 'orbit' };
  if (/^(zastav|stop) (kameru|otacanie|krouzenie|kruzenie|pohyb|camera)$/.test(t)) return { type: 'camera', motion: 'stop' };

  // Sledovanie
  if (/^(prestan sledovat|zrus sledovanie|nesleduj|koniec sledovania|stop tracking|unfollow)\b/.test(t)) return { type: 'stop-tracking' };
  if (/^(co je to|co sledujem|co to je|ake je to lietadlo|aky je to let|kam leti|odkial leti|kto to je|what is (it|this|that))\b/.test(t)) return { type: 'describe' };
  if (TRACK.test(t)) {
    const query = tailAfter(heard, /^(sleduj|sledovat|nasleduj|zacni sledovat|follow|track)\b(\s+(lietadlo|let|lod|satelit)\b)?/);
    return query ? { type: 'track', query } : { type: 'describe' };
  }

  // Kokpit
  if (/\b(kokpit|cockpit)\b/.test(t)) {
    if (/\b(ukonc|opust|vystup|zavri|vypni|exit|leave)\w*/.test(t)) return { type: 'cockpit', action: 'exit' };
    return { type: 'cockpit', action: 'enter' };
  }
  if (/^(dalsie|nasledujuce) (lietadlo|kontakt)|^next (aircraft|contact)/.test(t)) return { type: 'cockpit', action: 'next' };
  if (/^(predchadzajuce|predosle) (lietadlo|kontakt)|^previous (aircraft|contact)/.test(t)) return { type: 'cockpit', action: 'previous' };

  // Rádio
  if (/\bradio\b/.test(t)) {
    if (OFF.test(t) || /\b(zastav|stop|stlm)\w*/.test(t)) return { type: 'radio', action: 'stop' };
    if (/\b(dalsi|dalsia|next)\b/.test(t)) return { type: 'radio', action: 'next' };
    return { type: 'radio', action: 'play' };
  }
  if (/^(dalsia stanica|dalsiu stanicu|next station)$/.test(t)) return { type: 'radio', action: 'next' };
  const volume = /\b(hlasitost|volume)\b\D*(\d{1,3})/.exec(t);
  if (volume) return { type: 'radio', action: 'volume', volumePct: Math.min(100, Number(volume[2])) };

  // Mapa (podklad)
  if (/\b(fotorealist\w*|3d mapa|mapa 3d|google 3d|photoreal)\b/.test(t)) return { type: 'command', id: 'view:photoreal' };
  if (/\b(obycajn\w* mapa|osm|open street map|mapa ulic|plain map)\b/.test(t)) return { type: 'command', id: 'view:osm' };
  if (/\b(mapa frontu|karta|karta frontu)\b/.test(t)) return { type: 'command', id: 'view:karta' };

  // Front na Ukrajine
  if (/^(front|ukaz front|cely front|mapa frontu)$/.test(t)) return { type: 'front', name: 'cely front' };
  const front = /\b([a-z\-]+(?: [a-z\-]+)?) smer\b|\bsmer ([a-z\-]+)/.exec(t);
  if (front) return { type: 'front', name: (front[1] || front[2]).trim() };

  // Vrstvy
  if (OFF.test(t)) {
    const rest = t.replace(OFF, '').trim();
    if (rest) return { type: 'layer', on: false, layerId: layerFromWords(rest), name: rest };
  }
  if (ON.test(t)) {
    const rest = t.replace(ON, '').trim();
    const layerId = rest ? layerFromWords(rest) : null;
    // „ukáž lode" = vrstva; „ukáž Bratislavu" = miesto (rozhodne go).
    if (layerId && rest.split(' ').length <= 3) return { type: 'layer', on: true, layerId, name: rest };
  }

  // Choď / nájdi / ukáž X — rozhodne jednotné hľadanie (lietadlo, scéna, vrstva, miesto).
  if (GO.test(t)) {
    const query = tailAfter(heard, GO);
    if (query) return { type: 'go', query };
  }
  // Holá veta bez slovesa („Ruslan", „Hormuz", „Košice") — tiež hľadanie, v pôvodnom tvare.
  return { type: 'go', query: tailAfter(heard, /^$/) || t };
}
