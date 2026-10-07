// src/data/eventVideoAudio.test.mjs — zvuk a titulky videa udalosti (2026-10-03). Testy SPRÁVANIA: plán hudby
// natiahne skladbu celými frázami na dĺžku videa s tempom blízko 1, graf ffmpeg má hlas na časoch viet
// a hudbu stlmenú pod hlasom, hranice reči z výpisu silencedetect; titulky z presných časov viet, dlhé
// sa delia pri čiarke len keď hlas urobil pauzu, SRT formát, v súhrne vyššie, konkurencia nikde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_DEFAULTS, audioGraph, loudnormArgs, musicPlan, speechBounds } from './eventVideoAudio.js';
import { CAPTION_STYLE, captionBottom, captionCues, captionPageHtml, keepCaptionNumbers, overlayGraph, srt, srtTime } from './eventCaptions.js';
import { parseMcpBody, toolResultValue } from './aiTranslatorsClient.js';

const TRACK = { durationS: 38.78, loop: { from: 8.33, to: 16.2 } };
const NB = String.fromCharCode(160);

test('plán hudby: skladba 38,8 s na video 68 s = štyri frázy navyše a tempo blízko 1; na 48 s jedna; krátke video skráti tempom', () => {
  const p68 = musicPlan(TRACK, 68.34);
  assert.equal(p68.loops, 4);
  assert.deepEqual(p68.segments, [[0, 16.2], [8.33, 16.2], [8.33, 16.2], [8.33, 16.2], [8.33, 16.2], [16.2, null]]);
  assert.ok(Math.abs(p68.tempo - 1) < 0.04, `tempo ${p68.tempo}`);
  const p48 = musicPlan(TRACK, 48);
  assert.equal(p48.loops, 1);
  assert.ok(Math.abs(p48.tempo - 1) < 0.04);
  const p36 = musicPlan(TRACK, 36);
  assert.equal(p36.loops, 0);
  assert.ok(p36.tempo <= AUDIO_DEFAULTS.tempoMax && p36.tempo >= 1, 'bez slučky, mierne zrýchlené v medziach');
  assert.throws(() => musicPlan({ durationS: 10, loop: { from: 8, to: 12 } }, 30));
});

test('graf ffmpeg: každá veta oneskorená na svoj čas, hudba zo segmentov s prelínaním, stlmenie pod hlasom, bez hudby len hlas', () => {
  const placement = [{ id: 'a', start: 0.19 }, { id: 'b', start: 6.24 }];
  const g = audioGraph({ placement, totalS: 20, music: musicPlan(TRACK, 20), tail: ';[mix]loudnorm[o]' });
  assert.match(g, /\[0:a\]aresample=48000,aformat=channel_layouts=mono,adelay=190:all=1\[v0\]/);
  assert.match(g, /\[1:a\][^;]*adelay=6240:all=1\[v1\]/);
  assert.match(g, /\[v0\]\[v1\]amix=inputs=2:normalize=0/);
  assert.match(g, /\[2:a\]aresample=48000,asplit=\d\[ms0\]\[ms1\]/, 'hudba je vstup za vetami');
  assert.match(g, /acrossfade=d=0.03/);
  assert.match(g, /sidechaincompress=threshold=0.025:ratio=6/);
  assert.match(g, /volume=0.4\[mus\]/);
  assert.match(g, /\[vo\]\[duck\]amix=inputs=2:normalize=0:duration=first\[mix\];\[mix\]loudnorm\[o\]$/);
  const noMusic = audioGraph({ placement, totalS: 20, music: null, tail: ';[mix]anull[o]' });
  assert.ok(!noMusic.includes('sidechain') && noMusic.includes('[mix];[mix]anull[o]'));
  assert.match(loudnormArgs(), /^loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json$/);
  assert.match(loudnormArgs({ input_i: '-18.3', input_tp: '-4.3', input_lra: '5.3', input_thresh: '-28.5', target_offset: '0.1' }), /measured_I=-18.3.*linear=true/);
});

