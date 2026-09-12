# OKO Blender trial — generic tanker

`oko-tanker.blend` is the editable source, with named hull, deck, bridge,
pipework, rail and lifeboat objects. It was created in Blender 4.5.13 LTS with
the bundled glTF exporter, without paid add-ons or downloaded assets.
The model and its generated GLB are original OKO artwork, available under
CC0 1.0. It is a generic illustration, not a reconstruction of a named ship.

## Open and try

Open this `.blend` file in Blender. The material-coloured viewport is already
framed on the ship.

On the configured Windows PC, the Start menu entries **Blender 4.5 LTS** and
**OKO tanker - Blender** launch the editor and this source file respectively.
Blender was installed per user from the official portable Windows distribution;
the downloaded archive was checked against Blender's published SHA-256 manifest.

For the web version, start OKO as usual and visit:

`http://localhost:4173/demos/tanker/index.html`

The preview uses OKO's bundled CesiumJS, with perspective, side and top views,
mouse orbit and zoom, and a GLB download. It does not request map tiles,
AIS, ion, or any external service. Its illustrative status is visible on screen.
It is an isolated trial: production vessel/aircraft rendering is unchanged.
The preview is also copied into the normal production build under the same path.

## Rebuild

From the repository root:

```powershell
& "$env:LOCALAPPDATA\Programs\Blender\blender-4.5.13-windows-x64\blender.exe" --background --factory-startup --python scripts/build-tanker-model.py
```

The script regenerates the editable `.blend`, `public/models/oko-tanker.glb`
and its metadata `.json`. Save manual edits under a new filename before
regenerating. The Blender source preserves individual editable objects;
the web export joins meshes into one node with eight material primitives.

Units are metres; the Blender model has its bow along +X and up along +Z,
with the origin at the waterline amidships. The GLB converts up to +Y.
The hull is 200 m long and 32 m wide, with a 7 m submerged section and a
mast reaching 39 m above the waterline. Render at scale 1, accounting for
Cesium's glTF axis correction. This is different from the legacy `ship.glb`
scale of 0.03; do not substitute files without adjusting the runtime scale.

## Validation and rollback

```powershell
node --test src/data/tankerAsset.test.mjs
node scripts/qa-tanker-model.mjs
```

The asset tests check exported dimensions, triangle and byte budgets,
embedded resources and the editable source. Browser QA checks real WebGL
loading, camera presets, mouse orbit and mobile layout, and rejects any
external/API request. Screenshots are saved to `qa-shots/blender-tanker/`.

Validation on 2026-09-12 (Node 24.19.0): the two asset tests, browser QA and
production build passed. `npm test` passed all 3,191 ordinary tests and the
focus allocation probe; three existing shared-overlay allocation profiles
exceeded their budgets (147,033/132,000, 151,641/142,000 and
188,459/182,000 bytes per frame). This trial does not modify those runtime
modules or their allocation tests.

The whole trial is additive and isolated on `codex/blender-tanker-trial`.
Reverting its commit removes the model and preview without changing live feeds.
The separately installed Blender remains available from the Windows Start menu.
