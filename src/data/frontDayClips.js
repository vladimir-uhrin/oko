// src/data/frontDayClips.js — výber akčných záberov do denného videa „Deň na fronte" (2026-10-05).
// Vlastník: „zábery potrebujem nejaké akčné" + „pravidlo o ľuďoch zruš". Zdroj = videá ArmyInform (agentúra
// Ministerstva obrany Ukrajiny, CC BY 4.0 s odkazom) — jediné oficiálne videá, ktoré sa dajú stiahnuť (Telegram
// dáva len vložený prehrávač, YouTube sa nepreberá). Z ukrajinského nadpisu sa určí: či je to akcia (zásah,
// zničenie, zostrelenie, odrazený útok — nie rozhovor, príbeh, návšteva), čo bolo cieľom, smer frontu
// a či môže byť drastický (FB by ho skryl za varovanie → nižšia priorita, rozhoduje vlastník pri schválení).
// Popis po slovensky z pevného slovníka — žiadny strojový preklad, nič sa nedomýšľa. Pure.

/**
 * Slovo od začiatku: JS `\b` pozná len latinku, v azbuke by „збит" našlo aj „розбита" (rozbitá pechota ≠ zostrelenie).
 * @param {string} alternatives regex alternatívy kmeňov
 */
const word = (alternatives) => new RegExp(`(?<![а-яіїєґʼ'’])(?:${alternatives})`, 'i');

/** Akcia → sloveso (3. os. mn. č., „ukrajinské sily …"). Poradie = priorita. */
const ACTIONS = [
  [word('збил|збив|збит|збиття|розстріля|перехопил|перехоплю|перехопи'), 'zostrelili'],
  [word('знищил|знищив|знищен|знищує|знищують|знищу|спалил|спален|відцвіл'), 'zničili'],
  [word('уразил|уразив|уражен|уражає|уражають|уражень|удар(?:и|ів|ом)? по|під .{0,20}удар|завдал[иа]? .{0,30}удар'), 'zasiahli'],
  [word('відби(?:л|ли|ття)|зірвал'), 'odrazili'],
  [word('поверну(?:ла|ли) під контроль|звільнил'), 'oslobodili'],
];

/** Cieľ → slovenský tvar (akuzatív po slovese). Poradie = od konkrétneho k všeobecnému. */
const TARGETS = [
  [/танк/i, 'ruský tank'],
  [/САУ|Гвоздик|Акаці|Піон|Мста|гаубиц/i, 'ruskú samohybnú húfnicu'],
  [/ЗРК|Бук|«Тор»|\bТор\b|Панцир|С-300|С-400|ППО окупант/i, 'ruské protilietadlové systémy'],
  [/РЛС|радар/i, 'ruský radar'],
  [/РСЗВ|Град|Ураган|Торнадо/i, 'ruský raketomet'],
  [/гармат|артилер/i, 'ruské delostrelectvo'],
  [/БМП|БТР|МТ-ЛБ|бронетехн|бронемашин/i, 'ruské obrnené vozidlá'],
  [/машин|автомобіл|вантажівк/i, 'ruské vozidlo'],
  [/НПЗ|нафтопереробн/i, 'ruskú rafinériu'],
  [/аеродром/i, 'ruské letisko'],
  [/Іскандер/i, 'ruské komplety Iskander'],
  [/Шахед|Гербер|Герань|Ланцет|FPV|ударн[а-яіїє]* дрон|російськ[а-яіїє]* дрон|БпЛА|БПЛА/i, 'ruský dron'],
  [/радіостанц|вузол зв.?язку|станці[юя] зв.?язку/i, 'ruskú spojovaciu techniku'],
  [/Терек|Каст[аи]/i, 'ruské vojenské systémy'],
  [/склад|\bБК\b|боєприпас/i, 'ruský sklad munície'],
  [/катер|корабл/i, 'ruské plavidlo'],
  [/техні/i, 'ruskú techniku'],
  // Len podstatné meno („відбили штурм"), nie „штурмової/штурмовики" — názov brigády (2026-10-07: „бійці Третьої
  // штурмової уразили машину" → „zničili ruský útok").
  [/штурм(?!ов)/i, 'ruský útok'],
  [/піхот|окупант|росіян|ворог/i, 'ruských vojakov'],
  [/територ|км²/i, 'územie'],
];

/** Rozhovory, príbehy, návštevy, spomienky — nie akčný záber, aj keď nadpis spomína útok. */
const NOT_ACTION = /історі[яї]|розпов|інтерв|боєць|офіцер|штурмовик «|заступник|оператор|командир|меморіал|гуманітар|відвідав|прощ|похов|нагород|«[^»]{0,90}»:\s*(?:як|що|чому)\b/i;
/** Možno drastický záber — FB skryje za varovanie a neodporučí. Nevylučuje sa, len nižšia priorita a označenie. */
const SENSITIVE = /загиб|вбит|тіл[ао]|трупи|поранен|полон|обмінн|ліквідув|одним ударом|двохсот|«200»/i;

