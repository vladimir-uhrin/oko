// src/data/eventNarration.js — komentár videa udalosti z dát (2026-10-03, vlastník: „ako by si to celé
// automatizoval… sprav"; „čísla zle vyslovuje a anglické názvy tiež" → výslovnosť; „prvé 3–4 sekundy
// musia diváka chytiť" → háčik na začiatku; „vždy spomínaj môj portál"). Čisté:
//   vety      z kľúčových momentov udalosti (eventPost.keyMoments) + háčik a doplnky zo scenára vlastníka
//             (eventVideoScript.js) + pevná veta na záver (portál — nahratá raz, schválená uchom; meno autora sa nehovorí),
//   dve podoby každej vety: `spoken` (čo číta hlas: čísla slovami, cudzie názvy foneticky — eventSpeech)
//             a `caption` (titulok: číslice, správny pravopis),
//   kotva     kedy má veta zaznieť (fáza/moment plánu videa),
//   tempo     fitNarration: kúsky plánu videa sa predlžujú (stretch), kým každá veta nezačne pri svojom zábere
//             (najviac `tolS` za kotvou) a posledná skončí pred koncom videa.
// Pure; hlas, nahrávanie a zvuk rieši scripts/lib/eventVideoPipeline.mjs.

import { keyMoments } from './eventPost.js';
import { videoPlan } from './eventVideo.js';
import { VIDEO_BRAND } from './eventVideoHud.js';
import { landingPhrase } from './eventReported.js';
import { spokenNumber, spokenMinutes, spokenMinutesAcc, spokenDegrees, spokenFeet, spokenFlightNumber, spokenDomain, spokenFlightTime, spokenKm } from './eventSpeech.js';

export const NARRATION_DEFAULTS = Object.freeze({
  /** Medzera medzi vetami (s), tolerancia oneskorenia za kotvou (s), rezerva na konci videa (s). */
  gapS: 0.35, tolS: 0.35, endMarginS: 0.6, maxIterations: 60,
  /** Predvolené tempo s otvorením a koncovou kartou; solver ich podľa potreby predĺži. */
  planOpts: { openingS: 2.6, endCardS: 3 },
});

const NBSP = ' ';
const groupDigits = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const SQUAWK_SK = { emergency: 'kód núdze', hijack: 'kód nezákonného zásahu', radio: 'kód straty spojenia' };

/** Zaokrúhlenie výšky pre reč a titulok: nad 10 000 ft na tisíce, inak na stovky. Pure. */
export function roundFeet(ft) {
  const n = Math.round(Number(ft) || 0);
  return n >= 10_000 ? Math.round(n / 1000) * 1000 : Math.round(n / 100) * 100;
}

/**
 * Pevná veta na záver (portál) — nahratá raz, schválená vlastníkom (bez kontroly výslovnosti).
 * Meno autora sa v komentári NEHOVORÍ (vlastník 10-03: „moje meno nespomínaj"); podpis ostáva len v obraze.
 */
export function fixedLines() {
  return [
    { id: 'portal', kind: 'fixed', spoken: `Celú rekonštrukciu nájdete na ${spokenDomain(VIDEO_BRAND.domain)}.`, caption: `Celú rekonštrukciu nájdete na ${VIDEO_BRAND.domain}.`, anchor: { at: 'endcard', offset: 0.4 }, approved: true },
  ];
}

