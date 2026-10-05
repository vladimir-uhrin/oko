#!/usr/bin/env node
// Denné video „Deň na fronte" (2026-10-05, vlastník: „denné akčné spravodajstvo z UA … systém, nie ty").
// Etapa 1: dáta a text. `node scripts/make-front-day-video.mjs --dry [--url http://localhost:4175]` vypíše
// model dňa, háčik, vety komentára (titulok · záber) a text príspevku na Facebook — nič nenahráva.
// Etapa 2 (video) a 3 (Štúdio o 9:30) nadviažu na tento model.

import { loadFrontDay } from './lib/frontDayData.mjs';
import { dayStory, frontDayHook, frontDayLines, frontDayPostText } from '../src/data/frontDayNarration.js';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const baseUrl = opt('url', process.env.FRONT_DAY_API_URL || 'http://localhost:4175');

const { model, reason } = await loadFrontDay({ baseUrl });
if (!model) {
  console.error(`[front-day] video sa dnes nerobí: ${reason}`);
  process.exit(2);
}
const hook = frontDayHook(model);
const lines = frontDayLines(model);
console.log(`[front-day] deň ${model.day} · príbeh ${dayStory(model)} · strety ${model.report.total} (priemer ${model.avg7 ?? '—'})`);
console.log(`  smery: ${model.directions.map(d => `${d.id} ${d.attacks}`).join(', ') || '—'}`);
console.log(`  mapa: ${model.change ? `${model.change.fromDay} → ${model.change.toDay} (${model.change.spanDays} d): RU +${model.change.ruKm2.toFixed(1)} km², UA +${model.change.uaKm2.toFixed(1)} km², do sivej ${model.change.toGreyKm2.toFixed(1)} km²` : `bez zmeny (${model.frontStale || 'nedostupná'})`}`);
console.log(`  noc: ${model.air ? `${model.air.count} oblastí, ${model.air.kinds.join('+') || '—'}` : '—'}`);
console.log(`  zábery: ${model.clips.map(c => `${c.captionSk}${c.direction ? ` [${c.direction}]` : ''}${c.sensitive ? ' (citlivé)' : ''}`).join(' | ') || '—'}`);
console.log(`\nHÁČIK (karta): ${hook.tag} | ${hook.lines.join(' / ')}${hook.sub ? ` | ${hook.sub}` : ''}`);
console.log('\nKOMENTÁR (titulok · záber):');
for (const line of lines) console.log(`  [${line.shot}] ${line.caption}`);
const words = lines.reduce((n, l) => n + l.spoken.split(/\s+/).length, 0);
console.log(`  ~${Math.round(words / 2.6)} s reči (${words} slov)`);
console.log('\nTEXT PRÍSPEVKU (Facebook):\n');
console.log(frontDayPostText(model));
