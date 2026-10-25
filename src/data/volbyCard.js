// src/data/volbyCard.js
/**
 * @module volbyCard
 * @description Karta obce na zdieľanie (2026-10-25, vlastník: „zdieľateľná karta obce"): `/s/v<kód>` je stránka
 * s Open Graph značkami (náhľad na Facebooku) a `/s/v<kód>.jpg` obrázok 1200×630 so zvoleným starostom,
 * percentami, účasťou a značkou okolive.sk. Návštevník sa presmeruje na `/?volby=<kód>` (panel s obcou).
 * Obrázok sa skladá ako SVG a rasterizuje cez sharp (len server). Texty bez emoji, po slovensky.
 */
import { escapeHtml } from '../shareStore.js';

export const CARD_W = 1200;
export const CARD_H = 630;
export const CARD_ID_RE = /^v(\d{6})$/;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v) => (v == null ? '' : `${String(Number(v).toFixed(2)).replace(/\.?0+$/, '').replace('.', ',')} %`);
const int = (v) => (v == null ? '' : new Intl.NumberFormat('sk-SK').format(v).replace(/ /g, ' '));
const fem = (meno) => /a$/i.test(String(meno || '').trim());
/** Skráti text na približnú šírku v znakoch. Pure. */
export function clip(s, max) { const t = String(s ?? '').trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; }

/** Popis výsledku pre kartu a og:description. Pure. */
export function cardText(obec, r) {
  const mesto = Number(obec?.seats) >= 0 && /^(582000|599981)$/.test(String(obec?.code)) ? 'primátor' : 'starosta';
  const role = (w) => (fem(w?.meno) ? `${mesto === 'primátor' ? 'primátorka' : 'starostka'}` : mesto);
  if (!r || !r.done) return { kicker: 'VÝSLEDKY VOLIEB 2026', head: obec?.name || '', line: 'Výsledky sa ešte spracúvajú', sub: '', desc: `Výsledky komunálnych volieb 2026 v obci ${obec?.name || ''} na mape okolive.sk.` };
  if (!r.elected) return { kicker: 'KOMUNÁLNE VOĽBY 2026', head: obec.name, line: `${mesto === 'primátor' ? 'Primátor' : 'Starosta'} nebol zvolený`, sub: r.turnoutPct != null ? `Účasť ${pct(r.turnoutPct)}` : '', desc: `${obec.name}: ${mesto} nebol zvolený. Výsledky na okolive.sk.` };
  const w = r.winner;
  // Rod víťaza z mena nevieme spoľahlivo (Tünde, Ágnes…) → neutrálne formulácie.
  const office = mesto === 'primátor' ? 'primátor' : 'starosta';
  const status = r.cls === 'held' ? 'mandát obhájený' : r.cls === 'lost' ? `doterajší ${office} ${r.incumbent?.priezvisko || ''} prehral` : r.single ? 'jediný kandidát' : r.cls === 'open' ? 'nová tvár na radnici' : '';
  const sub = [r.turnoutPct != null ? `Účasť ${pct(r.turnoutPct)}` : '', r.margin != null && r.second ? `druhý: ${r.second.meno} ${r.second.priezvisko}, rozdiel ${int(r.margin)} ${r.margin === 1 ? 'hlas' : r.margin >= 2 && r.margin <= 4 ? 'hlasy' : 'hlasov'}` : ''].filter(Boolean).join(' · ');
  return {
    kicker: `VOĽBA ${mesto === 'primátor' ? 'PRIMÁTORA' : 'STAROSTU'} · KOMUNÁLNE VOĽBY 2026`,
    head: obec.name,
    line: `${w.meno} ${w.priezvisko}`,
    pct: pct(w.pct), status, sub,
    party: w.strany === 'NEKA' ? 'nezávislý kandidát' : w.strany,
    desc: `${obec.name}: víťaz voľby ${mesto === 'primátor' ? 'primátora' : 'starostu'} ${w.meno} ${w.priezvisko} (${pct(w.pct)})${status ? `, ${status}` : ''}. Výsledky každej obce na mape okolive.sk.`,
  };
}

