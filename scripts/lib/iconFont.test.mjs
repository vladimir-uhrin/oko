// scripts/lib/iconFont.test.mjs — výrez písma Material Symbols Outlined (2026-10-31): zber názvov ikon
// z kódu, zhoda zoznamu vo výreze s kódom, súbor písma, odkazy v index.html a style.css, Vite plugin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ICON_FONT_AXES,
  ICON_FONT_FILE,
  ICON_FONT_MANIFEST,
  ICON_FONT_URL,
  collectIconNames,
  fontFingerprint,
  fontUrlFromCss,
  functionsWithParam,
  googleSubsetCssUrl,
  iconFontCacheBustPlugin,
  iconNamesFromMarkup,
  iconNamesFromScript,
  parseCodepoints,
  splitCallArgs,
  versionIconFontUrls,
} from './iconFont.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const vite = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
const fontBytes = fs.readFileSync(path.join(ROOT, 'public', ICON_FONT_FILE));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', ICON_FONT_MANIFEST), 'utf8'));
const collected = collectIconNames(ROOT);

test('zber: ligatúry v značkách HTML aj v reťazcoch JS', () => {
  const markup = `
    <span class="pp-icon material-symbols-outlined" aria-hidden="true">wb_twilight</span>
    <div class="cockpit-reticle material-symbols-outlined" aria-hidden="true">my_location</div>
    <span class="material-symbols-outlined">
      layers
    </span>
    <span class="data-icon">◇</span>
    <span class="material-symbols-outlined-x">nie</span>`;
  assert.deepEqual([...iconNamesFromMarkup(markup)].sort(), ['layers', 'my_location', 'wb_twilight']);
  assert.deepEqual([...iconNamesFromMarkup(`x.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">search</span>';`)], ['search']);
});

test('zber: názvy skladané v JS — textContent, el(), icon:, mapy ICONS, parametre podľa miest volania', () => {
  const src = `
const FIELD_ICONS = Object.freeze({ wind: 'air', temp: 'device_thermostat' });
function makeButton(doc, className, iconName, title) {
  const icon = doc.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.textContent = iconName;
  return icon;
}
const share = makeButton(doc, 'card-share card-flight-share', 'share', t('flight.share'));
function sync(on, signedIn) { icon.textContent = on ? 'notifications_active' : signedIn ? 'notification_add' : 'lock'; }
const toggleIcon = el('span', 'material-symbols-outlined', '');
toggleIcon.textContent = collapsed ? 'left_panel_open' : 'right_panel_close';
const star = el(doc, 'span', 'material-symbols-outlined state-strip-icon', 'verified');
function button(icon, label) { b.append(el('span', 'material-symbols-outlined', icon), el('span', 'weather-dock-label', label)); }
button(FIELD_ICONS[id] || 'circle', t('meteo.chip'));
function icon(doc, name) { return el(doc, 'span', { className: 'material-symbols-outlined oko-consent-icon', 'aria-hidden': 'true', text: name }); }
const close = el(doc, 'button', { type: 'button' }, icon(doc, 'close'));
items.push({ id: 'toggle', label: t('ctx.layer-off', { name: layer.name }), icon: layer.enabled ? 'toggle_off' : 'toggle_on' });
createConflictsPanel({ launchIcon: 'ios_share', launchLabel: 'Zdieľať' });
const chevron = this.contextToggle.querySelector('.material-symbols-outlined');
if (chevron) chevron.textContent = expanded ? 'chevron_left' : 'chevron_right';
const label = doc.createElement('span');
label.textContent = 'live';
cmd.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">search</span>';
`;
  assert.deepEqual([...iconNamesFromScript(src)].sort(), [
    'air', 'chevron_left', 'chevron_right', 'circle', 'close', 'device_thermostat', 'ios_share', 'left_panel_open',
    'lock', 'notification_add', 'notifications_active', 'right_panel_close', 'search', 'share', 'toggle_off',
    'toggle_on', 'verified',
  ]);
  // Modul bez triedy ikon nič nedáva — vlastnosť icon: vrstvy je jej vlastný glyf.
  assert.deepEqual([...iconNamesFromScript("export default { id: 'cctv', icon: 'warning' };")], []);
});