/** Veta k momentu z dát: `{spoken, caption}` alebo null (štart, cestovná výška, pristátie bez letiska…). Pure. */
export function momentSentence(m, { nextSquawks = [] } = {}) {
  switch (m.kind) {
    case 'dive': {
      const fpm = Math.abs(m.fpm || 0);
      const floor = Math.floor(fpm / 1000) * 1000;
      const more = fpm > floor && floor > 0;
      // Dramaticky, ale podľa čísla: nad 10 000 stôp za minútu „rúti sa dolu" (bežné klesanie je okolo 2 000).
      // Hodina sa nehovorí — čas beží v obraze; veta je krátka, aby stihla samotný pád.
      const verb = fpm >= 10_000 ? 'Zrazu sa lietadlo rúti dolu' : 'Zrazu lietadlo prudko klesá';
      return {
        spoken: `${verb} — ${more ? 'vyše ' : ''}${spokenFeet(floor || fpm)} za minútu.`,
        caption: `${verb} — ${more ? 'vyše ' : ''}${groupDigits(floor || fpm)}${NBSP}stôp za minútu.`,
      };
    }
    case 'gap': {
      const min = Math.max(1, Math.round((m.s ?? ((m.toT ?? m.t) - (m.fromT ?? m.t))) / 60));
      return { spoken: `Potom ${spokenMinutes(min)} ticho. Žiadne údaje.`, caption: `Potom ${min} ${min === 1 ? 'minúta' : (min <= 4 ? 'minúty' : 'minút')} ticho. Žiadne údaje.` };
    }
    case 'squawk': {
      const all = [m, ...nextSquawks];
      const codes = all.map((x) => SQUAWK_SK[x.meaning] || 'núdzový kód');
      const spoken = [`Lietadlo vysiela ${codes[0]}.`];
      const caption = [`Lietadlo vysiela ${codes[0]}.`];
      // Ďalší kód s odstupom z údajov: „O päť minút neskôr kód nezákonného zásahu."
      for (let k = 1; k < all.length; k += 1) {
        const dMin = Number.isFinite(all[k].t) && Number.isFinite(all[k - 1].t) ? Math.round((all[k].t - all[k - 1].t) / 60) : 0;
        if (dMin >= 1) {
          spoken.push(`O ${spokenMinutesAcc(dMin)} neskôr ${codes[k]}.`);
          caption.push(`O ${dMin === 1 ? 'minútu' : `${dMin} ${dMin <= 4 ? 'minúty' : 'minút'}`} neskôr ${codes[k]}.`);
        } else {
          spoken.push(`Vzápätí ${codes[k]}.`);
          caption.push(`Vzápätí ${codes[k]}.`);
        }
      }
      return { spoken: spoken.join(' '), caption: caption.join(' ') };
    }
    case 'uturn': {
      const deg = Math.round(Math.abs(m.turnDeg || 0));
      return { spoken: `Stroj sa otáča späť — obrat o ${spokenDegrees(deg)}.`, caption: `Stroj sa otáča späť — obrat o ${deg} ${deg === 1 ? 'stupeň' : (deg <= 4 ? 'stupne' : 'stupňov')}.` };
    }
    case 'last-contact': {
      if (!m.airborne) return { spoken: 'Posledný záznam je na zemi.', caption: 'Posledný záznam je na zemi.' };
      const ft = roundFeet((m.alt ?? 0) / 0.3048);
      return { spoken: `Údaje končia vo výške ${spokenFeet(ft)} — lietadlo je stále vo vzduchu.`, caption: `Údaje končia vo výške ${groupDigits(ft)}${NBSP}stôp — lietadlo je stále vo vzduchu.` };
    }
    case 'landing': return { spoken: 'Lietadlo pristáva.', caption: 'Lietadlo pristáva.' };
    case 'reported-landing': {
      const text = `${cap(landingPhrase(m.reported, 'sk').replace(/ \([A-Z0-9]{3,4}\)/, ''))} — podľa správ.`;
      // Hovorene: „Podľa správ núdzovo pristálo na letisku Tabuk." (apozícia, bez skloňovania mesta)
      return { spoken: `Podľa správ ${landingPhrase(m.reported, 'sk').replace(/ \([A-Z0-9]{3,4}\)/, '').replace(/^(núdzové pristátie|pristátie)/, (w) => (w === 'núdzové pristátie' ? 'núdzovo pristálo' : 'pristálo'))}.`, caption: text };
    }
    default: return null;
  }
}