/** SVG karty 1200×630. Pure. */
export function cardSvg(obec, r) {
  const t = cardText(obec, r);
  const accent = r?.cls === 'held' ? '#4ade80' : r?.cls === 'lost' || r?.cls === 'open' ? '#ffb33c' : '#7fdcff';
  const font = "Segoe UI, 'Inter', Arial, sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
<defs><radialGradient id="g" cx="78%" cy="30%" r="80%"><stop offset="0" stop-color="#14304a"/><stop offset="1" stop-color="#060b14"/></radialGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<rect x="0" y="0" width="12" height="${CARD_H}" fill="${accent}"/>
<text x="70" y="96" font-family="${font}" font-size="30" font-weight="700" letter-spacing="4" fill="${accent}">${esc(t.kicker)}</text>
<text x="70" y="186" font-family="${font}" font-size="74" font-weight="800" fill="#ffffff">${esc(clip(t.head, 26))}</text>
<text x="70" y="290" font-family="${font}" font-size="58" font-weight="700" fill="#e8f3ff">${esc(clip(t.line, 30))}</text>
${t.pct ? `<text x="70" y="410" font-family="${font}" font-size="120" font-weight="800" fill="${accent}">${esc(t.pct)}</text>` : ''}
${t.status ? `<text x="${t.pct ? 70 + t.pct.length * 66 + 24 : 70}" y="${t.pct ? 392 : 370}" font-family="${font}" font-size="36" font-weight="600" fill="#ffffff">${esc(clip(t.status, 34))}</text>` : ''}
${t.party ? `<text x="70" y="468" font-family="${font}" font-size="28" fill="#9fb3c8">${esc(clip(t.party, 70))}</text>` : ''}
${t.sub ? `<text x="70" y="520" font-family="${font}" font-size="30" fill="#c9d6e3">${esc(clip(t.sub, 70))}</text>` : ''}
<text x="70" y="592" font-family="${font}" font-size="30" font-weight="800" fill="#ffffff">okolive<tspan fill="#00d4ff">.sk</tspan><tspan fill="#9fb3c8" font-weight="500" font-size="24">  ·  výsledky každej obce na mape · zdroj ŠÚ SR</tspan></text>
<text x="${CARD_W - 60}" y="592" text-anchor="end" font-family="${font}" font-size="64" font-weight="900" fill="#ffffff" fill-opacity="0.10" letter-spacing="6">VOĽBY 2026</text>
</svg>`;
}

/** JPEG karty (sharp). */
export async function renderCardJpeg(obec, r) {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(cardSvg(obec, r))).jpeg({ quality: 88 }).toBuffer();
}

/** HTML stránky /s/v<kód>: Open Graph + presmerovanie do aplikácie. Pure. */
export function cardPage(obec, r, origin) {
  const t = cardText(obec, r);
  const base = String(origin || 'https://okolive.sk').replace(/\/+$/, '');
  const id = `v${obec.code}`;
  const title = `${obec.name} – ${t.line}${t.pct ? ` (${t.pct})` : ''} | Voľby 2026`;
  const target = `${base}/?volby=${encodeURIComponent(obec.code)}`;
  return `<!doctype html><html lang="sk"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(t.desc)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="OKO – okolive.sk" />
<meta property="og:url" content="${escapeHtml(`${base}/s/${id}`)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(t.desc)}" />
<meta property="og:image" content="${escapeHtml(`${base}/s/${id}.jpg`)}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="${CARD_W}" />
<meta property="og:image:height" content="${CARD_H}" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" />
<link rel="canonical" href="${escapeHtml(target)}" />
</head><body style="background:#060b14;color:#fff;font-family:sans-serif"><p><a href="${escapeHtml(target)}" style="color:#00d4ff">${escapeHtml(title)}</a></p>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`;
}

export const OVERVIEW_ID = 'volby2026';
export const CLASS_COLORS = Object.freeze({ held: '#4ade80', lost: '#ff8a3d', open: '#ffd166', none: '#ff4d6d', pending: '#3b6f8f' });

/**
 * Súhrnná karta volieb: mapa SR, každá obec bod vo farbe výsledku (obhájil / prehral / nová tvár / nezvolený),
 * počty vpravo. Body: [[lat, lon, cls], …]. Pure.
 */
export function overviewSvg(points, counts = {}) {
  const font = "Segoe UI, 'Inter', Arial, sans-serif";
  // SR: lon 16,8–22,6, lat 47,7–49,65; mierka so stlačením dĺžky podľa cos(48,7°)
  const x0 = 16.8; const x1 = 22.6; const y0 = 47.7; const y1 = 49.65;
  const k = Math.cos((48.7 * Math.PI) / 180);
  const W = 760; const scale = W / ((x1 - x0) * k); const H = (y1 - y0) * scale;
  const ox = 40; const oy = 150 + (420 - H) / 2;
  const dots = points.map(([lat, lon, cls]) => {
    const x = ox + (lon - x0) * k * scale; const y = oy + (y1 - lat) * scale;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${cls === 'pending' ? 2.2 : 3}" fill="${CLASS_COLORS[cls] || CLASS_COLORS.pending}"/>`;
  }).join('');
  const n = (v) => new Intl.NumberFormat('sk-SK').format(v || 0).replace(/ /g, ' ');
  const rows = [['held', 'starosta obhájil', counts.held], ['lost', 'starosta prehral', counts.lost], ['open', 'nová tvár, bez starostu v boji', counts.open], ['none', 'starosta nezvolený', counts.none]];
  const legend = rows.map(([cls, label, v], i) => `<circle cx="838" cy="${222 + i * 74}" r="12" fill="${CLASS_COLORS[cls]}"/><text x="864" y="${218 + i * 74}" font-family="${font}" font-size="40" font-weight="800" fill="#fff">${n(v)}</text><text x="864" y="${246 + i * 74}" font-family="${font}" font-size="21" fill="#b9c8d8">${esc(label)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
<defs><radialGradient id="g" cx="40%" cy="55%" r="75%"><stop offset="0" stop-color="#10263c"/><stop offset="1" stop-color="#05090f"/></radialGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="40" y="78" font-family="${font}" font-size="54" font-weight="900" letter-spacing="3" fill="#ffffff">VOĽBY 2026</text>
<text x="40" y="118" font-family="${font}" font-size="27" fill="#9fb3c8">Starostovia a primátori všetkých ${n(counts.done || points.length)} obcí · výsledky ŠÚ SR</text>
${dots}
${legend}
<text x="40" y="600" font-family="${font}" font-size="32" font-weight="800" fill="#ffffff">okolive<tspan fill="#00d4ff">.sk</tspan><tspan fill="#9fb3c8" font-weight="500" font-size="24">  ·  klikni na svoju obec</tspan></text>
<text x="${CARD_W - 40}" y="600" text-anchor="end" font-family="${font}" font-size="20" fill="#6f8399">doterajší starosta podľa zamestnania v registri kandidátov MV SR</text>
</svg>`;
}

