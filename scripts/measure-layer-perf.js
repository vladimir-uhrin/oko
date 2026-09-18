/**
 * measure-layer-perf.js — ETAPA 0 pred rozšírením potrubí (2026-09-18)
 *
 * NIE je to Node skript. Vlož ho CELÝ do konzoly PREHLIADAČA na
 * https://oko.uhrin.digital (alebo na dev serveri) a stlač Enter.
 *
 * PREČO RUČNE A NIE V CLAUDE BROWSER PANE:
 *   V pane vracajú Google 3D dlaždice 403, stránka je `hidden` a
 *   requestAnimationFrame je škrtený na ~2 fps. Každé číslo namerané tam je
 *   nezmysel. Musí to bežať v normálnom, VIDITEĽNOM okne prehliadača.
 *
 * ČO MERIA:
 *   fps a čas snímku s vrstvou `gas-pipelines` ZAPNUTOU a VYPNUTOU, v poradí
 *   A-B-A (vypnuté → zapnuté → vypnuté), aby sa dal odhaliť drift z doťahovania
 *   dlaždíc. Bez A-B-A sa „vrstva stojí 12 fps" a „medzitým sa donačítal
 *   terén" nedajú rozlíšiť.
 *
 * DVE PASCE, KTORÉ RIEŠI:
 *   1. Render governor (src/renderGovernor.js) drží scénu v requestRenderMode,
 *      keď nič neanimuje — vtedy rAF nemeria záťaž, ale nečinnosť. Skript
 *      súvislý render vynúti a NA KONCI KAŽDÉHO OKNA OVERÍ, že mu to governor
 *      nevrátil späť; ak áno, výsledok označí za neplatný.
 *   2. Doťahovanie dlaždíc dominuje nad všetkým ostatným, takže sa pred každým
 *      oknom čaká na pokoj scény.
 *
 * Výstup na konci vypíše blok, ktorý stačí skopírovať a poslať späť.
 */
