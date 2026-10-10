// Video o silnom zemetrasení (2026-10-10, vlastník: „bolo zemetrasenie v Paname… aj zemetrasenia aby si robil
// podobne"): scenár pre linku denného videa (scripts/lib/frontDayPipeline.mjs, `scenario`) z údajov USGS —
// hlavný otras, odhad PAGER (koľko ľudí zažilo silné otrasy, stupeň škôd), dotrasy a overené správy o
// následkoch (len od aspoň dvoch médií, inak sa o obetiach nehovorí). Mapa: reliéf ASTER (bez kľúča). Pure.
import { spokenNumber } from './eventSpeech.js';
import { MAP_SOURCE } from './frontWeekNarration.js';

const NBSP = ' ';
/** Krajiny v názve miesta USGS („12 km WSW of Pitaloza Arriba, Panama") — slovensky: nom., akuz., lokál. */
export const QUAKE_COUNTRIES = Object.freeze({
  Panama: { nom: 'Panama', acc: 'Panamu', loc: 'v Paname' },
  'Costa Rica': { nom: 'Kostarika', acc: 'Kostariku', loc: 'v Kostarike' },
  Colombia: { nom: 'Kolumbia', acc: 'Kolumbiu', loc: 'v Kolumbii' },
  Ecuador: { nom: 'Ekvádor', acc: 'Ekvádor', loc: 'v Ekvádore' },
  Peru: { nom: 'Peru', acc: 'Peru', loc: 'v Peru' },
  Chile: { nom: 'Čile', acc: 'Čile', loc: 'v Čile' },
  Mexico: { nom: 'Mexiko', acc: 'Mexiko', loc: 'v Mexiku' },
  Guatemala: { nom: 'Guatemala', acc: 'Guatemalu', loc: 'v Guatemale' },
  Japan: { nom: 'Japonsko', acc: 'Japonsko', loc: 'v Japonsku' },
  Indonesia: { nom: 'Indonézia', acc: 'Indonéziu', loc: 'v Indonézii' },
  Philippines: { nom: 'Filipíny', acc: 'Filipíny', loc: 'na Filipínach' },
  Turkey: { nom: 'Turecko', acc: 'Turecko', loc: 'v Turecku' },
  Türkiye: { nom: 'Turecko', acc: 'Turecko', loc: 'v Turecku' },
  Greece: { nom: 'Grécko', acc: 'Grécko', loc: 'v Grécku' },
  Italy: { nom: 'Taliansko', acc: 'Taliansko', loc: 'v Taliansku' },
  Iran: { nom: 'Irán', acc: 'Irán', loc: 'v Iráne' },
  Afghanistan: { nom: 'Afganistan', acc: 'Afganistan', loc: 'v Afganistane' },
  Nepal: { nom: 'Nepál', acc: 'Nepál', loc: 'v Nepále' },
  China: { nom: 'Čína', acc: 'Čínu', loc: 'v Číne' },
  Taiwan: { nom: 'Taiwan', acc: 'Taiwan', loc: 'na Taiwane' },
  Myanmar: { nom: 'Mjanmarsko', acc: 'Mjanmarsko', loc: 'v Mjanmarsku' },
  'New Zealand': { nom: 'Nový Zéland', acc: 'Nový Zéland', loc: 'na Novom Zélande' },
  Alaska: { nom: 'Aljaška', acc: 'Aljašku', loc: 'na Aljaške' },
  Russia: { nom: 'Rusko', acc: 'Rusko', loc: 'v Rusku' },
});

/** Dotrasy: od magnitúdy, do vzdialenosti a času od hlavného otrasu. */
export const AFTERSHOCK = Object.freeze({ minMag: 4.5, maxKm: 200, maxDays: 7 });

