# God's Eye View Current State

### OKO Blender tanker trial (2026-09-12)

An original Blender tanker is available as an isolated Cesium preview at
`/demos/tanker/index.html`. The editable source is
`assets/blender/oko-tanker.blend`, with generator `scripts/build-tanker-model.py`
and web asset `public/models/oko-tanker.glb`. The preview offers orbit/zoom,
three camera presets, mobile layout and model download without external/API
requests. It is clearly labelled as an illustration, not a live vessel.
Production vessel and aircraft renderers are unchanged. See
`assets/blender/README.md` for dimensions, rebuild, validation and rollback.

### OKO maritime historical context (2026-09-09)

The live AIS row has an additive historical-context panel implemented in
`src/data/maritimeHistoryPanel.js`. **Placement fixed 2026-09-12** (user, pointing at the
block pinned above the whole rail: "treba to spojiť s loďami"): the block is no longer
prepended to the top of the layer rail on mere registration; `_renderToggles` appends it
INSIDE the `ais-live-vessels` row after the row's meta/controls, `hidden` while the layer
is off, and `_refreshTogglePanel` re-syncs both the `hidden` state and the block's Undo
enablement through `root._syncMaritime` (the Undo chip used to recompute only inside its
own click). The block lost its `<strong>` title (the row already says what it is; the title
survives as `aria-label`), the note was cut to one sentence in EN and SK, and the CSS is an
in-row dashed sub-block instead of a standalone card. Tripwires in
`maritimeHistoryPanel.test.mjs`. It enables existing shipping-lane, port and
historical density layers, with session Undo that preserves previously enabled
layers and subsequent independent visibility choices. A separate Hormuz button
frames the Persian Gulf at regional scale. Source-period copy explicitly states
that the World Bank / IMF density is January 2015–February 2021 and not current
vessel positions; OSM/Bing and zoom-out guidance preserves the existing density
rendering restrictions. No live AIS ingestion, retention, keys, or provider
requests change. Recent GFW history is not integrated (authenticated access has
not been established). Rollback and next-stage notes: `docs/MARITIME-HISTORY.md`.

Updated: August 24, 2026

> **2026-08-23 — first-run mission launcher** (`src/firstRunExperience.js`,
> `#first-run-launcher`, styles at the tail of `style.css`). After startup
> settles, a fresh session gets one card offering **Live Contacts · Space
> Missions · Environmental · Explore manually**. No layer and no optional API
> call happens until a tile is clicked. The right-hand DISPLAY rail
> (`pp-toggles`) now starts **collapsed** on a first run rather than expanded —
> a stored collapse state still wins, as before.
>
> **The ENVIRONMENTAL tile is quakes AND fires** — live USGS earthquakes plus
> NASA FIRMS active fires (`layerIds: ['earthquakes', 'local-firms']`), with the
> tile subcopy naming both. **The launcher optimizes for the fully configured
> experience:** it does not trim what it offers down
> to the lowest-configured install. The mission does not branch on whether a key
> is present — everyone gets the same tile.
>
> Keyless, the honest surface is the **layer row**, which reads
> `UNAVAILABLE · NASA FIRMS · LIVE · KEY REQUIRED`, and the earthquakes half
> still delivers in full. The shared loading reducer now treats an explicitly
> declared missing optional key as a configured terminal state rather than a
> failed multi-layer mission, so the global chip completes without showing
> `LOAD FAILED`. A genuine lifecycle or fetch failure still retains failure
> priority.
>
> **Acceptance changed with that ruling (2026-08-23).** `qa-firstrun` no longer
> asserts "a keyless Environmental never shows a failure chip" — that stopped
> being a launch requirement when the tile went back to promising both feeds.
> The Environmental section now **branches on the observed key state** and says
> which branch it took: KEYED asserts both datasets actually arrive and that no
> LOAD FAILED banner appears while the mission runs; KEYLESS asserts the
> layer-row honesty (`KEY REQUIRED`), the quakes half loading, and that the
> deliberate missing-key state never becomes a global failure.
>
> **An INFRASTRUCTURE tile is deliberately absent.** It was built, playtested,
> and cut: one click enabling `local-datacenters` + `local-dams` +
> `telegeography-submarine-cables` puts ~5,700 entities on a full-earth view and
> the frame rate goes with them. The layers are unchanged and still reachable by
> hand and by voice ("infrastructure mode" is still mapped). Do not re-add the
> tile before the bundled-infra globe-LOD declutter lands — that is the real
> fix, and it is post-launch work.
>
> **Show policy — it is NOT one-shot.** Precedence, highest first: a share link
> never sees it → `?welcome=0` suppresses → `?welcome=1` replays (past both
> suppressions, for demos/support) → the durable
> `localStorage['gev:first-run-mission:v1'] === 'suppressed'`, written **only**
> by the "Don't show this again" checkbox → the per-session
> `sessionStorage['gev:first-run-mission-session:v1'] === 'dismissed'`, written
> by **every** close path (mission, Explore, ESC). So it returns each fresh
> browser session until the visitor ticks the box; clearing storage un-ticks it,
> which is accepted. Both stores fail open — an unreadable store still shows the
> launcher rather than silently swallowing first launch.
>
> **What a mission may persist (do not "simplify" this).** Layer enablement is
> durable in this app (`gev:layer-state:v2`, written by
> `LayerStateCoordinator._commitExplicit` only for origin `user`/`voice`/`tool`).
> **Session-only layers** (`session: true` in `LAYER_STATE_REGISTRY` — today only
> `meteo-gfs`; 2026-09-12, user: „meteo sa bude zapínať manuálne" after it kept
> coming back on every reload) are dropped by `normalizeLayerState`, so they are
> never written to `gev:layer-state:v2`, never restored on load and never encoded
> into share links (an old `l=…6…` link just ignores the token); they start OFF on
> every load and are switched on by hand. `SESSION_ONLY_LAYER_IDS` /
> `isSessionOnlyLayer()` expose the set.
> A mission enables **its own** layers at `origin: 'user'` — durable, exactly as
> clicking those rows is, because picking the mission *is* that choice. The two
> Context missions also expand the Context panel, as the visible tabs do; the
> globe missions open no panel. Everything else is off limits: detection
> mode/density, `gev:detection-allocation:v1`, 3D models, feather, and above all
> `_detectionUserOverridden` — setting that flag means "the operator hand-edited
> detection" and would silently disable the CRT/NVG/FLIR auto-preset contract for
> the session. The full table is a comment block in the module and is pinned by
> `src/firstRunExperience.test.mjs`.
>
> **Voice is instruction-only.** Both globe missions are expressible with
> shipped tools (`set_layer_visibility`'s enum already carries
> `local-datacenters`, `local-dams`, `telegeography-submarine-cables`,
> `local-firms`, `earthquakes`; `zoom_to_globe` supplies the camera), so
> `GEV_REALTIME_TOOLS` is **byte-identical to `main`** and pinned by sha256 in
> the unit suite. One instruction paragraph in `vite.config.js` teaches the
> phrase mapping; deleting it is the complete rollback.
>
> **ESC arbitration — three rules, do not collapse them into one.** (1) The
> launcher **yields**: a MutationObserver watches `body` for the surfaces that
> take the screen (`cockpit-mode`, `scene-playback-mode`, `recording-mode`,
> `ui-clean-view` — `EXCLUSIVE_SURFACE_CLASSES`, kept in step with the CSS hide
> rule by a unit pin), and session-dismisses rather than contesting the key; if
> one is already up at init it **waits** instead of appearing over it. (2) A
> surface can take the screen with **no class to watch** — the Cesium attribution
> lightbox is full-screen at `z-index: 200` against the card's `175`, which left
> the launcher measurable (`getClientRects()` non-empty) and buried, so ESC
> dismissed a card nobody could see and burned the session flag. `isTopmost()`
> therefore also **hit-tests the card's own centre** with `elementFromPoint`; any
> overlay, classed or not, disarms the handler. Every inconclusive answer counts
> as uncovered, so the guard can never be why ESC stops working. (3) A small
> control that claims only the **key** (a disclosure, a popover) is not something
> to yield to: whoever handles ESC first calls `preventDefault()` **and**
> `stopImmediatePropagation()`, and the launcher skips `defaultPrevented` events.
> `stopPropagation()` alone does **not** stop later listeners on the same
> `document` — that is exactly how the compact Radio disclosure made one key
> close the disclosure *and* dismiss the launcher.
>
> **Accepted:** a surface class that never clears means no launcher for that page
> load, with no timeout. None of the four classes is restored at startup, so an
> already-blocked init is an error path, while a long recording or clean-view
> session is ordinary — a "reveal anyway" timer would trade a benign no-show for
> the card punching through a recording in progress. The no-show is benign: the
> handler is inert, no session flag is written, the observer still reveals the
> card if the class clears, and it returns next session either way.
>
> **Blocked storage un-ticks the box.** "Don't show this again" is a claim about
> the future, so a refused `setItem` reverts the checkbox and says so in the
> status line instead of showing a saved preference that was never saved.
>
> Gates: `node scripts/qa-firstrun.mjs --url <app>` (in-app checks across eight
> independent sections) plus its `--teeth` negative control, which removes
> the launcher and requires EVERY launcher-dependent section to go red — it
> always exits non-zero, `1` meaning the control is healthy and `2` meaning it
> is not. Plus the unit pins above.

> **2026-08-08 — performance waves 1+2:** the app idles via an explicit render
> governor (`src/renderGovernor.js` — hold/release from every per-frame
> animator; discrete mutators call `governorRequestRender`). Any NEW
> per-frame visual animation MUST register a hold; any new discrete scene
> mutation MUST request a frame — `scripts/qa-perf.mjs` is the gate. The
> circular scope is an explicit canvas (`src/scopeMask.js`, DISPLAY-rail
> SCOPE toggle + FEATHER slider, hash keys `sc`/`scf`) — it is NOT the
> six zero-intensity style stages anymore (those are disabled; see the
> history note in `_initStages`). Hidden tabs stop the render loop.
> The scope's OUTSIDE terminus is **altitude-adaptive** (2026-08-17): 0.94
> at/above **10 Mm**, so
> faint stars survive in the corners of a TRUE full-globe view, fading quickly
> (smoothstep) to fully opaque by **7 Mm** — every working altitude below that
> is solid black, because there the same 6% bleed reads as smeared geometry.
> FEATHER is unaffected by the terminus ramp and there is NO new slider (its own
> default later moved 35 → 0 on 2026-08-22, 0 → 8 on 2026-08-23, and 8 → 11 at
> the 2026-08-24 final lock; see Current
> Global Post Defaults); hash key
> `sce` pins the terminus and is **clamped to 94..100 on BOTH parse and write**
> (out-of-range clamps into the band; absent or non-numeric = the adaptive
> default), so a shared link can neither freeze the ramp by accident nor carry
> an unsupported sub-94 terminus. Repaints are gated on a quantized 0.005 alpha
> step, so a full 20 Mm→ground descent costs 12 canvas repaints (the alpha span
> sets that, not the altitude span) and a parked camera costs zero. That
> quantization also means the PAINTED value plateaus at each end of the band:
> measured, the painted terminus stays 0.94 from the top of the band down to
> ~9.63 Mm (first step), and is solid black from ~7.37 Mm (last step) rather
> than exactly at the 10 Mm / 7 Mm clamp heights. SCOPE OFF costs less still:
> no height sampling and no canvas work after the single clear on the disable
> transition. The hard-crop (FEATHER 0) path honors the same terminus.

This is the current runtime/source-of-truth snapshot for the project.

> [!IMPORTANT]
> **Delta since the July-2 body below** (the detailed sections are still accurate
> for everything they describe; these landed after):
> - **"Never answered yet" is a THIRD state, distinct from empty (2026-08-23):**
>   `sourceState` in `src/data/militaryAwareness.js` treats a dependency that is
>   busy AND has never produced an answer (`loading === true && !lastUpdate`) as
>   unavailable, so the Contacts panel prints `?` and voice says "unknown". This
>   is deliberately NOT "busy": a source that has answered once keeps its real
>   count through every later refresh poll. It is a CONTRACT over the whole
>   dependency list rather than a fix for one layer, and the dependencies reach
>   it by different routes:
>   - **AIS vessels is its reachable producer.** `enable()`/`update()` both
>     resolve as soon as the first `/api/ais-live` poll answers, so the manager's
>     lifecycle settles to `enabled` — but until the server-side socket delivers
>     a position, `firstConnectPhase` stays `'loading'` and `getStats()` reports
>     `loading: true`, `lastUpdate: null`, count 0, and an UNDEFINED status.
>     Without the predicate that window prints an all-clear `0`.
>   - **Mapped installations never reaches that window.**
>     `militaryInstallations.enable()` is synchronous and the manager awaits
>     `update()`, which owns the first Overpass fetch, so the lifecycle stays
>     `enabling` for the whole fetch and the pre-existing `enabling` branch
>     covers it. Confirmed live on :4272 across a held 17 s first fetch (34
>     samples, `enabling` throughout, panel non-numeric) and across a failing
>     one. Its `status: 'idle'` is not what saves it — the lifecycle is; the
>     module has no `loading` status at all.
>
>   Any new dependency that can be slow must report `loading` and `lastUpdate`
>   honestly for the contract to hold, and must be pinned against the shape its
>   own module really returns — a fixture that invents a status the module cannot
>   emit guards nothing (that is exactly how a hole here survived a green suite).
> - **A held ground snap is dropped when measured ground contradicts it
>   (2026-08-23):** the WARM hold described below answers on DISTANCE travelled,
>   which is only a proxy for whether the value still describes the ground. A
>   contact can taxi ~200 m onto a different surface INSIDE the 250 m bound, and
>   since a miss preserves the hold, nothing would ever correct the burial. So
>   `heldSnapM` (`src/data/groundSnap.js`) also consults `cachedMeshFloor` at the
>   contact's CURRENT position: a measured floor more than
>   `HELD_SNAP_CONTRADICTION_M` (5 m) ABOVE the held value drops the hold and the
>   contact is COLD again, back to the floored 2D billboard. The rule is
>   ONE-SIDED on purpose — it targets BURIAL. A cell reading BELOW a real sample
>   is the floor chain's expected under-read (one-shot latch over ~111 m,
>   neighbours lean lowest, `displayFloorHeightM` only ever raises), not evidence
>   of anything, and a two-sided cut was disproved on the track rig by a planted
>   cell 66.7 m below a real sample at the same spot. Accepted residual, stated
>   with its condition: a DOWNHILL taxi floats, and the only correction on this
>   path is a SUCCESSFUL resample — nothing guarantees one. On the OSM fallback
>   `sampleHeight` misses forever, so the float persists for as long as the
>   contact stays inside the 250 m bound, with no timer beside it and no vertical
>   cap of its own beyond whatever the ground drops within that radius. It is
>   accepted because it errs UPWARD and stays visible. Three boundaries are
>   load-bearing — that one direction, MESH cells only
>   (`cachedGroundFloor`'s DEM fallback is a DIFFERENT surface; the skin/DEM
>   spread is what `MESH_FLOOR_BELOW/ABOVE_PRIOR_M` budget 15 m / 80 m for) and
>   the contact's OWN cell only (a neighbour ~111 m away may be a terminal roof —
>   `neighborFloorM` leans lowest for that reason — and must never be borrowed to
>   DISCARD a real measurement). Do not widen either without re-arguing both.
> - **The trail's acceptance bar is visual (2026-08-23):**
>   the trail terminates roughly BACK-CENTRE on the aircraft; MINOR hull overlap
>   is acceptable; there is no conspicuous top, bottom or lateral protrusion; it
>   is stable across headings; and a parked aircraft draws no moving head
>   segment. That is the bar a future change is judged against — NOT sub-metre
>   precision. The pins below are tighter than the bar on purpose, because a
>   measurable property is what a test can hold, but a pin's tolerance is not the
>   product requirement and tightening one is not an improvement to the picture.
>   Measured on live traffic at the shipped transform, the airliner anchor sits
>   24.09 m aft (70 % of the model's rendered envelope, so inside it), 2.22 m
>   below centre (6 %), and 2e-9 m off the centreline.
> - **The tracked trail attaches to REAL HULL, aft and below (2026-08-23):**
>   `MODEL_TRAIL_ANCHOR_NATIVE` (`src/data/modelVisualAnchor.js`) holds, per GLB
>   and in RAW glTF coordinates (see the transform-chain entry below), the point
>   of the hull's CENTRELINE PROFILE (its y = 0 slice) closest to the aft-belly
>   AABB corner. It is NOT the corner: a bounding-box corner is empty
>   space, 4.80 m off the nearest triangle on `airplane.glb` and 6.14 m on
>   `jet.glb`, so the trail ended in mid air beside the aircraft. The head segment
>   is drawn from a point behind the aircraft to this anchor, so the anchor must
>   stay aft (83–96 % of each aft extreme) or the segment enters at the tail and
>   stops inside the fuselage. `modelScale.test.mjs` reads the POSITION BUFFERS —
>   real vertices and triangles, because accessor min/max cannot tell a corner
>   from a surface — and re-derives on-hull, aft, lowest-at-its-station,
>   on-centreline, and the construction itself. Re-measure, never re-guess.
> - **The trail anchor rides CESIUM'S transform chain, not a hand-rolled one
>   (2026-08-23 regression fix):** `MODEL_TRAIL_ANCHOR_NATIVE` stores RAW
>   glTF coordinates and `modelAnchorWorld()` assembles
>   `modelMatrix × components.transform × axisCorrection` — the same chain
>   `ModelSceneGraph` renders with, built from Cesium's own exported
>   `Axis.Y_UP_TO_Z_UP` / `Axis.Z_UP_TO_X_UP` and the model instance's own root
>   transform. The anchors were previously PRE-CONVERTED by a single glTF
>   Y-up → Z-up step (`[x,y,z]` → `[x,−z,y]`) and multiplied straight by
>   `modelMatrix`; that is half the correction (the defaults also apply
>   `Z_UP_TO_X_UP`, the complete mapping being raw `[x,y,z]` → `[z,x,y]`), and an
>   aircraft's longitudinal axis is raw glTF X, so the aft offset landed on the
>   RENDERED model's LATERAL axis. `modelMatrix` carries the heading, so both
>   frames rotated together and the trail terminated a fuselage-length to one
>   SIDE, swapping sides with the course. Measured live in each aircraft's own
>   (aft, cross, up) frame: civil airliner (0.00, −81.47, −7.50) before,
>   (81.47, 0.00, −7.50) after; rotorcraft (0.00, −73.67, −16.33) →
>   (73.67, 0.00, −16.33). **Never pre-convert an anchor** — one transform,
>   Cesium's, or a second hand-maintained convention drifts again. The pin sweeps
>   headings 0/45/90/180/270/315 across every shipped asset plus a hovering
>   rotorcraft and asserts NO lateral component, and it derives its reference axes
>   from the ENU frame and the heading rather than through the function under
>   test: the first version routed them through `modelAnchorWorld` and passed
>   against the very bug it was written for, because a wrong transform rotates the
>   anchor and its reference frame together.
> - **A stationary contact draws no trail head, and the head end NEVER gives
>   (2026-08-23):** grounded tracking starts a trail unconditionally, and on a
>   contact that has not moved the last body point sits where the aircraft is — so
>   the head segment became a line from inside the model out to its own anchor,
>   through half the fuselage. `trailHeadStart()` decides where that segment
>   starts being drawn: nothing while the last body point is no further from the
>   model centre than the ANCHOR'S OWN STATION (every millimetre would be drawn
>   forward of the attachment point, into the fuselage — a parked contact sits at
>   exactly zero), the whole segment once it has cleared the model's rendered
>   ENVELOPE, and between them the drawn start slides along the segment so the
>   visible length grows CONTINUOUSLY from zero. Three earlier cuts are recorded
>   because their shape matters: testing segment LENGTH against the radius HID
>   real trail (58 m aft of `airplane.glb`'s 34.41 m envelope gives a 33.98 m
>   segment, suppressed, though ~23.6 m of it is open air); CLIPPING at the
>   envelope and keeping only what lay outside stopped a moving trail visibly
>   SHORT of the aircraft, since a bounding sphere encloses a lot of empty space
>   around a slender airframe; and a BOOLEAN containment test flashed 10.33 m of
>   trail on and off across 2 cm of travel at the boundary, and again on any fix
>   that fell back inside. The END is never cut — that end is the whole point.
>   `radiusM` carries `computedScale`, so the verdict is the same at every camera
>   distance, and any contact that has moved more than its own size (every
>   airborne one: 30 s of flight is kilometres) gets bit-identical geometry to the
>   containment rule this replaces.
> - **The AIR bracket alpha floor SCALES with the OUTSIDE slider (2026-08-23):**
>   `aircraftBracketAlphaFloor` (`src/data/detectionPolicy.js`) is piecewise
>   linear through 0 → 0, **the default → 0.35**, and 100 % → 1.0. The default
>   value reproduces the previously shipped flat 0.35 exactly at every keyhole
>   alpha, so the approved bracket look is unchanged; a flat floor made every
>   reachable stop below 35 % paint identically. `AIRCRAFT_BRACKET_FLOOR_ANCHOR`
>   mirrors `KEYHOLE_OUTSIDE_OPACITY_DEFAULT` (kept Cesium-free on purpose), the
>   two are pinned together, and **the anchor MOVES WITH THE DEFAULT** — both are
>   `0.01` since the 2026-08-24 final lock (`0.03` on 08-23, `0.05` before). That pin is the
>   tripwire for a default move: the mapping is pinned to bracket BRIGHTNESS,
>   not slider position. The `detection-opacity-slider` `step` is **1** so low values are
>   reachable — the mapping was always continuous from 0, but at the
>   previous step of 5 the entire sub-default range was one stop wide. Both the
>   markup and the ordering of 1–5 % are pinned in `detectionPolicy.test.mjs`.
> - **A grounded contact HOLDS its floor through a terrain outage (2026-08-21):**
>   when the Re:Earth proxy fails, the floor cells a grounded contact stands on
>   never warm, and the un-clamped render height for a contact reporting no
>   altitude at all is the GEOID — ~150 m below the ground at an inland field.
>   Both steps now hold instead. At POLL time `geoidSurfaceLastResortM()`
>   (`src/data/renderAltitude.js`) withholds the geoid guess from any contact
>   that already has a `renderAltitudeM`, so the sentinel path holds that height;
>   the guess is reserved for a genuine first sighting. At DISPLAY time
>   `_heldDisplayFloorM()` (`src/data/flights.js`) answers with the contact's own
>   last resolved floor — valid within `HELD_FLOOR_MAX_DRIFT_KM` (1 km, one
>   rollout's worth of travel) of the cell that supplied it — and otherwise with
>   a resolved ADJACENT cell via `neighborFloorM()`, which takes the LOWEST of
>   at least `NEIGHBOR_FLOOR_MIN_SAMPLES` (2) resolved neighbours and otherwise
>   refuses. An earlier cut leaned HIGH, reasoning from "never below the visible
>   surface"; that principle is about a contact's OWN measured ground and it
>   inverts for a BORROWED cell, as playtesting confirmed — planes
>   floating at terminal gates. The errors are not symmetric: too LOW is inert
>   (`displayFloorHeightM` only ever raises, so an under-reading floor simply
>   does not lift, bounded by one cell of grade), while too HIGH invents a
>   position bounded by BUILDING height and a parked contact holds it — measured
>   at 29.5 m of permanent float from a lone roof neighbour. A plane at a gate is
>   on the apron, never on the roof. The honest residual is the mirror image: on
>   a genuine slope the lowest neighbour under-reads, so the clamp lifts a little
>   less than it could, which shows up as no lift rather than a wrong one and is
>   corrected as soon as the contact's own cell warms. Both tiers are validated
>   measurements out of the shared floor cache; with neither available the
>   position passes through untouched, exactly as before. Adjacent-cell probes
>   are throttled per contact (500 ms) and rationed no further: a probe is eight
>   synchronous `Map` reads with no I/O — every DEM request is driven by
>   `warmGroundFloor` from the poll loop, bounded there — and 200 synchronised
>   all-cold contacts probing on the same tick measure 1.0 ms median / 1.2 ms worst on the all-cold workload (a noisier ad-hoc run of the same workload peaked at 2.1 ms), 1.4% of one 80 ms
>   fleet tick (`scripts/qa-floorhold-probe-cost.mjs`). A global per-tick budget
>   with a fairness queue was built over that and DELETED: it protected single-
>   digit milliseconds and produced two starvation defects. Nothing can starve
>   because there is no shared resource to be starved of.
>   A floor that moves DOWN under a contact standing on a BORROWED one is
>   APPROACHED exponentially (`FLOOR_EASE_TAU_MS`, 360 ms — ~20% of the
>   remaining gap per fleet tick, hard-capped at `FLOOR_EASE_MAX_STEP` so a
>   delayed or stalled tick cannot close more) from the value currently displayed, rather than
>   interpolated from a fixed anchor over a fixed duration. The target moves: a
>   second, lower neighbour can warm mid-approach, and re-evaluating a fixed
>   anchor against a moved target jumps by the eased fraction of the change
>   (measured at 100 m in one tick). Approaching from the displayed value has no
>   such seam. Rises are always taken whole, including mid-approach, since an
>   eased rise is time spent under the mesh; a change between two resolved floors
>   keeps its existing timing. The hold state is retired the moment a contact
>   stops being a grounded billboard (airborne or model-owned), but the floor
>   itself is PARKED as a rehydration seed rather than destroyed: deleting it
>   outright let an `on_ground` flap through a rotation cold-start the contact
>   under the runway (observed with VIR138M at JFK). **A seed is a memory, not
>   a reading**, and three bounds keep it honest. `HELD_FLOOR_MAX_DRIFT_KM`
>   refuses it more than a kilometre from where it was measured.
>   `FLOOR_SEED_GRACE_MS` (90 s, three polls) expires it on wall-clock age,
>   judged BOTH while the contact is away and AGAIN at the moment it re-grounds —
>   a contact that makes no calls in between (off the poll on a cruise, outside
>   the corridor radius, tab hidden) never reaches the first check, and an
>   earlier cut that only had that one reused a floor parked 198 s earlier. And
>   the seed ranks BELOW the neighbour tier: two freshly resolved adjacent cells
>   overrule it, which is what stops a contact re-grounding half a kilometre
>   away from floating on the field it left (measured before that rule: a 200 m
>   seed held over a 100 m/105 m neighbourhood, 100 m in the air). So a short hop
>   back onto the same apron inside the grace window and the drift bound DOES
>   reuse its floor — deliberately, and only while nothing fresh contradicts it.
>   What starts clean is a genuine departure. A model→billboard handoff retires
>   and rehydrates by exactly the same rules. What none of this fixes is the flap
>   tick ITSELF: the display clamp passes airborne positions through by design
>   (an airborne height is the fix-time clamp's job), and at a sea-level field
>   the airborne fix IS baro + geoid N, ~4 m under the runway. That is an
>   accepted one-tick transition residual, and
>   `scripts/qa-floorhold-staircase.mjs` §F1 counts every tick so it stays
>   visible: 1 of 23 ticks below the runway, all of it that airborne tick, 0 of
>   22 grounded ticks — against 12 of 22 grounded and not recovering before the
>   seed existed. **A third tier that read the rendered mesh
>   where no DEM existed to validate it was built and REMOVED** — measured
>   against a real GPU with the proxy down, it recorded a coarse-LOD 20.6 m for
>   ground that is really ~122 m; `tilesLoaded` goes true while coarse tiles are
>   what is loaded, so without a DEM prior there is nothing to tell a surface
>   from a mis-hit. Gates: `scripts/qa-floorhold-mutations.mjs` (22 named
>   defects, each reverted individually and required to go red) and
>   `scripts/qa-floor-hold.mjs` (live, real GPU — the proxy is failed mid-run and
>   the contact is measured against `scene.sampleHeight`). This floor-hold path
>   currently applies to `flights.js`; `militaryFlights.js` does not use it.
> - **Screen picks are validated before conversion (2026-08-21):** anything that
>   comes back from `scene.pickPosition()` must clear
>   `isPickedWorldPosition()` (`src/data/scenePick.js`) before it is converted
>   to a Cartographic. The guard is a magnitude BAND — 6,000,000 m to
>   1,000,000,000 m, plus finite components — not a null check, because a depth
>   read over empty sky can return a Cartesian that Cesium mishandles three
>   different ways: non-finite throws `DeveloperError: normalized result is not
>   a number`, exactly `(0,0,0)` returns undefined, and a near-center value such
>   as `(500,0,0)` converts SILENTLY into a point 6,378 km underground that
>   reverse-geocodes as 0°, 0°. The floor sits ~346 km below the smallest real
>   surface magnitude (WGS84 polar radius 6,356,752 m); the ceiling is ~24×
>   geostationary, so no real contact is rejected. **A degenerate pick is a
>   MISSED pick:** the cascade in `getViewTargetCartesian()` and
>   `pickWorldFromScreen()` falls through to `pickEllipsoid` and then the globe
>   ray, and callers receive the same `null` they already handle for a miss —
>   there is no new sentinel. Two consumers had no owner for a throw and were
>   hardened to match: the moveEnd view-target prewarm runs inside
>   `requestIdleCallback` (now catches and reports once per viewer at
>   `console.debug`), and `IntelHUD._updateSummary()` awaits its context INSIDE
>   a guard, because every caller invokes it as `void this._updateSummary(...)`
>   and a rejection there is ownerless. Gate:
>   `scripts/qa-view-target-prewarm.mjs`.
> - **Scene playback ownership + reconcile (2026-08-20):** five corrections to
>   `src/scenes/director.js`, with the pure decisions in `src/scenes/scenePolicy.js`.
>   (1) A shot reconciles ONLY the layers it declares. The old walk forced every
>   undeclared layer off, so a recipe authored against the original four layers
>   tore down CCTV, vessels and fires with no restore pass. Operator captures
>   snapshot the whole registry, so those still reconcile in full.
>   (2) Playback claims the camera through `runImmediateNavigation('scene', …)`
>   instead of a bare `camera.flyTo`, so it releases the follow camera, respects
>   the navigation policy and lets Cockpit refuse before anything mutates.
>   (3) **Playback NEVER re-establishes tracking.** `SCENE_TRACKING_PARAM_KEYS`
>   (`selectedFlightsTrackingId`, `selectedMilitaryTrackingId`,
>   `selectedSatTrackingId`) are stripped on the way to the layer — a shot
>   captured while following a contact would otherwise hand the camera straight
>   back to the follow loop it was just taken from, recreating the two-writer
>   jitter. The keys stay in the STORED capture; only the apply path drops them.
>   A unit pin sweeps every layer's `getParams()` for the whole selection naming
>   family (`SCENE_SELECTION_PARAM_PATTERN` — `selected…`/`tracked…`, `…TrackingId`,
>   `…Mmsi`/`…Norad`/`…Icao`), and each match must be on the strip list or on
>   `SCENE_KEPT_SELECTION_PARAM_KEYS`; a name like `trackedVesselMmsi` therefore
>   cannot slip through by not matching the older spelling. CCTV's
>   `selectedCameraId` is the one recorded keep: it raises a monitor plane and
>   never writes `viewer.trackedEntity` or the camera.
>   (4) An **isolating Context mode is exited before a shot's layers apply**.
>   Space Missions refuses every enable outside its replay bundle, so with it
>   left dirty all five recipes were refused (or, for Orbital Watch, composed
>   over a replay they never declared). The verdict is read off the shared guard
>   (`contextLayerEnableBlockReason`), not a mode name, so a future isolating
>   mode is covered — the probe id `SCENE_EXCLUSIVITY_PROBE_LAYER_ID` is
>   reserved by a test against the real layer registry. The exit itself is the
>   ordinary `setContextMode('off')` exact-restore path and is deliberately NOT
>   abortable: leaving the mode IS the restore to the operator's pre-mode state,
>   and tearing that transaction in half would strand Context. A refused
>   `setEnabled` is surfaced in the status line and a `shot_layers_refused`
>   telemetry event instead of being reported as success. **Mixed accepted /
>   refused layers are reported honestly, not rolled back** — a shot whose
>   enables partly failed leaves the layers that did move in place.
>   (5) **Cancellation cancels the work, not just the next step.** Checking a
>   flag after an `await` only stops what has not started, so both awaited
>   operations are now themselves cancellable. Layers: the run/LOAD owns an
>   `AbortController` whose signal is passed to every `setEnabled`, and STOP,
>   supersession, and run teardown abort it — the data manager rolls an aborted
>   enable back through the module's own `disable()`, so no layer is left on
>   carrying stale params. Visuals: `styleManager.applyVisualState(state, {
>   isCurrent })` gates BOTH halves of the map-stack switch, which is its only
>   suspension point. The switch is a *mutation*, not just a wait, and
>   `mapStackController` invalidates a switch only when another `setStack()`
>   arrives — a winning state that omits `mapStack` (every normalized shot does)
>   never issues one, so a stale switch would otherwise stand on the globe.
>   So: an already-superseded caller never starts the switch, and one superseded
>   *during* it puts the globe back to the stack the winner inherited — but only
>   while `getSwitchGeneration()` shows no newer switch has claimed it, because
>   a newer switch is a live intent that must not be stomped. The shader-uniform
>   commit after the await keeps its own gate. Precisely: a stale LOAD's
>   *synchronous* prelude (style/bloom/HUD) can still have landed before it was
>   superseded, and is then overwritten by the newer state; what cannot survive
>   is its map stack, its uniform commit, its layers, or its camera flight.
>   Post-`await` flag checks remain as a backstop. Known remainder: run cleanup
>   still waits on a suspended
>   visual/map operation, because `setRecordingMode(false)` is not idempotent
>   (a second call restores HUD `auto` rather than the operator's saved mode) —
>   worst case is recording chrome staying up until the promise settles, which
>   then restores correctly.
> - **Ambient contact labels (2026-08-20):** detection callsign callouts paint
>   on the shared normal-blend world-overlay canvas as their own host lane
>   (`detection-callouts`) — NOT on the screen-blended sensor surface. `screen`
>   can only lighten, so a dark backing plate drawn there is a no-op over sunlit
>   ground and the text dissolves into the imagery. Brackets, the scanline wash
>   and the mode banner stay on the sensor surface; the callout lane registers
>   in the same `detection` slot, so callouts keep their z-position beneath every
>   ordinary overlay card and beneath the tracked readout. Plate fills come from
>   per-theme `calloutPlate` / `calloutPlateSpace` tokens (~63% / ~73% of the
>   tracked card's `CARD_PLATE_ALPHA`), resolved once per style change; space-tier
>   contacts take the heavier one. Rows are pooled, and an empty field must clear
>   the replay buffer or the final callsigns strand on the canvas. **Do not move
>   callouts back onto the sensor surface, and do not merge the plate tokens into
>   `labelBg`** — that token is the scanline wash and shifting it retunes the
>   sensor texture. Plates are additionally **backdrop-selective (2026-08-21)**:
>   `skyBackdropFactor()` (`src/data/iconOrientation.js`, exact scaled-space
>   ellipsoid silhouette) feathers the plate FILL ALPHA to `SKY_PLATE_SCALE`
>   (0.18×) for labels above the horizon — sky backdrops read as near-bare text,
>   terrain backdrops keep the full plate — across a smoothstep band of
>   `HORIZON_FEATHER_RAD` (~1.09°/side). Only the plate alpha feathers; text,
>   tier accents, leaders, brackets, and the tracked readout card are untouched.
>   **The test is TWO-REGIME, and only the first regime is a ray test
>   (2026-08-22).** Above the ellipsoid, `1` means the view ray genuinely misses
>   the planet and the function is the exact complement of the occluder. **At and
>   below the ellipsoid the horizon is EYE LEVEL** — the local geodetic
>   horizontal plane through the camera — and that is NOT a ray-miss test: from a
>   −18 m camera the ray to a contact 900 m up crosses the ellipsoid and still
>   reads sky, deliberately, because the ellipsoid it crosses is not a surface
>   anyone can see. It is reached by clamping the tangent cone's half-angle at
>   90°, the continuous limit of the same formula (the horizon dip goes to zero
>   at the surface), and is the convention Cesium's `EllipsoidalOccluder` already
>   uses there, so the two stay sign-consistent. This is not an edge case:
>   coastal airports sit at NEGATIVE ellipsoid height (JFK ramp ≈ −30 m, geoid
>   ≈ −34 m), so a ground-level cockpit is genuinely inside the ellipsoid and
>   **must not** be treated as degenerate — doing so put a full plate behind
>   every label on an empty sky. Fail-closed now covers only unanswerable input
>   (null, zero-length ray, non-finite camera, camera at the planet's centre).
>   Note the pairing: from such a camera the occluder culls every contact BELOW
>   eye level before detection sees it, so ground-backed labels only reappear
>   once the camera clears the ellipsoid. Rendered proof:
>   `scripts/qa-cockpit-plates.mjs`.
> - **Required attribution has two named keep-out rules (2026-08-20):** the
>   Google/Cesium credit line must stay visible in every state, and below 900px
>   two surfaces used to paint over it — the command dock's popover tray (any
>   width ≤900px) and the right context rail, which goes edge-to-edge below
>   720px and covered the credit with every dock panel closed. Both now yield;
>   the credit itself never moves, shrinks, or hides. **The clearance is not a
>   single constant:** `#command-dock` is anchored at `2vh` down to 721px and
>   re-anchors to a flat `8px` at 720px while `#cesium-credits` keeps its `2vh`
>   base, so anything reasoning "the 2vh terms cancel" is only true in the
>   721–900px band. `src/creditAttribution.test.mjs` is a **fail-closed** cascade
>   model: it flattens `style.css`, resolves each anchor by importance →
>   specificity → source order, evaluates a 14×11 viewport grid, and fails
>   loudly on any construct it cannot resolve (`!important`, `inset`/`margin`
>   shorthands, unvetted custom properties, unparsable or nested media queries,
>   or an unrecognized selector positioning one of these elements). Extend the
>   model rather than working around it — a silent skip here ships a ToS
>   violation.
> - **Dock tray stacking is decided by ID count (2026-08-20):** the pinned-tray
>   selectors `#command-dock.dock-has-two-pinned-trays …` carry one ID against
>   five classes, so any narrow-width override written with two IDs outranks
>   them and the upper tray silently loses `var(--dock-lower-pinned-height)`,
>   landing on its pinned sibling. The ≤900px and ≤720px overrides therefore
>   name the panel (`#location-bar` / `#control-panel`) to reach (2,5,0). Adding
>   a new tray rule means checking it against the pinned variants, not just
>   against the base rule.
> - **LOCATION mini-status is data-only today (2026-08-20):** the collapsed
>   readout now follows a free-text geocode search as well as preset pills
>   (`src/locationStatus.js` owns the copy for both), and every other camera
>   destination invalidates the searched label — `_stampNavigation` covers
>   voice/reset/takeover/selection, and scene playback calls the public
>   `clearSearchedLocation()` per shot. `#command-dock` still hides
>   `.location-mini-status` with `display: none !important`, so none of this is
>   on screen; a `display:none` subtree is also out of the accessibility tree,
>   so nothing is announced. Unhiding it is a separate product decision.
> - **The Street Traffic sync chip shows one percentage (2026-08-20):** the
>   settled confirmation flash carries the layer's coverage figure and NO
>   progress number. `reduceTrafficSyncFeedback` returns an empty
>   `progressText` once the sync lands and `#traffic-sync-progress:empty`
>   collapses the slot; the renderer writes the empty value rather than
>   guarding on truthiness, or the busy `...` strands beside the settled label.
> - **`#active-style-name` has exactly one writer (2026-08-20):** the style-name
>   mapping in `setStyle`. Location, search, and scene paths report where the
>   camera is through the LOCATION surfaces, never the style slot.
> - **Share-link selected-subject Follow (2026-08-20):** a copied v2 link adds
>   an ephemeral `at` epoch-seconds field; ordinary live hash updates omit it.
>   A shared Flights, Military Flights, or Satellites selection restores only
>   after the base destination camera, ordinary layer restoration, and a new
>   destination-scoped source refresh settle. The source module—not lifecycle
>   success or the UI—owns the final presence decision: Flights and Military
>   use the exact accepted snapshot, while Satellites waits for the applicable
>   dense catalog and treats a partial CelesTrak catalog as unable to prove
>   absence. A found subject starts the normal moving Follow at its current
>   position regardless of link age. An authoritatively missing subject is
>   `expired` only when copy age is strictly greater than 90 seconds for Flights,
>   45 seconds for Military, or 5 minutes for Satellites; equality, missing or
>   malformed time, and other non-found cases are unavailable. Feed/catalog
>   failure has its own feed-unavailable message. These warnings use the
>   universal top-center status banner and its standard failure dwell, beginning
>   only after the shared-view startup cover clears. If
>   teardown or disable invalidates an in-flight refresh, any selected-subject
>   restore waiting behind it settles as cancelled instead of remaining pending.
>   Terminal non-found cleanup compare-clears only the exact passive ID in memory and the live URL, never
>   recipient local storage. A newer explicit selection, visibility request,
>   destination, pointer gesture, wheel gesture, destroy, or source cancellation
>   wins and suppresses late Follow/status work without cancelling unrelated
>   shared layer visibility or options. Radio station selection remains outside
>   the share payload; Radio restores only its allowlisted filter and volume.
> - **AIS feed watchdog (2026-08-18):** feed liveness is judged by DATA, not
>   socket state — AISStream can complete the handshake and then deliver
>   nothing forever. `/api/ais-live` reports `live | stale | reconnecting |
>   down | auth-failed` (plus the unchanged `missing-key`/`unsupported`) with
>   `silentForMs`, `reconnectAttempt` and `nextAttemptAt`. Silence is REPORTED
>   at 120s and ACTED ON at 300s; recovery walks a 5s/15s/60s/300s ladder and
>   then stops at a terminal `down` with a slow 15-min retry running behind it
>   (a retry never flips the chip back to "connecting" — only real data clears
>   `down`). Liveness credit requires a frame that arrived on a still-owned
>   socket AND decoded into a real AIS record: handshakes, malformed frames and
>   error envelopes are never liveness, and orphan frames are dropped entirely.
>   Failures are CLASSIFIED — auth rejections (error envelope, HTTP 401/403)
>   are terminal with an hourly probe and an actionable chip, 429 honours
>   `Retry-After` and otherwise enters at the slowest rung, and only genuine
>   transport faults use the ladder; worst case is single-digit connection
>   attempts per hour in every class. Degraded states stay visible in the chip
>   even while cached vessels are still drawn.
>   **Locked invariants — do not "fix" these:** teardown is `ws.terminate()`,
>   never `close()` (the built-in WebSocket has no hard-abort and its `close()`
>   never completes against a black-holed peer, leaking the single per-key
>   connection); socket generations are monotonic for the module lifetime and
>   never reused across a dispose, and every socket-map mutation is
>   identity-checked (otherwise a pre-disposal close event orphans a
>   post-disposal socket and two connections race for the one slot); durations
>   use a monotonic clock, wall time only for display. Policy is a pure state
>   machine (`src/data/aisWatchdog.js`) returning actions; the socket lifecycle
>   is `src/data/aisStreamAdapter.js`, tested directly with mock sockets; the
>   transport assumption is pinned in `src/data/aisWatchdogTransport.test.mjs`.
> - **Honest live AIS health:** the vessel layer treats socket connection,
>   first message receipt, raw payload rows, and accepted vessel positions as
>   separate stages. Each enabled session owns one 30-second first-connect
>   grace: an open or connecting socket with no accepted position reads
>   `LOADING`, and polls do not restart that deadline. The first accepted
>   position ends the grace and establishes freshness; expiry, missing
>   credentials, rejected transport, or another definitive failure reads
>   `UNAVAILABLE`. Disable/re-enable starts a new isolated session. A socket
>   with no received message or no usable positions does not advance
>   `lastUpdate` or replace warm accepted vessels;
>   warm selection and trail state remain visible as stale/degraded. Late
>   responses from disabled, destroyed, or replaced layer requests cannot
>   mutate or finalize the current lifecycle. Layer stats expose transport
>   status, message time, and raw/accepted row counts for diagnosis.
> - **Vessel/fire camera transfer:** clicking an actionable AIS vessel sprite
>   or painted card selects that MMSI and requests one close oblique camera
>   transfer; re-clicking the selected vessel refocuses it. FIRMS detection
>   sprites and actionable detection cards do the same using a refetch-stable
>   identity that includes position, acquisition time, and source satellite.
>   Aggregate fire cells remain non-actionable. Painted actionable cards are
>   also mirrored into a named, focusable assistive-control list that exposes
>   selected state and announces focus only after the backing record accepts
>   activation. Global FIRMS cards reject far-side cells before
>   filling the bounded overlay cohort; the shared overlay still owns final
>   horizon culling. The UI validates world-focus
>   requests before releasing tracking, refuses Cockpit-owned moves before any
>   camera mutation, and releases follow owners before accepted flights.
>   Sibling-owned picks win without clearing the vessel/fire selection or
>   issuing a competing camera command. Deferred geocoding stamps intent but
>   retains the current owner until a valid destination resolves; immediately
>   before flight it rechecks shared navigation authority. Newer destinations,
>   voice `move_camera`, `fly_route`, overhead framing, strongest-fire focus,
>   vessel/aircraft/satellite tracking, reset, Cockpit entry, or teardown
>   make older work and its UI completion inert. Teardown removes immediate
>   camera-entry listeners before its first asynchronous restoration step and
>   refuses any new immediate or deferred navigation after disposal begins.
> - **Loading, reset, and Display completion:** every registered layer exposes
>   one normalized manager loading contract. Enable and disable feedback remains
>   lifecycle-authoritative, while manager-owned periodic updates publish
>   refreshing, failure, and recovery without replacing a producer's more
>   specific error or availability state. The shared presentation is delayed to
>   avoid flashes, visible outside the rails, and retained in
>   Cockpit. One continuous overlapping load interval retains the strongest
>   terminal outcome (`failed`, then `cancelled`, then `complete`) until every
>   participant settles, so a later success cannot mask an earlier failure.
>   A participating producer's terminal error, unavailable status, or
>   key-required state also outranks generic completion without requiring a
>   separate manager failure event; AIS first-connect expiry therefore ends as
>   `LOAD FAILED`, not `LOAD COMPLETE`.
>   Slow disable work is labeled as turning live data off rather than
>   as a completed load. Street Traffic's dedicated sync chip shows genuine
>   work and one bounded completion; steady TomTom coverage, including 0%, does
>   not keep it open. Mapped Installations reports its bounded camera-driven
>   requests to the same shared surface, but full-globe `zoom-in` guidance is
>   not presented as loading. Terminal completion, cancellation, and failure
>   labels are centered in that surface without an empty detail slot. The circular `RESET GLOBE` action sits beside the top-center share
>   control in map view; Cockpit hides the complete action group and provides a
>   cockpit-styled `RESET` beside `EXIT COCKPIT`. Both resets share one route
>   with the voice action, release continuous/POI/Cockpit/entity and
>   Space Mission camera ownership, and returns to the 18,000 km globe frame.
>   Reset preserves the selected Contact while invalidating delayed automatic
>   refocus work; the normal Context `FOCUS` action is the explicit route back
>   to that same flight or vessel after the globe view settles. Location
>   navigation uses the same selection-preserving camera
>   handoff once a city, landmark, coordinates, or search destination resolves;
>   failed searches leave the current camera owner untouched, and Context Focus
>   can return to the preserved Contact. Focus also restores the selected
>   aircraft's canonical follow frame after a manual zoom-away.
>   Visual presets retain the order Normal, CRT, NVG, FLIR, Anime, Noir, Snow.
>   Configurable preset selection—including same-style reselection—opens the
>   shared Parameters surface directly below Detection and scrolls it into
>   view; share-link restoration
>   does not force that disclosure. Presets remain in the map Display. The
>   shared Parameters surface moves into Cockpit Display for the session and
>   returns on exit, with slider values contained by the panel at its supported widths;
>   the bottom Visual Presets tray owns the MAP SOURCE label, centered status,
>   and four-tile source row. Its compact wing is a keyboard disclosure:
>   Enter/Space opens and focuses Map Source, Escape closes and returns focus,
>   and unavailable sources remain tabbable with their reason exposed. Expanded left-panel
>   headers use the same container-owned background treatment without changing
>   their collapsed launchers; a soft 28% cyan divider identifies expanded
>   titles on both side rails.
>   Cockpit portals HUD, Detection, the single shared Parameters surface, and
>   3D controls, but not the visual-preset grid. Parameters follow the active
>   Cockpit vision treatment and remain directly below Detection. Changing the
>   top vision style does not close an open Display or Radio utility; explicitly
>   opening Display still collapses Live Signals. Its left-side
>   Data Layers and Contact interactions do not collapse an expanded
>   Display or Radio utility. Presentation-only adaptive collapse is reconsidered after HUD
>   and viewport changes, while explicit collapse remains the only persisted
>   user intent.
>   Display orders 3D immediately above Celestial and Clean UI immediately
>   below it. The top-center action group places Clear Layers to the left of
>   Share and Reset Globe to the right. Clear Layers turns off the currently
>   selected manager-owned data layers, including an active Context choice,
>   while retaining visual, HUD, map, and panel settings. A disabled layer may
>   still release camera work that it owns through its normal teardown.
>   Direct Data Layers entry into Space Missions excludes the new mission ON
>   intent from its pre-entry snapshot. Its OFF control therefore leaves Space
>   Missions off and restores Satellites to their exact pre-entry visibility
>   and parameter state.
>   The title and loading logos use a blue 10 px outer-eye stroke with a
>   translucent slate fill, while the globe-and-cage gaze travels up to 34 SVG
>   units toward the pointer for clearer feedback at the compact title size.
> - **Context, Cockpit, and Radio interaction contract:** explicit Contacts,
>   Space Missions, and successful Cockpit actions reveal the Context panel, while
>   restoration and replay preserve its prior collapsed state. Contacts uses the
>   dedicated right-side chooser; the underlying Global Context coordinator is
>   registered for lifecycle and restoration but is not duplicated in Data Layers.
>   Inside Cockpit, the focused summary card is titled Contact in both visible
>   copy and its accessible control labels.
>   The top-center Cockpit vision cycle shows the inherited map preset name
>   (for example, `NOIR`) followed by CRT, NVG, FLIR, and NOIR. That inherited entry
>   leaves the selected map preset unchanged inside Cockpit. NONE is not offered
>   in the cycle; CRT, NVG, FLIR, and NOIR temporarily override that preset, while returning to it or exiting
>   Cockpit restores the captured map style and its exact shader intensities.
>   Selecting a Cockpit vision treatment with configurable parameters opens
>   Cockpit Display and reveals those parameters through the existing right-side
>   accordion; an inherited parameterless Normal preset does not force it open.
>   Expanded Cockpit Display uses a container-integrated header and soft 28% cyan divider
>   matching the expanded left-side panel treatment; its collapsed launcher
>   keeps the standalone glass surface and muted divider. Cockpit Display and
>   Radio use right-rail chevrons: left to expand and right to collapse.
>   Cockpit side surfaces use one expanded body per side: Display or Radio
>   collapses Live Signals and vice versa. When both utilities close, Live
>   Signals reopens unless the user explicitly collapsed it. Expansion notifications
>   fire only on a real collapsed-to-expanded transition, preventing repeated close
>   synchronization from re-entering the disclosure coordinator. Data Layers collapses
>   Contact, while expanding Contact returns that panel to its visible
>   launchers. Live viewport-height changes remeasure both utility lanes and
>   keep their collapsed launchers inside the obstacle-free corridor above
>   Contact and Live Signals. An expanded Data Layers panel is solved against the
>   viewport rather than the Cockpit cards: the CONTACT card and the peripheral
>   Intel HUD corners stop shortening its corridor while it is open, so it
>   unfurls downward from its collapsed launcher position and renders over them
>   (`#left-panel-stack` is z-index 147, above the Intel HUD readouts at 146 and
>   the Cockpit HUD at 145), scrolling internally when the layer list is longer than
>   the corridor. Cesium's credit line is never passable and still bounds the
>   corridor. Layer toggles stay live from there, and collapsing returns the
>   plain launcher. The map-only Clear, Share, and Reset Globe actions are hidden
>   for the duration of Cockpit, both as a group and as individual controls.
>   It uses the `radar` symbol and provides roving keyboard tab navigation. Its action row
>   places the single Cockpit entry before Search Nearby Sites. Cockpit removes
>   the duplicate floating map entry and topline exit; the bottom-center
>   `EXIT COCKPIT` control (offset downward by a `-95px` bottom margin) plus `Escape`/`C` own exit, with entry/exit focus
>   transfer and failure-safe shortcut routing. The exit control sits at the
>   bottom-center compass position. A Cockpit-only control strip sits
>   directly above Live Signals, anchored 12px under the REC readout it shares
>   the right margin with and clamped to keep 8px above the briefing card,
>   never rising past `max(96px, 12vh)`; Cockpit owns that anchor and
>   republishes it every layout tick (the left accordion no longer donates its
>   corridor). Its minimal Display popover exposes Intel HUD,
>   Detection, Parameters, and 3D aircraft. During Cockpit, those existing
>   standard Display controls move into the Cockpit popover and retain their normal
>   nested interaction: HUD plus Tactical/Operator/Minimal layout, Detection plus
>   Density/Allocation/Fade/Outside tuning, and 3D plus Proximity/All mode. The
>   same nodes and state return to the map Display on exit, so Cockpit does not
>   maintain a second control state. **Detection is owned by the CONTACTS
>   session, not by Cockpit** (validated 2026-08-18): activating Contacts
>   forces detection on at the shared military preset (`MILITARY_DETECTION_PRESET`
>   — Dense @ 75%, the same frozen object the CRT/NVG/FLIR styles apply), and it
>   then stays on for the whole session — cockpit enter, cockpit exit and
>   third-person tracking are moves WITHIN Contacts and do not touch detection at
>   all. A manual DETECT change during the session holds for the rest of it.
>   Deactivating Contacts restores the pre-Contacts state, except that a map
>   style chosen during the session keeps its own auto-enable preset (that rule
>   is younger than the entry snapshot). The trigger lives on
>   `_syncContactsDetection()`, called from `_syncContextModeButtons()` and gated
>   on `!_contextModeChanging` so it fires at transaction settle, never at click
>   — a failed activation cannot strand detection on. Policy in
>   `src/contactsDetectionPolicy.js`. Detection continues to show surrounding
>   aircraft in Cockpit while omitting only the active first-person subject's bracket;
>   handoffs move that suppression to the new subject and exit restores the
>   selected aircraft's map-view bracket. Remaining Cockpit bracket strokes render
>   at 45% of their normal presentation opacity to reduce visor clutter; callouts,
>   density, allocation, fade, and Outside tuning are unchanged and normal bracket
>   opacity returns on exit. AIR presentation follows the same retained 3D mode:
>   Proximity uses 150/185 km and All uses 400/450 km. With 3D off, in-range
>   contacts remain rotating 2D silhouettes; with 3D on, ready admitted models
>   take over under the Cockpit cap of 60. Loading/capped contacts remain 2D,
>   out-of-range contacts use rotation-free dots, and exit restores map treatment.
>   Its Radio popover exposes compact power,
>   transport, station, and volume controls. Cockpit Previous/Next preserves
>   selection, autoplay, and broadcaster fallback audio without starting the
>   map-view station flights that compete with the first-person camera. These
>   are a Cockpit-only accordion:
>   each static header uses the left accordion's label and divider with a dedicated
>   directional-chevron disclosure button and no full-row hover treatment. Only one
>   utility body expands at a time. On desktop, its collapsed sibling remains
>   visible whenever both controls fit above Live Signals; a constrained
>   corridor gives the expanded utility the full height and temporarily hides
>   that sibling, restoring it as soon as room returns. Collapsed Display
>   matches the collapsed Data Layers launcher width. Expanded Display uses the
>   standard map Display panel's 272 px width, glass shell, header surface, and
>   internal spacing. Radio retains its independent compact and expanded widths.
>   Display no longer follows the Data Layers corridor: that corridor is solved
>   against left-lane obstacles and has nothing to say about the right margin,
>   which dropped the strip into Live Signals below roughly 830 px of browser
>   height. Cockpit owns the strip's anchor and republishes it on every layout
>   tick — including the settling pass after HUD transitions and asynchronous
>   map-provider swaps — hanging it 12 px under the REC readout, clamping it up
>   to keep 8 px above Live Signals, and never letting it rise past
>   `max(96 px, 12vh)`. The utility height is measured from that resolved top
>   and floors on a launcher height rather than a fixed minimum, so expansion is
>   bounded to the real corridor below the Cockpit topline and above Live
>   Signals, including when a tall panel takes over the corridor. A hidden
>   sibling is also removed from the accessibility tree, and focus transfers to
>   the expanded utility if a layout transition hides the focused launcher. The
>   shared map Display, Radio detail,
>   ordinary Global Context, and Scenes surfaces stay hidden in Cockpit. Data
>   Layers remains available. Its Cockpit-only stack paints
>   above the curved speed and altitude rulers, matching the existing Context,
>   Signals, Display, and Radio surface ordering without changing map-view
>   stacking. Narrow mobile Cockpit
>   viewports suppress the legacy layer stack, peripheral HUD, and secondary
>   Context/briefing panes so the flight instruments and primary controls remain
>   unobstructed. Outside Cockpit, Radio starts collapsed while off. When Context
>   is collapsed, its Radio header icon opens compact controls whose explicit
>   Enable/Disable action owns power; stable close and full-panel buttons own
>   compact dismissal and one-way detailed expansion independently. When Context
>   is already expanded, that same icon skips the floating compact card, expands
>   the embedded Radio section, scrolls it into view, and moves keyboard focus to
>   its disclosure control. The detailed panel's normal accordion control owns
>   its collapse. Compact/detailed state and playback continuity remain shared.
>   Radio volume in the full, compact, and Cockpit surfaces, plus Space Mission
>   replay speed, use Display / Sharpen's muted 3px rail, circular cyan thumb,
>   glow, and mono value treatment. Their larger transparent hit areas, keyboard
>   focus indication, ranges, disabled states, and mission speed scale remain
>   control-specific.
>   Outside Cockpit, panel collapse state is independent. Multiple expanded
>   panels in either desktop lane share the measured viewport-safe corridor.
>   If a later panel would receive less than half its intrinsic height, the
>   layout presents it as a collapsed, accessible launcher without overwriting
>   the user's saved preference; the panel most recently opened by the user
>   keeps the lane, so an older expanded sibling yields when necessary. In a
>   constrained Tactical lane, later competing panels collapse to their
>   launchers even when they would narrowly exceed that threshold. While the
>   left lane remains constrained, every collapsed sibling launcher is hidden
>   and the primary panel uses the complete safe corridor; the launchers return
>   when that panel closes or the stack fits again. An expanded
>   Tactical Display claims the right lane and hides every collapsed CCTV and
>   Context sibling, including a layout-collapsed Context; those launchers
>   return when Display releases the lane. Display itself remains the single
>   scroll surface when a visual preset adds Parameters: those rows do not form
>   a nested scroll surface. The bottom Visual Presets MAP SOURCE row keeps the
>   `3D` status and four source tiles inside its padded tray; the row wraps
>   from one row to two at 620 px, and live viewport changes keep the complete
>   tray inside the screen.
>   Adaptive remeasurement preserves the user's
>   scroll position across Tactical, Minimal, and HUD Off layouts.
>   During an active Scene run, Clear Selected Layers and Reset Globe remain
>   hidden until playback stops or completes because the Scene transport owns
>   layer and camera sequencing for that interval.
>   The Cockpit Contact summary exposes Previous and Next contact navigation
>   plus its collapse control; it does not offer a Focus action because the
>   first-person Cockpit camera remains owned by the tracked aircraft.
>   A voice Cockpit request that retargets to a filtered civilian or military
>   contact carries voice selection authority through navigation, so the
>   aircraft entered is also the durable target used by Copy Link and reload.
>   Missing context values render as `—` with an accessible “Unavailable” name.
>   Because the panel hosts its own Previous/Next controls, the ONLY condition
>   that hides it is the absence of a context snapshot. Contact identity never
>   gates visibility — hiding on a non-aircraft subject stranded the operator
>   the moment Next landed on a vessel or an installation.
> - **Contact readout: foreign subjects and CONTACT LOST.** When the selected
>   contact is not the tracked aircraft (a vessel, an installation, another
>   aircraft), the panel stays up and keeps its label, cohort counts, nearest
>   contact, distance and evaluated time live. Only the nose-relative direction
>   arrow and BRG readout are dashed: those two are measured in the tracked
>   aircraft's own frame while the rest of that row is measured from the
>   selected contact, and rendering both live presents one mixed-frame reading
>   as a single measurement.
>   A contact that leaves its feed holds the panel in a `CONTACT LOST` state
>   (`data-state="lost"`, the same panel-level cue mechanism as `uncertain`,
>   in the amber the app already spends on unknown/stale inputs): the last
>   rendered values stay on screen rather than being recomputed against a
>   position that stopped updating, and Previous/Next stay operable so the
>   operator can step off. It fires on two paths, and both retain the snapshot:
>   an eviction-origin selection clear (`reason: 'evicted'` — the aged-out
>   branches in `flights.js` / `militaryFlights.js`, AIS pin exhaustion, and a
>   viewport refresh that drops a selected record), and a refresh whose
>   presence check comes back absent. A DELIBERATE clear (click-away, Escape,
>   voice stop, layer disable) still clears the subject and takes the panel
>   down; an untagged clear defaults to deliberate.
> - **Presence contract (`hasContact`).** `flights`, `militaryFlights` and
>   `aisLiveVessels` each expose `hasContact(id)`: `true`/`false` in O(1) from
>   the layer's own keyed map, or `null` when the layer holds no data and
>   therefore cannot answer (disabled, or not yet loaded). Presence consumers
>   MUST use it and must never infer absence from `getAllPositions`, which
>   stops at its cap — the live flights layer routinely carries ~11k contacts
>   against a 1,000-row cap, so "not in the returned rows" is not "gone".
>   `null` leaves the previous verdict untouched, so a silent layer can never
>   fabricate a CONTACT LOST cue.
> - **Compact data-attribution panel:** the complete Cesium credit inventory
>   remains available without taking over the viewport. Its expanded desktop
>   panel is capped at 70dvh/36rem, the wrapped 12px credit list scrolls inside
>   it, and narrow screens retain Cesium's full-screen surface with an internal
>   scroller. The title, close control, links, and persistent Google/Cesium line
>   remain unchanged and visible.
> - **Distant-aircraft recession:** both civilian and military billboard fleets
>   retain their locked class/ground scale and `NearFarScalar`, then multiply a
>   limb-relative taper in the existing ~12 Hz tick. The taper is 1 below 0.5×
>   geometric limb distance and smoothsteps to 0.45 scale plus a 0.35 alpha-haze
>   factor at the limb. That treatment eases continuously back to identity from
>   3,500–4,500 km camera height, avoiding a globe-view threshold pop. These
>   values, the start ratio, blend band, composed floor, and write epsilon remain
>   runtime tunings. No aircraft is count-culled or made fully transparent.
>   Focus emphasis and limb haze multiply at one deadband-gated write site, and
>   their product is clamped to 0.20 before freshness alpha is applied. Ambient
>   fleet models receive that same composed alpha; class/ground/cockpit repaints
>   preserve the current limb scale instead of dropping it for a tick.
>   **Model-perspective cap (2026-09-09, user: "tie horné lietadlá pri horizonte
>   nie sú 3D v polohe"):** while the 3D-model regime is active, ambient
>   billboards beyond the model ADD radius were still 20 px × 3 × NearFarScalar
>   ≈ 56 px (measured at 183 km from a 7.5 km camera) while every model at the
>   150 km boundary is `minimumPixelSize` = 32 px — a row of large flat
>   top-down glyphs floated above the horizon. `modelHandoffScaleCap()` in
>   `aircraftRecession.js` now caps the billboard scale so the icon equals the
>   model's minimum pixel size exactly at the ADD radius and shrinks ∝ 1/distance
>   beyond it, floored at 14 CSS px (still pickable with the 6 px tolerance);
>   `applyAircraftBillboardTreatment` takes it as `scaleCap` (min with the limb
>   taper; `factors.scale` becomes the effective factor so presentation repaints
>   reproduce it). Wired in `flights.js` and `militaryFlights.js` only for
>   `useModels && !isDot`; the 3× close-range scale, dot/micro tiers and the
>   3D-off look are untouched. Measured after: 24 px at 247 km, 18–19 px from
>   325 km to the limb (was 44–56 px).
>   **Model reach to the horizon (same day, user compared crops: wants the
>   side-on model silhouette at the horizon, not the top-down glyph):** on the
>   map the model ADD radius is no longer the static 150 km (proximity) /
>   400 km (all) but `modelHorizonReachM()` in `aircraftRecession.js` =
>   limb(camera height) + limb(12.5 km cruise altitude), floored at the mode's
>   static radius and capped at 900 km (`MODEL_REACH_MAX_M`); KEEP = ADD × 1.15.
>   Model caps (150 / 350, nearest-first with on-screen priority) are
>   unchanged, so the cost is bounded; cockpit keeps the static radii for its
>   pip/near-contact band. Verified from a 7.5 km camera tilted to the horizon:
>   127 models (47 on screen, 25–683 km), one billboard left on screen.
>   **Automatic model cap (same day, user: "nestačí to, sprav aby to bolo
>   automaticky"):** the static caps (150 proximity / 350 all) left dense
>   horizons (Frankfurt from 7.5 km: ~150 on-screen planes) partly as
>   billboards. Two pure pieces now size the cap: `modelAutoCap()` in
>   `aircraftRecession.js` raises it to the number of ON-SCREEN planes inside
>   the add radius (floor = mode base cap, hard ceiling `MODEL_AUTO_MAX` = 600;
>   off-screen KEEP/ADD passes stay limited to the base cap), and
>   `modelFrameBudget.js` throttles it by measured CPU frame cost — a
>   preRender→postRender EMA meter per layer, `nextModelBudget()` once per
>   second while no model load is pending: ×0.8 above 22 ms, +40 below 14 ms,
>   hold in between, start 300, never below the base cap. Measured in the
>   Browser pane (slow renderer, ~0.2 ms per model, 143 models = +30 ms):
>   the budget settles at the base cap; on a fast machine it grows until every
>   on-screen plane to the horizon is a model. Cockpit keeps its own caps.
> - **Focus-aware contact de-emphasis:** civilian/military aircraft and
>   satellites publish the selected target's padded screen bounds and camera
>   distance from the same per-frame position cache already consumed by their
>   tracked entity. Ambient flight sprites, AIS chevrons, CCTV icons, and
>   satellite points then ease their own alpha where they compete with that
>   target; no draw-order assumption participates. The always-visible rule is
>   narrowly amended rather than removed: emphasis never falls below 0.25,
>   contacts never blink or disappear, entry/exit use 6 px hysteresis, and
>   writes use a 0.005 alpha deadband. Defaults are 18 px padding, 300 ms attack,
>   600 ms release, an 8%-of-target-distance range hysteresis band, and
>   `nearerBehavior: 'allow'`; `dim` and `partial` remain runtime/evidence
>   tunings. Ambient overlap includes each sprite's own rendered extent. The
>   gated AIS, CCTV, and satellite passes retain an active-emphasis count so a
>   settled dim contact always completes its release after tracking ends.
> - **Terrain-height resilience:** `/api/terrain/heights` caches canonical
>   5-decimal points individually, reconstructs reordered/overlapping batches
>   in exact request order, and refreshes only missing or stale points. Network,
>   429, and 5xx failures receive bounded jittered retries with `Retry-After`;
>   stale real heights remain usable per point, while an uncached absent height
>   still returns 502 rather than becoming a fabricated ground value. Client
>   geoid fallbacks wait 60 seconds before retrying and self-heal to Re:Earth on
>   the first later successful fetch.
> - **Overpass cache admission:** `/api/overpass` parses and sanitizes requests,
>   then checks fresh memory, identical in-flight work, and fresh disk entries
>   before invoking its local 90/min limiter. Cache and single-flight responses
>   therefore do not spend quota; upstream-bound misses retain the existing
>   limiter, mirror, stale, and sanitization behavior.
> - **CCTV world-click focus:** clicking an in-world CCTV icon or ambient card
>   activates it and routes the camera flight through the panel FOCUS policy.
>   Aircraft/satellite tracking releases outside cockpit; cockpit retains the
>   view, keeps the CCTV activation, and surfaces the existing refusal toast.
>   Auto-hop and programmatic camera activation remain activation-only. CCTV
>   world clicks must stay within 6 px and 400 ms; drag-like or long gestures
>   are inert, and re-clicking the already active camera emits no focus request.
>   A clean empty-space click clears the active CCTV camera in place without
>   moving the view or disabling the layer. Sibling-layer picks and ADJUST-mode
>   interactions never trigger that clear. The resulting null selection remains
>   stable across rendering and updates; configured auto-hop is held until a
>   later explicit activation or AUTO HOP toggle-on.
> - **Tracked-flight close-range feel:** the existing 150 m camera floor is
>   unchanged, while the selected-only civilian and military model cap is now
>   200 px so minimum range reads as close. Pointer travel over 6 px suppresses
>   selection and empty-space untracking; duration over 400 ms suppresses only
>   untracking, so a stationary slow press on a plane still selects it. Escape
>   still releases tracking in place. The 200 px feel needs close-range field
>   verification; fleet model sizing remains unchanged.
> - **Deterministic sprite stacking:** contact collections reassert the stable
>   bottom-to-top order CCTV, FIRMS, bikeshare, AIS, military, then civilian
>   flights after every relevant layer init/enable and immediately after FIRMS
>   lazily registers its detection sprites. Always-visible contact
>   depth settings are unchanged. Cesium OIT weighted blending may soften strict
>   alpha layering on some GPUs, so the ordering remains a real-browser check.
> - **Deterministic card stacking:** CCTV, FIRMS, vessel, and tracked-target
>   cards use the shared world-overlay canvas. Detection paints through the
>   same host/frame contract onto one host-owned blend surface beneath that
>   canvas — parented into `#cesiumContainer` so its `screen` blend still
>   reaches the WebGL scene. The exact detection, ambient-label, ambient-track,
>   ambient-card, thumbnail, selected, and tracked lane sequence is binding;
>   the detection callback runs first and z-index preserves its shipped z5
>   position below the z6 cards.
> - **Cross-layer vessel ownership:** clicking a sibling-layer contact leaves
>   the active vessel card, HUD, context, and trail unchanged while the sibling
>   handles the pick, preventing two camera commands from one click. Starting entity tracking still clears vessel
>   inspection; AIS itself never sets `viewer.trackedEntity`. Own unkeyed or
>   evicted vessel-record picks and `gev-trail:*` remain no-ops. CCTV choices
>   made from the panel dropdown do not currently emit a cross-layer event and
>   therefore do not clear vessel inspection.
> - **World-overlay host and Phase 2–6 source migrations:**
>   `src/overlays/worldOverlay.js` owns one shared DPR-aware text/card canvas,
>   one detection blend surface, and one world-overlay post-render
>   scheduler. Both surfaces share the same sizing, clear, projection,
>   and teardown paths. The host includes bounded per-source/per-collision-domain
>   arbitration, horizon/viewport culling, shared keyhole fading, cached UI
>   exclusions, cockpit source gating, pooled hit
>   rectangles, and development diagnostics. **UI exclusion is a per-rectangle
>   PLACEMENT PREFERENCE over currently visible chrome — it clips no canvas and
>   vetoes no entry.** Rectangles are never coalesced into bounding unions
>   (that requirement existed only for even-odd canvas holes, and the host
>   punches none). Exclusion strength is decided per element by its EFFECTIVE
>   stacking level (the outermost positioned ancestor carrying a z-index, i.e.
>   the stacking context that competes with `#world-overlay-root`): chrome ABOVE
>   the host — map panels z90-1000, the dock, the cockpit windows inside
>   `#cockpit-hud` z145 — is a soft preference, so an entry with no
>   collision-free placement keeps its full placement set and simply renders
>   beneath that chrome. Chrome at or BELOW the host keeps an absolute veto:
>   `#intel-hud` is z2, under both host surfaces (detection z5, cards z6), so a
>   kept placement there would paint over HUD text. Placement runs two passes —
>   prefer variants clear of all chrome, else variants clear of the below-host
>   chrome, else drop the entry. Cockpit line art (rims, arcs, rails, toplines, readouts) is not
>   in the inventory at all: the AR-HUD model puts world-space content beneath
>   the cockpit's screen-space HUD by z-order. Its empty-host path performs no
>   post-setup layout reads or canvas work under resize/mutation noise; removed
>   entry records are pruned, and text measurement uses a host-lifetime,
>   1,024-entry LRU. Steady-state rendering reuses arbiter output, placement,
>   paint-item, and paint-rectangle storage; track display text is rebuilt only
>   when its title or detail changes. DOM mutations only flag exclusions dirty,
>   with selector/layout scans deferred until there is overlay paint work, and
>   host teardown severs pooled record/entry references before releasing every
>   pool. A custom paint-lane contract gives source-owned batched painters the
>   same DPR-sized context, per-frame view-projection matrix, ellipsoid
>   occluder, keyhole geometry, and cached UI rectangles without transferring
>   their selection policy into the host. Datacenters and Dams now publish card
>   entries into that host on their
>   existing 450 ms screen-grid cadence. Each source retains two deterministic
>   contenders per grid cell and publishes at most 160 entries. The legacy
>   700/900 winner ceilings are no longer the effective shipped caps; active
>   `ambient-card` source budgets sum to a bounded 1,150-card shared lane: two
>   96-card infrastructure budgets, FIRMS' shipped 18-card cohort, AIS's
>   existing configured 900-row absolute ceiling, and CCTV's shipped 40-card
>   ambient maximum. Runtime AIS demand still
>   derives from its shipped 118 px grid: 112 candidates at the 1600×900
>   allocation viewport and 170 at full HD; its existing 150 px greedy
>   separation usually admits fewer. The host owns final cross-source declutter
>   without letting source count grow beyond the pre-migration source bounds.
>   Cards use the infrastructure name plus available operator/capacity for
>   datacenters or river for dams. Their native Cesium points, stems, polygons,
>   selection/picking, terrain sampling, and enable/disable lifecycle remain in
>   `localGeojson.js`; it creates no native label graphics.
>   The bundled public-release snapshots omit contact-oriented fields and note
>   values containing email or phone identifiers. Runtime cards and entity
>   context do not depend on those fields; geometry, identity, name,
>   operator/capacity/river metadata, and ODbL attribution remain intact.
>   Stem position and
>   polyline properties are constant between initialization, camera `moveEnd`,
>   and successful near-surface ground samples rather than per-frame callbacks
>   or every 450 ms visibility pass. Unchanged or sub-0.5 m tips do not call
>   `setValue`, and each record alternates between two preallocated two-position
>   stem arrays so real tip changes notify Cesium without steady-state allocation.
>   Shared placement records retain the raw anchor plus one signed integer
>   leader offset; painters apply that offset without materializing four pairs
>   of computed doubles per entry. The arbiter's spread distances and compact
>   placement-availability masks live in pooled numeric buffers. Because solve
>   occupancy only grows, few-placement identities whose complete set is
>   blocked are dismissed once instead of being returned and re-spread; the
>   authoritative collision lookup remains the final semantic check. Protected
>   entries that cannot separate completely choose the placement with the least
>   total protected-rectangle overlap rather than stacking on the first option.
>   Cards use the host's shared keyhole fade and global detection fade/opacity
>   controls with no source-local edge constants; cached keyhole geometry is
>   invalidated by live tuning as well as canvas size, so Fade changes reach the
>   next frame. Outside opacity defaults to the shipped floor (5 % when this
>   landed; 1 % since the 2026-08-24 final lock, 3 % on 08-23). The
>   `KEYHOLE_OUTSIDE_OPACITY_DEFAULT` change from 0 to 0.05 also affects
>   detection: callouts and brackets previously hard-culled outside the keyhole
>   now paint at the OUTSIDE default (1% since the 2026-08-24 final lock;
>   aircraft brackets hold the 0.35 readable floor) and consume ambient budget
>   viewport-wide under the same
>   fade-don't-cull principle; this remains pending visual review. Cards
>   also reproduce the former
>   `scaleByDistance` curve (1.0× at 250 km to 0.62× at 9,000 km).
>   Mapped Military Installations create no empty native labels; selected names
>   remain in the tracked readout. Submarine-cable labels moved into the shared
>   host on 2026-08-18 (Option 2, superseding the Phase-5 Option-1 native
>   exception): the same nearest-160 bounded cohort now publishes
>   `ambient-label` entries on a dirty sweep with exactly two dirty
>   conditions — camera `moveEnd` / layer enable / load completion, plus a
>   motion fallback that samples the camera at most once per 2 s and only
>   re-arms past 250 m of travel since the last swept position, so tracked
>   and orbit cameras (which never emit `moveEnd`) cannot starve the sweep
>   while a parked camera still costs zero. The former 500 ms timer path was
>   removed in the same-day perf round — timer-driven stem re-sizes rebuilt
>   the 2,629-instance batched stem primitive mid-motion. The 2,629 reference
>   stems are staticized constants (no per-frame `CallbackProperty`), and an
>   unchanged cohort is never republished so a parked camera stays
>   governor-idle at the source level.
>   The 2026-08-18
>   host fix extends that to the HOST level: chrome mutation observation is
>   scoped (body childList filtered to inventory-chrome add/remove;
>   per-occluder attribute observation element-only, no subtree) and the
>   right-rail allocator writes `--right-panel-allocated-height` only on real
>   change, so parked idle with ANY live overlay source measures 0 postRender
>   fires / 5 s — empty-scene control parity (pre-fix ~56-61; dams
>   cross-checked at 0). Genuine chrome changes (occluder add/remove,
>   own-attribute flips, resizes) still invalidate;
>   `qa-cables-overlay.mjs` gates idle at ≤6 / 5 s.
> - **Phase 6 detection consolidation:** `src/data/detection.js` retains its own
>   `LabelArbiter` instance and existing 125 ms solve cadence, density/altitude
>   budgets, layer quotas, Elastic/Weighted allocation, manual scalar matrix
>   projection, tier palette, batched bracket paths, callout painter,
>   acquire/keyhole fades, sparse focus ring, banner, scanlines, suspension, and
>   diagnostic object. It no longer creates or sizes a canvas, clears pixels,
>   builds a camera matrix or UI inventory, observes layout, or attaches a
>   render listener. The host creates and lifecycle-manages
>   `#world-overlay-detection-surface`, DPR-sizes it through the same frame path
>   as `#world-overlay-canvas`, and invokes detection against its
>   plain source-over context. Detection writes the exact shipped theme
>   `mixBlendMode` and `filter + drop-shadow(...)` strings to that provided
>   element, preserving scene-level CRT/NVG/FLIR glow and once-per-layer
>   filtering. The surface is host-owned but **parented into `#cesiumContainer`
>   at `z-index:5`**, not into `#world-overlay-root`: the root is a stacking
>   context (`z-index:6`), i.e. an isolated blending group, and a surface inside
>   it has its `mix-blend-mode: screen` silently discarded by the browser
>   instead of compositing against the WebGL scene. z-index (5 under the root's
>   6) keeps it beneath ambient-through-tracked host paint.
>   The >22 ms odd-frame relief valve is restored: the host does not clear the
>   detection surface on a held frame, while unrelated shared lanes repaint,
>   and `throttleSkipCount` remains a live diagnostic. Detection `data-*` fields
>   now live on `#world-overlay-canvas`, while the StyleManager diagnostic API
>   remains unchanged. Disable and suspension deactivate only the detection
>   lane, leaving unrelated host entries intact; teardown unregisters the lane
>   before the host is destroyed. The production-shaped allocation gate covers
>   5,000 visible Dense observations at 2,500 km under the unchanged 154
>   B/observation/frame ceiling. The host owns one world-overlay `postRender`
>   listener; the repository has five `postRender` listeners total (host,
>   celestial ring, annotations SVG, missions frame tick, and traffic).
> - **World-label accounting:** All intended label/card migrations use the
>   shared host. The former native `LabelGraphics` exception for cable reference
>   labels was retired on 2026-08-18; cable text may render over tile geometry,
>   so **zero native world-label creation sites remain**. The mission replay DOM vehicle, awareness
>   compass, annotation SVG callouts, and host-owned detection isolation target
>   are explicit exceptions; the awareness ring and cockpit contact pips are
>   non-text out-of-scope surfaces. Annotation callout text, geometry, leaders,
>   and behavior retain their tested presentation; a future annotation style
>   system is outside this phase. `src/overlays/worldOverlayTokens.js` is the single home for
>   shared world-overlay, CCTV-thumbnail, and detection-theme presentation
>   constants. Former source renderers own no canvas, DPR, or world-overlay
>   listener path; the duplicate detection rounded-rectangle helper and dead
>   tactical compatibility helpers are gone. No temporary dual-renderer flag
>   existed to remove. `activeCameraCardEnabled` remains a product
>   presentation control, and `_detectionUserOverridden` remains the documented
>   style-switch persistence state. Browser/GPU performance comparison remains
>   operator-side; the final accounting records only comparable population
>   reductions and deterministic Node allocation/solve measurements. Those
>   allocation gates are calibrated on Node.js 24.14.x; `package.json` permits
>   supported product runtimes on Node 24 or 26, while the allocation runner
>   separately enforces Node 24 for these two calibrated probes. Each probe
>   compiles synchronously and discards explicit-GC
>   transition chunks before applying the unchanged byte ceilings. The unit
>   runner executes ordinary test files with Node's default parallelism, then
>   runs only the two explicit-GC allocation microbenchmark files sequentially
>   and one at a time with `--expose-gc`, so unrelated tests cannot perturb their
>   calibrated budgets and each isolated test process has the same GC contract
>   as its measurement worker.
>   A worker spawn, exit, output, or availability failure is a failing gate, not
>   a passing skip.
> - **Phase 5 earthquake labels:** Earthquake disc ellipses and pickable
>   entities remain Cesium-native, but their magnitude text is now an
>   `ambient-label` source in the shared world-overlay host. The source formats
>   `M#.#` text and depth-band accent colors, publishes only the 96 largest
>   current events with stable id tie-breaking, and declares a 48-winner
>   ambient-label budget. Host keyhole fading, horizon culling, UI exclusion,
>   and final collision apply. Disable/destroy clear and hide the source; real
>   earthquake entities carry no native label graphic.
> - **Phase 5 bikeshare selection:** The selected station keeps its native cyan
>   point highlight, while its station name, availability counts, capacity, and
>   operational warnings now publish as one protected selected-lane host card.
>   The card reads the point's authoritative Cartesian directly, declares zero
>   ambient quota, and therefore cannot be evicted by ambient budgets. Shared
>   keyhole fading, horizon culling, UI exclusion, and selected-card paint
>   order apply. Clear, disable, and destroy remove the host entry; the selected
>   Cesium entity carries no label graphic.
> - **Phase 5 ISS and tracked-satellite labels:** The ISS path and large red
>   point remain native, while persistent `ISS` text is a one-entry moving
>   ambient-label host source. Its getter reads the already-propagated point
>   cache, preserving the 1 Hz fleet epoch and eliminating the former second ISS
>   propagation. Satellite tracking continues to publish exactly one protected
>   tracked-lane card through `gevLabelModel` and `_trackedDisplayCached`; the
>   tracked entity is point-only. Tracking ISS suppresses the ambient entry and
>   untracking restores it, preventing duplicate ISS text. Disable, orbit-text
>   preference changes, catalog rebuild, and destroy clear/hide the source.
> - **Phase 5 active CCTV projection label:** The active camera's monitor plane
>   remains native Cesium geometry, while its camera-name label is one protected
>   selected-lane host entry. The entry closes over the same cached
>   `positions.label` Cartesian updated whenever the plane geometry moves, so
>   label and plane retain a single placement authority. Only the active,
>   projection-visible camera publishes; hide, disable, runtime destruction,
>   and state clear remove the source. Monitor-plane entities carry no native
>   label graphic.
> - **Phase 5 tracked civil aircraft label:** A tracked flight's Cesium entity
>   is a billboard-only camera target with no native label. The flight source
>   retains callsign/registration fallback, flight-level/altitude, speed, stale
>   state, airline/type, and plausible-route formatting in `gevLabelModel`; the
>   one protected tracked-lane host card renders that complete model. Its
>   position getter reads only `_trackedDisplayCached`, the same authoritative
>   Cartesian already consumed by the tracked visual and camera, and never
>   advances dead reckoning from the host frame.
> - **Aircraft label convention (both flight layers, 2026-08-18):** every civil
>   and military label surface resolves **callsign → registration → icao24**
>   (`_contactLabel()` in `flights.js`; the same chain inline in
>   `militaryFlights.js`) — tracked readout, detection card, `getNearby`,
>   `getDetectableObjects`, `getAllPositions().label`, `getTrackedSubject`, the
>   analyst record, the Context subject/nearest list, the Cockpit signal list,
>   and the `track_entity` voice narration. Registration is aircraft IDENTITY,
>   not route, so unlike origin/destination it is **not** routePlausible-gated.
>   Identity stays `icao24` on every keyed surface (`getNearby().icao24`, the
>   detection `sourceId` declutter hashes, and the `id` that `trackById` and the
>   Context cohorts resolve) — only the displayed string follows the chain.
>   Because adsbdb enrichment can answer *after* selection, the Context subject
>   re-resolves its label each refresh (`resolveSubjectLabel()`) instead of
>   freezing the selection-time snapshot.
> - **Phase 5 tracked military aircraft label:** The military tracking entity
>   is likewise billboard-only and label-free. Its source-owned model retains
>   callsign/registration fallback, stale cue, aircraft type, registration,
>   operator, altitude, and speed, rendered as the sole protected tracked-lane
>   card with the amber military accent. Its getter reads only the military
>   `_trackedDisplayCached` publisher, keeping the host, visual, and camera on
>   one dead-reckoned frame sample.
> - **Phase 5b Space Mission labels:** Launch markers publish through a bounded
>   48-candidate / 24-winner ambient-label source. Selecting a mission clears
>   that overview and publishes its launch-site, stage re-entry, payload
>   position, and orbit annotations as protected selected-lane entries; every
>   source-formatted line and accent remains intact. Static entries reuse the
>   mission geometry Cartesians, the payload getter reads its per-frame live
>   cache, and catalog-backed orbit text reads the cache updated with the ring
>   matrix. Refresh, deselect, disable, and destroy replace or clear the real
>   sources. Mission Cesium entities carry no label graphics, and the shared
>   host replaces the former quadratic label overlap pass.
> - **Phase 5 cable depth-testing decision (2026-08-02, REVISED 2026-08-18 →
>   Option 2):** the 2026-08-02 ruling kept submarine-cable reference labels
>   native (`disableDepthTestDistance: 0`) as the sole approved world-label
>   exception so photorealistic tiles could occlude label text. On 2026-08-18
>   that exception was retired after performance measurement: the native
>   path evaluated 5,258 `CallbackProperty` channels per frame across 2,629
>   reference entities and re-batched a 160-label `LabelCollection` per sweep,
>   costing the layer ~9.5 ms/frame during camera motion (≈42 → ≈59 fps
>   measured headless at a mid-Atlantic orbit). Cable text is now a bounded
>   nearest-160 `ambient-label` host cohort (`telegeographySubmarineCables.js`
>   publishes on the dirty sweep — `moveEnd`/enable plus the 2 s/250 m motion
>   fallback for tracked and orbit cameras — skipping identical
>   cohorts); stems/points stay Cesium-native, depth-tested, and pickable, so
>   only TEXT lost tile occlusion — the same trade every other host label
>   already shipped: labels may render on top of tiles. The dedicated
>   `submarine-cables` allocation row gates
>   the new source at 17,015 B/frame median (106.3 B/candidate, Node 24)
>   under a 19,000 budget, and the all-live aggregate row was recalibrated
>   with the cable cohort folded in (164,711 B/frame median, 190.6
>   B/candidate, 182,000 budget); the intermediate phase rows keep their
>   historical pre-cable composition. `load()` carries a load-generation
>   ownership token (the militaryAwareness activationId pattern): a stale
>   aborted load bails after every await and never clears a successor's
>   lifecycle, so rapid toggle/destroy sequences cannot double-add data
>   sources.
>   The 639-candidate Phase-5b row (353 painted, 133,769 B/frame, 209.3
>   B/candidate) remains as an intermediate historical gate; as of the
>   2026-08-18 recalibration the all-live aggregate — every shared-host
>   source including Radio and the migrated cable cohort — is 864 candidates
>   / 398 painted at 164,711 B/frame (190.6 B/candidate) under a 182,000
>   budget. The image-inclusive ceiling remains attributable to CCTV, while
>   the isolated mission row measures 108.2 B/candidate/frame under the
>   shared 154 ceiling.
>   FIRMS severity/source formatting, its pre-existing 150 px greedy selector,
>   selected-fire semantics, and LOD distance limits stay in `firmsHeatmap.js`;
>   `firmsLabels.js` is formatting-only. FIRMS entries use the host's tactical
>   card painter, vertical above/below placement, severity top rule, shared UI
>   exclusion/clip, horizon culling, distance-alpha channel, and always-on
>   `edgeFade: 'keyhole'` policy. Selected fires are protected in the selected
>   lane and bypass both the 18-card ambient cohort and distance fade while
>   excluding ambient cards from their footprint. Disable and destroy clear
>   the source rather than leaving a stale host entry. This is not a
>   pixel-for-pixel port: global collision/UI avoidance can choose fewer cards,
>   host horizon culling is explicit, and ordinary map mode now retains the
>   shared Outside floor instead of bypassing edge fade through the former
>   cockpit/celestial gate.
> - **Vessel card ownership:** `aisLiveVessels.js` retains the 800 ms visibility
>   pass, 118 px one-winner grid, priority ranking, 150 px greedy separation,
>   type/detail formatting, and the AIS positions produced by its unchanged sea
>   datum path. It publishes ambient tactical cards and one protected selected
>   card into the host. `vesselLabels.js` is formatting/policy-only: no vessel
>   canvas, projection, paint loop, or post-render listener remains. Ambient
>   vessels share `ambient-card`; the selected entry paints in the selected lane,
>   bypasses the ambient cohort/distance fade, and its protected rectangle
>   excludes sibling ambient cards. Tracked readout still excludes AIS, avoiding
>   a duplicate card for the same selection. Disable and destroy clear the host
>   source. This is not a pixel-for-pixel port: shared cross-source collision,
>   UI exclusion, and horizon culling can admit fewer cards than the isolated
>   canvas, and the shared always-on keyhole policy now applies the shipped
>   Outside floor in ordinary map mode instead of using the interim active-mask
>   gate.
> - **Tracked-readout ownership:** `trackedReadout.js` is now a presentation-model
>   bridge only; it owns no canvas, projection, post-render listener, layout,
>   keyhole fade, or paint path. Civilian flights, military flights, satellites,
>   and mapped installations write explicit `gevLabelModel` objects and expose
>   `gevDisplayPosition` getters backed by their layer-owned frame/display cache.
>   Selected AIS vessels continue using the vessel source's protected selected
>   card, so they do not create a duplicate tracked readout. The host registers
>   the active readout in the protected tracked lane with a zero ambient quota;
>   protected semantics bypass that quota and reserve the painted footprint
>   against ambient cards. Moving sources never fall back to a fresh
>   `entity.position.getValue()` in post-render. Annotation fade queries the
>   host's actual `getOverlayPaintRect('tracked', trackedId)` after layout and
>   unions it with the tracked billboard extent. Untrack, context clear, and UI
>   destroy clear/hide the source. This is not a pixel-for-pixel port: placement
>   is host-rounded, cross-source/UI exclusion and horizon culling now apply,
>   accents are source-stable rather than detection-theme-derived, and the old
>   screen-coordinate deadband was removed in favor of the authoritative layer
>   frame cache.
>   Civilian and military poll reconciliation refreshes this model after fresh
>   kinematics and again when a missed poll enters the `STALE` grace period.
>   Satellite pre-render propagation refreshes its altitude line from the same
>   per-frame SGP4 sample used by the tracked dot and camera.
> - **CCTV thumbnail ownership:** `cctv.js` retains the 20/28/40 zoom selection,
>   40-card shipped maximum, 112 px source declutter, eviction grace, frame
>   fetching/cadence/retry, stable slot cache, last-success persistence, hover
>   pinning, and activation. `cctvCards.js` is now source policy plus pure
>   lifecycle helpers only; it owns no canvas, post-render subscription,
>   Cesium projection, layout solve, paint pass, or hit store. The shared host
>   paints its exact 96×54 thumbnail inside the 104×77 shipped chrome, applies
>   the same 1.0→0.45→0.35 altitude scale and 7,500→9,500 m fade, shared
>   keyhole fade, full UI exclusions, and tracked/protected footprint
>   exclusion. Ambient entries paint nothing before their first successful
>   frame; a user-pinned entry retains the documented immediate empty-chrome
>   exception, and later failures never clear the last successful frame. The
>   active camera is excluded from the 40-card ambient quota and has no host
>   card by default: its monitor plane is the active representation. The
>   product option `cctvLayer.setCardPresentationOptions({
>   activeCameraCardEnabled: true })` may publish it through the retained
>   protected path. CCTV leaders use the source cyan, remain vertical at the
>   camera anchor except for the off-card edge clamp, and counter-scale to one
>   CSS pixel through the altitude transform. Card hits come from
>   `hitTestWorldOverlay` after a
>   scene pick miss with no canonical scene-object ID. CCTV billboard ownership
>   is proven by the owning collection/object rather than a bare upstream ID,
>   so an independent sibling with a colliding ID still wins. As a completed,
>   narrowly extended ownership hardening step, property-bearing Entity picks
>   must also be the exact stored CCTV coverage/projection object; copying the
>   `cctvCameraId` property cannot impersonate a camera. Card hits pass through the
>   6 px / 400 ms gesture guard
>   before activation and the existing click-to-fly event. CCTV cards are not
>   sprite-focus-dimmed. Disable/destroy clear and hide the host source, stop
>   pacing, detach in-flight image handlers, and empty source caches.
> - **Cockpit left-panel chrome:** opening any left-stack panel fades the
>   overlapping left pitch-rail glyphs out. The separately right-anchored pitch
>   rail remains visible, and panel/context-card stacking is unchanged.
> - **Cockpit context stacking:** the context card renders above visor glass,
>   pitch/heading instruments, altitude/speed tapes, and the signal window.
>   Topline vision and exit controls retain the highest in-cockpit layer.
> - **Space Missions dependency shutdown:** disabling a mission dependency or
>   leaving the mode closes mission context and restores the exact pre-entry
>   Satellite enabled state and presentation parameters. Restored parameters
>   never re-show primitives while the Satellite layer is disabled.
> - **Flights 3D/cockpit hardening:** the destination-direction cue is an
>   inline SVG rather than a remotely loaded Material Icons ligature, so a
>   blocked or late font can no longer expand the literal word `navigation`
>   across the cockpit. The grounded `airplane.glb` belly offset is calibrated
>   to the current asset's measured Y-up bounds (`0.063` native units).
>   Contact Previous/Next and Live Signals aircraft handoffs now
>   re-seed the first-person camera anchor at the selected flight immediately;
>   bounded feed-correction smoothing remains scoped to the same aircraft.
>   When NEXT has no flight inside the normal 250 km Context window, it searches
>   both civilian and military feeds at successively doubled radii through
>   16,000 km and transfers the cockpit to the closest available aircraft.
>   Tracked cameras now share one ENU frame across Cesium and the close-range
>   guard: switches relocate to the new aircraft, zoom stops 150 m short of
>   crossing the target, and the icon/model, label, trail head, and camera are
>   prepared from the same frame. The guard frames once and then leaves
>   Cesium's EntityView as the sole continuous camera writer. The tracked
>   entity remains a pure position/billboard target with no unused aircraft
>   orientation input; 3D→2D handoffs seed the current screen-projected course,
>   course projection uses the camera's right/up basis so it remains valid
>   through the >180° rear half of a tracked orbit, and the host readout consumes
>   that same settled frame cache without a second dead-reckon. Selected
>   3D models are seeded at the tracked position before scene insertion and
>   update before scene preparation from one frame-cached sample, retain real-world scale at
>   ordinary ranges, cap at 200 px
>   when very close for a continuous 2D→3D handoff, and use a 40 px selected
>   model floor near the long-range 3D→2D cutoff so the glTF silhouette remains
>   comparable to the selected billboard; ambient model sizing is unchanged.
> - **Minimal HUD right rail:** constrained focus layout keeps the collapsed
>   CCTV and Context launchers visible and accessible while the expanded
>   Display panel scrolls inside an explicit remaining-height budget. The rail
>   reserves both launcher heights and inter-panel gaps without a self-reversing
>   layout measurement. Tactical HUD instead gives the expanded Display, CCTV,
>   or Context panel exclusive use of the rail and hides its collapsed siblings
>   until the active panel is collapsed.
> - **Context-flow hardening:** the cockpit left accordion stays below the HUD
>   inside its measured safe top/bottom lane. Global Context focus guards exist
>   only for the synchronous selection window, history survives same-layer
>   reselection, and NEXT availability uses the same UNKNOWN-cohort gate as the
>   navigation action. Contacts entry does not wait for unrelated serialized
>   layer teardown; Space Missions waits for every incompatible live/current
>   layer to settle off before replay data starts. A rejected teardown keeps
>   that layer authoritatively enabled, restores any siblings already stopped,
>   and aborts replay entry; the isolation
>   guard remains active until Rocket Launches finishes enabling. Manually enabling
>   another Data Layer is additive in both an active mode and the neutral shell:
>   it does not exit Context, and the added layer joins the pre-entry snapshot
>   when the session is eventually restored. Manually disabling a required mode
>   dependency still exits and restores that union.
>   While Space Missions is active, direct incompatible enables are refused
>   before initialization or polling and explain that the mode must be exited.
>   User entry alone owns the pre-entry snapshot; programmatic dependencies do
>   not replace it, and rapid re-entry snapshots the pending settled restore
>   target rather than partial manager state.
>   Contacts-mode entry chooses the nearest aircraft to the current camera from
>   one uncapped civilian-plus-military pool (military wins an exact distance
>   tie), then falls back to the nearest AIS vessel. An initially empty set gets
>   one retry on the next Awareness refresh tick rather than permanently losing
>   automatic acquisition. Clearing a manually selected subject cancels that
>   pending retry so an intentional deselection cannot acquire another contact.
>   NEXT keeps a cycle-scoped visited set separate from PREVIOUS history. Once
>   every current target is visited, it starts a deterministic new walk with the
>   current subject retained as visited instead of re-admitting all candidates
>   into a nearest-contact ping-pong. Expanded flight searches use the same reset
>   rule. Vessel focus uses a 3 km bounding sphere at entry and during cycling.
>   The user-facing mode is **CONTACTS**: it cycles the nearest contact of
>   whichever supported type is selected (civilian or military plane, AIS vessel,
>   or mapped installation). Satellites are explicitly outside the Awareness
>   navigation cohorts and retain their independent tracking UX. The cockpit
>   briefing opt-in is labeled `CYCLE OFF` / `CYCLE ON`, with state-specific help
>   that distinguishes page cycling from continuously refreshed live data. The
>   neutral standby summarizes both chooser modes, while the `CONTACTS` and cycle
>   controls keep their short visible state as the accessible name and expose
>   longer help only as a title.
> - **CCTV focus and teardown:** explicit camera choices still activate during
>   cockpit mode, but they retain aircraft tracking, suppress the view flight,
>   and ask the user to exit cockpit. Layer enable is activation-only when a
>   tracked entity or cockpit owns the view, with no flight or cockpit-exit toast.
>   Voice select/next/previous/nearest actions report when tracking or cockpit
>   refuses their requested flight without hiding the successful selection.
>   Camera deactivation and layer disable both clear temporary probe clamps;
>   disable re-arms the active record, re-enable restores nominal geometry without
>   probing, and the next real activation re-runs the obstruction probe. Disable
>   uses a direct hide sweep; obstruction hits retain the field-derived 12 m floor.
>   Geometry-drain progress notifications are coalesced to roughly 300 ms or ten
>   batches, whichever arrives first. Natural completion publishes its final
>   state; disable publishes the terminal state explicitly when it cancels a drain.
>   Coverage polylines are lazy: catalog init creates none, while enable in the
>   default COVERAGE ON mode materializes the active camera and visible neighbor
>   cohort (70 entities at the 14-camera cap). Activation always materializes the
>   selected frustum, including COVERAGE OFF when projection remains on.
>   Empty-space deselection removes the active projection and active-relative
>   coverage emphasis but preserves the layer, coverage mode, ambient cards,
>   catalog, panel settings, and viewer pose. With no active camera the panel
>   exposes no stale dropdown/FOCUS/calibration target; NEXT starts at the first
>   catalog entry and PREVIOUS starts at the last.
>   While aircraft tracking or cockpit mode owns the view, the geometry drain
>   rechecks ownership per batch and drops to two records every 250 ms. Enable
>   focus decisions conservatively combine pre- and post-await ownership.
> - Share-link camera restoration re-applies its settled pose and requests a
>   render after the flight completes, ensuring Google Photorealistic 3D Tiles
>   stream at a deep-link destination without requiring manual camera input.
> - **Reversible Context handoff:** enabling Global Context snapshots the exact
>   enabled-layer set and every runtime parameter it changes, then clears
>   unrelated active Data Layers. Mode switches, required-dependency disables, direct
>   disable, and teardown restore that pre-entry state before control leaves
>   Context. Directly switching between Flights and Space Missions remains
>   supported without losing the original snapshot. Contacts waits for the
>   dependency releases it owns before restoring that snapshot, so the first
>   Space Missions selection completes without a stale teardown superseding it.
> - **Space Mission horizon occlusion:** mission dots and hover reticles apply
>   their surface-anchor horizon state before Cesium draws or picks the frame,
>   while shared-host labels use the same hidden-globe horizon contract. Rear-side
>   markers therefore cannot remain from the prior camera frame, including in
>   request-on-demand photoreal views; the conservative limb margin remains.
>   Graphics that begin with Cesium's implicit visible default are enrolled in
>   that pass on their first frame rather than bypassing the cull.
>   Selecting a mission isolates its launch anchor until Show All / Deselect
>   or the panel close control clears the selection.
> - **Cockpit flight signals:** Live Signals shows the current and nearest
>   flight names as larger clickable controls. Selecting a name transfers the
>   active cockpit tracker to that flight; type and distance remain secondary
>   text without repetitive event-category headings.
> - **Ground-safe cockpit:** the first-person anchor and final camera position
>   are clamped to the shared mesh-first rendered-surface floor with 12 m of
>   clearance. In the photoreal stack, grounded entry keeps the existing safe
>   map camera until that rendered mesh cell resolves instead of trusting a
>   delayed/raw aircraft height as a temporary surface. Successful one-shot
>   model ground snaps populate the same shared mesh cache, and repeated
>   grounded source timestamps lift their stored history when the floor warms.
>   Landing and taxi tracks therefore cannot place the camera below terrain or
>   inside photoreal 3D Tiles.
> - **Display panel width:** across desktop HUD layouts, the expanded right-rail
>   Display panel uses a 272 px glass-backed surface; its collapsed tab and
>   narrow-screen layout retain their existing responsive widths.
> - **Cockpit rolling telemetry:** the central speed, heading, and altitude
>   values use per-digit vertical rolls when their displayed values change.
>   Increasing and decreasing values move in opposite directions, and heading
>   accounts for the 359°/000° wrap.
> - **Cockpit route cue:** when reliable destination coordinates are available,
>   the estimated-destination arrow occupies a fixed centered slot above the
>   lower telemetry, follows the apparent ground-plane perspective, and rotates
>   to show relative bearing within a legible ±120° steering range. Flights
>   without destination enrichment omit the cue.
> - The skylight feature set and six field-test hardening rounds shipped
>   2026-07-03; **CCTV v2** shipped 2026-07-04.
>   Voice tools are **28**. Global Context can be entered or exited directly,
>   and Cockpit voice control supports status, entry from a selected or tracked
>   aircraft (establishing Contacts first), exit, and filtered Previous/Next navigation through the full
>   nearby-contact cohort. Contacts exposes source-honest counts inside its
>   250 km subject window.
> - **Height-datum system (2026-07-08):** Caltrans + TfL camera packs (~900
>   cameras) and the height-datum work fix entity heights on the
>   ellipsoidal globe end-to-end (geoid module, keyless Re:Earth terrain for the
>   OSM stack, ground-floor system with rendered-mesh sampling, always-visible
>   sprites/trails, OpenSky credit governor). The 2026-07-08 CHANGELOG entry
>   records the subsystem's architecture, invariants, residuals, and verification.
> - **Height-datum test surface:** `npm test` 184 unit · `npm run
>   test:track` 43 tracking invariants · headless QA harnesses under
>   `scripts/qa-*.mjs` incl. `qa-height-datum.mjs` (numeric heights) and
>   `qa-floor-verify.mjs` (any-airport ground-truth oracle).
> - **2026-08-19 — display-time ground floor (flights layer).** A grounded
>   contact's render height is picked once per poll from the floor of its FIX
>   cell, but what renders is the dead-reckoned position, which drifts across
>   cells for the whole segment and for hundreds of metres while a contact
>   coasts on a stale feed. On a graded apron that buried sprites under the
>   mesh (measured −15.5 m at KAUS; `qa-floor-verify` reported FAIL). The fleet
>   pass and the tracked display path now re-floor the DISPLAYED coordinate
>   against `cachedGroundFloor` — read-only, grounded contacts only, and never
>   while a 3D model owns the visual (T7 ground-snap one-shot). The poll's floor
>   warm/sample batch additionally collects each grounded contact's display
>   CORRIDOR (the ground it is about to cross — toward its newest fix while
>   interpolating, along its course while coasting), need-ranked and deduped so
>   parked contacts never crowd out moving ones. Budget is charged only for cells
>   with no floor yet — warm cells are still emitted, because the mesh sampler
>   must see a cell again once its DEM prior lands — which gives a service bound
>   that falls out of the policy: every contact is served within
>   `ceil(contacts / budget)` polls. Sample spacing along a projected arc derives
>   from its length (never a fixed count, whose spacing widens with speed), and
>   the cell walk steps at an eighth of a cell, so any cell the path occupies for
>   ~14 m of ground or more is collected. The corridor
>   integrates the SAME constant-rate turn the dead-reckon does, so a
>   sustained-turn taxi warms its arc rather than a straight tangent. Visual
>   ownership — not model existence — decides when the clamp stands aside: a model
>   owns the visual only while it is actually RENDERING (`ready && show`, the
>   pair the billboard handoff itself consults), and the tracked path also
>   requires `_trackedModelRegimeActive()`. So neither a retained-but-hidden
>   model (3D off, zoomed out, cockpit) nor one still loading suppresses
>   flooring while the billboard is what the user sees. **The visual/data split is deliberate**: visual
>   consumers are floored at the per-frame cache, while `_describeFlight` — and
>   so `findByQuery`, `getTrackedInfo`, `getTrackedSubject` — keeps reporting
>   sensor truth (barometric `altitudeM`, fix-time `renderAltitudeM`), because a
>   query or an altimeter should answer what the aircraft reported, not where its
>   icon was nudged to clear the tiles. Residual, unchanged by this
>   work: the floor is a ~111 m cell, so intra-cell relief (terminals, jet
>   bridges) and contacts moving faster than the 30 s warm batch can still read
>   metres low. `qa-floor-verify.mjs` now **exits non-zero on FAIL** (1 = FAIL,
>   2 = INCONCLUSIVE); it previously exited 0 on every verdict, which is how the
>   burial stayed invisible. It also honours `QA_BASE_URL` and puppeteer's
>   pinned Chrome-for-Testing, like the other harnesses.
> - **2026-07-16:** the FIRMS Active Fires layer is **LIVE** —
>   the bundled 2026-05-25 snapshot (58 MB) is deleted; a new `/api/firms` proxy
>   (vite.config.js) merges VIIRS NOAA-20/NOAA-21/Suomi-NPP NRT world CSVs
>   (days=2 → trailing-24h clamp, 30 min memory+disk cache, single-flight,
>   serve-stale-on-failure) behind server-side `FIRMS_MAP_KEY` (keyless → 503 +
>   in-app KEY REQUIRED chip). Client polls 10 min (`src/data/firmsHeatmap.js`;
>   adapter `src/data/firmsAdapt.js`, CSV parser `src/data/firmsCsv.js`).
>   `/api/firms/status` reports cache age + MAP_KEY transaction usage.
> - **2026-07-16:** Traffic supports optional live
>   TomTom flow through the server-side, budget-governed `/api/tomtom` proxy;
>   keyless installs retain the byte-identical white-dot simulation.
> - **2026-07-22 (CCTV v3 Parts A+B):** replay, color-coded viewsheds,
>   save-gated direct-manipulation calibration, `viewshed`/`adjust` voice
>   actions, shared-floor E/N drag grounding, and bounded snapshot requests are
>   integrated. Citywide static-plane LOD/pacing work remains outside runtime.

> **2026-07-02 milestone:** the skylight aircraft/satellite/enrichment work and
> pre-ship hardening fixes landed.
> Runtime changes reflected below: **voice tools 17→20 at the 2026-07-02 milestone** (`next_iss_pass` + the 19 already on
> main), type-aware 8-class aircraft sprites + path-derived rate-limited display heading, adsbdb
> flight enrichment (cached proxy + route-plausibility gate), disk-cached CelesTrak TLE proxy,
> ISS pass prediction, and per-layer data attribution. Gate at close: unit 98/98, build clean,
> track 19/19, + five QA harnesses (heading 16/16, sprites 9/9, cctv 5/5, failstate 5/5,
> attribution 18/18). New modules: `src/data/{motionModel,aircraftMeta,aircraftClass,aircraftIcons,issPass,routePlausible,dataCredits}.js`.
> The live runtime now declares 28 voice tools; the 17→20 count above is retained only as milestone history.

## Canonical Docs Order

Use docs in this order when details conflict:

1. `docs/CURRENT-STATE.md` (this file)
2. `docs/opensky-auth.md` (OpenSky authentication)
3. `CHANGELOG.md` (release history)

Historical planning documents may not match runtime behavior.

## Current Baseline

- Repository metadata and public URLs use the `bilawalsidhu/gods-eye-view`
  project identity. Runtime behavior is defined by this document and the current
  source tree rather than historical branch notes.

## Runtime Stack

- Vite + CesiumJS app with Google Photorealistic 3D Tiles
- Scene/HUD/style systems in `src/ui.js` and `src/hud.js`
- Layer management in `src/data/manager.js`
- Map stack switching in `src/mapStackController.js`
- Voice control in `src/voice/` (OpenAI Realtime over WebRTC)
- Voice map whiteboard annotations in `src/annotations/`
- 3D aircraft/model tracking surfaces in `src/data/flights.js` and `src/data/militaryFlights.js`
- Detection overlay and tracked-target readout in `src/data/detection.js`, `src/data/detectionDraw.js`, and `src/data/trackedReadout.js`
- Proxy middleware and API wiring in `vite.config.js`

### Active Data Layers in Runtime

Qualified Radio playback requests—category, station, country, coordinates, or
nearby place—always use station selection. Unqualified “turn on/start the radio”
requests use Play; a qualified Play-shaped tool call is normalized to Select so
its criteria cannot be silently ignored.

| Layer | Source | File | Proxy | Update Interval |
|-------|--------|------|-------|-----------------|
| Live Flights ✈️ | OpenSky Network; bounded adsb.lol regional fallback | `src/data/flights.js` | `/api/opensky` (OAuth + fallback) | 30s |
| Military Flights 🎖️ | adsb.lol /v2/mil | `src/data/militaryFlights.js` | `/api/adsblol/mil` | 15s |
| Live AIS Vessels 🚢 | AISStream websocket | `src/data/aisLiveVessels.js` | `/api/ais-live` | 60s (+800ms visibility pass) |
| Mapped Installations ⌖ | OpenStreetMap mapped context; on-demand Google Maps Places supplement | `src/data/militaryInstallations.js` | `/api/military-installations`, `/api/google/text-search` | viewport-driven + user search; while unavailable, auto-retry 30 s → 240 s backoff |
| Earthquakes | USGS + EMSC/CSEM | `src/data/earthquakes.js` | `/api/earthquakes/usgs`, `/api/earthquakes/emsc` | 60s |
| Satellites | CelesTrak | `src/data/satellites.js` | `/api/celestrak` | 120s |
| Space Missions (30d) | Launch Library 2 + CelesTrak | `src/data/rocketLaunches.js` | `/api/launches` + `/api/celestrak/active` | 5 min |
| Traffic | OSM Overpass (+ optional TomTom live flow) | `src/data/traffic.js` | `/api/overpass` + `/api/tomtom` | viewport-driven |
| CCTV | Austin + Caltrans (CA) + TfL London Open Data + Street View fallback | `src/data/cctv.js` | `/api/cctv` | 10s (active) |
| Radio | Radio Browser (public-domain station directory) | `src/data/radio.js` | `/api/radio/stations`, `/api/radio/click/:uuid` | 45 min directory refresh |
| Bikeshare 🚲 | GBFS (Lyft + BCycle) | `src/data/bikeshare.js` | `/api/gbfs` | 60s |
| Datacenters ▣ | OSM extract (bundled) | `src/data/localLayers.js` | — | static |
| Dams ▰ | OpenInfraMap/OSM extract (bundled) | `src/data/localLayers.js` | — | static |
| Submarine Cables ◠ | TeleGeography public map (bundled) | `src/data/telegeographySubmarineCables.js` | — | static |
| FIRMS Active Fires ▲ | NASA FIRMS live (VIIRS ×3 NRT, trailing 24h) | `src/data/firmsHeatmap.js` | `/api/firms` (`FIRMS_MAP_KEY`) | 10 min (proxy TTL 30 min) |

`src/data/militaryAwareness.js` remains registered internally as the Contacts
coordinator, but it is not a user-visible Data Layers entry. Its visible entry
point is the right-side `CONTEXT` chooser's `CONTACTS` mode.

At global scale, ambient Radio cluster badges are hard-opacity shared-host
entries: count/category updates and identity replacement do not run keyhole or
enter/exit ramps. Shared collision, viewport rejection, allocation, and horizon
culling can still remove an invalid placement, and Cesium still owns the cluster
point geometry and picks. Their 50,000 km line-of-sight range covers the
supported full-globe camera above 24,000 km, including farther horizon clusters.
Unclustered visible stations publish nearest-first ambient labels through that
same host, capped at 16 labels globally, 32 at intermediate zoom, and 48 nearby;
cluster and singleton candidates still share the Radio source's 64-entry ambient
cohort. Cesium continues to own each 13 px station point, horizon visibility,
and direct/nearby picking. Native points and shared-host text use one 50,000 km
interaction limit, so a painted singleton or cluster label always retains a
pickable point at its anchor throughout the supported high-global view. No
Radio entity uses native Cesium label text.

Delivery constraint: PR #10 is stack-only and unsafe standalone. PR #11 owns
the required Radio lifecycle/authority repair, so PR #10 must not merge or ship
unless PR #11 is included in the delivered stack.
Selected and singleton globe labels use the same compact 30-character
presentation: a credible explicit or leading-decimal frequency is rendered
first (`93.9 FM — Station`), otherwise the station name is ellipsized. Full
upstream names remain unchanged in the directory, player, and search state.
Fresh Radio sessions open on All stations while enable and restoration remain
silent. Directory refreshes retain cluster overlay identity for unchanged
represented membership and discard only identities containing removed stations.
When the user explicitly clicks Enable inside the expanded Radio section, the
Context panel performs one internal post-render scroll to reveal the station
filter and primary transport together without moving keyboard focus, the page,
or the globe. Compact controls, voice/tools, restoration, Data Layers, and
programmatic activation do not trigger this reveal.

Radio directory admission is atomic on both sides of the proxy boundary. A
refresh is healthy only when it reaches the minimum accepted-query and station
coverage; schema-valid responses with zero normalized stations count as failed
queries rather than inflating refresh health. Each specialist query also needs
an accepted station whose normalized tags match that requested category; rows
tagged only for another category remain usable catalog data but do not earn
specialist health credit. A partial cold result remains
usable but is explicitly `DEGRADED` and has no accepted catalog generation, while a
partial or malformed refresh cannot replace a warm catalog. The client likewise
rejects stale/future freshness metadata, incomplete rows, and empty catalogs as
a whole, preserving its last usable stations with `STALE`/`DEGRADED` state.
Every healthy admission publishes a monotonically increasing generation scoped
to a restart-stable `catalogInstance` token (a new server process starts a
fresh sequence — never read as a repeat or a regression) with a deeply
immutable station snapshot; stale/degraded warm responses retain the same
generation so tuner and cluster consumers can preserve exact station identity.
Generation semantics assume the app's actual single-process dev-server
deployment; concurrent replicas behind one origin are out of scope.
The client snapshot contains only the normalized station-field allowlist,
preserves object identity for an idempotent repeat of the same generation, and
degrades without replacement if a fresh response presents an older generation.
Snapshot records mark community metadata as untrusted, and Radio tool results
omit station names so directory text never becomes model instruction context.
One bounded country parser maps recognized ISO codes and English/common names
through proxy metadata and final station selection, while malformed, non-ISO,
control-containing, and oversized inputs fail closed. Literal or resolved
non-global IPv4/IPv6 targets are refused. Destroy fully releases the Radio audio
session, voice ducking/restoration, request state, filter, selection, volume,
accepted snapshot, and feed telemetry before re-initialization; monotonic
ownership tokens plus the session boundary keep late callbacks from a retired
session inert.
A tuner drag resolves previews against the single accepted snapshot captured at
pointer-down, even while a newer catalog is admitted. Release starts playback
only when the current same-ID record still exactly matches the frozen
presentation and stream metadata; removal or replacement reports the channel as
unavailable and never silently retargets the drag. A cold degraded fallback may
still populate the directory and globe, but its null accepted generation cannot
populate or begin the tuner.

Context entry and exit consider both rejected lifecycle promises and resolved
`false` manager results to be transaction failures. Entry awaits isolation and
restores the exact prior layer snapshot when isolation or activation fails;
when a direct Context shell fails after lifecycle work starts, reconciliation
waits outside the manager notification until that shell's queue settles, then
restores the complete snapshot rather than treating the in-flight layer as an
exclusion. An uncertain shell is retried and incomplete cleanup retains the
snapshot for a later restore. Direct-shell isolation and its compensating
rollback share one operation-scoped notification token, so an inner lifecycle
failure cannot announce separately from the outer blocked action. Context exit
waits for every sibling transition, retains the exact pending snapshot
after failed compensation, and can retry it later instead of silently reporting
a partial restore. User-facing Context chooser, direct Data Layer shell,
mapped-installation Search, rollback/exit, and Radio chip routes settle those
failures through the existing toast surface, release busy controls, and avoid
unhandled promises. A wrapped operation owns exactly one failure or blocked
notification; its synchronous manager event is suppressed only for that
operation, while unwrapped lifecycle failures retain the manager-level fallback.
The toast is a polite atomic status announcement.
When no tracked entity owns the follow camera, Radio Previous/Next and tuner
previews rotate to the requested broadcaster without changing zoom. A local
view whose optical center remains safely over the Earth, or a full globe already
contained in the viewport keyhole, uses one direct station flight and preserves
its initiating view angle. If a fit-capable Earth disc is clipped/off-center, or
a closer oblique view leaves the viewport center outside the Earth disc, Radio
first animates a centered north-up nadir composition, then focuses the latest
station from that canonical frame. Closer views keep their initiating altitude;
an extreme zoom-out is capped at 13,000 km so recovery returns to a useful
whole-globe scale instead of preserving an empty-space view. The two-stage navigation has one generation:
a playback fallback retargets it to the broadcaster that will play, while a newer
Radio action—including direct globe or non-moving voice selection—supersedes
older callbacks, and layer disable/destroy invalidates
the pending stages. While Flights, Military Flights, or any other
`viewer.trackedEntity` is active, Previous/Next and tuner previews continue to
change station and playback without cancelling or flying the camera. Tracking
acquired between the recenter and focus stages suppresses the later stage, and
a delayed fallback rechecks the same live ownership. Voice Radio navigation
remains non-moving; explicit station focus remains a separate user-requested
route and also yields to a live tracked entity.
The Radio tuner exposes the complete current filtered directory, up to 750
stations, in stable catalog and filter order. Needle progress is absolute across
that directory: the left, center, and right of the control resolve to the first,
middle, and last available station. Every position snaps to a real station, so
there are no selectable static gaps. During a drag, the bounded virtual tape
moves left as the needle moves right and travels faster than the needle without
creating DOM nodes for the complete directory. Camera movement never re-ranks or
rebuilds this order. Tuner-owned preview flights remain monotonic on the captured
strip, and release commits the frozen station before selection and playback
settle. That exact release clears older fallback ownership, so a broadcaster
failure cannot silently play a station left over from an earlier non-playing
cycle; the failed target retains its static/error handoff until Stop or another
explicit choice. Pointer cancellation instead cancels the active preview flight and
restores the exact pre-drag station ordering, absolute position, and frozen
presentation-only marker without starting a replacement camera flight,
committing, or autoplaying. That marker is restored even when an
accepted concurrent catalog removes the station or replaces its metadata, but
it never becomes current playback authority. The next accepted healthy catalog
refresh clears that presentation-only marker, including when the accepted
generation repeats and the immutable directory snapshot is intentionally kept
by identity. Every accepted filter action also clears and rebuilds the marker,
including a request for the already-active filter; a lifecycle-rejected filter
event leaves the restored marker and tuner band untouched. An accepted filter
action synchronously rebuilds the complete navigation pool after the layer state
notification, so Previous/Next and the tuner cannot observe an empty interim
directory. This restoration
also holds at either directory endpoint. Previous/Next traverses the same stable
pool and updates the absolute tuner position.
Cluster refresh identity follows the prior cluster contributing the greatest
absolute number of stations to the new cluster. This preserves majority identity
during merges instead of allowing a fully retained minority to win; deterministic
similarity and stable-ID tie breakers cover equal contributors and splits.
Every positive overlap participates in greatest-contributor discovery, so ratio
thresholds cannot discard a diffuse or one-station maximum. Inheritance is
bilateral mutual-best: a current cluster accepts only a greatest contributor and
a prior identity transfers only to a strongest split child. If that identity is
already claimed by an equal or stronger child, the later cluster receives fresh
identity instead of falling through to a historical minority. Disjoint clusters
also receive fresh identity; sequential fresh IDs are allocated in canonical
membership/station order so input permutations do not rename them.

Voice interprets “turn on/start the radio” as Radio Play, including when it is
combined with a camera action. Explicit “show/enable the Radio layer/markers”
remains a silent layer-only action and does not close the voice session.

Successful explicit user playback from Play/Resume, Previous/Next, the tuner,
or a globe station closes an active voice session only after Radio reaches
`playing`; a failed stream leaves voice active.
An interrupted or superseded voice turn aborts pending Radio location resolution
before it can enable the layer or select a station. Radio enable and disable are
abort-aware manager transactions: cancellation restores the authoritative
pre-transaction state only when the compensating lifecycle call succeeds and
emits no settled explicit-intent event for Context persistence. Failed
activation and teardown expose explicit `enabling` and `disabling` lifecycle
states while the manager retains the last authoritative visibility. The public
lifecycle vocabulary is `enabling`, `enabled`, `disabling`, and `disabled`, plus
a separate uncertainty bit. Radio controls present that phase and remain
non-interactive until the lifecycle is certain `enabled`; only a successful
transaction publishes the new `enabled` or `disabled` settlement. Radio's data
layer state, player message, compact status, launch controls, and generic Data
Layers row explicitly show `UNCERTAIN` when cleanup cannot establish authority;
their accessible labels name the uncertainty while Enable/Disable remains
available to reconcile it.
The Radio source, shared overlays, selected marker, and pick handler use the same
manager-owned presentation gate:
they remain hidden and inert throughout enabling, disabling, cancellation,
failure, and uncertain reconciliation, and activate only for certain `enabled`.
The same gate rejects direct station selection, Previous/Next cycling and its
camera/fallback preparation, tuner-static and category-filter mutation, volume
mutation, and every non-Pause playback toggle before fallback, selection, or
audio state changes. Voice volume and station-starting actions require a fresh
manager lifecycle read.
Every returned `control_radio` result, including status, failure,
cancellation, and a missing Radio module, exposes that same authoritative
`lifecycleState` plus `lifecycleUncertain`; the manager lifecycle record takes
precedence over the stable enabled fallback. Status only reads this state and
does not enqueue lifecycle or player work.
Generic `set_layer_visibility` results expose the same atomic `enabled`,
`lifecycleState`, and `lifecycleUncertain` summary for Radio on success,
fulfilled-false failure, rejection, cancellation, reversal, and missing-module
outcomes. Realtime suppression and settlement refresh all three fields together,
so dedicated and generic Radio routes cannot publish mixed lifecycle snapshots.
`disabled` is inert, while a transitional or uncertain shell is reconciled
through the manager and may proceed only after a fresh read confirms certain
`enabled`; false, rejection, or cancellation preserves the prior player state.
The existing immediate Stop/Pause authority is unchanged.
Cancelled-disable compensation reports failure and records whether lifecycle
state remains uncertain. Any same-target request made while state is uncertain
performs the real lifecycle work instead of taking the stable-state no-op, then
clears that reconciliation debt only after a confirmed enable or disable. A module-local
`AbortError` is a cancellation even while the caller signal remains live, while
that settled transaction releases its abort listener so the old caller cannot
disable a later successful retry. A resolved `false` from init, enable, first
update, or disable is a lifecycle
failure. Unrelated sibling tools remain independent, while each Radio control
captures the current playback-handoff epoch. A later Radio
Pause or Stop provisionally freezes prepared or already-started playback
handoff work without aborting active Select/Play auto-enable or an independent
explicit dedicated or generic Radio visibility ON. After semantic success it
cancels the active Select/Play lane and clears the frozen handoff. Semantic
failure leaves active work live and releases and resumes the frozen handoff.
Disable and generic OFF own visibility as well as playback and may cancel both.
These controls commit their authority only after semantic success, so a failed
stronger control cannot suppress a valid completed sibling. Pause uses the
production player's synchronous boolean contract; Stop and Disable additionally
handle their awaited failure paths. The control's function output is sent before a failed reservation releases,
so resumed playback cannot close the voice channel before the failure is
reported. Resumed handoffs own their attempt-scoped cleanup, so a stale predecessor
cannot clear the successor's in-flight result or block a later failed
reservation from resuming it again.
Generic `set_layer_visibility` Radio disable participates in the same ownership
domain as dedicated Radio controls, so an older Select cannot reverse it. Direct OFF
from either Radio control or the Data Layers row publishes intent before joining
the lifecycle queue and aborts in-flight voice work before an intermediate ON
event can settle. Every absolute manager visibility request also advances a
per-layer intent epoch and aborts the older absolute lifecycle transaction,
including a same-target request whose newer origin must own persistence. An
obsolete queued request never starts; obsolete in-flight cleanup keeps
presentation transitional and hidden, and only the latest request may adopt or
reconcile that state and publish settled visibility. The epoch is rechecked
after synchronous lifecycle-presentation callbacks, so a re-entrant newer
request prevents the older transaction from arming a timer or publishing a
settled visibility event. Superseding an uncertain same-target retry also keeps
the last authoritative enabled boolean until cleanup confirms the real module
state. Direct OFF also freezes
prepared or already-started playback handoff
until the manager queue settles; confirmed OFF discards that handoff, while a
failed OFF releases the reservation and resumes the valid prepared result. A
successful Stop cancels stale Radio work across older response ids as well as
its own response. If a Radio action has already completed its station mutation
before the later control succeeds, only its playback handoff is suppressed; its
result reads enabled state from the manager and audio state from the Radio
module. Voice Pause is a playback-only no-op while the layer is disabled; it
never enables Radio and reports a fulfilled-false pause as failure. A
newer-response or user-origin Stop still cancels stale handoff work.
Only a newer user turn or session teardown aborts the complete active-tool set.
A cancelled turn cannot publish a late Radio playback request. Dedicated Radio
controls and generic layer-visibility commands both forward cancellation.
Each explicit Radio play attempt owns one active audio element; replacement
retires the prior element, making its queued callbacks inert. Pause retires the
current stream and fallback attempt, so delayed callbacks from a replaced or
paused stream cannot change current state or start another station.
Pause and Stop settle attempt ownership and authoritative audio state before
synchronous playback-control observers run, so reentrant voice cleanup cannot
overwrite a released stream with a stale paused state. Layer
destruction likewise retains an enabled manager entry when module disable or
destroy fails semantically, preventing an active orphan and allowing retry.
When Context is collapsed, explicitly activating its Radio header icon reveals
the compact transport; hover and focus alone do not open it. When Context is
expanded, the icon instead expands and scrolls to the embedded Radio section.
Its accessible label, controlled region, and expanded state keep describing the
current route throughout enabling, enabled, disabling, and uncertain lifecycle
renders. Both routes preserve Radio power, playback, station, filter, and volume
state.

Bundled datasets live in `src/data/local_data/` with per-folder provenance READMEs; they are lazily loaded via `src/data/localGeojson.js` (Vite `?url` assets) when toggled on.

A bundled dataset that fails to load is a broken install, not a blip, so it is
never swallowed: `localGeojson.js` guards `response.ok`, reports `error` +
`lastUpdate` through `getStats()` (UNAVAILABLE chip, not a green ON over an
empty globe), and commits its Cesium data source only after setup completes so
a partial failure retries on the next enable. The two non-layer packs
(`naturalEarthRegions.js`, `neighborhoodPolygons.js`) have no stats contract to
report into, so they instead refuse to memoize a failure —
`src/data/retryableLoad.js` caches success permanently and retries a failed
load after a doubling cooldown (5 s → 5 min), which keeps one bad load from
silently demoting every later lookup for the session.

### Context / Contacts coordinator (July 2026)

- The internal Context coordinator is available in every visual style. Its dedicated right-side `CONTEXT` chooser exposes the neutral shell; the coordinator is not duplicated in Data Layers and does not enable a live-data dependency until a mode is selected.
- The expanded `CONTEXT` view offers mutually exclusive `CONTACTS` and `SPACE MISSIONS` modes. Selecting `CONTACTS` enables the context-owned Flights, Military Flights, AIS Vessels, and Mapped Installations dependencies only when they are not already user-enabled; selecting `SPACE MISSIONS` enables the recent-launch layer and its Satellite dependency. `CONTACTS` cycles the nearest supported contact of whatever type is selected. Satellites are deliberately excluded from those Awareness cohorts and keep their own tracking UX. Selecting the active mode again returns to the neutral chooser and releases only mode-owned dependencies.
- If a civilian or military aircraft is already tracked when `CONTACTS` becomes operational, that source-owned track is adopted as the Context subject before nearest-contact autofocus. Context rechecks the tracker after its dependencies settle, so a newer selection wins, while an explicit clear during activation prevents fallback from silently selecting a replacement. Cockpit entry remains unavailable until that Context transaction has settled, so its camera takeover cannot clear Cesium tracking before adoption. Adoption does not recreate tracking or transfer camera ownership; it initializes the normal 250 km ring, history, proximity results, and Cockpit Previous/Next state for the original aircraft.
- `SEARCH NEARBY SITES` retains the bounded OSM results and makes one user-initiated, view-biased Google Maps Places text search for “military installation.” Google results are source-stamped, deduplicated against OSM by rounded location/name, and remain mapped context rather than operational claims. If Places is unavailable or the API is not enabled for the supplied key, OSM context remains available.
- The expanded desktop header omits the redundant `ON` label; the active mode button carries state. Expanded Contact results also omit the duplicate `GLOBAL CONTEXT` / `CONTEXT ONLY` status row and begin with the selected subject and its 250 km scope. Global Context does not fabricate a selected-entity model preview: the provisional hand-authored aircraft wireframe was removed because it was not geometry extracted from the selected entity's actual asset.
- Dependency ownership is reversible: disabling Global Context releases only dependencies it enabled, while user-enabled layers remain on. This also removes the Military-layer suppression handoff when Global Context owned Military, allowing an already-enabled civilian Flights layer to resume its normal mixed rendering. If OpenSky is unavailable and has no last-good cache, Flights requests a capped 250 nm adsb.lol point snapshot around the current view anchor and labels that provenance explicitly; it never relabels military-feed rows as civilian data. If both inputs fail, Flights remains `UNKNOWN`.
- Space Missions is replay-isolated: Rocket Launches and Satellites are the only Data Layers permitted while the mode is active. Direct UI and voice entry capture the same pre-entry snapshot; internal dependency and restoration enables do not create a user-owned Context session. Entry waits for incompatible layers to shut down, direct incompatible enables are blocked before lifecycle work, and the entry gate remains active through the complete Rocket Launches enable. A newer same-target ON request takes ownership of the pending entry without releasing its isolation snapshot, including when it arrives while the prior request is awaiting the adoption guard. A caller abort, resource cancellation, newer OFF, or layer teardown waits for exact manager settlement and restores that snapshot without resurrecting Rocket Launches. If an abort lands after only part of a restore settles, Context completes the same exact target without the stale caller signal and then replays newer explicit layer intent. Dedicated Voice Context cancellation reports a stable cancelled result plus the current Context state; generic layer visibility additionally exposes manager phase, reason, successor, and lifecycle details. Once an exact voice visibility intent commits, a newer voice turn cannot relabel it as cancelled while Context settlement completes; pre-commit aborts remain cancellable and final lifecycle mismatches remain failures. Clear Selected Layers reserves its complete captured OFF set before sequential teardown; a newer absolute request of any origin supersedes only its layer reservation and remains authoritative. A rejected layer teardown retains the truthful enabled state, rolls already-stopped siblings back to the captured pre-entry set, and aborts replay; rapid exit/re-entry serializes the full Satellite enabled-state and parameter restore before a new snapshot is taken. Contacts remains additive and restores user-enabled layers normally.
- Enabled Data Layer controls report normalized feed health on the button (`LOADING`, `DEGRADED`, `STALE`, `FALLBACK`, or `UNAVAILABLE`) while the metadata line retains the source and reason. A partial CelesTrak group failure keeps the usable catalog and reports `DEGRADED`; a total outage keeps last-good catalog data visible but reports `UNAVAILABLE`.
- On activation it focuses the nearest currently observed aircraft across the civilian and military feeds, with military winning an exact distance tie; if none are available, it focuses an observed AIS vessel. The aircraft search is deliberately uncapped and one refresh-tick retry handles initially empty feeds. This is an attention-priority navigation shortcut, not a high-risk, affiliation, or threat classification.
- A selected aircraft, AIS vessel, or mapped installation gets a 250 km **context window** with nearby cohort counts, nearest examples, source labels, and stale/unavailable reasons. It emits `NEARBY` or `UNKNOWN`; no detection, engagement, affiliation, or sensor-activity conclusion is calculated.
- For a selected live aircraft or vessel, the context window refreshes from the existing tracker/feed position every 750 ms, so nearest distances and cohort counts follow the subject without introducing a duplicate poll loop.
- Aircraft cohort membership uses every locally loaded, selectable contact inside the 250 km window, including a plane hidden only by horizon culling or because its 3D model owns the visual. Counts and navigation therefore do not change with the current camera angle or billboard/model handoff.
- Nearby examples in the context panel are focus controls: they use their owning layer's existing selection/tracking path, then frame that contact. Static-installation distances use ellipsoidal surface distance so the count matches the ground-projected context disk.
- Context selection transfers camera ownership by subject type: selecting a civilian or military flight keeps that layer's moving follow camera, while selecting an AIS vessel or mapped installation first releases any prior aircraft tracker and performs only the source layer's one-time framing. The camera therefore remains user-controlled after non-aircraft selection instead of continuing to move with the previously selected plane.
- Selected AIS vessels use their layer-owned full-detail presentation model in the shared world-overlay host; mapped installations use the tracked-readout aesthetic. Both remain crisp above post-processing without duplicate selected labels; non-selected AIS cards retain their source-owned grid/visibility selection and are host-batched with other world cards.
- Space Mission ascent replay uses the compact rocket/thrust overlay only through orbit insertion. Once the replay enters its orbit phase, that vehicle glyph is replaced by a fixed-size cyan dot following the same orbit path and callout.
- While a subject is selected, an inner keyhole compass rotates against camera heading and up to three cyan shafted bearing arrows lock to its single faint tick-marked rim, with their labels inset just inside the circle. Labels explicitly separate the geographic bearing (`BRG`) from the contact's reported course (`CRS`) so the pointer direction is not confused with aircraft heading. They point toward the nearest observed/mapped examples; each cohort displays up to ten examples while retaining the complete locally loaded in-range cohort for navigation, with three visible at a time and a ten-second page rotation shared by the panel and arrows. This distinct neutral-context color avoids implying that all context indicators are military-flight symbols. `PREVIOUS`, `FOCUS`, and `NEXT` controls navigate selection history or the next nearby cohort example through the existing tracker. NEXT uses a cycle-scoped visited set and starts a deterministic new walk after exhausting the current candidates instead of re-admitting the nearest visited contact.
- Installations are viewport-bounded OSM map features (`military=airfield|naval_base|range|barracks|base` and `landuse=military`), capped to a 10° non-dateline request and 700 upstream features. The proxy caches five minutes and serves a one-hour stale fallback. Empty, stale, unavailable, and zoom-too-wide states remain visibly distinct.
- The selected-only visual is one static, unfilled blue circle. It marks the 250 km proximity context window only; it is not coverage or a radar/weapon envelope. Missing broadcasts and unmapped sites are explicitly not evidence of absence.
- The right rail's collapsed Display, CCTV, and Context controls use the same compact sizing language as the left rail's collapsed Data Layers and Scenes controls. These compact-state widths do not constrain expanded panel or child-content widths.

### Motion & Symbology Correctness (June 10, 2026)

- **Flights (commercial + military)** render one poll interval behind real time (30s/15s) and interpolate between two known feed-stamped fixes (OpenSky `time_position`; adsb.lol `receipt − seen_pos`). The display latency is an intentional product decision — do not "fix" it away. The whole fleet dead-reckons at ~12Hz (1m² write gating); aircraft get a 3-poll grace period (faded icon) before removal. When a position epoch pauses, both layers coast for at least 60 seconds of contact grace with an absolute five-minute ceiling. Source backoff marks each contact and the cockpit `STALE`; the cockpit then holds the exact layer position instead of continuing inertial flight. Repeated-position kinematic changes create a forward-only synthetic fix rather than mutating history, and grounded history is lifted only when no owned 3D model already controls its datum. A nominally successful worldwide OpenSky response whose own snapshot epoch is more than two minutes old prefers the existing 250-nm viewport-scoped adsb.lol fallback and labels the source/coverage accordingly when that upstream is available. If the fallback is also unavailable, the layer's freshness/error fields use the source epoch—never the cache receipt time—so the UI reports an old snapshot rather than “just now.”
- **World-space headings at every angle** (`src/data/iconOrientation.js`): aircraft/vessel icon rotation uses the camera right/up basis per tick (alignedAxis always ZERO), which is exact at screen center and for orthographic/nadir views and remains stable through >180° tracked orbits. Perspective rays vary across the viewport, so off-center contacts at oblique pitch can diverge from an exact finite-difference window projection; a regression test pins that known regime, and field evidence decides whether to adopt exact projection with the basis method as fallback. Fleet rotations refresh on camera-pose change; tracked entities per frame. Billboards are horizon-culled via a shared EllipsoidalOccluder.
- **Military/OpenSky reconciliation** (`src/data/militaryRegistry.js`): known-military ICAOs render amber in the flights layer (60s self-poll of the cached mil endpoint when the military layer is off) and are suppressed there while the military layer renders them.
- **Traffic density at globe range** (`src/data/trafficDensity.js`, 2026-09-04): above ~3 500 km camera altitude the flight layer stops drawing individual contacts and renders aggregated density cells instead — 12 000 separate icons at that range are informationally empty (nobody reads them one by one) and still cover a fifth of the screen even shrunk to 9 px. What matters there is WHERE traffic is dense: Atlantic corridors, empty oceans. Same idea the FIRMS layer already uses (aggregated cells when zoomed out, individual detections when close). Cells carry the CENTROID of their contacts, not the square centre — at a 6° grid the centre would drag the blob hundreds of km off the actual traffic and break corridors into a regular chessboard. Marker size and alpha scale LOGARITHMICALLY (a 400-aircraft cell is not 100× more important than a 4-aircraft one, and linear scaling would turn Frankfurt into a blob across half of Europe). Density composes into the SAME `beyondHorizon` gate that owns `bb.show`, so the fleet can never be lit at the same time as the cells; the rebuild is throttled to 2 s because recomputing 12 000 contacts every tick is wasted work at a range where one aircraft is a fraction of a pixel. Hidden categories are excluded from the aggregate, so the category filter keeps working. Cells live in their own `PointPrimitiveCollection`, not in the fleet. **Cells are horizon-culled every tick** (`cullDensityCells`, 2026-09-04 fix): they render depth-test-free like every contact sprite, so without the cull the far side of the globe showed through as an arc of rings glued to the limb (live finding: 163 of 284 cells were North American traffic seen from over Europe). The cull uses the SAME `horizonOccluder` as the fleet pass and runs outside the 2 s rebuild throttle, because a rotating camera would otherwise leave far-side cells lit until the next rebuild. **Limb taper** (same commit, second finding): cells just BEFORE the horizon pass the occluder but the projection squashes them into a band of rings glued to the globe's edge (from 7 900 km over Finland the horizon is ~63.5° and the US East Coast sits at ~60.6° — visible, yet an arc on the limb). `cullDensityCells` therefore also takes the camera's cartographic position and fades each cell by its central angle from nadir (`limbFactor`: full up to 72 % of the horizon angle, gone at 92 %, i.e. before the horizon), writing alpha and size through a layer-supplied `paint` callback only when the factor changes; the cell's base colour/alpha/size and lat/lon live in `point.id` so the taper is stateless across rebuilds. The pure helpers (`horizonAngleRad`, `centralAngleRad`, `limbFactor`) are spherical, which is plenty at a 8 % margin before the horizon. **Cells are soft glows, not discs** (`src/data/densityGlow.js`, same day, user feedback "bubliny"): hard `PointPrimitive` discs of 4–20 px read as bubbles/beads on the map, while density is a field and should read as heat. Both layers now use a `BillboardCollection` with ONE shared white radial-gradient sprite (transparent edge, 64 px texture) tinted multiplicatively through `billboard.color`, at `2.4×` the marker core diameter so the soft edge keeps the cell's visual weight. Civil flight cells are the muted violet of the flight trails (`#a78bde`) — white vanished on light basemaps and read as bubbles on dark ones; military-carrying cells stay amber; vessel cells stay muted cyan. Without a DOM the sprite helper returns `''` and the layers simply omit `image`, so Node tests exercise the real collections. **Flight density is OFF by user decision (2026-09-05, `FLIGHT_DENSITY_ENABLED = false`):** at globe range the operator wants to see individual aircraft as small icons, FR24-style, even at 12 000 contacts. The aggregation stays wired (the vessel layer keeps using it) behind that one switch. **Contact icon palette follows basemap contrast** (`src/data/contactPalette.js`, 2026-09-05): the white silhouette with a hairline dark stroke is perfect on dark/satellite basemaps and invisible on light OSM (at ~8 px on screen the stroke is 1 px and merges with the map). The OSM descriptor carries `contactContrast: 'light'`; `main.js` binds the palette to the existing `gev:map-stack-changed` event (seeding from `getActiveStack()` because the first `setStack` is silent); both aircraft layers ask `contactIconTint('civil'|'military')` inside their single `bb.image` writer and re-raster the whole fleet on a palette change (`onContactPaletteChange`, unsubscribed in `destroy`). On light basemaps civil icons bake an ink-blue fill (`TINT_FILLS.ink`) and military an ember fill that the amber `billboard.color` multiplies into burnt orange. The fill is baked into the SVG through `aircraftIcon(..., tint)` and NEVER applied via `billboard.color`: that tint is multiplicative and a blue tint would turn the red wing strobe into a black dot (the tracked-aircraft cyan lesson). The fleet's 3D models ("Models: nearby" regime below 800 km) follow the same palette through `_modelColor` (ink on light basemaps, white otherwise; military stays amber) and are recoloured explicitly on a palette change, because the per-tick model treatment only writes colour when alpha moves. `MODEL_MIN_PX` went 24 → 32 in the same fix: at 129 km a white GLB clamped to 24 px read as a ~6 px grey speck inside its detection bracket. In the same pass the far tiers grew: `TIER_ICON_PX` full 20 / medium 16 / micro 12 (was 20/14/9) in both aircraft layers — the micro tier rides the cockpit `scaleByDistance` (0.65 at 8 000 km), so a 12 px icon lands at ~8 px on screen at globe range, "a bit bigger" than the ~6 px specks the operator was looking at.
- **Vessel icon tiers + density** (`aisLiveVessels.js`, 2026-09-04): the AIS layer previously had NO zoom-dependent sizing — at globe range it drew ~27 000 full-size 32 px chevrons, a wall along every coastline that hid both the basemap and the flight density cells. It now shares the flight layer's altitude thresholds (`airIconTier`) with a per-tier scale multiplier (`VESSEL_TIER_SCALE` full 1 / medium 0.7 / micro 0.45 → ~19–25 / 13–17 / 9–11 px after the speed scale), and above the shared density threshold it aggregates vessels into its own `PointPrimitiveCollection` (muted cyan, to tell it apart from the white flight cells) via the same pure `trafficDensity.js` helpers. The tier is baked into `shipScale`, so selection, in-place refresh and deselect stay a single scale writer. Density composes into the SAME visibility gate as the horizon cull inside `updateVisibility` (only the selected vessel stays visible, like the tracked aircraft), the pre-render listener runs tier → density → visibility in that order, and the cells are horizon-culled every frame.
- **Vessel hull silhouette + 3D models** (`aisLiveVessels.js`, 2026-09-05, user "nech to vypadá ako loď nie ako gumený čln"): the 2D icon was a chevron/delta-wing (same family as aircraft, just rotated) and read as an arrow, not a boat. It is now a **top-down hull silhouette** — sharp bow (north at rotation 0, so the projected-rotation pass still maps it to course exactly as the chevron did), straight parallel sides, blunt transom stern, a faint cargo-deck outline and a darker aft **deckhouse** block. The first cut (2.4:1, rounded) still read as a dinghy; the shipped hull is ~3.4:1 and slender. Below `SHIP_MODEL_ALT_CEIL_M` (15 km) the nearest `SHIP_MODEL_MAX` (40) vessels also **render as real glTF hulls** (`public/models/ship.glb`, "Low Poly Cargo Ship", CC BY 4.0) — a lean mirror of the aircraft "Models: nearby" regime with none of its class/IR/ground-snap machinery: ships sit on the water, so placement is a single `headingPitchRollToFixedFrame(course + SHIP_MODEL_HEADING_OFFSET_DEG)` at a fixed `SHIP_MODEL_LIFT_M` above the ellipsoid (the model's bow points +X → the offset is −90°, measured live in the browser; `ship.glb` is NOT meter-baked like the aircraft, so `SHIP_MODEL_SCALE = 0.03` shrinks its ~4200 own units to ~125 m and `SHIP_MODEL_MIN_PX = 40` floors distant hulls). The handoff is atomic through a **`shipModelOwners` set**, mirroring the aircraft billboard→model rule: `refreshVesselModels` runs AFTER `updateVisibility` in the same pre-render tick, and a model only takes the visual once it is `ready` — until then the 2D icon stays. `updateVisibility` reads the owner set (`record.billboard.show = visible && !shipModelOwnsVisual(record)`), so the icon can never light up under a model; labels still key off `visible`, so a modelled vessel keeps its card. Candidates are "already-modelled (keep) + currently-visible icons (add)", nearest-first, capped — bounded to the on-screen set without recomputing horizon for 36 k records. Leaving the regime (zoom out past the ceiling, or `state.shipModels3d = false`) releases every model and forces one `updateVisibility(true)` so icons return with no 800 ms gap. Models live in their own `PrimitiveCollection` (`state.modelCollection`), created in `ensureCollections`, shown via `setVisible`, and destroyed with the layer in `disable`. One model for every class is fine for v1 — a river cruiser rendering as a cargo hull still reads unmistakably as a ship. (Dev aid added the same day: `window.Cesium` is exposed in `import.meta.env.DEV` in `main.js` — namespace only, alongside `window.__godsEyeView` — which is how the model's bow axis and scale were measured live.)
- **Vessel density at globe range is OFF** (`VESSEL_DENSITY_ENABLED = false`, 2026-09-05, same user decision as `FLIGHT_DENSITY_ENABLED`): at 12 000 km the aggregate reduced 30 000 vessels to 147 glow cells, 48 visible, median alpha 0.29 — "a few dots for a hemisphere". Ships stay individual micro-tier hulls at globe range (3 908 shown per hemisphere instead of 48 glows). The aggregation stays wired behind a runtime copy of the switch (`_vesselDensityEnabled`) that tests flip on, so it remains covered.
- **Historical ship density** (`src/data/shipDensity.js`, `local-ship-density`, token `n`, 2026-09-05): the answer to "the world is deaf". Live AIS is terrestrial — 70 % of contacts sit in Europe, 20 % in North America, the Persian Gulf + India carried **7** vessels, open ocean nothing — so this layer drapes **where ships actually go**: the World Bank / IMF *Global Shipping Traffic Density* raster (count of AIS positions per 0.005° cell, Jan 2015 – Feb 2021, **CC BY 4.0** — read from the catalog AND the Zenodo record, not from memory). It is **historical and modelled, never live**: the panel row reads `World Bank / IMF · AIS 2015-01 – 2021-02 · CC BY 4.0 · HISTORICKÉ, nie živé`, the credit says "modelled, not live", and `lastUpdate` is the snapshot's build date so the age readout says years (rule 2). **Build** (`scripts/build-ship-density.mjs`): the source is a 9.8 GB *uncompressed, tiled* int32 BigTIFF (72006×33998, 128×128 tiles, nodata 2147483647, ±85° only) fetched from the stable Zenodo archive 16894236 (534.9 MB zip, MD5 pinned) — so it is read with plain `fs`, **no `geotiff` dependency**; `sharp` only encodes the 8-bit PNG (it silently collapses single-channel 32-bit input to 8-bit RGB, so it must never READ the raster). Beware the two tile arrays use different element sizes (`TileOffsets` LONG8, `TileByteCounts` LONG). 50×50 px blocks are **summed** (true totals — a 1-px ocean lane survives; an average would erase it) into a 0.25° 1440×680 grid in ~65–95 s, then **log-normalised between a floor and a ceiling**: floor = 60th percentile of non-zero cells (126 M positions — ordinary background sea → transparent), ceiling = 99.5th (39 G — ports clamp so they cannot dim lanes), alpha = intensity^1.4. The floor exists because of a live finding: normalising from zero painted every ocean a flat opaque cyan (61 % of all cells hold ≥1 position after six years of satellite AIS). Output: 455 KB RGBA PNG + a sidecar JSON (bounds, grid, stats) + a regenerated `SOURCE.md` (with the source data's known artefacts: a zero block over the Sahara, land speckle from river traffic/noise). **Render**: one textured primitive — `RectangleGeometry` + `EllipsoidSurfaceAppearance` with an `Image` material at 30 m, translucent — exactly the SHMÚ radar pattern, **and `flat: true`** (2026-09-07, user "the historical air density got messed up": `EllipsoidSurfaceAppearance` applies Phong sun lighting by default, so once the scene clock ran in real time the drape went black on the night side — visible over the US by day, gone over Europe at night; the radar drape got the same fix, pinned by a tripwire in `shipDensity.test.mjs`) — **and hidden on the photoreal stack** (2026-09-07, user "historical flights on Google are crap": with `globe.show = false` the 30 m drape sits below the Google mesh and shows as torn fragments — `densityDrape.js` now follows `activeMapStack` like the GIBS overlays: `show` is false under photoreal, `getStats().error` reads `density.globe-only`, and the drape returns on any globe stack) — deliberately **not** `viewer.imageryLayers` (with Google 3D the globe may be hidden). Bounds are clamped to ±180/±90 (the source's pixel-edge origin sits 0.015° west of −180°, which Cesium's Rectangle rejects). The sidecar is fetched with `cache: 'no-cache'` (revalidate): `force-cache` served the previous build's stats after a re-bake. **Layer alpha follows basemap contrast** (same `contactPalette.js` signal as the aircraft icons, user "nedá sa trochu znížiť?" on Stadia dark): `SHIP_DENSITY_ALPHA_LIGHT` 0.85 on OSM where cyan needs full strength, `SHIP_DENSITY_ALPHA_DARK` 0.45 on dark/satellite stacks where it glowed twice as loud; `syncAlpha` — the single alpha writer — rewrites the Image material's `uniforms.color` live on `onContactPaletteChange` (subscribed when the primitive exists, unsubscribed in `destroy`). **Zoom-fade** (user "pri zazoomovaní to bola hmlovina"): the data is 0.25° (~28 km cells) and cannot be sharper — magnified it reads as blurry blobs — so `syncAlpha` also multiplies by `shipDensityZoomFactor(cameraHeight)`: 1 above 4 000 km, 0 below 1 200 km, linear between, driven by a `scene.preRender` tick that writes only on change and hides the primitive at 0 (no transparent full-screen draw). Up close the live vessels speak. Verified live: 12 000 km → 0.45 (dark), 2 500 km → 0.21, 800 km → hidden. Registry test pins alphabetical order — `local-ship-density` sorts BEFORE `local-shipping-lanes`.
- **Day/night terminator** (`src/globeLighting.js`, DISPLAY-rail `#daynight-toggle`, 2026-09-05, user "ako má Flightradar"): real sun lighting on the globe. Cesium does this natively (`globe.enableLighting`; the app already runs a real-time clock and computes the sun for `celestialRing`), so the whole feature is one flag plus **distance tuning**, which is the part that matters: `lightingFadeOutDistance` 1 500 km / `lightingFadeInDistance` 4 000 km **above the surface** — fully lit at globe range (12–13 000 km) where the terminator is the point, OFF below 1 500 km so a city at night is not an unreadable black. ⚠️ Cesium measures both distances **from the Earth's centre** in 3D (GlobeFS `cameraDist = length(czm_view[3])`; it subtracts the radius only in 2D/Columbus), so the altitudes are written to the globe as `GLOBE_RADIUS_M + altitude` via `lightingFadeDistancesFromCentre()` — the bare values were below the radius and lighting never faded (the "dark map at 700 km" of 2026-09-04; measured and fixed 2026-09-06). `lightingFadeFactor(height)` is the same ramp as the shader, for layers that must follow it. ⚠️ **The scene clock must run** (2026-09-06, user "nefunguje deň/noc"): a Cesium Viewer starts with `clock.shouldAnimate = false`, so `clock.currentTime` — and the sun, hence the terminator — froze at page-load time (measured 59 min = 15° of drift after an hour). `installDayNightClock(viewer)` (main.js, right after `targetFrameRate`) sets `ClockStep.SYSTEM_CLOCK` + `shouldAnimate` (currentTime = system time on every tick; no layer depends on an animated clock — they only pass `clock.currentTime` to `getValue` of constant properties) and asks the render governor for one frame per minute while lighting is on, because in idle mode nothing else would repaint the creeping terminator. `dynamicAtmosphereLighting(FromSun)` makes the limb darken on the night side. `applyGlobeLighting(scene, on)` is the single writer (DOM-less safe, sets only properties the scene has, writes the fade distances on OFF too so re-enable never inherits foreign values). **Default ON**, session-only (no share-link key, like the scope feather), markup-carries-the-default like `#models3d-toggle`, `aria-pressed` mirrored. **Globe stacks** get Cesium's lighting (OSM, Bing, Stadia, NASA); **Google 3D photoreal** bakes its shading into unlit tiles and hides the globe, so since 2026-09-06 the SAME toggle drives a `Cesium3DTileset.customShader` instead (`src/photorealNight.js`, applied from `MapStackController._syncNightLightsLayer` whenever the target stack is photoreal): the fragment shader derives the surface normal from `positionWC`, darkens by the globe's own curve (`lambert*5 + 0.12` floor, with a strong cool moonlight tint) against `czm_sunDirectionWC`, and ADDS warm city lights on the night side by sampling one equirectangular Black Marble image (GIBS WMS 4096×2048, keyless, CORS) by the fragment's lon/lat, with the same ambient-land cutoff as the imagery layer. Light gain depends on camera distance (0.4 within 3 km → 1.1 beyond 300 km): the 3 km/px texture is a true light map from altitude but only a soft glow at street level — measured 2026-09-06 over the castle: floor 0.35 + gain 0.9 gave 0.62 of daytime luminance ("overcast day"), floor 0.28 gave 0.53 (user: "slabé"), the shipped floor 0.12 gives **0.33** — a real night, streets readable by the city glow. No altitude fade on photoreal — the city going dark is the point (floor keeps streets readable). Verification trap: `scene.render()` in requestRenderMode does NOT redraw unless `scene.requestRender()` was called first — readPixels after a bare render() reads the stale frame. Shader instance is cached on the tileset (`gevNightShader`) and merely detached when off; a foreign customShader is never overwritten.
- **Night lights on the night side** (`src/nightLights.js`, owned by `MapStackController`, 2026-09-06, user "urob 1" after "NASA má veľmi pekné mapy"): a second imagery layer — NASA GIBS **Black Marble** (VIIRS Suomi NPP, static 2016 composite, WMTS REST `z/y/x`, time literal `default`, Level 8) — blended along the terminator by Cesium's `ImageryLayer.dayAlpha = 0` / `nightAlpha = 1`. Bound to the SAME Day/night toggle, not a chip of its own: the shader mixes day/night alpha only under `ENABLE_DAYNIGHT_SHADING`, i.e. with `globe.enableLighting` **and a terrain without vertex normals** — World Terrain is therefore requested with `requestVertexNormals: false` (with normals Cesium defines `ENABLE_VERTEX_LIGHTING` instead and the lights silently covered the day side; hillshade is invisible anyway since lighting is off below 1 500 km). The tile is opaque RGB with a faint ambient land/ocean rendering (max component ≤ 63 on 90 % of pixels), so `colorToAlpha` black with threshold **0.39 (sRGB — GlobeFS compares raw texture values, no linearisation)** keeps only the lights — 0.25 was the first value, tuned on a European tile; on 2026-09-07 the user asked about "purple blotches" over the Sahara and Arabia: measured z=5 tiles put 94 % of Saharan pixels (73 % India, 12 % Europe, 0 % Atlantic) in the 40–69/255 band — the composite's desert/land sheen, not lights (lights start ≈ 100/255) — and the hard GlobeFS cut at 64 split that band into blotches; 0.39 ≈ 100/255 removes the whole band at the cost of the faintest rural lights (70–99). The photoreal night shader's `PHOTOREAL_NIGHT_LIGHTS_CUTOFF` moved with it (smoothstep 0.34→0.50) — and `brightness` **3** lets them survive Cesium's hard-coded 0.3 night dimming (measured: without it Seoul had the same luminance as the sea on OSM). Layer `alpha` follows `lightingFadeFactor(cameraHeight)` on `preRender` so the lights vanish together with the lighting below 1 500 km. `brightness` follows the basemap contrast (`contactPalette.basemapContrastForStack`: light 3.0, dark 1.8 — re-applied on every re-seat), because the night side of Stadia Dark / Blue Marble is a class darker than OSM and 3× blew cities into white sheets. Controller re-seats the layer on top after every stack switch and drops it on photoreal (globe hidden). Credit on the imagery credit line; terms in DATA_SOURCES.md. Tests: `nightLights.test.mjs`, `mapStackController.test.mjs`, `globeLighting.test.mjs`.
- **Cockpit entry is discoverable and touch-sized** (2026-09-06, user "mal som funkciu cockpit, neviem ju nájsť" + "viac mobile friendly"): the COCKPIT button used to live inside the Contacts tab panel (`#context-flights-view`, `hidden` unless that tab was open) and showed only when `cockpitEntryAllowed` (Contacts context + both aircraft feeds) already held — three invisible preconditions. Now `#cockpit-entry` sits at body level (index.html, before `#view-switcher`), `CockpitViewController.syncEntry` shows it for ANY tracked aircraft and marks `data-needs-context` when Contacts is not on yet; the click and the `C` key go through `requestEntry()`, which first awaits `onPrepareEntry` (ui.js → `setContextMode('flights')`, enabling both feeds) and only then `enter()` — the policy still gates the actual entry. Layout: the fixed `left: 50% + 270px` position was off-screen below ~1 100 px, so ≤ 1180 px it becomes a bottom-right floating button; `(pointer: coarse)` gives it and the cockpit exit/reset 44 px targets (the exit rule must sit AFTER the 28 px `body.cockpit-mode #view-switcher button` rule — same specificity, order decides). Verified at 660 px and in the 375×812 mobile emulation: track → KOKPIT visible → tap → Contacts on → cockpit HUD; exit/reset 44 px.
- **Right-click context menus + black (Linux-style) cursor** (`src/contextMenu.js`, 2026-09-06, user "čierny kurzor ako na Linuxe a všade, kde sa dá, pravé tlačidlo"): one `role="menu"` element (keyboard: arrows/Home/End/Enter/Escape; closes on outside pointerdown, wheel; clamped into the viewport by `placeMenu`; 44 px items on coarse pointers) opened from three places wired in `StyleManager._initContextMenus`: the Cesium canvas (pick with 6 px tolerance → `pickRegistry.ownerOfPick` names the owning layer → contact menu: track/stop tracking, cockpit via `requestEntry`, copy ICAO/NORAD; vessels: inspect (`selectById`), copy MMSI; empty ground via `pickPosition`/`pickEllipsoid`: fly here, copy coordinates, bookmark view, full globe) and the layer rows in `#data-toggles` (turn on/off, only this one, all off). Right-DRAG stays Cesium zoom — `installDragGuard` suppresses the menu after a right-button move over 6 px (browsers fire `contextmenu` on release); the menu is inert in cockpit mode. Items are pure builders (tested without DOM), actions live in ui.js. Cursor: `:root` carries `--cursor-arrow/-pointer/-grab/-grabbing` as SVG data-URI cursors (black with a white outline, hotspots set) and every `cursor: pointer/default/grab/grabbing` rule in style.css now references them; `html, body` gets the arrow so the Cesium canvas inherits it; wait/not-allowed/text stay system cursors.
- **Sun and Moon as bodies, sharp stars** (2026-09-07, user screenshot of the celestial ring: "make the sun and moon look like the moon should, and stars sharp not blurred"): the ring markers are no longer Material Symbols glyphs but small `<canvas>` bodies (`src/celestialBodies.js`): the Sun a glowing disc with a corona, the Moon a disc with its REAL phase — illuminated fraction `(1 − cos elongation)/2` from the same geocentric Simon-1994 sun/moon vectors the ring already uses, bright limb pointing along the ring toward the Sun, crescent/gibbous drawn with the half-disc ± terminator-ellipse technique; redrawn only when `markerRenderKey(fraction, limb, dpr)` changes (`getDebugState().moonPhaseFraction` for QA). Stars: `src/starfield.js` replaces Cesium's default 1024 px Tycho JPEG skybox (soft blobs at 60° FOV) with a generated cube map — 6 × 2048 px faces, ~9 000 deterministic stars (uniform on the sphere, brightness `u³` so many faint/few bright, 1–3 px crisp points, faint halo only on the brightest ~2 %, slight spectral tints), projected with the standard major-axis cube mapping so face seams are continuous; installed after the first frame via data-URL sources, `?stars=cesium` restores the original. Not a star catalogue — constellations are not real. Same-day follow-up ("too faint"): marker 22 → 36 px, sun/moon discs fill most of it (`SUN_RADIUS_RATIO`/`MOON_RADIUS_RATIO`), brighter palette + double CSS glow; stars `u²` brightness, ≥ 2 px points (a 1 px point loses half its light when the 2048 px face is minified at 60° FOV), 11 000 stars, halo on the top ~16 %. Then the user asked for the ORIGINAL stars back (Cesium's Tycho sky has the Milky Way and reads fuller) — the sharp starfield is now opt-in via `?stars=sharp`, default is Cesium's skybox; the sun/moon bodies stay.
- **Aircraft strobe phase per plane** (2026-09-07, user: "planes always blink the same and when dense the whole thing blinks"): the anti-collision strobe used one wall-clock phase for the whole fleet, so a dense cluster (US east coast, Europe) flashed as a block. `strobePhaseOffsetMs(icao24)` (FNV-1a hash, 0..1200 ms) + `strobeOnFor(icao24, nowMs, offset)` in `aircraftIcons.js`; both fleet modules cache the offset on the billboard (`bb._gevStrobeOffset`) and evaluate `contactStrobe` per contact for micro silhouettes and (distance-gated) normal silhouettes. Textures stay shared (lit/unlit per kind) — only the switch time differs. The tracked aircraft keeps the shared `strobeOn(nowMs)` phase.
- **Tracked flight card: mini profile + emergency frame** (2026-09-07, user picked proposals 2 and 5): `src/data/flightProfile.js` keeps a sparse per-aircraft ring (one sample per minute, 31 slots, Float64Array — ~10 MB worst case for the whole fleet, no per-sample objects) written from the poll loop next to the 5-fix dead-reckoning history; `profileRowFromSamples` turns the last 30 min into two unit-range curves (altitude in the accent colour, speed faint; a flat cruise is drawn mid-box, not "from zero") plus `FL120 → FL340` / `250 → 480 kts · last 28 min` labels, null until ≥ 3 samples spanning ≥ 2 min. The card model (`buildTrackedCardModel`) now returns `profile` and `alert` as their own fields (the alert used to be the last footer row); `normalizeOverlayEntry` validates both, `measureOverlayEntry` reserves two lines for the chart and one for the alert, `paintTracked` draws the 96×26 chart with an end dot and — for 7500/7600/7700 — a red frame, red top rule and a warning-triangle line (`TRACKED_ALERT_COLOR`). The hover card mirrors the alert (`.contact-hover-card--alert` red ring + line).
- **Cockpit: destination METAR + approach estimate** (2026-09-07, proposals 9 and 7): `src/cockpitApproach.js` (pure) + `src/data/airportLookup.js` (lazy ICAO/IATA index over the bundled OurAirports files, loaded once per session). `CockpitViewController.updateDestinationServices` runs from `updateRoute`: the adsbdb destination code (IATA; the proxy now also returns `icao`) resolves to the airport record (position, elevation, runways), the destination METAR comes through the existing `/api/metar` cache (`requestAirportMetar`, TTL 5 min, one station per tracked flight) and renders as `LZIB · VFR · Cloudy · 18 °C · wind 12 kt from SW · 25 min ago` under the flight-plan endpoints. Within 50 km of the destination and descending (≤ −0.5 m/s) or below 4 000 m above the field, an amber APPROACH · ESTIMATE block shows the wind-estimated active runway (`runwayWind.js`, honestly "no METAR wind yet" / "runway data unavailable"), distance + minutes to the airport, and height above the field with the straight-line slope angle (`atan(AGL / distance)` — a geometric estimate, not an ILS). `getTrackedInfo` now carries `verticalRateMps`. DOM writes only on text change.
- **ACARS / CPDLC datalink messages for the tracked aircraft — LOCAL-ONLY** (2026-09-08, user: "implement 1 and 3, but only locally" after the airframes.io study in `docs/drafts/airframes-io.md`): `src/data/acarsMessages.js` (pure: label table ARINC 620/622 — AA/BA CPDLC, A6/B6 ADS-C, A9/B9 ATIS/clearances = kind `atc`, QA–QF OOOI, 5Z airline ops, H1 data, Q0/SQ/SA/_d noise dropped; `compactAirframesMessage` strips everything about the feeder except the station ident; client cache per hex with TTL 60 s / 30 s on failure, `requestAcarsMessages` calls `onDone` only after a real fetch so the card cannot loop; `{enabled:false}` from the proxy disables the source for the session) + `airframesProxy()` in `vite.config.js` (`/api/acars/messages?icao=<hex>`, `/api/acars/status`). **Two deliberate gates:** `.env` `ACARS_MESSAGES=on` (default off) and `isLoopbackAddress(req.socket.remoteAddress)` — any non-loopback client gets 403 `local-only`. Upstream is the public `GET /v1/messages?icao=&limit=40&exclude_labels=…` (no key; 60 req/min per IP): proxy cache 60 s per hex, single in-flight request, hard cap 30 upstream calls/min, 429 `Retry-After` honoured, stale-if-error, 8 s timeout, 1.5 MB cap; intermittent upstream 404 "Cannot GET" (seen live on an identical query) is a transient failure, not "no messages". UI: the tracked card footer gets `ACARS 7 · 03:40 CPDLC ↑ ACFT→ATC · REQUEST CLIMB FL370` (first footer line, before the source line; nothing when there are no messages), and the cockpit gets a `#cockpit-acars` section under the flight-plan card (status `{n} msg · 24 h` / `ACARS…` / `no datalink messages in 24 h` / `ACARS UNAVAILABLE`, up to 6 rows `03:40Z · BA · CPDLC ↑ ACFT→ATC · text`, ATC rows amber like the approach block, prescribed credit "Data provided by Airframes.io and its community of feeders." linked). `updateRoute` → `updateAcars(info)` each HUD tick (module dedupes), DOM written only on signature change, hidden on cockpit exit. Terms recorded verbatim in DATA_SOURCES.md ("Personal and non-commercial use", "Bulk redistribution … requires prior arrangement", "still being finalized") — the local-only gate exists because of them. Voice of the tower is still out of reach (data networks carry text only). Military layer not wired (adsb.lol contacts rarely carry ACARS).
- **Cockpit: destination tower — ONLINE STREAMS ONLY** (2026-09-08, user rejected an own receiver: "B nie", then "len online streami"): `src/cockpitTower.js` (pure) + `CockpitViewController.updateTower/renderTower` in `ui.js`, section `#cockpit-tower` above the ACARS block. Sources are exactly the two the airport card already has: the user's own stream from git-ignored `local_data/airports/atc-streams.local.json` (`ownStreamFor`, persistent `<audio controls preload="none">`, src rewritten only when the URL changes) and a YouTube live airport stream with ATC audio through the **official** `youtube-nocookie.com` embed (`airportCameraFor` curated catalogue — LKPR SlowTV, KLAX AirlineVideosLive+ — else one `/api/youtube-live` search per destination, which without `YOUTUBE_API_KEY` is a 503 and a 30-min negative cache). Status line `LKPR · YouTube · SlowTV` / `own stream + …` / `looking for a live stream…` / `no online stream for LZIB` with a note that says why (LiveATC and Broadcastify forbid third-party use). Called from `updateDestinationServices` (destination ICAO from the adsbdb route), DOM only on signature change, iframe blanked and audio paused on cockpit exit or destination change. **Research recorded in DATA_SOURCES.md (2026-09-08):** Radio Browser has no ATC streams at all (its "atc" tag matches Mexican Grupo ACIR stations, "tower" matches unrelated radios); RadioReference/Broadcastify Terms §8 allow only "private, personal, non-commercial viewing purposes" and no embed path — out, like LiveATC. So the honest state: tower audio in OKO comes only from YouTube live embeds and the user's own URLs; the YouTube auto-search needs the user's `YOUTUBE_API_KEY` in `.env` (not present as of 2026-09-08).
- **Dev server watchdog outside Claude** (2026-09-08, user: "when I come home the server is always down"): the server started from the Claude desktop Browser pane lives only for the agent session and is stopped when the session ends. `scripts/oko-server.ps1` runs `npm run dev -- --host localhost --port 4173 --strictPort` in a loop (restart 5 s after exit, 60 s pause after three crashes within 15 s, exits if the port is already taken, log `.gev-cache/logs/oko-server.log`, prefers fnm Node 24 when present); `scripts/install-oko-server-task.ps1` registers it as a per-user Task Scheduler task "OKO dev server" at logon (hidden, restart every minute, `-Uninstall` to remove). `.claude/launch.json` gained `oko-attach` (URL only) so the Browser pane attaches to the running server instead of fighting for the port. Registration is a persistent system change, so it is left to the user to run.
- **World meteorology — PROTOTYPE "like Windy, OKO style"** (2026-09-08, user: "GPU particles, OKO style but Windy-like rendering, prototype first, use the most suitable map"; plan in `docs/drafts/meteorologia-svet-plan.md`). Layer `meteo-gfs` (token `6`, `src/data/meteoLayer.js`, name "Meteorológia · vietor a teplota (GFS)"). **Data:** NOAA/NCEP GFS 0.25° (US public domain) through the NSF Unidata THREDDS NetCDF Subset Service — NOMADS OpenDAP was retired in 2025 (SCN 25-81) and only the GRIB2 filter remains, so THREDDS' `Best` dataset is read as NetCDF-3 by the new dependency-free reader `src/data/netcdf3.js` (classic + 64-bit offset, scale/offset/fill; ~8 MB per global wind step, ~3 s). `meteoProxy()` in `vite.config.js`: `/api/meteo/catalog` (17 steps of 3 h to +48 h, model run from the file's `reftime`), `/api/meteo/slice?var=wind|temp&time=` → PNG 1440×721 encoded with `sharp` (wind: R=u, G=v over ±60 m/s, B=speed 0–60; temp: R over −60…+60 °C; columns shifted so column 0 = −180°, north up), disk cache `.gev-cache/meteo/<var>/<iso>.png` + json (`METEO_CACHE_DIR`), TTL 3 h, one in-flight per (var, time), 60 upstream requests/hour cap, stale-if-error, 40 MB cap. **Rendering:** a full-globe flat `Primitive` with a custom Material fabric (`OkoMeteoField`: texture channel → decode → 1D ramp lookup; ramps in `meteoField.js` are OKO's own — night navy → azure #39d0ff → amber → red, wind 0–45 m/s, temp −40…+45 °C) and **GPU wind particles** in `src/windParticles.js`: its own WebGL2 context on a transparent canvas inside `#cesiumContainer` (z4), 65 536 particles whose lon/lat live in an RGBA8 state texture (16-bit each, the mapbox webgl-wind scheme rewritten for a globe), an update pass advecting by u/v with metres-per-degree at the particle's latitude and random respawn uniform over the sphere, a draw pass computing WGS84 ECEF in the vertex shader, projecting with the live Cesium view-projection matrix and discarding the far hemisphere (dot of the ellipsoid normal and the camera direction), and screen-space trails that fade (0.955/frame; 0.6 while the camera moves). 2D "PLÁTNO" mode disables particles; no WebGL2 → the layer still shows the field. **UI:** row chips WIND / TEMPERATURE / PARTICLES (`setParams`), legend from the ramp, source line `NOAA/NCEP GFS 0,25° · beh 08.09. 12Z · NSF Unidata THREDDS · PREDPOVEĎ · model, nie pozorovanie`; bottom timeline `src/meteoTimeline.js` (◀ ▶ play, slider over steps, day ticks, step label with lead time, run label, status). Enabling on the photoreal stack asks the map-stack controller (new `gev:request-map-stack` event handled in `main.js`) for **GIBS Blue Marble** as the muted relief basemap and restores the previous stack on disable. Verified live: field + streaks over the globe, catalog run 12Z, first slice 1.6 MB. **Honest limits:** prototype only — no pressure/precip/clouds/waves yet, no isobars, no point meteogram, single model; particles ignore terrain occlusion; Unidata's terms page returned 404 — recorded as community server, prototype use, move to NOAA NODD S3 GRIB2 for production.
- **World meteorology — phase "fields": pressure with isobars, rain, clouds, gusts** (2026-09-08 evening, user: "continue with the next phase"). `METEO_FIELDS` in `meteoField.js` now carries six fields with a `convert` (unit scale/offset applied in the proxy: K → °C, Pa → hPa, kg m⁻² s⁻¹ × 3600 → mm/h), a quantisation range (`decode`), a ramp range, a per-field drape alpha and, for pressure, `isolines: { step: 4, emphasis: 1013 }`. Ramps gained an optional alpha per stop (rain and clouds are transparent where there is nothing — the fabric multiplies `c.a * alpha`). The proxy's `ncssUrl` omits `vertCoord` for surface variables and `rasterize` is generic for scalars (R = G = B = quantised value). **Isobars:** `src/data/meteoIsolines.js` — pure marching squares (16 cases, saddle decided by the cell mean, linear interpolation on edges) that joins segments into long lines by shared edge keys; the layer reads the pressure PNG back through a 1440×721 canvas (`imageToGrid`), downsamples 2× and draws every 4 hPa as a `PolylineCollection` at 4 000 m (white 0.42 alpha, 1013 hPa thicker and brighter); rebuilt on every step change and dropped when another field is chosen. Row chips: VIETOR · TEPLOTA · TLAK · ZRÁŽKY · OBLAČNOSŤ · NÁRAZY · ČASTICE. Verified live: isobars over Europe at the 21Z step, slices 0.2–0.7 MB each. Not yet: isoline labels, pressure-level winds, precipitation accumulation (only the instantaneous rate is used), timeline into the past.
- **World meteorology — "that's weak" tuning pass** (2026-09-08 late evening, user: "to je slabé"): the meteorology basemap is now **Stadia Alidade Smooth Dark** (`METEO_BASEMAP_ID = 'stadia-dark'`, dark vector map with labels — Windy's own recipe; Blue Marble competed with the colours), field alphas rose to 0.78–0.96, the wind/gust ramps start at deep blue instead of near-black so calm areas do not blacken the map, particles are 2 px, brighter (mixed 35 % towards white), with longer trails (fade 0.968) and a faster simulated step (800 s/frame), and **isobars carry hPa labels** (`LabelCollection`, mono font, every ~90 points of a long line or the midpoint of a short one, 1013 bold; `scaleByDistance`, depth test off). Verified live: the globe reads as Windy — dense cyan streamlines with a cyclone over the Mediterranean.
- **World meteorology — particles as soft continuous strokes** (2026-09-08 night, user: "you overdid the streamlines, I want them subtle and without raster — it looks dotted"): the dots came from drawing one point per frame while a particle jumped several pixels between frames. `windParticles.js` now draws each particle as a **line segment from its previous to its current position** (`gl.LINES`, two vertices per particle, the previous state texture bound as `u_particles_prev`; a segment is skipped when either end faces away from the camera or when it is longer than 300 km, i.e. the particle respawned or crossed the ±180° seam), the trail buffers are rendered at 0.55× the canvas with LINEAR filtering (soft when scaled up), the particle count dropped to 16 384, the simulated step to 320 s/frame, the stroke alpha to 0.6 with only 18 % whitening and the trail fade to 0.975. Tests pin `gl.LINES`, the two-end visibility rule and the buffer scale.
- **World meteorology — the three Windy techniques** (2026-09-08 night, user asked "how does Windy render it?" then "sprav"): (1) **city labels above the field** — not a tile layer (CARTO's label tiles are watermarked without a key and Stadia has no white labels-only style) but our own `LabelCollection` from a new public-domain bundle `local_data/natural_earth/places.json` (3 116 Natural Earth populated places ≥ 100 000 or capitals, `scripts/build-meteo-places.mjs`, `src/data/meteoPlaces.js`): each label reads "city  value" with the value bilinearly sampled from the current field grid ("Bratislava 25°", "1013", "4 mm", "87 %", "8 m/s"), visibility tiered by population (`placeVisibleUntilM`: 8 M+ always, 3 M+/capitals to 9 000 km, 1 M+ to 3 500 km, 300 k+ to 1 500 km, rest to 600 km), depth test off, texts updated in place on step/field change; (2) **time interpolation** — the field material now mixes two slices (`imageNext`, `mixT`) and the particle shaders mix two wind textures (`u_wind_next`, `u_mix`); play is a requestAnimationFrame loop advancing a fraction over `METEO_PLAY_STEP_MS` = 2.4 s per 3-h step, the step index flips at 1.0 with a `_stepPending` guard (the first version advanced every frame while the next slice was loading), particles are not cleared during playback so the wind changes continuously, and the next step's images are already prefetched; (3) **particle age** — instead of purely random respawn every particle has a fixed phase (hash of its texel) and dies once per `WIND_PARTICLE_MAX_AGE_FRAMES` = 240 frames, so ages are spread evenly and the streamlines keep an even density (the nullschool/Windy scheme). Also new: **height fade** — the drape sits 2 km above the ellipsoid, so a camera below it saw a white screen; field, isobars and particles now fade out between 20 km and 5 km camera height (`syncHeightFade` on `scene.preRender`).
- **World meteorology — scope mask and PLÁTNO (2D)** (2026-09-08 night, user: "that's crap.. add the canvas option and the globe, but it must not be outside" — streamlines were drawn outside the PRIEZOR circle and not at all in 2D): the particle canvas moved from z4 to **z0** inside `#cesiumContainer` (above Cesium's WebGL canvas, below the scope mask at z1), so the mask now covers the streamlines like everything else in the scene. `windParticles.js` renders in **SCENE2D and Columbus view** too: `sceneModeCode(scene)` (pure, tested) yields 0 = 3D ECEF, 1 = flat geographic, 2 = flat Web Mercator (the app's PLÁTNO), −1 = morphing (canvas cleared); the vertex shader gets `u_mode` and projects flat positions as Cesium does — world = (0, lon·R, lat·R) or Mercator y = R·ln(tan(π/4 + φ/2)) — with the same view-projection matrix, no hemisphere occlusion, and the trail buffer is cleared on a mode change. Verified live: PLÁTNO shows the wind field, streamlines and city values on the flat map; the globe view keeps the scope vignette over the particles. **Trap:** the first version named a shader variable `flat` — a reserved GLSL interpolation qualifier — so the vertex shader failed to compile, `createWindParticles` threw, the layer caught it with a console *warning* and silently ran without particles ("prúdnice sú kde?"); renamed to `isFlat` and a tripwire forbids `bool flat`.
- **World meteorology — particle flow quality pass** (2026-09-08 night, user: "improve the particles: finer, smoother, elastic, real — work hard"): four changes in `windParticles.js`, all pure-tested. (1) **RK2 midpoint integration** — the update shader samples the wind at the half-step position and advances with that velocity, so a particle follows the curved streamline instead of its tangent (the "elastic" look; Euler produced kinked, jittery arcs in curved flow). (2) **Spawn only inside the visible extent** — `camera.computeViewRectangle` (3D and 2D) → `spawnRectFromView` (15 % margin so particles enter from outside, whole-sphere spawn when the view covers more than half the world or no rectangle exists, antimeridian-safe widths) → `u_spawn`; before this, 16 384 particles were spread over the whole sphere and a Europe view held a few dozen of them. (3) **Zoom-linked speed and density** — `simSecondsPerFrame(height)` = height × 1.2e-4 s clamped to 30…1 500 s (≈ 1 px/frame at 10 m/s in any zoom, so motion looks the same from space and from 200 km), `activeParticleCount` draws `total × √(areaFraction / 0.5)` (floor 12 %) so screen density stays constant, and a big view change triggers a 40-frame respawn boost (drop rate 0.08) that relocates the swarm into the new extent. (4) **Brightness by wind** — stroke alpha 0.22 + 0.55 × speed, calm air barely visible, jets and cyclones bright. The state exposes `active` and `spawn` for diagnostics. **Regression fixed 2026-09-09** (user: "nefungujú mi vetry, PC mi spadol"): in the flow-quality pass `simDt` referenced `dtFrame` one line before its `const` declaration — a temporal-dead-zone ReferenceError thrown every frame, so the loop died and the wind field showed no streamlines (the PC crash was unrelated GPU trouble that only made the user reload into the broken build). Reordered; a tripwire asserts `dtFrame` is declared before use. City points were also made subtler (3–4 px, lower opacity, thinner outline) and rarer (1 M+ only from ~1 300 km) after "tie bodky to je čo". **Trap found on the user's screen right after this:** with spawning confined to the view, a respawned particle often lands within 300 km of its old position, so the fixed `WIND_MAX_SEGMENT_M` cutoff let a "teleport" segment through — long straight lines across the whole screen. The cutoff is now `maxSegmentMetres(simDt)` = 60 m/s × step × 3 (floor 2 km, cap 300 km), i.e. tied to the largest honest step at the current zoom. Note for future verification: the Claude desktop Browser pane throttles requestAnimationFrame to ~2 fps (a plain rAF loop measures the same), so particle smoothness cannot be judged there — only in the user's browser.
- **World meteorology — cities as hover cards, not labels** (2026-09-09 night, user: "the cities must be done differently — hover cards like planes and earthquakes, and later we add data to the cards"; the label version also drew names beyond the limb because depth testing was off). `meteoPlaces.js` now builds a `PointPrimitiveCollection` (4–5 px azure dots, depth-tested so they vanish behind the globe, same population-tiered `distanceDisplayCondition`, id `place:<index>`) and a DOM hover card (`createPlaceHoverCard`, pattern of `earthquakeHoverCard.js`): the layer listens to `pointermove` on the Cesium canvas with an 80 ms delay, `scene.pick` → `resolvePickId` → `place:N`, and shows name, ISO country, population, coordinates and one row per field — temperature 2 m, wind 10 m with speed and meteorological direction (`windDirectionText`, north = 360°), gusts, MSL pressure, rain rate, cloud cover — sampled bilinearly from grids of the current step. Grids for fields that are not the displayed one are decoded lazily from the (already prefetched or fetched) slices and cached per step; the card shows "…" until they land and updates in place, and refreshes on step change. Card hides on pointer leave (220 ms grace unless hovered), pointer down, camera move start, Escape; listeners are attached on enable and removed on disable/destroy. Verified live over Bratislava. The card is the place for future data (Open-Meteo hourly, METAR of the nearest airport, sunrise/sunset). **Hover made forgiving 2026-09-09** (user: "neviem načo sú mi bodky miest keď sa žiadna akcia nekoná" — a pixel-perfect `scene.pick` on a 3 px dot almost never hit): the layer now projects every in-range, in-front-of-horizon city with `SceneTransforms.worldToWindowCoordinates` (front-face filtered by `EllipsoidalOccluder`) and shows the card for the nearest one within `PLACE_HOVER_RADIUS_PX` = 22 px of the cursor (`nearestWithinRadius`, pure/tested), so moving the mouse near any dot pops its card.
- **World meteorology on Google 3D Tiles** (2026-09-09, user: "google zle zobrazuje vrstvy" — the field drape at 2 km was pierced by the photoreal mesh: mountains, tile skirts and, from space, the coarse root tiles, leaving dark polygon holes). Two changes in `meteoLayer.js`: the drape sits at **10 km** (isobars 12 km, city points 13 km, height fade 30 → 12 km) and its appearance renders **without depth test** (`depthTest.enabled = false`, `depthMask = false`, alpha blending) with **back-face culling**, so the near hemisphere always paints over the terrain while the far hemisphere is culled instead of bleeding through. **Critical follow-up 2026-09-09** (user: "nefunguje ani hover na lietadlá… len keď je zapnuté vetry a tá vrstva"): with depth-test off the full-globe drape sat in front of everything in the pick pass too, so `scene.pick` (used by detection hover for planes AND by other layers) returned the drape (no id) instead of the object beneath — killing every hover while the layer was on. First attempt was `allowPicking: false` on the field primitive — **not enough** (user: "keď zapnem Meteorológia… nefungujú lietadlá, klikať, mouseover"): Cesium's `Scene.executeCommand` runs a command with no `pickId` through its ordinary colour shader during the pick pass, so the depth-test-free drape still painted the whole pick framebuffer and `scene.pick` returned `undefined` for everything (measured in the browser: 0/51 hits on plane billboards with the drape shown, 50/51 with it hidden). Real fix: `renderPassOnly(primitive)` in `meteoLayer.js` wraps the drape in a custom-primitive object whose `update(frameState)` returns early when `frameState.passes.pick`, `depth` or `pickVoxel` is set (show/destroy/isDestroyed delegate to the inner `Primitive`); `createFieldPrimitive` returns the wrapper. Verified live with the layer on: 48/48 programmatic picks, plane hover card, and click-to-track (RYR9TN locked, camera flew, cockpit button) all work. Verified on the photoreal stack from 12 800 km and 1 300 km: continuous field, no holes. Planes and city points still sort above the drape in the translucent pass.
- **Tracked card docked to the right edge; Cockpit exit restores Contacts** (2026-09-07, user screenshot: the card sat in the middle of the celestial ring over the aircraft — "make it hover or put it beside, it would not get in the way", and "a fragment stays when I leave the cockpit"): the world-overlay host gained a `dock: 'right' | 'left'` entry option (`normalizeOverlayEntry`) — `dockedPlacement()` in `worldOverlayDraw.js` writes ONE placement at the viewport edge (`DOCK_MARGIN_PX` 24), level with the anchor's screen Y, clamped out of the top 12 % band and the bottom `DOCK_BOTTOM_RESERVE_PX` (attribution / voice / cockpit entry); `paintTracked` draws no leader for the `'dock'` corner. `trackedReadout.js` sets `dock: 'right'` and `edgeFade: 'none'` (the keyhole fade would dim an edge card); the photo strip follows via the paint rect; UI-exclusion soft/hard semantics unchanged. The "fragment" was the Contacts context that the Cockpit entry itself enables (`onPrepareEntry` → `setContextMode('flights')`) and never released: `requestEntry` now remembers `_preparedContext` and `exit()` calls `onReleasePreparedEntry` (`setContextMode(null, { claimVisualAuthority: false })`) only in that case — Contacts the operator had on before entering stay on.
- **Units toggle (aviation ↔ metric) everywhere altitude and speed are shown** (2026-09-07, user asked whether ft/kts in the cockpit is right, then: "do both, everywhere altitude and speed appear"): `src/units.js` is the ONLY place that turns metres / m/s into text — `formatAltitude` (FL above 18 000 ft, else `12 500 ft`; metric `3 810 m`), `formatSpeed` (`499 kts` / `924 km/h`), `formatSpeedRange`, `formatVerticalRateMagnitude` (`980 ft/min` / `5,0 m/s`), `formatHeightAgl`, `formatVesselSpeedKnots` (`14 kn` / `26 km/h`), `altitudeDisplayValue` / `speedDisplayValue` + unit labels for instruments, `formatThousands` (U+202F thin space — the cockpit used to print `34,975`). Preference is per device (`localStorage` `oko-units`, like language) but switches LIVE via `gev:units-changed`: the Display-panel `#units-toggle` (`FT · KTS` ↔ `M · KM/H`) triggers `CockpitViewController.refreshUnits` (rim labels + immediate HUD repaint), both fleet modules rebuild the tracked card model at once, hover cards and detection labels reformat on their next build. Consumers: `trackedCardModel.js` (flight line, vertical rate), `flightProfile.js` labels, `contactHoverCard.js`, `cockpitApproach.js` (height above field, i18n `{h}` carries the unit), `detectionDraw.js` (`formatFlightLevel` → metres in metric, `formatKnots`), `militaryFlights.js` tracked label, `aisLiveVessels.js` (HUD `SPD` line KT/KM/H), cockpit instruments in `ui.js` (tape steps are value-agnostic). Voice/analyst metadata deliberately stays in aviation units (it is text for the model, not display).
- **Plain-language contact cards: both units, explained abbreviations, countries, landing time** (2026-09-12, user annotated the tracked card: „pridaj tam aj vysvetlivky, aby to aj debil pochopil — FL bude aj letová hladina, kts bude rýchlosť, prepočítať na km/h, KONYA bude aj Turecko"). The card model (`src/data/trackedCardModel.js`) now speaks to a layperson without dropping the aviation values: the tracked card gets its kinematics from `formatFlightLinesPlain()` as two or three lines — `Letová hladina FL360 (≈ 10 973 m)` (or `Výška 12 500 ft (3 810 m)` below FL180, `Na zemi` on the ground), `stúpa 980 ft/min (5,0 m/s)` on its own line only while climbing/descending (joined to the altitude it made 64 characters and the docked card clipped it live), and `Rýchlosť 401 kts (743 km/h) · kurz 327° (SZ)`; card lines stay ≤ 52 characters — while the compact `formatFlightLine()` (hover card, voice, context) shows the same dual units and compass point on one line. `units.js` gained the dual formatters `formatAltitudeDual`, `formatAltitudeRangeDual`, `formatSpeedDual`, `formatSpeedRangeDual`, `formatVerticalRateDual`: the unit toggle still decides which unit comes first (aviation `401 kts (743 km/h)`, metric `743 km/h (401 kts)`); on-icon labels keep single units for space. Route sides carry the country from `Intl.DisplayNames` in the UI language (`regionDisplayName`: `KYA Konya (Turecko) → CPH Copenhagen (Dánsko)`; an airport name parenthetical such as `Zemunik (Zadar)` yields to the country), the progress row reads `74 % trasy · zostáva 640 km · pristátie za 52 min (22:31)` (`formatEtaPlain`, no more `ETA 0:52`), the mini profile reads `výška FL360 → FL380 (10 973 → 11 582 m)` / `rýchlosť 405 → 413 kts (751 → 766 km/h) · posledných 13 min`, the ident line prefixes `reg. TC-NCY`, and the data line reads `OpenSky Network · poloha pred 11 s · squawk 3257 · ICAO 4BB879` (shared with the ship hover cards: `poloha pred 113 h`). New i18n keys `card.*`, `compass.points` (`S,SV,V,JV,J,JZ,Z,SZ` / `N,NE,…`). Verified live on EWG20X (Hamburg → Zadar): every line renders on the docked card. Tests updated across `trackedCardModel`, `units`, `flightProfile`, `contactHoverCard`, `flights`, `tr3bRegistry` (the tripwire now pins the dual formatters).
- **Whole-flight charts on the tracked card: altitude with a forecast, and speed** (2026-09-12, user circled the mini profile: „graf celkovej výšky letu a keď sa dá aj predpokladaná výška… pekný malý graf" and „ďalší malý graf rýchlosti celkovej letu"). `src/data/flightCharts.js` (pure) builds two series over the WHOLE current leg: past fixes come from the local flight history (`/api/history/track`, 24 h raw fixes of our own polls — fetched by `src/data/trackedHistory.js` with a 60 s TTL cache, single in-flight request, `onDone` only after a real fetch, 503 = history disabled → no further asks, the same pattern as ACARS) merged with the card's 30-min live ring and the current fix (`mergeTrackSamples`, 5 s dedupe); `currentLegFixes` keeps only the leg after the last > 30 min gap (an earlier rotation of the same airframe is a different flight). The x axis is the route fraction when the card has a plausible route (`haversine(origin, fix) / totalKm`, clamped to „now"), otherwise time since the first recorded fix; a flight parked at its origin airport collapses to one route bucket, so it falls back to the time axis (live case: EWG20X on the ground in HAM). Series are bucket averages with linear gap fill over `FLIGHT_CHART_SAMPLES = 96` points, normalised 0..1 (`null` = unknown). **Forecast (route mode only, always drawn dashed and tagged `odhad`):** `forecastAltitude` holds the current level to the top of descent from the 3° rule of thumb (`DESCENT_FT_PER_NM = 300`: FL360 → ~222 km before landing), then descends linearly to 0 m (airport elevation unknown); a descending aircraft goes straight to the destination; a climbing one keeps its vertical rate up to the highest known level (or `CRUISE_GUESS_M = 11 000 m`, at most a quarter of the route) — a model, never data (rule 2). Speed is never forecast. **Rendering** (`worldOverlayDraw.js` `paintFlightChartsRows`): two boxes side by side (`FLIGHT_CHART_W 150 × FLIGHT_CHART_H 42`) over `FLIGHT_CHART_ROWS = 3` card rows, altitude = accent fill + line, speed = amber line, the „now" dot, titles `VÝŠKA` / `RÝCHLOSŤ`, axis ends = airport codes (route) or `HH:MM … teraz` (time), then two label lines `výška max FL400 · teraz FL400` / `rýchlosť max 422 kts · teraz 419 kts (776 km/h)`; the old 30-min mini profile stays only as a fallback while a chart has fewer than 2 points. `trackedReadout.js` passes `charts` into the entry and `worldOverlay.js` validates it (`normalizeChartsRow`) so painters never see a half-formed row. Verified live on WIF7H (time axis) after the passthrough bug (charts built but never copied into the overlay entry) was found on the pane. Tests: `flightCharts.test.mjs`, `trackedHistory.test.mjs`, painter and normaliser cases in `worldOverlayDraw.test.mjs`, tripwires in `flightProfile.test.mjs`.
- **Airline and manufacturer logos on the tracked card — Wikipedia infobox → Wikimedia Commons, free licences only** (2026-09-12, user: „aj logá spoločnosti a výrobcu lietadiel", chose Commons via a cached proxy over a paid logo API). `logoProxy()` in `vite.config.js`: `GET /api/logo?kind=airline|manufacturer&name=…` resolves the en.wikipedia page (title candidates from `logoResolve.airlineTitleCandidates` — `Name`, `Name (airline)`, `Name Airlines` — then a fulltext search fallback; manufacturers map from the first type words via `MANUFACTURER_TITLES`), reads `| logo =` from the infobox wikitext (`infoboxLogoFile` handles `[[File:…]]`, `File:`, bare names and the `Name.svg{{!}}class=skin-invert` form used by Airbus/Boeing), asks `imageinfo` for the file and keeps it ONLY when `imagerepository` is `shared` (hosted on Commons — a Commons file looks `missing` from en.wikipedia, so `missing` must not be treated as absence) and `LicenseShortName` is public domain / CC0 / CC BY / CC BY-SA (`acceptableLogoLicense`; local fair-use logos such as Ryanair, Widerøe, Austrian are refused with `not_commons`, so those cards simply show no logo), then stores the 240 px PNG thumb under `.gev-cache/logos/<id>.png` and serves it from `/api/logo/img/<id>.png`. Every Wikimedia call carries `User-Agent: OKO-logo-bot/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) node-fetch` per the Wikimedia User-Agent policy. Cache 30 d (positive), 1 d (`no_logo`), 7 d (`license`/`not_commons`); memory + disk, single-flight, limiter 20/min/IP, a 45 s guard drops a stuck shared promise (live: „Airbus" hung forever after a Vite restart). Client `src/data/contactLogos.js`: metadata cache 24 h (6 h after failure, 503 disables), `onDone` only after a real fetch (ACARS pattern), `Image` cache with a ready listener like flags, `logoDrawSize` keeps the aspect at 14 px height (max 96 px), `paintLogo` draws a light 92 % white plate under a loaded logo (dark wordmarks were invisible on the dark card live) and a silent placeholder while loading. Card: `logos: { airline, manufacturer }` from `contactLogosFor()` in `_trackedLabelParts`, requested in `_updateTrackedLabelModel`, passed through `buildTrackedCardModel` → `trackedReadout` → `worldOverlay.normalizeLogosRow` (only `/api/logo/img/` URLs survive) → painter row right after the ident line; the footer gets `Logá: Wikimedia Commons · <licence> [· author for CC BY]` (`logoCreditLine`). Verified live: Eurowings, Pegasus, Emirates, Wizz Air, Lufthansa (PD), Airbus, Boeing, Embraer, ATR (PD) resolve; Ryanair/Widerøe/Austrian are non-free → no logo; RYR70XA card showed the Boeing logo row and the credit line. Trademark note: logos identify the operator/manufacturer of the tracked aircraft (nominative use), never brand OKO. Tests: `logoResolve.test.mjs`, `contactLogos.test.mjs`, painter row in `worldOverlayDraw.test.mjs`, tripwires in `flightProfile.test.mjs` (Commons-only, licence filter, User-Agent).
- **Hi-res terrain pipeline takes every published DMR 6.0 LOT and downloads them itself** (2026-09-12, user: „chcem čo najväčšiu ostrosť" → „všetkých 16 dostupných"). `scripts/build-sk-terrain-hires.mjs`: `PUBLISHED_LOTS` (LOT04, 06, 07, 08, 09, 10, 11, 12, 13, 16, 17, 20, 27, 29, 31, 32 — ÚGKK cycle-2 list checked 2026-09-12, HEAD 200 each, ≈ 210 GB of ZIPs; known regions: 06 Piešťany, 07 Trnava, 08 Bratislava, 10 Dunajská Streda, 20 Nové Zámky), `SK_HIRES_LOTS=LOT08,LOT10` narrows; per LOT: `curl -C -` download from `https://opendata.skgeodesy.sk/static/LLS/2_cyklus/<LOT>/<LOT>_DMR6_sjtsk03_bpv.zip` (resumable `.part`, sanity ≥ 1 GB) → extract → warp → relabel → cleanup (extracted ~30 GB raster, warp intermediate and the ZIP are deleted unless `SK_HIRES_KEEP_ZIP=1`; a finished LOT with its relabeled TIFF is skipped entirely, so the run resumes without re-downloading); union VRT / mask / staging dir carry a hash of the LOT list (`sk-terrain-hires-<hash>`), the validity mask grows with the union (`maskPx` up to 48 000), and a running CTB container aborts the run (orphan lesson). The base script now skips download/unzip/warp when the relabeled TIFF exists (the cleaned sources used to force a 2.3 GB re-download). The DMR 3.5 base was already at z15 (199 776 tiles nationwide) — the 10 m source has no more to give; LiDAR LOTs at z15–z18 (~1.2 m) are the only sharper path. Started 2026-09-12 23:14 via the `oko-terrain-build` task (LOT04 downloaded 14.2 GB at ~19–30 MB/s in ~10 min, warp running); expect many hours — the gdalwarp/CTB containers saturate the CPU, so Vite restarts and the browser crawl meanwhile. **Incident:** at ~23:05 both the `OKO dev server` watchdog and the first terrain run ended with `0xC000013A` (STATUS_CONTROL_C_EXIT) at the same moment — cause not identified (nothing in the Task Scheduler log); both tasks were restarted with `Start-ScheduledTask` and resumed; check `Get-ScheduledTaskInfo` result codes when a background job disappears.
- **`.gev-cache` lives on D: behind an NTFS junction; terrain steps are restart-safe** (2026-09-13, user: „nedajú sa veľké súbory preniesť na druhý disk, aby sa mi neplnili na C:?" → chose `D:\OKO\gev-cache` and „teraz — prerušiť build, presunúť, pokračovať"). The whole cache directory (nationwide z15 terrain tiles, LOT sources, GFW / logo / meteo / CelesTrak caches, watchdog and build logs — tens of GB) was moved with `robocopy /E /MOVE /MT:32` from PowerShell (the same command from Git Bash failed with exit 16 — MSYS path mangling; run it from PowerShell with single-quoted paths), and `C:\AI\OKO\oko\.gev-cache` is now a junction (`mklink /J`) to `D:\OKO\gev-cache`. No code path changed: Node resolves `process.cwd()/.gev-cache` through the junction, the watchdog log (`.gev-cache/logs/oko-server.log`) and the terrain log stay where the scripts expect them, `.gitignore` still ignores the directory. Two consequences handled in the terrain scripts: (1) Docker bind mounts get the real directory — `build-sk-terrain.mjs` and `build-sk-terrain-hires.mjs` mount `fs.realpathSync.native(CACHE)` instead of the junction path, so Docker Desktop never has to resolve the junction itself (D: is shared with Docker Desktop; verified with a throw-away `-v D:\OKO:/x` run); (2) `viaTmp()` in the hires script writes extract / warp / relabel output to `<target>.tmp` and renames only after success, so an interrupted step (Ctrl+C, task restart, killed container — live 2026-09-13 a 1.5 GB torso of the LOT04 gdalwarp output would have passed as a finished step) is redone instead of skipped; a stale `.tmp` is removed at step start and the warp passes `-of GTiff` explicitly; (3) the relabel step no longer re-encodes the raster — `gdal_edit.py -a_srs EPSG:4326` rewrites the GeoTIFF keys of the warp output in place (seconds) and the file is renamed to `<LOT>_wgs84_4326.tif`; the old `gdal_translate` copy took longer than the 29-minute warp itself and, interrupted at 30 %, left a 1.6 GB torso that the „relabeled exists → skip whole LOT" shortcut would have accepted (deleted before the restart). The union-mask `gdalinfo` call in both scripts mounts the real path too; verified with `docker inspect` on the restarted LOT04 warp (`D:\OKO\gev-cache -> /cache`). Flight history is separate: the DB has lived on `D:\oko-history` since 2026-09-07 (`FLIGHT_HISTORY_DB` in `.env`, not under `.gev-cache`; the `flight-history.sqlite` still lying in `.gev-cache` is the pre-09-07 default-path leftover); in the same conversation the user chose „plný záznam 30 dní, retencia 365 dní", so `.env` now has `FLIGHT_HISTORY_RETENTION_DAYS=365` and `FLIGHT_HISTORY_RAW_HOURS=720` (was 8760 — fixes older than 30 days are thinned to 2-minute steps again). After the move both scheduled tasks were started again (`Start-ScheduledTask 'OKO dev server'`, `'oko-terrain-build'`); the hires run resumes at the LOT04 warp. One test needed a change: `trafficTiming.test.mjs` wrote its instrumented copy of `traffic.js` into `.gev-cache` and imported it — Node's ESM loader imports through the real path on D:, above which there is no `node_modules`, so the bare `cesium` import failed (`ERR_MODULE_NOT_FOUND`); the copy now lives in `node_modules/.cache/oko/` (gitignored, not watched, resolves packages). Rule: never import a module written under `.gev-cache`; data files are fine.
- **GFW proxy serialises upstream reports and retries one 429; both GFW layers show a truthful 429 message and retry themselves** (2026-09-13, user: „ukáž mi to na hormuze" — the first time the AIS presence and the SAR layer were switched on together). Live: both layers requested their report at the same moment; GFW answered the second one with HTTP 429 while the first (SAR, 13.7 s) was still being generated, and the layer row said „denný rozpočet dopytov GFW minutý" — false, the budget counter stood at 1 of 300; a manual retry 20 s later succeeded. Proxy (`gfwPresenceProxy()` in `vite.config.js`): `fetchReportQueued()` runs every upstream report through one promise chain (`upstreamQueue`, shared by the presence and SAR plans, survives a rejected predecessor) and repeats a 429 once after `Retry-After` (2–20 s; `fetchReport` now stores `error.retryAfterMs`); the retry costs one budget unit like any upstream call. Client (`src/data/gfwPresence.js`, `src/data/gfwSarDetections.js`): `{error:'budget'}` keeps the budget message, every other 429 (upstream, or the proxy's own per-IP limiter) shows `gfw.throttled` („Global Fishing Watch dočasne odmieta dopyty (429) — o 30 s skúsim znova") and `scheduleRetry()` re-fetches the same view after `GFW_PRESENCE_RETRY_MS` (30 s, deliberately above the proxy's 20 s cap) unless that view loaded meanwhile or the layer was disabled (`disable()` clears the timer; a successful load clears it too). Tests: `gfwPresence.test.mjs` (429 → throttled + silent retry with `mock.timers`, budget → no retry, disable cancels, proxy tripwires: queue, retry-only-on-429, Retry-After, 20 s cap < client 30 s), `gfwSarDetections.test.mjs` (same for the radar layer). Verified at Hormuz (56.45 E 26.45 N, 230 km): 1 352 AIS vessels (hourly cells, data as of 9 Sep, „ONESKORENÉ") + 1 365 SAR detections (788 with an AIS match, 577 without). Side note from the same session: camera and layer choices survive a Vite restart (the page reloads and restores them from storage), so a `vite.config.js` edit no longer costs the user their view.
- **Gas panel, stage 1: prices from ACER (daily) and IMF via FRED (monthly) — no keys, no paid feeds** (2026-09-13, user: „potrebujem plyn kompletne EÚ a ZSSR … reálne dáta, ceny na burzách, história, zásobníky, prietoky", then „platiť nechcem, nemám peniaze"). New left-rail panel `#gas-panel` (order 6, right after Flight history; `src/gasPanel.js`, markup in `index.html`, styles in `style.css`, registered in `ui.js` share/cockpit lists, `panel.gas` i18n) with the PRICES card: headline = TTF front-month **derived** from ACER (EU LNG price minus the LNG benchmark, which Council Regulation (EU) 2022/2576 defines as the spread to the ICE Endex TTF front-month settlement — the card says „odvodené / derived" and its note says it is not an exchange quote), day-on-day change, EU / NW / S Europe LNG prices, 1M / 1Y / MAX chart (`src/gasChart.js`: real time axis, same palette, grid and label placement as the flight-history chart; MAX overlays the IMF monthly European price since 1992 — in € only from 1999 because the euro rate starts there — on the daily ACER series), a lay line (€/MWh → ct/kWh, „households pay distribution and taxes on top"), source line and a freshness line (stale after 5 days without a new weekday value). Data module `src/data/gasPrices.js` (pure, no i18n/DOM — also imported by the server: ACER CSV parser by column name, FRED CSV parser, monthly USD/MMBtu → €/MWh via the FRED DEXUSEU monthly average and 1 MMBtu = 0.293071 MWh, range slicing, change, SK/EN formatting, `buildPricesModel`). Proxy `gasProxy()` in `vite.config.js`: `GET /api/gas/prices` fetches the public ACER TERMINAL historical CSV (`…/terminal/price_assessments/historical_data`; 884 weekdays from 19 Jan 2023 to 11 Sep 2026 at first run) and two keyless FRED CSVs (PNGASEUUSDM, DEXUSEU; 415 months), caches memory + disk `.gev-cache/gas/prices.json` for 6 h, serves stale up to 7 days, single-flight, 20/min/IP, 25 s / 4 MB per source, `User-Agent: OKO-gas/0.1 (…contact…)`; a FRED failure degrades to ACER-only (`monthly.error`); `/api/gas/status`. Live 11 Sep 2026: EU LNG 77.15 €/MWh, benchmark −2.37 → TTF ≈ 79.5 €/MWh (−3.1 % d/d). Explicitly out: EEX/ICE quotes (licence only; the tripwire forbids exchange hosts in the proxy). Lesson from the same evening: the terrain LOT warps on D: starve the flight-history SQLite (also on D:, synchronous `node:sqlite`) — while a gdalwarp ran, every dev-server request hung for 20+ s (Vite idle at 0.3 s CPU/5 s, port listening), and recovered the moment the warp finished; if that recurs, pause the recorder during warps or move one of the two off D:. Agreed next stages: ENTSOG flows card + globe layer (no key), GIE AGSI+/ALSI storage & LNG (user's free API key in `.env`), Eurostat/JODI import history, GEM/OSM infrastructure layer, LNG fleet via AIS. Tests: `gasPrices.test.mjs`, `gasPanel.test.mjs` (chart stub, DOM lifecycle on a fake document, tripwires for markup/CSS/UI/i18n/proxy, no bare `cursor: pointer` — the context-menu tripwire enforces `--cursor-pointer`).
- **Gas panel, stage 2: physical flows from ENTSOG, 32 point-directions in one hourly request, no key** (2026-09-13, same conversation: „zásobníky, prietoky a všetko"). `src/data/gasFlows.js` (pure, shared with the server) holds the catalogue: Slovakia (eustream SK-TSO-0001: Lanžhot ↔ CZ, Baumgarten ↔ AT, Veľké Zlievce ↔ HU, Výrava ↔ PL, Veľké Kapušany and Budince ↔ UA, Láb storage entry = withdrawal / exit = injection) and „EU borders with the former USSR and Russian routes" (Strandža 2 TurkStream and Strandža 1 Trans-Balkan from TR, Greifswald OPAL/NEL Nord Stream landing, Imatra FI–RU, Narva and Värska EE–RU, Kotlovka BY–LT, Sudzha RU–UA and Kobryn/Mozyr BY–UA on the Ukrainian TSO — ENTSOG carries Gas TSO of Ukraine and the Moldovan TSOs — Isaccea I ↔ RO, VIP Bereg ↔ HU, Ungheni RO→MD, Kipoi TAP and Kipi ITG from TR), each with operator/point/direction keys verified against `operatorpointdirections` and approximate station coordinates for a later globe layer. The proxy builds one `operationalData.json` request with all `pointDirection` keys comma-separated (verified live: ENTSOG accepts the list), indicator Physical Flow, `periodType=day`, 31 days back, `timezone=CET`, `limit=-1`; `cachedRoute()` refactor in `gasProxy()` now serves both `/api/gas/prices` and `/api/gas/flows` (flows TTL 1 h, stale 3 d — ENTSOG T&C 5.6 forbids usage that reduces platform performance, 5.7 allows automated download via the API tool), `/api/gas/status` reports both. `normalizeFlowRows` turns kWh/d into GWh/d (MWh/d and GWh/d units handled too), keys the gas day by `periodFrom`, lets a later duplicate day win; `summarizeSeries` gives latest / previous / 7-day average / max; `buildFlowsModel` yields the TOKY card rows: route + station, GWh/d (0 shown dim, missing shown „bez dát"), „≈ mcm/d" at 10.55 kWh/m³ (lay conversion, hence ≈), 7-day average, gas day, Provisional/Confirmed, a fixed note per station (TurkStream = the only Russian pipeline route into the EU, Sudzha contract expired 1 Jan 2025, Nord Stream out of service since 2022, TAP = Azerbaijani gas …), a 14-day sparkline (`drawSparkline` in `gasChart.js`, zero baseline), freshness (stale after 4 days), and the footer citation required by T&C 5.2: „ENTSOG TP DD-MM-YYYY https://transparency.entsog.eu/". The status line always says „predbežné, D−1" — ENTSOG publishes the gas day the next morning (~06:35 CET), hourly rows exist for some points but are not used yet. Live at first run: all 32 rows rendered; TurkStream (Strandža 2) 380.9 GWh/d, TAP Kipoi 258.2, Kotlovka 13.3, Sudzha 0, Greifswald no data; Slovakia: Veľké Zlievce HU→SK 90.3, Baumgarten AT→SK 7.8, Lanžhot 0 on the last day (7-day average 6.6), eustream gas days lag 2–3 days (10 Sep on 13 Sep) while other TSOs already show 12–13 Sep. Tests: `gasFlows.test.mjs` (catalogue integrity, URL, normalisation, summaries, payload, model, citation, fetch) and the panel test (32 rows, levels, note, status, footer; independent failure of the flows card). Next: the globe layer of flow points (coordinates are in the catalogue), then GIE storage/LNG once the user adds `GIE_API_KEY`, Eurostat/JODI history, GEM/OSM infrastructure, LNG fleet via AIS.
- **Gas panel, stage 3: storage (GIE AGSI+) and LNG terminals (GIE ALSI) behind the user's free API key** (2026-09-13, user: „otvor stránku, ja sa nalogujem, ty ma zaregistruješ" → the user registered at agsi.gie.eu themselves; the 32-character key went page → clipboard → `.env` without passing through the assistant, see the memory note). `GIE_API_KEY` is read lazily on the server and sent only as the `x-key` header; without it `/api/gas/storage` and `/api/gas/lng` answer 503 `no_key` and the cards say „chýba kľúč GIE". `src/data/gasStorage.js` (pure, shared with the server): request plans (AGSI: EU aggregate 5 years in one request — `size=2000`, verified: 1 829 days; SK and UA 400 days; AT, CZ, HU, PL, DE, IT, FR, NL latest 3 days; ALSI: EU 400 days plus PL, DE, NL, BE, FR, ES, IT, GR, HR, LT latest), normalisers (the API returns numbers as strings and „-" for missing; `full` is recomputed from TWh when absent; injection − withdrawal = net), `buildGiePayload`, `yearAgoValue` (±3 days), `buildStorageModel` (EU headline: % of working gas volume, TWh of TWh, net injection/withdrawal, a year ago, „≈ N days of average consumption" from `consumptionFull`, estimate/confirmed status; 1Y / 5Y chart of the EU fill; country rows with a fill bar) and `buildLngModel` (EU send-out GWh/d, tank inventory vs declared maximum, year chart, country rows). Proxy: `buildGie(kind)` walks the plan sequentially with 150 ms gaps, a failed country is reported in its row, a failed EU aggregate fails the build (stale served); TTL 3 h, stale 7 d, disk `.gev-cache/gas/storage.json` and `lng.json`; `/api/gas/status` shows `gie.hasKey`/`keyLength` and both caches. Terms (GIE API manual, registration page): „All data published on AGSI & ALSI can be used or repackaged in any way you see fit but a clear indication on GIE as data source is mandatory" → `gas.gie-source` footer on both cards. Panel: `paintSeries()` now draws every card chart (prices, storage %, LNG send-out), `renderCountryRows()` renders rows with an optional fill bar; `formatGwhDay` drops the decimal from 100 GWh/d. Live at first run: EU 67.8 % (767 of 1 132 TWh, net injection 1 368 GWh/d, ≈ 80 days), SK 52.1 %, UA 34.8 %, PL 97.6 %, DE 55.4 %; LNG EU send-out 3 119 GWh/d, tanks 48.6 %. Tests: `gasStorage.test.mjs`, panel test (both cards, no_key path, tripwires: `x-key` only on the server, no `process.env` in the client module, GIE named as source).
- **Gas panel, stage 4: the „gas-flows" globe layer — border stations as labelled points, click card, fly-to from the TOKY rows** (2026-09-13, user: „pokračuj ďalšou etapou"). `src/data/gasFlowsLayer.js` (token `9`, registry pin 33 → 34, credit `gas-flows`, i18n `layer.gas-flows.name`): `groupStations()` folds the 32 point-directions into 21 stations by rounded coordinates (Lanžhot entry + exit, Strandža 1 + 2, Greifswald OPAL + NEL, Isaccea, VIP Bereg each become one point), `stationLabelText()` = station name plus one `CZ → SK 24,6 GWh/d` line per direction, colour by station level (amber = flows, grey = zero, dark = no data; the point is larger when gas flows), Cesium native labels with a dark plate, `scaleByDistance`/`translucencyByDistance` so the labels fade at continental zoom, `disableDepthTestDistance` so points never sink into the photoreal mesh. Data come from the same `/api/gas/flows` proxy as the panel (cache 1 h, refresh 30 min → no extra ENTSOG calls); `getStats().source` carries the T&C 5.2 citation and `status: 'stale'` when the newest gas day is older than 4 days. Click = own `ScreenSpaceEventHandler` like localGeojson (pick → `viewer.selectedEntity` + `selectEntityContext`), the context record has label, the ENTSOG citation as source, approximate coordinates and properties (per-direction flow · ≈ mcm · 7-day average, gas day + provisional/confirmed, station note). `disable()` also drops the selection if it is a station. Panel: every TOKY row with coordinates is a button (`role=button`, Enter/Space) whose `onFlyTo` in `ui.js` enables the layer (`origin: 'user'`) and flies the camera 120 km above the station. Tests: `gasFlowsLayer.test.mjs` (grouping, label/colour/context properties, lifecycle on fake Cesium data source and handler, click selection, proxy error, registry/credit/i18n), panel test (row click and keyboard → onFlyTo, main.js registration tripwire), registry pin updated.
- **Gas stations get aircraft-style cards: compact tactical cards, and on click a tracked card with two 31-day charts (flow + TTF price), the second direction as a profile row, price line and provenance footer** (2026-09-13, user annotated the plain labels: „sprav ako pri lietadlách aj s grafmi, históriou, daj tam aj cenu, jednoducho lepšie"). `gasFlowsLayer.js` no longer uses Cesium labels: every station publishes a world-overlay entry through the shared host (`setOverlayEntries('gas-flows', …)`, cohort 24) — the compact card goes through `applyVesselOverlayPolicy` (variant `card`, tactical style, keyhole edge fade, fades beyond 2 800 km) with title, one line per direction and the gas day; the selected station becomes a `tracked` variant entry (protected, tracked lane, priority max) built by `stationTrackedCard()`: route row with country flags, details (per direction: GWh/d · ≈ mcm · 7-day average; gas day + provisional/confirmed; „TTF 79,5 €/MWh · 7,95 ct/kWh · 11. 9." from the ACER-derived price), `charts` (altitude slot = main direction 31 gas days normalised by its maximum with null gaps, speed slot = TTF over the last 31 calendar days, titles/axis/labels localised), `profile` = second direction 31 days, footer = station note + „predbežné, D−1 · poloha stanice približná" + the ENTSOG T&C 5.2 citation. `normalizeDaily()` builds the 31-day axes (max-normalised, zero floor). Clicks: own handler first asks `hitTestWorldOverlay(x, y, { sourceId })` (card click toggles), then `scene.pick` on the small station point, an empty click collapses, a click on another layer's object leaves the selection; `activate` on the entries serves keyboard/assistive activation; `selectStationByRowId()` lets the TOKY row fly-to open the card (a selection requested before the first load is remembered). Prices come from `/api/gas/prices` in the same refresh (cache 6 h; a failure only drops the price line). Tests: `gasFlowsLayer.test.mjs` (grouping with series, `normalizeDaily`, compact vs tracked card shapes incl. flags, charts, profile, footer and the price line, lifecycle on fake data source / handler / overlay host with click routing, pending selection, proxy errors, registry/credit/i18n).
- **Gas panel, stage 5: the „gas-pipelines" globe layer — EU + former-USSR gas transmission pipelines from an OpenStreetMap snapshot, ground-clamped lines with click cards** (2026-09-13, user: „pokračuj ďalšou etapou a elektrinu nateraz vypni" — the SK energy-grid layer was switched off in the running app, not removed). Build `scripts/build-gas-pipelines.mjs` (no key): 6 Overpass bbox tiles (34–75° N, −12…180° E) of `man_made=pipeline` + `substance=gas|natural_gas` + `usage=transmission` (east of 20° E also ways without `usage` that carry `diameter` or `name`, because Gazprom-era mapping rarely sets usage), 20 s pauses, 3 retries, raw tiles cached in `.gev-cache/gas/osm-pipelines/`, clipped to the tile, simplified 0.002° and rounded to 3 decimals → `.gev-cache/gas/pipelines.geojsonl` (one Feature per line: name, name:en, operator, ref, diameter mm, substance, location, status from construction/proposed/disused/abandoned tags, OSM way id, segment length) + `pipelines.meta.json` (snapshot time, licence, endpoint, per-tile counts and OSM base timestamps). First snapshot 2026-09-13 14:08 UTC: 14 720 segments (5 743 named, 6 planned), 92 396 points, 197 472 km, 5.9 MB in 447 s (the public mirror answered 504 on the first attempt of the three big tiles, then served; the 148–180° E tile is empty); 25 ways crossing a tile border arrive twice and the second copy gets a `#2` suffix (the first live run threw „entity with id … already exists" on such a duplicate — fixed in the build, and the layer also suffixes duplicates and empties its data source before a retry). Live 2026-09-13: 737 kB gzip transfer, 14 720 ground polylines drawn within ~6 s at 1 CPU spare while the terrain container was throttled; a click on the TAG I segment near Salzburg highlighted it white and opened the card (operator, DN 900 · 11 km, status, OSM way, ODbL footer). Proxy: `/api/gas/pipelines/meta` (registered before the file route — connect matches prefixes) and `/api/gas/pipelines` stream the files from disk with ETag (size+mtime), `max-age=86400`, gzip when accepted, 404 `no_snapshot` when the build never ran; `/api/gas/status` reports `pipelines`. Client `src/data/gasPipelines.js` (pure: geojsonl parser, status, style — width 2.8/2.0/1.4 px by DN ≥ 900/≥ 500/other, amber operating, lighter dashed planned, dimmed disused —, card title name → name:en → ref → „bez mena", details DN · km · status · OSM way, midpoint, source label „© OpenStreetMap contributors · ODbL · snímok <date> · <km> km", `fetchGasPipelines` = meta first with `no-store`, then the file under a URL versioned by the snapshot time so a rebuild shows up without a hard reload). Layer `src/data/gasPipelinesLayer.js` (token `0` — the last free digit; registry pin 34 → 35; credit `gas-pipelines`; i18n `layer.gas-pipelines.name`, `gas.pipeline-*`): CustomDataSource of `clampToGround` polylines (entity events suspended while adding ~15 k entities), lazy single-flight load on first enable, the hourly manager tick is a no-op afterwards; click = own handler (overlay card hit → collapse; pick `__gasPipeline` → white +2 px highlight, `viewer.selectedEntity`, contextStore record with the midpoint, `selected` overlay card at the segment midpoint through `applyVesselOverlayPolicy`; the same segment again or an empty click collapses; another layer's object keeps the selection); `disable()` drops the selection and the card; a missing snapshot → `getStats().error` = the i18n hint to run the build. Tests: `gasPipelines.test.mjs`, `gasPipelinesLayer.test.mjs` (lifecycle on fake data source / handler / overlay host, styles per status, click routing, 404 vs other errors, registry/credit/i18n, tripwires for the main.js registration, proxy route order, gzip, `no_snapshot`, keyless build script). Lesson: after editing `layerState.js` and `main.js` in one go the open tab kept a stale `layerState.js` module and failed with „registry mismatch (extra: gas-pipelines)" until a second reload — check `curl /src/data/layerState.js` before suspecting the code.
- **Gas panel, stage 6: the DOVOZ card — where the EU's gas comes from, monthly since 2021 (Eurostat `nrg_ti_gasm`), stacked by origin** (2026-09-13, user: „pokračuj ďalšou etapou"). Source facts verified live: Eurostat's JSON-stat dissemination API, keyless (`…/statistics/1.0/data/nrg_ti_gasm?format=JSON&freq=M&unit=MIO_M3&geo=EU27_2020&sinceTimePeriod=2021-01`, ~300 kB, 166 partner codes × 2 `siec` (natural gas total, LNG) × months); the EU27 aggregate exists from January 2021 and lags 2–3 months (on 13 Sep 2026 the last complete month was June 2026, dataset updated 8 Sep); reuse is „authorised provided the source is acknowledged", modifications must be stated and a non-responsibility disclaimer shown. Honest reading of the data: the partner is what the importing member state reports — often the last transit country (Algerian gas appears as TN, Azeri as AL, Russian as UA/BY/TR/RS) plus a lot of intra-EU re-trade (BE/DE/NL as partners), so the naive „Russia" share would be a third of the truth. Therefore `buildImportsPayload()` (`src/data/gasImports.js`, pure, imported by the server too) drops the EU27 partners, splits pipeline (= total − LNG) from LNG and folds partners into nine fixed groups (`GAS_IMPORT_GROUPS`: Norway; Russia; transit UA·BY·TR·RS; Algeria+Tunisia; Azerbaijan+Albania; USA; Qatar; other LNG incl. „not specified"; other pipeline incl. UK/CH/LY/NSP), trimmed to the last month with a reported TOTAL. Proxy `/api/gas/imports` (`cachedRoute`, TTL 24 h, stale 30 d; the first Eurostat answer took 26 s) returns only the grouped payload (~11 kB) and `/api/gas/status` reports `imports`. Card `imports` in `src/gasPanel.js`: headline = extra-EU imports of the latest month in „mld m³" (`formatBcm`) with the y/y change, label „dovoz do EÚ z krajín mimo EÚ · jún 2026", sub-line ≈ TWh (10.55 kWh/m³) · Russia's share vs the 2021 average · transit share vs 2021 · LNG share; ranges 2R / MAX (from 2021); stacked area chart `drawStackedChart()` in `src/gasChart.js` (layers bottom-up in group order, total line in the accent, max/last labels in bcm, month axis); legend rows (`.gas-legend-row`: colour swatch, name, bcm, share, „z toho LNG · pred rokom") sorted by volume with zero groups dimmed; note and source line naming Eurostat, the OKO grouping and the disclaimer; `stale` after five months without a new month. Live June 2026: 27.5 bcm extra-EU (−6.7 % y/y), ≈ 290 TWh, Russia 8.9 % (2021 average 23 %), transit routes 6 % (2021: 22 %), LNG 39 %. JODI-Gas was checked and set aside: the public „beta" CSV zip on jodidata.org still ends in August 2018. Tests: `gasImports.test.mjs` (JSON-stat parser, grouping, formats, model, fetch) on the synthetic fixture `src/data/fixtures/eurostatImportsFixture.mjs`, and the panel test (card, ranges, error path, tripwires for the route, TTL, i18n and CSS).
- **Two fixes from the user's annotated screenshots the same evening.** (1) The TTF chart in the station card looked like torn blocks: weekends and holidays have no ACER value, so the painter split the area into weekly runs, and the zero-floor normalisation pushed a 75–82 €/MWh line to the top edge. `normalizeDaily()` in `gasFlowsLayer.js` now takes `fill: 'forward'` (carry the last settlement over days without a value) and `floor: 'min'` (min–max with an 8 % margin, flat series = mid) for prices; flows keep the zero floor because a zero flow is information. (2) Collapsed panels of the left stack share one width again (`--left-collapsed-width` in `style.css`): History and Gas sat at 360 px next to the 170 px Layers and Scenes.
- **Gas pipelines v2 — fewer fragments** (same evening, user: „niekde sú len fragmenty a hluché miesta"). An Overpass survey over SK/AT/CZ/HU found 5 249 gas pipeline ways but only 566 tagged `usage=transmission`; 1 926 carried no `usage` at all (among them 132 FGSZ, 94 ONTRAS and 22 Gaz-System ways — transmission operators — and 246 named ones), and long routes are mapped as `type=route` + `route=pipeline` relations (OPAL, West Austria Gasleitung, Urengoy–Pomary–Uzhhorod) whose member ways often lack even `substance`. `scripts/build-gas-pipelines.mjs` now requests transmission ways plus untagged ways with a diameter, name or operator, plus the member ways of gas `route=pipeline` relations (with `.r out body` so relation tags become defaults for members), and keeps a way only when `classifyPipeline()` says transmission / relation member / DN ≥ 300 / named / TSO operator (`TSO_RE`: European and ex-USSR transmission operators incl. Cyrillic Газпром/трансгаз), dropping distribution, facility, service and known DN < 150. Raw tiles are versioned (`tile-v2-…`) so an old cache is never mixed in; meta records the `basis` counts. Rebuilt 2026-09-13 17:07 UTC in 288 s: 18 378 segments (was 14 720), 8 447 named (was 5 743), 230 203 km (was 197 472), 7.2 MB; kept by basis: transmission 14 085, relation member 513, DN ≥ 300 990, named 2 008, TSO operator 1 294; 3 951 candidate ways dropped as distribution/facility/small bore. Türkiye's BOTAŞ network (550 ways, no `usage` tag) now appears through the operator rule. Remaining blind spots are OSM coverage gaps (Russia east of the Urals, Central Asia) — GEM attributes would fill them but need the user's registration.

- **Gas pipelines — southern band, the Middle East finally has data (stage 1)** (2026-09-19, user: "potreboval by som doplniť plynovody do Blízkeho východu"). The snapshot's floor was latitude 34° N, so Saudi Arabia (16–32°), Qatar/UAE (22–26°), Iran below 25°, Egypt (22–31°) and all of South/South-East Asia were outside the query — not missing data, a missing bbox. `TILES` gained six southern tiles `[0, W, 34, E]` on the SAME meridian cuts as the north, APPENDED (the '#N' cross-tile suffix is assigned in TILES order, so prepending would silently renumber the existing 18 378 ids) with the north edge at exactly 34 (clipToBbox bounds are inclusive, so abutting bands share only the boundary point; any overlap would draw the same ground twice). The floor is the equator, not 12° N: an `[out:count]` survey measured the 12–34° N band at 642 ways across the whole window and the 0–12° N strip at just 53 more (+8 %), and the equator is the only floor that covers the Malacca scene frame (bottom edge 1.0° N). `QUERY_VERSION` stayed `v2`, so the six cached northern tiles (44 MB) were reused untouched and only six new tiles were fetched. Downloading alone was not enough: `classifyPipeline()` drops a way that has no `usage`, no diameter and no name unless its operator matches `TSO_RE`, which was purely European and ex-Soviet — so `TSO_RE` gained Gulf, Iranian, North African and Asian operators, every one verified against real `operator` values in taginfo rather than invented (sonatrach + سوناطراك, \bgrtg\b, dolphin energy, \bkar group\b, \bnigc\b, \bgail\b, \biocl\b, indian oil, petronas gas, perta arun, \bmoge\b, trans thai-malaysia, 国家管网, and the Persian route descriptors لوله گاز / انتقال گاز because Iran uses `operator` as a route description, not a company). Word boundaries are load-bearing and were regression-tested: 19 positives match and 18 negatives do not, including Gailtalbahn, Gaildorf, Limoges, Hawkar Group, Bakkar Group, Sonelgaz, bare Petronas and Credit Suisse. Rejected on measurement rather than taste: \baramco\b, dana gas and a Tunisian operator buy 0 ways today; \bptt\b buys 1 way while "PTT" has 1 347 OSM objects (the Turkish post); pertamina/pgn sit south of the equator. Run 2026-09-19, 352 s, one 504 on tile [0,20,34,52] that the existing 3-attempt retry absorbed: 18 378 → **18 728 features** (8 588 named), 230 203 → **246 965 km**, 7.2 → 7.4 MB, cross-tile duplicates 31 → 46. The six northern tiles returned byte-identical way counts (16 615 / 4 038 / 1 884 / 174 / 130 / 0), proving the cache was reused; they yielded 18 380 features, i.e. **+2** from the new operator rules catching Sonatrach and NIGC north of 34°, so nothing was lost. Scene frames measured over the new snapshot: **hormuz 0 → 24**, **malacca 0 → 10**; suez, bab-el-mandeb and panama stay at 0. Those three are honest gaps, not build failures — Yemen's Marib–Balhaf line runs near 48° E, outside the bab-el-mandeb frame (41.8–44.6° E); the Arab Gas Pipeline crosses Sinai partly east of the suez frame; and **panama is at 79° W, outside the −12…180° E window entirely — no southern bound can ever reach it** (a prior analysis claimed widening the window would fix Panama; that was wrong, and Panama's canal-side infrastructure is oil anyway). Known bug found in passing, filed rather than fixed here: `diameterMm()` misreads inches, so '24"' becomes 24 mm and a 48-inch trunk is discarded as sub-150 mm.

- **Gas pipelines — first real performance measurement (etapa 0 before the Middle East / oil extension)** (2026-09-19). Every earlier budget was arithmetic over Cesium's source; these are measured numbers. Rig: NVIDIA GeForce GTX 1080 Ti (ANGLE D3D11), canvas 1120×844, devicePixelRatio 1, production build on oko.uhrin.digital with the Cesium ion photoreal fallback (the direct Google endpoint 403s, ion serves — 526 tiles with content ready, 214 selected, 33 MB textures, so ground-clamped lines DO have a surface to classify against). Method: Cesium's own loop stopped (`viewer.useDefaultRenderLoop = false`), `requestRenderMode = false`, 5 warm-up renders, then 40 × `scene.render()` + `gl.finish()` so GPU work is included — rAF fps is useless here because it is vsync-capped at 60 and would report "60 vs 60" for any change under 16.7 ms. Measured from a FRESH page load with the layer never enabled, then again after enabling; an earlier attempt that toggled the layer off for its baseline was invalid, see the finding below.
  **Frame cost (p50):** central Europe at 600 km nadir **2.1 → 3.1 ms (+1.0 ms)**, 55 → 59 draw commands; whole planet at 20 000 km **1.0 → 1.1 ms (+0.1 ms)**, 24 → 28 draw commands. 18 378 entities cost FOUR extra draw commands, because `clampToGround` batches every `ColorMaterialProperty` into one `GroundPolylinePrimitive` regardless of colour.
  **Build cost:** 748 ms one-shot from `setEnabled(true)` to 18 378 entities present — a visible freeze, and the number that grows worst when the network doubles.
  **Memory:** heap 123 MB → 750 MB peak during the build, settling to **429 MB** once the build garbage is collected, i.e. **≈307 MB steady** for one network, 10.2 % of this machine's 4 192 MB heap limit.
  **Finding — disabling the layer frees nothing.** After `setEnabled('gas-pipelines', false)` all 18 378 entities stay resident and the heap does not drop; the toggle only hides. So the memory is paid once per session at first enable and never returned, and any A/B measurement that uses "layer off" as its baseline is measuring hidden-but-built geometry, not absence.
  **Verdict for the extension:** frame time is NOT the blocker the plan assumed — doubling the network lands near 4 ms at 600 km, far inside a 16.7 ms budget. The real costs are the ~300 MB per network and the sub-second build freeze, both of which roughly double. Staging can therefore proceed in the planned order (data first, fragment merging last) instead of pre-empting with a renderer rewrite. Caveats: one GPU, one window size, ion fallback rather than direct Google tiles, and a generous 4 GB heap limit — a weaker machine has less headroom.
- **Gas panel, stage 7: the ZDROJE DODÁVOK card — the EU's daily supply mix by origin from ENTSOG entry points plus LNG send-out, no new request** (2026-09-13, user: „pokračuj ďalej"). The flows catalogue in `src/data/gasFlows.js` gained a third group `west` (11 point-directions verified live on ENTSOG TP: Dunkerque/Franpipe FR-TSO-0003 ITP-00045, Zeebrugge ZPT ITP-00106 and IZT ITP-00061 (BE-TSO-0001), Dornum/NETRA DE-TSO-0009 ITP-00126, Emden EPT1 DE-TSO-0005 ITP-00081, Nybro/North Sea Entry DK-TSO-0001 ITP-00630, Bacton BBL UK-TSO-0004 ITP-00207, Almería/Medgaz ES-TSO-0006 ITP-00048, Mazara/Transmed IT-TSO-0001 ITP-00093, Gela/Greenstream IT-TSO-0001 ITP-00074, Tarifa exit ES→MA ITP-00082) and every point an `origin` (NO, DZ, LY, AZ, UK, RU = TurkStream and the idle northern routes, RU-UA = the Ukrainian transit routes, null = not part of the mix: intra-EU, storage, exports, Kaliningrad transit, Ukraine's own entries). Discovery lessons: Dornum is published by OGE (ITP-00126 and 00525) and GUD (ITP-00188) with identical numbers, Emden EPT1 by GUD and Thyssengas likewise — each landing is counted once; Emden NPT (ITP-00210) and Zeebrugge IZT entry publish nothing useful; Kipi (ITG) is 0. `src/data/gasSupply.js` (pure): `supplyPoints()` joins payload points with the catalogue origin (the proxy cache may still carry the old point shape for an hour), `supplyDays()`/`alignSeries()` build a 31-day axis with a missing day forward-filled for up to 3 days, `buildSupplyModel({ flows, lng })` sums GWh/d per origin, adds the EU LNG send-out from the ALSI payload as its own layer, picks the last „complete" day (≥ 70 % of active sources reported) so the chart never ends in a fake dip, and returns headline (GWh/d, ≈ mcm/d at 10.55 kWh/m³, top-four shares, „hlási n z m zdrojov"), stacked layers, legend rows (value, share, 7-day average, points reported of points in the origin; origins without a single reporting point are „bez dát", not zero), note and the ENTSOG 5.2 citation + GIE ALSI line. Card `supply` sits right after TOKY in `src/gasPanel.js` and re-renders whenever the flows or LNG card renders (`renderLegend()` is now shared with DOVOZ, `paintStacked()` takes `withYear`). Live 11 Sep 2026 (proxy payloads through the same model): 6 765 GWh/d ≈ 641 mcm/d — LNG 46 %, Norway 31 % (2 122 GWh/d over 4 of 5 landings), Algeria 11 %, Russia via TurkStream 5.6 %, Azerbaijan 4.2 %, UK 1.9 %, Libya 0.1 %, Russia via Ukraine 0; 14 of 19 sources reported. The TOKY card now lists 43 directions in three groups and the `gas-flows` globe layer 31 stations (Zeebrugge ZPT + IZT fold into one). Tests: `gasSupply.test.mjs` (catalogue origins, axis/fill, model incl. complete-day fallback, no-LNG, empty), catalogue/model/layer counts updated (43 / 31 / 30 compact cards), panel test (card order, headline, legend, error path, i18n tripwires; the fake DOM now clears children on `textContent = ''` like a real one — the legend re-render had doubled rows).
- **Gas panel, stage 8: the LNG TANKERY card — LNG carriers within AIS range, from this session's AISStream store plus a Wikidata allowlist** (2026-09-13, user: „pokračuj"; the agreed „LNG flotila cez AIS"). Honest scope first: AISStream is terrestrial AIS (~40–60 km from the coast), so ships at sea are invisible and ships near terminals and ports are not; AIS carries no „LNG" ship type (80–89 is any tanker). So `scripts/build-lng-fleet.mjs` pulls every Wikidata item that is an LNG carrier (Q15247) with an IMO number (278 ships, 193 with MMSI — about a third of the world fleet; CC0; bundled in `src/data/local_data/lng_fleet/` with `SOURCE.md`) and `src/data/lngFleet.js` (pure, shared with the server) classifies a contact as **confirmed** when its IMO or MMSI is in that list, **likely** when the AIS type is tanker (or unknown) and the name belongs to an LNG-only fleet (`LNG_NAME_STRONG_RE`: LNG, GasLog, Maran Gas, Methane, Golar, FSRU, Energos, Dynagas „Clean …", Yamal Arc7 names…) or the ship is ≥ 250 m with a weaker fleet prefix (`LNG_NAME_WEAK_RE`: Flex, BW, Seri, Grace, Arctic, Puteri, Cesi, Al …, Knutsen, Höegh…) or a terminal-specific destination (`LNG_TERMINAL_STRICT_RE`: Świnoujście, Klaipėda, Gate, Wilhelmshaven, Montoir, Sabine, Ras Laffan… — generic ports such as Rotterdam or Barcelona only feed the „→ EÚ" flag via `LNG_EU_TERMINAL_RE`, never the classification); known non-tankers never qualify. The first live minutes taught two negatives now pinned in tests: MINERVA PELAGIA (a 250 m crude tanker matched by a fleet prefix — Minerva, Energy, Pacific, SK, Stena, Sonangol and bare Knutsen were dropped from the weak list, Knutsen's LNG hulls are named explicitly) and ATLANTIC MAJESTY bound „NLRTM>LYMEL" (a generic port matched as a terminal).
- **Oil pipelines ride the gas layer, in their own colour** (2026-09-19, stage 2 of the pipeline plan, user: „potreboval by som doplniť plynovody do Blízkeho východu a ropovody všade kde som dal aj plynovody"). A second Overpass snapshot — `scripts/build-oil-pipelines.mjs`, the same 12 tiles, `substance=oil|crude_oil|petroleum`, 2 599 segments / 77 962 km — served from `.gev-cache/oil/` through `/api/oil/pipelines` (+ `/meta`) and drawn by the SAME layer `gas-pipelines` (the 36 layer tokens are exhausted, so oil rides inside token `0`). **Kept as a separate database on purpose:** merged into the gas file it would be a *Derivative Database* under ODbL, while two databases side by side are a *Collective Database* exempted by §4.5(a). In the layer, oil is **optional** — it is fetched after gas and its failure is only logged, so a machine where the oil build has not run yet (404 `no_snapshot`) still draws gas exactly as before. Colour: orchid `#eab2ff`, 48.9 dE2000 from the gas amber, 36.2 from the red border fence and 41.9 from the cyan shipping lanes (under deuteranopia 53.4 and 50.6) — amber was unusable even as a shade, because the tanker hull `#ffb347` and the scene pin `#ffb547` already sit 1.5–2.3 dE from the gas `#ffb14d`. **Colour is not the only channel:** the card names the substance in WORDS on the first line of BOTH layers (`PLYNOVOD · zemný plyn` / `ROPOVOD · ropa (surová)`) plus the raw `substance=` tag from OSM; giving the header to oil alone would teach „card without a header = gas". The chip adds the two snapshots up — kilometres summed (otherwise it would claim fewer than are drawn) and the OLDER of the two dates, because „the data is at most this old" has to hold for both substances. Two defects fixed on the way: the inch parser in `scripts/lib/pipelineTags.mjs` (`24"` was read as 24 mm and the way then failed the 150 mm floor — +12 segments, impossible diameters 65 → 3) and `usage=flowline|flare_header|collection` on the oil side (738 gathering ways excluded; the same gap on the gas side is closed too, without changing its output). **A third defect was found on the live layer right after this** (21 368 drawn segments, `kinds` gas 18 769 / oil 2 599 against a 2 628-segment oil snapshot): a `relation[route=pipeline]` carries `substance` on the relation, but its member ways carry their own, and `makeClassifier` admitted every member unconditionally — so 29 of 2 628 oil segments were not oil (20 × `fuel` refined products, 3 × `naphtha`, 3 × `hydrocarbons`, 3 × `gas`), exactly what the query and DATA_SOURCES.md both claimed to exclude, and they rendered in the GAS amber inside the oil dataset. `makeClassifier` now takes `substanceRe` and checks the way’s own `substance` FIRST, before `usage=transmission` and before relation membership; oil rebuilt to 2 599 / 77 962 km with nothing but `oil` left, gas given the same guard (`gas|natural_gas|cng`) with its 18 740 segments unchanged). Voice: „ropovody / ropovod / oil pipelines" alias to the same layer — the Realtime tool schema is pinned byte-for-byte, and no new enum value is needed because the layer id did not change. Stage 3 followed the same day (below), then stage 3b.
- **Pipeline chips PLYN / ROPA and a hover card with the live flow** (2026-09-19, stage 3, user: „pri prechode myšou cez rúru chcem vyskakovacie okno s názvom rúry plynovodu ropovodu a keď sa dá aj reálne dáta koľko tečie a kam"). **Chips:** `gas-pipelines` moved from `enabled-only` to `enabled+options` (owner `gas-pipelines`, options `gas` / `oil`, tokens `g` / `o`, both default AND absent = on, so `v=2&l=0` keeps meaning „everything the layer draws" and `lo=0.o.0` is gas only); each substance lives in its own `CustomDataSource` (`gas-pipelines`, `gas-pipelines-oil`) so a chip is one `show` flip, not a loop over 18 000 entities; `setParams` hides the source, drops a selection that belonged to the hidden substance and closes the hover; `getRowControls` renders the two chips plus a legend with per-substance counts and colours (`PLYN 18.7K · ROPA 2.6K`), re-rendered through `setRowControlsListener` once the snapshot has loaded. Verified live: clicking ROPA wrote `lo=…_0.o.0` into the hash and `{gas:true, oil:false}` into `gev:layer-state:v2`. **Hover:** `pointermove` on the canvas → 80 ms rest → `scene.pick(pos, 7, 7)` (a 1.4 px ground line is never hit by the default 3×3 pick) → `src/data/pipelineHoverCard.js` (pattern of `earthquakeHoverCard.js`: DOM without innerHTML, placed at the cursor, scrollable, stays while the cursor is inside so the OSM link is clickable, closed by ×, Escape, pointer leave after 220 ms, pointerdown, `camera.moveStart`). The card shows substance in words, name, operator, DN, segment length, **route `from → to`, `capacity` and `pressure`** — new snapshot properties inherited from the OSM route relation (`scripts/lib/pipelineSnapshot.mjs`, both snapshots rebuilt from the raw cache: gas 8.4 MB, oil 1.3 MB) — status and the `openstreetmap.org/way/<id>` link with the ODbL notice. **Live flow, honestly scoped:** ENTSOG publishes physical flows per BORDER POINT, not per pipe, so `src/data/pipelineFlowLinks.js` is a hand-written table tying pipeline NAMES to points already in the `gas-flows` catalogue (Nord Stream 1 → Greifswald OPAL + NEL, never NS2; OPAL / EUGAL → OPAL; TAP and TANAP → Kipoi; TurkStream → Strandzha 2; Trans-Balkan → Strandzha 1 + Isaccea; Franpipe, Zeepipe, Interconnector, Europipe, NETRA, BBL, Baltic Pipe → Nybro, Medgaz, GreenStream, GME by its Arabic OSM name; Urengoy–Pomary–Uzhhorod → Sudzha + Veľké Kapušany, Soyuz/Progress → Veľké Kapušany; the PL–SK interconnector → Výrava; eustream by operator → Baumgarten + Lanžhot exits) — every id is checked against the catalogue at module load, at most 4 points per pipe, and a name with no point in the catalogue (Yamal–Europe, TAG, Langeled, Statpipe) gets „bez živého toku" instead of a number from somewhere else; oil always gets „živé toky ropy nie sú verejné". The layer fetches `/api/gas/flows` lazily on the first hover of a tied pipe and keeps the payload 30 min (the proxy caches 1 h); the card prints the point, its `from → to`, the D−1 value in GWh/d and ≈ mil. m³/d, the gas day, provisional/confirmed, the point note and the ENTSOG TP citation required by their T&C 5.2. Verified live over TAP near Kipoi: „Kipoi (TAP) · TR → GR · 14,1 GWh/d ≈ 1,3 mil. m³/d · 19. 9. · predbežné" with the citation. Tests: `pipelineFlowLinks.test.mjs` (every id exists, unions, NS2 ≠ NS1, oil never), `pipelineHoverCard.test.mjs` (model + DOM over a fake document, late flow for another pipe is dropped), layer tests for chips/params/two sources and the hover choreography with injected timers, `layerState.test.mjs` round-trip of `0.o.0`.
- **Pipelines 3b: borders back, Latin names, richer OKO-style cards with flags** (2026-09-19, user: „hranice si vyhodil, niektoré názvy sú v azbuke a informácie v kartičkách vyžmíkaj viac aj s vlajkami, style OKO"). **Borders:** `countryBoundaries` was a scene-only overlay — shown by a chokepoint scene, never outside one — so the pane looked border-less as soon as the verification left `?chokepoint=`. It now has holders (`retain(owner)` / `release(owner)`; `show()`/`hide()` are the scene’s holder) and `main.js` retains `gas-pipelines` while that layer is on (`dataManager.subscribe` on `visibility` + a seed from `isEnabled`), so pipelines always come with borders and a scene ending never takes them away from the layer. **Latin names:** OSM carries `name:en` for only ~3 % of the 5 875 Cyrillic-named gas ways, so `src/data/latinize.js` transliterates Cyrillic (RU/UK/BE/KK/BG/SR letters, simplified BGN/PCGN, shouting words stay upper-case); the snapshot now records the name language when `name:uk`/`name:ru`/`name:be`/`name:kk` equals `name` (199 gas + 134 oil features) so Ukrainian gets г → h / и → y; without a hint, Ukrainian-only letters (є ї і ґ) decide and everything else falls back to Russian — an honest limit, stated in the module. `pipelineDisplayName` prefers `name:sk` → `name:en` → `int_name` → transliteration → `name` → `ref`, keeps the original script for a second line, and `pipelineOperator` does the same for operators (2 489 Cyrillic); Arabic, Persian and CJK names are not transliterated (without a dictionary that would be noise) and stay as mapped unless `name:en` exists. **Flags:** a way carries no country, so `scripts/lib/pipelineCountries.mjs` computes each segment’s ISO2 list at build time by point-in-polygon over Natural Earth 1:50m admin-0 countries (fetched once into `.gev-cache/natural-earth/`, public domain, never shipped): 18 498 / 18 740 gas and 2 563 / 2 599 oil segments got countries, 170 + 47 cross a border and list both in order along the segment. **Cards:** the hover card was restyled in the contact-card idiom (mono, glass, 2 px left border in the substance colour, 12×9 flags) and now shows substance, Latin name + „v origináli" line, operator (+ original), the segment’s countries as flags + names in the UI language (`regionDisplayName`), DN · segment length · route `from → to` · capacity · pressure (bare numbers get „bar" per the OSM wiki) · placement (`location`) · status, the live-flow block with flags for the ENTSOG point’s `from → to`, the D−1 value, ≈ mil. m³/d, the gas day, provisional/confirmed, the 7-day average and a 14-day sparkline (`drawSparkline` from `gasChart.js`), and a footer with the OSM way link, ODbL, the snapshot date (rule 2) and the click hint; the click card got the countries and placement lines and the Latin operator. Verified live: Urengoy–Pomary–Uzhgorod hovered as „Urengoy — Pomary — Uzhgorod / v origináli: Уренгой — Помары — Ужгород", flags RU · UA, borders drawn with the layer on. Tests: `latinize.test.mjs`, `countryBoundaries.test.mjs` (holders), model/DOM tests for names, countries, flags and the snapshot footer, `gasPipelines.test.mjs` for display names, operators, placement and the click-card lines, a `main.js` tripwire for the retain/release wiring.
- **Pipelines stage 4 — visibility I: measured widths, outlines, distance gating, cheap selection** (2026-09-19, user: „Etapa4"; the plan’s stage 4 as agreed on 2026-09-18). **Measured first**, on the photoreal stack with the default `sharpen` post-process on, nadir from 42 km, ten test ground polylines in a scratch data source and `gl.readPixels` across each: at 1.4, 2.2 and 3 px the whole line clips to 255,190,255 (the sharpen halo eats every pixel), from 4 px a 2-px core keeps the hue (212,164,228 for orchid), `PolylineOutlineMaterialProperty` DOES render on a clampToGround polyline (dark rim pixels found — nobody had run this before), `PolylineDashMaterialProperty` with a dark `gapColor` too, and `distanceDisplayCondition` works per ground-polyline instance (a line with far = 5 km did not draw from 42 km, its twin with 5 000 km did). **Widths** (`PIPELINE_WIDTHS`): trunk DN ≥ 900 → 6 px, main DN ≥ 500 → 5, minor → 4, stub (no trunk diameter and < 2 km) → 3, the same for both substances (width keeps meaning diameter); solid lines carry a 1 px `#0b0f14` outline at 0.7 (`PIPELINE_OUTLINE`), planned lines keep the dash and get the same dark colour as `gapColor` because outline and dash are two materials that cannot combine. **Distance gating** (`pipelineDisplayCondition`): 52.8 % of segments are two-point stubs and 42.3 % are under 1 km, so < 1 km hides beyond 300 km, < 5 km beyond 1 200 km, < 20 km beyond 4 000 km, ≥ 20 km never (trunks are built of those), unknown length never; a per-instance attribute, so batching is untouched. **Selection** is now ONE entity in its own `gas-pipelines-selected` data source (`pipelineSelectedStyle`: white, +3 px, darker outline, never gated) — before, a click rewrote the base entity’s width and material, which rebuilt the whole ~770 k-vertex batch twice (the freeze measured in stage 0). **classificationType** stays `BOTH` on purpose rather than following the base map like the cables: switching it rebuilds 21 000 entities (~750 ms) for a saving under 1 ms per frame, and BOTH is visually right on both regimes (tiles when the globe is hidden, terrain otherwise). **Guard**: `defaultGroundSupport` wraps `GroundPolylinePrimitive.isSupported`; without depth-texture support the layer draws the same lines 200 m above the ellipsoid, not clamped (an admitted degradation — under the Zagros that is underground — printed into the layer source line, rule 2). Tests re-derived for the new widths, outline material, gating, the separate selection source and the fallback path.
- **Pipelines stage 5 — visibility II: fence in the middle band, ghost through terrain up close** (2026-09-19, user: „pokračuj autonómne"; the plan’s stage 5). **Fence:** operating trunk and main segments (DN ≥ 500 — 3 280 gas + 299 oil = 3 561 entities) carry a `wall` on the SAME entity as the line (so the substance chip hides both): a translucent curtain in the substance colour from the ellipsoid up to **7 000 m** with a brighter top edge, gated to camera distance **200–1 100 km** (`PIPELINE_FENCE`, `pipelineFenceSpec`). It is deliberately a third of the border fence (18 667 m, 300–1 300 km) and a different hue, so the two never merge over Hormuz; 7 km still pokes above the Zagros and the Iranian plateau, in lowlands it is a 7-km ribbon. Planned and disused lines and stubs get no fence. Measured at 700 km over the Gulf: +1.5 ms per frame for the whole layer with fences on (8.3 vs 6.8 ms). **Ghost:** below 250 km the ground line hides behind ridges, so a bounded cohort (`selectGhostCohort`: nearest first, no stubs, ≤ 60 segments / 600 vertices) gets a STATIC polyline in its own `gas-pipelines-ghost` data source whose normal material is transparent and whose `depthFailMaterial` is a dashed line in the substance colour at 0.55 — it draws ONLY where terrain occludes it (the trap from the plan: `depthFailMaterial` is silently dropped for CallbackProperty entities, so these are constants). Heights per vertex come from the shared **`terrainHeights.js` resolver** (`/api/terrain/heights`, Re:Earth, disk-cached, batched 200 points, in-memory cache) plus 3 m, cached per segment with a 5-minute retry on failure; the cohort is recomputed 250 ms after `camera.moveEnd`, a newer cohort discards a stale sampling by token, and a substance chip or the layer switch drops the ghosts with it. **Two sampling paths were tried and rejected on the way, both recorded in the module:** `scene.sampleHeightMostDetailed` forces the most detailed 3D tiles to load for every sampled point across 250 km — thousands of photoreal tile requests (quota) and in the pane it never completed; `Cesium.sampleTerrain(viewer.terrainProvider)` is useless on the photoreal stack because the globe is hidden and the provider is the flat `EllipsoidTerrainProvider` (heights 0 = the plan’s trap 1). Tests: fence spec and cohort selection (pure), the layer choreography with injected timers and a fake sampler (one sampling per segment, cache on repeated moveEnd, empty cohort above 250 km, chip hides the ghost, disable detaches the camera, destroy removes four sources), and the no-resolver path (fence and lines only).
- **Pipelines stage 6 (as far as it earns its keep): a click selects the whole route, not a 900-m stub** (2026-09-19, user: „pokračuj autonómne"; the plan’s stage 6 was „merge fragments by relation/name/operator + tile the sources for culling", conditional). 52.8 % of segments are two-point stubs, so the snapshot now records the OSM `route=pipeline` **relation id** of every member way (gas 2 243 segments in 112 relations, oil 1 001 in 50; largest relation 141 segments) and `pipelineGroupKey` groups by that relation, else by normalised name + operator, refusing names under 4 characters and a list of generic words („лупинг" = loop, „Нефтепровод", „gas pipeline", „خط لوله گاز"…) that would otherwise glue hundreds of unrelated pieces across a country; a name group over 120 segments is treated as generic too, and a group of one is no group. The layer builds the index once after load; a click renders the WHOLE group in the selection source (clicked segment first, capped at 300 entities), and both the click card and the hover card get a „celá trasa: N úsekov · X km" line from `pipelineGroupSummary`. **Deliberately not done:** merging fragment geometries into one entity and tiling the data sources per substance × tile — stage 0 measured frame time as a non-issue (+1.0 ms for the whole network, +1.5 ms with fences), so the culling half of stage 6 would cost a snapshot rewrite for no measurable gain, and merged geometries would break the per-segment attributes (diameter, pressure, from/to) the cards show. Tests: group keys and summary (pure), the layer click selecting three relation members in clicked-first order, a lone segment, a generic-name pair, and the hover receiving the summary.
- **Local markers pop up on hover — ports, airports, datacenters, dams** (2026-09-19, user circled a dark dot sitting on an oil pipeline north of the Sea of Azov: „tam kde som označil daj X alebo aj tie uzly sprav vyskakovacie"). The dot was the port of **Mariupol** (WPI 44010, layer `local-ports`): from a continent away the label tiers reduce a marker to a bare dot, so it read as a pipeline node. `createLocalGeoJsonLayer` now has the same hover choreography as the pipeline layer (pointermove → 80 ms → `scene.pick(pos, 7, 7)` → only this layer’s `__localLayerId` → `src/data/localHoverCard.js`, closed by ×, Escape, pointer leave after 220 ms, pointerdown, `camera.moveStart`; detached on disable, destroyed on destroy; injectable `hoverFactory`, `hoverTimers`, `translate`; `hover: false` opts out). The card shares the OKO hover-card CSS (`.pipeline-hover-card.local-hover-card`, `data-kind` = layer id without `local-` → teal ports, magenta airports, cyan datacenters, blue dams) and shows the layer name + source as the kind line, the title with a flag, the same detail lines the click card uses (`localInfrastructureOverlayCopy`, tier `full`) and a footer „NGA WPI · klik = karta a prílet k miestu". Ports gained a title flag: WPI carries the country NAME („Ukraine"), not a code, so `portTitleFlag` goes through `countryIso2FromName` (unknown names, e.g. „Korea, South", stay flagless). Verified live over Mariupol from 150 km: „Prístavy · NGA WPI / 🇺🇦 Mariupol / UAMPW · SMALL · COASTAL (BREAKWATER) / CH 6.4M · Ukraine". Note: a marker hidden by its label tier is not pickable, so from very far the hover has nothing to hit — by design, the dot is not drawn there either. Tests: `localHoverCard.test.mjs` (model + DOM), `localGeojsonHover.test.mjs` (layer choreography with a loaded port feature), `portTitleFlag.test.mjs`.
- **Pipeline fence switched OFF; pipeline work handed over** (2026-09-19 evening, user at ~400 km over the stage-5 result: „oprav ešte aj potrubia majú ploty" — the 7-km walls with an outline on each of 3 561 short segments read as a chain of little boxes along the line, not a ribbon). `PIPELINE_FENCE.enabled = false`: no entity carries a `wall` any more (the border fence is a different module and stays), `pipelineFenceSpec` keeps the mechanism behind an explicit `{ enabled: true }` for a future return — which should drop `outline` (the vertical edges at segment ends are the „posts") and build one wall per route rather than per segment. The outlined 6/5/4/3-px lines of stage 4 stay readable from an oblique angle without it. **Everything about the pipeline work — where things live, how to rebuild the snapshots, how to publish from a clean HEAD export while another agent’s uncommitted work sits in the tree, what was measured, the decisions and their reasons, the traps, the open list and the commit chain — is written up in `docs/drafts/potrubia-stav-a-plan.md`** (Slovak, the same shape as the meteorology plan draft) so the work can be resumed from the repository alone.
- **UKRAINE module, stage 1 — base map and front directions** (2026-09-19, user: „pokračuj etapou 1" after the plan and source survey in `docs/drafts/ukrajina-plan.md` / `ukrajina-zdroje-prieskum.md`). A SECOND standalone scene overlay, like `countryBoundaries.js` — the `lo=` token space is full (36/36) and `finalizeRegistrations` rejects a manager layer without a token — so nothing here is a data-manager layer or a share-link token: `src/data/ukraineBaseLayer.js` (impure) + `src/data/ukraineBase.js` (pure) draw the OpenStreetMap snapshot built by `scripts/build-ukraine-base.mjs` (library `scripts/lib/ukraineBase.mjs`): 1 442 cities/towns as ground-clamped points + labels (`heightReference: CLAMP_TO_GROUND` clamps to terrain AND 3D Tiles in Cesium 1.124, `disableDepthTestDistance: ∞` so a hill never hides a name; label text is `name:en`, otherwise a BGN/PCGN transliteration through `latinize.js` with the snapshot’s language hint, cities uppercase), 27 973 villages fetched lazily below 260 km and drawn as a cohort of ≤ 1 800 nearest the view centre (recomputed 250 ms after `camera.moveEnd`), 11 353 chained road lines (motorway…secondary, 3.2/3.0/2.4/1.8 px, class-specific `distanceDisplayCondition`, `clampToGround` + `ClassificationType.BOTH` like the pipelines), 2 257 river lines (≥ 30 km; rivers ≥ 200 km get one italic label), 27 oblasts as dashed borders + uppercase labels visible between 260 and 3 200 km; four `CustomDataSource`s so the panel chips PLACES / ROADS / RIVERS / OBLASTS are one `show` each. Label declutter after the camera settles: one label per 118 × 26 px grid cell, importance = class + log₁₀(population), projected with `SceneTransforms.worldToWindowCoordinates` (labels already beyond their display distance do not occupy a cell). Hover card via `localHoverCard.js` (kinds `ukraine-places` / `ukraine-rivers` / `ukraine-roads`, own foot text „klik na sídlo = prelet k nemu" instead of the local layers’ „klik = karta") with Latin name, original, population, „OpenStreetMap · snapshot <date>"; left click on a place flies to it (45 / 22 / 9 km by class, pitch −48°, from the south). Proxy `ukraineBaseProxy()` in `vite.config.js` streams `.gev-cache/ukraine/base/{meta,places,villages,roads,rivers,oblasts}.json` with ETag + gzip, 404 `no_snapshot` before the build; the client versions the dataset URLs with `?v=<snapshot>` and fetches `meta` with `cache: 'no-cache'` — `force-cache` on an `/api` route had returned Vite’s cached HTML fallback forever (a content-type guard now rejects non-JSON). Panel **UKRAJINA** (`#ukraine-panel`, lane order 9, body by `src/ukrainePanel.js`, share token `u` in `sharelink.js`, mobile drawer tab DÁTA, cockpit-entry collapse list) shows the snapshot date and counts, the base toggle, the four chips and 12 front-direction presets from `src/ukraineFrontScenes.js` — whole front + 11 directions named after the Ukrainian General Staff daily report of 2026-09-19 (Sumy/Kursk, Vovchansk, Kupiansk, Lyman, Sloviansk–Kramatorsk, Kostiantynivka, Pokrovsk, Oleksandrivka with an approximate anchor, Huliaipole, Orikhiv, Kherson), each an oblique south→north framing (−58°, whole front −70°) applied LAST after the base is shown; triggers `?front=<id>`, `#front-select` in the SCENES panel, `window.__godsEyeView.frontScenes.apply(id)`; the overlay holds `countryBoundaries` as holder `ukraine-base`. Honesty: the panel says in words that territorial control, events and news are stages 2–4 and that nothing on the base map is a front line; every status and card carries „OSM snapshot <date> · ODbL · static". **Traps found on the way:** the Overpass mirror overpass.kumi.systems has no area data, so `(area["ISO3166-1"="UA"])` returned 0 rivers for a whole tile and the build had cached that as valid — the queries now use a `poly:` filter from the Natural Earth 1:50m outline (which itself EXCLUDES Crimea, de facto POV → a Crimea bbox is added) and an empty answer is a failure that is never cached; overpass-api.de answers 429 when heavy queries follow faster than ~30 s; `out body geom` returns whole ways even with a global bbox (213 points outside the tile in the first roads tile), so de-duplication by way id is enough and the merge by node id is only a safety net; in the Browser pane the Google 3D tiles are 403 and the ion token 401, so the check ran on the OSM stack, `camera.flyTo` stalls there (the front-scene flight was verified with `setView` + unit tests only), synthetic `PointerEvent`s do not reach Cesium’s handler (a real pane hover does) and `zoom` is unsupported. Measured in the pane: 2.6 MB gzip for the four eager files, 1.3 s load + entity build, declutter kept 444 of 3 242 labels at 159 km over Lyman. Tests: `scripts/lib/ukraineBase.test.mjs`, `src/data/ukraineBase.test.mjs`, `src/data/ukraineBaseLayer.test.mjs`, `src/ukraineFrontScenes.test.mjs`, `src/ukrainePanel.test.mjs`; `panelLaneCss.test.mjs` covers the new panel automatically. Not published yet (the tree still carries the meteorology agent’s uncommitted work).
- **UKRAINE module, stage 2 — General Staff report, open-source news, EU media blocklist** (2026-09-19, user: „Fáza 2"). Three new things, all behind the UKRAJINA panel and the front-direction presets. (1) **General Staff daily report**: `ukraineReportProxy()` (`/api/ukraine/report`) reads the ArmyInform tag feed (Ministry of Defence agency, CC BY 4.0, mandatory link), fetches the newest article (the feed carries only an excerpt; `wp-json` is disallowed by robots.txt) and hands `div.single-content` to the pure parser `src/data/ukraineReport.js` — total clashes, „станом на 08:00 19 вересня" → Kyiv-local ISO, strikes (missiles, air strikes, guided bombs, kamikaze drones, shellings), and per-direction paragraphs with the attack count (numbers, Ukrainian number words, „тричі", „один раз", „— 29", explicit „не проводили" → 0, unknown → null); `reportByScene` folds two GS directions onto one preset and counts a shared paragraph once. Cache 30 min in memory + disk, stale up to 24 h, single-flight, limiter. The overlay `src/data/ukraineReportLayer.js` (standalone, shown with the base map, chip STRETY is its switch) puts a crossed-swords billboard + count label (colour by intensity: 0 grey, 1–9 light, 10–24 amber, 25+ red) at each preset centre — anchors are settlements, never units — with a hover card (direction, attacks, report time, the Ukrainian paragraph, a MyMemory uk→sk translation swapped in when it resolves, and the „one-sided official report" line) and a click that opens the report. The panel shows the report card (summary, strikes, claim line, link) and a count badge on every direction button. (2) **Open-source news for region `ukraine`** in `SITUATION_REGIONS`: GDELT query with `sourcelang:english`, Google News fallback, and eight direct feeds carrying per-source rules through `normalizeDirectFeed` — `unfurl` (og:image only where terms allow: BBC topic „War in Ukraine", Kyiv Independent), `drop` (Ukrainska Pravda items citing Interfax-Ukraine), `badge` (Ukrinform/ArmyInform „official UA"), `limit` per feed (the two Ukrainian agencies alone filled the whole top 40 and pushed BBC/RFE/RL/DW out) and `googleLimit`; the shared RSS parser now accepts `<item rdf:about>` (DW), `dc:date`, `media:content`/image enclosures and a description. One pinned ISW row (title + link, existence checked by one HEAD per date per 6 h, nothing else taken). `noImage` and `badge` flow through `buildIncidents` → hot cards and the bulletin; the bulletin takes a `regions` list (one region = no chips) and classifies/locates per region; the UKRAJINA panel mounts its own bulletin instance; a front scene now also arms the reveal gate and shows the `ukraine` hot cards. Region policies in `gulfIncidents.js`: `gazetteerForRegion`, `classifyIncident(text, {region})` (Ukrainian rule set in `ukraineIncidents.js`: naval and air-defence before strike, infrastructure only with an action word, `unless` for „shot down … but hit"), `REGION_DEFAULT.ukraine = null` — an unlocated item gets no marker. (3) **EU media sanctions blocklist** `src/data/sanctionedMedia.js` (Annex XV outlets up to the 16th package + Rybar under Annex I, domains and subdomains, `t.me/rybar`), applied in the proxy before merging and again in `buildSituationModel`; TASS is not listed and not ingested (owner’s question 4 pending). `translateProxy` accepts `from=uk` (cache key unchanged for `en`). **Traps:** `\b` in a JS regex never matches before Cyrillic — the parser found every count but not a single direction until the boundary became a lookbehind (the first live proxy answer had `directions: []` and cached it); the extractor’s stop line („Gemini ChatGPT …" share buttons) has no Cyrillic in the fixture and slipped past the Cyrillic filter until the stop check moved first; editing a config dependency restarts Vite and reloads the page mid-verification. Measured live 2026-09-19: report parsed in ~1 s with 15 directions / 213 clashes; the feed built 40 items (Kyiv Independent 7, Ukrainska Pravda 13, Ukrinform 18, Al Jazeera 1, ISW 1) before the caps; 4 hot cards over the front, 11 markers. Tests: `sanctionedMedia.test.mjs`, `ukraineIncidents.test.mjs`, `ukraineReport.test.mjs` (real report text of 2026-09-19 as fixture), `ukraineReportLayer.test.mjs`, plus additions in `ukrainePanel.test.mjs`, `conflictBulletin.test.mjs`, `situationNews.test.mjs`. Not published yet.
- **UKRAINE module — ground clamping removed after a CPU complaint** (2026-09-19 night, user opened `?front=lyman` on the photoreal stack: „strašne vysoké hodnoty CPU", one Edge renderer at ~4.5 cores). The base map had put `heightReference: CLAMP_TO_GROUND` on every settlement point and label (1 442 cities/towns + up to 1 800 villages + 69 river/oblast labels) and on the 11 clash markers; on Google 3D Tiles that registers a height callback per entity and every streamed tile re-runs them — exactly the cost the local infrastructure layers already avoid with their own bounded sampling. Now `ukraineBaseLayer.js` and `ukraineReportLayer.js` create entities without a height reference and lift them ONCE through the shared `/api/terrain/heights` resolver (`defaultTerrainSampler`, Re:Earth DEM, 200-point chunks, server disk cache — the first load over the whole country takes ~30 s of background requests, later loads are instant), single-flight (`_liftChain`), with a 2-minute back-off when the proxy fails (the point then stays on the ellipsoid, still drawn on top by `disableDepthTestDistance`); villages are lifted per fresh cohort. The front framing is also steeper (−64°, whole front −72°, was −58/−70) so the horizon view no longer streams the far tile set. In the Browser pane the app idles at 0 fps with everything on (render governor idle), so the remaining load on the user’s machine is tile streaming itself; still unverified there. Tests: `ukraineBaseLayer.test.mjs` (lift batches, retry back-off, no clamping), `ukraineReportLayer.test.mjs`, `ukraineFrontScenes.test.mjs`.
- **UKRAINE module, stage 3 — events backbone, event cards, timeline, photos & video, archive** (2026-09-19, user: „chcel by som to mať ako na obrázku, určite časovú os … všetko čo vieš spraviť tj 1 až 5", then „zdroje a fotky z čo najviac relevantných zdrojov", „aj videá a všetko ukladať aby to bolo v časovej osi"; proposal in `docs/drafts/ukrajina-plan.md`). Replaces the ZÁLIV hot cards for region `ukraine` (those stay untouched for ZÁLIV). **(1) Archive on disk** `.gev-cache/ukraine/events/` (junction → D:), library `scripts/lib/ukraineArchive.mjs` (all I/O through an injected `fetchImpl`, atomic `.tmp` + rename): `viina/<year>.json` (+ `<year>.summary.json` with per-day counts — 2022 alone is 135 810 events / 45 MB, the „since 2022" strip must not read whole years), `geoconfirmed/<day>.json`, `news/<day>.json`, `media/<day>.json`, `reports/<day>.json`; items merge by id/url, empty fields (an og:image found later) get filled, `archivedAt` kept. The Vite plugin `src/data/ukraineEventsProxy.js` (its own module like `earthquakeFeedProxy.js`, registered in `vite.config.js`) runs an **archiver while the dev server is up** (the Scheduler task keeps it up): news every 15 min from its own `/api/situation-news?region=ukraine` (+ up to 25 `/api/link-image` unfurls per tick), media every 15 min (YouTube channel feeds, Telegram previews, ArmyInform mp4), the General Staff report hourly, GeoConfirmed every 6 h as a rolling 90-day window in 30-day pieces, VIINA daily (current year; one past year per tick, monthly) — `UKRAINE_ARCHIVE=off` disables it. `/api/ukraine/events?from&to` (≤ 31 days, gzip, 60 s cache) returns raw events + news + media + reports + coverage; `/summary?from&to` (≤ 1 900 days) per-day counts; `/status` the archiver state. Backfill CLI `scripts/build-ukraine-events.mjs --all` (VIINA 2022–2026 = 318 947 events, GeoConfirmed 90 d = 778, 52 GS reports from the paginated ArmyInform feed, 94 media). No image or video bytes are stored — only links and preview URLs (licences allow previews with a link, not copies; `/api/img` still caches thumbnails 7 d as before). **(2) Pure model** `src/data/ukraineEvents.js`: unified event `{id, t, dayOnly, lat, lon, place, precision, approx, type, sub, severity, level (reported/official/osint), src (viina/geoconfirmed/news/media), actor, civcas, milcas, killed, injured, reports, sources, image, media[], status}`; `viinaClassify` (flag priority: air strike > drone > artillery > hospital > air defence > control/occupy/retreat > armour/firefight/raid > property > IED > civilian > alert > other; sanctions/arrests dropped), `geoconfirmedRowToEvent` with the ethical filter (no `Units`/`OrbatUnits`, no faction „Ukraine", no position descriptions), `newsItemToEvent` (English rules + gazetteer, casualty counts from the headline as numbers only), `attachNews`/`attachMedia` (same day, ≤ 15 km, related type family — a VIINA point gains the headline, photo, hour, sources), `eventsInWindow`, `clusterEvents`, `pickCards` (one card per place + family, approximate points never get a card), `eventCardModel`. `src/data/ukraineMedia.js`: `parseYoutubeFeed`, `parseTelegramPreview` (photo `background-image` URLs, video thumb + count, text without tags, forwards skipped), `parseRssVideoEnclosures`, Ukrainian classification `classifyUkText` (short Air-Force posts „КАБи на північ Харківщини" = alert, not strike) and `locateUkText` — Cyrillic stems per gazetteer place matched by the EARLIEST mention, `(?!щин|ськ)` so „Харківщина" is the oblast and „Лиманський" no place, while „Покровському напрямку" anchors on Pokrovsk; `ukCasualties`. `src/data/ukraineEventsClient.js`: 31-day chunks, chunk cache (today 60 s, past 30 min), `assembleEvents` (sanctions blocklist again), `mediaInWindow`, `reportForDay`. **(3) Renderer** `src/ukraineEventsLayer.js` — NOT a copy of the ZÁLIV cards: every event is a `PointPrimitiveCollection` point (colour = severity, size = severity, no `CLAMP_TO_GROUND`, heights lifted once through `defaultTerrainSampler` in 200-point batches, single-flight, cached by coordinate); three LODs by camera height — > 600 km clusters (`clusterEvents`, cell 1°/0.5°/0.25°, point + count label), 150–600 km mini chips (glyph + place, one chip per place with „+n"), < 150 km up to 8 full cards (`pickCards`) + chips; a clicked point/chip always gets a card. Card = severity bar, chips TYPE + TIME, level, subject, status line (MT to the UI language for English news and Ukrainian posts, labelled), photo/video thumbnail via `/api/img` with ▶ and „+n", foot „source · link ↗"; placement tries 8 candidates (above, right, left, below, 4 corners) against already placed boxes, leader line to the nearest edge, horizon/off-screen culling, recompute on `camera.changed` (debounced 120 ms — `setView` never fires `moveEnd`) and when the LOD band changes. Lightbox in the viewer container (z 190, above the command dock): YouTube nocookie iframe (`autoplay=1`), Telegram post embed, ArmyInform `<video>`, Telegram photo gallery with prev/next; ESC closes. Type glyphs are monochrome characters (⚔︎ with VS15, ≋ for naval — U+2693 has emoji presentation). **(4) Timeline** `src/ukraineTimeline.js` + pure `src/data/ukraineTimelineClock.js`: own clock (LIVE = window ends now; REPLAY = fixed cursor; `mapRange` caps the map at 30 days and at 7 days for „since 2022"), windows 24 h / 7 d / 30 d / since 2022, speeds 1 h/s … 2 d/s, play/pause/step, drag-scrub on the histogram (day-only VIINA events spread over the day when bins are finer than a day), coverage ticks for days with archived news/media, legend of `EVENT_TYPES` with counts (click = solo filter, then add/remove), counters „UDALOSTI V ZÁBERE n / total · GS clashes for the cursor day · photos/videos", film strip of the window's photos and videos (click = select + lightbox), copy-link button → `?front=<scene>&t=<ISO>&win=<id>` (parsed in `main.js` after the front scene). In REPLAY the General Staff markers show the archived report of the cursor day (`ukraineReportLayer.setOverride`). Playback is driven by a 100 ms timer, not rAF (rAF in a hidden pane fires once a second). The strip is a FIXED bottom island declared in `style.css` (`.oko-ukr-timeline`, obstacle entry in both `*_STACK_OBSTACLE_SELECTOR` lists, mobile: above the app bar via `--oko-dock-lift`, film strip hidden); while open, `body.oko-ukr-tl-open` lifts `#command-dock`, `#cesium-credits`, `#toast` and the HUD bottom corners by `--oko-ukr-tl-lift` (measured with a ResizeObserver) — `margin-bottom`, so it wins over whatever `bottom` each of them has. Chip UDALOSTI in the UKRAJINA panel toggles the timeline; a front scene opens it and arms the reveal gate (`ukraineEvents.setRevealed`). **Sources added** (DATA_SOURCES.md): VIINA 2.0 (ODbL, own file family), GeoConfirmed API, YouTube channel feeds (9 channels, world channels keyword-filtered), official Telegram channels (GS, MoD, DSNS, Air Force; forwards skipped, video only as thumb + official embed), ArmyInform video enclosures (CC BY 4.0), Guardian/Meduza feed thumbnails (`feedImage` — the shared RSS parser now picks the widest `media:content`), Kyiv Post and Euromaidan Press headline-only. **Measured live 2026-09-19** (dev server, OSM stack in the pane): 7-day window = 543 events (VIINA 205 strikes, 79 ground …) + 98 photos/videos, 1-day payload 25 kB gz, 30-day 1.26 MB raw, summary since 2022 380 kB; over Lyman at 80 km 8 cards + 4 chips placed without overlap, at 120 km 11 chips (52 in view); replay to 16.9. swapped the GS markers to 278 clashes; YouTube lightbox played. **Traps:** a Git Bash heredoc in the Bash tool turns `\b` into a literal backspace (0x08) and `\\d` into `\d` — patch files with the Edit/Write tools, never with heredoc scripts; VIINA zips on GitHub are LFS pointers via `raw.githubusercontent.com` — use `media.githubusercontent.com/media/…`; a failed Vite config reload is not retried until a config dependency changes (`touch vite.config.js`); the pane hides between turns and the app then waits at the loading screen (rAF) — `tabs_select` first. Tests: `ukraineEvents.test.mjs`, `ukraineMedia.test.mjs`, `ukraineArchive.test.mjs` (stored-zip helper, no network), `ukraineEventsProxy.test.mjs`, `ukraineEventsClient.test.mjs`, `ukraineTimelineClock.test.mjs`, `ukraineEventsLayer.test.mjs`, `ukraineTimeline.test.mjs` (fake DOM). Not published yet.
- **UKRAINE module, stage 4C — territorial control (Wikipedia points, derived zones) + war fires + DeepState visuals** (2026-09-19, user: „no nie je to nič moc ale pokračuj", then „čo vieme zatiaľ získať z deepstate stránok?"). **Control**: `src/data/ukraineControl.js` (pure) parses the two Wikipedia Lua modules — `parseMkTable` (marker shortcuts `mk.rus/ukr/con/grz/shr/rNE…`, defaults for revisions without the table), `parseLuaMarks` (entries `{ lat, long, mark, marksize, label, link }` in both the 2022 form with quoted icon names and quoted sizes and the post-2024-04 form with `mk.*`), `markStatus` (icon → side/kind/pressure/direction from the /doc legend), `controlPointsFromModules` (overview = cities, detailed = villages + infrastructure; the detailed module `require`s the overview since 2024-04-22, so older days use the detailed module alone), `controlRaster` (0.05° grid over 22–40.6°E × 44.2–52.6°N = 372×168 cells, nearest UA/RU/contested settlement in km with cos(lat), band 7 km, cutoff 35 km; 296 ms for 1 150 points). Archive: `controlSnapshot` (both modules at `rvstart=<day>T23:59:59Z`, file `control/<day>.json` with revision ids, `revisionAt`, summary, points and the CC BY-SA line; today refreshed every 6 h, past days final), `controlFor` (latest snapshot ≤ day), `controlBackfill` (weekly since 2022-02-24, 1.2 s pauses — 236 snapshots, 881 → 1 150 points over the years), route `/api/ukraine/events/control?at=` (404 `no_control_snapshot` before the first snapshot). Layer `src/ukraineControlLayer.js`: `PointPrimitiveCollection` (size by population class, contested with a red ring, infrastructure smaller, heights lifted once), the zone raster painted on a canvas (`paintControlCanvas`: RU runs as fills, contested cells clipped and hatched 45°) and draped as an entity `rectangle` with `ImageMaterialProperty` + `classificationType: BOTH` (clamps to terrain and 3D Tiles — a fixed-height rectangle would sit under the Donbas terrain), hover tip `.oko-ukr-ctl-tip` (name · side · kind · pressure). Timeline: chip KONTROLA + legend swatches + „as of <revision> · per Wikipedia" + settlement counts; the snapshot follows the cursor day (`store.control(day)`, 404 → „no snapshot for this day yet"); the front scene opens it; panel chip KONTROLA. **War fires**: `firesRefresh` downloads the Economist CSV (70 MB, 454 333 rows all `war_fire=1`, `ACQ_TIME` „HHMM" with dropped leading zeros → padded) with `If-None-Match`, writes only days whose count changed, `meta.json` index for the summary; `fireToEvent` → type `hotspot`, level `derived`, `noCard` (never a card, chip or cluster), drawn as 3.5 px orange points; legend/count „war fire (satellite)". **DeepState**: API and mirrors stay out (licence §2, proxying prohibited, owner's request form pending); their Telegram channel `DeepStateUA` joins the media pipeline with badge `osint` because licence §3 frees visual materials with their logo/link → daily map images in the strip. Tests: `ukraineControl.test.mjs`, `ukraineControlLayer.test.mjs` (fake canvas), archive/proxy/timeline additions.
- **UKRAINE module — DeepState polygons (hobby use, consent requested)** (2026-09-19, user: „OKO nie je biznis ale hobby pre mňa a môj FB profil, pridaj zatiaľ všetko čo vieš a požiadame DeepState o súhlas" + „vyplň zatiaľ aj request a odošli ho"). `/api/history/last` answers a plain request with the contact User-Agent (627 kB, 527 features, `id` = unix seconds of the snapshot, `datetime` „18.09 o 21:25"); `/api/history` is 401 → no history, OKO archives one snapshot per day from now (`deepstateSnapshot`, hourly job, unchanged `id` = no new file; `/api/ukraine/events/deepstate?at=` = latest snapshot ≤ day). Feature names carry `uk /// en /// geoJSON.<group>.<key>`: `src/data/ukraineDeepState.js` keeps `status.occupied|unknown|dismissed|dismissed_at`, `territories.crimea|ordlo|tuzla`, `status.attack_direction` points and `airfield/airbase/airport.*` points, computes spherical areas (occupied ≈ 72 941 km² + Crimea 27 111 + CADR/CALR 16 756, grey ≈ 1 674 km² on 2026-09-18), rounds coordinates to 5 decimals (628 kB → 256 kB) and DROPS `units.*` (276 RU unit markers) and „places of concentration" (ethical line), foreign territories and capitals. `src/ukraineDeepStateLayer.js`: entity polygons without height (`classificationType: BOTH`) with muted fills in OKO colours + `clampToGround` outlines (Cesium draws no outline for clamped polygons), attack/airfield `PointPrimitive`s lifted once, hover tip from `properties.deepstate`. Timeline: chip DEEPSTATE, legend swatches, „as of <UTC> · deliberate 2–3 day delay", derived km²; while DeepState is shown the Wikipedia zone raster hides (points stay); the front scene opens it; panel chip. **Request form** (Tally embed at api.deepstatemap.live/request, not in the accessibility tree — driven by coordinates): name, e-mail and type B „non-commercial" prefilled in the pane, then on the owner's explicit instruction the description was typed in English and Ukrainian (with a closing note that the text was drafted with an AI assistant from the owner's notes, because the form says „do not use AI to generate the request text"); the owner solved the reCAPTCHA and submitted it himself on 2026-09-19 („Дякуємо, запит збережено"; answer expected within ~3 days, silence = declined). `UKRAINE_DEEPSTATE=off` disables the job; if consent is refused, delete the layer, the job and `.gev-cache/ukraine/events/deepstate/`.
- **UKRAINE module, stage 5 (the consent-free part) — building damage** (2026-09-19, user: „pokračuj v pláne"). Static layer ŠKODY from the ETH Zürich Zenodo record 15088349 (CC BY 4.0): `scripts/build-ukraine-damage.mjs` downloads `n_buildings_damaged_adm3_t0_655.geojson` (61 MB) and `unosat_labels.geojson` (7 MB) into `.gev-cache/ukraine/damage/raw/` (the 18 GB raster and the 4.8 GB parquet are never fetched) and writes `adm3.json` (1 759 hromadas with damage, 403 990 probably damaged buildings, centroid per `featureCentroid` = area centroid of the largest ring) and `unosat.json` (18 209 buildings, classes 1–4 → destroyed/severe/moderate/possible, March–October 2022, 26 cities); pure helpers in `src/data/ukraineDamage.js`. Routes `/api/ukraine/events/damage/adm3|unosat` (file read, 60 min memory cache, 404 `no_damage_snapshot` before the build). Layer `src/ukraineDamageLayer.js`: hromada circles (`damageRadiusPx` 4–22 px ~ √count, `damageColor` by share, lifted once through the terrain resolver) and UNOSAT points on the ellipsoid (18 000 points are not lifted; depth test off), hover tips with the honesty line („Sentinel-1 model, precision ≈ 67 % — an estimate"); the timeline chip ŠKODY + legend line with counts, and in REPLAY `setCursor` hides UNOSAT assessments dated after the cursor; panel chip ŠKODY. Not switched on by the front scene (opt-in). Tests: `ukraineDamage.test.mjs`, `ukraineDamageLayer.test.mjs`. GIBS night lights and voice aliases were looked at and deferred: the map stacks have no VNP46A2 layer yet and imagery layers cannot drape on the photoreal 3D tiles the owner uses; voice tools carry no scene aliases at all.
- **UKRAINE module — settlements named in the General Staff report anchored on the map** (2026-09-19, user: „pokračuj v pláne"; the open item left from stage 2). The daily report names the villages it talks about in the genitive after „у районі / в районах / у напрямку / в напрямках / поблизу / неподалік" („у районах Петропавлівки, Куп’янська-Вузлового та Новоосинового"). New pure module `src/data/ukraineReportPlaces.js`: `extractPlaceMentions` (name lists after the triggers; connectors `,` / `та` / `й` / `і`; hyphenated and two-word names; stop words such as „Сили"), `nominativeCandidates` (ending rules -ки→-ка, -ого→-е/-ий, -ової→-ова, -оля→-іль, -ів→-и, -их→-і, -ова→-ів …, stem of at least two letters so „Яру"→„Яр"; a hyphenated name declines every part — „Куп’янська-Вузлового"→„Куп’янськ-Вузловий"), `PLACE_EXCEPTIONS` (Часів Яр, Русин Яр, Київ, Львів, Харків), `buildPlaceIndex` (the Cyrillic names of the OSM base snapshot; key = lower case with unified apostrophes), `resolvePlace` (first candidate found in the index; several settlements of the same name → the one nearest to the direction's centre within 120 km with a class bonus of 30 km for a city and 15 km for a town — Добропілля near Pokrovsk is a town 20 km away and a village 18 km away, the town wins; without a centre the most populous), `directionPlaces` (places per direction with mention counts plus the unresolved names). `ukraineBaseLayer.getPlaceIndex()` builds the index once per snapshot from the towns file plus the villages file (fetched for the index even when the camera never went low enough; an empty index is not cached). `ukraineReportLayer` takes `placeIndex` (main.js hands over the base layer's provider), resolves after every draw — the live report and the timeline's archived override alike, a stale run is dropped by a token — and draws one small point + label per settlement (colour of the direction's intensity, „×2" when named twice; a settlement named by two directions is drawn once with the mentions summed; point visible to 700 km, label to 260 km), lifts them in the same terrain-resolver batch as the markers (`lifting` flag, no double lift), hands the OSM ids of the drawn settlements to the base map (`reservePlaces` → `ukraineBaseLayer.setReservedPlaces`, released when chip STRETY is off or the report has no places) so the base map hides its own village point and label there — measured trap: the base village point sits at the very same pixel and terrain height and wins `scene.pick` even though the report data source is above it (`raiseToTop` changed nothing), so without the reservation the hover showed the plain village card and the label was drawn twice — and shows a hover card „settlement named in the General Staff report" with the direction(s) and their counts, the report time and the note that this is neither a front line nor a unit position (art. 114-2 stays untouched — the report names places, not positions; nothing derived is stored, geocoding runs in the browser, ODbL). The UKRAJINA panel's report card appends „N settlements named"; `getState()` carries `placesCount` and `placesUnresolved`. **Measured live 2026-09-19** (report of 08:00 19.9., snapshot 2026-09-19): index of 18 148 distinct names from 1 442 towns + 27 973 villages (66 Novoselivkas, 88 Mykolaivkas — hence the centre rule); 41 names in 15 paragraphs, 40 resolved, 1 unresolved (Юрківка in the Kramatorsk direction: the nearest village of that name in the snapshot is 195 km away, so it stays honestly unplaced); panel line „213 bojových stretov · … · 40 menovaných sídiel". Tests: `ukraineReportPlaces.test.mjs` (paragraphs of the real 19 Sep report as fixtures), additions in `ukraineReportLayer.test.mjs` (points, shared settlement, card, override) and `ukraineBaseLayer.test.mjs` (index build, villages fetched on demand, cache). Not published yet.
- **KARTA — cartographic mode, stages K0 + K1: browser-shaded hillshade base map** (2026-09-20, user showed Rybar's „Лиманское направление" map: „chcel by som to takéto jemnučké. Navrhni riešenie" → proposal in `docs/drafts/ukrajina-plan.md` (section „jemná karta frontu ako Rybar"), then „sprav mi najprv vzorku" → the 2D canvas sample `docs/drafts/karta-vzorka/index.html` (real data: Mapzen normal tiles, OSM built-up/forest/water/rail polygons for the Lyman window, DeepState zones, GS report places), then „je to dobré"). **K0 findings**: Mapzen/Nextzen terrain tiles on AWS Open Data answer without a key (`normal/{z}/{x}/{y}.png`, 56 kB at z12 over Lyman, 0.6 s), but the S3 bucket sends no CORS headers, so a browser cannot read their pixels — hence a same-origin proxy; the **green channel of the normal tiles points SOUTH** (checked on the Siverskyi Donets valley near Sviatohirsk through the quantised elevation in the alpha channel: the valley floor is the alpha minimum and the slope rising northwards has +y), so the shader flips Y; raw SRTM normals at z12 look like crumpled paper, a 1.4 px blur of the normals before shading fixes it, and blurring at the tile edge would blend transparent black into a dark seam unless the edge rows are clamped into a margin first. Overpass was overloaded that night (HTML/504 from three mirrors), the Lyman window later came through kumi: 21 576 elements / 31 MB raw → 4 833 built-up, 4 437 forest, 696 water, 169 rail polygons after simplification (that data stays under `docs/drafts/karta-vzorka/`, untracked, for the sample only — K2 will build it into the base snapshot). **K1**: new `src/hillshadeImagery.js` — pure `lightVector`, `shadePixel` (amp on the horizontal components, gamma 0.8, three-colour ramp `KARTA_PALETTE` mid #1e2c3a / lit #687c92 / shadow #070e17), `shadeNormals`, `shadeNormalTile` (margin clamp → blur → shade) and `HillshadeImageryProvider` (Web Mercator 256 px, ≤ level 15, `requestImage` through `Cesium.Resource` with the layer's `request` so the RequestScheduler throttles it like any other base map, `preferImageBitmap: false` so the image arrives upright and the returned canvas is upright as with `GridImageryProvider`; returns `undefined` when throttled). New Vite plugin `src/data/reliefTilesProxy.js` (`/api/relief/{z}/{x}/{y}.png`: z ≤ 15, x/y < 2^z, upstream S3 with UA, PNG ≤ 2 MB, disk cache forever under `.gev-cache/relief-normal` written atomically, `immutable` response, single-flight per tile, 900 upstream fetches per client per minute, 404 passthrough uncached). Map stack `karta` („Karta frontu", chip KARTA right after OSM in `mapStackChips.js`): `kind: 'hillshade'`, keyless, `contactContrast: 'dark'`, `globeBaseColor: '#0b1622'` (the controller now sets `globe.baseColor` per stack and restores Cesium's default when leaving), `postProcess: { sharpen: false, bloom: false }` — `StyleManager._applyStackPostProcess` (called from `_renderMapStackState` and once after the post-process stages exist) switches sharpen and bloom off while the stack is active and restores the user's previous state on leaving; a manual re-enable during KARTA is respected until the stack changes. Measured live 2026-09-20 in the pane over the Lyman direction (front scene, 159 km, terrain world): stack ready without errors, 23 globe tiles rendered, the OSM overlay (roads, rivers, settlements), the control zones, DeepState polygons and the report markers all read well on the dark relief; the first screenshot right after the switch still showed the sky box (textures not yet uploaded), 10 s later the globe was there. Tests: `hillshadeImagery.test.mjs`, `reliefTilesProxy.test.mjs`, additions in `mapStackController.test.mjs` and `mapStackChips.test.mjs`. Not published yet. Next: K2 (built-up/forest/water/rail into the base snapshot as GroundPrimitive batches), K3 (soft zones with hatching, pins by side), K4, K5 as listed in the plan.
- **KARTA — stage K2: OSM areas (built-up, forests, water, railways) as batched ground primitives by 1° tiles** (2026-09-20, continuation of K0+K1 after „je to dobré"). **Build**: `scripts/lib/ukraineAreas.mjs` (pure: `tileKey`/`tileBbox`, `tilesForScenes` — the 1°×1° tiles intersecting any front-direction window, 26 of them, ordered from the Donbas centre outwards; `buildAreasQuery` for `landuse=residential|industrial`, `natural=wood`/`landuse=forest`, `natural=water`, `railway=rail` with `out geom`; `ringsFromElement`/`chainRings` assemble relation outers and inners by matching way ends; `simplifyLine`/`simplifyRing` Douglas–Peucker at 0.00011° ≈ 12 m; `elementsToAreas` keeps a polygon only if the centroid of its outer ring lies in the tile — a polygon crossing a tile border is drawn once, by the tile that owns its centroid — drops tiny ones (built < 0.01 km², forest < 0.05, water < 0.02), rounds to 5 decimals and caps 6 000 per class largest-first) and `scripts/build-ukraine-areas.mjs` (Overpass etiquette of the base builder: one query at a time, 30 s pause, 429/504 → 90 s and the next mirror, raw cache under `.gev-cache/ukraine/osm-raw/areas/`, atomic writes, `--tiles`, `--limit`, `--refresh`, `--list`; output `.gev-cache/ukraine/base/areas/<N48E037>.json` + `meta.json` updated after every tile, so the client can use tiles while the rest is still downloading). Measured: overpass-api.de answered a 1° tile in ~20 s / 20–30 MB raw (the same query took 201 s the night before on kumi), a tile compacts to 0.7–2 MB; N49E038 keeps 1 685 built-up / 1 832 forest / 244 water / 98 rail polygons after dropping 21 299 tiny ones. **Serving**: `ukraineBaseProxy` in `vite.config.js` also answers `areas/meta` and `areas/<key>` (key validated by regex, same gzip + ETag path as the other snapshot files). **Client**: `src/data/ukraineAreas.js` (pure: `pickAreaTiles` — tiles intersecting the camera's view rectangle, nearest to its centre first, max 6; `areasWanted` below 420 km; `filterAreasForDraw` with stricter draw thresholds built ≥ 0.02 km², forest ≥ 0.08, water ≥ 0.03 and caps 2 500/2 000/800/1 500 per tile; `AREAS_STYLE`), `src/data/ukraineAreasLayer.js` (`createUkraineAreasLayer`: loads `areas/meta` on show, recomputes on `camera.moveEnd` (350 ms settle) and on map-stack change, fetches missing tiles, shows at most 6, keeps 12 in memory with LRU eviction, hides everything above 420 km and whenever the globe is hidden (`isGlobeHiddenForStack` — Google 3D would otherwise get grey polygons draped over real buildings); each tile = up to four batched primitives in `scene.groundPrimitives` with `allowPicking: false` and `classificationType: BOTH`: water and built-up as `GroundPrimitive` + `PerInstanceColorAppearance`, forests as `GroundPrimitive` + `MaterialAppearance` with the registered Fabric material `OkoForestDots` (white dots in SCREEN pixels via `gl_FragCoord`, spacing 7 px — the density does not change with zoom, exactly the Rybar texture), railways as `GroundPolylinePrimitive` + `PolylineDash`). Chip PLOCHY in the UKRAJINA panel is only the switch (`setEnabled`); visibility follows the base map (main.js: `ukraineBase.onChange` → show/hide). **Traps measured tonight**: entities were far too heavy — 27 000 polygon entities for 4 tiles blocked the main thread and the globe stayed black for tens of seconds (the first primitive-based build with the stricter draw filter shows 6 889 built-up + 4 824 forest + 1 348 water + 2 702 rail instances for the 4 Lyman tiles, `ready` after ~15 s in workers, frame time ~1 ms); `Cesium.Material.fromType` throws `HTMLCanvasElement is not defined` in Node, so the layer takes a `materialFactory` (tests inject a fake and the layer falls back to per-instance colour / `PolylineColorAppearance` when a material cannot be built); `PolylineColorAppearance` throws „lineWidth is out of range" in Node because `ContextLimits` are 0 without WebGL — the test seeds `_minimumAliasedLineWidth`/`_maximumAliasedLineWidth`; right after switching to KARTA the globe shows only the base colour until the relief tiles arrive from S3 (~0.5 s each, 6 per server in flight, cached on disk afterwards). Verified live at 90 km and 38 km over Lyman: forests dotted, villages grey, reservoirs blue, DeepState and Wikipedia zones and the report markers on top, no console errors. Tests: `scripts/lib/ukraineAreas.test.mjs`, `src/data/ukraineAreas.test.mjs`, `src/data/ukraineAreasLayer.test.mjs`, `ukrainePanel.test.mjs`. The tile download for the remaining directions keeps running in the background (Overpass mirrors alternate between 429 and 504); tiles appear in the app after a reload (meta is read once per show). Not published yet. Next: K3 (soft control zones + 45° hatch, settlement pins by side, city glow), K4, K5.
- **KARTA — after the user's first look: forests off, half-width lines, darker relief, and the real cause of the black globe (render governor tile watchdog)** (2026-09-20, user: „je to nahovno… tie lesy vybodkované sú rušivé a chcel som jemnejšie línie. tie lesy určite nie" and „aj pozadie bolo tmavšie predtým"). (1) **Forests are not drawn**: `AREAS_DRAW_CLASSES = ['built','water','rail']` in `ukraineAreas.js`, `filterAreasForDraw` skips the class (the tile data and the `OkoForestDots` material stay for a possible quiet flat tint later; the dotted texture is gone for good); built-up α 0.36→0.28, water 0.5→0.4, railway 2.2→1.4 px. (2) **Base map style modes**: `ukraineBaseLayer.setStyle('karta'|'default')` with `UKRAINE_BASE_STYLES` (karta: line widths ×0.5, point sizes ×0.72, label fonts ×0.9) — every road/river/oblast polyline and every settlement point/label registers its BASE values at creation (`registerStyle`), so the scale applies to entities that already exist and to village cohorts created later; `removeRecord`/`destroy` drop the registry entries; `main.js` switches the mode from `onActiveMapStackChange` (hillshade stack → karta) and once at boot. (3) **Darker relief**: `KARTA_PALETTE` mid 30/44/58→22/33/45, lit 104/124/146→82/100/120, shadow 7/14/23→5/10/17, amp 2.5→2.0 (the stronger amp lit up every slope). (4) **The black globe was never the imagery**: with the stack restored from the hash and the camera parked, the globe stayed base-colour-black for 121 s — `tilesToRender: 1`, 23 terrain/imagery tiles queued, `RequestScheduler` 0 active requests, last frame two minutes old, governor mode `idle`; 40 manual `scene.render()` calls loaded everything at once. In `requestRenderMode` the globe's load queue is processed only inside a rendered frame, and when the scheduler defers the queued tiles while nothing is in flight there is no completion event to request the next frame, so loading deadlocks until the user moves the mouse. `renderGovernor.js` now arms a **tile watchdog while idle**: every 400 ms (`TILE_WATCH_MS`, `setInterval` unref'd so Node tests do not hang) it requests one frame if `scene.globe.show && !globe.tilesLoaded`; the interval is cleared in continuous mode and re-armed on the last release; `installRenderGovernor(viewer, { timers })` takes injected timers for tests. Verified live: KARTA restored at boot, camera parked, no interaction — `tilesLoaded` true after the wait, globe drawn (the pane's screenshot capture itself times out while the desktop window is hidden, so the proof is the scene state plus the earlier renders). Tests: `renderGovernor.test.mjs` (watchdog arms in idle, silent when loaded or globe hidden, cleared by a hold), `ukraineBaseLayer.test.mjs` (setStyle scales existing and later entities, restores, unknown mode = default), `ukraineAreas.test.mjs` (forest class skipped), `mapStackController.test.mjs` (amp 2.0). Open for the user's next look: line widths/colours of the DeepState outlines and the Wikipedia raster on KARTA (K3), and whether built-up polygons should stay.
- **KARTA — forests off for good, relief ramp back to the approved sample** (2026-09-20, user: „aha to je karta frontu a ja som pozeral iný glóbus. skús zapnúť tie lesy" → forests re-enabled and shown on KARTA → „nie lesy vypni"). The earlier complaint about a too-light background belonged to another map stack, so `KARTA_PALETTE` and `amp: 2.5` are the values of the approved sample again; the halved base-map lines (`ukraineBase.setStyle('karta')`) stay, they were in the proposal from the start. `AREAS_DRAW_CLASSES = ['built','water','rail']` — the dotted forest texture was judged on KARTA itself this time and rejected; tiles and the `OkoForestDots` material remain, re-enabling is adding `'forest'` to that list. Built-up α 0.34, water α 0.5, railway 1.4 px. Tests updated (`ukraineAreas.test.mjs`, `ukraineAreasLayer.test.mjs`, `mapStackController.test.mjs`). Not published yet.
- **KARTA — the green band across central Ukraine was Cesium's fog, now off while KARTA is active** (2026-09-20, user: „je tam taká zelená, to neviem čo je" with a screenshot of a dark-green rhombus from the Belarus border to Mykolaiv). Measured in the pane, layer by layer: not the relief tiles (the same Web Mercator tiles rendered navy next to the band and their textures read back navy through a framebuffer), not DeepState (no polygon spans that area), not the control raster (UA side has alpha 0), not the OSM areas (hidden above 420 km), not DOM overlays (all 37 hidden, band stayed), not globe lighting, ground atmosphere, post-process stages or the sky atmosphere — only `scene.fog.enabled = false` removed it. Cesium's fog takes its colour from the atmosphere model; with the sun below the horizon that colour is greenish and the fog paints it on the terrain with a fairly hard screen-space edge, so on the dark KARTA relief it read as a green band, and because the atmosphere colour follows the sun the band drifted a few degrees between screenshots ten minutes apart (bright basemaps hide the same tint). `MAP_STACKS.karta.fog = false`; `MapStackController._applySceneFog(stack)` runs after every successful switch, remembers the fog state before the first stack that disables it and restores it on any stack without the flag (verified live: fog true → KARTA false → OSM true → KARTA false). Pane traps recorded on the way: `Framebuffer.destroy()` destroys the attached textures by default (pass `destroyAttachments: false` when probing live textures), `scene.render()` without `scene.requestRender()` does not raise `postRender` in requestRenderMode, `gl.readPixels` after a plain render reads a stale buffer. Test added to `mapStackController.test.mjs`.
- **KARTA — stage K3: soft control zones, hatched grey zone, settlement pins by side, city glow** (2026-09-20, user: „pokračuj" after approving K1+K2 on the right globe). All of it is bound to the `karta` style mode, other stacks keep their look. (1) **Control raster** (`ukraineControlLayer.js`): `paintControlCanvas` gained `soft` + `createCanvas` — the RU fills are painted one pixel per cell into a helper canvas and drawn back scaled with image smoothing and a `blur(3px)` filter, the contested hatch stays crisp on top; `CONTROL_STYLES` (karta: soft 3, RU α 0.26, Wikipedia points hidden because the base map pins take over), `setStyle`, `sideAt(lon, lat)` through the pure `nearestSide` (nearest settlement/rural point within 3 km; `mixed` counts as contested). (2) **DeepState** (`ukraineDeepStateLayer.js`): `DEEPSTATE_STYLES` (karta: outlines 1.0/0.7 px instead of 1.8/1.2, grey zone drawn with the new screen-space hatch material), `setStyle`, `buildPolyIndex` + `sideFromPolygons` (occupied/ordlo/crimea/tuzla → ru, grey → contested, otherwise the fallback — the layer passes `ua` whenever the snapshot has occupied polygons, since everything outside them is UA-controlled in DeepState's model) and `sideAt`. (3) **Hatch material** `src/data/screenPatternMaterials.js`: Fabric `OkoHatch45` registered once in Cesium's material cache — 45° lines in SCREEN pixels via `gl_FragCoord` (spacing 9 px, thickness 0.22 of the gap), `HatchMaterialProperty` for entities, `hatchMaterialFor(css, {lineAlpha, fillAlpha})` with a colour fallback when the cache is missing (Node). (4) **Base map** (`ukraineBaseLayer.js`): `setSideResolver(fn)` + `refreshSides()` — in `karta` every settlement point takes `SIDE_PIN_COLORS` (UA #5b8fd0, RU #d0554a, contested #f0a53a) from the resolver, otherwise the class colour; village cohorts created later are coloured at creation; `glowRadiusPx`/`GLOW_MIN_POP` — cities and towns from 10 000 inhabitants get a radial-gradient billboard (`defaultGlowImage`, canvas 64 px, warm #ff5a4a α 0.3, 26–70 px by population, drawn under the pins, shown only in `karta`); `glowImageFactory` injectable for tests. (5) `main.js` composes the resolver (Wikipedia point within 3 km first, then DeepState polygons), refreshes pins on every control/DeepState change and switches control + DeepState styles from `onActiveMapStackChange` like the base map. Measured live over Lyman on KARTA: 1 034 UA / 401 RU / 7 contested pins of 1 442 towns (no grey leftovers once the DeepState fallback is in), 467 town glows, DeepState 229 features with the grey zone hatched, Wikipedia RU raster with soft edges, Wikipedia points hidden. Tests: `screenPatternMaterials.test.mjs`, additions in `ukraineControlLayer.test.mjs` (nearestSide, soft painting on a fake canvas), `ukraineDeepStateLayer.test.mjs` (index, sides, fallback), `ukraineBaseLayer.test.mjs` (pins by side, glow, style switch). Not published yet. Next: K4 (report places as lightning badges, road badges, DeepState attack arrows only with consent), K5 (title, legend, inset, export).
- **Propagácia — sumár konfliktov (krok 2): textový prehľad z hlásenia GŠ** (2026-09-20, user: „pokračujeme"). Nový `src/conflictSummary.js` (čistý): z denného hlásenia Generálneho štábu ZSU (najsilnejšie denné dáta) zostaví sourcovaný textový prehľad na FB popis. `frontDigestLines(report)` = smery zoradené podľa počtu útokov zostupne (neuvedené na koniec) cez `reportByScene` + `frontSceneLabel`; `frontAttacks(report, sceneId)`; `buildUkraineDigest({report, translate, dateText})` → hlavička (dátum + zdroj), riadky smerov s útokmi > 0 („• Kosťantynivský smer: 25…"), súčet a zdroj (ArmyInform CC BY 4.0 + oko.uhrin.digital). Etická čiara: len smery, počty a zdroj, žiadne osoby ani polohy jednotiek. Prázdny dátum → hlavička bez „stav k" (`head-nodate`); main dopĺňa dnešný dátum. Panel Kartičky konfliktov dostal tlačidlo „Kopírovať prehľad" (`onDigest` + `clipboard`, stav „Prehľad skopírovaný"). main.js `onDigest` = `fetchUkraineReport()` → `buildUkraineDigest`. i18n `summary.*` (SK+EN). Testy `conflictSummary.test.mjs` + panel digest test. Overené naživo: prehľad „Ukrajina · stav k 20. 9. 2026 · hlásenie GŠ ZSU" so 6 smermi a súčtom 234. Ďalej: Blízky východ (správy) a úžiny (ropa/premávka) do prehľadu, potom video. Viď [[oko-propagacia]].
- **Propagácia — panel „Kartičky konfliktov" (B)** (2026-09-20, user: „A aj B"). Samostatný plávajúci panel (`src/conflictsPanel.js`, geometria v `style.css` kvôli testu overlayIslands; spúšťač „Kartičky konfliktov" vľavo dole): zoznam všetkých konfliktov z katalógu po regiónoch (Ukrajina 12, Námorné úžiny 8, Blízky východ 1 = 21 riadkov, mená lokalizované cez `conflictTitle`), výber pomeru (Feed/Štvorec/Story), export po jednom aj dávkou („Exportovať všetky" so stavom „Exportujem n/total"). Export navigáciou: `frameConflict(conflict)` v main.js zarámuje scénu podľa druhu (Ukrajina → KARTA stack + `runFrontScene`, úžina → `runChokepointScene`, situácia → ručný `flyTo` na obdĺžnik), počká ~3,5 s na ustálenie dlaždíc, potom `exportConflict({conflict, ratio})` zachytí a stiahne. `window.__godsEyeView.conflictsPanel`. Overené naživo: spúšťač aj panel sa vykreslia, 21 riadkov / 3 regióny / 3 pomery, prepínanie pomeru, otvorenie/zatvorenie. i18n `conflicts.*` (SK+EN). Testy `conflictsPanel.test.mjs` (štruktúra, toggle, pomer, export jedného, dávka s vypnutými tlačidlami, inertný bez documentu). PASCA: dávka naviguje a čaká na dlaždice — v mojom pane (403 fotoreál) visí, patrí na stroj používateľa/produkciu. **Propagácia A aj B hotové.** Viď [[oko-propagacia]].
- **Propagácia — export kartičiek naprieč konfliktmi (A: aktívna scéna)** (2026-09-20, user: „A aj B"). Zdieľacia kartička (rám K5) funguje pre KTORÝKOĽVEK konflikt, nielen KARTU. Nové: `src/conflictExport.js` (jadro): `CARD_RATIOS` feed 1200×630 / square 1080×1080 / story 1080×1920, `conflictCardModel` (Ukrajina zo živého KARTA prekryvu, ostatné z katalógu), `defaultConflictFacts` (zdroje podľa druhu: úžina = GFW/Sentinel-1/OSM/Yahoo, situácia = GDELT/BBC/AJ/Google News), `captureConflictCard` (aktuálny pohľad + rám cez `drawKartaExport` decorate v danom pomere), `conflictCardFilename`, `downloadCardSnapshot`. `drawKartaExport` zovšeobecnený: prehľadová mapka berie obrys z modelu (`model.inset` = {rings,bbox}; KARTA = Ukrajina default, globálne konflikty = svet), a MIERKA podľa menšej strany (feed=1, štvorec/story ~1,8× → text nie je drobný; feed ostáva 1:1, KARTA nezmenená). Nový `src/data/worldOutline.js` (hrubý obrys pevnín z Natural Earth 1:50m, DP ~1,2°, 175 prstencov/1 561 bodov, bez Antarktídy, public domain). `buildConflictCardModel` dopĺňa `inset` (svet pre neukrajinské). main.js: sleduje `activeChokepoint`/`activeFrontScene`, `activeConflict()`, `exportConflict({conflict,ratio})` (Ukrajina → overlay model, inak katalóg + fakty + viewRect z kamery → stiahne); tlačidlo Snímka na KARTE aj globálne API `window.__godsEyeView.conflicts = {list, active, ratios, exportCard(id,ratio)}`. Overené naživo: kartička úžiny Hormuz (titulok, zdroje, mapa OSM, svetový inset s bodkou na Hormuze, pás OKO+atribúcia). Testy `conflictExport.test.mjs`. Ďalej B: panel Konflikty (zoznam, export po jednom, dávka, 3 pomery). Viď [[oko-propagacia]].
- **Propagácia — katalóg konfliktov + model zdieľacej kartičky (krok 1)** (2026-09-20, user: „pokračujeme"). Základ pre propagáciu naprieč konfliktmi (OKO nie je len Ukrajina): `src/data/conflictsCatalog.js` (čistý) je tenká kurátorská vrstva NAD existujúcimi presetmi — smery frontu (`ukraineFrontScenes`), námorné úžiny (`chokepointScenes`) a situácie zo správ (Perzský záliv). `listConflicts()` = plochý zoznam zdieľateľných scén (celý front + 11 smerov, 8 úžin, 1 situácia), každá s id (`ukraine:lyman`, `chokepoint:hormuz`, `gulf`), kind (`ukraine-front|chokepoint|situation`), regiónom (`ukraine|maritime|middle-east`), rámovaním (center + rectDegrees) a odkazom na preset; `conflictById`, `conflictsByRegion`, `conflictFraming`, `conflictTitle` (dispatch na `frontSceneLabel`/`chokepointSceneLabel`/titleKey). `buildConflictCardModel(conflict, {dateText, sources, legend, legendHead, viewRect, translate})` vyrobí model kompatibilný s `drawKartaExport` (K5) pre KTORÝKOĽVEK konflikt — nielen KARTU; viewRect padá späť na obdĺžnik konfliktu. i18n `conflict.gulf` (SK „Perzský záliv" / EN). Testy `conflictsCatalog.test.mjs` vrátane integrácie (model úžiny Hormuz sa naozaj nakreslí cez `drawKartaExport`). NEZAPOJENÉ do UI — ďalší krok: „Snímka" na ktorejkoľvek scéne + dávkový export + 3 pomery (feed/štvorec/story). Viď [[oko-propagacia]].
- **KARTA — rozmiestnenie popiskov bojov v obrazovke (proti prekryvom)** (2026-09-20, user: „sprav" — dorieš prekryvy). Na KARTE sa popisky sídiel z hlásenia GŠ už neprekrývajú: `ukraineReportLayer.js` má greedy rozmiestnenie v priestore obrazovky (`deconflictLabels`, pure): krížené meče smerov sú pevné prekážky (nikdy sa nehýbu ani neskrývajú), sídla si podľa priority (viac útokov + zmienok = prednosť) hľadajú prvú voľnú polohu zo štyroch (vpravo → vľavo → hore → dole, `labelBox`), a keď žiadna nesadne, popisok sa skryje (blesk sídla ostane, poloha je stále označená). Prepočet po ustálení kamery (`camera.moveEnd`, pauza `settleMs` 200 ms), po vykreslení a pri zmene štýlu; projekcia svet→okno cez `SceneTransforms` (`projectorFactory`, testy dajú vlastný); berie len popisky v dosahu DDC a na obrazovke; mimo KARTY sa všetko vráti vpravo a zobrazí. Namerané nad Lymanom: pri 159 km 12 vpravo / 8 presunutých / 4 skryté, pri 92 km 23 / 1 / 0 (bližšie = menej konfliktov). Vizuálne overené: „Novoiehorivka" a „Cherneshchyna", ktoré sa predtým prekrývali, sú teraz oddelené (Cherneshchyna vľavo od svojho blesku). Testy: `labelBox`/`deconflictLabels` (polohy, greedy, meče pevné, plno = skryť) a integračný `relayout` (všetko na jednom bode = konflikt vyriešený; default = späť vpravo). Zostávajúce cross-layer prekryvy (odznak cesty pod pilulkou) sú z inej vrstvy a pilulka kreslí navrchu, teda čitateľné.
- **KARTA — prehľadnosť: podložka popiskov bojov + robustná čistá karta** (2026-09-20, user: „mimoriadne precízne… vojnová zóna, mapa musí byť prehľadná"). Pixelová kontrola plátna (canvas.toDataURL, okno bolo skryté) ukázala hlavnú stratu čitateľnosti: amber popisky sídiel z hlásenia GŠ (STRETY) splývali s hustými podkladovými popiskami a terénom — krížené meče majú tmavú podložku, popisky sídiel nie. Oprava v `ukraineReportLayer.js`: v štýle `karta` dostane popisok sídla tmavú podložku (`showBackground`, #0b1622 α 0,72, padding 5×3) a tenší obrys (2 namiesto 3), takže combat popisky čítajú nad čímkoľvek; v `default` bez podložky (pôvodný vzhľad). `applyPlaceStyle` prepína podložku aj obrys pri zmene štýlu. Vizuálne overené: Novoselivka/Stavky/Lyman/Yampil/Dibrova… teraz jasné pilulky, hierarchia = mestá biele verzálky, boje amber pilulky. Čistá karta (K5) spevnená: namiesto menného zoznamu selektorov chrómu allow-list `body.oko-karta-clean > *:not(#cesiumContainer):not(#oko-karta-overlay):not(#cesium-credits) { display:none }` v `style.css` — schová VŠETOK chróm (aj panely v `#left-panel-stack`/`#right-context-rail` a budúce prvky), nechá mapu, rám KARTA a povinný kredit Cesium/Google (0×0 fixed kontajner, text preteká — ostáva viditeľný). Overené screenshotom: titulok + legenda + mapka + tlačidlá, žiadny chróm, kredit prítomný. Zvyšné drobné prekryvy (dve tesné pilulky vedľa seba, odznak pod pilulkou) sú z naozaj hustých zhlukov a ostávajú čitateľné.
- **KARTA — K5: rám „hotovej mapy" a export** (2026-09-20, user: „pokračuj"). Nový `src/ukraineKartaOverlay.js` + CSS v `style.css` (geometria ostrovov MUSÍ byť v style.css, nie vo vstreknutom `<style>` — test overlayIslands). Tri ostrovy len na podklade KARTA (kind hillshade) a len pri priblížení (brána `createSceneRevealGate` — `kartaOverlay.setRevealed`): (1) TITULOK vľavo hore = názov smeru (`frontSceneLabel`) + „stav k <dátum>" (`kartaDateText`: prednosť hlásenie GŠ → DeepState stamp → revízia Wikipédie) + zdroje (`kartaSources` podľa zapnutých vrstiev); (2) LEGENDA vľavo dole = `kartaLegendItems` podľa toho, čo je zapnuté (DeepState → obsadené + šrafovaná sivá zóna; inak KONTROLA → ruská kontrola; vždy špendlíky UA/RU; STRETY → blesk „hlásené boje"; vždy odznak cesty); (3) PREHĽADOVÁ MAPKA vpravo dole = SVG obrys Ukrajiny (`src/data/ukraineOutline.js`, zjednodušené z Natural Earth 1:50m, public domain) + obdĺžnik pohľadu z `camera.computeViewRectangle` + červená bodka stredu smeru (`makeInsetProjection` ekvirektangulárna, x×cos(šírka); `insetRingPath`). Tlačidlo „ČISTÁ KARTA" (`setClean`) dá telu triedu `oko-karta-clean` a v style.css schová chróm (title-bar, panely, dock, os UKRAJINA…) — mapa, rám a kredit Cesium/Google ostanú; tlačidlo „SNÍMKA" (`onExport` → `exportKarta` v main.js) zapečie rám do zdieľanej snímky: `captureShareSnapshot` má nový parameter `decorate(ctx,w,h)`, KARTA dodá `drawKartaExport` (kreslí titulok/legendu/mapku na plátno 1200×630 nad pásom atribúcie). Wiring v main.js: overlay vzniká po vrstvách KONTROLA/DeepState/STRETY, `setStack` z `onActiveMapStackChange`, `setScene` z `runFrontScene`, `setRevealed` z brány, inset sa prekreslí na `camera.moveEnd`. i18n `ukraine.karta.*` (SK+EN). Overené naživo nad Lymanom: titulok „Lymanský smer · stav k 20.9.2026 06:09 UTC · Generálny štáb ZSU · DeepState · OpenStreetMap", 6-riadková legenda, mapka s obdĺžnikom pohľadu; čistá karta schová chróm a nechá kredit; export = JPEG 1200×630, 183 kB s rámom aj odznakmi/bleskami z K4. Testy: `ukraineKartaOverlay.test.mjs` (projekcia, modely, DOM ostrov, čistá karta, kresba do snímky), overlayIslands guard zelený. **VŠETKÝCH K0–K5 hotových**; ostáva len K4 šípky útokov po súhlase DeepState. DATA_SOURCES: NE admin-0 riadok doplnený o obrys.
- **KARTA — K4 (časť 2): blesky pri sídlach z hlásenia GŠ** (2026-09-20, user: „K4 ale s maximálnym citom pre detail"). V štýle `karta` sa sídla menované v dennom hlásení Generálneho štábu (vrstva STRETY, `ukraineReportLayer.js`) kreslia ako blesk (kontakt) namiesto bodu; inde ostáva bod. `defaultBoltImage(css)` nakreslí bleskovú cestu (`BOLT_PATH` v štvorci 28) do plátna v DPR, sfarbenú intenzitou útokov (rovnaká škála `reportIntensityColor`: sivá/svetlá/jantár/červená), s tmavou svätožiarou a svetlým rámom; farbu pečie priamo (billboard.color biely), obrázky sa cachujú podľa css. Veľkosť `boltSizePx(attacks, mentions)` = základ 15 px + jemne podľa intenzity (log) a počtu zmienok, strop ~26 px. Bod aj blesk sú na TEJ ISTEJ entite sídla (spolu s popiskom), takže zdvih na terén platí pre oba; `applyPlaceStyle` prepína `point.show`/`billboard.show` a odstup popisku (`placeLabelOffsetX`: pri blesku od jeho polovice + 4, inak 8). Dohľad blesku `REPORT_BOLT_FAR_M` 460 km s doznievaním (`translucencyByDistance`) a zmenšením (`scaleByDistance`), aby sídla pri oddialení nesplynuli do fľakov. `setStyle('karta'|'default')` v report layeri, wiring v `main.js` `applyUkraineZoneStyle` vedľa KONTROLA/DeepState (`ukraineReport.setStyle(mode)`). Bez `boltImageFactory` (Node/headless) ostáva bod. Krížené meče + počet útokov pri smeroch ostávajú ako súhrn. Overené naživo (STRETY na KARTE nad Lymanom): 24 sídiel = 24 bleskov, body skryté; prepnutie na OSM → 24 bodov, blesky skryté; späť na KARTU → blesky; bez chýb v konzole. Testy: `boltSizePx`, `placeLabelOffsetX`, `defaultBoltImage`, a build (blesk sfarbený intenzitou, prepínanie štýlu, dohľad, headless = bod). **K4 časti 1 (odznaky ciest) + 2 (blesky) HOTOVÉ**; ostáva len K4 šípky útokov — až po súhlase DeepState. Ďalej K5 (titulok, legenda, prehľadová mapka, export, čistá karta).
- **KARTA — K4 (časť 1): odznaky ciest (road shields)** (2026-09-20, user: „K4 ale s maximálnym citom pre detail"). Malé štítky s číslom cesty ako na Rybarovej mape, len v štýle `karta`. V `ukraineBaseLayer.js`: kód sa latinizuje (`roadRefDisplay`: М-03 → M-03, cyrilika → latinka), triedu určuje prvé písmeno (`roadRefKind`: M/H = national modrá, E = european zelená, P/T/O/C/A/R = regional oceľová, inak other sivá), `roadShieldSpecs` vráti primárny kód + prípadné druhé európske číslo (dva odznaky vedľa seba ako reálne značenie). Odznak kreslí `defaultRoadShieldImage` do plátna v DPR (zaoblený obdĺžnik, tmavá svätožiara, svetlý vnútorný rám, tučný sans; farbu aj text pečie priamo, billboard.color ostáva biely) a vracia `{image,width,height}`; obrázky sa cachujú podľa signatúry. Umiestnenie: jeden odznak na (kód, bunku 1°) na NAJDLHŠOM úseku v bunke (`roadPolylineLengthDeg`/`roadPolylineMidpoint` = bod v polovici dĺžky, nie počtu bodov) → odznak sa opakuje pozdĺž dlhej cesty ≈ každých 100 km a je vždy blízko pohľadu. Číselné miestne kódy (napr. „885") na `secondary` cestách sa vynechajú (šum). Dohľad `min(farM triedy, ROAD_SHIELD_FAR_M 380 km)` s doznievaním (`translucencyByDistance`) a zmenšením (`scaleByDistance`) na okraji, takže pri oddialení mapu nezaplavia; zapnutie/vypnutie v `setStyle` (`applyRoadShieldVisibility`). Hover odznaku ukáže tú istú kartu ako čiara cesty (`_byEntityId`). Namerané: celý front = 1 583 odznakov, na pohľade smeru Lyman (159 km, −64°) ich je na obrazovke 37 (M-03 sa opakuje v troch bunkách, P-78/79 a T-21-xx okolo). Testy: `roadRefDisplay/roadRefKind/roadShieldSpecs`, geometria, `defaultRoadShieldImage` s falošným plátnom, a build (odznak len s ref, skrytý v default, viditeľný v karta, dohľad = strop). Odznaky používajú sans (nie Plex Mono) — v duchu odporúčania „sans na mape". Ďalej K4 časť 2: blesky pri sídlach z hlásenia GŠ; šípky útokov až po súhlase DeepState.
- **UKRAJINA — LIVE obnova zónových snímok (kontrola + DeepState)** (2026-09-20, user: „daj hodinovú ak to má zmysel"). Doteraz `applyControl`/`applyDeepState` v `ukraineTimeline.js` mali strážcu `if (day === _controlDay) return`, takže v LIVE sa snímka toho istého dňa nikdy nenačítala znova — front sa hýbal len pri zmene dňa alebo pri prepnutí čipu. Archivár pritom ťahá DeepState každú hodinu a Wikipédiu každých 6 h. Teraz: v LIVE sa ten istý deň pri každom 60 s tiku (a každom `load()`) pýta znova, ale iba pri inej identite snímky (`sameZoneSnapshot`: kontrola podľa `revisionAt` revízie Wikipédie, DeepState podľa `at` upstream snímky) sa raster/polygóny prestavajú — inak sa nič nekreslí nadarmo. Zlyhaná obnova (sieť) nechá poslednú snímku aj text legendy na mape (nezmaže front pri výpadku). V prehrávaní sa ten istý deň nepýta znova (strážca `state.mode !== 'live'`). Aby obnova naozaj dosiahla server, klientský sklad `createUkraineEventStore` skrátil `controlTtlMs` 60 → 15 min (platí pre kontrolu aj DeepState; payload ~260 kB je za proxy s `max-age=60`, takže ≤ 15 min latencia a lacno). `_controlTask`/`_deepstateTask` bránia súbežnému dvojnásobnému dopytu. Test „LIVE obnova zón…" v `ukraineTimeline.test.mjs` (tik prekreslí len pri novej revízii, chyba nechá mapu, prehrávanie sa nepýta) + export `sameZoneSnapshot`.
- **KARTA — K3 follow-up: city glow fades with camera distance** (2026-09-20, user: „neviem čo sú tie červené fľaky" over a theatre-scale view of eastern Ukraine). The glow billboards are sized in screen pixels (26–70 px), so from ~500 km every town from 10 000 inhabitants painted a fixed-size red disc and hundreds of them merged into blotches over Kharkiv, Dnipro, Poltava or Kryvyi Rih — places where a glow has nothing to say. Fix in `ukraineBaseLayer.js`: `GLOW_FULL_M` 240 km (full strength; a front direction preset sits ~180–230 km from the camera at −64°), `GLOW_GONE_M` 480 km — between them `translucencyByDistance` 1→0 and `scaleByDistance` 1→0.45, `distanceDisplayCondition` ends at 480 km, so the theatre view draws no glow at all. Verified in the pane on KARTA: preset (159 km, −64°) glows on, 340 km nadir faint halos, 600 km nadir none; the uniform red in the east is the soft Wikipedia RU raster, which is correct. Test extended (the K3 test checks the NearFarScalar ranges and the DDC). Front-line dynamics for the record (asked by the user the same day): both zone layers are day snapshots picked by the timeline cursor — Wikipedia control = nearest archived revision on or before the cursor day (241 snapshots since 2022, archiver every 6 h, weekly backfill via CLI), DeepState = nearest archived day on or before (hourly archive since 19 Sep 2026, older days answer 404 → „no snapshot" line; the history endpoint needs DeepState's consent); a redraw is a step per day, no interpolation between snapshots; settlement pins recolour on every snapshot change. Known gap: in LIVE mode a newer snapshot of the same day is not re-fetched until the day changes or the chip is toggled.
- **Public access through a Cloudflare Tunnel, noindex everywhere** (2026-09-13, user: „daj mi to zatiaľ pod doménu uhrin.digital cez CF tunel, ale SEO noindex"). The dev server keeps binding to localhost only (the CLAUDE.md rule stands): `cloudflared` on this machine — already serving the user's other tunnels — forwards `https://oko.uhrin.digital/` to `http://localhost:4173`. Setup script `scripts/oko-tunnel-setup.ps1` (idempotent, no secrets): named tunnel `oko` (id `b1f2ad76-c2a8-4981-88b2-80819a01d979`, credentials JSON in `~/.cloudflared/`, never read by the agent), `~/.cloudflared/config-oko.yml` (ingress hostname → localhost:4173, catch-all 404, log `oko.log`), Scheduled Task „OKO Cloudflare Tunnel" (at logon, current user, auto-restart, like the „OKO dev server" watchdog). App side: `server.allowedHosts` gained `.uhrin.digital` (any other Host still gets 403), `noIndexPlugin()` is the first Vite plugin (dev and preview) and puts `X-Robots-Tag: noindex, nofollow, noarchive` on every response and serves `/robots.txt` = `Disallow: /`, `index.html` carries `<meta name="robots" content="noindex, nofollow, noarchive">`; tripwires in `src/noIndex.test.mjs`. Lesson: `~/.cloudflared/cert.pem` is bound to ONE zone chosen at `cloudflared tunnel login` (here palmshub.net), so `cloudflared tunnel route dns oko oko.uhrin.digital` silently created `oko.uhrin.digital.palmshub.net` → the script now only prints the CNAME to create (`oko` → `<tunnel-id>.cfargotunnel.com`, proxied) unless `-RouteDns -OriginCert <zone cert>` is given. Done afterwards with the user logged into the Cloudflare dashboard in the Browser pane (the agent clicked, never saw a secret): CNAME `oko` → `<tunnel-id>.cfargotunnel.com` (proxied) in the `uhrin.digital` zone, the stray `oko.uhrin.digital.palmshub.net` record deleted, and — briefly — a Zero Trust Access self-hosted application `oko` with an e-mail one-time-PIN policy. The user wanted the address open („chcel som plný prístup") and the OpenAI voice key is not configured on this machine, so the Access application was deleted again the same evening; the lesson is recorded (ask before adding a login gate the user did not ask for). End-to-end after that: `https://oko.uhrin.digital/`, `/robots.txt` and `/api/gas/status` answer 200 through Cloudflare (CF-RAY VIE) with `X-Robots-Tag`, no redirect. What still bounds abuse of the open URL: noindex everywhere, the Google key's referrer + Map Tiles-only restriction, the Map Tiles daily quota and billing alert, rate limiters in the proxies, and the fact that GIE/ENTSOG/AISStream feeds are free.
- **First-run „Slovenský prehľad" tile now drives the gas layers, not the SK power grid** (2026-09-14, user on the new domain: „zobrazuje sa starý build s elektrifikačnou sústavou pre SK a plyn pre SK"). Cause: a new origin has no stored layer state, so the first-run launcher appears and its `sk-overview` mission enabled `shmu-radar` + `local-energy` (Energetika SR = 400/220 kV lines and SK gas mains) — exactly what the user had switched off in the pane's own stored state on 2026-09-13. `FIRST_RUN_MISSIONS['sk-overview'].layerIds` is now `['shmu-radar', 'gas-flows', 'gas-pipelines']` (ENTSOG border stations with cards, OSM pipeline snapshot); the tile subtitle in `index.html`/i18n says „Zrážkový radar SHMÚ, plynové stanice a plynovody"; both voice-tool layer enums (`set_layer_visibility`, `show_data_layers_menu`) gained `gas-flows` and `gas-pipelines` and the common-name mapping sentence routes „gas pipelines/plynovody" to `gas-pipelines` and „gas flows/border stations/toky plynu" to `gas-flows` (the frozen tool-schema pin in `firstRunExperience.test.mjs` was re-derived: 31 541 bytes); `gevActions.js` aliases: „pipelines" → `gas-pipelines`, „energy/energetika/power grid" stay on `local-energy`, which remains in the panel for a manual switch-on. A browser that already chose the old tile keeps `local-energy` ON in its stored state until the row is switched off once.
- **The public address now serves a production build; the dev server keeps only `/api`** (2026-09-14, user: „veľmi pomaly to načíta"). Measured through the tunnel: the dev server pushed the unbundled Cesium dep (10.3 MB, 2.0 MB zstd, 1.5 s), `ui.js` (0.5 MB zstd) and hundreds of `/src/*.js` modules at ~100 ms each, all over the home uplink. Now `vite build` (12 s, `dist/` 38 MB incl. the copied Cesium assets; index chunk 620 kB gzip, regions 684 kB, egm96 geoid 1.85 MB, marine 223 kB) is served by `scripts/oko-static-server.mjs` — a dependency-free Node server on 127.0.0.1:4174 (hashed `/assets/*` immutable for a year so Cloudflare keeps them at the edge: second fetch of the index chunk was an edge HIT in 0.14 s; `index.html` `no-cache` so a new build shows at once; `X-Robots-Tag` and `/robots.txt` like the dev plugin; no traversal, no listing) — and `~/.cloudflared/config-oko.yml` routes `^/api(/.*)?$` to the dev server on 4173 and everything else to 4174. One process keeps the live feeds (AISStream, OpenSky, the SQLite recorder): `vite preview` was rejected because only 14 of 28 proxy plugins have a preview hook and a second full server would double every feed. `scripts/oko-publish.ps1` = build → (re)register and restart the Scheduled Task „OKO public static" → rewrite the ingress → restart the tunnel task; `-SkipBuild` reuses `dist/`. Publishing is therefore a deliberate step: localhost:4173 stays live-reloading, the domain shows the last published build. Tests: `src/staticServer.test.mjs` spawns the server on a free port (index/asset headers, ETag/304, robots, 404, traversal, `/api` → 502, HEAD, 405). Google Maps key (project oko-dev, „Maps Platform API Key", API restriction Map Tiles API only — confirmed on a fresh load before saving, so the console's „usage detected for geocoding / street view" warning concerned calls that were already blocked): website restriction `https://oko.uhrin.digital/*` added next to `http://localhost:4173/*` with the user logged into Google Cloud Console in the pane (the key value was never shown). Not checked: Cesium ion token „allowed URLs" (the tokens page prints token values, so the agent stays away from it — if ion tiles fail on the public host while they work locally, that is the place). A second stray record `nextcloud.uhrin.digital.palmshub.net` (older, not ours) sits in palmshub.net. Route `/api/gas/lng-fleet` in `gasProxy()` reads `_aisStreamVessels` of this dev-server session and **never** calls `ensureAisStreamConnection()` — the feed is started (and paid for in bandwidth) only by the Live AIS Vessels layer; without it the answer says `feed.active:false` and the card shows „feed AIS nebeží" with a ZAPNÚŤ AIS button (`onEnableAis` in `ui.js`, reload after 8 s). Payload: prefiltered rows (mmsi, name, IMO, confidence + reason, Wikidata ship record, length, draught, speed, course, nav status, destination, ETA, position, fresh/last-known), counts (scanned, lng, confirmed, likely), feed state, list provenance; `no-store`. Card `fleet` after LNG in `src/gasPanel.js`: headline count, „potvrdené n · pravdepodobné n · smerujú na terminály EÚ n · v pohybe n", rows sorted EU-bound → confirmed → fresh (flag from MMSI via `mmsiFlag`, confidence, „→ EÚ", length · built · speed · destination · ETA · age; reason and operator as the note), OBNOVIŤ button, own 10-minute timer (`LNG_FLEET_REFRESH_MS`), row click = `onFlyToVessel` in `ui.js` (enables the ships layer, `selectById(mmsi)` now and after 6 s, camera 40 km above). Tests: `lngFleet.test.mjs` (index, tanker type, classifier incl. negatives — „GAS" alone is LPG, Höegh car carrier, BW under 250 m —, payload, feed states, model sort and texts, fetch, list integrity: ≥ 200 ships, 7-digit unique IMO, CC0 in SOURCE.md), panel test (card, fly-to, refresh, off state with the enable button, error path, tripwires: route present and free of `ensureAisStreamConnection`, `no-store`, ui hooks, CSS, i18n).
- **Public-address console clean-up** (2026-09-14, user pasted the DevTools console of oko.uhrin.digital: `GET /assets/local_data/flags/4x3/tr.svg 404`, `POST /api/openai/hud-summary 503` every 15 s, `WebSocket wss://oko.uhrin.digital/ failed`, sporadic `502`, Google 3D `403`). Four causes, three fixes. **Flags** — `countryFlags.js` built the flag directory from `import.meta.url`, which in the bundle is `/assets/index-<hash>.js`, so the build pointed at `/assets/local_data/flags/…` that `vite build` never emits; the SVGs now live in **`public/flags/4x3/`** (Vite public dir: served verbatim in dev and copied into `dist/`), `flagUrl()` returns `${BASE_URL}flags/4x3/<iso2>.svg`, `scripts/fetch-flags.mjs` writes them there (tables + provenance stay in `src/data/local_data/flags/`). **HUD summary** — `src/hudSummaryPolicy.js` (`classifySummaryFailure`): a 503 whose body says `OPENAI_API_KEY is not set`, or a 401/403, marks the AI summary off for the session (`hud._summaryDisabled`, one `console.info`), the composed local summary stays; 502/5xx/429 keep retrying as before. **Voice hint** — `fetchRealtimeToken` tags the thrown error with `code` (`classifyTokenFailure`: 503 + "not set" → `voice-unconfigured`, 403 → `voice-forbidden`), `createErrorRecord` keeps it, and `reportError` swaps the static "check microphone and network" line for `voice.error-hint-unconfigured` / `-forbidden` (`voiceErrorHintKey`). **502s** — cloudflared's log showed `wsarecv: An existing connection was forcibly closed` on 4173 in bursts (six at one second), never on 4174: Node closes idle keep-alive sockets after 5 s while cloudflared pools them for 90 s, and when the dev server's event loop is blocked for a moment the timer fires exactly as the next request lands → RST → 502; `originKeepAlivePlugin` (vite.config.js) and the static server now hold idle connections 120 s (`headersTimeout` 125 s), i.e. longer than the proxy. **The main cause of the slow `/api` was outside the code:** every Task Scheduler task runs at priority 7 = **BelowNormal** by default, so on a busy machine (Docker terrain tiling, Edge with Cesium, the Hermes agent, Defender) the dev server got almost no CPU — `/robots.txt` took 3–10 s or timed out, `/api/*` 80–100 s, the tunnel answered 502; switching the running dev server, static server and cloudflared to Normal (`PriorityClass`) dropped `/robots.txt` to 2–5 ms at once. The three tasks now have `Settings.Priority = 4` and `install-oko-server-task.ps1`, `oko-publish.ps1`, `oko-tunnel-setup.ps1` register with `-Priority 4` (tripwire `src/schedulerTasks.test.mjs`, which also pins the UTF-8 BOM of those scripts). **Second cause, in the code:** `GET /api/history/status` ran `SELECT COUNT(*) FROM fixes` over 25 M rows synchronously (`node:sqlite`) — 42 s during which the whole dev server stood still (`/robots.txt` took 30 s); `flightHistoryStore.js` now keeps `fixes_count` / `legs_count` in a `meta` table updated inside the same transactions as the inserts and the pruning (the full COUNT runs once at the first open without `meta`, or on demand via `store.recount()`), MIN/MAX(t) stay on the `fixes_t` index, so `status()` is O(1). **Not bugs:** the `wss://oko.uhrin.digital/` failures are Vite's HMR client in a tab that loaded the page *before* the switch to the static build (the build has no WebSocket at all — verified: no `ws` entries in the tunnel log after a fresh load); the Google 3D Tiles `403` is the known EEA block with the Cesium ion fallback taking over (see Fáza 0).
- **Photorealistic tiles: `dynamicScreenSpaceError` off** (2026-09-15, user with an oblique low view of Bratislava castle: „prečo mi nevykreslí dobre google mapu?" — a torn, scrambled band across mid-screen). CesiumJS enables `dynamicScreenSpaceError` by default on 3D tilesets; it inflates the allowed screen-space error for mid/far tiles to save load, and at a near-ground oblique angle (~450 m altitude, −28° pitch) it selects coarse ancestor tiles whose simplified mesh renders as spiky torn geometry. Diagnosed live in the pane (single ion-fallback tileset, `tilesLoaded: true`, nothing pending — so it was the *final* LOD, not a loading glitch): toggling `dynamicScreenSpaceError` off refined tiles from 76 to 133 selected and the mesh went crisp; `foveatedScreenSpaceError` left at its default `true` (it only softens screen edges, hidden by the scope mask). Fixed in `PHOTOREAL_TILESET_OPTIONS` (`src/photorealTileset.js`), so both the Google and the EEA ion-fallback path get it; tripwire in `photorealTileset.test.mjs`. Verified on the freshly published build.
- **Mobile shell — the whole app is responsive** (2026-09-14, user on a phone at work: „nevedel som sa preklikať… celý web má byť responzívny", picked option A). `src/mobileShell.js` (`initMobileShell` from `main.js`, `window.__okoMobileShell` for diagnostics) resolves a shell mode from `innerWidth`/`innerHeight` + `(pointer: coarse)`: **mobile** when the width is ≤ 900 px or a touch device is ≤ 1180 px wide (phone portrait, phone landscape, tablets), **landscape** additionally when the viewport is ≤ 520 px tall and wider than tall. In mobile mode `body.oko-mobile` hides `#left-panel-stack`, `#right-context-rail`, `#pp-toggles`, `#cctv-panel`, the Intel HUD (and its DISPLAY toggle), `#style-indicator` and the title subtitle; the title bar, `#top-center-actions` and `#lang-switch` shrink into one top row; the command dock, toast, view switcher and cockpit entry lift above a fixed bottom **app bar** `#oko-appbar` (static markup in `index.html`, Material Symbols, i18n keys `mobile.*`) with five sections — **Vrstvy** (`#data-panel`), **Scény** (`#scene-panel`), **Dáta** (`#gas-panel` + `#history-panel`), **Zobrazenie** (`#pp-toggles` + `#cctv-panel` + `#global-context-panel`) and **Hľadať** (expands the dock's location bar and focuses `#location-search`; no sheet). Tapping a section opens `#oko-sheet` (a bottom sheet, max 62 dvh, above the dock lift; in landscape a 430 px / 72 vw drawer from the right): the section's panels are **re-parented into the sheet body** (same DOM nodes, ids and listeners intact — the StyleManager rig ignores them there because they are no longer children of the stack or rail), the first panel is expanded and the others stay collapsed as tappable headers (`setPanelCollapsed(id, …, { persist: false, syncShare: false })`), and closing (× button, backdrop tap, Escape, swipe down on the sheet head ≥ 80 px or ≥ 30 px at ≥ 0.5 px/ms — `swipeShouldClose`) restores each panel before its original next sibling with its original collapsed state; one sheet at a time, the dock is hidden while a sheet is open, and switching back to desktop closes it. `.oko-in-sheet` CSS neutralises the panels' fixed positions, widths and inline max-heights and hides their tab-collapse `◀` buttons. Touch extras: `scene.pick()` is wrapped on coarse pointers so every pick box is at least 18 px (`installCoarsePickBox`, own property over Cesium's prototype — covers the Viewer's default click and the layers' handlers), the detection hover card is skipped on coarse pointers (an emulated mousemove would open the hover card and the tap card together), `#cesiumContainer { touch-action: none }` keeps pinch/drag for Cesium, the viewport meta carries `viewport-fit=cover` with `env(safe-area-inset-bottom)` on the bar, and the world overlay host got `setWorldOverlayLaneSuppressed(laneId, …)`: the shell suppresses the `ambient-card` lane on mobile (custom painters and queued entries of that lane are skipped, no hit rects), so only the selected and tracked cards paint on a phone. The first-run launcher becomes a bottom list above the bar with 56 px tiles. Follow-up the same night (user at 827 px: „toto sa prekrýva"): in mobile mode the dock's tray labels are icon-only (the „Vizuálne predvoľby" title was 160 px wide inside a 68 px tray and ran under the voice pill) and the shell lifts `#cesium-credits` inline to `lift + dock height + 8 px` (136 px by default) so the Cesium/Google credit line sits above the dock instead of in its band — both elements are modelled by `creditAttribution.test.mjs`, which is why the lifts are inline styles rather than CSS rules. Verified live in the Browser pane at 375×812 (bottom sheet: LAYERS, DISPLAY), 844×390 (right drawer: SCENES, search), 768×1024 (tablet sheet) and 1440×900 (desktop untouched: no body class, bar hidden, stack/rail/HUD displayed). Tests: `src/mobileShell.test.mjs` (mode table, swipe thresholds, pick box wrapper, re-parenting round-trips with a fake DOM, one sheet at a time, desktop switch closes, inert without markup) and `src/overlays/worldOverlayLaneSuppression.test.mjs`. Known limits: the Cockpit view keeps its own layout; the HUD is simply off on mobile (no compact variant yet); panels inside the sheet keep their desktop typography.
- **First-run launcher is opt-in now** (2026-09-14, user on the public address circled the „Vyber si svoj prvý pohľad" card: „toto úplne zruš alebo to daj hidden, aby sa to pri načítaní neobjavovalo — neviem, načo je to"). `FIRST_RUN_AUTO_SHOW = false` in `src/firstRunExperience.js` makes `shouldShowFirstRun()` return false unless the URL carries `?welcome=1` (the demo/support replay still works, a share link still outranks it); `initFirstRunExperience` therefore removes the `#first-run-launcher` node on every ordinary load. The module, its missions (`FIRST_RUN_MISSIONS`, incl. `sk-overview`) and the tool-schema pin stay untouched for the replay path. A fresh visitor now starts with the layer registry defaults, not with a mission.
- **Sharing with a picture, also for social networks (A+B)** (2026-09-14, user: „pri zdieľaní hocijakej časti systému sa musí objaviť aktuálne image presne toho, čo zdieľam… aj na soc. siete", picked A+B). Three layers. **Subject in the link** — `src/shareSubject.js`: the hash carries `subj=<layerId>.<kind>.<id>` (`t` = tracked via `trackById`: `flights`, `military`, `satellites`; `s` = selected via `selectById`: `ais-live-vessels`, `gas-flows`, `earthquakes`), read from `getTrackedSubject()` / `getTrackedInfo()` first and the context store's selected record second (`subjectIdFromContextId` strips the `ais-` / `gas-flows:` prefixes), written by `ShareLinkManager.setSubjectStateProvider` (ui.js also refreshes on `gev:entity-selected` / `gev:entity-selection-cleared`; tracking moves the camera, which already rewrites the hash) and restored by `ui._restoreShareSubject` after `onRestore`: `applyShareSubject` enables the layer if needed and retries every 1.5 s for 30 s while the live layer has no such object, giving up as soon as the user selects something else; `gasFlowsLayer` gained `selectById(key)` / `getSelectedKey()`. **Snapshot + panel (A)** — the share button now opens `src/sharePanel.js` (DOM built without innerHTML, so it is unit-tested with a fake document): `ShareLinkManager.buildShareUrl()` (long link with `at`), `captureShareSnapshot` (`src/shareSnapshot.js`: `renderFreshCesiumFrame`, the Cesium canvas plus every `#world-overlay-root canvas` composited into 1200×630 with a centred cover crop, a bottom strip with `OKO · <date>` and `buildAttributionLine(#cesium-credits text)` = „© Google · Cesium ion …" because the Map Tiles terms require attribution on shared images, JPEG re-encoded down to ≤ 400 kB), then `publishShareSnapshot` → `POST /api/share`; the panel shows the preview, the short link (or the long one with a toast when the server is unreachable), Copy link, Copy picture (`ClipboardItem` PNG), Share… (Web Share with the PNG as a file — Instagram/TikTok/stories), Save picture, and eight network intents from `buildShareTargets` (Facebook, X, LinkedIn, Threads, Bluesky, WhatsApp, Telegram, e-mail); title/description come from `buildShareCopy` (subject label, `#location-mini-city`, enabled layer names, time). i18n `share.*`. **Server (B)** — `src/shareStore.js` + `sharePlugin()` in vite.config.js: `POST /api/share` validates the payload (hash ≤ 4 096 chars of the URLSearchParams alphabet with `lat=`, JPEG magic bytes, ≤ 400 kB, 200–4096 px, texts trimmed of control chars), rate-limits 30/h per IP and 300/h globally keyed by `CF-Connecting-IP` behind the tunnel (the socket is always `::1` there), stores `<id>.json` + `<id>.jpg` under `.gev-cache/share` (junction → D:) with a random 10-char base62 id and 90-day retention (pruned on save, once an hour), and answers `{ id, url, image }` with the origin derived from `Host` + `X-Forwarded-Proto`; `GET /s/<id>` renders `renderSharePage`: Open Graph + Twitter `summary_large_image` tags with absolute image URL, `<meta name="robots" content="noindex">`, a meta-refresh and `location.replace` into `/#<hash>`; `GET /s/<id>.jpg` is immutable for a year. Because social crawlers must be able to fetch the share pages, both robots.txt files (dev `noIndexPlugin`, `scripts/oko-static-server.mjs`) now read `Disallow: /` + `Allow: /s/`, the `X-Robots-Tag` header is skipped for `/s/<id>` and the tunnel ingress in `scripts/oko-publish.ps1` routes `^/(api|s)(/.*)?$` to the dev server. Verified live on localhost: the panel showed the actual 3D view with the strip, a short link, eight networks; `/s/<id>` served the OG tags and the JPEG. Tests: `shareSubject`, `sharelink.subject`, `shareTargets`, `sharePanel`, `shareStore`, `shareServer` (tripwires), updated `noIndex` / `staticServer` / `gasFlowsLayer`. **First real Facebook post (same evening) showed only the bare domain** — three follow-ups: (1) the share page no longer carries `<meta http-equiv="refresh">` — Facebook's scraper follows meta refresh (unlike JavaScript) and landed on the root without the hash and without OG tags; the redirect is `location.replace` only, with a plain link for no-JS readers; (2) the root page got default Open Graph / Twitter tags with `public/share-default.jpg` (1200×630, generated by `scripts/build-share-default-image.mjs` with sharp: logo, OKO, SK+EN subtitle, domain), so a pasted root URL or a long hash link still gets a card; (3) robots.txt on both servers is now `Disallow: /api/` + `Allow: /` — the earlier `Disallow: /` hid the pages from the social crawlers (X and LinkedIn honour robots.txt) and would have let Google list the URL without content anyway; "no index" is carried by the `noindex` meta and the `X-Robots-Tag` header (still skipped only on `/s/<id>`). The panel also got a highlighted warning note plus a „Skúsiť znova" button whenever only the long link is available, console warnings for a failed snapshot/upload, and the server logs each stored share.
- **`img.decode()` never settles in a hidden tab** (2026-09-10, found live while chasing "Historical Ship Density will not switch on"): three layers awaited `img.decode()` before handing the element on — `densityDrape.js` (ship + air density), `shmuRadar.js` (radar frames) and `meteoLayer.js` (every GFS field and every timeline step). Measured in the browser with `document.visibilityState === 'hidden'`: the PNG fetched in 7 ms, `onload` fired, `complete` was true and `naturalWidth` was 1440, yet `decode()` had still neither resolved nor rejected after 6 s — identically for a detached image and one appended to the document. Because the promise never SETTLES, the existing `.catch(() => {})` and `.then(ok, fail)` guards could not help, so `enable()` never returned and the manager left the layer in `enabling` forever; the maritime-context panel, which awaits all three of its layers, stayed frozen with both buttons disabled. Anyone who switches browser tabs while a layer loads hits this, and it does not clear on return. Fix: new `src/data/imageDecode.js` with `awaitImageDecode(img)` — `decode()` may delay the result but can never decide it. It is skipped entirely when `document.hidden` (it provably will not run there, and meteo loads an image per forecast step), raced against `DECODE_BUDGET_MS` = 1 500 ms otherwise, and always resolves, never rejects; `onload` plus `naturalWidth > 0` already guarantees a usable element for Cesium's texture upload. All three call sites now go through it, pinned by a tripwire that forbids a bare `img.decode().then/catch` in those files. Verified live in a hidden tab: the density layer reaches `enabled`. Not covered here: the manager has no lifecycle timeout, so a future layer that hangs in `enable()` will still wedge silently.
- **Ships: hover card + hover bracket, and why the world outside Europe looks empty** (2026-09-12, user: "lode okrem Európy nevidí skoro nikde, ani keď na ne prejdem myšou tak nič, a zameriavače ako u lietadiel"). Three separate things. (1) **Hover card** — `installContactHoverCard` resolves `module.getContactSummary(sourceId)` for every candidate and `hoverCandidatesFromPick` already emitted `{ layerId: 'ais-live-vessels', sourceId: mmsi }`, but the vessel module never implemented `getContactSummary`, so a ship pick resolved to nothing and the card stayed hidden. `aisLiveVessels.getContactSummary(mmsi)` now returns the flights-shaped summary the shared `hoverCardModel` renders without a vessel branch: ship name as headline, speed (knots × 0.514444 → m/s for the shared formatter) · course (true heading preferred, AIS sentinels 511/360 dropped), `UNDER WAY · CARGO · 121 m · PBXY` as the machine line (nav status in `operator`, normalised type + length in `type`, call sign in `registration`; `type` is never empty so the card never falls back to `t('aircraft.category.…')`), `→ ROTTERDAM` as route text, flag from the MMSI MID, `AISStream · fix age`, and last-known positions honestly flagged via `stale` ("bez fixu — odhad"). Verified live: hovering CALYPSO shows the card. (2) **Hover bracket** — detection asks non-flight layers for at most `LAYER_CANDIDATE_CAP` = 2 600 objects by deterministic stride; with ~33 000 ships on screen that is one in thirteen, so the hovered ship was usually not in the cohort and `_isHoveredObject` had nothing to light (flights never hit this: they get `maxCount` Infinity). `_collectDetectableObjects` now passes `hovered: _hoverCandidates` and the vessel `getDetectableObjects` force-includes hovered and selected vessels on top of the stride sample (`maxCount` budgets the sample only); tripwire in `detectionHover.test.mjs`. Verified: the hovered ship is in the forced cohort and absent from the plain one. (3) **Coverage** — not a bug: the server holds 50 000 vessels (the retention cap) and `selectAisCoverage` balances 30° cells round-robin, but terrestrial AISStream simply carries 69 % of contacts in Europe, 17 % in North America, ~5 % East Asia, and a few hundred in the whole Middle East / South America (measured 2026-09-12: EU 34 416, NA 8 728, E-Asia 2 265, Oceania 1 515, Africa 748, S-America 450, Gulf 429, S-Asia 24); 19 000 of the 50 000 are last-known. That is exactly the gap the historical ship-density layer fills. At world zoom the 44 000 ship glyphs render at ~9 px, so the eye reads Europe as a smear and the rest as scattered dots.
- **Satellite AIS · delayed (Global Fishing Watch)** (`src/data/gfwPresence.js`, `src/data/gfwPresenceCore.js`, `gfwPresenceProxy()` in `vite.config.js`, layer `gfw-presence`, token `7`, 2026-09-12; user: "potrebujem aktuálne dáta alebo len trochu staré" after the live-AIS count for the Persian Gulf and Hormuz came back as **zero** — terrestrial AISStream has no receivers there). The user chose GFW over a paid minute-latency feed. **What it is:** the 4Wings report `POST /v3/4wings/report` on `public-global-presence:latest`, `spatial-resolution=HIGH` (0.01° cells), `temporal-resolution=HOURLY` (one row per vessel-hour-cell — the ONLY temporal mode that carries a time per cell, `Time Range` = `2026-09-08 04:00`), `format=CSV` (the reply is a ZIP with four members — the CSV, a readme, GFW's AIS-considerations PDF, the query geometry — read by the dependency-free `src/data/zipEntries.js`; 6× smaller than the JSON of the same report), `group-by=VESSEL_ID` (carries `Vessel Name`, `Vessel Type`, `Flag`, `CallSign`, `IMO`; `group-by=MMSI` carries none of them), custom GeoJSON polygon of the viewport in the body, `date-range` = the LATEST COMPLETE DAY only (`gfwPresenceDateRange`: D−4 in practice — on 2026-09-12 16:00 Z the days 4–8 Sept were available and the 9th was not) with an EXCLUSIVE end (`day,day+1`: `07,07` returns nothing and `06,07` only the 6th — the first version's "2-day window 07–08" silently fetched a single day and skipped the freshest one). The proxy parses the CSV (`parseGfwPresenceCsv`), keeps ONE row per MMSI = the vessel's LAST HOURLY CELL of that day (latest `Time Range`, ties → more hours: `latestGfwCellPerVessel`; `hours` becomes the vessel's total for the day, `firstSeen`/`lastSeen` its first/last hour; the identity fields name/type/flag/callsign/IMO are filled from any other row of the same MMSI, because one MMSI appears under several vessel IDs and the latest cell is often the anonymous one) and returns `{ rows, meta:{ range, day, requestedDay, delayHours:72, bbox, cellDeg:0.01, mode:'hourly', fallback:null, license, attribution } }`. **Fallback for busy seas:** when the ZIP exceeds 24 MB (≈ 20 000 vessels) or has no CSV member, the same day is re-fetched as `LOW` (0.1°) + `ENTIRE` + JSON (`GFW_MODES.dayCell`, `meta.mode:'dayCell'`, `meta.fallback:'too_large'`, `cellDeg:0.1`) — the cell with the most hours that day, honestly labelled as a day cell; an empty day steps back one day (max 2, `meta.day` ≠ `meta.requestedDay`). **Guardrails:** `GFW_API_TOKEN` server-only (503 `no_key` without it — the row shows the error, no crash); bbox required, expanded to whole degrees so a small pan hits the cache, max 40° per side (400 otherwise); memory + disk cache `.gev-cache/gfw/` TTL 6 h, serve-stale-on-error 48 h, single-flight per key, ZIP cap 24 MB / JSON fallback cap 32 MB, upstream timeout 90 s (the whole Gulf takes ~19 s); always-on limiter 20/min/IP (60 global); persistent daily counter `GFW_DAILY_REQUEST_BUDGET` (default 300 of the 50 000 allowed) with 429 `budget` past it; `GET /api/gfw/status` reports key presence and spend. **Client:** the layer registers right under Live AIS, queries only below 4 000 km camera height (status `zoom-in` above), re-queries on `camera.moveEnd` (1.5 s debounce) only when the whole-degree bbox changed, caps 6 000 points drawn EXACTLY like live vessels (2026-09-12, user: „doplň mená a sprav ako ostatné lode len pridaj poznámku oneskorené"): the same hull SVG (`shipIconDataUrl(vesselTypeCss(type))`, exported from `aisLiveVessels.js`) coloured by type family (cyan cargo/other, amber tanker, pink passenger, green fishing, yellow tug/service), `scale 0.6 × vesselTierScale(tier)` with the live-ship tiers (`airIconTier`: medium ≥ 300 km, micro ≥ 950 km) synced on `camera.changed` and `moveEnd` so the hull size follows the camera during flight, bow always north (a cell has no course), `disableDepthTestDistance` ∞ so cells never sink under terrain, pick id `{ mmsi, gfw:true, name }`. Name labels go through the shared world overlay (`setOverlayEntries('gfw-presence', …)`; `gfwLabelCard` builds `buildVesselCard`-shaped cards: title = name cut at 26 chars or the MMSI, flag from the MID, details `TYPE · ONESKORENÉ · 8. 9.` (the data day, `gfwDayLabel`: `8. 9.` in SK, `8 Sep` in EN), `applyVesselOverlayPolicy` with the same 300 km fade as live ships, on-screen cells only, max 300 by priority named > typed > hours, republished on every `moveEnd`). It never invents motion: no speed, no course. **Honesty (rule 2):** the panel row reads `Global Fishing Watch · satelitná prítomnosť AIS 0,01° · hodinové bunky · CC BY-NC 4.0 · ONESKORENÉ · dáta k 8. 9.` (`denné bunky` + `0,1°` in fallback mode); the hover card (same `getContactSummary` shape as flights/vessels) has the ship name as headline (MMSI when unnamed), the type, the callsign in the registration slot, puts `ONESKORENÉ · dáta k 8. 9.` on the machine line and `posledná hodinová bunka 0,01° · 8. 9. 11:00 UTC · 9 h v ten deň` as the route line (`denná bunka 0,1° (najviac hodín) · N h v ten deň` in fallback mode or without a time), and `lastContactEpochMs` = that hour, so the fix age is real; `hoverCandidatesFromPick` now emits both `ais-live-vessels` and `gfw-presence` for MMSI picks (GFW first when the pick id carries `gfw:true`), the resolver takes the first non-null summary; detection objects are `SEA` with `metric` = the delay label and hovered points forced into the cohort. Pick owner registered so a click on a cell never deselects a tracked aircraft. Attribution "Powered by Global Fishing Watch." in `dataCredits.js`; verbatim terms in `DATA_SOURCES.md`; placeholders in `.env.example`. Tests: `gfwPresenceCore.test.mjs` (bbox parse/quantise/limits, exclusive-end day window and step-back, report URL per mode, CSV records and 4Wings CSV rows, JSON normalisation, hourly/day-cell merge with identity fill), `zipEntries.test.mjs` (hand-built ZIP: deflate + stored members, sizes from the central directory), `gfwPresence.test.mjs` (registry/i18n/credit, source label, summary, label card, view bbox, layer lifecycle with fakes — hull SVG, colour by type, tier scale, `camera.changed` tier sync, overlay labels, hover, detection cohort — zoom-in and no_key paths, proxy tripwires). **First live run (2026-09-12):** the Gulf bbox 47–60 E / 23–31 N returned **5 890 vessels** for the 7–8 Sept window in 6.9 s (935 kB), 1 281 of them inside the Hormuz box — where live AISStream had **zero**; the viewport query at 1 300 km (46–62 E / 19–34 N) returned 6 172 rows, capped to 6 000 points. The first version used `group-by=MMSI`, which carries NO `shipName`/`vesselType`/`flag`; `group-by=VESSEL_ID` (same endpoint, same cells) carries them plus `callsign`/`imo` — 2 790 of 2 795 Hormuz rows named, and after the per-MMSI identity fill 5 829 of the 6 000 drawn points in the 1 300 km Gulf view (verified live: 620999679 showed as a bare MMSI in the wide view before the fill, now `TASNIM · CARGO · D6A3678`, Comoros flag from the MID). Unnamed rows keep the MMSI headline and type `VESSEL`; no Vessels API call is needed. The proxy caches the already-merged rows (`.gev-cache/gfw/<bbox>@<window>.json`), so a change to the merge needs that file removed to show up before the 6 h TTL (the key is now `<bbox>@<day>`). **Positions (2026-09-12, user: „prečo nemajú pozície?"):** with LOW + ENTIRE every icon sat at the centre of its 0.1° cell (visible columns across the Gulf) and, because ENTIRE stamps every cell of a vessel with the same vessel-level entry/exit, the "latest cell" was an arbitrary cell of the day's track (MANZAR2: 4 cells, all `04:00 → 07:00`); HOURLY carries the hour per cell, so the last hour's 0.01° cell is the vessel's real last position that day (~1 km). Measured: Hormuz 1 day HOURLY = 25 072 rows (anchored ships ≈ 21–24 rows/day) = 11.9 MB JSON vs 1.9 MB ZIP; the whole Gulf 103 291 rows = 7.3 MB ZIP in 18.6 s; datetime ranges (`2026-09-08T18:00:00Z,…`) work too if a "last N hours" variant is ever needed. Cold load in the pane 26 s, cached instant; verified live: 6 252 vessels for 8 Sept, TASNIM's card reads `posledná hodinová bunka 0,01° · 8. 9. 11:00 UTC · 9 h v ten deň`, and the Gulf overview shows lanes and anchorages instead of a lattice.
- **Radar ship detections · Sentinel-1 (Global Fishing Watch)** (`src/data/gfwSarDetections.js`, SAR helpers in `src/data/gfwPresenceCore.js`, `/api/gfw/sar` route of `gfwPresenceProxy()` in `vite.config.js`, layer `gfw-sar`, token `8`, 2026-09-12; user: „ako by sa dalo získať reálne dáta?" → „sprav tie radarové detekcie"). **What it is:** the same 4Wings report on `public-global-sar-presence:latest` — GFW's Sentinel-1 SAR ship detections, matched to an AIS identity where GFW could; a row with an empty `Vessel ID`/`MMSI` is a detection WITHOUT an AIS match (a vessel with AIS off, a small craft, a platform… — shown as `BEZ AIS` / `NO AIS MATCH`, never asserted as a "dark ship"). The only free source that sees vessels that do not transmit AIS. Request: `HIGH` 0.01° + `HOURLY` + CSV/ZIP (the hour is the pass time — over the Gulf ~02:00 and ~14:00 UTC, a pass every 2–3 days; the CSV's last column is `Detections` instead of `Vessel Presence Hours`) for the last 10 days (`gfwSarDateRange`: from = today−10, exclusive end = tomorrow, cache key `sar:<bbox>@<today>`), fallback `LOW` + `DAILY` + JSON (`GFW_MODES.sarDay` keeps the pass day — `normalizeGfwPresence` now takes the cell time from `date` when it is a single day/hour and leaves ENTIRE's comma range alone), no day step-back. The proxy is one `handleReport(plan)` for both routes (`PLANS.presence` / `PLANS.sar`: dataset, primary + fallback mode, merge, window, cache-key prefix, attribution). `latestGfwSarDetections` keeps the LAST PASS per object: per vessel (key `v:<MMSI|vesselId>`, identity filled across rows) or per 0.01° cell for unmatched detections (key `c:<lat>,<lon>`), detections summed over the window. Latest data day was D−3 (9 Sept on 12 Sept) — a day fresher than the AIS presence. **Rendering:** a hollow diamond "radar target" (`sarIconDataUrl`, cached per colour; the interior carries a 12 % fill because Cesium picks only opaque pixels — with a truly hollow diamond the `BEZ AIS` hover card did not open live) — matched: vessel-type colour with a centre dot; unmatched: white, no dot — scaled like hulls by `airIconTier` (`0.5 × vesselTierScale`), alpha by pass age (`sarAgeAlpha`: ≤3 d 0.95, ≤6 d 0.75, else 0.55), newest passes and matches win when the 6 000-point cap bites; name labels only for matched objects (`TYP · RADAR · 9. 9.`, max 200, same 300 km fade as live ships); hover card headline = name / MMSI / `BEZ AIS`, machine line `RADAR · 9. 9. 02:00 UTC · zhoda s AIS` (pass only when unmatched), type = vessel type or `RADAR`, route line `bunka 0,01° · N detekcií za 10 dní` with Slovak plural forms (1 detekcia / 2–4 detekcie / 5+ detekcií), `lastContactEpochMs` = pass time so the fix age is real; detection objects are `SEA`, klass = type or `RADAR`, metric `RADAR · 9. 9.`, unmatched keep `skipLabel:false` so the callout shows `BEZ AIS`. Pick ids carry `{ sar:true, key, matched }` and `hoverCandidatesFromPick` routes them only to `gfw-sar` — an MMSI must not fall through to live vessels, it is a different time. The panel row reads `Global Fishing Watch · radarové detekcie Sentinel-1 0,01° · posledných 10 dní · posledný prelet 9. 9. · 788 so zhodou AIS · 577 bez AIS · CC BY-NC 4.0`. Credits: "Powered by Global Fishing Watch." plus the Copernicus notice "Contains modified Copernicus Sentinel data <year>" (`dataCredits.js`, `DATA_SOURCES.md`). **Measured (2026-09-12):** Hormuz box 55–58 E / 25–28 N, 11 days: 1 828 rows, 0.40 MB ZIP, 15 s (655 without AIS); the whole Gulf 6 785 rows, 0.62 MB, 13 s; through the proxy Hormuz = 1 365 objects (788 matched, 577 without AIS), last passes 3, 6, 7 and 9 Sept, 26 s cold, then cached 6 h. `public-global-viirs-presence` (night-light detections) answers 403 for this token — needs a dataset access request. Vite trap: one config restart silently did not happen after the edit (status endpoint kept the old shape) — appending a newline to `vite.config.js` forced it; check `/api/gfw/status` after every proxy change. Tests: `gfwSarDetections.test.mjs` (registry/i18n/credit, icon and age alpha, source label, matched/unmatched summary and plurals, label card, lifecycle with fakes, zoom-in/empty/no_key, proxy tripwire) plus SAR cases in `gfwPresenceCore.test.mjs` and `detectionHover.test.mjs`. **Two traps from the rollout:** (1) Vite's `loadEnv` copies `.env` into `process.env` only for keys not already set, and a `.env` edit does not restart the Node process — after the placeholder line `GFW_API_TOKEN=SEM_VLOZ_TOKEN` had been loaded once, the real token in the file was ignored (`/api/gfw/status` now reports the non-secret `tokenLength`: 14 = placeholder, 780 = real) and upstream answered 401 until the dev server process was killed and the `oko-server.ps1` watchdog restarted it; a config edit alone (Vite restart) does NOT refresh an already-set key. (2) `formatTrack(null)` rendered `000°` because `Number(null) === 0` — fixed in `trackedCardModel.js` (null/undefined/'' → ''), which also protects live vessels without heading/course.
- **SHMÚ radar proxy: TLS chain fix** (2026-09-07, user circled the legend reading `SHMÚ RADAR · 20:40 UTC · STALE` — frames were six days old): `opendata.shmu.sk` serves only its leaf certificate; browsers and curl fetch the missing Sectigo DV R36 intermediate via the certificate's AIA URL, Node does not, so every slot failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` since 2026-09-01 and the layer served its disk cache as STALE. The proxy now fetches upstream through an `https.Agent` whose `ca` is Node's `tls.rootCertificates` **plus** the public intermediate bundled at `config/ca/sectigo-public-server-authentication-ca-dv-r36.pem` (provenance, fingerprint and expiry in `config/ca/SOURCE.md`) — verification stays strict, nothing is skipped; `fetchUpstream` keeps the fetch-like response shape, the timeout and the byte cap. Tripwire in `shmuRadar.test.mjs`.
- **Radar legend moved into the layer row; city lights got their own switch** (2026-09-07, user: "remove the SHMÚ legend, it does not belong there" — it floated bottom-left over the whole view, even over Italy where the radar covers nothing — and "put the city lights on a switch, with the glaciers, it is distracting"): the floating `#radar-legend` (markup, `_ensureRadarLegend`/`_syncRadarLegend` in ui.js, CSS) is gone; `shmuRadar.js` now exposes `getRowControls().legend` (dBZ stops straight from `radarLegendStops()`), so the scale renders in the Data-Layers row like the GIBS overlays, and time/STALE come from the row's standard meta line. City lights: `MapStackController.setCityLightsEnabled` is a second flag beside the Day/night master (`setNightLightsEnabled`) — off removes the Black Marble imagery layer on globe stacks and, on Google 3D, zeroes the shader's `u_lightsGain` via `syncPhotorealLights` while the night darkening stays (the "glaciers" the user saw were the 4096 px lights texture magnified at 20 km altitude into white blobs over the Alps). Display-panel `#night-lights-toggle` (default on, `localStorage` `oko-night-lights`), dimmed when Day/night is off. Follow-up the same evening ("it is crap — turn it off or do it properly"): done properly — on Google 3D the lights are a GLOBE-scale detail only: `PHOTOREAL_NIGHT_LIGHTS_GAIN.near = 0` and `PHOTOREAL_NIGHT_LIGHTS_RANGE_M = 400 km → 1 500 km`, so below ~400 km from the surface no lights are added at all and full brightness arrives at the same 1 500 km where the globe stacks switch lighting and the Black Marble layer on; the night darkening itself stays at every altitude. Final ruling the same night ("still crap, looks like clouds — turn it off"): city lights are **OFF by default** everywhere (globe Black Marble layer and Google 3D lights); the Display-panel toggle stays for whoever wants them, stored under the new key `oko-city-lights` (`1` = on) so no earlier "on" preference survives. Day/night darkening is unaffected.
- **Flight history: recorder, search, replay** (2026-09-07, user: "I want to find a flight retroactively, track it, with a good graphical display in the app style" — then "do not cut the data down", "a whole year"): `src/data/flightHistoryStore.js` (Node only, built-in `node:sqlite`, no dependency) records every OpenSky `/states` and adsb.lol `/v2/mil` response body the dev proxy already sends to the client — `flightHistoryProxy()` in `vite.config.js` wraps `res.end` of those two middlewares and MUST be registered before them (connect order; tripwire). Tables: `fixes` (PK icao24+t, values stored as scaled INTEGERs — lat/lon ×1e5, gs/trk/vr ×10 — ≈ 30 B/row; the same snapshot served twice from cache is skipped by `time`+count key, duplicate fixes by the PK) and `legs` (one row per airframe + callsign + ≤ 30 min gap: first/last seen, fixes, max alt/speed, squawks). Volume measured live: ~13 000 aircraft × 2 polls/min ≈ 37 M fixes/day ≈ 1.5–2 GB/day. Config in `.env` (read lazily — `loadEnv` fills `process.env` after the plugin is built): `FLIGHT_HISTORY_DB` (this machine: empty Samsung 870 QVO SSD `D:\oko-history`), `FLIGHT_HISTORY_RETENTION_DAYS=365`, `FLIGHT_HISTORY_RAW_HOURS=720` (8760 until 2026-09-13 — see the D: junction bullet) (raw ≥ retention disables the 2-minute thinning of fixes older than the raw window; defaults 7 d / 24 h keep the `.gev-cache` default small). Schema is versioned (`PRAGMA user_version`; a bump drops the dev cache). API: `/api/history/status|search?q=&hours=|track?icao24=&from=&to=|leg?id=`. Client: `src/data/flightHistory.js` (pure: compact rows → fixes, `trackSummary`, `interpolateFix` with lon/track wrap, `chartSeries`), `src/flightHistoryChart.js` (pure canvas: altitude area + speed line + cursor, HUD colours), `src/flightReplay.js` (Cesium: per-vertex altitude-coloured `PolylineGeometry` amber→cyan→white, marker billboard using the fleet silhouette + `screenProjectedRotation`, `ReplayClock` 1×/10×/60×/300× via rAF, follow = `viewer.trackedEntity`), `src/historyPanel.js` (left-rail `#history-panel`, order 5: search callsign/hex over 24 h / 3 d / 7 d, result list with emergency squawks flagged, detail with stats, chart, time slider, PLAY/PAUSE, speeds, FOLLOW, LIVE NOW → `trackById`). Right-click on an aircraft → "Flight history" opens the panel with its hex. Honest caveat: one SQLite file at ~13 G rows/year is at the edge — if inserts slow down, rotate to monthly files.
- **Contact icons on dark basemaps are FR24 yellow** (`contactPalette.js` `CONTACT_ICON_TINTS.dark = { civil: 'fr24', military: 'ember' }`, `TINT_FILLS.fr24 = #ffd21f`, 2026-09-06, user screenshot over night Europe: "the icons can't be white, they blend with the globe — like FR24"): once the night side carries Black Marble city lights (white-to-warm), white silhouettes vanished into them. The yellow is baked into the SVG like the light-basemap ink (never `billboard.color`, which would kill the red wing light); military keeps its identity as burnt orange (ember fill × amber billboard tint) on dark too; fleet 3D models follow the same swatch (`MODEL_TINTS` in flights.js). Tracked aircraft, TR-3B and the light-basemap palette are unchanged.
- **NASA GIBS science overlays over any globe basemap** (`src/data/gibsOverlays.js` catalog + factory, `src/data/gibsOverlayPanel.js` group "Earth from satellite (NASA)", 2026-09-06, user "urob 2"): five DATA layers — sea surface temperature (GHRSST MUR L4, Level 7), precipitation (GPM IMERG, Level 6), snow cover (MODIS NDSI, Level 8), aerosol (MODIS AOD, Level 6), sea ice (GHRSST MUR, Level 7) — each a translucent `ImageryLayer` (WMTS REST `z/y/x`, PNG, transparent no-data) that a normal manager row toggles; NOT map stacks (they overlay, they do not replace). Ordering contract in `src/imageryOrder.js`: every imagery layer carries `gevImageryRole` (base / underlay / overlay / night-lights) and `insertOverlayLayer()` always seats an overlay BELOW the night-lights layer, so city lights stay on top regardless of click order; MapStackController tags its own layers. Day = yesterday UTC from the shared `src/gibsTime.js` (`gibsImageryDay` moved there, re-exported by mapStackController); `update()` (hourly) probes one z=2 tile and steps back up to 4 days on HTTP 400 → row reads STALE with the day it actually draws; `lastUpdate` is the mosaic day (00:00 UTC), so the age readout says how old the weather is. Opacity is a params contract (`setParams({opacity})`, chips 40/70/100 %, default per layer); the legend is a 5-swatch transcription of the GIBS v1.3 colormap (`count: ''` — the manager prints `label count`). **Zoom-fade** (`gibsOverlayFade(level)`, reusing `densityZoomFactor`): Level 6 is ~2.4 km/px and at 700 km over the Alps precipitation was a field of blocks, so effective alpha = opacity × zoom factor with fadeOut = 200 km × 2^(8−level) and fadeIn = 3× (L6 800/2 400 km, L7 400/1 200, L8 200/600), applied on `preRender` (write only on change, listener attached on enable, detached on disable/destroy). **Day slider** (`src/data/gibsDay.js` shared offset 0–60 days back, `createGibsDayRow` in the group header, 2026-09-06 "bod 5"): one slider moves every enabled NASA overlay to the same mosaic day (offset 0 = latest = yesterday UTC with the STALE fallback; offset n = exactly that day, no fallback — a missing day reads "GIBS has no mosaic for …" and the layer keeps its last good day); layers subscribe in `init` (`onGibsDayChange` → `update()`), `getStats().historical` marks a chosen older day, the group subtitle prints the day. Session-only, no share-link key. Photoreal: `src/data/activeMapStack.js` mirrors `gev:map-stack-changed` (seeded from the silent first setStack, like contactPalette) and `getStats().error` says "globe basemaps only" while Google 3D hides the globe. Share-link tokens are DIGITS 1–5 (letters a–y were used up; the registry regex allows `[a-z0-9]`), registry pin 25 → 30. Credits: imagery credit line per provider + `nasa-gibs-overlays` in Data attribution. Tests: `gibsOverlays.test.mjs`, `gibsOverlayPanel.test.mjs`, `layerState.test.mjs`.
- **Two static NASA basemaps** (`MAP_STACKS` `gibs-blue-marble` = Blue Marble shaded relief + bathymetry, Level 8; `aster-relief` = ASTER GDEM colour shaded relief, Level 12 ≈ 40 m/px, credit wording "ASTER GDEM is a product of METI and NASA" is required; 2026-09-06, user "urob 3"): plain `xyz` descriptors with the time literal `default` (a date is HTTP 400 on a static layer — these deliberately do NOT use `gibsImageryDay()`), WMTS REST `z/y/x`, JPEG. Every new stack still needs the THREE places: `MAP_STACKS`, `PRESENTED_MAP_STACK_IDS` (chips allowlist) and `CABLE_GLOBE_STACK_IDS` (cable classification), each pinned by a tripwire test. Contrast stays the default `dark` (satellite tonality → white contact silhouettes, like Bing).
- **NASA basemap family — one chip, a variant row** (`mapStackChips.js` `MAP_STACK_FAMILIES`, 2026-09-06, user "zjednotiť prepínače a dať pod jedno NASA"): the three NASA rasters (daily VIIRS mosaic, Blue Marble, ASTER relief) collapse into ONE "NASA" chip in the main row (`PRESENTED_CHIP_ENTRIES` derives the row from the unchanged `PRESENTED_MAP_STACK_IDS` allowlist — the tripwire still guards every stack id). Clicking the family chip activates the remembered member (session `_familyChoice`, default `gibs-truecolor`); while a member is active, `#map-stack-variants` (`renderMapStackVariants`, called from `_renderMapStackState`, i.e. from controller state, never from the click) shows the three variants as small chips — "Dnes (VIIRS) · Blue Marble · Reliéf (ASTER)". `syncMapStackChips` lights the family chip when any member is active and rewrites its `dataset.stackId` to that member, so a click on a lit family is a no-op re-select. The main row is back to two lines (7 chips).
- **Stadia family — three more free styles** (2026-09-06, user "keď je platené tak nie. musíme nájsť inú cestu" after Google 2D tiles turned out to be pay-per-tile): `stadia-smooth` (Alidade Smooth, light), `stadia-outdoors`, `stadia-terrain` (Stamen Terrain, credit must name Stamen Design) join `stadia-dark` under ONE "Stadia" chip (`MAP_STACK_FAMILIES`, default dark — the contact-contrast reason from 2026-09-03 stands); the family chip title is now derived from the family id (`mapstack.family.<id>-title`). Light styles carry `contactContrast: 'light'` (dark contact silhouettes, night-lights brightness 3) and no dimming. Same keyless-on-localhost terms as the dark style (DATA_SOURCES.md). Google 2D Map Tiles (roadmap/terrain) DO work in the EEA (createSession 200; satellite 403) but are billed per tile — declined by the user, not wired.
- **EU / Copernicus sources — surveyed 2026-09-06, EUMETView deferred** (user "odložíme na neskôr zapíš"): live probes of GetCapabilities found keyless, CORS-open services that fit the overlay mechanism — **EUMETView** (Meteosat MTG/MSG RGB composites every 10–15 min, time dimension, archive 2020/2024), **EFFIS** (fire weather index, burnt areas; `AccessConstraints: None`), **Copernicus Marine WMTS** (SST/currents/waves/ice with time in the URL — the day slider would fit as-is), **EOX Sentinel-2 cloudless** (year 2016 is CC BY 4.0, later years CC BY-NC-SA), **GDACS** alerts API, **ECMWF open data** GRIB (CC BY 4.0, needs server-side processing), CAMS only through the ADS with a key. EUMETView got as far as a finished but UNWIRED draft (`docs/drafts/eumetviewOverlays.draft.js` — same lifecycle as `gibsOverlays.js`, explicit image time from capabilities because GetMap is served with `max-age=604800`) and stopped at the `new-data-layer` checklist: the service says `AccessConstraints: none` but EUMETSAT's Terms of Use say "personal and non-commercial use" and "Satellite data and products are not released under Creative Commons" — not declared open data, so it waits for the user's decision on OKO's (non-)commercial status. Verbatim quotes and the wiring checklist are in DATA_SOURCES.md and in the draft's header.
- **Google 3D via Cesium ion when Google refuses the region** (`src/photorealTileset.js`, 2026-09-06, user "inak nefunguje mi google"): since 2026-09-04 Google's Map Tiles API returns 403 "not available for your account and region" for EEA-billed accounts, so `createPhotorealTileset()` tries the Google key FIRST (self-healing if the block is lifted) and on failure loads ion asset **2275207** (the asset CesiumJS uses internally when no key is set — Cesium only takes that route when `GoogleMaps.defaultApiKey` is undefined, and main.js sets the key, hence the explicit fallback) with the same `cacheBytes`/`maximumCacheOverflowBytes`/`enableCollision` defaults. Result carries `source` ('google' | 'ion'), `googleError` and `regionBlocked` (text match on Google's EEA message); main.js passes `photorealSource` and `photorealUnavailableReason` into `MapStackController`, which only presents them: the photoreal chip title reads "Google 3D · via Cesium ion" (`sourceNote`), and when both paths fail the chip tooltip carries the real reason (`mapstack.unavailable-because` / `mapstack.photoreal-eea`) instead of a bare "unavailable". Error text is scrubbed of `key=` before it reaches any string. Terms: ion free plan is non-commercial, "Upgrade for commercial use." credit stays — DATA_SOURCES.md. Tests: `photorealTileset.test.mjs` (+ controller/chips pins).
- **Flat map ("Plátno")** (`src/sceneMode.js`, DISPLAY-rail `#flatmap-toggle`, 2026-09-05, user "namiesto glóbusu obdĺžnik"): morphs the scene to Cesium's 2D **Web Mercator** canvas and back (Mercator is the Viewer default and is fixed at construction; chosen over the equirectangular `GeographicProjection` because OSM tiles are native Mercator and stay crisp, and it is what every aviation/maritime map uses). **Default OFF** — the globe is the product — session-only, `aria-pressed` mirrored, same markup-carries-the-default convention as the other rail toggles. Three things had to change before 2D was survivable, all in `src/data/iconOrientation.js`, all found live: (1) `cameraPoseSignature` called `.toFixed` on `camera.heading/pitch/roll`, which Cesium returns as **`undefined` in SCENE2D** — it runs from every layer's per-frame tick, so the first 2D frame killed the renderer ("Rendering has stopped"); non-finite angles now stringify as `-`. (2) `horizonOccluder` fed `camera.positionWC` — a *projected* coordinate in 2D — to the ellipsoidal test; a flat scene has no far side, so an orthographic (2D) camera now gets an always-visible stand-in with the same `isPointVisible` interface (the 10 layer call sites are untouched). (3) `screenProjectedRotation` dotted a 3D ENU vector with `rightWC/upWC`, which are projection axes in 2D; in the north-up flat map rotation is simply `−course`. `applySceneMode` exists because a bare `morphTo2D()` never finishes under the render governor's `requestRenderMode` (the scene sat in MORPHING through a 2.5 s wait): it holds continuous render for the morph, releases on `morphComplete`, and a bounded fallback timer guards the hold against a missing event; duration 0 completes synchronously via `completeMorph`. Verified live: 3D → 2D in 200 ms with 27 907 vessels visible and no error panel → 3D in 600 ms with finite camera angles. Honest limits: 3D glTF models flatten in 2D, tilt/cinematic/follow are 3D-only, 3D Tiles (photoreal) do not render in 2D; `skyBackdropFactor` (detection bracket sky alpha) still assumes a 3D camera position — cosmetic in 2D, left as is. **Country labels in the flat map** (user "názvy štátov sa neprispôsobujú zoomovaniu"): the labels are raster, baked into the Stadia/OSM tiles, so their size is the tile level's size — and in 2D Cesium picks one level coarser than in 3D at the same height (measured: 3 200 km → level 4 at the default `maximumScreenSpaceError` 2, level 5 at 1), which doubled every label. `applySceneMode` therefore sets `FLAT_MAP_SCREEN_SPACE_ERROR = 1` on entering the flat map and restores the saved value on return to the globe (~3× tiles, only while flat).
- **Density drape factory + historical air-traffic density** (`src/data/densityDrape.js`, `src/data/airDensity.js`, `local-air-density`, token `j`, 2026-09-05, user "také pekné letecké trasy ako lodné"): the ship drape's render/alpha/lifecycle moved into a shared factory `createDensityDrapeLayer(config)` — one textured primitive, `syncAlpha` = basemap-contrast × zoom-fade with a preRender tick, `no-cache` sidecar, DOM-less test seams — and `shipDensity.js` became a thin wrapper that keeps its whole export surface (its tripwire now reads the factory for the primitive pattern). The second instance is **air traffic**: one day (2026-09-04) of **adsb.lol `globe_history`** (ODbL 1.0 + CC0, licence texts + the archive README copied into `local_data/air_density/`), read from the 48 gzip readsb `heatmap/` slices (~910 MB of a 3.9 GB split tar; the tar is discarded after extraction). readsb `heatEntry` = 16 B `int32 hex, lat, lon (°×1e6), int16 alt, gs`; skip separators (`hex 0x0e7f7c9d`, one per 10 s), info entries and zero placeholders. **Trap found live:** the info-entry rule "bit 30 set" must be evaluated as `lat >= 2^30` on the *signed* value — a plain `lat & (1<<30)` also matches every negative latitude and erased the southern hemisphere on the first decode (5.9 % of samples). Positions are counted into 0.25° (1440×720, 56.8 M samples from 80 761 airframes, 88 851 non-zero cells), log-normalised 60th–99.5th percentile, **amber** ramp (reads apart from the cyan ships), 97 KB PNG; panel row `adsb.lol · ADS-B 2026-09-04 · ODbL 1.0 / CC0 · HISTORICKÉ, nie živé`. **Honest result:** unlike the ship raster (six years of satellite + terrestrial AIS), one day of *terrestrial* ADS-B has no mid-ocean coverage — the drape shows hubs and continental corridors (Europe, North America, East Asia) and an empty Atlantic/Pacific. Two source candidates were rejected for licence reasons and are recorded in DATA_SOURCES/memory: OpenSky's crowdsourced flight lists (no redistribution outside the institute, expunge clause) — out; OpenFlights routes (ODbL, June 2014, airline+OD pairs only, no frequency) — kept as a possible *route-network* overlay to fill the oceans, not as density. **Rebuilt at 0.05° on 2026-09-07** (user: "not sharp on the other maps"): `AIR_DENSITY_CELL_DEG=0.05` → 7200×3600 cells (5.6 km), 4.29 M non-zero cells, 2.5 MB PNG (≈104 MB RGBA on the GPU; the desktop limit is 16 384 px), same counts/bridging/normalisation (floor 5 samples, ceiling 306) — individual flight tracks now read as thin lines; the drape therefore fades in from 1 500 km and stays down to 400 km (`AIR_DENSITY_FADE_IN_M`/`FADE_OUT_M`) instead of 4 000/1 200 km. The 910 MB of heatmap slices are NOT kept in the repo; re-download the release to rebuild.
- **Air density: ocean bridging** (`scripts/build-air-density.mjs`, 2026-09-05, user "hustotu letov nevieš nejako spraviť nad Atlantikom?"): the empty ocean is filled from the *same* day and dataset, no new source. The bake now tracks every airframe (24-bit hex) with the wall clock from the readsb separator record (lat = high 32 bits, lon = low 32 bits of Unix ms; verified 8 640 separators exactly 10 s apart) and, when one aircraft leaves coverage and re-appears **≥ 500 km** away at an implied **500–1050 km/h** with both ends **≥ 10 000 ft** (readsb `alt` is int16 of feet/25 — verified by the cruise cluster 1320–1480 = FL330–370; `gs` is knots × 10), fills the hole with synthetic 10-s samples along the **great circle** (slerp on unit vectors, antimeridian-safe). The speed window is what separates one continuous flight from a landing and a later departure; the altitude floor rejects descents into uncovered airports. Result on 2026-09-04: **19 169 gaps bridged, 13.8 M synthetic samples = 19.5 %** of all samples, 237 657 cells that hold only interpolated samples (vs 88 851 observed); rejected long gaps: 3 198 slow, 409 fast, 1 234 low. Floor/ceiling moved 181/12 387 → 42/5 073; PNG 97 → 276 KB; non-zero cells 88 851 → 326 508. The drape now shows transatlantic, transpacific and Europe–Asia corridors plus Australia/South America links. **Honesty (rule 2):** observed and bridged grids are kept apart in the bake and reported in the sidecar `stats.bridged` (gaps, samples, share, rules, rejected); the panel row gains `· medzery nad oceánom interpolované` only when `stats.bridged.gaps > 0`; the credit says "ocean coverage gaps bridged along great circles"; SOURCE.md has an "Ocean bridging" section with the caveat that real ocean tracks (NAT organised tracks, PACOTS, weather routing) deviate from the great circle by up to a few hundred km — the flights are real, their exact path over water is modelled. Tests: gap decision (transatlantic yes; slow/fast/low/short/notime no), great-circle points (Tokyo–SF stays in the Pacific across the antimeridian, meridian midpoint exact, degenerate arc finite), tracker through `accumulateHeatSlice` (observed grid stays clean, 1 439 synthetic samples for a 4-h gap, mid-Atlantic cell painted), label switch, sidecar/i18n/credit tripwires.
- **Contact cards: flags, aircraft photo, friendlier tracked readout** (2026-09-05, user "daj tam aj zástavy/vlajky a ak sa dá aj foto lietadla a trocha viac UI prívetivé"). **Flags** come from the MIT **flag-icons** set baked by `scripts/fetch-flags.mjs` into `local_data/flags/4x3/{iso2}.svg` (ISO 3166-1 only, lazy-loaded one image per country by `src/data/countryFlags.js`; SVG, not emoji — Windows has no flag emoji glyphs and the icon rule bans emoji anyway). Country resolution is pure: `normalizeIso2` for codes (adsbdb `registered_owner_country_iso_name` → `meta.countryIso`, airports `country_iso_name` → `route.origin/destination.country`, ship MID → `mmsiFlag().iso2`) and `countryIso2FromName` with an alias table for OpenSky's ICAO-allocation names ("Russian Federation", "Republic of Korea"…), used as the fallback for the ~permanent adsbdb aircraft cache that predates the field. **Tracked readout** (`src/data/trackedCardModel.js`, pure `buildTrackedCardModel`) is now structured: title = callsign (+ STALE) with the registration flag, details = flight line ("FL340↑ · 499 kts") + identity + alert as plain strings (voice/context readers unchanged), plus painter-owned decoration rows `route` ({origin,destination} with per-side label + iso2) and `progress` ({fraction,label}) — the world-overlay host validates them in `normalizeOverlayEntry` (`titleFlag`, `route`, `progress`), `trackedReadout.createTrackedOverlayEntry` passes them through, and `worldOverlayDraw.paintTracked` paints a flag before the title, a flagged route row ("[FR] CDG Paris → [CI] ABJ Abidjan") and a drawn progress bar (96×4 px track, accent fill, "33 % · ETA 3:35") instead of the ▰▱ glyph line; `measureOverlayEntry` grows the card by one line per decoration row. Vessel cards (tactical painter) and the DOM hover card get the flag before the title; `flights.js` splits its readout into `_trackedLabelParts` shared by `_trackedLabelText` (text for voice/context, unchanged wording) and `_trackedCardModel`. **Photo** (`src/data/trackedPhoto.js`): Planespotters.net Photo API, whose terms shape the module — browser-only fetch of JSON and image (no proxy, no rewrite, no server cache; the repo's vite config deliberately has no planespotters route), JSON cached ≤ 24 h in memory + localStorage including empty results, one request per tracked hex, thumbnail rendered as a plain `<a rel="noopener">` (no nofollow) to the returned photo page with the photographer's name as visible text; the photo is a DOM strip **joined to the card** (user: "treba to dať spolu"): same width as the painted card, overlapping its rounded bottom edge by 5 px so the two read as one block, 96×54 thumbnail on the left with the credit text beside it; positioned from `getOverlayPaintRect('tracked', id)` on `scene.postRender`, sticks to the top edge when there is no room below, hides whenever the card is not painted and immediately on `trackedEntityChanged` (the render governor may stop producing frames after un-tracking, so postRender alone would leave a stale strip — seen live). Failed requests (403/429/network/CORS) get a 10-min per-hex cooldown instead of the 24-h cache; live from localhost one first request failed with a missing `Access-Control-Allow-Origin` and later ones succeeded, so the cooldown-and-retry is the right shape. Vite strips the trailing slash from `new URL('./dir/', import.meta.url)`, so `countryFlags.js` builds the flag directory URL from `import.meta.url` as a string (the first live run requested `4x3gb.svg` and got the SPA fallback). adsbdb's `url_photo` stays unused (see the licence note in vite.config.js). **More flight information** (same day, user "daj tam viac informácií o lete"): the card now reads title `AFR702 · AF702` (IATA flight number from adsbdb `callsign_iata`, new proxy field, shown only when it differs from the callsign), flight line `FL340↑ 980 ft/min · 499 kts · 214°` (vertical rate in ft/min rounded to 10 whenever the ±2.5 m/s trend threshold is crossed, three-digit true track), progress label `33 % · zostáva 3 245 km · ETA 3:35 (21:40)` (remaining great-circle km from `routeProgress`, local clock time of arrival on the viewer's device), and a new **footer** row group painted after the decoration rows: `OpenSky Network · fix pred 6 s · SQ 1000 · 3C6444` (data source, age of the last fix, ordinary squawk, ICAO hex — rule 2 provenance on the card; the emergency squawk alert stays its own last footer row). Pure formatters live in `trackedCardModel.js` (`formatFlightLine`, `formatVerticalRate`, `formatTrack`, `formatFixAge`, `formatEtaClock`, `formatMetaLine`, `formatThousands` with U+202F thousands separator); `footer` is validated in `normalizeOverlayEntry`, passed through `createTrackedOverlayEntry`, measured and painted by `paintTracked`. i18n keys `card.km-left`, `card.fix`. **Host rect trap (same day, seen live at globe range):** `getOverlayPaintRect` publishes the UNSCALED placement while the card is painted at `record.paintScale` with `finalAlpha`, so the photo strip floated alone next to an invisible, shrunken card; painted rects now carry `alpha` and `paintScale`, and `trackedPhoto.photoVisibility` hides the strip below alpha 0.3 / scale 0.7 and otherwise sizes it to the scaled card and mirrors the card opacity.
- **Hover card = the full card** (`src/data/contactHoverCard.js`, 2026-09-05, user "chcem to mouse over a potom všetko zmizne"): the pointer card now composes the same rows as the tracked readout through the shared pure formatters — title with registration flag and IATA number, flight line (level/trend + ft/min, kts, track), operator · type · registration (or category), route row with airport flags, progress bar with remaining km and arrival clock, footer with source · fix age · squawk · hex (and the STALE note), plus the Planespotters photo — and disappears when the pointer leaves the contact. `flights.getContactSummary` grew the matching fields (`flightIata`, `trackDeg`, `routeInfo`, `progress`, `source`, `lastContactEpochMs`, `squawk`, `originCountry`). **Dwell:** after 350 ms over the same contact the card calls `onDwell` (ui.js → `flights.prefetchContactDetails`, i.e. adsbdb type + route with priority) and the shared `lookupPlanespottersPhoto` (same cache/cooldown as the tracked strip), so a sweep across the fleet fires nothing. **Sticky photo:** the card keeps `pointer-events: none` (it must not eat the MOUSE_MOVE that keeps it alive) but the photo anchor has `pointer-events: auto`; moving onto it stops canvas moves, the card stays and the link is clickable (Planespotters requirement), leaving the anchor hides the card. Hover altitude now follows the tracked-card convention (feet below FL180) instead of the old `formatFlightLevel` FLxxx-for-everything.
- **Airport card: restyled ambient card + rich click card** (`src/data/airportsData.js`, `src/data/airportCard.js`, `scripts/build-airports.mjs`, 2026-09-05, user "nepáči sa mi ten štýl … vyžmýkať všetko čo sa dá o danom letisku" + "rádiová komunikácia letiska"). Ambient canvas card: country flag before the name (`titleFlag` through `localInfrastructureOverlayCopy`), line 1 `BTS · LZIB · Bratislava`, line 2 `Veľké letisko · 133 m (436 ft)` (i18n tier words, metres first). Click → DOM card anchored to the airport's projected position (postRender, hidden behind the horizon, flips left of the point at the right edge, close button clears the layer selection): header with flag/name/codes/tier/place/elevation; **Rádio** = frequencies grouped ATIS → TWR → GND → DEL → APP → DEP … (max 12 + "+N") from the new sidecar `local_data/airports/airport-details.json` (OurAirports `airport-frequencies.csv` + `runways.csv` + link columns of `airports.csv`, public domain, baked by the extended build script, fetched lazily on the first airport click) plus a plain **LiveATC link** (`liveatc.net/search/?icao=`) — LiveATC's terms forbid third-party use of the streams, so OKO embeds no audio and the link title says the sound stays on their site; **Dráhy** = `04/22 · 2 900 × 60 m · asfalt · osvetlená` (closed runways dropped at build, longest first, surface codes mapped to i18n words); **Počasie** = the existing METAR/TAF cache lines (`requestAirportMetar` re-renders on arrival); **Premávka** = live aircraft within 40 km via `flights.getNearby` (count + up to 6 callsigns, refreshed every 2 s while open); **Odkazy** = Wikipedia + airport website. Pure model `airportCardModel` and formatters (`frequencyRows`, `runwayLabel`, `runwaySurfaceKey`, `liveAtcUrl`, `formatElevation`) are unit-tested; DATA_SOURCES.md gained the sidecar row and a LiveATC link-only row. **Own stream** (user "vlož aj priamy stream"): LiveATC audio cannot be embedded (their terms), so the card plays a user-supplied stream instead — `local_data/airports/atc-streams.local.json` (git-ignored, example file shipped) maps ICAO → `{url,label}`; only http(s) URLs, loaded once per session, rendered as one persistent `<audio controls preload="none">` element kept across the 2-s re-renders so playback is not restarted; missing file = no section. **Airport photo** (user "Fotky letísk nevieš pridať?"): `src/data/airportPhoto.js` resolves the lead image of the airport's Wikipedia article (link from the OurAirports sidecar) through the Wikipedia API (`prop=pageimages`, then `prop=imageinfo` with `extmetadata` for author/licence/file page), shows it above the card header with a credit link "Foto: author · licence · Wikimedia Commons" to the Commons file page, and refuses images without a recognised free licence (fair use / non-free). Client-side, CORS, no key, `Api-User-Agent` header, 7-day cache incl. negatives; the `<img>` element persists across the 2-s re-renders.
- **Active runway + local time on the airport card** (`src/data/runwayWind.js`, `src/data/solarTime.js`, 2026-09-05). The build script now carries both true runway headings (`le_heading_degT`/`he_heading_degT`) into the sidecar tuple (9 fields), `airportWeather.js` keeps the raw METAR in its cache and exposes `cachedMetarWind`, and the card computes the end with the biggest headwind: `RWY 22 · protivietor 12 kt · bočný 5 kt Ľ`, tie-broken by runway length, with `calm`/`variable` reported as their own states rather than silence. It is an **estimate from wind**, never an ATC report — the row's tooltip says exactly that. Missing headings fall back to the ident digits (04 → 040°). **Local time** is `≈19:17 miestny (odhad) · 18:17Z · západ 19:25`: the offset is `round(lon/15)` because a coordinates→timezone table is ~1 MB, so DST and wide zones (China, India) are off by up to an hour — hence `≈` and the word "odhad", with exact UTC beside it. Sunrise/sunset use the full NOAA algorithm (verified against real times for Bratislava, London and the equator within 8 minutes); polar day/night is a reported state. Trap fixed by the tests: `Number(null) === 0` passes `Number.isFinite`, so a missing runway heading read as 000° and a missing wind as calm-from-the-right.
- **Vessel destination port, line and ETA** (`src/data/vesselDestination.js`, `src/data/vesselVoyageLine.js`, 2026-09-05). AIS `destination` is crew-typed free text; the parser strips AIS filler (`@`, `^`), takes the LAST leg of `ECPSJ>JPYOK`, then tries UN/LOCODE (`NLRTM`, `TH BKK`), exact port name, and finally a ≥4-character name prefix (`MIZUSHIMA JAPAN` → Mizushima) against an index built lazily from the already-bundled World Port Index. **Measured on 4 083 live destinations: 53 % matched** (1 196 by LOCODE, 783 by name, 179 by prefix); the rest is genuinely unmatchable (`FISHING GROUNDS`, `SEA TRIAL`, `CH16`) and stays as the crew's raw text — no guessed port, no invented line. A match adds `→ Immingham (GBIMM) · zostáva 215 km · ETA ~9 h` to the selected-vessel card and a dashed geodesic line at sea level to the port (own pick namespace `gev-voyage:` so clicking it cannot deselect the ship). Distance is great-circle, not a shipping route: no land, canals or ice. Trap: `?url` imports are Vite-only, so the ports bundle is resolved with `new URL(...)` or every Node test importing the vessel layer fails at load.
- **NASA GIBS basemap** (`gibs-truecolor` in `MAP_STACKS`, 2026-09-05): daily global VIIRS NOAA-20 true-colour mosaic, keyless and CORS-enabled. **The URL is WMTS REST — `{z}/{y}/{x}`, not XYZ `{z}/{x}/{y}`**; swapped indices still return HTTP 200 with the wrong tile, so the failure looks like a scrambled map rather than an error. `gibsImageryDay()` picks **yesterday** in UTC (today's mosaic is still full of holes). `maximumLevel: 9` is the layer's own maximum. Added to the chip allowlist and to `CABLE_GLOBE_STACK_IDS` (cable ground lines classify per stack, and the per-stack test walks the real `MAP_STACKS`).
- **Label LOD for point layers** (`src/data/localLabelLod.js`, 2026-09-05, user over Central Europe from 700 km: "no to je dosť neprehľadné"). Airport cards were drawn at full detail (name + codes + tier + elevation) for every airport out to 14 000 km, thinned only by the 140 px collision grid — about 25 three-line cards covering half the screen. The fix mirrors `airIconLod.js`: camera-height tiers with hysteresis, on two axes at once. **Which** features get text comes from the layer's own importance scale (airports and ports share 300/150/60), **how much** text from the tier: `hidden` (dot only) above 1 500 km, `code` (`BTS`) 300–1 500 km for large only, `compact` (`BTS · Bratislava`, one line, with flag) 90–300 km for large + medium, `full` (today's card) below 90 km for everything. Each threshold has an enter/exit band so a camera parked on the boundary cannot flip the text back and forth. Opt-in per layer (`labelLod: true`, on for airports and ports; dams and datacenters keep full cards). The entry is rebuilt lazily and only for records about to be published, so the cost scales with the screen, not the dataset. **Trap found live:** the gate must read the layer's own importance, not `record.priority` — that composite adds 1 000 for merely having a name, so a grass strip scored 1 150 and passed the hub threshold of 300 exactly like Vienna; `labelImportanceFromProperties` now supplies the clean scale and a layer without one is never gated. **Second pass — the tiers had to reach the geometry, not just the text** (user screenshot from world view): with every label suppressed, 4 207 airport plus 2 682 port markers still drew a 10 px ringed point and a 3.5 px stem each, and the stems at that altitude are lines across half the globe, so the planet was a thicket. The same tier now also drives the point (`pointVisibleInTier`, gentler than the label gate because a dot is cheaper than a card: all points down to `compact`, ≥150 at `code`, ≥300 at `hidden`), its size and outline (10/2 → 8/2 → 6/1 → 4/0 px) and the stem (`stemVisibleInTier` — only at `full`, since a stem exists to keep the marker out of the terrain up close). Measured after the change: world view 851 airports + 122 ports, no stems, 4 px dots; continent 1 264 + 221, no stems, 6 px; close in 193 + 55 with stems and full 10 px markers. The selected entity is exempt from the gate so an open card can never point at nothing. **Third pass — markers floating off the sphere** (user screenshot from 32 000 km: "nesmú sa dostať body mimo gule"). The entity position is the stem *tip*, and `updateLocalStemGeometry` lifts the tip by `distance × fovFactor` to hold it ~65 px above the ground point — linear in camera distance, so at world view the lift is over 2 000 km and markers near the limb render outside the globe's disc. The lift only exists to make the stem visible and keep the marker out of terrain, so it now follows the stem: `lift = !labelLod || stemVisibleInTier(tier)`, and with the stem hidden the tip *is* the ground point. A tier change forces one geometry update so markers settle immediately rather than on the next camera move. Measured at 32 000 km: 816 airports shown, max height above ellipsoid 0 m.
- **Map markers for airports and ports** (`src/data/localMarkerIcons.js`, 2026-09-05, user: "a ikony si nezmenil" — the panel glyph had changed, the map had not). Both layers drew a bare 10 px point on the globe, which reads as nothing. They are now `BillboardGraphics` with a monochrome SVG data URI in the layer colour: a plane inside a circle for airports (the circle is what separates a static airport from a live, heading-rotated aircraft silhouette), an anchor inside a circle for ports. Opt-in per layer via `markerImage: (color) => dataUri`; layers without a conventional pictogram keep the point. The LOD tiers scale the billboard with the same curve they apply to the point (`scale = pixelSize / 10`, so 22 px → 18 → 13 → 9 px at world view). `disableDepthTestDistance` stays infinite so the marker never sinks into the photoreal mesh. **Trap while verifying:** after a reload the default preset enables the submarine-cables layer, whose landing-station cards ("Rostock, Germany") and cyan cable lines look exactly like port cards with stems at 2 200 km — check `enabled` layers before blaming ports. **Colour:** airports moved from the cool blue #8ab4f8 to magenta #ff66d4 (user: the blue blended into the cyan scene of flights, AIS, cables and HUD). No other layer uses magenta, and VFR aeronautical charts draw airports in it. The same value is hard-coded four times in style.css for the DOM airport card accent; keep the two in step.
- **Airport weather in plain language** (`src/data/metarSummary.js`, 2026-09-05, user: the raw METAR line told a pilot everything and a layperson nothing; chose items 1, 2, 3, 7 of the proposal). Pure module over the same aviationweather.gov JSON the card already caches: a headline ("Zamračené, slabý dážď · 14 °C · vietor 12 kt od západu") built from cloud cover, `wxString` phenomena with intensity and freezing prefixes, temperature and an eight-sector wind direction; a weather kind for a monochrome SVG glyph (sun, cloud, rain, drizzle, snow, thunder, fog, mist, haze — data URI in an `<img>`, no emoji); and the flight category badge VFR/MVFR/IFR/LIFR coloured as on aeronautical charts, taken from the server's `fltCat` and computed from ceiling (lowest BKN/OVC/VV) and visibility only when that is missing. The raw METAR/TAF lines stay under a "Surový METAR / TAF" toggle (state survives the 2 s refresh, resets on card change). `stale` flags observations older than 90 min. **Trap verified live on LZIB:** with CAVOK/CLR the API sends an EMPTY `clouds` array and puts the sky in a top-level `cover` field, so the cloud word must fall back to `cover` or clear weather has no sky word at all; and with no kind at all the card draws no glyph rather than a cloud that asserts something the report does not say.
- **Natural hazards group + NASA EONET natural events layer** (`src/data/naturalEvents.js`, `src/data/naturalHazardsPanel.js`, 2026-09-05, user: "oprav, vylepši, pridaj do karty prírodné hrozby a zlaď style" pointing at the layer-panel group). The group was an orange box with its own title in a cyan panel and a subtitle that repeated the row names; it is now a panel-language section (mono uppercase header like `.panel-title`, thin dividers, ordinary rows) with a LIVE summary line built from enabled layers' counts ("179 zemetrasení · 39 udalostí EONET · radar zapnutý"), refreshed on the manager's in-place panel refresh, not only on rebuild. Members now: earthquakes, volcanoes, natural events, FIRMS, SHMÚ radar. The FIRMS row's "KEY REQUIRED" goes through i18n ("bez kľúča · registrácia zdarma na firms.modaps.eosdis.nasa.gov") and its name is shortened so it stops wrapping to three lines. New layer `natural-events` (token `l`): open EONET reports for severe storms (with point track drawn as a ground polyline and latest magnitude, e.g. "Hurricane Lowell · 130 kts"), floods, landslides, drought, dust/haze, snow, temperature extremes, sea/lake ice, and wildfires behind a chip that is OFF by default. **Why two requests:** measured 2026-09-05, open wildfires ≈ 2 000 versus ≈ 20 for every other category combined, so one request with a limit would push the storms out of the response and the map would drown in small fires (FIRMS handles fires better anyway). Core categories go in one call (limit 500); wildfires are fetched only when the chip is enabled (limit 500). Category chips reuse the manager's `getRowControls`/`setParams` contract. Monochrome SVG icons per category, `⚠︎` (VS15) as the panel glyph. Same source, licence and disclaimer as the volcano layer; the detail card repeats that EONET is a curated catalog, not a warning service. Live check: 6 storms, 33 ice reports, 28 tracks drawn over the Americas.
- **Volcanoes as 3D objects with a real card** (`src/data/volcanoes.js`, `volcanoCard.js`, `volcanoInfo.js`, `scripts/build-volcano-model.mjs`, `scripts/build-volcanoes.mjs`, 2026-09-05, user: "prerob aj informácie aj nech je to 3D, nech to nejako vypadá"). Each open EONET volcano is now a procedural glTF cone (`public/models/volcano.glb`, own work CC0, ~8 kB: truncated cone in metres with a recessed emissive crater) seated on terrain with `CLAMP_TO_GROUND`, `minimumPixelSize` 44 so it keeps its shape from orbit and `maximumScale` 6 so it cannot outgrow the mountain up close, plus a translucent smoke-plume billboard 900 m up (brighter for reports younger than 60 days). Clicking the cone or plume opens a DOM card that reuses the airport card's CSS classes: Wikipedia lead photo (free licences only, with credit), name, `type · elevation · country`, status, "reported since … · latest … · N reports", description, links (Smithsonian GVP profile, NASA Earth Observatory, Wikipedia, EONET). **Where the information comes from:** EONET carries only a title, one point, a date and source links, so the card joins a bundled OpenStreetMap snapshot of 4 991 named `natural=volcano` nodes (ODbL, 585 kB, lazy-loaded on first open) by name within 25 km, else nearest within 8 km, else nothing — never a guess; the card says when the details came from the nearest node. **Smithsonian GVP was evaluated and rejected as a bundled source:** its WFS is easy and rich (1 226 Holocene volcanoes with type, elevation, last eruption) but the Smithsonian Terms of Use allow personal, educational and other non-commercial use only; the card links to the GVP profile instead. **Traps:** the first sidecar build wrote `ele` as 0 for every node without the tag (`Number('')` is 0) — a test now pins that fewer than all nodes carry an elevation; `SceneTransforms.worldToWindowCoordinates` throws on the test double's fake scene, so `place()` wraps it. Live: all 32 models ready, Bezymianny cone rendered on Kamchatka terrain. **Visual redo (2026-09-06, user: "to ako vyzerá SVG… oprav aj búrky aj všetky ikony"):** v1 drew a flat neon-orange crater disc and a clip-art grey smoke billboard that both read as stickers. The GLB (v2, build-volcano-model.mjs) is now a steeper dark-basalt cone whose crater is recessed and dark with only a small emissive vent glowing in the centre; the smoke billboard is gone entirely (activity lives on the card and the ambient label). The natural-events category markers were redrawn from a glyph-in-a-translucent-circle into filled colored MAP PINS with a white glyph and the tip anchored on the point (verticalOrigin BOTTOM), which reads as an intentional marker on photoreal terrain instead of a floating sticker. **Stronger icons + event card (2026-09-06, user: "ikony cyklóny aj iné sú slabé, popis žiadny udalostí"):** the pins are now colored per category (severe storms red #ff5b6e, floods blue, drought amber, ice cyan, wildfires deep orange, …) via `naturalEventInfo.categoryColor`, cyclones carry a real hurricane symbol (eye + two spiral arms) with a thicker 2.5px stroke and a larger pin, and the ambient label inherits the category color — so storms pop out instead of blending into the earthquake reds. Clicking a pin now opens a full DOM card (`naturalEventCard.js`, reuses the airport-card CSS) instead of the old canvas detail strip: title with a colored Saffir-Simpson badge (CAT 1–5 / TS / TD derived from the sustained wind in knots), an intensity line (`115 kt sustained · peak 140 kt`), and — because EONET ships an EMPTY description for storms — a description SYNTHESIZED from the data ("Tropical cyclone, currently 115 kt (category 4), peak 140 kt. Tracked over 38 positions from … to …"), plus tracked-since/latest/N-fixes, coordinates, track length and source links (JTWC, NOAA NHC, NASA EONET). The card is honest: a real EONET description wins over the synthesized one, and the coverage note stays. Live: Hurricane Lowell → CAT 4 card, red cyclone pins with track lines across the Pacific. New sources recorded in DATA_SOURCES.md + Data attribution (flag-icons MIT, Planespotters photos © photographers).
- **Earthquake pulsar that hugs the sphere** (`src/data/earthquakePulse.js`, 2026-09-06, user: "pri zemetraseniach sprav pulzar … keď je slabé menší, keď je väčšie väčší v závislosti na intenzite a aby kopíroval guľu"). The pulse ring now scales with magnitude — a world radius in metres, doubling per magnitude with a floor/ceiling (`earthquakeRippleMaxRadius`, M4 8 km → M7 64 km) — and lies on the globe surface: each pulsar's ripple element is drawn inside a `.quake-plane` whose CSS `matrix()` is the projected local east/north tangent basis at the epicentre (`tangentScreenMatrix`), so the ring foreshortens into an ellipse on the ground as the camera tilts (verified live over Castle Rock, WA: circle top-down, 0.45 axis ratio ellipse at −20° pitch) and shrinks with distance. The core dot stays outside the plane so it never squashes. **Why still CSS/DOM, not 3D geometry:** the layer holds hard performance pins in earthquakes.test.mjs — no `Cesium.CallbackProperty` on the clamp-to-ground discs (animating their axes re-tessellates every ground primitive each frame) and no `holdContinuousRender`. CSS animation runs on the compositor with no Cesium render lease; the tangent matrix and screen position only update when the scene already renders (camera motion), and a parked camera keeps pulsing purely in CSS. So the pulsar reads as painted on the sphere without reintroducing the render-loop cost those pins guard against. **Prettier multi-line pulsar (2026-09-06, "sprav to ako pekný pulzar s viacerými líniami"):** the ripple is now `EARTHQUAKE_PULSE_RINGS` = 4 thin concentric line-rings staggered by a quarter of the 5.2 s period so four waves always march outward like sonar, plus a soft breathing halo, all inside the same tangent-plane matrix so they foreshorten onto the ground together. The rings are a narrow radial-gradient band (thickness can't distort under the non-uniform matrix the way a border would). The static footprint disc's fill was dropped to ~0.11–0.16 alpha with a 1–2 px outline so it's just a faint base and the rings are the star. **Reduced-motion trap:** the in-app preview browser reports `prefers-reduced-motion: reduce`, and the old media query set `animation:none`, which froze the pulsar for the user; it now only slows to an 8 s period and drops to two rings under reduced-motion instead of stopping (reduce, not remove). **Felt-reach ring (2026-09-06, "aj dosah otrasov by si mohol", modelled on Sentinel's surface wave):** for M ≥ `EARTHQUAKE_FELT_MIN_MAG` (4.5) each quake also gets a large, faint, STATIC clamp-to-ground ring at the estimated perceptible-shaking radius (`earthquakeFeltRadiusM` = 105 km × 2^(M−4.5), ~MMI III: M5 ≈ 148 km, M6 ≈ 297, M7 ≈ 594), color-coded by depth. It lives in a separate `earthquake-felt` CustomDataSource (not pick-registered, so it never interferes with epicentre picking) with static axes — no `CallbackProperty`, so the performance pins hold — and the detail card gains a "shaking felt to ~X km (estimate from magnitude, not a ShakeMap)" line. It's honestly an estimate from magnitude only; DATA_SOURCES.md already records that EMSC/USGS felt reports are deliberately not ingested, so this never scrapes real felt data. **Trap:** the layer now adds two dataSources at init, so the multi-source test double had to capture the `earthquakes`-named source instead of the last one added. **Wave to the felt reach + bigger from afar (2026-09-06, "sprav ich zďaleka väčšie aj s vlnou imitujúcou otrasy"):** the animated pulse rings now expand out to the FELT radius for M ≥ 4.5 (`earthquakePulseStyle.maxRadius` = `earthquakeFeltRadiusM` for significant quakes, the compact `earthquakeRippleMaxRadius` below that), so the four staggered rings read as a seismic wave sweeping out to meet the static felt-reach ring — an animated wave imitating the tremor spreading. The on-screen clamps were raised (`RING_MAX_PX` 260→420, `RING_MIN_PX` 9→18) so the wave stays large and legible from a distance, not a tiny dot when zoomed out.
- **Airport live cameras** (`src/data/airportCameras.js`, card section "Živá kamera", proxy `/api/youtube-live` in `vite.config.js`, `scripts/check-airport-cameras.mjs`, 2026-09-06, user: "k letiskám karty by si vedel pridať live stream? preskúmaj … sprav všetko čo spraviť vieš … YT api mám"). Investigation first (recorded in DATA_SOURCES.md + the sk-data-source skill table): the other agent had left the radio card audio-only with LiveATC link-only and two verified YouTube streams parked; Vienna's hourly webcam JPEGs are barred by its imprint; Windy Webcams is keyed still-imagery with link-back terms, not video; **Bratislava's own webcam (5-min 1920×1080 JPEG + 24 h hourly archive, Cloudflare, ETag) has no terms of use anywhere in its 1 068-page sitemap, and "no terms" is not consent** — so LZIB is deliberately absent and a consent-request draft sits in `docs/drafts/bts-webcam-request.md`. Implementation: a curated catalogue (LKPR SlowTV, KLAX AirlineVideosLive+, both `isLiveNow`+`playableInEmbed` on 2026-09-06) plus optional automatic lookup through YouTube Data API v3 `search.list eventType=live` behind a server proxy — key `YOUTUBE_API_KEY` stays in `.env`, keyless → 503 `no_key` and the section stays hidden; 6 h cache per query, 30 min for empty results, coalesced misses, a daily cap of 80 searches (8 000 of the free 10 000 units), and only a trimmed snippet reaches the browser. `pickLiveCamera` keeps only `liveBroadcastContent === 'live'`, drops simulators/music, scores camera/airport words and code/city hints, and the card labels such hits "found automatically — verify". Playback is exclusively the official embedded player on `youtube-nocookie.com` (autoplay requested with sound because the ATC audio is the point; the browser may demand a click, which the note says), one persistent `<iframe>` per card that survives the 2 s refresh, is swapped only when the airport changes and is blanked (`about:blank`) on close so playback stops. Live check: Prague card shows the live runway stream with the SlowTV credit above the Wikipedia photo. **Traps:** the existing card test double answered every URL with the details JSON, so the new lookup had to be short-circuited to a 503 there; `cameraSearchQuery` doubled the city when the airport had no name.
- **Aircraft category chips** (`src/data/aircraftCategories.js`, 2026-09-03): both flight layers expose `getRowControls()` chips that tally live contacts per operational category — AIRLINERS (airliner + widebody + quadjet), BIZJETS, TURBOPROPS, LIGHT, HELICOPTERS, GLIDERS, FAST JETS, DRONES — and toggle that category's visibility on click. The grouping is deliberately coarser than `classifyAircraft()`'s ten silhouette classes: the panel speaks in operational terms while the glyphs keep their finer distinctions. A category renders a chip when it has contacts **or** is hidden, so switching one off never removes the control that switches it back on. Counts always describe the sky, not the filter. Filtering composes into the same `beyondHorizon` gate that owns `bb.show` rather than adding a competing writer, so a hidden category also drops its 3D model and — because `getNearby`/`getDetectableObjects` already guard on `bb.show` — disappears from detection brackets and Contacts for free. Each layer owns its own filter (hiding airliners must not blank a military transport). **Deliberately session-scoped:** the filter is absent from `layerState.js` and from local storage, so it never rides a share link and never survives F5 — a hidden category that outlives a restart is the same trap the detection default cost two bug reports to close.
- **Satellites**: 838-sat core catalog (stations/visual/GPS/GLONASS/Galileo/GEO), tracking lands ~726km out via `viewFrom` (tracked entity owns a point graphic so the tracking camera engages), rings realign via primitive modelMatrix (no per-second rebuild flicker), optional `setParams({catalog:'dense'})` Starlink mode.
- **Satellite classes** (`src/data/satelliteClass.js`): every satellite is classified from the CelesTrak group it was ingested with — no extra fetch and no heuristics — into STATION (warm white), NAV (cyan; GPS/GLONASS/Galileo deliberately share one color so the GNSS family reads as one thing), GEO (violet), VISUAL (muted blue-gray catch-all), and COMMS (dim slate, dense Starlink shell only). That module is the single source of truth for class, label, and color, so the dot, the card, and the legend swatch cannot disagree. Two deliberate palette rules: no class may sit in the 40–48° amber band, which is the app-wide known-military convention; and COMMS stays far below VISUAL in Rec.601 luminance so the dense shell stays separable when NVG/FLIR collapse the scene to one channel. The ISS keeps its long-standing red hero dot rather than the STATION color — it carries a permanent name label and its card still reads `STATION · ISS`. `satelliteClassOf` is the single owner of that ISS rule, so the card label and the legend tally can never disagree: during a stations-feed outage the ISS is ingested as `visual`, and both surfaces still file it under STATION.
- Class is also a **text field**, not just a color: `NAV · GPS` / `GEO` / `COMMS · STARLINK` / `STATION · ISS` leads the tracked card's detail block and replaces the raw CelesTrak tag on the detection-overlay label. Because that canvas composites above the post-FX chain, the class stays readable in NVG/FLIR after the in-scene dot colors are flattened.
- The satellites row in DATA LAYERS carries per-layer sub-controls (`DataLayerManager._syncRowControls`, the first consumer of the optional `getRowControls()` layer hook): a **DENSE** chip exposing the existing `catalog` param, and a swatch legend with live per-class counts. Default is the sparse core catalog. The chip is stateless — it declares the params to apply and the manager owns the write — so the Space Missions capture/restore path over the same param stays authoritative. Controls stay hidden while the layer is off. An explicit CORE or DENSE choice participates in versioned local and share-link state; temporary Space Missions overrides do not.
- **The DENSE chip reports the dense LOAD, not the catalog param.** The param flips synchronously while the Starlink shell takes seconds to arrive over a chunked load, and CelesTrak 502s that feed regularly. So the chip reads `DENSE ···` (busy, disabled) while loading, ACTIVE only once dense points are actually on screen, and `DENSE ✕` with the reason on hover when the load fails — a failure also reverts `catalog` to `core`, drops any partial chunk, and leaves the chip clickable to retry. A load is judged by points added, not by HTTP status: a 200 carrying an empty body, a passed-through HTML error page, or only TLEs the core catalog already owns fails with the same revert semantics as a 502. Any explicit request for `core` clears a latched error even when the mode does not change, so a Space Missions restore of an already-core snapshot never leaves the user with a failure they did not cause. Because the load settles asynchronously, the layer pushes a re-render through the optional `setRowControlsListener()` hook; nothing else would repaint that row before the 5-minute catalog refresh, so the count and legend would otherwise sit stale.
- **A dependency owner takes the row with it.** Space Missions borrows this layer for TLE lookup with `showPoints:false`; while points are hidden the layer returns empty row controls, so the legend never describes an empty sky and the chip cannot accept a write that the owner's restore would silently revert.
- The detection-overlay record cache (`_detectionObjects`) is cleared with the catalog on every rebuild: it stamps id/class at creation only, and a rebuild can re-tag a satellite when a partial CelesTrak outage changes which group wins dedupe.
- **FIRMS**: no ground clamping (zero 3D-tiles height sampling), ≤18 screen-decluttered ambient labels, click-to-inspect detail card, 2.5k/3k sprite budgets viewport-clipped by FRP.
- **CCTV v2 foundation:** a pitched
  frustum wireframe (4 corner rays + far-cap rectangle) with a monitor plane at the frustum's
  far cap, retargeting the existing video/canvas texture pipeline. Manual calibration only —
  auto-calibration and the drape mesh pipeline are deleted. A one-shot activation obstruction
  probe (`pickFromRay` on camera activation, clamping the plane short of the first hit) remains;
  ground placement is superseded by the shared-floor v3 behavior below. Calibration persists to
  `godsEyeView.cctv.calibration.v2` (wiped clean, no v1 import); a panel-only CAL badge shows
  `CALIBRATED`/`CURATED`/`RAW PRIOR` (no in-world tint). Panel is titled "CCTV" (not "CCTV
  MESH"). Staggered geometry/frame loading is active-first and uses 4 records per 120 ms normally,
  or 2 per 250 ms while tracking/cockpit owns the view (re-evaluated each batch), with coalesced progress
  notifications (roughly 300 ms or ten batches; natural completion and disable each publish their
  terminal state through their own completion paths) and a LOADING FRAMES
  chip and the preview-first auto-expanding panel are unchanged. Coverage polylines are created
  lazily instead of inserting five entities for every catalog camera during initialization: default
  COVERAGE ON enable creates the active/visible 14-camera cohort, and activation always creates the
  selected frustum even with COVERAGE OFF. **Field validation passed
  2026-07-04** (core look + downtown no-clip confirmed); that round fixed three findings: the
  ground clamp now lifts the cap *center* only so the wireframe stays a true pyramid welded to
  the plane (was a flattened fan / the ~47.5 m divergence — RESOLVED), re-selecting the active
  camera is a no-op (killed a click-flash), and texture swaps gate on canvas content (killed a
  periodic white flash). Coverage is now **metro-wide: 250 cameras** (`CCTV_AUSTIN_MAX_SOURCES`
  default 36 → 250, hard bound 300), filtered to `camera_status === TURNED_ON` (~815 live of
  1,003 rows). City packs (2026-07-04): Caltrans (districts 4/7/11/3 — SF, LA, San Diego,
  Sacramento; cap 300) and TfL London JamCams (cap 250) join Austin (cap 250) as keyless default
  sources — ~800 cameras total, all RAW PRIOR poses, stills-first.
- **CCTV v3 UX — viewshed + calibration gizmo** (built 2026-07-05 and field
  validated 2026-07-21): the COVERAGE toggle is a
  tri-state cycle `OFF → ON → VIEWSHED`; viewshed mode renders each visible camera's frustum
  as a translucent **color-coded volume** (golden-angle hue per camera, `cctvViewshed.js`)
  welded to the same 5 points as the wireframe — zero new scene queries or update cadences.
  The 7 calibration sliders are **deleted**: ADJUST mode puts a direct-manipulation **gizmo**
  on the active camera (`cctvGizmo.js` — heading/pitch rings, E/N/U arrows, range handle at
  the cap center, FOV handles on the cap edges; all 7 offset DOF), plus a click-to-edit
  **effective-pose readout** (HDG/PITCH/FOV/RANGE/HGT/ΔN/ΔE, absolute values). Persistence is
  now **save-gated**: edits are live but unsaved (`CAL · EDITED` chip) until SAVE CAL writes
  the v2 store. Do not add
  Translation arrows use a depth-test-free pickable tip so E/N/U ownership remains unambiguous even where shafts overlap
  other handles. Avoid hover effects that mutate gizmo polyline geometry (width) — the primitive rebuild blanks the pick buffer and eats the
  following click (root-caused 2026-07-05). Gizmo input checks the topmost, depth-test-free
  handle with `scene.pick` first and uses `drillPick` only as an overlap fallback; this keeps
  hover and press responsive on software GL without changing the real-GPU interaction. Frame serving is bounded independently from the
  10-second active refresh: upstream and Street View attempts abort after 8 seconds, and the
  panel/monitor plane keep at most one same-camera image request in flight. This prevents a
  slow provider from being cancelled and restarted forever while stale `SNAPSHOT · OK` health
  remains beside a pending preview. Grounding is shared with every other height consumer:
  CCTV warms/resolves `groundFloor.js` cells, reads `cachedGroundFloor()`, and delegates optional
  Google 3D refinement to the unchanged `meshFloorSampler.js`. During E/N gizmo movement the
  prior floor is frozen (constant elevation and zero transient samples); release or reset makes
  one resolution request at the committed anchor. U edits remain pure geometry and enforce the
  2 m minimum mount height above whichever shared floor wins, including a rooftop. Public camera
  state exposes `groundPriorM` as the immutable Re:Earth ellipsoidal datum reference; it is kept
  separate from live frustum geometry because Google-3D can refine the rendered ground to the
  photogrammetric mesh.
- **CCTV citywide ambient cards** (built 2026-07-29; shared-host migration
  2026-08-02): the LOD-selected nearby static cameras (20/28/40 by zoom,
  `cctvLod.js`) get **screen-space thumbnail cards** through the shared world-overlay host
  showing paced static frames — reselection on `camera.moveEnd` only, at most one frame fetch
  per second layer-wide, per-source cadences (Austin 5 min, TfL/Caltrans 3 min). Zero-flicker:
  a card renders nothing until its first frame, a drawn frame persists through failed fetches,
  and eviction grace (2-pass/5 s) stops budget-edge churn. Camera icons stay visible at every
  zoom. Eligible candidates are filtered to in-view stills with valid IDs,
  finite distances, and one deterministic representative per camera before
  ranking; videos, hidden/malformed rows, and duplicate outliers cannot alter
  the density scale or displace a valid winner. They are ranked with a
  deterministic 50/50 blend of eye distance and normalized screen-center offset
  before the existing 5×4 distribution pass, so the center wins contested
  density without removing peripheral coverage or changing the bounded count.
  The active camera keeps the v3 monitor plane and is excluded from the
  40-card ambient ring with no thumbnail by default. An explicit
  `activeCameraCardEnabled` presentation option can publish the retained
  protected-card path. Disable tears the tier down completely.
  Coverage/viewshed semantics unchanged.
- **Satellites**: orbit rings rotate about Earth's Z by ΔGMST every ~1s (exact inertial→ECEF compensation; no SGP4 re-runs); the tracked satellite propagates per frame with one shared epoch for dot/label/camera. Verified: ISS holds <1km perpendicular to its ring while tracked.
- **Space Missions (30d)**: recent launches render as bounded shared-host, horizon-occluded mission markers using Launch Library 2 v2.3 detailed records. Enabling the layer selects the unified right-side Context panel's Space Missions mode and enables the required satellite layer. Before applying its temporary dense/hidden Satellite mode, Space Missions snapshots the complete standalone Satellite parameter set and exact enabled-layer set. Disabling Space Missions from either Context or the left Data Layers rail restores those parameters and the exact prior enabled state, so a Satellite layer that was already on stays on while a mode-owned dependency returns off; enabling Satellites by itself remains independent. Selecting a mission isolates its launch-to-orbit transfer and dashed satellite orbit, fills that same panel with navigation/details, and animates a small phase-colored marker along the exact displayed Cartesian samples. Marker hit testing drill-picks through photorealistic tiles so the depth-test-free tactical dot remains reliably selectable; its text is non-interactive shared-host presentation. The selected pad is the camera's zoom pivot: the overview remains centered on its launch site, wheel zoom approaches that site instead of drifting elsewhere, and camera pitch progressively changes from global nadir to an oblique close 3D view. Its protected shared-host callout remains visible and expands to include both mission and launch-site names. `FOCUS` flies directly to a 12 km oblique frame around the selected launch site and retains the same anchored zoom/orbit behavior. `REPLAY ASCENT` resets the selected marker at the pad, frames it from an oblique third-person angle, and follows it through the mission-specific compressed ascent directly into one orbital lap at the default `1×` rate. A live `0.25×`–`4×` slider changes ascent and orbit playback speed; adjusting it mid-replay preserves the current path position and historical mission timestamp. Re-entry/recovery cannot be inserted into replay. At orbit insertion the camera smoothly pulls back over the first fifth of the orbital replay and pitches to a globe-scale nadir view while continuing to target the moving replay point. Replay Cancel, mission navigation, deselection, layer disable, and data refresh all release camera ownership. Reconstructed paths are one continuous 128-sample geodetic curve: horizontal departure begins near zero while altitude rises quickly, then the climb progressively bends toward insertion without the former hard 120 km corner. Unmatched orbit fallbacks are smooth planar inclined rings rather than longitude/latitude ground-track curves. The panel lists disclosed payload names, types, operators/manufacturers, mass, multiplicity, and destination when supplied; an empty LL2 payload collection is shown as `CLASSIFIED / MULTI-PAYLOAD`. Launcher, spacecraft, and recoverable payload stages appear in a compact stage table with serial/flight/reuse details, recovery outcome/type, destination, and final coordinates when those records exist; an empty recovery collection omits the section. Stage recoveries with confirmed coordinates use those coordinates; return-to-launch-site records use the pad; downrange-only records receive an explicitly labeled estimated endpoint along the ascent azimuth. Available endpoints render as static 2 px dashed descent/recovery paths with a fixed final-position dot and an estimated atmospheric-interface segment when applicable. The ascent is geodetically densified above the ellipsoid toward the orbit's nearest insertion point, then rendered with `ArcType.NONE`, so it neither cuts through Earth nor separates from the marker. Because LL2 does not normally supply continuous ascent telemetry, pad-to-insertion paths without upstream trajectory samples are labeled `RECONSTRUCTED ESTIMATE` / `ASCENT ESTIMATE`; only supplied trajectory samples receive the replay wording. Selected-orbit framing fits the complete ring, rear-side linework uses normal scene depth occlusion, and current distance, speed, and callout data come only from a launch-year-validated satellite match. Speed is the magnitude of the SGP4 inertial velocity vector at the same propagation epoch as position, displayed in km/s with km/h available as hover detail. Unavailable operator, site, launch-time, orbit, current-altitude, and speed values omit their detail rows instead of reserving panel space with placeholders. Newly launched payloads absent from the core operational groups use CelesTrak's cached active TLE feed as a lookup-only fallback; weak constellation-name matches are rejected. The replay callout maps compressed animation progress onto Launch Library's mission-relative timeline, showing the historical UTC date/time at the marker's current path position; unavailable timelines remain explicit. Matched live satellite positions propagate at one-second cadence and use a distinct green dot/callout with the current UTC date/time.
  When no mission is selected, the Context panel presents a scrollable newest-first roster of every launch in the rolling window, including the smaller 5 px operator-colored marker, provider, and launch date. Hovering or keyboard-focusing a row shows four compact cyan corner brackets on both that roster row and its corresponding globe dot, rotates the globe at the current zoom to center it, and gives its label declutter priority without selecting it; the globe label remains unbracketed. Selecting a roster row invokes the same mission isolation and full-orbit framing as clicking its globe marker. The replay vehicle is one screen-space SVG/CSS HUD overlay rather than separate Cesium billboard, label, and reticle graphics. It is hidden during ordinary Focus and manual close views, where the standard selected launch-site label remains visible, and exists only while ascent replay is active. Its fixed pixel scale is shared by ascent and insertion, so camera range never resizes the rocket on screen before the phase boundary. Generic Launch Library pad names are reduced to their identifying suffix, and replay timestamps use a cyan state title over unprefixed white UTC date/time values. `REPLAY ASCENT` holds the unframed cyan/white rocket at the pad for a real-time `T−10` countdown, transitions through `LIFTOFF`, and attaches six tapered cyan/white ellipse waves directly below it from liftoff through insertion to convey thrust without adding scene geometry. While replay is active, the single start button is replaced by compact Play, Pause, and Cancel icon controls. Pause freezes countdown or mission time, vehicle/stage positions, camera target, labels, and thrust-wave animation; Play resumes from that exact frame, and Cancel releases replay camera ownership. The rocket and thrust group rotates from the path's live screen-space tangent, so its nose follows the visible ascent curve while the adjacent text remains upright. The camera begins as a close oblique launch chase, then smoothly widens between roughly 120 and 420 km vehicle altitude into a higher oblique context view that keeps the moving rocket targeted while exposing the ascent bend and orbit connection. At insertion the rocket/thrust glyph is replaced by the fixed-size cyan orbit dot, which the camera follows through the existing globe-scale orbit pullback. The chase camera limits per-frame yaw changes across heading wraps so it cannot abruptly cross in front of the vehicle and make ascent read in reverse; the replay-speed slider affects mission playback but not countdown duration.
  Mission world text has no native `LabelGraphics`: overview launch markers publish at most 48 ambient candidates for a 24-winner budget, while selecting a mission clears that overview source and publishes its launch-site callout, stage re-entry annotations, live/estimated payload-position readout, and orbit annotation as protected selected-lane entries. The source retains the exact former strings and colors. Static anchors reuse the Cartesian values used to build their mission geometry; the moving payload entry reads the layer's per-frame live-position cache; catalog-backed orbit annotation positions are cached in the same one-second matrix update that realigns the orbit primitive. Keyhole edge fade, horizon culling, final collision placement, and UI exclusion are owned by the shared host. Deselect restores the bounded overview, and refresh, disable, and destroy replace or clear both mission sources.
  A selected mission renders its orbit as four repeating tactical sectors, each containing one prominent cyan dot followed by one hundred thin translucent dashes. The bright dots act as orbit anchors while the subdued dash field remains depth-tested against the globe and is shown only for the selected mission.
  Close selected-pad views add one static 500 m-radius cyan launch-zone ring with a low-opacity translucent fill over the sampled photoreal launch-site surface. The single scene primitive is created only for the visible selected site and is otherwise dormant. It appears during Focus, sufficiently close manual zoom, and the replay countdown, but is suppressed above 120 km camera altitude, beyond 180 km direct camera-to-pad range, for unselected missions, and whenever Space Missions is inactive. Focus establishes a launch-site-centered camera transform once; subsequent manual heading and pitch changes remain centered on that site without an automated per-frame correction. Surface mission markers and labels use an additional conservative globe-limb margin before the exact ellipsoid occluder boundary, preventing near-horizon visibility from alternating between frames.
- **AIS vessels**: chevron symbology (naval cyan base, type tints), world-space headings, MMSI-keyed reconciliation (selection survives refreshes; pinned 3 refreshes with STALE marker when absent), detection-overlay integration (`type: 'SEA'`), contextStore registration for voice Q&A. Empty-space clicks, id-less photorealistic-tile picks, and Escape dismiss the vessel card/HUD/context and clear its trail; picks owned by another layer (including `gev-trail:*`) and raw vessel-record picks without a live MMSI key are no-ops for vessel selection. Click and key handlers detach while the layer is disabled and reinstall on enable. Selecting another vessel replaces the selection and trail, and reconciliation clears a trail if its owning vessel is evicted.
- **Track trails**: server accumulates per-MMSI ring buffers (`/api/ais-live/track?mmsi=`, Float32+Uint32, 64 samples, 30s/25m thinning); aircraft backfill proxies `/api/opensky-track` (OAuth, own credit bucket) and `/api/adsblol/trace` (tar1090 readsb, ~24h history, ODbL — credit adsb.lol).
- Shared `src/data/pickRegistry.js` stops the two flight layers' click handlers from fighting over the camera.

### Share-link v2 layer state (August 2026)

- Generated share links use a deterministic v2 hash. Existing camera, visual,
  HUD, detection, post-processing, celestial, scope, and map-stack fields remain,
  with compact fields for enabled layers, allowlisted layer options, panel state,
  and the active preset's allowlisted shader controls. An absent layer field uses
  deterministic defaults; an explicit empty field means no enabled layers.
- The registry seals only after all 16 production layers register, and every
  layer has an explicit serialization disposition. Unknown enabled-layer tokens
  reject the layer payload; unknown option tokens are ignored. Restoration
  settles independently per layer so one failed or unavailable source cannot
  block its siblings.
- Stable visible options are limited to aircraft 3D mode, selected civilian and
  military flight IDs, Satellite catalog and selection, CCTV coverage/projection/
  auto-hop, and Radio filter/volume. Playback and tuning, live-data health,
  calibration, caches, lifecycle state, temporary Context ownership, and derived
  effects are deliberately excluded. Radio restore never selects or plays a
  station.
- Normal loads restore the last successful explicit UI, voice, or tool choice
  from versioned local storage. Any valid camera share wins for the current load
  without overwriting recipient preferences. Restore ownership is split by
  visibility, option/selection, camera, visual, map, and individual panel lane:
  a newer explicit action supersedes only the field it owns. In particular,
  navigation cannot turn unrelated layers off, and an option change cannot
  cancel the same layer's visibility transition. Every explicit HUD, detection,
  post-processing, scope, or celestial action from the UI, keyboard, voice, or
  public tool facade claims the visual lane before mutation. Invalid requests do
  not claim that lane or partially change controls.
  Direct globe pointer and wheel gestures supersede the delayed shared camera
  and selected-subject Follow without aborting unrelated layer visibility or
  display-option restoration.
- The initial restore has one terminal promise spanning the camera flight,
  visual/map/panel callback work, every production layer result, and the
  destination-scoped selected-subject Follow result. Hash writes remain
  suppressed and the startup screen continues to read `Restoring shared view...`
  until that aggregate settles. Destroy settles it as destroyed rather than
  permitting late mutation. A superseded shared visibility intent follows
  the authoritative successor chain to a terminal lifecycle result, including a
  same-target re-enable or opposite-target disable, before releasing the layer
  barrier. Flights, Military, and Satellite first-update
  fetches consume the manager AbortSignal; disable and destroy also abort their
  module-owned feed or dense-catalog requests.
- Only one Flights, Military, or Satellite tracking ID can be durable at once.
  Explicit selection clears the other families, Stop Tracking clears active and
  pending IDs, and ambiguous incoming multi-family selections fail closed rather
  than letting feed arrival order choose the camera owner.
- An explicit aircraft selection made inside Contacts promotes the owning
  Flights or Military layer from a mode-owned dependency into durable state, so
  leaving Context, reloading, or opening the link can restore it. Passive
  Contacts autofocus does not revoke a pending selected aircraft; the exact
  shared/local target wins when its feed row arrives.
- A shared Flights, Military, or Satellite subject that has not arrived yet
  publishes a persistent top-center `ACQUIRING` progress state while the
  existing deferred-restore latch and source-specific deadline remain active.
  Success, expiry/failure, cancellation, superseding intent, owner-layer
  disable, explicit navigation, and teardown all settle and clear that state;
  caller abort remains authoritative after the pending handoff. A latch that
  rejects its deferred selection emits only the terminal failure and never a
  false acquisition state. An unrelated manager failure preempts `ACQUIRING`
  for its full visible dwell; if acquisition is still owned afterward, the
  progress state resumes. A share-specific terminal failure that arrives while
  another failure is visible is queued, and its own fixed dwell starts only
  when that message reaches the screen. Only terminal failures use the existing
  fixed-dwell error presentation.
- Radio category persistence shares the live directory's bounded normalizer,
  including generated genre identifiers with spaces or `&` such as `Hip Hop`
  and `R&B`.
- Shared panel state starts from deterministic defaults and excludes responsive
  auto-collapse. Partial or malformed panel fields cannot import or overwrite
  recipient-local layout preferences.
- A fresh Cockpit entry temporarily collapses the standard left/right map
  panels and opens Cockpit's own Contact and Live Signals rails. This runs only
  on entry: Previous/Next preserves any panel the operator opens while already
  inside. Exit restores the exact standard-panel open/collapsed snapshot from
  before entry; Cockpit-only disclosure changes do not replace that map layout.
  Opening Data Layers while inside Cockpit temporarily collapses the Contact
  panel to prevent overlap. Closing Data Layers restores Contact only when that
  accordion action collapsed it; an operator's own Contact collapse remains
  authoritative.
  Voice selection of the nearest aircraft near a named place follows
  the requested-layer enable → location arrival → destination refresh → nearest
  airborne lookup → aircraft selection path, excludes on-ground records, and
  never enters Contacts or Cockpit unless either mode is named explicitly. The
  destination refresh also runs when the requested layer was already enabled.
  The lookup inspects the full loaded fleet and tracks by stable ICAO identity.
  That complete route is one atomic voice action, so Realtime sibling calls
  cannot race the nearest-aircraft query ahead of layer enablement. A healthy fallback feed is
  queried normally and its source is returned with the selection; fallback with
  no airborne records remains an honest no-data result, not an enable failure.
- Voice treats the parent Context panel and Contacts as separate intents. An
  explicit request to open Context expands only `global-context-panel`; it does
  not choose a mode. An explicit request to open Contacts expands that parent
  first, activates the Contacts sub-view, and returns the settled 250 km window.
  Its `aircraft` count is the exact civilian-plus-military total when both feeds
  can answer, or `unknown` when either component is unavailable.
- Cockpit's top vision switch cycles five rendered looks: the inherited map
  style, CRT, NVG, FLIR, and Noir. There is no empty `NONE` entry.

### Live AIS Vessels (June 2026)

**OKO coverage update (2026-09-05):** `aisCoverage.js` now selects measured positions
by occupied 10° cells, with recent fixes before last-known fixes. The client sends
the zoomed viewport (including dateline-crossing bounds) and selected MMSI; the
worldwide upstream subscription remains unchanged. Camera settlement triggers a
local-cache refresh after 500 ms, throttled to at most once per 5 s; normal polling
continues. The selected vessel can remain outside the viewport within the same cap.
Static AIS messages update identity only. Missing/invalid timestamps, regressed
fixes, fixes over one minute in the future, and expired positions cannot rejuvenate
a contact. Measurement time controls retention, not receipt time.

Positions remain in the bounded server cache for at most **6 hours**, subject to
the existing 50,000-contact capacity and periodic pruning. The longer window is
last-known context, not a claim of additional coverage. Fixes aged **10 minutes**
become grey `LAST KNOWN` contacts, keep their measured coordinates, lose 3D models,
and are excluded from current proximity/contact cohorts. Cards, HUD and analyst
metadata disclose age/state; the layer row separates recent and last-known counts.
The cache and recent paths are in memory and do not survive a server restart.

`/api/ais-live` adds `coverage`: retained/in-view/returned counts, limit omissions,
fresh/last-known counts, effective subscription bounds and cache capacity state,
plus 72 geographic 30° cells with observation counts and newest measurement time.
These count unique retained contacts, not incoming messages or all ships at sea.
Layer stats additionally expose horizon/LOD admission and label counts (not GPU
visibility). Empty cells establish missing observations, never zero traffic.
No additional provider or paid API is used. AISStream reception gaps remain.
The older 30-minute retention description below is superseded by this policy.
Validation: full `npm test` passed (2,840 ordinary tests plus 14 allocation tests);
the final AIS-focused run passed 95 tests, including empty-view/outage distinction
and last-known selection. Production build passed. `test:track` was stopped after
Google 3D root tiles returned HTTP 403; live visual acceptance remains unverified.

- Server-side `ws` websocket to `wss://stream.aisstream.io/v0/stream` maintained by Vite middleware; `AISSTREAM_API_KEY` never reaches the browser (AISStream has no browser CORS). The `ws` package is used rather than Node's built-in WebSocket specifically because only it can hard-abort a wedged socket (see the watchdog note in the delta block at the top).
- Browser polls same-origin `/api/ais-live` cache every 60s.
- The first enable in a session starts one 30-second client grace timer. Until
  an accepted vessel position arrives, `live`/`open`/`connecting` transport reports
  `LOADING`; the timer is not restarted by the 60-second poll. Expiry or a
  definitive transport/credential failure reports `UNAVAILABLE`. Accepted
  warm vessels survive later zero-position refreshes as stale/degraded data,
  while disable/re-enable owns a new timer and superseded responses remain
  inert.
- Client render cap `VITE_AIS_LIVE_MAX_ROWS` (default 12,000); type-colored ship icons (tanker/cargo/passenger/fishing/tug); screen-space label clustering caps active labels at `VITE_AIS_LIVE_LABEL_MAX_ROWS` (default 900).
- Click-to-inspect wired into the voice context store.

### Voice Control (June 2026)

`GEV MIC` button (bottom UI) starts an OpenAI Realtime session over WebRTC:

- **Token flow**: browser fetches a short-lived client secret from `/api/realtime/token`; the Vite middleware holds `OPENAI_API_KEY` and posts the full session config (instructions, tool schemas, VAD, truncation) to `api.openai.com/v1/realtime/client_secrets`. SDP exchange goes directly to `api.openai.com/v1/realtime/calls` with the ephemeral token.
- **Session defaults** (env-tunable): model `gpt-realtime-2` (or `gpt-realtime-2.1-mini` when the MINI tier is selected — see the model-tier entry below), voice `marin`, reasoning effort `low`, semantic VAD with low eagerness, no response interruption, context window truncated to ~3,000 post-instruction tokens with 0.5 retention ratio — the conversational window stays short because map state is fetched live per turn.
- **Twenty-eight tools** (schemas defined server-side in `vite.config.js`, executed client-side in `src/voice/gevActions.js`): `fly_to_location`, `select_nearest_aircraft`, `adjust_camera_zoom`, `zoom_to_globe`, `set_layer_visibility`, `show_data_layers_menu`, `set_panel_open`, `set_visual_style`, `get_entity_context`, `get_current_view_state`, `set_hud`, `set_detection`, `set_map_stack`, `set_post_processing`, `control_scene`, `control_cctv`, `set_context_mode`, `control_cockpit`, `control_radio`, `track_entity`, `stop_tracking`, `frame_overhead`, `annotate_map`, `clear_annotations`, `move_camera`, `fly_route`, `analyst_query`, and `next_iss_pass`.
> **Reading `npm test` totals:** the count depends on the Node major. The two
> GC-bracketed allocation microbenchmarks (`src/data/focusAllocations.test.mjs`
> = 1 test, `src/overlays/worldOverlayAllocation.test.mjs` = 13) only RUN on the
> calibrated Node 24 runtime; on any other major the runner skips both files and
> their 14 tests are absent from the total. A branch total quoted without its
> Node version is therefore not reproducible. As of the fly_route cinematic
> branch: **2,281 on Node 25.6.1** (allocation suites skipped) = 2,255 on
> `main` + 26 route pins; the same tree on Node 24 reports 2,295.

- **Camera verbs** (`src/cameraVerbs.js`) — one motion slot, driven per clock tick. `move_camera` orbits/pans/tilts/rotates; `fly_route` is a cinematic dolly along an existing route annotation.
  - **The route dolly is shaped, not linear** (2026-08-20). A trapezoid speed profile (smoothstep up, cruise, smoothstep down, distance taken as the closed-form integral) eases both ends without changing the pace — duration is still `totalM / ROUTE_M_S[speed]`, with one exception: a 0.5 s minimum keeps a degenerate route from being an instant teleport, so routes under 10 m (slow) / 20 m (normal) / 45 m (fast) fly SLOWER than the speed word, never faster. Turns bank up to **10°** (a 90° street corner settles near 7.5°), measured as a triangular pulse over a 4 s window centred on the camera so the roll leads in and unwinds after. Altitude breathes ±20 m around the 260 m mean and lifts up to 26 m into turns. Pitch is LOCKED at −32°; heading comes from a gaze that leads the path by 6.5 s of travel. `prefers-reduced-motion` zeroes the roll and the altitude shaping and keeps the easing.
  - **Invariants — do not "fix" these.** (1) **Every** release levels the roll: completion unwinds it through the ease-out envelope, and `interruptCameraMotion` zeroes it synchronously (heading/pitch/position preserved). Cesium keeps the last up vector it was handed, so skipping this leaves the user holding a tilted horizon. (2) Heading is interpolated as an ANGLE about the local up, never as a Cartesian lerp — a lerp cannot cross an antipodal pair, so an out-and-back route looked backwards for the entire return leg; `signedTurnRad` branches the exact-180° case deterministically because the cross product's sign there is a floating-point coin toss. (3) A COLD floor cell is missing data, not flat ground: route vertices carry height 0, so trusting them flew a mountain corridor at 260 m above the ELLIPSOID. The corridor warm is fire-and-forget, so the dolly ARMS — camera untouched, no teleport onto the route — for up to 1.2 s waiting for real floor data, falls back to a rendered-mesh probe (`scene.sampleHeight`) when the DEM stays cold — latched to ONE firing per flight, for exactly the cells the cache could not answer, so a route costs at most 8 `sampleHeight` calls however long it arms — and otherwise holds the launch altitude for the whole route. A corridor is only RESOLVED when every cell is accounted for: one warm cell says nothing about the ground under the other seven, and treating it as an answer let the dolly descend to 460 m over a 1,600 m rendered surface. The probe reads the rendered surface at the current LOD (rooftops and primitives included) — a better estimate than nothing, not a guaranteed upper bound. Never descend blind. The floor is SMOOTHED in both directions for the ride while the hard clearance clamp reads the RAW sample, so a cell boundary cannot pop the eye but a cliff is still cleared on the frame it is seen. A pre-departure floor is adopted whole; one arriving mid-flight is eased onto, and the eye's descent rate is capped.
  - Pins: `src/routeCinematics.test.mjs` (26 tests), with `scripts/qa-flyroute-mutations.mjs` reverting each fix individually to prove they are load-bearing (19 named defects); rendered proof `scripts/qa-flyroute-cinema.mjs` (drives the real voice runner, measures the real Cesium camera every frame, writes a labelled contact sheet).
- **Public control facade** on StyleManager (`setHudVisible/setHudLayout/setDetection/setMapStack/setBloom/setSharpen/setOrbit/setCleanView/getControlState` plus `runImmediateNavigation`): every setter syncs DOM sliders + share links + scene snapshots and returns `{ok, ...state}` — voice confirms only what actually happened. Validated `move_camera`, `fly_route`, `frame_overhead`, strongest-fire focus, and entity tracking use the shared navigation transaction, which refuses Cockpit before mutation, advances authority, releases follow owners, cancels stale work, and only then starts the requested action. All four entity layers expose `findByQuery/getNearby/getAllPositions/trackById|selectById/stopTracking/getTrackedInfo`.
- **Scene context** (`get_entity_context`): selected entity from the context store, or visible entities ranked by distance to the view target (≤100km altitude); plus basemap context — view-target picking, 7-point viewport sampling, view-scale classification (global/continental/regional/metro/city/local), reverse geocoding (center ≤750km, viewport samples ≤3,000km), Google Places Nearby via `/api/google/nearby-places` (≤25km), known-landmark matching against `CITY_POIS`, coarse country inference fallback. Context assembly is capped at 1.5s with cache fallbacks; caches are deduped in-flight.
  - **Every selectable layer writes that one slot** (2026-08-21). The tracking layers — flights, military, satellites — publish selection on their own awareness lane (`gev:awareness-subject-selected`, consumed by the readout card and the Contacts panel) and for the life of the voice tools never wrote the shared slot, so `scope:'selected'` silently answered `in_view` with a contact plainly selected on screen. They now call `selectTrackedSubjectContext` / `refreshTrackedSubjectContext` / `clearTrackedSubjectContext` (`src/data/contextStore.js`) on select / poll / deselect. **Invariants: (a)** that write path must NOT dispatch `gev:entity-selected` — tracking layers already own an event lane and a second one makes two surfaces fight over one subject; **(b)** exactly one record per tracking layer, because a frozen snapshot of a moved contact must never reach the visible-entity scan; **(c)** precedence is recency, not layer — one slot, last selection wins, so clicking an overlay entity supersedes a tracked plane as the voice subject while the plane stays tracked. Satellites refresh on the 1 s propagation beat, not per frame.
  - **Context-mode vocabulary is symmetric** (2026-08-21). `set_context_mode` accepts `contacts`; the internal id is `flights`. Every model-readable field (`mode`, `entering`, `priorMode`, nested `context`/`contextRollback`, and the transition diagnostic text) is reported in the accepted vocabulary, with the internal id preserved as `<field>Internal`; an absent secondary mode stays `null` rather than claiming to be `off`. Mapping lives in `src/contextModePolicy.js` so UI text and voice payloads cannot drift. Reporting the internal id made the model read `mode:'flights'` as "Contacts is off" and refuse to answer from the `contactsWindow` counts in the same payload.
  - **Analyst → track handoff carries a key, not just a label** (2026-08-21). `analyst_query` items include `icao24`/`mmsi` alongside the display `id`, and contact lookup uses the shared tiered ranking in `src/data/contactMatch.js`: hex exact → callsign exact → registration exact → callsign prefix → registration prefix → callsign substring → registration substring. The tiers keep an exact callsign ahead of a colliding registration regardless of feed order, and registrations compare separator-insensitively (`G-ABCD`/`GABCD`, `05-8152`/`058152`, `N123AB`/`N-123AB`).
  - **A typed command supersedes the turn it interrupts** (2026-08-21). `sendTextCommand` defers its `response.create` behind an active response instead of colliding with it, marks that response superseded so a late function call from it is refused rather than dispatched, and drops the old turn's queued follow-up. A refused call is still ANSWERED — a terminal `{ok:false, superseded:true}` `function_call_output` — because an unanswered `function_call` strands a pending call and deadlocks the model; the refusal creates no response of its own. A burst of typed commands coalesces into one response while keeping both conversation items.
  - **Subject reconciliation across satellite catalog rebuilds** (2026-08-21). A dense↔core toggle or TLE refresh clears and repopulates the catalog, so the published subject is re-resolved against the new satrec; a subject that did NOT survive releases the slot. The per-frame refresh cannot do this itself — `_getTrackedFramePosition` returns early once the satellite has no catalog entry — so the reconcile runs at rebuild completion. An empty catalog is a rebuild in flight, not a disappearance.
  - **One aircraft-proximity engine** (2026-08-22). `collectAircraftProximityWindow` (`src/data/militaryAwareness.js`) is the single computation behind both the Contacts panel window and the voice analyst's entity-centred "how many nearby", so the panel readout and the spoken count for one centre are identical by construction. **Invariant: do not re-derive a proximity count anywhere else.** They diverged before because the panel read live billboard positions (20,000 cap) while the analyst used last-fix coordinates over a 2,000-record slice — 111 on screen, 15 spoken. Explicit regions and arbitrary points deliberately keep the general record engine. Entity-centred results carry `window: {engine:'contacts-window', centeredOn, radiusKm, flights, military, aircraft}`.
  - **Centre precedence for nearby asks**: explicit place in the question > Contacts subject (a selected non-contact entity never silently becomes the centre) > an entity the user names > the current view, said aloud. Contacts active with no subject uses the view rather than reading an empty panel.
  - **Contact-match ties break on hex ascending.** `track_entity` is a mutation fulfilling "follow that one", and the model's observed answer to a non-ok track result is to retry with guesses rather than ask, so the lookup always commits rather than returning an ambiguity. What it owes the caller is stability: hex is unique and always present, so the same query resolves to the same contact for as long as both are loaded.
- **Visual grounding**: at `local` view scale with no structured identity, the client captures the Cesium canvas (≤1200px JPEG, black-frame detection, double-render for freshness) and sends it as `input_image` with a strict "do not invent labels" instruction.
- **Context window**: only the latest viewport screenshot stays in context — the client deletes the prior image item (`conversation.item.delete`) before adding a new one (images are the most expensive item, re-billed every turn). Text history is bounded by the **server-side** `truncation: { type: 'retention_ratio', retention_ratio, token_limits.post_instructions }` set in `/api/realtime/token` (cache-friendly batched truncation). There is intentionally **no** client-side per-turn conversation-item cap — deleting from the front of history each turn busts the Realtime prompt cache. A spatially-aware summarize-and-prune policy is specced for a future iteration.
- **Model tier + spend guard** (`src/voice/voiceCost.js`, August 2026): the voice heading row carries a `STD`/`MINI` toggle and a running session-cost readout (`~$0.42`).
  - **Tier selection.** `standard` = `gpt-realtime-2` (default), `mini` = `gpt-realtime-2.1-mini` (~3× cheaper per audio token). The client sends `?tier=` to `/api/realtime/token`; the endpoint resolves it through the shared registry, so an unknown, empty, or hostile value falls back to `standard` rather than reaching OpenAI as a model id. Responses echo `X-GEV-Voice-Tier` / `X-GEV-Voice-Model` (plus `X-GEV-Voice-Tier-Fallback: 1` when a bogus tier was downgraded). Persisted at `godsEyeView.voiceCost.tier`.
  - **Applies NEXT session.** The model is fixed when the ephemeral token is minted, so a live session always keeps the model it connected with; toggling mid-session only records the preference (the button title says so). The cost tracker's lifetime is the session's lifetime and its model binding is immutable from `start()` to `stop()` — rebuilding it on toggle would erase accrued spend and let repeated toggles bypass the cap. The tracker may only be replaced once the session is FULLY SETTLED (`isVoiceSessionSettled()`: not active **and** no data channel **and** no peer connection) — `!isActive()` alone is not enough, because the `error` status reports inactive while the transport can still deliver a late `response.done`. The toggle itself reads and writes only the persisted preference, never the live tracker.
  - **Env overrides.** `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_MODEL_MINI` remain authoritative per tier, so a drifted upstream model id is a `.env` fix rather than a code change. Because an override can point a tier at any model, the client prices against the model id the server actually echoed, **not** the tier it requested. An unrecognised id is billed at the most expensive known rates plus one console warning — under-metering is what lets a cap be overrun.
  - **Metering.** Token usage from each `response.done` is folded into a per-session estimate. Cached tokens are subtracted from their modality totals; any aggregate-minus-details residual (and any payload with no detail at all) is attributed to audio rates, so uncertainty always resolves *upward*.
  - **Thresholds** (one object, persisted at `godsEyeView.voiceCost.limits`): soft warning at **$2** — amber readout plus exactly one console line; hard cap at **$5** — the session ends through the ordinary stop path (data channel and peer connection closed, mic tracks stopped) and the readout reads `Session ended — cost cap`. `0`/negative disables a threshold and round-trips through storage as an `'off'` sentinel (raw `Infinity` would JSON-serialize to `null` and silently restore the default); a corrupt entry falls back to the defaults rather than disarming the cap.
  - **Cap semantics — in-flight tools COMPLETE and are NOT rolled back.** A session-ending latch (`isSessionEnding()`) is checked at the tool-dispatch site, so no *new* tool is dispatched once the cap trips. `extractFunctionCalls` yields at most one call per event, so that single check covers the whole batch. A tool already executing may still finish its map mutation (a camera flight, a layer toggle, an annotation). This is deliberate: unwinding a partially applied map change has no safe general implementation, and a half-reverted camera/layer/annotation state is worse than a completed one.
  - **In-flight response at teardown → the accounting is INCOMPLETE.** Usage only arrives with `response.done`, which never comes for a response cut off by teardown (`stop()` closes the peer connection, and the server cancels rather than completes it). Rather than invent a token count for it, the tracker is marked `incomplete`: the chip shows a trailing `*` (`~$1.00*`) as a see-note mark and the tooltip carries the reason. Deliberately **not** presented as a lower bound — the estimate can also run high (residuals and unrecognised models bill at worst-case rates, and sub-cent totals round up), so it is partial rather than directional. (A bounded teardown drain was tried and removed: `pc.close()` closes the data channels a drain would listen on, so it was structurally dead.)
  - **⚠️ Model ids and rates are external facts** read from OpenAI's model + pricing pages on 2026-08-18 and marked VERIFY-AT-RELEASE in `voiceCost.js`.
- **Reliability**: tool-call dedupe (2.5s window across call/item/args keys); response-create queueing that respects active responses and defers follow-ups when the user starts speaking; per-tool follow-up instructions so the agent confirms only what actually happened (zoom confirms only on `ok=true`).
- **Aircraft identity honesty:** “What is this aircraft?” reads callsign, operator, registration, type, and route only from the selected contact context. Missing operator, route, or type enrichment is named explicitly rather than silently omitted or inferred from the callsign.
- **Diagnostics**: every client/server event is posted to `/api/realtime/debug-log` and appended to `.gev-logs/realtime-conversations.jsonl` (gitignored) with secret/image redaction; last 30 errors persist in `localStorage` (`gev-realtime-errors`); `window.__gevVoiceCommands.getDiagnostics()` in the console.
- **Counting semantics ("near")** — a CONTRACT; new count-bearing tool work inherits it. Three honest numbers exist for one question: the Contacts cohort (250 km around the subject, what the panel shows), `analyst_query`'s count of *currently-loaded* records for the requested scope, and the layer-wide loaded total in `coverage.layersQueried[].records`. They diverge legitimately — the flights layer loads by viewport, so after a camera dive the loaded set can hold a fraction of the cohort (field case: panel 42, analyst 8). The contract:
  1. **Contacts ACTIVE** → "near / nearby / how many aircraft" means the **Contacts window** — the panel's numbers, spoken verbatim. Mechanism: `contactsWindow` (`{centeredOn, radiusKm, flights, military, vessels}`), carried by both `analyst_query` and `get_current_view_state`, derived by `contactsWindowFromSnapshot()` from the same snapshot the panel renders so the two cannot drift. A cohort whose feed cannot answer reports `'unknown'`, never a confident zero.
  2. **Contacts OFF** → "nearby" means **in view**; "near \<place\>" means a radius around that place. A radius query with Contacts active and no explicit centre is centred on the **active contact**, not the camera.
  3. **Every count names its scope in words** — "42 in your window", "8 in view", "about 30 within 250 km of Austin" — never a bare number. `analyst_query` returns `scopeLabel` so this is mechanical. Two different numbers with named scopes are not a contradiction.
  4. **The loaded-data caveat is stated once when relevant**: counts cover loaded data, and the flights layer loads where you look (appended to `coverage.note` for radius/view scopes over viewport-loaded layers).
- **Degradation**: without `OPENAI_API_KEY`, `/api/realtime/token` returns 503 and the mic button surfaces the error; the rest of the app is unaffected.

### AI HUD Summary (June 2026)

- HUD `SUMMARY` readout requests a five-word intelligence-style summary from `/api/openai/hud-summary` (model `OPENAI_HUD_SUMMARY_MODEL`, default `gpt-5-nano`, minimal reasoning).
- Input is the live basemap label context (place/street/nearby-place labels + enabled layers) — the model is instructed not to infer from coordinates.
- Output is sanitized to exactly five words; falls back to the deterministic telemetry summary on error/timeout (5s abort); typewriter animation on update.

### Map Stack Switcher (June 2026)

- `src/mapStackController.js` switches between Google Photorealistic 3D (`photoreal`, default), Bing Aerial / Aerial-with-Labels via Cesium ion world imagery (require `CESIUM_ION_TOKEN`), and OSM tile fallback. Bing Road is **retired**: it is gone from `MAP_STACKS`, from the `set_map_stack` enum, and from the voice aliases (road phrasings now resolve to OSM, the one shipped road basemap). An old `map=bing-road` link is simply an unknown id and takes `setStack()`'s existing photoreal fallback with the Google 3D tile lit — pinned live in `scripts/qa-map-source-tray.mjs`.
- The bottom Visual Presets tray presents a **four-tile MAP SOURCE row** (`#map-stack-chips`, `src/mapStackChips.js`): Google 3D, Bing Aerial, Bing Labels, and OSM. The duplicate left `#stack-panel` is retired. The four tiles share one row on desktop and two rows on narrow screens, carry `aria-pressed` on the active source, and remain keyboard-reachable with a visible focus outline.
- The lit tile follows controller state, not the click: a rejected switch (no ion token) or a superseded one (rapid A→B) leaves the genuinely active source lit, and the tray heading keeps its short-label status readout (`...` while switching, amber on `lastError`).
- Ion stacks remain visible and keyboard-focusable when no ion token is configured, but expose `aria-disabled="true"` and do not switch. Their accessible label and tooltip quote `getStacks().unavailableReason` — the same string `setStack()` puts in the toast. OSM works keyless. The `ION` badge is gated on the stack's own `requiresIon`, so a `photoreal` chip unavailable because the Google tileset failed says so instead of falsely demanding an ion token.
- Stack choice participates in share links (`src/sharelink.js`) and falls back to OSM when Google 3D tiles fail to load. Share-link restore, the `set_map_stack` voice tool, and the chip row all land on the same `_setMapStack()` path.

### Voice Map Whiteboard / Annotations (June 2026)

- Runtime entry: `src/main.js` calls `initAnnotations({ viewer, tileset })`, exposes `window.__gevAnnotations`, and passes the engine into the voice action runner.
- Engine contract: `src/annotations/annotationEngine.js` owns annotation state, TTL/fade lifecycle, concurrent anchor resolution, duplicate detection keyed on geometry, cancellation on clear/newer generations, and a hard cap of 120 live marks. Deferred outline upgrades drain FIFO at concurrency 2; queued work retains the owning abort controller and is discarded on a generation change before it can fetch.
- Resolver contract: `src/annotations/annotationResolver.js` converts names/coords/screen pixels into world anchors and optional geometry. The resolver is type-aware: Google Geocode/Places gives a centroid + scope, OSM/Overpass supplies admin/place/footprint/street/enclosing-area geometry, route requests use `/api/route`, and ambiguous/far results are rejected or recovered near the current view instead of drawing misleading blobs. Only explicitly country/state/county-scoped asks bypass near-view recovery and proximity gating; state scope requires a leading `state of …`/`the state of …` phrase, while bare names, proper names ending in “State,” and administrative geocode result types alone remain guarded. Overpass throttles remain distinct from normal transients: `Retry-After` is honored for one retry, and a repeated throttle ends only that mark's outline upgrade.
- Renderer contract: `src/annotations/hybridAnnotationRenderer.js` routes draped `area`/`route` geometry to world-space Cesium rendering and reticles/pins/arrows/callouts to the screen-space SVG renderer. Area labels are screen-space callouts so all captions share one visual language; progressive outline upgrades convert the existing screen group in place when the anchor snaps to the resolved centroid.
- Tooling: voice has `annotate_map` and `clear_annotations` tools. Annotations accumulate and persist by default; clearing is explicit only. Partial failures, approximate synthesized zones, and route fallbacks are returned as structured tool results so the voice layer can be honest.
- Console/dev API: `window.__gevAnnotations.tour()`, `.demo()`, `.annotate()`, `.clear()`, `.count()`, and `.list()` are the deterministic no-mic test surface.
- Current known resolver gap: mall/lifestyle districts such as "The Domain, Austin" can prefer a named building over the broader retail envelope. Product decision is that districts should become envelope + key buildings, but the scoring change still needs a careful multi-case validation pass.

### 3D Aircraft + Tracking (June 2026)

- **The TRACKED contact's 2D↔3D handoff is DEFAULT behaviour (2026-08-19), driven by camera distance alone.** It does NOT consult the DISPLAY-rail `3D` toggle, which continues to own the FLEET (the un-instanced draw-call budget stays the operator's decision). Policy lives in `src/data/trackedModelRegime.js` and is shared by both layers: enter below `TRACKED_MODEL_ENTER_ALT_M` = 150,000 m and hand back to the billboard only above `TRACKED_MODEL_EXIT_ALT_M` = 172,500 m. **The swap distance was set by playtesting on 2026-08-20:** a first pass at 1,000,000 m switched too early; 2D reads correctly at ~600 km and the handoff belongs at ~150 km. **Consequence, recorded on purpose:** the tracked contact now enters 3D NEARER than the FLEET does (`MODEL_ALT_CEIL_M` = 800,000 m, unchanged), so with the DISPLAY-rail `3D` toggle on, 150–800 km draws surrounding contacts as models while the selected one is still a glyph. Nothing double-draws (the fleet pass skips the tracked icao) and aligning the two is a fleet-side decision, deliberately out of scope. **The two thresholds are asymmetric on purpose:** a single threshold makes a tracked orbit sitting ON the boundary strobe billboard↔model as the camera's altitude wobbles across it. Do not collapse them. The latch is scoped per selection, so a new target re-evaluates against the ENTER ceiling rather than inheriting the previous target's exit band. Exactly ONE model is involved; it loads on demand when the regime opens, is HIDDEN (not released) on regime exit so re-entry has no load gap, and is released by the existing teardown on deselect/re-track/destroy. Cockpit and TR-3B suppression are unchanged. **Two invariants around it:** (a) the hysteresis latch AND the load-failure latch are per-selection state cleared by `_resetTrackedSelectionState()` in the tracking lifecycle (deselect / re-track / cross-layer / init / destroy) — the predicate's icao-change guard is defence only, since it needs a drawn frame while nothing is selected and the render governor's idle mode does not promise one; (b) on-demand loading is bounded at 3 attempts per selection with a 1.5 s backoff and one console warning naming the asset — the driver runs every `scene.preUpdate`, so an unbounded catch means a missing GLB spins load→reject at frame rate. The billboard stays the visual throughout a failed load.
- **Grounded 3D handoff is terrain-validity gated (2026-08-23).** A ready civilian or military glTF does not own the visual until `groundSnap` (`src/data/groundSnap.js`) can answer with a MEASURED photoreal-surface height. On success the layer writes `height + the model's measured belly offset` before revealing the model. Cache movement is measured on the WGS84 surface, not across altitude, so a stationary contact keeps its snap through poll-time vertical-datum changes. Model existence or GPU readiness alone never suppresses the billboard floor, and ordinary zoom/style/deselect transitions preserve a valid snap cache. **Two states, and the difference is the whole design.** COLD — nothing has ever resolved for this icao (tiles still streaming on first sight, sample failure, backoff after a first miss): there is no evidence of where the ground is, `heightFor` returns null, the model stays hidden and the depth-test-free 2D billboard remains opaque and floored. WARM — a snap resolved and then a >`MOVE_INVALIDATE_M` (50 m) taxi move stopped it answering directly: the measurement is DEMOTED to a bounded last-known rather than deleted, and it keeps answering while the resample is outstanding, so a taxiing aircraft does not pop 3D→2D→3D across a 2–30 s retry backoff. The bound is `HELD_SNAP_MAX_DRIFT_M` = 250 m from the spot the value was measured at, past which the hold is dropped rather than stretched and the contact is COLD again. It is spatial with no timer beside it (ground under a contact that has not moved does not change; what invalidates the value is the contact MOVING) and deliberately a quarter of the billboard chain's `HELD_FLOOR_MAX_DRIFT_KM` — that hold only ever RAISES a sprite, while a held snap IS the model's placement, so its error shows in both directions. A fresh sample releases the hold, and so does a ground flip (which already calls `forget`). **A loading model is HIDDEN, never zero-scaled:** admission sets `show = false` (Cesium's default is `true`, and an unplaced primitive would claim the visual at the identity matrix), and ownership is `ready && show` — Cesium 1.138's `Model.update` has no `show` guard, so hiding a primitive costs its load nothing.
- Commercial and military aircraft use the same high-level FLEET model regime: 2D billboards when zoomed out, optional glTF models when closer, controlled by the DISPLAY rail `3D` toggle and `Proximity` / `All` modes. Since 2026-08-16 (Hangar fleet) models are PER-CLASS: real CC-BY GLBs for light/bizjet/turboprop/widebody/helicopter/uav (`CLASS_MODEL_REAL` in `src/data/aircraftClass.js` — meters-baked, scale 1, per-model belly/radius; provenance in `public/models/README.md`), the shared `airplane.glb` for the remaining civilian classes, and the military layer maps weight classes (real GLBs / 747 heavies / `jet.glb` fastjets, per-model heading offsets, always flat amber). Textured civilians carry a HEAVY tint, not a light one: `MODEL_COLOR_BLEND_AMOUNT` is `0.94` in BOTH layers under Cesium's `ColorBlendMode.MIX`, so the class colour supplies 94% of the surface and the asset's own texture ~6%. The visual direction is clean light silhouettes with only a weak diffuse contribution from the approved textures, so liveries deliberately do NOT read. IR boost raises the blend to a full `1.0`. Under NVG/FLIR (map preset or Cockpit vision) models render unlit flat-white at full alpha and scene fog is disabled (fog otherwise blacks out distant models with the globe hidden); state restores on exit.
- The DISPLAY-rail `3D` toggle is the user-facing activation path for both aircraft layers. Their small approved GLBs build their render resources without Cesium's frame-spread job queue, preventing continuous Photorealistic 3D Tiles streaming from starving model readiness; model caps, tracking, camera, and fallback billboards are unchanged.
- **The `3D` toggle DEFAULTS ON in `proximity` on a first run.** Proximity is itself the budget — models appear only below `MODEL_ALT_CEIL_M` and only for the nearest `MODEL_MAX` in view — so the default costs nothing at globe scale, and `all` remains a deliberate opt-in. A fresh boot runs NO layer-state restoration (`LayerStateCoordinator.start()` returns early with neither a share payload nor stored state), so four independent initializers decide what a first-run operator sees and must agree: `booleanOption('models3d', 'e', true)` in `src/data/layerState.js`, `_models3dEnabled = true` in BOTH flight layers, `this._models3dEnabled = true` in `src/ui.js`, and the `active` / `visible` classes on `#models3d-toggle` / `#models3d-mode-row` in `index.html`. All four are pinned together in `src/data/layerState.test.mjs`. Explicit state still wins: because the codec omits default-valued options, `models3d: false` is now what travels in a link (`lo=…f.e.0`) and restores OFF at both aircraft layers. **Consequence for returning users:** a stored `gev:layer-state:v2` blob is a FULL options snapshot, so a session that wrote one before this change carries `models3d:false` and keeps 3D off until the operator flips it (or clears the key) — the durable snapshot is treated as the recipient's own state, by design.
- **Consequence of the flip on the recorded tracked/fleet inversion:** the 150–800 km band where surrounding contacts draw as models while the SELECTED one is still a glyph is now what an operator sees WITHOUT arming anything. The inversion itself is unchanged and still deliberate (see `src/data/trackedModelRegime.js`); only its reachability changed.
- Civilian and military 2D aircraft use the established distance scale: `3×` near
  the camera and a `0.5×` floor from 8,000 km outward. A standard 20 px ambient
  icon therefore remains about 10 px at globe altitude while retaining the
  established close-range silhouette. Any compact alternative requires
  before/after visual evidence.
- Fleet model eligibility is distance-based with on-screen priority and hard caps (`MODEL_MAX`, `MODEL_MAX_ALL`) to avoid draw-call explosions. Each model owns its own `modelMatrix`; shared scratch matrices are forbidden because they caused stacking/flicker.
- Tracked aircraft use standalone model primitives driven from the already-settled dead-reckoned display position, while the tracked Cesium entity remains billboard-backed so `viewer.trackedEntity` always has a ready bounding sphere.
- Flights and military layers mirror the same tracking invariants: no warm-up freeze/jump, altitude-scaled framing, trail head glued to the displayed plane, no pull-out when switching targets, and no cross-layer orphan when switching between commercial and military tracks.
- Regression surface: `npm run test:track` drives the real app headless with synthetic aircraft feeds and asserts the tracking invariants without depending on live OpenSky/adsb data. `src/data/trackedModelRegime.test.mjs` pins the tracked contact's threshold math, the enter/exit asymmetry, and the default-on / cockpit / TR-3B / deselect wiring in both layers.

### TR-3B conversion Easter egg (August 2026)

- With a contact tracked, CONTEXT ▸ CONTACTS shows a small 🛸 chip beside COCKPIT (`#tr3b-toggle`, gated by `CockpitView.syncTr3bToggle()` on a tracked contact — not on the cockpit entry policy). Pressing it converts that contact into a TR-3B and pressing it again restores the real aircraft. State lives in `src/data/tr3bRegistry.js`: a session-scoped module-level `Set` keyed by ICAO 24-bit address, shared across both flight layers the same way `militaryRegistry.js` is, so a conversion holds through a civil↔military handoff. It is deliberately NOT persisted (no localStorage, no share-link param, no schema change) and layer teardown deliberately leaves it intact — only a page reload clears conversions.
- The sprite is two hidden kinds (`tr3b`, `tr3bHot`) in `src/data/aircraftIcons.js`, authored in the same 96×96 nose-up pipeline as the eight class silhouettes, so the triangle points along the display course through the existing screen-projected rotation path with `alignedAxis` still `ZERO`. They are unreachable from `classifyAircraft()`. Variant selection rides the existing `irBoost` layer param, so under NVG/FLIR/surveillance the hull stays cold and the four emitters render hot; a style switch re-images only converted contacts, never the rest of the fleet.
- Both layers resolve every `aircraftIcon()` call through a local `_iconKind()` shim (identity for unconverted contacts), so no refresh path — poll reconciler, two-tier raster swap, presentation pass, tracked entity — can revert a conversion.
- The class label follows the conversion across every surface that reports one: tracked card, cockpit/`getTrackedInfo`, Contacts, and the analyst record's `aircraftClass` (`tr3b`, the style-independent id, so a query answers the same in FLIR as in Normal). Callsign, flight level, speed, and route stay live-feed truth.
- A converted contact is billboard-only. It is excluded from model eligibility at SELECTION time, so it never consumes a `MODEL_MAX` cap slot, with the handoff guard and the tracked-model regime guard kept as defence. The billboard stays shown, so the contact keeps satisfying the `getNearby` / `getDetectableObjects` visibility guards and still works in Contacts and Cockpit.
- Regression surface: `src/data/tr3bRegistry.test.mjs`.

### Split-flap status chips (August 2026)

- The three status chips flip their LABELS over character by character when the text changes, like a departure board: `#global-loading-label` ("LOADING LIVE DATA" → "LOAD COMPLETE"), `#traffic-sync-label`, and `#cctv-sync-label` ("loading frames" → "camera grid ready"). All three route through `setSplitFlapText()` in `src/splitFlap.js`; there is no other writer of those three elements. The progress counters (`#*-sync-progress`, `#global-loading-detail`) are deliberately left as plain `textContent` — they tick several times a second, and flapping them reads as a slot machine.
- `#global-loading-label` doubles as the universal top-center status banner, so anything routed through `_showGlobalStatusNotice()` flaps as well — in particular the share-link restore notices, of which "Shared military flight could not be restored — feed unavailable" is the longest at 63 characters. That needs no special case: `planSplitFlap()` compresses the stagger to hold the 620 ms budget (26 ms → 6.9 ms per column at that length), every column is reserved for the whole cascade, and `element.textContent` is the complete notice at every instant, so the `aria-live` region announces the whole sentence rather than a fragment. A notice deferred minutes past boot is equally safe: `ensureHost()` re-validates the shell on every call, and the long-lived `Text` node is never replaced.
- **DOM text is the truth, and its node NEVER moves — do not "fix" this.** The first call upgrades a chip label into a permanent shell (`ensureHost`): a `.gev-flap-text` span holding one long-lived `Text` node, plus an `aria-hidden` `.gev-flap-cells` sibling. After that the ONLY text operation for the life of the chip is `node.data = next`. Nothing is reparented, so the label is never transiently empty and the `aria-live` region never sees a removal/reinsertion pair it could announce twice. `element.textContent` is the settled string at every instant, because the cells carry no text at all: both glyphs are CSS generated content (`::before` from `data-flap-prev` = outgoing, `::after` from `data-flap-next` = incoming), which never reaches `textContent`. This keeps QA pins honest and lets `_updateTrafficSyncChip`'s own `textContent !==` guard keep working. The shell is built on a tick where the text is NOT changing, so no real label change ever carries a structural mutation.
- **No animation loop, and exactly ONE `setTimeout` per change.** CSS `animation`/`transition` only, triggered once per text change and staggered through a per-cell `--gev-flap-delay`. The single timer is the settle that strips the cells; the width ease ends on a `transitionend`/`transitioncancel` listener, never a second timer. Idle cost is zero, there is no periodic work, and nothing requests a Cesium render or takes a render-governor hold. `setSplitFlapText` is a no-op on unchanged text, which is required — the chips are repainted by a 60 ms and a 500 ms ticker.
- **Only what was visible flaps away.** An interrupted cascade (A→B cut short by C) derives each column's outgoing glyph from `visibleGlyphs()` — what that column is actually SHOWING at that instant, which for a column whose stagger has not elapsed is still A, not the pending B. `FLAP_TURN_RATIO` must track the `gev-flap-out`/`gev-flap-in` keyframe crossover in style.css.
- **Columns never renumber mid-cascade — do not "optimise" this away.** For the whole cascade the board keeps one column per index of the LONGER string, each holding its own width; a column the new string does not reach flaps to a BLANK in place (`data-flap-next=" "`) rather than collapsing. Collapsing stacks the absolutely-positioned outgoing glyphs on one x AND lets a later glyph slide into an earlier column, which makes `visibleGlyphs()` lie and the interrupt rule flap the wrong glyph away. Pinned by "a cleared column holds its place instead of letting later glyphs slide left".
- Length changes are eased, never snapped, and the ease is placed so it never fights the flaps (`.gev-flap-sizing`): a GROWING label reserves its columns as the cells go in and eases at the START; a SHRINKING one holds full width for the whole cascade and eases at SETTLEMENT.
- Accessibility: the cells sit in an `aria-hidden` wrapper and the settled string is real text in the a11y tree, so the `aria-live` chips announce the label once per change rather than character fragments. No `aria-label` is used — ARIA prohibits naming a generic `<span>`. Because the text node is permanent and only its data changes, a label update is a single `characterData` mutation and settlement is none — node churn in a live region can double-announce.
- A chip hidden by clean-UI, recording mode, or an un-`.visible` (`opacity: 0`) traffic/CCTV chip swaps instantly instead of animating where nobody can see it; `prefers-reduced-motion: reduce` does the same.
- Kill switch: `SPLIT_FLAP_ENABLED` in `src/splitFlap.js`. Set it `false` and every chip returns to a plain instant swap with no other change.
- Regression surface: `src/splitFlap.test.mjs`.

### Panoptic Detection + Tracked Readout (June 2026)

- `src/data/detection.js` samples enabled layers through each layer's `getDetectableObjects()` contract and renders bounding boxes/labels from the shared host's sole Cesium post-render callback so boxes align with the final camera frame.
- Detection diagnostics count fading labels from the arbiter rows that are
  actually rendered. The label QA harness uses time-weighted label exposure for
  churn and requires conclusive solve/frame samples at both its 12,000-object
  pathological field and 5,200-object normal field without relaxing budgets.
- `src/data/detectionDraw.js` performs the batched, DPI-crisp canvas drawing for tier-colored labels, corner brackets, callouts, and distance-scaled tracked boxes. Unit tests cover label measurement and draw geometry.
- `src/data/trackedReadout.js` publishes a protected shared-host callout above tracked aircraft and satellites or selected mapped installations. It reads only each layer's cached display position—never a fresh entity position evaluation—preventing readout jitter against the rendered target. AIS selection remains in the vessel source's protected card path.

### Not Currently in Runtime

- Weather radar (removed before OSS v1 after QA; no reliable visible payoff)
- General replay/timeline systems outside the Space Missions experience
- LiDAR explorer and paired-point CCTV calibration experiments

## Auth + Launch

- Recommended launcher: `./scripts/dev-fresh.sh` (also: `dev-secure.sh` for stricter bindings, `dev-cctv.sh` for CCTV source-pack tuning)
- Build gate: `npm run build`
- Network access: local-only by default (`HOST=localhost` in dev-fresh.sh); LAN is an explicit opt-in via `HOST=0.0.0.0` (launcher prints a key-exposure warning + LAN URL; see SECURITY.md)
- OpenSky default mode: OAuth (`OPENSKY_AUTH_MODE=oauth`; `anon` works without credentials)
- Google key expected in Keychain service `google-maps-api` (or `GOOGLE_MAPS_API_KEY`, or `.env`)
- OpenSky credentials expected in Keychain service `opensky-network` (or env, or `.env`); `OPENSKY_AUTH_MODE` and `OPENSKY_CREDENTIALS_FILE` read from `.env` too
- Optional-key precedence in `dev-fresh.sh` is uniform — explicit shell env, then `.env`, then Keychain: `OPENAI_API_KEY` (Keychain `openai-api`/`api-key` — voice + HUD summary), `AISSTREAM_API_KEY` (`aisstream-api`/`api-key` — live vessels), `CESIUM_ION_TOKEN` (`cesium-ion`/`token` — Bing stacks), `TOMTOM_API_KEY` (`tomtom-api`/`api-key` — live traffic flow), `FIRMS_MAP_KEY` (`firms-map`/`map-key` — live fires), `LL2_API_TOKEN` (`.env` only)
- An empty string is not "unset" on either side of the launcher, and both sides are handled. `scripts/read-dotenv-value.mjs` hides the requested key from `process.env` for the duration of the read (Vite's `loadEnv` otherwise lets an inherited empty export win over the parsed files) and restores it after. A key the launcher resolves to nothing is then removed from the dev server's environment outright (`env -u`), not merely omitted — the child inherits this shell's environment, and Vite backfills `.env` only over undefined variables, so an empty export in either place would shadow a configured key. `CCTV_CALTRANS_DISTRICTS` is the deliberate exception: empty is its documented Caltrans kill switch and is passed through as-is
- `.env` supported via `.env.example` template

### Proxy/Security Baseline

- CCTV proxy rejects client-specified upstream URLs (server-side source allowlist only).
- CCTV upstream still-image fetches use an explicit abort controller with an
  eight-second timeout; the timer is cleared on every success or failure path.
- OpenSky response cache stores successful upstream responses only; OAuth token refresh calls are coalesced.
- A cold OpenSky failure uses the current camera subpoint only to request a cached adsb.lol point fallback capped at 250 nm. A fresh OpenSky response or last-good cache wins; a nominally successful worldwide snapshot more than two minutes old prefers viewport-scoped adsb.lol when available, otherwise the stale source is reported honestly. The fallback is visibly source-labeled and is never presented as a worldwide snapshot.
- GBFS response size is capped; CCTV health map is bounded.
- Proxy error payloads are sanitized (no internal error details returned to clients).
- `OPENAI_API_KEY` is server-side only; the browser receives ephemeral Realtime client secrets from `/api/realtime/token`.
- `AISSTREAM_API_KEY` is server-side only; the browser reads the same-origin `/api/ais-live` cache.
- `/api/google/nearby-places` keeps the Google key out of Places requests issued for voice scene context.
- `/api/google/text-search` keeps the Google key server-side for view-biased Places recovery used by annotation resolution.
- `/api/overpass` is bounded by body/response caps, per-client/global rate limits, concurrency limits, mirror fallback, in-flight dedupe, cache bounds, and static validation that every selector is spatially bounded.
- `/api/military-installations` uses an independent limiter with the same 90-per-client/300-global one-minute bounds, so viewport installation refreshes never consume `/api/overpass` annotation/traffic capacity.
- `/api/route` proxies bounded OSRM route requests for annotation routes, with profile allowlisting, distance caps, response caps, caching, and sanitized "no route found" errors.
- Track endpoints: `/api/ais-live/track?mmsi=` (server-accumulated ring buffers; sub-route handled before the rows snapshot), `/api/opensky-track?icao24=` (OAuth, 60s cache, sanitized errors, independent OpenSky credit bucket), `/api/adsblol/trace?hex=` (60s cache, 5MB cap, ODbL attribution required in UI).
- Realtime debug logs redact API keys, bearer tokens, client secrets, and image data URLs before writing to disk; request bodies are size-capped.

## UI/UX Runtime Defaults

- Z ladder: panels promote within 100–139 (renormalized on wrap), voice pill 150, toast 200, clean-view exit 300.
- Panel POSITION keys are versioned `v8` (`godsEyeView.v8.panelPos.<id>`); collapsed-state keys remain `v6`. The one-time position reset clears stale DISPLAY placements that could overlap the Context rail.
- Map Source lives in the bottom Visual Presets tray. The left accordion contains no MAP STACK panel, and the `k` panel token that addressed it is gone from the share registry, so legacy `ui=k...` state takes the ordinary unknown-token skip.
- A dock popover (Visual Presets, Location) auto-dismisses on mouse-away unless pinned. Focus inside the tray defers that dismissal only when the browser reports `:focus-visible` — keyboard focus and typed-into fields hold the tray open; a mouse-clicked tile does not, because Chromium focuses a `<button>` on press.
- GEV MIC control is a glass capsule (var(--glass-bg), blur(24px) saturate(1.4), 999px radius; panel radius in error state).
- The desktop right rail (`#right-context-rail`) owns `DISPLAY`, `CCTV`, its active parameter controls, and `GLOBAL CONTEXT` as one fixed responsive stack in that order. Its compact buttons use the same 176 px width as the left accordion and one consistent 50 px height, share the left stack's 52 px edge inset and measured top baseline across HUD variants, then constrain themselves against visible HUD/chrome rectangles and the remaining vertical corridor. `DISPLAY` is no longer draggable and legacy saved coordinates are ignored.
- The right rail is labeled **DISPLAY** (formerly "MOVE") and groups, in order, HUD, DETECT, Bloom, Sharpen, 3D, Clean-UI (HUD + DETECT promoted to the top). Its expanded controls retain the same compact 176 px width as the right-side tabs instead of growing to the wider Context detail-card width. It starts expanded on first run and respects the user's later `v6` collapse choice. Collapses/expands with directional chevrons (`◀` collapsed, `▶` expanded).
- Display and Context use matching 330 px expanded widths and matching compact tab dimensions. The parameter panel is part of Display's expanded content. DISPLAY may remain open beside one contextual panel; CCTV and Context are mutually exclusive. In Tactical HUD, expanding CCTV or Context hides the other contextual launcher while DISPLAY remains independently available. The most recently opened right-rail panel owns the constrained lane even when it appears later in DOM order; passive restoration and automatic disclosure do not replace that explicit owner. Minimal and other HUD layouts retain the collapsed launchers; when their active panel exceeds the measured corridor, the rail reserves sibling heights and gaps and scrolls the active panel internally.
- `STYLE PRESETS` and `LOCATIONS` start collapsed, expand on intentional hover/click, and auto-collapse after hover leave delay.
- Collapsed mini-status indicators show active style and active location/landmark.
- Detection mode is user-controlled and should persist when switching styles. Since 2026-08-22 it also STARTS on — Dense @ 75% for every style on a first run, Normal included — as a `GLOBAL_POST_DEFAULTS` baseline that does NOT set `_detectionUserOverridden`. Exception (unchanged): selecting a military style (CRT/NVG/FLIR) auto-enables the same Dense preset, but only until the user manually changes detection this session (`_detectionUserOverridden` gate), after which style switches never touch it.
- Detection runs in the bottom lane of the shared host's single world-overlay `postRender`
  listener (not `preRender`) to eliminate bounding-box drift at close zoom.
- **Detection takes NO continuous-render hold (2026-08-22, `src/data/detectionRenderDemand.js`).**
  It repaints on CHANGE and asks the governor for exactly one more frame while work that spans
  frames is still outstanding. This is load-bearing for the detection-on-by-default flip: the old
  unconditional `holdContinuousRender('detection')` would have pinned every idle first-run tab at
  60 fps, defeating the render governor. Measured on a parked scene with zero layers: **0 renders
  per 5 s with detection ON, identical to OFF**; reinstating the hold gives 301. Gated by
  `scripts/qa-perf.mjs` §1b, which also counts the PAINTER's own frames so a painter that had been
  disabled outright could not score a perfect idle. The invariants — each of which a live
  adversarial review found broken in the first cut:
  - **Every kind of outstanding work must terminate.** A predicate that can stay true forever is
    the hold under another name. Three qualify: the enable fade-in, label fades, and a solve the
    frame could not run.
  - **Label fades count in BOTH directions.** A newly selected label is `selected`; counting only
    the fade-out tail left it invisible on a parked scene until an unrelated frame arrived.
  - **Paint and demand share ONE monotonic timestamp** — the host frame's `frame.timestamp`
    (`performance.now()`, sampled once per frame). Re-sampling dropped the terminal frame of a fade
    (paint at 219 ms drew alpha 0.99545; a policy re-reading at 220 ms said "done"), and a wall
    clock that jumps backwards keeps demand alive until it catches up. Nothing in the draw pass may
    use `Date.now()`.
  - **A skipped paint DEFERS, never cancels.** The relief valve's skip and its follow-up request
    come from one decision (`detectionPaintSkipDecision`), so it cannot drop the only frame that
    was requested.
  - **A changed detectable set dirties the solve.** Detection PULLS candidates per paint but
    re-solves on a private 125 ms throttle, so a layer tick that swapped contact A for B could be
    spent on a paint that declined to re-solve. `markDetectionSourcesChanged()` is called from the
    manager's layer tick and visibility change, next to the render request each already makes —
    discrete events seconds apart, never per frame — and it deliberately does not request a frame
    itself, because the caller already did.
  - **AIR brackets stay prompt because the AIRCRAFT LAYERS hold the loop, not detection**
    (verified live 2026-08-23). Brackets — including the alpha-floored ones — are painted inside
    `_drawOverlay` from live positions and take no part in the sources-changed notification, so the
    obvious worry is a floored bracket sitting stale on a parked scene. It cannot: an AIR bracket
    exists only while an aircraft layer is enabled, and `flights.enable()` /
    `militaryFlights.enable()` each take a continuous-render hold for their own per-frame fleet
    animation. For exactly as long as there is anything to bracket, the scene renders every frame.
    Measured on a parked camera: `holds: ["flights"]`, `requestRenderMode: false`, and an
    outside-aircraft population change moved the painted bracket count with no camera input. This
    is a COUPLING, so `detectionRenderDemand.test.mjs` pins it — a later perf pass that strips those
    holds the way it stripped detection's would take bracket promptness with it, silently.
  - Known, pre-existing, and deliberately out of scope here: the overlay's backing store does not
    re-derive on a DPR change mid-session (`worldOverlay` sizing — untouched by this work).
- The detection MODE BANNER (`DENSE VIS:… SRC:… DENS:…% ELASTIC …ms`) is
  developer telemetry and is HIDDEN by default. It paints only under
  `?detectDebug=1` (the `trafficDebug` convention), resolved once per
  `initDetection`. The same numbers are always available from
  `getDetectionDiagnostics()`. On a zero-object frame the "armed, nothing in
  view" signal is carried by the scanlines and sparse focus ring, not the banner.
- The HUD summary's `NEAR <landmark>` callout is capped at 150 km (metro scale).
  Beyond that it falls through to the `SECTOR <lat> <lon>` readout. The POI
  catalogue covers eight cities, so a looser bound made the HUD announce
  landmarks on other continents.
- Panoptic mode shows labels on ALL items (no stride skipping). Tracked/selected items keep bounding box but suppress label (skipLabel flag). Tracked items get enlarged bounding boxes (56×44 vs default 22×14).
- The 3D aircraft toggle reveals `Proximity` and `All` modes and drives both commercial and military aircraft layers. It ships ON in `Proximity`, so the button paints lit and the mode row paints open from markup; the panel is therefore ~36 px taller than before, which Cockpit's Display/Radio strip absorbs through its existing primary-only corridor solver.
- The host-painted tracked-target readout sits above the post-FX layer and follows tracked aircraft/satellites or selected mapped installations using each layer's display-position contract.
- Cockpit entry is gated to the operational Contacts context bundle. The
  Context chooser must be in Contacts mode, Live Flights and Military Flights must both
  be enabled, and a civilian or military aircraft must be tracked. The visible
  Cockpit actions and the `C` shortcut use the same gate, so ordinary standalone
  flight-layer selection cannot enter a context-dependent cockpit.
- **Aircraft cockpit view:** selecting a commercial or military aircraft reveals a `COCKPIT` action (`C`). Cockpit mode temporarily releases Cesium's orbit-follow transform and drives a first-person camera from the tracked aircraft's existing smoothed display position and course. Its concave helmet-visor HUD shows callsign, UTC time, coordinates, curved roll/pitch guides, and a seven-division heading tape. Ambient commercial and military AIR contacts use a Cockpit near/far band selected by the shared Display 3D mode: Proximity admits at 150 km and retains to 185 km; All admits at 400 km and retains to 450 km. The shared 3D toggle now applies in Cockpit: Off keeps in-range contacts as rotating 2D aircraft silhouettes, while On lets a ready admitted glTF take over without a drawing gap. The Cockpit model cap remains 60 and can only lower the map budget; in-range contacts that are capped or still loading remain 2D silhouettes instead of degrading to out-of-range dots. Contacts outside the selected band use small rotation-free cyan-white pips for civilian aircraft and amber pips for military. The pilot's own airframe is not drawn in first person, and exiting clears the Cockpit band and restores normal map silhouettes/models. The normal left accordion remains available for Layers and Scenes and keeps the same 26vh HUD-aligned anchor used in map mode, independent of whether the bottom-left Contact card is expanded or collapsed; the right-rail CCTV and Context chooser are hidden to avoid duplicating or overlapping the cockpit presentation. When the intelligence HUD is enabled, its classification, scene summary, collection/orbit metadata, coordinates, and imaging-status text remain visible as reduced peripheral cockpit telemetry; the optical center and flight instruments stay clear, and turning the HUD off still hides it. Ground speed, exact heading, and rendered altitude form one compact lower-center instrument cluster, keeping the horizon and peripheral view open. A second live altitude tape hugs the inside-right visor rim: its rail and nine moving ticks are derived from the same responsive keyhole radius, remain 20 px inside the circular edge even on wide displays, fade deeply at both vertical ends, and move continuously behind a fixed current-altitude pointer; its interval tightens automatically near the surface and it is suppressed on narrow screens. Cockpit mode also has a weather-backed transparent volumetric-cloud pass derived from the supplied FBM/domain-warped R&D shader. It renders at no more than 520×320, uses 24 ray steps/three FBM octaves at 12 FPS, is clipped to the visor, fails clear when Open-Meteo is unavailable, and stops its animation completely on cockpit exit. It does not restore the prior CPU weather canvases, precipitation, scene fog, or any map-mode effect. When Contacts is active for the tracked aircraft, the compact `CONTACT` rail adds the 250 km subject window, four cohort counts, nearest observed/mapped example with relative bearing and distance, freshness, explicit uncertainty, and Previous and Next controls plus its own collapse control. The mirrored right rail is a three-page **cockpit briefing carousel**: source-backed live signals, location-matched regional headlines, and local place/current-weather context from OpenStreetMap Nominatim and Open-Meteo. It is manual-first: Previous, Next, and direct page controls are always available, and the visible `CYCLE OFF` / `CYCLE ON` control starts or stops the nine-second page cycle. The cycle pauses on hover or keyboard focus and stops while collapsed, hidden, or outside cockpit mode; live signal data continues refreshing either way. Empty news matches and unavailable news use compact text states rather than reserving an empty media frame; partial local data remains explicit. Article links open their original publisher, and no headline is treated as verified risk intelligence. On desktop both cockpit rails use the same width and share a bottom-aligned safe baseline in opposite corners above the peripheral MGRS/GSD/time telemetry, leaving both that text and the lower-center instrument cluster readable. They collapse independently to slim tabs without stopping live data updates. Narrow screens use separated top/bottom fallbacks. Empty-space globe clicks are inert while cockpit owns the camera; `C`, `Escape`, or `EXIT COCKPIT` explicitly exits and restores the same tracked entity and standard follow camera. Unknown feeds remain unknown, selection loss still exits safely without inventing a replacement track, and the cockpit never presents the summary as threat scoring or an all-clear. This is a desktop first-person presentation, not a WebXR session.
- **Cockpit left-panel clearance:** the Cockpit Contact card and peripheral HUD participate in the adaptive left accordion's live obstacle measurements, including live viewport-height changes. Expanding Layers or Scenes keeps the active panel in the available upper-left corridor with internal scrolling; it does not cover the Contact card, lower Cockpit controls, or Cesium credit line. Outside Cockpit the hidden card does not alter the normal corridor.
- **Cockpit Context scope:** the 250 km radius applies to the air/sea proximity cohorts. Installation counts come only from the currently loaded viewport and are labeled `CURRENT VIEWPORT ONLY` in the cockpit as well as the normal Context panel; neither surface presents them as a complete 250 km installation survey.
- **Cockpit camera anchor:** first-person mode does not write feed-boundary corrections directly into the camera. A cockpit-only inertial anchor advances from the selected aircraft's displayed course and speed, then converges toward the authoritative delayed track with correction capped below forward motion. The displayed kinematics are derived from the same consecutive fix segment as the rendered position, with raw feed speed/course used only as fallback; a transient zero/missing feed speed therefore cannot freeze a visibly moving aircraft after layer enable or a map/cockpit handoff. Rendered altitude continues to come from that interpolated track position. Late ADS-B fixes and short render stalls can remove drift without accelerating or reversing the view. Camera placement runs before scene update/culling at a bounded 20 Hz so a moving cockpit does not force Photoreal 3D Tiles to retraverse on every display frame; textual instruments update at 10 Hz and context/layout work at 4 Hz. Every far Cockpit contact pip shares one stable Cesium texture-atlas entry and skips unused screen-projected course calculations, while only in-range 2D aircraft silhouettes pay the screen-projected rotation cost; ambient glTF collections are hidden/retained rather than synchronously destroyed at cockpit entry, and context rails lay out only on explicit content/state changes and viewport resize. The deliberate 15/30-second layer interpolation delays and per-Cesium-frame position caches remain unchanged.
- **Cockpit route, vision, and view controls:** visible on-screen `COCKPIT`, `RESET`, and `EXIT COCKPIT` controls replace reliance on the `C` shortcut. RESET uses the same canonical globe route as the map and voice actions, exits Cockpit, and releases its camera ownership rather than exposing the hidden map-style top action. When the tracked commercial flight has a plausible ADSBDB route, the top of the right briefing rail shows a compact `FROM → TO` airport strip and the visor shows a centered estimated-destination chevron with its relative bearing; absent or implausible route data hides the strip and cue rather than guessing. The cockpit-local vision control is an interactive `PREV / CURRENT / NEXT` carousel over the inherited map preset, `CRT`, `NVG`, `FLIR`, and `NOIR`; its previous/next actions wrap, and activating the current value advances to the next style. The inherited entry is named directly, such as `NOIR`, and retains that map shader. There is no empty `NONE` entry. CRT, NVG, FLIR, and NOIR temporarily activate the existing Cesium post-process stages, while returning to the inherited entry or exiting Cockpit restores the pre-entry visual style. The regional-news page uses a free Google News RSS locality query first, with the existing GDELT query retained only as a fail-soft fallback; linked headlines remain reporting, not verified incidents or risk intelligence.
- **Cockpit weather status:** the earlier multi-canvas atmospheric compositor remains fail-closed and is not attached to the live viewer. Cockpit clouds are a separate transparent WebGL pass with a capped 520×320 framebuffer, 24 ray steps, three FBM octaves, and a 12 FPS ceiling. It defaults off and starts only when local storage explicitly contains the persisted `WX ON` opt-in (`'1'`). When opted in, observations refresh after five minutes or 25 km of aircraft movement, fail transparent when unavailable or clear, and stop on exit or disable. `WX OFF` governs atmospheric rendering only: the briefing still fetches source-backed Nominatim, headline, and Open-Meteo local-information data, aborting and replacing any in-flight request when the selected aircraft changes. No weather effect runs in map mode and no synthetic fallback is shown.
- **Cockpit trail visibility:** entering cockpit hides the selected aircraft's trail body and head so they cannot cross the first-person view; exit restores them. This cockpit-only presentation change does not alter the normal map-mode invariant that aircraft trails render through terrain using their depth-fail material.
- **Aircraft course slew:** civilian and military 3D models retain the 60°/s course limiter, but each rendered frame can consume at most 250 ms of accumulated slew time. A long tile/render stall therefore catches up over multiple visible frames instead of turning one delayed frame into a heading snap.
- **Manual-first cockpit briefing:** the right-side Live Signals / Regional News / Local Info carousel does not advance automatically on page load. Previous, Next, and direct page controls remain available; the visible `CYCLE OFF` / `CYCLE ON` toggle explicitly starts or stops the nine-second page cycle, which still pauses on hover/focus and while collapsed, hidden, or outside cockpit mode. Live signal data continues refreshing in either state.
- **Photoreal horizon blend:** Cesium's sky atmosphere remains enabled behind the hidden base globe, but its light intensity, saturation, and brightness are reduced from the library defaults so the distant Google Photorealistic 3D Tiles boundary blends into the sky instead of producing a bright cyan horizon seam.
   - **Cockpit direction and speed tapes:** plausible destination metadata now drives one translucent, isometric visor chevron labeled directly below with the estimated geographic bearing; the prior full geodesic dashed path is not rendered. A mirrored live ground-speed tape follows the inside-left keyhole rim using the same responsive curve, end fades, fixed pointer, and fractional tick motion as the altitude tape on the right. Speed values scroll upward as they increase while altitude values scroll downward. Its tick endpoints and current-speed pointer share the rail's inset-circle origin, so the markings stay attached to the visible curve rather than drifting inward with the text-label gutter.
- Voice control UI (`#gev-voice-control`) shows status states OFF / CONNECTING / LISTENING / EXECUTING / ERROR.

### Current Global Post Defaults

**Reasonable-defaults batch (2026-08-22), extended and partly revised
2026-08-23.** First-run defaults move together as one coherent console
presentation. Every one is a FIRST-RUN baseline only: a
share link or the operator's own hand still wins over it, and none of them sets
the `_detectionUserOverridden` / explicit-intent flags that would suppress a
separate landed behaviour. Pinned in `src/reasonableDefaults.test.mjs` (feather,
detection, OUTSIDE opacity) and `src/data/layerState.test.mjs` (3D).

**The 2026-08-24 defaults** (superseding the interim 08-23 values of 8%/3%):
the first-run look is Detection DENSE
`75%`, ELASTIC allocation, Fade `7%`, OUTSIDE opacity `1%`, scope feather `11%`,
and 3D fleet mode PROXIMITY, with `AIRCRAFT_BRACKET_FLOOR_ANCHOR` at `0.01` so
brackets keep their approved brightness exactly at the new OUTSIDE default. Two
terms that must never be conflated: scope FEATHER softens the black scope-mask
edge; detection FADE is the label/card fading band around the keyhole. The
OUTSIDE slider's `step` stays `1` so every low stop is reachable.

**Allocation, defined precisely** (matches
`src/data/labelArbiter.js` `allocateLayerQuotas`): **ELASTIC** begins with
roughly equal capacity across active layers and redistributes unused
entitlement (`labelArbiter.js:170`); **WEIGHTED** allocates using visible
demand with square-root demand scaling and semantic layer weights
(`labelArbiter.js:181`). First-run default: ELASTIC.

**A default has THREE surfaces, and a PARSE fallback that is not one of them.**
The value literals (engine constant, markup value, markup readout, `ui.js`
`GLOBAL_POST_DEFAULTS`, the share generator's starting state) must all move
together, because a fresh boot runs no restore and those literals ARE the startup
state. The `scf` / `ko` PARSE fallbacks deliberately do NOT move: they answer
what an OLD LINK that omits the field meant, and such a link was authored under
that era's default (`scf` → 35, `ko` → 5). Every link since carries both fields
explicitly, because the generator always writes them, so no era whose default
later changed depends on a fallback either way.

**They do NOT all persist the same way, and only one of them persists at all.**
Worth stating plainly, because "a default you can override" and "a default that
remembers" are different promises:

- **3D models** have durable storage — `gev:layer-state:v2` in local storage,
  written by `LayerStateCoordinator` on explicit intent. A session that stored a
  snapshot keeps whatever it stored, across tabs and restarts.
- **Detection mode/density and scope feather have NO storage key at all.** Their
  only durable carrier is the URL hash (`dm`/`dd`, `scf`), written on a 500 ms
  debounce. A same-URL reload therefore keeps them only if that debounce already
  fired; a bare URL or a new tab returns to these defaults. That is unchanged by
  this batch — it is simply what these controls have always done — but it is the
  reason "stored state wins" is true of the 3D toggle and not of the other two.

**Known edge (detection, pre-existing, deliberately not redesigned here):** a
hash-restored `dm=OFF` restores the MODE but not `_detectionUserOverridden`,
which is session-scoped. A recipient of an OFF link who then selects a military
style therefore gets the style's auto-enable, where the original author — who had
turned detection off by hand — would not have. The default flip makes this edge
easier to meet (detection is now on more often), but does not create it.

- Bloom: `OFF`, intensity slider at `100%`
- Sharpen: `ON`, intensity slider at `49%`
- HUD: `ON`, layout `tactical`
- **Detection: `DENSE` @ `75%`** — ON for EVERY style on a first run, Normal
  included (was `OFF` @ `50%`). It is literally the same frozen
  `MILITARY_DETECTION_PRESET { mode:'dense', densityPct:75 }` object the military
  styles and the Contacts context mode already apply (Contacts OWNS detection
  while active and restores the prior state on exit — `contactsDetectionPolicy.js`;
  Cockpit deliberately does not touch detection at all), read by
  `GLOBAL_POST_DEFAULTS`, so there is one tactical look rather than several that
  can drift. Fade opens at `7%` since the 2026-08-24 final lock (`16%` before it). Style-switch semantics are
  unchanged: CRT/NVG/FLIR still carry `detection: MILITARY_DETECTION_PRESET` and
  still yield to `_detectionUserOverridden`; Normal still has no
  `STYLE_PRESET_DEFAULTS` entry, so switching TO Normal touches nothing. A share
  link carrying `dm=OFF` still restores OFF.
- **Detection OUTSIDE opacity: `1%`** (moved `5% → 3% → 1%` on 2026-08-24).
  `KEYHOLE_OUTSIDE_OPACITY_DEFAULT` in `src/celestialRing.js`, mirrored by
  `#detection-opacity-slider`'s markup value AND readout,
  `GLOBAL_POST_DEFAULTS.detectionOutsideOpacityPct` in `ui.js`, and
  `_detectionOutsideOpacityPct` in `sharelink.js`. The slider's `step` is now
  `1`, so 1–4 % are reachable at all (at the previous step of 5 the entire
  sub-default range was one stop wide). `AIRCRAFT_BRACKET_FLOOR_ANCHOR` in
  `src/data/detectionPolicy.js` MOVES WITH IT — the AIR bracket floor is
  calibrated so `AIRCRAFT_BRACKET_ALPHA_FLOOR` (0.35) lands exactly at the
  default, and the mapping follows bracket brightness rather than slider
  position. The `ko` PARSE fallback stays at `5`.
- **Scope feather: `11%`** — a soft scope-mask edge (moved `0% → 8% → 11%`; `0%` hard crop for one day,
  `35%` before that). `SCOPE_FEATHER_RATIO_DEFAULT` in `src/scopeMask.js`,
  mirrored by `#scope-feather-slider`'s markup value AND readout and
  `_scopeFeatherPct` in `sharelink.js`. The slider is untouched and still spans
  0–100, and an explicit `0` is still the hard-crop path — pinned, so moving the
  default cannot quietly delete it. The `scf` PARSE fallback deliberately stays
  at `35`: a link predating `scf` was authored when 35 was what its author saw,
  and restoring the author's view is what a share link is for.
- **3D aircraft models: `ON`, mode `proximity`** — see the 3D Aircraft section
  above and the DISPLAY-rail entry below (was `OFF`).
- Style shader starting params: CRT/NVG/FLIR pixelation `1.2` (just above the native `1.0` floor); thermal/FLIR ships an optional Ironbow "Predator" palette (`palette` uniform, default `0` = accurate grayscale).

## Operational Notes

- **Earthquake discs are STATIC geometry.** Every quake is a `CLAMP_TO_GROUND`
  ellipse; a `CallbackProperty` axis re-tessellates its ground primitive every
  frame, which cost 32.4 ms/frame and 30 fps on the shipped 58-event feed. The
  axes are plain numbers, redefined only when a poll brings new data, and the
  former ±15% radius pulse is gone. Because nothing in the layer animates
  per frame, it holds NO continuous-render hold — the governor stays idle with
  earthquakes on, and the manager's `layer-tick` / `layer-visibility` requests
  carry new data to the screen. Pinned in `src/data/earthquakes.test.mjs`.
- **Geocode framing has an off-centre sanity gate.** A viewport that is both
  bigger than any city (>300 km diagonal) and not centred on its own geocoded
  location (anchor >15% of the diagonal from the centroid) is replaced by a
  40 km metro box on that location. This is what stops "Tokyo" — which geocodes
  as the PREFECTURE, islands and all — from framing open Pacific. `country`
  results are EXEMPT by decision (several have the same pathology from overseas
  territories; reframing a country is a product decision, not a bug fix), and an
  explicit `viewMode: 'overview'` ask bypasses the gate entirely so "show me an
  overview of Hawaii" still frames the whole administrative area.
- **Viewport framing is antimeridian-safe.** `flyToViewportBounds` pads from the
  short-way-round longitude span and wraps the padded edges, so a dateline-
  crossing box stays its true width. Raw subtraction inflated a 0.41° metro box
  to 86.7° and a 60° territory to 132°.
- CCTV calibration persists at `godsEyeView.cctv.calibration.v2` (v2 rebuild;
  the store was wiped clean, no import from the old `v1` key).
- CCTV v3 floor QA pins are: zero samples for heading-only edits; zero transient
  samples and constant elevation during E/N drag; one shared-floor resolution on
  release; late one-shot shared-cell work is permitted during viewshed idle. The
  A+B harness intentionally excludes citywide LOD assertions.
- Draggable panel positions persist at `godsEyeView.v7.panelPos.<panel-id>` (collapsed states at `godsEyeView.v6.panelCollapsed.<panel-id>`).
- Legacy draggable-panel position keys may remain in local storage for backward compatibility, but the map-mode right rail ignores them; collapsed states still persist at `godsEyeView.v6.panelCollapsed.<panel-id>`.
- Flight/military tracked entities cache dead-reckoned positions per frame to avoid callback desync flicker.
- Aircraft 3D-model and tracking invariants are covered by `npm run test:track`; run this before touching `flights.js`, `militaryFlights.js`, `detection.js`, or `trackedReadout.js`.
- Annotation resolver behavior is pinned by `src/annotations/annotationResolver.test.mjs`; re-run that suite before changing place-resolution scoring.
- Layer input handlers (click + keydown) are detached on disable for flights/military/satellites/AIS vessels.
- Traffic tile cache is capped and traffic layer supports explicit destroy cleanup.
- Traffic feed state is honest about simulation. `getStats().mode` is the
  CONFIGURED source ('live' = a TomTom key is present, 'sim' = keyless), NOT
  this instant's health — health rides on `error`. Keyless reads FALLBACK with
  `SIMULATED — add TomTom key for live` in both the sync chip and the panel
  meta line; an unreachable `/api/tomtom/status` reads
  `SIMULATED — traffic service unreachable`; a total flow-fetch failure in live
  mode sets `error` (DEGRADED · `SIMULATED — <reason>`) and zeroes the stale
  coverage number. `stats.loading` covers outstanding flow work as well as the
  road fetch, so a failure landing after the 250 ms paint race still ends the
  shared loading batch as LOAD FAILED. Harnesses must gate on `!stats.error`,
  never on `mode === 'live'` alone.
- Traffic runs in `sim` mode (white dots, hardcoded speeds) unless `TOMTOM_API_KEY`
  is configured (env or Keychain `tomtom-api`/`api-key`), which enables `live` mode:
  TomTom flow vector tiles via the budget-governed `/api/tomtom` proxy
  (`.gev-cache/tomtom/`, 120 s TTL, `TOMTOM_DAILY_TILE_BUDGET` default 40k/day),
  decoded client-side (`flowTiles.js`), matched onto Overpass roads
  (`flowMatch.js`), and rendered as green/amber/red dot color + speed/density
  scaling (`trafficFlowStyle.js`); closures spawn no dots; unmatched roads stay
  white. Road fetch bounds center on the camera look-at point (`trafficBounds.js`).
- Development captures opened with `?trafficDebug=1` mint an interaction anchor
  from the exact `camera.changed` event that arms each debounced load, then emit
  scheduling-correlated User Timing entries for production `response.json`, road
  parse, flow-race, dot construction, heat-line rebuild, and next-post-render
  boundaries. Every trace is paired with the exact camera-change that scheduled
  its load; mismatches are counted drops. Cesium's `moveEnd` remains a diagnostic
  mark only: it arrives about 500 ms after stillness, typically after fetch has
  begun, and fetch never waits for it. Production builds remove the flag, hooks,
  counters, and timing labels.
- Voice debug log: `tail -f .gev-logs/realtime-conversations.jsonl` (gitignored).

Replay chase-camera updates run in Cesium `preUpdate` before scene traversal, preventing 3D-tile refinement stutter when the mission replay speed is reduced. Replay Ascent first gives the selected launch site a five-second tile-preparation hold before displaying the T-minus countdown. Replay ascent duration is mission-specific: disclosed insertion, SECO, or separation timing is compressed into the replay, while sparse records use reconstructed path length with bounded fallback timing instead of a universal fixed duration. Replay transitions directly from ascent to orbit; stage re-entry/recovery remains static contextual linework and is never a camera-tracked playback phase. The screen-space rocket/thrust symbol renders at 50% of its 92 × 138 px design box, while the separate callout text remains unchanged. Successful/upcoming selected missions show a current orbit marker: green for a reliable TLE match or amber and explicitly estimated when no live match exists. Failed launches show their source status and suppress live/estimated orbit markers and fallback rings. A retained Launch Library orbit is labeled as the planned target, an absent ascent is reported as unavailable, and replay-only controls remain hidden unless the selected mission has a rendered track; authoritative supplied trajectory points remain visible when present. Mission orbit primitives realign by model matrix each tick from the same current-GMST frame as their marker, preventing ring/marker drift; their host annotation reads the position cache updated in that same tick. During depth-dominant ascent segments, the replay rocket retains its last valid path-facing rotation rather than snapping toward the camera. Mission selection and replay overlays never call photoreal `sampleHeight()` from the render loop; the launch-zone ground primitive and precomputed surface-safe replay path avoid remote tile-refinement probes that previously caused a one-second globe texture pulse. The shared host replaces the former mission-label visibility churn and quadratic overlap loop; the layer's remaining frame sweep only culls native point/billboard geometry and refreshes selected UTC copy when its displayed second changes. Replay samples uneven path vertices by cumulative distance and normalizes camera-yaw easing to frame time.

Orbit replay framing uses one combined bounding sphere for Earth and every sample of the selected orbit. The camera derives its final range from that full envelope, while its look-at target retains a radial bias toward the moving vehicle rather than collapsing onto the singular Earth-center frame. Compact-orbit launchers therefore remain tracked during camera rotation, and highly eccentric transfer orbits still keep both the globe and their distant apogee arc visible. The orbital camera stays on one side of the mission's 3D orbit plane and uses the vehicle radial as visual up, so forward motion remains screen-left through polar/local-heading wraps instead of alternating left and right. The fixed-size cyan orbit dot retains one pixel scale throughout the pullback. While replay owns the camera, the selected launch-site host label is suppressed so it cannot duplicate or overlap the replay vehicle's DOM callout; cancel/completion restores it.

Mission ascent paths use a long cubic insertion transition that matches the incoming climb direction and the sampled orbit tangent. Because a Cartesian cubic can otherwise chord through the ellipsoid for some inclined insertion geometries, every blended sample preserves the original climb's smooth minimum-altitude envelope. This removes the artificial right-angle insertion corner and corresponding rocket heading snap without allowing the ascent path to enter the globe.

Insertion is source-aware: catalog-backed missions propagate the matched satellite to the historical insertion epoch. Projected missions have no authoritative historical phase, so their orbital plane starts over the launch site and follows a plausible launch azimuth—south-southwest for western North American sites and polar missions, eastward otherwise. The projected insertion advances only by the disclosed ascent duration or a ten-minute fallback, producing one continuous downrange climb into the forward orbit tangent instead of using UTC as an arbitrary phase and correcting through a 180-degree hook.

The reconstruction does not add a full revolution around Earth: ordinary launch vehicles use a gravity turn and downrange acceleration before orbital insertion, rather than spiraling around the planet during powered ascent.

At close range, the selected launch site's 500 m highlight is a single material-backed `GroundPrimitive` classified against both terrain and photoreal 3D Tiles. It has no fixed world-space height offset, so the translucent disc and rim remain draped across the rendered launch-site surface during tile refinement. A small render-state polygon depth bias keeps coplanar ring fragments above the photoreal mesh at low oblique angles without making the geometry float or drift.

The Space Missions roster prioritizes data-rich records using available mission, orbit, payload, trajectory, timeline, and recovery fields; launch time remains the tie-breaker.

When no live catalog track is available, the mission view marks the approximate orbital ring as `PROJECTED ORBIT` in purple and renders the ascent-to-insertion transfer in green; catalog-backed satellite orbits remain cyan.

The replay vehicle is a smaller solid cyan silhouette without the former orange flame; its initial pad anchor uses photoreal terrain, globe height, or launch elevation fallback so it remains above the surface during tile loading. Replay begins at a close launch-complex range so pad detail remains visible before the camera widens into the ascent context view. Its initial camera heading is perpendicular to the ascent/orbit direction for a profile view, then eases into tangent tracking. Small screen-space reprojection changes are damped for the animated marker on both ascent and orbit, while large camera or phase changes snap to the authoritative path position.
Space Missions keeps the Satellite layer available for catalog/TLE matching but suppresses its standalone fleet points and orbit rings. While those visuals are hidden, their per-frame dense propagation, one-second core point-buffer rewrite, and one-second orbit-matrix rotation are suspended; selected mission telemetry continues to propagate independently. The selected mission's live or estimated satellite marker uses fractional wall-clock time, so it moves continuously rather than creating a once-per-second position discontinuity and one-frame photoreal globe LOD pulse.

During ascent replay, the camera, Cesium callbacks, and HTML vehicle overlay share one replay sample per rendered frame. The tracked overlay is projected directly from that shared position instead of applying a second screen-space lag filter, preventing the vehicle and globe from repeatedly advancing and snapping back.

After the initial broadside launch profile, the ascent chase camera stays in a rear-quarter view about 30 degrees off the vehicle's forward path bearing, widening smoothly toward 45 degrees as orbit context appears. Cesium's `HeadingPitchRange` already places the camera opposite the supplied heading vector, so replay does not add a second 180-degree inversion; the trajectory therefore travels away toward the horizon while remaining visibly offset from the screen centerline.

During orbit replay, the camera continues following the selected vehicle but eases its look-at target down toward the vehicle's sub-satellite globe anchor. The range expands when necessary for high-altitude missions, keeping both Earth and the tracked label visible through the full revolution. The active replay clock clamps at the final orbital sample rather than wrapping to ascent progress zero; replay completion therefore leaves the final globe/orbit framing in place and does not return to the launch site.

Reconstructed mission orbits use a small downrange launch-to-insertion arc, so their estimated ground track is not artificially drawn directly over the launch pad in top-down views. The ascent remains connected to the ring at its selected insertion point.
Collapsed right-rail controls use the same 176 px width as collapsed left-rail controls, while expanded right-side detail panels retain their independent widths. DISPLAY starts expanded only on first run and then respects persistence; DISPLAY may remain open beside CCTV or Context, while CCTV and Context remain mutually exclusive without persisting forced collapses. Selecting a dedicated Context mode opens its right-side surface and clears unrelated layers after first snapshotting their exact state. Final exit restores the original enabled set and changed parameters. Cockpit View hides the right-side CCTV control because CCTV is not part of the cockpit rail. Airborne cockpit altitude uses the tracked aircraft's reported aviation MSL altitude, never the potentially negative Cesium terrain/ellipsoid render height; confirmed grounded contacts display `0 ft` without rewriting that source field. A cold photoreal floor shows `ACQUIRING SURFACE` for at most five seconds, then uses the source target-height fallback instead of freezing the camera indefinitely.
Replay transport uses one Play/Pause toggle plus Cancel. During ascent only the active thrust ring is visible; stage-recovery handoff uses a pulsing dot.

## Tooling Snapshot

- `tools/cesium-render.mjs`: headless Cesium render capture via Puppeteer.
- `tools/streetview-panorama.mjs`: Street View tile panorama stitcher.
- `tools/streetview-headings.mjs`: heading sweep capture; supports neighbor traversal.
- `tools/pano-pinhole.mjs`: equirectangular-to-pinhole reprojection.
- `tools/sat-ortho.mjs`: Map Tiles ortho stitch and centered crop with georef corners.
- `scripts/track-regression.mjs`: headless real-app regression harness for aircraft tracking/model/detection invariants (`npm run test:track`).
- `scripts/qa-map-source-tray.mjs`: browser proof for the four-source Map Source
  tray — presentation, keyboard disclosure, responsive bounds, unpinned
  auto-dismiss, ACQUIRING status, and retired/unknown stack-id restore
  (`QA_BASE_URL=http://localhost:4173 npm run qa:map-source-tray`). Add
  `-- --keyless` to force the no-ion-token expectations on a keyed server; both
  invocations are gates.
- `scripts/qa-l9-matrix.mjs`: the L9 release-candidate QA matrix in one command
  (`node scripts/qa-l9-matrix.mjs --url http://localhost:4173`). Orchestrates
  the `qa-*.mjs` fleet plus `track-regression` as subprocesses and adds
  repo/feed/in-browser probes; a check whose key the target lacks is SKIPPED
  with an OWNER-RUN tag rather than failed. Run with `--list` to print the
  manual checks it cannot automate.

## Maintenance Rule

When runtime behavior or architecture changes, update this file in the same change set as code updates.


### OKO earthquake catalogs — USGS + EMSC (2026-09-05)

The existing 24-hour layer now combines the global USGS daily feed and the EMSC
SeismicPortal FDSN Event catalog. Fixed server routes in earthquakeFeedProxy.js
share one in-flight request per source and cache successes AND failures for 60 s.
Requests have a 12 s timeout and a 16 MiB response cap. EMSC requests are bounded
to the trailing 24 hours and 20,000 rows, with truncation disclosed. There are no
keys, paid APIs, geographic restrictions, or WebSocket connections in this change.

Normalization rejects invalid identity/coordinates/magnitude/time, deduplicates
source revisions by original ID, and preserves depth, magnitude type, agency,
original timestamps and source URLs. EMSC negative GeoJSON elevation is converted
to positive depth (its explicit depth property wins). A wholly malformed catalog
cannot replace the last-good source snapshot; invalid individual records are
skipped and counted. An unavailable source retains cached, explicitly stale
solutions within the 24-hour window while the other source remains usable.

Association is heuristic, not official cross-catalog identity: only mutually
unique USGS/EMSC candidates within 20 s, 30 km, one magnitude unit and (when both
known) 50 km depth difference are combined. Ambiguous candidates remain separate;
there is no transitive matching or same-source event merging. The selected detail
labels associations as probable and displays both original measurements and IDs.
USGS provides the display solution when both are current; a current EMSC solution
outranks stale USGS. Magnitudes are never averaged. Prior source aliases preserve
map identity when a second catalog arrives. Source counts overlap.

Layer-row chips select all known magnitudes (>= -3), M1+, M2.5+ (default), or M4.5+
without additional network requests. Filters are session-only. Rendering is capped
at the 2,000 largest eligible events, with omitted counts disclosed; the original
96-label source cohort remains. Entity instances survive updates, and unchanged
solutions keep their existing static ellipse geometry. Circle sizes are symbols,
not ShakeMap, modeled shaking extent, or damage estimates. Clicking a disc shows
a protected shared-host detail; Escape, filtering out the event, or disabling the
layer clears it. Pick ownership is registered so sibling layers can yield.

Layer fetches have a 15 s timeout and generation/abort protection across disable,
destroy and superseding updates. USGS and EMSC completion is applied together.
The analyst API exposes the source solutions and association type. EMSC CC BY 4.0
attribution is in DATA_SOURCES.md and the existing credit popover. No GFZ, GeoNet,
Slovak catalog, ShakeMap, or replay feature is introduced by this change.

Offline UI acceptance: scripts/qa-earthquakes.mjs uses an isolated Vite config,
local fixtures and ellipsoid terrain, blocks every external browser request, and
exercises real layer controls, disc picking, shared-host details and Escape.

Validation for this change: 30 focused catalog/proxy/layer/i18n tests passed.
Live public-feed smoke returned 224 USGS and 299 EMSC records with zero rejected
records, combined into 459 display events including 64 probable pairs (a point-in-time
sample, not a completeness benchmark). Build passed. The full unit run passed
2,882 ordinary tests but failed one shared-overlay allocation profile at 191,430
B/frame against its 182,000 B/frame budget; isolated rerun reproduced it. Shared
overlay and flight modules were concurrently modified outside this change.
Offline browser acceptance remains unverified: Chromium/Edge CDP timed out during
page initialization, before the fixture could load. No paid-map test was run.
### Earthquake pulsar visual

Earthquake epicenters have an optional screen-space pulsar: a soft halo, two
staggered rings and a bright core drawn in CSS while the ground ellipse stays
static. It is capped at 24 visible symbols, culls far-side/off-screen and dense
overlaps, gives the selected event first priority, and becomes a quiet dashed
marker for stale or reduced-motion users. The toggle is local to the layer and
is cleaned up on disable/destroy without acquiring a continuous Cesium render
hold.
### Earthquake hover inspection (2026-09-05)

Hovering a painted magnitude label, pulsar core or picked ground disc opens a
scrollable DOM detail card. It preserves both catalog measurements and displays
magnitude type, depth, epicenter coordinates, origin/update timestamps, agency,
review status, source IDs and source links. Cursor movement is throttled; a short
leave grace permits entering the card to scroll or follow attribution links.
Camera movement, filtering, disable and teardown dismiss it and cancel enrichment.

After 500 ms dwell, public Wikipedia geosearch looks for a nearby geotagged article
with an image within 10 km. A second imageinfo request checks author and license;
only explicit CC BY/CC BY-SA/CC0/public-domain images are admitted. The caption
names the nearby place and distance and explicitly says this is contextual imagery,
not a photo of the earthquake. No result is shown honestly. Requests time out after
8 s; a bounded 64-entry memory cache stores success/empty results for 24 hours and
failures for 60 s. Leaving aborts requests; generations reject late results.
Validation: 40 focused earthquake/card/photo/i18n tests and production build passed.
Browser acceptance of the new hover interaction remains unverified in this session:
the in-app browser failed to attach/navigate to the isolated fixture. The fixture
uses a null photo lookup and CSP blocking external resources, so it is keyless.
### Natural Hazards card (2026-09-05)

The layer menu groups earthquakes, NASA FIRMS active fires and volcanoes in one
Natural Hazards / Prírodné hrozby card. These remain independent manager layers;
their toggles, per-layer freshness/errors and earthquake/FIRMS controls are intact.
The existing environmental first-run tile is renamed and enables all three.

The new volcanoes layer fetches the global NASA EONET v3 volcanoes category,
status=open, limit=200, directly with CORS and no API key. It shows the latest
valid point for each reported open event, not all volcanoes or instantaneous
eruption state. Successful responses are reused for 10 min, errors back off for
60 s, and requests time out after 12 s. Last-good records survive failure with a
stale label; generation/abort checks discard results after disable/destroy.
Triangular volcano icons and source-owned labels have horizon culling. Click an
icon for reporting date, coordinates, source and coverage details; Escape clears.
NASA EONET references are retained in analyst records. No paid service is added.
Validation: the public feed returned 32 events, zero rejected and no truncation
(point-in-time smoke). Production build passed. `npm test` passed all 2,959
ordinary tests and the focus allocation test; four shared-overlay allocation
profiles exceeded their budgets in the concurrently modified workspace. Those
profiles exercise infrastructure/FIRMS/tracked readouts and shared-host sources,
not the new volcano layer. The launcher tests also passed after updating the
named-view voice instruction to include volcanoes. Offline UI fixture is available
with `node scripts/qa-earthquakes.mjs --serve --hazards`; browser navigation timed
out in this session, so visual acceptance of the grouped card remains unverified.
Volcano startup registration fix: the canonical layer-state registry includes
`volcanoes` with the previously unused URL token `v` and `enabled-only`
serialization. Existing tokens are unchanged. A regression test seals a manager
with the real volcano module and verifies URL/local-storage round trips.

### Airport communication playback (2026-09-06)

Airport cards now keep a persistent media player outside the telemetry subtree.
Selection requests autoplay; refreshes preserve it; selection changes, close and
destroy release the audio source. Native audio handles
blocked autoplay with a retry button and ignores stale play rejections.
The user subsequently requested audio only, with cameras deferred. LKPR/KLAX
YouTube embeds were removed from radio cards; their references remain in
DATA_SOURCES.md for future camera work. The built-in audio catalogue is empty:
no usable independent direct stream with third-party embedding permission was
verified. Broadcastify's current terms require a separate developer license;
Purdue KLAF's operator also requires permission for use on other websites.
No paid license or API was activated. Configured audio remains supported.
Uncovered airports retain an honest
missing-source message and LiveATC link. Browser autoplay policies still apply.
Validation: 25 focused player/card/photo/airport tests and production build passed, including selection teardown,
camera exclusion, blocked audio retry and late rejection.
Actual browser audio playback has not been verified in this session.
