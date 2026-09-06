// src/data/naturalEventInfo.js
/**
 * @module naturalEventInfo
 * @description Popis a klasifikácia prírodnej udalosti pre kartu (2026-09-06,
 * „ikony cyklóny aj iné sú slabé, popis žiadny udalostí").
 *
 * EONET o udalosti posiela názov, kategóriu, trajektóriu bodov s intenzitou
 * (búrky v uzloch), dátumy a zdroje — POPIS býva prázdny. Karta ho preto
 * skladá z dát: pri cyklónoch Saffir-Simpsonovu kategóriu z vetra, vrcholovú
 * intenzitu a rozsah dráhy; pri ostatných počet a rozpätie hlásení.
 *
 * Čistý modul: žiadny fetch, žiadny DOM, žiadny Cesium — všetko cez `translate`.
 */

export const NATURAL_EVENT_SELECTED_EVENT = 'gev:natural-event-selected';
export const NATURAL_EVENT_CLEARED_EVENT = 'gev:natural-event-selection-cleared';

/** Farba špendlíka a akcentu podľa kategórie — cyklóny musia vyskočiť. */
export const NATURAL_EVENT_COLORS = Object.freeze({
  severeStorms: '#ff5b6e',
  floods: '#4aa8ff',
  landslides: '#c98a5b',
  drought: '#ffb03a',
  dustHaze: '#caa46a',
  snow: '#8fd3ff',
  tempExtremes: '#ff8a3a',
  seaLakeIce: '#7fe0e0',
  wildfires: '#ff6a2a',
});
export const NATURAL_EVENT_DEFAULT_COLOR = '#ffc46b';

/** Farba kategórie (fallback na default). Pure. */
export function categoryColor(category) {
  return NATURAL_EVENT_COLORS[category] || NATURAL_EVENT_DEFAULT_COLOR;
}

/** Čitateľné mená zdrojov EONET. */
export const NATURAL_SOURCE_LABELS = Object.freeze({
  JTWC: 'JTWC', NOAA_NHC: 'NOAA NHC', NHC: 'NOAA NHC', PDC: 'PDC', GDACS: 'GDACS',
  CEMS: 'Copernicus EMS', GLIDE: 'GLIDE', ReliefWeb: 'ReliefWeb', NASA_DISP: 'NASA Disasters',
  EO: 'NASA Earth Observatory', SIVolcano: 'Smithsonian GVP', InciWeb: 'InciWeb', FEMA: 'FEMA',
});

/** Saffir-Simpsonove stupne podľa vetra v uzloch (od najsilnejšieho). */
export const CYCLONE_STEPS = Object.freeze([
  { min: 137, cat: 5, key: 'natural.cyclone.cat5' },
  { min: 113, cat: 4, key: 'natural.cyclone.cat4' },
  { min: 96, cat: 3, key: 'natural.cyclone.cat3' },
  { min: 83, cat: 2, key: 'natural.cyclone.cat2' },
  { min: 64, cat: 1, key: 'natural.cyclone.cat1' },
  { min: 34, cat: 0, key: 'natural.cyclone.ts' },
  { min: -Infinity, cat: 0, key: 'natural.cyclone.td' },
]);

/** Trieda cyklónu z vetra (kt) alebo null. Pure. */
export function cycloneClass(kt) {
  if (!Number.isFinite(kt)) return null;
  return CYCLONE_STEPS.find((s) => kt >= s.min) || null;
}

/** Vietor v uzloch z magnitúdy záznamu, ak je jednotka kt. Pure. */
export function windKt(magnitude) {
  if (!magnitude || !Number.isFinite(magnitude.value)) return null;
  return /kt|kn/i.test(String(magnitude.unit || '')) ? magnitude.value : null;
}

