// „Týždeň v OKU" (2026-10-11, vlastník: súhrn týždňa — „Ukrajina najviac, ostatné okrajovo", „kvalita na prvom
// mieste", „prvé sekundy musia byť chytľavé", videá a obrázky aj z iných zdrojov). Z overených faktov týždňa
// (ruské útoky s obeťami od ≥ 2 médií, zmena frontu za 7 dní, strety GŠ, zábery ДСНС a ArmyInform, svet: tanker,
// zemetrasenie) poskladá dva scenáre linky denného videa v2: A = Ukrajina na mape KARTA, B = svet na reliéfe
// (iná mapa = iné nahrávanie); scripts/make-week-video.mjs ich spojí jedným hlasom a hudbou. Pure.
import { spokenNumber } from './eventSpeech.js';
import { MAP_SOURCE, directionSk } from './frontWeekNarration.js';
import { DAY_OVERVIEW_CAMERA } from './frontDayVideo.js';

const NBSP = ' ';
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const dm = (day) => { const d = new Date(`${day}T12:00:00Z`); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`; };
/** Kamera nad mestom: bod v dolnej polovici obrazu (hore je veľké číslo). Pure. */
export const townCamera = (p, heightM = 420_000) => ({ lon: p.lon, lat: p.lat + heightM / 1_400_000, heightM, pitchDeg: -88, headingDeg: 0 });

/**
 * @param {object} w vstup týždňa (pozri test): hook, strikes[], front { change, clashes }, clips[], world[], sources
 * @returns {{ a: object, b: object, post: string }} scenáre pre make-front-day-video.mjs --scenario
 */
export function weekScenarios(w) {
  const A = { lines: [], spots: {}, pins: [], cameras: {}, media: [] };
  const clip = (S, c) => { S.media.push({ inset: false, keepCaptions: true, sourceLines: [], placeName: '', ...c }); return S.media.length - 1; };

  // ── háčik: najsilnejší fakt týždňa, hneď za ním záber z miesta ─────────────
  // Prvé sekundy: fotka z miesta útoku na celú obrazovku a cez ňu veľký háčik (nie mapa) — `hookPhoto`.
  const hookShot = w.hookPhoto?.file
    ? `clip:${clip(A, { kind: 'images', files: [w.hookPhoto.file], captionSk: w.hookPhoto.caption || '', kicker: '', credit: w.hookPhoto.credit, sources: [w.hookPhoto.credit], keepCaptions: false, fixedStart: 0 })}`
    : 'opening';
  A.lines.push({ id: 'hook', shot: hookShot, spoken: w.hook.spoken, caption: w.hook.caption, names: true });
  // ── ruské útoky s obeťami: mapa (veľké číslo) → fotky ДСНС ────────────────
  for (const s of w.strikes || []) {
    A.pins.push({ lon: s.lon, lat: s.lat, label: s.name.toUpperCase(), color: '#ff3b3b', shots: [s.id] });
    A.spots[s.id] = { tag: `RUSKÝ ÚTOK · ${dm(s.day)}`, value: s.killed, unit: plural(s.killed, 'MŔTVY', 'MŔTVI', 'MŔTVYCH'), color: '#ff6b78',
      rows: [s.what, `najmenej · ${s.children ? `z toho ${s.children} ${plural(s.children, 'dieťa', 'deti', 'detí')} · ` : ''}podľa médií`].filter(Boolean) };
    A.cameras[s.id] = townCamera(s);
    A.lines.push({ id: `${s.id}-map`, shot: `spot:${s.id}`, ...s.mapLine, names: true });
    if (s.photos?.length) {
      const k = clip(A, { kind: 'images', files: s.photos, captionSk: s.name, kicker: `${s.name.toUpperCase()} · ZÁCHRANÁRI`, credit: s.credit, sources: [s.credit], fixedStart: 0 });
      A.lines.push({ id: `${s.id}-photo`, shot: `clip:${k}`, ...s.photoLine, names: true });
    }
  }
  // ── front za týždeň: obsadené km² a najťažší smer, strety GŠ ────────────
  const ch = w.front?.change;
  if (ch && ch.ruKm2 >= 1) {
    const km = Math.round(ch.ruKm2);
    const top = (ch.directions || []).filter((d) => d.ruKm2 >= 1).sort((a, b) => b.ruKm2 - a.ruKm2)[0];
    const text = (k) => `Na fronte ruský agresor za týždeň obsadil ďalších ${k === 'spoken' ? spokenNumber(km) : group(km)} kilometrov štvorcových`
      + (top ? `, najviac ${directionSk(top.id).at}.` : '.');
    A.lines.push({ id: 'change', shot: 'overview', spoken: text('spoken'), caption: text('caption'), names: Boolean(top) });
  }
  if (Number.isFinite(w.front?.clashes)) {
    const n = w.front.clashes;
    const text = (k) => `Generálny štáb Ukrajiny hlási za týždeň ${k === 'spoken' ? spokenNumber(n) : group(n)} bojových stretov s ruskými okupantmi.`;
    A.spots.week = { tag: 'CELÝ FRONT · TÝŽDEŇ', value: n, unit: 'BOJOVÝCH STRETOV', color: '#ffffff', rows: [`${dm(w.week.from)} – ${dm(w.week.to)} · Generálny štáb Ukrajiny`, 'údaje jednej strany'] };
    A.cameras.week = DAY_OVERVIEW_CAMERA;
    A.lines.push({ id: 'clashes', shot: 'spot:week', spoken: text('spoken'), caption: text('caption') });
  }
  // ── akčné zábery ArmyInform (Ukrajina sa bráni) ───────────────────────────
  for (const [i, c] of (w.clips || []).entries()) {
    const k = clip(A, { kind: 'video', file: c.file, captionSk: c.caption, kicker: 'ZÁBERY · ARMYINFORM', credit: 'Ministerstvo obrany Ukrajiny · CC BY 4.0', sources: ['Zábery: ArmyInform (CC BY 4.0)'] });
    A.lines.push({ id: `armyinform${i}`, shot: `clip:${k}`, spoken: `${c.caption}.`, caption: `${c.caption}.` });
  }

  // ── svet (okrajovo): spot na glóbuse s vlastnou kamerou, trasou alebo mapou otrasov ─
  const B = { lines: [], spots: {}, pins: [], cameras: {}, media: [], route: null, overlay: null };
  for (const it of w.world || []) {
    B.spots[it.id] = it.spot;
    B.cameras[it.id] = it.camera;
    for (const p of it.pins || []) B.pins.push({ ...p, shots: [it.id] });
    if (it.route) B.route = { points: it.route, shots: [it.id] };
    if (it.overlay) B.overlay = { ...it.overlay, shots: [it.id] };
    B.lines.push({ id: it.id, shot: `spot:${it.id}`, spoken: it.line.spoken, caption: it.line.caption, names: true });
  }
  B.lines.push({ id: 'portal', shot: 'closing', approved: true, spoken: `Týždeň v OKU. Svet naživo na ${MAP_SOURCE.spokenSite}.`, caption: `Týždeň v OKU. Svet naživo na ${MAP_SOURCE.site}.` });
  B.cameras.closing = (w.world || []).at(-1)?.camera || DAY_OVERVIEW_CAMERA;

  const day = w.week.to;
  const a = { name: `tyzden-v-oku-${day}-ukrajina`, story: 'strike', hook: w.hook.card,
    model: { day, change: ch || null, spots: A.spots, pins: A.pins, sources: [], hookOverClip: hookShot !== 'opening' }, lines: A.lines, cameras: A.cameras, media: A.media, post: '' };
  const b = { name: `tyzden-v-oku-${day}-svet`, story: 'quake', map: 'aster-relief', overlay: B.overlay,
    model: { day, spots: B.spots, pins: B.pins, route: B.route, sources: w.sources || [], endLine: 'Týždeň v OKU', musicCredit: w.musicCredit || null },
    lines: B.lines, cameras: B.cameras, media: B.media, post: '' };
  return { a, b, post: weekPostText(w) };
}

/** Text príspevku: háčik, útoky s obeťami a zdrojmi, front, svet, zdroje záberov, odkazy. Pure. */
export function weekPostText(w) {
  const out = [w.hook.caption, ''];
  for (const s of w.strikes || []) out.push(`${s.name} (${dm(s.day)}): ${s.postText} Zdroje: ${s.sources.join(', ')}.`);
  const ch = w.front?.change;
  if (ch?.ruKm2 >= 1 || Number.isFinite(w.front?.clashes)) {
    out.push('', [ch?.ruKm2 >= 1 ? `Ruský agresor za týždeň obsadil ďalších ${group(Math.round(ch.ruKm2))} km² (mapa frontu ${MAP_SOURCE.site}, porovnanie snímok ${dm(ch.fromDay)} a ${dm(ch.toDay)}).` : null,
      Number.isFinite(w.front?.clashes) ? `Generálny štáb Ukrajiny hlási za ${dm(w.week.from)} – ${dm(w.week.to)} spolu ${group(w.front.clashes)} bojových stretov (údaje jednej strany).` : null].filter(Boolean).join(' '));
  }
  for (const it of w.world || []) if (it.postText) out.push('', it.postText);
  if (w.credits?.length) out.push('', ...w.credits);
  out.push('', `Mapa frontu deň po dni: https://${MAP_SOURCE.site}/?front=front`, `Svet naživo: https://${MAP_SOURCE.site}`, '', '#Ukrajina #týždeň #OKO');
  return out.join('\n');
}
