# Maritime historical context — reversible first step

The live AIS row now has a separate historical-context panel. Click **Show
historical context** to enable the existing shipping lanes, ports and ship-density
layers. Click **Hormuz / Persian Gulf** to move to a regional overview. Use the
OSM basemap to see the density without keyed map requests; the existing density
drape is hidden on Google Photoreal and fades away at close zoom.

This is **not a newly acquired vessel-position dataset**. Density is the bundled
World Bank / IMF January 2015–February 2021 aggregate; lanes and ports are static
context with their existing individual source attribution. No synthetic vessels,
extrapolated routes, new provider requests or API credentials are added.

**Undo added layers** disables only layers enabled by this action. Layers already
enabled beforehand are preserved. A subsequent independent visibility request
hands ownership back to the user, so Undo does not override that choice. Undo is
available for the current page session; after reload the ordinary individual
layer toggles remain available. Moving to Hormuz is a separate camera action and
is not reversed by the layer Undo button. Failed partial activation remains
undoable and reports an error. The global AIS subscription is unchanged.

## More recent history

Global Fishing Watch documents a satellite/terrestrial AIS vessel-presence grid,
including non-fishing vessels, and delayed dynamic data (approximately 72 hours,
depending on dataset). API use requires a registered account and access token.
No authenticated data has been fetched or integrated in this step. Do not call
the 2015–2021 bundled raster recent history, or label grid activity as individual
current vessel positions.

Next stage: obtain an authorized GFW token, verify permitted use and the exact
dataset's date extent, fetch a bounded region through a server cache, then expose
the actual observation period and source independently of live AIS. Tokens must
stay server-side. A daily snapshot can later be retained with its original date;
restarting the PC must not turn an old snapshot into current data.

References checked 2026-09-09:
- https://globalfishingwatch.org/our-apis/documentation/docs/quick-start
- https://globalfishingwatch.org/global-fishing-watch-data-availability/
- https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats

## Reversal

Work branch: `codex/gulf-maritime-context`, branched from `oko/2026-09-06`.
The change is additive: remove the maritime panel import, initialization and
insertion in `src/data/manager.js`, the new panel module/test, its `maritime.*`
translations and `.maritime-history-panel` styles. All pre-existing layers and
data remain usable. Prefer reverting the dedicated commit once committed;
never reset unrelated local edits. `DATA_SOURCES.md` and research files were
already modified before this work and are not part of this change.