/** Poznámka zo správ k diere (pokles): „Podľa správ kleslo za minútu pod 17 000 stôp." Pure. */
export function descentSentence(f) {
  const dur = Math.max(0, (f.t ?? 0) - (f.fromT ?? f.t ?? 0));
  const during = dur <= 75 ? 'za jedinú minútu' : `za ${spokenMinutes(Math.round(dur / 60))}`;
  const duringCap = dur <= 75 ? 'za jedinú minútu' : `za ${Math.round(dur / 60)} ${Math.round(dur / 60) <= 4 ? 'minúty' : 'minút'}`;
  const ft = roundFeet(f.toFt);
  const under = f.toBelow ? 'pod ' : 'na ';
  return { spoken: `Podľa správ kleslo ${during} ${under}${spokenFeet(ft)}.`, caption: `Podľa správ kleslo ${duringCap} ${under}${groupDigits(ft)}${NBSP}stôp.` };
}

/**
 * Keď sa lietadlo po diere znova ozve výrazne inde (≥ 5 000 stôp): „Keď sa stroj znova ozve, je
 * o 13 000 stôp nižšie." — z výšok na okrajoch diery (tie isté ako nápis „kleslo o …" v obraze). Pure.
 */
export function gapAftermathSentence(m) {
  if (!Number.isFinite(m?.fromAlt) || !Number.isFinite(m?.toAlt)) return null;
  const dFt = (m.fromAlt - m.toAlt) / 0.3048;
  if (Math.abs(dFt) < 5000) return null;
  const ft = roundFeet(Math.abs(dFt));
  const dir = dFt > 0 ? 'nižšie' : 'vyššie';
  return { spoken: `Keď sa stroj znova ozve, je o ${spokenFeet(ft)} ${dir}.`, caption: `Keď sa stroj znova ozve, je o ${groupDigits(ft)}${NBSP}stôp ${dir}.` };
}

const RAD = Math.PI / 180;
function haversineKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * Veta kontextu pred prvým momentom (viac informácií z dát, vlastník 10-03): „Lietadlo je vyše 2 hodín vo
 * vzduchu, 400 km pred cieľom." — dve z trojice čas letu, vzdialenosť do cieľa, výška — len to, čo údaje nesú: štart z časovej osi, cieľ z trasy (iba keď lietadlo letí
 * k nemu, ±60° od kurzu), cestovná výška z posledného úseku pred momentom. Menej než dve časti = null. Pure.
 */
export function contextSentence(event, moments = keyMoments(event)) {
  const first = moments.find((m) => Number.isFinite(m.t) && !['landing', 'reported-landing', 'last-contact'].includes(m.kind));
  if (!first) return null;
  const timeline = event.timeline || [];
  const parts = [];
  const takeoff = timeline.find((m) => m.kind === 'takeoff' && m.t < first.t);
  const flown = takeoff ? spokenFlightTime(first.t - takeoff.t) : null;
  if (flown) parts.push({ spoken: `${flown.spoken} vo vzduchu`, caption: `${flown.caption} vo vzduchu` });
  const cruise = [...timeline].reverse().find((m) => m.kind === 'cruise' && m.t <= first.t);
  const dest = event.route?.destination;
  if (dest && [dest.lat, dest.lon, first.lat, first.lon].every(Number.isFinite) && Number.isFinite(cruise?.trk)) {
    const off = Math.abs(((bearingDeg(first.lat, first.lon, dest.lat, dest.lon) - cruise.trk + 540) % 360) - 180);
    const km = haversineKm(first.lat, first.lon, dest.lat, dest.lon);
    if (off <= 60 && km >= 50) {
      const d = spokenKm(km);
      parts.push({ spoken: `${d.spoken} pred cieľom`, caption: `${d.caption} pred cieľom` });
    }
  }
  if (Number.isFinite(cruise?.alt) && cruise.alt / 0.3048 >= 5000) {
    const ft = roundFeet(cruise.alt / 0.3048);
    parts.push({ spoken: `vo výške ${spokenFeet(ft)}`, caption: `vo výške ${groupDigits(ft)}${NBSP}stôp` });
  }
  if (parts.length < 2) return null;
  // Najviac dve časti (krátka veta): čas letu a vzdialenosť; výška (je aj v obraze) len keď jedna z nich chýba.
  const two = parts.slice(0, 2);
  return { spoken: `Lietadlo je ${two.map((p) => p.spoken).join(', ')}.`, caption: `Lietadlo je ${two.map((p) => p.caption).join(', ')}.` };
}

