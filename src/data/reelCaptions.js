// src/data/reelCaptions.js — titulky reelu v3 (2026-10-17): skupiny slov, ktoré sa čítajú naraz, a ich časy podľa reči.
// Oproti v2 (frontDayMotion.wordGroups): číslo sa neodtrhne od slova za ním („9 hodín") a krátke slovo (predložka,
// spojka) nevisí na konci skupiny („Ľudia na / Šeremeteve" → „Ľudia / na Šeremeteve").

const NUMBER = /^[+-]?\d[\d\s.,]*\+?$/;
const SHORT = new Set(['a', 'i', 'o', 'u', 'v', 'k', 's', 'z', 'na', 'do', 'po', 'od', 'za', 'zo', 'vo', 'so', 'ku', 'pri', 'pre', 'nad', 'pod', 'cez', 'bez', 'aj', 'že', 'ak', 'či', 'by', 'sa', 'si', 'no', 'ani']);
const ENDS = /[.!?…:]$/;

/** Slová, ktoré patria k nasledujúcemu (číslo, krátke slovo bez interpunkcie). Pure. */
export function bindsForward(word) {
  if (/[.,!?…:;]$/.test(word)) return false;
  return NUMBER.test(word) || SHORT.has(word.toLowerCase());
}

/**
 * Skupiny slov: najviac `maxUnits` jednotiek (slovo + slová k nemu viazané) a `maxChars` znakov, koniec vety
 * skupinu uzavrie. Pure.
 * @returns {string[]}
 */
export function captionGroups(text, { maxUnits = 3, maxChars = 18 } = {}) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const units = [];
  let pend = [];
  for (const w of words) {
    pend.push(w);
    if (!bindsForward(w)) { units.push(pend.join(' ')); pend = []; }
  }
  if (pend.length) {
    if (units.length) units[units.length - 1] += ` ${pend.join(' ')}`; else units.push(pend.join(' '));
  }
  // vety zvlášť; v každej najmenej skupín, medzi nimi najvyrovnanejšie dĺžky („Potom vyše / 9 hodín nič.",
  // nie „Potom vyše 9 hodín / nič.")
  const out = [];
  let sentence = [];
  for (const u of units) {
    sentence.push(u);
    if (ENDS.test(u)) { out.push(...balance(sentence, maxUnits, maxChars)); sentence = []; }
  }
  if (sentence.length) out.push(...balance(sentence, maxUnits, maxChars));
  return out;
}

function balance(units, maxUnits, maxChars) {
  const n = units.length;
  const fits = (i, j) => j - i === 1 || (j - i <= maxUnits && units.slice(i, j).join(' ').length <= maxChars);
  // best[i] = najlepšie rozdelenie units[i..]: [počet skupín, rozptyl dĺžok, rozdelenie]
  const best = Array(n + 1).fill(null);
  best[n] = { groups: 0, lens: [], cut: [] };
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j <= n; j += 1) {
      if (!fits(i, j) || !best[j]) continue;
      const len = units.slice(i, j).join(' ').length;
      const cand = { groups: best[j].groups + 1, lens: [len, ...best[j].lens], cut: [j, ...best[j].cut] };
      if (!best[i] || cand.groups < best[i].groups || (cand.groups === best[i].groups && spread(cand.lens) < spread(best[i].lens))) best[i] = cand;
    }
  }
  const groups = [];
  let i = 0;
  for (const j of best[0].cut) { groups.push(units.slice(i, j).join(' ')); i = j; }
  return groups;
}

const spread = (lens) => { const m = lens.reduce((a, b) => a + b, 0) / lens.length; return lens.reduce((a, b) => a + (b - m) ** 2, 0); };

/**
 * Časy titulkov: reč vety (speechStart–speechEnd z umiestnenia hlasu) rozdelená podľa dĺžky skupín, za koncom
 * vety krátko podržané. Pure.
 * @param {Array<{id: string, caption: string, noCaption?: boolean}>} lines
 * @param {Array<{id: string, speechStart: number, speechEnd: number}>} placement
 * @returns {Array<{start: number, end: number, text: string, line: string}>}
 */
export function captionTimeline(lines, placement, opts = {}) {
  const byId = Object.fromEntries((placement || []).map((p) => [p.id, p]));
  const out = [];
  for (const line of lines || []) {
    const p = byId[line.id];
    if (!p || line.noCaption) continue;
    const groups = captionGroups(line.caption, opts);
    const weight = (g) => g.length + (/[.!?…,:]$/.test(g) ? 4 : 0) + 2;
    const total = groups.reduce((a, g) => a + weight(g), 0);
    const span = Math.max(0.3, p.speechEnd - p.speechStart);
    let t = p.speechStart;
    for (const g of groups) {
      const d = (span * weight(g)) / total;
      out.push({ start: t, end: t + d, text: g, line: line.id });
      t += d;
    }
  }
  // posledná skupina vety vydrží o chvíľu dlhšie (najviac do ďalšej)
  return out.map((c, i) => ({ ...c, end: Math.min(c.end + 0.2, out[i + 1] ? Math.max(c.end, out[i + 1].start) : c.end + 0.35) }));
}
