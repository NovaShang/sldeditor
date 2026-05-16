---
'sldeditor': minor
---

Edit wire paths with vertex/midpoint handles. Selecting a wire reveals draggable corner handles (orthogonal-constrained) and segment midpoints that bend a segment perpendicular to its axis; double-click a vertex to remove it. A new "Reset to auto-route" action in the contextual toolbar clears the manual path.

Manual paths now track their connected elements: the compiler rebases the first/last point of `Wire.path` to the current terminal/bus world coords on every compile, and `normalizePath` (new in `src/model/wire-path.ts`) folds duplicates, removes collinear runs, and converts any diagonal segment into an L-corner — so user edits and persisted legacy paths both render cleanly.

`deleteSelectedWire` now freezes the auto-laid-out positions of the non-bus elements it touches into `diagram.layout`, matching the existing behavior of `deleteSelectedNode`. Removing the wire that anchors a downstream element to a bus no longer causes that element to relocate.