/** Text magnitúdy („80 kts", „12 m"). Pure. */
export function magnitudeText(magnitude) {
  if (!magnitude || !Number.isFinite(magnitude.value)) return '';
  const unit = String(magnitude.unit || '').trim();
  return `${Math.round(magnitude.value)}${unit ? ' ' + unit : ''}`;
}

const DAY_MS = 86_400_000;

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
}

function ago(ms, nowMs, translate) {
  const days = Math.floor((nowMs - ms) / DAY_MS);
  if (days <= 0) return translate('natural.today');
  if (days < 60) return translate('natural.days-ago', { n: days });
  return translate('natural.months-ago', { n: Math.round(days / 30) });
}

/**
 * Model karty prírodnej udalosti. Pure.
 * @param {object} event záznam vrstvy (id, title, category, lon, lat, time, firstTime?, reports?, magnitude?, peakKt?, track?, description?, sources?)
 * @param {number} nowMs
 * @param {(key: string, vars?: object) => string} translate
 */
export function naturalEventCardModel(event, nowMs, translate) {
  if (!event) return null;
  const category = event.category;
  const categoryLabel = translate(`natural.category.${category}`);
  const color = categoryColor(category);
  const kt = windKt(event.magnitude);
  const peak = Number.isFinite(event.peakKt) ? event.peakKt : null;
  const cls = category === 'severeStorms' && kt !== null ? cycloneClass(kt) : null;

  const subParts = [categoryLabel];
  if (cls) subParts.push(translate(cls.key));
  const subLine = subParts.join(' · ');

  const intensityParts = [];
  if (kt !== null) intensityParts.push(translate('natural.wind-now', { kt: Math.round(kt) }));
  else if (event.magnitude) intensityParts.push(magnitudeText(event.magnitude));
  if (peak !== null && peak > (kt ?? 0)) intensityParts.push(translate('natural.peak', { kt: Math.round(peak) }));
  const intensityLine = intensityParts.join(' · ');

  const first = Number.isFinite(event.firstTime) ? event.firstTime : event.time;
  const reports = Number.isFinite(event.reports) ? event.reports : 1;
  const activity = reports > 1
    ? translate('natural.activity-since', { date: fmtDate(first), ago: ago(event.time, nowMs, translate), n: reports })
    : translate('natural.reported-on', { date: fmtDate(event.time), ago: ago(event.time, nowMs, translate) });

  // Popis: skutočný z EONET, inak zložený z dát (honest — nie vymyslený text).
  let description = String(event.description || '').trim();
  if (!description) {
    if (cls) {
      description = translate('natural.desc.cyclone', {
        cls: translate(cls.key).toLocaleLowerCase(), kt: Math.round(kt),
        peak: peak !== null ? Math.round(peak) : Math.round(kt),
        from: fmtDate(first), to: fmtDate(event.time), n: reports,
      });
    } else {
      description = translate('natural.desc.default', {
        category: categoryLabel.toLocaleLowerCase(), from: fmtDate(first), to: fmtDate(event.time), n: reports,
      });
    }
  }

  const badge = cls ? { text: cls.cat >= 1 ? `CAT ${cls.cat}` : (cls.key.endsWith('ts') ? 'TS' : 'TD'), color } : null;

  const links = [];
  for (const s of event.sources || []) {
    if (!/^https?:\/\//.test(s?.url || '')) continue;
    links.push({ key: s.id, label: NATURAL_SOURCE_LABELS[s.id] || s.id || translate('volcano.source'), href: s.url });
  }
  if (event.id) links.push({ key: 'eonet', label: 'NASA EONET', href: `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(event.id)}` });

  return {
    title: event.title,
    category, color, badge,
    subLine, intensityLine, activity, description,
    coords: `${Number(event.lat).toFixed(3)}°, ${Number(event.lon).toFixed(3)}°`,
    trackLine: Array.isArray(event.track) && event.track.length > 1 ? translate('natural.track-points', { n: event.track.length }) : '',
    links,
    coverage: translate('natural.coverage'),
  };
}
