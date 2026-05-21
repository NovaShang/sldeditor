---
'sldeditor': minor
---

Drag a selected bus to move it. SelectTool and PanTool now track each selected bus's `geometry.at`, preview the drag with a `translate(dx dy)` on the wrapper `<g>`, and commit the move through `moveElements` (which routes bus ids to a `bus.layout.at` patch). Buses also now inherit theme color via `currentColor` instead of the hardcoded `black`.

Also fixes a bug where a bus body click was eaten by the connected wire's 12px hit polyline (which sits above the bus in z-order, so clicks near a wire endpoint resolved to the wire instead of the bus). SelectTool now walks the click stack when the immediate hit-test misses, and rewrites the target to the underlying bus when the cursor's wire is endpoint-connected to it. Wires that merely cross a bus mid-path still select normally on click.
