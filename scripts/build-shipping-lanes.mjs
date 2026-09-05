// OKO — build the bundled global shipping lanes snapshot.
//
// Fetches the Global Shipping Lanes / Routes GIS dataset (P. Benden, derived
// from the CIA's "Map of The World's Oceans"). The derivative is licensed
// CC BY 4.0 — NOT public domain; only the CIA base map is. Fetch from GitHub
// `main` on purpose: the older Zenodo v1.3.1 deposit is CC BY-NC (see
// SOURCE.md in the destination folder). Converts MultiLineString geometries
// into clean, streaming LineString .geojsonl features (= the "modification"
// that CC BY requires us to indicate).
//
// Usage:
//   node scripts/build-shipping-lanes.mjs
//   SHIPPING_LANES_GEOJSON=path node scripts/build-shipping-lanes.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_URL = 'https://raw.githubusercontent.com/newzealandpaul/Shipping-Lanes/main/data/Shipping_Lanes_v1.geojson';
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/shipping_lanes');
const OUT_FILE = path.join(OUT_DIR, 'shipping-lanes.geojsonl');
const SOURCE_MD = path.join(OUT_DIR, 'SOURCE.md');

async function main() {
  let geojsonRaw;
  if (process.env.SHIPPING_LANES_GEOJSON) {
    geojsonRaw = fs.readFileSync(process.env.SHIPPING_LANES_GEOJSON, 'utf8');
  } else {
    console.log(`Fetching shipping lanes from ${DATA_URL}...`);
    const response = await fetch(DATA_URL, {
      headers: { 'User-Agent': 'oko-shipping-lanes-build/1.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    geojsonRaw = await response.text();
  }

  const data = JSON.parse(geojsonRaw);
  if (!Array.isArray(data?.features)) throw new Error('Invalid GeoJSON: features array expected');

  const lines = [];
  const counts = { major: 0, middle: 0, minor: 0 };
  let totalPoints = 0;

  for (const feature of data.features) {
    const rawType = String(feature.properties?.Type || feature.properties?.type || 'Major').trim();
    const typeKey = rawType.toLowerCase();
    const geomType = feature.geometry?.type;
    const coordsList = geomType === 'MultiLineString'
      ? feature.geometry.coordinates
      : (geomType === 'LineString' ? [feature.geometry.coordinates] : []);

    for (let i = 0; i < coordsList.length; i++) {
      const lineCoords = coordsList[i];
      if (!Array.isArray(lineCoords) || lineCoords.length < 2) continue;

      // Ensure clean 5-decimal precision (~1.1m) to keep bundle compact
      const cleaned = lineCoords.map(([lon, lat]) => [
        Number(Number(lon).toFixed(5)),
        Number(Number(lat).toFixed(5)),
      ]);

      const record = {
        type: 'Feature',
        id: `lane-${typeKey}-${i}`,
        geometry: {
          type: 'LineString',
          coordinates: cleaned,
        },
        properties: {
          kind: typeKey,
          type: rawType,
        },
      };

      lines.push(JSON.stringify(record));
      counts[typeKey] = (counts[typeKey] || 0) + 1;
      totalPoints += cleaned.length;
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${lines.join('\n')}\n`, 'utf8');
  const sizeKb = Math.round(fs.statSync(OUT_FILE).size / 1024);

  const sourceContent = `# Global Shipping Lanes Dataset

## Provenance
- **Source:** [Global Shipping Lanes / Routes GIS Dataset](https://github.com/newzealandpaul/Shipping-Lanes) by newzealandpaul (v1.4, Zenodo DOI: 10.5281/zenodo.6361763).
- **Origin:** Georeferenced from the CIA's "Map of The World's Oceans" (October 2012) + subsequent maritime route corrections.
- **License:** U.S. Government work — Public Domain / CC0 equivalent.
- **Build date:** ${new Date().toISOString().split('T')[0]}
- **Transform:** \`scripts/build-shipping-lanes.mjs\` converts MultiLineStrings to individual LineString records in .geojsonl, rounding coordinates to 5 decimal places.

## Content
- **Total lines:** ${lines.length}
- **Major routes:** ${counts.major || 0}
- **Secondary (Middle) routes:** ${counts.middle || 0}
- **Minor routes:** ${counts.minor || 0}
- **Total points:** ${totalPoints}
- **File size:** ~${sizeKb} KB
`;

  fs.writeFileSync(SOURCE_MD, sourceContent, 'utf8');

  console.log(`[Build:ShippingLanes] Wrote ${lines.length} lanes to ${OUT_FILE} (${sizeKb} KB)`);
  console.log(`Counts: major=${counts.major}, middle=${counts.middle}, minor=${counts.minor}`);
}

main().catch((err) => {
  console.error('[Build:ShippingLanes] Failed:', err);
  process.exit(1);
});
