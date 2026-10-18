#!/usr/bin/env node
// Hotový reel (9:16 MP4) + text príspevku → koncept v Štúdiu (admin OKO), nič sa nezverejní. Vlastník 18. 10.:
// „ku všetkým reelom aj text … a daj do konceptov FB". Video sa neprerába (v3 reely sú hotové 9:16) — skopíruje sa
// k Štúdiu ako pripravené video návrhu; náhľad = snímka z videa. Rovnaký kľúč (--key) druhýkrát nič nepridá.
//
//   node scripts/studio-import-reel.mjs --key reel:samara-2026-10 --video <mp4> --text <post.txt> [--title "…"] [--db .auth-data/admin.sqlite]
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAdminStore } from '../src/admin/server/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const key = flag('--key'); const videoIn = flag('--video'); const textFile = flag('--text');
if (!key || !videoIn || !textFile) { console.error('chýba --key, --video alebo --text'); process.exit(2); }
const dbFile = path.resolve(root, flag('--db', '.auth-data/admin.sqlite'));
const mediaDir = path.join(path.dirname(dbFile), 'studio');
const text = fs.readFileSync(textFile, 'utf8').replace(/\r\n/g, '\n').trim();
const firstLine = text.split('\n').find((l) => l.trim()) || '';
const title = (flag('--title') || firstLine).trim().slice(0, 200);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, ext) => `ffprobe${ext || ''}`);

const store = openAdminStore(dbFile);
if (store.studioHasKey(key)) { console.log(`koncept ${key} už je v Štúdiu — nič nepridané`); process.exit(0); }
const id = randomUUID();
fs.mkdirSync(mediaDir, { recursive: true });
const name = `${id}.mp4`;
fs.copyFileSync(videoIn, path.join(mediaDir, name));
const poster = path.join(mediaDir, `${id}.poster.jpg`);
spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.4', '-i', videoIn, '-frames:v', '1', '-q:v', '3', poster], { windowsHide: true });
const image = fs.existsSync(poster) ? fs.readFileSync(poster) : null;
fs.rmSync(poster, { force: true });
const seconds = Number(spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoIn], { encoding: 'utf8' }).stdout.trim()) || null;
const now = Date.now();
const created = store.studioInsert({ id, template: 'reel-v3', eventKey: key, origin: 'manual', title, text: text.slice(0, 2200),
  card: { kind: 'import', vertical: true, kicker: 'REEL', headline: firstLine.slice(0, 160), source: 'okolive.sk' }, image, createdAt: now });
if (!created) { fs.rmSync(path.join(mediaDir, name), { force: true }); console.log(`koncept ${key} už existuje`); process.exit(0); }
store.studioUpdate(id, { video: name, videoStatus: 'ready', videoError: null, videoSeconds: seconds }, now);
console.log(`koncept pridaný: ${title} (${id}, ${seconds?.toFixed(1)} s)`);
