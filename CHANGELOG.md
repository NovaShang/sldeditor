# sldeditor

## 0.1.0

### Minor Changes

- [`9661e98`](https://github.com/NovaShang/sldeditor/commit/9661e9814e7e5f57a8170c88a30b03b472531664) Thanks [@NovaShang](https://github.com/NovaShang)! - Edit wire paths with vertex/midpoint handles. Selecting a wire reveals draggable corner handles (orthogonal-constrained) and segment midpoints that bend a segment perpendicular to its axis; double-click a vertex to remove it. A new "Reset to auto-route" action in the contextual toolbar clears the manual path.

  Manual paths now track their connected elements: the compiler rebases the first/last point of `Wire.path` to the current terminal/bus world coords on every compile, and `normalizePath` (new in `src/model/wire-path.ts`) folds duplicates, removes collinear runs, and converts any diagonal segment into an L-corner — so user edits and persisted legacy paths both render cleanly.

  `deleteSelectedWire` now freezes the auto-laid-out positions of the non-bus elements it touches into `diagram.layout`, matching the existing behavior of `deleteSelectedNode`. Removing the wire that anchors a downstream element to a bus no longer causes that element to relocate.

## 0.0.2

### Patch Changes

- [`cf59604`](https://github.com/NovaShang/sldeditor/commit/cf596043472caec8572b5491ac199992809d9ad2) Thanks [@NovaShang](https://github.com/NovaShang)! - Include element labels and free text annotations in SVG/PNG exports — previously only DXF carried them, leaving the raster/vector outputs missing the IDs, showOnCanvas params, and any notes the user dropped via the text tool. `downloadSvg` / `downloadPng` now honor `labelMode` and accept an `annotations` array (defaults wired through `ExportMenu`). Label/annotation positioning matches the canvas exactly because all three surfaces — `AnnotationLayer`, DXF, SVG — now share a single helper module.