(async () => {
  const LAYER = 'gas-pipelines';
  const WINDOW_MS = 6000;     // dĺžka jedného meracieho okna
  const SETTLE_MS = 1500;     // pauza po prepnutí, kým sa scéna upokojí
  const QUIESCE_MAX_MS = 45000;

  const gev = window.__godsEyeView;
  if (!gev?.viewer || !gev?.dataManager) {
    console.error('[perf] __godsEyeView.viewer / .dataManager chýba — appka ešte nedobootovala?');
    return;
  }
  const { viewer, dataManager } = gev;
  const scene = viewer.scene;

  if (document.hidden) {
    console.error('[perf] Karta je na pozadí. requestAnimationFrame je škrtený a meranie by bolo nezmysel. Prepni sa na túto kartu a spusti znova.');
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

  /** Počkaj, kým scéna prestane doťahovať dlaždice (alebo vyprší strop). */
  async function quiesce() {
    const started = performance.now();
    let stable = 0;
    while (performance.now() - started < QUIESCE_MAX_MS) {
      const loaded = scene.globe?.tilesLoaded !== false;
      const tilesetIdle = !gev.tileset || gev.tileset.tilesLoaded !== false;
      stable = (loaded && tilesetIdle) ? stable + 1 : 0;
      if (stable >= 6) return true;       // ~6 pokojných vzoriek po 250 ms
      await sleep(250);
    }
    return false;
  }

  /** Jedno merané okno. Vracia fps a časy snímkov. */
  async function sample(label) {
    await quiesce();
    await sleep(SETTLE_MS);

    const hadRequestRenderMode = scene.requestRenderMode;
    scene.requestRenderMode = false;      // vynúť súvislý render na čas merania

    const times = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (now - t0 >= WINDOW_MS) { done(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // Pasca 1: overiť, že governor režim počas merania nevrátil.
    const governorInterfered = scene.requestRenderMode === true;
    scene.requestRenderMode = hadRequestRenderMode;

    times.shift();                        // prvý interval je zaťažený štartom
    const sorted = [...times].sort((a, b) => a - b);
    const total = times.reduce((s, x) => s + x, 0);
    return {
      label,
      frames: times.length,
      fps: +(times.length / (total / 1000)).toFixed(1),
      msP50: +pct(sorted, 0.50).toFixed(2),
      msP95: +pct(sorted, 0.95).toFixed(2),
      msWorst: +sorted[sorted.length - 1].toFixed(2),
      commands: scene._frameState?.commandList?.length ?? null,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      governorInterfered,
      hidden: document.hidden,
    };
  }

  const setLayer = async (on) => {
    try {
      await Promise.race([
        Promise.resolve(dataManager.setEnabled(LAYER, on, { origin: 'perf-measurement' })),
        sleep(30000).then(() => { throw new Error('setEnabled sa neusadilo do 30 s'); }),
      ]);
    } catch (e) { console.warn('[perf] setEnabled:', e?.message || e); }
  };

  // Počítaj podľa id, ktoré vrstva sama razí (gasPipelinesLayer.js: `${LAYER}:${id}`),
  // nie podľa názvu dátového zdroja — ten je len kozmetický.
  const entityCount = () => {
    let n = 0;
    for (let i = 0; i < viewer.dataSources.length; i++) {
      for (const e of viewer.dataSources.get(i).entities.values) {
        if (String(e.id || '').startsWith(LAYER + ':')) n += 1;
      }
    }
    return n;
  };

  // ── kontext, nech je číslo pripísateľné konkrétnemu stroju ────────────────
  let renderer = 'unknown';
  try {
    const gl = scene.context._gl || scene.canvas.getContext('webgl2') || scene.canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  } catch { /* nevadí */ }

  const wasEnabled = dataManager.isEnabled(LAYER);
  const camBefore = {
    destination: scene.camera.positionWC.clone(),
    direction: scene.camera.direction.clone(),
    up: scene.camera.up.clone(),
  };

  // Deterministický pohľad: stredná Európa z ~600 km, pohľad kolmo dole.
  // POZOR: window.Cesium existuje LEN v DEV builde (src/main.js:383), na
  // oko.uhrin.digital nie. Statické metódy žijú na konštruktore, tak si ho
  // požičiame zo živej inštancie — funguje v oboch buildoch.
  const Cartesian3 = scene.camera.positionWC.constructor;
  scene.camera.setView({
    destination: Cartesian3.fromDegrees(17.11, 48.15, 600000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });

  console.log('[perf] meriam… ~40 s, NEHÝB myšou ani kamerou a nechaj kartu vpredu');

  await setLayer(false);
  const offA = await sample('vypnuté (A)');
  await setLayer(true);
  const on = await sample('ZAPNUTÉ');
  const entities = entityCount();
  await setLayer(false);
  const offB = await sample('vypnuté (B)');

  // obnov pôvodný stav
  await setLayer(wasEnabled);
  scene.camera.setView({ destination: camBefore.destination, orientation: { direction: camBefore.direction, up: camBefore.up } });

  const offAvg = (offA.fps + offB.fps) / 2;
  const drift = Math.abs(offA.fps - offB.fps);
  const driftSuspect = drift > Math.max(3, offAvg * 0.1);
  const invalid = offA.governorInterfered || on.governorInterfered || offB.governorInterfered
    || offA.hidden || on.hidden || offB.hidden;

  const report = [
    '───────── OKO · etapa 0 · výkon vrstvy gas-pipelines ─────────',
    `GPU:            ${renderer}`,
    `Okno:           ${innerWidth}×${innerHeight}, devicePixelRatio ${devicePixelRatio}`,
    `Entít vrstvy:   ${entities}`,
    '',
    ...[offA, on, offB].map((r) =>
      `${r.label.padEnd(14)} fps ${String(r.fps).padStart(5)} | p50 ${String(r.msP50).padStart(6)} ms | p95 ${String(r.msP95).padStart(6)} ms | max ${String(r.msWorst).padStart(7)} ms | cmd ${r.commands ?? '?'} | heap ${r.heapMB ?? '?'} MB`),
    '',
    `Cena vrstvy:    ${(offAvg - on.fps).toFixed(1)} fps (${offAvg.toFixed(1)} → ${on.fps})`,
    `Drift A vs B:   ${drift.toFixed(1)} fps${driftSuspect ? '  ⚠ VYSOKÝ — scéna sa počas merania menila, zopakuj' : '  ✓ nízky'}`,
    invalid
      ? '⚠ NEPLATNÉ: governor vrátil requestRenderMode alebo bola karta skrytá. Zopakuj s kartou vpredu.'
      : '✓ Meranie platné (súvislý render držal, karta bola vpredu).',
    '──────────────────────────────────────────────────────────────',
  ].join('\n');

  console.log(report);
  try { await navigator.clipboard.writeText(report); console.log('[perf] Skopírované do schránky.'); }
  catch { console.log('[perf] Schránka nedostupná — označ text vyššie a skopíruj ručne.'); }
  return report;
})();
