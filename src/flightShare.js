// src/flightShare.js
// Kvalitné zdieľanie letu (2026-10-11, vlastník: „aj tu by si mohol dať ako u lodiach v kartičke
// zdieľanie" + „a kvalitné zdieľanie"): z faktov karty sledovaného letu (flights.getTrackedShareCard)
// sa skladá titulok a popis príspevku (náhľad odkazu /s/<id>) a pás na obrázku aj krátkom videu —
// volací znak, aerolinka, trasa, hladina, rýchlosť, priebeh letu, NAŽIVO/ODHAD so zdrojom odhadu
// a značka okolive.sk. Čistý modul bez DOM pri importe; kreslenie ide cez 2D kontext (aj falošný).

export const FLIGHT_SHARE_SITE = 'okolive.sk';
const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const ACCENT = '#22d3ee';
const LIVE = '#4ade80';
const ESTIMATE = '#fbbf24';
const INK = '#e6f6fb';
const MUTED = 'rgba(214, 236, 244, 0.78)';

function clean(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function formatWhen(whenMs, lang) {
  const locale = lang === 'en' ? 'en-GB' : 'sk-SK';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(whenMs));
  } catch {
    return new Date(whenMs).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Percento priebehu letu alebo null. Pure. */
export function flightShareProgressPercent(progress) {
  const fraction = Number(progress?.fractionDone);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  return Math.round(fraction * 100);
}

/** Hlavička letu: „CCA754 · CA754" (IATA číslo len keď sa líši od volacieho znaku). Pure. */
export function flightShareHeadline(card) {
  const cs = clean(card?.callsign) || clean(card?.icao24).toUpperCase();
  const iata = clean(card?.flightIata);
  return iata && iata !== cs ? `${cs} · ${iata}` : cs;
}

/** Aerolinka z riadku identity (prvá časť pred „ · "). Pure. */
function airlineOf(card) {
  return clean(String(card?.identLine || '').split(' · ')[0]);
}

/**
 * Titulok, popis a text príspevku pre zdieľaný let. Pure.
 * @param {object} card výsledok flights.getTrackedShareCard()
 * @param {{ whenMs?: number, lang?: 'sk'|'en' }} [options]
 * @returns {{ title: string, description: string, text: string }}
 */
export function buildFlightShareCopy(card, { whenMs = Date.now(), lang = 'sk' } = {}) {
  const en = lang === 'en';
  const headline = flightShareHeadline(card);
  const airline = airlineOf(card);
  const route = clean(card?.routeLine);
  const title = [headline, airline, route].filter(Boolean).join(' · ').slice(0, 110) + ' | OKO';
  const status = card?.estimated
    ? (en ? 'ESTIMATED position' : 'ODHAD polohy') + (clean(card?.estimateLine) ? ` (${clean(card.estimateLine)})` : '')
    : (en ? 'LIVE' : 'NAŽIVO');
  const facts = (card?.flightLines || []).slice(0, 2).map(clean).filter(Boolean);
  const percent = flightShareProgressPercent(card?.progress);
  const progress = percent === null ? '' : (en ? `${percent} % of the route` : `${percent} % trasy`);
  const alert = clean(card?.alertLine);
  const description = [status, alert, ...facts, progress, `${FLIGHT_SHARE_SITE} · ${formatWhen(whenMs, lang)}`]
    .filter(Boolean).join(' · ').slice(0, 280);
  return { title, description, text: `${title} — ${description}` };
}

function fitText(ctx, text, maxWidth) {
  let value = clean(text);
  if (!value || !(maxWidth > 0)) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value.trimEnd()}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Značka okolive.sk vľavo hore (OK biele + azúrové O, ako logo webu). */
function drawBrand(ctx, x, y) {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `700 26px ${MONO}`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = INK;
  ctx.fillText('OK', x, y);
  const okWidth = ctx.measureText('OK').width;
  ctx.fillStyle = ACCENT;
  ctx.fillText('O', x + okWidth, y);
  ctx.font = `500 15px ${MONO}`;
  ctx.fillStyle = INK;
  ctx.fillText(FLIGHT_SHARE_SITE, x + 2, y + 32);
  ctx.restore();
}

/**
 * Pás letu na obrázku/videu zdieľania (ide ako `decorate` do drawShareFrame — výška už bez pásu
 * atribúcie). Ľavý dolný roh: hlavička + štítok NAŽIVO/ODHAD, aerolinka a typ, trasa s priebehom,
 * hladina a rýchlosť, zdroj odhadu. Vľavo hore značka okolive.sk.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} card flights.getTrackedShareCard()
 * @param {number} width
 * @param {number} height
 * @param {{ lang?: 'sk'|'en' }} [options]
 */
export function drawFlightShareCard(ctx, card, width, height, { lang = 'sk' } = {}) {
  if (!ctx || !card) return;
  const en = lang === 'en';
  const pad = 22;
  drawBrand(ctx, pad, pad);

  const panelW = Math.min(Math.round(width * 0.62), 760);
  const innerW = panelW - 2 * pad;
  const lines = [];
  const ident = clean(card.identLine);
  if (ident) lines.push({ text: ident, font: `500 19px ${MONO}`, color: INK, h: 28 });
  const route = clean(card.routeLine);
  if (route) lines.push({ text: route, font: `600 21px ${MONO}`, color: INK, h: 30 });
  const percent = flightShareProgressPercent(card.progress);
  if (percent !== null) lines.push({ bar: percent, h: 22 });
  for (const fact of (card.flightLines || []).slice(0, 2).map(clean).filter(Boolean)) {
    lines.push({ text: fact, font: `500 17px ${MONO}`, color: MUTED, h: 25 });
  }
  const alert = clean(card.alertLine);
  if (alert) lines.push({ text: alert, font: `700 17px ${MONO}`, color: '#f87171', h: 26 });
  const estimate = card.estimated ? clean(card.estimateLine) : '';
  if (estimate) lines.push({ text: estimate, font: `500 16px ${MONO}`, color: ESTIMATE, h: 24 });

  const headH = 44;
  const panelH = pad + headH + lines.reduce((sum, line) => sum + line.h, 0) + pad - 6;
  const x = pad;
  const y = Math.max(pad + 70, height - pad - panelH);

  ctx.save();
  roundRect(ctx, x, y, panelW, panelH, 10);
  ctx.fillStyle = 'rgba(5, 14, 22, 0.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = ACCENT;
  ctx.fillRect(x + 10, y, panelW - 20, 3);

  // Hlavička + štítok stavu.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const chipText = card.estimated ? (en ? 'ESTIMATE' : 'ODHAD') : (en ? 'LIVE' : 'NAŽIVO');
  const chipColor = card.estimated ? ESTIMATE : LIVE;
  ctx.font = `700 15px ${MONO}`;
  const chipW = Math.ceil(ctx.measureText(chipText).width) + 22;
  ctx.font = `700 32px ${MONO}`;
  ctx.fillStyle = INK;
  const head = fitText(ctx, flightShareHeadline(card), innerW - chipW - 14);
  ctx.fillText(head, x + pad, y + pad - 2);
  const chipX = x + pad + ctx.measureText(head).width + 14;
  roundRect(ctx, chipX, y + pad + 3, chipW, 26, 13);
  ctx.strokeStyle = chipColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = chipColor;
  ctx.font = `700 15px ${MONO}`;
  ctx.fillText(chipText, chipX + 11, y + pad + 8);

  let cy = y + pad + headH;
  for (const line of lines) {
    if (line.bar !== undefined) {
      const barW = innerW - 70;
      roundRect(ctx, x + pad, cy + 4, barW, 8, 4);
      ctx.fillStyle = 'rgba(214, 236, 244, 0.18)';
      ctx.fill();
      if (line.bar > 0) {
        roundRect(ctx, x + pad, cy + 4, Math.max(8, Math.round(barW * line.bar / 100)), 8, 4);
        ctx.fillStyle = ACCENT;
        ctx.fill();
      }
      ctx.font = `600 15px ${MONO}`;
      ctx.fillStyle = INK;
      ctx.fillText(`${line.bar} %`, x + pad + barW + 12, cy - 1);
    } else {
      ctx.font = line.font;
      ctx.fillStyle = line.color;
      ctx.fillText(fitText(ctx, line.text, innerW), x + pad, cy);
    }
    cy += line.h;
  }
  ctx.restore();
}
