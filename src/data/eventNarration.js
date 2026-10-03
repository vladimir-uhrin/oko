// src/data/eventNarration.js — komentár videa udalosti z dát (2026-10-03, vlastník: „ako by si to celé
// automatizoval… sprav"; „čísla zle vyslovuje a anglické názvy tiež" → výslovnosť; „prvé 3–4 sekundy
// musia diváka chytiť" → háčik na začiatku; „vždy spomínaj môj portál"). Čisté:
//   vety      z kľúčových momentov udalosti (eventPost.keyMoments) + háčik a doplnky zo scenára vlastníka
//             (eventVideoScript.js) + pevné vety na záver (portál, podpis — nahraté raz, schválené uchom),
//   dve podoby každej vety: `spoken` (čo číta hlas: čísla slovami, cudzie názvy foneticky — eventSpeech)
//             a `caption` (titulok: číslice, správny pravopis),
//   kotva     kedy má veta zaznieť (fáza/moment plánu videa),
//   tempo     fitNarration: voľby videoPlan sa predlžujú, kým každá veta nezačne pri svojom zábere
//             (najviac `tolS` za kotvou) a posledná skončí pred koncom videa.
// Pure; hlas, nahrávanie a zvuk rieši scripts/lib/eventVideoPipeline.mjs.

import { keyMoments } from './eventPost.js';
import { videoPlan } from './eventVideo.js';
import { VIDEO_BRAND } from './eventVideoHud.js';
import { landingPhrase } from './eventReported.js';
import { spokenNumber, spokenMinutes, spokenDegrees, spokenFeet, spokenFlightNumber, spokenDomain, spokenHour } from './eventSpeech.js';

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

/** Pevné vety na záver (portál, podpis) — nahraté raz, schválené vlastníkom (bez kontroly výslovnosti). */
export function fixedLines() {
  return [
    { id: 'portal', kind: 'fixed', spoken: `Celú rekonštrukciu nájdete na ${spokenDomain(VIDEO_BRAND.domain)}.`, caption: `Celú rekonštrukciu nájdete na ${VIDEO_BRAND.domain}.`, anchor: { at: 'endcard', offset: 0.4 }, approved: true },
    { id: 'signoff', kind: 'fixed', spoken: `Video pripravil ${VIDEO_BRAND.authorName}.`, caption: `Video pripravil ${VIDEO_BRAND.authorName}.`, anchor: null, approved: true },
  ];
}

