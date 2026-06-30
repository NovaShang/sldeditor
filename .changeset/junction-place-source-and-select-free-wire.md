---
"sldeditor": minor
---

Unify the place/connect gestures now that junctions are first-class, so bus-less diagrams feel the same as bus-based ones:

- **Drag a connected element out of a junction.** In place mode you can already drag a new element off a bus to create it pre-connected; the same gesture now works from a junction. `resolvePlaceSource` treats a junction as a valid place source (orientation points from the junction toward the cursor so the body extends away), and the dashed placement preview works too.
- **Free-ended wires from a selected terminal.** In the select tool, dragging a wire out of a selected element's terminal now uses the same resolution as the dedicated wire tool: the far end can land on a connectable (pin/bus/junction), tap into an existing wire, or fall in empty space — which mints a junction (a free end). Previously the select-tool drag only connected when it landed on another existing connectable. The shared logic lives in a new `wire-drag` module used by both tools.

Selecting and dragging a junction or bus body in the select tool still moves it (unchanged); start a wire from those with the wire tool.
