// src/volbyHead.test.mjs — náhľad odkazu okolive.sk/?volby na sieťach (scripts/lib/volbyHead.mjs + statický server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { applyVolbyHead, volbyHead } from '../scripts/lib/volbyHead.mjs';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('volbyHead: ?volby (aj s fbclid z Facebooku), obec, kraj; iná adresa nič nemení', () => {
  const sr = volbyHead('?volby&fbclid=IwY2xjawVJrp1');
  assert.equal(sr.url, 'https://okolive.sk/?volby');
  assert.equal(sr.image, 'https://okolive.sk/s/volby2026.jpg');
  assert.match(sr.title, /^Voľby 2026: výsledky každej obce na mape/);
  assert.equal(volbyHead('?volby=501921').image, 'https://okolive.sk/s/v501921.jpg');
  assert.match(volbyHead('?volby=k6').title, /Banskobystrický kraj/);
  assert.equal(volbyHead('?lang=sk'), null);
  assert.equal(volbyHead(''), null);
});

test('applyVolbyHead na skutočnom index.html: titulok, popis, og:*, twitter:*, kanonická adresa na prehľad', () => {
  const out = applyVolbyHead(INDEX, volbyHead('?volby'));
  assert.match(out, /<title>Voľby 2026: výsledky každej obce na mape \| okolive\.sk<\/title>/);
  assert.match(out, /<meta property="og:title" content="Voľby 2026: výsledky každej obce na mape \| okolive\.sk"/);
  assert.match(out, /<meta property="og:url" content="https:\/\/okolive\.sk\/\?volby"/);
  assert.match(out, /<meta property="og:image" content="https:\/\/okolive\.sk\/s\/volby2026\.jpg"/);
  assert.match(out, /<meta name="twitter:image" content="https:\/\/okolive\.sk\/s\/volby2026\.jpg"/);
  assert.match(out, /<link rel="canonical" href="https:\/\/okolive\.sk\/volby-2026\/"/);
  assert.doesNotMatch(out, /og:title" content="OKO — lietadlá/, 'všeobecný titulok preč');
  assert.equal(applyVolbyHead(INDEX, null), INDEX);
});

test('oko-static-server: /?volby&fbclid dostane hlavu volieb, koreň bez parametra pôvodnú', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'oko-dist-volby-'));
  writeFileSync(path.join(dist, 'index.html'), INDEX);
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const script = new URL('../scripts/oko-static-server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const child = spawn(process.execPath, [script, '--port', String(port), '--dir', dist], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i += 1) { try { await fetch(`${base}/robots.txt`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const v = await fetch(`${base}/?volby&fbclid=IwY2xjawVJrp1`);
    assert.equal(v.status, 200);
    assert.equal(v.headers.get('cache-control'), 'no-cache');
    const html = await v.text();
    assert.match(html, /og:image" content="https:\/\/okolive\.sk\/s\/volby2026\.jpg"/);
    assert.equal(Number(v.headers.get('content-length')), Buffer.byteLength(html));
    const root = await (await fetch(`${base}/`)).text();
    assert.match(root, /og:image" content="https:\/\/okolive\.sk\/share-default\.jpg"/);
  } finally { child.kill(); }
});
