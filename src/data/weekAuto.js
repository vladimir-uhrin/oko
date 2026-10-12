// Automatický vstup súhrnu „Týždeň v OKU" (2026-10-12, vlastník: „sprav automatiku súhrnu týždňa každú nedeľu
// ráno o 5-tej"). Z denných úloh videa „Deň na fronte" (obete ruských útokov už overené ≥ 2 médiami, zábery
// ArmyInform), zo zmeny frontu za 7 dní, z príspevkov ДСНС k mestám útokov a z najsilnejšieho zemetrasenia
// týždňa zloží vstup pre weekScenarios (src/data/weekVideo.js) — rovnaký tvar ako ručný vstup.json. Návrh ide do
// Štúdia na schválenie (fotky ДСНС sa automaticky nedajú overiť na drastickosť → kontroluje vlastník). Pure.
import { spokenNumber } from './eventSpeech.js';

/** Útok do súhrnu: od tohto počtu obetí (číslo od dvoch médií). */
export const WEEK_STRIKE_MIN_KILLED = 5;
/** Najviac útokov v súhrne (Ukrajina hlavne, no video ~90 s). */
export const WEEK_STRIKES_MAX = 3;
/** Háčik o obetiach, keď ich je spolu aspoň toľko. */
export const WEEK_HOOK_MIN_KILLED = 10;

const NBSP = ' ';
const MONTHS_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna', 'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];
const ORD_GEN = ['', 'prvého', 'druhého', 'tretieho', 'štvrtého', 'piateho', 'šiesteho', 'siedmeho', 'ôsmeho', 'deviateho', 'desiateho', 'jedenásteho', 'dvanásteho',
  'trinásteho', 'štrnásteho', 'pätnásteho', 'šestnásteho', 'sedemnásteho', 'osemnásteho', 'devätnásteho', 'dvadsiateho', 'dvadsiateho prvého', 'dvadsiateho druhého',
  'dvadsiateho tretieho', 'dvadsiateho štvrtého', 'dvadsiateho piateho', 'dvadsiateho šiesteho', 'dvadsiateho siedmeho', 'dvadsiateho ôsmeho', 'dvadsiateho deviateho',
  'tridsiateho', 'tridsiateho prvého'];
const dayOf = (day) => new Date(`${day}T12:00:00Z`);
/** „8. októbra" / „Ôsmeho októbra" (hlas). Pure. */
export function dateWords(day) {
  const d = dayOf(day); const n = d.getUTCDate(); const m = MONTHS_GEN[d.getUTCMonth()];
  return { caption: `${n}. ${m}`, spoken: `${ORD_GEN[n]} ${m}` };
}
const shift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const died = (n, k) => (n === 1 ? `zahynul najmenej ${k === 'spoken' ? 'jeden človek' : '1 človek'}`
  : n <= 4 ? `zahynuli najmenej ${k === 'spoken' ? { 2: 'dvaja', 3: 'traja', 4: 'štyria' }[n] : n} ľudia`
    : `zahynulo najmenej ${k === 'spoken' ? spokenNumber(n) : n} ľudí`);

/**
 * Útoky týždňa z denných úloh: miesto s obeťami v po sebe idúcich dňoch = jeden útok (číslo rastie, kým
 * záchranári pracujú) → najvyššie číslo, deň = prvý deň výskytu (správy z rána o noci/večere predtým). Pure.
 * @param {Array<{day: string, model: object}>} days denné úlohy (uloha.json) v týždni
 */