export async function renderOverviewJpeg(points, counts) {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(overviewSvg(points, counts))).jpeg({ quality: 88 }).toBuffer();
}

/** HTML /s/volby2026. Pure. */
export function overviewPage(counts = {}, origin) {
  const base = String(origin || 'https://okolive.sk').replace(/\/+$/, '');
  const target = `${base}/?volby`;
  const title = 'Voľby 2026: výsledky každej obce na mape | okolive.sk';
  const n = (v) => new Intl.NumberFormat('sk-SK').format(v || 0).replace(/ /g, ' ');
  const desc = counts.done ? `Starosta obhájil v ${n(counts.held)} obciach, prehral v ${n(counts.lost)}, v ${n(counts.none)} obciach nezvolený. Klikni na svoju obec: víťaz, percentá, účasť.` : 'Výsledky komunálnych a župných volieb 2026 na mape — každá obec, kandidáti a výsledky.';
  return `<!doctype html><html lang="sk"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="OKO – okolive.sk" />
<meta property="og:url" content="${escapeHtml(`${base}/s/${OVERVIEW_ID}`)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<meta property="og:image" content="${escapeHtml(`${base}/s/${OVERVIEW_ID}.jpg`)}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="${CARD_W}" />
<meta property="og:image:height" content="${CARD_H}" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" />
</head><body style="background:#060b14;color:#fff;font-family:sans-serif"><p><a href="${escapeHtml(target)}" style="color:#00d4ff">${escapeHtml(title)}</a></p>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`;
}
