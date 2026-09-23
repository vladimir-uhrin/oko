/**
 * OKO · Occupied area per DeepState — CesiumJS globe + Turf.js area
 * (standalone demo, 2026-09-23; server part: src/data/deepstateAnalyticsProxy.js).
 *
 * Data: DeepStateMap.live occupied-area GeoJSON from the unofficial GitHub mirror
 * cyterat/deepstate-map-data. The mirror's GPL-3.0 covers its scripts only; the
 * data stay under the DeepState licence. Kept as an explicit exception by the OKO
 * owner — the page must always say whose data it is and how old it is.
 *
 * Order of sources: OKO API (/api/deepstate/analytics: cache, fallback days,
 * rate limit) → only when that API is not there at all (static hosting, file:,
 * origin down behind the tunnel) the mirror directly from the browser. An API
 * answer such as 404/429/502/503 is shown as it is — it does not trigger a
 * second round of GitHub downloads.
 */

(() => {
  'use strict';

  const ION_TOKEN_PLACEHOLDER = 'YOUR_ION_TOKEN_HERE';
  const API_URL = '/api/deepstate/analytics';
  const MAX_FALLBACK_DAYS = 7; // same default as the server: yesterday + 7 older files
  const FETCH_TIMEOUT_MS = 25_000;
  const mirrorUrl = (key) => `https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_${key}.geojson`;

  const $ = (id) => document.getElementById(id);
  const metricDateEl = $('metricDate');
  const metricDateSubEl = $('metricDateSub');
  const metricAreaEl = $('metricArea');
  const metricAreaSubEl = $('metricAreaSub');
  const statusBadgeEl = $('statusBadge');
  const statusMessageEl = $('statusMessage');
  const ionNoteEl = $('ionNote');

  const DATE_SUB = 'mirror file date (UTC) · DeepState itself lags 2–3 days';
  const AREA_SUB = 'incl. Crimea and areas occupied since 2014 · OKO estimate, not a DeepState figure';

  /** Updates the dashboard values and the status badge. */
  function updateDashboard({ date, area, status, message, type, dateSub, areaSub }) {
    if (date !== undefined) metricDateEl.textContent = date;
    if (area !== undefined) metricAreaEl.textContent = area;
    if (dateSub !== undefined) metricDateSubEl.textContent = dateSub;
    if (areaSub !== undefined) metricAreaSubEl.textContent = areaSub;
    if (status !== undefined) statusBadgeEl.textContent = status;
    if (message !== undefined) statusMessageEl.textContent = message;
    if (type) statusBadgeEl.className = `badge badge-${type}`;
  }

  const timeoutSignal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined);

  // 1. CESIUM ION SETUP & 3D VIEWER
  // -------------------------------------------------------------
  let viewer = null;
  let hasIonToken = false;
  let globeProblem = null;
  if (typeof Cesium === 'undefined') {
    globeProblem = 'CesiumJS failed to load (/cesium/Cesium.js)';
  } else {
    // Placeholder on purpose — fill in your own token LOCALLY. Do not commit a real
    // token here: this file is in git and ships to the public site (public/ → dist/).
    Cesium.Ion.defaultAccessToken = 'YOUR_ION_TOKEN_HERE';
    hasIonToken = Boolean(Cesium.Ion.defaultAccessToken) && Cesium.Ion.defaultAccessToken !== ION_TOKEN_PLACEHOLDER;

    const viewerOptions = {
      animation: false,
      timeline: false,
      geocoder: false,
      navigationHelpButton: false,
      homeButton: false,
      sceneModePicker: true,
      infoBox: false,
      selectionIndicator: false,
    };
    if (hasIonToken) {
      // Default ion imagery (Bing Maps Aerial) + Cesium World Terrain.
      viewerOptions.terrain = Cesium.Terrain.fromWorldTerrain();
      viewerOptions.baseLayerPicker = true;
    } else {
      // Without a token ion answers 401: no imagery, no terrain, and nothing says so.
      // Natural Earth II ships with Cesium itself, so the globe still shows.
      viewerOptions.baseLayerPicker = false;
      viewerOptions.baseLayer = Cesium.ImageryLayer.fromProviderAsync(
        Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')),
      );
      ionNoteEl.hidden = false;
    }
    try {
      viewer = new Cesium.Viewer('cesiumContainer', viewerOptions);
      // Look at Ukraine (centre ≈ lon 31.17, lat 48.38). A rectangle instead of a fixed
      // altitude, so the whole country — Crimea included — fits any aspect ratio. On
      // phones the card covers the lower half, so the view reaches further south and
      // Ukraine sits in the upper, free half.
      const narrow = window.innerWidth <= 480;
      viewer.camera.setView({
        destination: Cesium.Rectangle.fromDegrees(22.1, narrow ? 36.2 : 44.3, 40.3, 52.4),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-85), roll: 0 },
      });
    } catch (err) {
      console.error('[deepstate-analytics] globe failed to start', err);
      viewer = null;
      globeProblem = `No 3D globe (${err?.message || 'WebGL unavailable'})`;
    }
  }

  // 2. DATE UTILITIES — mirror files are named by the UTC day of the ~03:00 UTC run.
  // -------------------------------------------------------------
  /** YYYYMMDD for N UTC calendar days ago (1 = yesterday). */
  function getFormattedDate(daysAgo = 1) {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  /** YYYYMMDD → YYYY-MM-DD */
  function formatDisplayDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return dateStr;
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  const formatKm2 = (km2) => `${Math.round(km2).toLocaleString('en-US')} km²`;
  const dayWord = (n) => (n === 1 ? '1 day' : `${n} days`);

  // 3. 3D RENDERING
  // -------------------------------------------------------------
  function collectRings(hierarchy, out) {
    if (!hierarchy) return;
    if (hierarchy.positions?.length) out.push(hierarchy.positions);
    for (const hole of hierarchy.holes || []) collectRings(hole, out);
  }

  async function renderGeoJson(geojsonData) {
    const RED_FILL = Cesium.Color.RED.withAlpha(0.4);
    const RED = Cesium.Color.RED;
    // clampToGround drapes the polygons over the terrain. Cesium drops polygon
    // OUTLINES on clamped polygons (GeometryUpdater: "outline not supported on
    // terrain"), so the solid red outline is drawn as clamped polylines along
    // every outer ring and hole.
    const dataSource = await Cesium.GeoJsonDataSource.load(geojsonData, {
      clampToGround: true,
      fill: RED_FILL,
      stroke: RED,
      strokeWidth: 2,
    });
    const rings = [];
    const t = Cesium.JulianDate.now();
    for (const entity of dataSource.entities.values) {
      if (!entity.polygon) continue;
      entity.polygon.material = RED_FILL;
      entity.polygon.outline = false;
      collectRings(entity.polygon.hierarchy?.getValue(t), rings);
    }
    for (const positions of rings) {
      dataSource.entities.add({
        polyline: { positions, width: 2, material: RED, clampToGround: true, arcType: Cesium.ArcType.GEODESIC },
      });
    }
    viewer.dataSources.removeAll();
    await viewer.dataSources.add(dataSource);
    return rings.length;
  }

  // 4. SPATIAL ANALYTICS (Turf.js) + DASHBOARD
  // -------------------------------------------------------------
  /**
   * Area with turf.area() on the raw GeoJSON; if Turf did not load, the server's
   * figure (same R = 6371.0088 km) — and the label says which one it is.
   */
  function areaOf(geojson, serverKm2) {
    if (typeof turf !== 'undefined' && typeof turf.area === 'function') {
      return { km2: turf.area(geojson) / 1e6, how: 'turf.area' };
    }
    if (Number.isFinite(serverKm2)) return { km2: serverKm2, how: 'server estimate (Turf.js did not load)' };
    return { km2: null, how: 'Turf.js did not load' };
  }

  /** A file is usable only with at least one polygon of positive area (same rule as the server). */
  function isUsable(geojson) {
    const geoms = geojson?.type === 'FeatureCollection' ? (geojson.features || []).map((f) => f?.geometry)
      : geojson?.type === 'Feature' ? [geojson.geometry] : [geojson];
    const polys = geoms.filter((g) => g && (g.type === 'Polygon' || g.type === 'MultiPolygon'));
    if (!polys.length) return false;
    return typeof turf === 'undefined' || turf.area(geojson) > 0;
  }

  function fallbackReason({ fallbackDays, outsideWindow, upstreamUnavailable, upstreamStatus }) {
    if (!fallbackDays) return DATE_SUB;
    if (upstreamUnavailable) {
      return `${DATE_SUB} · mirror not reachable${upstreamStatus ? ` (${upstreamStatus})` : ''} — newest cached file, ${dayWord(fallbackDays)} older than yesterday`;
    }
    if (outsideWindow) return `${DATE_SUB} · no newer file in the last ${MAX_FALLBACK_DAYS + 1} days — newest cached file`;
    return `${DATE_SUB} · yesterday's file missing, ${dayWord(fallbackDays)} older`;
  }

  async function show(geojson, meta) {
    const area = areaOf(geojson, meta.serverKm2);
    const older = meta.fallbackDays > 0;
    updateDashboard({
      date: formatDisplayDate(meta.dateKey),
      dateSub: fallbackReason(meta),
      area: area.km2 === null ? 'unavailable' : formatKm2(area.km2),
      areaSub: `${AREA_SUB} · ${area.how}`,
    });
    if (!viewer) {
      updateDashboard({ status: 'No globe', type: 'error', message: `${globeProblem}. The figures above are still valid (${meta.via}).` });
      return;
    }
    try {
      const outlines = await renderGeoJson(geojson);
      updateDashboard({
        status: older ? 'Older file' : 'Ready',
        type: older ? 'stale' : 'ready',
        message: `${meta.via} · ${outlines} outline rings drawn.`,
      });
    } catch (err) {
      console.error('[deepstate-analytics] render failed', err);
      updateDashboard({ status: 'Render error', type: 'error', message: `Map render failed: ${err?.message || err}. The figures above are still valid.` });
    }
  }

  /** Mirror directly from the browser — only when the OKO API is not there at all. */
  async function loadDirect(why) {
    for (let i = 0; i <= MAX_FALLBACK_DAYS; i += 1) {
      const dateKey = getFormattedDate(1 + i);
      updateDashboard({ date: formatDisplayDate(dateKey), area: 'Calculating…', status: 'Loading', type: 'loading', message: `${why} — fetching the mirror file for ${formatDisplayDate(dateKey)} from GitHub…` });
      let response;
      try {
        response = await fetch(mirrorUrl(dateKey), { signal: timeoutSignal() });
      } catch (err) {
        console.warn(`[deepstate-analytics] mirror ${dateKey} not reachable`, err);
        updateDashboard({ date: 'N/A', area: 'N/A', status: 'Error', type: 'error', message: `The mirror is not reachable (${err?.message || err}).` });
        return;
      }
      if (response.status === 404) continue;
      if (!response.ok) {
        updateDashboard({ date: 'N/A', area: 'N/A', status: 'Error', type: 'error', message: `The mirror answered HTTP ${response.status}.` });
        return;
      }
      let geojson = null;
      try { geojson = await response.json(); } catch { geojson = null; }
      if (!isUsable(geojson)) continue; // broken or empty file: same as missing, try the older day
      await show(geojson, { dateKey, fallbackDays: i, outsideWindow: false, upstreamUnavailable: false, serverKm2: null, via: `Loaded directly from the GitHub mirror (${why})` });
      return;
    }
    updateDashboard({ date: 'N/A', area: 'N/A', status: 'Error', type: 'error', message: `No usable mirror file for the last ${MAX_FALLBACK_DAYS + 1} days.` });
  }

  let retryTimer = null;
  /** Loads the snapshot: OKO API first, direct mirror only if the API is missing. */
  async function loadDeepStatePipeline() {
    retryTimer = null;
    updateDashboard({ date: '…', area: 'Calculating…', status: 'Loading', type: 'loading', message: 'Asking the OKO API (/api/deepstate/analytics)…' });
    if (globeProblem && !viewer) updateDashboard({ message: `${globeProblem} — computing the figures without the globe…` });

    let resp = null;
    let payload = null;
    try {
      resp = await fetch(API_URL, { headers: { Accept: 'application/json' }, signal: timeoutSignal() });
      // Static hosting or a gateway error page answers with HTML — that is "no API".
      if (!(resp.headers.get('content-type') || '').includes('application/json')) throw new Error(`HTTP ${resp.status}, not a JSON API`);
      payload = await resp.json();
    } catch (err) {
      console.warn('[deepstate-analytics] OKO API not available, using the mirror directly', err);
      await loadDirect('OKO API not available');
      return;
    }
    if (payload?.error === 'api_not_routed') { // OKO's static server without the /api route
      await loadDirect('OKO API not routed');
      return;
    }

    if (resp.ok && payload?.ok && payload.geojson) {
      await show(payload.geojson, {
        dateKey: payload.dateKey,
        fallbackDays: payload.fallbackDays || 0,
        outsideWindow: Boolean(payload.outsideWindow),
        upstreamUnavailable: Boolean(payload.upstreamUnavailable),
        upstreamStatus: payload.upstreamStatus ?? null,
        serverKm2: payload.areaKm2,
        via: `OKO API (server cache: ${resp.headers.get('X-OKO-Source') || 'n/a'})`,
      });
      return;
    }

    // The API answered, but without data — say why; do not re-download from GitHub.
    if (resp.status === 429) {
      const s = Number(resp.headers.get('Retry-After'));
      const wait = Math.min(300, Math.max(10, Number.isFinite(s) ? s : 60));
      updateDashboard({ date: '—', area: 'waiting for the API', status: 'Rate limited', type: 'stale', message: `Too many requests to the OKO API — retrying in ${wait} s.` });
      if (!retryTimer) retryTimer = setTimeout(loadDeepStatePipeline, wait * 1000);
      return;
    }
    const why = payload?.error === 'no_data_available' ? `No mirror file in the last ${payload.checkedDays ?? '?'} days.`
      : payload?.error === 'upstream_unavailable' ? `The mirror is not reachable right now${payload.upstreamStatus ? ` (${payload.upstreamStatus})` : ''} and nothing is cached.`
        : payload?.error === 'upstream_slow' ? 'The mirror is too slow right now — try again in a minute.'
          : `OKO API error ${resp.status}${payload?.error ? ` (${payload.error})` : ''}.`;
    updateDashboard({ date: 'N/A', area: 'N/A', status: 'Error', type: 'error', message: why });
  }

  loadDeepStatePipeline();
})();