/** Kam sa doplnok zo správ (scenár, `after`) zaradí: za poslednú vetu prvého momentu daného druhu. */
const AFTER_KINDS = { dive: ['dive'], gap: ['gap', 'descent', 'aftermath'], squawk: ['squawk'], uturn: ['uturn'], 'last-contact': ['last-contact'], landing: ['landing', 'reported-landing'] };

/**
 * Vety komentára v poradí: háčik (scenár) → kontext z dát → momenty z dát (s doplnkami zo správ pripnutými
 * k momentu, `extras[].after`) → doplnky na záver → portál. Riadok scenára `lines[id]` (`{spoken, caption}`)
 * nahradí vygenerovanú vetu (napr. skloňované mesto).
 * @param {object} event uložená udalosť
 * @param {object|null} script eventVideoScript.normalizeVideoScript(...) alebo null
 * @returns {Array<{id: string, kind: string, spoken: string, caption: string, anchor: object|null, approved?: boolean, source?: object}>}
 */
export function narrationLines(event, script = null) {
  const moments = keyMoments(event);
  const out = [];
  const hook = script?.hook || null;
  if (hook) {
    // Prvá veta na úvodnej karte, druhá už nad celkovým záberom (úvod) — karta nestojí zbytočne dlho.
    hook.spoken.forEach((spoken, i) => out.push({ id: `hook${i + 1}`, kind: 'hook', spoken, caption: hook.captions[i] || spoken, anchor: i === 0 ? { at: 'opening', offset: 0.3 } : (i === 1 ? { at: 'intro' } : null), source: hook.source }));
  } else {
    const flight = event.route?.flightIata || event.callsign || null;
    if (flight) {
      const route = event.route?.origin?.city && event.route?.destination?.city ? ` na trase ${event.route.origin.city} – ${event.route.destination.city}` : '';
      out.push({ id: 'flight', kind: 'flight', spoken: `Let ${spokenFlightNumber(flight)}${route}.`, caption: `Let ${flight}${route}.`, anchor: { at: 'opening', offset: 0.3 } });
    }
  }
  // Kontext z dát počas prehrávania stopy pred prvým momentom.
  const context = contextSentence(event, moments);
  if (context) out.push({ id: 'ctx', kind: 'context', ...context, anchor: { at: 'play' } });
  for (let i = 0; i < moments.length; i += 1) {
    const m = moments[i];
    if (m.kind === 'squawk' && i > 0 && moments[i - 1].kind === 'squawk') continue; // spojené do jednej vety
    const nextSquawks = [];
    if (m.kind === 'squawk') for (let j = i + 1; j < moments.length && moments[j].kind === 'squawk'; j += 1) nextSquawks.push(moments[j]);
    const sentence = momentSentence(m, { nextSquawks });
    if (!sentence) continue;
    const anchor = {
      dive: { spotlightBefore: i },
      gap: { hold: i },
      squawk: { hold: i },
      uturn: { spotlightBefore: i },
      'last-contact': { hold: i, offset: -2.0 },
      landing: { hold: i, offset: -1.0 },
      // Pristátie zo správ smie začať až 2 s po nástupe záberu (predošlá veta doznie nad presunom kamery)
      // — inak by sa kvôli nemu predlžovali všetky zastavenia.
      'reported-landing': { piece: 'reported', moment: i, late: 2 },
    }[m.kind] || { hold: i };
    out.push({ id: `m${i}`, kind: m.kind, ...sentence, anchor, moment: i });
    if (m.kind === 'gap') {
      (m.reportedNotes || []).forEach((f, k) => out.push({ id: `m${i}n${k}`, kind: 'descent', ...descentSentence(f), anchor: { gapOf: i, late: 2.5 }, moment: i, source: { domains: f.domains } }));
      const aftermath = gapAftermathSentence(m);
      // Znie počas diery (hodiny bežia, lietadlo je bledé), nie nad zastaveným obrazom pred ňou: kotva na
      // dieru s voľným oneskorením — tempo potom predĺži dieru, nie zastavenie.
      if (aftermath) out.push({ id: `m${i}a`, kind: 'aftermath', ...aftermath, anchor: { gapOf: i, late: 30 }, moment: i });
    }
  }
  // Doplnky zo správ: pripnuté k momentu (`after`) idú hneď za jeho vety (bez vlastnej kotvy — tempo ich
  // tam udrží), ostatné na záver nad súhrn. Id podľa poradia v scenári (extra1…), nie podľa miesta.
  let endExtras = 0;
  (script?.extras || []).forEach((x, i) => {
    const line = { id: `extra${i + 1}`, kind: 'extra', spoken: x.spoken, caption: x.caption, anchor: null, source: x.source };
    const kinds = AFTER_KINDS[x.after] || null;
    let at = -1;
    if (x.after === 'intro') {
      at = out.findLastIndex((l) => ['hook', 'flight', 'context'].includes(l.kind) || (l.kind === 'extra' && l.after === 'intro'));
    } else if (kinds) {
      const first = out.find((l) => kinds.includes(l.kind) && l.moment !== undefined);
      if (first) at = out.findLastIndex((l) => (l.moment === first.moment && kinds.includes(l.kind)) || (l.kind === 'extra' && l.after === x.after));
    }
    if (at >= 0) { out.splice(at + 1, 0, { ...line, after: x.after }); return; }
    out.push({ ...line, anchor: endExtras === 0 ? { at: 'outro', offset: 0.2 } : null });
    endExtras += 1;
  });
  out.push(...fixedLines());
  // Vlastníkove náhrady viet (scenár) — tá istá kotva, iný text; `skip` vetu vynechá (portál sa vynechať nedá).
  return out
    .filter((line) => !(script?.lines?.[line.id]?.skip && line.kind !== 'fixed'))
    .map((line) => (script?.lines?.[line.id] && !script.lines[line.id].skip ? { ...line, ...script.lines[line.id], edited: true } : line));
}

