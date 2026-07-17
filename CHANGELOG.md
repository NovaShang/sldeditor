# sldeditor

## 0.16.0

### Minor Changes

- [`2767678`](https://github.com/NovaShang/sldeditor/commit/2767678db9ed50bfb03d5f65dbcf0adc1cd456d8) Thanks [@NovaShang](https://github.com/NovaShang)! - Add two elements to the renewable/power-electronics library: **DC/DC converter** and **MPPT controller**. Both use the authoritative IEC 60617 DC/DC-converter symbol (QET `en_60617_06_14_02`) with top→bottom flow — DC/DC converter has generic `t_in`/`t_out` terminals, MPPT has `t_pv` (top) / `t_bat` (bottom). There is no dedicated IEC symbol for an MPPT charge controller; the accepted SLD convention is the DC/DC-converter block distinguished by label. Fills a recurring gap in solar/off-grid single-line diagrams (MPPT and DC-DC chargers previously had to be faked with annotation boxes).

## 0.15.1

### Patch Changes

- [`587839f`](https://github.com/NovaShang/sldeditor/commit/587839f17646ed4738f7825cadb7775ed5702b00) Thanks [@NovaShang](https://github.com/NovaShang)! - Fix the tool tooltip colliding with the mode-hint bar. Hovering a tool showed its tooltip in the same band as the persistent hint bar above the toolbar, so the two translucent panels overlapped and the tooltip looked covered. The hint now fades out while the pointer is over the toolbar (its layout space is preserved so the bar doesn't jump) — you see the hint at rest and the tooltip on hover.

## 0.15.0

### Minor Changes

- [`3e57c5f`](https://github.com/NovaShang/sldeditor/commit/3e57c5fc3d478c8c6f8ca451e8fb383c09f47795) Thanks [@NovaShang](https://github.com/NovaShang)! - Annotation shapes — rectangles, lines and tables, alongside the existing text notes, so a diagram can be dressed up into a finished drawing sheet.
  - **Rectangle / group frame** (F): drag to draw (Shift for a square); solid or dashed stroke, optional faint tint fill, and an optional corner label — the dashed-box-around-a-cabinet convention. Purely decorative: the interior is click-transparent so it never blocks selecting the devices inside it.
  - **Line** (L): drag to draw (Shift snaps to 45°); solid/dashed, with optional end or both-ends arrowheads for leaders and dividers. Endpoints are draggable after the fact.
  - **Table** (D): drag to sweep out an N×M grid with a live column×row count, or click for a default 3×3. Double-click any cell to edit inline with spreadsheet keys (Tab across, Enter down, Esc to close); drag the outer grips to scale or the internal borders to size individual columns/rows; add/remove rows and columns from the property panel.

  Editing model: click to select, click again (or double-click) to edit — text opens its inline editor, a table opens the cell under the cursor. A floating ✓ / ✕ toolbar follows the active editor (Enter / ✓ confirm, Esc / ✕ cancel), and a bottom hint tells the user how to edit whatever is selected. Text/table content, and property-panel edits like table row/column count, repaint live.

  All shapes get 8-point resize handles (line gets per-vertex grips), participate in select / move / copy-paste / delete / undo-redo, are theme-aware, and render identically in SVG, PNG and DXF exports (and the AI `render_diagram` feedback raster). `DiagramFile.annotations` is now a discriminated union (`text | rect | line | table`); files written before this release load unchanged (a typeless annotation is treated as text). New exports on the public API: `Annotation`, `RectAnnotation`, `LineAnnotation`, `TableAnnotation`, and the `annotationKind` / `isTextAnnotation` helpers.

## 0.14.0

### Minor Changes

- [`2129a5d`](https://github.com/NovaShang/sldeditor/commit/2129a5d11495051e6680674689532bbd5db412d1) Thanks [@NovaShang](https://github.com/NovaShang)! - Junction dots now follow the schematic solder-dot convention instead of always being drawn. A visible dot appears at rest only where 3+ conductors meet (a real tee/cross); a corner or pass-through junction (degree ≤ 2) stays hidden so the canvas isn't peppered with unnecessary dots. Hidden junctions still reveal themselves whenever the user might act on them — on hover of the junction or a connected wire, while a drawing/placing tool (wire/place/junction/busbar) is active, and on selection — and the wide invisible hit target keeps every junction clickable regardless. Exports (SVG/PNG, and the AI `render_diagram` raster) now omit degree ≤ 2 dots, matching the convention. `ResolvedJunction` gains a `degree` field, and the canvas host carries a `data-tool` attribute reflecting the active tool.

## 0.13.1

### Patch Changes

- [`c4d167a`](https://github.com/NovaShang/sldeditor/commit/c4d167abf546abceb3f30f0387dc9fa929218c2f) Thanks [@NovaShang](https://github.com/NovaShang)! - Symbol orientation + embed-inset fixes:
  - **panelboard orientation** — the distribution-centre symbol was drawn incoming-at-bottom (terminal `orientation: 's'`), which is upside down for a load (a load center takes its feeder from above). Flipped it vertically so the incoming terminal is at the top (`'n'`, matching the `load` / `ev-charger` convention) with the branch ways at the bottom.
  - **pv orientation** — the PV generator's DC terminal exited east at an off-axis point (`x: 50`), forcing layouts to shift downstream symbols by +50x to avoid a jogged wire. Moved it to the panel's bottom edge on the symbol axis (`x: 0`, `orientation: 's'`) so PV feeds straight down into a combiner/inverter like every other source.
  - **embedder inset regression** — `.ole-root` redeclared the embedder inset variables (`--ole-*-inset`) from `env(safe-area-inset-*)`, shadowing a host's own value for every floating panel inside the editor. An embedding app that reserved right-edge space (e.g. for a side panel) had its properties panel drawn underneath that space. Safe-area now lives in separate `--ole-safe-*` variables and the floating chrome sums the two, so both the host inset and the mobile safe-area are honored.

## 0.13.0

### Minor Changes

- [`afdeeaf`](https://github.com/NovaShang/sldeditor/commit/afdeeaf46950675c3f4c5c835607aed4b750d41f) Thanks [@NovaShang](https://github.com/NovaShang)! - New `label` field on wires (`Wire.label?: string`) — a short text rendered mid-wire, intended for phase designations (L1 / L2 / L3 / N / PE). The label anchors at the midpoint of the wire's longest rendered segment, offset clear of the line, and always stays upright: centered above horizontal runs, flowing right of vertical ones. Editable via a new Label input in the properties panel when a wire is selected, included in SVG/PNG and DXF exports, and carried through to `WireRender.label` for embedding apps. Labels survive copy/paste and wire splits, and round-trip untouched through save/load.

## 0.12.1

### Patch Changes

- [`43cd53d`](https://github.com/NovaShang/sldeditor/commit/43cd53d0abe9cacf44e42bbc9fccec09f88f1acc) Thanks [@NovaShang](https://github.com/NovaShang)! - Fixes from SmartSLD production sessions and the W26 expert review:
  - Note fields in the properties panel now autosave while typing (debounced ~350ms) and flush on blur/unmount, so a note can no longer be lost by clicking away or closing the panel. Enter still inserts a newline.
  - Element name labels are rotation/mirror-aware: at rot 180 the label sits beside the symbol instead of striking through it, and at rot 90/270 it centers below/above the symbol. Applied consistently to the canvas, SVG/PNG export, and DXF export.
  - Breaker terminal pin digits ("1"/"2") no longer clutter diagrams and exports: they are hidden during normal viewing (fixing the garbled look of rot-90 bus-tie breakers) and excluded from SVG/PNG/DXF exports entirely, appearing only while the wire/place tool is active or the breaker is selected.

## 0.12.0

### Minor Changes

- [`c6b2ad2`](https://github.com/NovaShang/sldeditor/commit/c6b2ad2b4f51efaa127a04882aa5b326e9349751) Thanks [@NovaShang](https://github.com/NovaShang)! - Add `panelboard` element (IEC 60617 "distribution centre" — a load-center / distribution-board symbol with its incoming terminal at the bottom), and export `TextAnnotation`, `AnnotationId`, and `newAnnotationId` so embedding apps can create free-text annotations programmatically.

## 0.11.0

### Minor Changes

- [`94ca999`](https://github.com/NovaShang/sldeditor/commit/94ca9993630ee49e76ccef5b4c4101d352297ae5) Thanks [@NovaShang](https://github.com/NovaShang)! - Add a `readOnly` prop to `<OneLineEditor>` for a view-only share/viewer mode. All pan/zoom/touch gestures (wheel, trackpad, pinch, multi-touch, space+drag) and fit-to-content on load are preserved, while every editing interaction and all editing chrome (tool/property panels, contextual + library popovers, onboarding, right-click / long-press menu, keyboard shortcuts) are disabled. The passed `diagram` always wins over any persisted document in this mode, and a read-only instance never writes to storage — so mounting a viewer can't clobber the editor's autosaved work.

## 0.10.5

### Patch Changes

- [`fba4981`](https://github.com/NovaShang/sldeditor/commit/fba4981fa2411012c2df943e8e6ff856514ffc72) Thanks [@NovaShang](https://github.com/NovaShang)! - Onboarding step 3 now makes clear a busbar is a shared rail, not a connecting wire — countering the common misuse of drawing a bus to join two devices. Title changed to "A busbar is a shared rail, not a wire" and the body steers point-to-point connections to the wire tool.

## 0.10.4

### Patch Changes

- [`1925613`](https://github.com/NovaShang/sldeditor/commit/1925613e1bcb1d89cb7b963f25f79f408aa5d877) Thanks [@NovaShang](https://github.com/NovaShang)! - Fix positionless junctions collapsing when wired to other junctions. The fallback that positions a junction without explicit coordinates only counted device/bus neighbours, so a chain of coordinate-less junctions (e.g. collection-junction → main-junction) landed on top of each other or at the origin. Junction→junction wires now contribute, and the fallback is solved iteratively so device/bus anchors propagate along the chain — junctions spread to sensible positions instead of collapsing.

## 0.10.3

### Patch Changes

- [`8e9746b`](https://github.com/NovaShang/sldeditor/commit/8e9746b0990d8cd320cb19ed9a695ac8a5e45aa9) Thanks [@NovaShang](https://github.com/NovaShang)! - Fix the inverter symbol's orientation. It was the only converter in the library drawn DC-top / AC-bottom — the opposite of every other AC/DC converter (rectifier, converter-bidir, power-supply are all AC-top / DC-bottom), so in a normal PV-below-grid-above layout it rendered upside-down. A full vision audit of all 88 symbols confirmed the inverter is the only one affected.

  The fix adds a declarative `transform` (flipV / flipH / rotate180) to the library build pipeline that re-orients a converted QET symbol's graphic **and** terminals together about the viewBox centre, and applies `flipV` to the inverter. The inverter now presents t_ac on top and t_dc on bottom.

  Note: diagrams that reference `inverter.t_dc` / `inverter.t_ac` will have those endpoints remap to the corrected physical terminals — which fixes (rather than breaks) diagrams drawn with the natural PV → inverter → grid flow.

## 0.10.2

### Patch Changes

- [`f94e909`](https://github.com/NovaShang/sldeditor/commit/f94e909c0646f6ced92d1b1e6ccae32b86054448) Thanks [@NovaShang](https://github.com/NovaShang)! - Default element label position moved from the symbol's top-right to its right edge, vertically centered. Labels without an explicit per-symbol anchor (currently all of them) now sit beside the middle of the symbol, which reads better for typical one-line names. Shared with the SVG/DXF exporters, so exported labels move too.

- [`245f531`](https://github.com/NovaShang/sldeditor/commit/245f531f4ad9b31e0e73628c0a52bba5db698d90) Thanks [@NovaShang](https://github.com/NovaShang)! - Render junctions as a smaller, less prominent dot (visible radius 4 → 2.5). The click/drag target is unchanged, so junctions are still easy to grab; they just read as a discreet connection point rather than a heavy blob.

## 0.10.1

### Patch Changes

- [`7c4cc7e`](https://github.com/NovaShang/sldeditor/commit/7c4cc7e39fb97d4376acdd3d20d45f0134850cac) Thanks [@NovaShang](https://github.com/NovaShang)! - Auto-remove junctions left orphaned by a delete. When deleting a wire (or an element/node whose removal drops wires), any junction that was an endpoint of a removed wire and now has no remaining connection is deleted in the same step. Junctions that still have another wire, and standalone junctions the user placed deliberately, are kept. This stops bus-less diagrams from accumulating dangling connection dots after edits.

## 0.10.0

### Minor Changes

- [`b6166d7`](https://github.com/NovaShang/sldeditor/commit/b6166d78bba9c7dd7a1455946eba7f5244723740) Thanks [@NovaShang](https://github.com/NovaShang)! - Pull a wire out of a junction in the select tool. A solo-selected junction now shows a small wire-pull handle offset from its dot; dragging the handle starts a wire from the junction (resolving to a connectable, a wire-tap, or empty space → a new junction, with the live preview), while dragging the dot itself still moves the junction. This closes the last gap in the unified gesture model: a junction is now a full peer of a device terminal as a select-tool wire source, without overloading its move gesture.

## 0.9.1

### Patch Changes

- [`115e5be`](https://github.com/NovaShang/sldeditor/commit/115e5be4c002db1d8f9bba0db44f9b20294f498e) Thanks [@NovaShang](https://github.com/NovaShang)! - Show the dashed wire preview while dragging a wire out of a selected element's terminal in the select tool. The gesture already created the wire on release, but `WirePreview` only renders when `wireDragFrom` is set and the select-tool path never set it — so there was no rubber-band line and users couldn't tell a wire was being created. The select-tool drag now feeds the same drag-origin the wire tool uses (and clears it on end), so the preview line + landing marker show throughout the drag.

## 0.9.0

### Minor Changes

- [`0bcd974`](https://github.com/NovaShang/sldeditor/commit/0bcd9747086b8e6636c6226360c7e18d8ec30a94) Thanks [@NovaShang](https://github.com/NovaShang)! - Unify the place/connect gestures now that junctions are first-class, so bus-less diagrams feel the same as bus-based ones:
  - **Drag a connected element out of a junction.** In place mode you can already drag a new element off a bus to create it pre-connected; the same gesture now works from a junction. `resolvePlaceSource` treats a junction as a valid place source (orientation points from the junction toward the cursor so the body extends away), and the dashed placement preview works too.
  - **Free-ended wires from a selected terminal.** In the select tool, dragging a wire out of a selected element's terminal now uses the same resolution as the dedicated wire tool: the far end can land on a connectable (pin/bus/junction), tap into an existing wire, or fall in empty space — which mints a junction (a free end). Previously the select-tool drag only connected when it landed on another existing connectable. The shared logic lives in a new `wire-drag` module used by both tools.

  Selecting and dragging a junction or bus body in the select tool still moves it (unchanged); start a wire from those with the wire tool.

## 0.8.0

### Minor Changes

- [`6bbff6d`](https://github.com/NovaShang/sldeditor/commit/6bbff6d5d4e27fbad81282174a7f87ad15a21371) Thanks [@NovaShang](https://github.com/NovaShang)! - Non-bus-first onboarding + crossing-vs-connecting wire gaps

  **Onboarding.** The first-run card no longer teaches "draw a busbar first". It now leads with the general flow — place a component → wire pins together (drag into empty space to drop a junction) → reach for a busbar only when several circuits share one rail — matching the free-wire / junction model.

  **Crossing ≠ connecting.** Where two wires of different electrical nodes cross with no junction, the under-wire is now drawn with a small gap at the crossing, so a crossover reads unambiguously as _not connected_. A junction dot remains the only "connected" signal. Hit-testing/selection still spans the whole wire (the gap is visual only).

## 0.7.0

### Minor Changes

- [`05706ac`](https://github.com/NovaShang/sldeditor/commit/05706ac51510a46ffe29584c55da44b0f99fa663) Thanks [@NovaShang](https://github.com/NovaShang)! - Top-down tree layout for bus-less diagrams + forgiving wire-tap snap

  **Bus-less auto-layout.** Radial / tree circuits (a source → chain → branches at junctions, with no busbar) previously fell into a weak seed-and-grid fallback that crammed everything into a thin horizontal strip with mixed rotations. They now get a proper **top-down tidy-tree** layout: the source at the top, flow descending, branches spreading horizontally at each junction, and devices rotated so the upstream terminal faces up. Junctions are positioned as the hub of their net (the tree branches _at_ the junction). Bus-structured diagrams are unaffected — the tree pass only runs for connected components with no bus and no explicit placement, and its placements are frozen against the bus cleanup sweeps.

  **Wire-tap snap.** Dropping a wire near an existing wire now snaps onto it and taps in a junction within a forgiving screen-space tolerance (not just an exact hit), making the "tap a line" gesture reliable at any zoom.

## 0.6.1

### Patch Changes

- [`4274948`](https://github.com/NovaShang/sldeditor/commit/4274948d00ad961ec30151812f587ebea580e28f) Thanks [@NovaShang](https://github.com/NovaShang)! - Fix: junctions couldn't be dragged in the select tool

  `SelectTool` only collected buses and layout-placed devices into the drag set, so a selected junction (which lives outside `internal.layout`, like a bus) produced an empty drag set and the gesture never started. Junctions are now a third draggable category alongside buses — drag-to-move with live preview, marquee box-selection, and clean rollback on gesture cancel.

## 0.6.0

### Minor Changes

- [`169bdb3`](https://github.com/NovaShang/sldeditor/commit/169bdb32fadce9a4ee07f4ab99cdd948b4c9b903) Thanks [@NovaShang](https://github.com/NovaShang)! - Fix reversed terminal IDs on `transformer-2w`, `ct`, `pt`, `fuse`, and `grounding-transformer`

  These five elements inherited their terminal order straight from the QElectroTech source, which lists the bottom terminal first — so `t1` ended up at the bottom and `t2` at the top, the opposite of the library-wide convention (`t1` = top/north, `t2` = bottom/south) that every other two-terminal element follows. Because auto-layout derives a symbol's rotation from the local Y of the pin wired to the upper bus, wiring an upper bus to `t1` made these symbols render rotated 180° with awkward wire routing.

  Terminal geometry is unchanged; only the `t1`/`t2` assignment is swapped so it matches the convention. The `grounding-transformer` wiring in the `complex-substation` fixture was updated to keep pointing at the same physical terminals.

  Note: any saved diagram that references `<id>.t1` / `<id>.t2` on these kinds will have those endpoints remapped to the opposite physical terminal. For diagrams that were authored assuming the standard `t1` = top convention (including AI-generated ones), this corrects the rendering.

- [`235a171`](https://github.com/NovaShang/sldeditor/commit/235a171ca9a96d86c77bb90bc1a3966bfeef4795) Thanks [@NovaShang](https://github.com/NovaShang)! - Add free-standing **junctions** and free-drawn wires

  Wires no longer need two pre-existing anchors. The wire tool now connects from any starting point — a device pin, a bus, a junction, or **empty space** — to any ending point. Releasing in empty space drops a **junction** (a first-class point connection node) and wires to it; releasing on an existing wire taps in a junction and splits that wire, all as a single undo step. This removes the old workaround where users (and the AI agent) fabricated thin buses to stand in for ordinary point-to-point wiring.

  New model surface:
  - `DiagramFile.junctions: Junction[]` — a junction is a peer to `Bus` with point geometry `{ at: [x, y] }` (no span). Ids share the element/bus namespace (prefix `J`).
  - `WireEnd` widens to `TerminalRef | BusId | JunctionId`; a bare wire end now resolves to a bus **or** a junction.
  - New exports: `Junction`, `JunctionId`, `JunctionLayout`, `ResolvedJunction`, `newJunctionId`, and `InternalModel.junctions`.
  - New `JunctionTool` (toolbar + `J` hotkey) to place a junction deliberately.

  Backward compatible: existing diagrams (no `junctions`) load and render unchanged; explicit placements are still frozen by auto-layout, and junctions are connectivity-transparent so device-to-device chains wired through a junction lay out as before.

## 0.5.0

### Minor Changes

- [`f3ccce3`](https://github.com/NovaShang/sldeditor/commit/f3ccce362a6e7fc76bdb56d14583c89de4041ed8) Thanks [@NovaShang](https://github.com/NovaShang)! - Auto-layout now treats explicit placements as authoritative: the overlap-resolution and repack passes (6b/6c/6d) never move user/AI-provided element positions or rewrite explicit bus geometry, and overlap shifts move by the actual overlap amount instead of the colliding pair's union width (which compounded into huge displacements on dense layouts).

## 0.4.0

### Minor Changes

- [`1c74081`](https://github.com/NovaShang/sldeditor/commit/1c740812ee87ed6243b9d379530d52ab6d9cc918) Thanks [@NovaShang](https://github.com/NovaShang)! - Auto-layout: fix overlapping / sprawling layouts in complex diagrams.
  - Multiple sources/transformers feeding one bus no longer stack on the same column (co-tier feeds are spread laterally).
  - Same-tier independent buses are packed tightly to their actual extent instead of sprawling to fixed wide spans.
  - Parallel-branch tap slots now size to their subtree width, so a CT feeding a load + earthing switch no longer collides with adjacent taps.
  - Bus-less / sparse diagrams (e.g. a PV string → inverter chain) lay out as vertical chains instead of dumping into a fallback grid.
  - Verified zero symbol overlaps across the repro + clean diagram set; 90/90 tests pass.

  i18n: added English names, descriptions, and param/state labels for all 41 library symbols introduced in v0.3 (resistor, relays, power-electronics, instruments, PLC/UPS, …). They previously fell back to their Chinese names in English mode.

## 0.3.0

### Minor Changes

- [`bb8867e`](https://github.com/NovaShang/sldeditor/commit/bb8867ee5832820901ce2528ac959ee794845f33) Thanks [@NovaShang](https://github.com/NovaShang)! - Expand the element library 47 → 88, sourced from the QElectroTech / IEC 60617 collection via the build pipeline:
  - passives: resistor, capacitor, inductor, diode, zener, thyristor, triac, IGBT
  - control / signalling: indicator light, push-button, relay coil, NO/NC contacts, bell, buzzer, siren, selector / limit / proximity switch, time relay
  - protective relays: overcurrent (50/51), undervoltage (27), reverse-power (32), distance (21), phase-failure, Buchholz (63), general measuring relay
  - instruments: power-factor meter, synchronoscope, varmeter, thermocouple
  - distribution / misc: terminal-junction, socket-outlet, fuse switch-disconnector, heater, voltage regulator, DC motor
  - labelled boxes (no standard IEC symbol): PLC, UPS, switched-mode PSU, genset

  Adds `passive` and `control` palette categories. Also fixes text-entity double-escaping in the element build pipeline — relay function glyphs (`U<`, `Z<`, `m<3`) were rendering as literal `&lt;`.

## 0.2.0

### Minor Changes

- [`b40c61a`](https://github.com/NovaShang/sldeditor/commit/b40c61a72733ea0623a9b24071ed2ddc442a89cd) Thanks [@NovaShang](https://github.com/NovaShang)! - Drag a selected bus to move it. SelectTool and PanTool now track each selected bus's `geometry.at`, preview the drag with a `translate(dx dy)` on the wrapper `<g>`, and commit the move through `moveElements` (which routes bus ids to a `bus.layout.at` patch). Buses also now inherit theme color via `currentColor` instead of the hardcoded `black`.

  Also fixes a bug where a bus body click was eaten by the connected wire's 12px hit polyline (which sits above the bus in z-order, so clicks near a wire endpoint resolved to the wire instead of the bus). SelectTool now walks the click stack when the immediate hit-test misses, and rewrites the target to the underlying bus when the cursor's wire is endpoint-connected to it. Wires that merely cross a bus mid-path still select normally on click.

## 0.1.0

### Minor Changes

- [`9661e98`](https://github.com/NovaShang/sldeditor/commit/9661e9814e7e5f57a8170c88a30b03b472531664) Thanks [@NovaShang](https://github.com/NovaShang)! - Edit wire paths with vertex/midpoint handles. Selecting a wire reveals draggable corner handles (orthogonal-constrained) and segment midpoints that bend a segment perpendicular to its axis; double-click a vertex to remove it. A new "Reset to auto-route" action in the contextual toolbar clears the manual path.

  Manual paths now track their connected elements: the compiler rebases the first/last point of `Wire.path` to the current terminal/bus world coords on every compile, and `normalizePath` (new in `src/model/wire-path.ts`) folds duplicates, removes collinear runs, and converts any diagonal segment into an L-corner — so user edits and persisted legacy paths both render cleanly.

  `deleteSelectedWire` now freezes the auto-laid-out positions of the non-bus elements it touches into `diagram.layout`, matching the existing behavior of `deleteSelectedNode`. Removing the wire that anchors a downstream element to a bus no longer causes that element to relocate.

## 0.0.2

### Patch Changes

- [`cf59604`](https://github.com/NovaShang/sldeditor/commit/cf596043472caec8572b5491ac199992809d9ad2) Thanks [@NovaShang](https://github.com/NovaShang)! - Include element labels and free text annotations in SVG/PNG exports — previously only DXF carried them, leaving the raster/vector outputs missing the IDs, showOnCanvas params, and any notes the user dropped via the text tool. `downloadSvg` / `downloadPng` now honor `labelMode` and accept an `annotations` array (defaults wired through `ExportMenu`). Label/annotation positioning matches the canvas exactly because all three surfaces — `AnnotationLayer`, DXF, SVG — now share a single helper module.