/** Smery OKO podľa ukrajinských kmeňov v nadpise („на Гуляйпільському напрямку", „під Покровськом"). */
const DIRECTION_STEMS = [
  [/Покровськ/i, 'pokrovsk'], [/Гуляйпіл/i, 'huliaipole'], [/Костянтинівк|Костянтинівськ/i, 'kostiantynivka'],
  [/Лиман/i, 'lyman'], [/Куп.?янськ/i, 'kupiansk'], [/Вовчанськ/i, 'vovchansk'], [/Сумськ|Сумщин/i, 'sumy'],
  [/Оріхів/i, 'orikhiv'], [/Херсон/i, 'kherson'], [/Слов.?янськ|Краматорськ/i, 'sloviansk-kramatorsk'],
  [/Олександрівськ/i, 'oleksandrivka'],
];

const first = (rules, text) => rules.find(([re]) => re.test(text))?.[1] ?? null;

/** Akcia nadpisu: sloveso a kde v nadpise stojí. */
function actionOf(text) {
  for (const [re, verb] of ACTIONS) { const m = re.exec(text); if (m) return { verb, at: m.index }; }
  return null;
}
/**
 * Cieľ = predmet, ktorý stojí najbližšie ZA slovesom („знищив два «Ланцети» … з РЛС" → drony, nie radar);
 * keď za slovesom nič nie je („Танк, гармата …: показав серію уражень"), prvý predmet v nadpise.
 */
function targetOf(text, verbAt) {
  let after = null; let earliest = null;
  for (const [re, target] of TARGETS) {
    const all = [...text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))].map(m => m.index);
    if (!all.length) continue;
    const next = all.find(i => i >= verbAt);
    if (next !== undefined && (!after || next < after.at)) after = { target, at: next };
    if (!earliest || all[0] < earliest.at) earliest = { target, at: all[0] };
  }
  return (after || earliest)?.target ?? null;
}

/**
 * Rozbor jedného videa archívu (ArmyInform): null, ak to nie je stiahnuteľné akčné video.
 * @returns {{id, url, videoUrl, title, publishedAt, verb, target, direction, sensitive, captionSk}|null}
 */
export function classifyClip(item) {
  if (item?.provider !== 'file' || !String(item.id || '').startsWith('ai:') || !/^https:\/\//.test(item.videoUrl || '')) return null;
  const title = String(item.title || '').replace(/\s+/g, ' ').trim();
  if (!title || NOT_ACTION.test(title)) return null;
  const action = actionOf(title);
  const verb = action?.verb ?? null;
  const target = action ? targetOf(title, action.at) : null;
  if (!verb || !target) return null;
  if (verb === 'oslobodili' && target !== 'územie') return null;
  const direction = first(DIRECTION_STEMS, title);
  return {
    id: item.id, url: item.url, videoUrl: item.videoUrl, title, publishedAt: item.publishedAt,
    // Zásah ľudí (vlastník 2026-10-05 povolil) býva drastický → citlivé, nižšia priorita; rozhodne vlastník.
    verb, target, direction, sensitive: SENSITIVE.test(title) || target === 'ruských vojakov',
    captionSk: clipCaptionSk({ verb, target }),
  };
}

/** „Ukrajinské sily zničili ruskú samohybnú húfnicu" — vecne, len z nadpisu zdroja. Pure. */
export function clipCaptionSk({ verb, target }) {
  if (verb === 'oslobodili') return 'Ukrajinské sily oslobodili ďalšie územie';
  return `Ukrajinské sily ${verb} ${target}`;
}

/**
 * Najlepšie akčné zábery pre deň: čerstvé (do `maxAgeH`), smer príbehu dňa navrchu, drastické nižšie,
 * každý cieľ najviac raz (aby dva zábery neboli dva tanky). Pure.
 * @param {object[]} media položky archívu médií (/api/ukraine/events → media)
 * @param {{now:number, max?:number, maxAgeH?:number, focusDirections?:string[]}} opts
 */
export function pickActionClips(media, { now, max = 2, maxAgeH = 30, focusDirections = [] } = {}) {
  const fresh = (media || []).filter(m => Number.isFinite(m?.publishedAt) && m.publishedAt <= now + 60_000 && now - m.publishedAt <= maxAgeH * 3600_000);
  const scored = fresh.map(classifyClip).filter(Boolean).map(clip => {
    let score = 1;
    const focus = focusDirections.indexOf(clip.direction);
    if (focus >= 0) score += 3 - Math.min(2, focus);
    if (now - clip.publishedAt <= 12 * 3600_000) score += 1;
    if (clip.verb === 'zničili' || clip.verb === 'zostrelili') score += 0.5;
    if (clip.sensitive) score -= 2.5;
    return { ...clip, score };
  }).sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt);
  const out = []; const targets = new Set();
  for (const clip of scored) {
    if (out.length >= max) break;
    if (targets.has(clip.target)) continue;
    targets.add(clip.target); out.push(clip);
  }
  return out;
}
