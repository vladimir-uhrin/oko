// src/data/eventCaptions.js — titulky videa udalosti (2026-10-03): z presného textu viet a časov reči
// (eventNarration.fitNarration + pauzy v nahrávke), nie z prepisu. Dlhá veta sa rozdelí na dva titulky
// na konci vety, pri pomlčke alebo čiarke, ak hlas tam urobil pauzu; inak ostane celá. SRT pre FB (názov.jazyk_KRAJINA.srt) a HTML
// titulkov v štýle OKO (Inter, tmavý podklad) tesne nad kartou letu, v súhrne nad súhrnom. Pure.

export const CAPTION_STYLE = Object.freeze({ fontPx: 38, maxChars: 48, bottomPx: 940, outroBottomPx: 640, fadeS: 0.12, tailS: 0.15, minS: 0.8, splitMinPauseS: 0.12 });

/**
 * Titulky z viet a ich umiestnenia. Delenie: na konci vety, pri pomlčke alebo čiarke uprostred, keď má nahrávka pauzu
 * (≥ splitMinPauseS) a titulok by bol dlhší než maxChars; čas delenia = pauza. Pure.
 * @param {Array<{id: string, caption: string}>} lines
 * @param {Array<{id: string, start: number, speechStart: number, speechEnd: number}>} placement
 * @param {Record<string, {pauses: Array<{from: number, to: number}>}>} bounds pauzy v nahrávke (čas od začiatku súboru)
 */
export function captionCues(lines, placement, bounds = {}, style = CAPTION_STYLE) {
  const byId = Object.fromEntries(placement.map((p) => [p.id, p]));
  const cues = [];
  for (const line of lines) {
    const p = byId[line.id];
    if (!p) continue;
    const text = line.caption.trim();
    const pauses = (bounds[line.id]?.pauses || []).filter((z) => z.to - z.from >= style.splitMinPauseS);
    // Miesto delenia najbližšie k stredu: koniec vety (prednosť), pomlčka, čiarka; pauza nahrávky, ktorá mu
    // časovo zodpovedá (podiel znakov ≈ podiel času). `cut` = koniec prvej časti, `next` = začiatok druhej.
    const marks = [
      ...[...text.matchAll(/[.!?…] /g)].map((m) => ({ cut: m.index + 1, next: m.index + 2, bonus: 0.2 })),
      ...[...text.matchAll(/ — /g)].map((m) => ({ cut: m.index + 2, next: m.index + 3, bonus: 0.12 })),
      ...[...text.matchAll(/, /g)].map((m) => ({ cut: m.index + 1, next: m.index + 2, bonus: 0 })),
    ].filter((k) => k.cut > 8 && k.cut < text.length - 8);
    const score = (k) => Math.abs(k.cut / text.length - 0.5) - k.bonus;
    const mark = marks.length ? marks.reduce((a, b) => (score(b) < score(a) ? b : a)) : null;
    const speechLen = Math.max(0.1, p.speechEnd - p.speechStart);
    const split = mark ? pauses.map((z) => ({ z, off: Math.abs(((p.start + (z.from + z.to) / 2) - p.speechStart) / speechLen - mark.cut / text.length) })).filter((x) => x.off <= 0.2).sort((a, b) => a.off - b.off)[0]?.z || null : null;
    if (text.length > style.maxChars && split) {
      cues.push({ id: `${line.id}a`, from: p.speechStart, to: p.start + split.from, text: text.slice(0, mark.cut) });
      cues.push({ id: `${line.id}b`, from: p.start + split.to, to: p.speechEnd, text: text.slice(mark.next) });
    } else {
      cues.push({ id: line.id, from: p.speechStart, to: p.speechEnd, text });
    }
  }
  // Zobrazenie trvá o chvíľu dlhšie než reč, nikdy do ďalšieho titulku.
  return cues.map((c, i) => {
    const next = cues[i + 1];
    const end = Math.min(c.to + style.tailS, next ? next.from - 0.04 : c.to + 0.6);
    return { ...c, end: Math.max(end, c.from + style.minS) };
  });
}

const pad = (v, n = 2) => String(v).padStart(n, '0');
/** 00:00:05,490. Pure. */
export function srtTime(s) {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** SRT (UTF-8). Pure. */
export function srt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

/** Spodný okraj titulku (px): v súhrne nad súhrnom, inak nad kartou letu. Pure. */
export function captionBottom(cue, outro, style = CAPTION_STYLE) {
  const inOutro = outro && Math.min(cue.end, outro.to) - Math.max(cue.from, outro.from) > 0.3;
  return inOutro ? style.outroBottomPx : style.bottomPx;
}

/** Stránka pre vykreslenie jedného titulku (puppeteer, priehľadné pozadie, písmo webu Inter). Pure. */
export function captionPageHtml(w, h, style = CAPTION_STYLE) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden}
#cap{position:absolute;left:0;right:0;margin:0 auto;width:fit-content;max-width:${Math.round(w * 0.85)}px;box-sizing:border-box;padding:14px 28px 16px;
border-radius:14px;background:rgba(5,14,22,0.84);border:1.5px solid rgba(0,212,255,0.42);
font-family:'Inter',sans-serif;font-weight:600;font-size:${style.fontPx}px;line-height:1.24;color:#f2fbff;text-align:center;
letter-spacing:0.1px;box-shadow:0 6px 24px rgba(0,0,0,0.35)}</style></head>
<body><div id="cap"></div></body></html>`;
}

/** Čísla a jednotky v titulku sa nezalomia. Pure. */
export const keepCaptionNumbers = (s) => String(s).replace(/(\d) (?=\d)/g, '$1 ').replace(/ (stôp|stupňov|stupne|minút|minúty|ft)(?![\p{L}])/gu, ' $1');

/**
 * Graf ffmpeg na vpálenie titulkov (PNG snímky s nábehom/dozvukom cez alfu) do videa (vstup 0),
 * zvuk je vstup 1, titulok k je vstup k+2. Pure.
 * @returns {{inputs: string[], filter: string, out: string}}
 */
export function overlayGraph(cues, style = CAPTION_STYLE) {
  const inputs = [];
  const filters = [];
  let last = '0:v';
  cues.forEach((c, k) => {
    const d = (c.end - c.from + 0.3).toFixed(3);
    inputs.push('-loop', '1', '-t', d, '-i', c.file);
    const idx = k + 2;
    filters.push(`[${idx}:v]format=rgba,fade=t=in:st=0:d=${style.fadeS}:alpha=1,fade=t=out:st=${(c.end - c.from - style.fadeS).toFixed(3)}:d=${style.fadeS}:alpha=1,setpts=PTS-STARTPTS+${c.from.toFixed(3)}/TB[c${k}]`);
    filters.push(`[${last}][c${k}]overlay=0:0:eof_action=pass:enable='between(t,${c.from.toFixed(3)},${c.end.toFixed(3)})'[o${k}]`);
    last = `o${k}`;
  });
  return { inputs, filter: filters.join(';'), out: last };
}