test('hranice reči z výpisu silencedetect: ticho na začiatku, koniec reči pred tichom na konci, pauzy vnútri', () => {
  const log = 'silence_start: 0 silence_end: 0.161\nsilence_start: 3.395 silence_end: 3.584\nsilence_start: 7.197 silence_end: 7.4';
  const b = speechBounds(log, 7.4);
  assert.equal(b.lead, 0.161);
  assert.equal(b.speechEnd, 7.197);
  assert.deepEqual(b.pauses, [{ from: 3.395, to: 3.584 }]);
  const none = speechBounds('', 2.5);
  assert.deepEqual([none.lead, none.speechEnd, none.pauses], [0, 2.5, []]);
});

test('titulky: čas z reči vety, dlhá veta s pauzou pri čiarke sa rozdelí na dva, bez pauzy ostane celá; SRT; v súhrne vyššie', () => {
  const lines = [
    { id: 'm0', caption: 'Krátko po piatej hodine svetového času prudko klesá, vyše 21 000 stôp za minútu.' },
    { id: 'm1', caption: 'Potom 9 minút bez údajov.' },
    { id: 'x', caption: 'Podľa izraelského premiéra jeden z pilotov pobodal druhého, a zrejme sa pokúsil zrútiť lietadlo.' },
  ];
  const placement = [
    { id: 'm0', start: 6.24, speechStart: 6.42, speechEnd: 13.44 },
    { id: 'm1', start: 14.36, speechStart: 14.52, speechEnd: 16.67 },
    { id: 'x', start: 41.8, speechStart: 41.94, speechEnd: 49.89 },
  ];
  // m0: okrem pauzy pri čiarke aj krátka pauza na začiatku (nahrávky ich mávajú) — delí sa pri tej, čo sedí k čiarke.
  const bounds = { m0: { pauses: [{ from: 0.49, to: 0.66 }, { from: 4.407, to: 4.911 }] }, x: { pauses: [{ from: 0.4, to: 0.6 }] } };
  const cues = captionCues(lines, placement, bounds);
  assert.deepEqual(cues.map((c) => c.id), ['m0a', 'm0b', 'm1', 'x']);
  assert.equal(cues[0].text, 'Krátko po piatej hodine svetového času prudko klesá,');
  assert.equal(cues[1].text, 'vyše 21 000 stôp za minútu.');
  assert.ok(Math.abs(cues[0].to - (6.24 + 4.407)) < 1e-9 && Math.abs(cues[1].from - (6.24 + 4.911)) < 1e-9, 'delenie v pauze nahrávky');
  assert.ok(cues[0].end <= cues[1].from, 'titulky sa neprekrývajú');
  assert.equal(cues[3].text, lines[2].caption, 'bez pauzy sa dlhá veta nedelí');
  assert.equal(cues[2].end, 16.67 + CAPTION_STYLE.tailS);
  const text = srt(cues);
  assert.match(text, /^1\n00:00:06,420 --> 00:00:10,797\nKrátko po piatej hodine/);
  assert.equal(srtTime(3661.5), '01:01:01,500');
  assert.equal(captionBottom(cues[3], { from: 41.74, to: 60.5 }), CAPTION_STYLE.outroBottomPx, 'v súhrne nad súhrnom');
  assert.equal(captionBottom(cues[0], { from: 41.74, to: 60.5 }), CAPTION_STYLE.bottomPx);
  assert.equal(keepCaptionNumbers('vyše 21 000 stôp za minútu'), `vyše 21${NB}000${NB}stôp za minútu`);
  assert.ok(captionPageHtml(1080, 1350).includes("font-family:'Inter'"));
  const g = overlayGraph(cues.map((c, i) => ({ ...c, file: `t${i}.png` })));
  assert.equal(g.inputs.filter((x) => x === '-i').length, 4);
  assert.match(g.filter, /\[2:v\]format=rgba,fade=t=in:st=0:d=0.12:alpha=1/);
  assert.match(g.filter, /overlay=0:0:eof_action=pass:enable='between\(t,6.420,/);
  assert.equal(g.out, 'o3');
});

test('MCP odpovede ai-translators: JSON aj SSE, výsledok nástroja ako JSON z textu alebo structuredContent', () => {
  assert.deepEqual(parseMcpBody('application/json', '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}').result, { ok: true });
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\\"url\\":\\"https://x/a.wav\\",\\"seconds\\":4.1}"}]}}\n\n';
  const msg = parseMcpBody('text/event-stream; charset=utf-8', sse);
  assert.deepEqual(toolResultValue(msg.result), { url: 'https://x/a.wav', seconds: 4.1 });
  assert.deepEqual(toolResultValue({ structuredContent: { a: 1 }, content: [] }), { a: 1 });
  assert.equal(toolResultValue({ content: [{ type: 'text', text: 'plain' }] }), 'plain');
  assert.equal(parseMcpBody('application/json', 'nie json'), null);
});

