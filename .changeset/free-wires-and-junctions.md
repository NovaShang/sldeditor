---
"sldeditor": minor
---

Add free-standing **junctions** and free-drawn wires

Wires no longer need two pre-existing anchors. The wire tool now connects from any starting point — a device pin, a bus, a junction, or **empty space** — to any ending point. Releasing in empty space drops a **junction** (a first-class point connection node) and wires to it; releasing on an existing wire taps in a junction and splits that wire, all as a single undo step. This removes the old workaround where users (and the AI agent) fabricated thin buses to stand in for ordinary point-to-point wiring.

New model surface:

- `DiagramFile.junctions: Junction[]` — a junction is a peer to `Bus` with point geometry `{ at: [x, y] }` (no span). Ids share the element/bus namespace (prefix `J`).
- `WireEnd` widens to `TerminalRef | BusId | JunctionId`; a bare wire end now resolves to a bus **or** a junction.
- New exports: `Junction`, `JunctionId`, `JunctionLayout`, `ResolvedJunction`, `newJunctionId`, and `InternalModel.junctions`.
- New `JunctionTool` (toolbar + `J` hotkey) to place a junction deliberately.

Backward compatible: existing diagrams (no `junctions`) load and render unchanged; explicit placements are still frozen by auto-layout, and junctions are connectivity-transparent so device-to-device chains wired through a junction lay out as before.