test('zber: pomocníky — argumenty volania, funkcie s parametrom', () => {
  assert.deepEqual(
    splitCallArgs("doc, 'card-share card-flight-share', 'share', t('flight.share', { a: 1 })) rest", 0),
    ['doc', "'card-share card-flight-share'", "'share'", "t('flight.share', { a: 1 })"],
  );
  assert.deepEqual(functionsWithParam('function makeButton(doc, className, iconName, title) {}', 'iconName'), [{ name: 'makeButton', index: 2 }]);
  assert.deepEqual(functionsWithParam('const button = (icon, label = "") => {};\nconst one = icon => icon;', 'icon'), [
    { name: 'button', index: 0 }, { name: 'one', index: 0 },
  ]);
  assert.deepEqual(functionsWithParam('function f({ launchIcon = null } = {}) {}', 'launchIcon'), []);
});

test('zber v repozitári: každá ligatúra z index.html a známe dynamické názvy zo src', () => {
  assert.ok(collected.names.length >= 60, `našlo sa len ${collected.names.length} ikon`);
  for (const name of iconNamesFromMarkup(html)) assert.ok(collected.names.includes(name), name);
  const tripwires = {
    ios_share: 'src/main.js', // launchIcon: v možnostiach panela konfliktov
    search: 'src/main.js', // innerHTML
    notifications_active: 'src/followedFlights.js', // ternár v textContent
    left_panel_open: 'src/weatherDock.js', // el('span', …, '') + textContent
    right_panel_open: 'src/ui.js', // querySelector('.material-symbols-outlined') + textContent
    circle: 'src/weatherDock.js', // FIELD_ICONS[id] || 'circle' cez parameter button(icon, …)
    air: 'src/weatherDock.js', // mapa FIELD_ICONS
    track_changes: 'src/weatherDock.js', // DOCK_OVERLAYS icon:
    smart_display: 'src/analytics.js', // icon: v kategóriách súhlasu
    close: 'src/analytics.js', // icon(doc, 'close') cez parameter name
    content_copy: 'src/contextMenu.js', // icon: položky ponuky
    toggle_off: 'src/contextMenu.js', // ternár v icon:
    verified: 'src/stateFlightsStrip.js', // el(doc, 'span', 'material-symbols-outlined …', 'verified')
    share: 'src/flightCardActions.js', // makeButton(doc, …, 'share', …) cez parameter iconName
  };
  for (const [name, file] of Object.entries(tripwires)) {
    assert.ok(collected.sources[name]?.includes(file), `${name} z ${file}: ${JSON.stringify(collected.sources[name] || null)}`);
  }
});

test('výrez obsahuje presne ikony z kódu (inak: node scripts/build-icon-font.mjs)', () => {
  const missing = collected.names.filter((name) => !manifest.icons.includes(name));
  const stale = manifest.icons.filter((name) => !collected.names.includes(name));
  assert.deepEqual({ missing, stale }, { missing: [], stale: [] }, 'zoznam ikon vo výreze nesedí s kódom — spusti: node scripts/build-icon-font.mjs');
  assert.deepEqual(manifest.icons, [...manifest.icons].sort());
  assert.deepEqual(manifest.axes, ICON_FONT_AXES);
  assert.match(manifest.license, /Apache License 2\.0/);
});