/** Kotva vety v čase videa podľa plánu. Pure. */
export function anchorTime(anchor, plan, moments) {
  if (!anchor) return null;
  const pieces = plan.pieces;
  const first = (phase) => pieces.find((p) => p.phase === phase) || null;
  const hold = (i) => pieces.find((p) => p.phase === 'moment' && p.moment === i) || null;
  let t = null;
  if (anchor.at === 'play') t = leadPlayPiece(plan)?.start ?? null; // kontext len pred prvým momentom, inak za predošlou vetou
  else if (anchor.at) t = first(anchor.at)?.start ?? null;
  else if (anchor.hold !== undefined) t = hold(anchor.hold)?.start ?? null;
  else if (anchor.spotlightBefore !== undefined) {
    const h = hold(anchor.spotlightBefore);
    const idx = h ? pieces.indexOf(h) : -1;
    let j = idx - 1;
    while (j >= 0 && pieces[j].phase === 'spotlight') j -= 1;
    t = idx > 0 && pieces[j + 1]?.phase === 'spotlight' ? pieces[j + 1].start : (h?.start ?? null);
  } else if (anchor.gapOf !== undefined) {
    const m = moments[anchor.gapOf];
    const g = pieces.find((p) => p.phase === 'gap' && m && Math.abs(p.from - (m.fromT ?? m.t)) <= 2);
    t = g?.start ?? hold(anchor.gapOf)?.start ?? null;
  } else if (anchor.piece) {
    const p = pieces.find((x) => x.phase === anchor.piece && (anchor.moment === undefined || x.moment === anchor.moment));
    t = p?.start ?? null;
  }
  return t === null ? null : t + (anchor.offset || 0);
}

