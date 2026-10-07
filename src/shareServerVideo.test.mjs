// src/shareServerVideo.test.mjs — strážca zapojenia videa do náhľadu v serveri zdieľania (2026-10-07):
// cesta nahrávky pod /api/share, obmedzenia a prevod, /s/<id>.mp4 s Range; pôvodné piny v shareServer.test.mjs platia ďalej.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('vite.config.js: POST /api/share/<id>/video s vlastným limitom, stropom tela, overením bajtov, oknom na pripojenie a ffmpeg; /s/<id>.mp4 cez sendVideoFile', () => {
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /import \{ convertShareVideo, resolveFfmpegPath, sendVideoFile \} from '\.\/src\/shareVideoServer\.js';/);
  assert.match(vite, /const videoRoute = \/\^\\\/\(\[A-Za-z0-9\]\{6,32\}\)\\\/video\(\?:\\\?\(\.\*\)\)\?\$\/\.exec\(req\.url \|\| ''\);/, 'cesta nahrávky');
  assert.match(vite, /const videoLimiter = makeRateLimiter\(\{ windowMs: 3600_000, max: 30, globalMax: 300 \}\);/, 'vlastný limit, neuberá zo zdieľaní');
  assert.match(vite, /readRequestBodyCapped\(req, SHARE_VIDEO_MAX_BYTES\)/, 'strop tela nahrávky');
  assert.match(vite, /validateVideoUpload\(\{ buffer, contentType: req\.headers\['content-type'\], width: query\.get\('w'\), height: query\.get\('h'\), durationMs: query\.get\('ms'\) \}\)/);
  assert.match(vite, /if \(!canAttachVideo\(record\)\) \{ sendJson\(res, 409, \{ error: 'video_closed' \}\); return; \}/, 'len čerstvé zdieľanie bez videa');
  assert.match(vite, /if \(converting >= 2\) \{ sendJson\(res, 503, \{ error: 'busy' \}/, 'najviac dva prevody naraz');
  assert.match(vite, /ffmpegPath: resolveFfmpegPath\(process\.env\)/, 'ffmpeg z FFMPEG_PATH v .env');
  assert.match(vite, /result\.error === 'ffmpeg_missing' \? 503 : 502/, 'bez ffmpeg 503, zlý prevod 502 — odkaz ostáva s obrázkom');
  assert.match(vite, /videoStore\.attachVideo\(id, \{ width: checked\.value\.width, height: checked\.value\.height, durationMs: checked\.value\.durationMs, bytes: result\.bytes \}\)/);
  assert.match(vite, /try \{ fs\.unlinkSync\(uploadPath\); \} catch \{ \/\* nebol \*\/ \}/, 'nahrávka sa po prevode zmaže');
  assert.match(vite, /const videoMatch = \/\^\\\/\(\[A-Za-z0-9\]\{6,32\}\)\\\.mp4\$\/\.exec\(pathname\);/);
  assert.match(vite, /sendVideoFile\(\{ req, res, filePath: getStore\(\)\.videoPath\(videoMatch\[1\]\) \}\);/, 'Range + nemenné cache ako obrázok');
  assert.match(vite, /if \(!videoRecord\?\.video\) \{ send\(res, 404/, 'mp4 len pre záznam s videom');
});
