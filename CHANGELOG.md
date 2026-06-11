# sldeditor

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