/** Prvý prelet plánu, ak pred ním nie je žiadne okolie ani moment (inak null). Pure. */
export function leadPlayPiece(plan) {
  const i = plan.pieces.findIndex((p) => p.phase === 'play');
  return i >= 0 && plan.pieces.slice(0, i).every((p) => p.phase === 'opening' || p.phase === 'intro') ? plan.pieces[i] : null;
}

/**
 * Umiestnenie viet a tempo videa: predlžuje jednotlivé kúsky plánu (`planOpts.stretch`: index kúska →
 * sekundy navyše), kým každá veta nezačne najneskôr `tolS` (+ `anchor.late`) po svojej kotve a posledná
 * neskončí pred koncom videa. Predlžuje sa len záber, pri ktorom veta znie — spoločné voľby (holdS, playS,
 * spotlightS) by natiahli aj ostatné zábery a medzi vetami by vzniklo ticho. Vety bez kotvy nasledujú po predošlej.
 * @param {object} event
 * @param {Array} lines narrationLines(...)
 * @param {Record<string, {lead: number, speechEnd: number}>} durations ticho na začiatku a koniec reči (s) podľa id vety
 * @param {object} [opts] NARRATION_DEFAULTS + planOpts
 * @returns {{planOpts: object, durationS: number, placement: Array, maxLag: number, converged: boolean}}
 */
export function fitNarration(event, lines, durations, opts = {}) {
  const o = { ...NARRATION_DEFAULTS, ...opts };
  const planOpts = { ...o.planOpts };
  const moments = keyMoments(event);
  const place = () => {
    const plan = videoPlan(event, planOpts);
    if (!plan) return null;
    let prevEnd = 0;
    const placement = [];
    for (const line of lines) {
      const d = durations[line.id];
      if (!d) continue;
      const anchor = anchorTime(line.anchor, plan, moments);
      const earliest = prevEnd + (placement.length ? o.gapS : 0) - d.lead;
      const start = Math.max(anchor === null ? earliest : anchor - d.lead, earliest);
      const speechStart = start + d.lead;
      const speechEnd = start + d.speechEnd;
      placement.push({ id: line.id, start, speechStart, speechEnd, anchor, lag: anchor === null ? 0 : speechStart - anchor, late: line.anchor?.late || 0, offset: line.anchor?.offset || 0 });
      prevEnd = speechEnd;
    }
    return { plan, placement };
  };
  let result = place();
  if (!result) return null;
  for (let iter = 0; iter < o.maxIterations; iter += 1) {
    const { plan, placement } = result;
    const lagging = placement.find((p) => p.lag - p.late > o.tolS);
    if (lagging) {
      // Predošlé vety presahujú cez kotvu tejto — predĺžiť kúsok plánu MEDZI začiatkom predošlej
      // ukotvenej vety a kotvou (prednostne ten, v ktorom tá veta začína, inak najdlhší v medzere).
      const k = placement.indexOf(lagging);
      let j = k - 1;
      while (j > 0 && placement[j].anchor === null) j -= 1;
      const prev = j >= 0 ? placement[j] : null;
      // Od kúska, ku ktorému je predošlá veta pripnutá: veta so záporným posunom (začína pred svojím
      // zastavením) sa s kúskami pred ním posúva tiež — ich predĺženie by nepomohlo.
      const prevStart = prev ? Math.max(prev.speechStart, prev.anchor === null ? prev.speechStart : prev.anchor - prev.offset) : 0;
      const between = plan.pieces.map((p, idx) => ({ p, idx })).filter(({ p }) => p.start < lagging.anchor && p.start + p.dur > prevStart);
      // Predošlá veta s voľným oneskorením (`late`) má znieť vo svojom zábere — predĺži sa ten, aj keď veta
      // začala až za ním; inak kúsok, v ktorom predošlá veta začína, inak najdlhší v medzere.
      const anchorIdx = prev && prev.late > 0 && prev.anchor !== null ? plan.pieces.findIndex((p) => prev.anchor - prev.offset >= p.start - 1e-9 && prev.anchor - prev.offset < p.start + p.dur) : -1;
      const own = anchorIdx >= 0 && plan.pieces[anchorIdx].start < lagging.anchor ? { p: plan.pieces[anchorIdx], idx: anchorIdx } : null;
      if (!own && !between.length) break;
      const pick = own || between.find(({ p }) => prevStart >= p.start && prevStart < p.start + p.dur) || between.reduce((a, b) => (b.p.dur > a.p.dur ? b : a));
      planOpts.stretch = { ...(planOpts.stretch || {}), [pick.idx]: (planOpts.stretch?.[pick.idx] || 0) + lagging.lag - lagging.late - o.tolS / 2 + 0.05 };
      result = place();
      // Poistka: predĺženie, ktoré oneskorenie nezmenší, sa neopakuje (inak by video rástlo do stropu iterácií).
      const again = result.placement.find((p) => p.id === lagging.id);
      if (again && again.lag >= lagging.lag - 1e-6) break;
      continue;
    }
    const last = placement[placement.length - 1];
    const over = last ? last.speechEnd - (plan.durationS - o.endMarginS) : 0;
    if (over > 0) {
      const lastIdx = plan.pieces.length - 1;
      planOpts.stretch = { ...(planOpts.stretch || {}), [lastIdx]: (planOpts.stretch?.[lastIdx] || 0) + over + 0.05 };
      result = place();
      continue;
    }
    return { planOpts, durationS: plan.durationS, placement, maxLag: Math.max(0, ...placement.map((p) => p.lag - p.late)), converged: true };
  }
  const { plan, placement } = result;
  return { planOpts, durationS: plan.durationS, placement, maxLag: Math.max(0, ...placement.map((p) => p.lag - p.late)), converged: false };
}