export function weekStrikes(days, { minKilled = WEEK_STRIKE_MIN_KILLED, max = WEEK_STRIKES_MAX } = {}) {
  const runs = new Map(); // mesto → [{ first, last, best }]
  for (const { day, model } of [...(days || [])].sort((a, b) => a.day.localeCompare(b.day))) {
    for (const p of model?.casualties?.places || []) {
      if (!p?.en || !(p.killed > 0) || !Number.isFinite(p.lat)) continue;
      const list = runs.get(p.en) || []; const last = list.at(-1);
      if (last && last.last === shift(day, -1)) {
        last.last = day;
        if (p.killed > last.best.killed) last.best = { ...p, day: last.first };
      } else list.push({ first: day, last: day, best: { ...p, day } });
      runs.set(p.en, list);
    }
  }
  return [...runs.values()].flat().map((r) => ({ ...r.best, day: r.first }))
    .filter((s) => s.killed >= minKilled).sort((a, b) => b.killed - a.killed).slice(0, max)
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Príspevok ДСНС k útoku: z mesta (do 30 km), od dňa útoku do 2 dní po ňom, s aspoň 2 fotkami. Prednosť má ten,
 * ktorý uvádza počet obetí blízky číslu zo správ (2026-10-12: najnovší príspevok z Kramatorska bol o inom útoku
 * s jednou obeťou), potom viac fotiek, potom skorší. Pure.
 * @param {Array<{url, text, photos, publishedAt}>} media archív `/api/ukraine/events`
 * @param {{day: string, killed: number, lat: number, lon: number}} strike
 * @param {(text: string) => {lat: number, lon: number}|null} locate locateUkText
 */
export function strikePost(media, strike, locate) {
  const from = Date.parse(`${strike.day}T00:00:00Z`) - 6 * 3600_000; const to = from + 3 * 86_400_000;
  const near = (a) => { const dy = (a.lat - strike.lat) * 111.32; const dx = (a.lon - strike.lon) * 111.32 * Math.cos((strike.lat * Math.PI) / 180); return Math.hypot(dx, dy) <= 30; };
  const fits = (text) => [...String(text || '').matchAll(/(\d{1,4})\s*(?:людей|люди|людини|осіб|особи)?[^.\d]{0,45}?(?:загинул|загибл)/gi)]
    .some((m) => { const n = Number(m[1]); return n >= strike.killed * 0.5 && n <= strike.killed * 1.4; });
  const cands = (media || []).filter((m) => /^https:\/\/t\.me\/dsns_telegram\/\d+$/.test(m?.url || '') && (m.photos?.length || 0) >= 2
    && m.publishedAt >= from && m.publishedAt <= to && /загин|поранен|постраждал|удар|атак|обстріл/i.test(m.text || ''))
    .map((m) => ({ m, loc: locate(m.text) })).filter((c) => c.loc && near(c.loc))
    .sort((a, b) => Number(fits(b.m.text)) - Number(fits(a.m.text)) || b.m.photos.length - a.m.photos.length || a.m.publishedAt - b.m.publishedAt);
  const best = cands[0]?.m;
  return best ? { post: Number(best.url.split('/').pop()), photos: best.photos.length } : null;
}

/** Zábery ArmyInform z týždňa: rôzne videá, rôzne popisy, najviac `max`. Pure. */
export function weekClips(days, { max = 2 } = {}) {
  const seen = new Set(); const captions = new Set(); const out = [];
  for (const { model } of [...(days || [])].sort((a, b) => b.day.localeCompare(a.day))) {
    for (const c of model?.clips || []) {
      if (!c?.videoUrl || c.aftermath || seen.has(c.videoUrl) || captions.has(c.captionSk)) continue;
      seen.add(c.videoUrl); captions.add(c.captionSk);
      out.push({ url: c.videoUrl, caption: c.captionSk, page: c.url || null });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Vstup pre weekScenarios. `strikes` z weekStrikes doplnené o `dsns` ({ post, picks[] }) z výberu príspevkov,
 * `quake` (voliteľne) = { line, spot, camera, pins, overlay, postText }.
 */
export function autoWeekInput({ week, strikes = [], clips = [], quake = null, musicId = null }) {
  const sum = strikes.reduce((s, x) => s + x.killed, 0);
  const cities = strikes.map((s) => s.sk);
  const listSk = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} a ${xs.at(-1)}`);
  const mk = (s, i) => {
    const d = dateWords(s.day);
    const when = (k) => (k === 'spoken' ? d.spoken[0].toUpperCase() + d.spoken.slice(1) : d.caption);
    const map = (k) => `${when(k)} zaútočil ruský agresor na mesto ${s.sk}.`;
    const photo = (k) => `${died(s.killed, k)[0].toUpperCase()}${died(s.killed, k).slice(1)}`
      + `${s.children ? `, z toho ${s.children} ${plural(s.children, 'dieťa', 'deti', 'detí')}` : ''}. Na mieste zasahovali záchranári.`;
    return {
      id: `s${i}`, name: s.sk, lat: s.lat, lon: s.lon, day: s.day, killed: s.killed, children: s.children || null,
      what: `ruský útok · ${d.caption}`,
      mapLine: { spoken: map('spoken'), caption: map('caption') },
      photoLine: { spoken: photo('spoken'), caption: photo('caption') },
      dsns: s.dsns ? [s.dsns] : [], credit: 'Foto: ДСНС України · Telegram',
      sources: [...new Set((s.sources || []).map((x) => x.name))].slice(0, 4),
      postText: `${died(s.killed, 'caption')}${s.children ? `, z toho ${s.children} ${plural(s.children, 'dieťa', 'deti', 'detí')}` : ''} pri ruskom útoku.`,
      postUrl: s.dsns?.post ? `https://t.me/dsns_telegram/${s.dsns.post}` : null,
    };
  };
  const st = strikes.map(mk);
  const hookKilled = sum >= WEEK_HOOK_MIN_KILLED;
  const hook = hookKilled
    ? { spoken: `Najmenej ${spokenNumber(sum)} mŕtvych civilistov za jediný týždeň. ${cities.length > 1 ? `Ruské útoky zasiahli ${listSk(cities)}.` : `Ruský útok zasiahol mesto ${cities[0]}.`}`,
      caption: `Najmenej ${sum} mŕtvych civilistov za jediný týždeň. ${cities.length > 1 ? `Ruské útoky zasiahli ${listSk(cities)}.` : `Ruský útok zasiahol mesto ${cities[0]}.`}`,
      card: { tag: `TÝŽDEŇ V OKU · ${dayOf(week.from).getUTCDate()}. – ${dayOf(week.to).getUTCDate()}. ${dayOf(week.to).getUTCMonth() + 1}.`,
        lines: [`${sum} MŔTVYCH CIVILISTOV`, 'ZA JEDINÝ TÝŽDEŇ'], accent: String(sum), sub: `${listSk(cities)} · podľa médií` } }
    : { spoken: 'Týždeň na fronte a vo svete.', caption: 'Týždeň na fronte a vo svete.',
      card: { tag: 'TÝŽDEŇ V OKU', lines: ['TÝŽDEŇ V OKU'], accent: '', sub: `${dayOf(week.from).getUTCDate()}. – ${dayOf(week.to).getUTCDate()}. ${dayOf(week.to).getUTCMonth() + 1}.` } };
  const top = st.find((s) => s.dsns.length);
  const hookPhoto = hookKilled && top ? { post: top.dsns[0].post, pick: top.dsns[0].pick[0], credit: 'Foto: ДСНС України · Telegram' } : null;
  const sourcesNews = [...new Set(st.flatMap((s) => s.sources))].slice(0, 4);
  return {
    week, musicId, auto: true, hook, hookPhoto, strikes: st,
    armyinform: clips.map((c) => ({ url: c.url, caption: c.caption })),
    world: quake ? [quake] : [],
    sources: [sourcesNews.length ? `Obete: ${sourcesNews.join(', ')}` : null, 'Foto: ДСНС України · Zábery: ArmyInform (CC BY 4.0)',
      'Mapa frontu: okolive.sk · strety: Generálny štáb Ukrajiny', quake ? 'Zemetrasenie: USGS (verejná doména)' : null, quake ? 'Mapa sveta: NASA GIBS · ASTER GDEM (METI/NASA)' : null].filter(Boolean),
    credits: [...st.filter((s) => s.postUrl).map((s) => `Foto ${s.name}: ДСНС України (Telegram): ${s.postUrl}`),
      ...(clips.length ? [`Zábery: ArmyInform, Ministerstvo obrany Ukrajiny (CC BY 4.0): ${clips.map((c) => c.page).filter(Boolean).join(', ')}`] : [])],
  };
}