test('súbor písma: woff2 v jednotkách KB, veľkosť aj odtlačok sedia s manifestom', () => {
  assert.equal(fontBytes.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(fontBytes.length > 1024 && fontBytes.length < 64 * 1024, `${fontBytes.length} B`);
  assert.equal(fontBytes.length, manifest.bytes);
  assert.equal(createHash('sha256').update(fontBytes).digest('hex'), manifest.sha256);
  assert.equal(fontFingerprint(fontBytes), manifest.fingerprint);
  assert.equal(manifest.fingerprint.length, 10);
});

test('index.html: Material písma z Google Fonts preč, preload výrezu pred style.css, text ďalej z Google', () => {
  assert.doesNotMatch(html, /fonts\.googleapis\.com\/css2\?family=Material\+Symbols/);
  assert.doesNotMatch(html, /Material\+Icons/);
  const preload = html.indexOf(`<link rel="preload" href="${ICON_FONT_URL}" as="font" type="font/woff2" crossorigin />`);
  assert.ok(preload >= 0, 'chýba preload výrezu');
  assert.ok(preload < html.indexOf('<link rel="stylesheet" href="/style.css" />'), 'preload má byť pred style.css');
  assert.match(html, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=JetBrains\+Mono[^"]*" rel="stylesheet" media="print" onload="this\.media='all'" \/>/);
  assert.match(html, /<noscript>\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=JetBrains\+Mono[^"]*" rel="stylesheet" \/>\s*<\/noscript>/);
});

test('style.css: @font-face výrezu (display block, lokálny woff2) a trieda ikon ako posledné pravidlo', () => {
  const face = css.match(/@font-face\s*\{[^}]*font-family: 'Material Symbols Outlined';[^}]*\}/);
  assert.ok(face, 'chýba @font-face Material Symbols Outlined');
  assert.match(face[0], /font-display: block;/);
  assert.match(face[0], /src: url\(\/fonts\/material-symbols-subset\.woff2\) format\('woff2'\);/);
  assert.doesNotMatch(css, /fonts\.gstatic\.com|fonts\.googleapis\.com/);
  const cls = css.lastIndexOf('.material-symbols-outlined {');
  assert.ok(cls > 0, 'chýba trieda .material-symbols-outlined');
  const end = css.indexOf('}', cls);
  const block = css.slice(cls, end);
  assert.match(block, /font-family: 'Material Symbols Outlined';/);
  assert.match(block, /font-feature-settings: 'liga';/);
  assert.match(block, /font-size: 24px;/);
  // Štýl z Google bol za style.css, takže jeho pravidlo triedy vyhrávalo nad rovnako silnými pravidlami
  // (.cockpit-reticle, .oko-consent-icon…). Trieda na konci súboru drží to isté poradie, teda ten istý vzhľad.
  assert.equal(css.slice(end + 1).trim(), '', 'trieda ikon musí byť posledné pravidlo v style.css');
});

test('odtlačok ?v= v HTML aj CSS; plugin ho dopĺňa v dev aj v builde, bez súboru nemení nič', () => {
  const sample = `href="${ICON_FONT_URL}" url(${ICON_FONT_URL}) src: url('${ICON_FONT_URL}')`;
  assert.equal(versionIconFontUrls(sample, 'abc'), `href="${ICON_FONT_URL}?v=abc" url(${ICON_FONT_URL}?v=abc) src: url('${ICON_FONT_URL}?v=abc')`);
  assert.equal(versionIconFontUrls(versionIconFontUrls(sample, 'abc'), 'abc'), versionIconFontUrls(sample, 'abc'), 'idempotentné');
  assert.equal(versionIconFontUrls(sample, null), sample);

  const plugin = iconFontCacheBustPlugin({ root: ROOT });
  assert.equal(plugin.enforce, 'pre');
  const v = manifest.fingerprint;
  assert.match(plugin.transformIndexHtml(html), new RegExp(`<link rel="preload" href="${ICON_FONT_URL}\\?v=${v}" as="font"`));
  const dev = plugin.transform(css, `${path.join(ROOT, 'style.css').replace(/\\/g, '/')}?direct`);
  assert.match(dev.code, new RegExp(`src: url\\(${ICON_FONT_URL}\\?v=${v}\\) format\\('woff2'\\)`));
  assert.ok(plugin.transform(css, path.join(ROOT, 'style.css')).code.includes(`?v=${v}`), 'build: id bez query');
  assert.equal(plugin.transform('a{}', path.join(ROOT, 'src', 'main.js')), null, 'iné moduly nechá tak');

  const noFont = iconFontCacheBustPlugin({ root: path.join(ROOT, 'docs') });
  assert.equal(noFont.transformIndexHtml(html), html);
  assert.equal(noFont.transform(css, path.join(ROOT, 'docs', 'style.css')), null);
});

test('vite.config.js registruje plugin tesne pred preloaderCacheBustPlugin', () => {
  assert.match(vite, /import \{ iconFontCacheBustPlugin \} from '\.\/scripts\/lib\/iconFont\.mjs';/);
  assert.match(vite, /\n {6}iconFontCacheBustPlugin\(\{ root: __dirname \}\),\n(?: {6}\/\/[^\n]*\n)* {6}preloaderCacheBustPlugin\(\),\n {4}\],/);
});

test('stavba: URL css2 so zoradenými ikonami, woff2 z odpovede, zoznam codepoints', () => {
  assert.equal(
    googleSubsetCssUrl(['search', 'close', 'search']),
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0&icon_names=close,search&display=block',
  );
  assert.equal(manifest.source, googleSubsetCssUrl(manifest.icons));
  assert.equal(
    fontUrlFromCss("@font-face {\n  src: url(https://fonts.gstatic.com/l/font?kit=abc&v=v382) format('woff2');\n}"),
    'https://fonts.gstatic.com/l/font?kit=abc&v=v382',
  );
  assert.equal(fontUrlFromCss('nič'), null);
  assert.deepEqual([...parseCodepoints('10k e951\nclose e5cd\r\n\n')], ['10k', 'close']);
});