/**
 * Porovnanie prepisu rozpoznávania reči s titulkom vety (kontrola výslovnosti bez počúvania):
 * slová po normalizácii (malé písmená, bez interpunkcie, čísla ako číslice, „21 tisíc" = 21000,
 * „5." = „piatej", stupne, „km²" = „kilometrov štvorcových" = „km štvorcových") sa musia zhodovať; vracia `{ok, missing, extra}`.
 * `names`: vlastné mená v titulku (veľké písmeno mimo začiatku vety — „Pokrovsku", „DeepState") smie
 * rozpoznávač zapísať inak („Pokrovsko", „Deep State"): stačí podobnosť (vzdialenosť úprav do tretiny dĺžky),
 * ostatné slová a čísla ostávajú prísne. Pure.
 */
export function narrationHeardMatches(caption, heard, { names = false } = {}) {
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/ /g, ' ').replace(/(\d)\s*km\s*[²2](?![\p{L}\d])/gu, '$1 kmq').replace(/kilomet\p{L}*\s+štvorcov\p{L}*/gu, 'kmq').replace(/(\d)\s*km\s+štvorcov\p{L}*/gu, '$1 kmq')
    .replace(/°c?/g, ' stupňov ').replace(/(\d)\s*km(?![\p{L}])/gu, '$1 kilometrov').replace(/(\d)[\s-]*(?:tisíc|tis\.)/g, (_, d) => `${d}000`)
    .replace(/(\d)\s+(?=\d{3}\b)/g, '$1').replace(/\b(\d{1,2})\.\s*(?=hodin)/g, (_, h) => `${ORDINAL_F[Number(h)] || h} `)
    .replace(/[.,;:!?„“"'()–—-]/g, ' ').replace(/\s+/g, ' ').trim();
  // Prvé písmeno slova bez dĺžňa (rozpoznávač píše „Udaje"); koncovky ostávajú prísne (katastrofé ≠ katastrofe).
  const words = (s) => norm(s).split(' ').filter(Boolean).map((w) => NUM_WORDS[w] || w).map((w) => w[0].normalize('NFD').replace(/[̀-ͯ]/g, '') + w.slice(1));
  const a = words(caption);
  const b = words(heard).map((w) => HEARD_ALIASES[w] || w);
  const bag = new Map();
  for (const w of b) bag.set(w, (bag.get(w) || 0) + 1);
  let missing = [];
  for (const w of a) {
    if (bag.get(w)) bag.set(w, bag.get(w) - 1); else missing.push(w);
  }
  let extra = [...bag.entries()].flatMap(([w, n]) => Array.from({ length: Math.max(0, n) }, () => w));
  if (names && missing.length && extra.length) {
    // Vlastné mená titulku: veľké začiatočné písmeno a nie prvé slovo vety.
    const tokens = String(caption || '').split(/\s+/).filter(Boolean);
    const nameSet = new Set();
    tokens.forEach((tok, k) => {
      const clean = tok.replace(/^[„“"'(]+/, '');
      const starts = k === 0 || /[.!?:]$/.test(tokens[k - 1]);
      if (!starts && /^\p{Lu}/u.test(clean)) for (const w of words(clean)) nameSet.add(w);
    });
    const plain = (w) => w.normalize('NFD').replace(/\p{M}/gu, '');
    const dist = (x, y) => {
      const row = Array.from({ length: y.length + 1 }, (_, k) => k);
      for (let p = 1; p <= x.length; p += 1) {
        let prev = row[0]; row[0] = p;
        for (let q = 1; q <= y.length; q += 1) { const tmp = row[q]; row[q] = Math.min(row[q] + 1, row[q - 1] + 1, prev + (x[p - 1] === y[q - 1] ? 0 : 1)); prev = tmp; }
      }
      return row[y.length];
    };
    const left = [];
    for (const m of missing) {
      if (!nameSet.has(m)) { left.push(m); continue; }
      const target = plain(m);
      const limit = Math.max(2, Math.floor(target.length / 3));
      // Jedno počuté slovo, alebo dve spojené („Deep" + „State").
      let hit = extra.findIndex((e) => dist(target, plain(e)) <= limit);
      if (hit >= 0) { extra.splice(hit, 1); continue; }
      let pair = null;
      for (let p = 0; p < extra.length && !pair; p += 1) for (let q = 0; q < extra.length && !pair; q += 1) if (p !== q && dist(target, plain(extra[p] + extra[q])) <= limit) pair = [p, q];
      if (pair) { extra = extra.filter((_, k) => !pair.includes(k)); continue; }
      left.push(m);
    }
    missing = left;
  }
  extra = [...new Set(extra)];
  // Rozpoznávač niekedy spojí alebo rozdelí slová („Obrat o" → „Obrato", „FZ1073" → „FZ 1073") —
  // bez medzier sa text musí zhodovať úplne; iné písmeno (katastrofé) neprejde.
  const spaceless = a.join('') === b.join('');
  return { ok: (missing.length === 0 && extra.length === 0) || spaceless, missing, extra };
}
const ORDINAL_F = ['', 'prvej', 'druhej', 'tretej', 'štvrtej', 'piatej', 'šiestej', 'siedmej', 'ôsmej', 'deviatej', 'desiatej', 'jedenástej', 'dvanástej', 'trinástej', 'štrnástej', 'pätnástej', 'šestnástej', 'sedemnástej', 'osemnástej', 'devätnástej', 'dvadsiatej', 'dvadsiatej prvej', 'dvadsiatej druhej', 'dvadsiatej tretej'];
/** Malé číslovky slovom aj číslicou sú to isté („dvoch hodín" = „2 hodín", „päť minút" = „5 minút"). */
const NUM_WORDS = { jeden: '1', jedna: '1', jedno: '1', jednu: '1', jednej: '1', dva: '2', dve: '2', dvoch: '2', tri: '3', troch: '3', štyri: '4', štyroch: '4', päť: '5', piatich: '5', šesť: '6', šiestich: '6', sedem: '7', siedmich: '7', osem: '8', ôsmich: '8', deväť: '9', deviatich: '9', desať: '10', desiatich: '10' };
/** Rozpoznávač známo píše inak (nie chyba výslovnosti): „Let" pred samohláskou ako „LED". */
const HEARD_ALIASES = { led: 'let' };

export { spokenNumber };
