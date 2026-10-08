// src/layerCategories.js
/**
 * @module layerCategories
 * @description Roztriedi vrstvy do ľudských tém, aby sa v palete „Hľadať
 * čokoľvek" (a inde) dali listovať prehľadne — nie ako jeden dlhý zoznam.
 * Len rozdelenie a poradie; žiadne odborné výrazy, ľudské názvy dodá i18n
 * `cmd.group.<key>`. Pure dáta — testovateľné bez DOM.
 *
 * Zámerne mimo tém:
 *  - `gibs-*` (rodina obrazových prekryvov NASA) má vlastné ovládanie,
 *    do zoznamu vrstiev nepatria po jednom.
 *  - `military-awareness` je skrytá pomocná vrstva (showInTogglePanel=false).
 */

/** Poradie tém vo výsledkoch (najčastejšie hore). Ľudské názvy: i18n `cmd.group.<key>`. */
export const LAYER_GROUP_ORDER = Object.freeze(['air', 'sea', 'earth', 'energy', 'city', 'defense', 'more']);

/** Vrstva (id) → téma. Čo tu nie je, spadne do „more" (Ďalšie) — nová vrstva nezmizne. */
export const LAYER_CATEGORY = Object.freeze({
  // Vo vzduchu
  flights: 'air',
  satellites: 'air',
  'rocket-launches': 'air',
  'local-airports': 'air',
  'local-air-density': 'air',
  // Na mori
  'ais-live-vessels': 'sea',
  'gfw-presence': 'sea',
  'gfw-sar': 'sea',
  'aishub-vessels': 'sea',
  'local-ports': 'sea',
  'local-shipping-lanes': 'sea',
  'local-ship-density': 'sea',
  // Zem a počasie
  earthquakes: 'earth',
  volcanoes: 'earth',
  'natural-events': 'earth',
  'local-firms': 'earth',
  'shmu-radar': 'earth',
  'shmu-warnings': 'earth',
  'shmu-stations': 'earth',
  'opera-radar': 'earth',
  'meteo-gfs': 'earth',
  // Energia a siete
  'gas-flows': 'energy',
  'gas-pipelines': 'energy',
  'local-energy': 'energy',
  'local-dams': 'energy',
  'telegeography-submarine-cables': 'energy',
  'local-datacenters': 'energy',
  // Mestá a doprava
  traffic: 'city',
  cctv: 'city',
  radio: 'city',
  bikeshare: 'city',
  // Obrana
  military: 'defense',
  'military-installations': 'defense',
});

/** Téma vrstvy podľa id; neznáme → „more". Pure. */
export function layerGroup(id) {
  return LAYER_CATEGORY[String(id || '')] || 'more';
}

/**
 * Prirodzené slová na hľadanie (SK+EN), keď sa nezhodujú s názvom vrstvy —
 * napr. názov „Živé lety", ale človek píše „lietadlá". Diakritiku rieši paleta
 * (foldText), preto tu stačí bežný tvar. Čo tu nie je, hľadá sa podľa názvu.
 */
export const LAYER_KEYWORDS = Object.freeze({
  flights: ['lietadlá', 'lietadlo', 'aircraft', 'planes', 'flights'],
  military: ['lietadlá', 'vojenské lietadlá', 'stíhačky', 'military aircraft', 'warplanes', 'jets'],
  satellites: ['družice', 'satellites', 'orbit'],
  'rocket-launches': ['rakety', 'štarty', 'rocket', 'launch', 'space'],
  'local-airports': ['letisko', 'letiská', 'airport', 'airports'],
  'local-air-density': ['lietadlá', 'hustota letov', 'air traffic', 'heatmap'],
  'ais-live-vessels': ['lode', 'loď', 'plavidlá', 'ships', 'vessels', 'ais'],
  'gfw-presence': ['lode', 'ships', 'satelitné ais'],
  'gfw-sar': ['lode', 'ships', 'radar', 'sar', 'sentinel'],
  'aishub-vessels': ['lode', 'ships', 'ais'],
  'local-ports': ['prístav', 'prístavy', 'port', 'harbour'],
  'local-shipping-lanes': ['koridory', 'trasy lodí', 'shipping lanes', 'routes'],
  'local-ship-density': ['lode', 'hustota lodí', 'ship density', 'heatmap'],
  earthquakes: ['zemetrasenie', 'earthquake', 'quake', 'seizmika'],
  volcanoes: ['sopka', 'sopky', 'volcano', 'volcanoes'],
  'natural-events': ['katastrofy', 'udalosti', 'disasters', 'hazards', 'eonet'],
  'local-firms': ['požiar', 'požiare', 'oheň', 'fire', 'fires', 'firms'],
  'shmu-radar': ['dážď', 'zrážky', 'počasie', 'rain', 'weather', 'radar'],
  'opera-radar': ['radar', 'európa', 'zrážky', 'dážď', 'počasie', 'rain', 'europe', 'opera', 'eumetnet'],
  'shmu-stations': ['stanice', 'merania', 'teplota', 'vietor', 'počasie', 'stations', 'observations', 'shmú'],
  'shmu-warnings': ['výstrahy', 'výstraha', 'vietor', 'búrka', 'počasie', 'warnings', 'alerts', 'shmú', 'meteoalarm'],
  'meteo-gfs': ['počasie', 'vietor', 'teplota', 'weather', 'wind', 'meteo'],
  'gas-flows': ['plyn', 'toky plynu', 'gas', 'flows', 'entsog'],
  'gas-pipelines': ['plyn', 'plynovod', 'gas', 'pipeline'],
  'local-energy': ['elektrina', 'sieť', 'power', 'grid', 'energy'],
  'local-dams': ['priehrada', 'priehrady', 'dam', 'dams', 'vodné'],
  'telegeography-submarine-cables': ['káble', 'internet', 'cable', 'cables'],
  'local-datacenters': ['servery', 'dáta', 'datacenter', 'servers'],
  traffic: ['doprava', 'premávka', 'cesty', 'traffic', 'roads'],
  cctv: ['kamera', 'kamery', 'camera', 'cameras', 'cctv'],
  radio: ['rádio', 'radio', 'stanice'],
  bikeshare: ['bicykle', 'kolo', 'bike', 'bikes'],
  'military-installations': ['vojenské', 'základne', 'armáda', 'military', 'bases', 'installations'],
});

/** Prirodzené slová na hľadanie pre vrstvu; neznáme → []. Pure. */
export function layerKeywords(id) {
  return LAYER_KEYWORDS[String(id || '')] || [];
}

/** Patrí vrstva do palety/katalógu vrstiev? (skryje obrazové prekryvy a pomocné vrstvy). Pure. */
export function isCatalogLayer(layer) {
  if (!layer || layer.showInTogglePanel === false) return false;
  const id = String(layer.id || '');
  if (!id) return false;
  if (id.startsWith('gibs-')) return false; // rodina NASA má vlastné ovládanie
  return true;
}