/** Veta k momentu z dát: `{spoken, caption}` alebo null (štart, cestovná výška, pristátie bez letiska…). Pure. */
export function momentSentence(m, { nextSquawks = [] } = {}) {
  switch (m.kind) {
    case 'dive': {
      const fpm = Math.abs(m.fpm || 0);
      const floor = Math.floor(fpm / 1000) * 1000;
      const more = fpm > floor && floor > 0;
      const when = spokenHour(m.t);
      return {
        spoken: `${cap(when.spoken)} svetového času prudko klesá, ${more ? 'vyše ' : ''}${spokenFeet(floor || fpm)} za minútu.`,
        caption: `${cap(when.caption)} svetového času prudko klesá, ${more ? 'vyše ' : ''}${groupDigits(floor || fpm)}${NBSP}stôp za minútu.`,
      };
    }
    case 'gap': {
      const min = Math.max(1, Math.round((m.s ?? ((m.toT ?? m.t) - (m.fromT ?? m.t))) / 60));
      return { spoken: `Potom ${spokenMinutes(min)} bez údajov.`, caption: `Potom ${min} ${min === 1 ? 'minúta' : (min <= 4 ? 'minúty' : 'minút')} bez údajov.` };
    }
    case 'squawk': {
      const codes = [m, ...nextSquawks].map((s) => SQUAWK_SK[s.meaning] || 'núdzový kód');
      if (codes.length === 1) return { spoken: `Transpondér hlási ${codes[0]}.`, caption: `Transpondér hlási ${codes[0]}.` };
      const text = `${cap(codes[0])}, potom ${codes.slice(1).join(', potom ')}.`;
      return { spoken: text, caption: text };
    }
    case 'uturn': {
      const deg = Math.round(Math.abs(m.turnDeg || 0));
      return { spoken: `Obrat o ${spokenDegrees(deg)}.`, caption: `Obrat o ${deg} ${deg === 1 ? 'stupeň' : (deg <= 4 ? 'stupne' : 'stupňov')}.` };
    }
    case 'last-contact': {
      if (!m.airborne) return { spoken: 'Posledný záznam je na zemi.', caption: 'Posledný záznam je na zemi.' };
      const ft = roundFeet((m.alt ?? 0) / 0.3048);
      return { spoken: `Údaje končia vo výške ${spokenFeet(ft)}.`, caption: `Údaje končia vo výške ${groupDigits(ft)}${NBSP}stôp.` };
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
  const during = dur <= 75 ? 'za minútu' : `za ${spokenMinutes(Math.round(dur / 60))}`;
  const duringCap = dur <= 75 ? 'za minútu' : `za ${Math.round(dur / 60)} ${Math.round(dur / 60) <= 4 ? 'minúty' : 'minút'}`;
  const ft = roundFeet(f.toFt);
  const under = f.toBelow ? 'pod ' : 'na ';
  return { spoken: `Podľa správ kleslo ${during} ${under}${spokenFeet(ft)}.`, caption: `Podľa správ kleslo ${duringCap} ${under}${groupDigits(ft)}${NBSP}stôp.` };
}

/**
 * Vety komentára v poradí: háčik (scenár) → momenty z dát → doplnky zo správ (scenár) → portál, podpis.
 * Riadok scenára `lines[id]` (`{spoken, caption}`) nahradí vygenerovanú vetu (napr. skloňované mesto).
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
      uturn: { hold: i, offset: -1.0 },
      'last-contact': { hold: i, offset: -2.0 },
      landing: { hold: i, offset: -1.0 },
      'reported-landing': { piece: 'reported', moment: i },
    }[m.kind] || { hold: i };
    out.push({ id: `m${i}`, kind: m.kind, ...sentence, anchor, moment: i });
    if (m.kind === 'gap') {
      (m.reportedNotes || []).forEach((f, k) => out.push({ id: `m${i}n${k}`, kind: 'descent', ...descentSentence(f), anchor: { gapOf: i }, moment: i, source: { domains: f.domains } }));
    }
  }
  (script?.extras || []).forEach((x, i) => out.push({ id: `extra${i + 1}`, kind: 'extra', spoken: x.spoken, caption: x.caption, anchor: i === 0 ? { at: 'outro', offset: 0.2 } : null, source: x.source }));
  out.push(...fixedLines());
  // Vlastníkove náhrady viet (scenár) — tá istá kotva, iný text.
  return out.map((line) => (script?.lines?.[line.id] ? { ...line, ...script.lines[line.id], edited: true } : line));
}

/** Kotva vety v čase videa podľa plánu. Pure. */
export function anchorTime(anchor, plan, moments) {
  if (!anchor) return null;
  const pieces = plan.pieces;
  const first = (phase) => pieces.find((p) => p.phase === phase) || null;
  const hold = (i) => pieces.find((p) => p.phase === 'moment' && p.moment === i) || null;
  let t = null;
  if (anchor.at) t = first(anchor.at)?.start ?? null;
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

/** Fáza plánu v čase videa → voľba videoPlan, ktorá ju predlžuje. Pure. */
export function knobForPhase(phase, piece) {
  if (phase === 'gap') return piece?.dur >= 1.5 ? 'gapDropS' : 'gapS';
  return { opening: 'openingS', intro: 'introS', play: 'playS', spotlight: 'spotlightS', moment: 'holdS', reported: 'reportedS', outro: 'outroS', endcard: 'endCardS' }[phase] || null;
}

/**
 * Umiestnenie viet a tempo videa: predlžuje voľby plánu, kým každá veta nezačne najneskôr `tolS` po
 * svojej kotve a posledná neskončí pred koncom videa. Vety bez kotvy nasledujú po predošlej.
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
      placement.push({ id: line.id, start, speechStart, speechEnd, anchor, lag: anchor === null ? 0 : speechStart - anchor });
      prevEnd = speechEnd;
    }
    return { plan, placement };
  };
  let result = place();
  if (!result) return null;
  for (let iter = 0; iter < o.maxIterations; iter += 1) {
    const { plan, placement } = result;
    const lagging = placement.find((p) => p.lag > o.tolS);
    if (lagging) {
      // Predošlé vety presahujú cez kotvu tejto — predĺžiť kúsok plánu MEDZI začiatkom predošlej
      // ukotvenej vety a kotvou (prednostne ten, v ktorom tá veta začína, inak najdlhší v medzere).
      const k = placement.indexOf(lagging);
      let j = k - 1;
      while (j > 0 && placement[j].anchor === null) j -= 1;
      const prevStart = j >= 0 ? placement[j].speechStart : 0;
      const between = plan.pieces.filter((p) => p.start < lagging.anchor && p.start + p.dur > prevStart && knobForPhase(p.phase, p));
      if (!between.length) break;
      const piece = between.find((p) => prevStart >= p.start && prevStart < p.start + p.dur) || between.reduce((a, b) => (b.dur > a.dur ? b : a));
      const knob = knobForPhase(piece.phase, piece);
      planOpts[knob] = (planOpts[knob] ?? defaultKnob(knob)) + lagging.lag - o.tolS / 2 + 0.05;
      result = place();
      continue;
    }
    const last = placement[placement.length - 1];
    const over = last ? last.speechEnd - (plan.durationS - o.endMarginS) : 0;
    if (over > 0) {
      planOpts.endCardS = (planOpts.endCardS ?? defaultKnob('endCardS')) + over + 0.05;
      result = place();
      continue;
    }
    return { planOpts, durationS: plan.durationS, placement, maxLag: Math.max(0, ...placement.map((p) => p.lag)), converged: true };
  }
  const { plan, placement } = result;
  return { planOpts, durationS: plan.durationS, placement, maxLag: Math.max(0, ...placement.map((p) => p.lag)), converged: false };
}

/** Predvolená hodnota voľby plánu (eventVideo.VIDEO_DEFAULTS), keď ju solver ešte nemenil. */
function defaultKnob(knob) {
  return { openingS: 2.6, introS: 1, playS: 7, holdS: 1, gapS: 0.6, gapDropS: 2, spotlightS: 3, reportedS: 3, outroS: 3.5, endCardS: 3 }[knob] ?? 1;
}

/**
 * Porovnanie prepisu rozpoznávania reči s titulkom vety (kontrola výslovnosti bez počúvania):
 * slová po normalizácii (malé písmená, bez interpunkcie, čísla ako číslice, „21 tisíc" = 21000,
 * „5." = „piatej", stupne) sa musia zhodovať; vracia `{ok, missing, extra}`. Pure.
 */
export function narrationHeardMatches(caption, heard) {
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/ /g, ' ').replace(/°c?/g, ' stupňov ').replace(/(\d)[\s-]*(?:tisíc|tis\.)/g, (_, d) => `${d}000`)
    .replace(/(\d)\s+(?=\d{3}\b)/g, '$1').replace(/\b(\d{1,2})\.\s*(?=hodin)/g, (_, h) => `${ORDINAL_F[Number(h)] || h} `)
    .replace(/[.,;:!?„“"'()–—-]/g, ' ').replace(/\s+/g, ' ').trim();
  // Prvé písmeno slova bez dĺžňa (rozpoznávač píše „Udaje"); koncovky ostávajú prísne (katastrofé ≠ katastrofe).
  const words = (s) => norm(s).split(' ').filter(Boolean).map((w) => w[0].normalize('NFD').replace(/[̀-ͯ]/g, '') + w.slice(1));
  const a = words(caption);
  const b = words(heard).map((w) => HEARD_ALIASES[w] || w);
  const bag = new Map();
  for (const w of b) bag.set(w, (bag.get(w) || 0) + 1);
  const missing = [];
  for (const w of a) {
    if (bag.get(w)) bag.set(w, bag.get(w) - 1); else missing.push(w);
  }
  const extra = [...bag.entries()].filter(([, n]) => n > 0).map(([w]) => w);
  // Rozpoznávač niekedy spojí alebo rozdelí slová („Obrat o" → „Obrato", „FZ1073" → „FZ 1073") —
  // bez medzier sa text musí zhodovať úplne; iné písmeno (katastrofé) neprejde.
  const spaceless = a.join('') === b.join('');
  return { ok: (missing.length === 0 && extra.length === 0) || spaceless, missing, extra };
}
const ORDINAL_F = ['', 'prvej', 'druhej', 'tretej', 'štvrtej', 'piatej', 'šiestej', 'siedmej', 'ôsmej', 'deviatej', 'desiatej', 'jedenástej', 'dvanástej', 'trinástej', 'štrnástej', 'pätnástej', 'šestnástej', 'sedemnástej', 'osemnástej', 'devätnástej', 'dvadsiatej', 'dvadsiatej prvej', 'dvadsiatej druhej', 'dvadsiatej tretej'];
/** Rozpoznávač známo píše inak (nie chyba výslovnosti): „Let" pred samohláskou ako „LED". */
const HEARD_ALIASES = { led: 'let' };

export { spokenNumber };