const km = (a, b) => { const R = 6371; const r = Math.PI / 180; const dLat = (b.lat - a.lat) * r; const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
/** 7.7 → { caption: '7,7', spoken: 'sedem celá sedem' }. Pure. */
export function magnitudeWords(m) {
  const v = Math.round(Number(m) * 10) / 10;
  const [i, d] = v.toFixed(1).split('.');
  return { caption: `${i},${d}`, spoken: d === '0' ? spokenNumber(Number(i)) : `${spokenNumber(Number(i))} celá ${spokenNumber(Number(d))}` };
}
/** Krajina z miesta USGS, alebo null. Pure. */
export function quakeCountry(place) {
  const tail = String(place || '').split(',').pop().trim();
  return QUAKE_COUNTRIES[tail] || null;
}
/** Hlavný otras z GeoJSON USGS (feature alebo detail). Pure. */
export function quakeOf(feature) {
  const p = feature?.properties || {}; const c = feature?.geometry?.coordinates || [];
  return { id: feature?.id, mag: Number(p.mag), magType: p.magType || null, time: Number(p.time), lon: Number(c[0]), lat: Number(c[1]), depthKm: Number(c[2]),
    place: p.place || '', url: p.url || null, alert: p.alert || null, tsunami: Boolean(p.tsunami), felt: Number(p.felt) || 0 };
}
/** Dotrasy hlavného otrasu z výpisu USGS (feed): po ňom, blízko, od AFTERSHOCK.minMag. Pure. */
export function aftershocksOf(main, features, o = AFTERSHOCK) {
  return (features || []).map(quakeOf)
    .filter((q) => q.id !== main.id && q.time > main.time && q.time - main.time <= o.maxDays * 86_400_000 && q.mag >= o.minMag && km(q, main) <= o.maxKm)
    .sort((a, b) => b.mag - a.mag);
}
/** Ľudia v intenzite VII a viac podľa PAGER (exposures.json, krajina hlavného otrasu alebo spolu). Pure. */
export function strongShakingPeople(exposures, { minMmi = 7 } = {}) {
  const e = exposures?.population_exposure;
  if (!e?.mmi || !e?.aggregated_exposure) return null;
  const n = e.mmi.reduce((s, m, i) => (m >= minMmi ? s + (Number(e.aggregated_exposure[i]) || 0) : s), 0);
  return n > 0 ? n : null;
}
/** „vyše 640 000" — zaokrúhlené nadol na tisíce (desaťtisíce nad milión). Pure. */
export function roundedDown(n) {
  const step = n >= 1_000_000 ? 100_000 : n >= 100_000 ? 10_000 : 1_000;
  return Math.floor(n / step) * step;
}
/** Kamera nad bodom vo výške podľa rozpätia bodov (km). Pure. */
function cameraOver(points, { minM = 260_000, k = 2600 } = {}) {
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length; const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const span = Math.max(...points.map((p) => km(p, { lon, lat })), 1);
  return { lon, lat: lat + 0.12 * Math.max(1, span / 60), heightM: Math.round(Math.max(minM, span * k)), pitchDeg: -88, headingDeg: 0 };
}
const dayMonth = (t) => { const d = new Date(t); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`; };
const utcTime = (t) => { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`; };

/**
 * Scenár videa o zemetrasení.
 * @param {object} p
 * @param {ReturnType<typeof quakeOf>} p.main
 * @param {Array} [p.aftershocks] aftershocksOf(...)
 * @param {object|null} [p.pager] { exposures, cities: [{name, lat, lon, pop, iscap, mmi}], economicLevel, fatalityLevel }
 * @param {object|null} [p.facts] overené správy: { spoken, caption, title, rows[], sources: [{name, url}] } — len od ≥ 2 médií
 */
export function quakeScenario({ main, aftershocks = [], pager = null, facts = null, media = null }) {
  const country = quakeCountry(main.place);
  const m = magnitudeWords(main.mag);
  const depth = Math.max(1, Math.round(main.depthKm));
  const day = new Date(main.time).toISOString().slice(0, 10);
  const lines = []; const spots = {}; const pins = []; const cameras = {};
  const pin = (p) => { pins.push(p); return pins.length - 1; };
  const epi = { lon: main.lon, lat: main.lat };
  cameras.opening = { ...cameraOver([epi], { minM: 2_400_000 }) };
  cameras.closing = cameras.opening;
  const where = country ? country.acc : 'oblasť';

  // 1. háčik
  const hookText = (k) => `Zemetrasenie s magnitúdou ${m[k]} zasiahlo ${where}.`;
  lines.push({ id: 'hook', shot: 'opening', spoken: hookText('spoken'), caption: hookText('caption'), names: true });
  const hook = { tag: `ZEMETRASENIE · ${dayMonth(main.time)}`, lines: [`MAGNITÚDA ${m.caption}`, (country?.nom || 'ZEMETRASENIE').toUpperCase()], accent: m.caption, sub: 'podľa USGS' };

  // 2. ohnisko: hĺbka a vzdialenosť od hlavného mesta (PAGER)
  const capital = (pager?.cities || []).find((c) => c.iscap);
  const capKm = capital ? Math.round(km(capital, epi) / 10) * 10 : null;
  const epiText = (k) => `Ohnisko bolo len ${k === 'spoken' ? spokenNumber(depth) : depth} kilometrov pod povrchom`
    + (capital && capKm >= 20 ? `, ${k === 'spoken' ? spokenNumber(capKm) : group(capKm)} kilometrov od hlavného mesta.` : '.');
  lines.push({ id: 'epi', shot: 'spot:epi', spoken: epiText('spoken'), caption: epiText('caption') });
  spots.epi = { tag: 'ZEMETRASENIE · USGS', value: Math.round(main.mag * 10) / 10, decimals: 1, unit: 'MAGNITÚDA', color: '#ff6b78',
    rows: [`hĺbka ${depth}${NBSP}km · ${dayMonth(main.time)} ${utcTime(main.time)}`, main.tsunami ? 'USGS: možnosť cunami' : 'Geologická služba USA'] };
  const epiPin = pin({ lon: epi.lon, lat: epi.lat, label: `EPICENTRUM · M${NBSP}${m.caption}`, color: '#ff3b3b', shots: ['epi', 'shake', 'after'] });
  const epiPoints = [epi];
  if (capital && capKm >= 20) { pin({ lon: capital.lon, lat: capital.lat, label: capital.name, color: '#4fd1ff', shots: ['epi'] }); epiPoints.push(capital); }
  cameras.epi = cameraOver(epiPoints, { minM: 380_000, k: 3200 });

  // Zábery (clip:<i> v poradí `clips`): mapa otrasov USGS, fotky alebo video z miesta (Commons, s autorom).
  const clips = [];
  const addClip = (c) => { clips.push({ inset: false, keepCaptions: true, sourceLines: [], placeName: '', ...c }); return clips.length - 1; };
  if (media?.shakemap?.file) {
    const k = addClip({ kind: 'images', files: [media.shakemap.file], captionSk: 'Mapa otrasov USGS', kicker: 'MAPA OTRASOV · USGS',
      credit: 'ShakeMap: USGS · verejná doména', sources: ['Mapa otrasov: USGS ShakeMap'], fixedStart: 0 });
    const text = 'Mapa USGS ukazuje, kde sa zem triasla najsilnejšie.';
    lines.push({ id: 'shakemap', shot: `clip:${k}`, spoken: text, caption: text });
  }
  let sceneClip = null;
  if (media?.video?.file) sceneClip = addClip({ kind: 'video', file: media.video.file, captionSk: 'Záber z miesta', kicker: `${(country?.nom || '').toUpperCase()} · ZÁBERY Z MIESTA`.replace(/^ · /, ''),
    credit: media.video.credit, sources: [media.video.credit], page: media.video.page || null });
  else if (media?.photos?.length) sceneClip = addClip({ kind: 'images', files: media.photos.map((p) => p.file), captionSk: 'Zábery z miesta', kicker: `${(country?.nom || '').toUpperCase()} · ZÁBERY Z MIESTA`.replace(/^ · /, ''),
    credit: media.photos.length === 1 ? media.photos[0].credit : `Foto: ${[...new Set(media.photos.map((p) => p.artist))].slice(0, 2).join(', ')} · Wikimedia Commons`,
    sources: [...new Set(media.photos.map((p) => p.credit))], pages: media.photos.map((p) => p.page).filter(Boolean), fixedStart: 0 });

  // 3. silné otrasy (PAGER): ľudia v intenzite VII+ a najviac zasiahnuté mestá
  const people = strongShakingPeople(pager?.exposures);
  if (people >= 10_000) {
    const r = roundedDown(people);
    const text = (k) => `Silné otrasy podľa odhadu USGS zasiahli vyše ${k === 'spoken' ? spokenNumber(r) : group(r)} ľudí.`;
    lines.push({ id: 'shake', shot: 'spot:shake', spoken: text('spoken'), caption: text('caption') });
    spots.shake = { tag: 'SILNÉ OTRASY · ODHAD USGS', value: r, prefix: '', unit: 'ĽUDÍ', color: '#ffb020', rows: ['intenzita VII a viac (model PAGER)'] };
    const towns = (pager.cities || []).filter((c) => !c.iscap && c.mmi >= 7).sort((a, b) => b.pop - a.pop).slice(0, 3);
    for (const c of towns) pin({ lon: c.lon, lat: c.lat, label: c.name, color: '#ffb020', shots: ['shake'] });
    cameras.shake = cameraOver([epi, ...towns], { minM: 420_000, k: 3400 });
  }

  // 4. dotrasy
  if (aftershocks.length >= 3) {
    const n = aftershocks.length; const top = magnitudeWords(aftershocks[0].mag);
    const unit = (k) => (k === 'spoken' ? spokenNumber(n) : String(n));
    const text = (k) => `${plural(n, 'Nasledoval', 'Nasledovali', 'Nasledovalo')} ${unit(k)} ${plural(n, 'silnejší dotras', 'silnejšie dotrasy', 'silnejších dotrasov')}, najsilnejší mal magnitúdu ${top[k]}.`;
    lines.push({ id: 'after', shot: 'spot:after', spoken: text('spoken'), caption: text('caption') });
    spots.after = { tag: 'DOTRASY · USGS', value: n, unit: plural(n, 'DOTRAS', 'DOTRASY', 'DOTRASOV'), color: '#ffffff',
      rows: [`magnitúda ${String(AFTERSHOCK.minMag).replace('.', ',')} a viac`, `najsilnejší M${NBSP}${top.caption}`] };
    for (const a of aftershocks.slice(0, 40)) pin({ lon: a.lon, lat: a.lat, label: a.mag >= 6 ? `M${NBSP}${magnitudeWords(a.mag).caption}` : '', color: '#ff8a3d', kind: 'fire', shots: ['after'] });
    cameras.after = cameraOver([epi, ...aftershocks.slice(0, 40)], { minM: 420_000, k: 3000 });
  }

  // 5. následky: len overené správy (≥ 2 médiá); inak stupeň PAGER ako odhad, nie fakt
  // Zábery z miesta nesú vetu o následkoch (alebo vlastnú, ak správy ešte nie sú overené).
  const impactShot = sceneClip !== null ? `clip:${sceneClip}` : 'spot:impact';
  if (sceneClip !== null && !facts?.spoken) {
    const text = 'Takto to vyzerá na mieste zemetrasenia.';
    lines.push({ id: 'scene', shot: `clip:${sceneClip}`, spoken: text, caption: text });
  }
  if (facts?.spoken) {
    lines.push({ id: 'impact', shot: impactShot, spoken: facts.spoken, caption: facts.caption || facts.spoken });
    spots.impact = { tag: 'NÁSLEDKY · PODĽA MÉDIÍ', title: facts.title || 'ŠKODY', rows: facts.rows || [] };
    cameras.impact = cameras.shake || cameras.epi;
  } else if (pager?.economicLevel === 'red' || pager?.economicLevel === 'orange') {
    const text = 'USGS podľa modelu odhaduje rozsiahle škody.';
    lines.push({ id: 'impact', shot: 'spot:impact', spoken: text, caption: text });
    spots.impact = { tag: 'ODHAD ŠKÔD · USGS PAGER', title: pager.economicLevel === 'red' ? 'ČERVENÝ STUPEŇ' : 'ORANŽOVÝ STUPEŇ', rows: ['model, nie hlásenie úradov'] };
    cameras.impact = cameras.shake || cameras.epi;
  }

  // 6. záver
  lines.push({ id: 'portal', shot: 'closing', approved: true,
    spoken: `Zemetrasenia vo svete naživo na ${MAP_SOURCE.spokenSite}.`, caption: `Zemetrasenia vo svete naživo na ${MAP_SOURCE.site}.` });

  const newsNames = (facts?.sources || []).map((s) => s.name);
  const sources = ['Údaje: USGS (verejná doména), model PAGER', newsNames.length ? `Správy: ${newsNames.slice(0, 3).join(', ')}` : null,
    sceneClip !== null ? clips[sceneClip].sources[0] : null, 'Mapa: NASA GIBS · ASTER GDEM (METI/NASA)'].filter(Boolean);
  const post = quakePostText({ main, country, m, depth, capital, capKm, people, aftershocks, pager, facts, clips });
  return { name: `zemetrasenie-${(country?.nom || 'svet').toLowerCase().replace(/\s+/g, '-')}-${day}`, story: 'quake', map: 'aster-relief',
    model: { day, spots, pins, sources, endLine: 'Zemetrasenia naživo', epiPin }, media: clips, lines, hook, cameras, post };
}

/** Text príspevku: háčik, údaje USGS, odhad (označený ako odhad), správy so zdrojmi, odkazy. Pure. */
export function quakePostText({ main, country, m, depth, capital, capKm, people, aftershocks, pager, facts, clips = [] }) {
  const out = [`Zemetrasenie s magnitúdou ${m.caption} zasiahlo ${country ? country.acc : 'oblasť'} (${dayMonth(main.time)} ${utcTime(main.time)}).`, ''];
  out.push(`Podľa Geologickej služby USA (USGS) bolo ohnisko v hĺbke ${depth} km${capital && capKm >= 20 ? `, asi ${group(capKm)} km od hlavného mesta (${capital.name})` : ''}. Miesto: ${main.place}.`);
  if (aftershocks.length >= 3) out.push(`Nasledovalo ${aftershocks.length} dotrasov s magnitúdou ${String(AFTERSHOCK.minMag).replace('.', ',')} a viac, najsilnejší M ${magnitudeWords(aftershocks[0].mag).caption}.`);
  if (people >= 10_000) out.push(`Silné otrasy (intenzita VII a viac) podľa odhadu modelu USGS PAGER zasiahli vyše ${group(roundedDown(people))} ľudí.`);
  if (facts?.caption || facts?.spoken) out.push('', `${facts.caption || facts.spoken} Zdroje: ${(facts.sources || []).map((s) => s.name).join(', ')}.`);
  if (pager?.economicLevel) out.push('', `Odhad USGS PAGER: ${pager.economicLevel === 'red' ? 'červený' : pager.economicLevel === 'orange' ? 'oranžový' : pager.economicLevel === 'yellow' ? 'žltý' : 'zelený'} stupeň pre ekonomické škody — ide o model, nie o hlásenie úradov.`);
  // Zábery z Commons: autor, licencia a odkaz na súbor (podmienka CC BY / CC BY-SA).
  const credits = clips.filter((c) => c.kind === 'video' || (c.pages && c.pages.length)).flatMap((c) => (c.kind === 'video' ? [`${c.credit}: ${c.page || ''}`.replace(/: $/, '')] : c.sources.map((src, i) => `${src}${c.pages[i] ? `: ${c.pages[i]}` : ''}`)));
  if (credits.length) out.push('', ...credits);
  if (main.url) out.push('', `USGS: ${main.url}`);
  out.push('', `Zemetrasenia vo svete naživo: https://${MAP_SOURCE.site}`, '', `#zemetrasenie${country ? ` #${country.nom.replace(/\s+/g, '')}` : ''} #OKO`);
  return out.join('\n');
}

/** Prah videa: magnitúda od `minMag`, alebo oranžový/červený PAGER od `alertMinMag`; čaká `minAgeMs` na PAGER a správy. */
export const QUAKE_VIDEO = Object.freeze({ minMag: 6.5, alertMinMag: 5.5, minAgeMs: 45 * 60_000, maxAgeMs: 24 * 3600_000 });

/**
 * Zemetrasenie, ku ktorému má Štúdio pripraviť video (feed USGS 4.5_day): najsilnejšie z okna, ktoré ešte
 * nemá návrh (`done(id)`), a nie dotras otrasu, ktorý video už má (do 200 km a 7 dní). Pure.
 */
export function quakeVideoCandidate(features, { now = Date.now(), done = () => false, o = QUAKE_VIDEO, minMag = o.minMag, alertMinMag = o.alertMinMag } = {}) {
  const quakes = (features || []).map(quakeOf).filter((q) => Number.isFinite(q.mag) && Number.isFinite(q.time) && q.id);
  const covered = quakes.filter((q) => done(q.id));
  return quakes
    .filter((q) => now - q.time >= o.minAgeMs && now - q.time <= o.maxAgeMs)
    .filter((q) => q.mag >= minMag || (q.mag >= alertMinMag && (q.alert === 'orange' || q.alert === 'red')))
    .filter((q) => !done(q.id))
    .filter((q) => !covered.some((c) => c.mag >= q.mag && c.time < q.time && q.time - c.time <= AFTERSHOCK.maxDays * 86_400_000 && km(c, q) <= AFTERSHOCK.maxKm))
    .sort((a, b) => b.mag - a.mag)[0] || null;
}