test('titulky: dlhá veta sa delí prednostne na konci vety alebo pri pomlčke (pauza nahrávky tam), nie pri skoršej čiarke', () => {
  const lines = [
    { id: 'q', caption: 'Prečo sa to stalo, zatiaľ nie je známe. Prebieha vyšetrovanie.' },
    { id: 'd', caption: 'Údaje končia vo výške 15 000 stôp — lietadlo je stále vo vzduchu.' },
    { id: 's', caption: 'Potom 9 minút ticho. Žiadne údaje.' },
  ];
  const placement = [
    { id: 'q', start: 10, speechStart: 10.2, speechEnd: 14.6 },
    { id: 'd', start: 20, speechStart: 20.2, speechEnd: 25.2 },
    { id: 's', start: 30, speechStart: 30.2, speechEnd: 32.9 },
  ];
  // q: pauza pri čiarke (1,2 s od začiatku súboru) aj na konci prvej vety (3,0 s) — delí sa na konci vety.
  const bounds = { q: { pauses: [{ from: 1.2, to: 1.4 }, { from: 3.0, to: 3.45 }] }, d: { pauses: [{ from: 2.75, to: 3.1 }] }, s: { pauses: [{ from: 1.6, to: 2.0 }] } };
  const cues = captionCues(lines, placement, bounds);
  assert.deepEqual(cues.map((c) => c.id), ['qa', 'qb', 'da', 'db', 's']);
  assert.equal(cues[0].text, 'Prečo sa to stalo, zatiaľ nie je známe.');
  assert.equal(cues[1].text, 'Prebieha vyšetrovanie.');
  assert.ok(Math.abs(cues[0].to - 13.0) < 1e-9 && Math.abs(cues[1].from - 13.45) < 1e-9);
  assert.equal(cues[2].text, 'Údaje končia vo výške 15 000 stôp —');
  assert.equal(cues[3].text, 'lietadlo je stále vo vzduchu.');
  assert.equal(cues[4].text, 'Potom 9 minút ticho. Žiadne údaje.', 'krátka veta sa nedelí, hoci má pauzu');
});

test('hudba podľa nálady príbehu, striedanie po dňoch, bez zhody ktorákoľvek', async () => {
  const { pickTrack } = await import('./eventVideoAudio.js');
  const tracks = [{ id: 'a', moods: ['tense'] }, { id: 'b', moods: ['tense'] }, { id: 'c', moods: ['somber'] }, { id: 'n', moods: ['news'] }];
  assert.equal(pickTrack(tracks, { story: 'strike', day: '2026-10-07' }).id, 'c', 'útok s obeťami = vážna hudba');
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((day) => pickTrack(tracks, { story: 'ru', day }).id);
  assert.ok(days.every((id) => id === 'a' || id === 'b') && new Set(days).size === 2, `striedanie: ${days}`);
  assert.equal(pickTrack([{ id: 'x' }], { story: 'strike' }).id, 'x');
  assert.equal(pickTrack([], {}), null);
});
